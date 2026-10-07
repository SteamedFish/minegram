/**
 * Board-variety descent search for Star Battle colourings.
 *
 * Motivation (measured by the oracle2 lane, recorded in its experiments):
 * the production generator (`construct.ts`, strips-and-sea) only ever paints
 * boards that the base rule set — exclusion + hidden singles, exactly
 * `propagate.ts` semantics — solves on its own, so every advertised
 * difficulty tier collapses to the same 3-wave reasoning and the levels
 * feel same-y. Undirected drift over colourings does not escape that basin:
 * across 5,600 accepted mutations it never once produced a board requiring
 * a catalogue technique, and multi-mutation tunnelling made it worse. The
 * oracle found one move that works — a DESCENT: accept a recolour only when
 * it does not make the board easier, where "easier" is the number of stars
 * the base rule subset can place. Reaching "base places nothing at all"
 * took a median of roughly 50 accepted mutations at n = 10.
 *
 * The walk here is a deterministic, seeded port of that descent:
 *
 * 1. Seed from a certified-unique board produced by
 *    {@link generateStarBattle} (read-only use; this module never modifies
 *    the construction).
 * 2. A move picks a non-solution cell and repaints it to the colour of one
 *    of its 4-neighbours.
 * 3. A move is accepted iff
 *    (a) connectivity-safe — the vacated colour region stays ONE
 *        4-connected component (the player's hard requirement: 「同一颜色的
 *        格子组成的色块全部连续，不分裂」; the gained region cannot split
 *        because the new cell is adjacent to one of its own), AND
 *    (b) the board stays solvable by the FULL technique catalogue
 *        (`base` + `c1..c4` + case-splitting depth 1) — a complete
 *        catalogue solve is a uniqueness certificate, every rule writes
 *        only cells blank in every solution, so this doubles as the
 *        acceptance gate AND the uniqueness proof. The expensive exact
 *        counter (`count.ts`) stays out of the hot path; it is the
 *        independent cross-check the tests run, not a generator input,
 *        AND
 *    (c) the easiness meter places no MORE stars than before — the
 *        descent condition that crosses the moat of unsolvable states
 *        plain drift cannot leave. The meter is selectable: 'base' (stars
 *        the production solver places — the 'challenging'/'expert' tiers)
 *        or 'confinement' (stars the full depth-0 confinement catalogue
 *        places — the 'contradiction' tier).
 * 4. Stop when the meter places zero stars and the full catalogue
 *    still solves: that board requires a technique the production solver
 *    does not have (or, under the 'confinement' meter, that NO pure
 *    deduction technique can start — a k = -1 candidate).
 *
 * Budget semantics (load-bearing, generation contract): the search is
 * bounded by a mutation-attempt cap and a wall-clock cap. Exceeding either
 * throws {@link StarWalkBudgetExhaustedError}. A budget-exhausted search
 * NEVER returns a board: partial progress is not a difficulty certificate.
 *
 * Restarts: the descent is a single-move local search and it has local
 * optima — measured at n = 10, some seeds sit at base-placed 1 for
 * thousands of accepted mutations without a level-0 move appearing (the
 * oracle lane observed the same: 3 of its 24 recorded walks never left
 * base-placed 1 inside the attempt budget). When an epoch stalls — no
 * strict improvement for {@link StarWalkRequest.stagnationAttempts}
 * attempts — the walk restarts from a freshly derived seed board and a
 * derived RNG stream. Restarts keep the search deterministic: same seed ⇒
 * same sequence of epochs ⇒ same board. They are the honest alternative to
 * hoping a lucky seed escapes; every returned board still passed the same
 * three gates at every accepted step.
 *
 * Determinism: every random draw comes from a `createSeededRandom` stream
 * in a fixed order; the seed board is a pure function of the same seed.
 * Wall-clock measurement never influences which moves are proposed or
 * accepted, only when the search gives up.
 */
import { assertStarBattleSide } from '../../domain/starBattle'
import { createSeededRandom, deriveRandomSeed, type RandomSeed } from '../rng'
import {
  fingerprintStarCatalogue,
  solveStarCatalogue,
  type StarCatalogueRule,
} from './catalogue'
import { generateStarBattle, type StarDifficulty } from './construct'

