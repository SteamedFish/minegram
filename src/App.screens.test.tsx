import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { DEFAULT_STAR_SIDE } from './domain/starBattle'
import { getCopy } from './ui/copy'
import { createGameStore, disposeGameStore, setGameStore } from './ui/gameStore'
import { getStarCopy, STAR_DIFFICULTIES, UNMEASURED_TIER_AVAILABILITY } from './ui/components/StarBattleSurface'
import {
  setStarBattleStore,
  type StarBattleSnapshot,
  type StarBattleStore,
} from './ui/starBattleStore'

/**
 * The multi-game shell's contract: the picker is the entry point on every
 * load, picking a game is the first act that can touch a store, the chrome on
 * each screen is deliberate (footer everywhere, minegram's panels only on
 * minegram, star battle's toolbar only on star battle), the surface renders in
 * every star battle state — a null puzzle states the empty case, a generation
 * failure shows its card under the toolbar so the controls stay reachable —
 * and a restored locale is honoured before any game is chosen.
 *
 * The Star Battle store is faked through `setStarBattleStore`, mirroring how
 * App.test.tsx installs its own game store: actions are spies, the snapshot is
 * a plain frozen object the test moves forward by hand. Plain DOM reads, no
 * testing library, createRoot inside act.
 */

const STAR_PUZZLE = {
  n: 2,
  seed: 7,
  colours: new Uint8Array([0, 1, 1, 0]),
  solution: [0, 1],
}

function starSnapshot(overrides: Partial<StarBattleSnapshot> = {}): StarBattleSnapshot {
  return Object.freeze({
    status: 'idle',
    puzzle: null,
    marks: new Uint8Array(0),
    lives: 5,
    maxLives: 5,
    mistakes: 0,
    streak: 0,
    difficulty: 'starter',
    side: DEFAULT_STAR_SIDE,
    failure: null,
    progress: null,
    // No measurement in these tests: every tier reads unmeasured, which is
    // the surface's no-signal behaviour.
    tierAvailability: Object.freeze(
      Object.fromEntries(STAR_DIFFICULTIES.map((tier) => [tier, UNMEASURED_TIER_AVAILABILITY])),
    ) as StarBattleSnapshot['tierAvailability'],
    version: 0,
    ...overrides,
  })
}

interface FakeStarStore {
  readonly store: StarBattleStore
  readonly actions: Record<keyof StarBattleStore['actions'], ReturnType<typeof vi.fn>>
  /** Moves the published snapshot forward and notifies subscribers, as a store would. */
  readonly advance: (snapshot: StarBattleSnapshot) => void
  readonly restore: () => void
}

function installStarStore(initial: StarBattleSnapshot): FakeStarStore {
  let current = initial
  let listener: (() => void) | null = null
  const actions = {
    setDifficulty: vi.fn(),
    setSide: vi.fn(),
    setMaxLives: vi.fn(),
    startNewRound: vi.fn(),
    nextRound: vi.fn(),
    retry: vi.fn(),
    onMark: vi.fn(),
    backToPicker: vi.fn(),
  }
  const store: StarBattleStore = {
    getSnapshot: () => current,
    subscribe: (next) => {
      listener = next
      return () => {
        listener = null
      }
    },
    actions: actions as unknown as StarBattleStore['actions'],
    dispose: vi.fn(),
  }
  const restore = setStarBattleStore(store)
  return {
    store,
    actions,
    advance: (snapshot) => {
      current = snapshot
      act(() => {
        listener?.()
      })
    },
    restore,
  }
}

let container: HTMLElement
let unmount: (() => void) | null = null
let fake: FakeStarStore | null = null

function render(node: ReactNode): void {
  const root = createRoot(container)
  act(() => {
    root.render(node)
  })
  unmount = () => {
    act(() => {
      root.unmount()
    })
  }
}

function one(selector: string): Element {
  const found = container.querySelectorAll(selector)
  expect(found.length).toBeGreaterThan(0)
  return found[0] as Element
}

function click(node: Element): void {
  act(() => {
    node.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }))
  })
}

function pickerCard(id: string): HTMLElement {
  return one(`[data-game='${id}']`) as HTMLElement
}

