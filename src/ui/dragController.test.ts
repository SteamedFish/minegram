/**
 * The §3.1 transition table, exercised as a pure state machine.
 *
 * No real pointer events and no DOM: every event is a plain object with the structural
 * shape the controller declares, and the DOM's only job — `elementFromPoint` +
 * `closest('[data-cell-index]')` + the "index is inside this board" test — is stood in
 * for by a point → cell-index registry, so a rail or an outside point is simply a
 * coordinate that was never registered.
 */
import { describe, expect, it } from 'vitest'
import {
  createDragController,
  ERASE_CAP,
  type DragAssertion,
  type DragCell,
  type DragController,
  type DragPorts,
  type PointerDownInput,
  type PointerEndInput,
  type PointerMoveInput,
} from './dragController'

/** The controller's own source, as text, with no filesystem or node types involved. */
const controllerSource = import.meta.glob<string>('./dragController.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
})['./dragController.ts']

// --------------------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------------------

/** The controller's marking-mode input, taken from its own signature. */
type Mode = Parameters<DragController['setMarkingMode']>[0]
type PreviewResult = ReturnType<DragPorts['preview']>
type Verdict = ReturnType<DragPorts['previewOf']>

interface Recorded {
  readonly commit: DragCell[][]
  readonly clear: number[]
  readonly focus: number[]
  readonly captured: (number | null)[]
  readonly previews: (readonly DragCell[])[]
  readonly verdicts: { readonly index: number; readonly assertion: DragAssertion }[]
}

interface Harness {
  readonly controller: DragController
  readonly recorded: Recorded
  /** Registers the cell a point resolves to; unregistered points are rails/outside. */
  at(x: number, y: number, index: number): void
  setInteractive(value: boolean): void
  setPreviewResult(fn: ((cells: readonly DragCell[]) => PreviewResult) | null): void
  setVerdict(fn: (index: number, assertion: DragAssertion) => Verdict): void
  /** Lays out `count` cells left to right: index `i` at `(i * 10, 0)`. */
  lay(count: number): void
}

function createHarness(
  options: { readonly interactive?: boolean; readonly mode?: Mode; readonly fingerMarking?: boolean } = {},
): Harness {
  const recorded: Recorded = { commit: [], clear: [], focus: [], captured: [], previews: [], verdicts: [] }
  const points = new Map<string, number>()
  let interactive = options.interactive ?? true
  let previewResult: ((cells: readonly DragCell[]) => PreviewResult) | null = null
  let verdict: (index: number, assertion: DragAssertion) => Verdict = () => 'hit'

  const ports: DragPorts = {
    interactive: () => interactive,
    cellIndexAt: (clientX, clientY) => points.get(`${clientX},${clientY}`) ?? null,
    preview: (cells) => {
      recorded.previews.push(cells)
      return previewResult
        ? previewResult(cells)
        : {
            affectedCount: cells.length,
            scoreCost: 0,
            projectedScore: 5,
            reachesZero: false,
            cellIndices: cells.map((cell) => cell.index),
          }
    },
    previewOf: (index, assertion) => {
      recorded.verdicts.push({ index, assertion })
      return verdict(index, assertion)
    },
    commit: (cells) => {
      recorded.commit.push([...cells])
    },
    clear: (index) => {
      recorded.clear.push(index)
    },
    focus: (index) => {
      recorded.focus.push(index)
    },
    setCaptured: (pointerId) => {
      recorded.captured.push(pointerId)
    },
  }

  return {
    controller: createDragController(ports, {
      markingMode: options.mode ?? 'mine',
      fingerMarking: options.fingerMarking,
    }),
    recorded,
    at: (x, y, index) => {
      points.set(`${x},${y}`, index)
    },
    setInteractive: (value) => {
      interactive = value
    },
    setPreviewResult: (fn) => {
      previewResult = fn
    },
    setVerdict: (fn) => {
      verdict = fn
    },
    lay: (count) => {
      for (let index = 0; index < count; index += 1) points.set(`${index * 10},0`, index)
    },
  }
}

/** The point `lay` gave cell `index`. */
function at(index: number): { readonly clientX: number; readonly clientY: number } {
  return { clientX: index * 10, clientY: 0 }
}

const PRIMARY = 1

function down(over: Partial<PointerDownInput> = {}): PointerDownInput {
  return { pointerId: PRIMARY, button: 0, isPrimary: true, ...at(0), ...over }
}

function move(over: Partial<PointerMoveInput> = {}): PointerMoveInput {
  return { pointerId: PRIMARY, isPrimary: true, ...at(0), ...over }
}

function up(over: Partial<PointerEndInput> = {}): PointerEndInput {
  return { pointerId: PRIMARY, ...at(0), ...over }
}

