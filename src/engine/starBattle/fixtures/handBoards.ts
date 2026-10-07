/**
 * Hand-derived ground-truth Star Battle colourings, shared across test
 * lanes. Lifted from `minimumBasis.test.ts` (2026-10-07) so the signature,
 * firstStarWave, and minimum-basis tests pin against the SAME arrays — the
 * derivation narrative and subset tables for each board live in
 * `minimumBasis.test.ts`, and the signature pins in `signature.test.ts`
 * reference these by the same names. Do not edit one copy: there is only
 * this one.
 */

/**
 * k = 0: the n = 4 starter construction (singleton regions 0..2, region 3
 * the sea). Base rules place every star by hidden singles alone.
 */
export const HAND_K0_COLOURS = new Uint8Array([3, 0, 3, 3, 3, 3, 3, 1, 2, 3, 3, 3, 3, 3, 3, 3])

/**
 * k = 1: n = 4 board found in the seeded walk stream; every single
 * confinement rule suffices with base, the canonical witness is ['c1'].
 */
export const HAND_K1_COLOURS = new Uint8Array([1, 1, 0, 0, 1, 3, 3, 3, 3, 3, 2, 2, 3, 3, 3, 3])

/**
 * k = 2: n = 4 board from the same search; first solving pair in canonical
 * order is ['c1','c4'].
 */
export const HAND_K2_COLOURS = new Uint8Array([2, 0, 0, 1, 2, 2, 3, 1, 2, 3, 3, 1, 2, 2, 3, 3])

/**
 * k = -1: n = 10 board from the seeded walk stream (walk seed 24757, steady
 * seed board) — the "requires contradiction" class; no confinement subset
 * solves at depth 0.
 */
export const HAND_KMINUS1_COLOURS = new Uint8Array([
  1, 1, 1, 1, 1, 1, 1, 9, 0, 0, 1, 9, 9, 9, 9, 9, 9, 9, 2, 9, 1, 9, 3, 3, 3, 3, 3, 9, 2, 9,
  1, 3, 3, 5, 4, 3, 3, 9, 9, 9, 1, 9, 3, 5, 4, 4, 9, 9, 9, 9, 9, 9, 9, 5, 5, 6, 6, 6, 9, 9,
  9, 7, 7, 7, 8, 6, 6, 9, 9, 9, 9, 7, 9, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 9, 9, 8, 8, 9, 9,
  9, 9, 9, 9, 9, 9, 9, 9, 9, 9,
])
