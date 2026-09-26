import { afterEach, describe, expect, it } from 'vitest'
import type { GeneratedRound, GameFailureDiagnostics } from '../application/gameReducer'
import type {
  GenerationWorkerCommand,
  GenerationWorkerResponse,
} from '../application/generationWorker'
import { derivePuzzleClues } from '../domain'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import { deriveRandomSeed } from '../engine/rng'
import { DEFAULT_LOCALE, LOCALES } from './copy'
import {
  DEFAULT_NEW_SEED_LABEL,
  DEFAULT_WIN_INTERLUDE_MS,
  createGameStore,
  disposeGameStore,
  getGameStore,
  normalizeDraft,
  setGameStore,
  type CellAssertionCell,
  type GameStore,
  type GameStoreOptions,
  type SettingsDraft,
  type TimerHandle,
} from './gameStore'
import type { BoardView, CellView, UiSnapshot } from './viewModel'

// ======================================================================================
// Fixtures
// ======================================================================================

const BOARD = [1, 0, 0, 1] as const
const DIMENSIONS = { rows: 2, columns: 2 } as const
const FIXTURE_SEED = 'fixture-seed'
const SOLUTION: readonly CellAssertionCell[] = Object.freeze([
  { index: 0, assertion: 'mine' },
  { index: 1, assertion: 'blank' },
  { index: 2, assertion: 'blank' },
  { index: 3, assertion: 'mine' },
])
const WRONG_SINGLE: readonly CellAssertionCell[] = Object.freeze([
  { index: 0, assertion: 'blank' },
])

const ROUND: GeneratedRound = Object.freeze({
  settings: normalizeGenerationSettings({
    rows: 2,
    columns: 2,
    densityPercent: 50,
    seed: FIXTURE_SEED,
    difficulty: 'starter',
    maxAttempts: 3,
  }),
  board: BOARD,
  puzzle: { dimensions: DIMENSIONS, clues: derivePuzzleClues(BOARD, DIMENSIONS) },
})

const DRAFT: SettingsDraft = Object.freeze({
  rows: '2',
  columns: '2',
  densityPercent: '50',
  difficulty: 'starter',
  seed: FIXTURE_SEED,
  maxAttempts: '3',
  initialScore: '5',
})

function cloneRound(seed: string | number = FIXTURE_SEED): GeneratedRound {
  return {
    settings: { ...ROUND.settings, seed },
    board: BOARD,
    puzzle: { dimensions: DIMENSIONS, clues: derivePuzzleClues(BOARD, DIMENSIONS) },
  }
}

function failure(reason: string, details: Record<string, unknown> = {}): GameFailureDiagnostics {
  return {
    reason,
    message: `${reason} message`,
    details: details as GameFailureDiagnostics['details'],
  }
}

// --------------------------------------------------------------------------------------
// Fake worker endpoint
// --------------------------------------------------------------------------------------

interface FakeWorker {
  readonly posted: GenerationWorkerCommand[]
  readonly terminated: () => number
  setHandlers: (handlers: {
    message: (event: MessageEvent<unknown>) => void
    error: (event: ErrorEvent) => void
    messageError: (event: MessageEvent<unknown>) => void
  }) => void
  postMessage: (message: GenerationWorkerCommand) => void
  terminate: () => void
  respond: (response: GenerationWorkerResponse) => void
  fail: (message: string) => void
}

function createFakeWorker(): FakeWorker {
  const posted: GenerationWorkerCommand[] = []
  const messageListeners: ((event: MessageEvent<unknown>) => void)[] = []
  const errorListeners: ((event: ErrorEvent) => void)[] = []
  let terminated = 0
  const worker: FakeWorker = {
    posted,
    terminated: () => terminated,
    setHandlers(handlers) {
      messageListeners.push(handlers.message)
      errorListeners.push(handlers.error)
    },
    postMessage(message) {
      posted.push(message)
    },
    terminate() {
      terminated += 1
    },
    respond(response) {
      for (const listener of messageListeners) {
        listener({ data: response } as MessageEvent<unknown>)
      }
    },
    fail(message) {
      for (const listener of errorListeners) {
        listener({ message, preventDefault: () => undefined } as unknown as ErrorEvent)
      }
    },
  }
  return worker
}

function lastRequest(worker: FakeWorker): Extract<GenerationWorkerCommand, { type: 'generation/request' }> {
  for (let index = worker.posted.length - 1; index >= 0; index -= 1) {
    const command = worker.posted[index]
    if (command !== undefined && command.type === 'generation/request') {
      return command
    }
  }
  throw new Error('no generation request was posted')
}

