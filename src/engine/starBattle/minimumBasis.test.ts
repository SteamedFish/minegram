/**
 * Tests for the minimum-basis measurement (`./minimumBasis.ts`).
 *
 * The fixtures below are committed ground truth, not values the
 * implementation under test printed: each fixture's expectation was derived
 * independently, subset by subset, from the deduction semantics in
 * `catalogue.ts` (frozen-state waves, soundness, stall-means-nothing), and
 * the k = -1 fixture pins the full 16-subset stall table measured by hand.
 * Two fixtures double as the demonstration of why this module exists:
 * `fingerprintStarCatalogue` (leave-one-out over the full set) answers a
 * different question and is asserted here to DISAGREE with the minimum
 * basis in exactly the predicted direction.
 */
import { describe, expect, it } from 'vitest'
import { fingerprintStarCatalogue, solveStarCatalogue } from './catalogue'
import { countStarSolutions } from './count'
import { measureMinimumBasis } from './minimumBasis'

/**
 * k = 0 fixture: the n = 4 starter construction (singleton regions 0..2,
 * region 3 the sea), hand-traced:
 *
 *     row 0: 3 0 3 3     star (0,1) — region 0 singleton
 *     row 1: 3 3 3 1     star (1,3) — region 1 singleton
 *     row 2: 2 3 3 3     star (2,0) — region 2 singleton
 *     row 3: 3 3 3 3     star (3,2) — sea
 *
 * Base rules place every star by hidden singles alone (each singleton
 * region forces its only cell; the sea collapses once the three exclusions
 * land), so no confinement rule is needed: k = 0. The wave count (3) is
 * the starter tier's documented collapse depth at every side.
 */
const K0_COLOURS = new Uint8Array([3, 0, 3, 3, 3, 3, 3, 1, 2, 3, 3, 3, 3, 3, 3, 3])
const K0_SOLUTION = [1, 3, 0, 2]

/**
 * k = 1 fixture: n = 4 board found in the seeded walk stream (the class
 * the human's n = 10 board defines, at a hand-checkable size). Hand-run
 * subset table:
 *
 *     (none) stalls | c1 SOLVES | c2 SOLVES | c3 SOLVES | c4 SOLVES
 *
 * Every single confinement rule suffices with base, so k = 1. The witness
 * must be ['c1'] — canonical enumeration order picks the first subset of
 * the minimal size, and c1 is tried first. This fixture is the trap
 * demonstration: the leave-one-out fingerprint below is EMPTY (removing
 * any one rule leaves the other three, which still solve), while the
 * minimum basis is genuinely 1.
 */
const K1_COLOURS = new Uint8Array([1, 1, 0, 0, 1, 3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 3])

/**
 * k = 2 fixture: n = 4 board from the same search, hand-run subset table:
 *
 *     (none) stalls | c1 stalls | c2 stalls | c3 stalls | c4 stalls
 *     c1+c2 stalls | c1+c3 stalls | c1+c4 SOLVES
 *
 * No single rule suffices (so k ≠ 1) and the first solving pair in
 * canonical order is c1+c4: witness ['c1','c4']. Mirrors the human
 * reference board (n = 10, minBasis 2, witness c2+c3) at a size where the
 * table can be checked by hand.
 */
const K2_COLOURS = new Uint8Array([2, 0, 0, 1, 2, 2, 3, 1, 2, 3, 3, 1, 2, 2, 3, 3])

/**
 * k = -1 fixture: n = 10 board from the seeded walk stream (walk seed
 * 24757, steady seed board) — the "requires contradiction" class. Hand-run
 * table of ALL 16 subsets (base + subset, depth 0), each entry the stall
 * point (stars placed / 10):
 *
 *     (none) 0 | c1 2 | c2 4 | c1+c2 4 | c3 2 | c1+c3 2 | c2+c3 5 | c1+c2+c3 5
 *     c4 2 | c1+c4 2 | c2+c4 5 | c1+c2+c4 5 | c3+c4 2 | c1+c3+c4 2
 *     c2+c3+c4 5 | c1+c2+c3+c4 5
 *
 * No confinement subset solves; the deepest attempt places 5/10 in 4
 * waves. csDepth:1 solves in 6 waves with a single case-split pass (13
 * trials) — the board is solvable, it simply requires contradiction — and
 * the independent exact counter agrees the solution is unique. This is the
 * measured class of the second human reference board (n = 9).
 */