/** One `pointermove` whose coalesced samples are the given cell indices, in order. */
function coalescedMove(indices: readonly number[], over: Partial<PointerMoveInput> = {}): PointerMoveInput {
  return move({
    ...at(indices[indices.length - 1] ?? 0),
    getCoalescedEvents: () => indices.map(at),
    ...over,
  })
}

// --------------------------------------------------------------------------------------
// Row 1 — pointerdown
// --------------------------------------------------------------------------------------

describe('§3.1 row 1 — pointerdown arms', () => {
  it('arms the origin cell, captures, focuses and previews', () => {
    const h = createHarness()
    h.lay(4)

    const hints = h.controller.onPointerDown(down())

    const state = h.controller.getSnapshot()
    expect(state.phase).toBe('armed')
    expect(state.pointerId).toBe(PRIMARY)
    expect(state.mode).toBe('mine')
    expect(state.token).toBe(1)
    expect(state.cells).toEqual([0])
    expect(state.lastIndex).toBe(0)
    expect(state.moved).toBe(false)
    expect(state.capReached).toBe(false)
    expect(state.preview?.affectedCount).toBe(1)
    expect(h.recorded.captured).toEqual([PRIMARY])
    expect(h.recorded.focus).toEqual([0])
    // Kills text selection and native drag; also the cell-scoped context menu.
    expect(hints).toEqual({ preventDefault: true, preventContextMenu: true })
  })

  it('mints a strictly monotonic token per stroke', () => {
    const h = createHarness()
    h.lay(3)
    const tokens: number[] = []
    for (let i = 0; i < 3; i += 1) {
      h.controller.onPointerDown(down({ clientX: i * 10 }))
      tokens.push(h.controller.getSnapshot().token)
      h.controller.onPointerUp(up())
    }
    expect(tokens).toEqual([1, 2, 3])
  })

  it('rejects a non-primary button', () => {
    const h = createHarness()
    h.lay(1)

    const hints = h.controller.onPointerDown(down({ button: 1 }))

    expect(h.controller.getSnapshot().phase).toBe('idle')
    expect(hints.preventDefault).toBe(false)
    expect(h.recorded.captured).toEqual([])
    expect(h.recorded.focus).toEqual([])
  })

  it('rejects a non-primary pointer (a second finger cannot start a stroke)', () => {
    const h = createHarness()
    h.lay(1)

    h.controller.onPointerDown(down({ isPrimary: false, pointerId: 2 }))

    expect(h.controller.getSnapshot().phase).toBe('idle')
    expect(h.recorded.captured).toEqual([])
  })

  it('rejects a rail or outside origin', () => {
    const h = createHarness()
    h.lay(1) // cell 0 only; (9999, 9999) is the rail / the padding around the stage

    h.controller.onPointerDown(down({ clientX: 9999, clientY: 9999 }))

    expect(h.controller.getSnapshot().phase).toBe('idle')
    expect(h.recorded.captured).toEqual([])
    expect(h.recorded.focus).toEqual([])
  })

  it('drops the event when the board is not playing', () => {
    const h = createHarness({ interactive: false })
    h.lay(1)

    h.controller.onPointerDown(down())

    expect(h.controller.getSnapshot().phase).toBe('idle')
    expect(h.recorded.captured).toEqual([])
  })

  it('rejects a second pointerdown while a drag is live, from any pointer', () => {
    const h = createHarness()
    h.lay(2)
    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move({ clientX: 10 }))

    h.controller.onPointerDown(down({ pointerId: 7, clientX: 10 }))
    h.controller.onPointerDown(down({ pointerId: PRIMARY, clientX: 10 }))

    const state = h.controller.getSnapshot()
    expect(state.phase).toBe('painting')
    expect(state.cells).toEqual([0, 1])
    expect(state.pointerId).toBe(PRIMARY)
    // Exactly one capture request: the rejected strokes never touched the port.
    expect(h.recorded.captured).toEqual([PRIMARY])
  })
})

// --------------------------------------------------------------------------------------
// §3.2 — right-click is acceleration only
// --------------------------------------------------------------------------------------