// --------------------------------------------------------------------------------------
// Fake timers
// --------------------------------------------------------------------------------------

interface FakeTimers {
  readonly pending: () => number
  readonly recorded: readonly number[]
  set: (handler: () => void, ms: number) => TimerHandle
  clear: (handle: TimerHandle) => void
  runAll: () => void
}

function createFakeTimers(): FakeTimers {
  const handlers = new Map<number, { handler: () => void }>()
  const recorded: number[] = []
  let next = 1
  return {
    pending: () => handlers.size,
    recorded,
    set(handler, ms) {
      const handle = next
      next += 1
      recorded.push(ms)
      handlers.set(handle, { handler })
      return handle as TimerHandle
    },
    clear(handle) {
      handlers.delete(handle as number)
    },
    runAll() {
      const entries = [...handlers.values()]
      handlers.clear()
      for (const entry of entries) {
        entry.handler()
      }
    },
  }
}

// --------------------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------------------

interface Harness {
  readonly store: GameStore
  readonly worker: FakeWorker
  readonly timers: FakeTimers
}

const openStores: GameStore[] = []

function createHarness(options: GameStoreOptions = {}, worker = createFakeWorker()): Harness {
  const timers = createFakeTimers()
  const store = createGameStore({
    workerFactory: () => worker,
    setTimer: timers.set,
    clearTimer: timers.clear,
    ...options,
  })
  openStores.push(store)
  return { store, worker, timers }
}

afterEach(() => {
  for (const store of openStores.splice(0)) {
    store.dispose()
  }
  disposeGameStore()
})

/**
 * Answers the client's outstanding request with a round that echoes the pending
 * settings, so the client's active generation clears exactly as a real one would.
 */
function completeViaWorker(worker: FakeWorker): GeneratedRound {
  const request = lastRequest(worker)
  const round = cloneRound(request.settings.seed)
  worker.respond({
    type: 'generation/succeeded',
    requestId: request.requestId,
    generationId: request.generationId,
    round,
  })
  return round
}

/** Drives a store to a playable round without involving a Worker. */
function reachPlaying(store: GameStore, initialScore = 5): void {
  store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore })
  store.dispatch({ type: 'generation/succeeded', generationId: 1, round: cloneRound() })
  if (store.getSnapshot().status.status !== 'playing') {
    throw new Error('the fixture failed to reach a playable round')
  }
}

// --------------------------------------------------------------------------------------
// Deep-scan helpers
// --------------------------------------------------------------------------------------

/**
 * §1: the puzzle's ordered run clues and the selectors' `runs[].mineIndices`
 * are solution-adjacent, and `preview.cellIndices` merely echoes the cells the
 * caller itself passed in. The private board is none of those.
 */
const ALLOWED_NUMERIC_ARRAYS = new Set(['mineIndices', 'clue', 'cellIndices'])

function findUnexpectedNumericArrays(value: unknown, path: string, into: string[] = []): string[] {
  if (Array.isArray(value)) {
    const leaf = path.slice(path.lastIndexOf('.') + 1).replace(/\[\d+\]$/, '')
    if (typeof value[0] === 'number' && !ALLOWED_NUMERIC_ARRAYS.has(leaf)) {
      into.push(path)
    }
    value.forEach((entry, index) => {
      findUnexpectedNumericArrays(entry, `${path}[${String(index)}]`, into)
    })
    return into
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, entry] of Object.entries(value)) {
      findUnexpectedNumericArrays(entry, `${path}.${key}`, into)
    }
  }
  return into
}

function collectStrings(value: unknown, into: string[] = []): string[] {
  if (typeof value === 'string') {
    into.push(value)
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      collectStrings(entry, into)
    }
  } else if (typeof value === 'object' && value !== null) {
    for (const entry of Object.values(value)) {
      collectStrings(entry, into)
    }
  }
  return into
}

function everyObject(value: unknown, visit: (node: object) => void): void {
  if (Array.isArray(value)) {
    visit(value)
  }
  if (typeof value === 'object' && value !== null) {
    visit(value)
    for (const entry of Object.values(value)) {
      everyObject(entry, visit)
    }
  }
}

function assertBoardShape(board: BoardView | null, snapshot: UiSnapshot): void {
  expect(board).toBe(snapshot.board)
}

// ======================================================================================
// Publish mechanics
// ======================================================================================

