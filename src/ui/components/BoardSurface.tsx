import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react'
import { describeCell, describeLine, interpolate, type Copy } from '../copy'
import {
  DragController,
  ERASE_CAP,
  type DragPorts,
  type DragPoint,
  type PointerEndInput,
  type PointerDownInput,
  type PointerMoveInput,
  type PreviewVerdict,
} from '../dragController'
import type { LineProgress, OrderedRunProgress } from '../../application/lineProgress'
import type {
  BoardView,
  CellView,
  MarkingMode,
  PreviewView,
  UiSnapshot,
  ZoomStep,
} from '../viewModel'
import type { GameStore } from '../gameStore'
import { BoardEmptyState } from './BoardEmptyState'

/**
 * The board surface: one scroll container, one grid, and every gesture that can
 * become a game action.
 *
 * ─── Why the host owns no dispatch ───────────────────────────────────────────────────
 * `dragController.ts` is the only place a pointer sequence becomes a mark, a clear
 * or a focus. This file renders and forwards; the single exception is the port table
 * below, which *is* the wiring the controller documents. There is deliberately no
 * second path, so the preview the player sees and the batch that commits cannot be
 * produced by two different pieces of arithmetic.
 *
 * ─── Why nothing is measured for alignment ───────────────────────────────────────────
 * The stage and every row declare the identical `grid-template-columns`
 * (a `max-content` rail track, then `--cols` × `--cell`), so cell *i* sits in the
 * same column of every row by arithmetic alone. The rail track is `max-content`
 * because a row clue is one unbroken line of runs: the widest row clue in the
 * round sets the track, so every run of every row is always fully rendered and
 * nothing is ever truncated. `display: contents` would have been the shorter way
 * to make a row of cells, but it strips `role="row"` out of the accessibility tree,
 * so the rows stay real elements and each one repeats the template.
 *
 * The only measurement in the file is the Fit cell size, which §1.7 explicitly
 * sanctions: a `ResizeObserver` on the scroller, floored at 24px and capped at 56px.
 * The fixed zoom steps above that — including the two that are meant to overflow
 * the pane — need no measurement at all: the pane caps its own height and scrolls.
 */
export interface BoardSurfaceProps {
  readonly t: Copy
  readonly snapshot: UiSnapshot
  readonly board: BoardView | null
  readonly mode: MarkingMode
  readonly zoom: ZoomStep
  readonly fingerMarking: boolean
  /* The hint layer's master switch, rendered as `data-hints` on the stage so
     clues.css §5.1 can restore the resting treatment with four custom
     properties, and passed down to `ClueCell` so the ✓ is not drawn at all when
     it is off. The attributes themselves stay truthful either way — this is a
     presentation gate, never a state gate — and the `aria-label` keeps
     reporting line state to a screen reader under both values. Optional
     because the stylesheet reads an absent attribute as "on", which is also
     what the existing renders (tests, the legend's neighbours) expect. */
  readonly hints?: boolean
  readonly store: GameStore
  readonly onMode: (mode: MarkingMode) => void
  readonly onZoom: (zoom: ZoomStep) => void
  readonly onFingerMarking: (enabled: boolean) => void
  readonly onGenerate: () => void
  readonly onCancel: () => void
}

const ZOOM_CELL: Readonly<Record<Exclude<ZoomStep, 'fit'>, string>> = {
  s: '26px',
  m: '32px',
  l: '40px',
  xl: '56px',
  xxl: '72px',
}
const FIT_FLOOR_PX = 24
const FIT_CEILING_PX = 56

/**
 * How many times the fit solve may re-solve before it gives up.
 *
 * The solve used to be one pass, and one pass was enough while the rail was a
 * constant: `--rail-col` and `--rail-band` were a function of the round's clues
 * alone, so the number the measure produced could not change the numbers it had
 * read. That is no longer true and cannot be made true again, because the
 * numeral now scales with the cell (tokens.css §5): `--rail-col` counts
 * `--rail-digit`, which is 0.62 of `--rail-num`, which is 0.3 of `--cell`. A
 * bigger cell therefore asks for a wider rail, and a wider rail hands back a
 * smaller cell — a real fixed point, and a cheap one, but it has to be walked to.
 *
 * Four is not a guess about how long it takes. The chain is monotone, and each
 * link is shallow: the block axis moves `--cell` by at most
 * `0.3 x 0.95 x slots / rows` px per pass (0.05px for the worst clue a 24-row
 * board can hold) and the inline axis by 0.03px, so two passes settle anything
 * that is not already sitting on a floor or a ceiling. Four leaves room for the
 * pane's own box to move under the measure — a scrollbar appearing is a second
 * observation, not a second link — and is still bounded, which is the property
 * that matters: a solve that cannot terminate would hang a frame.
 */
const FIT_PASSES = 4

/**
 * What the pane and its rail cost at ONE candidate cell size, read live.
 *
 * A function of `cell` rather than a snapshot, because that is the whole shape
 * of the fix: the caller writes the candidate onto the stage and then reads the
 * two costs back, so the costs are always the ones that candidate actually
 * produced. The board, the pane and the rail are three nested boxes and CSS will
 * not tell us the answer without being asked.
 */
export type FitProbe = (cell: number) => {
  readonly paneInline: number
  readonly paneBlock: number
  readonly railInline: number
  readonly railBlock: number
  /**
   * What the stage spends on itself on each axis, and nothing else.
   *
   * Read from the stage's parts, never from `pane - grid`, because a stage that
   * ever STRETCHED to the pane would hand its slack back as chrome and the solve
   * would subtract the same pixels twice. The parts are structural and small: the
   * stage's own border and padding, plus the rails ROW's border and padding, which
   * the corner does not cover. `.tmp/style-check.mjs` pins the CSS shape this
   * relies on; a stretch would be a layout decision, and the layout is `max-content`
   * on both axes in board.css §2.
   */
  readonly inlineChrome: number
  readonly blockChrome: number
}

export type FitOutcome = {
  /** The size the board should paint at. Never outside the floor and the ceiling. */
  readonly cell: number
  /** How many solves it took, counting the one that found the answer. */
  readonly passes: number
  /** False when the budget ran out, which the caller treats as "paint nothing". */
  readonly converged: boolean
}

