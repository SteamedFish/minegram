/**
 * The pointer-drag state machine (spec §3.1–§3.4), plus the keyboard requests the
 * grid's roving index needs (§3.4) and the flag §3.3's `touch-action` scoping binds to.
 *
 * Pure by construction: no React, no `Math.random`, no clock, no timers, and no DOM
 * lookup other than the injected `cellIndexAt` port. The host owns
 * `document.elementFromPoint` + `closest('[data-cell-index]')` and the "is this index
 * inside this board" test; this file only asks questions through ports. Nothing here
 * ever holds a `GameState` — the preview arrives as a `PreviewView` from the store
 * (§4.5: the preview must come from the store, never be re-derived here, so the
 * preview styling and the committed outcome can never disagree).
 *
 * ─── Why the preview is a port ───────────────────────────────────────────────────────
 * `previewMarkBatch(state, cells)` needs the raw state, so only `store.preview` /
 * `store.previewOf` may call it (§4.4 / risk 3). The controller therefore holds a
 * `PreviewView` and the per-cell verdicts it is handed, and the host renders
 * `data-preview` from `previewVerdictOf(index)`.
 *
 * ─── Phases ──────────────────────────────────────────────────────────────────────────
 * `idle → armed → painting → idle`, with `pointercancel` / `lostpointercapture` /
 * `Escape` going back to `idle` through an *abort* that never dispatches, and a
 * terminal `aborted` latch that swallows the `pointerup` the browser may still
 * deliver afterwards.
 *
 * ─── How a late `pointerup` can never commit ─────────────────────────────────────────
 * Two independent mechanisms, because they cover different windows:
 *
 * 1. **The abort latch.** Any abort records the aborted `pointerId`; a later
 *    `pointerup`/`pointercancel`/`lostpointercapture` carrying that id is dropped and
 *    only then clears the latch. The next `pointerdown` supersedes the latch.
 * 2. **The monotonic token.** Every arm mints `state.token`. A host that stamps its
 *    events (`event.token = controller.getSnapshot().token`) gets the *other* window
 *    covered — a stale event arriving after a fresh `pointerdown` has re-armed.
 *
 * For a real pointer the two are belt and braces: same-pointer events are delivered
 * in order, so an old `pointerup` cannot overtake a new `pointerdown`. The token
 * exists for hosts that dispatch synthetic or reordered events.
 *
 * ─── Coalesced samples, never interpolation ──────────────────────────────────────────
 * A fast flick delivers few `pointermove` samples and would skip cells, so every
 * sub-frame sample from `getCoalescedEvents()` is hit-tested. Nothing is interpolated
 * between samples: inventing cells the finger never crossed is both wrong and
 * expensive in score.
 *
 * ─── The host's one rule ──────────────────────────────────────────────────────────────
 * This machine is the only place a pointer gesture becomes a game action. The host
 * renders and forwards; it must never dispatch a mark, a clear or a focus of its own,
 * because a second dispatch path is a second score and preview that can disagree with
 * the one the player was shown.
 *
 * ─── Two deliberate deviations from the literal §3.1 text ────────────────────────────
 * 1. **Erase is a real drag mode.** §3.1 row 1 resolves `mode` to
 *    `Exclude<MarkingMode,'erase'>` with a `'mine'` fallback for the left button, but
 *    §3.2 requires Erase to collect indices and dispatch one `round/clearMark` per
 *    index, capped at 64 per drag. The cap only exists if erase is a mode, so the
 *    left button in Erase mode takes the clear path rather than falling back to
 *    `'mine'`. `state.mode` is therefore `MarkingMode | null`, and
 *    `getSnapshot().preview` is `null` while erasing (there is no assertion to
 *    preview). The widened type is deliberate (ruled in Phase 4 review), not a slip.
 * 2. **`Shift`+right-click is a cell action, not a mode change.** It clears the
 *    pressed cell, works in every mode including Erase, and leaves the toolbar mode
 *    alone — which is how §3.7's control table and §3.2's "right-click is acceleration
 *    only" rule coexist without a third right-click behaviour. See `onPointerDown`.
 *
 * ─── Host wiring ─────────────────────────────────────────────────────────────────────
 * ```tsx
 * const ctrl = useRef<DragController>(null) ?? (ctrl.current = new DragController(ports));
 * useSyncExternalStore(ctrl.subscribe, ctrl.getSnapshot, ctrl.getSnapshot);
 *
 * const hints = (e: React.PointerEvent) => {
 *   const h = ctrl.current.onPointerDown(e.nativeEvent);
 *   if (h.preventDefault) e.preventDefault();     // board surface only
 *   return h;
 * };
 * <div className="mg-board-stage"
 *   onPointerDown={hints} onPointerMove={hints} onPointerUp={hints}
 *   onPointerCancel={hints} onLostPointerCapture={hints}
 *   onContextMenu={e => e.preventDefault()}       // board-scoped, per §3.2
 *   onKeyDown={onKey}                             // M / B / Delete / arrows / Escape
 *                                                 // the handlers only forward
 *   data-dragging={snapshot.phase === 'idle' ? undefined : 'true'}
 *   data-finger-marking={snapshot.fingerMarking ? 'on' : 'off'}>
 * ```
 * `preventContextMenu` on the `pointerdown` hints is the value to apply for
 * cell-scoped suppression (`(e.target as Element).closest('[data-cell-index]')`).
 */