describe('gameStore publish mechanics', () => {
  it('publishes exactly one new snapshot and notifies once per accepted dispatch', () => {
    const { store } = createHarness()
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    const before = store.getSnapshot()

    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })

    expect(notifications).toBe(1)
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().status.status).toBe('generating')
    expect(store.getSnapshot().lastEvent).toEqual({ transition: 'generation-started', reason: null })
  })

  it('keeps the same snapshot object when the reducer ignores the action', () => {
    const { store } = createHarness()
    reachPlaying(store)
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    const before = store.getSnapshot()

    // Clearing a cell that is already unknown is ignored, and a cancellation for an
    // unknown generation is stale: nothing changed, so nothing is published and
    // useSyncExternalStore cannot loop.
    store.dispatch({ type: 'round/clearMark', index: 0 })
    store.dispatch({ type: 'round/clearMark', index: 0 })
    store.dispatch({ type: 'generation/cancelled', generationId: 999 })

    expect(store.getSnapshot()).toBe(before)
    expect(notifications).toBe(0)
  })

  it('publishes a change an ignored-looking action still makes', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const before = store.getSnapshot()
    store.actions.mark([{ index: 0, assertion: 'mine' }])
    expect(store.getSnapshot()).not.toBe(before)
    expect(store.getSnapshot().lastEvent).toEqual({ transition: 'marks-applied', reason: null })
    expect(store.getSnapshot().board?.cells[0]?.correct).toBe(true)
  })

  it('carries a recorded refusal reason into the next published event', () => {
    const { store } = createHarness()
    reachPlaying(store)
    store.dispatch({ type: 'round/clearMark', index: 0 })
    store.dispatch({ type: 'round/markBatch', cells: [{ index: 0, assertion: 'mine' }] })
    expect(store.getSnapshot().lastEvent).toEqual({
      transition: 'marks-applied',
      reason: 'cell-already-unknown',
    })
  })

  it('exposes a deeply frozen snapshot', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const snapshot = store.getSnapshot()
    let visited = 0
    everyObject(snapshot, (node) => {
      visited += 1
      expect(Object.isFrozen(node)).toBe(true)
    })
    expect(visited).toBeGreaterThan(8)
    expect(Object.isFrozen(snapshot.board)).toBe(true)
    expect(Object.isFrozen(snapshot.board?.cells)).toBe(true)
    expect(Object.isFrozen(snapshot.board?.cells[0])).toBe(true)
  })

  it('bumps the snapshot version monotonically', () => {
    const { store } = createHarness()
    const versions: number[] = []
    for (let index = 0; index < 3; index += 1) {
      store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
      store.dispatch({ type: 'generation/cancelled', generationId: index + 1 })
      versions.push(store.getSnapshot().version)
    }
    expect(new Set(versions).size).toBe(3)
    expect(versions).toEqual([...versions].sort((left, right) => left - right))
  })

  it('re-projects the same state as a new object on a locale change', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const before = store.getSnapshot()
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    store.setLocale('zh-CN')
    expect(notifications).toBe(1)
    expect(store.getLocale()).toBe('zh-CN')
    const after = store.getSnapshot()
    expect(after).not.toBe(before)
    const shape = (cells: readonly CellView[] | undefined): string =>
      (cells ?? []).map((cell) => `${String(cell.index)}:${String(cell.row)}:${String(cell.mark)}`).join('|')
    expect(shape(after.board?.cells)).toBe(shape(before.board?.cells))
  })

  it('keeps one snapshot when the locale is unchanged', () => {
    const { store } = createHarness()
    const before = store.getSnapshot()
    store.setLocale(DEFAULT_LOCALE)
    expect(store.getSnapshot()).toBe(before)
  })

  it('offers every locale the dictionary knows', () => {
    const { store } = createHarness()
    for (const locale of LOCALES) {
      store.setLocale(locale)
      expect(store.getLocale()).toBe(locale)
    }
  })
})

// ======================================================================================
// Generation client ownership (risks 1, 2, 8)
// ======================================================================================