/**
 * The base rule subset (exclusion + hidden singles), as a catalogue rules
 * value. This is exactly `propagate.ts` semantics — the "easiness" meter
 * the descent minimises.
 */
const BASE_ONLY_RULES: ReadonlySet<StarCatalogueRule> = new Set<StarCatalogueRule>(['base'])

/** Full catalogue acceptance-gate options: every rule, case-split depth 1. */
const FULL_CATALOGUE_CS_DEPTH = 1 as const

/**
 * Loud, typed failure when the walk exhausts its attempt or wall-clock
 * budget before reaching a technique-requiring board. Never carries a
 * board: a search that ran out of budget has nothing to report.
 */
export class StarWalkBudgetExhaustedError extends Error {
  readonly n: number
  readonly seed: number
  readonly attempts: number
  readonly acceptedMutations: number
  readonly basePlaced: number
  readonly elapsedMs: number
  readonly reason: 'attempts' | 'wall-clock'

  constructor(fields: {
    readonly n: number
    readonly seed: number
    readonly attempts: number
    readonly acceptedMutations: number
    readonly basePlaced: number
    readonly elapsedMs: number
    readonly reason: 'attempts' | 'wall-clock'
  }) {
    super(
      `star battle descent exhausted its ${fields.reason} budget ` +
        `(n=${fields.n}, seed=${fields.seed}, attempts=${fields.attempts}, ` +
        `accepted=${fields.acceptedMutations}, basePlaced=${fields.basePlaced}, ` +
        `${fields.elapsedMs.toFixed(1)}ms) without reaching a technique-requiring board`,
    )
    this.name = 'StarWalkBudgetExhaustedError'
    this.n = fields.n
    this.seed = fields.seed
    this.attempts = fields.attempts
    this.acceptedMutations = fields.acceptedMutations
    this.basePlaced = fields.basePlaced
    this.elapsedMs = fields.elapsedMs
    this.reason = fields.reason
  }
}

export interface StarWalkRequest {
  /** Board side; the usual Star Battle side range applies. */
  readonly n: number
  /** Seed: drives both the seed board and the walk stream. Same seed ⇒ same board. */
  readonly seed: RandomSeed
  /**
   * Difficulty tier of the seed board from {@link generateStarBattle}.
   * 'steady' (default) gives the deepest CONSTRUCTION tier to descend
   * from — a construction board has every star base-placeable, so the
   * descent has height to lose. The tier does not constrain the result,
   * only the starting point. (Defaults to 'steady' since 'challenging'
   * became a technique tier whose boards already have base-placed 0.)
   */
  readonly seedDifficulty?: StarDifficulty
  /**
   * The descent's easiness meter: which solver measures "how much of the
   * board is already forced". 'base' (default) — stars placed by the base
   * rule subset alone; the walk stops when the production solver can
   * start nothing, which is what the 'challenging'/'expert' tiers need.
   * 'confinement' — stars placed by the FULL depth-0 confinement catalogue
   * (base + c1..c4); the walk stops when even every confinement technique
   * together starts nothing, which is what the 'contradiction' tier
   * targets (k = -1). Either way gate (c) — the csDepth:1 certificate —
   * is unchanged.
   */
  readonly meter?: 'base' | 'confinement'
  /** Maximum number of proposed mutations across all epochs. Default 20000. */
  readonly maxAttempts?: number
  /** Maximum wall-clock milliseconds for the whole search. Default 5000. */
  readonly wallClockMs?: number
  /**
   * Epoch length: an epoch restarts from a fresh derived seed board when it
   * has gone this many attempts without a strict improvement (base-placed
   * dropping). Measured at n = 10–15: basins that do not escape within
   * ~100 attempts rarely escape at all, so a short epoch buys the restart
   * cheaply. Default 100.
   */
  readonly stagnationAttempts?: number
}

/**
 * A technique-requiring Star Battle colouring found by the descent, with
 * the measurements a difficulty grader needs. Every field is a fact about
 * the returned board, not an advertisement.
 */