describe('§3.2 — right button', () => {
  it('resolves the opposite of the current mode', () => {
    const h = createHarness({ mode: 'mine' })
    h.lay(1)

    h.controller.onPointerDown(down({ button: 2 }))
    h.controller.onPointerUp(up())

    expect(h.recorded.commit[0]).toEqual([{ index: 0, assertion: 'blank' }])
  })

  it('resolves Mine from Empty', () => {
    const h = createHarness({ mode: 'blank' })
    h.lay(1)

    h.controller.onPointerDown(down({ button: 2 }))
    h.controller.onPointerUp(up())

    expect(h.recorded.commit[0]).toEqual([{ index: 0, assertion: 'mine' }])
  })

  it('never changes the mode', () => {
    const h = createHarness({ mode: 'mine' })
    h.lay(1)

    h.controller.onPointerDown(down({ button: 2 }))
    h.controller.onPointerUp(up())
    h.controller.onPointerDown(down({ clientX: 0 }))
    h.controller.onPointerUp(up())

    // The second, left-button stroke still uses the toolbar's mode, not the right-click one.
    expect(h.recorded.commit[1]).toEqual([{ index: 0, assertion: 'mine' }])
  })

  it('is rejected in Erase mode, which has no opposite', () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(1)

    const hints = h.controller.onPointerDown(down({ button: 2 }))

    expect(hints.preventDefault).toBe(false)
    expect(h.controller.getSnapshot().phase).toBe('idle')
    expect(h.recorded.captured).toEqual([])
    expect(h.recorded.clear).toEqual([])
  })
})

// --------------------------------------------------------------------------------------
// §3.7 + §3.2 — Shift + right-click is a cell action, not a mode change
// --------------------------------------------------------------------------------------

describe('§3.2 / §3.7 — Shift + right button', () => {
  it('clears the pressed cell and nothing else', () => {
    const h = createHarness({ mode: 'mine' })
    h.lay(3)

    const hints = h.controller.onPointerDown(down({ button: 2, shiftKey: true, ...at(2) }))

    expect(hints).toEqual({ preventDefault: true, preventContextMenu: true })
    expect(h.recorded.clear).toEqual([2])
    expect(h.recorded.commit).toEqual([])

    // No stroke was started, so there is nothing for a later event to act on.
    const snapshot = h.controller.getSnapshot()
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.moved).toBe(false)
    expect(snapshot.cells).toEqual([])
    expect(h.controller.batch()).toEqual([])
    expect(h.recorded.captured).toEqual([])
    expect(h.recorded.focus).toEqual([])
  })

  it('works in Erase mode too, where it is simply idempotent', () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(1)

    const hints = h.controller.onPointerDown(down({ button: 2, shiftKey: true }))

    expect(hints.preventDefault).toBe(true)
    expect(h.recorded.clear).toEqual([0])
    expect(h.recorded.commit).toEqual([])
    expect(h.controller.getSnapshot().phase).toBe('idle')
  })

  it('is rejected when the board is not interactive', () => {
    const h = createHarness()
    h.lay(1)
    h.setInteractive(false)

    const hints = h.controller.onPointerDown(down({ button: 2, shiftKey: true }))

    expect(hints).toEqual({ preventDefault: false, preventContextMenu: false })
    expect(h.recorded.clear).toEqual([])
    expect(h.recorded.commit).toEqual([])
  })

  it('leaves the toolbar mode exactly where it was', () => {
    const h = createHarness({ mode: 'mine' })
    h.lay(1)

    h.controller.onPointerDown(down({ button: 2, shiftKey: true }))
    // `mode` is `null` whenever the machine is idle, so the assertion that matters is
    // the next stroke: it still paints the toolbar's assertion, not an erase.
    expect(h.controller.getSnapshot().mode).toBeNull()
    h.controller.onPointerDown(down({ button: 0 }))
    h.controller.onPointerUp(up())

    expect(h.recorded.commit[0]).toEqual([{ index: 0, assertion: 'mine' }])
    expect(h.recorded.clear).toEqual([0])
  })

  it('starts no drag, so the events that follow it do nothing', () => {
    const h = createHarness()
    h.lay(4)

    h.controller.onPointerDown(down({ button: 2, shiftKey: true }))
    h.controller.onPointerMove(move(at(1)))
    h.controller.onPointerMove(coalescedMove([2, 3]))
    h.controller.onPointerUp(up())

    expect(h.recorded.commit).toEqual([])
    expect(h.recorded.clear).toEqual([0])
    expect(h.controller.getSnapshot().phase).toBe('idle')
  })
})

// --------------------------------------------------------------------------------------
// Row 2 — pointermove
// --------------------------------------------------------------------------------------

