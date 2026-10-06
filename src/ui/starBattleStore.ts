/**
 * Star Battle store: the UI-facing seam for the second game, mirroring
 * `src/ui/gameStore.ts` in shape and voice. It drives `starBattleReducer`
 * (which owns `StarBattleState`) and a Star Battle generation Worker
 * (`src/workers/starBattleWorker.ts`), and it owns everything the reducer
 * deliberately does not: the `generating` lifecycle flag, the difficulty
 * preference (persisted through the shared storage helper, never through
 * generation settings), the failure state, the win interlude with its page
 * visibility guard, and stale-result protection.
 *
 * The store is the string→structure seam for marks: `onMark` receives the
 * UI's `'blank' | 'star'` vocabulary plus row/column coordinates and is the
 * only place that flattens them into the reducer's `{ index, mark }` batch
 * cell. `null` is not part of the assertion contract — Star Battle marks are
 * assert-only, a wrong mark is corrected by asserting the right one, and the
 * reducer has no unmark action — so a `null` request is inert here, exactly as
 * the surface's guards already make it.
 *
 * Inert gestures never reach the reducer: `previewStarMarkBatch` reports
 * `affectedCount === 0` for a re-assertion or an all-locked batch, and the
 * store dispatches nothing in that case, so the gesture charges, mutates and
 * announces nothing (the same structural rule Minegram's drag controller
 * enforces). A reducer refusal that nonetheless arrives is dropped silently:
 * through this store's actions a refusal is unreachable, and the surface
 * renders the locked state itself.
 */
import {
  createInitialStarBattleState,
  previewStarMarkBatch,
  starBattleReducer,
  type StarBattleState,
  type StarBattleTransition,
} from '../application/starBattleReducer'
import type { GameFailureDiagnostics } from '../application/gameReducer'
import {
  DEFAULT_STAR_SIDE,
  assertStarBattlePuzzle,
  assertStarBattleSide,
  type StarBattlePuzzle,
} from '../domain/starBattle'
import type { StarDifficulty } from '../engine/starBattle/construct'
import { deriveRandomSeed, normalizeRandomSeed, type RandomSeed } from '../engine/rng'
import { readStored, writeStored } from './components/storage'
import {
  isStarBattleWorkerResponse,
  isStarDifficulty,
  type StarBattleRequestMessage,
  type StarBattleWorkerCommand,
} from '../workers/starBattleWorker'

// --------------------------------------------------------------------------------------
// Snapshot
// --------------------------------------------------------------------------------------

/**
 * The reducer's status union has no `generating`; the store owns that flag
 * and composes the single status the UI reads.
 */
export type StarBattleUiStatus = 'idle' | 'generating' | 'playing' | 'won' | 'lost'

/**
 * Everything the surface needs, projected. `puzzle` is `null` until a
 * certified board has arrived — the store never renders a board it has not
 * received as certified. `failure` carries the raw diagnostics whose
 * `reason` is a token of Minegram's existing failure vocabulary
 * (`copy.ts`'s `failure.reasons` table), so the UI localises it through the
 * same `failureCopy` machinery Minegram's failure card uses.
 */
export interface StarBattleSnapshot {
  readonly status: StarBattleUiStatus
  readonly puzzle: StarBattlePuzzle | null
  readonly marks: Uint8Array
  readonly score: number
  readonly mistakes: number
  readonly streak: number
  readonly difficulty: StarDifficulty
  readonly failure: GameFailureDiagnostics | null
  readonly version: number
}

export interface StarBattleStoreActions {
  /** Persists the tier and prints a fresh board with the same seed. No-op while generating. */
  setDifficulty(difficulty: StarDifficulty): void
  /** Starts a round; an explicit seed (numeric or text) becomes the authored one. */
  startNewRound(seed?: RandomSeed): void
  /** The banner accelerator: clears the interlude and starts immediately (won → derived seed, lost → same seed). */
  nextRound(): void
  /** Reuses the exact seed of the most recent failed request. */
  retry(): void
  /**
   * The one mark seam. `next` is the UI's `'blank' | 'star'`; `null` is
   * inert. Row/column are validated against the current puzzle and flattened
   * to the reducer's batch index here and nowhere else.
   */
  onMark(row: number, col: number, next: 'blank' | 'star' | null): void
  /** Cancels any in-flight generation and returns to the picker-shaped idle state. */
  backToPicker(): void
}

export interface StarBattleStore {
  getSnapshot(): StarBattleSnapshot
  subscribe(listener: () => void): () => void
  actions: StarBattleStoreActions
  dispose(): void
}