export interface StarWalkBoard {
  readonly n: number
  /** The produced board: base rules place nothing, the full catalogue solves. */
  readonly colours: Uint8Array
  /** The certified-unique seed board the walk descended from. */
  readonly seedColours: Uint8Array
  /** The unique solution of the produced board, `solution[row] = column`. */
  readonly solution: readonly number[]
  /** Stars the base subset placed on the seed under the requested meter (always n today: construct boards collapse). */
  readonly basePlacedSeed: number
  /** Stars the meter placed on the produced board (always 0 — the stop condition; 'base' or 'confinement' per the request). */
  readonly basePlaced: number
  /** Total proposed mutations across all epochs (including rejected ones). */
  readonly attempts: number
  /** Total accepted mutations across all epochs. */
  readonly acceptedMutations: number
  /** How many epochs restarted on stagnation before the successful one. */
  readonly restarts: number
  /**
   * Leave-one-out load-bearing techniques of the produced board: idea
   * classes whose removal stalls the full-catalogue solve (c1/c2 are one
   * idea — line confinement — reported as both ids when load-bearing),
   * plus 'cs' when the depth-0 control fails. This is the honest tiering
   * signal: which techniques the board genuinely REQUIRES.
   */
  readonly fingerprint: ReadonlySet<StarCatalogueRule>
  /** Full-catalogue wave count of the produced board. */
  readonly waves: number
  /** Rule classes the full-catalogue solve engaged on the produced board. */
  readonly used: ReadonlySet<StarCatalogueRule>
  /**
   * Case-split passes the accepting certificate used (0 when the board
   * solved without contradiction). Reported for the difficulty grader:
   * the 'contradiction' tier's acceptance distribution is measured on
   * these, not assumed.
   */
  readonly csPasses: number
  /** Assumption cells the accepting certificate tested. */
  readonly csTrials: number
  /** Largest colour region's share of the board, in (0, 1]. */
  readonly largestRegionShare: number
  /** Measured wall-clock of the whole search. */
  readonly elapsedMs: number
  /** The normalised numeric seed (what determinism keys on). */
  readonly normalizedSeed: number
  readonly seedDifficulty: StarDifficulty
}

/**
 * True iff the region `region` of `colours`, with cell `index` removed,
 * forms at most one non-empty 4-connected component. A region that keeps
 * its shape minus `index` in one flood fill is safe to vacate. (The gained
 * region cannot split: the move only ever repaints to a neighbour's
 * colour, so the new cell attaches to an existing component.)
 */
function regionStaysConnectedWithout(colours: Uint8Array, n: number, index: number, region: number): boolean {
  let start = -1
  let regionSize = 0
  for (let cell = 0; cell < n * n; cell += 1) {
    if (colours[cell] === region) {
      regionSize += 1
      if (cell !== index && start === -1) {
        start = cell
      }
    }
  }
  // region minus index is empty: vacating would delete the region entirely.
  if (start === -1) {
    return false
  }
  const seen = new Uint8Array(n * n)
  const stack = [start]
  seen[start] = 1
  let reached = 1
  while (stack.length > 0) {
    const cell = stack.pop() as number
    const row = (cell / n) | 0
    const column = cell % n
    const neighbours = [
      row > 0 ? cell - n : -1,
      row + 1 < n ? cell + n : -1,
      column > 0 ? cell - 1 : -1,
      column + 1 < n ? cell + 1 : -1,
    ]
    for (const neighbour of neighbours) {
      if (
        neighbour >= 0 &&
        neighbour !== index &&
        seen[neighbour] === 0 &&
        colours[neighbour] === region
      ) {
        seen[neighbour] = 1
        reached += 1
        stack.push(neighbour)
      }
    }
  }
  return reached === regionSize - 1
}

/**
 * Stars the base rule subset alone can place on `colours` — the default
 * descent meter ("easiness" for the production solver). Runs with
 * case-splitting off and the confinement rules off: this is exactly the
 * production solver's reasoning power.
 */
function basePlacedCount(colours: Uint8Array, n: number): number {
  return solveStarCatalogue(colours, n, { rules: BASE_ONLY_RULES, csDepth: 0 }).placed
}

/**
 * Stars the full depth-0 confinement catalogue can place on `colours` —
 * the 'contradiction' tier's meter. When this reaches zero, NO confinement
 * subset can place anything (the solving family is monotone; verified
 * explicitly by {@link measureMinimumBasis} at acceptance), so the board
 * is a k = -1 candidate: pure deduction cannot start it.
 */
function confinementPlacedCount(colours: Uint8Array, n: number): number {
  return solveStarCatalogue(colours, n, { csDepth: 0 }).placed
}

