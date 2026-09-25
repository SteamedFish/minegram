import type {
  GameAction,
  GameFailureDiagnostics,
  GameState,
  PendingGeneration,
} from './gameReducer'
import { gameReducer } from './gameReducer'
import {
  isGenerationWorkerResponse,
  type GenerationCancellation,
  type GenerationRequest,
  type GenerationWorkerCommand,
} from './generationWorker'
import type { GenerationSettings, GenerationSettingsInput } from '../engine/generator/settings'

export interface GenerationWorkerHandlers {
  readonly message: (event: MessageEvent<unknown>) => void
  readonly error: (event: ErrorEvent) => void
  readonly messageError: (event: MessageEvent<unknown>) => void
}

/** Minimal Worker boundary, kept injectable for Node/jsdom tests. */
export interface GenerationWorkerEndpoint {
  postMessage(message: GenerationWorkerCommand): void
  terminate(): void
  setHandlers(handlers: GenerationWorkerHandlers): void
}

export type GenerationWorkerFactory = () => GenerationWorkerEndpoint
export type GenerationDispatch = (action: GameAction) => void

export interface GenerationStateStore {
  getState(): GameState
}

export interface GenerationClientOptions {
  /** Must reflect each action synchronously after `dispatch` returns. */
  readonly store: GenerationStateStore
  /** May return void (for example, a React dispatch wrapper). */
  readonly dispatch: GenerationDispatch
  readonly workerFactory?: GenerationWorkerFactory
}