describe('§3.1 row 2 — pointermove paints', () => {
  it('adds crossed cells in order and turns the stroke into a drag', () => {
    const h = createHarness()
    h.lay(4)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(1)))
    h.controller.onPointerMove(move(at(2)))

    const state = h.controller.getSnapshot()
    expect(state.phase).toBe('painting')
    expect(state.cells).toEqual([0, 1, 2])
    expect(state.moved).toBe(true)
    expect(state.lastIndex).toBe(2)
  })

  it('charges each cell at most once per drag, including on a revisit', () => {
    const h = createHarness()
    h.lay(4)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(1)))
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerMove(move(at(1))) // back over cells already charged
    h.controller.onPointerMove(move(at(3)))

    expect(h.controller.getSnapshot().cells).toEqual([0, 1, 2, 3])
    expect(h.controller.getSnapshot().moved).toBe(true)
  })

  it('marks every crossed cell from a coalesced multi-sample move, in order', () => {
    const h = createHarness()
    h.lay(6)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(coalescedMove([1, 2, 3, 4, 5]))

    expect(h.controller.getSnapshot().cells).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('never interpolates between samples', () => {
    const h = createHarness()
    h.lay(10)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(coalescedMove([7, 8]))

    // Cells 1–6 were never touched by the finger, so they are never claimed.
    expect(h.controller.getSnapshot().cells).toEqual([0, 7, 8])
  })

  it('ignores a move from a different pointer', () => {
    const h = createHarness()
    h.lay(3)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove({ ...move(at(2)), pointerId: 42 })

    expect(h.controller.getSnapshot().cells).toEqual([0])
    expect(h.controller.getSnapshot().phase).toBe('armed')
  })

  it('ignores a move carrying a stale token', () => {
    const h = createHarness()
    h.lay(3)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove({ ...move(at(2)), token: 99 })

    expect(h.controller.getSnapshot().cells).toEqual([0])
  })

  it('keeps the charge-once set while the stroke runs off the board', () => {
    const h = createHarness()
    h.lay(3)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerMove(move({ clientX: 9999, clientY: 9999 })) // over a rail
    h.controller.onPointerMove(move(at(2)))

    const state = h.controller.getSnapshot()
    expect(state.cells).toEqual([0, 2])
    expect(state.lastIndex).toBe(2)
  })

  it('falls back to the event itself when the coalesced list is empty', () => {
    const h = createHarness()
    h.lay(3)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove({ ...move(at(2)), getCoalescedEvents: () => [] })

    expect(h.controller.getSnapshot().cells).toEqual([0, 2])
  })
})

// --------------------------------------------------------------------------------------
// Row 3 — pointerup commits
// --------------------------------------------------------------------------------------

describe('§3.1 row 3 — pointerup commits', () => {
  it('dispatches the whole batch once, in order', () => {
    const h = createHarness({ mode: 'blank' })
    h.lay(4)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(1)))
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerUp(up())

    expect(h.recorded.commit).toEqual([
      [
        { index: 0, assertion: 'blank' },
        { index: 1, assertion: 'blank' },
        { index: 2, assertion: 'blank' },
      ],
    ])
  })

  it('commits a single tap as a complete interaction', () => {
    const h = createHarness()
    h.lay(1)

    h.controller.onPointerDown(down())
    h.controller.onPointerUp(up())

    expect(h.recorded.commit).toEqual([[{ index: 0, assertion: 'mine' }]])
    expect(h.controller.getSnapshot().moved).toBe(false)
  })

  it('never commits twice', () => {
    const h = createHarness()
    h.lay(2)

    h.controller.onPointerDown(down())
    h.controller.onPointerUp(up())
    h.controller.onPointerUp(up())
    h.controller.onPointerUp(up())

    expect(h.recorded.commit.length).toBe(1)
  })

  it('releases capture, clears the drag and leaves focus on the last cell', () => {
    const h = createHarness()
    h.lay(4)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerUp(up())

    const state = h.controller.getSnapshot()
    expect(h.recorded.captured).toEqual([PRIMARY, null])
    expect(state.phase).toBe('idle')
    expect(state.cells).toEqual([])
    expect(state.preview).toBeNull()
    expect(state.lastIndex).toBeNull()
    expect(h.recorded.focus).toEqual([0, 2]) // arm, then the end of the drag
  })

  it('dispatches nothing when the preview reports no affected cell', () => {
    const h = createHarness()
    h.lay(3)
    h.setPreviewResult(() => ({
      affectedCount: 0,
      scoreCost: 0,
      projectedScore: 5,
      reachesZero: false,
      cellIndices: [],
    }))

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerUp(up())

    expect(h.recorded.commit).toEqual([])
    // The stroke still ends cleanly: capture released, drag cleared.
    expect(h.recorded.captured).toEqual([PRIMARY, null])
    expect(h.controller.getSnapshot().phase).toBe('idle')
  })

  it('dispatches nothing when the preview is unknown', () => {
    const h = createHarness()
    h.lay(1)
    h.setPreviewResult(() => null)

    h.controller.onPointerDown(down())
    h.controller.onPointerUp(up())

    expect(h.recorded.commit).toEqual([])
  })
})

// --------------------------------------------------------------------------------------
// Rows 4, 5, 6 — every abort path
// --------------------------------------------------------------------------------------