/**
 * What the stage spends on itself, on both axes, measured from its parts.
 *
 * The pane measures the stage's border box, and the stage's border box is this
 * chrome plus the rail track plus `columns x cell`. The solve charges the band and
 * the rail track, so this is the part that would otherwise be charged to neither
 * and silently handed back as free room — see the block-axis note in `fitCellAt`
 * for the 3px ramp that omission caused once the solve started walking.
 *
 * `getComputedStyle` on the stage, and the rails row's own box against the corner's:
 * the corner spans the band exactly, and the row it sits in is the band plus the
 * row's border and padding. Reading it as a difference rather than as a constant is
 * the point — a 1px row border is 3.2% of a 32px cell and 25% of a 12.8px floor cell,
 * and neither number is worth writing down twice.
 */
function stageChrome(
  stage: HTMLElement | null,
  corner: HTMLElement | null,
): { readonly inline: number; readonly block: number } {
  if (stage === null) {
    return { inline: 0, block: 0 }
  }
  const cs = getComputedStyle(stage)
  const num = (value: string): number => {
    const parsed = Number.parseFloat(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  const railsRow = stage.querySelector<HTMLElement>('.mg-board-row--rails')
  const rowChrome = railsRow === null || corner === null ? 0 : Math.max(0, railsRow.offsetHeight - corner.offsetHeight)
  return {
    inline:
      num(cs.borderInlineStartWidth) +
      num(cs.borderInlineEndWidth) +
      num(cs.paddingInlineStart) +
      num(cs.paddingInlineEnd),
    block:
      num(cs.borderBlockStartWidth) +
      num(cs.borderBlockEndWidth) +
      num(cs.paddingBlockStart) +
      num(cs.paddingBlockEnd) +
      rowChrome,
  }
}

/** One solve at a given candidate, exported so a test can hold the chain still. */
export function fitCellAt(
  probe: FitProbe,
  columns: number,
  rows: number,
  cell: number,
): number {
  // The rail costs the pane a COLUMN on the inline axis and a BAND on the block
  // axis, and both come off before the cells divide what is left. Reading them
  // off the corner cell — which spans exactly the band, and whose width IS the
  // content-sized rail track — keeps the two axes symmetric and picks up any
  // change to either without a constant to update here.
  const {
    paneInline,
    paneBlock,
    railInline,
    railBlock,
    inlineChrome,
    blockChrome,
  } = probe(cell)
  // The vertical half of Fit, which §1.7's width-only solve never had. A cell has
  // to fit BOTH axes, so the answer is the SMALLER of the two solves — `max` here
  // would grow a board straight back out of the pane, which is the defect this
  // solve exists to remove.
  //
  // Reading the pane's OWN box, rather than any board variable, is what keeps the
  // cap ⇄ cell-size exchange one-directional. The pane is capped by
  // `min(70vh, 46rem)` in board.css — a value no board can influence, because it is
  // written in viewport units and in `rem`, and the stage inside the pane is
  // `max-content`. So the measure's inputs cannot include the board's own output.
  // THE OTHER HALF OF THAT CLAIM WAS WRONG, and walking the solve is what found
  // it. On the block axis the pane is NOT always capped: while the board is
  // shorter than the cap, the pane is tracking the board, so its height IS the
  // board's output and the two cancel — a no-op, the only correct answer. They did
  // not quite cancel, because the pane measures the stage's border box and the
  // solve was only subtracting the band. The stage spends 3px on itself at rest
  // (1px border above, 1px below, and the rails ROW's 1px `border-block-end`,
  // which is outside the corner's own 34px), so the solve saw 3px more room than
  // existed, asked for a cell 3px too big, the pane grew by 3px, and the next pass
  // saw the same 3px again. Measured on a 1x1 board at `--cell` 32: `pane` 69,
  // `band` 34, so `byHeight` 35 — and the chain ramped 32 → 35 → 38 → 41 → … to
  // the ceiling, where it turned around and came back down. The one-pass solve hid
  // this by painting a single 3px-oversized cell and never looking again; it is
  // the ITERATION that made the 3px into a non-terminating chain, and the fix is
  // to charge the chrome to the account that spends it rather than to shorten the
  // walk. With chrome charged, a tracking pane returns the cell it is already at —
  // a true no-op, so the chain is one pass — and a capped pane loses the 3px of
  // chrome that really is spent, which costs a 3-row board one cell of nothing.
  //
  // The loop that remains is the rail's, and `settleFitCell` below walks it.
  //
  // A hidden region measures zero on BOTH axes, and the two axes are not symmetric
  // here. On the block axis a zero measure is legitimately weak evidence — the pane
  // is capped by `min(70vh, 46rem)`, so a board that is merely not on screen yet
  // still has a perfectly good width to divide, and falling through to `byWidth` is
  // the right answer. On the INLINE axis there is nothing to fall back to: a
  // zero-width pane means the board has no room at all, and the arithmetic below
  // does not say so. `Math.floor` of a negative number is negative, `byHeight`
  // inherits it, and the closing `Math.max(FIT_FLOOR_PX, …)` then reports the
  // floor — so hiding a side panel yanked a live board to the smallest size it can
  // paint and left it there until something happened to re-fire the observer. The
  // comment here used to PROMISE the opposite ("must not be sized to the floor
  // because of it") while the code did exactly that, which is the same class of
  // defect as two agreeing comments: a claim in prose that nothing checks.
  //
  // So the code now keeps the promise. An inline measure with no room in it is not
  // a measurement, and the honest response to a measurement that did not happen is
  // to hold the size the board already has — clamped, because the caller's range
  // still applies — and let the observer re-solve when the pane is measurable
  // again. Returning rather than guessing is what makes the walk converge on a
  // board that is not on screen: a frozen cell is already a fixed point, so the
  // chain terminates on the first pass instead of oscillating.
  const inlineRoom = paneInline - inlineChrome - railInline
  if (inlineRoom <= 0) {
    return Math.min(FIT_CEILING_PX, Math.max(FIT_FLOOR_PX, cell))
  }
  const byWidth = Math.floor(inlineRoom / columns)
  const available = paneBlock - blockChrome - railBlock
  const byHeight = available > 0 ? Math.floor(available / rows) : byWidth
  return Math.min(FIT_CEILING_PX, Math.max(FIT_FLOOR_PX, Math.min(byWidth, byHeight)))
}

/**
 * Walk the fit solve to its fixed point.
 *
 * The chain is monotone and its links are shallow, so this converges; the budget
 * is there for the case where it does not, because the caller's honest response
 * to a board that will not settle is to leave the last size it settled on rather
 * than to paint one it is about to leave. `converged` is what lets it say so:
 * the effect does not paint an unconverged answer at all.
 */
export function settleFitCell(
  probe: FitProbe,
  columns: number,
  rows: number,
  start: number,
  maxPasses: number = FIT_PASSES,
): FitOutcome {
  let cell = Math.min(FIT_CEILING_PX, Math.max(FIT_FLOOR_PX, start))
  for (let passes = 1; passes <= maxPasses; passes += 1) {
    const next = fitCellAt(probe, columns, rows, cell)
    if (next === cell) {
      return { cell, passes, converged: true }
    }
    cell = next
  }
  return { cell, passes: maxPasses, converged: false }
}

/**
 * The board region's stable focus destination, exported because `RoundBanner`
 * hands focus to it: a win notice holds focus on its own primary button, and the
 * interlude then unmounts that button, so whatever the browser focuses next is
 * `<body>` and a keyboard player is back at the top of the document. The banner
 * used to be the only thing that knew where focus was, and the banner is exactly
 * the thing that disappears.
 *
 * The target is always mounted, so the round change has somewhere predictable to
 * put focus whatever happened before it — and it is inside `.mg-board-scroll`,
 * because the §3.6 handoff to the first cell only continues focus into the board
 * when the board region already holds it. `tabIndex={-1}` keeps it out of the Tab
 * order: it is a programmatic destination, never a stop on the way somewhere.
 */
export const ROUND_FOCUS_ID = 'mg-round-focus'

export function BoardSurface(props: BoardSurfaceProps) {
  const { t, snapshot, board, store } = props
  const interactive = snapshot.status.interactive
  const scroll = useRef<HTMLDivElement | null>(null)
  const stage = useRef<HTMLDivElement | null>(null)
  const rail = useRef<HTMLDivElement | null>(null)
  const landing = useRef<HTMLDivElement | null>(null)
  const captured = useRef<number | null>(null)
  const cells = useRef<(HTMLDivElement | null)[]>([])
  const live = useRef({ interactive })
  const [roving, setRoving] = useState(0)
  const [focusInside, setFocusInside] = useState(false)
  const [fitCell, setFitCell] = useState(32)
  // The size the fit effect last SETTLED on, as a ref rather than a dep: the
  // solve walks from there, and a state read would make the effect depend on its
  // own output, which is the render loop the note on its deps warns about.
  const fitSettled = useRef(32)
  const round = snapshot.status.round
  const columns = board?.columns ?? 0
  const rows = board?.rows ?? 0
  const grid = useMemo(() => groupRows(board), [board])

  // The column rail's band is sized from the round's own longest column clue, so
  // a rail never truncates a run: the band always has exactly one slot per run of
  // the worst column, and shorter columns leave their slack at the bottom. The
  // clue is right there on every LineProgress — no cap is ever guessed. The floor
  // of 2 keeps the header from collapsing to a sliver on a board whose columns
  // are all one run (or empty).
  const railSlots = useMemo(() => {
    if (board === null) {
      return 2
    }
    let longest = 0
    for (const line of board.columnProgress) {
      longest = Math.max(longest, line.clue.length)
    }
    return Math.max(2, longest)
  }, [board])

  // The row rail's two budgets, read the same way and from the same round. Its
  // track is `--rail-col` in tokens.css, and because a run may be two numerals
  // wide (`10`) the budget is counted in NUMERALS, not runs, or a clue of five
  // two-digit runs would be given the room of five one-digit ones and lose its
  // last numeral. The run count comes with it because the gutters between runs
  // are part of the same width. Nothing here is a guess and nothing is capped:
  // a one-run clue gets one numeral and no gutter, a nine-run clue gets all of
  // it, and the rail is never narrower than the clue it has to hold.
  const railRow = useMemo(() => {
    if (board === null) {
      return { digits: 1, runs: 1 }
    }
    let digits = 0
    let runs = 0
    for (const line of board.rowProgress) {
      let lineDigits = 0
      for (const length of line.clue) {
        lineDigits += String(length).length
      }
      if (lineDigits > digits) {
        digits = lineDigits
        runs = line.clue.length
      }
    }
    return { digits: Math.max(1, digits), runs: Math.max(1, runs) }
  }, [board])

  // The ports read live values through a ref, so the controller is built once and
  // never rebuilt when a snapshot arrives.
  useEffect(() => {
    live.current = { interactive }
  }, [interactive])

  // Stable for the store's lifetime: it reads a ref and touches the DOM, and neither
  // is a reason to rebuild the port table when a snapshot arrives.
  const focusCell = useCallback((index: number) => {
    const node = cells.current[index]
    if (node === undefined || node === null) {
      return
    }
    node.focus({ preventScroll: true })
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [])

  const ports = useMemo<DragPorts>(
    () => ({
      interactive: () => live.current.interactive,
      cellIndexAt: (x, y) => {
        const found = document.elementFromPoint(x, y)
        const node = found?.closest('[data-cell-index]')
        if (node === null || node === undefined || stage.current?.contains(node) !== true) {
          return null
        }
        const index = Number(node.getAttribute('data-cell-index'))
        return Number.isInteger(index) ? index : null
      },
      preview: (batch) => store.preview(batch),
      previewOf: (index, assertion) => store.previewOf(index, assertion),
      commit: (batch) => {
        store.actions.mark(batch)
      },
      clear: (index) => {
        store.actions.clear(index)
      },
      focus: (index) => {
        setRoving(index)
        focusCell(index)
      },
      setCaptured: (pointerId) => {
        const node = stage.current
        if (node === null) {
          return
        }
        if (pointerId !== null) {
          captured.current = pointerId
          if (typeof node.setPointerCapture === 'function') {
            node.setPointerCapture(pointerId)
          }
          return
        }
        const held = captured.current
        captured.current = null
        if (held !== null && typeof node.releasePointerCapture === 'function') {
          node.releasePointerCapture(held)
        }
      },
    }),
    [store, focusCell],
  )

  const controller = useRef<DragController | null>(null)
  if (controller.current === null) {
    controller.current = new DragController(ports)
  }
  const drag = controller.current
  // `getSnapshot`/`subscribe` are prototype methods, and `useSyncExternalStore` calls
  // them with no receiver, so they are wrapped rather than passed by reference.
  const subscribeDrag = useCallback(
    (listener: () => void) => drag.subscribe(listener),
    [drag],
  )
  const getDragSnapshot = useCallback(() => drag.getSnapshot(), [drag])
  const dragState = useSyncExternalStore(subscribeDrag, getDragSnapshot, getDragSnapshot)

  useEffect(() => {
    drag.setMarkingMode(props.mode)
  }, [drag, props.mode])

  useEffect(() => {
    drag.setFingerMarking(props.fingerMarking)
  }, [drag, props.fingerMarking])

  // A new round invalidates every cell element and the roving index (§3.4).
  useEffect(() => {
    cells.current = []
    setRoving(0)
  }, [round])

  // §3.6: on a fresh round, move focus to the first cell ONLY if the player was
  // already inside the board. Never steal focus from the settings panel.
  const previousStatus = useRef(snapshot.status.status)
  useEffect(() => {
    const before = previousStatus.current
    previousStatus.current = snapshot.status.status
    if (before !== 'generating' || snapshot.status.status !== 'playing') {
      return
    }
    const active = document.activeElement
    if (active !== null && active.closest('.mg-board-scroll') !== null) {
      focusCell(0)
    }
  }, [snapshot.status.status, focusCell])

  // A round change is the one moment the board region must be able to CLAIM focus,
  // because the interlude that follows a win tears out whatever held it. The round
  // number — not the status — is the edge, so this fires for a round printed from the
  // settings panel and for one printed by the win handoff alike, and it is
  // independent of the banner's mount lifetime.
  //
  // The first render is deliberately not a round change: on load this must not pull
  // focus out of whatever opened the app (the first-run help dialog does).
  const seenRound = useRef(round)
  useEffect(() => {
    if (seenRound.current === round) {
      return
    }
    seenRound.current = round
    const active = document.activeElement
    if (active !== null && active.closest('.mg-board-scroll') !== null) {
      // The region already holds focus, so the effect above has just handed it to
      // the first cell — the better destination, and this must not undo that.
      return
    }
    landing.current?.focus({ preventScroll: true })
  }, [round])

  // `isFit` names the one zoom fact the fit effect depends on (see its deps).
  const isFit = props.zoom === 'fit'
  useEffect(() => {
    const node = scroll.current
    if (node === null || typeof ResizeObserver === 'undefined' || columns === 0) {
      return
    }
    // An explicit zoom step is not the fit, and the measure cannot be allowed near
    // it. This is the second half of a clobber the first half explains: the probe
    // writes each candidate onto the stage's OWN `--cell` to price it, and the last
    // write is the answer — so when the answer equals the value React already has in
    // `fitCell`, `setFitCell` bails out, nothing re-renders, and the board keeps the
    // probe's pixels. Measured at 15x15 in 1440x900: choosing `xxl` painted 32px,
    // the fit's answer, and the numerals stayed at the resting 10px, because 72 was
    // written by React and then overwritten by a measure that had no business running.
    // The earlier reading — that a walk to a fixed point was the fix — was wrong about
    // this: the walk fixed the ramp, not the clobber, and a walk that ends where it
    // started is the quietest kind of clobber. So the fit only runs while it is in
    // charge, and the probe's writes are a measure's private business.
    if (!isFit) {
      return
    }
    const measure = (): void => {
      const corner = rail.current
      const stageNode = stage.current
      // Each candidate is written onto the stage and the two costs are read back
      // AFTER it, because the costs are a function of the candidate: a wider
      // numeral is a wider rail, and reading them before the write would solve
      // against the previous answer. The write is the same property React owns,
      // with the same value React would write, so the transient passes leave no
      // trace — the one place that is not true is the non-converged return below.
      //
      // The chrome is read ONCE per measure, outside the chain, because it is
      // structural: the stage's own border and padding and the rails row's border
      // and padding are the same pixels at every candidate, which is exactly the
      // property that makes charging them a fixed point rather than a loop.
      const chrome = stageChrome(stageNode, corner)
      const probe: FitProbe = (cell) => {
        stageNode?.style.setProperty('--cell', `${cell}px`)
        return {
          paneInline: node.clientWidth,
          paneBlock: node.clientHeight,
          railInline: corner?.offsetWidth ?? 0,
          railBlock: corner?.offsetHeight ?? 0,
          inlineChrome: chrome.inline,
          blockChrome: chrome.block,
        }
      }
      const outcome = settleFitCell(probe, columns, rows, fitSettled.current)
      if (!outcome.converged) {
        // Put back the size React last rendered before returning, so a board that
        // will not settle holds still instead of freezing on a candidate the
        // measure had already disowned.
        stageNode?.style.setProperty('--cell', `${fitSettled.current}px`)
        return
      }
      fitSettled.current = outcome.cell
      setFitCell(outcome.cell)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
    // `round` and the fit switch are deps because the rail's two costs are not
    // constants: a new round brings new clues (a different content-sized rail
    // track and a different band), and the corner is only read at fire time, so
    // without re-running here the fit would be solved against the PREVIOUS
    // round's rail. `fitCell` itself is deliberately NOT a dep: it is the
    // effect's own output, and depending on it would let a numeral-size change
    // feed the corner back into the measure as a render loop — which is why the
    // solve walks to its own fixed point INSIDE one pass instead. The observer
    // watches the pane only, so a content change never re-fires it; a change of
    // cell size does not need it to, because every pass re-reads the live costs.
  }, [columns, rows, round, isFit])

  function moveTo(next: number): void {
    const bounded = Math.max(0, Math.min(columns * rows - 1, next))
    // A move first aborts any live drag, so an arrow key can never commit a batch.
    drag.onKeyboard('move', roving)
    setRoving(bounded)
    focusCell(bounded)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const cellNode = (event.target as HTMLElement | null)?.closest('[data-cell-index]') ?? null
    const raw = cellNode === null ? roving : Number(cellNode.getAttribute('data-cell-index'))
    const index = Number.isInteger(raw) ? raw : roving
    const rowStart = Math.floor(index / columns) * columns
    const rowEnd = Math.min(rowStart + columns - 1, columns * rows - 1)
    let prevent = true
    switch (event.key) {
      case 'ArrowRight':
        moveTo(Math.min(index + 1, rowEnd))
        break
      case 'ArrowLeft':
        moveTo(Math.max(index - 1, rowStart))
        break
      case 'ArrowDown':
        moveTo(Math.min(index + columns, columns * rows - 1))
        break
      case 'ArrowUp':
        moveTo(Math.max(index - columns, rowStart))
        break
      case 'Home':
        moveTo(event.ctrlKey ? 0 : rowStart)
        break
      case 'End':
        moveTo(event.ctrlKey ? columns * rows - 1 : rowEnd)
        break
      case 'm':
      case 'M':
        prevent = drag.onKeyboard('mark-mine', index).preventDefault
        break
      case 'b':
      case 'B':
        prevent = drag.onKeyboard('mark-blank', index).preventDefault
        break
      case 'Backspace':
      case 'Delete':
        prevent = drag.onKeyboard('clear', index).preventDefault
        break
      case 'Escape':
        prevent = drag.onEscape().preventDefault
        break
      default:
        return
    }
    if (prevent) {
      event.preventDefault()
    }
  }

  const cellSize = props.zoom === 'fit' ? `${fitCell}px` : ZOOM_CELL[props.zoom]

  // The round-change destination. Always mounted, in both branches, and named after
  // whatever the region currently holds, so focus lands on a thing that describes
  // where it is instead of on a vanished button. `.mg-visually-hidden` keeps it in
  // the accessibility tree — it is positioned and clipped, never hidden from it.
  const roundFocus = (
    <div
      id={ROUND_FOCUS_ID}
      ref={landing}
      tabIndex={-1}
      className="mg-visually-hidden"
      data-testid="round-focus"
      aria-label={
        board === null
          ? t.board.empty.title
          : interpolate(t.board.label, { rows, columns })
      }
    />
  )

  return (
    <div className="mg-board-surface">
      <BoardToolbar {...props} />
      <div
        className="mg-board-scroll"
        ref={scroll}
        data-testid="board-scroll"
        onFocus={() => {
          setFocusInside(true)
        }}
        onBlur={(event) => {
          const next = event.relatedTarget
          if (next === null || scroll.current?.contains(next) !== true) {
            setFocusInside(false)
          }
        }}
      >
        {roundFocus}
        {board === null ? (
          <BoardEmptyState t={t} />
        ) : (
          <div
            className="mg-board-stage"
            ref={stage}
            role="grid"
            aria-rowcount={rows + 1}
            aria-colcount={columns + 1}
            aria-label={interpolate(t.board.label, { rows, columns })}
            aria-readonly={interactive ? undefined : true}
            data-testid="board-stage"
            data-dragging={dragState.phase === 'idle' ? undefined : 'true'}
            data-finger-marking={props.fingerMarking ? 'on' : 'off'}
            data-hints={props.hints === false ? 'off' : 'on'}
            data-inert={interactive ? undefined : 'true'}
            style={
              {
                '--cols': String(columns),
                '--rows': String(rows),
                '--cell': cellSize,
                // The two rail budgets, from this round's own clues and never from
                // a cap: the column band's run capacity, and the row track's
                // numeral count and run count. The CSS owns what each one SPENDS
                // (tokens.css §5, re-bound on the stage in board.css §2) so the
                // rail's rhythm can be retuned without touching the component.
                '--rail-slots': String(railSlots),
                '--rail-digits': String(railRow.digits),
                '--rail-runs': String(railRow.runs),
              } as CSSProperties
            }
            onPointerDown={(event) => {
              const input = pointerDownInput(event)
              if (drag.onPointerDown(input).preventDefault) {
                event.preventDefault()
              }
            }}
            onPointerMove={(event) => {
              const input = pointerMoveInput(event)
              if (drag.onPointerMove(input).preventDefault) {
                event.preventDefault()
              }
            }}
            onPointerUp={(event) => {
              const input = pointerEndInput(event)
              if (drag.onPointerUp(input).preventDefault) {
                event.preventDefault()
              }
            }}
            onPointerCancel={(event) => {
              const input = pointerEndInput(event)
              if (drag.onPointerCancel(input).preventDefault) {
                event.preventDefault()
              }
            }}
            onLostPointerCapture={(event) => {
              const input = pointerEndInput(event)
              if (drag.onLostPointerCapture(input).preventDefault) {
                event.preventDefault()
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault()
            }}
            onKeyDown={onKeyDown}
          >
            {board === null ? (
              <BoardEmptyState t={t} />
            ) : (
              <>
                <ColumnClueRail t={t} board={board} focusWithin={focusInside} railRef={rail} hints={props.hints} />
                {grid.map((rowCells) => (
                  <BoardRow
                    key={rowCells[0]?.index ?? 0}
                    t={t}
                    row={rowCells[0]?.row ?? 0}
                    cells={rowCells}
                    board={board}
                    drag={drag}
                    roving={roving}
                    registerCell={(index, node) => {
                      cells.current[index] = node
                    }}
                    hints={props.hints}
                  />
                ))}
                {/* §5.4 on the column axis. A row has an element of its own to carry
                    the band; a column does not, so one empty strip per COMPLETE column
                    is added here, and board.css places it from `--k` between the first
                    and last cell rows of the stage's own grid template. `aria-hidden`
                    is load-bearing rather than decorative: this is a `role="grid"`,
                    whose required children are rows, and an `aria-hidden` child is
                    removed from the accessibility tree, so the grid's owned children
                    stay exactly the rows `aria-rowcount` promises. */}
                {board.columnProgress.map((line) =>
                  line.complete ? (
                    <div
                      className="mg-board-column-reveal"
                      key={`reveal-${line.index}`}
                      aria-hidden="true"
                      data-line-revealed="column"
                      style={{ '--k': String(line.index) } as CSSProperties}
                    />
                  ) : null,
                )}
              </>
            )}
          </div>
        )}
      </div>
      <DragPreviewChip
        t={t}
        preview={dragState.preview}
        score={snapshot.status.score.current}
        capReached={dragState.capReached}
      />
    </div>
  )
}

function groupRows(board: BoardView | null): readonly (readonly CellView[])[] {
  if (board === null) {
    return []
  }
  const grouped: CellView[][] = Array.from({ length: board.rows }, () => [])
  for (const cell of board.cells) {
    grouped[cell.row]?.push(cell)
  }
  return grouped
}

function pointerDownInput(event: ReactPointerEvent<HTMLDivElement>): PointerDownInput {
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    button: event.button,
    isPrimary: event.isPrimary,
    shiftKey: event.shiftKey,
  }
}

function pointerMoveInput(event: ReactPointerEvent<HTMLDivElement>): PointerMoveInput {
  const native = event.nativeEvent as Event & {
    getCoalescedEvents?: () => readonly DragPoint[]
  }
  return {
    clientX: event.clientX,
    clientY: event.clientY,
    pointerId: event.pointerId,
    isPrimary: event.isPrimary,
    getCoalescedEvents: () =>
      typeof native.getCoalescedEvents === 'function' ? native.getCoalescedEvents() : [],
  }
}

function pointerEndInput(event: ReactPointerEvent<HTMLDivElement>): PointerEndInput {
  return { clientX: event.clientX, clientY: event.clientY, pointerId: event.pointerId }
}

// ---- toolbar -------------------------------------------------------------------

export type BoardToolbarProps = BoardSurfaceProps

export function BoardToolbar(props: BoardToolbarProps) {
  const { t, snapshot, mode, zoom, fingerMarking } = props
  return (
    <div className="mg-toolbar" data-testid="board-toolbar">
      <ModeControl t={t} mode={mode} disabled={!snapshot.status.interactive} onMode={props.onMode} />
      <ZoomControl t={t} zoom={zoom} onZoom={props.onZoom} />
      <FingerMarkingControl t={t} enabled={fingerMarking} onChange={props.onFingerMarking} />
      {snapshot.status.isGenerating ? (
        /* §8.9: Cancel is hidden whenever a board exists, because cancelling would
           discard a round the player can still finish; "Keep waiting" is the whole
           affordance in that case. */
        snapshot.status.hasRound ? (
          <span className="mg-toolbar__waiting">{t.toolbar.keepWaiting}</span>
        ) : (
          <button className="mg-button" type="button" onClick={props.onCancel}>
            {t.toolbar.cancel}
          </button>
        )
      ) : (
        <button className="mg-button mg-button--primary" type="button" onClick={props.onGenerate}>
          {t.toolbar.generate}
        </button>
      )}
    </div>
  )
}

function ModeControl({
  t,
  mode,
  disabled,
  onMode,
}: {
  readonly t: Copy
  readonly mode: MarkingMode
  readonly disabled: boolean
  readonly onMode: (mode: MarkingMode) => void
}) {
  const modes: readonly MarkingMode[] = ['mine', 'blank', 'erase']
  return (
    <div className="mg-toolbar__group" role="radiogroup" aria-label={t.toolbar.mode}>
      {modes.map((candidate) => (
        <button
          key={candidate}
          className="mg-toolbar__mode"
          type="button"
          role="radio"
          aria-checked={mode === candidate}
          data-mode={candidate}
          disabled={disabled}
          onClick={() => {
            onMode(candidate)
          }}
        >
          {t.toolbar.modes[candidate]}
        </button>
      ))}
    </div>
  )
}

function ZoomControl({
  t,
  zoom,
  onZoom,
}: {
  readonly t: Copy
  readonly zoom: ZoomStep
  readonly onZoom: (zoom: ZoomStep) => void
}) {
  const steps: readonly ZoomStep[] = ['fit', 's', 'm', 'l', 'xl', 'xxl']
  return (
    <div className="mg-toolbar__group" role="radiogroup" aria-label={t.toolbar.zoom}>
      {steps.map((candidate) => (
        <button
          key={candidate}
          className="mg-toolbar__zoom"
          type="button"
          role="radio"
          aria-checked={zoom === candidate}
          data-zoom={candidate}
          onClick={() => {
            onZoom(candidate)
          }}
        >
          {t.toolbar.zooms[candidate]}
        </button>
      ))}
    </div>
  )
}

function FingerMarkingControl({
  t,
  enabled,
  onChange,
}: {
  readonly t: Copy
  readonly enabled: boolean
  readonly onChange: (enabled: boolean) => void
}) {
  return (
    <label className="mg-toolbar__finger">
      <input
        type="checkbox"
        role="switch"
        checked={enabled}
        aria-describedby="mg-finger-marking-hint"
        onChange={(event) => {
          onChange(event.currentTarget.checked)
        }}
      />
      <span className="mg-toolbar__finger-label">{t.toolbar.fingerMarking}</span>
      <span className="mg-visually-hidden" id="mg-finger-marking-hint">
        {t.toolbar.fingerMarkingHint}
      </span>
    </label>
  )
}

/**
 * The drag preview, stated in the score it will spend. It is not a live region:
 * §6.2 allows exactly three, and a chip that re-announced on every pointer sample
 * would make the board unusable with a screen reader.
 */
export function DragPreviewChip({
  t,
  preview,
  score,
  capReached,
}: {
  readonly t: Copy
  readonly preview: PreviewView | null
  readonly score: number
  readonly capReached: boolean
}) {
  const values = { cells: preview?.affectedCount ?? 0, from: score, to: preview?.projectedScore ?? score }
  const text =
    preview === null
      ? t.toolbar.preview.idle
      : preview.reachesZero
        ? interpolate(t.toolbar.preview.endsRound, values)
        : interpolate(t.toolbar.preview.score, values)
  return (
    <p
      className="mg-preview"
      aria-live="off"
      data-live={preview === null ? 'false' : 'true'}
      data-ends={preview?.reachesZero === true ? 'true' : 'false'}
    >
      <span className="mg-preview__text">{text}</span>
      {preview?.reachesZero === true ? (
        <span className="mg-preview__badge">{t.toolbar.preview.badge}</span>
      ) : null}
      {capReached ? (
        <span className="mg-preview__cap">{interpolate(t.toolbar.capReached, { max: ERASE_CAP })}</span>
      ) : null}
    </p>
  )
}

// ---- stage ---------------------------------------------------------------------

export function ColumnClueRail({
  t,
  board,
  focusWithin,
  railRef,
  hints,
}: {
  readonly t: Copy
  readonly board: BoardView
  readonly focusWithin: boolean
  readonly railRef: RefObject<HTMLDivElement | null>
  readonly hints?: boolean
}) {
  return (
    <div
      className="mg-board-row mg-board-row--rails"
      role="row"
      data-focus-within={focusWithin ? 'true' : 'false'}
    >
      <div className="mg-rail-cell mg-rail-cell--corner" role="presentation" aria-hidden="true" ref={railRef}>
        {t.board.corner}
      </div>
      {board.columnProgress.map((line) => (
        <ClueCell key={line.index} t={t} line={line} orientation="column" hints={hints} />
      ))}
    </div>
  )
}

export function BoardRow({
  t,
  row,
  cells,
  board,
  drag,
  roving,
  registerCell,
  hints,
}: {
  readonly t: Copy
  readonly row: number
  readonly cells: readonly CellView[]
  readonly board: BoardView
  readonly drag: DragController
  readonly roving: number
  readonly registerCell: (index: number, node: HTMLDivElement | null) => void
  readonly hints?: boolean
}) {
  const rowLine = board.rowProgress[row]
  if (rowLine === undefined) {
    return null
  }
  return (
    // §5.4: the row IS the carrier, so the band is a tint on its cells and a
    // gradient bar at each end. The attribute is absent unless the line is
    // complete, so nothing in the DOM is being told about a line that is not.
    <div className="mg-board-row" role="row" data-line-revealed={rowLine.complete ? 'row' : undefined}>
      <ClueCell t={t} line={rowLine} orientation="row" hints={hints} />
      {cells.map((cell) => {
        const columnLine = board.columnProgress[cell.column]
        return (
          <BoardCell
            key={cell.index}
            t={t}
            cell={cell}
            rowLine={rowLine}
            columnLine={columnLine}
            revealed={rowLine.complete || columnLine?.complete === true}
            preview={drag.previewVerdictOf(cell.index)}
            tabIndex={cell.index === roving ? 0 : -1}
            registerCell={registerCell}
            hints={hints}
          />
        )
      })}
    </div>
  )
}

/**
 * One cell. `data-state` is the single value the stylesheet binds, and the raw
 * `data-mark`/`data-locked`/`data-correct` attributes stay too, so a test can assert
 * what the projection said and not only the state it resolved to.
 *
 * §8.5: an unmarked cell carries no truth-derived attribute at all — `data-correct`
 * is `unknown` for a cell the player has not claimed, never `true`.
 */
export function BoardCell({
  t,
  cell,
  rowLine,
  columnLine,
  revealed,
  preview,
  tabIndex,
  registerCell,
  hints,
}: {
  readonly t: Copy
  readonly cell: CellView
  readonly rowLine: LineProgress
  readonly columnLine: LineProgress | undefined
  readonly revealed: boolean
  readonly preview: PreviewVerdict
  readonly tabIndex: number
  readonly registerCell: (index: number, node: HTMLDivElement | null) => void
  readonly hints?: boolean
}) {
  const state = cellState(cell, revealed)
  return (
    <div
      className="mg-cell"
      role="gridcell"
      ref={(node) => {
        registerCell(cell.index, node)
      }}
      tabIndex={tabIndex}
      /* No `aria-selected`. A gridcell that is always "not selected" advertises a
         selection model the board does not have: the roving tabindex is a focus
         cursor, and a click is an assertion, not a selection. The cell already
         carries its own state in `aria-label`, and the grid declares no
         `aria-multiselectable`, so claiming a false selection on all 225 cells only
         misleads. */
      aria-label={describeCell(t, cell)}
      data-testid={`cell-${cell.index}`}
      data-cell-index={cell.index}
      data-state={state}
      data-mark={cell.mark}
      data-locked={cell.locked ? 'true' : 'false'}
      data-correct={cell.correct === null ? 'unknown' : cell.correct ? 'true' : 'false'}
      data-preview={preview === 'hit' || preview === 'risk' ? preview : undefined}
      /* The wrong-* states set `--cell-texture` and the background-image that paints
         it is bound to `[data-texture]`, so a hatched cell needs both. */
      data-texture={state === 'wrong-mine' || state === 'wrong-blank' ? 'hatch' : undefined}
    >
      {cell.mark === 'unknown' ? null : <span className="mg-cell__mark" aria-hidden="true" />}
      <RunGuides
        run={runCovering(rowLine.runs, cell.column)}
        cap={capOf(rowLine.runs, cell.column)}
        hints={hints}
      />
      <RunGuides
        run={runCovering(columnLine?.runs ?? [], cell.row)}
        cap={capOf(columnLine?.runs ?? [], cell.row)}
        orientation="column"
        hints={hints}
      />
    </div>
  )
}

/** The eight values the style lane binds. Anything else is an unmapped state. */
function cellState(cell: CellView, revealed: boolean): string {
  if (cell.mark === 'unknown') {
    return revealed ? 'revealed' : 'unmarked'
  }
  if (cell.correct === false) {
    return cell.mark === 'mine' ? 'wrong-mine' : 'wrong-blank'
  }
  if (cell.locked) {
    return cell.mark === 'mine' ? 'mine-locked' : 'blank-locked'
  }
  return cell.mark === 'mine' ? 'mine' : 'blank'
}

type Cap = 'only' | 'start' | 'middle' | 'end'

function runCovering(runs: readonly OrderedRunProgress[], offset: number): OrderedRunProgress | null {
  for (const run of runs) {
    if (run.start === null || run.end === null) {
      continue
    }
    if (offset >= run.start && offset <= run.end) {
      return run
    }
  }
  return null
}

function capOf(runs: readonly OrderedRunProgress[], offset: number): Cap {
  for (const run of runs) {
    if (run.start === null || run.end === null) {
      continue
    }
    if (offset < run.start || offset > run.end) {
      continue
    }
    if (run.start === run.end) {
      return 'only'
    }
    if (offset === run.start) {
      return 'start'
    }
    return offset === run.end ? 'end' : 'middle'
  }
  return 'only'
}

/**
 * The run tape. It renders inside the cells a run covers rather than as one measured
 * overlay, so it needs no geometry: consecutive segments join into a continuous
 * underline and `data-cap` tells the stylesheet where the ends are.
 *
 * §5.6: a tape is a PROOF, and it takes all three of these to be one.
 *   · `run.invariant` — the run's window is forced by the clue alone. A window read
 *     off the solution is inference, and inference drawn on the board reads as an
 *     answer key, so `mineIndices` is never rendered and never a cap source.
 *   · `run.start !== null` — a start is proved, not merely floated.
 *   · `run.end !== null` — an end is proved too. `start` and `invariant` are the
 *     pure deduction; `end` is not. When the solution pins an end and leaves the
 *     start free, `end` comes back set and `start` stays `null`, so "an end
 *     exists" is not evidence of position and the guard has to ask for both.
 * Dropping either guard would let a run that merely COULD be somewhere be drawn
 * as though it were certainly there. Note that marking a window forces its start,
 * so the one state this cannot reach in play is `complete === true` with
 * `start === null`; the reachable proof that a window is inference is a non-empty
 * `mineIndices` beside a null `start`.
 *
 * § — and the hint layer's cut runs straight through this component. The
 * membership rule is INFERENCE versus ACKNOWLEDGEMENT, and this function is where
 * the two meet: `run.complete` is derived from the PLAYER's own marks, so a closed
 * run's tape is the game saying \u201cyou finished that\u201d and is drawn at every
 * setting; an open run's tape is the MACHINE saying where the run has to be, which
 * the player has not done anything to earn, and it is the layer — so `hints`
 * takes it away. The player's own question put it there: \u300c段落位置已定 这个应该也属于提示？」.
 *
 * It is done HERE, in React, rather than in a stylesheet, for one reason that is
 * about testing rather than design: jsdom resolves every CSS import to an empty
 * module here, so a `display: none` written against `[data-hints='off']` would
 * have no committed test at all — it would be a rule nothing could fail. Removing
 * an element is checkable, so this is a checkable gate. The residual, stated
 * plainly: the stylesheet still cannot prove what React does, and the two are
 * kept in step by the shape instead — `data-hints` is written on the stage either
 * way, and the rules that read it are the two annotation edge styles in
 * clues.css §5b, which have no other state to belong to.
 */
export function RunGuides({
  run,
  cap,
  orientation = 'row',
  hints,
}: {
  readonly run: OrderedRunProgress | null
  readonly cap: Cap
  readonly orientation?: 'row' | 'column'
  readonly hints?: boolean
}) {
  if (run === null || !run.invariant) {
    return null
  }
  // The layer's own line, in the same shape as the clue numerals': a closed run
  // is never gated, an open run is. `hints === false` rather than `!hints`, so a
  // caller that forgets the prop draws the loud form rather than the quiet one.
  if (hints === false && !run.complete) {
    return null
  }
  return (
    <span
      className="mg-run-tape"
      data-run={run.complete ? 'complete' : 'tape'}
      data-cap={cap}
      data-orientation={orientation}
      aria-hidden="true"
    />
  )
}

/**
 * A rail cell. It is never focusable and never clickable: the only claim a rail
 * makes is what the line already knows, and the `aria-label` carries the whole
 * sentence so the visual glyphs can be hidden from assistive technology.
 */
export function ClueCell({
  t,
  line,
  orientation,
  hints,
}: {
  readonly t: Copy
  readonly line: LineProgress
  readonly orientation: 'row' | 'column'
  /* The same flag the stage renders as `data-hints`, and it reaches the glyph
     because the glyph is ONE element for all three line marks: a `display: none`
     under `[data-hints='off']` would take the ✓ with the `✕` and the `?`. The
     narrow rules are available — the cell already says `data-line-state` — but
     they would live in a stylesheet no committed test can read, so the two
     ANNOTATION characters are simply not rendered here instead. The `complete`
     branch is deliberately OUT of the flag: the run highlight and the line tick
     are the game's acknowledgement of a finished line, not an assist, and the
     player called that 必须做的. Nothing announced is lost either way: the span
     is `aria-hidden` and the cell's `aria-label` carries the state sentence
     under both values. */
  readonly hints?: boolean
}) {
  const state = lineState(line)
  const annotated = state === 'contradiction' || state === 'unknown'
  const glyph =
    annotated && hints !== false
      ? state === 'contradiction'
        ? '✕'
        : '?'
      : state === 'complete'
        ? '✓'
        : ''
  return (
    <div
      className="mg-rail-cell"
      role={orientation === 'row' ? 'rowheader' : 'columnheader'}
      aria-label={describeLine(t, line)}
      data-testid={`${orientation}-clue-${line.index}`}
      data-line={orientation}
      data-line-state={state}
      /* The stage carries the switch; the cell repeats it, so a rail cell states
         the two facts about itself a reader needs — which line it is, and whether
         the annotations are being drawn for it — and so clues.css's five off-rules
         are two compounds deep (the house rule for a selector chain) instead of
         three. It costs one attribute per cell and buys specificity that does not
         depend on the off-rules coming after the on-rules, which is the only kind
         of ordering a later edit can break silently. */
      data-hints={hints === false ? 'off' : 'on'}
    >
      <span className="mg-rail-cell__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="mg-rail-cell__clue" aria-hidden="true">
        {line.clue.length === 0 ? (
          <span className="mg-rail-cell__empty">—</span>
        ) : (
          line.clue.map((length, runIndex) => (
            <span className="mg-rail-cell__run" key={runIndex}>
              {/* A run is one numeral and nothing else. The blank guarantee is
                  drawn by the gutter between runs and by the run's own underline
                  (clues.css §4, §6), not by a separator glyph: a `│` cost 5.7px
                  of a row rail's width per run and pushed every numeral after the
                  first off the cell's centre line, for a grouping the line break
                  already gives a column rail. */}
              {/* §5 states a closed run ON its numeral: `data-run-state` is the
                  hook clues.css turns into the acknowledgement — the numeral's own
                  box filled solid confirm with the digit knocked out, plus the
                  solid underline. The block is the numeral's box and nothing more,
                  so it cannot push a column rail's run past the band or widen a row
                  rail. Neither the block nor the `✓` reads the hint flag: a run
                  whose mines are all marked is closed, and the tick is the line's
                  own news, so a player who has the annotations off still gets both.
                  The glyph element is always rendered, which is what lets clues.css
                  fill its badge strip. */}
              <span
                className="mg-rail-cell__numeral"
                data-run-state={line.runs[runIndex]?.complete === true ? 'complete' : 'open'}
              >
                {length}
              </span>
            </span>
          ))
        )}
      </span>
    </div>
  )
}

/** §5's priority: contradiction, then unknown, then complete, then neutral. */
function lineState(line: LineProgress): 'contradiction' | 'unknown' | 'complete' | 'neutral' {
  if (line.contradiction) {
    return 'contradiction'
  }
  if (line.status === 'unknown') {
    return 'unknown'
  }
  return line.complete ? 'complete' : 'neutral'
}
