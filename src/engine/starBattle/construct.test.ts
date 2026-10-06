/**
 * Tests for the constructive generator: the validity-rule invariant
 * pinned by brute force over generated boards, exact-uniqueness
 * cross-checks against the small-n exact counter, determinism, the
 * never-fails contract, and the measured wave distribution per tier.
 */
import { describe, expect, it } from 'vitest'
import {
  MAX_STAR_SIDE,
  MIN_STAR_SIDE,
  assertStarBattlePuzzle,
  assertStarBattleSide,
} from '../../domain/starBattle'
import { countStarSolutions } from './count'
import {
  STAR_DIFFICULTIES,
  admissibleStarPermutation,
  generateStarBattle,
  type StarDifficulty,
} from './construct'
import { propagateStarBoard } from './propagate'

const DIFFICULTIES = STAR_DIFFICULTIES

describe('admissibleStarPermutation', () => {
  it('returns an admissible permutation for every supported side', () => {
    for (let n = MIN_STAR_SIDE; n <= MAX_STAR_SIDE; n += 1) {
      for (const seed of [1, 42]) {
        // A locally-seeded LCG is fine for a structural property test; the
        // production path's determinism is pinned separately below.
        let state = (seed * 2654435761) >>> 0
        const rand = () => {
          state = (Math.imul(state, 1664525) + 1013904223) >>> 0
          return state / 0x100000000
        }
        const permutation = admissibleStarPermutation(n, {
          seed,
          nextUint32: () => Math.floor(rand() * 0x100000000),
          nextFloat: rand,
          nextInt: (maxExclusive: number) => Math.floor(rand() * maxExclusive),
          restart() {
            return this
          },
          derive() {
            return this
          },
        })
        expect(permutation).toHaveLength(n)
        expect([...permutation].sort((a, b) => a - b)).toEqual(
          Array.from({ length: n }, (_, index) => index),
        )
        for (let row = 0; row + 1 < n; row += 1) {
          expect(Math.abs(permutation[row] - permutation[row + 1])).toBeGreaterThanOrEqual(2)
        }
      }
    }
  })

  it('rejects sides below the supported range instead of looping forever', () => {
    let state = 1
    const rand = () => {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0
      return state / 0x100000000
    }
    const rng = {
      seed: 1,
      nextUint32: () => Math.floor(rand() * 0x100000000),
      nextFloat: rand,
      nextInt: (maxExclusive: number) => Math.floor(rand() * maxExclusive),
      restart() {
        return this
      },
      derive() {
        return this
      },
    }
    expect(() => admissibleStarPermutation(3, rng)).toThrow(RangeError)
  })
})

describe('generateStarBattle validity rule', () => {
  it('every decoy of every generated board satisfies the validity rule', () => {
    for (const n of [4, 6, 9, 13]) {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of [1, 2, 3]) {
          const { puzzle } = generateStarBattle({ n, seed, difficulty })
          assertStarBattlePuzzle(puzzle)
          const { colours, solution } = puzzle
          // Recover the proof order from the painting: the star of row r
          // carries colour pos[r].
          const pos = solution.map((column, row) => colours[row * n + column])
          expect([...pos].sort((a, b) => a - b)).toEqual(
            Array.from({ length: n }, (_, index) => index),
          )
          const rowOfColumn = new Int16Array(n)
          for (let row = 0; row < n; row += 1) {
            rowOfColumn[solution[row]] = row
          }
          for (let row = 0; row < n; row += 1) {
            for (let column = 0; column < n; column += 1) {
              const region = colours[row * n + column]
              if (column === solution[row]) {
                continue
              }
              const otherRow = rowOfColumn[column]
              // k >= min(pos[r], pos[s]) + 1, i.e. the cell is blankable
              // by whichever of its row's or column's star lands first.
              expect(region).toBeGreaterThanOrEqual(Math.min(pos[row], pos[otherRow]) + 1)
              expect(region).toBeLessThanOrEqual(n - 1)
            }
          }
          // No star is blankable at its own step: two stars are never
          // within Chebyshev distance 1 (admissibility on the permutation).
          for (let a = 0; a < n; a += 1) {
            for (let b = a + 1; b < n; b += 1) {
              const near = Math.abs(a - b) <= 1 && Math.abs(solution[a] - solution[b]) <= 1
              expect(near).toBe(false)
            }
          }
        }
      }
    }
  })
})

describe('generateStarBattle uniqueness cross-check (exact counter, small n)', () => {
  it('countStarSolutions(colours, n, 2) === 1 for n=4..10 across difficulties', () => {
    for (let n = MIN_STAR_SIDE; n <= 10; n += 1) {
      for (const difficulty of DIFFICULTIES) {
        for (const seed of [7, 99]) {
          const { puzzle } = generateStarBattle({ n, seed, difficulty })
          // The exact counter is the independent instrument here; its
          // exponential cost on deep boards is exactly why the small-n
          // bound exists and why production acceptance uses propagation.
          expect(countStarSolutions(puzzle.colours, n, 2)).toBe(1)
        }
      }
    }
  })
})