describe('§3.1 rows 4–6 — abort never dispatches', () => {
  const aborts: { readonly name: string; readonly run: (h: Harness) => void }[] = [
    { name: 'pointercancel', run: (h) => h.controller.onPointerCancel(up()) },
    { name: 'lostpointercapture', run: (h) => h.controller.onLostPointerCapture(up()) },
    { name: 'Escape', run: (h) => h.controller.onEscape() },
  ]

  for (const { name, run } of aborts) {
    it(`aborts on ${name}: no dispatch, capture released, preview cleared`, () => {
      const h = createHarness()
      h.lay(3)
      h.controller.onPointerDown(down())
      h.controller.onPointerMove(move({ clientX: 20 }))

      run(h)

      const state = h.controller.getSnapshot()
      expect(h.recorded.commit).toEqual([])
      expect(h.recorded.clear).toEqual([])
      expect(h.recorded.captured).toEqual([PRIMARY, null])
      expect(state.phase).toBe('idle')
      expect(state.cells).toEqual([])
      expect(state.preview).toBeNull()
    })
  }

  it('drops a stale pointerup that arrives after an abort', () => {
    const h = createHarness()
    h.lay(3)
    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move({ clientX: 20 }))
    h.controller.onPointerCancel(up())

    h.controller.onPointerUp(up())
    h.controller.onPointerUp(up())

    expect(h.recorded.commit).toEqual([])
    expect(h.recorded.captured).toEqual([PRIMARY, null])
  })

  it('drops a stale pointerup carrying the previous token after a re-arm', () => {
    const h = createHarness()
    h.lay(3)
    h.controller.onPointerDown(down())
    h.controller.onPointerCancel(up())

    // A fresh stroke on another pointer, stamped the way a stamping host would.
    h.controller.onPointerDown(down({ pointerId: 2, clientX: 10 }))
    const current = h.controller.getSnapshot().token
    expect(current).toBe(2)
    h.controller.onPointerUp(up({ pointerId: 2, token: 1 })) // the late event
    h.controller.onPointerUp(up({ pointerId: 2, token: current }))

    expect(h.recorded.commit.length).toBe(1)
    expect(h.recorded.commit[0]).toEqual([{ index: 1, assertion: 'mine' }])
  })

  it('is a no-op when there is no drag in flight', () => {
    const h = createHarness()
    h.lay(1)

    expect(h.controller.onEscape()).toEqual({ preventDefault: false, preventContextMenu: false })
    expect(h.controller.onPointerCancel(up())).toEqual({
      preventDefault: false,
      preventContextMenu: false,
    })
    expect(h.recorded.captured).toEqual([])
  })

  it('aborts on a roving-index move so focus and drag cannot disagree', () => {
    const h = createHarness()
    h.lay(3)
    h.controller.onPointerDown(down())

    h.controller.onKeyboard('move', 2)

    expect(h.controller.getSnapshot().phase).toBe('idle')
    expect(h.recorded.captured).toEqual([PRIMARY, null])
    expect(h.recorded.commit).toEqual([])
  })
})

// --------------------------------------------------------------------------------------
// §3.2 — erase mode
// --------------------------------------------------------------------------------------

describe('§3.2 — erase mode', () => {
  it('clears each collected cell and never marks a batch', () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(4)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(1)))
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerUp(up())

    expect(h.recorded.clear).toEqual([0, 1, 2])
    expect(h.recorded.commit).toEqual([])
    expect(h.recorded.previews).toEqual([]) // no assertion to preview
    expect(h.controller.getSnapshot().preview).toBeNull()
  })

  it('caps the collection at 64 cells per commit and reports it', () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(90)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(
      coalescedMove(Array.from({ length: 89 }, (_, offset) => offset + 1)),
    )

    const state = h.controller.getSnapshot()
    expect(state.cells.length).toBe(ERASE_CAP)
    expect(state.capReached).toBe(true)
    expect(state.cells).toEqual(Array.from({ length: ERASE_CAP }, (_, index) => index))

    h.controller.onPointerUp(up())
    expect(h.recorded.clear.length).toBe(ERASE_CAP)
    expect(new Set(h.recorded.clear).size).toBe(ERASE_CAP)
    // The flag survives the release so the chip can still say `toolbar.capReached`.
    expect(h.controller.getSnapshot().capReached).toBe(true)

    h.controller.onPointerDown(down())
    expect(h.controller.getSnapshot().capReached).toBe(false)
  })

  it('still commits a capped drag as a clean single release', () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(70)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(
      coalescedMove(Array.from({ length: 69 }, (_, offset) => offset + 1)),
    )
    h.controller.onPointerUp(up())
    h.controller.onPointerUp(up())

    expect(h.recorded.captured).toEqual([PRIMARY, null])
    expect(h.recorded.clear.length).toBe(ERASE_CAP)
  })
})

