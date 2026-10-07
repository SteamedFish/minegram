import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_STAR_LIVES, MAX_STAR_SIDE, MIN_STAR_LIVES, MIN_STAR_SIDE, type StarBattlePuzzle } from '../domain/starBattle'
import type { StarDifficulty } from '../engine/starBattle/construct'
import type {
  StarTierFeasibility,
  StarTierFeasibilityReport,
  StarTierFeasibilityStatus,
} from '../engine/starBattle/feasibility'
import { deriveRandomSeed, normalizeRandomSeed } from '../engine/rng'
import {
  STAR_NEXT_ROUND_SEED_LABEL,
  STAR_PICKER_ENTRY_SEED_LABEL,
  createStarBattleStore,
  type StarBattleSnapshot,
  type StarBattleStoreOptions,
  type TimerHandle,
  type VisibilityProbe,
} from './starBattleStore'
import type {
  StarBattleWorkerCommand,
  StarBattleWorkerResponse,
} from '../workers/starBattleWorker'

// ======================================================================================
// Fixtures
// ======================================================================================

const SIDE = 4

/** Row-index colouring; valid for any permutation (star colours stay distinct). */
function makePuzzle(seed: number, solution: readonly number[], n = SIDE): StarBattlePuzzle {
  const colours = new Uint8Array(n * n)
  for (let row = 0; row < n; row += 1) {
    for (let col = 0; col < n; col += 1) {
      colours[row * n + col] = row
    }
  }
  return Object.freeze({ n, seed, colours, solution })
}

const PUZZLE_A = makePuzzle(normalizeRandomSeed('star-fixture-a'), [1, 3, 0, 2])
const PUZZLE_B = makePuzzle(normalizeRandomSeed('star-fixture-b'), [2, 0, 3, 1])

// Stars at columns alternating 1, 3, 5, 7, 0, 2, 4, 6: neighbours are always
// two columns apart, so the adjacency rule holds on the row-index colouring.
const PUZZLE_EIGHT = makePuzzle(
  normalizeRandomSeed('star-fixture-eight'),
  [1, 3, 5, 7, 0, 2, 4, 6],
  8,
)

function solutionCells(puzzle: StarBattlePuzzle): readonly number[] {
  return puzzle.solution.map((col, row) => row * puzzle.n + col)
}

function nonSolutionCells(puzzle: StarBattlePuzzle): readonly number[] {
  const stars = new Set(solutionCells(puzzle))
  return Array.from({ length: puzzle.n * puzzle.n }, (_, index) => index).filter(
    (index) => !stars.has(index),
  )
}

// --------------------------------------------------------------------------------------
// Fake worker endpoints (one per launch, mirroring gameStore.test.ts)
// --------------------------------------------------------------------------------------

interface FakeWorker {
  readonly posted: StarBattleWorkerCommand[]
  setHandlers: (handlers: {
    message: (event: MessageEvent<unknown>) => void
    error: (event: ErrorEvent) => void
    messageError: (event: MessageEvent<unknown>) => void
  }) => void
  postMessage: (message: StarBattleWorkerCommand) => void
  terminate: () => void
  respond: (response: StarBattleWorkerResponse) => void
  fail: (message: string) => void
}

