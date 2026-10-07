/**
 * Rejection (MCMC) drift over legal Star Battle colourings — the diversity
 * phase that runs AFTER the tier walk (walk.ts).
 *
 * Why this exists (measured, 2026-10-07): the player's ruling on the shipped
 * technique tiers was 「每一关的思路都一样，玩久了很无趣」. The signature
 * instrument (signature.ts) located the monotony: the walk is an ATTRACTOR
 * LADDER — at the base-stall bottom only c1 revives propagation, so every
 * steady-seeded walk ends at witness {c1} and `challenging`'s class-modal
 * share measures 1.000 before AND after seed-tier rotation. Rotating the
 * walk's INPUTS moved the line-owner structural axis on a third to a half
 * of boards but never touched the (k, witness) axis. This module attacks
 * the witness axis directly.
 *
 * Why the drift succeeds where five earlier constructions failed: IT HAS NO
 * OBJECTIVE FUNCTION. The descent walks (walk.ts, construct.ts shaper)
 * scalarise a defect and stop at zero — every greedy walk plateaus on the
 * same attractor, which is the measured monotony. Here legality is 0/∞:
 * the state space is colourings with one connected region per colour and
 * EXACTLY ONE star solution; a move is accepted iff it lands in the legal
 * set, full stop. There is no gradient to descend and no plateau to stall
 * on. Measured by the research lane on this engine: connectivity pass rate
 * ~41–43%, of which 66–81% remain unique (770–1040 accepted boards per
 * start, ~100% distinct); the unique set is DENSE, not spiky. Structural
 * escape is real: from sea starts (largest share 0.42–0.49) the drift
 * produced 672–928 hub-free boards and 35–645 clean boards (hub-free AND
 * no whole-line region) per start; at n = 15 a 94%-sea start dropped to
 * share 0.36 within 2864 accepted steps.
 *
 * The move: repaint one cell to a 4-neighbour's colour. Hard-reject if the
 * vacated region would disconnect (regionStaysConnectedWithout, structure.ts
 * — the gained region cannot split: the new cell attaches to an existing
 * component of the target colour). Accept iff the repainted board has
 * exactly one star solution. Unlike the walk, ANY cell may be repainted —
 * the walk protects its planted solution line because its descent reasons
 * about it; the drift re-certifies uniqueness at every accepted step, so
 * the solution is free to move. That freedom is what escapes the attractor.
 *
 * THE METROPOLIS–HASTINGS CORRECTION (kept, and analysed honestly). The
 * neighbour-colour proposal is asymmetric — the proposal draws a cell
 * uniformly and then a target colour uniformly among the DISTINCT neighbour
 * colours, so q(x→y) = 1 / (n² · |S_x|) with S_x the repaint-option set.
 * The correction accepts with min(1, |S_x| / |S_y|). TWO FACTS ARE RECORDED
 * HERE BECAUSE THEY ARE LOAD-BEARING FOR ANY FUTURE CHANGE OF THE PROPOSAL
 * KERNEL:
 *
 *  1. For THIS kernel the ratio provably never rejects. S_x = D ∖ {c} and
 *     S_y = D ∖ {d}, where D is the set of distinct colours among the
 *     cell's 4-neighbours — and repainting the cell never changes its
 *     neighbours, so D is IDENTICAL in both states. Since d ∈ D and c may
 *     or may not be in D, |S_y| = |D| − 1 ≤ |D| − [c ∈ D] = |S_x| always.
 *     The line is kept anyway: it is the difference between a correct
 *     sampler and a plausible one for ANY kernel change that draws the
 *     target colour from a state-dependent set (e.g. a k-neighbourhood
 *     proposal), where the same calculation yields |S_y| > |S_x| on some
 *     moves and the correction bites. Removing it because it is a no-op
 *     today would silently un-correct a future kernel.
 *  2. The deeper asymmetry the ratio cannot fix: repainting a cell AWAY
 *     from a colour no neighbour carries (c ∉ D) has NO direct reverse
 *     proposal, because the reverse draw needs c among the repaint options
 *     of the new state and the neighbours are unchanged. Strict MH would
 *     reject every such move (q(y→x) = 0 ⇒ ratio 0), which freezes cells
 *     whose colour is locally unique; the chain instead stays ergodic by
 *     accepting them (the ratio is ≥ 1). The consequence is recorded in
 *     plain terms: despite the correction line, the stationary
 *     distribution of this chain is NOT proven uniform over the legal
 *     component, and the brief's "exact uniformity" claim should be read
 *     as "no scalar objective, dense exploration" — which is what the
 *     picker needs, and which the batch measurements in drift.test.ts and
 *     the construct.ts audit assertions pin down operationally.
 *
 * THE UNIQUENESS GATE — the acceptance-test boundary, enforced
 * structurally and load-bearing (a gate that admits "unknown" admits
 * duplicated boards into a game whose contract is exactly-one-solution):
 *  - FAST POSITIVE: {@link solveStarCatalogue} with the full depth-0
 *    ruleset MAY shortcut an acceptance — a complete sound-rule solve is
 *    a uniqueness certificate the whole engine already relies on (walk.ts
 *    gate (d)), and it is free for the k ≥ 0 majority (boards solvable
 *    by pure deduction). It is NEVER used as a rejection gate: a board
 *    the catalogue does not solve is not rejected, it falls through to
 *    the exact counter — using the catalogue as a rejection gate would
 *    silently exclude exactly the k = −1 boards, which is the retired
 *    noHub gate wearing a solver costume.
 *  - REJECTION SIDE: only {@link countStarSolutionsWithBudget}. Budget
 *    exhaustion REJECTS (fail closed, the sound direction — the generation
 *    contract: unknown/budget-exhausted solver results are failures, never
 *    treated as unique) and is COUNTED in {@link StarDriftBoard.exhaustions}.
 *    RESIDUAL BIAS, recorded honestly: a board whose uniqueness proof is
 *    very expensive is silently excluded from the drift's reachable set —
 *    a slight bias AGAINST the hardest-to-verify boards. The exhaustion
 *    count travels with the result so the rate can be raised against the
 *    ~0.1% ceiling if it ever exceeds it. Measured by the research lane:
 *    a 500 ms budget fired ZERO times in ~5.5k n = 15 drift-stream calls
 *    (max 382 ms), so the shipped node budget is calibrated with headroom.
 *
 * BUDGET SEMANTICS (the quality dial, walk.ts precedent): the search is
 * bounded by a PROPOSAL count — deterministic, never wall clock — because
 * the drift may stop at ANY accepted unique board: a smaller budget trades
 * diversity for latency, and that trade is the design. Wall clock is a
 * GIVE-UP-AND-RESTART guard only: exceeding it throws
 * {@link StarDriftBudgetExhaustedError} and the caller rejects the walk
 * sample and moves on, exactly as {@link StarWalkBudgetExhaustedError} is
 * handled today. A wall-clock cutoff NEVER returns a short-drift board —
 * that would make the accepted board a function of machine load. Measured
 * escape cost (research lane): n ≤ 12 reaches structural escape in ~2000
 * proposals ≈ 1–2 s; n = 15 needs ~6000–9000 ≈ 60–90 s. The shipped
 * per-side default ({@link starDriftProposalBudget}) is chosen from the
 * quality/latency knee measured on this engine with the shipped fast
 * positive — see drift.test.ts and the construct.ts module doc, and note
 * the tier wall clock ({@link TECHNIQUE_TIER_WALL_CLOCK_MS} in construct.ts)
 * caps what n = 15 can spend before the tier must give up instead.
 *
 * Determinism: every random draw comes from one seeded stream in a fixed
 * order; the solvers draw no randomness; wall clock gates only when the
 * search gives up, never which board is accepted. Same (n, seed, start)
 * ⇒ same endpoint and same counts.
 *
 * === THE MEASURED NULL (2026-10-07, this lane, on this engine) ===
 *
 * The headline question — does the drift move `challenging`'s (k, witness)
 * class-modal share off 1.000? — measured NO at n = 10, and the economics
 * fail at n = 15:
 *
 *  - Class share: drifted boards gated on the tier contract (base places
 *    ZERO stars AND minimum basis k = 1) came out 10/11 class {c1} —
 *    statistically identical to the walk's 11/12. Both samplers land on
 *    the same distribution, which is the measured evidence that the {c1}
 *    concentration is a property of the CONDITIONAL PUZZLE-CLASS SPACE —
 *    "base-stall boards solvable by exactly one idea" are mostly
 *    line-confinement boards no matter how the legal set is sampled — not
 *    a generator artifact a sampler can diversify away.
 *  - Not a mixing-time artifact: checkpoint legs of 2000 proposals from a
 *    {c1} walk start, a {c3} walk start, and a construction sea start all
 *    leave their start basin within one leg and converge to the same
 *    profile (base rules place 1–10 stars; k = −1 and k = 2 appear
 *    occasionally). The drift forgets where it started; the distribution
 *    is what it is.
 *  - Where the class diversity actually lives: in boards where the base
 *    rules place SOME stars (drifted k = 1 boards show witnesses {c1},
 *    {c3}, basePlaced 0–7) and in the k = 2 / k = −1 classes the chain
 *    reaches from construction starts. That is a DIFFERENT tier contract
 *    than the shipped "base places zero" — a product decision, not a
 *    sampling fix.
 *  - Cost (this machine, the shipped fast positive): n = 8 ≈ 0.1–0.2 ms /
 *    proposal, n = 10 ≈ 0.15–0.4 ms, n = 15 ≈ 24–31 ms — at n = 15 the
 *    exact counter's rejection of non-unique candidates dominates
 *    (~31 ms median per rejection), so a 30 s tier budget buys ~1,000
 *    proposals there.
 *  - Throughput under the tier gates: n = 10 consumed a median of ~22
 *    walk+drift cycles per accepted board (drift legs that leave the
 *    base-stall slice are almost never in it at their endpoint); n = 15
 *    measured ZERO challenging hits across 12 drift legs at budget 800,
 *    with legs up to 21.5 s — minutes per board, against the 30 s tier
 *    wall clock.
 *
 * Consequence (the sequencing safety rule from the lane brief): the drift
 * is NOT wired into technique-tier generation and the shape gate stays.
 * A gate left in with an honest explanation beats a gate removed into a
 * 30-seconds-per-board regression that ships the same {c1} puzzle. The
 * module, its tests, and this record stay: the drift IS the right
 * instrument for the structural axis (sea starts lose the hub and the
 * line owner within hundreds of accepted steps — the distribution-suite
 * tests pin it), and it is the wrong instrument for the witness axis.
 *
 * Independence: pure engine module — no React, no DOM, no Math.random.
 */