import type { MarkingMode, PreviewView } from './viewModel'

// --------------------------------------------------------------------------------------
// Vocabulary
// --------------------------------------------------------------------------------------

/**
 * The assertion a cell can carry. Structurally identical to the application's
 * `CellAssertion`, so `DragCell` is assignable to the store's
 * `{ index: number; assertion: CellAssertion }` and `previewOf` accepts it.
 */
export type DragAssertion = 'mine' | 'blank'

/** One cell of a pending batch, insertion-ordered and deduplicated. */
export interface DragCell {
  readonly index: number
  readonly assertion: DragAssertion
}

/**
 * Per-cell preview verdict, bound to `data-preview` by the stylesheet. §1.5's four
 * preview looks and §1.6's "drag preview" row map one-to-one:
 *
 * - `hit` — will be applied, costs nothing → 2px dotted `--focus` inset outline.
 * - `risk` — will be applied, costs 1 point → 2px dotted `--accent` + wrong glyph.
 * - `none` — no-op for this cell (identical mark, locked, not in the drag, or erasing)
 *   → deliberately **not** outlined, so "nothing happens here" reads as absence.
 * - `none-while-inert` — the board is not interactive, so nothing can happen at all.
 */
export type PreviewVerdict = 'hit' | 'risk' | 'none' | 'none-while-inert'

export type DragPhase = 'idle' | 'armed' | 'painting'

/**
 * The frozen snapshot the host renders from. Immutable: a new object is published on
 * every transition, so `useSyncExternalStore` can compare by reference.
 */
export interface DragState {
  readonly phase: DragPhase
  readonly pointerId: number | null
  /** Resolved at `pointerdown`; `'erase'` takes the clear path (§3.2). */
  readonly mode: MarkingMode | null
  /** Monotonic; minted on every arm. Guards late events. */
  readonly token: number
  /** Insertion-ordered, deduplicated. */
  readonly cells: readonly number[]
  readonly lastIndex: number | null
  /** From `ports.preview`, never re-derived here (§4.5). `null` while erasing. */
  readonly preview: PreviewView | null
  /** `true` once more than one cell has been seen — "this was a drag", not a tap. */
  readonly moved: boolean
  /** Erase hit `ERASE_CAP`; survives the release so the chip can still say so. */
  readonly capReached: boolean
  /**
   * The §3.3 toggle, as the user set it. This is what `data-finger-marking` binds to, so
   * the stylesheet owns the whole `touch-action` decision. For the live question "may a
   * finger paint *right now*", read `canPaint()` — the toggle alone is not enough.
   */
  readonly fingerMarking: boolean
}

