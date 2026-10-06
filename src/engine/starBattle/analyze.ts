/**
 * Star Battle difficulty analysis: a pure-logic propagation solver.
 *
 * The rules it uses, iterated to a fixpoint:
 * 1. Blank elimination — a cell cannot hold a star when its row already holds
 *    a known star, its column already holds one, it lies within Chebyshev
 *    distance 1 of a known star, or its colour already holds one.
 * 2. Hidden single — a row, column or colour that has no known star and
 *    exactly one remaining candidate cell places its star there.
 *
 * This is a SUBSET of what a player may know. It performs no guessing, no
 * look-ahead and no "what if this cell were a star" reasoning, so
 * `solvedByLogic === false` does NOT mean the board is unsolvable — it means
 * this propagation alone is not enough, and a human (or a deeper solver)
 * might still finish it without a guess. A caller may conclude ONLY:
 * - `solvedByLogic === true` and `solution` non-null — the board has exactly
 *   one solution, and this is it; the caller can cross-check it against a
 *   planted generator solution to catch a generator bug.
 * - `solvedByLogic === false` — nothing about solvability or uniqueness;
 *   `rounds` and `unknownCells` are difficulty signals only.
 *
 * `rounds` counts propagation passes that placed at least one star (a pass =
 * one sweep of hidden-single checks; the final fixpoint sweep that places
 * nothing is not counted, so a board where propagation cannot start reports
 * `rounds === 0`). It is the difficulty signal: a board that collapses in one
 * pass is trivial, one that keeps forcing new singles for many passes is hard.
 *
 * Bootstrap caveat, stated plainly because it shapes what the numbers mean:
 * with only these rules, NOTHING is deducible on a fresh board until some
 * unit has a single candidate — a colour occupying exactly one cell (the
 * colouring-analogue of a one-cell cage in classic Star Battle), or a unit
 * reduced to one candidate by an earlier placement. A colouring whose
 * colours all span several cells therefore reports `solvedByLogic === false`
 * whatever its true difficulty; that is the honest answer for this rule set,
 * not a failure.
 */
import { assertStarColours } from '../../domain/starBattle'

const CELL_UNKNOWN = 0
const CELL_BLANK = 1
const CELL_STAR = 2

export interface StarBoardAnalysis {
  /**
   * Whether pure propagation fully determined the star permutation. `false`
   * is silence, not failure — see the module doc for what a caller may
   * conclude from it.
   */
  readonly solvedByLogic: boolean
  /** Propagation passes run. The difficulty signal. */
  readonly rounds: number
  /** Cells still neither blanked nor starred when propagation stalled. */
  readonly unknownCells: number
  /** The deduced star permutation, or `null` when propagation did not finish. */
  readonly solution: readonly number[] | null
}

/** Whether the permutation satisfies all four Star Battle constraints. */
function permutationIsValid(colours: Uint8Array, n: number, solution: readonly number[]): boolean {
  const columnSeen = new Uint8Array(n)
  const colourSeen = new Uint8Array(n)
  let previousColumn = -1
  for (let row = 0; row < n; row += 1) {
    const column = solution[row]
    if (typeof column !== 'number' || column < 0 || column >= n) {
      return false
    }
    if (columnSeen[column] === 1) {
      return false
    }
    columnSeen[column] = 1
    if (previousColumn >= 0 && Math.abs(column - previousColumn) < 2) {
      return false
    }
    previousColumn = column
    const colour = colours[row * n + column]
    if (colourSeen[colour] === 1) {
      return false
    }
    colourSeen[colour] = 1
  }
  return true
}

