import { derivePuzzleClues, type MinegramPuzzle } from '../domain'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import { describe, expect, it } from 'vitest'
import {
  createInitialGameState,
  deriveNextRoundSettings,
  gameReducer,
  previewMarkBatch,
  type CellAssertion,
  type GameAction,
  type GameState,
  type GeneratedRound,
} from './gameReducer'

const board = [1, 0, 0, 1] as const
const dimensions = { rows: 2, columns: 2 } as const
const puzzle: MinegramPuzzle = {
  dimensions,
  clues: derivePuzzleClues(board, dimensions),
}
const settings = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  seed: 'fixture-seed',
  difficulty: 'starter',
  maxAttempts: 3,
})

const generatedRound: GeneratedRound = { settings, board, puzzle }

function start(settingsOverride = settings, initialScore = 5): GameState {
  return startWithRound(
    { ...generatedRound, settings: normalizeGenerationSettings(settingsOverride) },
    initialScore,
  )
}

function startWithRound(round: GeneratedRound, initialScore = 5): GameState {
  const initial = createInitialGameState({ settings: round.settings, initialScore })
  const started = gameReducer(initial, { type: 'generation/start' })
  expect(started.type).toBe('transition')
  if (started.type !== 'transition') {
    throw new Error('expected generation to start')
  }
  const succeeded = gameReducer(started.state, {
    type: 'generation/succeeded',
    generationId: started.state.generationId,
    round,
  })
  expect(succeeded.type).toBe('transition')
  if (succeeded.type !== 'transition') {
    throw new Error('expected generation to succeed')
  }
  return succeeded.state
}

function apply(state: GameState, action: GameAction): GameState {
  const result = gameReducer(state, action)
  if (result.type !== 'transition') {
    throw new Error(`expected transition, received ${result.type}: ${result.reason}`)
  }
  return result.state
}

function mark(index: number, assertion: CellAssertion): GameState {
  return apply(start(), { type: 'round/markBatch', cells: [{ index, assertion }] })
}

function markBatch(state: GameState, cells: readonly { readonly index: number; readonly assertion: CellAssertion }[]) {
  return apply(state, { type: 'round/markBatch', cells })
}

function correctFor(index: number): CellAssertion {
  return board[index] === 1 ? 'mine' : 'blank'
}

