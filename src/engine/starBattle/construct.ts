/**
 * Star Battle puzzle construction — the spanning-tree generator.
 *
 * THE CONSTRUCTION (four measurement lanes, all agreeing — this module is
 * the critical path and the numbers below are the spec):
 *
 *  1. Plant a uniformly random admissible star permutation (the intended
 *     answer) — `admissibleStarPermutation` in `sample.ts`.
 *  2. Grow a randomised DFS spanning tree over the grid's 4-neighbour
 *     graph and cut n − 1 uniformly chosen tree edges, splitting the board
 *     into exactly n connected components (`sample.ts`).
 *  3. Reject the layout unless every component contains exactly one planted
 *     star (the mine-balance filter). Measured acceptance: 1.11% at n = 6,
 *     0.062% at n = 8, 0.012% at n = 10 — weak, but sampling is cheap.
 *  4. Run counterexample-guided recolouring repair (`repair.ts`) until the
 *     exact solution count is 1. Among balanced boards, uniqueness is 85%
 *     at n = 4 and 0% from n = 6 up, so repair — not sampling — is the
 *     only mechanism that produces a unique board at played sizes.
 *  5. THE GATE IS EXACT UNIQUENESS: `countStarSolutions(colours, n, 2) === 1`.
 *     The propagation certificate gate accepts ZERO boards at n = 8, 10 and
 *     12 (measured) and is retired as an admission requirement — it is now
 *     a difficulty signal inside the grade. A budget-exhausted count is a
 *     rejection, never an acceptance (the project generation contract).
 *
 * THE MEASURED STREAM (probe, this machine, 2026-10; the numbers the
 * budgets and tier bands below are derived from; the four
 * pre-implementation measurement lanes' figures reproduce where the
 * mechanics match — balance rates and catalogue-solve rates agree within
 * sample noise — and the one place they did NOT is recorded in repair.ts:
 * the guided move set is the FULL planted-blank recolour space, not the
 * counterexample-sourced subset):
 *
 *     metric                  n = 6          n = 8          n = 10
 *     mine-balance rate       1.07%          0.070%         0.0033%
 *     repair conversion       100%           98%            ~80%
 *     repair rounds p50       4              76             ~530
 *     cost/accepted p50       3.6 ms         91 ms          ~5 s
 *     cost/accepted p95       17 ms          0.36 s         ~33 s
 *     base-solve share        8.3%           10%            0%
 *     catalogue-depth0 share  92%            72%            61%
 *     depth-1 cs solvable     100%           100%           100%
 *     largest region          ≤ 51%          ≤ 60%          ≤ 50%
 *
 * (The pre-implementation lanes measured the same shape: balance
 * 1.11%/0.062%/0.012%, base-solve 15.4%/13.3%/0%, depth-0 89/73/50%,
 * depth-1 100% everywhere, largest region 22–51%. Their cost-per-accepted
 * — 1.32 s / 8.0 s / 60 s — does not reproduce: their repair used the
 * counterexample-sourced move set under a different scoring budget, and
 * this implementation is 100–600× cheaper per accepted board at every
 * size with the same grade distribution. Cheaper with the same
 * distribution is not a defect.)
 *
 * NEVER FAIL: generation carries a wall-clock budget (per-size defaults in
 * {@link DEFAULT_GENERATION_BUDGET_MS}, overridable through
 * {@link StarGenerationOptions.timeBudgetMs}). When the budget expires
 * before an accepted board exists, generation falls back to the retired
 * strips-and-sea painting (`paintFallbackConstructionBoard` below) — kept
 * for exactly this purpose — certified by connectivity, the propagation
 * certificate AND the exact counter at every size. The fallback is reported
 * honestly on the board (`fallback: true`); it is a contract-preserving
 * escape hatch, never the primary path.
 *
 * DIFFICULTY TIERS are keyed on the catalogue depth (`measureMinimumBasis`
 * k: how many confinement IDEAS a depth-0 solve needs, −1 = none suffice)
 * and, inside the k = 0 class, on base-propagation waves:
 *
 *  - starter    — k = 0 and shallow (base waves ≤ {@link STAR_STARTER_MAX_WAVES})
 *  - steady     — k = 0 and deep    (base waves  > {@link STAR_STARTER_MAX_WAVES})
 *  - challenging— k = 1 (exactly one confinement idea finishes it)
 *  - expert     — k = 2
 *  - contradiction — k = −1 AND the depth-1 case-split certificate solves
 *    it (only contradiction works; measured csDepth-1 solvability is 100%
 *    at every played size, csTrials ≤ 55)
 *
 * Measured natural distribution of the grade classes and the wave bands
 * derived from it (this machine, 2026-10): the k = 0 pool is 8%/10%/0% of
 * accepted boards at n = 6/8/10 (n = 10's zero is why starter and steady
 * are unreachable there — a MEASURED FACT, recorded in the tests and
 * surfaced through feasibility.ts, never widened away). Within k = 0 the
 * base waves are always ODD (each simultaneous sweep is a full
 * row/column/colour pass) and measure: n = 6 over 30 boards — {3:1, 5:6,
 * 7:12, 9:11}; n = 8 over 30 boards — {5:3, 7:2, 9:12, 11:10, 13:3}. The
 * starter cut ({@link STAR_STARTER_MAX_WAVES} = 6) keeps starter at the
 * old shipped shallow band (waves ≤ 5) and lets steady absorb 7+ —
 * starter/steady split ≈ 23/77 (n = 6) and 10/90 (n = 8) of the k = 0
 * pool. See {@link STAR_STARTER_MAX_WAVES} and the feasibility module for
 * the per-(side, tier) acceptance matrix. Where a class is unreachable at
 * a size that is a MEASURED FACT recorded there and in the tests — the
 * band is never widened to pretend otherwise, and the picker learns it
 * through `feasibility.ts` rather than a generation that silently always
 * falls back. Boards with k = 3, or k = −1 boards the case-split cannot
 * solve, belong to no tier and are rejected back to the stream.
 *
 * DELETED WITH THE OLD CONSTRUCTION (precedent: drift.ts, commit f735a0f —
 * a measured-but-unused module's record belongs in a surviving module doc
 * and a commit message, never in a dormant file):
 *
 *  - `walk.ts` + `walk.test.ts` — the variety/attractor-ladder descent and
 *    its input menus. Its only callers were this file's technique-tier
 *    rejection loop and `feasibility.ts`'s probe, both replaced by the
 *    sampler stream. The witness-concentration finding it encoded (no
 *    sampler can vary the core technique of "base stalls AND one idea
 *    finishes it"; only a contract change can) is exactly why the contract
 *    changed — to the measured tier classes above.
 *  - `signature.ts` + `signature.test.ts` — walk-endpoint signatures. Only
 *    this file consumed them, as report-only data; the new generator ships
 *    no signatures. This file inherits its drift.ts deletion record (see
 *    below).
 *  - `analyze.ts` + `analyze.test.ts` — the original commit's board
 *    analyser, a strict duplicate of `propagate.ts`'s successor. Imported
 *    by nothing except its own test since ddd9cc7; deleted per the repo's
 *    rule against unreachable code.
 *  - The hub-free shaping descent (`shapeSteadyColours`,
 *    `resolveShapedSteadyColours`, `STAR_TIER_SHAPE_GATE`,
 *    `StarShapeBudgetExhaustedError`, `StarTechniqueTierBudgetExhaustedError`)
 *    and the structural shape gate in `structure.ts`
 *    (`StarShapeGate`, `starShapeDefect`, `starShapeSatisfied`, the 40%
 *    share cap, `measureStarStructuralCore`): all existed to rescue the
 *    strips-and-sea shape (the sea hub, measured 91–94% largest region on
 *    starter boards). The spanning-tree construction generates the
 *    interesting shape naturally — measured largest region 22–51% at
 *    n = 6–10 — and the player's ruling 「只要是合法的满足规则的棋局都要有概率被
 *    我们构建出来才行」 retires structural gates outright: difficulty
 *    measurement may reject, shape may not.
 *  - `drift.ts` was deleted earlier (commit f735a0f, MCMC rejection drift,
 *    measured useless); its record lived in signature.ts's module doc and
 *    now lives here.
 *
 * DETERMINISM: every random draw comes from the seeded RNG in a fixed
 * order (`rng.derive('candidate-<i>')` per sampled layout), so same
 * (n, seed, difficulty) ⇒ byte-identical board — with ONE documented
 * exception: when the wall-clock budget expires, WHICH candidate index the
 * stream reached is timing-dependent, so a fallback board is not
 * seed-reproducible. Wall clock gates only when the search gives up, never
 * which board is accepted.
 */

