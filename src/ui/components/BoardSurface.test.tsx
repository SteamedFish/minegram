import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardSurface, ClueCell, settleFitCell } from './BoardSurface'
import { BoardEmptyState } from './BoardEmptyState'
import { createGameStore, type GameStore } from '../gameStore'
import { DEFAULT_LOCALE, getCopy } from '../copy'
import { derivePuzzleClues } from '../../domain'
import { normalizeGenerationSettings } from '../../engine/generator/settings'
import type { MarkingMode, UiSnapshot, ZoomStep } from '../viewModel'
import type { LineProgress } from '../../application/lineProgress'

/**
 * The board surface's structural contract, and only the parts of it this file owns.
 *
 * Three things are proved here, all of them things jsdom CAN see because they are
 * attributes and a custom property rather than pixels:
 *
 *   1. the §5.4 reveal hooks. A complete line's ROW container carries
 *      `data-line-revealed="row"` and every complete COLUMN contributes one
 *      `.mg-board-column-reveal[data-line-revealed="column"]` carrying its own index
 *      in `--k`. board.css binds both, so if either name or the index drifts the
 *      reveal paints nothing and nothing here would notice.
 *   2. the empty state really replaces the stage, and leaves no board hooks behind.
 *   3. the height-aware Fit. §1.7's solve was width-only, which is why a 15×15 board
 *      could grow past its pane; the fit now takes the LARGER of the width and height
 *      solves. jsdom has no layout, so the pane's box is stubbed — that is the only
 *      way to exercise a `ResizeObserver` measure at all, and it is why the height
 *      axis is asserted directly rather than through a screenshot.
 *
 * Nothing here asserts pixels. The paint is the stylesheet's business and is checked
 * by `.tmp/style-check.mjs` and by eye in a browser.
 */

// 1 0
// 0 1
// A 2×2 whose mines sit on a diagonal, so row 0 and column 0 share a single mine at
// cell 0 and marking it CORRECTLY completes both lines at once — the cheapest fixture
// in the codebase for the reveal, and the one the store's own suite uses.
const BOARD = [1, 0, 0, 1] as const
const DIMENSIONS = { rows: 2, columns: 2 } as const
const SETTINGS = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  seed: 'surface-fixture',
  difficulty: 'starter',
  maxAttempts: 3,
})

let container: HTMLElement
let root: Root | null = null
let store: GameStore | null = null

function openStore(): GameStore {
  const created = createGameStore()
  created.dispatch({ type: 'generation/start', settings: SETTINGS, initialScore: 5 })
  created.dispatch({
    type: 'generation/succeeded',
    generationId: 1,
    round: {
      settings: SETTINGS,
      board: BOARD,
      puzzle: { dimensions: DIMENSIONS, clues: derivePuzzleClues(BOARD, DIMENSIONS) },
    },
  })
  const snapshot = created.getSnapshot()
  if (snapshot.status.status !== 'playing') {
    throw new Error('the fixture failed to reach a playable round')
  }
  return created
}

function paint(snapshot: UiSnapshot, live: GameStore, mode: MarkingMode = 'mine', hints?: boolean, zoom: ZoomStep = 'fit'): void {
  const noop = (): void => undefined
  root = createRoot(container)
  act(() => {
    root?.render(
      <BoardSurface
        t={getCopy(DEFAULT_LOCALE)}
        snapshot={snapshot}
        board={snapshot.board}
        mode={mode}
        zoom={zoom}
        fingerMarking={false}
        hints={hints}
        store={live}
        onMode={noop}
        onZoom={noop}
        onFingerMarking={noop}
        onGenerate={noop}
        onCancel={noop}
      />,
    )
  })
}

function all(selector: string): Element[] {
  return Array.from(container.querySelectorAll(selector))
}

/**
 * The rows that hold CELLS.
 *
 * `.mg-board-row` also matches the rail row, which carries `--rails` and is the
 * stage's first child, so an unqualified query returns one row too many.
 */
function cellRows(): Element[] {
  return all('.mg-board-row:not(.mg-board-row--rails)')
}

function one(selector: string): Element {
  const found = all(selector)
  expect(found.length).toBe(1)
  return found[0] as Element
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (root !== null) {
    act(() => {
      root?.unmount()
    })
    root = null
  }
  store?.dispose()
  store = null
  container.remove()
  Reflect.deleteProperty(globalThis, 'ResizeObserver')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'clientHeight')
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetWidth')
  Reflect.deleteProperty(HTMLElement.prototype, 'offsetHeight')
})

