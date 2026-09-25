import { describe, expect, it } from 'vitest'
import { derivePuzzleClues, type MinegramPuzzle } from '../../domain/puzzle'
import { countMatchingBoardsReference } from '../referenceCounter'
import { solvePuzzle, validateSolutionBoard } from './constraintSolver'
import type { BinaryCell, BinaryMineBoard } from '../../domain/board'

function boardFromMask(mask: number, rows: number, columns: number): BinaryMineBoard {
  return Object.freeze(
    Array.from(
      { length: rows * columns },
      (_, index) => ((mask >>> index) & 1) as BinaryCell,
    ),
  )
}

function firstMaskWithMineCount(rows: number, columns: number, mineCount: number): number {
  const totalBits = rows * columns
  for (let mask = 0; mask < 2 ** totalBits; mask += 1) {
    let bits = 0
    for (let index = 0; index < totalBits; index += 1) {
      bits += (mask >>> index) & 1
    }
    if (bits === mineCount) {
      return mask
    }
  }
  throw new Error(`no ${rows}x${columns} mask has ${mineCount} mines`)
}

function expectedStatus(count: number): 'none' | 'unique' | 'multiple' {
  if (count === 0) {
    return 'none'
  }
  if (count === 1) {
    return 'unique'
  }
  return 'multiple'
}

const EXPECTED_EXHAUSTIVE_WITNESS_COUNT = 90_262

function validateReturnedWitnesses(
  result: ReturnType<typeof solvePuzzle>,
  puzzle: MinegramPuzzle,
): 0 | 1 | 2 {
  if (result.status === 'unique') {
    validateSolutionBoard(result.solution, puzzle)
    return 1
  }
  if (result.status === 'multiple') {
    validateSolutionBoard(result.solutions[0], puzzle)
    validateSolutionBoard(result.solutions[1], puzzle)
    return 2
  }
  return 0
}

describe('solver/reference differential coverage', () => {
  it('agrees for a representative board at every small size and mine count', () => {
    for (let rows = 1; rows <= 4; rows += 1) {
      for (let columns = 1; columns <= 4; columns += 1) {
        for (let mineCount = 0; mineCount <= rows * columns; mineCount += 1) {
          const board = boardFromMask(firstMaskWithMineCount(rows, columns, mineCount), rows, columns)
          const puzzle: MinegramPuzzle = {
            dimensions: { rows, columns },
            clues: derivePuzzleClues(board, { rows, columns }),
          }
          const reference = countMatchingBoardsReference(puzzle)
          expect(reference.status).toBe('complete')
          if (reference.status !== 'complete') {
            continue
          }
          const result = solvePuzzle(puzzle, { maxNodes: 1_000_000 })
          expect(
            result.status,
            `${rows}x${columns} with ${mineCount} mines had reference count ${reference.count}`,
          ).toBe(expectedStatus(reference.count))
          validateReturnedWitnesses(result, puzzle)
        }
      }
    }
  })

  it('matches an exhaustive count for every binary board up to 4x4', () => {
    let witnessChecks = 0
    let expectedWitnessChecks = 0

    for (let rows = 1; rows <= 4; rows += 1) {
      for (let columns = 1; columns <= 4; columns += 1) {
        const totalBoards = 2 ** (rows * columns)
        const countsByClues = new Map<string, number>()

        for (let mask = 0; mask < totalBoards; mask += 1) {
          const board = boardFromMask(mask, rows, columns)
          const clues = derivePuzzleClues(board, { rows, columns })
          const key = JSON.stringify(clues)
          countsByClues.set(key, (countsByClues.get(key) ?? 0) + 1)
        }

        for (let mask = 0; mask < totalBoards; mask += 1) {
          const board = boardFromMask(mask, rows, columns)
          const dimensions = { rows, columns }
          const puzzle: MinegramPuzzle = {
            dimensions,
            clues: derivePuzzleClues(board, dimensions),
          }
          const referenceCount = countsByClues.get(JSON.stringify(puzzle.clues)) ?? 0
          const result = solvePuzzle(puzzle, { maxNodes: 1_000_000 })
          expect(
            result.status,
            `${rows}x${columns} board ${mask} had exhaustive count ${referenceCount}`,
          ).toBe(expectedStatus(referenceCount))

          const returnedWitnessCount = validateReturnedWitnesses(result, puzzle)
          witnessChecks += returnedWitnessCount
          expectedWitnessChecks +=
            referenceCount === 1 ? 1 : referenceCount > 1 ? 2 : 0
        }
      }
    }

    expect(witnessChecks).toBe(expectedWitnessChecks)
    expect(witnessChecks).toBe(EXPECTED_EXHAUSTIVE_WITNESS_COUNT)
    expect(witnessChecks).toBeGreaterThan(0)
  }, 15_000)
})