const KMINUS1_COLOURS = new Uint8Array([
  1, 1, 1, 1, 1, 1, 1, 9, 0, 0, 1, 9, 9, 9, 9, 9, 9, 9, 2, 9, 1, 9, 3, 3, 3, 3, 3, 9, 2, 9,
  1, 3, 3, 5, 4, 3, 3, 9, 9, 9, 1, 9, 3, 5, 4, 4, 9, 9, 9, 9, 9, 9, 9, 5, 5, 6, 6, 6, 9, 9,
  9, 7, 7, 7, 8, 6, 6, 9, 9, 9, 9, 7, 9, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 8, 8, 9, 9,
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
])
const KMINUS1_SOLUTION = [9, 0, 8, 2, 5, 3, 6, 1, 7, 4]
/** Hand-run stall table: subset bitmask (bit i = rule i of c1..c4) → stars placed. */
const KMINUS1_STALL_TABLE: ReadonlyMap<number, number> = new Map([
  [0b0000, 0],
  [0b0001, 2],
  [0b0010, 4],
  [0b0100, 2],
  [0b1000, 2],
  [0b0011, 4],
  [0b0101, 2],
  [0b1001, 2],
  [0b0110, 5],
  [0b1010, 5],
  [0b1100, 2],
  [0b0111, 5],
  [0b1011, 5],
  [0b1101, 2],
  [0b1110, 5],
  [0b1111, 5],
])

describe('measureMinimumBasis hand-computed fixtures', () => {
  it('k = 0: base rules alone solve the starter board; no witness', () => {
    const basis = measureMinimumBasis(K0_COLOURS, 4)
    expect(basis.k).toBe(0)
    expect(basis.rules).toEqual([])
    expect(basis.placed).toBe(4)
    expect(basis.waves).toBe(3)
    // The fixture really is the claimed solution.
    for (let row = 0; row < 4; row += 1) {
      expect(K0_COLOURS[row * 4 + K0_SOLUTION[row]]).toBe(row)
    }
  })

  it('k = 1: every single rule suffices; the witness is the canonical first, c1', () => {
    const basis = measureMinimumBasis(K1_COLOURS, 4)
    expect(basis.k).toBe(1)
    expect(basis.rules).toEqual(['c1'])
    expect(basis.placed).toBe(4)
    expect(basis.waves).toBe(5)
    // Hand-run table: each single rule solves with base.
    for (const rule of ['c1', 'c2', 'c3', 'c4'] as const) {
      expect(
        solveStarCatalogue(K1_COLOURS, 4, { rules: ['base', rule], csDepth: 0 }).solved,
      ).toBe(true)
    }
  })

  it('k = 1 fixture exposes the fingerprint trap: leave-one-out reports EMPTY', () => {
    // The whole point of the module: the fingerprint says "no rule is
    // load-bearing" (any one removal still solves, because another single
    // rule suffices), while the minimum basis is genuinely 1. A difficulty
    // grader built on the fingerprint would call this a base-solvable
    // board; it is not.
    const fingerprint = fingerprintStarCatalogue(K1_COLOURS, 4)
    expect(fingerprint).not.toBeNull()
    expect([...(fingerprint as ReadonlySet<string>)]).toEqual([])
    expect(measureMinimumBasis(K1_COLOURS, 4).k).toBe(1)
  })

  it('k = 2: no single rule suffices; first solving pair in canonical order is c1+c4', () => {
    const basis = measureMinimumBasis(K2_COLOURS, 4)
    expect(basis.k).toBe(2)
    expect(basis.rules).toEqual(['c1', 'c4'])
    expect(basis.placed).toBe(4)
    expect(basis.waves).toBe(5)
    // Hand-run table: all four singles stall...
    for (const rule of ['c1', 'c2', 'c3', 'c4'] as const) {
      expect(
        solveStarCatalogue(K2_COLOURS, 4, { rules: ['base', rule], csDepth: 0 }).solved,
      ).toBe(false)
    }
    // ...and the two pairs canonically before c1+c4 stall as well, so the
    // witness is not an artefact of enumeration luck.
    for (const subset of [['c1', 'c2'], ['c1', 'c3']] as const) {
      expect(
        solveStarCatalogue(K2_COLOURS, 4, { rules: ['base', ...subset], csDepth: 0 }).solved,
      ).toBe(false)
    }
  })

  it('k = -1: no confinement subset solves; the documented reading, not an error', () => {
    const basis = measureMinimumBasis(KMINUS1_COLOURS, 10)
    expect(basis.k).toBe(-1)
    expect(basis.rules).toEqual([])
    expect(basis.placed).toBe(5)
    expect(basis.waves).toBe(4)
    // The full hand-run stall table, subset by subset.
    const rules = ['c1', 'c2', 'c3', 'c4'] as const
    for (let mask = 0; mask < 16; mask += 1) {
      const subset = rules.filter((_, bit) => (mask & (1 << bit)) !== 0)
      const attempt = solveStarCatalogue(KMINUS1_COLOURS, 10, {
        rules: ['base', ...subset],
        csDepth: 0,
      })
      expect(attempt.solved).toBe(false)
      expect(attempt.placed).toBe(KMINUS1_STALL_TABLE.get(mask))
    }
  })

  it('k = -1 fixture still carries its certificates: contradiction solves it, the counter agrees it is unique', () => {
    // The k = -1 reading is "requires contradiction", so the fixture must
    // actually be solvable that way...
    const contradiction = solveStarCatalogue(KMINUS1_COLOURS, 10, { csDepth: 1 })
    expect(contradiction.solved).toBe(true)
    expect(contradiction.waves).toBe(6)
    expect(contradiction.csPasses).toBe(1)
    // ...and the independent exact counter must agree there is exactly one
    // solution, matching the planted one.
    expect(countStarSolutions(KMINUS1_COLOURS, 10, 3)).toBe(1)
    expect(contradiction.stars.map(([, column]) => column)).toEqual(KMINUS1_SOLUTION)
  })
})

