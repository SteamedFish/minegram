import { describe, expect, it } from 'vitest'
import {
  analyzeDifficulty,
  analyzePuzzleDifficulty,
  difficultyBandForMinimumGuesses,
  DIFFICULTY_BANDS,
  isDifficultyBandSatisfied,
} from './difficulty'
import { derivePuzzleClues, type MinegramPuzzle } from '../../domain/puzzle'
import type { BinaryMineBoard } from '../../domain/board'

const forcedUnique3x3: MinegramPuzzle = {
  dimensions: { rows: 3, columns: 3 },
  clues: { rowClues: [[3], [], []], columnClues: [[1], [1], [1]] },
}

const ambiguous2x2: MinegramPuzzle = {
  dimensions: { rows: 2, columns: 2 },
  clues: { rowClues: [[1], [1]], columnClues: [[1], [1]] },
}

function puzzleFromBoard(
  board: BinaryMineBoard,
  dimensions: { readonly rows: number; readonly columns: number },
): MinegramPuzzle {
  return { dimensions, clues: derivePuzzleClues(board, dimensions) }
}

const exactTwo3x3 = puzzleFromBoard(
  [0, 1, 0, 0, 1, 1, 1, 0, 0] as BinaryMineBoard,
  { rows: 3, columns: 3 },
)
const exactThree3x3 = puzzleFromBoard(
  [0, 0, 1, 0, 1, 0, 1, 0, 0] as BinaryMineBoard,
  { rows: 3, columns: 3 },
)

describe('exact minimum-guess difficulty analysis', () => {
  it('returns zero for a board forced entirely by propagation', () => {
    const result = analyzeDifficulty(forcedUnique3x3)
    expect(result).toMatchObject({ status: 'known', minimumGuesses: 0, minimum: 0, band: 'starter' })
    expect(result.diagnostics.nodesVisited).toBeGreaterThan(0)
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result.diagnostics)).toBe(true)
  })

  it('finds the exact one-guess decision-tree cost for an ambiguous 2x2 puzzle', () => {
    const result = analyzePuzzleDifficulty(ambiguous2x2)
    expect(result).toMatchObject({ status: 'known', minimumGuesses: 1, band: 'steady' })
  })

  it('matches exact two- and three-guess tiny-board decision trees', () => {
    expect(analyzeDifficulty(exactTwo3x3)).toMatchObject({
      status: 'known',
      minimumGuesses: 2,
      band: 'steady',
    })
    expect(analyzeDifficulty(exactThree3x3)).toMatchObject({
      status: 'known',
      minimumGuesses: 3,
      band: 'challenging',
    })
  })

  it('fails closed at an explicit decision-state cap without changing exact fixtures', () => {
    const result = analyzeDifficulty(ambiguous2x2, { maxNodes: 1 })
    expect(result).toMatchObject({
      status: 'unknown',
      reason: 'node-limit',
      diagnostics: { nodesVisited: 1 },
    })
  })

  it('maps exact bands and treats expert as a lower bound', () => {
    expect(DIFFICULTY_BANDS).toEqual(['starter', 'steady', 'challenging', 'expert'])
    expect([0, 1, 2, 3, 5, 6].map(difficultyBandForMinimumGuesses)).toEqual([
      'starter',
      'steady',
      'steady',
      'challenging',
      'challenging',
      'expert',
    ])
    expect(isDifficultyBandSatisfied(0, 'starter')).toBe(true)
    expect(isDifficultyBandSatisfied(1, 'steady')).toBe(true)
    expect(isDifficultyBandSatisfied(2, 'steady')).toBe(true)
    expect(isDifficultyBandSatisfied(3, 'challenging')).toBe(true)
    expect(isDifficultyBandSatisfied(5, 'challenging')).toBe(true)
    expect(isDifficultyBandSatisfied(6, 'expert')).toBe(true)
    expect(isDifficultyBandSatisfied(100, 'expert')).toBe(true)
    expect(isDifficultyBandSatisfied(2, 'challenging')).toBe(false)
  })

  it('fails closed for zero node/time budgets before invoking a clock', () => {
    const throwingNow = (): never => {
      throw new Error('clock must not be called')
    }
    expect(analyzeDifficulty(ambiguous2x2, { maxNodes: 0, now: throwingNow })).toMatchObject({
      status: 'unknown',
      reason: 'node-limit',
      diagnostics: { nodesVisited: 0 },
    })
    expect(analyzeDifficulty(ambiguous2x2, { timeBudgetMs: 0, now: throwingNow })).toMatchObject({
      status: 'unknown',
      reason: 'time-limit',
      diagnostics: { nodesVisited: 0 },
    })
    expect(
      analyzeDifficulty(ambiguous2x2, { signal: { aborted: true }, timeBudgetMs: 0, now: throwingNow }),
    ).toMatchObject({ status: 'unknown', reason: 'cancelled' })
  })

  it('returns unknown when a positive time budget has no injected clock', () => {
    expect(() => analyzeDifficulty(ambiguous2x2, { timeBudgetMs: 1 })).toThrow(
      /now is required/,
    )
  })
})
