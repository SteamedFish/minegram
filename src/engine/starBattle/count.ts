/**
 * Exact Star Battle solution counting — the project's proof instrument for the
 * "exactly one star set" generation contract. Correctness and honesty about
 * what a return value proves matter more than speed here.
 *
 * Search model: a solution is a permutation `p` of the columns with
 * `p[row] = column of the star in that row`. Row and column uniqueness are
 * then automatic; the 3×3 (Chebyshev) rule collapses to
 * `|p[row] - p[row + 1]| >= 2` because stars two or more rows apart can never
 * be within distance 1; the colour rule becomes "the n chosen cells have
 * pairwise-distinct colours". Rows are filled in order, and the search is
 * memoised over `(columnsUsedMask, coloursUsedMask)` with an `n + 1` slot
 * vector per key indexed by `previousColumn + 1` (slot 0 = no previous row).
 * Because rows fill in order, the current row is `popcount(columnsUsedMask)`,
 * so the key fully determines the subproblem.
 *
 * Memory bound: the memo holds at most one `(n + 1)`-slot Int32Array per
 * reachable `(columnsUsedMask, coloursUsedMask)` pair — loosely `4^n` entries
 * (both masks n bits), i.e. ~2.7e8 slots worst-case theory at n = 14. The
 * reachable set is far smaller in practice (a colours mask is only reachable
 * together with the column masks whose chosen cells actually carry those
 * colours), and the measured residency at the maximum supported side is a
 * small fraction of that bound. Keys are exact doubles for n ≤ 26
 * (`columnsUsedMask + coloursUsedMask * 2^n < 2^53`), far above anything this
 * module accepts.
 */
import { assertStarColours } from '../../domain/starBattle'

/**
 * The cap a uniqueness proof asks for: finding a second solution is enough to
 * answer "no", and a search that finds only one has proved "exactly one".
 */
export const DEFAULT_STAR_COUNT_CAP = 2

/**
 * What a budgeted count may conclude. `count` is `min(actual, cap)` — see
 * {@link countStarSolutions} for the exact reading of each value. The
 * discriminated shape exists so a budget exhaustion can NEVER be mistaken for
 * a count: a caller must treat `limit-exhausted` as a failure (the project
 * generation contract: unknown/budget-exhausted solver results are failures,
 * never treated as unique), from which nothing about the true count follows.
 */
export type StarCountResult =
  | { readonly status: 'count'; readonly count: number }
  | { readonly status: 'limit-exhausted'; readonly nodes: number }

interface CounterContext {
  readonly colours: Uint8Array
  readonly n: number
  readonly cap: number
  readonly maskShift: number
  readonly memo: Map<number, Int32Array>
  readonly budget: number
  nodes: number
  exhausted: boolean
}

/**
 * Memoised count of completions from `(row, colMask, colourMask, prevColumn)`,
 * saturated at `ctx.cap`. When a finite budget is set, exceeding it latches
 * `ctx.exhausted` and every in-flight frame unwinds returning 0; the whole
 * result is then discarded by the caller, so partially-written memo entries
 * can never leak into an answer.
 */
function countFrom(
  ctx: CounterContext,
  row: number,
  colMask: number,
  colourMask: number,
  prevColumn: number,
): number {
  if (row === ctx.n) {
    return 1
  }
  if (ctx.exhausted) {
    return 0
  }
  if (ctx.budget !== Number.POSITIVE_INFINITY) {
    ctx.nodes += 1
    if (ctx.nodes > ctx.budget) {
      ctx.exhausted = true
      return 0
    }
  }
  const key = colMask + colourMask * ctx.maskShift
  let memoRow = ctx.memo.get(key)
  const slot = prevColumn + 1
  if (memoRow !== undefined && memoRow[slot] >= 0) {
    return memoRow[slot]
  }
  let total = 0
  const rowBase = row * ctx.n
  for (let column = 0; column < ctx.n; column += 1) {
    if ((colMask & (1 << column)) !== 0) {
      continue
    }
    if (prevColumn >= 0 && Math.abs(column - prevColumn) < 2) {
      continue
    }
    const colour = ctx.colours[rowBase + column]
    if ((colourMask & (1 << colour)) !== 0) {
      continue
    }
    total += countFrom(ctx, row + 1, colMask | (1 << column), colourMask | (1 << colour), column)
    if (total >= ctx.cap || ctx.exhausted) {
      total = ctx.exhausted ? 0 : ctx.cap
      break
    }
  }
  if (ctx.exhausted) {
    return 0
  }
  if (memoRow === undefined) {
    memoRow = new Int32Array(ctx.n + 1).fill(-1)
    ctx.memo.set(key, memoRow)
  }
  memoRow[slot] = total
  return total
}