/** A pointer event built on MouseEvent, as StarBattleSurface.test.tsx does. */
function firePointer(target: Element, type: string, opts: { button?: number } = {}): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: opts.button ?? 0,
  })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  act(() => {
    target.dispatchEvent(event)
  })
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  setGameStore(createGameStore())
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  fake?.restore()
  fake = null
  disposeGameStore()
  window.localStorage.clear()
  if (unmount !== null) {
    unmount()
    unmount = null
  }
  container.remove()
})

describe('App screens — the picker is the door', () => {
  it('opens on the picker every load, with both games and no board behind them', () => {
    fake = installStarStore(starSnapshot())
    render(<App />)
    expect(one('[data-testid="game-picker"]')).toBeTruthy()
    expect(pickerCard('minegram')).toBeTruthy()
    expect(pickerCard('starbattle')).toBeTruthy()
    // Neither game is on screen: no minegram stage, no star grid.
    expect(container.querySelector('.mg-board-stage')).toBeNull()
    expect(container.querySelector('[data-testid="star-grid"]')).toBeNull()
  })

  it('fires no store action on mount, before any game is picked', () => {
    fake = installStarStore(starSnapshot())
    render(<App />)
    expect(fake.actions.startNewRound).not.toHaveBeenCalled()
    expect(fake.actions.nextRound).not.toHaveBeenCalled()
    expect(fake.actions.onMark).not.toHaveBeenCalled()
    expect(fake.actions.setDifficulty).not.toHaveBeenCalled()
    expect(fake.actions.retry).not.toHaveBeenCalled()
    // The minegram store is untouched too: still no board, still idle.
    expect(container.querySelector('.mg-board-stage')).toBeNull()
  })

  it('keeps locale and theme reachable on the picker', () => {
    fake = installStarStore(starSnapshot())
    render(<App />)
    const footer = one('.mg-footer')
    // The two preference selects and the source link are the footer's whole job.
    expect(footer.querySelectorAll('.mg-footer__select')).toHaveLength(2)
    expect(footer.querySelector('.mg-footer__source')).toBeTruthy()
  })

  it('applies a restored Chinese preference before any game is chosen', () => {
    window.localStorage.setItem('minegram.lang', 'zh-CN')
    fake = installStarStore(starSnapshot())
    render(<App />)
    expect(one('.mg-picker__title').textContent).toBe('选择游戏')
    // The footer's own strings are Chinese too, not English in a Chinese tree.
    expect(one('.mg-footer').textContent).toContain('语言')
  })
})

describe('App screens — picker to minegram and back', () => {
  it('switches to the minegram screen and back without touching the star store', () => {
    fake = installStarStore(starSnapshot())
    render(<App />)
    click(pickerCard('minegram'))
    // Minegram's chrome arrives wholesale: banner, panels, board region.
    expect(one('.mg-app')).toBeTruthy()
    expect(one('.mg-banner')).toBeTruthy()
    expect(one('.mg-main')).toBeTruthy()
    expect(container.querySelector('[data-testid="game-picker"]')).toBeNull()
    // The way back is the slim games bar; it is not a store act.
    const back = one('[data-testid="gamesbar-back"]')
    expect(back.textContent).toBe('All games')
    click(back)
    expect(one('[data-testid="game-picker"]')).toBeTruthy()
    expect(container.querySelector('.mg-app')).toBeNull()
    expect(fake.actions.startNewRound).not.toHaveBeenCalled()
  })

  it('shows the games-bar back in Chinese under a Chinese locale', () => {
    window.localStorage.setItem('minegram.lang', 'zh-CN')
    fake = installStarStore(starSnapshot())
    render(<App />)
    click(pickerCard('minegram'))
    expect(one('[data-testid="gamesbar-back"]').textContent).toBe('全部游戏')
  })
})