// --------------------------------------------------------------------------------------
// Preview (from the store, never re-derived here — §4.5)
// --------------------------------------------------------------------------------------

describe('§4.5 — the preview comes from the store', () => {
  it('recomputes after each added cell', () => {
    const h = createHarness()
    h.lay(5)

    h.controller.onPointerDown(down())
    expect(h.recorded.previews.length).toBe(1)
    h.controller.onPointerMove(coalescedMove([1, 2]))
    expect(h.recorded.previews.length).toBe(3)
    h.controller.onPointerMove(coalescedMove([3, 4]))
    expect(h.recorded.previews.length).toBe(5)

    expect(h.recorded.previews.map((cells) => cells.map((cell) => cell.index))).toEqual([
      [0],
      [0, 1],
      [0, 1, 2],
      [0, 1, 2, 3],
      [0, 1, 2, 3, 4],
    ])
  })

  it('does not recompute when a sample hits an already-charged cell', () => {
    const h = createHarness()
    h.lay(4)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(coalescedMove([1, 2]))
    const before = h.recorded.previews.length
    h.controller.onPointerMove(coalescedMove([2, 1, 2]))
    h.controller.onPointerMove(coalescedMove([1, 2]))

    expect(h.recorded.previews.length).toBe(before)
  })

  it('never asks the store for a preview of an erase batch', () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(3)

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(2)))

    expect(h.recorded.previews).toEqual([])
  })
})

describe('§1.5 / §1.6 — the per-cell preview verdict', () => {
  it("reports the store's verdict for cells in the batch", () => {
    const h = createHarness()
    h.lay(4)
    h.setVerdict((index) => (index === 0 ? 'hit' : 'risk'))

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(coalescedMove([1, 2]))

    expect(h.controller.previewVerdictOf(0)).toBe('hit')
    expect(h.controller.previewVerdictOf(2)).toBe('risk')
    // Asked per rendered cell, not precomputed for the whole batch.
    expect(h.recorded.verdicts).toEqual([
      { index: 0, assertion: 'mine' },
      { index: 2, assertion: 'mine' },
    ])
  })

  it("reports 'none' for a cell outside the batch and while idle", () => {
    const h = createHarness()
    h.lay(4)

    expect(h.controller.previewVerdictOf(0)).toBe('none')

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(1)))
    expect(h.controller.previewVerdictOf(3)).toBe('none')

    h.controller.onPointerUp(up())
    expect(h.controller.previewVerdictOf(0)).toBe('none')
  })

  it("reports 'none-while-inert' once the board stops being interactive", () => {
    const h = createHarness()
    h.lay(2)

    h.controller.onPointerDown(down())
    h.setInteractive(false)

    expect(h.controller.previewVerdictOf(0)).toBe('none-while-inert')
  })

  it("reports 'none' while erasing, which has no assertion to preview", () => {
    const h = createHarness({ mode: 'erase' })
    h.lay(2)

    h.controller.onPointerDown(down())

    expect(h.controller.previewVerdictOf(0)).toBe('none')
    expect(h.recorded.verdicts).toEqual([])
  })
})

// --------------------------------------------------------------------------------------
// §3.4 — keyboard shares the reducer path
// --------------------------------------------------------------------------------------

describe('§3.4 — keyboard requests', () => {
  it('marks with a single-cell batch through the same path as the mouse', () => {
    const h = createHarness()
    h.lay(2)

    h.controller.onKeyboard('mark-mine', 1)
    h.controller.onKeyboard('mark-blank', 1)

    expect(h.recorded.commit).toEqual([
      [{ index: 1, assertion: 'mine' }],
      [{ index: 1, assertion: 'blank' }],
    ])
  })

  it('goes through the same preview gate, so an identical mark dispatches nothing', () => {
    const h = createHarness()
    h.setPreviewResult(() => ({
      affectedCount: 0,
      scoreCost: 0,
      projectedScore: 5,
      reachesZero: false,
      cellIndices: [],
    }))

    h.controller.onKeyboard('mark-mine', 0)

    expect(h.recorded.commit).toEqual([])
  })

  it('clears the roving index', () => {
    const h = createHarness()
    h.lay(2)

    h.controller.onKeyboard('clear', 1)

    expect(h.recorded.clear).toEqual([1])
    expect(h.recorded.commit).toEqual([])
  })

  it('is inert when the board is not playing', () => {
    const h = createHarness({ interactive: false })
    h.lay(2)

    h.controller.onKeyboard('mark-mine', 0)
    h.controller.onKeyboard('clear', 0)

    expect(h.recorded.commit).toEqual([])
    expect(h.recorded.clear).toEqual([])
  })
})

