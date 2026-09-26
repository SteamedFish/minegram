import { derivePuzzleClues, type BinaryMineBoard, type MinegramPuzzle } from '../domain'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import { describe, expect, it } from 'vitest'
import {
  createInitialGameState,
  deriveNextRoundSettings,
  gameReducer,
  previewMarkBatch,
  revealEligibleLines,
  type CellAssertion,
  type CellMark,
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

/**
 * A 3x3 board with exactly one mine per row and per column:
 *
 * ```
 *  1 0 0
 *  0 0 1
 *  0 1 0
 * ```
 *
 * Every row and every column therefore needs a non-trivial fill, and the
 * columns that only become eligible after a later mine is marked make the
 * row/column orientations genuinely independent.
 */
const board3x3 = [1, 0, 0, 0, 0, 1, 0, 1, 0] as const
const dimensions3x3 = { rows: 3, columns: 3 } as const
const settings3x3 = normalizeGenerationSettings({
  rows: 3,
  columns: 3,
  densityPercent: 34,
  seed: 'fixture-seed-3x3',
  difficulty: 'starter',
  maxAttempts: 3,
})
const generatedRound3x3: GeneratedRound = {
  settings: settings3x3,
  board: board3x3,
  puzzle: { dimensions: dimensions3x3, clues: derivePuzzleClues(board3x3, dimensions3x3) },
}

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
    // Cells 0 and 1 are the batch's own work. Cell 2 was NOT in the batch: it
    // carries no mine, and marking the row-0 mine made column 0 a known line, so
    // the auto-reveal filled cell 2 for free and locked it. Both writes are
    // correct, so `score` is untouched at 5.
    expect(correct.marks).toEqual(['mine', 'blank', 'blank', 'unknown'])
    expect(correct.locked).toEqual([true, true, true, false])
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

  it('charges a wrong mark once, charges nothing for the identical mark, and charges the opposite again', () => {
    // A drag may touch the same cell twice with the same assertion: charged once.
    const state = markBatch(start(), [
      { index: 1, assertion: 'mine' },
      { index: 1, assertion: 'mine' },
    ])
    expect(state.marks[1]).toBe('mine')
    expect(state.locked[1]).toBe(false)
    expect(state.score).toBe(4)

    // Identical wrong assertion in a later action: free, and reported as such.
    const repeated = gameReducer(state, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'mine' }],
    })
    expect(repeated.type).toBe('ignored')
    if (repeated.type === 'ignored') {
      expect(repeated.reason).toBe('cell-already-marked')
    }
    expect(repeated.state.score).toBe(4)
    expect(repeated.state.marks).toEqual(state.marks)

    // The opposite assertion on a wrong unlocked cell is, by the binary board,
    // always the correct one, so it locks for free. A cell is charged only when
    // its mark changes to a different value and that new value is wrong; a
    // cleared cell re-marked wrongly is charged again.
    const corrected = apply(repeated.state, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'blank' }],
    })
    expect(corrected.marks[1]).toBe('blank')
    expect(corrected.locked[1]).toBe(true)
    expect(corrected.score).toBe(4)
  })

  it('rejects the opposite assertion on a locked correct cell without charging it', () => {
    const correct = markBatch(start(), [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
    ])
    expect(correct.locked[0]).toBe(true)
    expect(correct.score).toBe(5)

    const result = gameReducer(correct, {
      type: 'round/markBatch',
      cells: [{ index: 0, assertion: 'blank' }],
    })
    expect(result.type).toBe('ignored')
    if (result.type === 'ignored') {
      expect(result.reason).toBe('locked-cell')
    }
    expect(result.state).toBe(correct)
    expect(result.state.score).toBe(5)
  })

  it('previews an identical-assertion batch as free, matching applyMarkBatch', () => {
    const state = mark(1, 'mine')
    const cells = [
      { index: 1, assertion: 'mine' as const },
      { index: 1, assertion: 'mine' as const },
    ]
    const preview = previewMarkBatch(state, cells)
    expect(preview).toEqual({
      valid: true,
      affectedCount: 0,
      scoreCost: 0,
      projectedScore: 4,
      reachesZero: false,
    })

    const applied = gameReducer(state, { type: 'round/markBatch', cells })
    expect(applied.type).toBe('ignored')
    if (applied.type === 'ignored') {
      expect(applied.reason).toBe('cell-already-marked')
    }
    expect(applied.state.score).toBe(preview.projectedScore)
  })

  it('reports locked-cell for an all-locked and for a mixed identical+locked batch', () => {
    const correct = markBatch(start(), [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
    ])

    const allLocked = gameReducer(correct, {
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'blank' },
        { index: 1, assertion: 'mine' },
      ],
    })
    expect(allLocked.type).toBe('ignored')
    if (allLocked.type === 'ignored') {
      expect(allLocked.reason).toBe('locked-cell')
    }

    // Cell 3 carries no mark yet, so first give it a wrong one, then build a
    // batch mixing an identical re-assertion with a locked opposite assertion.
    // (Cell 2 is no longer available: the auto-reveal filled and locked it when
    // the batch above made row 0 and column 0 known lines.)
    const wrong = markBatch(correct, [{ index: 3, assertion: 'blank' }])
    expect(wrong.score).toBe(4)
    const mixed = gameReducer(wrong, {
      type: 'round/markBatch',
      cells: [
        { index: 3, assertion: 'blank' },
        { index: 0, assertion: 'blank' },
      ],
    })
    expect(mixed.type).toBe('ignored')
    if (mixed.type === 'ignored') {
      expect(mixed.reason).toBe('locked-cell')
    }
    expect(mixed.state.score).toBe(4)
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
    // Cells 0 and 1 carry a correct and a wrong mine mark here, so row 0's mine
    // is located — but the auto-reveal is deliberately NOT run on the loss path,
    // which is why cells 2 and 3 are still 'unknown' rather than filled.
    expect(result.state.marks).toEqual(['mine', 'mine', 'unknown', 'unknown'])
    expect(result.autoRevealedLines).toEqual([])
    expect(result.autoRevealedCells).toBe(0)
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

  it('wins by marking only the mines, because a known line fills its own gaps', () => {
    // The user rule: "if every mine in a row/column is marked, the whole line is
    // shown automatically - all the gaps appear for free". The player asserts
    // three mines and never touches a blank; the six blanks are filled by the
    // rows and columns whose mines are now known.
    let state = startWithRound(generatedRound3x3, 5)
    const mines = board3x3
      .map((cell, index) => (cell === 1 ? index : -1))
      .filter((index) => index >= 0)
    expect(mines).toEqual([0, 5, 7])

    for (const index of mines) {
      const result = gameReducer(state, {
        type: 'round/markBatch',
        cells: [{ index, assertion: 'mine' }],
      })
      expect(result.type).toBe('transition')
      if (result.type !== 'transition') {
        throw new Error('expected transition')
      }
      state = result.state
    }

    // Every cell is now asserted and correct, and no score was ever charged.
    expect(state.marks).toEqual([
      'mine',
      'blank',
      'blank',
      'blank',
      'blank',
      'mine',
      'blank',
      'mine',
      'blank',
    ])
    expect(state.locked.every(Boolean)).toBe(true)
    expect(state.score).toBe(5)
    expect(state.status).toBe('won')
  })

  it('wins on a correct full board and hands the next round to an explicit start', () => {
    // The two mine assertions go in one batch. Sequenced cell by cell they can
    // no longer reach the blanks: marking the row-0 mine makes row 0 and column
    // 0 known lines, so the reveal fills and LOCKS cells 1 and 2, and the next
    // single-cell batch on cell 1 would be refused as `locked-cell`. The blanks
    // are still all correct and locked in the end — they are just written by the
    // reveal instead of by the player.
    const played = start(settings, 3)
    const won = gameReducer(played, {
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'mine' },
        { index: 3, assertion: 'mine' },
      ],
    })
    expect(won.type).toBe('transition')
    if (won.type !== 'transition') {
      throw new Error('expected win transition')
    }
    const state = won.state
    expect(won.transition).toBe('round-won')
    expect(won.state.marks).toEqual(['mine', 'blank', 'blank', 'mine'])
    expect(won.state.locked).toEqual([true, true, true, true])
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

  it('keeps the derived next-round seed after a post-win failure but restores settings when a playing round fails', () => {
    // One batch covering all four cells. This still wins after the auto-reveal
    // was added, but only incidentally: the batch itself asserts every cell, so
    // the reveal finds nothing left to fill. Asserting the mines alone would also
    // win (see the 3x3 test above); the blanks here are the player's own work.
    const won = markBatch(start(), [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
      { index: 3, assertion: 'mine' },
    ])
    expect(won.status).toBe('won')
    // The solved round keeps its own settings (seed S1).
    expect(won.settings).toEqual(settings)
    expect(won.board).not.toBeNull()

    const nextStarted = apply(won, { type: 'generation/start' })
    expect(nextStarted.status).toBe('generating')
    const nextPending = nextStarted.pendingGeneration
    expect(nextPending?.continuesWonRound).toBe(true)
    expect(nextPending?.roundNumber).toBe(2)
    const derivedSeed = nextPending?.settings.seed
    expect(derivedSeed).not.toBe(settings.seed)

    // Post-win failure: the winning board is still present, yet the derived
    // seed S2 must survive, otherwise a later start would replay the solved
    // board under round number 2.
    const failed = apply(nextStarted, {
      type: 'generation/failed',
      generationId: nextStarted.generationId,
      failure: { reason: 'attempts-exhausted', message: 'no unique board found' },
    })
    expect(failed.status).toBe('failed')
    expect(failed.settings.seed).toBe(derivedSeed)
    expect(failed.board).toEqual(won.board)

    // A plain start now replays exactly S2 with round number 2.
    const replayStarted = apply(failed, { type: 'generation/start' })
    expect(replayStarted.status).toBe('generating')
    const replayPending = replayStarted.pendingGeneration
    expect(replayPending?.continuesWonRound).toBe(false)
    expect(replayPending?.roundNumber).toBe(2)
    expect(replayPending?.settings.seed).toBe(derivedSeed)
    expect(replayPending?.settings).toEqual(deriveNextRoundSettings(settings, 2))

    // A failure while a playable round is being replaced keeps the old settings.
    const replacement = apply(start(), { type: 'generation/start' })
    const replacementFailed = apply(replacement, {
      type: 'generation/failed',
      generationId: replacement.generationId,
      failure: { reason: 'attempts-exhausted', message: 'no unique board found' },
    })
    expect(replacementFailed.status).toBe('failed')
    expect(replacementFailed.settings).toEqual(settings)
    expect(replacementFailed.board).toEqual(board)
  })

  it('resumes a failed round that kept its board without resetting the round', () => {
    const wrong = markBatch(start(), [{ index: 1, assertion: 'mine' }])
    expect(wrong.score).toBe(4)
    const started = apply(wrong, { type: 'generation/start' })
    const failed = apply(started, {
      type: 'generation/failed',
      generationId: started.generationId,
      failure: { reason: 'attempts-exhausted', message: 'no unique board found' },
    })
    expect(failed.status).toBe('failed')
    expect(failed.failure).not.toBeNull()

    const result = gameReducer(failed, { type: 'round/resume' })
    expect(result.type).toBe('transition')
    if (result.type !== 'transition') {
      throw new Error('expected resume transition')
    }
    expect(result.transition).toBe('round-resumed')
    const resumed = result.state
    expect(resumed.status).toBe('playing')
    expect(resumed.pendingGeneration).toBeNull()
    expect(resumed.failure).toBeNull()
    expect(resumed.board).toBe(failed.board)
    expect(resumed.puzzle).toBe(failed.puzzle)
    expect(resumed.marks).toEqual(failed.marks)
    expect(resumed.locked).toEqual(failed.locked)
    expect(resumed.score).toBe(failed.score)
    expect(resumed.score).toBe(4)
    expect(resumed.round).toBe(failed.round)
    expect(resumed.settings).toBe(failed.settings)
    expect(resumed.generationId).toBe(failed.generationId)
    expect(resumed.difficulty).toBe(failed.difficulty)
  })

  it('resumes a post-win failure as won instead of soft-locking the finished board', () => {
    // Incidental survival again: this batch asserts all four cells, so the
    // auto-reveal has nothing to fill and the resume guard sees a finished board.
    const won = markBatch(start(), [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
      { index: 3, assertion: 'mine' },
    ])
    expect(won.status).toBe('won')
    expect(won.marks.every((mark) => mark !== 'unknown')).toBe(true)
    expect(won.locked.every(Boolean)).toBe(true)

    const started = apply(won, { type: 'generation/start' })
    const failed = apply(started, {
      type: 'generation/failed',
      generationId: started.generationId,
      failure: { reason: 'attempts-exhausted', message: 'no unique board found' },
    })
    expect(failed.status).toBe('failed')
    // The kept board is already finished: resuming it as 'playing' would lock.
    expect(failed.marks.every((mark) => mark !== 'unknown')).toBe(true)
    expect(failed.locked.every(Boolean)).toBe(true)

    const result = gameReducer(failed, { type: 'round/resume' })
    expect(result.type).toBe('transition')
    if (result.type !== 'transition') {
      throw new Error('expected resume transition')
    }
    expect(result.transition).toBe('round-resumed')
    const resumed = result.state
    expect(resumed.status).toBe('won')
    expect(resumed.pendingGeneration).toBeNull()
    expect(resumed.failure).toBeNull()
    expect(resumed.board).toBe(failed.board)
    expect(resumed.puzzle).toBe(failed.puzzle)
    expect(resumed.marks).toEqual(failed.marks)
    expect(resumed.locked).toEqual(failed.locked)
    expect(resumed.score).toBe(failed.score)
    expect(resumed.round).toBe(failed.round)
    expect(resumed.settings).toBe(failed.settings)

    // 'won' is not resumable, so the branch cannot loop.
    const again = gameReducer(resumed, { type: 'round/resume' })
    expect(again.type).toBe('ignored')
    if (again.type === 'ignored') {
      expect(again.reason).toBe('round-not-resumable')
    }

    // The post-win advance still works, with a newly derived seed.
    const nextStarted = apply(resumed, { type: 'generation/start' })
    expect(nextStarted.status).toBe('generating')
    const pending = nextStarted.pendingGeneration
    expect(pending?.roundNumber).toBe(2)
    expect(pending?.settings).toEqual(deriveNextRoundSettings(failed.settings, 2))
    expect(pending?.settings.seed).not.toBe(settings.seed)
  })

  it('ignores resume unless a failed round kept a board', () => {
    const idle = createInitialGameState({ settings, initialScore: 5 })
    const generating = apply(idle, { type: 'generation/start' })
    const playing = start()
    const won = markBatch(start(), [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
      { index: 3, assertion: 'mine' },
    ])
    const lost = apply(start(settings, 1), {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'mine' }],
    })
    // A failure with no board to keep cannot be resumed.
    const failedWithoutBoard = apply(generating, {
      type: 'generation/failed',
      generationId: generating.generationId,
      failure: { reason: 'attempts-exhausted', message: 'no unique board found' },
    })
    expect(failedWithoutBoard.status).toBe('failed')
    expect(failedWithoutBoard.board).toBeNull()
    expect(failedWithoutBoard.puzzle).toBeNull()

    for (const state of [idle, generating, playing, won, lost, failedWithoutBoard]) {
      const result = gameReducer(state, { type: 'round/resume' })
      expect(result.type).toBe('ignored')
      if (result.type === 'ignored') {
        expect(result.reason).toBe('round-not-resumable')
      }
      expect(result.state).toBe(state)
    }
  })

  it('keeps a wrong mark wrong across a resume and accepts marks afterwards', () => {
    const wrong = markBatch(start(), [{ index: 1, assertion: 'mine' }])
    const started = apply(wrong, { type: 'generation/start' })
    const failed = apply(started, {
      type: 'generation/cancelled',
      generationId: started.generationId,
    })
    expect(failed.status).toBe('failed')
    const resumed = apply(failed, { type: 'round/resume' })
    expect(resumed.status).toBe('playing')
    expect(resumed.marks[1]).toBe('mine')
    expect(resumed.locked[1]).toBe(false)
    expect(resumed.score).toBe(4)

    // The identical assertion is still free after resuming, and the cell keeps
    // its wrong mark: resume neither re-scores nor forgives.
    const repeated = gameReducer(resumed, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'mine' }],
    })
    expect(repeated.type).toBe('ignored')
    if (repeated.type === 'ignored') {
      expect(repeated.reason).toBe('cell-already-marked')
    }
    expect(repeated.state.marks[1]).toBe('mine')
    expect(repeated.state.locked[1]).toBe(false)
    expect(repeated.state.score).toBe(4)

    // Resume is not a generation restart: marking is accepted again, no seed
    // or round change, and the correct assertion still locks.
    const corrected = apply(resumed, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'blank' }],
    })
    expect(corrected.status).toBe('playing')
    expect(corrected.round).toBe(resumed.round)
    expect(corrected.settings).toBe(resumed.settings)
    expect(corrected.generationId).toBe(resumed.generationId)
    expect(corrected.pendingGeneration).toBeNull()
    expect(corrected.marks[1]).toBe('blank')
    expect(corrected.locked[1]).toBe(true)
    expect(corrected.score).toBe(4)
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

