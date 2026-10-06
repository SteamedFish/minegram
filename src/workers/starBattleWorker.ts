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

export type StarBattleWorkerResponse = StarBattleSucceededMessage | StarBattleFailedMessage

export type StarBattlePuzzleGenerator = (
  request: StarGenerationRequest,
) => StarGeneratedBoard

export type StarBattlePostMessage = (message: StarBattleWorkerResponse) => void

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
 * future async generator, and so a superseded generation never posts.
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
      const result = generate({
        n: request.n,
        seed: request.seed,
        difficulty: request.difficulty,
      })
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
  postMessage(message: StarBattleWorkerResponse): void
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