function createFakeWorker(): FakeWorker {
  const posted: StarBattleWorkerCommand[] = []
  const messageListeners: ((event: MessageEvent<unknown>) => void)[] = []
  const errorListeners: ((event: ErrorEvent) => void)[] = []
  const worker: FakeWorker = {
    posted,
    setHandlers(handlers) {
      messageListeners.push(handlers.message)
      errorListeners.push(handlers.error)
    },
    postMessage(message) {
      posted.push(message)
    },
    terminate() {},
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

function lastRequest(worker: FakeWorker): Extract<StarBattleWorkerCommand, { type: 'star-generation/request' }> {
  for (let index = worker.posted.length - 1; index >= 0; index -= 1) {
    const command = worker.posted[index]
    if (command !== undefined && command.type === 'star-generation/request') {
      return command
    }
  }
  throw new Error('no star-generation request was posted')
}

// --------------------------------------------------------------------------------------
// Fake timers and visibility (mirroring gameStore.test.ts)
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

interface FakeVisibility extends VisibilityProbe {
  setVisible: (next: boolean) => void
  fire: () => void
}

function createFakeVisibility(visible = true): FakeVisibility {
  let isVisible = visible
  const handlers = new Set<() => void>()
  return {
    isVisible: () => isVisible,
    subscribe(handler) {
      handlers.add(handler)
      return () => {
        handlers.delete(handler)
      }
    },
    setVisible(next) {
      isVisible = next
    },
    fire() {
      for (const handler of [...handlers]) {
        handler()
      }
    },
  }
}

// --------------------------------------------------------------------------------------
// Harness
// --------------------------------------------------------------------------------------

interface Harness {
  readonly store: ReturnType<typeof createStarBattleStore>
  readonly workers: readonly FakeWorker[]
  readonly timers: FakeTimers
  readonly visibility: FakeVisibility
  snapshot: () => StarBattleSnapshot
}

function createHarness(overrides: Partial<StarBattleStoreOptions> = {}): Harness {
  const workers: FakeWorker[] = []
  const timers = createFakeTimers()
  const visibility = createFakeVisibility()
  const store = createStarBattleStore({
    side: SIDE,
    // Availability is 'unmeasured' forever unless a test injects its own
    // probe: no existing test sees publishes it did not ask for, and no test
    // ever runs the real wall-clock-bounded engine probe.
    feasibilityProbe: () => new Promise(() => {}),
    workerFactory: () => {
      const worker = createFakeWorker()
      workers.push(worker)
      return worker
    },
    interludeMs: 2_500,
    setTimer: timers.set,
    clearTimer: timers.clear,
    visibility,
    ...overrides,
  })
  return {
    store,
    workers,
    timers,
    visibility,
    snapshot: () => store.getSnapshot(),
  }
}

function succeed(worker: FakeWorker, puzzle: StarBattlePuzzle, waves = 2): void {
  const request = lastRequest(worker)
  worker.respond({
    type: 'star-generation/succeeded',
    requestId: request.requestId,
    generationId: request.generationId,
    puzzle,
    waves,
    difficulty: request.difficulty,
  })
}

function fail(worker: FakeWorker, reason = 'worker-exception', message = 'boom'): void {
  const request = lastRequest(worker)
  worker.respond({
    type: 'star-generation/failed',
    requestId: request.requestId,
    generationId: request.generationId,
    failure: { reason, message, details: {} },
  })
}

afterEach(() => {
  window.localStorage.clear()
})

// ======================================================================================
// Generation
// ======================================================================================

describe('star battle store: generation', () => {
  it('starts idle, generates on demand, and plays the certified board', () => {
    const harness = createHarness()
    expect(harness.snapshot().status).toBe('idle')
    expect(harness.snapshot().puzzle).toBeNull()

    harness.store.actions.startNewRound('star-fixture-a')
    expect(harness.snapshot().status).toBe('generating')
    expect(harness.workers).toHaveLength(1)
    const request = lastRequest(harness.workers[0]!)
    expect(request.n).toBe(SIDE)
    expect(request.seed).toBe(normalizeRandomSeed('star-fixture-a'))
    expect(request.difficulty).toBe('starter')

    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_A)
    expect(harness.snapshot().lives).toBe(5)
    expect(harness.snapshot().maxLives).toBe(5)
  })

  it('a difficulty change persists the tier and re-generates with the same seed', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)

    harness.store.actions.setDifficulty('challenging')

    expect(window.localStorage.getItem('minegram.star-battle.difficulty')).toBe('challenging')
    expect(harness.snapshot().difficulty).toBe('challenging')
    expect(harness.workers).toHaveLength(2)
    const request = lastRequest(harness.workers[1]!)
    expect(request.difficulty).toBe('challenging')
    expect(request.seed).toBe(normalizeRandomSeed('star-fixture-a'))

    succeed(harness.workers[1]!, PUZZLE_B)
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_B)
  })

  it('replacing a playing round discards the old board instead of refusing the new one', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().status).toBe('playing')

    harness.store.actions.setDifficulty('steady')
    succeed(harness.workers[1]!, PUZZLE_B)

    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_B)
    expect(harness.snapshot().marks).toHaveLength(SIDE * SIDE)
  })

  it('ignores a difficulty change that arrives while a round is printing', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    harness.store.actions.setDifficulty('steady')

    expect(harness.workers).toHaveLength(1)
    expect(harness.snapshot().difficulty).toBe('steady')
  })

  it('drops a stale generation result whose identity matches no in-flight request', () => {
    const harness = createHarness()
    const listener = vi.fn()
    harness.store.subscribe(listener)
    harness.store.actions.startNewRound('star-fixture-a')

    const worker = harness.workers[0]!
    const request = lastRequest(worker)
    // An answer with a foreign generationId never applies...
    worker.respond({
      type: 'star-generation/succeeded',
      requestId: request.requestId,
      generationId: request.generationId + 999,
      puzzle: PUZZLE_B,
      waves: 2,
      difficulty: 'starter',
    })
    expect(harness.snapshot().status).toBe('generating')
    expect(harness.snapshot().puzzle).toBeNull()

    // ...and a late duplicate from a superseded Worker is dropped too.
    succeed(worker, PUZZLE_A)
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_A)
    const version = harness.snapshot().version
    worker.respond({
      type: 'star-generation/succeeded',
      requestId: request.requestId,
      generationId: request.generationId,
      puzzle: PUZZLE_B,
      waves: 2,
      difficulty: 'starter',
    })
    expect(harness.snapshot().version).toBe(version)
    expect(harness.snapshot().puzzle).toBe(PUZZLE_A)
    // start + the applying answer; both stale replies published nothing.
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('a throwing generator surfaces a failure state, not a board', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    fail(harness.workers[0]!)

    expect(harness.snapshot().status).toBe('idle')
    expect(harness.snapshot().puzzle).toBeNull()
    expect(harness.snapshot().failure).toMatchObject({ reason: 'worker-exception' })
  })

  it('retry reuses the exact seed of the failed request', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    fail(harness.workers[0]!)

    harness.store.actions.retry()
    expect(harness.workers).toHaveLength(2)
    expect(lastRequest(harness.workers[1]!).seed).toBe(normalizeRandomSeed('star-fixture-a'))

    succeed(harness.workers[1]!, PUZZLE_A)
    expect(harness.snapshot().failure).toBeNull()
    expect(harness.snapshot().status).toBe('playing')
  })

  it('an unreadable worker message is a failure with the invalid-worker-response reason', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    harness.workers[0]!.respond({ nonsense: true } as unknown as StarBattleWorkerResponse)

    expect(harness.snapshot().failure).toMatchObject({ reason: 'invalid-worker-response' })
    expect(harness.snapshot().status).toBe('idle')
  })

  it('a worker fault event is a failure with the worker-error reason', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    harness.workers[0]!.fail('worker exploded')

    expect(harness.snapshot().failure).toMatchObject({ reason: 'worker-error' })
  })

  it('an unparseable seed is reported as a failure state, never thrown', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('')

    expect(harness.snapshot().failure).toMatchObject({ reason: 'invalid-settings' })
    expect(harness.workers).toHaveLength(0)
  })

  it('backToPicker cancels in-flight generation and returns to idle', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    harness.store.actions.backToPicker()

    expect(harness.snapshot().status).toBe('idle')
    expect(harness.snapshot().puzzle).toBeNull()
    expect(harness.snapshot().failure).toBeNull()
    expect(harness.workers[0]!.posted.some((command) => command.type === 'star-generation/cancel')).toBe(true)

    // A late answer to the cancelled request is dropped.
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().status).toBe('idle')
  })
})

