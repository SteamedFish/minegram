/**
 * Tests for the Star Battle propagation analyzer. The fixtures are
 * hand-designed so each cascade level lands in a separate propagation sweep,
 * which pins both the deduction order (row, then column, then colour, per
 * unit index) and the `rounds` difficulty signal.
 */
import { describe, expect, it } from 'vitest'
import { countStarSolutions } from './count'
import { analyzeStarBoard } from './analyze'

const plantedSolution = [1, 3, 0, 2]

/**
 * One-pass board: colours 0, 1 and 2 are singletons at their star cells and
 * colour 3 fills everything else. The first sweep places every star.
 */
function onePassBoard(): Uint8Array {
  return new Uint8Array([
    3, 0, 3, 3, //
    3, 3, 3, 1, //
    2, 3, 3, 3, //
    3, 3, 3, 3,
  ])
}

/**
 * Multi-pass board: only colour 3 (a singleton at the row-3 star cell) can
 * start. The seed lands in the LAST unit of sweep 1; its elimination makes
 * row 2 a hidden single in sweep 2, that placement makes column 3 a hidden
 * single later in sweep 2, and column 1 becomes the final single in sweep 3.
 */
function multiPassBoard(): Uint8Array {
  return new Uint8Array([
    0, 0, 1, 2, //
    1, 2, 0, 1, //
    2, 0, 1, 0, //
    2, 1, 3, 0,
  ])
}

/** No unit has a single candidate: propagation cannot start at all. */
function noBootstrapBoard(): Uint8Array {
  return new Uint8Array([
    0, 1, 2, 3, //
    1, 2, 3, 0, //
    2, 3, 0, 1, //
    3, 0, 1, 2,
  ])
}

/**
 * A singleton seed in the corner (0,0) whose cascade stalls immediately:
 * every other unit keeps at least two candidates, so propagation stops with
 * open cells. Corner placement matters: at n = 4 a star anywhere else would
 * strip its adjacent rows to a single candidate and cascade to a solution.
 */
function stallsAfterSeedBoard(): Uint8Array {
  return new Uint8Array([
    3, 0, 0, 0, //
    1, 1, 2, 2, //
    2, 2, 1, 0, //
    1, 1, 2, 0,
  ])
}

describe('analyzeStarBoard', () => {
  it('solves a one-pass board in a single round and reports the planted permutation', () => {
    const analysis = analyzeStarBoard(onePassBoard(), 4)
    expect(analysis.solvedByLogic).toBe(true)
    expect(analysis.rounds).toBe(1)
    expect(analysis.solution).toEqual(plantedSolution)
    expect(analysis.unknownCells).toBe(0)
  })

  it('solves a board that needs several passes, counting each cascade level', () => {
    const analysis = analyzeStarBoard(multiPassBoard(), 4)
    expect(analysis.solvedByLogic).toBe(true)
    expect(analysis.rounds).toBe(3)
    expect(analysis.solution).toEqual(plantedSolution)
    expect(analysis.unknownCells).toBe(0)
  })

  it('reports silence, not failure, when no unit has a single candidate', () => {
    const analysis = analyzeStarBoard(noBootstrapBoard(), 4)
    expect(analysis.solvedByLogic).toBe(false)
    expect(analysis.rounds).toBe(0)
    expect(analysis.solution).toBeNull()
    expect(analysis.unknownCells).toBe(16)
  })

  it('stalls mid-cascade with open cells when propagation is not enough', () => {
    const analysis = analyzeStarBoard(stallsAfterSeedBoard(), 4)
    expect(analysis.solvedByLogic).toBe(false)
    expect(analysis.solution).toBeNull()
    expect(analysis.unknownCells).toBeGreaterThan(0)
    expect(analysis.unknownCells).toBeLessThan(16)
  })

  it('cannot finish a uniquely solvable board that lacks a propagation seed', () => {
    // The multi-pass board with its singleton broken: colour 3 gains a second
    // cell, so no unit starts. The counter proves the board is STILL uniquely
    // solvable — propagation alone just cannot see it.
    const colours = multiPassBoard()
    colours[0] = 3
    expect(countStarSolutions(colours, 4, 2)).toBe(1)
    const analysis = analyzeStarBoard(colours, 4)
    expect(analysis.solvedByLogic).toBe(false)
    expect(analysis.unknownCells).toBe(16)
  })

  it('rejects malformed input', () => {
    expect(() => analyzeStarBoard(new Uint8Array(15), 4)).toThrow(RangeError)
    expect(() => analyzeStarBoard(new Uint8Array(16), 3)).toThrow(RangeError)
  })
})
