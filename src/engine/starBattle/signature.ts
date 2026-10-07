/**
 * Board signatures and per-tier diversity measurement for Star Battle
 * generation.
 *
 * Why this exists (measured, 2026-10-07): every technique tier was shipping
 * the same puzzle repeatedly. The diagnosis was NOT monotone difficulty but
 * monotone GENERATION: a structural property (the strips-and-sea sea) holds
 * on ~100% of boards in a tier, so `modalSignatureShare` — the share of the
 * last M boards sharing the tier's most common signature — measured 1.0 in
 * every technique tier. The planned fix, an acceptance predicate rejecting
 * boards whose signature is too common, is DEAD CODE by measurement: the
 * descent walk is an attractor ladder (walks under meter [c3], [c4], [c3,c4]
 * reproduce meter []'s trajectory attempt-for-attempt — at the base-stall
 * bottom only c1 revives propagation, so {c1} is a probability-1 attractor),
 * so rejecting the modal signature rejects 100% of reachable endpoints.
 * Diversity must be injected at the walk's INPUTS (see the rotation in
 * construct.ts); this module is the MEASUREMENT side that proves whether
 * the injection worked.
 *
 * THE LOAD-BEARING BOUNDARY: the signature is computed on a walk's ENDPOINT
 * and must NEVER feed back into the descent. A signature that participates
 * in the search re-creates the non-monotone descent that made five earlier
 * constructions fail. `walk.ts` does not import this module — pinned by a
 * `?raw` source guard in signature.test.ts, not by convention. The rotation
 * in construct.ts computes the signature only AFTER the acceptance gates,
 * on the returned board; it is reportable data, never a gate input.
 *
 * The signature (all components measured, none asserted):
 * - `k` / `witness` / `witnessWaves` — the minimum-basis measurement
 *   (minimumBasis.ts): basis cardinality in ideas, the witness subset, and
 *   that subset's wave count. `k = -1` boards carry the empty witness and
 *   the all-four-rules stall run's numbers.
 * - `firstStarWave` — the wave at which the witness run placed its first
 *   star (0 when it placed none). Two boards with identical k and witness
 *   can open completely differently; this separates them.
 * - `baseFreebies` — the blank marks the base rules hand out for free: the
 *   count of BLANK cells in the base-only run's final state. This is the
 *   doctrine number from the difficulty work ("count freebies in blank
 *   marks, not solver steps": a colour owning a whole row resolves n − 1
 *   blanks for free). On technique-tier boards the base rules place no
 *   star, and blanks only ever follow placed stars, so this is 0 there —
 *   a constant, kept because it distinguishes construction-tier boards and
 *   costs one already-priced run.
 * - `coreScore` — the structural-core profile (structure.ts): how strongly
 *   some colour exhibits the sea profile, 0..5.
 *
 * Everything is pure and deterministic: same colouring ⇒ same signature, no
 * randomness, no shared state, no wall-clock input. Never `Math.random()`.
 */

import { assertStarColours } from '../../domain/starBattle'
import { solveStarCatalogue } from './catalogue'
import {
  measureMinimumBasis,
  type StarConfinementRule,
  type StarMinimumBasis,
} from './minimumBasis'
import { measureStarStructuralCore } from './structure'

/**
 * The measured signature of one Star Battle colouring. A fact tuple, not a
 * verdict: every field is something the engine measured, and the tuple's
 * equality class is the diversity unit (`starSignatureKey`).
 */
export interface StarBoardSignature {
  /**
   * Minimum-basis cardinality in technique ideas: 0 (base alone) .. 3, or
   * -1 (no pure-deduction subset solves; requires contradiction).
   */
  readonly k: number
  /**
   * The witness subset carrying the solve, in canonical order. Empty for
   * k = 0 and k = -1.
   */
  readonly witness: readonly StarConfinementRule[]
  /** Waves the witness run wrote (k >= 0) or the all-four stall run wrote (k = -1). */
  readonly witnessWaves: number
  /**
   * The 1-based wave at which the witness run placed its first star, or 0
   * when it placed none (always 0 for k = -1 stall runs that never placed,
   * never 0 for a solved witness run).
   */
  readonly firstStarWave: number
  /**
   * Blank marks the base rules hand out for free (BLANK cells in the
   * base-only run's final state). 0 on every technique-tier board, where
   * the base rules place no star and blanks only follow placed stars.
   */
  readonly baseFreebies: number
  /** The structural-core profile score, 0..5 (structure.ts). */
  readonly coreScore: number
}

const BLANK_MARK = 1

/**
 * Measure the signature of a colouring. `basis` may carry an already-measured
 * minimum basis (construct.ts measures one at acceptance; passing it avoids
 * a second 16-subset enumeration); when omitted it is measured here. Throws
 * the domain's standard errors on invalid input, and an Error (internal
 * invariant violation) when the witness re-run disagrees with the basis
 * measurement — same colouring must reproduce same run, always.
 */
