import { afterEach, describe, expect, it, vi } from 'vitest'
import type { StarBattlePuzzle } from '../domain/starBattle'
import { deriveRandomSeed, normalizeRandomSeed } from '../engine/rng'
import {
  STAR_NEXT_ROUND_SEED_LABEL,
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
function makePuzzle(seed: number, solution: readonly number[]): StarBattlePuzzle {
  const colours = new Uint8Array(SIDE * SIDE)
  for (let row = 0; row < SIDE; row += 1) {
    for (let col = 0; col < SIDE; col += 1) {
      colours[row * SIDE + col] = row
    }
  }
  return Object.freeze({ n: SIDE, seed, colours, solution })
}

const PUZZLE_A = makePuzzle(normalizeRandomSeed('star-fixture-a'), [1, 3, 0, 2])
const PUZZLE_B = makePuzzle(normalizeRandomSeed('star-fixture-b'), [2, 0, 3, 1])

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
    expect(harness.snapshot().score).toBe(5)
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
    expect(harness.snapshot().score).toBe(5)
    expect(harness.snapshot().mistakes).toBe(0)
    expect(harness.snapshot().streak).toBe(1)
  })

  it('a correct blank assertion locks with no charge', () => {
    const harness = createHarness()
    startPlaying(harness)
    const [blankIndex] = nonSolutionCells(PUZZLE_A)

    harness.store.actions.onMark(Math.floor(blankIndex! / SIDE), blankIndex! % SIDE, 'blank')

    expect(harness.snapshot().marks[blankIndex!]).toBe(3)
    expect(harness.snapshot().score).toBe(5)
  })

  it('a wrong assertion costs one point and stays unlocked so it can be fixed', () => {
    const harness = createHarness()
    startPlaying(harness)
    const [blankIndex] = nonSolutionCells(PUZZLE_A)

    harness.store.actions.onMark(Math.floor(blankIndex! / SIDE), blankIndex! % SIDE, 'star')

    expect(harness.snapshot().marks[blankIndex!]).toBe(2) // STAR_STAR, unlocked
    expect(harness.snapshot().score).toBe(4)
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
    expect(harness.snapshot().score).toBe(5)
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
    expect(harness.snapshot().score).toBe(4)

    harness.store.actions.onMark(row, col, null)

    expect(harness.snapshot().marks[blankIndex!]).toBe(0) // STAR_UNMARKED
    expect(harness.snapshot().score).toBe(4) // free, and the earlier charge is not refunded
    expect(harness.snapshot().mistakes).toBe(1)
  })

  it('the wire mapping covers all three values: blank and star assert, null retracts', () => {
    const harness = createHarness()
    startPlaying(harness)
    const stars = solutionCells(PUZZLE_A)
    const blanks = nonSolutionCells(PUZZLE_A)

    // 'blank' on a blank cell locks it.
    harness.store.actions.onMark(0, 0, 'blank')
    expect(harness.snapshot().marks[0]).toBe(3)
    // 'star' on a star cell locks it.
    harness.store.actions.onMark(Math.floor(stars[0]! / SIDE), stars[0]! % SIDE, 'star')
    expect(harness.snapshot().marks[stars[0]!]).toBe(3)
    // 'star' on another blank cell is wrong; null retracts it to unmarked for free.
    const target = blanks[1]!
    harness.store.actions.onMark(Math.floor(target / SIDE), target % SIDE, 'star')
    expect(harness.snapshot().marks[target]).toBe(2)
    const scoreAfterWrong = harness.snapshot().score
    harness.store.actions.onMark(Math.floor(target / SIDE), target % SIDE, null)
    expect(harness.snapshot().marks[target]).toBe(0)
    expect(harness.snapshot().score).toBe(scoreAfterWrong)
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

  it('score clamps at zero and zero ends the game', () => {
    const harness = createHarness()
    startPlaying(harness)
    const wrongCells = nonSolutionCells(PUZZLE_A).slice(0, 5)

    for (const index of wrongCells) {
      harness.store.actions.onMark(Math.floor(index / SIDE), index % SIDE, 'star')
    }

    expect(harness.snapshot().status).toBe('lost')
    expect(harness.snapshot().score).toBe(0)
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
