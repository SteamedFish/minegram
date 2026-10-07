/**
 * Star Battle constructive generator — connected-region construction.
 *
 * Player requirement (2026-10-07): 「同一颜色的格子组成的色块全部连续，
 * 不分裂」 — every colour's cells must form ONE 4-connected region. The
 * previous chain painting failed this on every measured board (0/40 fully
 * connected at every tier), because a horizontal strip with a hole at the
 * star column is two components whenever the star is interior. The
 * construction below was proved and machine-validated by the oracle lane;
 * the tests here pin its invariants instead of re-deriving it.
 *
 * === The construction (n >= 6) ===
 *
 * Proof order σ is the identity: the star of region r is planted at
 * (r, T[r]) and painted colour r, where T is an admissible column
 * permutation (|T[r] - T[r+1]| ≥ 2) with {T[0], T[1]} = {0, n-1}.
 * Such a T exists for every n ≥ 6 and none for n = 4 or 5 (proven by
 * enumeration); it is drawn by rejection sampling from the seeded RNG.
 *
 * A strip set S ⊆ {1..n-2} is chosen per difficulty, and the board is
 * painted:
 *
 *     colour(r, T[r]) = r                                        (star)
 *     for s in S, row k = s - 1:
 *         for c in [min(T[k], T[s]) .. max(T[k], T[s])], c != T[k]:
 *             colour(k, c) = s                                   (strip)
 *     every unpainted cell: colour = n - 1                       (sea)
 *
 * Why uniqueness is FREE (this is the load-bearing property; do not trade
 * it away). A strip decoy (k, c) -> region s satisfies the validity rule
 * s ≥ min(pos[k], pos[s']) + 1 = min(k, s') + 1 for s' = rowOfColumn[c],
 * which is always true. A sea cell (r, c) -> n-1 satisfies
 * n-1 ≥ min(r, s') + 1 because c != T[r] forces s' ≠ r and two distinct
 * rows cannot both be n-1. Every colouring here obeys the validity rule
 * (any decoy may independently take any k in
 * [min(pos[r], pos[s]) + 1, n - 1] and uniqueness is invariant under that
 * choice — see the previous module doc for the induction), so compliance
 * under that rule is what certifies uniqueness by propagation. The
 * certificate is NOT weakened by the connectedness requirement.
 *
 * Why connectivity holds. Strip s is an interval containing column T[s],
 * so the star at (s, T[s]) attaches to it vertically at (s-1, T[s]) — one
 * component per stripped region. The sea is connected because every strip
 * row k ≥ 1 has both flanks nonempty under {T[0], T[1]} = {0, n-1} (left
 * flanks share column 0, right flanks share column n-1) and singleton rows
 * contribute full-rows-minus-star whose star holes are pairwise
 * non-adjacent by admissibility. The one trap the proof had to rule out —
 * region 2's strip disconnects when region 1 is a singleton and
 * T[2] ∈ {1, n-2} — is NOT trusted to the analysis: after painting, the
 * generator counts 4-connected components per region and REJECTS any board
 * that is not fully connected, then resamples. The structural check is the
 * safety net, required, not optional.
 *
 * === Difficulty tiers (redefined 2026-10-07, measured bands below) ===
 *
 * Four tiers, two construction tiers solved by the base rules alone and
 * two technique tiers the base rules cannot touch:
 *
 * - starter:     S = ∅ — regions 0..n-2 are singletons, region n-1 is the
 *   absorber sea. Base rules solve it; collapses in 3 waves at every side.
 *   (Unchanged from the original three-tier scheme.)
 * - steady:      S = {1..n-2} — every possible strip; the deepest
 *   construction the theorem certifies. Base rules solve it. This IS the
 *   old 'challenging' behaviour and wave bands, moved down one step.
 * - challenging: base rules place ZERO stars, and the minimum confinement
 *   basis ({@link measureMinimumBasis}) is exactly 1: one catalogue
 *   technique idea (line confinement, box confinement, or shadow) is
 *   necessary and sufficient. Boards come from {@link walkStarBattleBoard}
 *   with rejection on k.
 * - expert:      base rules place ZERO stars, and the minimum confinement
 *   basis is exactly 2: no single technique suffices, some pair of ideas
 *   does. Rejection on k = 2 over the same walk stream.
 * - contradiction: the FULL depth-0 confinement catalogue (base + c1..c4)
 *   places ZERO stars — no pure-deduction subset can start the board
 *   (k = -1) — and the csDepth:1 certificate still solves it. Boards come
 *   from the walk with its easiness meter switched to 'confinement', so
 *   the descent stops only when every confinement technique together
 *   places nothing; the k = -1 target is then verified by the explicit
 *   16-subset enumeration inside {@link measureMinimumBasis}, never
 *   inferred from the certificate (the acceptance trap).
 *
 * Construction wave counts (frozen-state semantics, 2026-10-07, oracle
 * lane):
 *
 *     n     starter   steady
 *     8     3         11–15
 *     10    3         15–19
 *     12    3         17–23
 *     15    3         25–29
 *
 * (steady inherits the old challenging column). Technique tiers report the
 * FULL-CATALOGUE wave count of the accepted board, not a base count — the
 * base subset places nothing on them by definition.
 *
 * Measured in the walk stream (2026-10-07, seeds documented in
 * minimumBasis tests and construct tests): k = 1 acceptance is ~75–92%
 * (challenging usually lands on the first walk); k = 2 is ~8% at n = 15
 * (~12 walks median, worst observed 18) and ~17% at n = 5. k = -1 boards
 * (no confinement subset solves; see minimumBasis.ts) DO occur in the
 * stream — measured at n = 8, 10 — and are rejected by both technique
 * tiers; a "requires contradiction" tier would target exactly them. At n =
 * 4 no k = 2 board was observed in 40 walks, so expert at n = 4 honestly
 * exhausts its budget and throws {@link StarTechniqueTierBudgetExhaustedError}
 * instead of returning an off-target board.
 *
 * Walk wall-clock (measured, load-bearing for the budgets below): median
 * ~55 ms at n = 10, ~562 ms at n = 15 (max observed 1,586 ms) — tens of
 * milliseconds at small n only. A single technique-tier generation is
 * therefore ~12 walks ≈ 7 s median for expert at n = 15. Budgets:
 * {@link TECHNIQUE_WALK_ATTEMPTS} walks or
 * {@link TECHNIQUE_TIER_WALL_CLOCK_MS} wall-clock, whichever first;
 * exceeding either throws the typed error. Wall clock gates only when the
 * search gives up, never which board is accepted, so determinism holds.
 *
 * k alone is not the whole difficulty axis (third human reference board,
 * n = 10, rated 非常有趣: also minBasis = 1, witness c2, but the witness
 * solve takes 13 waves where generated k = 1 boards take ~4–6). The
 * measurement tests therefore report WAVES AT THE MINIMAL BASIS alongside
 * acceptance and wall-clock, per tier and side; a future tuning pass that
 * wants "deep k = 1" boards has the signal ready.
 *
 * KNOWN LIMITATION 1 is RESOLVED by the redefinition: the old n = 6–8
 * steady/challenging strip-set coincidence disappeared because steady now
 * takes the full strip set and challenging no longer reads a strip set at
 * all.
 *
 * === The n = 4, 5 fallback ===
 *
 * No admissible T with {T[0], T[1]} = {0, n-1} exists there (only 2
 * admissible permutations exist at n = 4, 14 at n = 5). A measured
 * rejection-sampling fallback over uniformly-random compliant assignments
 * was tried first and is nearly always disconnected (7/2000 connected at
 * n = 4, 0/2000 at n = 5) — it cannot fill the attempt budget, so the
 * fallback paints a STRUCTURED compliant assignment instead: region k is
 * a domino {star (k, T[k]), one adjacent decoy} whose decoy sits in a
 * column owned by an EARLIER star (parent p < k, region k ≥ min(p, k) + 1
 * = p + 1 ≤ k — compliant) or directly above the star (parent k - 1,
 * blanked by m_{k-1}'s row exclusion — also compliant). Every region is
 * a connected domino by construction; the sea is checked by the same
 * structural flood fill and rejected boards resample. starter paints no
 * decoys (every region a singleton, 3 waves).
 *
 * Measured over every admissible T at n = 4 and 2000 random samples at
 * n = 5: uniqueness 100% (exact counter agrees on every board), sea
 * connectivity 100% at n = 4 (deep shape) / ≈ 69% at n = 5, waves {3, 5}
 * at n = 4 and {5, 7} at n = 5. The exact counter stays in the acceptance
 * path for n ≤ 5 as belt and braces.
 *
 * KNOWN LIMITATION 2 (pre-existing, record do not fix): at n = 4 only
 * wave counts {3, 5} exist, so steady's floor max(6, n + 2) is
 * mathematically unreachable; the global floor min(5, n + 1) still passes.
 * (The limitation moved with the bands from challenging to steady.)
 *
 * Acceptance: a board is accepted only if it is fully connected AND
 * {@link propagateStarBoard} solves it (all n stars placed). For n ≤ 5
 * the exact counter must additionally agree the solution is unique. The
 * theorem guarantees propagation for every validity-rule-compliant
 * colouring, so generation can NEVER fail for a supported side; a failed
 * certificate or counter on an accepted-shape board is an internal
 * invariant violation and throws, never a player-facing failure.
 */
