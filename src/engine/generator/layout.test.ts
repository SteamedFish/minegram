import { describe, expect, it } from 'vitest'
import { countBoardMines, assertBoardHasMineInEveryLine } from '../../domain/board'
import { createSeededRandom, type SeededRandom } from '../rng'
import {
  createLayouts,
  createRandomLayout,
  createStructuredLayout,
} from './layout'

function dimensions(rows: number, columns: number) {
  return { rows, columns }
}

describe('generator layouts', () => {
  it('creates deterministic exact-count random layouts with every-line coverage', () => {
    const first = createRandomLayout(dimensions(5, 7), 12, createSeededRandom('layout'))
    const second = createRandomLayout(dimensions(5, 7), 12, createSeededRandom('layout'))
    expect(first).toEqual(second)
    expect(first.kind).toBe('random')
    expect(countBoardMines(first.board, dimensions(5, 7))).toBe(12)
    expect(() => assertBoardHasMineInEveryLine(first.board, dimensions(5, 7))).not.toThrow()
  })

  it('creates contiguous structured rows and repairs column coverage', () => {
    const layout = createStructuredLayout(dimensions(5, 7), 12, createSeededRandom('structured'))
    expect(layout.kind).toBe('structured')
    expect(countBoardMines(layout.board, dimensions(5, 7))).toBe(12)
    expect(() => assertBoardHasMineInEveryLine(layout.board, dimensions(5, 7))).not.toThrow()
    for (let row = 0; row < 5; row += 1) {
      const columns = layout.mineIndices
        .filter((index) => Math.floor(index / 7) === row)
        .map((index) => index % 7)
      let runs = columns.length === 0 ? 0 : 1
      for (let index = 1; index < columns.length; index += 1) {
        if (columns[index] !== columns[index - 1] + 1) {
          runs += 1
        }
      }
      expect(runs).toBeLessThanOrEqual(3)
    }
  })

  it('emits independent random and structured streams without unstable ordering', () => {
    const layouts = createLayouts(dimensions(6, 8), 18, createSeededRandom(42))
    expect(layouts).toHaveLength(2)
    expect(layouts.map((layout) => layout.kind)).toEqual(['random', 'structured'])
    for (const layout of layouts) {
      expect(layout.mineIndices).toEqual([...layout.mineIndices].sort((left, right) => left - right))
      expect(Object.isFrozen(layout)).toBe(true)
      expect(Object.isFrozen(layout.mineIndices)).toBe(true)
    }
  })

  it('rethrows unexpected layout construction errors', () => {
    const error = new Error('unexpected layout construction failure')
    const brokenRng: SeededRandom = {
      seed: 1,
      nextUint32: () => 0,
      nextFloat: () => 0,
      nextInt: () => {
        throw error
      },
      restart: () => brokenRng,
      derive: () => brokenRng,
    }

    expect(() => createLayouts(dimensions(3, 2), 3, brokenRng)).toThrow(error)
  })

  it('handles rectangular and one-cell edge dimensions', () => {
    for (const [rows, columns, mineCount] of [[1, 1, 1], [1, 30, 30], [30, 1, 30], [2, 7, 7]] as const) {
      const layout = createStructuredLayout(dimensions(rows, columns), mineCount, createSeededRandom(`${rows}x${columns}`))
      expect(countBoardMines(layout.board, dimensions(rows, columns))).toBe(mineCount)
      expect(() => assertBoardHasMineInEveryLine(layout.board, dimensions(rows, columns))).not.toThrow()
    }
  })

  it('constructs covered layouts at the minimum count in both orientations', () => {
    for (const [rows, columns] of [[3, 2], [2, 3], [3, 3], [4, 2], [2, 4]] as const) {
      const mineCount = Math.max(rows, columns)
      for (const create of [createRandomLayout, createStructuredLayout]) {
        const layout = create(dimensions(rows, columns), mineCount, createSeededRandom(`${rows}x${columns}-minimum`))
        expect(countBoardMines(layout.board, dimensions(rows, columns))).toBe(mineCount)
        expect(() => assertBoardHasMineInEveryLine(layout.board, dimensions(rows, columns))).not.toThrow()
        expect(new Set(layout.mineIndices).size).toBe(mineCount)
      }
    }
  })
})