interface ActiveGeneration {
  readonly requestId: number
  readonly generationId: number
  readonly settings: GenerationSettings
  readonly worker: GenerationWorkerEndpoint
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
export function createDefaultGenerationWorker(): GenerationWorkerEndpoint {
  const worker = new Worker(new URL('./generationWorker.ts', import.meta.url), { type: 'module' })
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

/**
 * Headless generation controller. The injected store is synchronous: after
 * dispatching `generation/start`, the reducer's pending ID/settings are the only
 * source used to create the Worker request.
 */
export class GenerationClient {
  private readonly store: GenerationStateStore
  private readonly dispatch: GenerationDispatch
  private readonly workerFactory: GenerationWorkerFactory
  private active: ActiveGeneration | null = null
  private failedSettings: GenerationSettings | null = null
  private requestCounter = 0
  private disposed = false

  constructor(options: GenerationClientOptions) {
    this.store = options.store
    this.dispatch = options.dispatch
    this.workerFactory = options.workerFactory ?? createDefaultGenerationWorker
  }

  get currentState(): GameState {
    return this.store.getState()
  }

  get isDisposed(): boolean {
    return this.disposed
  }

  /** Starts an initial or explicitly requested replacement round. */
  start(settings?: GenerationSettingsInput, initialScore?: number): boolean {
    return this.startWithAction(
      settings === undefined && initialScore === undefined
        ? { type: 'generation/start' }
        : {
            type: 'generation/start',
            ...(settings === undefined ? {} : { settings }),
            ...(initialScore === undefined ? {} : { initialScore }),
          },
    )
  }

  /**
   * The caller invokes this explicitly after a win. The reducer receives the
   * current base settings and derives the deterministic next-round seed.
   */
  startNextRound(initialScore?: number): boolean {
    return this.startWithAction({
      type: 'generation/start',
      settings: this.store.getState().settings,
      ...(initialScore === undefined ? {} : { initialScore }),
    })
  }

  /** Reuses the exact settings of the most recent failed/cancelled request. */
  retry(): boolean {
    if (this.failedSettings === null) {
      return false
    }
    return this.startWithAction({
      type: 'generation/start',
      settings: this.failedSettings,
    })
  }

  /** Invalidates the token, terminates the Worker, then cancels via reducer. */
  cancel(): boolean {
    const active = this.active
    if (this.disposed || active === null) {
      return false
    }

    this.active = null
    this.failedSettings = active.settings
    const cancellation: GenerationCancellation = {
      type: 'generation/cancel',
      requestId: active.requestId,
      generationId: active.generationId,
    }
    try {
      active.worker.postMessage(cancellation)
    } catch {
      // Termination below is the cancellation fallback.
    }
    this.terminate(active.worker)
    this.dispatch({ type: 'generation/cancelled', generationId: active.generationId })
    return true
  }

  /** Invalidates and releases the Worker without mutating reducer state. */
  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    const active = this.active
    this.active = null
    if (active === null) {
      return
    }
    try {
      active.worker.postMessage({
        type: 'generation/cancel',
        requestId: active.requestId,
        generationId: active.generationId,
      })
    } catch {
      // The Worker may already be gone.
    }
    this.terminate(active.worker)
  }

  private startWithAction(action: GameAction): boolean {
    if (this.disposed || this.active !== null) {
      return false
    }

    const previousGenerationId = this.store.getState().generationId
    this.dispatch(action)
    const state = this.store.getState()
    const pending = state.pendingGeneration
    if (
      pending === null ||
      state.status !== 'generating' ||
      state.generationId === previousGenerationId
    ) {
      return false
    }
    this.failedSettings = null
    this.launch(pending)
    return true
  }

  private nextRequestId(): number {
    this.requestCounter += 1
    return this.requestCounter
  }

  private launch(pending: PendingGeneration): void {
    const requestId = this.nextRequestId()
    let worker: GenerationWorkerEndpoint | null = null

    try {
      const created = this.workerFactory()
      worker = created
      created.setHandlers({
        message: (event) => {
          this.handleMessage(created, requestId, pending.id, event.data)
        },
        error: (event) => {
          event.preventDefault()
          this.reportFailure(
            created,
            requestId,
            pending.id,
            workerFailure('worker-error', `Generation Worker error: ${event.message || 'unknown error'}`),
          )
        },
        messageError: (_event) => {
          this.reportFailure(
            created,
            requestId,
            pending.id,
            workerFailure('worker-message-error', 'Generation Worker sent an unreadable message'),
          )
        },
      })
    } catch (error) {
      if (worker !== null) {
        this.terminate(worker)
      }
      this.dispatch({
        type: 'generation/failed',
        generationId: pending.id,
        failure: workerFailure(
          'worker-unavailable',
          `Generation Worker could not be created: ${errorMessage(error)}`,
        ),
      })
      this.failedSettings = pending.settings
      return
    }

    const active: ActiveGeneration = {
      requestId,
      generationId: pending.id,
      settings: pending.settings,
      worker,
    }
    this.active = active
    const request: GenerationRequest = {
      type: 'generation/request',
      requestId,
      generationId: pending.id,
      settings: pending.settings,
    }
    try {
      worker.postMessage(request)
    } catch (error) {
      this.reportFailure(
        worker,
        requestId,
        pending.id,
        workerFailure('worker-post-error', `Generation Worker request failed: ${errorMessage(error)}`),
      )
    }
  }

  private handleMessage(
    worker: GenerationWorkerEndpoint,
    requestId: number,
    generationId: number,
    data: unknown,
  ): void {
    const active = this.active
    if (
      active === null ||
      active.worker !== worker ||
      active.requestId !== requestId ||
      active.generationId !== generationId
    ) {
      return
    }
    if (!isGenerationWorkerResponse(data)) {
      this.reportFailure(
        worker,
        requestId,
        generationId,
        workerFailure('invalid-worker-response', 'Generation Worker returned an invalid response'),
      )
      return
    }
    if (data.requestId !== requestId || data.generationId !== generationId) {
      return
    }

    this.active = null
    this.terminate(worker)
    if (data.type === 'generation/succeeded') {
      this.dispatch({
        type: 'generation/succeeded',
        generationId,
        round: data.round,
      })
      const state = this.store.getState()
      if (
        state.generationId === generationId &&
        state.status === 'generating' &&
        state.pendingGeneration?.id === generationId
      ) {
        this.failedSettings = active.settings
        this.dispatch({
          type: 'generation/failed',
          generationId,
          failure: workerFailure(
            'invalid-generated-round',
            'Generation Worker returned a round rejected by the reducer',
          ),
        })
      }
      return
    }

    this.failedSettings = active.settings
    this.dispatch({ type: 'generation/failed', generationId, failure: data.failure })
  }

  private reportFailure(
    worker: GenerationWorkerEndpoint,
    requestId: number,
    generationId: number,
    failure: GameFailureDiagnostics,
  ): void {
    const active = this.active
    if (
      active === null ||
      active.worker !== worker ||
      active.requestId !== requestId ||
      active.generationId !== generationId
    ) {
      return
    }
    this.active = null
    this.terminate(worker)
    this.failedSettings = active.settings
    this.dispatch({ type: 'generation/failed', generationId, failure })
  }

  private terminate(worker: GenerationWorkerEndpoint): void {
    try {
      worker.terminate()
    } catch {
      // A fake or already-closed Worker may throw while being released.
    }
  }
}

/** A synchronous reducer bridge for callers whose dispatch intentionally returns void. */
export function createGenerationStateBridge(
  initialState: GameState,
  reduce: (state: GameState, action: GameAction) => GameState = (state, action) =>
    gameReducer(state, action).state,
): GenerationStateStore & { dispatch: GenerationDispatch } {
  let state = initialState
  return Object.freeze({
    getState: () => state,
    dispatch(action: GameAction) {
      state = reduce(state, action)
    },
  })
}
