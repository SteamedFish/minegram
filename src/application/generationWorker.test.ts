import { derivePuzzleClues } from '../domain'
import {
  type GenerationDiagnostics,
  type GenerationResult,
} from '../engine/generator/generator'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import { describe, expect, it } from 'vitest'
import {
  createGenerationMessageHandler,
  isGenerationWorkerResponse,
  type GenerationPuzzleGenerator,
  type GenerationRequest,
  type GenerationWorkerResponse,
} from './generationWorker'

const board = [1, 0, 0, 1] as const
const dimensions = { rows: 2, columns: 2 } as const
const puzzle = { dimensions, clues: derivePuzzleClues(board, dimensions) }
const settings = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  difficulty: 'starter',
  seed: 'worker-fixture',
  maxAttempts: 3,
})

const diagnostics: GenerationDiagnostics = {
  attempts: 1,
  layouts: 1,
  candidates: 1,
  accepted: 1,
  rollbacks: 0,
  solverCalls: 1,
  solverStatuses: ['unique'],
  resourceReasons: [],
  difficultyNodesVisited: 4,
  difficultyNodeLimit: 100,
  proofStatus: 'unique',
  difficultyStatus: 'known',
  minimumGuesses: 2,
  band: 'starter',
}

const successResult: GenerationResult = {
  status: 'success',
  settings,
  board,
  puzzle,
  mineIndices: [0, 3],
  proof: {
    status: 'unique',
    solution: board,
    diagnostics: { nodesVisited: 5, solutionsFound: 1 },
  },
  difficulty: {
    status: 'known',
    minimumGuesses: 2,
    minimum: 2,
    band: 'starter',
    diagnostics: {
      nodesVisited: 4,
      statesEvaluated: 3,
      memoEntries: 2,
      maxDepth: 2,
    },
  },
  trace: [],
  diagnostics,
}

const failureResult: GenerationResult = {
  status: 'failure',
  reason: 'resource-limit',
  settings,
  diagnostics: {
    ...diagnostics,
    accepted: 0,
    proofStatus: 'unknown',
    difficultyStatus: 'not-run',
    minimumGuesses: undefined,
    band: undefined,
  },
}

const request: GenerationRequest = {
  type: 'generation/request',
  requestId: 17,
  generationId: 4,
  settings,
}

function runHandler(
  generate: GenerationPuzzleGenerator,
  message: unknown = request,
): readonly GenerationWorkerResponse[] {
  const responses: GenerationWorkerResponse[] = []
  const handle = createGenerationMessageHandler(generate, (response) => {
    responses.push(response)
  })
  handle(message)
  return responses
}

describe('generation Worker protocol', () => {
  it('maps a successful engine result to only the reducer-facing round', () => {
    let receivedSettings = settings
    let signalWasAborted: boolean | null = null
    const generate: GenerationPuzzleGenerator = (received, options) => {
      receivedSettings = received
      signalWasAborted = options.signal.aborted
      return successResult
    }

    const responses = runHandler(generate)

    expect(responses).toHaveLength(1)
    expect(receivedSettings).toEqual(settings)
    expect(signalWasAborted).toBe(false)
    expect(responses[0]).toEqual({
      type: 'generation/succeeded',
      requestId: 17,
      generationId: 4,
      round: {
        settings,
        board,
        puzzle,
        difficulty: successResult.difficulty,
      },
    })
    if (responses[0].type !== 'generation/succeeded') {
      throw new Error('expected a successful Worker response')
    }
    expect(Object.keys(responses[0].round).sort()).toEqual([
      'board',
      'difficulty',
      'puzzle',
      'settings',
    ])
    expect(JSON.parse(JSON.stringify(responses[0]))).toEqual(responses[0])
  })

  it('maps engine failures to JSON-serializable diagnostics', () => {
    const responses = runHandler(() => failureResult)

    expect(responses).toEqual([
      {
        type: 'generation/failed',
        requestId: 17,
        generationId: 4,
        failure: {
          reason: 'resource-limit',
          message: 'Minegram generation failed: resource-limit',
          details: {
            settings,
            diagnostics: expect.objectContaining({
              attempts: 1,
              proofStatus: 'unknown',
              solverStatuses: ['unique'],
            }),
          },
        },
      },
    ])
    expect(JSON.parse(JSON.stringify(responses[0]))).toEqual(responses[0])
  })

  it('sets the local cancellation signal for the matching request', () => {
    let handle: ((message: unknown) => void) | null = null
    let cancellationObserved = false
    const responses: GenerationWorkerResponse[] = []
    handle = createGenerationMessageHandler(
      (_received, options) => {
        handle?.({
          type: 'generation/cancel',
          requestId: request.requestId,
          generationId: request.generationId,
        })
        cancellationObserved = options.signal.aborted
        return failureResult
      },
      (response) => {
        responses.push(response)
      },
    )

    handle(request)

    expect(cancellationObserved).toBe(true)
    expect(responses).toHaveLength(1)
  })

  it('contains thrown exceptions and ignores malformed commands', () => {
    const thrown = runHandler(() => {
      throw new Error('fixture exception')
    })
    const malformed = runHandler(() => successResult, {
      type: 'generation/request',
      requestId: -1,
      generationId: 4,
      settings,
    })

    expect(thrown).toHaveLength(1)
    expect(thrown[0]).toMatchObject({
      type: 'generation/failed',
      failure: {
        reason: 'worker-exception',
        message: 'Minegram generation threw an exception: fixture exception',
      },
    })
    expect(malformed).toEqual([])
    expect(isGenerationWorkerResponse(thrown[0])).toBe(true)
    expect(isGenerationWorkerResponse(malformed[0])).toBe(false)
  })
})