// ======================================================================================
// Board size
// ======================================================================================

describe('star battle store: board size', () => {
  it('setSide refuses a side below MIN_STAR_SIDE or above MAX_STAR_SIDE without throwing or launching', () => {
    const harness = createHarness()

    expect(() => harness.store.actions.setSide(MIN_STAR_SIDE - 1)).not.toThrow()
    expect(() => harness.store.actions.setSide(MAX_STAR_SIDE + 1)).not.toThrow()
    expect(() => harness.store.actions.setSide(6.5)).not.toThrow()

    expect(harness.workers).toHaveLength(0)
    expect(harness.snapshot().status).toBe('idle')
    expect(harness.snapshot().side).toBe(SIDE)
    expect(window.localStorage.getItem('minegram.star-battle.side')).toBeNull()
  })

  it('setSide accepts the boundary sides MIN_STAR_SIDE and MAX_STAR_SIDE', () => {
    const harness = createHarness()

    harness.store.actions.setSide(MIN_STAR_SIDE)
    expect(harness.workers).toHaveLength(1)
    expect(lastRequest(harness.workers[0]!).n).toBe(MIN_STAR_SIDE)
    succeed(harness.workers[0]!, PUZZLE_A)

    harness.store.actions.setSide(MAX_STAR_SIDE)
    expect(harness.workers).toHaveLength(2)
    expect(lastRequest(harness.workers[1]!).n).toBe(MAX_STAR_SIDE)
  })

  it('setSide prints a board at the new side, keeping the seed and the tier', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)
    harness.store.actions.setDifficulty('challenging')
    succeed(harness.workers[1]!, PUZZLE_B)

    harness.store.actions.setSide(8)

    expect(harness.snapshot().side).toBe(8)
    expect(harness.workers).toHaveLength(3)
    const request = lastRequest(harness.workers[2]!)
    expect(request.n).toBe(8)
    expect(request.seed).toBe(normalizeRandomSeed('star-fixture-a'))
    expect(request.difficulty).toBe('challenging')

    succeed(harness.workers[2]!, PUZZLE_EIGHT)
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_EIGHT)
    expect(harness.snapshot().puzzle?.n).toBe(8)
  })

  it('setSide is a no-op while a round is generating', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    harness.store.actions.setSide(8)

    expect(harness.workers).toHaveLength(1)
    expect(lastRequest(harness.workers[0]!).n).toBe(SIDE)
    expect(harness.snapshot().side).toBe(8)
    expect(window.localStorage.getItem('minegram.star-battle.side')).toBe('8')

    // The in-flight round still prints at the old side; the persisted side
    // applies to the next launch.
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().puzzle?.n).toBe(SIDE)
  })

  it('setSide persists the side and a freshly created store prints at it', () => {
    const harness = createHarness()
    harness.store.actions.setSide(6)
    expect(window.localStorage.getItem('minegram.star-battle.side')).toBe('6')

    // `side: undefined` overrides the harness default, so the store falls
    // back to the persisted preference — a player re-entering the game.
    const returning = createHarness({ side: undefined })
    returning.store.actions.startNewRound('star-fixture-a')
    expect(returning.snapshot().side).toBe(6)
    expect(lastRequest(returning.workers[0]!).n).toBe(6)
  })
})

// ======================================================================================
// Lives setting
// ======================================================================================