export function analyzeStarBoard(colours: Uint8Array, n: number): StarBoardAnalysis {
  assertStarColours(colours, n)

  const cells = new Uint8Array(n * n) // CELL_* per cell
  const starColumn = new Int32Array(n).fill(-1) // star column per row, -1 = none
  const columnStarred = new Uint8Array(n)
  const colourStarred = new Uint8Array(n)
  let contradiction = false

  /** Places a star and applies every blank-elimination consequence of it. */
  const placeStar = (row: number, column: number): void => {
    const index = row * n + column
    if (
      contradiction ||
      cells[index] !== CELL_UNKNOWN ||
      starColumn[row] !== -1 ||
      columnStarred[column] === 1 ||
      colourStarred[colours[index]] === 1
    ) {
      contradiction = true
      return
    }
    cells[index] = CELL_STAR
    starColumn[row] = column
    columnStarred[column] = 1
    colourStarred[colours[index]] = 1
    for (let r = 0; r < n; r += 1) {
      // Row and column elimination.
      if (cells[r * n + column] === CELL_UNKNOWN) {
        cells[r * n + column] = CELL_BLANK
      }
      if (cells[row * n + r] === CELL_UNKNOWN) {
        cells[row * n + r] = CELL_BLANK
      }
    }
    for (let dr = -1; dr <= 1; dr += 1) {
      const nr = row + dr
      if (nr < 0 || nr >= n) {
        continue
      }
      for (let dc = -1; dc <= 1; dc += 1) {
        const nc = column + dc
        if (nc < 0 || nc >= n) {
          continue
        }
        if (cells[nr * n + nc] === CELL_UNKNOWN) {
          cells[nr * n + nc] = CELL_BLANK
        }
      }
    }
    // Colour elimination.
    const colour = colours[index]
    for (let r = 0; r < n; r += 1) {
      for (let c = 0; c < n; c += 1) {
        if (colours[r * n + c] === colour && cells[r * n + c] === CELL_UNKNOWN) {
          cells[r * n + c] = CELL_BLANK
        }
      }
    }
  }

  /**
   * One sweep of hidden singles across rows, then columns, then colours.
   * Placements inside the sweep update candidates for later units in the
   * same sweep, so the pass count is a fair measure of deduction depth.
   * Returns whether any star was placed.
   */
  const sweep = (): boolean => {
    let changed = false
    for (let unit = 0; unit < n; unit += 1) {
      if (starColumn[unit] === -1) {
        let candidate = -1
        for (let c = 0; c < n; c += 1) {
          if (cells[unit * n + c] === CELL_UNKNOWN) {
            if (candidate !== -1) {
              candidate = -2
              break
            }
            candidate = c
          }
        }
        if (candidate >= 0) {
          placeStar(unit, candidate)
          changed = true
        }
      }
      if (columnStarred[unit] === 0) {
        let candidate = -1
        for (let r = 0; r < n; r += 1) {
          if (cells[r * n + unit] === CELL_UNKNOWN) {
            if (candidate !== -1) {
              candidate = -2
              break
            }
            candidate = r
          }
        }
        if (candidate >= 0) {
          placeStar(candidate, unit)
          changed = true
        }
      }
      if (colourStarred[unit] === 0) {
        let candidate = -1
        for (let r = 0; r < n && candidate !== -2; r += 1) {
          for (let c = 0; c < n; c += 1) {
            if (colours[r * n + c] === unit && cells[r * n + c] === CELL_UNKNOWN) {
              if (candidate !== -1) {
                candidate = -2
                break
              }
              candidate = r * n + c
            }
          }
        }
        if (candidate >= 0) {
          placeStar(Math.floor(candidate / n), candidate % n)
          changed = true
        }
      }
      if (contradiction) {
        return changed
      }
    }
    return changed
  }

  let rounds = 0
  let solved = false
  while (!contradiction) {
    const changed = sweep()
    if (changed) {
      rounds += 1
    }
    let allRowsStarred = true
    for (let row = 0; row < n; row += 1) {
      if (starColumn[row] === -1) {
        allRowsStarred = false
        break
      }
    }
    if (allRowsStarred) {
      solved = true
      break
    }
    if (!changed) {
      break
    }
  }

  // Defensive cross-check: propagation is only trusted when the permutation
  // it produced actually satisfies all four constraints. A propagation bug
  // must never be reported as a logically solved board.
  const solution: readonly number[] | null =
    solved && !contradiction && permutationIsValid(colours, n, Array.from(starColumn))
      ? Object.freeze(Array.from(starColumn))
      : null

  let unknownCells = 0
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] === CELL_UNKNOWN) {
      unknownCells += 1
    }
  }

  return Object.freeze({
    solvedByLogic: solution !== null,
    rounds,
    unknownCells,
    solution,
  })
}