describe('BoardSurface — the §5.4 reveal hooks', () => {
  it('leaves an unplayed board unrevealed', () => {
    store = openStore()
    paint(store.getSnapshot(), store)
    const rows = all('.mg-board-row[data-line-revealed]')
    expect(rows).toHaveLength(0)
    expect(all('.mg-board-column-reveal')).toHaveLength(0)
  })

  it('marks a complete row on the row CONTAINER and leaves the others alone', () => {
    store = openStore()
    // Cell 0 is a mine, and row 0's only mine. Marking it correctly completes row 0
    // and column 0; row 1 still holds an unmarked mine at cell 3.
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }])
    })
    paint(store.getSnapshot(), store)

    const rows = cellRows()
    expect(rows).toHaveLength(2)
    expect(rows[0]?.getAttribute('data-line-revealed')).toBe('row')
    expect(rows[1]?.hasAttribute('data-line-revealed')).toBe(false)
  })

  it('gives every complete column one strip, carrying that column index in --k', () => {
    store = openStore()
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }])
    })
    paint(store.getSnapshot(), store)

    const strips = all('.mg-board-column-reveal')
    expect(strips).toHaveLength(1)
    const strip = strips[0] as HTMLElement
    expect(strip.getAttribute('data-line-revealed')).toBe('column')
    // Column 0 is the complete one, and `--k` is what places the strip on grid line
    // `calc(var(--k) + 1)`. A strip with the wrong index would paint a whole other
    // column, which is the failure this assertion exists to catch.
    expect(strip.style.getPropertyValue('--k').trim()).toBe('0')
    // Decorative: a strip is a wash, not content, so it must not be announced or
    // focusable, and it must not intercept a pointer aimed at a cell.
    expect(strip.getAttribute('aria-hidden')).toBe('true')
    expect(strip.hasAttribute('tabindex')).toBe(false)
  })

  it('keeps the strips inside the stage, after the rows', () => {
    store = openStore()
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }])
    })
    paint(store.getSnapshot(), store)

    const stage = one('.mg-board-stage')
    const children = Array.from(stage.children)
    const lastRow = children.findIndex((child) => child.classList.contains('mg-board-row'))
    const firstStrip = children.findIndex((child) =>
      child.classList.contains('mg-board-column-reveal'),
    )
    expect(lastRow).toBeGreaterThan(-1)
    expect(firstStrip).toBeGreaterThan(lastRow)
    // A strip is a GRID ITEM of the stage, placed by `grid-column: calc(var(--k) + 1)`.
    // jsdom loads no stylesheet, so the two declarations that make that placement
    // meaningful — the strip's `grid-row: 2 / -1` and the stage's `position: relative`
    // — are asserted against the sheet's source in the last block of this file.
  })

  it('reveals every line the player completed at once', () => {
    store = openStore()
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }, { index: 3, assertion: 'mine' }])
    })
    paint(store.getSnapshot(), store)

    // The second mine closes row 1 and column 1 as well, so all four lines are
    // revealed and the board is complete.
    expect(cellRows().filter((row) => row.getAttribute('data-line-revealed') === 'row')).toHaveLength(2)
    const strips = all('.mg-board-column-reveal[data-line-revealed="column"]')
    expect(strips).toHaveLength(2)
    expect(strips.map((strip) => (strip as HTMLElement).style.getPropertyValue('--k').trim())).toEqual([
      '0',
      '1',
    ])
  })

  it('keeps the three hooks the loud ON state binds to, on every rail cell', () => {
    // The hint layer's ON state is pure CSS (clues.css §5, §5.1) because the
    // numerals are 10px: a 10px chip or badge drawn in the markup would have to be
    // carried by the render tree on every one of the forty-eight rail cells of a
    // 24x24 board, and it would be a second thing to keep in step with the line
    // state. So the stylesheet binds to three hooks, and THIS is the test that
    // keeps them alive:
    //   · `.mg-rail-cell__glyph` must exist on EVERY rail cell, including a
    //     resting one, because the ON state fills that strip to turn a settled
    //     line into a bar. Render the badge only for a bad line and a closed line
    //     loses the loudest mark it has.
    //   · `data-line-state` must reach `complete` on a settled line, and
    //   · `data-run-state` must reach `complete` on a closed run.
    // Reverting any of them leaves the marker's loudness silently unstyled.
    store = openStore()
    paint(store.getSnapshot(), store)
    // The corner is a `.mg-rail-cell` too, and it must stay out of the ON state:
    // it holds no line, so it carries no `data-line-state` and never gets an edge
    // or a filled strip of its own.
    expect(one('.mg-rail-cell--corner').hasAttribute('data-line-state')).toBe(false)
    const cells = all('.mg-rail-cell[data-line]')
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      // The badge strip is reserved on every rail cell, so a resting one is still
      // carrying an (empty) glyph to be filled later.
      expect(cell.querySelectorAll('.mg-rail-cell__glyph')).toHaveLength(1)
      expect(cell.getAttribute('data-line-state')).toBe('neutral')
      expect(cell.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('')
    }

    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }, { index: 3, assertion: 'mine' }])
    })
    paint(store.getSnapshot(), store)
    for (const cell of all('.mg-rail-cell[data-line]')) {
      expect(cell.getAttribute('data-line-state')).toBe('complete')
      expect(cell.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('✓')
      const numerals = Array.from(cell.querySelectorAll('.mg-rail-cell__numeral'))
      expect(numerals.length).toBeGreaterThan(0)
      for (const numeral of numerals) {
        expect(numeral.getAttribute('data-run-state')).toBe('complete')
      }
    }
  })
})