describe('star battle store: lives setting', () => {
  it('setMaxLives refuses a value below MIN_STAR_LIVES or above MAX_STAR_LIVES without throwing or launching', () => {
    const harness = createHarness()

    expect(() => harness.store.actions.setMaxLives(MIN_STAR_LIVES - 1)).not.toThrow()
    expect(() => harness.store.actions.setMaxLives(MAX_STAR_LIVES + 1)).not.toThrow()
    expect(() => harness.store.actions.setMaxLives(2.5)).not.toThrow()
    expect(() => harness.store.actions.setMaxLives(Number.NaN)).not.toThrow()

    expect(harness.workers).toHaveLength(0)
    expect(harness.snapshot().status).toBe('idle')
    expect(harness.snapshot().maxLives).toBe(5)
    expect(window.localStorage.getItem('minegram.star-battle.lives')).toBeNull()
  })

  it('setMaxLives accepts the boundary values MIN_STAR_LIVES and MAX_STAR_LIVES', () => {
    const harness = createHarness()

    harness.store.actions.setMaxLives(MIN_STAR_LIVES)
    expect(harness.workers).toHaveLength(1)
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().lives).toBe(MIN_STAR_LIVES)

    harness.store.actions.setMaxLives(MAX_STAR_LIVES)
    expect(harness.workers).toHaveLength(2)
    succeed(harness.workers[1]!, PUZZLE_B)
    expect(harness.snapshot().lives).toBe(MAX_STAR_LIVES)
    expect(harness.snapshot().maxLives).toBe(MAX_STAR_LIVES)
  })

  it('setMaxLives relaunches with the SAME seed and tier, and the fresh round starts at the new maximum', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)
    harness.store.actions.setDifficulty('challenging')
    succeed(harness.workers[1]!, PUZZLE_B)

    // Spend a life, then raise the maximum: the relaunch must restore lives
    // to the new maximum, not carry the spent total over.
    const [blankIndex] = nonSolutionCells(PUZZLE_B)
    harness.store.actions.onMark(Math.floor(blankIndex! / SIDE), blankIndex! % SIDE, 'star')
    expect(harness.snapshot().lives).toBe(4)

    harness.store.actions.setMaxLives(7)

    expect(harness.snapshot().maxLives).toBe(7)
    expect(harness.workers).toHaveLength(3)
    const request = lastRequest(harness.workers[2]!)
    expect(request.seed).toBe(normalizeRandomSeed('star-fixture-a'))
    expect(request.difficulty).toBe('challenging')
    expect(request.n).toBe(SIDE)

    succeed(harness.workers[2]!, PUZZLE_B)
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().lives).toBe(7)
    expect(harness.snapshot().mistakes).toBe(0)
  })

  it('setMaxLives is a no-op while a round is generating', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    harness.store.actions.setMaxLives(8)

    expect(harness.workers).toHaveLength(1)
    expect(harness.snapshot().maxLives).toBe(8)
    expect(window.localStorage.getItem('minegram.star-battle.lives')).toBe('8')

    // The in-flight round still starts at the old maximum; the persisted
    // maximum applies to the next launch.
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().lives).toBe(5)
  })

  it('setMaxLives persists the maximum and a freshly created store reads it back', () => {
    const harness = createHarness()
    harness.store.actions.setMaxLives(6)
    expect(window.localStorage.getItem('minegram.star-battle.lives')).toBe('6')

    // `maxLives: undefined` overrides the harness default, so the store
    // falls back to the persisted preference — a player re-entering the game.
    const returning = createHarness({ maxLives: undefined })
    expect(returning.snapshot().maxLives).toBe(6)
    returning.store.actions.startNewRound('star-fixture-a')
    succeed(returning.workers[0]!, PUZZLE_A)
    expect(returning.snapshot().lives).toBe(6)
  })

  it('an explicit maxLives option wins over the persisted preference', () => {
    window.localStorage.setItem('minegram.star-battle.lives', '8')
    const harness = createHarness({ maxLives: 2 })
    expect(harness.snapshot().maxLives).toBe(2)
    harness.store.actions.startNewRound('seed')
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().lives).toBe(2)
  })
})

// ======================================================================================
// Picker entry
// ======================================================================================

describe('star battle store: picker entry', () => {
  it('two consecutive picker entries print different boards, not a replay of the authored seed', () => {
    const harness = createHarness()
    const authored = normalizeRandomSeed('star-fixture-a')
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)

    harness.store.actions.backToPicker()
    harness.store.actions.startNewRound()
    const firstEntry = lastRequest(harness.workers[1]!).seed
    expect(firstEntry).not.toBe(authored)
    expect(firstEntry).toBe(deriveRandomSeed(authored, STAR_PICKER_ENTRY_SEED_LABEL))
    succeed(harness.workers[1]!, PUZZLE_A)

    // The player leaves and picks Star Battle again: a fresh board, never a replay.
    harness.store.actions.backToPicker()
    harness.store.actions.startNewRound()
    const secondEntry = lastRequest(harness.workers[2]!).seed
    expect(secondEntry).not.toBe(firstEntry)
    expect(secondEntry).not.toBe(authored)
    expect(secondEntry).toBe(deriveRandomSeed(firstEntry, STAR_PICKER_ENTRY_SEED_LABEL))
  })

  it('the picker-entry derivation is a pure function of the prior seed and its label', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound()
    expect(lastRequest(harness.workers[0]!).seed).toBe(
      deriveRandomSeed(0, STAR_PICKER_ENTRY_SEED_LABEL),
    )
    succeed(harness.workers[0]!, PUZZLE_A)

    // Same inputs, a second store built and driven identically: same seed.
    const twin = createHarness()
    twin.store.actions.startNewRound()
    expect(lastRequest(twin.workers[0]!).seed).toBe(
      deriveRandomSeed(0, STAR_PICKER_ENTRY_SEED_LABEL),
    )
    twin.store.dispose()
    harness.store.dispose()
  })

  it('an explicit seed is honoured and becomes the authored seed for later entries', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('my seed')
    expect(lastRequest(harness.workers[0]!).seed).toBe(normalizeRandomSeed('my seed'))
    succeed(harness.workers[0]!, PUZZLE_A)

    // A later no-argument picker entry derives from the explicit seed, not from 0.
    harness.store.actions.backToPicker()
    harness.store.actions.startNewRound()
    const derived = normalizeRandomSeed('my seed')
    expect(lastRequest(harness.workers[1]!).seed).toBe(
      deriveRandomSeed(derived, STAR_PICKER_ENTRY_SEED_LABEL),
    )
  })

  it('a picker entry after a failure does not resurrect the failed request: retry still owns that seed', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    fail(harness.workers[0]!)

    harness.store.actions.startNewRound()
    const entrySeed = lastRequest(harness.workers[1]!).seed
    expect(entrySeed).not.toBe(normalizeRandomSeed('star-fixture-a'))
    fail(harness.workers[1]!)

    // Retry means "try that again": the failed request's exact seed, even here.
    harness.store.actions.retry()
    expect(lastRequest(harness.workers[2]!).seed).toBe(entrySeed)
  })
})