describe('gameStore generation client', () => {
  it('creates the client lazily, on the first generation action', () => {
    let constructions = 0
    const worker = createFakeWorker()
    const { store } = createHarness({
      workerFactory: () => {
        constructions += 1
        return worker
      },
    })
    reachPlaying(store)
    expect(constructions).toBe(0)
    expect(worker.posted).toHaveLength(0)
  })

  it('posts a generation request the store then accepts in the same tick', () => {
    const { store, worker } = createHarness()
    const outcome = store.actions.start(DRAFT)

    expect(outcome.ok).toBe(true)
    expect(outcome.started).toBe(true)
    expect(worker.posted).toHaveLength(1)
    const request = lastRequest(worker)
    expect(request.settings).toEqual(outcome.settings)
    expect(store.getSnapshot().status.isGenerating).toBe(true)

    // The pending id the store reports is knowable only through the reducer: if the
    // posted id is the live one, the round is accepted and the board is playable.
    store.dispatch({
      type: 'generation/succeeded',
      generationId: request.generationId,
      round: cloneRound(),
    })
    expect(store.getSnapshot().status.status).toBe('playing')
    expect(store.getSnapshot().status.round).toBe(1)
  })

  it('builds exactly one client across repeated starts', () => {
    let constructions = 0
    const worker = createFakeWorker()
    const { store } = createHarness({
      workerFactory: () => {
        constructions += 1
        return worker
      },
    })
    expect(store.actions.start(DRAFT).started).toBe(true)
    expect(store.actions.start(DRAFT).started).toBe(false)
    expect(constructions).toBe(1)
    expect(worker.posted).toHaveLength(1)
  })

  it('cancels a pending generation without leaving the generating status', () => {
    const { store, worker } = createHarness()
    store.actions.start(DRAFT)
    store.actions.cancel()
    expect(worker.posted[1]?.type).toBe('generation/cancel')
    expect(worker.terminated()).toBe(1)
    expect(store.getSnapshot().status.status).toBe('failed')
    expect(store.getSnapshot().status.failure?.kind).toBe('neutral')
    expect(store.getSnapshot().status.failure?.reason).toBe('cancelled')
  })

  it('retries the settings of the most recent failure', () => {
    const { store, worker } = createHarness()
    store.actions.start(DRAFT)
    const request = lastRequest(worker)
    worker.respond({
      type: 'generation/failed',
      requestId: request.requestId,
      generationId: request.generationId,
      failure: failure('time-limit'),
    })
    expect(store.getSnapshot().status.status).toBe('failed')

    store.actions.retry()

    expect(worker.posted).toHaveLength(2)
    const retry = lastRequest(worker)
    expect(retry.settings.seed).toBe(DRAFT.seed)
    expect(retry.settings.rows).toBe(2)
    expect(store.getSnapshot().status.isGenerating).toBe(true)
  })

  it('surfaces a worker fault as a retryable failure', () => {
    const { store, worker } = createHarness()
    store.actions.start(DRAFT)
    worker.fail('boom')
    expect(store.getSnapshot().status.failure?.reason).toBe('worker-error')
    expect(store.getSnapshot().status.failure?.kind).toBe('retryable')
  })

  it('never renders a failure card for an internal teardown', () => {
    const { store } = createHarness()
    store.actions.start(DRAFT)
    const before = store.getSnapshot()
    store.dispose()
    expect(store.getSnapshot()).toBe(before)
    expect(store.getSnapshot().status.failure).toBeNull()
    expect(store.getSnapshot().status.isGenerating).toBe(true)
  })

  it('ignores every action once disposed', () => {
    const { store, worker } = createHarness()
    let notifications = 0
    store.subscribe(() => {
      notifications += 1
    })
    store.dispose()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    expect(notifications).toBe(0)
    expect(store.actions.start(DRAFT).started).toBe(false)
    expect(store.preview(SOLUTION)).toBeNull()
    expect(store.previewOf(0, 'mine')).toBe('none')
    expect(worker.posted).toHaveLength(0)
  })
})

// ======================================================================================
// Mount churn, the StrictMode risk
// ======================================================================================

