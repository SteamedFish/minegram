import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  StarBattleSurface,
  STAR_DIFFICULTIES,
  type StarBattleSurfaceProps,
  type StarMark,
} from './StarBattleSurface'

/**
 * The Star Battle surface's behavioural contract. Everything asserted here is
 * something jsdom can see: grid shape, the data-colour channel, the mark
 * callbacks and their coordinates, drag dedupe, keyboard roving, the counter
 * states, the wrong-mark announcement, and the win/loss banners. Pixels are
 * the stylesheet's business and are guarded by scripts/style-check.mjs.
 *
 * Fixture: a 4x4 whose solution is [1, 3, 0, 2] — stars on the diagonal-ish,
 * cheap to reason about row by row.
 */

const N = 4
const PUZZLE = {
  n: N,
  seed: 42,
  colours: new Uint8Array([
    0, 0, 1, 1,
    0, 2, 2, 1,
    3, 2, 3, 3,
    1, 3, 0, 2,
  ]),
  solution: [1, 3, 0, 2],
}

interface MarkCall {
  readonly row: number
  readonly col: number
  readonly next: StarMark
}

let container: HTMLElement
let root: Root | null = null

function defaults(): StarBattleSurfaceProps {
  return {
    locale: 'en',
    puzzle: PUZZLE,
    marks: new Uint8Array(N * N),
    status: 'playing',
    score: 5,
    mistakes: 0,
    streak: 0,
    difficulty: 'starter',
    minSide: 4,
    maxSide: 15,
    onMark: () => {},
    onNewRound: () => {},
    onDifficultyChange: () => {},
    onSizeChange: () => {},
    onBackToPicker: () => {},
  }
}

function render(overrides: Partial<StarBattleSurfaceProps> = {}): StarBattleSurfaceProps {
  const props = { ...defaults(), ...overrides }
  if (root === null) {
    root = createRoot(container)
  }
  act(() => {
    root?.render(<StarBattleSurface {...props} />)
  })
  return props
}