/**
 * What the host must prevent. Applied by the host, scoped to the board surface; this
 * module never calls `preventDefault` itself.
 */
export interface DragEventHints {
  readonly preventDefault: boolean
  readonly preventContextMenu: boolean
}

/** A transition: only the fields that change. Mutable, so a caller can branch on it. */
type DragPatch = { -readonly [K in keyof DragState]?: DragState[K] }

export interface DragControllerOptions {
  readonly markingMode?: MarkingMode
  readonly fingerMarking?: boolean
}

/** §3.2: an erase drag collects at most this many indices, then stops. */
export const ERASE_CAP = 64

/**
 * Everything the machine needs from its host. `cellIndexAt` is the *only* DOM-shaped
 * question asked, and the host answers it with
 * `document.elementFromPoint(x, y)?.closest('[data-cell-index]')` plus the
 * "index is inside this board" test — which is how a rail cell or the padding outside
 * the stage comes back as `null`.
 */
export interface DragPorts {
  /** `status === 'playing'`. False makes every cell inert (§3.1 guarantee). */
  readonly interactive: () => boolean
  readonly cellIndexAt: (clientX: number, clientY: number) => number | null
  /** Whole-batch preview. `null` when the store cannot answer. */
  readonly preview: (cells: readonly DragCell[]) => PreviewView | null
  /** Single-cell verdict, so preview styling and outcome come from one function. */
  readonly previewOf: (index: number, assertion: DragAssertion) => 'hit' | 'risk' | 'none'
  readonly commit: (cells: readonly DragCell[]) => void
  readonly clear: (index: number) => void
  /** Host moves DOM focus and its roving index here. */
  readonly focus: (index: number) => void
  /** Host calls `setPointerCapture` / `releasePointerCapture` on the stage. */
  readonly setCaptured: (pointerId: number | null) => void
}

/** §3.4: what the grid's `onKeyDown` forwards here so M/B/Delete/arrows share one path. */
export type KeyboardRequest = 'mark-mine' | 'mark-blank' | 'clear' | 'move'

// --------------------------------------------------------------------------------------
// Event inputs
// --------------------------------------------------------------------------------------

/** The only thing a hit-test needs. `PointerEvent` and React's synthetic event both fit. */
export interface DragPoint {
  readonly clientX: number
  readonly clientY: number
}

/** Shared by every pointer input. `token` is optional: only stamped hosts get §1's stale-drop. */
export interface PointerEventBase extends DragPoint {
  readonly pointerId: number
  readonly token?: number
}

export interface PointerDownInput extends PointerEventBase {
  /** 0 = primary, 2 = secondary. Anything else is rejected (§3.1 row 1). */
  readonly button: number
  readonly isPrimary?: boolean
  /** `Shift`+right-click is a single-cell erase (see `onPointerDown`). */
  readonly shiftKey?: boolean
}

export interface PointerMoveInput extends PointerEventBase {
  readonly isPrimary?: boolean
  readonly getCoalescedEvents?: () => readonly DragPoint[]
}

/** `pointerup`, `pointercancel` and `lostpointercapture` share one shape. */
export type PointerEndInput = PointerEventBase

// --------------------------------------------------------------------------------------
// Constants
// --------------------------------------------------------------------------------------

const NO_HINTS: DragEventHints = Object.freeze({ preventDefault: false, preventContextMenu: false })
const DOWN_HINTS: DragEventHints = Object.freeze({ preventDefault: true, preventContextMenu: true })
const MOVE_HINTS: DragEventHints = Object.freeze({ preventDefault: true, preventContextMenu: false })
const EMPTY_BATCH: readonly DragCell[] = Object.freeze([])
const EMPTY_CELLS: readonly number[] = Object.freeze([])