/** The largest colour region's share of the n×n board, in (0, 1]. */
function largestRegionShareOf(colours: Uint8Array, n: number): number {
  const counts = new Uint32Array(n)
  for (let index = 0; index < n * n; index += 1) {
    counts[colours[index]] += 1
  }
  let largest = 0
  for (let colour = 0; colour < n; colour += 1) {
    if (counts[colour] > largest) {
      largest = counts[colour]
    }
  }
  return largest / (n * n)
}

/**
 * The cells of the seed board's unique solution, as a lookup set. The
 * solution is recovered with the full catalogue (a complete solve is a
 * uniqueness certificate), so the walk never repaints a cell the known
 * unique solution stars at — the descent then always reasons about the
 * same planted solution line.
 */
function solutionCellSet(colours: Uint8Array, n: number): Set<number> | null {
  const solved = solveStarCatalogue(colours, n, { csDepth: FULL_CATALOGUE_CS_DEPTH })
  if (!solved.solved) {
    return null
  }
  const cells = new Set<number>()
  for (const [row, column] of solved.stars) {
    cells.add(row * n + column)
  }
  return cells
}

/**
 * Descend from a certified-unique seed board to a colouring where the base
 * rule subset places zero stars and the full technique catalogue still
 * solves — i.e. a board that genuinely requires a technique. Throws
 * {@link StarWalkBudgetExhaustedError} when the budget runs out before
 * that point; never returns a board it cannot certify.
 *
 * Cost model: the cheap base-subset solve gates every proposal; the
 * full-catalogue certificate (with case-splitting) runs only on proposals
 * that pass connectivity and the descent condition.
 */