function cell(index: number): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-cell-index='${index}']`)
  expect(found).not.toBeNull()
  return found as HTMLElement
}

function grid(): HTMLElement {
  const found = container.querySelector<HTMLElement>('[data-testid="star-grid"]')
  expect(found).not.toBeNull()
  return found as HTMLElement
}

/** A pointer event built on MouseEvent, with the pointer fields added — jsdom has no PointerEvent constructor. */
function firePointer(
  target: Element,
  type: string,
  opts: { button?: number; pointerId?: number; pointerType?: string; clientX?: number; clientY?: number } = {},
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: opts.button ?? 0,
    clientX: opts.clientX ?? 0,
    clientY: opts.clientY ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: opts.pointerId ?? 1 })
  if (opts.pointerType !== undefined) {
    Object.defineProperty(event, 'pointerType', { value: opts.pointerType })
  }
  act(() => {
    target.dispatchEvent(event)
  })
}

function key(target: Element, k: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  })
}

function click(node: Element): void {
  act(() => {
    node.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
  })
}

function marksWith(entries: Record<number, number>): Uint8Array {
  const marks = new Uint8Array(N * N)
  for (const [index, code] of Object.entries(entries)) {
    marks[Number(index)] = code
  }
  return marks
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  if (root !== null) {
    act(() => {
      root?.unmount()
    })
    root = null
  }
  container.remove()
})

describe('StarBattleSurface — grid and colour channel', () => {
  it('renders an n x n grid of cells in n rows', () => {
    render()
    expect(container.querySelectorAll('[role="grid"]')).toHaveLength(1)
    expect(container.querySelectorAll('[role="row"]')).toHaveLength(N)
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(N * N)
    expect(grid().getAttribute('aria-rowcount')).toBe(String(N))
    expect(grid().getAttribute('aria-colcount')).toBe(String(N))
  })

  it('carries the colour on data-colour and never as an inline style', () => {
    render()
    for (const index of [0, 5, 10, 15]) {
      const node = cell(index)
      expect(node.getAttribute('data-colour')).toBe(String(PUZZLE.colours[index]))
      expect(node.getAttribute('style')).toBeNull()
    }
  })

  it('exposes every cell state through its accessible name', () => {
    render({ marks: marksWith({ 1: 2, 2: 1, 4: 3 }) })
    expect(cell(0).getAttribute('aria-label')).toContain('unmarked')
    expect(cell(2).getAttribute('aria-label')).toContain('empty')
    expect(cell(1).getAttribute('aria-label')).toContain('star')
    expect(cell(4).getAttribute('aria-label')).toContain('locked star')
  })
})

describe('StarBattleSurface — pointer interaction', () => {
  it('left click marks blank, clicking blank again clears it', () => {
    const calls: MarkCall[] = []
    const handlers = { onMark: (row: number, col: number, next: StarMark) => calls.push({ row, col, next }) }
    render(handlers)
    firePointer(cell(0), 'pointerdown')
    firePointer(cell(0), 'pointerup')
    expect(calls).toEqual([{ row: 0, col: 0, next: 'blank' }])
    render({ ...handlers, marks: marksWith({ 0: 1 }) })
    firePointer(cell(0), 'pointerdown')
    firePointer(cell(0), 'pointerup')
    expect(calls[1]).toEqual({ row: 0, col: 0, next: null })
  })

  it('right click marks a star, clicking star again clears it', () => {
    const calls: MarkCall[] = []
    const handlers = { onMark: (row: number, col: number, next: StarMark) => calls.push({ row, col, next }) }
    render(handlers)
    firePointer(cell(3), 'pointerdown', { button: 2 })
    firePointer(cell(3), 'pointerup', { button: 2 })
    expect(calls).toEqual([{ row: 0, col: 3, next: 'star' }])
    render({ ...handlers, marks: marksWith({ 3: 2 }) })
    firePointer(cell(3), 'pointerdown', { button: 2 })
    firePointer(cell(3), 'pointerup', { button: 2 })
    expect(calls[1]).toEqual({ row: 0, col: 3, next: null })
  })

  it('changing a star to blank by left click dispatches blank', () => {
    const calls: MarkCall[] = []
    render({ marks: marksWith({ 3: 2 }), onMark: (row, col, next) => calls.push({ row, col, next }) })
    firePointer(cell(3), 'pointerdown')
    firePointer(cell(3), 'pointerup')
    expect(calls).toEqual([{ row: 0, col: 3, next: 'blank' }])
  })

  it('a drag paints each cell at most once, including its origin', () => {
    const calls: MarkCall[] = []
    render({ onMark: (row, col, next) => calls.push({ row, col, next }) })
    let moving = false
    const queue: (Element | null)[] = [cell(1), cell(2), cell(1)]
    // jsdom does not implement elementFromPoint at all, so it is assigned, not spied.
    document.elementFromPoint = () => {
      // The pointerdown resolves its origin from the event target; only moves
      // consult the hit-test, which is stubbed cell by cell.
      if (!moving) {
        return null
      }
      return queue.shift() ?? null
    }
    try {
      const board = grid()
      firePointer(cell(0), 'pointerdown', { clientX: 0, clientY: 0 })
      moving = true
      firePointer(board, 'pointermove', { clientX: 10, clientY: 0 })
      firePointer(board, 'pointermove', { clientX: 20, clientY: 0 })
      firePointer(board, 'pointermove', { clientX: 30, clientY: 0 })
      firePointer(board, 'pointerup', { clientX: 30, clientY: 0 })
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint
    }
    expect(calls).toEqual([
      { row: 0, col: 0, next: 'blank' },
      { row: 0, col: 1, next: 'blank' },
      { row: 0, col: 2, next: 'blank' },
    ])
  })

  it('a touch long-press marks a star without a right button', () => {
    vi.useFakeTimers()
    const calls: MarkCall[] = []
    render({ onMark: (row, col, next) => calls.push({ row, col, next }) })
    firePointer(cell(5), 'pointerdown', { pointerType: 'touch', pointerId: 7 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toEqual([{ row: 1, col: 1, next: 'star' }])
    // Releasing the long-press must not toggle the star back off.
    firePointer(cell(5), 'pointerup', { pointerType: 'touch', pointerId: 7 })
    expect(calls).toHaveLength(1)
  })

  it('locked cells reject every pointer gesture silently', () => {
    const calls: MarkCall[] = []
    render({ marks: marksWith({ 4: 3 }), onMark: (row, col, next) => calls.push({ row, col, next }) })
    firePointer(cell(4), 'pointerdown')
    firePointer(cell(4), 'pointerup')
    firePointer(cell(4), 'pointerdown', { button: 2 })
    firePointer(cell(4), 'pointerup', { button: 2 })
    expect(calls).toEqual([])
  })

  it('ignores pointer input when the round is not playing', () => {
    const calls: MarkCall[] = []
    render({ status: 'lost', onMark: (row, col, next) => calls.push({ row, col, next }) })
    firePointer(cell(0), 'pointerdown')
    firePointer(cell(0), 'pointerup')
    expect(calls).toEqual([])
  })
})

describe('StarBattleSurface — keyboard', () => {
  it('arrow keys move a single roving tab stop', () => {
    render()
    const first = cell(0)
    expect(first.getAttribute('tabindex')).toBe('0')
    expect(cell(1).getAttribute('tabindex')).toBe('-1')
    act(() => {
      first.focus()
    })
    key(first, 'ArrowRight')
    expect(document.activeElement).toBe(cell(1))
    expect(cell(1).getAttribute('tabindex')).toBe('0')
    expect(cell(0).getAttribute('tabindex')).toBe('-1')
    key(cell(1), 'ArrowDown')
    expect(document.activeElement).toBe(cell(5))
    key(cell(5), 'ArrowLeft')
    expect(document.activeElement).toBe(cell(4))
    key(cell(4), 'ArrowUp')
    expect(document.activeElement).toBe(cell(0))
  })

  it('space toggles blank, s toggles star, Backspace clears', () => {
    const calls: MarkCall[] = []
    const handlers = { onMark: (row: number, col: number, next: StarMark) => calls.push({ row, col, next }) }
    render(handlers)
    const target = cell(1)
    key(target, ' ')
    expect(calls).toEqual([{ row: 0, col: 1, next: 'blank' }])
    // Each toggle is read off the fresh marks, as the store would send them back.
    render({ ...handlers, marks: marksWith({ 1: 1 }) })
    key(target, 's')
    expect(calls[1]).toEqual({ row: 0, col: 1, next: 'star' })
    render({ ...handlers, marks: marksWith({ 1: 2 }) })
    key(target, 's')
    expect(calls[2]).toEqual({ row: 0, col: 1, next: null })
    // Clearing an unmarked cell is silent.
    key(cell(0), 'Backspace')
    expect(calls).toHaveLength(3)
  })

  it('the star toggle is reachable without a pointer on a fresh cell', () => {
    const calls: MarkCall[] = []
    render({ onMark: (row, col, next) => calls.push({ row, col, next }) })
    key(cell(6), '*')
    expect(calls).toEqual([{ row: 1, col: 2, next: 'star' }])
  })

  it('keyboard input is inert when the round is over', () => {
    const calls: MarkCall[] = []
    // 'won' still renders the grid (dimmed under the banner), so the keys
    // genuinely reach a cell and must still be refused.
    render({ status: 'won', onMark: (row, col, next) => calls.push({ row, col, next }) })
    key(cell(0), ' ')
    key(cell(0), 's')
    expect(calls).toEqual([])
  })
})

describe('StarBattleSurface — the four constraints, counted', () => {
  it('reads a correct star as satisfied across row, column and colour', () => {
    // Cell 1 is row 0, column 1, colour 0 — and solution[0] is 1, so it is correct.
    render({ marks: marksWith({ 1: 2 }) })
    expect(container.querySelector("[data-testid='counter-rows-0']")?.getAttribute('data-state')).toBe('satisfied')
    expect(container.querySelector("[data-testid='counter-columns-1']")?.getAttribute('data-state')).toBe('satisfied')
    expect(container.querySelector("[data-testid='counter-colours-0']")?.getAttribute('data-state')).toBe('satisfied')
    expect(container.querySelector("[data-testid='counter-rows-1']")?.getAttribute('data-state')).toBe('open')
    expect(container.querySelector("[data-testid='counter-rows-0']")?.textContent).toBe('1')
  })

  it('reads two stars in one line as violated, and flags touching stars as a conflict', () => {
    render({ marks: marksWith({ 1: 2, 2: 2 }) })
    expect(container.querySelector("[data-testid='counter-rows-0']")?.getAttribute('data-state')).toBe('violated')
    expect(cell(1).getAttribute('data-conflict')).toBe('true')
    expect(cell(2).getAttribute('data-conflict')).toBe('true')
  })

  it('reads a single misplaced star as violated, not satisfied', () => {
    // Cell 0 is row 0, column 0 — solution[0] is 1, so the star is wrong.
    render({ marks: marksWith({ 0: 2 }) })
    expect(cell(0).getAttribute('data-wrong')).toBe('true')
    expect(container.querySelector("[data-testid='counter-rows-0']")?.getAttribute('data-state')).toBe('violated')
    expect(container.querySelector("[data-testid='counter-columns-0']")?.getAttribute('data-state')).toBe('violated')
  })

  it('keeps the colour counter on data-colour like every other colour surface', () => {
    render()
    const chip = container.querySelector("[data-testid='counter-colours-2']")
    expect(chip?.getAttribute('data-colour')).toBe('2')
  })
})

describe('StarBattleSurface — mistakes are announced, not just coloured', () => {
  it('puts a new wrong mark into the polite live region, in Chinese too', () => {
    const spoken = (): string =>
      container.querySelector('.mg-star-live')?.textContent ?? ''
    render({ locale: 'zh' })
    expect(spoken()).toBe('')
    render({ locale: 'zh', marks: marksWith({ 0: 2 }) })
    expect(spoken()).toContain('标记错误')
    expect(spoken()).toContain('第 1 行第 1 列')
    expect(cell(0).getAttribute('aria-label')).toContain('错误的星标')
  })

  it('announces a wrong blank the same way', () => {
    render()
    render({ marks: marksWith({ 1: 1 }) })
    expect(container.querySelector('.mg-star-live')?.textContent).toContain('Wrong mark')
    expect(cell(1).getAttribute('aria-label')).toContain('wrong empty mark')
  })
})

describe('StarBattleSurface — round states', () => {
  it('idle and generating state their case plainly without a grid', () => {
    render({ status: 'idle' })
    expect(container.querySelector('[data-testid="star-grid"]')).toBeNull()
    expect(container.querySelector('[data-testid="star-empty"]')?.textContent).toContain('No board yet')
    render({ status: 'generating' })
    expect(container.querySelector('[data-testid="star-empty"]')?.textContent).toContain('Printing the board')
  })

  it('a won board shows a banner whose primary control starts the next round', () => {
    const onNewRound = vi.fn()
    render({ status: 'won', score: 4, onNewRound })
    const banner = container.querySelector('[data-testid="star-banner"]')
    expect(banner?.getAttribute('data-tone')).toBe('won')
    expect(banner?.textContent).toContain('Board complete')
    const primary = banner?.querySelector('button')
    expect(primary).not.toBeNull()
    click(primary as Element)
    expect(onNewRound).toHaveBeenCalledTimes(1)
  })

  it('a lost board states the reason and offers restart and the way back', () => {
    const onNewRound = vi.fn()
    const onBackToPicker = vi.fn()
    render({ status: 'lost', score: 0, onNewRound, onBackToPicker })
    const banner = container.querySelector('[data-testid="star-banner"]')
    expect(banner?.getAttribute('data-tone')).toBe('lost')
    expect(banner?.textContent).toContain('Out of points')
    const buttons = banner?.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    click(buttons?.[0] as Element)
    expect(onNewRound).toHaveBeenCalledTimes(1)
    click(buttons?.[1] as Element)
    expect(onBackToPicker).toHaveBeenCalledTimes(1)
  })

  it('announces the round result through the live region', () => {
    render({ status: 'won' })
    expect(container.querySelector('.mg-star-live')?.textContent).toContain('Board complete')
    render({ status: 'lost' })
    expect(container.querySelector('.mg-star-live')?.textContent).toContain('Out of points')
  })
})

describe('StarBattleSurface — chrome', () => {
  it('shows score, mistakes and streak in the meter', () => {
    render({ score: 3, mistakes: 2, streak: 7 })
    expect(container.querySelector('[data-testid="star-score"]')?.textContent).toBe('3')
    expect(container.querySelector('[data-testid="star-mistakes"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-testid="star-streak"]')?.textContent).toBe('7')
  })

  it('changes difficulty through the segmented control', () => {
    const onDifficultyChange = vi.fn()
    render({ difficulty: 'starter', onDifficultyChange })
    expect(STAR_DIFFICULTIES).toEqual(['starter', 'steady', 'challenging'])
    const option = container.querySelector<HTMLInputElement>("input[value='steady']")
    expect(option).not.toBeNull()
    act(() => {
      option?.click()
    })
    expect(onDifficultyChange).toHaveBeenCalledWith('steady')
  })

  it('offers the way back to the picker', () => {
    const onBackToPicker = vi.fn()
    render({ onBackToPicker })
    const back = container.querySelector('.mg-star-toolbar__back')
    expect(back?.textContent).toBe('All games')
    click(back as Element)
    expect(onBackToPicker).toHaveBeenCalledTimes(1)
  })

  it('renders every size in the given range as a segmented option', () => {
    render({ minSide: 4, maxSide: 15 })
    const group = container.querySelector<HTMLElement>('[data-testid="star-size"] .mg-seg')
    expect(group?.getAttribute('role')).toBe('radiogroup')
    expect(group?.getAttribute('aria-label')).toBe('Board size')
    const options = container.querySelectorAll<HTMLInputElement>("[data-testid='star-size'] input[type='radio']")
    expect(options).toHaveLength(12)
    expect(Array.from(options).map((option) => option.value)).toEqual([
      '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15',
    ])
    // A narrowed range renders exactly what it is given.
    render({ minSide: 6, maxSide: 8 })
    const narrowed = container.querySelectorAll<HTMLInputElement>("[data-testid='star-size'] input[type='radio']")
    expect(Array.from(narrowed).map((option) => option.value)).toEqual(['6', '7', '8'])
  })

  it('marks the live board side as the checked option and calls onSizeChange with the chosen n', () => {
    const onSizeChange = vi.fn()
    render({ onSizeChange })
    const checked = container.querySelector<HTMLInputElement>("[data-testid='star-size'] input:checked")
    expect(checked?.value).toBe('4')
    const twelve = container.querySelector<HTMLInputElement>("[data-testid='star-size'] input[value='12']")
    expect(twelve).not.toBeNull()
    act(() => {
      ;(twelve as HTMLInputElement).click()
    })
    expect(onSizeChange).toHaveBeenCalledTimes(1)
    expect(onSizeChange).toHaveBeenCalledWith(12)
  })

  it('announces the size group the way the difficulty group does, in Chinese too', () => {
    render({ locale: 'zh' })
    const group = container.querySelector<HTMLElement>("[data-testid='star-size'] .mg-seg")
    expect(group?.getAttribute('aria-label')).toBe('棋盘尺寸')
    const difficulty = container.querySelector<HTMLElement>("[id='mg-star-difficulty']")
    expect(difficulty?.getAttribute('aria-label')).toBe('难度')
  })

  it('disables the size control while a board is printing, like difficulty', () => {
    render({ status: 'generating' })
    const options = container.querySelectorAll<HTMLInputElement>("[data-testid='star-size'] input[type='radio']")
    expect(options.length).toBeGreaterThan(0)
    for (const option of Array.from(options)) {
      expect(option.disabled).toBe(true)
    }
  })

  it('cell keyboard roving still works with the size control present', () => {
    render()
    const first = cell(0)
    expect(first.getAttribute('tabindex')).toBe('0')
    act(() => {
      first.focus()
    })
    key(first, 'ArrowRight')
    expect(document.activeElement).toBe(cell(1))
    key(cell(1), 'ArrowDown')
    expect(document.activeElement).toBe(cell(5))
  })

  it('renders Chinese copy when the locale says zh', () => {
    render({ locale: 'zh' })
    expect(container.querySelector('.mg-star-hint')?.textContent).toContain('左键标空')
    expect(container.querySelector('.mg-star-meter__label')?.textContent).toBe('分数')
    expect(container.querySelector('.mg-star-toolbar__back')?.textContent).toBe('全部游戏')
    expect(container.querySelector("[data-testid='star-counters-colours'] .mg-star-counters__label")?.textContent).toBe('颜色')
  })
})
