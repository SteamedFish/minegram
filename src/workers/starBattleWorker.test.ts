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
  isStarBattleProgressMessage,
  isStarBattleWorkerResponse,
  isStarDifficulty,
  type StarBattleRequestMessage,
  type StarBattleWorkerMessage,
  type StarGenerationOptions,
  type StarGenerationProgress,
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
  difficulty: 'challenging',
})

const REQUEST: StarBattleRequestMessage = Object.freeze({
  type: 'star-generation/request',
  requestId: 17,
  generationId: 4,
  n: 4,
  seed: 42,
  difficulty: 'challenging',
})

function runHandler(
  generate: (request: StarGenerationRequest) => StarGeneratedBoard,
  message: unknown = REQUEST,
): readonly StarBattleWorkerMessage[] {
  const responses: StarBattleWorkerMessage[] = []
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

    expect(received).toEqual({ n: 4, seed: 42, difficulty: 'challenging' })
    expect(responses).toHaveLength(1)
    expect(responses[0]).toEqual({
      type: 'star-generation/succeeded',
      requestId: 17,
      generationId: 4,
      puzzle: PUZZLE,
      waves: 3,
      difficulty: 'challenging',
    })
  })

  it('forwards the fallback flag when the engine fell back, and omits it otherwise', () => {
    // Absence is the wire spelling of "not a fallback": an older worker, or
    // a board from the main construction, sends no field, and the store
    // reads absence as false. Only an explicit true travels.
    const fallbackResponses = runHandler(() => ({ ...BOARD, fallback: true }))
    expect(fallbackResponses[0]).toMatchObject({ type: 'star-generation/succeeded', fallback: true })

    const normalResponses = runHandler(() => BOARD)
    expect(normalResponses[0]).toMatchObject({ type: 'star-generation/succeeded' })
    expect(normalResponses[0]).not.toHaveProperty('fallback')

    const explicitFalseResponses = runHandler(() => ({ ...BOARD, fallback: false }))
    expect(explicitFalseResponses[0]).not.toHaveProperty('fallback')
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
    const responses: StarBattleWorkerMessage[] = []
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
    const responses: StarBattleWorkerMessage[] = []
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
// Progress
// ======================================================================================

describe('star battle Worker progress', () => {
  function runProgressHandler(
    generate: (
      request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ) => StarGeneratedBoard,
    message: unknown = REQUEST,
  ): readonly StarBattleWorkerMessage[] {
    const responses: StarBattleWorkerMessage[] = []
    const handle = createStarBattleMessageHandler(generate, (response) => {
      responses.push(response)
    })
    handle(message)
    return responses
  }

  it('posts each tick the engine reports, with the request identity attached', () => {
    const generate = (
      _request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ): StarGeneratedBoard => {
      options?.onProgress?.({ candidates: 3, accepted: 0, phase: 'sampling' })
      options?.onProgress?.({ candidates: 12, accepted: 1, phase: 'grading' })
      return BOARD
    }

    const responses = runProgressHandler(generate)

    expect(responses).toHaveLength(3)
    expect(responses[0]).toEqual({
      type: 'star-generation/progress',
      requestId: 17,
      generationId: 4,
      candidates: 3,
      accepted: 0,
      phase: 'sampling',
    })
    expect(responses[1]).toEqual({
      type: 'star-generation/progress',
      requestId: 17,
      generationId: 4,
      candidates: 12,
      accepted: 1,
      phase: 'grading',
    })
    expect(responses[2]).toMatchObject({ type: 'star-generation/succeeded' })
  })

  it('never posts a progress tick for a cancelled generation', () => {
    const responses: StarBattleWorkerMessage[] = []
    let handle: (message: unknown) => void = () => {}
    const generate = (
      _request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ): StarGeneratedBoard => {
      handle({ type: 'star-generation/cancel', requestId: 17, generationId: 4 })
      options?.onProgress?.({ candidates: 1, accepted: 0, phase: 'sampling' })
      return BOARD
    }
    handle = createStarBattleMessageHandler(generate, (response) => {
      responses.push(response)
    })

    handle(REQUEST)

    expect(responses).toHaveLength(0)
  })

  it('drops a progress tick once a new request has superseded the generation', () => {
    const responses: StarBattleWorkerMessage[] = []
    let handle: (message: unknown) => void = () => {}
    const generate = (
      request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ): StarGeneratedBoard => {
      if (request.seed === 42) {
        handle({ ...REQUEST, requestId: 18, generationId: 5, seed: 7 })
        options?.onProgress?.({ candidates: 1, accepted: 0, phase: 'sampling' })
      }
      return BOARD
    }
    handle = createStarBattleMessageHandler(generate, (response) => {
      responses.push(response)
    })

    handle(REQUEST)

    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({
      type: 'star-generation/succeeded',
      requestId: 18,
      generationId: 5,
    })
  })

  it('stops posting progress after the generation has succeeded', () => {
    const responses: StarBattleWorkerMessage[] = []
    let stash: ((progress: StarGenerationProgress) => void) | undefined
    const generate = (
      _request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ): StarGeneratedBoard => {
      stash = options?.onProgress
      return BOARD
    }
    const handle = createStarBattleMessageHandler(generate, (response) => {
      responses.push(response)
    })

    handle(REQUEST)
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ type: 'star-generation/succeeded' })

    // A pathological engine that fires a stashed callback after the answer
    // must not leak a tick: the generation has settled, so nothing posts.
    stash?.({ candidates: 4, accepted: 0, phase: 'repairing' })
    expect(responses).toHaveLength(1)
  })

  it('stops posting progress after the generation has failed', () => {
    const responses: StarBattleWorkerMessage[] = []
    let stash: ((progress: StarGenerationProgress) => void) | undefined
    const generate = (
      _request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ): StarGeneratedBoard => {
      stash = options?.onProgress
      throw new Error('no certified board exists')
    }
    const handle = createStarBattleMessageHandler(generate, (response) => {
      responses.push(response)
    })

    handle(REQUEST)
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ type: 'star-generation/failed' })

    stash?.({ candidates: 4, accepted: 0, phase: 'repairing' })
    expect(responses).toHaveLength(1)
  })

  it('drops an invalid tick from a lying engine instead of posting it or failing', () => {
    const generate = (
      _request: StarGenerationRequest,
      options?: StarGenerationOptions,
    ): StarGeneratedBoard => {
      options?.onProgress?.({ candidates: -1, accepted: 0, phase: 'sampling' })
      options?.onProgress?.({ candidates: 1.5, accepted: 0, phase: 'sampling' })
      // A lying engine reporting a phase outside the wire protocol.
      const lying = { candidates: 2, accepted: 0, phase: 'weaving' } as unknown as StarGenerationProgress
      options?.onProgress?.(lying)
      return BOARD
    }

    const responses = runProgressHandler(generate)

    // The malformed ticks are advisory: dropped, never posted, and the
    // healthy generation still answers with its board.
    expect(responses).toHaveLength(1)
    expect(responses[0]).toMatchObject({ type: 'star-generation/succeeded' })
  })
})