describe('App screens — picker to star battle and back', () => {
  it('starts a round on the pick and shows the generating state, not a board', () => {
    fake = installStarStore(starSnapshot({ status: 'generating' }))
    render(<App />)
    click(pickerCard('starbattle'))
    expect(fake.actions.startNewRound).toHaveBeenCalledTimes(1)
    // The surface is never rendered without a certified puzzle.
    expect(container.querySelector('[data-testid="star-grid"]')).toBeNull()
    expect(one('[data-testid="star-empty"]').textContent).toContain('Printing the board')
    // Minegram's chrome is nowhere on this screen.
    expect(container.querySelector('.mg-app')).toBeNull()
    expect(container.querySelector('.mg-banner')).toBeNull()
  })

  it('wires the store’s generation progress through to the surface, not just the type', () => {
    // The surface's progress prop is OPTIONAL, so a missing pass-through in App
    // compiles cleanly and simply never renders. That is exactly the shape of
    // bug a type cannot catch, so it is pinned here on the rendered result.
    fake = installStarStore(
      starSnapshot({ status: 'generating', progress: { candidates: 128, accepted: 3, phase: 'repairing' } }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    const bar = one('[data-testid="star-progress"]')
    expect(bar.getAttribute('data-phase')).toBe('repairing')
    expect(bar.textContent).toContain('128')
  })

  it('renders the surface once a certified puzzle arrives, and passes marks through', () => {
    fake = installStarStore(starSnapshot())
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({
        status: 'playing',
        puzzle: STAR_PUZZLE,
        marks: new Uint8Array([2, 0, 0, 0]),
        lives: 5,
        maxLives: 5,
        mistakes: 1,
        streak: 2,
      }),
    )
    expect(container.querySelectorAll('[data-testid="star-cell"]')).toHaveLength(4)
    expect(one('[data-testid="star-lives"]').getAttribute('aria-label')).toBe('5 of 5 lives')
    expect(one('[data-testid="star-mistakes"]').textContent).toBe('1')
    expect(one('[data-testid="star-streak"]').textContent).toBe('2')
    // A tap reaches the store with its coordinates — a tap toggles a star…
    const cell = container.querySelector("[data-cell-index='1']") as HTMLElement
    firePointer(cell, 'pointerdown')
    firePointer(cell, 'pointerup')
    expect(fake.actions.onMark).toHaveBeenCalledWith(0, 1, 'star')
    // …and `null` — the real retract — passes through untouched. The starred
    // cell (index 0) is the one with something to retract.
    const starred = container.querySelector("[data-cell-index='0']") as HTMLElement
    act(() => {
      starred.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true }))
    })
    expect(fake.actions.onMark).toHaveBeenLastCalledWith(0, 0, null)
    // The banner accelerator and the difficulty seam are the store's actions.
    fake.advance(starSnapshot({ status: 'won', puzzle: STAR_PUZZLE, lives: 4 }))
    click(one('[data-testid="star-banner"] button'))
    expect(fake.actions.nextRound).toHaveBeenCalledTimes(1)
  })

  it('back to the picker is the store\'s backToPicker, and the picker returns', () => {
    fake = installStarStore(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    // One back affordance on the playing screen: the shared games bar. The
    // surface's own toolbar no longer carries one.
    expect(container.querySelector('.mg-star-toolbar__back')).toBeNull()
    click(one('[data-testid="gamesbar-back"]'))
    expect(fake.actions.backToPicker).toHaveBeenCalledTimes(1)
    expect(one('[data-testid="game-picker"]')).toBeTruthy()
  })

  it('renders the size selector across the sanctioned domain range', () => {
    fake = installStarStore(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    const options = container.querySelectorAll<HTMLInputElement>(
      "[data-testid='star-size'] input[type='radio']",
    )
    // The range comes from the domain constants the app passes down — 4..10
    // today — never from literals restated here.
    expect(Array.from(options).map((option) => option.value)).toEqual([
      '4', '5', '6', '7', '8', '9', '10',
    ])
  })

  it('choosing a size reaches the store as setSide with the chosen n', () => {
    fake = installStarStore(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    const ten = container.querySelector<HTMLInputElement>(
      "[data-testid='star-size'] input[value='10']",
    )
    expect(ten).not.toBeNull()
    act(() => {
      ;(ten as HTMLInputElement).click()
    })
    expect(fake.actions.setSide).toHaveBeenCalledTimes(1)
    expect(fake.actions.setSide).toHaveBeenCalledWith(10)
  })

  it('choosing starting lives reaches the store as setMaxLives with the chosen n', () => {
    fake = installStarStore(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    const seven = container.querySelector<HTMLInputElement>(
      "[data-testid='star-max-lives'] input[value='7']",
    )
    expect(seven).not.toBeNull()
    act(() => {
      ;(seven as HTMLInputElement).click()
    })
    expect(fake.actions.setMaxLives).toHaveBeenCalledTimes(1)
    expect(fake.actions.setMaxLives).toHaveBeenCalledWith(7)
  })

  it('the games bar names the game, on both game screens, from the picker dictionary', () => {
    fake = installStarStore(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    // One bar above the shell: the way back, and the game's own name.
    expect(container.querySelectorAll('.mg-gamesbar__name')).toHaveLength(1)
    expect(one('.mg-gamesbar__name').textContent).toBe('Star Battle')
    expect(one('.mg-gamesbar').getAttribute('data-screen')).toBe('starbattle')
    click(one('[data-testid="gamesbar-back"]'))
    click(pickerCard('minegram'))
    expect(one('.mg-gamesbar__name').textContent).toBe('Minegram')
    expect(one('.mg-gamesbar').getAttribute('data-screen')).toBe('minegram')
  })

  it('names the game in Chinese too, on both screens', () => {
    window.localStorage.setItem('minegram.lang', 'zh-CN')
    fake = installStarStore(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    fake.advance(
      starSnapshot({ status: 'playing', puzzle: STAR_PUZZLE, marks: new Uint8Array(4) }),
    )
    expect(one('.mg-gamesbar__name').textContent).toBe('星战')
    expect(one('[data-testid="gamesbar-back"]').textContent).toBe('全部游戏')
    click(one('[data-testid="gamesbar-back"]'))
    click(pickerCard('minegram'))
    expect(one('.mg-gamesbar__name').textContent).toBe('Minegram')
    expect(one('[data-testid="gamesbar-back"]').textContent).toBe('全部游戏')
  })

  it('surfaces a generation failure with the toolbar still reachable — the report of the dead end', () => {
    fake = installStarStore(
      starSnapshot({
        status: 'idle',
        failure: { reason: 'resource-limit', message: 'out of budget', details: {} },
      }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    const card = one('[data-testid="star-failure"]')
    expect(card.getAttribute('data-reason')).toBe('resource-limit')
    const t = getCopy('en')
    expect(card.textContent).toContain(t.failure.reasons['resource-limit'].headline)
    // Retry is the store's retry, labelled from the surface's own dictionary;
    // the way back is offered too.
    const starCopy = getStarCopy('en')
    const retry = card.querySelector('button')
    expect(retry?.textContent).toBe(starCopy.failure.retry)
    click(retry as Element)
    expect(fake.actions.retry).toHaveBeenCalledTimes(1)
    const buttons = card.querySelectorAll('button')
    click(buttons[buttons.length - 1] as Element)
    expect(fake.actions.backToPicker).toHaveBeenCalledTimes(1)
    expect(one('[data-testid="game-picker"]')).toBeTruthy()
  })

  it('a failed board is never a dead end: size and difficulty change straight from the failure state', () => {
    fake = installStarStore(
      starSnapshot({
        status: 'idle',
        failure: { reason: 'resource-limit', message: 'out of budget', details: {} },
      }),
    )
    render(<App />)
    click(pickerCard('starbattle'))
    // The failure card and the surface's toolbar are on screen TOGETHER: the
    // card no longer replaces the controls, which was the player's dead end.
    const card = one('[data-testid="star-failure"]')
    expect(card.textContent).toContain(getStarCopy('en').failure.changeNote)
    const ten = container.querySelector<HTMLInputElement>(
      "[data-testid='star-size'] input[value='10']",
    )
    expect(ten).not.toBeNull()
    expect(ten?.disabled).toBe(false)
    act(() => {
      ;(ten as HTMLInputElement).click()
    })
    expect(fake.actions.setSide).toHaveBeenCalledWith(10)
    const steady = container.querySelector<HTMLInputElement>(
      "[data-testid='star-difficulty'] input[value='steady']",
    )
    expect(steady).not.toBeNull()
    expect(steady?.disabled).toBe(false)
    act(() => {
      ;(steady as HTMLInputElement).click()
    })
    expect(fake.actions.setDifficulty).toHaveBeenCalledWith('steady')
  })
})