describe('gameStore subscription churn', () => {
  it('tolerates double subscribe and double unsubscribe', () => {
    const { store } = createHarness()
    let notifications = 0
    const listener = (): void => {
      notifications += 1
    }
    const first = store.subscribe(listener)
    const second = store.subscribe(listener)
    expect(first).not.toBe(second)
    first()
    first()
    second()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    expect(notifications).toBe(0)

    const third = store.subscribe(listener)
    store.dispatch({ type: 'generation/cancelled', generationId: 1 })
    expect(notifications).toBe(1)
    third()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    expect(notifications).toBe(1)
  })

  it('keeps the surviving listener when another unsubscribes', () => {
    const { store } = createHarness()
    let first = 0
    let second = 0
    const dropFirst = store.subscribe(() => {
      first += 1
    })
    store.subscribe(() => {
      second += 1
    })
    dropFirst()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    expect(first).toBe(0)
    expect(second).toBe(1)
  })

  it('notifies a listener that subscribes and unsubscribes repeatedly', () => {
    const { store } = createHarness()
    let notifications = 0
    for (let round = 0; round < 3; round += 1) {
      const off = store.subscribe(() => {
        notifications += 1
      })
      store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
      store.dispatch({ type: 'generation/cancelled', generationId: round + 1 })
      off()
    }
    expect(notifications).toBe(6)
  })

  it('never leaves a second store stuck after another store was disposed', () => {
    const first = createHarness()
    const second = createHarness()
    first.store.actions.start(DRAFT)
    expect(first.store.getSnapshot().status.isGenerating).toBe(true)
    first.store.dispose()

    expect(second.store.actions.start(DRAFT).started).toBe(true)
    expect(second.store.getSnapshot().status.isGenerating).toBe(true)
    second.store.actions.cancel()
    expect(second.store.getSnapshot().status.status).toBe('failed')
    expect(second.store.actions.start(DRAFT).started).toBe(true)
    expect(second.store.getSnapshot().status.isGenerating).toBe(true)
  })
})

// ======================================================================================
// Preview and containment (risks 3, 5)
// ======================================================================================

describe('gameStore preview', () => {
  it('previews a correct mark as free', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const view = store.preview([{ index: 0, assertion: 'mine' }])
    expect(view).not.toBeNull()
    expect(view?.affectedCount).toBe(1)
    expect(view?.scoreCost).toBe(0)
    expect(view?.projectedScore).toBe(5)
    expect(view?.reachesZero).toBe(false)
    expect(view?.cellIndices).toEqual([0])
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view?.cellIndices)).toBe(true)
  })

  it('previews a whole batch', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const view = store.preview(SOLUTION)
    expect(view?.affectedCount).toBe(4)
    expect(view?.scoreCost).toBe(0)
    expect(view?.projectedScore).toBe(5)
    expect(view?.cellIndices).toEqual([0, 1, 2, 3])

    const wrong = store.preview([
      { index: 0, assertion: 'blank' },
      { index: 1, assertion: 'mine' },
    ])
    expect(wrong?.scoreCost).toBe(2)
    expect(wrong?.projectedScore).toBe(3)
  })

  it('answers a single-cell verdict', () => {
    const { store } = createHarness()
    reachPlaying(store)
    expect(store.previewOf(0, 'mine')).toBe('hit')
    expect(store.previewOf(1, 'blank')).toBe('hit')
    expect(store.previewOf(1, 'mine')).toBe('risk')
    expect(store.previewOf(3, 'blank')).toBe('risk')
    expect(store.previewOf(99, 'mine')).toBe('none')
  })

  it('reports a no-op for repeated and locked assertions', () => {
    const { store } = createHarness()
    reachPlaying(store)
    store.actions.mark([{ index: 0, assertion: 'mine' }])
    // A correct mark locks the cell, so neither the same nor the opposite
    // assertion changes anything: the drag layer must see no risk at all.
    expect(store.previewOf(0, 'mine')).toBe('none')
    expect(store.previewOf(0, 'blank')).toBe('none')

    store.actions.mark([{ index: 1, assertion: 'mine' }])
    expect(store.previewOf(1, 'mine')).toBe('none')
    expect(store.previewOf(1, 'blank')).toBe('hit')

    store.actions.mark(SOLUTION)
    expect(store.previewOf(0, 'mine')).toBe('none')
    expect(store.previewOf(1, 'blank')).toBe('none')
  })

  it('returns null and none when the round is not interactive', () => {
    const { store } = createHarness()
    expect(store.preview(SOLUTION)).toBeNull()
    expect(store.previewOf(0, 'mine')).toBe('none')
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    expect(store.preview(SOLUTION)).toBeNull()
    expect(store.previewOf(1, 'blank')).toBe('none')
  })

  it('never leaks the solution through the snapshot', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const snapshot = store.getSnapshot()
    expect(snapshot.board).not.toBeNull()
    expect(snapshot.board?.cells.every((cell) => cell.correct === null)).toBe(true)
    expect(findUnexpectedNumericArrays(snapshot, 'snapshot')).toEqual([])
    expect(collectStrings(snapshot).join(' | ')).not.toContain('round:')
  })

  it('keeps the solution out of the whole store surface', () => {
    const { store } = createHarness()
    reachPlaying(store)
    const surface: Record<string, unknown> = {
      snapshot: store.getSnapshot(),
      locale: store.getLocale(),
      report: store.copyReport(),
      preview: store.preview(SOLUTION),
      verdict: store.previewOf(0, 'mine'),
    }
    expect(findUnexpectedNumericArrays(surface, 'store')).toEqual([])
    expect(collectStrings(surface)).not.toContain('round:')
  })
})

