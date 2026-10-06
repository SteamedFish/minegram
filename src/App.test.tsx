import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { App } from './App'
import { getCopy, interpolate } from './ui/copy'
import {
  createInitialGameState,
  gameReducer,
  type GeneratedRound,
  type GameState,
} from './application/gameReducer'
import { derivePuzzleClues } from './domain/puzzle'
import type { BinaryMineBoard } from './domain/board'
import { normalizeGenerationSettings } from './engine/generator/settings'
import {
  createGameStore,
  disposeGameStore,
  setGameStore,
  type GameStore,
  type GameStoreOptions,
} from './ui/gameStore'
import type { GenerationWorkerFactory, GenerationWorkerHandlers } from './application/generationClient'

/**
 * The app suite.
 *
 * `@testing-library/react` is deliberately not used. Every assertion here is about the
 * rendered *contract* — landmark roles, `data-state` values, the three live regions,
 * the absence of a solution board and of a derived seed — and those are plain DOM
 * reads. The suite therefore mounts through `createRoot` inside `act`, which also
 * proves the app itself needs nothing from a test library to be driven.
 *
 * Each test installs its own store through `setGameStore` and disposes it, so no test
 * can inherit another's generation, locale or worker.
 */

const FIXTURE_SEED = 'fixture-seed'
const FIXTURE_SETTINGS = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  seed: FIXTURE_SEED,
  difficulty: 'starter',
  maxAttempts: 3,
})

const CELL_STATES = new Set([
  'unmarked',
  'mine',
  'mine-locked',
  'blank',
  'blank-locked',
  'wrong-mine',
  'wrong-blank',
  'revealed',
])

let container: HTMLElement
let unmount: (() => void) | null = null

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
  // The app opens on the game picker on every load (that is the product
  // contract); this suite owns the minegram screen, so every render steps
  // through the picker into it before the assertions run.
  const minegram = container.querySelector<HTMLElement>("[data-game='minegram']")
  if (minegram !== null) {
    act(() => {
      minegram.click()
    })
  }
}

function install(state: GameState, options: GameStoreOptions = {}): GameStore {
  const store = createGameStore({ initialState: state, ...options })
  setGameStore(store)
  return store
}

/**
 * A worker that answers every request with a round built for the settings it was
 * asked for.
 *
 * jsdom has no `Worker`, so without this a generation ends in `worker-unavailable` and
 * the reducer reverts the settings — which is correct behaviour, but it would hide
 * whether a *successful* new seed reaches the panel. Echoing the requested settings
 * back matters: the reducer rejects a round whose settings are not the ones it asked
 * for, so a fixed round would fail for the wrong reason. The reply is deferred by one
 * microtask so the client has finished its own bookkeeping first, as a real worker would.
 */
function succeedingWorker(): GenerationWorkerFactory {
  return () => {
    let handlers: GenerationWorkerHandlers | null = null
    return {
      postMessage(message) {
        if (message.type !== 'generation/request') {
          return
        }
        const { generationId, requestId, settings } = message
        const dimensions = { rows: settings.rows, columns: settings.columns }
        const board = Array.from({ length: settings.rows * settings.columns }, (_, i) =>
          i % 2 === 0 ? 1 : 0,
        ) as BinaryMineBoard
        queueMicrotask(() => {
          handlers?.message({
            data: {
              type: 'generation/succeeded',
              requestId,
              generationId,
              round: { settings, board, puzzle: { dimensions, clues: derivePuzzleClues(board, dimensions) } },
            },
          } as MessageEvent<unknown>)
        })
      },
      terminate() {
        handlers = null
      },
      setHandlers(next) {
        handlers = next
      },
    }
  }
}

function all(selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector))
}

function one(selector: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(selector)
  if (found === null) {
    throw new Error(`expected one ${selector}, found none`)
  }
  return found
}

function click(target: Element | null): void {
  if (target === null) {
    throw new Error('click: no target')
  }
  act(() => {
    ;(target as HTMLElement).click()
  })
}

