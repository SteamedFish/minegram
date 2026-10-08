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
 * callbacks and their coordinates, drag dedupe, keyboard roving, the lives
 * meter, the rules block, the wrong-mark announcement, and the win/loss
 * banners. Pixels are the stylesheet's business and are guarded by
 * scripts/style-check.mjs.
 *
 * Fixture: a 4x4 whose solution is [1, 3, 0, 2] — stars on the diagonal-ish,
 * cheap to reason about row by row. The interaction vocabulary is the flipped
 * one: tap/left-click toggles a star, right-click or a touch long-press
 * toggles a blank, a drag paints the stroke's tool.
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
    lives: 5,
    maxLives: 5,
    mistakes: 0,
    streak: 0,
    difficulty: 'starter',
    side: N,
    minSide: 4,
    maxSide: 15,
    minLives: 1,
    maxLivesCeiling: 9,
    onMark: () => {},
    onNewRound: () => {},
    onRetry: () => {},
    onDifficultyChange: () => {},
    onSizeChange: () => {},
    onMaxLivesChange: () => {},
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
    // Index 1 is a solution star; index 7 is a solution blank; index 4 is a
    // solution blank too — a locked code there must read as a locked blank,
    // because the solution, not the mark code, says what a locked cell locked as.
    render({ marks: marksWith({ 1: 2, 2: 1, 4: 3, 7: 3 }) })
    expect(cell(0).getAttribute('aria-label')).toContain('unmarked')
    expect(cell(2).getAttribute('aria-label')).toContain('empty')
    expect(cell(1).getAttribute('aria-label')).toContain('star')
    expect(cell(7).getAttribute('aria-label')).toContain('locked star')
    expect(cell(4).getAttribute('aria-label')).toContain('locked empty')
  })

  it('renders a locked cell by what the solution says it locked as, not by the code alone', () => {
    // Index 4 (row 1, col 0) is not a solution cell: code 3 there is a locked
    // blank — ringed, dotted, and never counted as a star.
    render({ marks: marksWith({ 4: 3, 7: 3 }) })
    expect(cell(4).getAttribute('data-mark')).toBe('locked-blank')
    expect(cell(7).getAttribute('data-mark')).toBe('locked-star')
    expect(cell(4).querySelector('.mg-star-cell__glyph')?.textContent).toBe('·')
    expect(cell(7).querySelector('.mg-star-cell__glyph')?.textContent).toBe('★')
    // The locked blank is not a star for the adjacency signal either: a star
    // beside it does not conflict.
    render({ marks: marksWith({ 0: 2, 4: 3 }) })
    expect(cell(0).getAttribute('data-conflict')).toBeNull()
  })
})

