import {
  assertBinaryMineBoard,
  assertBoardDimensions,
  type BinaryLine,
  type BinaryMineBoard,
  type BoardDimensions,
} from './board'
import {
  assertOrderedLineClue,
  encodeOrderedLineClue,
  type ColumnClues,
  type OrderedLineClue,
  type RowClues,
} from './orderedClues'

export interface PuzzleClues {
  readonly rowClues: RowClues
  readonly columnClues: ColumnClues
}

export interface MinegramPuzzle {
  readonly dimensions: BoardDimensions
  readonly clues: PuzzleClues
}

export function assertPuzzleClues(
  dimensions: BoardDimensions,
  value: unknown,
  context = 'puzzle clues',
): asserts value is PuzzleClues {
  assertBoardDimensions(dimensions, `${context} dimensions`)
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${context} must be an object with rowClues and columnClues`)
  }

  const candidate = value as Record<string, unknown>
  const { rowClues, columnClues } = candidate
  if (!Array.isArray(rowClues)) {
    throw new TypeError(`${context}.rowClues must be an array`)
  }
  if (rowClues.length !== dimensions.rows) {
    throw new RangeError(
      `${context}.rowClues must contain exactly ${dimensions.rows} clues; received ${rowClues.length}`,
    )
  }
  if (!Array.isArray(columnClues)) {
    throw new TypeError(`${context}.columnClues must be an array`)
  }
  if (columnClues.length !== dimensions.columns) {
    throw new RangeError(
      `${context}.columnClues must contain exactly ${dimensions.columns} clues; received ${columnClues.length}`,
    )
  }

  for (let row = 0; row < rowClues.length; row += 1) {
    assertOrderedLineClue(
      dimensions.columns,
      rowClues[row],
      `${context}.rowClues[${row}]`,
    )
  }
  for (let column = 0; column < columnClues.length; column += 1) {
    assertOrderedLineClue(
      dimensions.rows,
      columnClues[column],
      `${context}.columnClues[${column}]`,
    )
  }
}

export function assertMinegramPuzzle(
  value: unknown,
  context = 'puzzle',
): asserts value is MinegramPuzzle {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${context} must be an object`)
  }

  const candidate = value as Record<string, unknown>
  assertBoardDimensions(candidate.dimensions, `${context}.dimensions`)
  if (typeof candidate.clues !== 'object' || candidate.clues === null) {
    throw new TypeError(`${context}.clues must be an object`)
  }

  assertPuzzleClues(candidate.dimensions, candidate.clues, `${context}.clues`)
}

export function derivePuzzleClues(
  board: BinaryMineBoard,
  dimensions: BoardDimensions,
): PuzzleClues {
  assertBinaryMineBoard(board, dimensions)

  const rowClues: OrderedLineClue[] = []
  for (let row = 0; row < dimensions.rows; row += 1) {
    const start = row * dimensions.columns
    rowClues.push(encodeOrderedLineClue(board.slice(start, start + dimensions.columns) as BinaryLine))
  }

  const columnClues: OrderedLineClue[] = []
  for (let column = 0; column < dimensions.columns; column += 1) {
    const line = Array.from(
      { length: dimensions.rows },
      (_, row) => board[row * dimensions.columns + column],
    ) as BinaryLine
    columnClues.push(encodeOrderedLineClue(line))
  }

  return Object.freeze({
    rowClues: Object.freeze(rowClues),
    columnClues: Object.freeze(columnClues),
  })
}
