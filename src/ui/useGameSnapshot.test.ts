import { act, cleanup, render, screen } from '@testing-library/react'
import { StrictMode, createElement, useEffect, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it } from 'vitest'
import type { GeneratedRound } from '../application/gameReducer'
import type { GenerationWorkerCommand, GenerationWorkerResponse } from '../application/generationWorker'
import { derivePuzzleClues } from '../domain'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import * as hooks from './useGameSnapshot'
import {
  createGameStore,
  setGameStore,
  type GameStore,
  type SettingsDraft,
  type TimerHandle,
} from './gameStore'
import { useBoard, useStatus, useUiSnapshot } from './useGameSnapshot'

const BOARD = [1, 0, 0, 1] as const
const DIMENSIONS = { rows: 2, columns: 2 } as const
const SEED = 'hook-seed'

const ROUND: GeneratedRound = {
  settings: normalizeGenerationSettings({
    rows: 2,
    columns: 2,
    densityPercent: 50,
    seed: SEED,
    difficulty: 'starter',
    maxAttempts: 3,
  }),
  board: BOARD,
  puzzle: { dimensions: DIMENSIONS, clues: derivePuzzleClues(BOARD, DIMENSIONS) },
}

const DRAFT: SettingsDraft = {
  rows: '2',
  columns: '2',
  densityPercent: '50',
  difficulty: 'starter',
  seed: SEED,
  maxAttempts: '3',
  initialScore: '5',
}

interface FakeWorker {
  readonly posted: GenerationWorkerCommand[]
  setHandlers: (handlers: {
    message: (event: MessageEvent<unknown>) => void
    error: (event: ErrorEvent) => void
    messageError: (event: MessageEvent<unknown>) => void
  }) => void
  postMessage: (message: GenerationWorkerCommand) => void
  terminate: () => void
  respond: (response: GenerationWorkerResponse) => void
}

function createFakeWorker(): FakeWorker {
  const posted: GenerationWorkerCommand[] = []
  const listeners: ((event: MessageEvent<unknown>) => void)[] = []
  const worker: FakeWorker = {
    posted,
    setHandlers(handlers) {
      listeners.push(handlers.message)
    },
    postMessage(message) {
      posted.push(message)
    },
    terminate() {
      /* nothing to release in the test double */
    },
    respond(response) {
      for (const listener of listeners) {
        listener({ data: response } as MessageEvent<unknown>)
      }
    },
  }
  return worker
}

const restoreStores: (() => void)[] = []

/** The hooks read the module singleton, so every test installs its own store into it. */
function createStore(workerFactory: () => FakeWorker): GameStore {
  const store = createGameStore({
    workerFactory,
    setTimer: (): TimerHandle => 1 as TimerHandle,
    clearTimer: (): void => undefined,
  })
  restoreStores.push(setGameStore(store))
  return store
}

function probe(store: GameStore, renders: { count: number }): ReactElement {
  function Probe(): ReactElement {
    const snapshot = useUiSnapshot()
    const status = useStatus()
    const board = useBoard()
    // A commit per render, counted outside the component so React Compiler's
    // immutability rule has nothing to complain about.
    useEffect(() => {
      renders.count += 1
    })
    return createElement(
      'div',
      null,
      createElement('span', { 'data-testid': 'status' }, status.status),
      createElement('span', { 'data-testid': 'round' }, String(status.round)),
      createElement('span', { 'data-testid': 'interactive' }, String(status.interactive)),
      createElement('span', { 'data-testid': 'board' }, board === null ? 'none' : 'present'),
      createElement('span', { 'data-testid': 'cells' }, String(board?.cells.length ?? -1)),
      createElement('span', { 'data-testid': 'frozen' }, String(Object.isFrozen(snapshot.board))),
      createElement('span', { 'data-testid': 'identity' }, String(snapshot === store.getSnapshot())),
      createElement('span', { 'data-testid': 'aliased' }, String(status === snapshot.status)),
    )
  }
  return createElement(Probe)
}

afterEach(() => {
  cleanup()
  for (const restore of restoreStores.splice(0)) {
    restore()
  }
})

function read(testId: string): string {
  return screen.getByTestId(testId).textContent ?? ''
}

describe('useGameSnapshot', () => {
  it('exports hooks and nothing else', () => {
    expect(Object.keys(hooks).sort()).toEqual(['useBoard', 'useStatus', 'useUiSnapshot'])
  })

  it('projects the idle board as no board', () => {
    const store = createStore(createFakeWorker)
    render(probe(store, { count: 0 }))
    expect(read('status')).toBe('idle')
    expect(read('board')).toBe('none')
    expect(read('round')).toBe('0')
    expect(read('interactive')).toBe('false')
    expect(read('frozen')).toBe('true')
    expect(read('identity')).toBe('true')
    expect(read('aliased')).toBe('true')
  })

  it('exposes the board only once a puzzle exists', () => {
    const store = createStore(createFakeWorker)
    render(probe(store, { count: 0 }))

    act(() => {
      store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    })
    expect(read('status')).toBe('generating')
    expect(read('board')).toBe('none')

    act(() => {
      store.dispatch({ type: 'generation/succeeded', generationId: 1, round: ROUND })
    })
    expect(read('status')).toBe('playing')
    expect(read('board')).toBe('present')
    expect(read('cells')).toBe('4')
    expect(read('round')).toBe('1')
    expect(read('interactive')).toBe('true')
  })

  it('re-renders once per publish and never after unmount', () => {
    const store = createStore(createFakeWorker)
    const renders = { count: 0 }
    const view = render(probe(store, renders))
    const mounted = renders.count
    expect(mounted).toBeGreaterThan(0)

    act(() => {
      store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    })
    expect(renders.count).toBe(mounted + 1)

    act(() => {
      // Ignored: the snapshot identity holds, so React must not re-render.
      store.dispatch({ type: 'round/clearMark', index: 0 })
    })
    expect(renders.count).toBe(mounted + 1)

    view.unmount()
    const afterUnmount = renders.count
    act(() => {
      store.dispatch({ type: 'generation/succeeded', generationId: 1, round: ROUND })
    })
    expect(renders.count).toBe(afterUnmount)
  })

  it('survives a StrictMode double mount with one client and no failure card', () => {
    let constructions = 0
    const worker = createFakeWorker()
    const store = createStore(() => {
      constructions += 1
      return worker
    })
    render(createElement(StrictMode, null, probe(store, { count: 0 })))

    act(() => {
      store.actions.start(DRAFT)
    })
    expect(constructions).toBe(1)
    expect(read('status')).toBe('generating')

    const request = worker.posted[0]
    if (request === undefined || request.type !== 'generation/request') {
      throw new Error('the client did not post a request')
    }
    act(() => {
      worker.respond({
        type: 'generation/succeeded',
        requestId: request.requestId,
        generationId: request.generationId,
        round: ROUND,
      })
    })

    expect(read('status')).toBe('playing')
    expect(read('board')).toBe('present')
    expect(read('interactive')).toBe('true')
    expect(store.getSnapshot().status.failure).toBeNull()
    expect(constructions).toBe(1)
  })

  it('reads the same server snapshot during static rendering', () => {
    const store = createStore(createFakeWorker)
    const markup = renderToStaticMarkup(probe(store, { count: 0 }))
    expect(markup).toContain('>idle<')
    expect(markup).toContain('>none<')
    expect(markup).toContain('>true<')
  })
})