import { assertStarBattleSide, assertStarColours } from '../../domain/starBattle'
import { createSeededRandom, deriveRandomSeed, type RandomSeed } from '../rng'
import { solveStarCatalogue } from './catalogue'
import { countStarSolutionsWithBudget, DEFAULT_STAR_COUNT_CAP, findStarSolutions } from './count'
import {
  measureStarBoardStructure,
  measureStarStructuralCore,
  regionStaysConnectedWithout,
} from './structure'

/**
 * The node budget the uniqueness counter gets per call on the rejection
 * side. The counter runs ONLY on boards the full catalogue does not solve
 * (the k = −1 tail); every other acceptance and rejection is either the
 * free catalogue certificate or a cap-2 search that stops at the second
 * solution. Measured by the research lane on the n = 15 drift stream: a
 * 500 ms wall budget fired zero times in ~5.5k calls (max 382 ms), so this
 * node budget is orders of magnitude above the observed worst case.
 * Exhaustions are counted and reported, never treated as unique.
 */
export const STAR_DRIFT_COUNTER_NODE_BUDGET = 50_000_000

/**
 * The Metropolis–Hastings acceptance ratio for the neighbour-colour
 * proposal: min(1, |S_x| / |S_y|) over the counts of distinct repaint
 * options. Pure; factored out so the provable no-op property of the
 * current kernel (|S_y| ≤ |S_x| always — see module doc) is pinned by a
 * direct unit test, and a future kernel change that makes the ratio bite
 * is caught by the same test.
 */