// --------------------------------------------------------------------------------------
// Worker boundary (kept injectable for Node/jsdom tests, as generationClient does)
// --------------------------------------------------------------------------------------

export interface StarWorkerHandlers {
  readonly message: (event: MessageEvent<unknown>) => void
  readonly error: (event: ErrorEvent) => void
  readonly messageError: (event: MessageEvent<unknown>) => void
}

export interface StarWorkerEndpoint {
  postMessage(message: StarBattleWorkerCommand): void
  terminate(): void
  setHandlers(handlers: StarWorkerHandlers): void
}

export type StarWorkerFactory = () => StarWorkerEndpoint

export type TimerHandle = ReturnType<typeof setTimeout>

export interface VisibilityProbe {
  /** `false` only while the page is in the background. */
  readonly isVisible: () => boolean
  /** Notifies on every visibility change; returns the unsubscribe. */
  readonly subscribe: (handler: () => void) => () => void
}

export interface StarBattleStoreOptions {
  readonly initialState?: StarBattleState
  /** Board side sent to the generator; the domain default unless overridden. */
  readonly side?: number
  /** Initial tier; the persisted preference wins when this is omitted. */
  readonly difficulty?: StarDifficulty
  readonly workerFactory?: StarWorkerFactory
  /** Win interlude in ms. Lower it in tests. */
  readonly interludeMs?: number
  readonly setTimer?: (handler: () => void, ms: number) => TimerHandle
  readonly clearTimer?: (handle: TimerHandle) => void
  /** Page visibility. Defaults to `document`, and to "always visible" without one. */
  readonly visibility?: VisibilityProbe
  /** Persistence key for the difficulty preference (test seam). */
  readonly storageKey?: string
}

export const DEFAULT_STAR_WIN_INTERLUDE_MS = 2_500

/** The pure label the next-round derivation mixes into the last used seed. */
export const STAR_NEXT_ROUND_SEED_LABEL = 'star-battle:next-round'

const STAR_DIFFICULTY_STORAGE_KEY = 'minegram.star-battle.difficulty'

const DEFAULT_STAR_DIFFICULTY: StarDifficulty = 'starter'

/** A host with no document (a bare test, a worker) is treated as foreground. */
const ALWAYS_VISIBLE: VisibilityProbe = Object.freeze({
  isVisible: () => true,
  subscribe: () => () => {},
})

function documentVisibility(): VisibilityProbe {
  if (typeof document === 'undefined') {
    return ALWAYS_VISIBLE
  }
  return Object.freeze({
    isVisible: () => document.visibilityState !== 'hidden',
    subscribe: (handler: () => void) => {
      document.addEventListener('visibilitychange', handler)
      return () => {
        document.removeEventListener('visibilitychange', handler)
      }
    },
  })
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.length > 0) {
    return error
  }
  return 'Unknown Worker error'
}

function workerFailure(reason: string, message: string): GameFailureDiagnostics {
  return { reason, message, details: {} }
}

/** Uses Vite's module Worker URL only when the caller uses the real default. */
export function createDefaultStarWorker(): StarWorkerEndpoint {
  const worker = new Worker(new URL('../workers/starBattleWorker.ts', import.meta.url), {
    type: 'module',
  })
  return {
    postMessage(message) {
      worker.postMessage(message)
    },
    terminate() {
      worker.terminate()
    },
    setHandlers(handlers) {
      worker.addEventListener('message', handlers.message)
      worker.addEventListener('error', handlers.error)
      worker.addEventListener('messageerror', handlers.messageError)
    },
  }
}

function readPersistedDifficulty(storageKey: string): StarDifficulty {
  const stored = readStored(storageKey)
  return stored !== null && isStarDifficulty(stored) ? stored : DEFAULT_STAR_DIFFICULTY
}

// --------------------------------------------------------------------------------------
// The store
// --------------------------------------------------------------------------------------

interface ActiveStarRequest {
  readonly requestId: number
  readonly generationId: number
  readonly worker: StarWorkerEndpoint
  /** The normalised seed in flight; the next round derives from it after a win. */
  readonly seed: number
}