import {
  assertStarBattlePuzzle,
  assertStarBattleSide,
  type StarBattlePuzzle,
} from '../../domain/starBattle'
import { createSeededRandom, type SeededRandom } from '../rng'
import { solveStarCatalogue } from './catalogue'
import { countStarSolutions } from './count'
import { measureMinimumBasis } from './minimumBasis'
import { propagateStarBoard } from './propagate'
import { StarWalkBudgetExhaustedError, walkStarBattleBoard } from './walk'

/**
 * The five difficulty tiers. 'starter' and 'steady' are CONSTRUCTION
 * tiers: the painted board itself obeys the validity rule and the base
 * rules solve it. 'challenging', 'expert' and 'contradiction' are
 * TECHNIQUE tiers: the board is found by descent
 * ({@link walkStarBattleBoard}) and the base rules place nothing on it;
 * what separates them is the minimum confinement basis
 * ({@link measureMinimumBasis}): 1, 2, and -1 (no pure-deduction subset
 * solves; the board requires contradiction).
 */
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

/** The construction tiers: solved by the base rules alone, painted directly. */
type StarConstructionDifficulty = 'starter' | 'steady'

/** The technique tiers: descended, then rejection-sampled on the basis k. */
type StarTechniqueDifficulty = 'challenging' | 'expert' | 'contradiction'