describe('StarBattleSurface — pointer interaction', () => {
  it('a tap marks a star, tapping the star again clears it', () => {
    const calls: MarkCall[] = []
    const handlers = { onMark: (row: number, col: number, next: StarMark) => calls.push({ row, col, next }) }
    render(handlers)
    firePointer(cell(0), 'pointerdown')
    firePointer(cell(0), 'pointerup')
    expect(calls).toEqual([{ row: 0, col: 0, next: 'star' }])
    render({ ...handlers, marks: marksWith({ 0: 2 }) })
    firePointer(cell(0), 'pointerdown')
    firePointer(cell(0), 'pointerup')
    expect(calls[1]).toEqual({ row: 0, col: 0, next: null })
  })

  it('right click marks a blank, clicking the blank again clears it', () => {
    const calls: MarkCall[] = []
    const handlers = { onMark: (row: number, col: number, next: StarMark) => calls.push({ row, col, next }) }
    render(handlers)
    firePointer(cell(3), 'pointerdown', { button: 2 })
    firePointer(cell(3), 'pointerup', { button: 2 })
    expect(calls).toEqual([{ row: 0, col: 3, next: 'blank' }])
    render({ ...handlers, marks: marksWith({ 3: 1 }) })
    firePointer(cell(3), 'pointerdown', { button: 2 })
    firePointer(cell(3), 'pointerup', { button: 2 })
    expect(calls[1]).toEqual({ row: 0, col: 3, next: null })
  })

  it('a tap on a blank asserts the star — the two tools switch in either direction', () => {
    const calls: MarkCall[] = []
    render({ marks: marksWith({ 3: 1 }), onMark: (row, col, next) => calls.push({ row, col, next }) })
    firePointer(cell(3), 'pointerdown')
    firePointer(cell(3), 'pointerup')
    expect(calls).toEqual([{ row: 0, col: 3, next: 'star' }])
  })

  it('a drag paints each cell at most once, including its origin, with the tap tool', () => {
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
      { row: 0, col: 0, next: 'star' },
      { row: 0, col: 1, next: 'star' },
      { row: 0, col: 2, next: 'star' },
    ])
  })

  it('a touch long-press marks a blank without a right button', () => {
    vi.useFakeTimers()
    const calls: MarkCall[] = []
    render({ onMark: (row, col, next) => calls.push({ row, col, next }) })
    firePointer(cell(5), 'pointerdown', { pointerType: 'touch', pointerId: 7 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(calls).toEqual([{ row: 1, col: 1, next: 'blank' }])
    // Releasing the long-press must not toggle the blank back off.
    firePointer(cell(5), 'pointerup', { pointerType: 'touch', pointerId: 7 })
    expect(calls).toHaveLength(1)
  })

  it('a touch drag after the long-press keeps painting blanks', () => {
    vi.useFakeTimers()
    const calls: MarkCall[] = []
    render({ onMark: (row, col, next) => calls.push({ row, col, next }) })
    let moving = false
    document.elementFromPoint = () => (moving ? cell(6) : null)
    try {
      firePointer(cell(5), 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: 0, clientY: 0 })
      act(() => {
        vi.advanceTimersByTime(500)
      })
      // The store would have applied the long-press by now; feed the blank back
      // so the drag's origin re-assertion reads as a re-assertion, not a new mark.
      render({ marks: marksWith({ 5: 1 }), onMark: (row, col, next) => calls.push({ row, col, next }) })
      moving = true
      firePointer(grid(), 'pointermove', { pointerType: 'touch', pointerId: 7, clientX: 40, clientY: 40 })
      firePointer(cell(5), 'pointerup', { pointerType: 'touch', pointerId: 7 })
    } finally {
      delete (document as { elementFromPoint?: unknown }).elementFromPoint
    }
    expect(calls).toEqual([
      { row: 1, col: 1, next: 'blank' },
      { row: 1, col: 2, next: 'blank' },
    ])
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

describe('StarBattleSurface — wrong marks and conflicts, stated on the cells', () => {
  it('flags a wrong star on data-wrong; a blank on a star cell reads as a plain blank', () => {
    // Cell 0 is row 0, column 0 — solution[0] is 1, so a star there is wrong;
    // cell 1 IS a solution cell, so a blank there is wrong — and must still
    // render exactly like a correct blank: flagging it would leak the answer.
    render({ marks: marksWith({ 0: 2, 1: 1 }) })
    expect(cell(0).getAttribute('data-wrong')).toBe('true')
    expect(cell(1).getAttribute('data-wrong')).toBeNull()
    expect(cell(1).getAttribute('data-mark')).toBe('blank')
    expect(cell(2).getAttribute('data-wrong')).toBeNull()
  })

  it('flags both cells of a touching pair as a conflict', () => {
    render({ marks: marksWith({ 1: 2, 2: 2 }) })
    expect(cell(1).getAttribute('data-conflict')).toBe('true')
    expect(cell(2).getAttribute('data-conflict')).toBe('true')
    // A star with no neighbour carries no conflict, wrong or not.
    render({ marks: marksWith({ 0: 2 }) })
    expect(cell(0).getAttribute('data-conflict')).toBeNull()
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

  it('a wrong blank is silent: no live announcement, the label of a plain blank', () => {
    // 标错空白，应该静默 — a blank on a star cell must not announce the
    // mistake nor label the cell as wrong; it reads exactly like a note.
    render()
    render({ marks: marksWith({ 1: 1 }) })
    expect(container.querySelector('.mg-star-live')?.textContent).toBe('')
    expect(cell(1).getAttribute('aria-label')).toContain('empty')
    expect(cell(1).getAttribute('aria-label')).not.toContain('wrong')
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

  it('a null puzzle states the empty case instead of a fabricated board', () => {
    render({ puzzle: null, status: 'generating' })
    expect(container.querySelector('[data-testid="star-grid"]')).toBeNull()
    expect(container.querySelector('[data-testid="star-empty"]')?.textContent).toContain(
      'Printing the board',
    )
  })

  it('a won board shows a banner whose primary control starts the next round', () => {
    const onNewRound = vi.fn()
    render({ status: 'won', lives: 3, maxLives: 5, onNewRound })
    const banner = container.querySelector('[data-testid="star-banner"]')
    expect(banner?.getAttribute('data-tone')).toBe('won')
    expect(banner?.textContent).toContain('Board complete')
    expect(banner?.textContent).toContain('Lives 3')
    const primary = banner?.querySelector('button')
    expect(primary).not.toBeNull()
    click(primary as Element)
    expect(onNewRound).toHaveBeenCalledTimes(1)
  })

  it('a lost board states the reason and offers restart and the way back', () => {
    const onNewRound = vi.fn()
    const onBackToPicker = vi.fn()
    render({ status: 'lost', lives: 0, maxLives: 5, onNewRound, onBackToPicker })
    const banner = container.querySelector('[data-testid="star-banner"]')
    expect(banner?.getAttribute('data-tone')).toBe('lost')
    expect(banner?.textContent).toContain('Out of lives')
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
    expect(container.querySelector('.mg-star-live')?.textContent).toContain('Out of lives')
  })
})

describe('StarBattleSurface — generation progress', () => {
  const PROGRESS = { candidates: 1200, accepted: 0, phase: 'sampling' as const }

  const indicator = (): HTMLElement | null => container.querySelector('[data-testid="star-progress"]')
  const spoken = (): string => container.querySelector('.mg-star-live')?.textContent ?? ''

  it('shows the phase and the candidate count while generating, and nothing otherwise', () => {
    render({ puzzle: null, status: 'generating', progress: PROGRESS })
    const bar = indicator()
    expect(bar).not.toBeNull()
    expect(bar?.getAttribute('data-phase')).toBe('sampling')
    expect(bar?.textContent).toContain('Sampling colourings')
    expect(bar?.textContent).toContain('1200')

    // Idle and playing show no indicator at all.
    render({ status: 'idle' })
    expect(indicator()).toBeNull()
    render({ status: 'playing' })
    expect(indicator()).toBeNull()
  })

  it('renders nothing until progress arrives, and nothing on the empty generating card without it', () => {
    render({ puzzle: null, status: 'generating' })
    expect(indicator()).toBeNull()
    render({ puzzle: null, status: 'generating', progress: null })
    expect(indicator()).toBeNull()
  })

  it('keeps the line in step with the phase', () => {
    render({ puzzle: null, status: 'generating', progress: PROGRESS })
    expect(indicator()?.textContent).toContain('Sampling colourings')
    render({ puzzle: null, status: 'generating', progress: { candidates: 1201, accepted: 0, phase: 'repairing' } })
    expect(indicator()?.getAttribute('data-phase')).toBe('repairing')
    expect(indicator()?.textContent).toContain('Repairing the layout')
    render({ puzzle: null, status: 'generating', progress: { candidates: 1202, accepted: 1, phase: 'grading' } })
    expect(indicator()?.textContent).toContain('Grading difficulty')
  })

  it('localises the phase names and the count template', () => {
    render({ locale: 'zh', puzzle: null, status: 'generating', progress: PROGRESS })
    const bar = indicator()
    expect(bar?.textContent).toContain('采样配色')
    expect(bar?.textContent).toContain('已尝试 1200 种配色')
    expect(bar?.textContent).not.toContain('Sampling')
  })

  it('announces a phase change through the polite region but not every count tick', () => {
    render({ puzzle: null, status: 'generating', progress: { candidates: 10, accepted: 0, phase: 'sampling' } })
    expect(spoken()).toContain('Sampling colourings')
    const announced = spoken()

    // Same phase, higher count: the counter moves, the region stays silent.
    render({ puzzle: null, status: 'generating', progress: { candidates: 900, accepted: 0, phase: 'sampling' } })
    expect(spoken()).toBe(announced)

    // A new phase is the milestone worth one announcement.
    render({ puzzle: null, status: 'generating', progress: { candidates: 901, accepted: 0, phase: 'grading' } })
    expect(spoken()).toContain('Grading difficulty')
  })

  it('announces the first phase again on the next generation', () => {
    render({ puzzle: null, status: 'generating', progress: PROGRESS })
    expect(spoken()).toContain('Sampling colourings')
    render({ status: 'playing' })
    render({ puzzle: null, status: 'generating', progress: { candidates: 3, accepted: 0, phase: 'sampling' } })
    expect(spoken()).toContain('Sampling colourings — 3 layouts tried')
  })
})

describe('StarBattleSurface — a generation failure is a state, not a dead end', () => {
  const failure = {
    reason: 'resource-limit',
    headline: 'The board could not be printed',
    explanation: 'The generation ran out of budget.',
    remedies: ['Try a smaller board.', 'Try an easier difficulty.'],
    retryable: true,
  }

  it('states the failure in place of the board, with retry and the way back', () => {
    const onRetry = vi.fn()
    const onBackToPicker = vi.fn()
    render({ puzzle: null, status: 'idle', failure, onRetry, onBackToPicker })
    expect(container.querySelector('[data-testid="star-grid"]')).toBeNull()
    const card = container.querySelector('[data-testid="star-failure"]') as HTMLElement
    expect(card.getAttribute('data-kind')).toBe('retryable')
    expect(card.getAttribute('data-reason')).toBe('resource-limit')
    expect(card.textContent).toContain('The board could not be printed')
    expect(card.textContent).toContain('The generation ran out of budget.')
    expect(card.querySelectorAll('.mg-star-failure__remedy')).toHaveLength(2)
    // The note under the actions names the toolbar as the real escape.
    expect(card.querySelector('.mg-star-failure__note')?.textContent).toContain('board size or difficulty')
    const buttons = card.querySelectorAll('button')
    expect(buttons).toHaveLength(2)
    click(buttons[0] as Element)
    expect(onRetry).toHaveBeenCalledTimes(1)
    click(buttons[1] as Element)
    expect(onBackToPicker).toHaveBeenCalledTimes(1)
  })

  it('hides retry for a deterministic failure but keeps the way back', () => {
    render({ puzzle: null, status: 'idle', failure: { ...failure, retryable: false } })
    const card = container.querySelector('[data-testid="star-failure"]') as HTMLElement
    expect(card.getAttribute('data-kind')).toBe('deterministic')
    const buttons = card.querySelectorAll('button')
    expect(buttons).toHaveLength(1)
    expect(buttons[0]?.textContent).toBe('All games')
  })

  it('keeps the size and difficulty controls reachable and live while the failure shows', () => {
    const onSizeChange = vi.fn()
    const onDifficultyChange = vi.fn()
    render({ puzzle: null, status: 'idle', failure, onSizeChange, onDifficultyChange })
    const twelve = container.querySelector<HTMLInputElement>("[data-testid='star-size'] input[value='12']")
    expect(twelve).not.toBeNull()
    expect(twelve?.disabled).toBe(false)
    act(() => {
      ;(twelve as HTMLInputElement).click()
    })
    expect(onSizeChange).toHaveBeenCalledWith(12)
    const steady = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='steady']",
    )
    expect(steady?.disabled).toBe(false)
    act(() => {
      ;(steady as HTMLInputElement).click()
    })
    expect(onDifficultyChange).toHaveBeenCalledWith('steady')
  })

  it('renders the failure card in Chinese under a Chinese locale', () => {
    render({ locale: 'zh', puzzle: null, status: 'idle', failure })
    const card = container.querySelector('[data-testid="star-failure"]') as HTMLElement
    expect(card.querySelector('.mg-star-failure__note')?.textContent).toContain('更改棋盘尺寸或难度')
    expect(card.querySelector('button')?.textContent).toBe('重试')
  })
})

describe('StarBattleSurface — no availability signal', () => {
  it('with no signal, every tier renders enabled — the behaviour before the signal existed', () => {
    render()
    const options = container.querySelectorAll<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[type='radio']",
    )
    expect(options.length).toBeGreaterThan(0)
    for (const option of Array.from(options)) {
      expect(option.disabled).toBe(false)
    }
    expect(
      container.querySelectorAll("[data-testid='star-difficulty'] .mg-seg__label[data-unavailable='true']"),
    ).toHaveLength(0)
    expect(container.querySelector('[data-testid="star-tier-note"]')).toBeNull()
  })
})

describe('StarBattleSurface — measured tier availability', () => {
  function availability(
    status: 'available' | 'unreliable' | 'unavailable' | 'unmeasured',
    samples: number,
    hits: number,
  ): { status: 'available' | 'unreliable' | 'unavailable' | 'unmeasured'; samples: number; hits: number } {
    return { status, samples, hits }
  }

  const ALL_MEASURED = (
    overrides: Partial<Record<(typeof STAR_DIFFICULTIES)[number], ReturnType<typeof availability>>>,
  ) => {
    return (_side: number, tier: (typeof STAR_DIFFICULTIES)[number]) =>
      overrides[tier] ?? availability('available', 48, 48)
  }

  it('an unavailable cell is not selectable, and the honest note carries the sample count — never a claim of impossibility', () => {
    const onDifficultyChange = vi.fn()
    render({
      difficulty: 'expert',
      tierAvailability: ALL_MEASURED({ expert: availability('unavailable', 1200, 0) }),
      onDifficultyChange,
    })
    const expert = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='expert']",
    )
    expect(expert?.disabled).toBe(true)
    expect(expert?.getAttribute('aria-label')).toContain('1200')
    const note = container.querySelector('[data-testid="star-tier-note"]')
    expect(note?.textContent).toContain('1200')
    expect(note?.textContent).toMatch(/no board/i)
    expect(note?.textContent).not.toMatch(/impossible/i)
    act(() => {
      ;(expert as HTMLInputElement).click()
    })
    expect(onDifficultyChange).not.toHaveBeenCalled()
    // An available neighbour stays selectable.
    const steady = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='steady']",
    )
    expect(steady?.disabled).toBe(false)
  })

  it('the honest note stays honest in Chinese: the count, and never 不可能', () => {
    render({
      locale: 'zh',
      difficulty: 'contradiction',
      tierAvailability: ALL_MEASURED({ contradiction: availability('unavailable', 276, 0) }),
    })
    const note = container.querySelector('[data-testid="star-tier-note"]')
    expect(note?.textContent).toContain('276')
    expect(note?.textContent).not.toContain('不可能')
  })

  it('an unreliable cell stays selectable but is marked with its thin evidence', () => {
    const onDifficultyChange = vi.fn()
    render({
      difficulty: 'starter',
      tierAvailability: ALL_MEASURED({ contradiction: availability('unreliable', 24, 2) }),
      onDifficultyChange,
    })
    // The live tier is an available one; the note belongs to the unreliable
    // cell's own label until it is chosen.
    expect(container.querySelector('[data-testid="star-tier-note"]')).toBeNull()
    const contradiction = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='contradiction']",
    )
    expect(contradiction?.disabled).toBe(false)
    expect(
      container
        .querySelector("[data-testid='star-difficulty'] .mg-seg__label[data-tier='contradiction']")
        ?.getAttribute('data-availability'),
    ).toBe('unreliable')
    expect(contradiction?.getAttribute('aria-label')).toContain('2')
    act(() => {
      ;(contradiction as HTMLInputElement).click()
    })
    expect(onDifficultyChange).toHaveBeenCalledWith('contradiction')
    // Once live, the thin evidence is said in words under the control.
    render({
      difficulty: 'contradiction',
      tierAvailability: ALL_MEASURED({ contradiction: availability('unreliable', 24, 2) }),
    })
    const note = container.querySelector('[data-testid="star-tier-note"]')
    expect(note?.textContent).toContain('2')
    expect(note?.textContent).toContain('24')
  })

  it('the availability function is asked at the current side, board or no board', () => {
    const seen: Array<[number, string]> = []
    render({
      side: 8,
      puzzle: null,
      status: 'idle',
      tierAvailability: (side, tier) => {
        seen.push([side, tier])
        return availability('available', 48, 48)
      },
    })
    // One call per pill, plus one for the live-tier note check.
    expect(seen.length).toBeGreaterThanOrEqual(STAR_DIFFICULTIES.length)
    for (const [side] of seen) {
      expect(side).toBe(8)
    }
  })

  it('an unmeasured cell behaves as if there were no signal: enabled, unmarked, no note', () => {
    render({ tierAvailability: () => availability('unmeasured', 0, 0) })
    const options = container.querySelectorAll<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[type='radio']",
    )
    for (const option of Array.from(options)) {
      expect(option.disabled).toBe(false)
    }
    expect(
      container.querySelectorAll("[data-testid='star-difficulty'] .mg-seg__label[data-availability]"),
    ).toHaveLength(0)
    expect(container.querySelector('[data-testid="star-tier-note"]')).toBeNull()
  })

  it('the unavailable pill is disabled even when every other cell reports available', () => {
    // A lone `unavailable` cell in an otherwise all-available report is
    // still a disabled pill: the measured signal is the only source.
    render({
      difficulty: 'starter',
      tierAvailability: ALL_MEASURED({ starter: availability('unavailable', 48, 0) }),
    })
    const starter = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='starter']",
    )
    expect(starter?.disabled).toBe(true)
  })
})