// ======================================================================================
// Failure report and seed policy (risk 8)
// ======================================================================================

describe('gameStore failure report', () => {
  it('formats the engine settings and diagnostics at click time', () => {
    const { store } = createHarness()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    store.dispatch({
      type: 'generation/failed',
      generationId: 1,
      failure: failure('difficulty-not-found', {
        settings: { ...ROUND.settings },
        diagnostics: { attempts: 424242, layouts: 7, unlisted: 'ignored' },
      }),
    })

    const report = store.copyReport()
    expect(report).toContain('Attempts: 424242')
    expect(report).toContain('Layouts: 7')
    expect(report).toContain('Rows: 2')
    expect(report).toContain('Mines: 2')
    expect(report).toContain(FIXTURE_SEED)
    expect(report).not.toContain('unlisted')

    // The failure card renders the very same whitelist, frozen, because that is
    // what §5.7 sanctions; only the clipboard text carries the seed source.
    const view = store.getSnapshot().status.failure
    const values = view?.report.map((row) => row.value) ?? []
    expect(values).toContain('424242')
    expect(values).toContain('2')
    expect(values).toContain(FIXTURE_SEED)
    expect(Object.isFrozen(view?.report)).toBe(true)
    expect(Object.isFrozen(view?.report[0])).toBe(true)
  })

  it('is empty when nothing failed', () => {
    const { store } = createHarness()
    expect(store.copyReport()).toBe('')
    reachPlaying(store)
    expect(store.copyReport()).toBe('')
  })

  it('exposes an engine-derived seed only through the clipboard', () => {
    const { store, worker } = createHarness()
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    expect(store.getSnapshot().status.status).toBe('won')
    expect(store.getSnapshot().status.dimensions?.authoredSeed).toBe(FIXTURE_SEED)

    store.actions.nextRound()
    const request = lastRequest(worker)
    store.dispatch({
      type: 'generation/failed',
      generationId: request.generationId,
      failure: failure('time-limit', { attempts: 1 }),
    })

    const snapshot = store.getSnapshot()
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.status.dimensions?.authoredSeed).toBe('')
    const derived = deriveRandomSeed(FIXTURE_SEED, 'round:2')
    const report = store.copyReport()
    expect(report).toContain(String(derived))
    expect(collectStrings(snapshot).join(' | ')).not.toContain(String(derived))
  })

  it('classifies a deterministic failure as not retryable', () => {
    const { store } = createHarness()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    store.dispatch({
      type: 'generation/failed',
      generationId: 1,
      failure: failure('difficulty-not-found'),
    })
    const view = store.getSnapshot().status.failure
    expect(view?.kind).toBe('deterministic')
    expect(view?.canRetry).toBe(false)
    expect(view?.canChangeSeed).toBe(true)
  })
})

// ======================================================================================
// Win handoff (§4.8)
// ======================================================================================