/** True for the technique tiers ('challenging' | 'expert' | 'contradiction'). */
function isTechniqueTier(difficulty: StarDifficulty): difficulty is StarTechniqueDifficulty {
  return (
    difficulty === 'challenging' ||
    difficulty === 'expert' ||
    difficulty === 'contradiction'
  )
}

export interface StarGenerationRequest {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarDifficulty
}

export interface StarGeneratedBoard {
  readonly puzzle: StarBattlePuzzle
  /**
   * The measured wave count of the accepted board — the depth metric. For
   * the construction tiers this is the BASE solver's wave count; for the
   * technique tiers the base solver places nothing, so it is the full-
   * catalogue (base + confinement + case-splitting) wave count.
   */
  readonly waves: number
  readonly difficulty: StarDifficulty
  /**
   * Case-split passes and assumption trials the accepting certificate
   * used. ABSENT for the construction tiers (their acceptance is the base
   * propagation certificate — no case-splitting runs). Reported, with the
   * full measured distribution, for the technique tiers; the
   * 'contradiction' tier's boards are exactly the k = -1 class, so these
   * two numbers are the honest cost meter of "requires contradiction".
   */
  readonly csPasses?: number
  readonly csTrials?: number
}

/**
 * Attempts per construction-tier generation call. Steady searches T-space
 * for the maximum measured wave count (it inherited the old challenging
 * contract); starter only needs enough samples to land inside its band.
 * Every accepted board is valid and unique regardless, so the budget
 * trades quality of fit against wall-clock, never against correctness.
 * Technique tiers budget WALKS instead; see {@link TECHNIQUE_WALK_ATTEMPTS}.
 */
