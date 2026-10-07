/**
 * Minimum-basis measurement for Star Battle colourings.
 *
 * The difficulty axis this module measures: the smallest number of
 * confinement rules {c1, c2, c3, c4} that, ADDED to the base rule set
 * (exclusion + hidden singles, exactly `propagate.ts` semantics), lets the
 * depth-0 catalogue solver place all n stars. Call it `k`:
 *
 * - `k = 0` — the base rules alone solve the board. The production solver
 *   can finish it; no technique required.
 * - `k = 1..4` — at least one confinement rule is required, and some subset
 *   of size `k` suffices. `rules` carries the WITNESS subset: the first
 *   subset, in canonical enumeration order, that solves.
 * - `k = -1` — NO subset of {c1..c4} solves the board at depth 0. This is
 *   NOT an error and NOT "unsolvable": the board class genuinely exists
 *   (measured at n = 8..10 in the walk stream, and it is the class of the
 *   second human reference board, n = 9, whose full base+c1..c4 catalogue
 *   stalls at depth 0 while csDepth:1 — one contradiction pass — solves it
 *   in 5 waves). The reading is "pure deduction from exclusions, hidden
 *   singles and confinement is insufficient; the board requires
 *   contradiction (case-splitting)". A caller that only understands {0..4}
 *   must treat -1 as "harder than any k = 4 board", never as a failure.
 *
 * Why this exists alongside `fingerprintStarCatalogue` (the trap this module
 * is written to route around): the fingerprint is leave-one-out over the
 * FULL enabled rule set — it reports which rules the full solve could not
 * have done without. That is a different question. A board that base+c1
 * solves single-handedly reports an EMPTY fingerprint (remove any one rule
 * and the rest still solve), while its minimum basis is genuinely 1 — and
 * the human reference board (n = 10) fingerprints several load-bearing
 * rules while its minimum basis is 2 (witness c2+c3). Minimum basis
 * cardinality is the axis that separates "one technique" boards from
 * "two techniques" boards; the fingerprint cannot.
 *
 * Enumeration: subsets are tried by INCREASING SIZE (1, then 2, then 3,
 * then 4), and within a size in canonical rule order (c1, c2, c3, c4 —
 * ascending bitmask). The first solving subset wins, so `k` is genuinely
 * minimal and `rules` is a deterministic function of the colouring. `k = 0`
 * is checked first (base alone). Case-splitting is never used: the question
 * is what PURE deduction achieves, and a contradiction pass would collapse
 * every axis into "solvable with cs".
 *
 * Soundness contract (inherited from `catalogue.ts`): every rule is sound,
 * so a solved run is a uniqueness certificate and `waves`/`placed` describe
 * that witness run. A stalled run proves nothing about the true solution
 * count. All runs are pure functions of the colouring; the module holds no
 * state.
 */
import { assertStarColours } from '../../domain/starBattle'
import { solveStarCatalogue, type StarCatalogueRule } from './catalogue'

/**
 * The confinement vocabulary minimum bases are built from: `base` is the
 * frame every run includes, `cs` is deliberately excluded (it would answer
 * a different question — see module doc).
 */
export type StarConfinementRule = Exclude<StarCatalogueRule, 'base' | 'cs'>

/** The confinement rules, in canonical enumeration order. */
export const STAR_CONFINEMENT_RULES: readonly StarConfinementRule[] = ['c1', 'c2', 'c3', 'c4']

/**
 * The minimum-basis result for one colouring.
 *
 * - `k` — basis cardinality: 0 (base alone) .. 4, or -1 (no confinement
 *   subset solves at depth 0; the board requires contradiction).
 * - `rules` — the witness subset. Empty for `k = 0` (no confinement rule
 *   needed) and for `k = -1` (no witness exists).
 * - `waves` — waves the witness run wrote. For `k = -1`: the waves of the
 *   deepest attempt (base + all four confinement rules).
 * - `placed` — stars the reported run placed (`n` when solved; the stall
 *   point otherwise). For `k = -1`: the deepest attempt's placement
 *   (5/10 on the reference fixture — confinement alone cannot even place
 *   half the stars).
 */
export interface StarMinimumBasis {
  /** Basis cardinality 0..4, or -1 = no confinement subset solves (requires contradiction). */
  readonly k: number
  /** Witness subset in canonical order; empty when k = 0 or k = -1. */
  readonly rules: readonly StarConfinementRule[]
  /** Waves of the witness run (k >= 0) or of the all-four attempt (k = -1). */
  readonly waves: number
  /** Stars placed by the reported run. */
  readonly placed: number
}

/**
 * Measure the minimum confinement basis of a colouring. Pure and
 * deterministic: same colouring ⇒ identical result, subset enumeration in
 * fixed canonical order, no randomness, no shared state. Throws the
 * domain's standard errors on invalid input (`assertStarColours`).
 */
export function measureMinimumBasis(colours: Uint8Array, n: number): StarMinimumBasis {
  assertStarColours(colours, n)

  // k = 0: the base frame alone. A solve here means no technique is needed.
  const base = solveStarCatalogue(colours, n, { rules: ['base'], csDepth: 0 })
  if (base.solved) {
    return Object.freeze({ k: 0, rules: Object.freeze([]) as readonly StarConfinementRule[], waves: base.waves, placed: base.placed })
  }

  // k = 1..4: enumerate subsets by increasing size, canonical order within
  // a size (ascending bitmask over STAR_CONFINEMENT_RULES). First solve is
  // the answer, so k is minimal and the witness is deterministic.
  for (let size = 1; size <= STAR_CONFINEMENT_RULES.length; size += 1) {
    for (let mask = 1; mask < 1 << STAR_CONFINEMENT_RULES.length; mask += 1) {
      let popcount = 0
      for (let bit = 0; bit < STAR_CONFINEMENT_RULES.length; bit += 1) {
        if ((mask & (1 << bit)) !== 0) {
          popcount += 1
        }
      }
      if (popcount !== size) {
        continue
      }
      const subset = STAR_CONFINEMENT_RULES.filter((_, bit) => (mask & (1 << bit)) !== 0)
      const attempt = solveStarCatalogue(colours, n, { rules: ['base', ...subset], csDepth: 0 })
      if (attempt.solved) {
        return Object.freeze({
          k: size,
          rules: Object.freeze(subset) as readonly StarConfinementRule[],
          waves: attempt.waves,
          placed: attempt.placed,
        })
      }
    }
  }

  // k = -1: not an error — a real board class. Deepest attempt (all four
  // confinement rules) is the most informative stall to report.
  const deepest = solveStarCatalogue(colours, n, {
    rules: ['base', ...STAR_CONFINEMENT_RULES],
    csDepth: 0,
  })
  return Object.freeze({
    k: -1,
    rules: Object.freeze([]) as readonly StarConfinementRule[],
    waves: deepest.waves,
    placed: deepest.placed,
  })
}