// ======================================================================================
// Progress guard
// ======================================================================================

describe('isStarBattleProgressMessage', () => {
  const TICK: Record<string, unknown> = {
    type: 'star-generation/progress',
    requestId: 1,
    generationId: 1,
    candidates: 3,
    accepted: 0,
    phase: 'sampling',
  }

  it('accepts a well-formed progress message', () => {
    expect(isStarBattleProgressMessage(TICK)).toBe(true)
  })

  it('rejects a tick whose candidate count is negative, fractional, or non-numeric', () => {
    expect(isStarBattleProgressMessage({ ...TICK, candidates: -1 })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, candidates: 1.5 })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, candidates: '3' })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, candidates: Number.NaN })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, candidates: Number.POSITIVE_INFINITY })).toBe(
      false,
    )
  })

  it('rejects a tick whose accepted count is negative or non-numeric', () => {
    expect(isStarBattleProgressMessage({ ...TICK, accepted: -1 })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, accepted: 0.5 })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, accepted: '1' })).toBe(false)
  })

  it('rejects a tick with an unknown phase', () => {
    expect(isStarBattleProgressMessage({ ...TICK, phase: 'weaving' })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, phase: null })).toBe(false)
  })

  it('rejects a tick with a missing or non-positive identity', () => {
    expect(isStarBattleProgressMessage({ ...TICK, requestId: 0 })).toBe(false)
    expect(isStarBattleProgressMessage({ ...TICK, generationId: -1 })).toBe(false)
    expect(isStarBattleProgressMessage({ candidates: 3, accepted: 0, phase: 'sampling' })).toBe(
      false,
    )
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
        difficulty: 'expert',
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
        difficulty: 'expert',
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
        difficulty: 'expert',
      }),
    ).toBe(false)
  })

  it('accepts a missing or boolean fallback flag, and rejects a forged one', () => {
    const base = {
      type: 'star-generation/succeeded',
      requestId: 1,
      generationId: 1,
      puzzle: PUZZLE,
      waves: 2,
      difficulty: 'expert',
    }
    // Absent — an older worker — reads as not-fallback on the store side.
    expect(isStarBattleWorkerResponse({ ...base })).toBe(true)
    expect(isStarBattleWorkerResponse({ ...base, fallback: true })).toBe(true)
    expect(isStarBattleWorkerResponse({ ...base, fallback: false })).toBe(true)
    // A corrupt or forged field must never become a fallback claim.
    expect(isStarBattleWorkerResponse({ ...base, fallback: 'yes' })).toBe(false)
    expect(isStarBattleWorkerResponse({ ...base, fallback: 1 })).toBe(false)
    expect(isStarBattleWorkerResponse({ ...base, fallback: null })).toBe(false)
  })

  it('rejects progress messages: the terminal guard narrows the store to succeeded', () => {
    // The store reads succeeded-only fields off this guard's narrowed result,
    // so progress — however well-formed — must fail it and be handled by
    // isStarBattleProgressMessage instead.
    expect(
      isStarBattleWorkerResponse({
        type: 'star-generation/progress',
        requestId: 1,
        generationId: 1,
        candidates: 3,
        accepted: 0,
        phase: 'sampling',
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
      'challenging',
      'expert',
      'contradiction',
    ])
  })

  it('guards the tier boundary, failing closed on anything else', () => {
    expect(isStarDifficulty('challenging')).toBe(true)
    // `starter` and `steady` were retired when the engine dropped to three tiers. A guard that
    // still accepted them would let the worker advertise a tier the generator cannot produce,
    // which is exactly the failure the store's persisted-preference path has to survive too.
    expect(isStarDifficulty('starter')).toBe(false)
    expect(isStarDifficulty('steady')).toBe(false)
    expect(isStarDifficulty('impossible')).toBe(false)
    expect(isStarDifficulty(null)).toBe(false)
    expect(isStarDifficulty(3)).toBe(false)
  })
})
