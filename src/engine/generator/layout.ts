import {
  assertBinaryMineBoard,
  assertBoardDimensions,
  countBoardMines,
  type BinaryCell,
  type BinaryMineBoard,
  type BoardDimensions,
} from '../../domain/board'
import type { SeededRandom } from '../rng'

export type CandidateLayoutKind = 'random' | 'structured'

export interface CandidateLayout {
  readonly kind: CandidateLayoutKind
  readonly mineIndices: readonly number[]
  readonly board: BinaryMineBoard
}

function setToSortedIndices(selected: ReadonlySet<number>, cellCount: number): number[] {
  const indices: number[] = []
  for (let index = 0; index < cellCount; index += 1) {
    if (selected.has(index)) {
      indices.push(index)
    }
  }
  return indices
}

function boardFromSelected(
  selected: ReadonlySet<number>,
  dimensions: BoardDimensions,
): BinaryMineBoard {
  const board: BinaryCell[] = Array.from(
    { length: dimensions.rows * dimensions.columns },
    (_, index) => (selected.has(index) ? 1 : 0),
  )
  assertBinaryMineBoard(board, dimensions, 'generated mine layout')
  return Object.freeze(board)
}

function assertMineCount(
  mineCount: number,
  dimensions: BoardDimensions,
  context: string,
): void {
  const cellCount = dimensions.rows * dimensions.columns
  if (!Number.isSafeInteger(mineCount)) {
    throw new TypeError(`${context} must be a safe integer; received ${String(mineCount)}`)
  }
  if (mineCount < 0 || mineCount > cellCount) {
    throw new RangeError(
      `${context} must be between 0 and ${cellCount}; received ${mineCount}`,
    )
  }
}

function chooseIndex(rng: SeededRandom, candidates: readonly number[]): number | undefined {
  if (candidates.length === 0) {
    return undefined
  }
  return candidates[rng.nextInt(candidates.length)]
}

function shuffleIndices(length: number, rng: SeededRandom): number[] {
  const indices = Array.from({ length }, (_, index) => index)
  for (let index = indices.length - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1)
    const temporary = indices[index]
    indices[index] = indices[swapIndex]
    indices[swapIndex] = temporary
  }
  return indices
}

/**
 * At the minimum feasible count, one mine per line is possible only when the
 * longer line dimension is represented. Construct that matching directly so
 * coverage does not depend on a repair donor being available.
 */
function createMinimumCoverageSelected(
  dimensions: BoardDimensions,
  mineCount: number,
  rng: SeededRandom,
): Set<number> | undefined {
  if (mineCount !== Math.max(dimensions.rows, dimensions.columns)) {
    return undefined
  }

  const selected = new Set<number>()
  if (dimensions.rows >= dimensions.columns) {
    const columnOrder = shuffleIndices(dimensions.columns, rng)
    for (let row = 0; row < dimensions.rows; row += 1) {
      selected.add(row * dimensions.columns + columnOrder[row % dimensions.columns])
    }
  } else {
    const rowOrder = shuffleIndices(dimensions.rows, rng)
    for (let column = 0; column < dimensions.columns; column += 1) {
      selected.add(rowOrder[column % dimensions.rows] * dimensions.columns + column)
    }
  }
  return selected
}

/**
 * Repairs a selected set by moving mines from a cell whose row and column
 * still have another mine. The bounded loop makes coverage repair explicit and
 * deterministic; it never changes the requested mine count.
 */
