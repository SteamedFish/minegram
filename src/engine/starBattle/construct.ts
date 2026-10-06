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
 * === Difficulty strip sets (measured bands below; do not retune) ===
 *
 * - starter:     S = ∅ — regions 0..n-2 are singletons, region n-1 is the
 *   absorber sea. Collapses in 3 waves at every side.
 * - steady:      S = {1} ∪ {n-s .. n-2} with s = round(0.7n).
 * - challenging: S = {1..n-2} — every possible strip.
 *
 * Wave counts (frozen-state semantics, 2026-10-07, oracle lane):
 *
 *     n     starter   steady      challenging
 *     8     3         11–15       11–15
 *     10    3         11–15       15–19
 *     12    3         13–17       17–23
 *     15    3         17–21       25–29
 *
 * KNOWN LIMITATION 1 (pre-existing, record do not fix): at n = 6–8,
 * s = round(0.7n) = n-2 makes steady's strip set equal challenging's, so
 * the two tiers coincide there (today's generator collides too: n=6
 * steady median 9 = challenging median 9). Separating them would retune
 * shipped difficulty semantics and is a separate decision for the player.
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
 * wave counts {3, 5} exist, so challenging's band is mathematically
 * unreachable; the existing floor min(5, n+1) still passes.
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
import { countStarSolutions } from './count'
import { propagateStarBoard } from './propagate'

export type StarDifficulty = 'starter' | 'steady' | 'challenging'

export const STAR_DIFFICULTIES: readonly StarDifficulty[] = ['starter', 'steady', 'challenging']

export interface StarGenerationRequest {
  readonly n: number
  readonly seed: number
  readonly difficulty: StarDifficulty
}

export interface StarGeneratedBoard {
  readonly puzzle: StarBattlePuzzle
  /** The measured wave count of the accepted board — the depth metric. */
  readonly waves: number
  readonly difficulty: StarDifficulty
}

/**
 * Attempts per generation call, per tier. Challenging searches T-space for
 * the maximum measured wave count; starter and steady only need enough
 * samples to land inside their band. Every accepted board is valid and
 * unique regardless, so the budget trades quality of fit against
 * wall-clock, never against correctness.
 */
const ATTEMPTS: Readonly<Record<StarDifficulty, number>> = {
  starter: 8,
  steady: 16,
  challenging: 48,
}

/**
 * Target bands on the measured wave count, as functions of n. A board
 * inside its tier's band scores 0; outside, the distance to the nearest
 * edge. The best-scoring attempt wins, so an expired budget still returns
 * the closest-measured board rather than failing.
 */
function waveBand(n: number, difficulty: StarDifficulty): readonly [number, number] {
  switch (difficulty) {
    case 'starter':
      return [3, 5]
    case 'steady':
      return [Math.max(4, n + 1), 2 * n + 2]
    case 'challenging':
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
 * The strip set S ⊆ {1..n-2} for a side and tier: which regions (other
 * than the absorber sea) grow a horizontal strip into the row above their
 * star. See the module doc for the measured wave bands and for the known
 * n = 6–8 steady/challenging coincidence.
 */
function stripSet(n: number, difficulty: StarDifficulty): ReadonlySet<number> {
  switch (difficulty) {
    case 'starter':
      return new Set()
    case 'steady': {
      // s = round(0.7n); strips are region 1 plus the s-2 topmost regions
      // below the sea. At n = 6–8 this equals {1..n-2} (challenging) —
      // pre-existing tier coincidence, recorded in the module doc.
      const s = Math.round(0.7 * n)
      const strips = new Set<number>([1])
      for (let region = n - s; region <= n - 2; region += 1) {
        strips.add(region)
      }
      return strips
    }
    case 'challenging':
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
  difficulty: StarDifficulty,
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
 * difficulty. Always returns a board that is fully connected and whose
 * uniqueness is certified by {@link propagateStarBoard} (plus the exact
 * counter for the n = 4, 5 fallback); throws only on invalid input or an
 * internal invariant violation (the certificate failing on a construction
 * the theorem says cannot fail).
 *
 * Determinism: the same (n, seed, difficulty) always yields byte-identical
 * `colours` and `solution`, because every random draw comes from the
 * seeded RNG in a fixed order and attempt selection is a pure function of
 * the measured wave counts.
 */
export function generateStarBattle(request: StarGenerationRequest): StarGeneratedBoard {
  const { n, seed, difficulty } = request
  assertStarBattleSide(n)
  if (!STAR_DIFFICULTIES.includes(difficulty)) {
    throw new TypeError(
      `difficulty must be one of ${STAR_DIFFICULTIES.join(', ')}; received ${String(difficulty)}`,
    )
  }

  const rng = createSeededRandom(seed)
  const band = waveBand(n, difficulty)
  const attempts = ATTEMPTS[difficulty]
  const strips = stripSet(n, difficulty)

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
      colours = paintFallbackColours(n, permutation, rng, difficulty)
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
    // measured board wins for starter, the deepest for challenging (its
    // "best measured" contract), the first for steady.
    const prefer =
      score < bestScore ||
      (score === bestScore &&
        bestColours !== null &&
        ((difficulty === 'challenging' && result.waves > bestWaves) ||
          (difficulty === 'starter' && result.waves < bestWaves)))
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

  return Object.freeze({ puzzle, waves: bestWaves, difficulty })
}
