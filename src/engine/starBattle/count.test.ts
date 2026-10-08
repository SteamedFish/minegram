/**
 * Tests for the exact Star Battle solution counter. The cross-check oracle is
 * a fully independent brute force written INSIDE this file: plain recursion
 * over column swaps with array-based membership tests — no bitmasks, no memo,
 * no shared code with the implementation. Agreement between two searches that
 * share no machinery is the point.
 */
import { describe, expect, it } from 'vitest'
import { MAX_STAR_SIDE, MIN_STAR_SIDE } from '../../domain/starBattle'
import { createSeededRandom } from '../rng'
import { admissibleStarPermutation } from './sample'
import {
  DEFAULT_STAR_COUNT_CAP,
  countStarSolutions,
  countStarSolutionsWithBudget,
  findStarSolutions,
} from './count'

/**
 * Independent oracle: enumerates every permutation of columns via swap
 * recursion and tests the constraints directly against the colour grid.
 */
function bruteForceSolutions(colours: Uint8Array, n: number): number[][] {
  const perm = Array.from({ length: n }, (_, index) => index)
  const out: number[][] = []
  const check = (): void => {
    const colourSeen = new Set<number>()
    for (let row = 0; row < n; row += 1) {
      if (row > 0 && Math.abs(perm[row] - perm[row - 1]) < 2) {
        return
      }
      const colour = colours[row * n + perm[row]]
      if (colourSeen.has(colour)) {
        return
      }
      colourSeen.add(colour)
    }
    out.push([...perm])
  }
  const recurse = (depth: number): void => {
    if (depth === n) {
      check()
      return
    }
    for (let index = depth; index < n; index += 1) {
      const swap = perm[depth]
      perm[depth] = perm[index]
      perm[index] = swap
      recurse(depth + 1)
      perm[index] = perm[depth]
      perm[depth] = swap
    }
  }
  recurse(0)
  return out
}