export function walkStarBattleBoard(request: StarWalkRequest): StarWalkBoard {
  const { n, seed } = request
  assertStarBattleSide(n)
  const seedDifficulty = request.seedDifficulty ?? 'steady'
  const meter = request.meter ?? 'base'
  const meterPlaced =
    meter === 'base' ? basePlacedCount : confinementPlacedCount
  const maxAttempts = request.maxAttempts ?? 20000
  const wallClockMs = request.wallClockMs ?? 5000
  const stagnationAttempts = request.stagnationAttempts ?? 100
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new RangeError(`maxAttempts must be a positive safe integer; received ${String(maxAttempts)}`)
  }
  if (typeof wallClockMs !== 'number' || !(wallClockMs > 0)) {
    throw new RangeError(`wallClockMs must be a positive number; received ${String(wallClockMs)}`)
  }
  if (!Number.isSafeInteger(stagnationAttempts) || stagnationAttempts <= 0) {
    throw new RangeError(
      `stagnationAttempts must be a positive safe integer; received ${String(stagnationAttempts)}`,
    )
  }

  // The base stream derives every epoch stream; epoch 0 also derives the
  // seed-board seed, so same seed ⇒ identical seed board AND identical walk.
  const baseRng = createSeededRandom(deriveRandomSeed(seed, 'star-battle-descent'))
  const normalizedSeed = baseRng.seed
  const startedAt = performance.now()

  let attempts = 0
  let acceptedMutations = 0
  let restarts = 0
  let epochBasePlacedSeed = n
  let epochBasePlaced = n
  let colours: Uint8Array = new Uint8Array(0)
  let finalSeedColours: Uint8Array = new Uint8Array(0)
  let epoch = 0

  for (;;) {
    // --- (re)seed the epoch -----------------------------------------------
    const epochRng = baseRng.derive(`epoch-${epoch}`)
    const generated = generateStarBattle({ n, seed: epochRng.derive('seed-board').seed, difficulty: seedDifficulty })
    const seedColours = generated.puzzle.colours
    const protectedCells = solutionCellSet(seedColours, n)
    if (protectedCells === null) {
      // Unreachable today: the construction certifies its boards. Loud, not
      // silent, because a seed without a recoverable solution has no walk.
      throw new Error(
        `star battle descent seed has no catalogue-certified solution (n=${n}, seed=${normalizedSeed}, epoch=${epoch})`,
      )
    }
    colours = seedColours.slice()
    finalSeedColours = seedColours
    epochBasePlacedSeed = meterPlaced(colours, n)
    let current = epochBasePlacedSeed
    epochBasePlaced = current
    let sinceImprovement = 0
    let solved = current === 0

    while (!solved) {
      if (attempts >= maxAttempts) {
        throw new StarWalkBudgetExhaustedError({
          n,
          seed: normalizedSeed,
          attempts,
          acceptedMutations,
          basePlaced: current,
          elapsedMs: performance.now() - startedAt,
          reason: 'attempts',
        })
      }
      if (performance.now() - startedAt >= wallClockMs) {
        throw new StarWalkBudgetExhaustedError({
          n,
          seed: normalizedSeed,
          attempts,
          acceptedMutations,
          basePlaced: current,
          elapsedMs: performance.now() - startedAt,
          reason: 'wall-clock',
        })
      }
      attempts += 1
      sinceImprovement += 1
      if (sinceImprovement > stagnationAttempts) {
        // Local optimum of the single-move landscape: measured basins sit
        // at base-placed 1 for thousands of accepted mutations. Restart
        // from a fresh derived seed instead of hoping for a lucky escape.
        restarts += 1
        break
      }

      // --- propose: repaint a non-solution cell to a neighbour's colour ---
      const index = epochRng.nextInt(n * n)
      if (protectedCells.has(index)) {
        continue
      }
      const from = colours[index]
      const row = (index / n) | 0
      const column = index % n
      const neighbourColours: number[] = []
      const neighbourIndexes = [
        row > 0 ? index - n : -1,
        row + 1 < n ? index + n : -1,
        column > 0 ? index - 1 : -1,
        column + 1 < n ? index + 1 : -1,
      ]
      for (const neighbour of neighbourIndexes) {
        if (
          neighbour >= 0 &&
          colours[neighbour] !== from &&
          !neighbourColours.includes(colours[neighbour])
        ) {
          neighbourColours.push(colours[neighbour])
        }
      }
      if (neighbourColours.length === 0) {
        continue
      }
      const to = neighbourColours[epochRng.nextInt(neighbourColours.length)]

      // --- gate (a): the vacated region must stay one connected component -
      if (!regionStaysConnectedWithout(colours, n, index, from)) {
        continue
      }

      colours[index] = to

      // --- gate (b): never make the board easier (base-subset star count) -
      const candidateBase = meterPlaced(colours, n)
      if (candidateBase > current) {
        colours[index] = from
        continue
      }

      // --- gate (c): the full catalogue must still solve it (uniqueness) --
      const certified = solveStarCatalogue(colours, n, { csDepth: FULL_CATALOGUE_CS_DEPTH })
      if (!certified.solved) {
        colours[index] = from
        continue
      }

      // --- accept ----------------------------------------------------------
      if (candidateBase < current) {
        sinceImprovement = 0
      }
      current = candidateBase
      acceptedMutations += 1
      epochBasePlaced = current
      solved = current === 0
    }

    if (solved) {
      break
    }
    epoch += 1
  }

  const basePlacedSeed = epochBasePlacedSeed
  const basePlaced = epochBasePlaced
  const elapsedMs = performance.now() - startedAt

  const fingerprint = fingerprintStarCatalogue(colours, n, { csDepth: FULL_CATALOGUE_CS_DEPTH })
  const finalSolve = solveStarCatalogue(colours, n, { csDepth: FULL_CATALOGUE_CS_DEPTH })
  if (fingerprint === null || !finalSolve.solved) {
    // Acceptance gated on this at every step; reaching here is an internal
    // invariant violation, reported loudly rather than as a board.
    throw new Error(
      `star battle descent produced a board the full catalogue does not solve ` +
        `(n=${n}, seed=${normalizedSeed}); the acceptance gate is broken`,
    )
  }

  return Object.freeze({
    n,
    colours: colours.slice(),
    seedColours: finalSeedColours.slice(),
    solution: Object.freeze(finalSolve.stars.map((star) => star[1])) as readonly number[],
    basePlacedSeed,
    basePlaced,
    attempts,
    acceptedMutations,
    restarts,
    fingerprint,
    waves: finalSolve.waves,
    used: finalSolve.used,
    csPasses: finalSolve.csPasses,
    csTrials: finalSolve.csTrials,
    largestRegionShare: largestRegionShareOf(colours, n),
    elapsedMs,
    normalizedSeed,
    seedDifficulty,
  })
}