const ATTEMPTS: Readonly<Record<StarConstructionDifficulty, number>> = {
  starter: 8,
  steady: 48,
}

/**
 * Technique-tier budgets: the maximum number of descent walks per
 * generation call, and the maximum wall-clock for the whole rejection
 * loop. Measured against the walk stream (module doc): k = 2 acceptance is
 * ~8% at n = 15, so 48 walks keep the give-up probability under ~2% while
 * the 30 s wall clock bounds the worst case at large sides. Exceeding
 * either throws {@link StarTechniqueTierBudgetExhaustedError}; a search
 * that ran out of budget NEVER returns an off-target board.
 */
const TECHNIQUE_WALK_ATTEMPTS = 48
const TECHNIQUE_TIER_WALL_CLOCK_MS = 30_000

/**
 * The minimum-basis target per technique tier: 'challenging' boards need
 * exactly one confinement technique idea, 'expert' boards need exactly
 * two, 'contradiction' boards need none to suffice (k = -1: only
 * case-splitting solves them).
 */
const TECHNIQUE_TIER_TARGET: Readonly<Record<StarTechniqueDifficulty, number>> = {
  challenging: 1,
  expert: 2,
  contradiction: -1,
}

/**
 * Loud, typed failure when a technique-tier generation exhausts its walk
 * or wall-clock budget before finding a board whose minimum basis hits the
 * tier's target. Never carries a board: partial progress is not a
 * difficulty certificate.
 */
export class StarTechniqueTierBudgetExhaustedError extends Error {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarTechniqueDifficulty
  readonly targetK: number
  readonly walks: number
  /** Minimum basis of the last rejected walk, when one completed. */
  readonly lastK: number | null
  readonly elapsedMs: number
  readonly reason: 'walk-attempts' | 'wall-clock'

  constructor(fields: {
    readonly n: number
    readonly seed: number
    readonly difficulty: StarTechniqueDifficulty
    readonly targetK: number
    readonly walks: number
    readonly lastK: number | null
    readonly elapsedMs: number
    readonly reason: 'walk-attempts' | 'wall-clock'
  }) {
    super(
      `star battle ${fields.difficulty} generation exhausted its ${fields.reason} budget ` +
        `(n=${fields.n}, seed=${fields.seed}, walks=${fields.walks}, ` +
        `targetK=${fields.targetK}, lastK=${String(fields.lastK)}, ` +
        `${fields.elapsedMs.toFixed(1)}ms) without reaching a board of that difficulty`,
    )
    this.name = 'StarTechniqueTierBudgetExhaustedError'
    this.n = fields.n
    this.seed = fields.seed
    this.difficulty = fields.difficulty
    this.targetK = fields.targetK
    this.walks = fields.walks
    this.lastK = fields.lastK
    this.elapsedMs = fields.elapsedMs
    this.reason = fields.reason
  }
}

/**
 * Target bands on the measured base-solver wave count, as functions of n.
 * Construction tiers only: a board inside its tier's band scores 0;
 * outside, the distance to the nearest edge. The best-scoring attempt
 * wins, so an expired budget still returns the closest-measured board
 * rather than failing. Technique tiers have no wave band — they select on
 * the minimum basis instead — and never reach this function.
 */