function selectValue(target: Element | null, value: string): void {
  if (target === null) {
    throw new Error('selectValue: no target')
  }
  const node = target as HTMLSelectElement
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
    setter?.call(node, value)
    node.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

/**
 * The *live* value of a controlled input. `getAttribute('value')` only sees what
 * React wrote at mount, so a field re-rendered by a state update has to be read as a
 * property or the test would keep asserting the pre-update text.
 */
function fieldValue(selector: string): string {
  const node = one(selector) as HTMLInputElement
  const getter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.get
  return getter?.call(node) ?? node.value
}

/** `idle → generating → playing`, driven through the real reducer. */
function playingState(): GameState {
  const start = gameReducer(baseState(), { type: 'generation/start' })
  if (start.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${start.type}`)
  }
  const succeeded = gameReducer(start.state, {
    type: 'generation/succeeded',
    generationId: start.state.generationId,
    round: fixtureRound(),
  })
  if (succeeded.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${succeeded.type}`)
  }
  return succeeded.state
}

function failedState(reason: string, from: GameState): GameState {
  const start = gameReducer(from, { type: 'generation/start' })
  if (start.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${start.type}`)
  }
  const failed = gameReducer(start.state, {
    type: 'generation/failed',
    generationId: start.state.generationId,
    failure: { reason, message: 'the generator could not prove a unique solution', details: {} },
  })
  if (failed.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${failed.type}`)
  }
  return failed.state
}

function baseState(): GameState {
  return createInitialGameState({ settings: FIXTURE_SETTINGS, initialScore: 5 })
}

