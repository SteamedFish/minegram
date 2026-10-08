/**
 * Star Battle generation Worker: the typed request/response adapter between the
 * store and `generateStarBattle` in `src/engine/starBattle/construct.ts`.
 * Mirrors `src/application/generationWorker.ts` message-for-message: the same
 * request/cancel command pair, the same succeeded/failed response pair, the
 * same identity (requestId + generationId) stale-result protection, and the
 * same refusal to let an uncertified board reach the store — the generator
 * either returns a puzzle or throws, and a throw is reported as a failure,
 * never as a fallback board.
 *
 * The engine's `STAR_DIFFICULTIES` is re-exported as {@link
 * STAR_DIFFICULTY_TIERS} so the tier list has one runtime home on the UI side
 * of the seam; the engine export remains the source of truth for what gets
 * GENERATED.
 *
 * While a board is printing, the handler forwards the engine's progress
 * callbacks as `star-generation/progress` messages — the store already
 * consumes them. A tick is advisory: it is validated as strictly as the
 * terminal responses, but a bad tick is dropped, never a failure, and a tick
 * for a superseded or cancelled generation is dropped too, because a late bar
 * for a board that is never coming is worse than no bar.
 */
import {
  assertStarBattlePuzzle,
  type StarBattlePuzzle,
} from '../domain/starBattle'
import type { GameFailureDiagnostics, JsonObject } from '../application/gameReducer'
import {
  generateStarBattle,
  STAR_DIFFICULTIES,
  type StarDifficulty,
  type StarGeneratedBoard,
  type StarGenerationRequest,
} from '../engine/starBattle/construct'

// --------------------------------------------------------------------------------------
// Messages
// --------------------------------------------------------------------------------------

export interface StarBattleRequestMessage {
  readonly type: 'star-generation/request'
  readonly requestId: number
  readonly generationId: number
  /** Board side; the store sends the domain default unless told otherwise. */
  readonly n: number
  /** Normalised (uint32) seed; the store owns `normalizeRandomSeed`. */
  readonly seed: number
  readonly difficulty: StarDifficulty
}

export interface StarBattleCancellation {
  readonly type: 'star-generation/cancel'
  readonly requestId: number
  readonly generationId: number
}

export type StarBattleWorkerCommand = StarBattleRequestMessage | StarBattleCancellation

export interface StarBattleSucceededMessage {
  readonly type: 'star-generation/succeeded'
  readonly requestId: number
  readonly generationId: number
  readonly puzzle: StarBattlePuzzle
  readonly waves: number
  readonly difficulty: StarDifficulty
}

export interface StarBattleFailedMessage {
  readonly type: 'star-generation/failed'
  readonly requestId: number
  readonly generationId: number
  readonly failure: GameFailureDiagnostics
}

/**
 * The mid-generation message the Worker posts while a board is printing.
 * `candidates` counts the candidate colourings tried so far, `accepted` is
 * 0 or 1 (a board is certified at most once), and `phase` names the stage
 * the generator is in. There is deliberately no total: the generator cannot
 * know how many candidates a board needs, so the count of what has actually
 * happened is the whole truth the UI can show.
 */
export interface StarBattleProgressMessage {
  readonly type: 'star-generation/progress'
  readonly requestId: number
  readonly generationId: number
  readonly candidates: number
  readonly accepted: number
  readonly phase: StarGenerationPhase
}

export type StarBattleWorkerResponse = StarBattleSucceededMessage | StarBattleFailedMessage

/**
 * Everything the Worker posts in response to a request: the terminal pair
 * plus mid-generation progress. `StarBattleWorkerResponse` stays terminal-
 * only because the store narrows on `isStarBattleWorkerResponse` and then
 * reads succeeded-only fields; progress rides its own message type and its
 * own guard, and the store validates it before the terminal path.
 */
export type StarBattleWorkerMessage = StarBattleWorkerResponse | StarBattleProgressMessage

/**
 * The phases a generation walks through, in the order the player meets them.
 * These names are the pinned wire protocol — the store guards on exactly
 * these three literals.
 */
export type StarGenerationPhase = 'sampling' | 'repairing' | 'grading'

/**
 * The payload the engine reports through `onProgress`. The worker owns this
 * structural copy of the engine's imminent options bag so this seam compiles
 * before the engine lane lands; the types are structurally identical to the
 * engine's, so the real `generateStarBattle` stays assignable either way.
 */
export interface StarGenerationProgress {
  readonly candidates: number
  readonly accepted: number
  readonly phase: StarGenerationPhase
}

export interface StarGenerationOptions {
  readonly onProgress?: (progress: StarGenerationProgress) => void
  readonly timeBudgetMs?: number
}

