import { derivePuzzleClues } from '../domain'
import {
  normalizeGenerationSettings,
  type GenerationSettings,
} from '../engine/generator/settings'
import { describe, expect, it } from 'vitest'
import {
  createGenerationStateBridge,
  GenerationClient,
  type GenerationWorkerEndpoint,
  type GenerationWorkerHandlers,
} from './generationClient'
import {
  createInitialGameState,
  deriveNextRoundSettings as deriveNextRoundSettingsFromReducer,
  type GameAction,
  type GameState,
  type GeneratedRound,
} from './gameReducer'
import type {
  GenerationRequest,
  GenerationSucceededMessage,
  GenerationWorkerCommand,
} from './generationWorker'

const dimensions = { rows: 2, columns: 2 } as const
const board = [1, 0, 0, 1] as const
const puzzle = { dimensions, clues: derivePuzzleClues(board, dimensions) }
const settings = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  difficulty: 'starter',
  seed: 'client-fixture',
  maxAttempts: 3,
})
const difficulty = {
  status: 'known' as const,
  minimumGuesses: 2,
  minimum: 2,
  band: 'starter' as const,
  diagnostics: {
    nodesVisited: 4,
    statesEvaluated: 3,
    memoEntries: 2,
    maxDepth: 2,
  },
}

class FakeWorker implements GenerationWorkerEndpoint {
  readonly sent: GenerationWorkerCommand[] = []
  terminateCount = 0
  onPost: ((worker: FakeWorker, message: GenerationWorkerCommand) => void) | null = null
  private handlers: GenerationWorkerHandlers | null = null

  postMessage(message: GenerationWorkerCommand): void {
    this.sent.push(message)
    this.onPost?.(this, message)
  }

  terminate(): void {
    this.terminateCount += 1
  }

  setHandlers(handlers: GenerationWorkerHandlers): void {
    this.handlers = handlers
  }

  emitMessage(data: unknown): void {
    this.requiredHandlers().message(new MessageEvent('message', { data }))
  }

  emitError(message: string): boolean {
    const event = new ErrorEvent('error', {
      cancelable: true,
      message,
    })
    this.requiredHandlers().error(event)
    return event.defaultPrevented
  }

  emitMessageError(): void {
    this.requiredHandlers().messageError(new MessageEvent('messageerror'))
  }

  private requiredHandlers(): GenerationWorkerHandlers {
    if (this.handlers === null) {
      throw new Error('fake Worker has no handlers')
    }
    return this.handlers
  }
}

function requestFrom(worker: FakeWorker, index = 0): GenerationRequest {
  const message = worker.sent[index]
  if (message === undefined || message.type !== 'generation/request') {
    throw new Error(`expected generation request at index ${index}`)
  }
  return message
}

function roundFor(roundSettings: GenerationSettings = settings): GeneratedRound {
  return {
    settings: roundSettings,
    board,
    puzzle,
    difficulty,
  }
}

function successFor(
  request: GenerationRequest,
  round: GeneratedRound = roundFor(request.settings),
): GenerationSucceededMessage {
  return {
    type: 'generation/succeeded',
    requestId: request.requestId,
    generationId: request.generationId,
    round,
  }
}