/**
 * The 3x3 fixture, one mine per row and per column:
 *
 * ```
 *  1 0 0        indices 0 1 2
 *  0 0 1               3 4 5
 *  0 1 0               6 7 8
 * ```
 *
 * Rows and columns therefore have exactly one mine each, and a row and a column
 * only become eligible at different moments, which is what makes the two
 * orientations independent here.
 */
function start3x3(initialScore = 5): GameState {
  return startWithRound(generatedRound3x3, initialScore)
}

/** The three mark patterns a batch can leave on a cell: mine, blank, or nothing. */
const everyMark: readonly (CellAssertion | null)[] = ['mine', 'blank', null]
const liveAssertions: readonly CellAssertion[] = ['mine', 'blank']

/**
 * Every locked cell must carry the mark the solution board calls for. A wrong
 * UNLOCKED mark is legal and expected: the player may guess wrong and then
 * correct it, and the wrong mark is what blocks a line from being revealed.
 */
function expectLockedCellsCorrect(state: GameState, solution: readonly number[]): void {
  state.locked.forEach((isLocked, index) => {
    if (!isLocked) {
      return
    }
    expect(`cell ${index} locked as ${state.marks[index]}`).toBe(
      `cell ${index} locked as ${solution[index] === 1 ? 'mine' : 'blank'}`,
    )
  })
}

