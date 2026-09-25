import { describe, expect, it } from 'vitest'
import { solvePuzzle, validateSolutionBoard } from './constraintSolver'
import type { MinegramPuzzle } from '../../domain/puzzle'

const unique1x1: MinegramPuzzle = {
  dimensions: { rows: 1, columns: 1 },
  clues: { rowClues: [[1]], columnClues: [[1]] },
}

const multiple2x2: MinegramPuzzle = {
  dimensions: { rows: 2, columns: 2 },
  clues: { rowClues: [[1], [1]], columnClues: [[1], [1]] },
}

const none2x2: MinegramPuzzle = {
  dimensions: { rows: 2, columns: 2 },
  clues: { rowClues: [[1], [1]], columnClues: [[2], [1]] },
}

const forcedUnique3x3: MinegramPuzzle = {
  dimensions: { rows: 3, columns: 3 },
  clues: {
    rowClues: [[3], [], []],
    columnClues: [[1], [1], [1]],
  },
}

describe('finite-domain count-to-two solver', () => {
  it('returns a unique board when constraints force one solution', () => {
    const result = solvePuzzle(unique1x1)
    expect(result.status).toBe('unique')
    if (result.status === 'unique') {
      expect(result.solution).toEqual([1])
      expect(() => validateSolutionBoard(result.solution, unique1x1)).not.toThrow()
    }
    expect(solvePuzzle(forcedUnique3x3).status).toBe('unique')
    expect(() => validateSolutionBoard([0], unique1x1)).toThrow(/row 0 does not match/)
    expect(
      solvePuzzle({
        dimensions: { rows: 1, columns: 1 },
        clues: { rowClues: [[0]], columnClues: [[0]] },
      }),
    ).toMatchObject({ status: 'unique', solution: [0] })
  })

  it('returns two witness boards for multiple solutions and none for contradictions', () => {
    const multiple = solvePuzzle(multiple2x2)
    expect(multiple.status).toBe('multiple')
    if (multiple.status === 'multiple') {
      expect(multiple.solutions).toHaveLength(2)
      expect(multiple.solutions[0]).not.toEqual(multiple.solutions[1])
    }
    expect(solvePuzzle(none2x2).status).toBe('none')
  })

  it('is deterministic across repeated solves and solution ordering', () => {
    const first = solvePuzzle(multiple2x2)
    const second = solvePuzzle(multiple2x2)
    expect(second).toEqual(first)
    if (first.status === 'multiple') {
      expect(solvePuzzle(multiple2x2)).toEqual(first)
    }
  })

  it('fails closed for node, time, and cancellation limits', () => {
    expect(solvePuzzle(multiple2x2, { maxNodes: 0 })).toMatchObject({
      status: 'unknown',
      reason: 'node-limit',
      diagnostics: { nodesVisited: 0, solutionsFound: 0 },
    })
    expect(solvePuzzle(multiple2x2, { maxNodes: 1 })).toMatchObject({
      status: 'unknown',
      reason: 'node-limit',
    })
    expect(solvePuzzle(unique1x1, { timeBudgetMs: 0, now: () => 0 })).toMatchObject({
      status: 'unknown',
      reason: 'time-limit',
    })
    expect(solvePuzzle(multiple2x2, { signal: { aborted: true } as never })).toMatchObject({
      status: 'unknown',
      reason: 'cancelled',
    })
  })

  it('validates malformed budgets and never claims an interrupted search is unique', () => {
    expect(() => solvePuzzle(unique1x1, { maxNodes: -1 })).toThrow(/nonnegative/)
    expect(() => solvePuzzle(unique1x1, { timeBudgetMs: Number.NaN })).toThrow(/finite nonnegative/)
    expect(() => solvePuzzle(unique1x1, { signal: null as never })).toThrow(/AbortSignal-like/)
    expect(() => solvePuzzle(unique1x1, [] as never)).toThrow(/non-array object/)
  })
})