function createHarness(): {
  readonly bridge: ReturnType<typeof createGenerationStateBridge>
  readonly client: GenerationClient
  readonly workers: FakeWorker[]
  readonly actions: GameAction[]
  state(): GameState
} {
  const bridge = createGenerationStateBridge(createInitialGameState())
  const workers: FakeWorker[] = []
  const actions: GameAction[] = []
  const client = new GenerationClient({
    store: bridge,
    dispatch(action) {
      actions.push(action)
      bridge.dispatch(action)
    },
    workerFactory() {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })
  return {
    bridge,
    client,
    workers,
    actions,
    state: () => bridge.getState(),
  }
}

function attachClient(
  bridge: ReturnType<typeof createGenerationStateBridge>,
  actions: GameAction[],
): { readonly client: GenerationClient; readonly workers: FakeWorker[] } {
  const workers: FakeWorker[] = []
  const client = new GenerationClient({
    store: bridge,
    dispatch(action) {
      actions.push(action)
      bridge.dispatch(action)
    },
    workerFactory() {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    },
  })
  return { client, workers }
}

/**
 * Round 1 is won, then a pending generation is left behind by a disposed
 * client: the store is `generating` with a pending request carrying the derived
 * next-round seed while `state.settings` still holds round 1's seed.
 */
function createPostWinOrphanStore(): {
  readonly bridge: ReturnType<typeof createGenerationStateBridge>
  readonly nextRoundSettings: GenerationSettings
} {
  const bridge = createGenerationStateBridge(createInitialGameState())
  bridge.dispatch({ type: 'generation/start', settings })
  bridge.dispatch({ type: 'generation/succeeded', generationId: 1, round: roundFor(settings) })
  bridge.dispatch({
    type: 'round/markBatch',
    cells: [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
      { index: 3, assertion: 'mine' },
    ],
  })
  expect(bridge.getState().status).toBe('won')
  const nextRoundSettings = deriveNextRoundSettingsFromReducer(settings, 2)
  bridge.dispatch({ type: 'generation/start' })
  return { bridge, nextRoundSettings }
}

describe('GenerationClient', () => {
  it('dispatches start before a successful result and uses reducer pending settings', () => {
    const harness = createHarness()

    expect(harness.client.start(settings)).toBe(true)
    const worker = harness.workers[0]
    const request = requestFrom(worker)
    expect(request).toMatchObject({
      type: 'generation/request',
      requestId: 1,
      generationId: 1,
      settings,
    })
    expect(harness.actions.map((action) => action.type)).toEqual(['generation/start'])

    worker.emitMessage(successFor(request))

    expect(harness.actions.map((action) => action.type)).toEqual([
      'generation/start',
      'generation/succeeded',
    ])
    expect(harness.state()).toMatchObject({
      status: 'playing',
      generationId: 1,
      pendingGeneration: null,
      difficulty: { status: 'known', band: 'starter', minimumGuesses: 2 },
    })
    expect(worker.terminateCount).toBe(1)
  })

  it('maps failure details and retries with the failed pending settings', () => {
    const harness = createHarness()
    harness.client.start(settings)
    const firstWorker = harness.workers[0]
    const firstRequest = requestFrom(firstWorker)
    const failure = {
      reason: 'time-limit',
      message: 'Minegram generation failed: time-limit',
      details: { attempts: 3, nested: { resource: true } },
    }

    firstWorker.emitMessage({
      type: 'generation/failed',
      requestId: firstRequest.requestId,
      generationId: firstRequest.generationId,
      failure,
    })

    expect(harness.state().failure).toEqual(failure)
    expect(JSON.parse(JSON.stringify(harness.state().failure))).toEqual(failure)
    expect(harness.client.retry()).toBe(true)
    const retryRequest = requestFrom(harness.workers[1])
    expect(retryRequest.settings).toEqual(firstRequest.settings)
    expect(retryRequest.generationId).toBe(2)
  })

  it('invalidates cancellation tokens so stale results are no-ops', () => {
    const harness = createHarness()
    harness.client.start(settings)
    const firstWorker = harness.workers[0]
    const staleRequest = requestFrom(firstWorker)

    expect(harness.client.cancel()).toBe(true)
    expect(firstWorker.sent[1]).toEqual({
      type: 'generation/cancel',
      requestId: staleRequest.requestId,
      generationId: staleRequest.generationId,
    })
    expect(firstWorker.terminateCount).toBe(1)
    expect(harness.state().status).toBe('failed')

    firstWorker.emitMessage(successFor(staleRequest))
    expect(harness.actions.map((action) => action.type)).toEqual([
      'generation/start',
      'generation/cancelled',
    ])

    expect(harness.client.retry()).toBe(true)
    const activeWorker = harness.workers[1]
    const activeRequest = requestFrom(activeWorker)
    firstWorker.emitMessage(successFor(staleRequest))
    expect(harness.state().status).toBe('generating')
    expect(harness.state().generationId).toBe(2)

    activeWorker.emitMessage(successFor(activeRequest))
    expect(harness.state().status).toBe('playing')
    expect(harness.state().generationId).toBe(2)
  })

  it('prevents duplicate starts for a request this client owns', () => {
    const duplicateHarness = createHarness()
    expect(duplicateHarness.client.start(settings)).toBe(true)
    expect(duplicateHarness.client.start(settings)).toBe(false)
    expect(duplicateHarness.workers).toHaveLength(1)
    expect(duplicateHarness.workers[0].sent).toHaveLength(1)
    expect(duplicateHarness.actions).toHaveLength(1)
  })

  it('takes over an orphaned pending generation before starting a new request', () => {
    const harness = createHarness()
    harness.bridge.dispatch({ type: 'generation/start', settings })
    expect(harness.state()).toMatchObject({ status: 'generating', generationId: 1 })

    expect(harness.client.start(settings)).toBe(true)

    expect(harness.actions).toMatchObject([
      { type: 'generation/cancelled', generationId: 1 },
      { type: 'generation/start' },
    ])
    const request = requestFrom(harness.workers[0])
    expect(request.generationId).toBe(2)
    expect(harness.state()).toMatchObject({ status: 'generating', generationId: 2 })
  })

  it('starts a post-win orphan with the derived next-round seed through start()', () => {
    const { bridge, nextRoundSettings } = createPostWinOrphanStore()
    const orphan = bridge.getState()
    expect(orphan.settings.seed).toBe(settings.seed)
    expect(orphan.pendingGeneration?.settings.seed).toBe(nextRoundSettings.seed)
    const actions: GameAction[] = []
    const attached = attachClient(bridge, actions)

    expect(attached.client.start()).toBe(true)

    expect(actions.map((action) => action.type)).toEqual([
      'generation/cancelled',
      'generation/start',
    ])
    const pending = bridge.getState().pendingGeneration
    expect(pending?.settings.seed).toBe(nextRoundSettings.seed)
    expect(pending?.settings.seed).not.toBe(settings.seed)
    expect(requestFrom(attached.workers[0]).settings.seed).toBe(nextRoundSettings.seed)
  })

  it('starts a post-win orphan with the derived next-round seed through startNextRound()', () => {
    const { bridge, nextRoundSettings } = createPostWinOrphanStore()
    const orphan = bridge.getState()
    expect(orphan.settings.seed).toBe(settings.seed)
    expect(orphan.pendingGeneration?.settings.seed).toBe(nextRoundSettings.seed)
    const actions: GameAction[] = []
    const attached = attachClient(bridge, actions)

    expect(attached.client.startNextRound()).toBe(true)

    expect(actions.map((action) => action.type)).toEqual([
      'generation/cancelled',
      'generation/start',
    ])
    const pending = bridge.getState().pendingGeneration
    expect(pending?.settings.seed).toBe(nextRoundSettings.seed)
    expect(pending?.settings.seed).not.toBe(settings.seed)
    expect(requestFrom(attached.workers[0]).settings.seed).toBe(nextRoundSettings.seed)
  })

  it('clears an in-flight pending generation on dispose so a new client can start', () => {
    const bridge = createGenerationStateBridge(createInitialGameState())
    const actions: GameAction[] = []
    const first = attachClient(bridge, actions)

    expect(first.client.start(settings)).toBe(true)
    const staleRequest = requestFrom(first.workers[0])

    first.client.dispose()

    expect(first.workers[0].terminateCount).toBe(1)
    expect(actions.map((action) => action.type)).toEqual([
      'generation/start',
      'generation/cancelled',
    ])
    expect(bridge.getState()).toMatchObject({ status: 'failed', pendingGeneration: null })

    first.workers[0].emitMessage(successFor(staleRequest))
    expect(actions).toHaveLength(2)
    expect(bridge.getState().status).toBe('failed')

    const second = attachClient(bridge, actions)
    expect(second.client.start(settings)).toBe(true)
    const request = requestFrom(second.workers[0])
    expect(request.generationId).toBe(2)
    second.workers[0].emitMessage(successFor(request))
    expect(bridge.getState().status).toBe('playing')
  })

  it('disposes without dispatching a cancellation when nothing is in flight', () => {
    const idleHarness = createHarness()

    idleHarness.client.dispose()

    expect(idleHarness.actions).toEqual([])
    expect(idleHarness.state()).toMatchObject({ status: 'idle', pendingGeneration: null })

    const playingHarness = createHarness()
    playingHarness.client.start(settings)
    const worker = playingHarness.workers[0]
    worker.emitMessage(successFor(requestFrom(worker)))
    const playingState = playingHarness.state()
    expect(playingState.status).toBe('playing')
    const dispatched = playingHarness.actions.length

    playingHarness.client.dispose()

    expect(playingHarness.actions).toHaveLength(dispatched)
    expect(playingHarness.state()).toBe(playingState)
  })

  it('handles a Worker response emitted synchronously during postMessage', () => {
    const bridge = createGenerationStateBridge(createInitialGameState())
    const worker = new FakeWorker()
    const actions: GameAction[] = []
    worker.onPost = (current, message) => {
      if (message.type === 'generation/request') {
        current.emitMessage(successFor(message))
      }
    }
    const client = new GenerationClient({
      store: bridge,
      dispatch(action) {
        actions.push(action)
        bridge.dispatch(action)
      },
      workerFactory: () => worker,
    })

    expect(client.start(settings)).toBe(true)
    expect(client.retry()).toBe(false)
    expect(actions.map((action) => action.type)).toEqual([
      'generation/start',
      'generation/succeeded',
    ])
    expect(bridge.getState().status).toBe('playing')
  })

  it('contains Worker error and messageerror events as generation failures', () => {
    const errorHarness = createHarness()
    errorHarness.client.start(settings)
    const errorWorker = errorHarness.workers[0]
    const errorRequest = requestFrom(errorWorker)
    expect(errorWorker.emitError('fixture worker failure')).toBe(true)
    expect(errorHarness.actions.at(-1)).toMatchObject({
      type: 'generation/failed',
      generationId: errorRequest.generationId,
      failure: { reason: 'worker-error' },
    })

    const messageHarness = createHarness()
    messageHarness.client.start(settings)
    const messageWorker = messageHarness.workers[0]
    const messageRequest = requestFrom(messageWorker)
    messageWorker.emitMessageError()
    expect(messageHarness.actions.at(-1)).toMatchObject({
      type: 'generation/failed',
      generationId: messageRequest.generationId,
      failure: { reason: 'worker-message-error' },
    })
  })

  it('clears a pending generation when the reducer rejects a success result', () => {
    const harness = createHarness()
    harness.client.start(settings)
    const worker = harness.workers[0]
    const request = requestFrom(worker)
    const mismatchedSettings = normalizeGenerationSettings({ ...settings, seed: 'wrong-seed' })

    worker.emitMessage(successFor(request, roundFor(mismatchedSettings)))

    expect(harness.actions.map((action) => action.type)).toEqual([
      'generation/start',
      'generation/succeeded',
      'generation/failed',
    ])
    expect(harness.actions[2]).toMatchObject({
      type: 'generation/failed',
      generationId: request.generationId,
      failure: { reason: 'invalid-generated-round' },
    })
    expect(harness.state()).toMatchObject({
      status: 'failed',
      generationId: request.generationId,
      pendingGeneration: null,
    })
  })

  it('keeps the won board while an explicit next-round request generates', () => {
    const harness = createHarness()
    harness.client.start(settings)
    const firstWorker = harness.workers[0]
    const firstRequest = requestFrom(firstWorker)
    firstWorker.emitMessage(successFor(firstRequest))
    const wonState = harness.state()
    expect(wonState.status).toBe('playing')

    harness.bridge.dispatch({
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'mine' },
        { index: 1, assertion: 'blank' },
        { index: 2, assertion: 'blank' },
        { index: 3, assertion: 'mine' },
      ],
    })
    expect(harness.state().status).toBe('won')
    expect(harness.workers).toHaveLength(1)

    expect(harness.client.startNextRound()).toBe(true)
    const secondRequest = requestFrom(harness.workers[1])
    expect(secondRequest.settings).toEqual(
      deriveNextRoundSettingsFromReducer(settings, 2),
    )
    expect(harness.state()).toMatchObject({
      status: 'generating',
      generationId: 2,
      board: wonState.board,
      puzzle: wonState.puzzle,
    })
  })
})
