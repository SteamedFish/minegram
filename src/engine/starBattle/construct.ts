/**
 * Star Battle constructive generator.
 *
 * The construction theorem this module implements (proven by the oracle
 * lane; the tests here pin its invariants instead of re-deriving it):
 *
 * Let T be any admissible permutation (adjacent rows differ by ≥ 2) and
 * let pos[r] be the proof-order index of row r. A decoy — any non-star
 * cell (r, c), s being the row with T[s] == c — may safely be painted
 * region k iff k > pos[r] OR k > pos[s], i.e. k ≥ min(pos[r], pos[s]) + 1.
 * The cell is then provably blank the moment either its own row's star or
 * its column's star is placed, whichever comes first. Star cells are
 * painted colour(r, T[r]) = pos[r]. Every colouring obeying that rule is
 * uniquely solvable: region 0 is the singleton {m_0}; inductively every
 * decoy in region k shares a row or column with an already-forced star
 * while m_k's own row and column stars are both placed exactly at step k
 * (admissibility rules out 8-neighbourhood exclusion by any earlier
 * star), so region k has exactly one viable cell and the colour rule R4
 * forces it. All n stars forced ⇒ the board is UNIQUE.
 *
 * The validity rule is also the ONLY safe degree of freedom: each decoy
 * may independently take any k in [min(pos[r], pos[s]) + 1, n - 1], and
 * uniqueness is invariant under that choice. Difficulty is chosen by
 * biasing k within that interval — this is the measured behaviour of the
 * three biases (frozen-state wave semantics, 24 seeds per cell,
 * 2026-10-07, see construct.test.ts for the live distribution table):
 *
 * - k biased LARGE (n-1 / n-2): every early region stays a singleton, so
 *   wave 1 places most stars and the board collapses in 3–5 waves.
 * - k uniform over the valid range: ≈ 1.7n waves.
 * - k biased SMALL (the minimum valid k, chain-style): each region's
 *   decoys are blanked only by the immediately preceding star, so the
 *   induction unwinds one link per wave — up to ~2n waves, the deepest
 *   measured band.
 *
 * Note this is the OPPOSITE of the brief's prose ("starter biases the
 * smallest valid k"), which measurement refutes: the smallest valid k is
 * the deepest construction, not the shallowest. The brief's wave BANDS
 * (starter ≈ 2–4, chain at n=12 strictly deeper than the shallow
 * fixture) are what the tiers target, and the large-k bias is what
 * actually lands them; the bands below are pinned by tests so a future
 * change to the painting shifts the numbers, not the players.
 *
 * Acceptance: a board is accepted only if {@link propagateStarBoard}
 * solves it (all n stars placed). The theorem guarantees this for every
 * validity-rule-compliant colouring, so generation can NEVER fail for a
 * supported side — difficulty is metadata on an already-unique board, not
 * an acceptance criterion. If the propagation certificate ever fails the
 * module throws: that is an internal invariant violation, never a
 * player-facing "ambiguous board".
 */
import {
  assertStarBattlePuzzle,
  assertStarBattleSide,
  type StarBattlePuzzle,
} from '../../domain/starBattle'
import { createSeededRandom, type SeededRandom } from '../rng'
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
 * Attempts per generation call, per tier. Challenging searches the proof
 * order (and T) space for the maximum measured wave count; starter and
 * steady only need enough samples to land inside their band. Every
 * attempt produces a valid unique board regardless, so the budget trades
 * quality of fit against wall-clock, never against correctness.
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
      return [Math.max(6, Math.floor(1.6 * n)), 2 * n + 4]
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
 * Paints a full colour grid for the given planted permutation and proof
 * order. Star cells take colour pos[row]; every decoy takes a difficulty-
 * biased valid region k ∈ [min(pos[r], pos[s]) + 1, n - 1]. See the
 * module doc for the measured wave behaviour of each bias.
 */
function paintColours(
  n: number,
  permutation: readonly number[],
  pos: readonly number[],
  rng: SeededRandom,
  difficulty: StarDifficulty,
): Uint8Array {
  const colours = new Uint8Array(n * n)
  const rowOfColumn = new Int16Array(n)
  for (let row = 0; row < n; row += 1) {
    rowOfColumn[permutation[row]] = row
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      if (column === permutation[row]) {
        colours[row * n + column] = pos[row]
        continue
      }
      const otherRow = rowOfColumn[column]
      const lowestValid = Math.min(pos[row], pos[otherRow]) + 1
      let region: number
      switch (difficulty) {
        case 'starter':
          // Blend of the two largest valid regions: most early regions
          // stay singletons and the board collapses in a handful of waves.
          region = Math.max(lowestValid, rng.nextInt(2) === 0 ? n - 1 : n - 2)
          break
        case 'steady':
          region = lowestValid + rng.nextInt(n - lowestValid)
          break
        case 'challenging':
          // The smallest valid region: each region's decoys are blanked
          // only by the immediately preceding star, so the induction
          // unwinds one link per wave — the deepest construction.
          region = lowestValid
          break
      }
      colours[row * n + column] = region
    }
  }
  return colours
}

/**
 * Generates a Star Battle puzzle for the requested side, seed and
 * difficulty. Always returns a board whose uniqueness is certified by
 * {@link propagateStarBoard}; throws only on invalid input or an internal
 * invariant violation (the certificate failing on a construction the
 * theorem says cannot fail).
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

  let bestColours: Uint8Array | null = null
  let bestSolution: readonly number[] | null = null
  let bestWaves = 0
  let bestScore = Number.POSITIVE_INFINITY

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const permutation = admissibleStarPermutation(n, rng)
    const identity = Array.from({ length: n }, (_, index) => index)
    for (let index = n - 1; index > 0; index -= 1) {
      const pick = rng.nextInt(index + 1)
      const swap = identity[index]
      identity[index] = identity[pick]
      identity[pick] = swap
    }
    const pos: readonly number[] = identity
    const colours = paintColours(n, permutation, pos, rng, difficulty)
    const result = propagateStarBoard(colours, n)
    if (!result.solved) {
      // The theorem says every validity-rule-compliant colouring solves.
      // Reaching this line is a bug in this module, not a hard puzzle.
      throw new Error(
        `star battle generation invariant violated: constructed board failed the propagation certificate (n=${n}, seed=${rng.seed}, attempt=${attempt})`,
      )
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
