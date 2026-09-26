export const MIN_BOARD_SIDE = 1
// 24 is a capacity fact, not a taste call. The solver enumerates the legal
// per-line patterns for an ordered clue, and that enumeration is bounded (10,000
// patterns / 300,000 materialized cells per line). A ~25-cell line carrying
// internal blank separators no longer fits that budget, so every board above 24
// per side exhausts the resource limit and fails closed with
// `resource-limit` — and no amount of extra solver nodes or wall-clock time
// changes it, because the cliff is pattern materialization, not search effort.
// Measured over 25 seeds at 60% density with a 30s budget: 0/24 failures at
// 24x24 (slowest 968ms) versus 5/24 at 25x25, then 2/2 at 26x26, 28x28 and
// 30x30. Raising the node budget to 400k/1.6M/6.4M leaves 30x30 at
// `accepted=0 rollbacks=16`.
export const MAX_BOARD_SIDE = 24
export const MAX_BOARD_CELLS = MAX_BOARD_SIDE * MAX_BOARD_SIDE

export type BinaryCell = 0 | 1
export type BinaryLine = readonly BinaryCell[]
export type BinaryMineBoard = readonly BinaryCell[]

export interface BoardDimensions {
  readonly rows: number
  readonly columns: number
}

export interface Coordinate {
  readonly row: number
  readonly column: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function assertBoardDimensions(
  value: unknown,
  context = 'board dimensions',
): asserts value is BoardDimensions {
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object with integer rows and columns`)
  }

  const { rows, columns } = value
  if (typeof rows !== 'number' || !Number.isInteger(rows)) {
    throw new TypeError(`${context}.rows must be an integer; received ${String(rows)}`)
  }
  if (typeof columns !== 'number' || !Number.isInteger(columns)) {
    throw new TypeError(`${context}.columns must be an integer; received ${String(columns)}`)
  }
  if (rows < MIN_BOARD_SIDE || rows > MAX_BOARD_SIDE) {
    throw new RangeError(
      `${context}.rows must be between ${MIN_BOARD_SIDE} and ${MAX_BOARD_SIDE}; received ${rows}`,
    )
  }
  if (columns < MIN_BOARD_SIDE || columns > MAX_BOARD_SIDE) {
    throw new RangeError(
      `${context}.columns must be between ${MIN_BOARD_SIDE} and ${MAX_BOARD_SIDE}; received ${columns}`,
    )
  }
  if (rows * columns > MAX_BOARD_CELLS) {
    throw new RangeError(
      `${context} must contain at most ${MAX_BOARD_CELLS} cells; received ${rows * columns}`,
    )
  }
}

export function assertLineLength(value: number, context = 'line length'): void {
  if (!Number.isInteger(value)) {
    throw new TypeError(`${context} must be an integer; received ${String(value)}`)
  }
  if (value < MIN_BOARD_SIDE || value > MAX_BOARD_SIDE) {
    throw new RangeError(
      `${context} must be between ${MIN_BOARD_SIDE} and ${MAX_BOARD_SIDE}; received ${value}`,
    )
  }
}

export function assertCoordinate(
  value: unknown,
  dimensions: BoardDimensions,
  context = 'coordinate',
): asserts value is Coordinate {
  assertBoardDimensions(dimensions, `${context} dimensions`)
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be an object with integer row and column fields`)
  }

  const { row, column } = value
  if (typeof row !== 'number' || !Number.isInteger(row)) {
    throw new TypeError(`${context}.row must be an integer; received ${String(row)}`)
  }
  if (typeof column !== 'number' || !Number.isInteger(column)) {
    throw new TypeError(`${context}.column must be an integer; received ${String(column)}`)
  }
  if (row < 0 || row >= dimensions.rows) {
    throw new RangeError(
      `${context}.row must be between 0 and ${dimensions.rows - 1}; received ${row}`,
    )
  }
  if (column < 0 || column >= dimensions.columns) {
    throw new RangeError(
      `${context}.column must be between 0 and ${dimensions.columns - 1}; received ${column}`,
    )
  }
}

export function coordinateToIndex(coordinate: Coordinate, dimensions: BoardDimensions): number {
  assertBoardDimensions(dimensions)
  assertCoordinate(coordinate, dimensions)
  return coordinate.row * dimensions.columns + coordinate.column
}

export function indexToCoordinate(index: number, dimensions: BoardDimensions): Coordinate {
  assertBoardDimensions(dimensions)

  const cellCount = dimensions.rows * dimensions.columns
  if (!Number.isInteger(index)) {
    throw new TypeError(`cell index must be an integer; received ${String(index)}`)
  }
  if (index < 0 || index >= cellCount) {
    throw new RangeError(`cell index must be between 0 and ${cellCount - 1}; received ${index}`)
  }

  return Object.freeze({
    row: Math.floor(index / dimensions.columns),
    column: index % dimensions.columns,
  })
}

export function assertBinaryMineBoard(
  value: unknown,
  dimensions: BoardDimensions,
  context = 'binary mine board',
): asserts value is BinaryMineBoard {
  assertBoardDimensions(dimensions, `${context} dimensions`)
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array of binary cells`)
  }

  const expectedLength = dimensions.rows * dimensions.columns
  if (value.length !== expectedLength) {
    throw new RangeError(
      `${context} must contain exactly ${expectedLength} cells; received ${value.length}`,
    )
  }

  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0 && value[index] !== 1) {
      throw new TypeError(`${context}[${index}] must be 0 or 1; received ${String(value[index])}`)
    }
  }
}

export function assertBinaryLine(value: unknown, context = 'binary line'): asserts value is BinaryLine {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array of binary cells`)
  }
  assertLineLength(value.length, `${context} length`)
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== 0 && value[index] !== 1) {
      throw new TypeError(`${context}[${index}] must be 0 or 1; received ${String(value[index])}`)
    }
  }
}

export function createEmptyBoard(dimensions: BoardDimensions): BinaryMineBoard {
  assertBoardDimensions(dimensions)
  return Object.freeze(Array.from({ length: dimensions.rows * dimensions.columns }, () => 0 as const))
}

export function getBoardCell(
  board: BinaryMineBoard,
  coordinate: Coordinate,
  dimensions: BoardDimensions,
): BinaryCell {
  assertBinaryMineBoard(board, dimensions)
  return board[coordinateToIndex(coordinate, dimensions)]
}

export function countBoardMines(board: BinaryMineBoard, dimensions: BoardDimensions): number {
  assertBinaryMineBoard(board, dimensions)
  let mineCount = 0
  for (const cell of board) {
    mineCount += cell
  }
  return mineCount
}

export function assertBoardHasMineInEveryLine(
  board: BinaryMineBoard,
  dimensions: BoardDimensions,
  context = 'mine coverage',
): void {
  assertBinaryMineBoard(board, dimensions, `${context} board`)
  for (let row = 0; row < dimensions.rows; row += 1) {
    const start = row * dimensions.columns
    let hasMine = false
    for (let column = 0; column < dimensions.columns; column += 1) {
      if (board[start + column] === 1) {
        hasMine = true
        break
      }
    }
    if (!hasMine) {
      throw new RangeError(`${context} requires a mine in row ${row}`)
    }
  }

  for (let column = 0; column < dimensions.columns; column += 1) {
    let hasMine = false
    for (let row = 0; row < dimensions.rows; row += 1) {
      if (board[row * dimensions.columns + column] === 1) {
        hasMine = true
        break
      }
    }
    if (!hasMine) {
      throw new RangeError(`${context} requires a mine in column ${column}`)
    }
  }
}
