import { describe, expect, it } from 'vitest'
import { countMatchingBoardsReference } from './referenceCounter'
import type { MinegramPuzzle } from '../domain/puzzle'

function puzzle(
  rows: readonly (readonly number[])[],
  columns: readonly (readonly number[])[],
): MinegramPuzzle {
  return {
    dimensions: { rows: rows.length, columns: columns.length },
    clues: { rowClues: rows, columnClues: columns },
  }
}

const diagonal2x2 = puzzle([[1], [1]], [[1], [1]])
const diagonal2x2WithZeroAliases = puzzle([[0, 1], [0, 1]], [[0, 1], [0, 1]])
const impossible2x2 = puzzle([[1], [1]], [[2], [1]])

describe('exhaustive reference counter', () => {
  it('counts all boards matching row and column clues', () => {
    expect(countMatchingBoardsReference(diagonal2x2)).toEqual({
      status: 'complete',
      count: 2,
      boardsExamined: 16,
    })
    expect(countMatchingBoardsReference(diagonal2x2WithZeroAliases)).toEqual({
      status: 'complete',
      count: 2,
      boardsExamined: 16,
    })
    expect(countMatchingBoardsReference(impossible2x2)).toEqual({
      status: 'complete',
      count: 0,
      boardsExamined: 16,
    })
  })

  it('preflights cancelled and zero-budget work without invoking the clock', () => {
    const throwingNow = (): never => {
      throw new Error('clock must not be called')
    }

    expect(
      countMatchingBoardsReference(diagonal2x2, {
        signal: { aborted: true } as never,
        timeBudgetMs: 1,
        now: throwingNow,
      }),
    ).toEqual({
      status: 'cancelled',
      count: 0,
      boardsExamined: 0,
    })
    expect(
      countMatchingBoardsReference(diagonal2x2, {
        maxBoardsExamined: 0,
        timeBudgetMs: 1,
        now: throwingNow,
      }),
    ).toEqual({
      status: 'node-limit',
      count: 0,
      boardsExamined: 0,
    })
    expect(
      countMatchingBoardsReference(diagonal2x2, {
        timeBudgetMs: 0,
        now: throwingNow,
      }),
    ).toEqual({
      status: 'time-limit',
      count: 0,
      boardsExamined: 0,
    })
  })

  it('stops at an explicit count cap without claiming completeness', () => {
    expect(countMatchingBoardsReference(diagonal2x2, { maxCount: 1 })).toEqual({
      status: 'capped',
      count: 1,
      boardsExamined: 7,
    })
  })

  it('exposes node, time, and cancellation outcomes explicitly', () => {
    expect(countMatchingBoardsReference(diagonal2x2, { maxBoardsExamined: 0 })).toEqual({
      status: 'node-limit',
      count: 0,
      boardsExamined: 0,
    })
    expect(
      countMatchingBoardsReference(diagonal2x2, { timeBudgetMs: 0, now: () => 0 }),
    ).toEqual({
      status: 'time-limit',
      count: 0,
      boardsExamined: 0,
    })
    expect(
      countMatchingBoardsReference(diagonal2x2, { signal: { aborted: true } as never }),
    ).toEqual({
      status: 'cancelled',
      count: 0,
      boardsExamined: 0,
    })
  })

  it('rejects boards outside the small reference limit and malformed options', () => {
    const large = puzzle([[1]], [[1]])
    expect(() =>
      countMatchingBoardsReference({
        dimensions: { rows: 5, columns: 1 },
        clues: { rowClues: [[1], [1], [1], [1], [1]], columnClues: [[1]] },
      }),
    ).toThrow(/at most 4 rows/)
    expect(() => countMatchingBoardsReference(diagonal2x2, { maxCount: 0 })).toThrow(/positive/)
    expect(() => countMatchingBoardsReference(diagonal2x2, [] as never)).toThrow(/non-array object/)
    expect(() => countMatchingBoardsReference(large, { maxBoardsExamined: -1 })).toThrow(
      /nonnegative/,
    )
  })
})
