/**
 * Tests for the minimum-basis measurement (`./minimumBasis.ts`).
 *
 * The fixtures below are committed ground truth. Where a pinned number
 * changed with the 2026-10-07 matching engine (Hall/matching confinement
 * replacing the oracle's capped unionClosure zones), the change is
 * re-derived, not re-recorded: the subset tables are re-run by the tests
 * themselves, the load-bearing properties (which subsets solve, that no
 * subset solves the k = -1 board, that contradiction solves it, that the
 * independent exact counter agrees it is unique) are asserted independently
 * of the values that moved, and the direction of every move is explained by
 * the engine change — matching derives strictly more sound deductions per
 * wave than the capped zone generator, so solves need no more waves and
 * stall points land no earlier. Two fixtures double as the demonstration of
 * why this module exists: `fingerprintStarCatalogue` (leave-one-out over
 * ideas) answers a different question and is asserted here to DISAGREE with
 * the minimum basis in exactly the predicted direction.
 */
import { describe, expect, it } from 'vitest'
import { fingerprintStarCatalogue, solveStarCatalogue } from './catalogue'
import { countStarSolutions } from './count'
import {
  HAND_K0_COLOURS,
  HAND_K1_COLOURS,
  HAND_K2_COLOURS,
  HAND_KMINUS1_COLOURS,
} from './fixtures/handBoards'
import { measureMinimumBasis } from './minimumBasis'

/**
 * The fixtures live in `./fixtures/handBoards.ts` so the signature and
 * firstStarWave test lanes pin against the SAME arrays; each narrative
 * below describes the board at its new shared name (the `HAND_` prefix is
 * the only change).
 */
const K0_COLOURS = HAND_K0_COLOURS
const K0_SOLUTION = [1, 3, 0, 2]

/**
 * k = 1 fixture: n = 4 board found in the seeded walk stream (the class
 * the human's n = 10 board defines, at a hand-checkable size). Subset
 * table under the matching engine:
 *
 *     (none) stalls | c1 SOLVES | c2 SOLVES | c3 SOLVES | c4 SOLVES
 *
 * Every single confinement rule suffices with base, so k = 1. The witness
 * must be ['c1'] — canonical enumeration order picks the first subset of
 * the minimal size, and c1 is tried first. The matching engine solves the
 * confinement witnesses in 4 waves where the capped zone engine needed 5:
 * matching prunes disallowed colour-line edges the zone generator never
 * derived, so the cascade shortens — the expected direction of the change.
 * This fixture is the trap demonstration: the leave-one-out fingerprint
 * below is EMPTY (removing any one idea leaves the others, which still
 * solve), while the minimum basis is genuinely 1.
 */
const K1_COLOURS = HAND_K1_COLOURS

/**
 * k = 2 fixture: n = 4 board from the same search. Subset table under the
 * matching engine:
 *
 *     (none) stalls | c1 stalls | c2 stalls | c3 stalls | c4 stalls
 *     c1+c2 stalls | c1+c3 stalls | c2+c3 stalls | c3+c4 stalls
 *     c1+c4 SOLVES | c2+c4 SOLVES
 *
 * No single rule suffices (so k ≠ 1) and every pair canonically before
 * c1+c4 stalls, so the first solving pair in canonical order is c1+c4:
 * witness ['c1','c4']. Mirrors the human reference board (n = 10,
 * minBasis 2) at a size where the table can be checked by hand. Under the
 * matching engine the witness solve takes 4 waves (the capped zone engine
 * needed 5): matching derives strictly more per wave, so cascades shorten.
 */
const K2_COLOURS = HAND_K2_COLOURS

/**
 * k = -1 fixture: n = 10 board from the seeded walk stream (walk seed
 * 24757, steady seed board) — the "requires contradiction" class. Stall
 * table of ALL 16 subsets (base + subset, depth 0) under the matching
 * engine, each entry the stall point (stars placed / 10):
 *
 *     (none) 0 | c1 4 | c2 4 | c1+c2 4 | c3 2 | c1+c3 5 | c2+c3 5 | c1+c2+c3 5
 *     c4 2 | c1+c4 5 | c2+c4 5 | c1+c2+c4 5 | c3+c4 2 | c1+c3+c4 5
 *     c2+c3+c4 5 | c1+c2+c3+c4 5
 *
 * No confinement subset solves — matching's stronger deductions move the
 * stall points (the zone engine placed 2 with c1 alone; matching places 4)
 * but no subset crosses into solving: this board is NOT one of the j ≥ 4
 * confinement boards the cap misfiled, it genuinely needs contradiction.
 * csDepth:1 solves in 5 waves with a single case-split pass (13 trials),
 * and the independent exact counter agrees the solution is unique. This is
 * the measured class of the second human reference board (n = 9).
 */