describe('measureMinimumBasis contract', () => {
  it('is deterministic and does not mutate its input', () => {
    const snapshot = K2_COLOURS.slice()
    const first = measureMinimumBasis(K2_COLOURS, 4)
    const second = measureMinimumBasis(K2_COLOURS, 4)
    expect(second).toEqual(first)
    expect([...K2_COLOURS]).toEqual([...snapshot])
  })

  it('validates its input with the domain asserts', () => {
    expect(() => measureMinimumBasis(new Uint8Array(3), 4)).toThrow(RangeError)
    expect(() => measureMinimumBasis(K0_COLOURS, 3)).toThrow(RangeError)
    expect(() => measureMinimumBasis(K0_COLOURS, 4.5)).toThrow(TypeError)
  })

  it('k is minimal: never reports a size-2 basis when a size-1 rule solves', () => {
    // Cross-check every fixture against a brute-force independent
    // re-enumeration written inline here (not calling the module): for
    // each size, does ANY subset solve?
    const fixtures: ReadonlyArray<readonly [Uint8Array, number, number]> = [
      [K0_COLOURS, 4, 0],
      [K1_COLOURS, 4, 1],
      [K2_COLOURS, 4, 2],
      [KMINUS1_COLOURS, 10, -1],
    ]
    for (const [colours, n, expected] of fixtures) {
      let minimal = -1
      const base = solveStarCatalogue(colours, n, { rules: ['base'], csDepth: 0 })
      if (base.solved) {
        minimal = 0
      } else {
        outer: for (let size = 1; size <= 4; size += 1) {
          for (let mask = 1; mask < 16; mask += 1) {
            let bits = 0
            for (let b = 0; b < 4; b += 1) {
              if ((mask & (1 << b)) !== 0) {
                bits += 1
              }
            }
            if (bits !== size) {
              continue
            }
            const subset = (['c1', 'c2', 'c3', 'c4'] as const).filter(
              (_, bit) => (mask & (1 << bit)) !== 0,
            )
            if (
              solveStarCatalogue(colours, n, { rules: ['base', ...subset], csDepth: 0 }).solved
            ) {
              minimal = size
              break outer
            }
          }
        }
      }
      expect(minimal).toBe(expected)
      expect(measureMinimumBasis(colours, n).k).toBe(expected)
    }
  })
})