describe('auto-reveal', () => {
  it('fills a known line free, locks it, and reports the line and its cell count', () => {
    const initial = start3x3()
    const result = gameReducer(initial, {
      type: 'round/markBatch',
      cells: [{ index: 0, assertion: 'mine' }],
    })
    expect(result.type).toBe('transition')
    if (result.type !== 'transition') {
      throw new Error('expected transition')
    }
    // Row 0 and column 0 became known with that one mark. Row 0 contributed
    // cells 1 and 2, column 0 contributed cells 3 and 6.
    expect(result.transition).toBe('marks-applied')
    expect(result.autoRevealedLines).toEqual([
      { orientation: 'row', index: 0, cells: 2 },
      { orientation: 'column', index: 0, cells: 2 },
    ])
    expect(result.autoRevealedCells).toBe(4)
    expect(result.state.marks).toEqual([
      'mine',
      'blank',
      'blank',
      'blank',
      'unknown',
      'unknown',
      'blank',
      'unknown',
      'unknown',
    ])
    expect(result.state.locked).toEqual([true, true, true, true, false, false, true, false, false])
  })

  it('never charges for a revealed cell', () => {
    const initial = start3x3()
    const result = gameReducer(initial, {
      type: 'round/markBatch',
      cells: [{ index: 0, assertion: 'mine' }],
    })
    if (result.type !== 'transition') {
      throw new Error('expected transition')
    }
    // One correct mark, four free fills, and the score is untouched.
    expect(result.state.score).toBe(initial.score)
    expect(result.autoRevealedCells).toBe(4)
    // For contrast, the same board does charge for a wrong mark.
    const wrong = gameReducer(initial, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'mine' }],
    })
    if (wrong.type !== 'transition') {
      throw new Error('expected transition')
    }
    expect(wrong.state.score).toBe(initial.score - 1)
  })

  it('never overwrites a wrong mark in an otherwise eligible line, and charges it once', () => {
    // Cell 4 is a blank, so a 'mine' there is wrong: charged, never locked.
    const wrong = markBatch(start3x3(), [{ index: 4, assertion: 'mine' }])
    expect(wrong.score).toBe(4)
    const result = gameReducer(wrong, {
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'mine' },
        { index: 5, assertion: 'mine' },
      ],
    })
    if (result.type !== 'transition') {
      throw new Error('expected transition')
    }
    // Row 1 holds the wrong mark at cell 4, so row 1 stays unfilled even though
    // its only mine (cell 5) is now marked. Row 0, column 0 and column 2 are
    // unaffected by it and fill normally.
    expect(result.autoRevealedLines).toEqual([
      { orientation: 'row', index: 0, cells: 2 },
      { orientation: 'column', index: 0, cells: 2 },
      { orientation: 'column', index: 2, cells: 1 },
    ])
    expect(result.state.marks[4]).toBe('mine')
    expect(result.state.locked[4]).toBe(false)
    expect(result.state.score).toBe(4)

    // Re-asserting the same batch changes nothing and is not charged again.
    const repeated = gameReducer(result.state, {
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'mine' },
        { index: 5, assertion: 'mine' },
      ],
    })
    expect(repeated.type).toBe('ignored')
    if (repeated.type === 'ignored') {
      expect(repeated.reason).toBe('cell-already-marked')
    }
    expect(repeated.state.score).toBe(4)
  })

  it('is idempotent: re-asserting and contradicting a revealed cell both change nothing', () => {
    const revealed = markBatch(start3x3(), [{ index: 0, assertion: 'mine' }])
    // A revealed cell is locked, so the drag controller and the preview chip
    // treat it as inert without any new mechanism.
    const identical = gameReducer(revealed, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'blank' }],
    })
    expect(identical.type).toBe('ignored')
    if (identical.type === 'ignored') {
      expect(identical.reason).toBe('cell-already-marked')
    }
    expect(identical.state.marks).toBe(revealed.marks)
    expect(identical.state.locked).toBe(revealed.locked)
    expect(identical.state.score).toBe(revealed.score)

    const opposite = gameReducer(revealed, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'mine' }],
    })
    expect(opposite.type).toBe('ignored')
    if (opposite.type === 'ignored') {
      expect(opposite.reason).toBe('locked-cell')
    }
    expect(opposite.state.marks).toBe(revealed.marks)
    expect(opposite.state.locked).toBe(revealed.locked)
    expect(opposite.state.score).toBe(revealed.score)

    expect(
      previewMarkBatch(revealed, [{ index: 1, assertion: 'blank' }]),
    ).toEqual({ valid: true, affectedCount: 0, scoreCost: 0, projectedScore: 5, reachesZero: false })
    expect(
      previewMarkBatch(revealed, [{ index: 1, assertion: 'mine' }]),
    ).toEqual({ valid: true, affectedCount: 0, scoreCost: 0, projectedScore: 5, reachesZero: false })
  })

  it('writes the same value where two eligible lines share a cell, and counts it once', () => {
    // Cells 0 and 7 make rows 0 and 2 eligible and columns 0 and 1 eligible.
    // Cell 1 is shared by row 0 and column 1, cell 6 by row 2 and column 0.
    const result = gameReducer(start3x3(), {
      type: 'round/markBatch',
      cells: [
        { index: 0, assertion: 'mine' },
        { index: 7, assertion: 'mine' },
      ],
    })
    if (result.type !== 'transition') {
      throw new Error('expected transition')
    }
    expect(result.autoRevealedLines).toEqual([
      { orientation: 'row', index: 0, cells: 2 },
      { orientation: 'row', index: 2, cells: 2 },
      { orientation: 'column', index: 0, cells: 1 },
      { orientation: 'column', index: 1, cells: 1 },
    ])
    // Six distinct cells, and the per-line counts add up to the same six because
    // the second line to reach a shared cell does not count it again.
    const summed = result.autoRevealedLines.reduce((total, line) => total + line.cells, 0)
    expect(summed).toBe(6)
    expect(result.autoRevealedCells).toBe(6)
    expect(result.state.marks).toEqual([
      'mine',
      'blank',
      'blank',
      'blank',
      'blank',
      'unknown',
      'blank',
      'mine',
      'blank',
    ])
    expect(result.state.locked[1]).toBe(true)
    expect(result.state.locked[6]).toBe(true)
    expect(result.state.score).toBe(5)
    expect(result.state.status).toBe('playing')
  })

  it('wins a 1x1 board of one mine, with the reveal writing nothing', () => {
    const settings1x1 = normalizeGenerationSettings({
      rows: 1,
      columns: 1,
      densityPercent: 100,
      seed: 'fixture-seed-1x1',
      difficulty: 'starter',
      maxAttempts: 3,
    })
    const board1x1 = [1] as const
    const dimensions1x1 = { rows: 1, columns: 1 } as const
    const result = gameReducer(startWithRound({
      settings: settings1x1,
      board: board1x1,
      puzzle: { dimensions: dimensions1x1, clues: derivePuzzleClues(board1x1, dimensions1x1) },
    }), { type: 'round/markBatch', cells: [{ index: 0, assertion: 'mine' }] })
    if (result.type !== 'transition') {
      throw new Error('expected transition')
    }
    expect(result.transition).toBe('round-won')
    expect(result.state.status).toBe('won')
    expect(result.state.marks).toEqual(['mine'])
    expect(result.state.locked).toEqual([true])
    expect(result.state.score).toBe(5)
    expect(result.autoRevealedLines).toEqual([])
    expect(result.autoRevealedCells).toBe(0)
  })

  it('never reveals a line that holds no mine, because it confirms nothing', () => {
    // Unreachable through the real game, which guarantees a mine in every row
    // and column, but `revealEligibleLines` is exported, so the guard is pinned
    // here instead of being assumed. A mine-less line satisfies "every mine is
    // marked" vacuously and has no wrong mark to find, so without the `mines > 0`
    // precondition it would be filled for no reason at all.
    // One mine in the whole board, at index 0. That makes row 0 and column 0
    // eligible and leaves row 1, row 2, column 1 and column 2 with no mine at
    // all, so the guard is exercised against lines the player could never have
    // learned anything about.
    const sparseBoard: BinaryMineBoard = [1, 0, 0, 0, 0, 0, 0, 0, 0]
    const sparseMarks: CellMark[] = [
      'mine', 'unknown', 'unknown',
      'unknown', 'unknown', 'unknown',
      'unknown', 'unknown', 'unknown',
    ]
    const sparseLocked = sparseMarks.map(
      (mark, index) => mark !== 'unknown' && (mark === 'mine') === (sparseBoard[index] === 1),
    )
    const result = revealEligibleLines(sparseBoard, sparseMarks, sparseLocked, 3, 3)

    expect(result.lines).toEqual([
      { orientation: 'row', index: 0, cells: 2 },
      { orientation: 'column', index: 0, cells: 2 },
    ])
    expect(result.marks).toEqual([
      'mine', 'blank', 'blank',
      'blank', 'unknown', 'unknown',
      'blank', 'unknown', 'unknown',
    ])
    expect(result.locked).toEqual([true, true, true, true, false, false, true, false, false])

    // The whole-board case: with every line mine-less, nothing at all is
    // revealed. The all-blank 3x3 is vacuously uniquely solvable, which is how
    // an all-mine-less board reaches the helper in the property sweep.
    const empty: BinaryMineBoard = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    const allUnknown: CellMark[] = Array.from({ length: 9 }, () => 'unknown' as CellMark)
    const noneLocked: boolean[] = Array.from({ length: 9 }, () => false)
    const untouched = revealEligibleLines(empty, allUnknown, noneLocked, 3, 3)
    expect(untouched.lines).toEqual([])
    expect(untouched.marks.every((mark) => mark === 'unknown')).toBe(true)
    expect(untouched.locked.every((isLocked) => isLocked === false)).toBe(true)
  })

  it('reveals nothing on a fresh board, so accepting a round cannot win it', () => {
    const initial = createInitialGameState({ settings: settings3x3, initialScore: 5 })
    const started = gameReducer(initial, { type: 'generation/start' })
    if (started.type !== 'transition') {
      throw new Error('expected transition')
    }
    const succeeded = gameReducer(started.state, {
      type: 'generation/succeeded',
      generationId: started.state.generationId,
      round: generatedRound3x3,
    })
    if (succeeded.type !== 'transition') {
      throw new Error('expected transition')
    }
    // Every row and column of a mark-less board satisfies the gate vacuously, so
    // this is the case that must NOT reveal.
    expect(succeeded.state.status).toBe('playing')
    expect(succeeded.state.marks).toEqual(Array(9).fill('unknown'))
    expect(succeeded.state.locked).toEqual(Array(9).fill(false))
    expect(succeeded.autoRevealedLines).toEqual([])
    expect(succeeded.autoRevealedCells).toBe(0)
  })

  it('re-reveals a line that clearing a wrong mark unblocks, and reports the counts', () => {
    // Cell 8 is a blank, so this wrong 'mine' is charged and stays unlocked.
    const wrong = markBatch(start3x3(), [{ index: 8, assertion: 'mine' }])
    expect(wrong.score).toBe(4)
    const blocked = markBatch(wrong, [
      { index: 0, assertion: 'mine' },
      { index: 5, assertion: 'mine' },
    ])
    // Cell 8 is in row 2 and in column 2, and its wrong mark blocks both of
    // them, so neither line fills while it stands.
    expect(blocked.marks[8]).toBe('mine')
    expect(blocked.locked[8]).toBe(false)

    const cleared = gameReducer(blocked, { type: 'round/clearMark', index: 8 })
    if (cleared.type !== 'transition') {
      throw new Error('expected transition')
    }
    expect(cleared.transition).toBe('mark-cleared')
    expect(cleared.autoRevealedLines).toEqual([{ orientation: 'column', index: 2, cells: 1 }])
    expect(cleared.autoRevealedCells).toBe(1)
    expect(cleared.state.marks[8]).toBe('blank')
    expect(cleared.state.locked[8]).toBe(true)
    // Clearing refunds nothing.
    expect(cleared.state.score).toBe(4)
  })

  it('does not win while a wrong mark survives, even though every mine is marked', () => {
    // The wrong mark has to be made first: marking the row-0 mine first would
    // make column 0 a known line and lock cell 2 as a correct 'blank', so the
    // wrong mark could never be placed there.
    const wrong = markBatch(start(), [{ index: 2, assertion: 'mine' }])
    expect(wrong.score).toBe(4)
    const allMinesMarked = markBatch(wrong, [
      { index: 0, assertion: 'mine' },
      { index: 3, assertion: 'mine' },
    ])
    // Both mines are marked and every cell carries a mark, but cell 2 is wrong.
    expect(allMinesMarked.marks).toEqual(['mine', 'blank', 'mine', 'mine'])
    expect(allMinesMarked.marks.every((mark) => mark !== 'unknown')).toBe(true)
    expect(allMinesMarked.locked).toEqual([true, true, false, true])
    // Row 1 and column 0 both fail the "no wrong mark" half of the gate on cell
    // 2, so neither fills, and the round is not won.
    expect(allMinesMarked.status).toBe('playing')
    expect(allMinesMarked.score).toBe(4)

    // Correcting the wrong mark is the player's job, and it wins the round.
    const corrected = gameReducer(allMinesMarked, {
      type: 'round/markBatch',
      cells: [{ index: 2, assertion: 'blank' }],
    })
    if (corrected.type !== 'transition') {
      throw new Error('expected transition')
    }
    expect(corrected.transition).toBe('round-won')
    expect(corrected.state.status).toBe('won')
    expect(corrected.state.marks).toEqual(['mine', 'blank', 'blank', 'mine'])
    expect(corrected.state.score).toBe(4)
  })

  it('locks only correct marks in every reachable state of the 3x3 board', () => {
    // A locked cell must always carry the mark the solution calls for. The
    // auto-reveal is the one writer that is not the player, so this is the
    // invariant that proves it cannot lock a wrong mark.
    //
    // The sweep is exhaustive over the mark patterns a single batch can produce:
    // for each of the 9 cells independently, assert 'mine', assert 'blank', or
    // leave it out. 'unknown' is not a legal batch assertion, so leaving the
    // cell out is how an unmarked cell is enumerated.
    const solution = [...board3x3]
    for (let assignment = 0; assignment < 3 ** 9; assignment += 1) {
      const cells: { index: number; assertion: CellAssertion }[] = []
      for (let index = 0; index < 9; index += 1) {
        const choice = everyMark[Math.floor(assignment / 3 ** index) % 3]
        if (choice !== null) {
          cells.push({ index, assertion: choice })
        }
      }
      if (cells.length === 0) {
        // An empty batch is rejected by contract and reveals nothing.
        continue
      }
      // initialScore 9 keeps every pattern inside one batch: at most 8 of the 9
      // cells can be wrong, so no pattern ends the round early.
      const played = gameReducer(start3x3(9), { type: 'round/markBatch', cells })
      if (played.type !== 'transition') {
        throw new Error(`expected transition, received ${played.type}: ${played.reason}`)
      }
      expectLockedCellsCorrect(played.state, solution)
    }

    // And on the states reached by the single marks a player actually makes.
    for (let index = 0; index < 9; index += 1) {
      for (const assertion of liveAssertions) {
        const played = gameReducer(start3x3(), { type: 'round/markBatch', cells: [{ index, assertion }] })
        if (played.type !== 'transition') {
          throw new Error('expected transition')
        }
        expectLockedCellsCorrect(played.state, solution)
      }
    }
  })
})