function repairCoverage(
  selected: Set<number>,
  dimensions: BoardDimensions,
  rng: SeededRandom,
): boolean {
  const rowCounts = Array.from({ length: dimensions.rows }, () => 0)
  const columnCounts = Array.from({ length: dimensions.columns }, () => 0)
  for (const index of selected) {
    rowCounts[Math.floor(index / dimensions.columns)] += 1
    columnCounts[index % dimensions.columns] += 1
  }

  const missingRowTarget = (): number | undefined => {
    for (let row = 0; row < dimensions.rows; row += 1) {
      if (rowCounts[row] !== 0) {
        continue
      }
      const candidates: number[] = []
      for (let column = 0; column < dimensions.columns; column += 1) {
        if (!selected.has(row * dimensions.columns + column)) {
          candidates.push(row * dimensions.columns + column)
        }
      }
      const emptyColumns: number[] = []
      for (const index of candidates) {
        if (columnCounts[index % dimensions.columns] === 0) {
          emptyColumns.push(index)
        }
      }
      const preferred = emptyColumns.length > 0 ? emptyColumns : candidates
      let minimum = Number.POSITIVE_INFINITY
      let leastLoaded: number[] = []
      for (const index of preferred) {
        const load = columnCounts[index % dimensions.columns]
        if (load < minimum) {
          minimum = load
          leastLoaded = [index]
        } else if (load === minimum) {
          leastLoaded.push(index)
        }
      }
      return chooseIndex(rng, leastLoaded)
    }
    return undefined
  }

  const missingColumnTarget = (): number | undefined => {
    for (let column = 0; column < dimensions.columns; column += 1) {
      if (columnCounts[column] !== 0) {
        continue
      }
      const candidates: number[] = []
      for (let row = 0; row < dimensions.rows; row += 1) {
        if (!selected.has(row * dimensions.columns + column)) {
          candidates.push(row * dimensions.columns + column)
        }
      }
      const emptyRows: number[] = []
      for (const index of candidates) {
        if (rowCounts[Math.floor(index / dimensions.columns)] === 0) {
          emptyRows.push(index)
        }
      }
      const preferred = emptyRows.length > 0 ? emptyRows : candidates
      let minimum = Number.POSITIVE_INFINITY
      let leastLoaded: number[] = []
      for (const index of preferred) {
        const load = rowCounts[Math.floor(index / dimensions.columns)]
        if (load < minimum) {
          minimum = load
          leastLoaded = [index]
        } else if (load === minimum) {
          leastLoaded.push(index)
        }
      }
      return chooseIndex(rng, leastLoaded)
    }
    return undefined
  }

  const findDonor = (): number | undefined => {
    const safeDonors: number[] = []
    const rowDonors: number[] = []
    for (const index of selected) {
      const row = Math.floor(index / dimensions.columns)
      const column = index % dimensions.columns
      if (rowCounts[row] > 1) {
        rowDonors.push(index)
        if (columnCounts[column] > 1) {
          safeDonors.push(index)
        }
      }
    }
    // Prefer donors that preserve both line-coverage constraints. If every
    // remaining donor is in a critical column, the next bounded pass repairs
    // that column rather than returning a false-success layout.
    return chooseIndex(rng, safeDonors.length > 0 ? safeDonors : rowDonors)
  }

  for (let pass = 0; pass < dimensions.rows + dimensions.columns + 2; pass += 1) {
    const target = missingRowTarget() ?? missingColumnTarget()
    if (target === undefined) {
      const allRows = rowCounts.every((count) => count > 0)
      const allColumns = columnCounts.every((count) => count > 0)
      return allRows && allColumns
    }
    const donor = findDonor()
    if (donor === undefined) {
      return false
    }
    selected.delete(donor)
    selected.add(target)
    const donorRow = Math.floor(donor / dimensions.columns)
    const donorColumn = donor % dimensions.columns
    const targetRow = Math.floor(target / dimensions.columns)
    const targetColumn = target % dimensions.columns
    rowCounts[donorRow] -= 1
    columnCounts[donorColumn] -= 1
    rowCounts[targetRow] += 1
    columnCounts[targetColumn] += 1
  }
  return rowCounts.every((count) => count > 0) && columnCounts.every((count) => count > 0)
}

function createRandomSelected(
  dimensions: BoardDimensions,
  mineCount: number,
  rng: SeededRandom,
): Set<number> {
  const minimumCoverage = createMinimumCoverageSelected(dimensions, mineCount, rng)
  if (minimumCoverage !== undefined) {
    return minimumCoverage
  }

  const cellCount = dimensions.rows * dimensions.columns
  const permutation = Array.from({ length: cellCount }, (_, index) => index)
  // Fisher–Yates is the only random ordering primitive used by the generator.
  for (let index = cellCount - 1; index > 0; index -= 1) {
    const swapIndex = rng.nextInt(index + 1)
    const temporary = permutation[index]
    permutation[index] = permutation[swapIndex]
    permutation[swapIndex] = temporary
  }
  return new Set(permutation.slice(0, mineCount))
}