export function measureStarBoardSignature(
  colours: Uint8Array,
  n: number,
  basis?: StarMinimumBasis,
): StarBoardSignature {
  assertStarColours(colours, n)
  const measured = basis ?? measureMinimumBasis(colours, n)

  // The witness run, re-run standalone to read its first-star wave. For
  // k = -1 the basis reports the all-four confinement attempt, so that is
  // the run re-read. The re-run must reproduce the basis measurement
  // exactly: same rules, same board, same deterministic engine.
  const witnessRules: readonly StarConfinementRule[] =
    measured.k === -1 ? ['c1', 'c2', 'c3', 'c4'] : measured.rules
  const witnessRun = solveStarCatalogue(colours, n, {
    rules: ['base', ...witnessRules],
    csDepth: 0,
  })
  if (witnessRun.waves !== measured.waves || witnessRun.placed !== measured.placed) {
    throw new Error(
      `star battle signature witness re-run disagrees with the basis measurement ` +
        `(n=${n}, k=${measured.k}, basis waves=${measured.waves}/placed=${measured.placed}, ` +
        `re-run waves=${witnessRun.waves}/placed=${witnessRun.placed})`,
    )
  }

  const baseRun = solveStarCatalogue(colours, n, { rules: ['base'], csDepth: 0 })
  let baseFreebies = 0
  for (const mark of baseRun.marks) {
    if (mark === BLANK_MARK) {
      baseFreebies += 1
    }
  }

  return Object.freeze({
    k: measured.k,
    witness: measured.rules,
    witnessWaves: measured.waves,
    firstStarWave: witnessRun.firstStarWave,
    baseFreebies,
    coreScore: measureStarStructuralCore(colours, n).coreScore,
  })
}

/**
 * The canonical string form of a signature — the equality class the
 * diversity window counts. Deterministic and injective per tuple.
 *
 * TWO GRAINS, both honest, and the distinction is measured (2026-10-07):
 * the FULL tuple varies even inside one attractor class — challenging
 * boards under the shipped {c1} attractor already spread over
 * witnessWaves 5..9 (full-tuple modal share 0.375 over 8 boards) — while
 * the puzzle CLASS the player experiences, `(k, witness)`, sat at share
 * 1.0 (every board {c1}). The study's "modalSignatureShare is 1.0 in
 * every technique tier" is a claim about {@link starSignatureClass}; the
 * full tuple decomposes the within-class monotony on top. The diversity
 * TARGET (modal class share ≤ 0.5) is evaluated on the class key; the
 * full tuple is the finer report.
 */
export function starSignatureKey(signature: StarBoardSignature): string {
  return [
    signature.k,
    signature.witness.join('+'),
    signature.witnessWaves,
    signature.firstStarWave,
    signature.baseFreebies,
    signature.coreScore,
  ].join('|')
}

/**
 * The puzzle-class key: `(k, witness)` — the coarse identity the player's
 * "every level is the same puzzle" complaint is about. For k = -1 the
 * witness is empty by definition, so every contradiction board is one
 * class no matter what generation does; that tier's diversity lives only
 * in the full tuple, which is reported but cannot carry a class target.
 */
export function starSignatureClass(signature: StarBoardSignature): string {
  return [signature.k, signature.witness.join('+')].join('|')
}

/**
 * The window size the diversity measurement rolls over: the modal share is
 * computed over the last {@link STAR_SIGNATURE_WINDOW_BOARDS} boards a tier
 * produced. 8 is the smallest window where a 0.5 share cap admits four
 * distinct classes comfortably; it is a product constant, not a measured
 * optimum.
 */
export const STAR_SIGNATURE_WINDOW_BOARDS = 8

/**
 * An immutable rolling window of signature keys, oldest first. Purely
 * functional: recording returns a new window and never mutates the input.
 */
export interface StarSignatureWindow {
  /** The window capacity; `entries.length` is the filled portion. */
  readonly maxBoards: number
  /** The recorded keys, oldest first, at most `maxBoards` long. */
  readonly entries: readonly string[]
}

/** Create an empty window. `maxBoards` must be a positive safe integer. */
export function createStarSignatureWindow(
  maxBoards: number = STAR_SIGNATURE_WINDOW_BOARDS,
): StarSignatureWindow {
  if (!Number.isSafeInteger(maxBoards) || maxBoards <= 0) {
    throw new RangeError(`maxBoards must be a positive safe integer; received ${String(maxBoards)}`)
  }
  return Object.freeze({ maxBoards, entries: Object.freeze([]) as readonly string[] })
}

/**
 * Append a key, dropping the oldest entry when the window is full. Returns
 * a new window; the input is untouched.
 */
export function recordStarSignature(
  window: StarSignatureWindow,
  key: string,
): StarSignatureWindow {
  const entries = [...window.entries, key]
  while (entries.length > window.maxBoards) {
    entries.shift()
  }
  return Object.freeze({ maxBoards: window.maxBoards, entries: Object.freeze(entries) })
}

/** The aggregate statistics of one window. */
export interface StarSignatureWindowStats {
  /** Recorded boards (the filled portion of the window). */
  readonly boards: number
  /** The most common key; null only when the window is empty. */
  readonly modalSignature: string | null
  /** How many recorded boards carry the modal key. */
  readonly modalCount: number
  /**
   * `modalCount / boards` — the tier diversity number. 1.0 means every
   * recorded board is the same signature (the pre-rotation measurement);
   * lower is more diverse. 0.0 for an empty window: no evidence is not
   * diversity, and must never read as success.
   */
  readonly modalSignatureShare: number
}

/** Compute the aggregate statistics of a window. Pure. */
export function starSignatureWindowStats(window: StarSignatureWindow): StarSignatureWindowStats {
  const counts = new Map<string, number>()
  for (const key of window.entries) {
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let modalSignature: string | null = null
  let modalCount = 0
  for (const [key, count] of counts) {
    if (count > modalCount) {
      modalSignature = key
      modalCount = count
    }
  }
  const boards = window.entries.length
  return Object.freeze({
    boards,
    modalSignature,
    modalCount,
    modalSignatureShare: boards === 0 ? 0 : modalCount / boards,
  })
}