import {
  assertStarBattlePuzzle,
  assertStarBattleSide,
  type StarBattlePuzzle,
} from '../../domain/starBattle'
import { createSeededRandom, type SeededRandom } from '../rng'
import { countStarSolutions } from './count'
import { propagateStarBoard } from './propagate'
import { solveStarCatalogue } from './catalogue'
import { measureMinimumBasis } from './minimumBasis'
import { measureStarBoardStructure } from './structure'
import { admissibleStarPermutation, sampleStarBattleLayout } from './sample'
import { repairStarBattleLayout } from './repair'

export { admissibleStarPermutation }

/** The difficulty tiers, in progression order. */
export type StarDifficulty =
  | 'starter'
  | 'steady'
  | 'challenging'
  | 'expert'
  | 'contradiction'

/** All tiers in progression order. */
export const STAR_DIFFICULTIES: readonly StarDifficulty[] = [
  'starter',
  'steady',
  'challenging',
  'expert',
  'contradiction',
]

export interface StarGenerationRequest {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarDifficulty
}

export interface StarGeneratedBoard {
  readonly puzzle: StarBattlePuzzle
  /**
   * The measured wave count of the accepted board — the depth metric. It
   * is the base propagation's waves for k = 0 boards (starter/steady), the
   * minimum-basis witness run's waves for k ≥ 1 (challenging/expert), and
   * the depth-1 case-split run's waves for k = −1 (contradiction).
   */
  readonly waves: number
  readonly difficulty: StarDifficulty
  /**
   * Case-split passes and assumption trials the contradiction certificate
   * used. Absent on every other tier (no case-splitting runs there).
   */
  readonly csPasses?: number
  readonly csTrials?: number
  /**
   * True when this board came from the budget-expiry fallback (the retired
   * strips-and-sea painting) rather than the spanning-tree stream. The
   * fallback satisfies the full generation contract — connectivity, an
   * independent uniqueness proof, valid planted solution — but its shape
   * is the old construction's, and honesty about that is cheaper than
   * hiding it.
   */
  readonly fallback?: boolean
}