describe('StarBattleSurface — tier descriptions', () => {
  // Pinned verbatim, both locales: a return of the stale pre-re-tier wording
  // ("exactly one confinement technique", steady as a technique tier) fails
  // these strings, not a reviewer noticing.
  const EN: Record<(typeof STAR_DIFFICULTIES)[number], string> = {
    starter: 'The placement rules alone solve it; the chains are short.',
    steady: 'The placement rules alone solve it too, but the chains run long — routine work throughout.',
    challenging:
      'One idea beyond the rules finishes it — and not the free one: no single colour owns a whole row or column to hand you the line.',
    expert: 'Two ideas beyond the rules are needed; either one alone is not enough.',
    contradiction:
      'No set of ideas suffices on its own; the board yields only to a proof by contradiction.',
  }
  const ZH: Record<(typeof STAR_DIFFICULTIES)[number], string> = {
    starter: '只靠摆放规则就能解开，链条很短。',
    steady: '只靠摆放规则也能解开，只是链条很长——全程都是常规推理。',
    challenging: '需要规则之外的一个想法才能解开——但不是白送的那种：不会有颜色独占整行或整列，把答案直接交到你手上。',
    expert: '需要规则之外的两个想法，只有一个不够。',
    contradiction: '任何技巧组合单独都不够，只能靠反证法解开。',
  }

  it('states the live tier contract under the control, in English', () => {
    for (const tier of STAR_DIFFICULTIES) {
      render({ difficulty: tier })
      expect(container.querySelector('[data-testid="star-tier-description"]')?.textContent).toBe(
        EN[tier],
      )
    }
  })

  it('states the live tier contract under the control, in Chinese', () => {
    for (const tier of STAR_DIFFICULTIES) {
      render({ locale: 'zh', difficulty: tier })
      expect(container.querySelector('[data-testid="star-tier-description"]')?.textContent).toBe(
        ZH[tier],
      )
    }
  })

  it("steady is not described as a technique tier; challenging's one idea is never the whole-line freebie", () => {
    render({ difficulty: 'steady' })
    const steadyText = container.querySelector('[data-testid="star-tier-description"]')?.textContent ?? ''
    expect(steadyText).not.toMatch(/technique|confinement|idea/i)
    render({ difficulty: 'challenging' })
    const challengingText =
      container.querySelector('[data-testid="star-tier-description"]')?.textContent ?? ''
    expect(challengingText).not.toMatch(/confinement|c1|c2/)
    expect(challengingText).toContain('whole row or column')
  })

  it('no description implies the technique rotates board to board', () => {
    for (const tier of STAR_DIFFICULTIES) {
      render({ difficulty: tier })
      const text = container.querySelector('[data-testid="star-tier-description"]')?.textContent ?? ''
      expect(text).not.toMatch(/each board|every board|varies|different technique|每局|每盘|各不相同/i)
    }
  })

  it('with no signal the description still states the tier — the pre-signal behaviour plus the words', () => {
    render()
    expect(container.querySelector('[data-testid="star-tier-description"]')?.textContent).toBe(
      EN.starter,
    )
    expect(container.querySelector('[data-testid="star-tier-note"]')).toBeNull()
  })

  it('an unavailable live tier hides the description: the honest note alone is the truth there', () => {
    render({
      difficulty: 'challenging',
      tierAvailability: () => ({ status: 'unavailable', samples: 1200, hits: 0 }),
    })
    expect(container.querySelector('[data-testid="star-tier-description"]')).toBeNull()
    expect(container.querySelector('[data-testid="star-tier-note"]')?.textContent).toContain('1200')
  })

  it('an unreliable live tier keeps the description and adds the thin-evidence note', () => {
    render({
      difficulty: 'challenging',
      tierAvailability: () => ({ status: 'unreliable', samples: 48, hits: 2 }),
    })
    expect(container.querySelector('[data-testid="star-tier-description"]')?.textContent).toBe(
      EN.challenging,
    )
    expect(container.querySelector('[data-testid="star-tier-note"]')?.textContent).toContain('2')
  })
})