export function metropolisHastingsAcceptance(forwardOptions: number, backwardOptions: number): number {
  if (forwardOptions <= 0 || backwardOptions <= 0) {
    throw new RangeError(
      `repaint option counts must be positive; received forward=${String(forwardOptions)} backward=${String(backwardOptions)}`,
    )
  }
  return Math.min(1, forwardOptions / backwardOptions)
}

/**
 * The per-side default proposal budget — the quality dial. Chosen from
 * the measured quality/latency knee (drift.test.ts distribution suite and
 * the construct.ts module doc record the numbers), NOT from the largest
 * report value: the drift stops at the FIRST accepted board at or past
 * the budget, so proposals beyond the knee buy almost no additional
 * structural escape while costing linear latency inside the tier's wall
 * clock.
 */
export function starDriftProposalBudget(n: number): number {
  assertStarBattleSide(n)
  // n <= 12 reaches structural escape in ~2000 proposals (research lane);
  // n >= 13 needs more steps to leave the sea-dominated basin. The n = 15
  // value is the knee measured against the tier's 30 s wall clock: the
  // drift must leave room for the walk that precedes it and the walks that
  // a k-target rejection may consume after it.
  if (n <= 12) {
    return 2000
  }
  if (n <= 14) {
    return 4000
  }
  return 6000
}