// --------------------------------------------------------------------------------------
// §3.3 — the flag the stylesheet binds to
// --------------------------------------------------------------------------------------

describe('§3.3 — touch-action scoping', () => {
  it('exposes the toggle for the stylesheet and a live answer for the event', () => {
    const h = createHarness({ fingerMarking: true })
    expect(h.controller.getSnapshot().fingerMarking).toBe(true)
    expect(h.controller.canPaint()).toBe(true)

    // The store's status can change with no drag transition in sight, so the conjunction
    // is a live read rather than something frozen into the last snapshot.
    h.setInteractive(false)
    expect(h.controller.canPaint()).toBe(false)
    expect(h.controller.getSnapshot().fingerMarking).toBe(true)

    h.setInteractive(true)
    h.controller.setFingerMarking(false)
    expect(h.controller.getSnapshot().fingerMarking).toBe(false)
    expect(h.controller.canPaint()).toBe(false)
  })

  it('lets a tap mark one cell while painting is off, and aborts on a swipe', () => {
    const h = createHarness({ fingerMarking: false })
    h.lay(4)
    expect(h.controller.canPaint()).toBe(false)

    h.controller.onPointerDown(down())
    h.controller.onPointerUp(up())
    expect(h.recorded.commit).toEqual([[{ index: 0, assertion: 'mine' }]])

    // Painting off: the UA claims the gesture, so the swipe arrives as pointercancel.
    h.controller.onPointerDown(down(at(1)))
    h.controller.onPointerMove(move(at(2)))
    h.controller.onPointerCancel(up())

    expect(h.recorded.commit.length).toBe(1)
    expect(h.controller.getSnapshot().phase).toBe('idle')
  })
})

// --------------------------------------------------------------------------------------
// Host contract
// --------------------------------------------------------------------------------------

describe('host contract', () => {
  it('publishes an immutable snapshot and notifies subscribers on every transition', () => {
    const h = createHarness()
    h.lay(3)
    let notifications = 0
    const unsubscribe = h.controller.subscribe(() => {
      notifications += 1
    })
    const initial = h.controller.getSnapshot()

    h.controller.onPointerDown(down())
    const armed = h.controller.getSnapshot()
    h.controller.onPointerMove(move(at(1)))
    h.controller.onPointerUp(up())
    const idle = h.controller.getSnapshot()

    expect(notifications).toBe(3) // arm, paint, release
    expect(armed).not.toBe(initial)
    expect(idle).not.toBe(armed)
    expect(Object.isFrozen(armed)).toBe(true)
    expect(Object.isFrozen(armed.cells)).toBe(true)
    expect(() => {
      ;(armed.cells as number[]).push(99)
    }).toThrow()

    unsubscribe()
    const before = notifications
    h.controller.onPointerDown(down())
    expect(notifications).toBe(before)
  })

  it('tracks the toolbar mode the host sets', () => {
    const h = createHarness({ mode: 'mine' })
    h.lay(1)

    h.controller.setMarkingMode('blank')
    h.controller.onPointerDown(down())
    expect(h.controller.getSnapshot().mode).toBe('blank')

    h.controller.onPointerUp(up())
    h.controller.setMarkingMode('erase')
    h.controller.onPointerDown(down())
    expect(h.controller.getSnapshot().mode).toBe('erase')
  })

  it('exposes the live batch for the preview chip', () => {
    const h = createHarness({ mode: 'blank' })
    h.lay(4)

    expect(h.controller.batch()).toEqual([])

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(2)))

    expect(h.controller.batch()).toEqual([
      { index: 0, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
    ])
  })

  it('resets without dispatching, releasing any held capture', () => {
    const h = createHarness()
    h.lay(3)
    h.controller.onPointerDown(down())
    h.controller.onPointerMove(move(at(2)))

    h.controller.reset()

    const state = h.controller.getSnapshot()
    expect(state.phase).toBe('idle')
    expect(state.cells).toEqual([])
    expect(state.preview).toBeNull()
    expect(h.recorded.captured).toEqual([PRIMARY, null])
    expect(h.recorded.commit).toEqual([])

    h.controller.onPointerUp(up())
    expect(h.recorded.commit).toEqual([])
  })

  it('is free of React, DOM, clock and randomness, in code and not just in comments', () => {
    expect(controllerSource).toBeTypeOf('string')
    // Comments are allowed to *name* the forbidden things; the code is not.
    const code = (controllerSource as string)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')

    for (const forbidden of [
      'Math.random',
      'Date.now',
      'new Date',
      'setTimeout',
      'setInterval',
      'requestAnimationFrame',
      'performance.now',
      'document.',
      'window.',
      'react',
    ]) {
      expect(code, `dragController must not reference ${forbidden}`).not.toContain(forbidden)
    }
  })
})