export type StarBattlePuzzleGenerator = (
  request: StarGenerationRequest,
  options?: StarGenerationOptions,
) => StarGeneratedBoard

export type StarBattlePostMessage = (message: StarBattleWorkerMessage) => void

// --------------------------------------------------------------------------------------
// Difficulty tiers — the engine's list, re-exported as the UI-side runtime home
// --------------------------------------------------------------------------------------

export const STAR_DIFFICULTY_TIERS: readonly StarDifficulty[] = STAR_DIFFICULTIES

export function isStarDifficulty(value: unknown): value is StarDifficulty {
  return typeof value === 'string' && (STAR_DIFFICULTY_TIERS as readonly string[]).includes(value)
}

// --------------------------------------------------------------------------------------
// Message reading (everything untrusted is validated, exactly as Minegram does)
// --------------------------------------------------------------------------------------

interface MutableGenerationSignal {
  aborted: boolean
}

interface ActiveStarGeneration {
  readonly requestId: number
  readonly generationId: number
  readonly signal: MutableGenerationSignal
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

const STAR_GENERATION_PHASES: readonly StarGenerationPhase[] = ['sampling', 'repairing', 'grading']

/** The payload half of the progress protocol: counts and phase, no identity. */
function isStarGenerationProgress(value: unknown): value is StarGenerationProgress {
  return (
    isRecord(value) &&
    isNonNegativeSafeInteger(value.candidates) &&
    isNonNegativeSafeInteger(value.accepted) &&
    typeof value.phase === 'string' &&
    (STAR_GENERATION_PHASES as readonly string[]).includes(value.phase)
  )
}

function hasIdentity(
  value: Record<string, unknown>,
): value is Record<string, unknown> & {
  readonly requestId: number
  readonly generationId: number
} {
  return isPositiveSafeInteger(value.requestId) && isPositiveSafeInteger(value.generationId)
}

function readStarBattleRequest(value: unknown): StarBattleRequestMessage | null {
  if (!isRecord(value) || value.type !== 'star-generation/request' || !hasIdentity(value)) {
    return null
  }
  if (typeof value.n !== 'number' || !Number.isSafeInteger(value.n)) {
    return null
  }
  // The seed is the normalised RNG seed, so `0` is a legitimate value — unlike
  // the identity counters above, which start at 1 on the client.
  if (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed) || value.seed < 0) {
    return null
  }
  if (!isStarDifficulty(value.difficulty)) {
    return null
  }
  return Object.freeze({
    type: 'star-generation/request',
    requestId: value.requestId,
    generationId: value.generationId,
    n: value.n,
    seed: value.seed,
    difficulty: value.difficulty,
  })
}

function readStarBattleCancellation(value: unknown): StarBattleCancellation | null {
  if (!isRecord(value) || value.type !== 'star-generation/cancel' || !hasIdentity(value)) {
    return null
  }
  return Object.freeze({
    type: 'star-generation/cancel',
    requestId: value.requestId,
    generationId: value.generationId,
  })
}

// --------------------------------------------------------------------------------------
// Result mapping — a throw is a failure, never a board
// --------------------------------------------------------------------------------------

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.length > 0) {
    return error
  }
  return 'Unknown Star Battle generation error'
}

function makeExceptionResponse(
  request: Pick<StarBattleRequestMessage, 'requestId' | 'generationId'>,
  error: unknown,
): StarBattleFailedMessage {
  return {
    type: 'star-generation/failed',
    requestId: request.requestId,
    generationId: request.generationId,
    failure: {
      reason: 'worker-exception',
      message: `Star Battle generation threw an exception: ${safeErrorMessage(error)}`,
      details: { stage: 'generation' } satisfies JsonObject,
    },
  }
}

/**
 * Projects a certified board onto the serializable protocol. The puzzle is
 * re-validated here so a malformed engine result can never cross the Worker
 * boundary dressed as success.
 */
export function mapStarGenerationResult(
  request: Pick<StarBattleRequestMessage, 'requestId' | 'generationId'>,
  result: StarGeneratedBoard,
): StarBattleWorkerResponse {
  try {
    assertStarBattlePuzzle(result.puzzle)
  } catch {
    return {
      type: 'star-generation/failed',
      requestId: request.requestId,
      generationId: request.generationId,
      failure: {
        reason: 'invalid-generated-round',
        message: 'Star Battle generation returned a board rejected by the domain validator',
        details: { stage: 'acceptance' } satisfies JsonObject,
      },
    }
  }
  return {
    type: 'star-generation/succeeded',
    requestId: request.requestId,
    generationId: request.generationId,
    puzzle: result.puzzle,
    waves: result.waves,
    difficulty: result.difficulty,
  }
}