function waveBand(n: number, difficulty: StarConstructionDifficulty): readonly [number, number] {
  switch (difficulty) {
    case 'starter':
      return [3, 5]
    case 'steady':
      // The old 'challenging' bands, moved down one step.
      return [Math.max(6, n + 2), 2 * n + 4]
  }
}

function bandDistance(waves: number, band: readonly [number, number]): number {
  if (waves < band[0]) {
    return band[0] - waves
  }
  if (waves > band[1]) {
    return waves - band[1]
  }
  return 0
}

/**
 * A uniformly random admissible column permutation (|T[r] - T[r+1]| ≥ 2
 * for every adjacent pair), drawn by rejection from the seeded RNG. The
 * side is validated first: below n = 4 no admissible permutation exists
 * and rejection would loop forever, so the assert is load-bearing, not
 * ceremonial.
 */
export function admissibleStarPermutation(n: number, rng: SeededRandom): readonly number[] {
  assertStarBattleSide(n)
  for (;;) {
    const columns = Array.from({ length: n }, (_, index) => index)
    for (let index = n - 1; index > 0; index -= 1) {
      const pick = rng.nextInt(index + 1)
      const swap = columns[index]
      columns[index] = columns[pick]
      columns[pick] = swap
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
 * The strip set S ⊆ {1..n-2} for a side and construction tier: which
 * regions (other than the absorber sea) grow a horizontal strip into the
 * row above their star. starter paints nothing; steady paints everything
 * (the old challenging painting, moved down one step).
 */
function stripSet(n: number, difficulty: StarConstructionDifficulty): ReadonlySet<number> {
  switch (difficulty) {
    case 'starter':
      return new Set()
    case 'steady':
      return new Set(Array.from({ length: n - 2 }, (_, index) => index + 1))
  }
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
 * Paints the connected construction for n ≥ 6: star cells take colour r;
 * region s in the strip set paints the interval between T[s-1] and T[s]
 * in row s-1 (minus the star column); everything else is the absorber
 * sea n-1. Every decoy obeys the validity rule (module doc), so the
 * propagation certificate applies. Consumes no RNG — attempts differ only
 * by the sampled T.
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
 * Paints the structured n = 4, 5 fallback (module doc): the sea plus star
 * cells, and region k a domino whose decoy is blanked by an earlier star —
 * either directly above the star (parent k - 1, blanked by m_{k-1}'s row
 * exclusion) or horizontally adjacent in a column owned by a star in an
 * earlier row (parent p < k, blanked by m_p's column exclusion). Both
 * shapes satisfy the validity rule with room to spare, so the propagation
 * certificate applies. starter paints no decoys: every non-sea region is
 * a singleton and the board collapses in 3 waves. The parent choice is
 * driven by the seeded RNG; a region with no free decoy cell stays a
 * singleton, which is always legal.
 */
function paintFallbackColours(
  n: number,
  permutation: readonly number[],
  rng: SeededRandom,
  difficulty: StarConstructionDifficulty,
): Uint8Array {
  const colours = new Uint8Array(n * n).fill(n - 1)
  for (let row = 0; row < n; row += 1) {
    colours[row * n + permutation[row]] = row
  }
  if (difficulty === 'starter') {
    return colours
  }
  const rowOfColumn = new Int16Array(n)
  for (let row = 0; row < n; row += 1) {
    rowOfColumn[permutation[row]] = row
  }
  const taken = new Set<number>()
  for (let region = 1; region <= n - 2; region += 1) {
    const options: number[] = []
    // Decoy directly above the star: blanked by the previous star's row
    // exclusion; valid because region >= min(region - 1, region) + 1.
    const above = (region - 1) * n + permutation[region]
    options.push(above)
    // Decoys left and right of the star: compliant iff the neighbouring
    // column's star sits in an earlier row (parent < region), and then
    // blanked by that star's column exclusion.
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
 * Generates a Star Battle puzzle for the requested side, seed and
 * difficulty.
 *
 * Construction tiers ('starter', 'steady') paint the connected strips-and-
 * sea construction directly; acceptance requires full connectivity and a
 * {@link propagateStarBoard} solve (plus the exact counter for the n = 4,
 * 5 fallback), and throws only on invalid input or an internal invariant
 * violation (the certificate failing on a construction the theorem says
 * cannot fail).
 *
 * Technique tiers ('challenging', 'expert', 'contradiction') descend to
 * boards the base rules cannot place a single star on and reject-sample on
 * the minimum confinement basis (1, 2, or -1); see
 * {@link generateTechniqueTierBoard} for the acceptance gates and the
 * typed budget failure.
 *
 * Determinism: the same (n, seed, difficulty) always yields byte-identical
 * `colours` and `solution`. Every random draw comes from the seeded RNG in
 * a fixed order; wall-clock checks gate only when a search gives up, never
 * which board is accepted.
 */
export function generateStarBattle(request: StarGenerationRequest): StarGeneratedBoard {
  const { n, difficulty } = request
  assertStarBattleSide(n)
  if (!STAR_DIFFICULTIES.includes(difficulty)) {
    throw new TypeError(
      `difficulty must be one of ${STAR_DIFFICULTIES.join(', ')}; received ${String(difficulty)}`,
    )
  }
  if (isTechniqueTier(difficulty)) {
    return generateTechniqueTierBoard({ n, seed: request.seed, difficulty })
  }
  return generateConstructionBoard({ n, seed: request.seed, difficulty })
}

/**
 * The construction-tier generator: paints the strips-and-sea construction
 * (or the n = 4, 5 domino fallback) and selects the attempt that best
 * fits the tier's wave band. See the module doc for the construction
 * proof and the measured bands.
 */
function generateConstructionBoard(request: {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarConstructionDifficulty
}): StarGeneratedBoard {
  const { n, seed, difficulty: constructionDifficulty } = request
  const rng = createSeededRandom(seed)
  const band = waveBand(n, constructionDifficulty)
  const attempts = ATTEMPTS[constructionDifficulty]
  const strips = stripSet(n, constructionDifficulty)

  let bestColours: Uint8Array | null = null
  let bestSolution: readonly number[] | null = null
  let bestWaves = 0
  let bestScore = Number.POSITIVE_INFINITY

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let permutation: readonly number[]
    let colours: Uint8Array
    if (n >= 6) {
      permutation = absorbingStarPermutation(n, rng)
      colours = paintConnectedColours(n, permutation, strips)
    } else {
      // n = 4, 5: no absorbing permutation exists; fall back to the
      // structured domino painting (module doc), filtered by connectivity
      // and the exact counter.
      permutation = admissibleStarPermutation(n, rng)
      colours = paintFallbackColours(n, permutation, rng, constructionDifficulty)
    }

    // Structural safety net: every colour one 4-connected component.
    if (!regionsConnected(colours, n)) {
      continue
    }

    const result = propagateStarBoard(colours, n)
    if (!result.solved) {
      // The theorem says every validity-rule-compliant colouring solves.
      // Reaching this line is a bug in this module, not a hard puzzle.
      throw new Error(
        `star battle generation invariant violated: constructed board failed the propagation certificate (n=${n}, seed=${rng.seed}, attempt=${attempt})`,
      )
    }
    if (n <= 5 && countStarSolutions(colours, n, 2) !== 1) {
      // The n = 4, 5 fallback accepts only boards the exact counter agrees
      // are unique; a disagreeing board is an attempt, never an output.
      continue
    }

    const score = bandDistance(result.waves, band)
    // Deterministic tie-break inside an equal band distance: the shallowest
    // measured board wins for starter, the deepest for steady (its
    // "best measured" contract, inherited from the old challenging tier).
    const prefer =
      score < bestScore ||
      (score === bestScore &&
        bestColours !== null &&
        ((constructionDifficulty === 'steady' && result.waves > bestWaves) ||
          (constructionDifficulty === 'starter' && result.waves < bestWaves)))
    if (prefer) {
      bestColours = colours
      bestSolution = permutation
      bestWaves = result.waves
      bestScore = score
    }
  }

  if (bestColours === null || bestSolution === null) {
    // attempts ≥ 1 for every tier, so this is unreachable; it exists so
    // the compiler knows the best* locals are populated below.
    throw new Error('star battle generation made no attempts')
  }

  const puzzle: StarBattlePuzzle = {
    n,
    seed: rng.seed,
    colours: bestColours,
    solution: bestSolution,
  }
  // Shape, colour grid and planted solution re-validated before the board
  // leaves the engine: n, byte length, colour range, permutation,
  // admissibility and pairwise-distinct star colours.
  assertStarBattlePuzzle(puzzle)

  return Object.freeze({ puzzle, waves: bestWaves, difficulty: constructionDifficulty })
}

/**
 * The technique-tier generator ('challenging', 'expert', 'contradiction'):
 * rejection sampling over {@link walkStarBattleBoard} on the minimum
 * confinement basis. Each walk already descends to a board its easiness
 * meter cannot start ('base' for challenging/expert, 'confinement' for
 * contradiction); this loop keeps walking (seeded, derived stream) until
 * one lands on the tier's target k. A walk that exhausts ITS own budget
 * is a rejected sample, not a failure — only this loop's budget is the
 * tier's contract.
 *
 * Acceptance re-verifies every gate with this module's own instruments,
 * independent of the walk's internal checks:
 * - connectivity — {@link regionsConnected}, this file's flood fill, NOT
 *   the walk's `regionStaysConnectedWithout`;
 * - base stalls — {@link propagateStarBoard} (the production base solver)
 *   places zero stars;
 * - uniqueness — the full catalogue with case-splitting depth 1 solves
 *   (a complete sound-rule solve is a uniqueness certificate), plus the
 *   exact counter for n ≤ 5, matching the fallback's belt-and-braces;
 * - difficulty — {@link measureMinimumBasis} returns exactly the tier's
 *   target k.
 *
 * Budget: {@link TECHNIQUE_WALK_ATTEMPTS} walks or
 * {@link TECHNIQUE_TIER_WALL_CLOCK_MS} wall-clock. Exceeding either throws
 * {@link StarTechniqueTierBudgetExhaustedError}; a search that ran out of
 * budget NEVER returns a board that misses its target.
 *
 * Determinism: the walk seeds derive in a fixed order from the request
 * seed, so same (n, seed, difficulty) ⇒ byte-identical board; wall clock
 * gates only when the search gives up, never which walk is accepted.
 */
function generateTechniqueTierBoard(request: {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarTechniqueDifficulty
}): StarGeneratedBoard {
  const { n, seed, difficulty } = request
  const targetK = TECHNIQUE_TIER_TARGET[difficulty]
  const rng = createSeededRandom(seed)
  const startedAt = performance.now()
  let lastK: number | null = null

  for (let walk = 0; walk < TECHNIQUE_WALK_ATTEMPTS; walk += 1) {
    if (performance.now() - startedAt >= TECHNIQUE_TIER_WALL_CLOCK_MS) {
      throw new StarTechniqueTierBudgetExhaustedError({
        n,
        seed: rng.seed,
        difficulty,
        targetK,
        walks: walk,
        lastK,
        elapsedMs: performance.now() - startedAt,
        reason: 'wall-clock',
      })
    }

    let walked: ReturnType<typeof walkStarBattleBoard>
    try {
      walked = walkStarBattleBoard({
        n,
        seed: rng.derive(`technique-walk-${walk}`).seed,
        // 'steady' — the deepest CONSTRUCTION tier — seeds the descent.
        // Seeding from a technique tier would recurse back into this loop.
        seedDifficulty: 'steady',
        // The contradiction tier descends on the confinement meter: stop
        // only when EVERY pure-deduction technique together places
        // nothing. The k = -1 target is then verified explicitly below.
        meter: difficulty === 'contradiction' ? 'confinement' : 'base',
        // Wall clock: the tier's own budget, checked between walks, is the
        // only timing gate the acceptance path may see. The walk's default
        // 5 s budget would let a slow walk give up mid-search under CPU
        // contention and this loop would then accept a DIFFERENT walk —
        // a timing-dependent board. A walk that completes always produces
        // its seeded board; a walk that cannot fit the tier budget ends in
        // the typed error (no board), never an off-seed one.
        wallClockMs: TECHNIQUE_TIER_WALL_CLOCK_MS,
      })
    } catch (error) {
      if (error instanceof StarWalkBudgetExhaustedError) {
        // An individual walk that ran out of budget is a rejected sample.
        continue
      }
      throw error
    }

    // Gate (a): every colour one 4-connected component, by this module's
    // own flood fill rather than the walk's internal gate.
    if (!regionsConnected(walked.colours, n)) {
      continue
    }

    // Gate (b): the base (production) solver places nothing on the board.
    const base = propagateStarBoard(walked.colours, n)
    if (base.solved || base.stars.length !== 0) {
      // The walk's stop condition is basePlaced === 0; reaching this line
      // is an internal invariant violation, reported loudly.
      throw new Error(
        `star battle technique-tier invariant violated: accepted walk board is base-solvable ` +
          `(n=${n}, seed=${rng.seed}, walk=${walk}, placed=${base.stars.length})`,
      )
    }

    // Gate (c): uniqueness certified by the full catalogue + case-splitting
    // (a complete sound-rule solve is a uniqueness certificate), with the
    // exact counter agreeing for the small sides, as in the fallback.
    const certified = solveStarCatalogue(walked.colours, n, { csDepth: 1 })
    if (!certified.solved) {
      throw new Error(
        `star battle technique-tier invariant violated: accepted walk board failed the catalogue certificate ` +
          `(n=${n}, seed=${rng.seed}, walk=${walk})`,
      )
    }
    if (n <= 5 && countStarSolutions(walked.colours, n, 2) !== 1) {
      continue
    }

    // Gate (d): the difficulty target — the minimum confinement basis.
    // THE ACCEPTANCE TRAP, enforced structurally: `measureMinimumBasis`
    // enumerates ALL 16 confinement subsets explicitly and verifies their
    // solving family is upward-closed (throwing on violation) — k is never
    // inferred from the full-catalogue certificate above, which with a
    // non-monotone engine would prove nothing about subset solves. For
    // 'contradiction' the walk's meter guarantees the deepest subset
    // stalls; the enumeration here is the explicit, independent check.
    const basis = measureMinimumBasis(walked.colours, n)
    lastK = basis.k
    if (basis.k !== targetK) {
      continue
    }

    const puzzle: StarBattlePuzzle = {
      n,
      seed: rng.seed,
      colours: walked.colours,
      solution: walked.solution,
    }
    assertStarBattlePuzzle(puzzle)
    // `waves` here is the full-catalogue wave count of the accepted board —
    // the base subset places nothing on a technique tier by definition.
    // `csPasses`/`csTrials` travel with the board: the measured cost of
    // the certificate, reported for the difficulty grader.
    return Object.freeze({
      puzzle,
      waves: certified.waves,
      difficulty,
      csPasses: certified.csPasses,
      csTrials: certified.csTrials,
    })
  }

  throw new StarTechniqueTierBudgetExhaustedError({
    n,
    seed: rng.seed,
    difficulty,
    targetK,
    walks: TECHNIQUE_WALK_ATTEMPTS,
    lastK,
    elapsedMs: performance.now() - startedAt,
    reason: 'walk-attempts',
  })
}
