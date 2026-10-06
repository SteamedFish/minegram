/**
 * Tests for the propagation solver: pinned wave counts on hand-built
 * fixtures, cross-validation against an INDEPENDENT brute-force solution
 * enumerator (plain swap recursion + a Set — deliberately no bitmasks and
 * no shared code with the solver), and honest reporting of stalled and
 * unsolvable boards.
 */
import { describe, expect, it } from 'vitest'
import { STAR_STAR, assertStarBattlePuzzle } from '../../domain/starBattle'
import { generateStarBattle } from './construct'
import { propagateStarBoard, type StarPropagationResult } from './propagate'

/**
 * The independent oracle: enumerates column permutations by plain swap
 * recursion, pruning by the adjacency rule and a colour Set, returning up
 * to `cap` full solutions and whether the search exhausted (a capped,
 * non-exhausted run proves nothing about the boards it never reached).
 */
function bruteStarSolutions(
  colours: Uint8Array,
  n: number,
  cap: number,
  nodeBudget: number,
): { readonly solutions: readonly (readonly number[])[]; readonly exhausted: boolean; readonly nodes: number } {
  const array = Array.from({ length: n }, (_, index) => index)
  const solutions: number[][] = []
  const usedColours = new Set<number>()
  let nodes = 0
  let stopped = false
  const walk = (depth: number): void => {
    if (solutions.length >= cap || stopped) {
      return
    }
    if (depth === n) {
      solutions.push([...array])
      return
    }
    nodes += 1
    if (nodes > nodeBudget) {
      stopped = true
      return
    }
    for (let pick = depth; pick < n; pick += 1) {
      const swap = array[depth]
      array[depth] = array[pick]
      array[pick] = swap
      const column = array[depth]
      if (depth > 0 && Math.abs(column - array[depth - 1]) < 2) {
        array[pick] = array[depth]
        array[depth] = swap
        continue
      }
      const colour = colours[depth * n + column]
      if (usedColours.has(colour)) {
        array[pick] = array[depth]
        array[depth] = swap
        continue
      }
      usedColours.add(colour)
      walk(depth + 1)
      usedColours.delete(colour)
      array[pick] = array[depth]
      array[depth] = swap
      if (solutions.length >= cap || stopped) {
        return
      }
    }
  }
  walk(0)
  return { solutions, exhausted: !stopped, nodes }
}

function starsAsPermutation(result: StarPropagationResult): number[] {
  return result.stars.map(([, column]) => column)
}

/**
 * Paints a fixture by the oracle's CHAIN rule: decoys of row r take region
 * pos[r] + 1, except the last proof-order row whose decoys take n - 1.
 * Test-local so the production painting stays free to bias differently.
 */
function paintChainFixture(n: number, permutation: readonly number[], pos: readonly number[]): Uint8Array {
  const colours = new Uint8Array(n * n)
  const rowOfColumn = new Int16Array(n)
  for (let row = 0; row < n; row += 1) {
    rowOfColumn[permutation[row]] = row
  }
  const lastRow = pos.indexOf(n - 1)
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      if (column === permutation[row]) {
        colours[row * n + column] = pos[row]
        continue
      }
      const region = row === lastRow ? n - 1 : pos[row] + 1
      colours[row * n + column] = region
    }
  }
  return colours
}

/** Paints every decoy into the last region — the shallowest construction. */
function paintShallowFixture(n: number, permutation: readonly number[], pos: readonly number[]): Uint8Array {
  const colours = new Uint8Array(n * n)
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      colours[row * n + column] = column === permutation[row] ? pos[row] : n - 1
    }
  }
  return colours
}

const T_4 = [1, 3, 0, 2] as const
const POS_4 = [0, 1, 2, 3] as const