describe('gameReducer', () => {
  it('creates normalized idle state with the default score and immutable defaults', () => {
    const state = createInitialGameState()
    expect(state.status).toBe('idle')
    expect(state.round).toBe(0)
    expect(state.score).toBe(5)
    expect(state.initialScore).toBe(5)
    expect(state.settings).toEqual(normalizeGenerationSettings())
    expect(state.pendingGeneration).toBeNull()
    expect(Object.isFrozen(state)).toBe(true)
  })

  it('applies the unknown/correct/locked transition table', () => {
    const initial = start()
    const correct = markBatch(initial, [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
    ])
    expect(correct.marks).toEqual(['mine', 'blank', 'unknown', 'unknown'])
    expect(correct.locked).toEqual([true, true, false, false])
    expect(correct.score).toBe(5)

    const lockedAttempt = gameReducer(correct, {
      type: 'round/markBatch',
      cells: [{ index: 0, assertion: 'blank' }],
    })
    if (lockedAttempt.type !== 'ignored') {
      throw new Error(`expected ignored result, received ${lockedAttempt.type}`)
    }
    expect(lockedAttempt.reason).toBe('locked-cell')
    expect(lockedAttempt.state).toBe(correct)
  })

  it('charges wrong, repeated wrong, and opposite assertions while preserving penalty on correction', () => {
    let state = mark(1, 'mine')
    expect(state.marks[1]).toBe('mine')
    expect(state.locked[1]).toBe(false)
    expect(state.score).toBe(4)

    state = markBatch(state, [
      { index: 1, assertion: 'mine' },
      { index: 1, assertion: 'mine' },
    ])
    expect(state.score).toBe(3)

    state = markBatch(state, [{ index: 1, assertion: 'blank' }])
    expect(state.marks[1]).toBe('blank')
    expect(state.locked[1]).toBe(true)
    expect(state.score).toBe(3)
  })

  it('clears only an unlocked wrong mark and does not refund its cost', () => {
    const wrong = mark(1, 'mine')
    const cleared = apply(wrong, { type: 'round/clearMark', index: 1 })
    expect(cleared.marks[1]).toBe('unknown')
    expect(cleared.locked[1]).toBe(false)
    expect(cleared.score).toBe(4)

    const unknownClear = gameReducer(cleared, { type: 'round/clearMark', index: 1 })
    if (unknownClear.type !== 'ignored') {
      throw new Error(`expected ignored result, received ${unknownClear.type}`)
    }
    expect(unknownClear.reason).toBe('cell-already-unknown')

    const repeatedWrong = markBatch(cleared, [{ index: 1, assertion: 'mine' }])
    expect(repeatedWrong.score).toBe(3)

    const correct = markBatch(start(), [{ index: 0, assertion: 'mine' }])
    const lockedClear = gameReducer(correct, { type: 'round/clearMark', index: 0 })
    if (lockedClear.type !== 'ignored') {
      throw new Error(`expected ignored result, received ${lockedClear.type}`)
    }
    expect(lockedClear.reason).toBe('locked-cell')
  })

  it('deduplicates a valid batch by first occurrence and charges each cell at most once', () => {
    const state = start()
    const result = gameReducer(state, {
      type: 'round/markBatch',
      cells: [
        { index: 1, assertion: 'mine' },
        { index: 2, assertion: 'blank' },
        { index: 1, assertion: 'mine' },
      ],
    })
    expect(result.type).toBe('transition')
    if (result.type !== 'transition') {
      throw new Error('expected batch transition')
    }
    expect(result.state.score).toBe(4)
    expect(result.state.marks.slice(0, 3)).toEqual(['unknown', 'mine', 'blank'])
  })

  it('rejects conflicting assertions independent of input order and leaves state untouched', () => {
    const state = start()
    for (const cells of [
      [
        { index: 1, assertion: 'mine' as const },
        { index: 1, assertion: 'blank' as const },
      ],
      [
        { index: 1, assertion: 'blank' as const },
        { index: 1, assertion: 'mine' as const },
      ],
    ]) {
      const result = gameReducer(state, { type: 'round/markBatch', cells })
      expect(result.type).toBe('rejected')
      if (result.type === 'rejected') {
        expect(result.reason).toBe('conflicting-assertions')
      }
      expect(result.state).toBe(state)
    }
  })

  it('rejects malformed indices, assertions, and batches without partial application', () => {
    const state = start()
    const cases: readonly { readonly cells: unknown; readonly reason: string }[] = [
      { cells: [{ index: -1, assertion: 'mine' }], reason: 'invalid-cell-index' },
      { cells: [{ index: 4, assertion: 'mine' }], reason: 'invalid-cell-index' },
      { cells: [{ index: 1.5, assertion: 'mine' }], reason: 'invalid-cell-index' },
      { cells: [{ index: 0, assertion: 'unknown' }], reason: 'invalid-cell-assertion' },
      { cells: [{ index: 0, assertion: true }], reason: 'invalid-cell-assertion' },
      { cells: [{ index: 0 }], reason: 'invalid-batch' },
      { cells: null, reason: 'invalid-batch' },
    ]
    for (const fixture of cases) {
      const result = gameReducer(state, {
        type: 'round/markBatch',
        cells: fixture.cells as never,
      })
      expect(result.type).toBe('rejected')
      if (result.type === 'rejected') {
        expect(result.reason).toBe(fixture.reason)
      }
      expect(result.state).toBe(state)
    }
  })

  it('clamps score at zero and gives loss precedence over completion or later cells', () => {
    const onePoint = start(settings, 1)
    const result = gameReducer(onePoint, {
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'mine' },
        { index: 1, assertion: 'mine' },
        { index: 2, assertion: 'blank' },
        { index: 3, assertion: 'mine' },
      ],
    })
    expect(result.type).toBe('transition')
    if (result.type !== 'transition') {
      throw new Error('expected loss transition')
    }
    expect(result.transition).toBe('round-lost')
    expect(result.state.status).toBe('lost')
    expect(result.state.score).toBe(0)
    expect(result.state.pendingGeneration).toBeNull()
    expect(result.state.marks).toEqual(['mine', 'mine', 'unknown', 'unknown'])
  })

  it('previews deduplicated cost and zero projection without mutating state', () => {
    const state = start(settings, 2)
    const cells = [
      { index: 1, assertion: 'mine' as const },
      { index: 1, assertion: 'mine' as const },
      { index: 2, assertion: 'mine' as const },
    ]
    const before = state.marks
    const preview = previewMarkBatch(state, cells)
    expect(preview).toEqual({
      valid: true,
      affectedCount: 2,
      scoreCost: 2,
      projectedScore: 0,
      reachesZero: true,
    })
    expect(state.marks).toBe(before)
    expect(state.score).toBe(2)

    const invalid = previewMarkBatch(state, [
      { index: 0, assertion: 'mine' },
      { index: 0, assertion: 'blank' },
    ])
    expect(invalid.valid).toBe(false)
    expect(invalid.scoreCost).toBe(0)
    expect(invalid.projectedScore).toBe(2)
  })

  it('only accepts a generation result for the current generation ID', () => {
    const initial = createInitialGameState({ settings, initialScore: 4 })
    const started = gameReducer(initial, { type: 'generation/start' })
    if (started.type !== 'transition') {
      throw new Error('expected generation to start')
    }
    for (const action of [
      { type: 'generation/succeeded', generationId: 0, round: generatedRound },
      { type: 'generation/failed', generationId: 99, failure: { reason: 'x', message: 'x' } },
      { type: 'generation/cancelled', generationId: -1 },
    ] satisfies GameAction[]) {
      const result = gameReducer(started.state, action)
      expect(result.type).toBe('ignored')
      if (result.type === 'ignored') {
        expect(result.reason).toBe('stale-generation-id')
      }
      expect(result.state).toBe(started.state)
    }

    const succeeded = gameReducer(started.state, {
      type: 'generation/succeeded',
      generationId: started.state.generationId,
      round: generatedRound,
    })
    expect(succeeded.type).toBe('transition')
    if (succeeded.type === 'transition') {
      expect(succeeded.state.status).toBe('playing')
      expect(succeeded.state.round).toBe(1)
      expect(succeeded.state.score).toBe(4)
      expect(succeeded.state.marks).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
    }
  })

  it('keeps the last playable board, marks, score, and settings while generating and after failure', () => {
    const playing = markBatch(start(), [{ index: 1, assertion: 'mine' }])
    const started = gameReducer(playing, { type: 'generation/start' })
    if (started.type !== 'transition') {
      throw new Error('expected generation to start')
    }
    expect(started.state.status).toBe('generating')
    expect(started.state.board).toBe(playing.board)
    expect(started.state.marks).toBe(playing.marks)
    expect(started.state.score).toBe(4)
    expect(started.state.round).toBe(1)

    const failed = gameReducer(started.state, {
      type: 'generation/failed',
      generationId: started.state.generationId,
      failure: {
        reason: 'resource-limit',
        message: 'bounded search exhausted',
        details: { attempts: 3, nested: { exhausted: true } },
      },
    })
    expect(failed.type).toBe('transition')
    if (failed.type !== 'transition') {
      throw new Error('expected failure transition')
    }
    expect(failed.state.status).toBe('failed')
    expect(failed.state.board).toBe(playing.board)
    expect(failed.state.puzzle).toBe(playing.puzzle)
    expect(failed.state.marks).toBe(playing.marks)
    expect(failed.state.settings).toBe(playing.settings)
    expect(failed.state.round).toBe(1)
    expect(failed.state.score).toBe(4)
    expect(failed.state.failure?.reason).toBe('resource-limit')
    expect(Object.isFrozen(failed.state.failure)).toBe(true)
  })

  it('handles a matching cancellation as a failed lifecycle without discarding a round', () => {
    const playing = start()
    const started = gameReducer(playing, { type: 'generation/start' })
    if (started.type !== 'transition') {
      throw new Error('expected generation to start')
    }
    const cancelled = gameReducer(started.state, {
      type: 'generation/cancelled',
      generationId: started.state.generationId,
    })
    expect(cancelled.type).toBe('transition')
    if (cancelled.type === 'transition') {
      expect(cancelled.state.status).toBe('failed')
      expect(cancelled.state.failure?.reason).toBe('cancelled')
      expect(cancelled.state.board).toBe(playing.board)
      expect(cancelled.state.marks).toBe(playing.marks)
    }
  })

  it('wins on a correct full board and hands the next round to an explicit start', () => {
    let state = start(settings, 3)
    for (const index of [0, 1, 2]) {
      state = markBatch(state, [{ index, assertion: correctFor(index) }])
    }
    const won = gameReducer(state, {
      type: 'round/markBatch',
      cells: [{ index: 3, assertion: 'mine' }],
    })
    expect(won.type).toBe('transition')
    if (won.type !== 'transition') {
      throw new Error('expected win transition')
    }
    expect(won.transition).toBe('round-won')
    expect(won.state.status).toBe('won')
    expect(won.state.round).toBe(1)
    expect(won.state.score).toBe(3)
    // The won state holds no generation slot, so `generation/start` can consume it.
    expect(won.state.pendingGeneration).toBeNull()
    expect(won.state.board).toBe(state.board)

    const stale = gameReducer(won.state, {
      type: 'generation/succeeded',
      generationId: won.state.generationId,
      round: generatedRound,
    })
    expect(stale.type).toBe('ignored')
    if (stale.type === 'ignored') {
      expect(stale.reason).toBe('stale-generation-id')
    }
    expect(stale.state).toBe(won.state)

    const nextStarted = gameReducer(won.state, { type: 'generation/start' })
    expect(nextStarted.type).toBe('transition')
    if (nextStarted.type !== 'transition') {
      throw new Error('expected next generation to start')
    }
    expect(nextStarted.state.status).toBe('generating')
    expect(nextStarted.state.round).toBe(1)
    const pending = nextStarted.state.pendingGeneration
    expect(pending?.roundNumber).toBe(2)
    expect(pending?.id).toBe(won.state.generationId + 1)
    expect(pending?.settings).toEqual(deriveNextRoundSettings(settings, 2))
    expect(pending?.settings.seed).not.toBe(settings.seed)

    const nextSucceeded = gameReducer(nextStarted.state, {
      type: 'generation/succeeded',
      generationId: pending!.id,
      round: { ...generatedRound, settings: pending!.settings },
    })
    expect(nextSucceeded.type).toBe('transition')
    if (nextSucceeded.type === 'transition') {
      expect(nextSucceeded.state.status).toBe('playing')
      expect(nextSucceeded.state.round).toBe(2)
      expect(nextSucceeded.state.score).toBe(3)
      expect(nextSucceeded.state.settings).toEqual(pending!.settings)
      expect(nextSucceeded.state.pendingGeneration).toBeNull()
      expect(nextSucceeded.state.marks).toEqual(['unknown', 'unknown', 'unknown', 'unknown'])
      expect(nextSucceeded.state.locked).toEqual([false, false, false, false])
    }
  })

  it('rejects stale, mismatched, and malformed generation results', () => {
    const initial = createInitialGameState({ settings, initialScore: 5 })
    const started = gameReducer(initial, { type: 'generation/start' })
    if (started.type !== 'transition') {
      throw new Error('expected generation to start')
    }
    const generationId = started.state.generationId

    const mismatchedSettings = gameReducer(started.state, {
      type: 'generation/succeeded',
      generationId,
      round: { ...generatedRound, settings: { ...settings, rows: 3, columns: 3 } },
    })
    expect(mismatchedSettings.type).toBe('rejected')
    if (mismatchedSettings.type === 'rejected') {
      expect(mismatchedSettings.reason).toBe('invalid-settings')
    }

    const differentSeed = gameReducer(started.state, {
      type: 'generation/succeeded',
      generationId,
      round: { ...generatedRound, settings: deriveNextRoundSettings(settings, 2) },
    })
    expect(differentSeed.type).toBe('rejected')
    if (differentSeed.type === 'rejected') {
      expect(differentSeed.reason).toBe('invalid-settings')
    }

    const malformedDifficulty = gameReducer(started.state, {
      type: 'generation/succeeded',
      generationId,
      round: { ...generatedRound, difficulty: { status: 'known', band: 'impossible' } as never },
    })
    expect(malformedDifficulty.type).toBe('rejected')
    if (malformedDifficulty.type === 'rejected') {
      expect(malformedDifficulty.reason).toBe('invalid-difficulty')
    }
    expect(malformedDifficulty.state).toBe(started.state)

    const playing = start()
    const notGenerating = gameReducer(playing, {
      type: 'generation/succeeded',
      generationId: 0,
      round: generatedRound,
    })
    expect(notGenerating.type).toBe('ignored')
    if (notGenerating.type === 'ignored') {
      expect(notGenerating.reason).toBe('stale-generation-id')
    }
    expect(notGenerating.state).toBe(playing)
  })

  it('keeps a known or unknown difficulty analysis and projects it for the UI', () => {
    const known = startWithRound({
      ...generatedRound,
      difficulty: {
        status: 'known',
        minimumGuesses: 7,
        minimum: 7,
        band: 'challenging',
        diagnostics: { nodesVisited: 12, statesEvaluated: 5, memoEntries: 2, maxDepth: 3 },
      },
    })
    expect(known.difficulty).toEqual({
      status: 'known',
      band: 'challenging',
      minimumGuesses: 7,
    })
    expect(Object.isFrozen(known.difficulty)).toBe(true)
    expect(JSON.parse(JSON.stringify(known.difficulty))).toEqual(known.difficulty)

    const unknown = startWithRound({
      ...generatedRound,
      difficulty: {
        status: 'unknown',
        reason: 'node-limit',
        diagnostics: { nodesVisited: 40, statesEvaluated: 9, memoEntries: 1, maxDepth: 4 },
      },
    })
    expect(unknown.difficulty).toEqual({ status: 'unknown', reason: 'node-limit' })

    // Engine results without an analysis stay visible as "no difficulty yet".
    expect(start().difficulty).toBeNull()
    expect(createInitialGameState().difficulty).toBeNull()
  })

  it('keeps failure diagnostics serializable and retains the last playable difficulty', () => {
    const playing = startWithRound({
      ...generatedRound,
      difficulty: {
        status: 'known',
        minimumGuesses: 3,
        minimum: 3,
        band: 'starter',
        diagnostics: { nodesVisited: 8, statesEvaluated: 4, memoEntries: 1, maxDepth: 2 },
      },
    })
    const started = apply(playing, { type: 'generation/start' })
    const failed = apply(started, {
      type: 'generation/failed',
      generationId: started.generationId,
      failure: {
        reason: 'attempts-exhausted',
        message: 'no unique board found',
        details: { attempts: 3, nested: { exhausted: true } },
      },
    })
    expect(failed.status).toBe('failed')
    expect(failed.difficulty).toBe(playing.difficulty)
    expect(JSON.parse(JSON.stringify(failed.failure))).toEqual({
      reason: 'attempts-exhausted',
      message: 'no unique board found',
      details: { attempts: 3, nested: { exhausted: true } },
    })
  })
})