function createStructuredSelected(
  dimensions: BoardDimensions,
  mineCount: number,
  rng: SeededRandom,
): Set<number> {
  const minimumCoverage = createMinimumCoverageSelected(dimensions, mineCount, rng)
  if (minimumCoverage !== undefined) {
    return minimumCoverage
  }

  const selected = new Set<number>()
  const base = Math.floor(mineCount / dimensions.rows)
  const extra = mineCount % dimensions.rows
  const shift = rng.nextInt(Math.max(1, dimensions.columns))
  for (let row = 0; row < dimensions.rows; row += 1) {
    const count = base + (row < extra ? 1 : 0)
    if (count === 0) {
      continue
    }
    const maximumStart = Math.max(0, dimensions.columns - count)
    const offset = (row * 7 + shift) % (maximumStart + 1)
    for (let position = 0; position < count; position += 1) {
      selected.add(row * dimensions.columns + offset + position)
    }
  }
  if (selected.size !== mineCount) {
    return selected
  }
  if (!repairCoverage(selected, dimensions, rng)) {
    return selected
  }
  return selected
}

function finalizeLayout(
  kind: CandidateLayoutKind,
  selected: Set<number>,
  dimensions: BoardDimensions,
  mineCount: number,
): CandidateLayout {
  const board = boardFromSelected(selected, dimensions)
  if (countBoardMines(board, dimensions) !== mineCount) {
    throw new RangeError('generated layout lost its exact mine count')
  }
  const mineIndices = Object.freeze(setToSortedIndices(selected, dimensions.rows * dimensions.columns))
  return Object.freeze({ kind, mineIndices, board })
}

export function createRandomLayout(
  dimensions: BoardDimensions,
  mineCount: number,
  rng: SeededRandom,
): CandidateLayout {
  assertBoardDimensions(dimensions, 'random layout dimensions')
  assertMineCount(mineCount, dimensions, 'random layout mine count')
  const selected = createRandomSelected(dimensions, mineCount, rng)
  if (!repairCoverage(selected, dimensions, rng)) {
    throw new RangeError('could not construct a covered random layout')
  }
  return finalizeLayout('random', selected, dimensions, mineCount)
}

export function createStructuredLayout(
  dimensions: BoardDimensions,
  mineCount: number,
  rng: SeededRandom,
): CandidateLayout {
  assertBoardDimensions(dimensions, 'structured layout dimensions')
  assertMineCount(mineCount, dimensions, 'structured layout mine count')
  const selected = createStructuredSelected(dimensions, mineCount, rng)
  if (!repairCoverage(selected, dimensions, rng)) {
    throw new RangeError('could not construct a covered structured layout')
  }
  return finalizeLayout('structured', selected, dimensions, mineCount)
}

export function createLayouts(
  dimensions: BoardDimensions,
  mineCount: number,
  seedRng: SeededRandom,
): readonly CandidateLayout[] {
  assertBoardDimensions(dimensions, 'layout dimensions')
  assertMineCount(mineCount, dimensions, 'layout mine count')
  const layouts: CandidateLayout[] = []
  const randomRng = seedRng.derive('layout:random')
  const structuredRng = seedRng.derive('layout:structured')
  for (const [kind, create] of [
    ['random', createRandomLayout],
    ['structured', createStructuredLayout],
  ] as const) {
    try {
      const layout = create(dimensions, mineCount, kind === 'random' ? randomRng : structuredRng)
      if (
        layouts.length === 0 ||
        layouts[0].mineIndices.some((index, position) => index !== layout.mineIndices[position])
      ) {
        layouts.push(layout)
      }
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error
      }
      // A random layout may fail its bounded coverage repair on a pathological
      // shape. The structured layout is still attempted in the same root.
    }
  }
  return Object.freeze(layouts)
}