/**
 * The phases the generation stream moves through. `sampling` covers the
 * mine-balance filter, `repairing` the guided recolouring rounds, and
 * `grading` the catalogue-depth measurement and tier match.
 */
export type StarGenerationPhase = 'sampling' | 'repairing' | 'grading'

/**
 * A progress snapshot. `candidates` is a TRUTHFUL count of sampled layouts
 * actually examined (balance-rejected, repair-abandoned and
 * grade-rejected layouts all count — the surface shows "candidates
 * tried"). No percentage and no invented denominator is ever reported.
 */
export interface StarGenerationProgress {
  readonly candidates: number
  readonly accepted: number
  readonly phase: StarGenerationPhase
}

export interface StarGenerationOptions {
  /**
   * Optional progress listener. Called on every phase change and on every
   * examined candidate. A listener that THROWS is swallowed (and
   * generation continues): progress reporting is a courtesy to the
   * surface, never a way to corrupt or abort a generation — a broken
   * listener degrades the progress display, not the puzzle.
   */
  readonly onProgress?: (progress: StarGenerationProgress) => void
  /**
   * Wall-clock budget for the whole generation call, in milliseconds. On
   * expiry the budget-preserving fallback board is returned. Defaults to
   * {@link DEFAULT_GENERATION_BUDGET_MS} for the requested side.
   */
  readonly timeBudgetMs?: number
}