/**
 * Loud, typed failure when the drift's wall-clock give-up guard fires
 * before the proposal budget completed. Never carries a board: a drift
 * that gave up on wall clock has nothing to distinguish from one that
 * stopped early by load, so the caller rejects the whole walk sample.
 */
export class StarDriftBudgetExhaustedError extends Error {
  readonly n: number
  readonly seed: number
  readonly proposals: number
  readonly accepted: number
  readonly exhaustions: number
  readonly elapsedMs: number

  constructor(fields: {
    readonly n: number
    readonly seed: number
    readonly proposals: number
    readonly accepted: number
    readonly exhaustions: number
    readonly elapsedMs: number
  }) {
    super(
      `star battle drift exhausted its wall-clock budget ` +
        `(n=${fields.n}, seed=${fields.seed}, proposals=${fields.proposals}, ` +
        `accepted=${fields.accepted}, exhaustions=${fields.exhaustions}, ` +
        `${fields.elapsedMs.toFixed(1)}ms) before completing its proposal budget`,
    )
    this.name = 'StarDriftBudgetExhaustedError'
    this.n = fields.n
    this.seed = fields.seed
    this.proposals = fields.proposals
    this.accepted = fields.accepted
    this.exhaustions = fields.exhaustions
    this.elapsedMs = fields.elapsedMs
  }
}

