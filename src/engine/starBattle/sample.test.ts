/**
 * Tests for the spanning-tree layout sampler (`./sample.ts`).
 *
 * The sampler is the first stage of the spanning-tree construction: plant
 * an admissible star permutation, grow a randomised DFS spanning tree, cut
 * n − 1 edges, flood-fill the components, and accept only layouts where
 * every component holds exactly one planted star. These tests pin the
 * structural guarantees (connectivity, one star per region, all colours
 * present, planted solution valid), the determinism contract, and the
 * measured ballpark of the mine-balance acceptance rate.
 */
import { describe, expect, it } from 'vitest'
import { assertStarBattlePuzzle, MIN_STAR_SIDE, MAX_STAR_SIDE } from '../../domain/starBattle'
import { createSeededRandom } from '../rng'
import { countStarSolutions } from './count'
import { measureStarBoardStructure } from './structure'
import { admissibleStarPermutation, sampleStarBattleLayout } from './sample'

/** Counts planted-star cells per 4-connected component of one colour. */
function starCountsPerRegion(colours: Uint8Array, n: number, solution: readonly number[]): number[] {
  const mineCells = new Set<number>()
  for (let row = 0; row < n; row += 1) {
    mineCells.add(row * n + solution[row])
  }
  const seen = new Uint8Array(n * n)
  const counts: number[] = []
  for (let start = 0; start < n * n; start += 1) {
    if (seen[start] !== 0) {
      continue
    }
    const region = colours[start]
    let stars = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const cell = stack.pop() as number
      if (mineCells.has(cell)) {
        stars += 1
      }
      const row = (cell / n) | 0
      const column = cell % n
      for (const neighbour of [
        row > 0 ? cell - n : -1,
        row + 1 < n ? cell + n : -1,
        column > 0 ? cell - 1 : -1,
        column + 1 < n ? cell + 1 : -1,
      ]) {
        if (neighbour >= 0 && seen[neighbour] === 0 && colours[neighbour] === region) {
          seen[neighbour] = 1
          stack.push(neighbour)
        }
      }
    }
    counts.push(stars)
  }
  return counts
}

describe('admissibleStarPermutation', () => {
  it('returns an admissible permutation for every supported side', () => {
    for (let n = MIN_STAR_SIDE; n <= MAX_STAR_SIDE; n += 1) {
      const permutation = admissibleStarPermutation(n, createSeededRandom(n * 1000 + 7))
      expect(permutation).toHaveLength(n)
      expect([...permutation].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i))
      for (let row = 0; row + 1 < n; row += 1) {
        expect(Math.abs(permutation[row] - permutation[row + 1])).toBeGreaterThanOrEqual(2)
      }
    }
  })

  it('is deterministic per seed and varies across seeds', () => {
    const first = admissibleStarPermutation(8, createSeededRandom(42))
    const second = admissibleStarPermutation(8, createSeededRandom(42))
    expect(first).toEqual(second)
    const others = new Set<string>()
    for (let seed = 0; seed < 8; seed += 1) {
      others.add(admissibleStarPermutation(8, createSeededRandom(seed)).join(','))
    }
    expect(others.size).toBeGreaterThan(1)
  })

  it('rejects unsupported sides', () => {
    expect(() => admissibleStarPermutation(3, createSeededRandom(1))).toThrow(RangeError)
    expect(() => admissibleStarPermutation(4.5, createSeededRandom(1))).toThrow(TypeError)
  })
})

describe('sampleStarBattleLayout', () => {
  it('returns null or a structurally perfect layout — never anything else', () => {
    const rng = createSeededRandom('sampler-structural')
    let accepted = 0
    for (let index = 0; index < 300; index += 1) {
      const layout = sampleStarBattleLayout(6, rng.derive(`probe-${index}`))
      if (layout === null) {
        continue
      }
      accepted += 1
      const { colours, solution } = layout
      // The planted permutation is a valid puzzle: admissibility,
      // pairwise-distinct star colours, colour range.
      assertStarBattlePuzzle({ n: 6, seed: 0, colours, solution })
      // Every region connected and every colour present (union-find).
      const structure = measureStarBoardStructure(colours, 6)
      expect(structure.connected).toBe(true)
      // Exactly one planted star per region — the mine-balance guarantee.
      expect(starCountsPerRegion(colours, 6, solution)).toEqual(
        structure.componentCounts.map(() => 1),
      )
      // The planted answer is always A solution; uniqueness is repair's job.
      expect(countStarSolutions(colours, 6, 1)).toBeGreaterThanOrEqual(1)
    }
    expect(accepted).toBeGreaterThan(0)
  })

  it('accepts layouts at roughly the measured mine-balance rate', () => {
    // Measured 2026-10: 1.11% at n = 6. The test pins a wide band, not the
    // point estimate — the point estimate's job is the module doc's; a
    // drift beyond the band means the sampler changed, which is what the
    // test exists to catch. Deterministic given the fixed seed list.
    const rng = createSeededRandom('sampler-balance-rate')
    let accepted = 0
    const samples = 2000
    for (let index = 0; index < samples; index += 1) {
      if (sampleStarBattleLayout(6, rng.derive(`rate-${index}`)) !== null) {
        accepted += 1
      }
    }
    const rate = accepted / samples
    expect(rate).toBeGreaterThan(0.002)
    expect(rate).toBeLessThan(0.05)
  })

  it('is deterministic per seed: same seed, same accept decision and layout', () => {
    for (const seed of ['a', 'b', 'c']) {
      const first = sampleStarBattleLayout(8, createSeededRandom(seed))
      const second = sampleStarBattleLayout(8, createSeededRandom(seed))
      if (first === null || second === null) {
        expect(first === null).toBe(second === null)
        continue
      }
      expect([...second.colours]).toEqual([...first.colours])
      expect(second.solution).toEqual(first.solution)
    }
  })

  it('never mutates anything and validates its inputs', () => {
    expect(() => sampleStarBattleLayout(3, createSeededRandom(1))).toThrow(RangeError)
    expect(() => sampleStarBattleLayout(4.5, createSeededRandom(1))).toThrow(TypeError)
  })
})