describe('BoardSurface — the hint switch as a boundary', () => {
  /**
   * The switch is 提示, and 提示 is EXACTLY what the player has named, which is now
   * THREE members and not the two this block used to say: the 矛盾提示 cell (dashed
   * edge, ✕), the 进度未解 cell (dotted edge, ?), and the 段落位置已定 tape — the
   * underline under an OPEN run whose position the solution has forced, which the
   * player asked about directly: 「段落位置已定 这个应该也属于提示？」. The first two
   * are the two the player named in the legend; the third arrived by the rule the
   * component now carries in code, which is INFERENCE versus ACKNOWLEDGEMENT — a
   * member says something the MACHINE worked out, a non-member says something the
   * PLAYER did. It is not the acknowledgement. A run whose mines are all marked is
   * lit, a finished line is ticked and a CLOSED run's tape stays because the player
   * did that work; the player said so twice and called it 必须做的. A switch that
   * could take those away would be a switch that can make the game unplayable, and a
   * gate that grows is a bug.
   *
   * So there are four phases, and this file pins all four:
   *
   *   1  off, acknowledgement   the ✓ stands and the numerals are filled
   *   2  on,  acknowledgement   the same board, and the same two facts
   *   3  off, annotations       neither ✕ nor ? is in the DOM at all
   *   4  on,  annotations       both glyphs are, each in the same cell as before
   *
   * Phases 3 and 4 are checked on the CHARACTER, not on a computed style, because
   * jsdom does not lay out stylesheets: an assertion about `display: none` keeps
   * passing with the glyph painted. `.mg-rail-cell__glyph` is one element for all
   * three marks, so the two annotation characters have to be withheld by the
   * component. The span itself always exists — it carries the badge strip's
   * geometry, and the strip is where the annotations are loudest — so "absent"
   * means an empty span, and the cell's own `data-line-state` is untouched either
   * way because this is a presentation gate and never a state gate.
   *
   * THE THIRD MEMBER IS NOT A CHARACTER, so it is not asserted in these four: the
   * tape is an element, gated in `RunGuides` by returning null, and it is asserted
   * in the test immediately after phase 4. Both gates are component gates for the
   * same reason, and neither can be done in a stylesheet here.
   */

  /** The complete-line fixture: cells 0 and 3 are row 0's only and column 0's only. */
  function closedStore(): GameStore {
    const created = openStore()
    act(() => {
      created.actions.mark([
        { index: 0, assertion: 'mine' },
        { index: 3, assertion: 'mine' },
      ])
    })
    return created
  }

  /** A line the machine could not enumerate. Built rather than generated: an
   *  `unknown` status needs enumeration to hit a resource limit, which a fixture
   *  must not wait for. `ClueCell` is a pure function of the line, so the state
   *  the UI cares about — the glyph and the two attributes — is fully reachable
   *  this way, and the store still covers the contradiction half for real. */
  function unresolvedLine(): LineProgress {
    return {
      orientation: 'column',
      index: 0,
      clue: [1, 2],
      fullyLabeled: false,
      compatiblePatternCount: null,
      contradiction: false,
      status: 'unknown',
      complete: false,
      runs: [
        { runIndex: 0, length: 1, start: 0, end: 0, invariant: true, mineIndices: [0], complete: true },
        { runIndex: 1, length: 2, start: 2, end: 3, invariant: true, mineIndices: [2, 3], complete: false },
      ],
    }
  }

  function paintCell(line: LineProgress, hints: boolean): Element {
    act(() => {
      root?.render(<ClueCell t={getCopy(DEFAULT_LOCALE)} line={line} orientation="column" hints={hints} />)
    })
    return one('.mg-rail-cell')
  }

  const glyphs = (): string[] =>
    all('.mg-rail-cell[data-line]').map((cell) => cell.querySelector('.mg-rail-cell__glyph')?.textContent ?? '')

  it('phase 1 — off: the closed line keeps its tick, and its run numerals stay filled', () => {
    store = closedStore()
    paint(store.getSnapshot(), store, 'mine', false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
    // Every rail cell mirrors the switch, so one query reads a cell's own mode and
    // clues.css's off-rules can name the cell instead of the stage.
    for (const cell of all('.mg-rail-cell[data-line]')) {
      expect(cell.getAttribute('data-hints')).toBe('off')
    }
    expect(glyphs()).toEqual(['✓', '✓', '✓', '✓'])
    expect(all('.mg-rail-cell[data-line-state="complete"]')).toHaveLength(4)
    // The numerals are the other half of the acknowledgement, and the off-rules
    // give an annotated line the resting underline rather than no underline.
    expect(all('.mg-rail-cell__numeral[data-run-state="complete"]').length).toBeGreaterThan(0)
    for (const cell of all('.mg-rail-cell[data-line-state="complete"]')) {
      expect((cell.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0)
    }
  })

  it('phase 2 — on: the same board, the same acknowledgement, so the switch changed nothing here', () => {
    store = closedStore()
    paint(store.getSnapshot(), store, 'mine', true)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('on')
    expect(glyphs()).toEqual(['✓', '✓', '✓', '✓'])
    expect(all('.mg-rail-cell[data-line-state="complete"]')).toHaveLength(4)
    expect(all('.mg-rail-cell__numeral[data-run-state="complete"]').length).toBeGreaterThan(0)
  })

  it('phase 3 — off: neither annotation is in the DOM, and the rail still knows about both', () => {
    store = openStore()
    // Two mines under a clue of one is the only way a mark has no pattern at all,
    // so this is the real contradiction, reached the way a player reaches one.
    act(() => {
      store?.actions.mark([
        { index: 0, assertion: 'mine' },
        { index: 1, assertion: 'mine' },
      ])
    })
    paint(store.getSnapshot(), store, 'mine', false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
    const contradictionCell = one('.mg-rail-cell[data-line-state="contradiction"]')
    // The character is gone, which is the assertion a `display: none` regression
    // could not fail; the span stays, because it is also the tick's span.
    expect(contradictionCell.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('')
    expect(glyphs()).not.toContain('✕')
    expect(glyphs()).not.toContain('?')
    // The state attribute and the label are NOT gated: the DOM keeps reporting
    // what the machine knows, and a screen reader is not quieter than the eye.
    expect(contradictionCell.getAttribute('aria-label')).toContain(
      getCopy(DEFAULT_LOCALE).clue.contradiction,
    )
    // The `?` half needs an enumeration that hit a resource limit, so it is
    // rendered directly: off, the character is absent and the cell still says why.
    const unknown = paintCell(unresolvedLine(), false)
    expect(unknown.getAttribute('data-line-state')).toBe('unknown')
    expect(unknown.getAttribute('data-hints')).toBe('off')
    expect(unknown.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('')
  })

  it('phase 4 — on: both annotations appear, each in the cell that was already saying so', () => {
    store = openStore()
    act(() => {
      store?.actions.mark([
        { index: 0, assertion: 'mine' },
        { index: 1, assertion: 'mine' },
      ])
    })
    paint(store.getSnapshot(), store, 'mine', true)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('on')
    const contradiction = all('.mg-rail-cell[data-line-state="contradiction"]')
    expect(contradiction).toHaveLength(1)
    expect(contradiction[0]?.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('✕')
    expect(glyphs()).toContain('✕')

    const unknown = paintCell(unresolvedLine(), true)
    expect(unknown.getAttribute('data-hints')).toBe('on')
    expect(unknown.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('?')
  })

  it('gates the third member — the open run tape — on the same cut, and never the closed one', () => {
    // The tape is an ELEMENT and not a character, so it is gated by returning null
    // from `RunGuides` rather than by emptying a span, and it is asserted on the
    // count. That is not a stylistic difference: jsdom resolves every stylesheet
    // import to an empty module here, so a `display: none` written against
    // `[data-hints='off']` would be a rule with no committed test — a gate that
    // could be deleted and nothing would fail.
    //
    // The board is the 2x2 diagonal, and ONE correct blank is all it takes to make
    // the deduction: cell 1 is blank, so row 0's clue of `1` can only be cell 0, and
    // column 1's can only be cell 3. Both runs are forced and neither is finished,
    // so the tapes are `data-run="tape"` — the layer. Marking nothing else keeps the
    // auto-reveal out of it: row 0's only mine is unmarked, so the line is not filled
    // behind the player's back and a closed tape cannot be mistaken for an open one.
    store = openStore()
    act(() => {
      store?.actions.mark([{ index: 1, assertion: 'blank' }])
    })
    const openTapes = (): Element[] => all('.mg-run-tape[data-run="tape"]')
    const closedTapes = (): Element[] => all('.mg-run-tape[data-run="complete"]')
    // A second `paint` on the same container is a second `createRoot`, which React
    // warns about, so the root is torn down between every view of the same store.
    const repaint = (hints: boolean): void => {
      act(() => {
        root?.unmount()
        root = null
      })
      paint(store?.getSnapshot() as UiSnapshot, store as GameStore, 'mine', hints)
    }

    paint(store.getSnapshot(), store, 'mine', true)
    // Non-vacuity first: with the layer on, the deduction is on the board, and
    // exactly the two forced-but-unfinished runs carry a tape. The other two lines
    // are two-cell lines with an unforced single run, which is what `invariant` means.
    expect(openTapes()).toHaveLength(2)
    expect(closedTapes()).toHaveLength(0)
    // Each tape is where the deduction is, and it is the machine's claim, not the
    // player's: the cells they sit in are unmarked.
    for (const tape of openTapes()) {
      // An unmarked cell is `data-mark="unknown"` — the value means "the player has
      // said nothing", which is the whole claim: the tape is standing where no
      // assertion was made.
      expect(tape.closest('[data-cell-index]')?.getAttribute('data-mark')).toBe('unknown')
      expect(tape.getAttribute('aria-hidden')).toBe('true')
    }
    act(() => {
      root?.unmount()
      root = null
    })
    repaint(false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
    // The whole layer: no tape of either kind, and the cells are still there, still
    // unmarked, and still described by their own labels.
    expect(all('.mg-run-tape')).toHaveLength(0)
    expect(all('[data-mark="unknown"]').length).toBe(3)

    // And the cut, in the direction that matters most: the player finishes the run
    // and the tape STAYS with the layer off, because that is the acknowledgement.
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }])
    })
    repaint(false)
    expect(openTapes()).toHaveLength(0)
    expect(closedTapes().length).toBeGreaterThan(0)
  })

  /**
   * The auto-reveal is not the hint layer, and the claim used to rest on an
   * argument no test could see: that `hints` is read in exactly one place and that
   * `src/application/` imports nothing from `src/ui/`. A layering argument is
   * true right up until somebody reads the flag in a selector or a memo. This is
   * the observable half of the claim — flip the flag, and every mark, every lock
   * and every label on the board must be byte-identical, including the cells the
   * reducer revealed on its own.
   *
   * The `blank-locked` assertion is what keeps the test from passing vacuously:
   * a boundary test over a board where nothing was ever revealed would prove
   * nothing about the reveal.
   */
  it('leaves the revealed marks and the locks byte-identical when the flag flips', () => {
    store = openStore()
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }, { index: 3, assertion: 'mine' }])
    })
    const fingerprint = (): string =>
      all('[data-cell-index]')
        .map((cell) =>
          [
            cell.getAttribute('data-cell-index'),
            cell.getAttribute('data-mark'),
            cell.getAttribute('data-locked'),
            cell.getAttribute('data-correct'),
            cell.getAttribute('data-state'),
            cell.getAttribute('data-texture') ?? '',
            cell.getAttribute('aria-label') ?? '',
            cell.querySelectorAll('.mg-cell__mark').length,
          ].join('\u0000'),
        )
        .join('\n')
    const locks = (): string[] => all('[data-cell-index]').map((cell) => cell.getAttribute('data-locked') ?? '?')

    paint(store.getSnapshot(), store, 'mine', true)
    // The reducer filled row 0's and column 0's remaining cells on its own.
    expect(all('.mg-cell[data-state="blank-locked"]').length).toBe(2)
    const on = fingerprint()
    const onLocks = locks()

    act(() => {
      root?.unmount()
      root = null
    })
    paint(store.getSnapshot(), store, 'mine', false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
    expect(fingerprint()).toBe(on)
    expect(locks()).toEqual(onLocks)
    // The revealed cells are still revealed, and still locked, with the flag off.
    expect(all('.mg-cell[data-state="blank-locked"]').length).toBe(2)
  })
})