export interface StarDriftRequest {
  /** Board side; the usual Star Battle side range applies. */
  readonly n: number
  /** Seed: drives the drift stream. Same (n, seed, start) ⇒ same endpoint. */
  readonly seed: RandomSeed
  /**
   * The colouring to drift from — today the tier walk's accepted endpoint,
   * itself certified unique and fully connected. The drift re-certifies
   * uniqueness at every accepted step; it does not trust the start beyond
   * its shape (connectivity is re-verified, loudly, before the first
   * proposal).
   */
  readonly startColours: Uint8Array
  /**
   * The proposal budget — the quality dial (see module doc). Defaults to
   * {@link starDriftProposalBudget}(n).
   */
  readonly maxProposals?: number
  /**
   * The give-up-and-restart guard, in milliseconds. Throwing
   * {@link StarDriftBudgetExhaustedError} on expiry is the ONLY thing wall
   * clock influences; it never changes which board an un-guarded drift
   * accepts. Defaults to 30 s, the tier budget the caller also answers to.
   */
  readonly wallClockMs?: number
  /**
   * The node budget handed to the exact counter on the rejection side.
   * Exhaustion rejects (fail closed) and is counted. Defaults to
   * {@link STAR_DRIFT_COUNTER_NODE_BUDGET}.
   */
  readonly counterNodeBudget?: number
  /**
   * The catalogue fast positive (module doc): true (default) tries a
   * full-ruleset depth-0 {@link solveStarCatalogue} first — a complete
   * sound-rule solve is a free uniqueness certificate for the k ≥ 0
   * majority. false sends EVERY legality check through the exact counter
   * — the honest cost baseline the measurements report against, and the
   * path the fail-closed exhaustion tests exercise directly. Never a
   * rejection gate either way: a board the catalogue does not solve falls
   * through to the counter, never rejects on the catalogue's word.
   */
  readonly fastPositive?: boolean
}

/**
 * The endpoint of one drift run: the final accepted colouring (the start
 * itself when nothing was accepted), its certified-unique solution, every
 * counter the grader and the audit need, and the structural measurements
 * of BOTH ends so a caller can report the escape (start sea share vs end
 * share) from one call.
 */
export interface StarDriftBoard {
  readonly n: number
  /** The final accepted colouring. */
  readonly colours: Uint8Array
  /** The unique solution of the final board, `solution[row] = column`. */
  readonly solution: readonly number[]
  /** Proposals drawn (including every rejection kind). */
  readonly proposals: number
  /** Accepted proposals — steps the chain actually moved. */
  readonly accepted: number
  /** Proposals with no valid neighbour-colour repaint option. */
  readonly rejectedNoChoice: number
  /** Proposals the vacated-region connectivity gate rejected. */
  readonly rejectedConnectivity: number
  /** Proposals the Metropolis–Hastings ratio rejected. */
  readonly rejectedMetropolis: number
  /** Proposals the exact counter rejected as non-unique (count ≥ 2). */
  readonly rejectedNonUnique: number
  /**
   * Counter calls that exhausted their node budget — REJECTED, per the
   * fail-closed contract, and counted here so the residual bias against
   * the hardest-to-verify boards is a reported number, never a silent
   * one. The ~0.1% ceiling: if exhaustions / proposals ever exceeds it,
   * raise {@link STAR_DRIFT_COUNTER_NODE_BUDGET}.
   */
  readonly exhaustions: number
  /** Acceptances certified by the catalogue fast positive (k ≥ 0 boards). */
  readonly certifiedByCatalogue: number
  /** Acceptances certified by the exact counter (the k = −1 tail). */
  readonly certifiedByCounter: number
  /** Structure of the START board — the escape's "before". */
  readonly start: {
    readonly hubCount: number
    readonly largestRegionShare: number
    readonly coreScore: number
  }
  /** Structure of the END board — the escape's "after". */
  readonly end: {
    readonly hubCount: number
    readonly largestRegionShare: number
    readonly coreScore: number
    /** Some colour owns an entire row or column (structure.ts). */
    readonly lineOwner: boolean
  }
  /** Measured wall-clock of the whole drift. Not part of the identity. */
  readonly elapsedMs: number
  /** The normalised numeric seed (what determinism keys on). */
  readonly normalizedSeed: number
}