/** §3.2: right-click is the opposite of the current assertion; erase has no opposite. */
function opposite(mode: MarkingMode): DragAssertion | null {
  if (mode === 'mine') return 'blank'
  if (mode === 'blank') return 'mine'
  return null
}

// --------------------------------------------------------------------------------------
// Controller
// --------------------------------------------------------------------------------------

/**
 * Create the machine. React owns one instance in a ref for the app's lifetime; it is
 * pure, so nothing here needs disposing beyond `reset()`.
 */
export function createDragController(
  ports: DragPorts,
  options: DragControllerOptions = {},
): DragController {
  return new DragController(ports, options)
}

export class DragController {
  private readonly ports: DragPorts
  private readonly listeners = new Set<() => void>()
  /** Never handed out unfrozen: the snapshot always publishes a frozen copy. */
  private cellList: number[] = []
  private readonly seen = new Set<number>()
  private tokenCounter = 0
  private latch: { readonly pointerId: number; readonly token: number } | null = null
  private markingMode: MarkingMode
  private fingerMarking: boolean
  private captured: number | null = null
  private state: DragState

  constructor(ports: DragPorts, options: DragControllerOptions = {}) {
    this.ports = ports
    this.markingMode = options.markingMode ?? 'mine'
    this.fingerMarking = options.fingerMarking ?? false
    this.state = Object.freeze({
      phase: 'idle',
      pointerId: null,
      mode: null,
      token: 0,
      cells: EMPTY_CELLS,
      lastIndex: null,
      preview: null,
      moved: false,
      capReached: false,
      fingerMarking: this.fingerMarking,
    })
  }

  // ---- snapshot & subscription (React reads through useSyncExternalStore) ------------

  /**
   * `getSnapshot` and `subscribe` are ARROW class fields, not prototype methods, and
   * that is load-bearing rather than stylistic.
   *
   * `useSyncExternalStore(subscribe, getSnapshot)` hands both to React, which invokes
   * them as free functions with no receiver. A prototype method therefore reads
   * `this.state` off `undefined` and throws `TypeError: Cannot read properties of
   * undefined (reading 'state')` on the first render — a failure at the very call site
   * that is supposed to prove the store is safe to read. An arrow field closes over the
   * instance at construction, so `const { getSnapshot } = controller; getSnapshot()` is
   * the same function the instance owns.
   *
   * The alternative — `this.getSnapshot = this.getSnapshot.bind(this)` in the
   * constructor — produces the same behaviour. The field is preferred because the class
   * then has exactly one spelling of every method and no init-order hazard: `useRef`
   * consumers can read a snapshot before the first `useEffect` has run.
   *
   * The same reasoning is why EVERY public member below is an arrow field, not just the
   * two store methods. The host wires `drag.onPointerDown` into a React prop, and React
   * invokes a prop as a member of the props object — so `onPointerDown={drag.onPointerDown}`
   * would run with `this === props` and read `this.state.phase` off the props object.
   * That is the identical crash with a more confusing stack, so the invariant is stated
   * once here and held by the whole public surface. Only the private helpers below stay
   * prototype methods, because nothing outside the class can reach them.
   */
  readonly getSnapshot = (): DragState => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  // ---- host-settable inputs ---------------------------------------------------------

  readonly setMarkingMode = (mode: MarkingMode): void => {
    this.markingMode = mode
  }

  /**
   * §3.3: this only moves the flag the stylesheet binds. The controller never gates on
   * it — with painting off, a swipe arrives as `pointercancel`, which the abort path
   * already handles, and a tap still marks exactly one cell.
   */
  readonly setFingerMarking = (enabled: boolean): void => {
    if (this.fingerMarking === enabled) return
    this.fingerMarking = enabled
    this.commit({ fingerMarking: enabled })
  }

  /**
   * §3.3: may a finger paint *right now*? A live read, not snapshot state — the store's
   * status can change without any drag transition, and a value frozen into the last
   * snapshot would quietly go stale. The host renders `data-finger-marking` from
   * `getSnapshot().fingerMarking` (a pure style decision) and uses this for anything that
   * has to be true at the moment of the event.
   */
  readonly canPaint = (): boolean => {
    return this.fingerMarking && this.ports.interactive()
  }

