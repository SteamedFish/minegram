/**
 * Star Battle guided repair: the second stage of the spanning-tree
 * construction.
 *
 * A mine-balanced sampled layout (`sample.ts`) is almost never
 * unique-solution — measured uniqueness-among-balanced is 85% at n = 4 and
 * 0% from n = 6 up — so repair, not sampling, is the mechanism that
 * produces a unique board at any played size. Blind repair (random shuffle
 * attempts, or restricting to `counterexample − answer` cells without
 * guidance) false-dead-ends badly: measured 17/46 at n = 6, 11/13 at n = 8
 * and 2/2 at n = 10 of the layouts that DO have a repairable path were
 * abandoned. This module implements the GUIDED variant: enumerate every
 * legal move, evaluate each with the exact counter, and apply the one that
 * minimises the solution count. That measured 53/54 (98%) at n = 6, 13/14
 * (93%) at n = 8 and 2/3 (67%) at n = 10, with median rounds to uniqueness
 * of 3 (n = 6), 18 (n = 8) and ~85 (n = 10).
 *
 * The move, and why it is safe. A legal move recolours ANY cell that is
 * blank in the intended (planted) answer to a colour already present on
 * one of its 4-neighbours, provided the losing region stays one connected
 * component. Restricting the move set to `counterexample − answer` cells
 * (the blind variant's restriction) measured terribly: 55%/31%/14%
 * conversion at n = 6/8/10 with the board usually stuck after 2 rounds —
 * the spanning-tree regions are corridor-like, nearly every cell is an
 * articulation point, and the tiny counterexample-sourced move set hits a
 * wall where every remaining move is refused (measured dead-end anatomy:
 * 2–5 candidate cells, ZERO legal moves, 2–4 solutions left). The guided
 * move set is the full planted-blank cell space: a move that breaks no
 * counterexample still scores "count unchanged" and loses the argmin to
 * any move that does, while remaining available when the counterexample
 * kills dry up — which is exactly how the stuck boards unstick.
 *
 * Why the move keeps the board legal: it keeps the intended answer's
 * per-colour star counts intact (the cell holds no intended star, and no
 * intended star's colour changes), cannot split the gaining region (the
 * recoloured cell attaches to an existing component of its new colour on
 * a neighbour), and the losing region is checked with
 * `regionStaysConnectedWithout` — a vacate that would delete the region
 * entirely is refused, which also keeps every colour present.
 *
 * Guidance: every legal move is scored with the exact solution counter
 * (cap {@link DEFAULT_MOVE_SCORE_CAP} — a saturated "≥ cap" still ranks
 * below a smaller measured count, and the terminal round re-proves exact
 * uniqueness before repair returns); the argmin breaks ties by reservoir
 * sampling on the seeded RNG. Scoring with cap 2 measured as bad as blind
 * search: the gradient cannot tell "9 → 3" from "9 → 8", conversion stays
 * at ~53% and the stream biases toward easy boards (the hard half dies as
 * dead ends). A `limit-exhausted` count is never read as a number (the
 * project generation contract); in practice the counter is
 * sub-millisecond at every supported side — the measured cliff is at
 * n = 14, and `MAX_STAR_SIDE` is 10 — and an exhausted evaluation scores
 * just above the cap rather than being trusted, as defence in depth.
 *
 * Measured with the full move space and cap-16 scoring (2026-10, this
 * machine): see the construct.ts module doc for the stream table. The
 * round cap matters: at n = 10 a 400-round cap converted only ~24% of
 * balanced layouts and the abandoned 76% skewed hard (the deep repairs
 * the k = −1 class needs die at the cap, so the accepted stream read
 * artificially easy); the 1200-round default converts ~80% there at a
 * median repair cost of ~2.7 s (max ~10 s), far inside the generation
 * budget — conversion and an unbiased stream are worth more than a
 * repair-tail wall clock that never binds in practice.
 */

import { assertStarColours } from '../../domain/starBattle'
import { countStarSolutionsWithBudget, findStarSolutions } from './count'
import { regionStaysConnectedWithout } from './structure'
import type { SeededRandom } from '../rng'

/**
 * Outcome of one repair run. `null` means this layout was abandoned —
 * either every reachable round exhausted the round/wall-clock budget, or a
 * round found no legal move at all (a true dead end: some balanced layouts
 * have no single-cell recolour that keeps the structure legal, and the
 * measurement lane called those false dead ends under blind repair but
 * real ones under guided enumeration). Callers resample; abandonment is
 * normal, not exceptional.
 */
export interface StarRepairResult {
  /** The repaired colouring, proven to have exactly one solution. */
  readonly colours: Uint8Array
  /** Guided rounds applied (one round = one applied move). */
  readonly rounds: number
}

export interface StarRepairRequest {
  readonly n: number
  readonly colours: Uint8Array
  /** The planted permutation repair preserves as the unique answer. */
  readonly solution: readonly number[]
  readonly rng: SeededRandom
  /** Hard cap on applied rounds for one layout. Default 1200. */
  readonly maxRounds?: number
  /** Wall-clock cap for one layout, in milliseconds. Default 30_000. */
  readonly wallClockMs?: number
  /**
   * The solution-count cap used to SCORE one candidate move. This is the
   * guidance signal: a saturated count (cap 2) cannot tell "9 → 3
   * solutions" from "9 → 8" — measured with cap 2 the repair converted only
   * ~53%/31%/14% at n = 6/8/10 AND biased the stream toward easy boards
   * (the hard half of the distribution dies as dead ends). A cap of 16
   * keeps the counter sub-millisecond on these nearly-unique boards while
   * restoring the gradient. Default 16.
   */
  readonly moveScoreCap?: number
}