describe('gameStore win handoff', () => {
  it('starts the next round after the interlude, exactly once', () => {
    const { store, worker, timers } = createHarness()
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    expect(store.getSnapshot().status.status).toBe('won')
    expect(timers.pending()).toBe(1)
    expect(timers.recorded).toEqual([DEFAULT_WIN_INTERLUDE_MS])
    expect(worker.posted).toHaveLength(0)

    timers.runAll()

    expect(worker.posted).toHaveLength(1)
    expect(lastRequest(worker).settings.seed).not.toBe(FIXTURE_SEED)
    expect(store.getSnapshot().status.status).toBe('generating')
    expect(timers.pending()).toBe(0)
  })

  it('accelerates without starting twice', () => {
    const { store, worker, timers } = createHarness()
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    store.actions.nextRound()
    expect(timers.pending()).toBe(0)
    expect(worker.posted).toHaveLength(1)

    timers.runAll()

    expect(worker.posted).toHaveLength(1)
    expect(store.getSnapshot().status.isGenerating).toBe(true)
  })

  it('uses the injected interlude length', () => {
    const { store, timers } = createHarness({ interludeMs: 40 })
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    expect(timers.recorded).toEqual([40])
  })

  it('starts nothing after a loss', () => {
    const { store, timers, worker } = createHarness()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 1 })
    store.dispatch({ type: 'generation/succeeded', generationId: 1, round: cloneRound() })
    store.actions.mark(WRONG_SINGLE)
    expect(store.getSnapshot().status.status).toBe('lost')
    expect(timers.pending()).toBe(0)
    timers.runAll()
    expect(worker.posted).toHaveLength(0)
    expect(store.getSnapshot().status.status).toBe('lost')
  })

  it('cancels the handoff when the player asks for another round', () => {
    const { store, timers, worker } = createHarness()
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    expect(timers.pending()).toBe(1)
    store.actions.retry()
    expect(timers.pending()).toBe(0)
    timers.runAll()
    expect(worker.posted).toHaveLength(0)
    expect(store.getSnapshot().status.status).toBe('won')
  })

  it('clears the handoff on dispose', () => {
    const { store, timers } = createHarness()
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    expect(timers.pending()).toBe(1)
    store.dispose()
    expect(timers.pending()).toBe(0)
  })

  it('does not start a second round when one is already in flight', () => {
    const { store, worker, timers } = createHarness()
    reachPlaying(store)
    store.actions.mark(SOLUTION)
    store.actions.nextRound()
    store.actions.nextRound()
    store.actions.retry()
    timers.runAll()
    expect(worker.posted).toHaveLength(1)
  })

  it('paints the round swap inside a transition', () => {
    const deferred: boolean[] = []
    const { store, worker } = createHarness({
      paintPriority: (notify) => {
        deferred.push(true)
        notify()
      },
    })
    store.subscribe(() => undefined)
    reachPlaying(store)
    deferred.length = 0
    store.actions.mark(SOLUTION)
    expect(deferred).toEqual([])

    store.actions.nextRound()
    completeViaWorker(worker)
    expect(deferred).toEqual([true])
    expect(store.getSnapshot().status.status).toBe('playing')
  })
})

// ======================================================================================
// Settings draft
// ======================================================================================

describe('gameStore settings', () => {
  it('normalises a valid draft through the engine', () => {
    const result = normalizeDraft(DRAFT)
    expect(result.ok).toBe(true)
    expect(result.error).toBeNull()
    expect(result.settings?.rows).toBe(2)
    expect(result.settings?.mineCount).toBe(2)
    expect(result.initialScore).toBe(5)
  })

  it('reports an infeasible draft with the engine message instead of throwing', () => {
    const result = normalizeDraft({ ...DRAFT, rows: '40' })
    expect(result.ok).toBe(false)
    expect(result.settings).toBeNull()
    expect(result.error).toBe('rows must be between 1 and 24; received 40')
  })

  it('reports a half-finished field through the engine message', () => {
    expect(normalizeDraft({ ...DRAFT, columns: '  ' }).error).toBe(
      'columns must be a safe integer; received NaN',
    )
    expect(normalizeDraft({ ...DRAFT, initialScore: '0' }).error).toBe(
      'initialScore must be a positive safe integer; received 0',
    )
    expect(normalizeDraft({ ...DRAFT, seed: '' }).error).toBe('text seed must be a nonempty string')
    expect(normalizeDraft({ ...DRAFT, densityPercent: '101' }).ok).toBe(false)
    expect(normalizeDraft({ ...DRAFT, difficulty: 'nightmare' }).ok).toBe(false)
  })

  it('never starts a generation for an infeasible draft', () => {
    let constructions = 0
    const worker = createFakeWorker()
    const { store } = createHarness({
      workerFactory: () => {
        constructions += 1
        return worker
      },
    })
    const outcome = store.actions.start({ ...DRAFT, densityPercent: '900' })
    expect(outcome.ok).toBe(false)
    expect(outcome.started).toBe(false)
    expect(outcome.error).not.toBeNull()
    expect(constructions).toBe(0)
    expect(worker.posted).toHaveLength(0)
    expect(store.getSnapshot().status.status).toBe('idle')
  })

  it('derives a new seed deterministically and never from the derived one', () => {
    const { store, worker } = createHarness()
    reachPlaying(store)

    store.actions.newSeed()
    const first = lastRequest(worker)
    expect(first.settings.seed).toBe(deriveRandomSeed(FIXTURE_SEED, DEFAULT_NEW_SEED_LABEL))
    completeViaWorker(worker)

    store.actions.newSeed()
    const second = lastRequest(worker)
    expect(second.settings.seed).toBe(
      deriveRandomSeed(first.settings.seed, DEFAULT_NEW_SEED_LABEL),
    )
    expect(second.settings.seed).not.toBe(first.settings.seed)
  })

  it('shows a new seed as the authored one', () => {
    const { store, worker } = createHarness()
    reachPlaying(store)
    store.actions.newSeed()
    const request = lastRequest(worker)
    completeViaWorker(worker)
    expect(store.getSnapshot().status.dimensions?.authoredSeed).toBe(String(request.settings.seed))
  })
})