  // ---- §3.1 transition table ---------------------------------------------------------

  /**
   * Row 1. Returns hints for the host to apply; this module never calls `preventDefault`.
   *
   * §3.2, right-click resolves to the OPPOSITE of the current marking mode, never a
   * change of that mode, and is rejected when the mode is `erase` (erase has no
   * opposite). `Shift`+right-click is the exception and not an acceleration: it clears
   * the pressed cell and nothing else. It is a *cell action*, not a mode change — the
   * toolbar keeps whatever it had, and the next left-drag still paints the mode's
   * assertion — so the two rules cannot contradict each other. It works in every mode,
   * Erase included, where it is simply idempotent; the reducer reports
   * `locked-cell` / `cell-already-unknown` for the no-op cases, exactly as for
   * `Backspace` / `Delete`. No drag follows it: no `armed` phase, no capture, no cells.
   */
  readonly onPointerDown = (event: PointerDownInput): DragEventHints => {
    // One stroke at a time: a second finger, a second mouse button, or a duplicate
    // event must not restart a live drag.
    if (this.state.phase !== 'idle') return NO_HINTS
    if (event.isPrimary === false) return NO_HINTS
    if (event.button !== 0 && event.button !== 2) return NO_HINTS
    if (!this.ports.interactive()) return NO_HINTS

    // Row 7: a rail cell or a point outside the board resolves to null and is inert.
    const index = this.ports.cellIndexAt(event.clientX, event.clientY)
    if (index === null) return NO_HINTS

    if (event.button === 2 && event.shiftKey === true) {
      this.ports.clear(index)
      return DOWN_HINTS
    }

    const mode = this.resolveMode(event.button)
    if (mode === null) return NO_HINTS

    // A new stroke supersedes any earlier abort latch. `token` is deliberately not read
    // here: arming mints the next one, so a stamped pointerdown can never match.
    this.latch = null
    this.tokenCounter += 1
    this.cellList = [index]
    this.seen.clear()
    this.seen.add(index)
    this.captured = event.pointerId
    this.commit({
      phase: 'armed',
      pointerId: event.pointerId,
      mode,
      token: this.tokenCounter,
      lastIndex: index,
      // `mode`, not `this.state.mode`: the patch is built before the state moves, so
      // asking the snapshot for the batch here would answer with the *previous* mode.
      preview: this.batchPreview(mode),
      capReached: false,
    })
    this.ports.setCaptured(event.pointerId)
    this.ports.focus(index)
    return DOWN_HINTS
  }

  /** Row 2. Coalesced sub-frame samples, hit-tested in order, deduplicated per drag. */
  readonly onPointerMove = (event: PointerMoveInput): DragEventHints => {
    if (this.state.phase === 'idle') return NO_HINTS
    if (event.pointerId !== this.state.pointerId) return NO_HINTS
    if (event.isPrimary === false) return NO_HINTS
    if (!this.tokenMatches(event.token)) return NO_HINTS

    // A real `getCoalescedEvents()` always contains the current event; the empty-array
    // fallback exists so a degenerate host cannot stall a drag.
    const coalesced = event.getCoalescedEvents?.() ?? []
    const samples: readonly DragPoint[] = coalesced.length > 0 ? coalesced : [event]

    let added = false
    let capped = false
    for (const sample of samples) {
      const index = this.ports.cellIndexAt(sample.clientX, sample.clientY)
      if (index === null) continue // off the board: the stroke keeps its charge-once set
      if (!this.seen.has(index)) {
        if (this.state.mode === 'erase' && this.cellList.length >= ERASE_CAP) {
          capped = true // the drag has taken its quota; stop collecting, keep reporting
        } else {
          this.cellList.push(index)
          this.seen.add(index)
          added = true
        }
      }
      const patch: DragPatch = { phase: 'painting', lastIndex: index }
      if (capped) patch.capReached = true
      if (added) patch.preview = this.batchPreview(this.state.mode)
      this.commit(patch)
      added = false
      capped = false
    }
    return MOVE_HINTS
  }

