import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GamePicker, type GamePickerProps } from './GamePicker'

/**
 * The front door's contract: both games as peers, the choice is a button
 * press, `selected` is reflected, and the stats area looks deliberate when
 * there is nothing to show. Plain DOM reads, following the repo's convention
 * (createRoot inside act, no testing-library).
 */

let container: HTMLElement
let root: Root | null = null

function render(props: Partial<GamePickerProps> = {}): { onSelect: ReturnType<typeof vi.fn> } {
  const onSelect = vi.fn()
  const full: GamePickerProps = {
    locale: 'en',
    selected: null,
    onSelect,
    ...props,
  }
  root = createRoot(container)
  act(() => {
    root?.render(<GamePicker {...full} />)
  })
  return { onSelect }
}

function card(id: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`[data-game='${id}']`)
  expect(found).not.toBeNull()
  return found as HTMLButtonElement
}

function click(node: Element): void {
  act(() => {
    node.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
  })
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
  container.remove()
})

describe('GamePicker', () => {
  it('renders both games as peer cards', () => {
    render()
    const minegram = card('minegram')
    const starbattle = card('starbattle')
    expect(minegram.textContent).toContain('Minegram')
    expect(starbattle.textContent).toContain('Star Battle')
    // Each card says what the game is, in one sentence.
    expect(minegram.textContent).toContain('mines')
    expect(starbattle.textContent).toContain('star')
    expect(container.querySelectorAll('.mg-picker__card')).toHaveLength(2)
  })

  it('fires onSelect with the game id when a card is chosen', () => {
    const { onSelect } = render()
    click(card('starbattle'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith('starbattle')
    click(card('minegram'))
    expect(onSelect).toHaveBeenCalledWith('minegram')
  })

  it('reflects the selected game with aria-pressed and data-selected', () => {
    render({ selected: 'starbattle' })
    expect(card('starbattle').getAttribute('aria-pressed')).toBe('true')
    expect(card('starbattle').getAttribute('data-selected')).toBe('true')
    expect(card('minegram').getAttribute('aria-pressed')).toBe('false')
    expect(card('minegram').getAttribute('data-selected')).toBeNull()
  })

  it('survives absent stats with an unplayed line', () => {
    render()
    const stats = container.querySelectorAll("[data-empty='true']")
    expect(stats).toHaveLength(2)
    expect(stats[0]?.textContent).toBe('Not played yet')
  })

  it('treats all-zero stats like no stats', () => {
    render({
      stats: {
        minegram: { roundsPlayed: 0, bestStreak: 0 },
        starbattle: { roundsPlayed: 0, bestStreak: 0 },
      },
    })
    expect(container.querySelectorAll("[data-empty='true']")).toHaveLength(2)
  })

  it('shows rounds and best streak when there is a record', () => {
    render({
      stats: {
        minegram: { roundsPlayed: 12, bestStreak: 4 },
        starbattle: { roundsPlayed: 3, bestStreak: 0 },
      },
    })
    const minegram = card('minegram')
    expect(minegram.textContent).toContain('12 rounds played')
    expect(minegram.textContent).toContain('Best streak 4')
    // A zero streak is not a record; the starbattle card omits that line.
    const starbattle = card('starbattle')
    expect(starbattle.textContent).toContain('3 rounds played')
    expect(starbattle.textContent).not.toContain('Best streak')
  })

  it('renders both locales', () => {
    render({ locale: 'zh' })
    expect(container.querySelector('.mg-picker__title')?.textContent).toBe('选择游戏')
    expect(card('minegram').textContent).toContain('地雷')
    expect(card('starbattle').textContent).toContain('星')
    expect(container.querySelector("[data-empty='true']")?.textContent).toBe('还没玩过')
  })
})
