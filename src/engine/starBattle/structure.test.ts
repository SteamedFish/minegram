/**
 * Tests for the solver-independent board-structure module (`./structure.ts`).
 *
 * Independence is the point of the module (union-find where the production
 * gates use flood fills), so every assertion here is against hand-built
 * grids with known answers or against this file's OWN flood fill — never
 * against another structure.ts call as the source of truth. The two human
 * reference boards the player's enjoyment was measured on are pinned too:
 * the instrument must reproduce the parent's hand measurement (no hub,
 * largest 25–40%, board D a near-hub).
 */
import { describe, expect, it } from 'vitest'
import { generateStarBattle } from './construct'
import {
  STAR_SHAPE_MAX_LARGEST_REGION_SHARE,
  measureStarBoardStructure,
  regionStaysConnectedWithout,
  starShapeDefect,
  starShapeSatisfied,
} from './structure'
import { walkStarBattleBoard } from './walk'

/** Flattens row arrays into the engine's colour grid. */
function grid(rows: number[][]): Uint8Array {
  return Uint8Array.from(rows.flat())
}

/**
 * This file's OWN 4-connected flood fill: component count per colour.
 * A different algorithm from structure.ts's union-find, so a traversal
 * bug in one cannot pass both.
 */
function ownComponentsPerColour(colours: Uint8Array, n: number): number[] {
  const seen = new Uint8Array(n * n)
  const components = new Array<number>(n).fill(0)
  for (let start = 0; start < n * n; start += 1) {
    if (seen[start] !== 0) {
      continue
    }
    const colour = colours[start]
    components[colour] += 1
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const cell = stack.pop() as number
      const row = (cell / n) | 0
      const column = cell % n
      for (const neighbour of [
        row > 0 ? cell - n : -1,
        row + 1 < n ? cell + n : -1,
        column > 0 ? cell - 1 : -1,
        column + 1 < n ? cell + 1 : -1,
      ]) {
        if (neighbour >= 0 && seen[neighbour] === 0 && colours[neighbour] === colour) {
          seen[neighbour] = 1
          stack.push(neighbour)
        }
      }
    }
  }
  return components
}

describe('measureStarBoardStructure on hand-built grids', () => {
  it('detects the sea hub: one region adjacent to every other', () => {
    // Three singleton regions inside a sea (the starter signature).
    const colours = grid([
      [3, 3, 3, 1],
      [3, 0, 3, 3],
      [3, 3, 3, 3],
      [2, 3, 3, 3],
    ])
    const structure = measureStarBoardStructure(colours, 4)
    expect(structure.hubCount).toBe(1)
    expect(structure.hubColours).toEqual([3])
    expect(structure.adjacencyDegrees).toEqual([1, 1, 1, 3])
    expect(structure.largestRegionShare).toBeCloseTo(13 / 16)
    expect(structure.connected).toBe(true)
    expect(structure.componentCounts).toEqual([1, 1, 1, 1])
  })

  it('finds no hub when the adjacency graph is a cycle', () => {
    // Four quadrants: 0-1, 0-2, 1-3, 2-3 — every degree exactly 2.
    const colours = grid([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ])
    const structure = measureStarBoardStructure(colours, 4)
    expect(structure.hubCount).toBe(0)
    expect(structure.adjacencyDegrees).toEqual([2, 2, 2, 2])
    expect(structure.largestRegionShare).toBeCloseTo(0.25)
    expect(structure.connected).toBe(true)
  })

  it('reports split regions and absent colours as disconnected', () => {
    // Colour 0 in two diagonal corners; colour 1 absent entirely.
    const colours = grid([
      [0, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 2],
      [2, 2, 2, 0],
    ])
    const structure = measureStarBoardStructure(colours, 4)
    expect(structure.componentCounts[0]).toBe(2)
    expect(structure.componentCounts[1]).toBe(0)
    expect(structure.connected).toBe(false)
  })
})

describe('starShapeDefect / starShapeSatisfied', () => {
  const seaHub = measureStarBoardStructure(
    grid([
      [3, 3, 3, 1],
      [3, 0, 3, 3],
      [3, 3, 3, 3],
      [2, 3, 3, 3],
    ]),
    4,
  )
  const cycle = measureStarBoardStructure(
    grid([
      [0, 0, 1, 1],
      [0, 0, 1, 1],
      [2, 2, 3, 3],
      [2, 2, 3, 3],
    ]),
    4,
  )

  it('noHub gates on the hub count alone', () => {
    const gate = { noHub: true } as const
    expect(starShapeDefect(seaHub, gate)).toBe(1)
    expect(starShapeSatisfied(seaHub, gate)).toBe(false)
    expect(starShapeDefect(cycle, gate)).toBe(0)
    expect(starShapeSatisfied(cycle, gate)).toBe(true)
  })

  it('the share cap gates on the excess over it, with gradient', () => {
    const gate = { maxLargestRegionShare: 0.25 } as const
    // 13/16 = 0.8125 → excess 0.5625.
    expect(starShapeDefect(seaHub, gate)).toBeCloseTo(13 / 16 - 0.25)
    expect(starShapeSatisfied(seaHub, gate)).toBe(false)
    expect(starShapeDefect(cycle, gate)).toBe(0)
    expect(starShapeSatisfied(cycle, gate)).toBe(true)
  })

  it('the combined gate adds both terms', () => {
    const gate = { noHub: true, maxLargestRegionShare: 0.25 } as const
    expect(starShapeDefect(seaHub, gate)).toBeCloseTo(1 + (13 / 16 - 0.25))
    expect(starShapeDefect(cycle, gate)).toBe(0)
  })

  it('the shipped tier cap accepts the cycle and rejects the sea', () => {
    const gate = { noHub: true, maxLargestRegionShare: STAR_SHAPE_MAX_LARGEST_REGION_SHARE } as const
    expect(starShapeSatisfied(cycle, gate)).toBe(true)
    expect(starShapeSatisfied(seaHub, gate)).toBe(false)
  })
})