const KMINUS1_COLOURS = HAND_KMINUS1_COLOURS
const KMINUS1_SOLUTION = [9, 0, 8, 2, 5, 3, 6, 1, 7, 4]
/** Stall table under the matching engine: subset bitmask (bit i = rule i of c1..c4) → stars placed. */
const KMINUS1_STALL_TABLE: ReadonlyMap<number, number> = new Map([
  [0b0000, 0],
  [0b0001, 4],
  [0b0010, 4],
  [0b0100, 2],
  [0b1000, 2],
  [0b0011, 4],
  [0b0101, 5],
  [0b1001, 5],
  [0b0110, 5],
  [0b1010, 5],
  [0b1100, 2],
  [0b0111, 5],
  [0b1011, 5],
  [0b1101, 5],
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
    expect(basis.waves).toBe(4)
    // Hand-run table: each single rule solves with base.
    for (const rule of ['c1', 'c2', 'c3', 'c4'] as const) {
      expect(
        solveStarCatalogue(K1_COLOURS, 4, { rules: ['base', rule], csDepth: 0 }).solved,
      ).toBe(true)
    }
  })

  it('k = 1 fixture exposes the fingerprint trap: leave-one-out reports EMPTY', () => {
    // The whole point of the module: the fingerprint says "no idea is
    // load-bearing" (remove line confinement and box/shadow still solve;
    // remove box or shadow and line confinement still solves), while the
    // minimum basis is genuinely 1. A difficulty grader built on the
    // fingerprint would call this a base-solvable board; it is not.
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
    expect(basis.waves).toBe(4)
    // Hand-run table: all four singles stall...
    for (const rule of ['c1', 'c2', 'c3', 'c4'] as const) {
      expect(
        solveStarCatalogue(K2_COLOURS, 4, { rules: ['base', rule], csDepth: 0 }).solved,
      ).toBe(false)
    }
    // ...and every pair canonically before c1+c4 stalls as well, so the
    // witness is not an artefact of enumeration luck.
    for (const subset of [['c1', 'c2'], ['c1', 'c3'], ['c2', 'c3'], ['c3', 'c4']] as const) {
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
    expect(basis.waves).toBe(3)
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
    expect(contradiction.waves).toBe(5)
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

  it('k counts IDEAS: c1 and c2 collapse to one confinement idea', () => {
    // Defect-1 pin: the module's k is the minimal number of distinct
    // technique IDEAS over all solving subsets — line confinement (c1 or
    // c2) is one idea no matter which ids name it. Cross-checked against a
    // brute-force independent re-enumeration written inline here (not
    // calling the module).
    const fixtures: ReadonlyArray<readonly [Uint8Array, number, number]> = [
      [K0_COLOURS, 4, 0],
      [K1_COLOURS, 4, 1],
      [K2_COLOURS, 4, 2],
      [KMINUS1_COLOURS, 10, -1],
    ]
    for (const [colours, n, expected] of fixtures) {
      // Cross-check every fixture against a brute-force independent
      // re-enumeration written inline here (not calling the module):
      // minimal IDEA count over all solving subsets.
      let minimal = -1
      const base = solveStarCatalogue(colours, n, { rules: ['base'], csDepth: 0 })
      if (base.solved) {
        minimal = 0
      } else {
        for (let mask = 1; mask < 16; mask += 1) {
          const subset = (['c1', 'c2', 'c3', 'c4'] as const).filter(
            (_, bit) => (mask & (1 << bit)) !== 0,
          )
          if (
            solveStarCatalogue(colours, n, { rules: ['base', ...subset], csDepth: 0 }).solved
          ) {
            let ideas = 0
            if ((mask & 0b0011) !== 0) {
              ideas += 1
            }
            if ((mask & 0b0100) !== 0) {
              ideas += 1
            }
            if ((mask & 0b1000) !== 0) {
              ideas += 1
            }
            minimal = minimal === -1 ? ideas : Math.min(minimal, ideas)
          }
        }
      }
      expect(minimal).toBe(expected)
      expect(measureMinimumBasis(colours, n).k).toBe(expected)
    }
  })

  it('solving subsets are upward-closed: a superset of a solving subset solves', () => {
    // The monotonicity invariant measureMinimumBasis enforces, checked
    // against the fixtures: for every solving subset, every strict
    // superset solves too. This is the property the matching engine makes
    // structural — the capped zone engine violated it (a board solved by
    // {c1,c2} could stall under {c1,c2,c4}).
    for (const colours of [K1_COLOURS, K2_COLOURS]) {
      for (let mask = 0; mask < 16; mask += 1) {
        const subset = (['c1', 'c2', 'c3', 'c4'] as const).filter(
          (_, bit) => (mask & (1 << bit)) !== 0,
        )
        const solved = solveStarCatalogue(colours, 4, {
          rules: ['base', ...subset],
          csDepth: 0,
        }).solved
        if (!solved) {
          continue
        }
        for (let bit = 0; bit < 4; bit += 1) {
          const superset = mask | (1 << bit)
          if (superset === mask) {
            continue
          }
          const more = (['c1', 'c2', 'c3', 'c4'] as const).filter(
            (_, b) => (superset & (1 << b)) !== 0,
          )
          expect(
            solveStarCatalogue(colours, 4, { rules: ['base', ...more], csDepth: 0 }).solved,
          ).toBe(true)
        }
      }
    }
  })
})
