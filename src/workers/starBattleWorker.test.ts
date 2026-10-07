import { describe, expect, it } from 'vitest'
import type { StarBattlePuzzle } from '../domain/starBattle'
import {
  STAR_DIFFICULTIES,
  type StarGeneratedBoard,
  type StarGenerationRequest,
} from '../engine/starBattle/construct'
import {
  STAR_DIFFICULTY_TIERS,
  createStarBattleMessageHandler,
  isStarBattleWorkerResponse,
  isStarDifficulty,
  type StarBattleRequestMessage,
  type StarBattleWorkerResponse,
} from './starBattleWorker'

// ======================================================================================
// Fixtures
// ======================================================================================

/**
 * n = 4 with the row-index colouring (`colours[row * 4 + col] = row`): every
 * colour is used, and the planted stars land on pairwise-distinct colours for
 * any permutation, which keeps the fixture honest under the domain validator.
 */
const PUZZLE: StarBattlePuzzle = Object.freeze({
  n: 4,
  seed: 42,
  colours: new Uint8Array([
    0, 0, 0, 0,
    1, 1, 1, 1,
    2, 2, 2, 2,
    3, 3, 3, 3,
  ]),
  solution: [1, 3, 0, 2],
})

const BOARD: StarGeneratedBoard = Object.freeze({
  puzzle: PUZZLE,
  waves: 3,
  difficulty: 'starter',
})

const REQUEST: StarBattleRequestMessage = Object.freeze({
  type: 'star-generation/request',
  requestId: 17,
  generationId: 4,
  n: 4,
  seed: 42,
  difficulty: 'starter',
})

function runHandler(
  generate: (request: StarGenerationRequest) => StarGeneratedBoard,
  message: unknown = REQUEST,
): readonly StarBattleWorkerResponse[] {
  const responses: StarBattleWorkerResponse[] = []
  const handle = createStarBattleMessageHandler(generate, (response) => {
    responses.push(response)
  })
  handle(message)
  return responses
}

// ======================================================================================
// Protocol
// ======================================================================================

describe('star battle Worker protocol', () => {
  it('maps a certified board to the succeeded message, ids and metadata intact', () => {
    let received: StarGenerationRequest | null = null
    const generate = (request: StarGenerationRequest): StarGeneratedBoard => {
      received = request
      return BOARD
    }

    const responses = runHandler(generate)

    expect(received).toEqual({ n: 4, seed: 42, difficulty: 'starter' })
    expect(responses).toHaveLength(1)
    expect(responses[0]).toEqual({
      type: 'star-generation/succeeded',
      requestId: 17,
      generationId: 4,
      puzzle: PUZZLE,
      waves: 3,
      difficulty: 'starter',
    })
  })

  it('reports a throwing generator as a worker-exception failure, never a board', () => {
    const generate = (): StarGeneratedBoard => {
      throw new Error('no certified board exists')
    }

    const responses = runHandler(generate)

    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      type: 'star-generation/failed',
      requestId: 17,
      generationId: 4,
      failure: {
        reason: 'worker-exception',
        message: 'Star Battle generation threw an exception: no certified board exists',
        details: { stage: 'generation' },
      },
    })
  })

  it('rejects a malformed engine result instead of shipping it as success', () => {
    const generate = (): StarGeneratedBoard =>
      ({ ...BOARD, puzzle: { ...PUZZLE, solution: [1, 1, 0, 2] } }) as StarGeneratedBoard

    const responses = runHandler(generate)

    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      type: 'star-generation/failed',
      failure: { reason: 'invalid-generated-round' },
    })
  })

  it('answers a throw with a non-Error value with the generic exception message', () => {
    const generate = (): StarGeneratedBoard => {
      throw 'string failure'
    }

    const responses = runHandler(generate)

    expect(responses[0]).toMatchObject({
      type: 'star-generation/failed',
      failure: { reason: 'worker-exception', message: 'Star Battle generation threw an exception: string failure' },
    })
  })

  it('ignores commands that do not parse: wrong type, bad identity, bad seed, unknown tier', () => {
    const generate = (): StarGeneratedBoard => BOARD

    const malformed: readonly unknown[] = [
      null,
      'star-generation/request',
      { type: 'star-generation/request' },
      { ...REQUEST, requestId: 0 },
      { ...REQUEST, generationId: -1 },
      { ...REQUEST, n: 3.5 },
      { ...REQUEST, seed: -1 },
      { ...REQUEST, seed: 1.5 },
      { ...REQUEST, difficulty: 'impossible' },
      { type: 'star-generation/cancel', requestId: 17 },
    ]
    for (const message of malformed) {
      expect(runHandler(generate, message)).toHaveLength(0)
    }
  })

  it('accepts seed 0, which normalizeRandomSeed can legitimately produce', () => {
    const responses = runHandler(() => BOARD, { ...REQUEST, seed: 0 })

    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ type: 'star-generation/succeeded' })
  })

  it('treats a cancellation for an unknown identity as a no-op', () => {
    const generate = (): StarGeneratedBoard => BOARD
    const responses: StarBattleWorkerResponse[] = []
    const handle = createStarBattleMessageHandler(generate, (response) => {
      responses.push(response)
    })

    handle({ type: 'star-generation/cancel', requestId: 99, generationId: 99 })
    handle(REQUEST)

    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ type: 'star-generation/succeeded' })
  })

  it('does not post when the generation was superseded before it answered', () => {
    // A synchronous generator finishes inside the first handle call, so the
    // only reachable superseded path is a generator that re-enters the handler
    // (a pathological engine). The abort guard must still drop that answer.
    const responses: StarBattleWorkerResponse[] = []
    let handle: (message: unknown) => void = () => {}
    const reentrant = (_request: StarGenerationRequest): StarGeneratedBoard => {
      handle({ type: 'star-generation/cancel', requestId: 17, generationId: 4 })
      return BOARD
    }
    handle = createStarBattleMessageHandler(reentrant, (response) => {
      responses.push(response)
    })

    handle(REQUEST)

    expect(responses).toHaveLength(0)
  })
})

