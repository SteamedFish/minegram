import { describe, expect, it } from 'vitest'
import {
  boardFromAssignments,
  createConstraintDomains,
  propagateConstraints,
} from './propagation'
import type { MinegramPuzzle } from '../../domain/puzzle'

const forcedPuzzle: MinegramPuzzle = {
  dimensions: { rows: 3, columns: 3 },
  clues: {
    rowClues: [[3], [], []],
    columnClues: [[1], [1], [1]],
  },
}

const contradictoryPuzzle: MinegramPuzzle = {
  dimensions: { rows: 2, columns: 2 },
  clues: {
    rowClues: [[1], [1]],
    columnClues: [[2], [1]],
  },
}

describe('finite-domain propagation', () => {
  it('filters domains and propagates forced cells to a fixed point', () => {
    const domains = createConstraintDomains(forcedPuzzle)
    expect(domains.rowDomains[0]).toEqual([0])
    const result = propagateConstraints(forcedPuzzle)
    expect(result.status).toBe('stable')
    expect([...result.assignments]).toEqual([1, 1, 1, 0, 0, 0, 0, 0, 0])
    expect(result.forcedCells).toHaveLength(9)
    expect(result.forcedCells[0]).toEqual({ row: 0, column: 0 })
    expect(Object.isFrozen(result.assignments)).toBe(true)
  })

  it('detects contradictory domains and explicit conflicting assignments', () => {
    expect(propagateConstraints(contradictoryPuzzle).status).toBe('contradiction')
    expect(
      propagateConstraints(forcedPuzzle, [0, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined])
        .status,
    ).toBe('contradiction')
  })

  it('validates every explicit assignment while treating only undefined as omitted', () => {
    const malformedAssignments: unknown[] = [
      null,
      'empty',
      [2, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined],
      Array(9),
    ]

    for (const assignments of malformedAssignments) {
      expect(() => propagateConstraints(forcedPuzzle, assignments as never)).toThrow()
    }
    expect(propagateConstraints(forcedPuzzle, undefined).status).toBe('stable')
  })

  it('rejects sparse partial boards and only builds complete boards from fully assigned cells', () => {
    expect(() => boardFromAssignments(Array(2) as never, { rows: 1, columns: 2 })).toThrow(
      /explicit undefined/,
    )
    expect(() =>
      boardFromAssignments([1, undefined], { rows: 1, columns: 2 }),
    ).toThrow(/partial assignments/)
    expect(boardFromAssignments([1, 0], { rows: 1, columns: 2 })).toEqual([1, 0])
  })
})
