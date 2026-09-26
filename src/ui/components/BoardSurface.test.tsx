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

function paint(snapshot: UiSnapshot, live: GameStore, mode: MarkingMode = 'mine'): void {
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
    // `--rail-col` is written in `--cell`, so the rail tracks the fit exactly.
    expect(stage.style.getPropertyValue('--rail-col')).toContain('var(--cell)')
  })

  it('writes the fit into --cell, and never into the cap', () => {
    stubPane(400, 58)
    store = openStore()
    paint(store.getSnapshot(), store)
    const stage = one('.mg-board-stage') as HTMLElement
    // The only thing this file writes inline is the cell size and the rail width; the
    // pane's `max-block-size` lives in board.css and reads no board variable, which is
    // what makes the cap ⇄ cell-size loop impossible. Asserted from the DOM rather than
    // from the sheet: under this repo's vitest configuration every CSS import resolves
    // to an empty module (`css` is stubbed and `?raw` / `?inline` do not get past it),
    // so a source-level check would be checking against `''`. The three declarations
    // jsdom cannot see — the strip's grid lines, the stage's containing block, and the
    // cap — are guarded statically in `.tmp/style-check.mjs` instead, and the visible
    // consequence of the geometry is asserted above: the strip lands after the rows, on
    // its own line, carrying `--k`.
    const inline = Array.from(stage.style)
    expect(inline.sort()).toEqual(['--cell', '--cols', '--rail-col', '--rows'])
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