// ======================================================================================
// Marking
// ======================================================================================

describe('star battle store: marking', () => {
  function startPlaying(harness: Harness, puzzle: StarBattlePuzzle = PUZZLE_A): void {
    harness.store.actions.startNewRound('seed')
    succeed(harness.workers[0]!, puzzle)
  }

  it('round-trips the UI mark vocabulary through the seam into locked numeric marks', () => {
    const harness = createHarness()
    startPlaying(harness)
    const [starIndex] = solutionCells(PUZZLE_A)
    const row = Math.floor(starIndex! / SIDE)
    const col = starIndex! % SIDE

    harness.store.actions.onMark(row, col, 'star')

    expect(harness.snapshot().marks[starIndex!]).toBe(3) // STAR_LOCKED
    expect(harness.snapshot().lives).toBe(5)
    expect(harness.snapshot().mistakes).toBe(0)
    expect(harness.snapshot().streak).toBe(1)
  })

  it('a correct blank assertion stays the player\'s own mark with no charge', () => {
    const harness = createHarness()
    startPlaying(harness)
    const [blankIndex] = nonSolutionCells(PUZZLE_A)

    harness.store.actions.onMark(Math.floor(blankIndex! / SIDE), blankIndex! % SIDE, 'blank')

    // STAR_BLANK (1), not STAR_LOCKED (3): a correct blank is retractable.
    expect(harness.snapshot().marks[blankIndex!]).toBe(1)
    expect(harness.snapshot().lives).toBe(5)
    expect(harness.snapshot().streak).toBe(0)
  })

  it('a wrong assertion costs one point and stays unlocked so it can be fixed', () => {
    const harness = createHarness()
    startPlaying(harness)
    const [blankIndex] = nonSolutionCells(PUZZLE_A)

    harness.store.actions.onMark(Math.floor(blankIndex! / SIDE), blankIndex! % SIDE, 'star')

    expect(harness.snapshot().marks[blankIndex!]).toBe(2) // STAR_STAR, unlocked
    expect(harness.snapshot().lives).toBe(4)
    expect(harness.snapshot().mistakes).toBe(1)
    expect(harness.snapshot().streak).toBe(0)
  })

  it('a locked cell is silently inert: no dispatch, no charge, no announcement', () => {
    const harness = createHarness()
    const listener = vi.fn()
    harness.store.subscribe(listener)
    startPlaying(harness)
    const [starIndex] = solutionCells(PUZZLE_A)
    harness.store.actions.onMark(Math.floor(starIndex! / SIDE), starIndex! % SIDE, 'star')
    const versionAfterLock = harness.snapshot().version

    harness.store.actions.onMark(Math.floor(starIndex! / SIDE), starIndex! % SIDE, 'star')
    harness.store.actions.onMark(Math.floor(starIndex! / SIDE), starIndex! % SIDE, 'blank')

    expect(harness.snapshot().version).toBe(versionAfterLock)
    expect(harness.snapshot().lives).toBe(5)
    // start + accept + lock; both re-assertions dispatched nothing.
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('out-of-bounds requests are inert', () => {
    const harness = createHarness()
    startPlaying(harness)
    const version = harness.snapshot().version

    harness.store.actions.onMark(-1, 0, 'star')
    harness.store.actions.onMark(0, SIDE, 'star')

    expect(harness.snapshot().version).toBe(version)
  })

  it('onMark(row, col, null) retracts: the cell returns to unmarked, free, with no refund', () => {
    const harness = createHarness()
    startPlaying(harness)
    const [blankIndex] = nonSolutionCells(PUZZLE_A)
    const row = Math.floor(blankIndex! / SIDE)
    const col = blankIndex! % SIDE

    harness.store.actions.onMark(row, col, 'star')
    expect(harness.snapshot().marks[blankIndex!]).toBe(2) // STAR_STAR, wrong
    expect(harness.snapshot().lives).toBe(4)

    harness.store.actions.onMark(row, col, null)

    expect(harness.snapshot().marks[blankIndex!]).toBe(0) // STAR_UNMARKED
    expect(harness.snapshot().lives).toBe(4) // free, and the earlier charge is not refunded
    expect(harness.snapshot().mistakes).toBe(1)
  })

  it('the wire mapping covers all three values: blank and star assert, null retracts', () => {
    const harness = createHarness()
    startPlaying(harness)
    const stars = solutionCells(PUZZLE_A)
    const blanks = nonSolutionCells(PUZZLE_A)

    // 'blank' on a blank cell writes a player blank: free, unlocked.
    harness.store.actions.onMark(0, 0, 'blank')
    expect(harness.snapshot().marks[0]).toBe(1) // STAR_BLANK, retractable
    // 'star' on a star cell locks it.
    harness.store.actions.onMark(Math.floor(stars[0]! / SIDE), stars[0]! % SIDE, 'star')
    expect(harness.snapshot().marks[stars[0]!]).toBe(3)
    // 'star' on another blank cell is wrong; null retracts it to unmarked for
    // free. The target must be a cell the correct star's auto-fill did NOT
    // already lock — pick the first still-unmarked blank.
    const target = blanks.find((index) => harness.snapshot().marks[index] === 0)!
    harness.store.actions.onMark(Math.floor(target / SIDE), target % SIDE, 'star')
    expect(harness.snapshot().marks[target]).toBe(2)
    const livesAfterWrong = harness.snapshot().lives
    harness.store.actions.onMark(Math.floor(target / SIDE), target % SIDE, null)
    expect(harness.snapshot().marks[target]).toBe(0)
    expect(harness.snapshot().lives).toBe(livesAfterWrong)
  })

  it("a locked cell's retract never reaches the reducer: no dispatch, no charge, no announcement", () => {
    const harness = createHarness()
    const listener = vi.fn()
    harness.store.subscribe(listener)
    startPlaying(harness)
    const [starIndex] = solutionCells(PUZZLE_A)
    const row = Math.floor(starIndex! / SIDE)
    const col = starIndex! % SIDE
    harness.store.actions.onMark(row, col, 'star')
    const versionAfterLock = harness.snapshot().version

    harness.store.actions.onMark(row, col, null)

    expect(harness.snapshot().version).toBe(versionAfterLock)
    expect(harness.snapshot().marks[starIndex!]).toBe(3)
    // start + accept + lock; the retract dispatched nothing.
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it('lives clamp at zero and zero ends the game', () => {
    const harness = createHarness()
    startPlaying(harness)
    const wrongCells = nonSolutionCells(PUZZLE_A).slice(0, 5)

    for (const index of wrongCells) {
      harness.store.actions.onMark(Math.floor(index / SIDE), index % SIDE, 'star')
    }

    expect(harness.snapshot().status).toBe('lost')
    expect(harness.snapshot().lives).toBe(0)
    expect(harness.snapshot().mistakes).toBe(5)

    // A lost round accepts nothing further.
    const version = harness.snapshot().version
    harness.store.actions.onMark(0, 0, 'blank')
    expect(harness.snapshot().version).toBe(version)
  })

  it('marks are ignored while a round is generating', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('seed')
    const version = harness.snapshot().version
    harness.store.actions.onMark(0, 0, 'star')
    expect(harness.snapshot().version).toBe(version)
  })
})

// ======================================================================================
// Win interlude
// ======================================================================================

describe('star battle store: win interlude', () => {
  function winRound(harness: Harness, puzzle: StarBattlePuzzle = PUZZLE_A): void {
    harness.store.actions.startNewRound('seed')
    succeed(harness.workers[0]!, puzzle)
    for (const index of solutionCells(puzzle)) {
      harness.store.actions.onMark(Math.floor(index / puzzle.n), index % puzzle.n, 'star')
    }
    for (const index of nonSolutionCells(puzzle)) {
      harness.store.actions.onMark(Math.floor(index / puzzle.n), index % puzzle.n, 'blank')
    }
  }

  it('winning holds for the interlude and then generates the next round with a derived seed', () => {
    const harness = createHarness()
    const firstSeed = normalizeRandomSeed('seed')
    winRound(harness)
    expect(harness.snapshot().status).toBe('won')
    expect(harness.timers.recorded).toEqual([2_500])
    expect(harness.workers).toHaveLength(1)

    harness.timers.runAll()

    expect(harness.workers).toHaveLength(2)
    const request = lastRequest(harness.workers[1]!)
    expect(request.seed).toBe(deriveRandomSeed(firstSeed, STAR_NEXT_ROUND_SEED_LABEL))
    expect(request.difficulty).toBe('starter')
    expect(harness.timers.pending()).toBe(0)

    succeed(harness.workers[1]!, PUZZLE_B)
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_B)
  })

  it('the interlude never elapses while the document is hidden', () => {
    const harness = createHarness()
    harness.visibility.setVisible(false)
    winRound(harness)
    expect(harness.snapshot().status).toBe('won')
    expect(harness.timers.pending()).toBe(0)

    // Hidden between arming and firing must not burn the round either.
    harness.visibility.setVisible(true)
    harness.visibility.fire()
    expect(harness.timers.pending()).toBe(1)
    harness.visibility.setVisible(false)
    harness.timers.runAll()
    expect(harness.workers).toHaveLength(1)

    // Shown again: the listener re-arms the handoff without human input.
    harness.visibility.setVisible(true)
    harness.visibility.fire()
    expect(harness.timers.pending()).toBe(1)
    harness.timers.runAll()
    expect(harness.workers).toHaveLength(2)
    expect(harness.snapshot().status).toBe('generating')
  })

  it('the banner accelerator starts the next round immediately and clears the timer', () => {
    const harness = createHarness()
    const firstSeed = normalizeRandomSeed('seed')
    winRound(harness)

    harness.store.actions.nextRound()

    expect(harness.timers.pending()).toBe(0)
    expect(harness.workers).toHaveLength(2)
    expect(lastRequest(harness.workers[1]!).seed).toBe(
      deriveRandomSeed(firstSeed, STAR_NEXT_ROUND_SEED_LABEL),
    )

    succeed(harness.workers[1]!, PUZZLE_B)
    expect(harness.snapshot().status).toBe('playing')
  })

  it('a lost round restarts from the banner with the same seed', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)
    for (const index of nonSolutionCells(PUZZLE_A).slice(0, 5)) {
      harness.store.actions.onMark(Math.floor(index / SIDE), index % SIDE, 'star')
    }
    expect(harness.snapshot().status).toBe('lost')

    harness.store.actions.nextRound()

    expect(harness.workers).toHaveLength(2)
    expect(lastRequest(harness.workers[1]!).seed).toBe(normalizeRandomSeed('star-fixture-a'))
    succeed(harness.workers[1]!, PUZZLE_A)
    expect(harness.snapshot().status).toBe('playing')
  })

  it('a generation failure during the handoff keeps the won banner and allows retry', () => {
    const harness = createHarness()
    winRound(harness)
    harness.timers.runAll()
    fail(harness.workers[1]!)

    expect(harness.snapshot().status).toBe('won')
    expect(harness.snapshot().failure).toMatchObject({ reason: 'worker-exception' })

    harness.store.actions.retry()
    expect(harness.workers).toHaveLength(3)
    succeed(harness.workers[2]!, PUZZLE_B)
    expect(harness.snapshot().status).toBe('playing')
  })
})