/**
 * Per-side default generation budgets, chosen from the measured cost per
 * accepted board (probe, this machine, 2026-10 — the module doc's stream
 * table): p50/p95 ≈ 3.6 ms / 17 ms at n = 6, ≈ 91 ms / 0.36 s at n = 8,
 * ≈ 5 s / 33 s at n = 10. The player has approved a 16 s default
 * experience and knows n = 10 is slower: n ≤ 8 stay inside ~15 s (hundreds
 * to thousands of × the p50 — the fallback is a tail event, not the mode)
 * and n ≥ 9 inside ~90 s (≈ 3× the n = 10 p95), so the worst case is
 * bounded and generation NEVER exceeds the approved envelope.
 */
export function defaultStarGenerationBudgetMs(n: number): number {
  assertStarBattleSide(n)
  return n >= 9 ? 90_000 : 15_000
}

/**
 * The starter/steady wave cut inside the k = 0 class: starter takes base
 * waves ≤ 6 (i.e. the measured odd-wave values 3 and 5), steady takes 7+.
 * Derived from 30 k = 0 boards per side (probe, this machine, 2026-10 —
 * the construct.ts module doc has the histogram): the cut keeps starter
 * at the old shipped shallow band instead of stretching to claim half the
 * pool, because a starter board the player reads as "trivial" is exactly
 * a ≤ 5-wave collapse; the deeper k = 0 boards are routine-but-long, which
 * is the steady contract.
 */
export const STAR_STARTER_MAX_WAVES = 6

function nowMs(): number {
  return Date.now()
}

/**
 * The measured grade of one unique repaired board. Built lazily by
 * {@link gradeForTier}: the expensive instruments (the 16-subset minimum
 * basis, the depth-1 case-split) run only when the requested tier can
 * still match, so a starter request never pays for a basis measurement.
 */
interface StarGrade {
  readonly baseSolved: boolean
  readonly baseWaves: number
  readonly k: number
  readonly basisWaves: number
  readonly contradiction?: {
    readonly solved: boolean
    readonly waves: number
    readonly csPasses: number
    readonly csTrials: number
  }
}

/**
 * The grade facts the tier predicate reads. Deliberately minimal —
 * generation's fuller {@link StarGrade} and the feasibility probe's
 * partial grade both satisfy it, and the predicate never sees (or needs)
 * waves/csTrials beyond the solved flag.
 */
export interface StarTierGrade {
  readonly baseSolved: boolean
  readonly baseWaves: number
  readonly k: number
  readonly contradiction?: { readonly solved: boolean }
}

/**
 * The tier acceptance predicate on a measured grade — the whole tier
 * contract in one place, shared by generation (rejection sampling) and
 * feasibility (per-candidate acceptance measurement), so the picker can
 * never disagree with the generator.
 */
export function starTierAcceptsGrade(difficulty: StarDifficulty, grade: StarTierGrade): boolean {
  switch (difficulty) {
    case 'starter':
      return grade.baseSolved && grade.baseWaves <= STAR_STARTER_MAX_WAVES
    case 'steady':
      return grade.baseSolved && grade.baseWaves > STAR_STARTER_MAX_WAVES
    case 'challenging':
      return grade.k === 1
    case 'expert':
      return grade.k === 2
    case 'contradiction':
      return grade.k === -1 && grade.contradiction?.solved === true
  }
}

/**
 * The wave count a grade reports on its board: the witness run's waves —
 * base waves for k = 0, basis witness waves for k ≥ 1, case-split waves
 * for k = −1. Always a positive integer on an accepted grade.
 */
