import {
  generateMinegramPuzzle,
  type GenerationFailureReason,
  type GenerationResult,
  type GenerationSignal,
} from '../engine/generator/generator'
import {
  normalizeGenerationSettings,
  type GenerationSettings,
  type GenerationSettingsInput,
} from '../engine/generator/settings'
import type {
  GameFailureDiagnostics,
  GeneratedRound,
  JsonObject,
} from './gameReducer'

export interface GenerationRequest {
  readonly type: 'generation/request'
  readonly requestId: number
  readonly generationId: number
  /** Exact normalized settings copied across the Worker boundary. */
  readonly settings: GenerationSettings
}

export interface GenerationCancellation {
  readonly type: 'generation/cancel'
  readonly requestId: number
  readonly generationId: number
}

export type GenerationWorkerCommand = GenerationRequest | GenerationCancellation

export interface GenerationSucceededMessage {
  readonly type: 'generation/succeeded'
  readonly requestId: number
  readonly generationId: number
  readonly round: GeneratedRound
}

export interface GenerationFailedMessage {
  readonly type: 'generation/failed'
  readonly requestId: number
  readonly generationId: number
  readonly failure: GameFailureDiagnostics
}

export type GenerationWorkerResponse = GenerationSucceededMessage | GenerationFailedMessage

export type GenerationPuzzleGenerator = (
  settings: GenerationSettings,
  options: { readonly signal: GenerationSignal },
) => GenerationResult

export type GenerationWorkerPostMessage = (message: GenerationWorkerResponse) => void

interface MutableGenerationSignal {
  aborted: boolean
}

interface ActiveGeneration {
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

function readGenerationRequest(value: unknown): GenerationRequest | null {
  if (!isRecord(value) || value.type !== 'generation/request' || !hasIdentity(value)) {
    return null
  }

  let settings: GenerationSettings
  try {
    settings = normalizeGenerationSettings(value.settings as GenerationSettingsInput | undefined)
  } catch {
    return null
  }
  return Object.freeze({
    type: 'generation/request',
    requestId: value.requestId,
    generationId: value.generationId,
    settings,
  })
}

function readGenerationCancellation(value: unknown): GenerationCancellation | null {
  if (!isRecord(value) || value.type !== 'generation/cancel' || !hasIdentity(value)) {
    return null
  }
  return Object.freeze({
    type: 'generation/cancel',
    requestId: value.requestId,
    generationId: value.generationId,
  })
}

function settingsAsJson(settings: GenerationSettings): JsonObject {
  return {
    rows: settings.rows,
    columns: settings.columns,
    densityPercent: settings.densityPercent,
    mineCount: settings.mineCount,
    difficulty: settings.difficulty,
    seed: settings.seed,
    maxAttempts: settings.maxAttempts,
  }
}

function diagnosticsAsJson(result: Extract<GenerationResult, { readonly status: 'failure' }>): JsonObject {
  const { diagnostics } = result
  return {
    attempts: diagnostics.attempts,
    layouts: diagnostics.layouts,
    candidates: diagnostics.candidates,
    accepted: diagnostics.accepted,
    rollbacks: diagnostics.rollbacks,
    solverCalls: diagnostics.solverCalls,
    solverStatuses: [...diagnostics.solverStatuses],
    resourceReasons: [...diagnostics.resourceReasons],
    difficultyNodesVisited: diagnostics.difficultyNodesVisited,
    difficultyNodeLimit: diagnostics.difficultyNodeLimit,
    proofStatus: diagnostics.proofStatus,
    difficultyStatus: diagnostics.difficultyStatus,
    ...(diagnostics.difficultyReason === undefined
      ? {}
      : { difficultyReason: diagnostics.difficultyReason }),
    ...(diagnostics.minimumGuesses === undefined
      ? {}
      : { minimumGuesses: diagnostics.minimumGuesses }),
    ...(diagnostics.band === undefined ? {} : { band: diagnostics.band }),
  }
}

function generationFailureMessage(reason: GenerationFailureReason): string {
  return `Minegram generation failed: ${reason}`
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message
  }
  if (typeof error === 'string' && error.length > 0) {
    return error
  }
  return 'Unknown Minegram generation error'
}

function makeExceptionResponse(
  request: GenerationRequest,
  error: unknown,
): GenerationFailedMessage {
  return {
    type: 'generation/failed',
    requestId: request.requestId,
    generationId: request.generationId,
    failure: {
      reason: 'worker-exception',
      message: `Minegram generation threw an exception: ${safeErrorMessage(error)}`,
      details: { stage: 'generation' },
    },
  }
}

/** Projects an engine result onto the serializable application protocol. */
export function mapGenerationResult(
  request: Pick<GenerationRequest, 'requestId' | 'generationId'>,
  result: GenerationResult,
): GenerationWorkerResponse {
  if (result.status === 'success') {
    const round: GeneratedRound = {
      settings: result.settings,
      board: result.board,
      puzzle: result.puzzle,
      difficulty: result.difficulty,
    }
    return {
      type: 'generation/succeeded',
      requestId: request.requestId,
      generationId: request.generationId,
      round,
    }
  }

  return {
    type: 'generation/failed',
    requestId: request.requestId,
    generationId: request.generationId,
    failure: {
      reason: result.reason,
      message: generationFailureMessage(result.reason),
      details: {
        settings: settingsAsJson(result.settings),
        diagnostics: diagnosticsAsJson(result),
      },
    },
  }
}

/**
 * Creates the Worker's pure message handler. The signal bridge is local to the
 * Worker and contains only a serializable boolean; no function, signal, class
 * instance, or Error crosses the request boundary.
 */
export function createGenerationMessageHandler(
  generate: GenerationPuzzleGenerator,
  postMessage: GenerationWorkerPostMessage,
): (message: unknown) => void {
  let active: ActiveGeneration | null = null

  return (message: unknown): void => {
    const cancellation = readGenerationCancellation(message)
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

    const request = readGenerationRequest(message)
    if (request === null) {
      return
    }

    if (active !== null) {
      active.signal.aborted = true
    }
    const signal: MutableGenerationSignal = { aborted: false }
    const current: ActiveGeneration = {
      requestId: request.requestId,
      generationId: request.generationId,
      signal,
    }
    active = current

    let response: GenerationWorkerResponse
    try {
      const result = generate(request.settings, { signal })
      response = mapGenerationResult(request, result)
    } catch (error) {
      response = makeExceptionResponse(request, error)
    } finally {
      if (active === current) {
        active = null
      }
    }

    try {
      postMessage(response)
    } catch {
      // The Worker may be terminating while the synchronous call returns.
    }
  }
}

export function isGenerationWorkerResponse(value: unknown): value is GenerationWorkerResponse {
  if (!isRecord(value) || !hasIdentity(value)) {
    return false
  }
  if (value.type === 'generation/succeeded') {
    return (
      isRecord(value.round) &&
      isRecord(value.round.settings) &&
      Array.isArray(value.round.board) &&
      isRecord(value.round.puzzle)
    )
  }
  if (value.type === 'generation/failed') {
    return (
      isRecord(value.failure) &&
      typeof value.failure.reason === 'string' &&
      typeof value.failure.message === 'string' &&
      (value.failure.details === undefined || isRecord(value.failure.details))
    )
  }
  return false
}

interface WorkerScope {
  postMessage(message: GenerationWorkerResponse): void
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
  const handleMessage = createGenerationMessageHandler(
    generateMinegramPuzzle,
    (message) => scope.postMessage?.(message),
  )
  scope.addEventListener('message', (event) => {
    handleMessage(event.data)
  })
}

installWorkerEntry()
