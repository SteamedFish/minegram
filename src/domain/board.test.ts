import { describe, expect, it } from 'vitest'
import {
  assertBinaryMineBoard,
  assertBoardHasMineInEveryLine,
  assertBoardDimensions,
  assertCoordinate,
  assertLineLength,
  coordinateToIndex,
  countBoardMines,
  createEmptyBoard,
  getBoardCell,
  indexToCoordinate,
  type BoardDimensions,
} from './board'

const dimensions: BoardDimensions = { rows: 2, columns: 3 }
const coverageDimensions: BoardDimensions = { rows: 2, columns: 2 }

describe('board domain', () => {
  it('validates dimensions and maps row-major coordinates', () => {
    expect(() => assertBoardDimensions(dimensions)).not.toThrow()
    expect(coordinateToIndex({ row: 1, column: 2 }, dimensions)).toBe(5)
    expect(indexToCoordinate(4, dimensions)).toEqual({ row: 1, column: 1 })
    expect(indexToCoordinate(0, dimensions)).toEqual({ row: 0, column: 0 })
  })

  it('rejects malformed dimensions and line lengths with precise errors', () => {
    expect(() => assertBoardDimensions({ rows: 0, columns: 2 })).toThrow(/rows must be between/)
    expect(() => assertBoardDimensions({ rows: 2, columns: 31 })).toThrow(/columns must be between/)
    expect(() => assertBoardDimensions({ rows: '2', columns: 2 })).toThrow(/rows must be an integer/)
    expect(() => assertBoardDimensions(null)).toThrow(/must be an object/)
    expect(() => assertLineLength(1.5)).toThrow(/must be an integer/)
    expect(() => assertLineLength(31)).toThrow(/must be between/)
  })

  it('validates coordinates and reports out-of-bounds positions', () => {
    expect(() => assertCoordinate({ row: 0, column: 0 }, dimensions)).not.toThrow()
    expect(() => assertCoordinate({ row: -1, column: 0 }, dimensions)).toThrow(/row must be between/)
    expect(() => assertCoordinate({ row: 0, column: 3 }, dimensions)).toThrow(
      /column must be between/,
    )
    expect(() => assertCoordinate({ row: 0.5, column: 0 }, dimensions)).toThrow(
      /row must be an integer/,
    )
  })

  it('validates flattened binary boards and reads cells and mine totals', () => {
    const board = [1, 0, 1, 0, 1, 0] as const
    expect(() => assertBinaryMineBoard(board, dimensions)).not.toThrow()
    expect(getBoardCell(board, { row: 1, column: 1 }, dimensions)).toBe(1)
    expect(countBoardMines(board, dimensions)).toBe(3)
    expect(createEmptyBoard(dimensions)).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('validates row and column mine coverage for later generator layers', () => {
    expect(() => assertBoardHasMineInEveryLine([1, 0, 0, 1], coverageDimensions)).not.toThrow()
    expect(() => assertBoardHasMineInEveryLine([0, 0, 1, 1], coverageDimensions)).toThrow(
      /mine in row 0/,
    )
    expect(() => assertBoardHasMineInEveryLine([1, 0, 1, 0], coverageDimensions)).toThrow(
      /mine in column 1/,
    )
  })

  it('rejects malformed binary boards with cell context', () => {
    expect(() => assertBinaryMineBoard([1, 0], dimensions)).toThrow(/exactly 6 cells/)
    expect(() => assertBinaryMineBoard([1, 0, 2, 0, 0, 0], dimensions)).toThrow(
      /binary mine board\[2\]/,
    )
    expect(() => assertBinaryMineBoard('101010', dimensions)).toThrow(/must be an array/)
  })
})