function gradeWaves(grade: StarGrade): number {
  if (grade.k === 0) {
    return grade.baseWaves
  }
  if (grade.k === -1) {
    return grade.contradiction?.waves ?? grade.basisWaves
  }
  return grade.basisWaves
}

/**
 * Measure (lazily) the grade facts the requested tier needs, and accept or
 * reject the board against {@link starTierAcceptsGrade}. Returns the
 * accepted board data, or `null` when the candidate is rejected back to
 * the stream.
 */
function gradeForTier(
  colours: Uint8Array,
  n: number,
  difficulty: StarDifficulty,
): { readonly waves: number; readonly csPasses?: number; readonly csTrials?: number } | null {
  const base = propagateStarBoard(colours, n)

  // starter/steady need nothing beyond the base run.
  if (difficulty === 'starter' || difficulty === 'steady') {
    const grade = { baseSolved: base.solved, baseWaves: base.waves, k: base.solved ? 0 : 1, basisWaves: base.waves }
    if (!starTierAcceptsGrade(difficulty, grade)) {
      return null
    }
    return { waves: base.waves }
  }

  // Technique tiers: the minimum basis is the contract. (For a base-solved
  // board this returns k = 0 without the subset enumeration, so the common
  // reject path stays cheap.)
  const basis = measureMinimumBasis(colours, n)
  let contradiction: StarGrade['contradiction']
  if (difficulty === 'contradiction' && basis.k === -1) {
    const certified = solveStarCatalogue(colours, n, { csDepth: 1 })
    contradiction = {
      solved: certified.solved,
      waves: certified.waves,
      csPasses: certified.csPasses,
      csTrials: certified.csTrials,
    }
  }
  const grade: StarGrade = {
    baseSolved: base.solved,
    baseWaves: base.waves,
    k: basis.k,
    basisWaves: basis.waves,
    contradiction,
  }
  if (!starTierAcceptsGrade(difficulty, grade)) {
    return null
  }
  const result: { waves: number; csPasses?: number; csTrials?: number } = { waves: gradeWaves(grade) }
  if (grade.contradiction !== undefined) {
    result.csPasses = grade.contradiction.csPasses
    result.csTrials = grade.contradiction.csTrials
  }
  return result
}

/**
 * Generates a Star Battle puzzle for the requested side, seed and
 * difficulty.
 *
 * The primary path is the spanning-tree stream (module doc): sample a
 * mine-balanced layout, repair it to exact uniqueness, grade it against
 * the requested tier, and rejection-sample until one matches — all inside
 * the wall-clock budget (per-side default, or `options.timeBudgetMs`).
 * When the budget expires, the strips-and-sea fallback board is returned
 * (`fallback: true`) instead of failing: generation NEVER fails.
 *
 * Progress: `options.onProgress` receives a snapshot on every phase change
 * and every examined candidate; a throwing listener is swallowed.
 *
 * Determinism: same (n, seed, difficulty) ⇒ byte-identical board whenever
 * no fallback runs; a fallback board depends on how many candidates the
 * wall clock allowed before expiry and is not seed-reproducible.
 */