/**
 * Creates the Worker's pure message handler. The signal bridge is local to the
 * Worker and contains only a serializable boolean; no function, signal, class
 * instance, or Error crosses the request boundary. `generateStarBattle` is
 * synchronous, so a cancellation cannot interleave with a running generation —
 * the abort check after the call exists so the protocol stays honest for a
 * future async generator, and so a superseded generation never posts its
 * answer or a progress tick.
 */
export function createStarBattleMessageHandler(
  generate: StarBattlePuzzleGenerator,
  postMessage: StarBattlePostMessage,
): (message: unknown) => void {
  let active: ActiveStarGeneration | null = null

  return (message: unknown): void => {
    const cancellation = readStarBattleCancellation(message)
    if (cancellation !== null) {
      if (
        active !== null &&
        active.requestId === cancellation.requestId &&
        active.generationId === cancellation.generationId
      ) {
        active.signal.aborted = true
      }
      return
    }

    const request = readStarBattleRequest(message)
    if (request === null) {
      return
    }

    if (active !== null) {
      active.signal.aborted = true
    }
    const signal: MutableGenerationSignal = { aborted: false }
    const current: ActiveStarGeneration = {
      requestId: request.requestId,
      generationId: request.generationId,
      signal,
    }
    active = current

    let response: StarBattleWorkerResponse | null = null
    try {
      const result = generate(
        {
          n: request.n,
          seed: request.seed,
          difficulty: request.difficulty,
        },
        {
          onProgress: (progress) => {
            // A tick from a superseded or cancelled generation must never
            // post: the client already moved on, and a live bar for a board
            // that is never coming is worse than none. The same identity
            // check guards the terminal path below — and, because `active`
            // is cleared when this generation settles, it also silences a
            // callback a pathological engine stashed and fires after the
            // answer posted.
            if (active !== current || signal.aborted) {
              return
            }
            // Progress is advisory, so an engine tick that fails the protocol
            // guard is dropped, never posted and never a failure — the
            // asymmetric counterpart to the terminal path, where a malformed
            // result must fail the generation.
            if (!isStarGenerationProgress(progress)) {
              return
            }
            try {
              postMessage({
                type: 'star-generation/progress',
                requestId: request.requestId,
                generationId: request.generationId,
                candidates: progress.candidates,
                accepted: progress.accepted,
                phase: progress.phase,
              })
            } catch {
              // The Worker may be terminating mid-generation.
            }
          },
        },
      )
      if (active === current && !signal.aborted) {
        response = mapStarGenerationResult(request, result)
      }
    } catch (error) {
      if (active === current && !signal.aborted) {
        response = makeExceptionResponse(request, error)
      }
    } finally {
      if (active === current) {
        active = null
      }
    }

    if (response === null) {
      // Cancelled or superseded between the request and its answer: the client
      // already moved on, so nothing is posted.
      return
    }
    try {
      postMessage(response)
    } catch {
      // The Worker may be terminating while the synchronous call returns.
    }
  }
}

export function isStarBattleProgressMessage(value: unknown): value is StarBattleProgressMessage {
  return (
    isRecord(value) &&
    value.type === 'star-generation/progress' &&
    hasIdentity(value) &&
    isStarGenerationProgress(value)
  )
}

export function isStarBattleWorkerResponse(value: unknown): value is StarBattleWorkerResponse {
  if (!isRecord(value) || !hasIdentity(value)) {
    return false
  }
  if (value.type === 'star-generation/succeeded') {
    try {
      assertStarBattlePuzzle(value.puzzle)
    } catch {
      return false
    }
    return typeof value.waves === 'number' && Number.isSafeInteger(value.waves) && value.waves > 0
  }
  if (value.type === 'star-generation/failed') {
    return (
      isRecord(value.failure) &&
      typeof value.failure.reason === 'string' &&
      typeof value.failure.message === 'string' &&
      (value.failure.details === undefined || isRecord(value.failure.details))
    )
  }
  return false
}

// --------------------------------------------------------------------------------------
// Worker entry — binds the real generator without a module-load-time dependency
// --------------------------------------------------------------------------------------

interface WorkerScope {
  postMessage(message: StarBattleWorkerMessage): void
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<unknown>) => void,
  ): void
}

function installWorkerEntry(): void {
  if (typeof document !== 'undefined') {
    return
  }
  const scope = globalThis as unknown as Partial<WorkerScope>
  if (typeof scope.postMessage !== 'function' || typeof scope.addEventListener !== 'function') {
    return
  }
  const handleMessage = createStarBattleMessageHandler(generateStarBattle, (message) => {
    try {
      scope.postMessage?.(message)
    } catch {
      // The Worker may be terminating while the reply is posted.
    }
  })
  scope.addEventListener('message', (event) => {
    handleMessage(event.data)
  })
}

installWorkerEntry()
