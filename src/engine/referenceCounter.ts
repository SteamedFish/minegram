import {
  assertBoardDimensions,
  type BoardDimensions,
} from '../domain/board'
import {
  assertMinegramPuzzle,
  type MinegramPuzzle,
} from '../domain/puzzle'
import type { OrderedLineClue } from '../domain/orderedClues'

export const MAX_REFERENCE_SIDE = 4

export interface ExhaustiveCountOptions {
  readonly maxCount?: number
  readonly maxBoardsExamined?: number
  readonly timeBudgetMs?: number
  readonly signal?: AbortSignal
  readonly now?: () => number
}

interface ExhaustiveCountSummary {
  readonly count: number
  readonly boardsExamined: number
}

export type ExhaustiveCountResult =
  | (ExhaustiveCountSummary & { readonly status: 'complete' })
  | (ExhaustiveCountSummary & { readonly status: 'capped' })
  | (ExhaustiveCountSummary & { readonly status: 'cancelled' })
  | (ExhaustiveCountSummary & { readonly status: 'node-limit' })
  | (ExhaustiveCountSummary & { readonly status: 'time-limit' })

function assertReferenceDimensions(dimensions: BoardDimensions): void {
  assertBoardDimensions(dimensions, 'reference counter dimensions')
  if (dimensions.rows > MAX_REFERENCE_SIDE || dimensions.columns > MAX_REFERENCE_SIDE) {
    throw new RangeError(
      `reference counter supports at most ${MAX_REFERENCE_SIDE} rows and ${MAX_REFERENCE_SIDE} columns; received ${dimensions.rows}x${dimensions.columns}`,
    )
  }
}

function isAbortSignalLike(value: unknown): value is { readonly aborted: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof value.aborted === 'boolean'
  )
}

function assertCountOptions(options: ExhaustiveCountOptions): void {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    throw new TypeError('reference counter options must be a non-array object')
  }
  if (
    options.maxCount !== undefined &&
    (!Number.isSafeInteger(options.maxCount) || options.maxCount <= 0)
  ) {
    throw new RangeError(`maxCount must be a positive safe integer; received ${String(options.maxCount)}`)
  }
  if (
    options.maxBoardsExamined !== undefined &&
    (!Number.isSafeInteger(options.maxBoardsExamined) || options.maxBoardsExamined < 0)
  ) {
    throw new RangeError(
      `maxBoardsExamined must be a nonnegative safe integer; received ${String(options.maxBoardsExamined)}`,
    )
  }
  if (
    options.timeBudgetMs !== undefined &&
    (!Number.isFinite(options.timeBudgetMs) || options.timeBudgetMs < 0)
  ) {
    throw new RangeError(
      `timeBudgetMs must be a finite nonnegative number; received ${String(options.timeBudgetMs)}`,
    )
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('now must be a function returning a finite millisecond value')
  }
  if (options.signal !== undefined && !isAbortSignalLike(options.signal)) {
    throw new TypeError('signal must be an AbortSignal-like object with a boolean aborted field')
  }
}

function sameClue(left: OrderedLineClue, right: OrderedLineClue): boolean {
  const normalizedLeft = left.filter((value) => value > 0)
  const normalizedRight = right.filter((value) => value > 0)
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  )
}

function readRuns(
  mask: number,
  lineLength: number,
  startBit: number,
  bitStride: number,
): number[] {
  const runs: number[] = []
  let currentRun = 0
  for (let position = 0; position < lineLength; position += 1) {
    const bit = (mask >>> (startBit + position * bitStride)) & 1
    if (bit === 1) {
      currentRun += 1
    } else if (currentRun > 0) {
      runs.push(currentRun)
      currentRun = 0
    }
  }
  if (currentRun > 0) {
    runs.push(currentRun)
  }
  return runs
}

function readClock(clock: () => number): number {
  const current = clock()
  if (!Number.isFinite(current)) {
    throw new TypeError('now must return a finite millisecond value')
  }
  return current
}

function boardMatchesClues(mask: number, puzzle: MinegramPuzzle): boolean {
  const { dimensions, clues } = puzzle
  for (let row = 0; row < dimensions.rows; row += 1) {
    const actual = readRuns(mask, dimensions.columns, row * dimensions.columns, 1)
    if (!sameClue(actual, clues.rowClues[row])) {
      return false
    }
  }
  for (let column = 0; column < dimensions.columns; column += 1) {
    const actual = readRuns(mask, dimensions.rows, column, dimensions.columns)
    if (!sameClue(actual, clues.columnClues[column])) {
      return false
    }
  }
  return true
}

export function countMatchingBoardsReference(
  puzzle: MinegramPuzzle,
  options: ExhaustiveCountOptions = {},
): ExhaustiveCountResult {
  assertMinegramPuzzle(puzzle)
  assertCountOptions(options)
  assertReferenceDimensions(puzzle.dimensions)

  const totalBoards = 2 ** (puzzle.dimensions.rows * puzzle.dimensions.columns)
  const maxBoardsExamined = options.maxBoardsExamined ?? totalBoards

  let count = 0
  let boardsExamined = 0

  // Preserve the loop's stop precedence while rejecting work that cannot begin
  // before reading a user-supplied clock.
  if (options.signal?.aborted) {
    return { status: 'cancelled', count, boardsExamined }
  }
  if (maxBoardsExamined === 0) {
    return { status: 'node-limit', count, boardsExamined }
  }
  if (options.timeBudgetMs === 0) {
    return { status: 'time-limit', count, boardsExamined }
  }

  const clock = options.now ?? Date.now
  const startTime = options.timeBudgetMs === undefined ? undefined : readClock(clock)

  for (let mask = 0; mask < totalBoards; mask += 1) {
    if (options.signal?.aborted) {
      return { status: 'cancelled', count, boardsExamined }
    }
    if (boardsExamined >= maxBoardsExamined) {
      return { status: 'node-limit', count, boardsExamined }
    }
    if (startTime !== undefined && readClock(clock) - startTime >= options.timeBudgetMs!) {
      return { status: 'time-limit', count, boardsExamined }
    }

    boardsExamined += 1
    if (boardMatchesClues(mask, puzzle)) {
      count += 1
      if (options.maxCount !== undefined && count >= options.maxCount) {
        return { status: 'capped', count, boardsExamined }
      }
    }
  }

  return { status: 'complete', count, boardsExamined }
}