export function generateStarBattle(
  request: StarGenerationRequest,
  options?: StarGenerationOptions,
): StarGeneratedBoard {
  const { n, difficulty } = request
  assertStarBattleSide(n)
  if (!STAR_DIFFICULTIES.includes(difficulty)) {
    throw new TypeError(
      `difficulty must be one of ${STAR_DIFFICULTIES.join(', ')}; received ${String(difficulty)}`,
    )
  }
  if (typeof request.seed !== 'number' || !Number.isSafeInteger(request.seed)) {
    throw new TypeError(`seed must be a safe integer; received ${String(request.seed)}`)
  }
  if (options?.timeBudgetMs !== undefined) {
    if (!Number.isSafeInteger(options.timeBudgetMs) || options.timeBudgetMs < 0) {
      throw new RangeError(`timeBudgetMs must be a nonnegative integer; received ${String(options.timeBudgetMs)}`)
    }
  }

  const rng = createSeededRandom(request.seed)
  const budgetMs = options?.timeBudgetMs ?? defaultStarGenerationBudgetMs(n)
  const deadline = nowMs() + budgetMs
  const emit = (progress: StarGenerationProgress): void => {
    try {
      options?.onProgress?.(progress)
    } catch {
      // A throwing listener must never corrupt generation (documented on
      // StarGenerationOptions.onProgress): swallowed by contract.
    }
  }
  const state = { candidates: 0, accepted: 0, phase: 'sampling' as StarGenerationPhase }
  const emitPhase = (phase: StarGenerationPhase): void => {
    if (state.phase !== phase) {
      state.phase = phase
      emit({ ...state })
    }
  }

  for (;;) {
    if (nowMs() >= deadline) {
      // Budget expired: the fallback board honours the full contract.
      // Report the sampling state one last time so the surface's counter
      // matches what actually happened.
      emit({ ...state })
      return paintFallbackConstructionBoard({ n, seed: request.seed, difficulty, rng })
    }

    const candidateRng = rng.derive(`candidate-${state.candidates}`)
    emitPhase('sampling')
    const layout = sampleStarBattleLayout(n, candidateRng)
    state.candidates += 1
    emit({ ...state })
    if (layout === null) {
      continue
    }

    emitPhase('repairing')
    const repaired = repairStarBattleLayout({
      n,
      colours: layout.colours,
      solution: layout.solution,
      rng: candidateRng,
      wallClockMs: Math.max(0, deadline - nowMs()),
    })
    if (repaired === null) {
      continue
    }

    // The acceptance gate, verbatim from the generation contract: exact
    // uniqueness, and a budget-exhausted (or here: any non-1) count is a
    // rejection. Repair's terminal round already proved count = 1 exactly;
    // this is the independent re-proof on the final colouring.
    if (countStarSolutions(repaired.colours, n, 2) !== 1) {
      continue
    }

    emitPhase('grading')
    const accepted = gradeForTier(repaired.colours, n, difficulty)
    if (accepted === null) {
      continue
    }
    state.accepted += 1

    const puzzle: StarBattlePuzzle = {
      n,
      seed: request.seed,
      colours: repaired.colours,
      solution: layout.solution,
    }
    // Shape, colour grid and planted solution re-validated before the
    // board leaves the engine (n, byte length, colour range, permutation,
    // admissibility, pairwise-distinct star colours).
    assertStarBattlePuzzle(puzzle)
    emit({ ...state })

    const result: { waves: number; difficulty: StarDifficulty; csPasses?: number; csTrials?: number } = {
      waves: accepted.waves,
      difficulty,
    }
    if (accepted.csPasses !== undefined) {
      result.csPasses = accepted.csPasses
    }
    if (accepted.csTrials !== undefined) {
      result.csTrials = accepted.csTrials
    }
    return Object.freeze({ puzzle, ...result })
  }
}

// ---------------------------------------------------------------------------
// The strips-and-sea fallback (budget expiry only).
// ---------------------------------------------------------------------------

/**
 * The strip set S ⊆ {1..n-2} for the fallback painting: which regions
 * (other than the absorber sea) grow a horizontal strip into the row above
 * their star. The fallback always paints the full strip set — the most
 * constrained, most reliably certified painting; it is an escape hatch,
 * not a difficulty instrument.
 */
function fallbackStripSet(n: number): ReadonlySet<number> {
  return new Set(Array.from({ length: Math.max(0, n - 2) }, (_, index) => index + 1))
}

/**
 * Draws an admissible permutation with {T[0], T[1]} = {0, n-1} — the
 * "absorbing" endpoints the sea-connectivity proof needs. Only called for
 * n ≥ 6, where such permutations exist. The two anchor columns are placed
 * at rows 0 and 1 in random order and the remaining columns shuffled into
 * rows 2..n-1, rejecting any draw whose adjacent pairs violate
 * admissibility. Rejection sampling driven by the seeded RNG, so a seed
 * reproduces its board.
 */