// ======================================================================================
// Resume (ruling 1)
// ======================================================================================

describe('gameStore resume', () => {
  it('resumes a board a failure kept', () => {
    const { store } = createHarness()
    reachPlaying(store)
    // A generation started over a live round keeps the board, so a failure keeps it too.
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    store.dispatch({ type: 'generation/failed', generationId: 2, failure: failure('time-limit') })
    const failed = store.getSnapshot()
    expect(failed.status.status).toBe('failed')
    expect(failed.status.hasRound).toBe(true)
    expect(failed.status.failure?.remedies[0]).toBeDefined()

    expect(store.actions.resume()).toBe(true)
    expect(store.getSnapshot().status.status).toBe('playing')
    expect(store.getSnapshot().status.failure).toBeNull()
  })

  it('is not offered without a board', () => {
    const { store } = createHarness()
    store.dispatch({ type: 'generation/start', settings: ROUND.settings, initialScore: 5 })
    store.dispatch({ type: 'generation/failed', generationId: 1, failure: failure('time-limit') })
    expect(store.getSnapshot().status.hasRound).toBe(false)
    expect(store.actions.resume()).toBe(false)
    expect(store.getSnapshot().status.status).toBe('failed')
  })

  it('is not offered while the round is playable', () => {
    const { store } = createHarness()
    reachPlaying(store)
    expect(store.actions.resume()).toBe(false)
    expect(store.getSnapshot().status.status).toBe('playing')
  })
})

// ======================================================================================
// Singleton
// ======================================================================================

describe('gameStore singleton', () => {
  it('returns one store and disposes it idempotently', () => {
    const first = getGameStore()
    expect(getGameStore()).toBe(first)
    disposeGameStore()
    disposeGameStore()
    expect(getGameStore()).toBe(first)
  })

  it('lets a test install its own store and restore the previous one', () => {
    const { store } = createHarness()
    const previous = getGameStore()
    const restore = setGameStore(store)
    expect(getGameStore()).toBe(store)
    restore()
    expect(getGameStore()).toBe(previous)
  })
})

// ======================================================================================
// Surface shape
// ======================================================================================

describe('gameStore surface', () => {
  it('exposes the documented members only', () => {
    const { store } = createHarness()
    expect(Object.isFrozen(store)).toBe(true)
    expect(Object.keys(store)).toEqual([
      'getSnapshot',
      'subscribe',
      'dispatch',
      'actions',
      'preview',
      'previewOf',
      'copyReport',
      'getLocale',
      'setLocale',
      'dispose',
    ])
    expect(Object.keys(store.actions).sort()).toEqual([
      'cancel',
      'clear',
      'mark',
      'newSeed',
      'nextRound',
      'resume',
      'retry',
      'start',
    ])
    assertBoardShape(store.getSnapshot().board, store.getSnapshot())
  })
})

// ======================================================================================
// Source guards
// ======================================================================================

async function readSource(path: string): Promise<string> {
  const module: { default: string } = await import(`./${path}?raw`)
  return module.default
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

describe('gameStore source guards', () => {
  it('is the only importer of previewMarkBatch', async () => {
    expect(stripComments(await readSource('gameStore.ts'))).toContain('previewMarkBatch')
    for (const path of ['useGameSnapshot.ts', 'viewModel.ts', 'copy.ts', 'dragController.ts']) {
      expect(stripComments(await readSource(path))).not.toContain('previewMarkBatch')
    }
  })

  it('leaves the selectors to viewModel', async () => {
    expect(await readSource('viewModel.ts')).toContain('gameSelectors')
    for (const path of ['gameStore.ts', 'useGameSnapshot.ts']) {
      expect(await readSource(path)).not.toContain('gameSelectors')
    }
  })

  it('uses no randomness, no wall clock, and no console in the store layer', async () => {
    for (const path of ['gameStore.ts', 'useGameSnapshot.ts']) {
      const source = stripComments(await readSource(path))
      expect(source).not.toContain('Math.random')
      expect(source).not.toContain('new Date(')
      expect(source).not.toContain('Date.now()')
      expect(source).not.toContain('console.log')
      expect(source).not.toContain('document.')
    }
  })
})