/** Deterministic LCG so the cross-check sweep needs no RNG import. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 0x100000000
  }
}

function randomColouring(n: number, rand: () => number): Uint8Array {
  const colours = new Uint8Array(n * n)
  for (let index = 0; index < colours.length; index += 1) {
    colours[index] = Math.floor(rand() * n)
  }
  return colours
}

describe('countStarSolutions', () => {
  it('pins the default cap a uniqueness proof asks for', () => {
    expect(DEFAULT_STAR_COUNT_CAP).toBe(2)
  })

  it('agrees with the independent brute force over many random colourings, n = 4..8', () => {
    for (let n = MIN_STAR_SIDE; n <= 8; n += 1) {
      const rand = makeRandom(0x5eed + n)
      for (let trial = 0; trial < 30; trial += 1) {
        const colours = randomColouring(n, rand)
        const expected = bruteForceSolutions(colours, n).length
        // Exact count: a cap above the true total proves the total.
        const exact = countStarSolutions(colours, n, expected + 1)
        expect(exact).toBe(expected)
        // Capped semantics: min(actual, cap).
        const capped = countStarSolutions(colours, n, 2)
        expect(capped).toBe(Math.min(expected, 2))
      }
    }
  })

  it('handles the n = 4 minimum side, including zero- and one-solution boards', () => {
    const many = new Uint8Array(16)
    many.fill(0)
    // All one colour: the colour rule leaves no solutions for n > 1.
    expect(countStarSolutions(many, 4, 2)).toBe(0)

    // A planted unique 4×4: stars at (0,1),(1,3),(2,0),(3,2) with distinct
    // star colours; filler cells reuse those colours under other rows/cols.
    const unique = new Uint8Array([
      0, 0, 1, 1, //
      1, 2, 2, 1, //
      2, 3, 0, 0, //
      3, 3, 3, 2,
    ])
    expect(countStarSolutions(unique, 4, 2)).toBe(1)

    const uniqueFound = findStarSolutions(unique, 4, 2)
    expect(uniqueFound).toEqual([[1, 3, 0, 2]])
  })

  it('pins the cap semantics: a saturated return proves "at least cap", never "exactly cap"', () => {
    // A board where the colour rule is automatically satisfied (colour =
    // column index), so every adjacency-legal permutation is a solution.
    // The independent oracle establishes the true count; the capped counter
    // must stop at the cap even though the true count is higher.
    const n = 5
    const colours = new Uint8Array(n * n)
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        colours[row * n + column] = column
      }
    }
    const trueCount = bruteForceSolutions(colours, n).length
    expect(trueCount).toBeGreaterThan(3)
    expect(countStarSolutions(colours, n, trueCount + 1)).toBe(trueCount)
    const capped = countStarSolutions(colours, n, 3)
    expect(capped).toBe(3)
  })

  it('counts at the maximum supported side', () => {
    const n = MAX_STAR_SIDE
    const rand = makeRandom(0xd15ea5e)
    // Plant a valid star permutation with distinct star colours. Uniqueness
    // is a DESIGNED property that random colourings essentially never have
    // (measured: 0/200 random plants unique at n = 9..13), so the honest
    // claims here are: the planted solution exists (count >= 1) and the
    // counter saturates honestly at the cap (count <= 2). The exhaust-every-
    // branch path is pinned separately by the 0-solution board below. The
    // planted permutation is drawn from the sampler's admissible-permutation
    // generator so the test stays correct at any MAX_STAR_SIDE.
    const solution = admissibleStarPermutation(n, createSeededRandom(0xd15ea5e))
    const starColour = Array.from({ length: n }, (_, index) => index)
    for (let index = n - 1; index > 0; index -= 1) {
      const pick = Math.floor(rand() * (index + 1))
      const swap = starColour[index]
      starColour[index] = starColour[pick]
      starColour[pick] = swap
    }
    const colours = new Uint8Array(n * n)
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        colours[row * n + column] =
          column === solution[row] ? starColour[row] : Math.floor(rand() * n)
      }
    }
    const count = countStarSolutions(colours, n, 2)
    expect(count).toBeGreaterThanOrEqual(1)
    expect(count).toBeLessThanOrEqual(2)
    // When collection completes (fewer than cap), every solution — the
    // planted one included — must be present. With hundreds of solutions the
    // collection is legitimately cut off at the cap, so no membership claim
    // is made there (that cutoff semantics is pinned at small n above).
    const found = findStarSolutions(colours, n, 1000)
    if (found.length < 1000) {
      expect(found.some((candidate) => candidate.join(',') === solution.join(','))).toBe(true)
    }

    // A 0-solution board at the maximum side proves the exhaust-every-branch
    // path also completes there.
    const impossible = new Uint8Array(n * n).fill(0)
    expect(countStarSolutions(impossible, n, 2)).toBe(0)
  })

  it('rejects out-of-range sides and malformed caps', () => {
    const colours = new Uint8Array(16)
    expect(() => countStarSolutions(colours, MIN_STAR_SIDE - 1)).toThrow(RangeError)
    expect(() => countStarSolutions(colours, MAX_STAR_SIDE + 1)).toThrow(RangeError)
    expect(() => countStarSolutions(new Uint8Array(15), 4)).toThrow(RangeError)
    expect(() => countStarSolutions(colours, 4, 0)).toThrow(TypeError)
    expect(() => countStarSolutions(colours, 4, 1.5)).toThrow(TypeError)
  })
})

describe('countStarSolutionsWithBudget', () => {
  it('returns a count indistinguishable from the unbudgeted counter when the budget suffices', () => {
    const rand = makeRandom(0xb0d9e7)
    for (let trial = 0; trial < 10; trial += 1) {
      const colours = randomColouring(6, rand)
      const result = countStarSolutionsWithBudget(colours, 6, 2, Number.POSITIVE_INFINITY)
      expect(result.status).toBe('count')
      if (result.status === 'count') {
        expect(result.count).toBe(countStarSolutions(colours, 6, 2))
      }
    }
  })

  it('reports limit-exhausted honestly when the budget runs out', () => {
    // Any non-trivial board with a 1-node budget exhausts immediately.
    const colours = new Uint8Array(16).fill(0)
    colours[5] = 1
    const result = countStarSolutionsWithBudget(colours, 4, 2, 1)
    expect(result.status).toBe('limit-exhausted')
    // The distinguishable shape: no `count` field exists to misread.
    expect('count' in result).toBe(false)
  })

  it('never reports limit-exhausted once the search completes within the budget', () => {
    const colours = new Uint8Array(16).fill(0)
    const result = countStarSolutionsWithBudget(colours, 4, 2, 10_000_000)
    expect(result).toEqual({ status: 'count', count: 0 })
  })

  it('rejects non-positive budgets', () => {
    const colours = new Uint8Array(16)
    expect(() => countStarSolutionsWithBudget(colours, 4, 2, 0)).toThrow(TypeError)
    expect(() => countStarSolutionsWithBudget(colours, 4, 2, -5)).toThrow(TypeError)
  })
})

describe('findStarSolutions', () => {
  it('returns up to cap distinct, fully valid solutions and all of them when fewer exist', () => {
    for (let n = MIN_STAR_SIDE; n <= 7; n += 1) {
      const rand = makeRandom(0xf17d + n)
      for (let trial = 0; trial < 10; trial += 1) {
        const colours = randomColouring(n, rand)
        const all = bruteForceSolutions(colours, n)
        const some = findStarSolutions(colours, n, 3)
        expect(some.length).toBe(Math.min(all.length, 3))
        const seen = new Set(some.map((solution) => solution.join(',')))
        expect(seen.size).toBe(some.length)
        // Every returned solution is one the independent oracle also found.
        const oracleKeys = new Set(all.map((solution) => solution.join(',')))
        for (const solution of some) {
          expect(oracleKeys.has(solution.join(','))).toBe(true)
        }
        // Asking for more than exists yields exactly the full set.
        const everything = findStarSolutions(colours, n, all.length + 1)
        expect(everything.length).toBe(all.length)
      }
    }
  })
})