function absorbingStarPermutation(n: number, rng: SeededRandom): readonly number[] {
  for (;;) {
    const columns = new Array<number>(n)
    columns[0] = rng.nextInt(2) === 0 ? 0 : n - 1
    columns[1] = columns[0] === 0 ? n - 1 : 0
    const rest: number[] = []
    for (let column = 1; column < n - 1; column += 1) {
      rest.push(column)
    }
    for (let index = rest.length - 1; index > 0; index -= 1) {
      const pick = rng.nextInt(index + 1)
      const swap = rest[index]
      rest[index] = rest[pick]
      rest[pick] = swap
    }
    for (let row = 2; row < n; row += 1) {
      columns[row] = rest[row - 2]
    }
    let admissible = true
    for (let row = 0; row + 1 < n; row += 1) {
      if (Math.abs(columns[row] - columns[row + 1]) < 2) {
        admissible = false
        break
      }
    }
    if (admissible) {
      return columns
    }
  }
}

/**
 * Paints the connected strips-and-sea construction for n ≥ 6: star cells
 * take colour r; region s paints the interval between T[s-1] and T[s] in
 * row s-1 (minus the star column); everything else is the absorber sea
 * n-1. Every decoy obeys the validity rule (the old module doc's
 * construction proof), so the propagation certificate applies. Consumes no
 * RNG — attempts differ only by the sampled T.
 */
function paintConnectedColours(
  n: number,
  permutation: readonly number[],
  strips: ReadonlySet<number>,
): Uint8Array {
  const colours = new Uint8Array(n * n).fill(n - 1)
  for (let row = 0; row < n; row += 1) {
    colours[row * n + permutation[row]] = row
  }
  for (const strip of strips) {
    const row = strip - 1
    const low = Math.min(permutation[row], permutation[strip])
    const high = Math.max(permutation[row], permutation[strip])
    for (let column = low; column <= high; column += 1) {
      if (column !== permutation[row]) {
        colours[row * n + column] = strip
      }
    }
  }
  return colours
}

/**
 * Paints the structured n = 4, 5 fallback: the sea plus star cells, and
 * region k a domino whose decoy is blanked by an earlier star — either
 * directly above the star (parent k - 1, blanked by the previous star's
 * row exclusion) or horizontally adjacent in a column owned by a star in
 * an earlier row (parent p < k, blanked by that star's column exclusion).
 * Both shapes satisfy the validity rule with room to spare, so the
 * propagation certificate applies. The parent choice is driven by the
 * seeded RNG.
 */
function paintSmallSideColours(
  n: number,
  permutation: readonly number[],
  rng: SeededRandom,
): Uint8Array {
  const colours = new Uint8Array(n * n).fill(n - 1)
  for (let row = 0; row < n; row += 1) {
    colours[row * n + permutation[row]] = row
  }
  const rowOfColumn = new Int16Array(n)
  for (let row = 0; row < n; row += 1) {
    rowOfColumn[permutation[row]] = row
  }
  const taken = new Set<number>()
  for (let region = 1; region <= n - 2; region += 1) {
    const options: number[] = []
    const above = (region - 1) * n + permutation[region]
    options.push(above)
    for (const delta of [-1, 1]) {
      const column = permutation[region] + delta
      if (column >= 0 && column < n && rowOfColumn[column] < region) {
        options.push(region * n + column)
      }
    }
    const free = options.filter((index) => !taken.has(index))
    if (free.length === 0) {
      continue
    }
    const pick = free[rng.nextInt(free.length)]
    colours[pick] = region
    taken.add(pick)
  }
  return colours
}

/**
 * The structural connectivity safety net: true iff every colour in the
 * grid forms exactly one 4-connected component. One flood-fill pass
 * launches at most one search per colour; a second launch for any colour
 * means a disconnected region.
 */