// ======================================================================================
// Lifecycle
// ======================================================================================

describe('star battle store: lifecycle', () => {
  it('subscribe returns an unsubscribe that actually detaches', () => {
    const harness = createHarness()
    const listener = vi.fn()
    const unsubscribe = harness.store.subscribe(listener)
    harness.store.actions.startNewRound('seed')
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
    unsubscribe()
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('dispose tears the store down and refuses later actions', () => {
    const harness = createHarness()
    harness.store.actions.startNewRound('seed')
    harness.store.dispose()

    harness.store.actions.startNewRound('other-seed')
    succeed(harness.workers[0]!, PUZZLE_A)
    expect(harness.snapshot().status).toBe('generating')
  })

  it('a store with an explicit initial difficulty prefers it over the persisted one', () => {
    window.localStorage.setItem('minegram.star-battle.difficulty', 'challenging')
    const harness = createHarness({ difficulty: 'steady' })
    expect(harness.snapshot().difficulty).toBe('steady')
  })
})

// ======================================================================================
// Tier availability
// ======================================================================================

interface Deferred<T> {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (error: unknown) => void
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A flush long enough for the store's probe `.then` chain to run. */
async function flushProbe(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function feasibilityEntry(
  status: StarTierFeasibilityStatus,
  samples: number,
  hits: number,
): StarTierFeasibility {
  return Object.freeze({
    status,
    basis: 'measured-walks',
    samples,
    hits,
    rate95: Object.freeze([0, 1]) as readonly [number, number],
    generationSuccess: null,
  })
}

/**
 * A full five-tier report: every tier `available` unless overridden. Tests
 * assert status transitions and their consequences — never wall-clock sample
 * counts, which the probe's own documentation says vary with machine load.
 */
function feasibilityReport(
  overrides: Partial<Record<StarDifficulty, StarTierFeasibility>> = {},
): StarTierFeasibilityReport {
  return Object.freeze({
    starter: overrides.starter ?? feasibilityEntry('available', 8, 8),
    steady: overrides.steady ?? feasibilityEntry('available', 8, 8),
    challenging: overrides.challenging ?? feasibilityEntry('available', 48, 48),
    expert: overrides.expert ?? feasibilityEntry('available', 48, 48),
    contradiction: overrides.contradiction ?? feasibilityEntry('available', 48, 48),
  })
}

const UNAVAILABLE = (samples: number): StarTierFeasibility =>
  feasibilityEntry('unavailable', samples, 0)

describe('star battle store: tier availability', () => {
  it('carries unmeasured availability until the probe resolves, then republishes the measured answer', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({ feasibilityProbe: () => gate.promise })
    expect(harness.snapshot().tierAvailability.contradiction.status).toBe('unmeasured')

    let publishes = 0
    harness.store.subscribe(() => {
      publishes += 1
    })
    gate.resolve(feasibilityReport({ contradiction: UNAVAILABLE(48) }))
    await flushProbe()

    expect(publishes).toBeGreaterThan(0)
    expect(harness.snapshot().tierAvailability.contradiction).toEqual({
      status: 'unavailable',
      samples: 48,
      hits: 0,
    })
    expect(harness.snapshot().tierAvailability.expert.status).toBe('available')
  })

  it('re-warms on a side change and drops a stale side’s late resolution', async () => {
    const probedSides: number[] = []
    const gates = new Map<number, Deferred<StarTierFeasibilityReport>>()
    const harness = createHarness({
      feasibilityProbe: (n) => {
        probedSides.push(n)
        const gate = createDeferred<StarTierFeasibilityReport>()
        gates.set(n, gate)
        return gate.promise
      },
    })
    // Warmed at construction for the initial side.
    expect(probedSides).toEqual([SIDE])

    harness.store.actions.setSide(8)
    expect(probedSides).toEqual([SIDE, 8])
    // setSide launched a generation at the new side; it stays in flight.

    let publishes = 0
    harness.store.subscribe(() => {
      publishes += 1
    })
    gates.get(8)!.resolve(feasibilityReport())
    await flushProbe()
    expect(harness.snapshot().tierAvailability.expert.status).toBe('available')
    expect(harness.snapshot().side).toBe(8)
    expect(publishes).toBeGreaterThan(0)

    // The old side's probe landing late must not republish or retarget.
    const settled = publishes
    gates.get(SIDE)!.resolve(feasibilityReport({ contradiction: UNAVAILABLE(48) }))
    await flushProbe()
    expect(publishes).toBe(settled)
    expect(harness.snapshot().difficulty).toBe('starter')
  })

  it('recovers a dead selection parked on a failure: retargets to the nearest working tier and prints it', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({
      difficulty: 'contradiction',
      feasibilityProbe: () => gate.promise,
    })
    harness.store.actions.startNewRound('star-fixture-a')
    fail(harness.workers[0]!)
    expect(harness.snapshot().failure).not.toBeNull()

    gate.resolve(feasibilityReport({ contradiction: UNAVAILABLE(48) }))
    await flushProbe()

    // The preference moved to the nearest tier below that prints, persisted…
    expect(harness.snapshot().difficulty).toBe('expert')
    expect(window.localStorage.getItem('minegram.star-battle.difficulty')).toBe('expert')
    // …and the player is not parked on the failure: the fallback board is
    // already printing, so the dead selection never strands them.
    expect(harness.workers).toHaveLength(2)
    const recovery = lastRequest(harness.workers[1]!)
    expect(recovery.difficulty).toBe('expert')
    expect(recovery.n).toBe(SIDE)
    expect(harness.snapshot().failure).toBeNull()
    expect(harness.snapshot().status).toBe('generating')
  })

  it('recovers when the failure lands after the measurement', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({
      difficulty: 'contradiction',
      feasibilityProbe: () => gate.promise,
    })
    harness.store.actions.startNewRound('star-fixture-a')

    gate.resolve(feasibilityReport({ contradiction: UNAVAILABLE(48) }))
    await flushProbe()
    // The request is still printing: the preference moves, the round is not yanked.
    expect(harness.snapshot().difficulty).toBe('expert')
    expect(harness.workers).toHaveLength(1)

    fail(harness.workers[0]!)
    // The failure this measurement explains recovers immediately.
    expect(harness.workers).toHaveLength(2)
    expect(lastRequest(harness.workers[1]!).difficulty).toBe('expert')
    expect(harness.snapshot().failure).toBeNull()
  })

  it('never yanks a playing round: the retarget applies to the next launch', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({
      difficulty: 'starter',
      feasibilityProbe: () => gate.promise,
    })
    harness.store.actions.startNewRound('star-fixture-a')
    succeed(harness.workers[0]!, PUZZLE_A)

    gate.resolve(feasibilityReport({ starter: UNAVAILABLE(8) }))
    await flushProbe()

    // The live board is untouched…
    expect(harness.snapshot().status).toBe('playing')
    expect(harness.snapshot().puzzle).toBe(PUZZLE_A)
    expect(harness.workers).toHaveLength(1)
    // …but the dead preference moved on for the next launch.
    expect(harness.snapshot().difficulty).toBe('steady')
  })

  it('prefers the nearest working tier on either side when everything below is dead', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({
      difficulty: 'starter',
      feasibilityProbe: () => gate.promise,
    })
    harness.store.actions.startNewRound('star-fixture-a')
    fail(harness.workers[0]!)

    gate.resolve(
      feasibilityReport({
        starter: UNAVAILABLE(8),
        steady: UNAVAILABLE(8),
        challenging: UNAVAILABLE(48),
      }),
    )
    await flushProbe()

    expect(harness.snapshot().difficulty).toBe('expert')
  })

  it('measurement never blocks or delays the first board', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({ feasibilityProbe: () => gate.promise })
    harness.store.actions.startNewRound('star-fixture-a')
    // The probe is still pending and the board is already printing.
    expect(harness.workers).toHaveLength(1)
    expect(harness.snapshot().status).toBe('generating')
  })

  it('a failed probe stays optimistic and publishes nothing', async () => {
    const gate = createDeferred<StarTierFeasibilityReport>()
    const harness = createHarness({ feasibilityProbe: () => gate.promise })
    let publishes = 0
    harness.store.subscribe(() => {
      publishes += 1
    })
    gate.reject(new Error('probe boom'))
    await flushProbe()
    expect(publishes).toBe(0)
    expect(harness.snapshot().tierAvailability.contradiction.status).toBe('unmeasured')
  })
})