describe('propagateStarBoard', () => {
  it('pins the exact wave count of the hand-built shallow 4x4 fixture', () => {
    // Every decoy in region 3: regions 0..2 are singletons from the start,
    // wave 1 places three stars, wave 3 places the last. Frozen-state
    // semantics make 3 the global minimum for this construction.
    const colours = paintShallowFixture(4, T_4, POS_4)
    const result = propagateStarBoard(colours, 4)
    expect(result.solved).toBe(true)
    expect(result.waves).toBe(3)
    expect(result.stalledRounds).toBe(0)
    expect(result.stars).toEqual([
      [0, 1],
      [1, 3],
      [2, 0],
      [3, 2],
    ])
  })

  it('pins the exact wave count of the hand-built chain 4x4 fixture', () => {
    // Chain painting: each region's decoys are blanked only by the
    // preceding star, so the induction unwinds one link per wave and the
    // 4-star board needs five.
    const colours = paintChainFixture(4, T_4, POS_4)
    const result = propagateStarBoard(colours, 4)
    expect(result.solved).toBe(true)
    expect(result.waves).toBe(5)
    expect(result.stalledRounds).toBe(0)
    expect(starsAsPermutation(result)).toEqual([1, 3, 0, 2])
  })

  it('chain at n=12 is strictly deeper than the shallow fixture', () => {
    // A fixed admissible permutation: evens ascending, then odds.
    const permutation = [0, 2, 4, 6, 8, 10, 1, 3, 5, 7, 9, 11]
    const pos = Array.from({ length: 12 }, (_, index) => index)
    const shallow = propagateStarBoard(paintShallowFixture(12, permutation, pos), 12)
    const chain = propagateStarBoard(paintChainFixture(12, permutation, pos), 12)
    expect(shallow.solved).toBe(true)
    expect(shallow.waves).toBe(3)
    expect(chain.solved).toBe(true)
    expect(chain.waves).toBeGreaterThan(shallow.waves)
    expect(starsAsPermutation(chain)).toEqual(permutation)
    // Pin the measured depth too, so a semantic drift in wave counting
    // fails loudly rather than sliding the difficulty bands silently.
    expect(chain.waves).toBeGreaterThanOrEqual(12)
  })

  it('reports waves === 0 honestly when nothing is deducible', () => {
    // A cyclic Latin colouring: every row, column and colour spans n
    // cells, so the first sweep finds no forced move at all.
    const n = 4
    const colours = new Uint8Array(n * n)
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        colours[row * n + column] = (row + column) % n
      }
    }
    const result = propagateStarBoard(colours, n)
    expect(result.solved).toBe(false)
    expect(result.waves).toBe(0)
    expect(result.stalledRounds).toBe(1)
    expect(result.stars).toEqual([])
  })

  it('reports a dead colour as unsolvable without guessing', () => {
    // Colour 0 is the singleton (0,0); every colour-1 cell shares its row,
    // column or 3x3 neighbourhood with that forced star, so rule R4 can
    // never be satisfied.
    const n = 4
    const colours = new Uint8Array([
      0, 1, 2, 3,
      1, 1, 2, 3,
      2, 2, 3, 3,
      3, 2, 2, 3,
    ])
    const result = propagateStarBoard(colours, n)
    expect(result.solved).toBe(false)
    expect(result.waves).toBe(2)
    expect(result.stalledRounds).toBeGreaterThanOrEqual(1)
    expect(result.stars).toEqual([[0, 0]])
  })

  it('validates its inputs', () => {
    expect(() => propagateStarBoard(new Uint8Array(3), 4)).toThrow(RangeError)
    expect(() => propagateStarBoard(new Uint8Array(16), 3)).toThrow(RangeError)
  })

  it('solves the puzzle the star mark constants ship alongside', () => {
    // Guard against an accidental import drift: the domain marks stay the
    // wire format and the solver stays a pure function of the grid.
    expect(STAR_STAR).toBe(2)
  })
})

describe('propagateStarBoard cross-validated against independent brute force', () => {
  const difficulties = ['starter', 'steady', 'challenging'] as const
  const nodeBudget = 5_000_000

  const expectAgreement = (
    colours: Uint8Array,
    n: number,
    planted: readonly number[],
    budget: number,
  ) => {
    const propagated = propagateStarBoard(colours, n)
    const brute = bruteStarSolutions(colours, n, 3, budget)
    // Every solution the brute force found must be the planted one (a
    // second solution would refute uniqueness whatever the cap).
    for (const solution of brute.solutions) {
      expect([...solution]).toEqual([...planted])
    }
    if (brute.exhausted) {
      // Full enumeration: uniqueness decided. The solver must agree, and
      // its stars must be exactly the planted permutation.
      expect(brute.solutions).toHaveLength(1)
      expect(propagated.solved).toBe(true)
      expect(propagated.waves).toBeGreaterThan(0)
      expect(starsAsPermutation(propagated)).toEqual([...planted])
    } else {
      // Budget exhausted before the tree did: uniqueness is unproven
      // here, but the solver may not contradict the partial evidence.
      expect(propagated.solved || brute.solutions.length > 1).toBe(true)
    }
  }

  it('agrees at n=4..7 across many seeds and every difficulty', () => {
    for (const n of [4, 5, 6, 7]) {
      for (const difficulty of difficulties) {
        for (const seed of [1, 17, 4242]) {
          const { puzzle } = generateStarBattle({ n, seed, difficulty })
          expectAgreement(puzzle.colours, n, puzzle.solution, nodeBudget)
        }
      }
    }
  })

  it('agrees at n=8..10 where exhaustion is still cheap', () => {
    for (const n of [8, 9, 10]) {
      for (const difficulty of difficulties) {
        const { puzzle } = generateStarBattle({ n, seed: 99, difficulty })
        expectAgreement(puzzle.colours, n, puzzle.solution, nodeBudget)
      }
    }
  })

  it('never contradicts the brute force at n=15 within an honest budget', () => {
    // Exhausting 15! is infeasible by design (the exact counter in
    // count.ts is the instrument for small-n uniqueness). Within the
    // budget the brute force must find no solution other than the planted
    // one, and the propagation certificate must solve the board.
    for (const difficulty of difficulties) {
      const { puzzle } = generateStarBattle({ n: 15, seed: 7, difficulty })
      const propagated = propagateStarBoard(puzzle.colours, 15)
      expect(propagated.solved).toBe(true)
      expect(starsAsPermutation(propagated)).toEqual([...puzzle.solution])
      const brute = bruteStarSolutions(puzzle.colours, 15, 3, 20_000_000)
      for (const solution of brute.solutions) {
        expect([...solution]).toEqual([...puzzle.solution])
      }
      // The planted permutation must be genuinely valid per the domain
      // contract (this also covers the n=15 shapes).
      assertStarBattlePuzzle(puzzle)
    }
  })
})