function regionsConnected(colours: Uint8Array, n: number): boolean {
  const seen = new Uint8Array(n * n)
  const launches = new Uint8Array(n)
  for (let start = 0; start < n * n; start += 1) {
    if (seen[start] !== 0) {
      continue
    }
    const region = colours[start]
    launches[region] += 1
    if (launches[region] > 1) {
      return false
    }
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const cell = stack.pop() as number
      const row = (cell / n) | 0
      const column = cell % n
      if (row > 0 && seen[cell - n] === 0 && colours[cell - n] === region) {
        seen[cell - n] = 1
        stack.push(cell - n)
      }
      if (row + 1 < n && seen[cell + n] === 0 && colours[cell + n] === region) {
        seen[cell + n] = 1
        stack.push(cell + n)
      }
      if (column > 0 && seen[cell - 1] === 0 && colours[cell - 1] === region) {
        seen[cell - 1] = 1
        stack.push(cell - 1)
      }
      if (column + 1 < n && seen[cell + 1] === 0 && colours[cell + 1] === region) {
        seen[cell + 1] = 1
        stack.push(cell + 1)
      }
    }
  }
  return true
}

/**
 * The NEVER-FAIL fallback: the retired strips-and-sea painting, kept for
 * exactly this purpose (module doc). Attempts are drawn from a seeded
 * stream derived from the request seed; an attempt ships only when BOTH
 * connectivity nets (this file's flood fill and structure.ts's
 * union-find), the propagation certificate AND the exact counter all
 * agree. The strip construction is theorem-backed — validity-rule
 * compliance makes the propagation certificate a uniqueness proof — so
 * the loop terminates on the first attempts in practice; the iteration
 * cap exists so a bug fails loudly as an internal invariant violation
 * instead of looping forever.
 */
function paintFallbackConstructionBoard(request: {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarDifficulty
  readonly rng: SeededRandom
}): StarGeneratedBoard {
  const { n, difficulty } = request
  const strips = fallbackStripSet(n)
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const attemptRng = request.rng.derive(`fallback-paint-${attempt}`)
    let permutation: readonly number[]
    let colours: Uint8Array
    if (n >= 6) {
      permutation = absorbingStarPermutation(n, attemptRng)
      colours = paintConnectedColours(n, permutation, strips)
    } else {
      permutation = admissibleStarPermutation(n, attemptRng)
      colours = paintSmallSideColours(n, permutation, attemptRng)
    }

    if (!regionsConnected(colours, n)) {
      continue
    }
    const structure = measureStarBoardStructure(colours, n)
    if (!structure.connected) {
      throw new Error(
        `star battle fallback invariant violated: union-find disagrees with the flood fill (n=${n}, seed=${request.seed})`,
      )
    }
    const certified = propagateStarBoard(colours, n)
    if (!certified.solved) {
      // The theorem says every validity-rule-compliant colouring solves.
      // Reaching this line is a bug in this module, not a hard puzzle.
      throw new Error(
        `star battle fallback invariant violated: painted board failed the propagation certificate (n=${n}, seed=${request.seed}, attempt=${attempt})`,
      )
    }
    // The generation contract's primary gate, verbatim: the exact counter
    // must prove exactly one solution. For these paintings it always
    // agrees with the certificate; running it at every size (not just
    // n ≤ 5) is the belt to the certificate's braces.
    if (countStarSolutions(colours, n, 2) !== 1) {
      continue
    }

    const puzzle: StarBattlePuzzle = {
      n,
      seed: request.seed,
      colours,
      solution: permutation,
    }
    assertStarBattlePuzzle(puzzle)
    return Object.freeze({
      puzzle,
      waves: certified.waves,
      difficulty,
      fallback: true,
    })
  }
  throw new Error(
    `star battle fallback made no certified board (n=${n}, seed=${request.seed}); the strip construction is theorem-backed, so this is an internal invariant violation`,
  )
}