export function createStarBattleStore(options: StarBattleStoreOptions = {}): StarBattleStore {
  const side = options.side ?? DEFAULT_STAR_SIDE
  assertStarBattleSide(side, 'star battle store side')
  const setTimer =
    options.setTimer ?? ((handler: () => void, ms: number): TimerHandle => setTimeout(handler, ms))
  const clearTimer = options.clearTimer ?? ((handle: TimerHandle): void => clearTimeout(handle))
  const interludeMs = options.interludeMs ?? DEFAULT_STAR_WIN_INTERLUDE_MS
  const visibility = options.visibility ?? documentVisibility()
  const storageKey = options.storageKey ?? STAR_DIFFICULTY_STORAGE_KEY

  // ---- closure state (never reachable from a property, a snapshot, or `this`) ----
  let state: StarBattleState = options.initialState ?? createInitialStarBattleState()
  let difficulty: StarDifficulty =
    options.difficulty ?? readPersistedDifficulty(storageKey)
  let failure: GameFailureDiagnostics | null = null
  let version = 0
  let interlude: TimerHandle | null = null
  let active: ActiveStarRequest | null = null
  let generationCounter = 0
  let requestCounter = 0
  let disposed = false
  /** True while the store itself tears a request down, so no failure publishes. */
  let internalTeardown = false
  /** The last seed the player (or a derivation) started a round with. */
  let authoredSeed: RandomSeed = 0

  const listeners = new Set<() => void>()
  // Armed once per store and torn down in `dispose()`: the hidden-tab win
  // handoff re-arms through this, exactly as Minegram's store does.
  const stopWatchingVisibility = visibility.subscribe(rewatchVisibility)

  function composeSnapshot(): StarBattleSnapshot {
    return Object.freeze({
      status: active !== null ? 'generating' : state.status,
      puzzle: state.puzzle,
      marks: state.marks,
      score: state.score,
      mistakes: state.mistakes,
      streak: state.streak,
      difficulty,
      failure,
      version,
    })
  }

  let snapshot: StarBattleSnapshot = composeSnapshot()

  function publish(): void {
    version += 1
    snapshot = composeSnapshot()
    for (const listener of [...listeners]) {
      listener()
    }
  }

  function clearInterlude(): void {
    if (interlude === null) {
      return
    }
    clearTimer(interlude)
    interlude = null
  }

  // ---- generation client (the Star Battle counterpart of GenerationClient) ----

  function terminateWorker(worker: StarWorkerEndpoint): void {
    try {
      worker.terminate()
    } catch {
      // A fake or already-closed Worker may throw while being released.
    }
  }

  /** Invalidates the request identity and releases the Worker, unpublished. */
  function teardownActive(): void {
    const current = active
    active = null
    if (current === null) {
      return
    }
    try {
      current.worker.postMessage({
        type: 'star-generation/cancel',
        requestId: current.requestId,
        generationId: current.generationId,
      })
    } catch {
      // Termination below is the cancellation fallback.
    }
    terminateWorker(current.worker)
  }

  /**
   * Starts a generation with the given seed input. `false` means the request
   * was refused (disposed, already generating, or the seed did not parse —
   * the seed failure is published as a failure state, never thrown).
   */
  function launch(seedInput: RandomSeed): boolean {
    if (disposed || active !== null) {
      return false
    }
    let seed: number
    try {
      seed = normalizeRandomSeed(seedInput)
    } catch (error) {
      reportFailure(workerFailure('invalid-settings', `Star Battle seed is not usable: ${errorMessage(error)}`))
      return false
    }

    generationCounter += 1
    requestCounter += 1
    const requestId = requestCounter
    const generationId = generationCounter

    let worker: StarWorkerEndpoint | null = null
    try {
      const created = (options.workerFactory ?? createDefaultStarWorker)()
      worker = created
      created.setHandlers({
        message: (event) => {
          handleWorkerMessage(created, requestId, generationId, event.data)
        },
        error: (event) => {
          event.preventDefault()
          reportRequestFailure(
            created,
            requestId,
            generationId,
            workerFailure('worker-error', `Star Battle Worker error: ${event.message || 'unknown error'}`),
          )
        },
        messageError: () => {
          reportRequestFailure(
            created,
            requestId,
            generationId,
            workerFailure('worker-message-error', 'Star Battle Worker sent an unreadable message'),
          )
        },
      })
    } catch (error) {
      if (worker !== null) {
        terminateWorker(worker)
      }
      reportFailure(
        workerFailure(
          'worker-unavailable',
          `Star Battle Worker could not be created: ${errorMessage(error)}`,
        ),
      )
      return false
    }

    active = { requestId, generationId, worker, seed }
    authoredSeed = seed
    failure = null
    const request: StarBattleRequestMessage = {
      type: 'star-generation/request',
      requestId,
      generationId,
      n: side,
      seed,
      difficulty,
    }
    try {
      worker.postMessage(request)
    } catch (error) {
      reportRequestFailure(
        worker,
        requestId,
        generationId,
        workerFailure('worker-post-error', `Star Battle Worker request failed: ${errorMessage(error)}`),
      )
      return false
    }
    publish()
    return true
  }

  function handleWorkerMessage(
    worker: StarWorkerEndpoint,
    requestId: number,
    generationId: number,
    data: unknown,
  ): void {
    const current = active
    // Stale-result protection: a reply whose identity does not match the
    // request actually in flight — or that arrives after this store moved on —
    // is dropped, never applied.
    if (
      current === null ||
      current.worker !== worker ||
      current.requestId !== requestId ||
      current.generationId !== generationId
    ) {
      return
    }
    if (!isStarBattleWorkerResponse(data)) {
      reportRequestFailure(
        worker,
        requestId,
        generationId,
        workerFailure('invalid-worker-response', 'Star Battle Worker returned an invalid response'),
      )
      return
    }
    if (data.requestId !== requestId || data.generationId !== generationId) {
      return
    }

    if (data.type === 'star-generation/failed') {
      active = null
      terminateWorker(worker)
      failure = data.failure
      publish()
      return
    }

    // The worker validated the puzzle before posting; the store re-validates
    // at the seam anyway, because the generation contract is non-negotiable:
    // a board that is not certified-shape never reaches the reducer.
    try {
      assertStarBattlePuzzle(data.puzzle)
    } catch {
      active = null
      terminateWorker(worker)
      failure = workerFailure(
        'invalid-generated-round',
        'Star Battle Worker returned a board rejected by the domain validator',
      )
      publish()
      return
    }
    const result = starBattleReducer(state, { type: 'round/start', puzzle: data.puzzle })
    if (result.type !== 'transition') {
      // The reducer refuses to replace a PLAYING round. A player-initiated new
      // round (difficulty change, restart) discards the old board by contract,
      // so the store resets to the picker-shaped idle state and starts once
      // more; a refusal from THAT is a genuine bad board.
      if (result.reason === 'round-not-startable' && !internalTeardown) {
        state = createInitialStarBattleState()
        const restarted = starBattleReducer(state, { type: 'round/start', puzzle: data.puzzle })
        if (restarted.type === 'transition') {
          active = null
          terminateWorker(worker)
          state = restarted.state
          adoptTransition(restarted.transition)
          publish()
          return
        }
      }
      active = null
      terminateWorker(worker)
      failure = workerFailure(
        'invalid-generated-round',
        'Star Battle Worker returned a board rejected by the reducer',
      )
      publish()
      return
    }
    active = null
    terminateWorker(worker)
    state = result.state
    adoptTransition(result.transition)
    publish()
  }

  function reportRequestFailure(
    worker: StarWorkerEndpoint,
    requestId: number,
    generationId: number,
    diagnostics: GameFailureDiagnostics,
  ): void {
    const current = active
    if (
      current === null ||
      current.worker !== worker ||
      current.requestId !== requestId ||
      current.generationId !== generationId
    ) {
      return
    }
    active = null
    terminateWorker(worker)
    failure = diagnostics
    publish()
  }

  function reportFailure(diagnostics: GameFailureDiagnostics): void {
    teardownActive()
    if (internalTeardown) {
      return
    }
    failure = diagnostics
    publish()
  }

  // ---- win interlude ----

  function adoptTransition(transition: StarBattleTransition): void {
    if (transition === 'round-won') {
      scheduleInterlude()
    } else {
      // Every other transition, `round-lost` included, cancels the handoff.
      clearInterlude()
    }
  }

  function scheduleInterlude(): void {
    clearInterlude()
    if (!visibility.isVisible()) {
      // A backgrounded tab must not silently burn a round. The visibility
      // listener re-arms the handoff the moment the page is shown again, so
      // the handoff still happens without a human pressing anything.
      return
    }
    interlude = setTimer(() => {
      interlude = null
      if (disposed || active !== null || state.status !== 'won') {
        return
      }
      if (!visibility.isVisible()) {
        // Hidden between arming and firing: hand the round back to the listener.
        return
      }
      launch(deriveRandomSeed(activeSeed(), STAR_NEXT_ROUND_SEED_LABEL))
    }, interludeMs)
  }

  /** Re-arms a handoff that a hidden tab deferred; guarded on `interlude === null`. */
  function rewatchVisibility(): void {
    if (disposed || interlude !== null || active !== null || state.status !== 'won') {
      return
    }
    if (!visibility.isVisible()) {
      return
    }
    scheduleInterlude()
  }

  /** The seed the in-flight or last round derived from; the interlude's base. */
  function activeSeed(): number {
    return active?.seed ?? (typeof authoredSeed === 'number' ? authoredSeed : normalizeRandomSeed(authoredSeed))
  }

  // ---- actions ----

  const actions: StarBattleStoreActions = {
    setDifficulty(next) {
      if (disposed || !isStarDifficulty(next)) {
        return
      }
      difficulty = next
      writeStored(storageKey, next)
      publish()
      if (active !== null) {
        // A round is already printing; the persisted tier applies next time.
        return
      }
      launch(authoredSeed)
    },
    startNewRound(seed) {
      if (seed !== undefined) {
        authoredSeed = seed
      }
      clearInterlude()
      launch(authoredSeed)
    },
    nextRound() {
      clearInterlude()
      if (disposed) {
        return
      }
      if (state.status === 'won') {
        launch(deriveRandomSeed(activeSeed(), STAR_NEXT_ROUND_SEED_LABEL))
        return
      }
      // 'lost' restarts the same board (Minegram's retry semantics); any other
      // state reuses the authored seed.
      launch(authoredSeed)
    },
    retry() {
      if (failure === null || active !== null) {
        return
      }
      clearInterlude()
      launch(authoredSeed)
    },
    onMark(row, col, next) {
      if (disposed || next === null || state.status !== 'playing' || state.puzzle === null) {
        return
      }
      const n = state.puzzle.n
      if (!Number.isSafeInteger(row) || !Number.isSafeInteger(col) || row < 0 || col < 0 || row >= n || col >= n) {
        return
      }
      const index = row * n + col
      // Structural inertness: a re-assertion or an all-locked gesture reports
      // `affectedCount === 0`, and the store dispatches nothing — no charge,
      // no mutation, no announcement.
      const preview = previewStarMarkBatch(state, [{ index, mark: next }])
      if (!preview.valid || preview.affectedCount === 0) {
        return
      }
      const result = starBattleReducer(state, { type: 'round/markBatch', cells: [{ index, mark: next }] })
      if (result.type !== 'transition') {
        // Unreachable through the preview gate above; a refusal changes nothing.
        return
      }
      state = result.state
      adoptTransition(result.transition)
      publish()
    },
    backToPicker() {
      if (disposed) {
        return
      }
      clearInterlude()
      internalTeardown = true
      try {
        teardownActive()
      } finally {
        internalTeardown = false
      }
      failure = null
      state = createInitialStarBattleState()
      publish()
    },
  }

  function getSnapshot(): StarBattleSnapshot {
    return snapshot
  }

  function subscribe(listener: () => void): () => void {
    if (disposed) {
      return () => {}
    }
    listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }
      subscribed = false
      listeners.delete(listener)
    }
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    clearInterlude()
    stopWatchingVisibility()
    listeners.clear()
    internalTeardown = true
    try {
      teardownActive()
    } finally {
      internalTeardown = false
    }
    disposed = true
  }

  return Object.freeze({
    getSnapshot,
    subscribe,
    actions: Object.freeze(actions),
    dispose,
  })
}

// --------------------------------------------------------------------------------------
// App singleton
// --------------------------------------------------------------------------------------

let singleton: StarBattleStore | null = null

export function getStarBattleStore(): StarBattleStore {
  singleton ??= createStarBattleStore()
  return singleton
}

/**
 * Installs `store` as the app singleton. Test seam only: it swaps a store
 * object, which holds no game state, and returns a restore function.
 */
export function setStarBattleStore(store: StarBattleStore): () => void {
  const previous = singleton
  singleton = store
  return () => {
    if (singleton === store) {
      singleton = previous
    }
  }
}

/** Idempotent. Called from `pagehide` and `beforeunload`, and from tests. */
export function disposeStarBattleStore(): void {
  singleton?.dispose()
}

if (typeof window !== 'undefined') {
  // Registered once, at module load, and nowhere else: `dispose()` is never
  // wired to a React effect, because client teardown also cancels the pending
  // generation and would flash a false failure card on every StrictMode mount.
  const teardown = (): void => {
    disposeStarBattleStore()
  }
  window.addEventListener('pagehide', teardown)
  window.addEventListener('beforeunload', teardown)
}