  /** Row 3. Commit at most once, and only while this stroke's token is current. */
  readonly onPointerUp = (event: PointerEndInput): DragEventHints => {
    if (this.consumeLatch(event.pointerId)) return NO_HINTS
    if (this.state.phase === 'idle') return NO_HINTS
    if (event.pointerId !== this.state.pointerId) return NO_HINTS
    if (!this.tokenMatches(event.token)) return NO_HINTS

    const mode = this.state.mode
    const last = this.state.lastIndex
    const cells = this.batch()

    if (mode === 'erase') {
      // §3.2: clearing is per-cell; the collection stopped at ERASE_CAP.
      for (const index of this.cellList) this.ports.clear(index)
    } else if (cells.length > 0 && this.state.preview !== null && this.state.preview.affectedCount > 0) {
      // An all-identical batch would come back `ignored 'cell-already-marked'` and
      // produce a useless announcement, so it is never dispatched. A `null` preview is
      // unknown, and unknown is a failure, not a yes.
      this.ports.commit(cells)
    }

    this.release()
    if (last !== null) this.ports.focus(last)
    return NO_HINTS
  }

  /** Row 4. The browser claimed the gesture: no dispatch, ever. */
  readonly onPointerCancel = (event: PointerEndInput): DragEventHints => {
    if (this.consumeLatch(event.pointerId)) return NO_HINTS
    if (this.state.phase === 'idle') return NO_HINTS
    if (event.pointerId !== this.state.pointerId) return NO_HINTS
    if (!this.tokenMatches(event.token)) return NO_HINTS
    this.abort()
    return NO_HINTS
  }

  /**
   * Row 5. Any capture loss while a stroke is live is an abort: the element may have
   * been removed, the UA may have taken the pointer back, or capture may have been
   * stolen. Never commit from this path.
   */
  readonly onLostPointerCapture = (event: PointerEndInput): DragEventHints => {
    if (this.consumeLatch(event.pointerId)) return NO_HINTS
    if (this.state.phase === 'idle') return NO_HINTS
    this.abort()
    return NO_HINTS
  }

  /** Row 6. `Escape` aborts an in-flight drag; with no drag it is a no-op. */
  readonly onEscape = (): DragEventHints => {
    if (this.state.phase === 'idle') return NO_HINTS
    this.abort()
    return NO_HINTS
  }

  /**
   * §3.4. Every keyboard cell action goes through the same reducer path as the mouse, so
   * `M` / `B` dispatch a single-cell batch (free-identical-mark rule included) and
   * `Backspace` / `Delete` clears. A roving-index move aborts any live stroke so focus
   * and drag state cannot disagree. Inert when the board is not `playing`.
   */
  readonly onKeyboard = (request: KeyboardRequest, index: number): DragEventHints => {
    if (request === 'move') {
      if (this.state.phase !== 'idle') this.abort()
      return NO_HINTS
    }
    if (!this.ports.interactive()) return NO_HINTS
    if (request === 'clear') {
      // The reducer ignores a clear on an unmarked cell; there is no preview to gate on.
      this.ports.clear(index)
      return NO_HINTS
    }
    const assertion: DragAssertion = request === 'mark-mine' ? 'mine' : 'blank'
    const cells: readonly DragCell[] = Object.freeze([Object.freeze({ index, assertion })])
    const preview = this.ports.preview(cells)
    if (preview !== null && preview.affectedCount > 0) this.ports.commit(cells)
    return NO_HINTS
  }

  // ---- reads the host renders from --------------------------------------------------