function createContext(
  colours: Uint8Array,
  n: number,
  cap: number,
  budget: number,
): CounterContext {
  assertStarColours(colours, n)
  if (typeof cap !== 'number' || !Number.isSafeInteger(cap) || cap <= 0) {
    throw new TypeError(`cap must be a positive safe integer; received ${String(cap)}`)
  }
  if (typeof budget !== 'number' || budget <= 0) {
    throw new TypeError(`nodeBudget must be a positive number; received ${String(budget)}`)
  }
  return {
    colours,
    n,
    cap,
    maskShift: 2 ** n,
    memo: new Map(),
    budget,
    nodes: 0,
    exhausted: false,
  }
}

/**
 * Exact count of valid star placements, capped: the return value is
 * `min(actual, cap)`.
 *
 * What the caller may conclude:
 * - return `< cap` — the board has EXACTLY that many solutions. The search
 *   exhausted every branch, so this is exact, not estimated.
 * - return `=== cap` — the board has AT LEAST cap solutions. This is a lower
 *   bound, never "exactly cap": the search stopped at the cap by design.
 *   A uniqueness proof calls with `cap = 2` and reads `1` as "unique" and
 *   `2` as "not unique"; it never needs the true total.
 *
 * This function always runs to completion. If the search might have to be
 * bounded, use {@link countStarSolutionsWithBudget} and branch on its
 * discriminated `status` — never on a bare number.
 */
export function countStarSolutions(colours: Uint8Array, n: number, cap = DEFAULT_STAR_COUNT_CAP): number {
  const ctx = createContext(colours, n, cap, Number.POSITIVE_INFINITY)
  return countFrom(ctx, 0, 0, 0, -1)
}

/**
 * The budgeted counterpart of {@link countStarSolutions}. `nodeBudget` counts
 * memoised DFS frames; exhausting it yields `{ status: 'limit-exhausted' }`,
 * from which NOTHING may be concluded about the count — treat it as a failure,
 * per the generation contract. `{ status: 'count', count }` carries exactly the
 * same guarantees as the unbudgeted function.
 */
export function countStarSolutionsWithBudget(
  colours: Uint8Array,
  n: number,
  cap: number,
  nodeBudget: number,
): StarCountResult {
  const ctx = createContext(colours, n, cap, nodeBudget)
  const count = countFrom(ctx, 0, 0, 0, -1)
  if (ctx.exhausted) {
    return Object.freeze({ status: 'limit-exhausted', nodes: ctx.nodes })
  }
  return Object.freeze({ status: 'count', count })
}

/**
 * Up to `cap` distinct solutions as column arrays (`solution[row] = column`),
 * for repair and diagnostic tooling that needs the actual placements, not
 * just their number. When the board has fewer than `cap` solutions the return
 * contains ALL of them (the search exhausts every branch); when it has at
 * least `cap`, the return contains exactly `cap` and makes no claim that the
 * list is complete. Pruning is by the same memoised counter: a child subtree
 * with count 0 is skipped without recursion, so the worst case matches
 * {@link countStarSolutions} rather than an unpruned permutation walk.
 */
export function findStarSolutions(colours: Uint8Array, n: number, cap = DEFAULT_STAR_COUNT_CAP): number[][] {
  const ctx = createContext(colours, n, cap, Number.POSITIVE_INFINITY)
  const solutions: number[][] = []
  const path: number[] = []

  const walk = (row: number, colMask: number, colourMask: number, prevColumn: number): void => {
    if (solutions.length >= cap) {
      return
    }
    if (row === ctx.n) {
      solutions.push([...path])
      return
    }
    const rowBase = row * ctx.n
    for (let column = 0; column < ctx.n; column += 1) {
      if ((colMask & (1 << column)) !== 0) {
        continue
      }
      if (prevColumn >= 0 && Math.abs(column - prevColumn) < 2) {
        continue
      }
      const colour = ctx.colours[rowBase + column]
      if ((colourMask & (1 << colour)) !== 0) {
        continue
      }
      if (countFrom(ctx, row + 1, colMask | (1 << column), colourMask | (1 << colour), column) === 0) {
        continue
      }
      path.push(column)
      walk(row + 1, colMask | (1 << column), colourMask | (1 << colour), column)
      path.pop()
      if (solutions.length >= cap) {
        return
      }
    }
  }

  walk(0, 0, 0, -1)
  return solutions
}
