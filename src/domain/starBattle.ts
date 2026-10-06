/**
 * Star Battle domain: pure types, numeric constants and shape validation for
 * the n×n puzzle with exactly n stars — one per row, one per column, none
 * within Chebyshev distance 1 of another, one per colour. This layer imports
 * nothing from the project; it is the root of the dependency graph.
 */

/**
 * Player-visible cell marks, shipped to the UI as a flat array of these.
 * The numeric values are the wire format and must stay stable: `STAR_LOCKED`
 * is written only by the reducer, never chosen by the player.
 */
export const STAR_UNMARKED = 0
export const STAR_BLANK = 1
export const STAR_STAR = 2
export const STAR_LOCKED = 3
export type StarMark = 0 | 1 | 2 | 3

/**
 * A generated Star Battle round. `colours[row * n + col]` is a colour index
 * in `[0, n)` — every cell is coloured and every colour is used. `solution`
 * is the star permutation: `solution[row]` is the column of that row's star,
 * so `colours` has length `n * n` and `solution` has length `n`. Both are
 * read-only; the engine treats them as the ground truth for correctness.
 */
export interface StarBattlePuzzle {
  readonly n: number
  readonly seed: number
  readonly colours: Uint8Array
  readonly solution: readonly number[]
}

// 4 is the smallest side on which the four constraints can interact at all.
// n = 1 is the trivial single-star board, and n = 2 and n = 3 admit NO valid
// star placement: the stars must form a permutation of the columns with
// |solution[row] - solution[row + 1]| >= 2, and no such permutation exists
// below n = 4 (for n = 4, [1, 3, 0, 2] works). Shipping 2 or 3 would mean the
// generator can only fail there, so the supported range starts at 4.
export const MIN_STAR_SIDE = 4

// The ceiling is a product decision, NOT a solver limit, and it is worth being
// explicit about why the obvious argument no longer applies.
//
// The counter in `src/engine/starBattle/count.ts` memoises DFS states keyed by
// (columnsUsedMask, coloursUsedMask) with an n-slot vector per key for the
// previous column, and it degrades sharply on highly symmetric 0-solution
// colourings, where the search must exhaust the whole tree. Measured
// (cap = 2, this machine, 2026-10): at 13×13 the worst case across hundreds of
// adversarial colourings — random, planted-solution, block, row-permutation
// and the full cyclic torus family (a·col + b·row mod n for every a, b) — is
// under 4ms, while at 14×14 the cyclic Latin stripes alone (a = 1, b odd) take
// ~4.4s. That cliff is real, and it is ALSO irrelevant here: the generator
// accepts a board only when the propagation certificate in
// `src/engine/starBattle/propagate.ts` forces all n stars, which is a strictly
// stronger statement than a count of 1 and costs ~0.03ms at n = 5 rising to
// ~26ms at n = 40. The counter is a TEST cross-check at n <= 10 and never a
// production gate, so no shipped size can trip the 14 cliff.
//
// (An earlier version of this comment set the ceiling at 13 "with headroom
// for the repair loop the generator runs on top". There is no repair loop, and
// there never will be one: uniqueness is MEASURE-ZERO among well-spread
// colourings past n ~ 8, so a repair-by-recolouring walk is a random walk on
// a non-monotone objective rather than a descent. The CHAIN construction in
// `src/engine/starBattle/construct.ts` makes uniqueness structural instead.)
//
// 15 is therefore a choice, and the choice is: the largest board the shipped
// palette and grid already cover without new CSS, which is the size the player
// actually tried by hand. A player-chosen size must read this constant rather
// than repeat a literal.
export const MAX_STAR_SIDE = 15
export const DEFAULT_STAR_SIDE = 10

export function assertStarBattleSide(value: unknown, context = 'star battle side'): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new TypeError(`${context} must be an integer; received ${String(value)}`)
  }
  if (value < MIN_STAR_SIDE || value > MAX_STAR_SIDE) {
    throw new RangeError(
      `${context} must be between ${MIN_STAR_SIDE} and ${MAX_STAR_SIDE}; received ${value}`,
    )
  }
}

/**
 * Validates the colour grid half of a puzzle: `colours` must be a Uint8Array
 * of length `n * n` whose values are colour indices in `[0, n)`. The solution
 * permutation is validated separately by {@link assertStarBattlePuzzle}.
 */
export function assertStarColours(
  value: unknown,
  n: number,
  context = 'star battle colours',
): asserts value is Uint8Array {
  assertStarBattleSide(n, `${context} side`)
  if (!(value instanceof Uint8Array)) {
    throw new TypeError(`${context} must be a Uint8Array; received ${String(value)}`)
  }
  if (value.length !== n * n) {
    throw new RangeError(`${context} must have length ${n * n}; received ${value.length}`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] >= n) {
      throw new RangeError(`${context}[${index}] must be a colour index in [0, ${n}); received ${value[index]}`)
    }
  }
}

/**
 * Full puzzle validation: shape, colour grid, and the planted solution —
 * a permutation of columns with no two stars within Chebyshev distance 1 and
 * pairwise-distinct star colours. Uniqueness of the solution is deliberately
 * NOT checked here: that is the exact counter's job in the engine, and this
 * function must stay cheap enough to run on every reducer `round/start`.
 */
export function assertStarBattlePuzzle(value: unknown, context = 'star battle puzzle'): asserts value is StarBattlePuzzle {
  if (typeof value !== 'object' || value === null) {
    throw new TypeError(`${context} must be an object; received ${String(value)}`)
  }
  const { n, seed, colours, solution } = value as {
    readonly n?: unknown
    readonly seed?: unknown
    readonly colours?: unknown
    readonly solution?: unknown
  }
  assertStarBattleSide(n, `${context}.n`)
  if (typeof seed !== 'number' || !Number.isSafeInteger(seed)) {
    throw new TypeError(`${context}.seed must be an integer; received ${String(seed)}`)
  }
  assertStarColours(colours, n, `${context}.colours`)
  if (!Array.isArray(solution)) {
    throw new TypeError(`${context}.solution must be an array of length ${n}`)
  }
  const columns: readonly unknown[] = solution
  if (columns.length !== n) {
    throw new RangeError(`${context}.solution must have length ${n}; received ${columns.length}`)
  }
  const columnSeen = new Uint8Array(n)
  const colourSeen = new Uint8Array(n)
  let previousColumn = -1
  for (let row = 0; row < n; row += 1) {
    const column = columns[row]
    if (typeof column !== 'number' || !Number.isSafeInteger(column) || column < 0 || column >= n) {
      throw new TypeError(`${context}.solution[${row}] must be a column index in [0, ${n}); received ${String(column)}`)
    }
    if (columnSeen[column] === 1) {
      throw new RangeError(`${context}.solution repeats column ${column} in rows ${row} and earlier`)
    }
    columnSeen[column] = 1
    if (previousColumn >= 0 && Math.abs(column - previousColumn) < 2) {
      throw new RangeError(
        `${context}.solution has stars within Chebyshev distance 1 at rows ${row - 1} and ${row}`,
      )
    }
    previousColumn = column
    const colour = colours[row * n + column]
    if (colourSeen[colour] === 1) {
      throw new RangeError(`${context} stars share colour ${colour} in rows ${row} and earlier`)
    }
    colourSeen[colour] = 1
  }
}