describe('BoardSurface — the unprinted region', () => {
  it('shows the empty state and no stage before a round exists', () => {
    store = createGameStore()
    paint(store.getSnapshot(), store)
    expect(all('.mg-board-empty')).toHaveLength(1)
    expect(all('.mg-board-stage')).toHaveLength(0)
    expect(all('[role="grid"]')).toHaveLength(0)
    expect(all('[data-cell-index]')).toHaveLength(0)
  })

  it('swaps the empty state for the board when a round arrives', () => {
    store = createGameStore()
    paint(store.getSnapshot(), store)
    expect(all('.mg-board-empty')).toHaveLength(1)
    act(() => {
      store?.dispatch({ type: 'generation/start', settings: SETTINGS, initialScore: 5 })
      store?.dispatch({
        type: 'generation/succeeded',
        generationId: 1,
        round: {
          settings: SETTINGS,
          board: BOARD,
          puzzle: { dimensions: DIMENSIONS, clues: derivePuzzleClues(BOARD, DIMENSIONS) },
        },
      })
    })
    paint(store.getSnapshot(), store)
    expect(all('.mg-board-empty')).toHaveLength(0)
    expect(all('.mg-board-stage')).toHaveLength(1)
    expect(all('[data-cell-index]')).toHaveLength(4)
  })

  it('is the same component the board region imports', () => {
    // Guards against a second, divergent copy of the placeholder being introduced:
    // the region must render `BoardEmptyState` itself, not a lookalike.
    store = createGameStore()
    paint(store.getSnapshot(), store)
    expect(one('.mg-board-empty').getAttribute('data-testid')).toBe('board-empty')
    expect(BoardEmptyState).toBeTypeOf('function')
  })
})

