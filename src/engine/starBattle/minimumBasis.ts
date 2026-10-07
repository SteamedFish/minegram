/**
 * Minimum-basis measurement for Star Battle colourings.
 *
 * The difficulty axis this module measures: the smallest number of distinct
 * technique IDEAS that, ADDED to the base rule set (exclusion + hidden
 * singles, exactly `propagate.ts` semantics), lets the depth-0 catalogue
 * solver place all n stars. Call it `k`:
 *
 * - `k = 0` — the base rules alone solve the board. The production solver
 *   can finish it; no technique required.
 * - `k = 1..3` — at least one technique is required, and some subset of
 *   size `k` of the idea vocabulary suffices. `rules` carries the WITNESS
 *   subset: the first subset, in canonical enumeration order, that solves
 *   with the minimal idea count.
 * - `k = -1` — NO subset of {c1..c4} solves the board at depth 0. This is
 *   NOT an error and NOT "unsolvable": the board class genuinely exists
 *   and is the target of the 'contradiction' difficulty tier — the board
 *   requires case-splitting (`csDepth: 1`), i.e. an assumption disproved by
 *   contradiction, which for a human is "I have to try something and see it
 *   fail". A caller that only understands {0..3} must treat -1 as "harder
 *   than any k = 3 board", never as a failure.
 *
 * The idea vocabulary (2026-10-07): `c1` and `c2` are ONE idea — "these
 * colours are confined to these lines, so the lines' other cells are
 * blank". The catalogue computes both with a single Hall/matching
 * propagator and reports the width of each deduction's certificate (one
 * line → `c1`, two or more → `c2`); a human counts "this colour is confined
 * to one line" and "these j colours are confined to these j lines" as the
 * same move at different widths, so counting them as two techniques
 * double-counted one idea. `c3` (box confinement) and `c4` (shadow) are
 * genuinely distinct techniques: measured boards exist that need c3 or c4
 * on top of full line confinement. The rule ids are NOT renamed or merged —
 * the collapse lives only in this counting layer.
 *
 * Why this exists alongside `fingerprintStarCatalogue` (the trap this
 * module is written to route around): the fingerprint is leave-one-out over
 * the FULL enabled rule set — it reports which rules the full solve could
 * not have done without. That is a different question. A board that
 * base+c1 solves single-handedly reports an EMPTY fingerprint (remove any
 * one idea and the rest still solve), while its minimum basis is genuinely
 * 1. Minimum-basis cardinality is the axis that separates "one technique"
 * boards from "two technique" boards; the fingerprint cannot.
 *
 * Enumeration: all 16 subsets of {c1,c2,c3,c4} are solved explicitly —
 * never inferred from the full catalogue (the acceptance trap: with a
 * non-monotone engine a full-catalogue solve implies nothing about subset
 * solves). Subsets are scored by idea count
 * (`|subset ∩ {c3,c4}| + (has c1 or c2 ? 1 : 0)`); `k` is the minimal
 * score over solving subsets and `rules` the first solving subset achieving
 * it, in canonical (size-major, then ascending-bitmask) order. `k = 0` is
 * checked first (base alone). Case-splitting is never used: the question
 * is what PURE deduction achieves, and a contradiction pass would collapse
 * every axis into "solvable with cs".
 *
 * Built-in invariant (the acceptance trap, enforced where it is cheapest):
 * the solving family over the 16 subsets MUST be upward-closed — if subset
 * S solves and S ⊆ T then T solves. The Hall/matching confinement
 * propagator makes this structural (sound blanking only removes graph
 * edges, so a subset solve certificate survives every superset), and the
 * enumeration verifies it on every measurement: a non-monotone table is an
 * engine bug, thrown loudly, never a silently mis-tiered board. This module
 * therefore answers for the generator's acceptance path: the 16-subset
 * enumeration IS the gate, executed here on every board the tiers accept.
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

/** The number of confinement subsets enumerated: 2^4 = 16. */
export const STAR_CONFINEMENT_SUBSET_COUNT = 1 << STAR_CONFINEMENT_RULES.length

/**
 * Count the distinct technique IDEAS a confinement subset carries:
 * line confinement (c1 or c2) is one idea, box confinement (c3) another,
 * shadow (c4) the third. Two subsets carrying the same ideas count equal
 * here no matter which of c1/c2 they name (defect-1 collapse).
 */
function ideaCount(mask: number): number {
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
  return ideas
}