/** `playing` with every cell marked correctly: the win banner surface. */
function wonState(): GameState {
  const marked = gameReducer(playingState(), {
    type: 'round/markBatch',
    cells: [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
      { index: 3, assertion: 'mine' },
    ],
  })
  if (marked.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${marked.type}`)
  }
  return marked.state
}

/** A one-point round with one wrong mark: the loss banner surface. */
function lostState(): GameState {
  const start = gameReducer(
    createInitialGameState({ settings: FIXTURE_SETTINGS, initialScore: 1 }),
    { type: 'generation/start' },
  )
  if (start.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${start.type}`)
  }
  const succeeded = gameReducer(start.state, {
    type: 'generation/succeeded',
    generationId: start.state.generationId,
    round: fixtureRound(),
  })
  if (succeeded.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${succeeded.type}`)
  }
  const marked = gameReducer(succeeded.state, {
    type: 'round/markBatch',
    cells: [{ index: 0, assertion: 'blank' }],
  })
  if (marked.type !== 'transition') {
    throw new Error(`fixture: expected a transition, got ${marked.type}`)
  }
  return marked.state
}

function fixtureRound(): GeneratedRound {
  const board = [1, 0, 0, 1] as const
  const dimensions = { rows: 2, columns: 2 } as const
  return {
    settings: FIXTURE_SETTINGS,
    board,
    puzzle: { dimensions, clues: derivePuzzleClues(board, dimensions) },
  }
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('lang')
  container = document.createElement('div')
  document.body.append(container)
})

afterEach(() => {
  unmount?.()
  unmount = null
  container.remove()
  disposeGameStore()
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('lang')
})

describe('App landmarks and live regions', () => {
  it('renders the wordmark as the page’s only h1 and drops the Phase 0 shell', () => {
    install(baseState())
    render(<App />)

    expect(all('h1')).toHaveLength(1)
    expect(one('h1').textContent).toBe('MINEGRAM')
    expect(container.querySelector('.app-shell')).toBeNull()
    expect(container.textContent).not.toContain('Project foundation is ready')
  })

  it('lays the four regions out in reading order', () => {
    install(baseState())
    render(<App />)

    const regions = Array.from(one('.mg-app').children)
    expect(regions.map((node) => node.tagName.toLowerCase())).toEqual([
      'header',
      'aside',
      'main',
      'aside',
      'footer',
    ])
  })

  it('exposes exactly one polite status region and no alert while idle', () => {
    install(baseState())
    render(<App />)

    const polite = all('[role="status"]')
    expect(polite).toHaveLength(1)
    expect(polite[0].getAttribute('aria-live')).toBe('polite')
    expect(polite[0].getAttribute('aria-atomic')).toBe('true')
    expect(all('[role="alert"]')).toHaveLength(0)
    expect(all('[aria-live="polite"]')).toHaveLength(1)
  })

  it('never puts aria-live on the board', () => {
    install(playingState())
    render(<App />)

    const grid = one('[role="grid"]')
    expect(grid.closest('[aria-live]')).toBeNull()
    expect(grid.closest('[role="status"]')).toBeNull()
  })
})

describe('App board contract', () => {
  it('renders one grid whose rails and cells carry the specified roles', () => {
    install(playingState())
    render(<App />)

    const grid = one('[role="grid"]')
    // The rail and the corner are part of the grid, so both counts are one higher
    // than the puzzle dimensions.
    expect(grid.getAttribute('aria-rowcount')).toBe('3')
    expect(grid.getAttribute('aria-colcount')).toBe('3')
    // `aria-readonly` is omitted while the round is playable; ARIA's default is false.
    expect(grid.getAttribute('aria-readonly')).toBeNull()

    const corner = one('.mg-board-stage [role="presentation"]')
    expect(corner.getAttribute('aria-hidden')).toBe('true')

    expect(all('[role="rowheader"]').length).toBeGreaterThan(0)
    expect(all('[role="columnheader"]').length).toBeGreaterThan(0)
    for (const rail of all('[role="rowheader"], [role="columnheader"]')) {
      expect(rail.getAttribute('tabindex')).toBeNull()
      expect(rail.getAttribute('aria-label')).not.toBe('')
    }

    const cells = all('[role="gridcell"]')
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      expect(cell.getAttribute('aria-label')).not.toBe('')
      // No `aria-selected`: the board is a grid of toggle buttons, not a
      // selection set, so claiming "not selected" on all 225 cells was noise
      // for a screen reader on every single cell.
      expect(cell.hasAttribute('aria-selected')).toBe(false)
    }
  })

  it('gives every cell one of the eight contract states and no unknown preview value', () => {
    install(playingState())
    render(<App />)

    for (const cell of all('.mg-cell')) {
      const state = cell.getAttribute('data-state')
      expect(state).not.toBeNull()
      expect(CELL_STATES.has(state as string)).toBe(true)
      const preview = cell.getAttribute('data-preview')
      if (preview !== null) {
        expect(['hit', 'risk']).toContain(preview)
      }
      // §8.5: an unmarked cell's attributes must not leak a truth-derived value.
      if (cell.getAttribute('data-mark') === 'unknown') {
        expect(cell.getAttribute('data-correct')).toBe('unknown')
      }
    }
  })

  it('keeps exactly one cell in the tab order', () => {
    install(playingState())
    render(<App />)

    const tabbable = all('.mg-cell[tabindex="0"]')
    expect(tabbable).toHaveLength(1)
    expect(all('.mg-cell[tabindex="-1"]')).toHaveLength(3)
  })

  it('marks the board read-only and inert when the round is not playing', () => {
    install(failedState('infeasible', playingState()))
    render(<App />)

    const stage = one('.mg-board-stage')
    expect(stage.getAttribute('aria-readonly')).toBe('true')
    expect(stage.getAttribute('data-inert')).toBe('true')
    expect(stage.getAttribute('data-finger-marking')).toMatch(/^(on|off)$/)
  })

  it('never puts the solution board or a derived seed into the DOM', () => {
    const store = install(playingState())
    render(<App />)
    act(() => {
      store.actions.nextRound()
    })
    const html = container.innerHTML
    // The fixture board is [1,0,0,1]; a leaked board would show as a row of booleans
    // or as the boolean 1/0 pair anywhere in the markup.
    expect(html).not.toMatch(/\[(?:1|0)(?:,(?:1|0))+\]/)
    expect(container.textContent).not.toContain('round:')
  })
})

describe('App failure surface', () => {
  it('shows the alert and a resume offer only when the failure kept a board', () => {
    install(failedState('worker-error', playingState()))
    render(<App />)

    const alert = all('[role="alert"]')
    expect(alert).toHaveLength(1)
    expect(alert[0].getAttribute('aria-atomic')).toBe('true')
    expect(one('.mg-round-banner').getAttribute('data-round-state')).toBe('resume')
  })

  it('offers no resume when the failure had no board to keep', () => {
    install(failedState('worker-error', baseState()))
    render(<App />)

    expect(all('[role="alert"]')).toHaveLength(1)
    expect(one('.mg-round-banner').getAttribute('data-round-state')).toBe('none')
  })

  it('gives a deterministic failure no retry action but keeps the seed change', () => {
    install(failedState('infeasible', baseState()))
    render(<App />)

    const report = one('.mg-failure')
    const labels = Array.from(report.querySelectorAll('button')).map((button) => button.textContent)
    expect(labels).not.toContain('Retry the same settings')
    expect(labels.some((label) => label !== null && label.includes('seed'))).toBe(true)
  })

  it('re-opens a hidden settings panel from the failure report and moves focus to it', async () => {
    install(failedState('worker-error', baseState()))
    render(<App />)

    // Collapse the panel first, so the button has something to undo.
    const aside = one('.mg-side--left')
    click(one('.mg-banner button[aria-controls="mg-settings-panel"]'))
    expect(aside.hasAttribute('hidden')).toBe(true)

    click(one('.mg-failure button[aria-controls="mg-settings"]'))
    expect(aside.hasAttribute('hidden')).toBe(false)

    // The handoff runs in a rAF after the commit that un-hides the aside.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    })
    expect(document.activeElement).toBe(one('#mg-settings'))
  })
})

describe('App chrome', () => {
  it('shows the authored seed and nothing else', () => {
    install(playingState())
    render(<App />)

    const chip = one('.mg-footer__seed')
    expect(chip.getAttribute('data-seed')).toBe('authored')
    expect(chip.textContent).toContain(FIXTURE_SEED)
  })

  it('persists the theme and drives html[data-theme]', () => {
    install(baseState())
    render(<App />)

    const selects = all('.mg-footer__select')
    selectValue(selects[1] ?? null, 'dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.localStorage.getItem('minegram.theme')).toBe('dark')

    selectValue(selects[1] ?? null, 'auto')
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })

  it('switches the whole page to Simplified Chinese', () => {
    install(baseState())
    render(<App />)

    selectValue(all('.mg-footer__select')[0] ?? null, 'zh-CN')
    expect(document.documentElement.getAttribute('lang')).toBe('zh-CN')
    expect(window.localStorage.getItem('minegram.lang')).toBe('zh-CN')
    expect(container.textContent).toContain('就绪')
    expect(container.textContent).not.toContain('Printing round')
  })

  it('hides the settings panel from the banner toggle, shows it again, and remembers both', () => {
    install(baseState())
    render(<App />)

    const aside = one('.mg-side--left')
    const app = one('.mg-app')
    const toggle = one('.mg-banner button[aria-controls="mg-settings-panel"]')
    // Shown by default: the disclosure is expanded and the aside is on the page.
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(aside.hasAttribute('hidden')).toBe(false)

    click(toggle)
    // Hidden for real: the aside leaves the page, the grid claim follows, and the
    // choice is stored, so a reload restores the same chrome.
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    expect(aside.hasAttribute('hidden')).toBe(true)
    expect(app.getAttribute('data-left-panel')).toBe('hidden')
    expect(window.localStorage.getItem('minegram.panel.settings')).toBe('false')

    click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(aside.hasAttribute('hidden')).toBe(false)
    expect(app.getAttribute('data-left-panel')).toBe('shown')
    expect(window.localStorage.getItem('minegram.panel.settings')).toBe('true')
  })

  it('hides the legend panel from its own banner toggle, independently of settings', () => {
    install(baseState())
    render(<App />)

    const legend = one('.mg-side--right')
    const settings = one('.mg-side--left')
    const toggle = one('.mg-banner button[aria-controls="mg-legend-panel"]')
    expect(toggle.getAttribute('aria-expanded')).toBe('true')

    click(toggle)
    expect(legend.hasAttribute('hidden')).toBe(true)
    expect(one('.mg-app').getAttribute('data-right-panel')).toBe('hidden')
    expect(window.localStorage.getItem('minegram.panel.legend')).toBe('false')
    // The settings panel is untouched: each disclosure owns exactly one panel.
    expect(settings.hasAttribute('hidden')).toBe(false)
  })

  it('seeds the settings panel from the settings actually running', () => {
    install(playingState())
    render(<App />)

    expect(fieldValue('#mg-settings-rows')).toBe('2')
    expect(fieldValue('#mg-settings-columns')).toBe('2')
    expect(fieldValue('#mg-settings-seed')).toBe(FIXTURE_SEED)
    expect(fieldValue('#mg-settings-max-attempts')).toBe('3')
  })

  it('renders the engine’s own infeasibility message verbatim', () => {
    install(baseState())
    render(<App />)

    const seed = one('#mg-settings-seed')
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(seed, '')
      seed.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => {
      one('.mg-form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })

    const warning = one('.mg-form__warning')
    expect(warning.textContent).toContain('nonempty string')
  })

  it('routes the panel’s “New seed” through the store so the draft adopts the derived seed', async () => {
    const store = install(playingState(), { workerFactory: succeedingWorker() })
    render(<App />)

    await act(async () => {
      one('.mg-form__new-seed').dispatchEvent(new Event('click', { bubbles: true }))
    })

    // The store derived a new seed; the panel shows it and the footer agrees with it.
    const adopted = fieldValue('#mg-settings-seed')
    expect(adopted).not.toBe('')
    expect(adopted).not.toBe(FIXTURE_SEED)
    expect(one('.mg-footer__seed').getAttribute('data-seed')).toBe('authored')
    expect(one('.mg-footer__seed').textContent).toContain(adopted)
    expect(store.getSnapshot().status.dimensions?.authoredSeed).toBe(adopted)
  })
})

/**
 * Round 6, defect A: a returning player who chose zh-CN once had Chinese chrome over
 * an English store. `useLocale` seeded its React state from `localStorage` but never
 * told the store, and every snapshot-derived string — the failure headline among
 * them — was projected with the store's own dictionary, which was still the default.
 */
describe('App locale authority', () => {
  it('applies a persisted zh-CN preference to the store on mount and re-projects the failure report in Chinese', () => {
    // The exact player state: the store exists on the default locale while
    // `minegram.lang` remembers zh-CN from a previous session.
    window.localStorage.setItem('minegram.lang', 'zh-CN')
    const store = install(failedState('difficulty-not-found', playingState()))
    render(<App />)

    // The sync effect must reach the store, and the re-published snapshot must
    // carry the Chinese failure copy — not just the component tree.
    expect(store.getLocale()).toBe('zh-CN')
    expect(one('.mg-failure').textContent).toContain('没有达到所选难度')
    expect(container.textContent).not.toContain('The requested difficulty was not reached')
  })

  it('leaves the store on the default locale when nothing is persisted', () => {
    const store = install(failedState('difficulty-not-found', playingState()))
    render(<App />)

    // The sync effect converges immediately; it must not manufacture a change.
    expect(store.getLocale()).toBe('en')
    expect(one('.mg-failure').textContent).toContain('The requested difficulty was not reached')
  })
})

/**
 * Round 6, defect B — and the durable guard for the whole class. The announcement
 * sweep in `announcePlaceholders.test.tsx` proved no `{placeholder}` survives the
 * status region, and a button outside that region leaked one anyway: `App` builds
 * its `resume` object inline (it needs its own `canResume`) and passed the raw
 * `t.resume.action` template, which `RoundBanner` renders verbatim. A guard that
 * covers one call path cannot clear a whole defect class, so this sweep renders the
 * REAL app — banner, failure report, status region, board, panels, footer — in both
 * locales over every banner surface, and asserts the only property that matters:
 * no unmatched `{` or `}` survives anywhere in the composed text. A static list of
 * expected strings cannot outlive a new branch; "no braces" can.
 */
describe('App placeholder sweep', () => {
  const LOCALES = ['en', 'zh-CN'] as const
  /** Every player-facing template reachable from a round-bearing state. */
  const SURFACES: readonly { name: string; state: () => GameState }[] = [
    // The defect itself: the kept-round banner with its resume button, alongside the
    // failure report and the (English-only until round 6) projected failure copy.
    { name: 'failed-kept-round', state: () => failedState('difficulty-not-found', playingState()) },
    // The win banner interpolates {round} and {score}; the loss banner {round}.
    { name: 'won', state: wonState },
    { name: 'lost', state: lostState },
  ]

  for (const locale of LOCALES) {
    for (const { name, state } of SURFACES) {
      it(`renders the ${name} surface in ${locale} without a leftover brace`, () => {
        if (locale === 'zh-CN') {
          window.localStorage.setItem('minegram.lang', 'zh-CN')
        }
        install(state())
        render(<App />)

        const text = container.textContent ?? ''
        expect(text.length, `${locale} / ${name} rendered nothing`).toBeGreaterThan(0)
        expect(text, `${locale} / ${name} left a placeholder in the composed text`).not.toMatch(/[{}]/)
      })
    }

    it(`interpolates the resume action at the producer in ${locale}`, () => {
      // The regression itself. `RoundBanner` renders `resume.action` verbatim, so the
      // interpolation has to happen where the object is built; `projectResume` already
      // does it, but App cannot use it and dropped it while inlining. "No braces" alone
      // would also pass a button that had stopped naming the round, so the exact
      // sentence is pinned here the same way the zoom sentence is pinned in
      // `announcePlaceholders.test.tsx`.
      if (locale === 'zh-CN') {
        window.localStorage.setItem('minegram.lang', 'zh-CN')
      }
      install(failedState('difficulty-not-found', playingState()))
      render(<App />)

      const primary = one('.mg-round-banner__primary')
      expect(primary.textContent).toBe(interpolate(getCopy(locale).resume.action, { round: 1 }))
    })
  }
})