describe('BoardSurface — the height-aware Fit', () => {
  /**
   * jsdom has no `ResizeObserver`, and the fit effect deliberately bails out when
   * there is none, so without this stub every measurement in this block would read the
   * initial 32px and pass or fail for the wrong reason. The stub records what it is
   * asked to observe, which is how the last test proves the observer watches the PANE
   * and not the stage.
   */
  const observed: Element[] = []
  // The callbacks as well as the nodes, so a test can make the pane report a new size
  // and have the fit re-solve. Without this the only way to re-measure is to remount
  // the whole board, which cannot distinguish "re-solved" from "never moved".
  const callbacks: (() => void)[] = []

  function fireObservers(): void {
    for (const callback of callbacks) {
      callback()
    }
  }

  // A parameter property would be shorter, but `erasableSyntaxOnly` is on in
  // tsconfig.app.json, so the field is declared and assigned like everything else here.
  class StubResizeObserver {
    private readonly callback: () => void

    constructor(callback: () => void) {
      this.callback = callback
    }

    observe(node: Element): void {
      observed.push(node)
      callbacks.push(this.callback)
      this.callback()
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  function stubPane(
    width: number,
    height: number,
    railWidth = 0,
    railBlock = 0,
    rowChrome = 0,
  ): void {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: StubResizeObserver,
    })
    observed.length = 0
    callbacks.length = 0
    definePane(width, height, railWidth, railBlock, rowChrome)
  }

  /**
   * Re-report the pane's box WITHOUT resetting the observer registries.
   *
   * A pane that resizes is not a new observer, and conflating the two is a trap this
   * suite has already paid for once: clearing the registry in `stubPane` meant that
   * re-stubbing a size threw away the very callback the test then wanted to fire, and
   * the re-solve it was checking silently never happened. The first draft of that test
   * passed the "holds still" half and failed the "re-solves" half for exactly that
   * reason — a failure that read like a defect in the fix.
   */
  function definePane(
    width: number,
    height: number,
    railWidth = 0,
    railBlock = 0,
    rowChrome = 0,
  ): void {
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('mg-board-scroll') ? width : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('mg-board-scroll') ? height : 0
      },
    })
    // The corner cell is what the fit measures the rail by, and it is the one element
    // that spans the whole rail band, so its two numbers are the rail's two costs.
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('mg-rail-cell') ? railWidth : 0
      },
    })
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      // The rails ROW is the band plus its own border, and the fit measures the
      // difference, so `rowChrome` is how a test speaks for the 1px
      // `border-block-end` the row spends outside the corner's box.
      get(this: HTMLElement) {
        if (this.classList.contains('mg-rail-cell')) return railBlock
        if (this.classList.contains('mg-board-row--rails')) return railBlock + rowChrome
        return 0
      },
    })
  }

  function fitCell(): string {
    return (one('.mg-board-stage') as HTMLElement).style.getPropertyValue('--cell').trim()
  }

  it('lets the HEIGHT solve win when the width solve would overflow the pane', () => {
    stubPane(400, 58)
    store = openStore()
    paint(store.getSnapshot(), store)
    // 400px wide over 2 columns would be 200px cells, and the ceiling would let 56 of
    // them through: 112px of board in a 58px pane, with the last row cut in half. The
    // height solve gives floor(58 / 2) = 29px and the board is 58px: it fits. 29 is
    // strictly inside the 24–56 band, so a wrong reading of either axis cannot produce
    // this number — the width answer clamps to 56 and the floor answer is 24.
    expect(fitCell()).toBe('29px')
  })

  it('still honours the width solve when the pane is wide and short', () => {
    stubPane(200, 400)
    store = openStore()
    paint(store.getSnapshot(), store)
    // 200 / 2 = 100 clamped to the ceiling, and 400 / 2 = 200 is wider still, so the
    // answer is the ceiling: a wide, short pane grows the board, up to the cap.
    expect(fitCell()).toBe('56px')
  })

  it('never shrinks a cell below the 24px floor, whatever the pane says', () => {
    stubPane(20, 20)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('24px')
  })

  it('reads an absent hints flag as on, which is what the stylesheet does', () => {
    // clues.css §5.1 gates the whole loud treatment behind
    // `.mg-board-stage[data-hints='off']`, so an absent attribute must render
    // as "on" here too — anything else would split the component and the sheet
    // on what the default is. The APP owns the off-by-default preference
    // (useStoredFlag(t.storage.hints, false)) and always passes the flag.
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('on')
  })

  it('renders data-hints="off" when the preference is off, so the gate has something to read', () => {
    store = openStore()
    paint(store.getSnapshot(), store, 'mine', false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
  })

  it('falls back to the width solve when the pane reports no height', () => {
    // A display:none board region measures zero in every axis, and a hidden board must
    // not be sized to the 24px floor merely because it is not on screen yet. 60px over
    // two columns is 30px, which sits between the floor and the ceiling, so a wrong
    // fallback would show up as either 24 or 56.
    stubPane(60, 0)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('30px')
  })

  it('holds its size when the pane reports no WIDTH, rather than falling to the floor', () => {
    // The inline axis has no fallback, and that asymmetry is the whole point. A pane
    // of zero width is not a measurement — it is the absence of one — and the old
    // arithmetic turned the absence into the floor: `Math.floor(0 / 2)` is 0, the
    // closing `Math.max(FIT_FLOOR_PX, …)` raised that to 24, and a live board was
    // yanked to the smallest size it can paint. Both side panels are hideable, so a
    // zero-inline pane is reachable in play and not only in a `display:none` test.
    //
    // The expectation is the size the board ALREADY had (32 is the resting `--cell`),
    // not merely "not 24": holding is the behaviour, and an implementation that
    // answered some other number in the 24..56 range would also be refusing to hold.
    stubPane(0, 620)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('32px')
  })

  it('re-solves once the pane is measurable again, after holding through a zero-width one', () => {
    // Holding must not become stuck. A frozen cell is a fixed point, so the walk
    // terminates on the first pass while the pane is unmeasurable; when the pane comes
    // back the observer re-fires and the solve runs against real numbers again. The
    // second half is the one that matters — a guard that returns early unconditionally
    // would satisfy the test above forever and leave the board at 32px for good.
    stubPane(0, 620)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('32px')
    definePane(400, 620)
    fireObservers()
    // 400 over two columns is 200 and 620 over two rows is 310, so the smaller is 200
    // and the ceiling has the last word: 56px. The point of the number is that it is
    // the ceiling rather than the 32px held above — a solve that never ran again would
    // also be "not 24".
    expect(fitCell()).toBe('56px')
  })

  it('takes the band off the height solve, as it takes the column off the width one', () => {
    // A 30px band over a 100px pane leaves 70px, and two rows of 35px — without the
    // band the solve would answer 50px and the board would be 130px tall in a 100px
    // pane, which is the cut-off-last-row defect in its purest form.
    stubPane(400, 100, 0, 30)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('35px')
  })

  it('charges the chrome the stage spends on itself before the rows divide', () => {
    // The same pane and the same band as the test above, plus the rails row's own
    // 1px `border-block-end` — the pixels the pane measures, that the band does not
    // cover, and that the solve used to hand back as free room. 100 − 1 − 30 = 69 over
    // two rows is 34, and 34 is strictly inside the band, so the number cannot be
    // produced by the width axis (which would answer the 56px ceiling) or by a
    // dropped chrome (35).
    stubPane(400, 100, 0, 30, 1)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('34px')
  })

  it('holds still on a pane that is TRACKING the board, which is the case the walk broke', () => {
    // The pane is capped by `min(70vh, 46rem)`, so a board shorter than the cap sits
    // inside a pane that is as tall as the board: the height solve's input is then
    // the board's own output, and the only correct answer is the cell it is already
    // at. Measured in the browser on a 1x1 board at 32px: pane 69, band 34, 3px of
    // chrome, so 69 − 3 − 34 = 32. A solve that ignored the chrome read 35, the pane
    // grew to 72, and the next pass read 38 — the chain ramped to the ceiling and
    // came back, so the board never settled and the effect refused to paint at all.
    // Both halves are asserted in one test because the second half is the
    // regression: the SAME pane, measured the way the solve used to measure it, does
    // not terminate inside the budget.
    const trackingPane = (extra: number) => {
      const band = 34
      return (cell: number) => ({
        paneInline: 668,
        paneBlock: band + cell + extra,
        railInline: 19,
        railBlock: band,
        inlineChrome: 0,
        blockChrome: extra,
      })
    }
    const settled = settleFitCell(trackingPane(3), 1, 1, 32)
    expect(settled).toEqual({ cell: 32, passes: 1, converged: true })
    // 69 − 34 = 35 with the 3px uncharged, and the pane grows to 72, so the next pass
    // asks for 38. The budget runs out with the board still moving, which is why the
    // effect refuses to paint rather than paint a size it is about to leave.
    const uncharged = (cell: number) => ({ ...trackingPane(3)(cell), blockChrome: 0 })
    const ramped = settleFitCell(uncharged, 1, 1, 32)
    expect(ramped.converged).toBe(false)
    expect(ramped.cell).toBeGreaterThan(32)
  })

  it('keeps the rail out of the width solve', () => {
    // The rail column is a real width cost: it must come off the pane's box before the
    // cells divide what is left, or every board is a rail too wide. 100px less a 40px
    // rail over two columns is 30px; taking the rail as free would answer 50px and
    // clamp to 56px, so this distinguishes the two.
    stubPane(100, 0, 40)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('30px')
    const stage = one('.mg-board-stage') as HTMLElement
    // The band's run capacity comes from the round's own longest column clue —
    // both columns of this fixture are a single run, so the floor of 2 answers.
    expect(stage.style.getPropertyValue('--rail-slots')).toBe('2')
    // The row rail's track is a LENGTH, not a content size: the stage and every
    // board row are separate grids, so a `max-content` first track lets each of
    // them resolve a different width and every column clue lands over the wrong
    // column. Nothing inline carries the length itself — the CSS owns the
    // formula and the host only writes the counts it spends.
    expect(stage.style.getPropertyValue('--rail-col')).toBe('')
    // This fixture is a 2x2 with every line a single run, so the row track is
    // budgeted one numeral and no gutter, and the band's floor answers 2 slots.
    expect(stage.style.getPropertyValue('--rail-digits')).toBe('1')
    expect(stage.style.getPropertyValue('--rail-runs')).toBe('1')
  })

  it('sizes the band from the round\'s longest column clue, never from a cap', () => {
    // 1/0/1/0/1 down a single column is a three-run clue, so the band needs
    // exactly three slots: a fixed capacity would either truncate this clue (the
    // defect of the six-slot band) or waste band height on every shorter round.
    const tall = [1, 0, 1, 0, 1] as const
    const dimensions = { rows: 5, columns: 1 } as const
    const settings = normalizeGenerationSettings({
      rows: 5,
      columns: 1,
      densityPercent: 60,
      seed: 'surface-tall-fixture',
      difficulty: 'starter',
      maxAttempts: 3,
    })
    const created = createGameStore()
    created.dispatch({ type: 'generation/start', settings, initialScore: 5 })
    created.dispatch({
      type: 'generation/succeeded',
      generationId: 1,
      round: {
        settings,
        board: tall,
        puzzle: { dimensions, clues: derivePuzzleClues(tall, dimensions) },
      },
    })
    paint(created.getSnapshot(), created)
    const stage = one('.mg-board-stage') as HTMLElement
    expect(stage.style.getPropertyValue('--rail-slots')).toBe('3')
  })

  it('budgets the row rail from the longest ROW clue, in numerals and not in runs', () => {
    // A 1×1 board whose single cell is a mine: the row clue and the column clue
    // are both the single run `1`, so the row track is one numeral and no gutter.
    // The floor matters as much as the count — a rail of a one-run clue would
    // otherwise be a 3px sliver of padding with one digit clipped inside it.
    const single = [1] as const
    const singleSettings = normalizeGenerationSettings({
      rows: 1,
      columns: 1,
      densityPercent: 100,
      seed: 'surface-single-fixture',
      difficulty: 'starter',
      maxAttempts: 3,
    })
    const narrow = createGameStore()
    narrow.dispatch({ type: 'generation/start', settings: singleSettings, initialScore: 5 })
    narrow.dispatch({
      type: 'generation/succeeded',
      generationId: 1,
      round: {
        settings: singleSettings,
        board: single,
        puzzle: {
          dimensions: { rows: 1, columns: 1 },
          clues: derivePuzzleClues(single, { rows: 1, columns: 1 }),
        },
      },
    })
    paint(narrow.getSnapshot(), narrow)
    const narrowStage = one('.mg-board-stage') as HTMLElement
    expect(narrowStage.style.getPropertyValue('--rail-digits')).toBe('1')
    expect(narrowStage.style.getPropertyValue('--rail-runs')).toBe('1')

    // A row of twelve mines, a gap, a row of eleven: the clue `12 11` is TWO runs
    // and FOUR numerals. A budget counted in runs would hand this rail the width of
    // two one-digit runs and clip the second digit of both, which is exactly the
    // reported defect — a clue that is drawn but cannot be read. This assertion
    // fails if the count is ever taken from `clue.length` again.
    const wide = [
      1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
      1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ] as const
    const wideDimensions = { rows: 4, columns: 24 } as const
    const wideSettings = normalizeGenerationSettings({
      rows: 4,
      columns: 24,
      densityPercent: 30,
      seed: 'surface-wide-fixture',
      difficulty: 'starter',
      maxAttempts: 3,
    })
    const wideStore = createGameStore()
    wideStore.dispatch({ type: 'generation/start', settings: wideSettings, initialScore: 5 })
    wideStore.dispatch({
      type: 'generation/succeeded',
      generationId: 1,
      round: {
        settings: wideSettings,
        board: wide,
        puzzle: { dimensions: wideDimensions, clues: derivePuzzleClues(wide, wideDimensions) },
      },
    })
    paint(wideStore.getSnapshot(), wideStore)
    const stage = one('.mg-board-stage') as HTMLElement
    expect(stage.style.getPropertyValue('--rail-runs')).toBe('2')
    expect(stage.style.getPropertyValue('--rail-digits')).toBe('4')
  })

  it('renders every run of every clue, and no separator glyph between them', () => {
    // 1 0 1 0 1 down one column is the clue `1 1 1`; the row rail and column rail
    // of that fixture together must draw all three, in reading order, with nothing
    // standing between them. The `│` this used to render is the thing that cost a
    // row rail 42% of its width and pushed every numeral after the first off the
    // cell's centre line, so its absence is asserted as a fact about the DOM and
    // not about the sheet: the grouping is now the gutter and the run underline.
    const tall = [1, 0, 1, 0, 1] as const
    const dimensions = { rows: 5, columns: 1 } as const
    const settings = normalizeGenerationSettings({
      rows: 5,
      columns: 1,
      densityPercent: 60,
      seed: 'surface-runs-fixture',
      difficulty: 'starter',
      maxAttempts: 3,
    })
    const created = createGameStore()
    created.dispatch({ type: 'generation/start', settings, initialScore: 5 })
    created.dispatch({
      type: 'generation/succeeded',
      generationId: 1,
      round: {
        settings,
        board: tall,
        puzzle: { dimensions, clues: derivePuzzleClues(tall, dimensions) },
      },
    })
    paint(created.getSnapshot(), created)
    const column = one('[data-testid="column-clue-0"]')
    const numerals = Array.from(column.querySelectorAll('.mg-rail-cell__numeral')).map(
      (node) => node.textContent,
    )
    expect(numerals).toEqual(['1', '1', '1'])
    expect(column.querySelectorAll('.mg-rail-cell__run')).toHaveLength(3)
    expect(column.querySelectorAll('.mg-rail-cell__separator')).toHaveLength(0)
    // Every numeral still carries its own run state, because that is where a
    // closed run is stated now (confirm ink, 600 weight, the solid underline).
    for (const numeral of column.querySelectorAll('.mg-rail-cell__numeral')) {
      expect(numeral.getAttribute('data-run-state')).toMatch(/^(open|complete)$/)
    }
    // And the whole clue is still in the cell's label, whatever is drawn: a player
    // who cannot see a run can still have it read to them.
    expect(column.getAttribute('aria-label')).toContain('1 1 1')
  })

  it('writes the fit into --cell, and never into the cap', () => {
    stubPane(400, 58)
    store = openStore()
    paint(store.getSnapshot(), store)
    const stage = one('.mg-board-stage') as HTMLElement
    // The only things this file writes inline are the cell size, the grid's two
    // counts, and the band's run capacity; the pane's `max-block-size` lives in board.css and reads no board variable, which is
    // what makes the cap ⇄ cell-size loop impossible. Asserted from the DOM rather than
    // from the sheet: under this repo's vitest configuration every CSS import resolves
    // to an empty module (`css` is stubbed and `?raw` / `?inline` do not get past it),
    // so a source-level check would be checking against `''`. The three declarations
    // jsdom cannot see — the strip's grid lines, the stage's containing block, and the
    // cap — are guarded statically in `.tmp/style-check.mjs` instead, and the visible
    // consequence of the geometry is asserted above: the strip lands after the rows, on
    // its own line, carrying `--k`.
    const inline = Array.from(stage.style)
    expect(inline.sort()).toEqual(['--cell', '--cols', '--rail-digits', '--rail-runs', '--rail-slots', '--rows'])
    // 400 wide and 58 tall over two cells: the width solve would answer 200 and clamp to
    // the 56px ceiling, so 29 can only be the height solve — floor(58 / 2).
    expect(stage.style.getPropertyValue('--cell')).toBe('29px')
    // A cap written in `--cell` or `--rows` would read a variable that lives on the
    // stage — its own child — so the pane would shrink as the board grew and the
    // measure would chase it. The pane's cap is `min(70vh, 46rem)` in board.css: nothing
    // the board can move, which is what closes the loop by construction.
    expect(stage.style.getPropertyValue('--cell-max')).toBe('')
    expect(stage.style.getPropertyValue('--rows-max')).toBe('')
  })

  it('watches the PANE, so a board that changes size cannot unbind the measure', () => {
    stubPane(400, 100)
    store = openStore()
    paint(store.getSnapshot(), store)
    // The loop this avoids: cap → smaller cell → smaller board → cap unbound. It
    // closes the moment the thing measured is the thing the cap is written on. The
    // observer is on the pane, and the pane's own variables are the cap's, so the
    // measure's inputs never include the board's own output.
    expect(observed).toHaveLength(1)
    expect(observed[0]?.classList.contains('mg-board-scroll')).toBe(true)
  })

  it('does not fit a board that does not exist', () => {
    stubPane(400, 100)
    store = createGameStore()
    paint(store.getSnapshot(), store)
    expect(all('.mg-board-stage')).toHaveLength(0)
    expect(all('.mg-board-empty')).toHaveLength(1)
    expect(observed).toHaveLength(0)
  })

  it('stands aside once the player has chosen a zoom step, so the step is what paints', () => {
    // The pane is the one every test above solves to 29px from, so a measure that ran
    // would leave its answer on the stage. The `xxl` step is 72px, the player asked for
    // it, and the measure has no claim on it: this is the clobber the probe's DOM
    // writes cause, measured in the browser at 15x15 in 1440x900 — choosing `xxl`
    // painted 32px and left the rail numerals at the resting 10px, because the fit's
    // answer happened to equal the value `fitCell` already held, `setFitCell` bailed
    // out, nothing re-rendered, and the board kept the last candidate the probe wrote.
    stubPane(400, 58)
    store = openStore()
    paint(store.getSnapshot(), store, 'mine', undefined, 'xxl')
    expect(fitCell()).toBe('72px')
    // And it observed nothing while it stood aside, so there is no measure waiting to
    // write the moment the pane is next resized.
    expect(observed).toHaveLength(0)
  })
})