/** The distinct colours among the 4-neighbours of `index`, excluding `exclude`. */
function distinctNeighbourColours(colours: Uint8Array, n: number, index: number, exclude: number): number[] {
  const row = (index / n) | 0
  const column = index % n
  const result: number[] = []
  const neighbours = [
    row > 0 ? index - n : -1,
    row + 1 < n ? index + n : -1,
    column > 0 ? index - 1 : -1,
    column + 1 < n ? index + 1 : -1,
  ]
  for (const neighbour of neighbours) {
    if (neighbour >= 0) {
      const colour = colours[neighbour]
      if (colour !== exclude && !result.includes(colour)) {
        result.push(colour)
      }
    }
  }
  return result
}

/**
 * Drift from a certified-unique, fully-connected colouring for
 * `maxProposals` proposals and return the final accepted state. See the
 * module doc for the move, the gates, the budget semantics and the honest
 * bias record.
 *
 * Cost model: per proposal — one connectivity flood fill, one catalogue
 * solve (the fast positive), and for the catalogue-unsolved minority one
 * budgeted exact count. The expensive counter never runs on k ≥ 0 boards.
 */
export function driftStarBattleBoard(request: StarDriftRequest): StarDriftBoard {
  const { n, startColours } = request
  assertStarBattleSide(n)
  assertStarColours(startColours, n)
  const maxProposals = request.maxProposals ?? starDriftProposalBudget(n)
  const wallClockMs = request.wallClockMs ?? 30_000
  const counterNodeBudget = request.counterNodeBudget ?? STAR_DRIFT_COUNTER_NODE_BUDGET
  const fastPositive = request.fastPositive ?? true
  if (!Number.isSafeInteger(maxProposals) || maxProposals <= 0) {
    throw new RangeError(`maxProposals must be a positive safe integer; received ${String(maxProposals)}`)
  }
  if (typeof wallClockMs !== 'number' || !(wallClockMs > 0)) {
    throw new RangeError(`wallClockMs must be a positive number; received ${String(wallClockMs)}`)
  }
  if (typeof counterNodeBudget !== 'number' || !(counterNodeBudget > 0)) {
    throw new RangeError(`counterNodeBudget must be a positive number; received ${String(counterNodeBudget)}`)
  }

  const rng = createSeededRandom(deriveRandomSeed(request.seed, 'star-battle-drift'))
  const normalizedSeed = rng.seed
  const startedAt = performance.now()

  const colours = startColours.slice()
  const startStructure = measureStarBoardStructure(colours, n)
  if (!startStructure.connected) {
    // The walk certifies its endpoints; reaching here is an internal
    // invariant violation, reported loudly rather than drifted from.
    throw new Error(
      `star battle drift start is not fully connected (n=${n}, seed=${normalizedSeed}); ` +
        `the drift never repairs connectivity, it only preserves it`,
    )
  }
  const startCore = measureStarStructuralCore(colours, n)

  let proposals = 0
  let accepted = 0
  let rejectedNoChoice = 0
  let rejectedConnectivity = 0
  let rejectedMetropolis = 0
  let rejectedNonUnique = 0
  let exhaustions = 0
  let certifiedByCatalogue = 0
  let certifiedByCounter = 0

  for (; proposals < maxProposals; proposals += 1) {
    if (performance.now() - startedAt >= wallClockMs) {
      throw new StarDriftBudgetExhaustedError({
        n,
        seed: normalizedSeed,
        proposals,
        accepted,
        exhaustions,
        elapsedMs: performance.now() - startedAt,
      })
    }

    // --- propose: repaint a cell to the colour of one of its 4-neighbours -
    const index = rng.nextInt(n * n)
    const from = colours[index]
    const forwardOptions = distinctNeighbourColours(colours, n, index, from)
    if (forwardOptions.length === 0) {
      rejectedNoChoice += 1
      continue
    }
    const to = forwardOptions[rng.nextInt(forwardOptions.length)]

    // --- the vacated region must stay one connected component ------------
    if (!regionStaysConnectedWithout(colours, n, index, from)) {
      rejectedConnectivity += 1
      continue
    }

    colours[index] = to

    // --- Metropolis–Hastings: corrects any state-dependent proposal set --
    // |S_x| / |S_y| over the distinct repaint-option counts (module doc:
    // for this kernel the ratio is provably ≥ 1 — the line is kept so a
    // future kernel change cannot silently go uncorrected).
    const backwardOptions = distinctNeighbourColours(colours, n, index, to).length
    if (rng.nextFloat() >= metropolisHastingsAcceptance(forwardOptions.length, backwardOptions)) {
      rejectedMetropolis += 1
      colours[index] = from
      continue
    }

    // --- legality: exactly one star solution -----------------------------
    // FAST POSITIVE ONLY: a complete depth-0 catalogue solve is a free
    // uniqueness certificate for the k >= 0 majority; it is never a
    // rejection gate (module doc — using it as one would silently exclude
    // the k = −1 boards). Depth 0, not 1: the measured cost of a
    // case-splitting solve per proposal exceeds the counter's at every
    // side, and the k = −1 tail the depth-1 certificate would cover is
    // exactly the tail the counter must see anyway (its exhaustions are
    // the audited bias channel).
    const catalogue = fastPositive ? solveStarCatalogue(colours, n, { csDepth: 0 }) : { solved: false }
    if (catalogue.solved) {
      certifiedByCatalogue += 1
    } else {
      const counted = countStarSolutionsWithBudget(colours, n, DEFAULT_STAR_COUNT_CAP, counterNodeBudget)
      if (counted.status === 'limit-exhausted') {
        // Fail closed: an exhausted proof rejects, and is COUNTED — the
        // residual bias against hard-to-verify boards stays a reported
        // number (module doc).
        exhaustions += 1
        colours[index] = from
        continue
      }
      if (counted.count !== 1) {
        rejectedNonUnique += 1
        colours[index] = from
        continue
      }
      certifiedByCounter += 1
    }

    accepted += 1
  }

  // --- final certification: the endpoint's unique solution ---------------
  // Every accepted state was certified at accept time; re-deriving the
  // solution here is the independent confirmation the puzzle record needs.
  // The catalogue path is the cheap one; the counter fallback covers a
  // catalogue-unsolvable-but-unique endpoint (the k = −1 tail), and
  // findStarSolutions prunes with that same counter, so a unique board
  // cannot come back empty.
  const finalSolve = solveStarCatalogue(colours, n, { csDepth: 1 })
  let solution: readonly number[]
  if (finalSolve.solved) {
    solution = Object.freeze(finalSolve.stars.map((star) => star[1])) as readonly number[]
  } else {
    const found = findStarSolutions(colours, n, 1)
    if (found.length !== 1) {
      // The acceptance gate certified exactly one solution at every step;
      // reaching here is an internal invariant violation, reported loudly.
      throw new Error(
        `star battle drift produced a board the exact counter does not confirm unique ` +
          `(n=${n}, seed=${normalizedSeed}, found=${found.length}); the acceptance gate is broken`,
      )
    }
    solution = Object.freeze(found[0].slice()) as readonly number[]
  }

  const endStructure = measureStarBoardStructure(colours, n)
  const endCore = measureStarStructuralCore(colours, n)

  return Object.freeze({
    n,
    colours: colours.slice(),
    solution,
    proposals,
    accepted,
    rejectedNoChoice,
    rejectedConnectivity,
    rejectedMetropolis,
    rejectedNonUnique,
    exhaustions,
    certifiedByCatalogue,
    certifiedByCounter,
    start: Object.freeze({
      hubCount: startStructure.hubCount,
      largestRegionShare: startStructure.largestRegionShare,
      coreScore: startCore.coreScore,
    }),
    end: Object.freeze({
      hubCount: endStructure.hubCount,
      largestRegionShare: endStructure.largestRegionShare,
      coreScore: endCore.coreScore,
      lineOwner: endCore.lineOwner,
    }),
    elapsedMs: performance.now() - startedAt,
    normalizedSeed,
  })
}