  /**
   * The per-cell verdict for `data-preview`. Cells outside the live batch report
   * `'none'`, so the host may safely call this for every cell and render the attribute
   * only when it differs.
   */
  readonly previewVerdictOf = (index: number): PreviewVerdict => {
    if (this.state.phase === 'idle') return 'none'
    if (!this.seen.has(index)) return 'none'
    if (!this.ports.interactive()) return 'none-while-inert'
    const mode = this.state.mode
    // Erasing has no assertion to preview; §1.5 renders it as "no outline".
    if (mode === null || mode === 'erase') return 'none'
    return this.ports.previewOf(index, mode)
  }

  /** The live batch, for the preview chip and for host-side assertions. */
  readonly batch = (): readonly DragCell[] => {
    const mode = this.state.mode
    if (mode === null || mode === 'erase' || this.cellList.length === 0) return EMPTY_BATCH
    return this.cellsFor(mode)
  }

  /** Full reset for a host that is unmounting or swapping rounds. Never dispatches. */
  readonly reset = (): void => {
    this.latch = null
    if (this.state.phase === 'idle' && this.captured === null && !this.state.capReached) return
    this.release()
    this.commit({ capReached: false })
  }

  // ---- internals --------------------------------------------------------------------

  /**
   * §3.1 row 1: the left button uses the toolbar mode, the right button its opposite.
   * Erase has no opposite, so a plain right-click in Erase mode resolves to nothing and
   * the press is rejected — `Shift`+right-click is the only erase gesture (§3.2).
   */
  private resolveMode(button: number): MarkingMode | null {
    return button === 2 ? opposite(this.markingMode) : this.markingMode
  }

  private batchPreview(mode: MarkingMode | null): PreviewView | null {
    if (mode === null || mode === 'erase') return null
    return this.ports.preview(this.cellsFor(mode))
  }

  /**
   * The collected indices as an assertion-bearing batch. The mode is a parameter, not a
   * read of the snapshot: a patch is built *before* it is committed, so the snapshot's
   * mode can still be the one from the previous transition.
   */
  private cellsFor(mode: MarkingMode): readonly DragCell[] {
    const assertion: DragAssertion = mode === 'mine' ? 'mine' : 'blank'
    return Object.freeze(
      this.cellList.map((index) => Object.freeze({ index, assertion })),
    )
  }

  private tokenMatches(token: number | undefined): boolean {
    return token === undefined || token === this.state.token
  }

  /** True when this event belongs to an already-aborted stroke; clears the latch. */
  private consumeLatch(pointerId: number): boolean {
    const latch = this.latch
    if (latch === null || latch.pointerId !== pointerId) return false
    this.latch = null
    return true
  }

  /** Abort: latch, clear the drag, publish, then release capture (never the reverse). */
  private abort(): void {
    if (this.state.pointerId !== null) {
      this.latch = { pointerId: this.state.pointerId, token: this.state.token }
    }
    this.release()
  }

  /**
   * Clears the drag and releases capture. State is published *before* the port call, so
   * the `lostpointercapture` that a real release fires lands on an already-idle machine.
   * `capReached` deliberately survives, so the host can surface `toolbar.capReached`
   * after the finger lifts; the next arm clears it.
   */
  private release(): void {
    const held = this.captured
    this.captured = null
    this.cellList = []
    this.seen.clear()
    this.commit({
      phase: 'idle',
      pointerId: null,
      mode: null,
      lastIndex: null,
      preview: null,
    })
    if (held !== null) this.ports.setCaptured(null)
  }

  /**
   * Publishes a new frozen snapshot. `cells` and `moved` are always derived from the
   * machine's own collection rather than passed in, so no caller can forget them and
   * `useSyncExternalStore` can compare by reference.
   */
  private commit(patch: DragPatch): void {
    const merged: DragState = { ...this.state, ...patch }
    const cells = Object.freeze([...this.cellList])
    this.state = Object.freeze({ ...merged, cells, moved: cells.length > 1 })
    for (const listener of [...this.listeners]) listener()
  }
}