describe('union-find vs this file’s own flood fill on generated boards', () => {
  it('agrees on every construction-tier board (starter painted, steady shaped)', () => {
    for (const n of [4, 5, 6, 8, 10]) {
      for (const difficulty of ['starter', 'steady'] as const) {
        for (const seed of [1, 2, 3]) {
          const { puzzle } = generateStarBattle({ n, seed, difficulty })
          const structure = measureStarBoardStructure(puzzle.colours, n)
          expect(ownComponentsPerColour(puzzle.colours, n)).toEqual([...structure.componentCounts])
          expect(structure.connected).toBe(true)
        }
      }
    }
  })

  it('agrees on shape-gated walk boards', () => {
    const board = walkStarBattleBoard({
      n: 8,
      seed: 91,
      shape: { noHub: true, maxLargestRegionShare: STAR_SHAPE_MAX_LARGEST_REGION_SHARE },
    })
    const structure = measureStarBoardStructure(board.colours, 8)
    expect(structure.connected).toBe(true)
    expect(structure.hubCount).toBe(0)
    expect(ownComponentsPerColour(board.colours, 8)).toEqual([...structure.componentCounts])
  })
})

describe('reproduces the measured reference-board structure', () => {
  // Boards A and D from the parent's structure probe (2026-10-07) — the
  // boards the human singled out. A: no hub, largest 36%. D: no hub,
  // largest 30%, and a NEAR-hub: one region adjacent to 8 of the 9 others
  // (degree n - 2). The instrument must reproduce those numbers exactly.
  const boardA = grid([
    [0, 0, 0, 0, 0, 0, 1, 1, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 1],
    [0, 0, 0, 0, 0, 0, 0, 3, 3, 3],
    [4, 0, 0, 0, 0, 0, 0, 3, 3, 5],
    [4, 0, 6, 6, 0, 0, 0, 0, 3, 5],
    [4, 4, 6, 6, 0, 0, 0, 0, 3, 3],
    [4, 4, 4, 6, 6, 7, 7, 8, 8, 3],
    [6, 4, 6, 6, 9, 7, 8, 8, 8, 8],
    [6, 6, 6, 9, 9, 9, 9, 8, 8, 8],
    [2, 6, 6, 6, 9, 9, 8, 8, 8, 8],
  ])
  const boardD = grid([
    [0, 0, 0, 1, 1, 1, 2, 3, 3, 3],
    [2, 0, 0, 1, 1, 1, 2, 5, 5, 3],
    [2, 2, 0, 1, 1, 2, 2, 5, 5, 5],
    [2, 2, 2, 2, 2, 2, 2, 2, 5, 6],
    [7, 2, 2, 2, 2, 2, 2, 2, 6, 6],
    [7, 7, 2, 2, 2, 2, 2, 6, 6, 6],
    [7, 7, 7, 2, 2, 2, 8, 8, 8, 6],
    [7, 7, 7, 7, 9, 9, 8, 8, 8, 6],
    [7, 7, 7, 7, 9, 9, 9, 4, 8, 8],
    [7, 7, 7, 7, 4, 4, 4, 4, 8, 8],
  ])

  it('board A: no hub, largest 36%, fully connected', () => {
    const structure = measureStarBoardStructure(boardA, 10)
    expect(structure.hubCount).toBe(0)
    expect(structure.largestRegionShare).toBeCloseTo(0.36, 2)
    expect(structure.connected).toBe(true)
  })

  it('board D: no hub, largest 30%, one region at degree n - 2 (near-hub)', () => {
    const structure = measureStarBoardStructure(boardD, 10)
    expect(structure.hubCount).toBe(0)
    expect(structure.largestRegionShare).toBeCloseTo(0.3, 2)
    expect(structure.connected).toBe(true)
    // Colour 2 is the near-hub: adjacent to 8 of the 9 others.
    expect(Math.max(...structure.adjacencyDegrees)).toBe(8)
  })
})

describe('regionStaysConnectedWithout', () => {
  it('accepts vacating a non-articulation cell and rejects the region’s last cell', () => {
    // 2x2 block of colour 0 in the corner of a 4x4 sea.
    const colours = grid([
      [0, 0, 3, 3],
      [0, 0, 3, 3],
      [3, 3, 3, 3],
      [3, 3, 3, 3],
    ])
    // Any cell of the 2x2 block is safe to vacate (the rest stay connected).
    expect(regionStaysConnectedWithout(colours, 4, 0, 0)).toBe(true)
    expect(regionStaysConnectedWithout(colours, 4, 5, 0)).toBe(true)
    // A singleton region cannot be vacated at all.
    const singletons = grid([
      [3, 3, 3, 1],
      [3, 0, 3, 3],
      [3, 3, 3, 3],
      [2, 3, 3, 3],
    ])
    expect(regionStaysConnectedWithout(singletons, 4, 5, 0)).toBe(false)
  })
})