describe('StarBattleSurface — chrome', () => {
  it('shows the lives as pips, spent ones dimmed, with a spoken total', () => {
    render({ lives: 3, maxLives: 5 })
    const meter = container.querySelector('[data-testid="star-lives"]')
    expect(meter?.getAttribute('role')).toBe('img')
    expect(meter?.getAttribute('aria-label')).toBe('3 of 5 lives')
    const pips = meter?.querySelectorAll('.mg-star-pips__pip')
    expect(pips).toHaveLength(5)
    expect(pips?.[0]?.getAttribute('data-spent')).toBeNull()
    expect(pips?.[1]?.getAttribute('data-spent')).toBeNull()
    expect(pips?.[2]?.getAttribute('data-spent')).toBeNull()
    expect(pips?.[3]?.getAttribute('data-spent')).toBe('true')
    expect(pips?.[4]?.getAttribute('data-spent')).toBe('true')
  })

  it('shows mistakes and streak in the meter', () => {
    render({ mistakes: 2, streak: 7 })
    expect(container.querySelector('[data-testid="star-mistakes"]')?.textContent).toBe('2')
    expect(container.querySelector('[data-testid="star-streak"]')?.textContent).toBe('7')
  })

  it('changes difficulty through the segmented control', () => {
    const onDifficultyChange = vi.fn()
    render({ difficulty: 'starter', onDifficultyChange })
    expect(STAR_DIFFICULTIES).toEqual([
      'starter',
      'steady',
      'challenging',
      'expert',
      'contradiction',
    ])
    const option = container.querySelector<HTMLInputElement>("input[value='steady']")
    expect(option).not.toBeNull()
    act(() => {
      option?.click()
    })
    expect(onDifficultyChange).toHaveBeenCalledWith('steady')
  })

  it('renders every tier as a labelled option, including the two technique tiers', () => {
    render({ difficulty: 'expert' })
    const group = container.querySelector<HTMLElement>('[data-testid="star-difficulty"] .mg-seg')
    expect(group?.getAttribute('role')).toBe('radiogroup')
    // The group is named by a REAL VISIBLE label through aria-labelledby,
    // not by an invisible aria-label — the eye must read what the screen
    // reader hears.
    expect(group?.getAttribute('aria-labelledby')).toBe('mg-star-difficulty-label')
    expect(
      container.querySelector<HTMLElement>("[data-testid='star-difficulty'] .mg-field__label")?.textContent?.trim(),
    ).toBe('Difficulty')
    const options = container.querySelectorAll<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[type='radio']",
    )
    expect(Array.from(options).map((option) => option.value)).toEqual([
      'starter',
      'steady',
      'challenging',
      'expert',
      'contradiction',
    ])
    expect(
      Array.from(options).map((option) => option.closest('.mg-seg__item')?.textContent?.trim()),
    ).toEqual(['Starter', 'Steady', 'Challenging', 'Expert', 'Contradiction'])
    expect(
      container.querySelector<HTMLInputElement>("[data-testid='star-difficulty'] input:checked")
        ?.value,
    ).toBe('expert')
  })

  it('selecting the contradiction tier reports it, in Chinese labels too', () => {
    const onDifficultyChange = vi.fn()
    render({ locale: 'zh', onDifficultyChange })
    const group = container.querySelector<HTMLElement>('[data-testid="star-difficulty"] .mg-seg')
    expect(group?.getAttribute('aria-labelledby')).toBe('mg-star-difficulty-label')
    expect(
      container.querySelector<HTMLElement>("[data-testid='star-difficulty'] .mg-field__label")?.textContent?.trim(),
    ).toBe('难度')
    const labels = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid='star-difficulty'] .mg-seg__label"),
    ).map((label) => label.textContent?.trim())
    expect(labels).toEqual(['入门', '进阶', '挑战', '专家', '反证'])
    const contradiction = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='contradiction']",
    )
    expect(contradiction).not.toBeNull()
    act(() => {
      contradiction?.click()
    })
    expect(onDifficultyChange).toHaveBeenCalledWith('contradiction')
  })

  it('renders every size in the given range as a segmented option', () => {
    render({ minSide: 4, maxSide: 15 })
    const group = container.querySelector<HTMLElement>('[data-testid="star-size"] .mg-seg')
    expect(group?.getAttribute('role')).toBe('radiogroup')
    expect(group?.getAttribute('aria-labelledby')).toBe('mg-star-size-label')
    expect(
      container.querySelector<HTMLElement>("[data-testid='star-size'] .mg-field__label")?.textContent?.trim(),
    ).toBe('Board size')
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

  it('disables the size control while a board is printing, like difficulty', () => {
    render({ status: 'generating' })
    const options = container.querySelectorAll<HTMLInputElement>("[data-testid='star-size'] input[type='radio']")
    expect(options.length).toBeGreaterThan(0)
    for (const option of Array.from(options)) {
      expect(option.disabled).toBe(true)
    }
  })

  it('renders every starting-lives step in the given range, live max checked', () => {
    render({ minLives: 1, maxLives: 5, maxLivesCeiling: 9 })
    const group = container.querySelector<HTMLElement>('[data-testid="star-max-lives"] .mg-seg')
    expect(group?.getAttribute('role')).toBe('radiogroup')
    expect(group?.getAttribute('aria-labelledby')).toBe('mg-star-max-lives-label')
    expect(
      container.querySelector<HTMLElement>("[data-testid='star-max-lives'] .mg-field__label")?.textContent?.trim(),
    ).toBe('Starting lives')
    const options = container.querySelectorAll<HTMLInputElement>(
      "[data-testid='star-max-lives'] input[type='radio']",
    )
    expect(Array.from(options).map((option) => option.value)).toEqual([
      '1', '2', '3', '4', '5', '6', '7', '8', '9',
    ])
    expect(container.querySelector<HTMLInputElement>("[data-testid='star-max-lives'] input:checked")?.value).toBe(
      '5',
    )
  })

  it('calls onMaxLivesChange with the chosen starting lives', () => {
    const onMaxLivesChange = vi.fn()
    render({ onMaxLivesChange })
    const seven = container.querySelector<HTMLInputElement>("[data-testid='star-max-lives'] input[value='7']")
    expect(seven).not.toBeNull()
    act(() => {
      ;(seven as HTMLInputElement).click()
    })
    expect(onMaxLivesChange).toHaveBeenCalledTimes(1)
    expect(onMaxLivesChange).toHaveBeenCalledWith(7)
  })

  it('disables the starting-lives control while a board is printing', () => {
    render({ status: 'generating' })
    const options = container.querySelectorAll<HTMLInputElement>(
      "[data-testid='star-max-lives'] input[type='radio']",
    )
    expect(options.length).toBeGreaterThan(0)
    for (const option of Array.from(options)) {
      expect(option.disabled).toBe(true)
    }
  })

  it('labels the size and lives groups visibly and explains what they mean, in English', () => {
    render()
    for (const testId of ['star-size', 'star-max-lives']) {
      const group = container.querySelector<HTMLElement>(`[data-testid='${testId}'] .mg-seg`)
      expect(group?.getAttribute('aria-labelledby')).toBeTruthy()
      const label = container.querySelector<HTMLElement>(`[data-testid='${testId}'] .mg-field__label`)
      expect(label?.textContent?.trim()).not.toBe('')
      // The visible label is the one that names the group.
      expect(group?.getAttribute('aria-labelledby')).toBe(label?.id)
    }
    // Board size: what N means — an N × N grid carrying N stars.
    const sizeHint = container.querySelector<HTMLElement>("[data-testid='star-size'] .mg-field__hint")
    expect(sizeHint?.textContent).toContain('N × N')
    expect(sizeHint?.textContent).toContain('N stars')
    expect(
      container.querySelector('[data-testid="star-size"] .mg-seg')?.getAttribute('aria-describedby'),
    ).toBe(sizeHint?.id)
    // Lives: the cost asymmetry — a wrong star costs a life, a wrong empty does not.
    const livesHint = container.querySelector<HTMLElement>("[data-testid='star-max-lives'] .mg-field__hint")
    expect(livesHint?.textContent).toContain('costs one life')
    expect(livesHint?.textContent).toContain('costs nothing')
    expect(
      container.querySelector('[data-testid="star-max-lives"] .mg-seg')?.getAttribute('aria-describedby'),
    ).toBe(livesHint?.id)
  })

  it('labels the size and lives groups visibly and explains what they mean, in Chinese', () => {
    render({ locale: 'zh' })
    expect(container.querySelector<HTMLElement>("[data-testid='star-size'] .mg-field__label")?.textContent?.trim()).toBe(
      '棋盘尺寸',
    )
    expect(container.querySelector('[data-testid="star-size"] .mg-field__hint')?.textContent).toContain('N 颗星')
    expect(
      container.querySelector<HTMLElement>("[data-testid='star-max-lives'] .mg-field__label")?.textContent?.trim(),
    ).toBe('初始生命')
    const livesHint = container.querySelector<HTMLElement>("[data-testid='star-max-lives'] .mg-field__hint")
    expect(livesHint?.textContent).toContain('扣一条命')
    expect(livesHint?.textContent).toContain('不扣命')
  })

  it('cell keyboard roving still works with the toolbar controls present', () => {
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
})

describe('StarBattleSurface — the rules and legend block', () => {
  it('states the four rules, the mark legend, and the gestures above the board', () => {
    render()
    const rules = container.querySelector('[data-testid="star-rules"]')
    expect(rules?.getAttribute('aria-label')).toBe('How to play')
    const items = rules?.querySelectorAll('.mg-star-rules__rule')
    expect(items).toHaveLength(4)
    expect(items?.[0]?.textContent).toContain('row')
    expect(items?.[1]?.textContent).toContain('column')
    expect(items?.[2]?.textContent).toContain('colour')
    expect(items?.[3]?.textContent).toContain('touch')
    // The legend speaks the board's glyph vocabulary.
    expect(rules?.querySelector("[data-swatch='star']")?.textContent).toBe('★')
    expect(rules?.querySelector("[data-swatch='blank']")?.textContent).toBe('·')
    expect(rules?.querySelector("[data-swatch='locked']")?.textContent).toBe('★')
    // The gestures line teaches the flip: tap a star, hold a blank.
    expect(rules?.textContent).toContain('press and hold')
    expect(rules?.querySelector("[data-keys='true']")?.textContent).toContain('Space marks empty')
  })

  it('renders the rules block in Chinese', () => {
    render({ locale: 'zh' })
    const rules = container.querySelector('[data-testid="star-rules"]')
    expect(rules?.getAttribute('aria-label')).toBe('玩法')
    expect(rules?.textContent).toContain('每一行各放一颗星')
    expect(rules?.textContent).toContain('长按')
  })
})

describe('StarBattleSurface — locale', () => {
  it('renders Chinese copy when the locale says zh', () => {
    render({ locale: 'zh' })
    expect(container.querySelector('.mg-star-meter__label')?.textContent).toBe('生命')
    expect(container.querySelector('[data-testid="star-lives"]')?.getAttribute('aria-label')).toBe('生命 5/5')
    expect(grid().getAttribute('aria-label')).toContain('4 × 4')
    expect(
      container.querySelector<HTMLElement>("[data-testid='star-max-lives'] .mg-field__label")?.textContent?.trim(),
    ).toBe('初始生命')
    expect(container.querySelector('[data-testid="star-max-lives"] .mg-seg')?.getAttribute('aria-labelledby')).toBe(
      'mg-star-max-lives-label',
    )
  })
})