// ======================================================================================
// Response guard
// ======================================================================================

describe('isStarBattleWorkerResponse', () => {
  it('accepts a well-formed succeeded message', () => {
    expect(
      isStarBattleWorkerResponse({
        type: 'star-generation/succeeded',
        requestId: 1,
        generationId: 1,
        puzzle: PUZZLE,
        waves: 2,
        difficulty: 'steady',
      }),
    ).toBe(true)
  })

  it('rejects a succeeded message whose puzzle fails the domain validator', () => {
    expect(
      isStarBattleWorkerResponse({
        type: 'star-generation/succeeded',
        requestId: 1,
        generationId: 1,
        puzzle: { ...PUZZLE, solution: [0, 0, 0, 0] },
        waves: 2,
        difficulty: 'steady',
      }),
    ).toBe(false)
  })

  it('rejects a succeeded message without a positive integer wave count', () => {
    expect(
      isStarBattleWorkerResponse({
        type: 'star-generation/succeeded',
        requestId: 1,
        generationId: 1,
        puzzle: PUZZLE,
        waves: 0,
        difficulty: 'steady',
      }),
    ).toBe(false)
  })

  it('accepts a well-formed failed message and rejects malformed ones', () => {
    expect(
      isStarBattleWorkerResponse({
        type: 'star-generation/failed',
        requestId: 1,
        generationId: 1,
        failure: { reason: 'worker-exception', message: 'boom', details: { stage: 'generation' } },
      }),
    ).toBe(true)
    expect(
      isStarBattleWorkerResponse({
        type: 'star-generation/failed',
        requestId: 1,
        generationId: 1,
        failure: { message: 'no reason' },
      }),
    ).toBe(false)
    expect(isStarBattleWorkerResponse({ type: 'star-generation/other', requestId: 1, generationId: 1 })).toBe(false)
    expect(isStarBattleWorkerResponse(null)).toBe(false)
  })
})

// ======================================================================================
// Difficulty mirror
// ======================================================================================

describe('difficulty tiers', () => {
  it('re-exports the engine tier list unchanged', () => {
    // Asserting a hand-copied literal here is what let the tier list drift: the engine grew
    // `expert` and `contradiction` while this test still demanded three ids, and the suite
    // failed on a fact that was never wrong. Comparing against the engine's own list means a
    // rename or a re-order now fails HERE instead, where the cause is visible.
    expect(STAR_DIFFICULTY_TIERS).toEqual([...STAR_DIFFICULTIES])
  })

  it('keeps the documented tier ids and order', () => {
    // The other direction: if the engine's list silently changes shape, the re-export still
    // matches and the test above passes. This pins what the ids actually are, which is the
    // part a reader needs to trust.
    expect([...STAR_DIFFICULTIES]).toEqual([
      'starter',
      'steady',
      'challenging',
      'expert',
      'contradiction',
    ])
  })

  it('guards the tier boundary, failing closed on anything else', () => {
    expect(isStarDifficulty('starter')).toBe(true)
    expect(isStarDifficulty('challenging')).toBe(true)
    expect(isStarDifficulty('impossible')).toBe(false)
    expect(isStarDifficulty(null)).toBe(false)
    expect(isStarDifficulty(3)).toBe(false)
  })
})