// --------------------------------------------------------------------------------------
// The detachment contract
//
// `useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)` does not call
// anything as a method. React stores the two functions it is given and invokes them as
// free functions, so the receiver inside them is `undefined`. A prototype method reads
// `this.state` off `undefined` and throws `TypeError: Cannot read properties of
// undefined (reading 'state')` on the first render — the exact failure that made
// `BoardSurface.tsx` wrap both methods in `useCallback` as a caller-side workaround.
//
// These tests hold the controller to the shape React actually uses, so the workaround
// stays a no-op simplification rather than a load-bearing patch over a real bug.
// --------------------------------------------------------------------------------------

describe('detachment — the shape React actually calls', () => {
  it('getSnapshot works with no receiver and still tracks the live state', () => {
    const h = createHarness()
    h.lay(3)

    const { getSnapshot } = h.controller
    expect(getSnapshot().phase).toBe('idle')

    h.controller.onPointerDown(down())
    h.controller.onPointerMove(coalescedMove([0, 1, 2]))

    // Detached, and still the *same* frozen object the instance would hand back.
    expect(getSnapshot().phase).toBe('painting')
    expect(getSnapshot().cells).toEqual([0, 1, 2])
    expect(getSnapshot().moved).toBe(true)
    expect(Object.isFrozen(getSnapshot())).toBe(true)
  })

  it('subscribe works with no receiver, and the returned unsubscribe detaches', () => {
    const h = createHarness()
    h.lay(2)
    let notifications = 0
    const listener = (): void => {
      notifications += 1
    }

    const { subscribe } = h.controller
    const unsubscribe = subscribe(listener)

    h.controller.onPointerDown(down())
    expect(notifications).toBe(1)

    h.controller.onPointerMove(move(at(1)))
    expect(notifications).toBe(2)

    unsubscribe()
    h.controller.onPointerUp(up())
    expect(notifications).toBe(2)
  })

  it('a useSyncExternalStore-shaped call never touches an undefined receiver', () => {
    const h = createHarness()
    h.lay(3)

    // Exactly what React does: it takes the two functions by reference, losing the
    // instance, and calls them with no receiver. Nothing else in this file is a
    // faithful stand-in for that, because every other test calls `h.controller.x()`.
    const subscribe = h.controller.subscribe
    const getSnapshot = h.controller.getSnapshot
    const read = (): { phase: string; cells: readonly unknown[] } => {
      const state = getSnapshot()
      return { phase: state.phase, cells: state.cells }
    }

    const seen: Array<{ phase: string; cells: readonly unknown[] }> = []
    const unsubscribe = subscribe(() => {
      seen.push(read())
    })

    // A store notifies on change, never on subscribe — so the first read is a direct
    // call and the listener has not fired yet.
    expect(read()).toEqual({ phase: 'idle', cells: [] })
    expect(seen).toEqual([])

    h.controller.onPointerDown(down())
    expect(seen).toEqual([{ phase: 'armed', cells: [0] }])

    h.controller.onPointerMove(coalescedMove([0, 1]))
    h.controller.onPointerUp(up())
    expect(seen[seen.length - 1]).toEqual({ phase: 'idle', cells: [] })

    unsubscribe()
    const settled = seen.length
    h.controller.onPointerDown(down())
    expect(seen).toHaveLength(settled)
  })

  it('detaching every public method leaves the machine working', () => {
    // The class states the invariant for its whole public surface, because the host
    // wires these into React props and React invokes a prop with `this === props`.
    // This pins it so a future refactor cannot quietly reintroduce a receiver
    // dependency in a method some future call site hands to a callback.
    const h = createHarness()
    h.lay(3)
    const c = h.controller
    const { onPointerDown, onPointerMove, onPointerUp, onEscape, onKeyboard, batch, reset } = c

    expect(onPointerDown(down()).preventDefault).toBe(true)
    // MOVE_HINTS: preventDefault true (kills native drag) but no context menu.
    expect(onPointerMove(coalescedMove([0, 1]))).toEqual({
      preventDefault: true,
      preventContextMenu: false,
    })
    expect(batch()).toHaveLength(2)
    expect(onPointerUp(up()).preventDefault).toBe(false)
    expect(h.recorded.commit).toHaveLength(1)

    onPointerDown(down())
    onEscape()
    expect(c.getSnapshot().phase).toBe('idle')
    onKeyboard('mark-blank', 2)
    expect(h.recorded.commit.at(-1)).toEqual([{ index: 2, assertion: 'blank' }])
    reset()
    expect(c.getSnapshot().cells).toEqual([])
  })
})