describe('generateStarBattle determinism', () => {
  it('same (n, seed, difficulty) yields byte-identical boards', () => {
    for (const difficulty of DIFFICULTIES) {
      const first = generateStarBattle({ n: 9, seed: 1234, difficulty })
      const second = generateStarBattle({ n: 9, seed: 1234, difficulty })
      expect(second.puzzle.colours).toEqual(first.puzzle.colours)
      expect(second.puzzle.colours).not.toBe(first.puzzle.colours) // fresh bytes, equal values
      expect(second.puzzle.solution).toEqual(first.puzzle.solution)
      expect(second.puzzle.seed).toBe(first.puzzle.seed)
      expect(second.waves).toBe(first.waves)
    }
  })

  it('different seeds yield different boards', () => {
    for (const difficulty of DIFFICULTIES) {
      const a = generateStarBattle({ n: 8, seed: 1, difficulty })
      const b = generateStarBattle({ n: 8, seed: 2, difficulty })
      expect(Array.from(a.puzzle.colours)).not.toEqual(Array.from(b.puzzle.colours))
    }
  })

  it('normalises the seed onto the puzzle', () => {
    const { puzzle } = generateStarBattle({ n: 5, seed: 0x1_0000_0007, difficulty: 'starter' })
    expect(puzzle.seed).toBe(0x1_0000_0007 >>> 0)
  })
})

describe('generateStarBattle never fails and lands the difficulty bands', () => {
  it('generates every (n, difficulty, seed) without throwing, all certified', () => {
    const distribution: Record<string, number[]> = {}
    for (let n = MIN_STAR_SIDE; n <= MAX_STAR_SIDE; n += 1) {
      for (const difficulty of DIFFICULTIES) {
        const waves: number[] = []
        for (const seed of [11, 2222, 333333]) {
          const board = generateStarBattle({ n, seed, difficulty })
          // The certificate ran inside the generator; re-running it here
          // pins the contract that waves travels with the board.
          const result = propagateStarBoard(board.puzzle.colours, n)
          expect(result.solved).toBe(true)
          expect(result.waves).toBe(board.waves)
          expect(result.stars.map(([, column]) => column)).toEqual([...board.puzzle.solution])
          assertStarBattlePuzzle(board.puzzle)
          waves.push(board.waves)
        }
        distribution[`n=${n} ${difficulty}`] = waves
        // Evidence-based bands, measured 2026-10-07 (frozen-state wave
        // semantics): starter 3..5, steady ~n..2n, challenging ~1.6n..2n.
        // Loose bounds that MUST hold for every supported side, so a
        // painting change that shifts the distribution fails here.
        if (difficulty === 'starter') {
          for (const w of waves) {
            expect(w).toBeGreaterThanOrEqual(3)
            expect(w).toBeLessThanOrEqual(5)
          }
        }
        if (difficulty === 'steady') {
          for (const w of waves) {
            expect(w).toBeGreaterThanOrEqual(4)
            expect(w).toBeLessThanOrEqual(2 * n + 2)
          }
        }
        if (difficulty === 'challenging') {
          for (const w of waves) {
            expect(w).toBeGreaterThanOrEqual(Math.min(5, n + 1))
            expect(w).toBeLessThanOrEqual(2 * n + 4)
          }
        }
      }
    }
    console.table(
      Object.fromEntries(
        Object.entries(distribution).map(([key, waves]) => [key, waves.join(' / ')]),
      ),
    )
  })

  it('orders the tiers by measured depth at larger sides', () => {
    // Per fixed seed, deeper tiers must not collapse below the shallow
    // band's floor at sides where the bands are well separated. Determined
    // by fixed seeds, so these are exact expectations, not probabilities.
    for (const n of [10, 13, 15]) {
      const starter = generateStarBattle({ n, seed: 5, difficulty: 'starter' }).waves
      const steady = generateStarBattle({ n, seed: 5, difficulty: 'steady' }).waves
      const challenging = generateStarBattle({ n, seed: 5, difficulty: 'challenging' }).waves
      expect(starter).toBeLessThanOrEqual(5)
      expect(steady).toBeGreaterThan(starter)
      expect(challenging).toBeGreaterThanOrEqual(steady)
    }
  })
})

describe('generateStarBattle wall-clock', () => {
  it('generates n=10, 13 and 15 quickly even at the hardest tier', () => {
    const timings: string[] = []
    for (const n of [10, 13, 15]) {
      const started = performance.now()
      generateStarBattle({ n, seed: 20261007, difficulty: 'challenging' })
      const elapsed = performance.now() - started
      timings.push(`n=${n}: ${elapsed.toFixed(1)}ms`)
      // Generous ceiling: the construction is O(attempts * n^3) and the
      // measured cost is two orders of magnitude under this.
      expect(elapsed).toBeLessThan(2000)
    }
    console.log(`generateStarBattle wall-clock — ${timings.join(', ')}`)
  })
})

describe('generateStarBattle input validation', () => {
  it('asserts the side and rejects unknown difficulties', () => {
    expect(() => generateStarBattle({ n: MIN_STAR_SIDE - 1, seed: 1, difficulty: 'starter' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: MAX_STAR_SIDE + 1, seed: 1, difficulty: 'starter' })).toThrow(RangeError)
    expect(() =>
      generateStarBattle({ n: 5, seed: 1, difficulty: 'impossible' as StarDifficulty }),
    ).toThrow(TypeError)
    expect(() => assertStarBattleSide(4.5)).toThrow(TypeError)
  })
})
