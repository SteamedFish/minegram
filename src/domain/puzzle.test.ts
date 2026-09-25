import { describe, expect, it } from 'vitest'
import {
  assertMinegramPuzzle,
  assertPuzzleClues,
  derivePuzzleClues,
  type MinegramPuzzle,
} from './puzzle'

const dimensions = { rows: 2, columns: 3 } as const

describe('puzzle domain', () => {
  it('derives ordered row and column clues from a flattened board', () => {
    const board = [1, 0, 1, 0, 1, 1] as const
    const clues = derivePuzzleClues(board, dimensions)
    expect(clues.rowClues).toEqual([[1, 1], [2]])
    expect(clues.columnClues).toEqual([[1], [1], [2]])
    expect(() => assertPuzzleClues(dimensions, clues)).not.toThrow()
    expect(() =>
      assertMinegramPuzzle({ dimensions, clues }),
    ).not.toThrow()
  })

  it('validates clue cardinality and nested malformed clues', () => {
    expect(() => assertPuzzleClues(dimensions, { rowClues: [[1]], columnClues: [[1], [1], [1]] })).toThrow(
      /exactly 2 clues/,
    )
    expect(() =>
      assertPuzzleClues(dimensions, { rowClues: [[1], [1]], columnClues: [[1], [1], [-1]] }),
    ).toThrow(/columnClues\[2\]\[0\]/)
    expect(() =>
      assertPuzzleClues(dimensions, { rowClues: [[1], [1]], columnClues: [[1], [1], [2]] }),
    ).not.toThrow()
    expect(() => assertMinegramPuzzle({ dimensions, clues: null })).toThrow(
      /clues must be an object/,
    )
  })

  it('rejects malformed board inputs while deriving clues', () => {
    expect(() => derivePuzzleClues([1, 0, 1, 0, 1], dimensions)).toThrow(/exactly 6 cells/)
    expect(() => derivePuzzleClues([1, 0, 2, 0, 1, 0] as never, dimensions)).toThrow(/\[2\]/)
  })

  it('exposes a stable puzzle shape for later layers', () => {
    const puzzle: MinegramPuzzle = {
      dimensions,
      clues: { rowClues: [[1], [1]], columnClues: [[1], [1], [1]] },
    }
    expect(Object.isFrozen(puzzle)).toBe(false)
    expect(() => assertMinegramPuzzle(puzzle)).not.toThrow()
  })
})