/**
 * The minimum-basis result for one colouring.
 *
 * - `k` — basis cardinality in IDEAS: 0 (base alone) .. 3, or -1 (no
 *   confinement subset solves at depth 0; the board requires contradiction).
 * - `rules` — the witness subset. Empty for `k = 0` (no confinement rule
 *   needed) and for `k = -1` (no witness exists).
 * - `waves` — waves the witness run wrote. For `k = -1`: the waves of the
 *   deepest attempt (base + all four confinement rules).
 * - `placed` — stars the reported run placed (`n` when solved; the stall
 *   point otherwise). For `k = -1`: the deepest attempt's placement.
 */
export interface StarMinimumBasis {
  /** Basis cardinality in ideas, 0..3, or -1 = no confinement subset solves (requires contradiction). */
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
 *
 * Throws an Error (internal invariant violation, never a player-facing
 * failure) if the 16-subset solving family is not upward-closed — the
 * monotonicity the matching engine guarantees, verified on every
 * measurement so a regression can never silently mis-tier a board.
 */
export function measureMinimumBasis(colours: Uint8Array, n: number): StarMinimumBasis {
  assertStarColours(colours, n)

  // k = 0: the base frame alone. A solve here means no technique is needed.
  const base = solveStarCatalogue(colours, n, { rules: ['base'], csDepth: 0 })
  if (base.solved) {
    return Object.freeze({
      k: 0,
      rules: Object.freeze([]) as readonly StarConfinementRule[],
      waves: base.waves,
      placed: base.placed,
    })
  }

  // The acceptance trap: enumerate ALL 16 subsets explicitly — never infer
  // a subset solve from the full catalogue. Canonical order: by increasing
  // subset size, ascending bitmask within a size.
  const solvedMasks: number[] = []
  const results: { readonly waves: number; readonly placed: number }[] = []
  const order: number[] = []
  for (let size = 1; size <= STAR_CONFINEMENT_RULES.length; size += 1) {
    for (let mask = 1; mask < STAR_CONFINEMENT_SUBSET_COUNT; mask += 1) {
      let bits = 0
      for (let bit = 0; bit < STAR_CONFINEMENT_RULES.length; bit += 1) {
        if ((mask & (1 << bit)) !== 0) {
          bits += 1
        }
      }
      if (bits !== size) {
        continue
      }
      order.push(mask)
    }
  }
  for (const mask of order) {
    const subset = STAR_CONFINEMENT_RULES.filter((_, bit) => (mask & (1 << bit)) !== 0)
    const attempt = solveStarCatalogue(colours, n, { rules: ['base', ...subset], csDepth: 0 })
    results[mask] = { waves: attempt.waves, placed: attempt.placed }
    if (attempt.solved) {
      solvedMasks.push(mask)
    }
  }

  // Monotonicity invariant: the solving family must be upward-closed. The
  // matching confinement engine makes this structural; verify it wherever
  // the measurement runs, because a violation here would mean every
  // tier acceptance built on this number is invalid.
  const solvedSet = new Set(solvedMasks)
  for (const mask of solvedMasks) {
    for (let bit = 0; bit < STAR_CONFINEMENT_RULES.length; bit += 1) {
      const superset = mask | (1 << bit)
      if (superset !== mask && !solvedSet.has(superset)) {
        throw new Error(
          `star battle confinement subsets are not monotone: {${STAR_CONFINEMENT_RULES.filter(
            (_, b) => (mask & (1 << b)) !== 0,
          ).join(',')}} solves but its superset {${STAR_CONFINEMENT_RULES.filter(
            (_, b) => (superset & (1 << b)) !== 0,
          ).join(',')}} stalls (n=${n})`,
        )
      }
    }
  }

  if (solvedMasks.length === 0) {
    // k = -1: not an error — a real board class. Deepest attempt (all four
    // confinement rules) is the most informative stall to report.
    const deepest = results[0b1111]
    return Object.freeze({
      k: -1,
      rules: Object.freeze([]) as readonly StarConfinementRule[],
      waves: deepest.waves,
      placed: deepest.placed,
    })
  }

  // k = 1..3: minimal idea count over solving subsets; the witness is the
  // first solving subset in canonical order achieving that minimum.
  let bestMask = solvedMasks[0]
  let bestIdeas = ideaCount(bestMask)
  for (const mask of solvedMasks) {
    const ideas = ideaCount(mask)
    if (ideas < bestIdeas) {
      bestMask = mask
      bestIdeas = ideas
    }
  }
  const witness = STAR_CONFINEMENT_RULES.filter((_, bit) => (bestMask & (1 << bit)) !== 0)
  const witnessResult = results[bestMask]
  return Object.freeze({
    k: bestIdeas,
    rules: Object.freeze(witness) as readonly StarConfinementRule[],
    waves: witnessResult.waves,
    placed: witnessResult.placed,
  })
}
