import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardSurface } from './BoardSurface'
import { BoardEmptyState } from './BoardEmptyState'
import { createGameStore, type GameStore } from '../gameStore'
import { DEFAULT_LOCALE, getCopy } from '../copy'
import { derivePuzzleClues } from '../../domain'
import { normalizeGenerationSettings } from '../../engine/generator/settings'
import type { MarkingMode, UiSnapshot, ZoomStep } from '../viewModel'

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

function paint(snapshot: UiSnapshot, live: GameStore, mode: MarkingMode = 'mine', hints?: boolean): void {
  const noop = (): void => undefined
  root = createRoot(container)
  act(() => {
    root?.render(
      <BoardSurface
        t={getCopy(DEFAULT_LOCALE)}
        snapshot={snapshot}
        board={snapshot.board}
        mode={mode}
        zoom={'fit' as ZoomStep}
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
   * A closed line's tick IS the loudest mark in the layer, and a switch that
   * removed the numerals and the underlines but left the tick standing would have
   * moved the player's complaint rather than answered it, so the switch has to
   * take the tick with it.
   *
   * What this test deliberately refuses to do is assert `display: none` or any
   * other CSS effect: jsdom does not lay out stylesheets, so such an assertion
   * would keep passing with the tick painted. The character has to be ABSENT
   * FROM THE DOM for the check to mean anything, which is why `ClueCell`
   * withholds it rather than a rule under `[data-hints='off']` hiding the span.
   * (The span itself always exists, because the same element carries the `✕` and
   * the `?` and the geometry of the badge strip; the tick is the part that goes.)
   */
  it('withdraws the closed line tick when the layer is off, and the error badges when it is on', () => {
    store = openStore()
    act(() => {
      store?.actions.mark([{ index: 0, assertion: 'mine' }, { index: 3, assertion: 'mine' }])
    })
    const ticks = (): string[] =>
      all('.mg-rail-cell[data-line]').map((cell) => cell.querySelector('.mg-rail-cell__glyph')?.textContent ?? '')

    paint(store.getSnapshot(), store, 'mine', true)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('on')
    expect(ticks()).toEqual(['✓', '✓', '✓', '✓'])
    // The run numerals are the rest of the layer and they are still announced by
    // their own attributes under both values; only the drawing changes.
    expect(all('.mg-rail-cell__numeral[data-run-state="complete"]').length).toBeGreaterThan(0)

    act(() => {
      root?.unmount()
      root = null
    })
    paint(store.getSnapshot(), store, 'mine', false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
    // No tick anywhere — the assertion a `display: none` regression could not fail.
    expect(ticks()).toEqual(['', '', '', ''])
    expect(all('.mg-rail-cell[data-line-state="complete"]')).toHaveLength(4)
    // The state attributes are untouched, because this is a presentation gate and
    // never a state gate: the rail still knows which lines are closed.
    expect(all('.mg-rail-cell__numeral[data-run-state="complete"]').length).toBeGreaterThan(0)
    // And the label is unconditional, so a screen reader is not quieter than the eye.
    for (const cell of all('.mg-rail-cell[data-line-state="complete"]')) {
      expect((cell.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0)
    }
  })

  /**
   * The `✕` and the `?` are NOT part of the hint layer. A line with no compatible
   * pattern says the player's own marks are wrong, which is an error warning and
   * has to survive a preference about ASSISTS — which is exactly why the tick is
   * withdrawn in the component and the span is never hidden: a blanket
   * `display: none` on `.mg-rail-cell__glyph` would silence the contradiction and
   * the unknown alongside the progress.
   */
  it('keeps the contradiction badge at off, because a wrong mark is not a hint', () => {
    store = openStore()
    // Asserting BOTH of row 0 as mines puts two mines under a clue of one, which is
    // the only way a mark can have no pattern at all: a single wrong mark is usually
    // still fittable, and a fittable wrong mark is not a contradiction yet.
    act(() => {
      store?.actions.mark([
        { index: 0, assertion: 'mine' },
        { index: 1, assertion: 'mine' },
      ])
    })
    const badges = (): string[] =>
      all('.mg-rail-cell[data-line-state]').map((cell) => cell.querySelector('.mg-rail-cell__glyph')?.textContent ?? '')

    paint(store.getSnapshot(), store, 'mine', false)
    expect(one('.mg-board-stage').getAttribute('data-hints')).toBe('off')
    const off = badges()
    expect(off).toContain('✕')
    expect(off).not.toContain('✓')

    act(() => {
      root?.unmount()
      root = null
    })
    paint(store.getSnapshot(), store, 'mine', true)
    const on = badges()
    // Same board, same marks: the ONLY difference the switch makes is that column 0
    // — whose only mine is the correctly marked cell 0 — earns a tick when the layer
    // is on. The `✕` stands in both phases, in the same cell, which is the whole
    // claim: an error warning outlives a preference about assists.
    expect(on.filter((glyph) => glyph === '✕')).toEqual(off.filter((glyph) => glyph === '✕'))
    expect(on).toContain('✕')
    expect(on).toContain('✓')
    expect(off).not.toContain('✓')
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

  // A parameter property would be shorter, but `erasableSyntaxOnly` is on in
  // tsconfig.app.json, so the field is declared and assigned like everything else here.
  class StubResizeObserver {
    private readonly callback: () => void

    constructor(callback: () => void) {
      this.callback = callback
    }

    observe(node: Element): void {
      observed.push(node)
      this.callback()
    }
    unobserve(): void {}
    disconnect(): void {}
  }

  function stubPane(width: number, height: number, railWidth = 0, railBlock = 0): void {
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      writable: true,
      value: StubResizeObserver,
    })
    observed.length = 0
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
      get(this: HTMLElement) {
        return this.classList.contains('mg-rail-cell') ? railBlock : 0
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

  it('takes the band off the height solve, as it takes the column off the width one', () => {
    // A 30px band over a 100px pane leaves 70px, and two rows of 35px — without the
    // band the solve would answer 50px and the board would be 130px tall in a 100px
    // pane, which is the cut-off-last-row defect in its purest form.
    stubPane(400, 100, 0, 30)
    store = openStore()
    paint(store.getSnapshot(), store)
    expect(fitCell()).toBe('35px')
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
})