const DEFAULT_MAX_ROUNDS = 1200
const DEFAULT_WALL_CLOCK_MS = 30_000
const DEFAULT_MOVE_SCORE_CAP = 16
// Defence in depth only: the exact counter at n <= 10 finishes in
// milliseconds on these boards, so exhaustion should never happen; if a
// future edit ever lets it happen, the move scores worst-instead-of-best.
const MOVE_EVALUATION_NODE_BUDGET = 50_000_000

function solutionsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false
    }
  }
  return true
}

function neighbourColours(colours: Uint8Array, n: number, cell: number, from: number): number[] {
  const row = (cell / n) | 0
  const column = cell % n
  const candidates = [
    row > 0 ? colours[cell - n] : -1,
    row + 1 < n ? colours[cell + n] : -1,
    column > 0 ? colours[cell - 1] : -1,
    column + 1 < n ? colours[cell + 1] : -1,
  ]
  const distinct: number[] = []
  for (const colour of candidates) {
    if (colour >= 0 && colour !== from && !distinct.includes(colour)) {
      distinct.push(colour)
    }
  }
  return distinct
}

/**
 * Run guided repair on one mine-balanced layout. Deterministic for a given
 * (`colours`, `solution`, rng draw sequence): rounds enumerate candidate
 * moves in a fixed order, evaluate them with the exact counter, and break
 * score ties with the seeded RNG, so a seed reproduces its repaired board.
 * Returns `null` when the layout is abandoned (see {@link StarRepairResult}
 * for the two reasons); the input `colours` is never mutated — the result
 * carries its own copy.
 */
export function repairStarBattleLayout(request: StarRepairRequest): StarRepairResult | null {
  const { n, solution, rng } = request
  assertStarColours(request.colours, n)
  const maxRounds = request.maxRounds ?? DEFAULT_MAX_ROUNDS
  const wallClockMs = request.wallClockMs ?? DEFAULT_WALL_CLOCK_MS
  const moveScoreCap = request.moveScoreCap ?? DEFAULT_MOVE_SCORE_CAP

  const colours = new Uint8Array(request.colours)
  const plantedStar = new Uint8Array(n * n)
  for (let row = 0; row < n; row += 1) {
    plantedStar[row * n + solution[row]] = 1
  }
  const deadline = nowMs() + wallClockMs

  for (let round = 0; round < maxRounds; round += 1) {
    const solutions = findStarSolutions(colours, n, 2)
    if (solutions.length === 1 && solutionsEqual(solutions[0], solution)) {
      return Object.freeze({ colours, rounds: round })
    }
    if (nowMs() >= deadline) {
      return null
    }

    // Enumerate EVERY structure-legal move — any planted-blank cell to any
    // neighbour's colour — and score each with the exact counter. The
    // counterexample-sourced subset alone (the blind variant's move set)
    // measured as a dead-end trap on these corridor-like regions; moves
    // that break no counterexample simply score "count unchanged" and lose
    // the argmin to moves that do, while remaining available when the
    // counterexample kills dry up. The argmin breaks ties by reservoir
    // sampling so a fixed enumeration order cannot bias which move a seed
    // selects.
    let bestScore = Number.POSITIVE_INFINITY
    let best: { readonly cell: number; readonly colour: number } | null = null
    let bestTieCount = 0
    for (let cell = 0; cell < n * n; cell += 1) {
      if (plantedStar[cell] === 1) {
        continue
      }
      const from = colours[cell]
      for (const colour of neighbourColours(colours, n, cell, from)) {
        // Structure gate: the losing region must stay one connected
        // component (and must not vanish). The gaining region cannot split
        // by construction — the recoloured cell attaches to its new
        // colour on a neighbour — and one-mine-per-region is structural:
        // the cell holds no intended star, so both regions keep their own.
        if (!regionStaysConnectedWithout(colours, n, cell, from)) {
          continue
        }
        colours[cell] = colour
        const count = countStarSolutionsWithBudget(colours, n, moveScoreCap, MOVE_EVALUATION_NODE_BUDGET)
        colours[cell] = from
        // A saturated score (count === moveScoreCap) means ">= cap", still
        // a usable gradient step: lower is better, and the terminal round
        // re-proves exact uniqueness before repair returns. An exhausted
        // evaluation scores just above the cap — worse than anything
        // measured, but never a false "no legal move" dead end when every
        // move exhausted (which at n <= 10 should not happen at all: the
        // counter's measured cliff is at n = 14).
        const score = count.status === 'limit-exhausted' ? moveScoreCap + 1 : count.count
        if (score < bestScore) {
          bestScore = score
          best = { cell, colour }
          bestTieCount = 1
        } else if (score === bestScore) {
          bestTieCount += 1
          if (rng.nextInt(bestTieCount) === 0) {
            best = { cell, colour }
          }
        }
        if (nowMs() >= deadline) {
          return null
        }
      }
    }
    if (best === null) {
      // No legal move at all: a true dead end for this layout.
      return null
    }
    colours[best.cell] = best.colour
  }
  return null
}

function nowMs(): number {
  return Date.now()
}
