/**
 * Star Battle propagation solver: the depth metric AND the generation
 * certificate in one pass.
 *
 * Wave semantics (this is the contract other lanes read `waves` against):
 * a WAVE is one sweep over the frozen state that finds EVERY forced move,
 * applies them ALL SIMULTANEOUSLY, and counts as one wave if it wrote
 * anything. A placement made in one wave may only enable deductions in the
 * NEXT wave — no within-wave cascade — so `waves` measures how many
 * deduction fronts the board survives, not how much work the solver did.
 *
 * The rule set per wave, each rule citing a member of
 * {@link StarPropagationReason}:
 * - star-elimination / blank-elimination — an unknown cell sharing a row,
 *   column or colour with a placed star, or lying within Chebyshev distance
 *   1 of one (`row-excluded`, `column-excluded`, `colour-excluded`,
 *   `proximity-excluded`), is blank. Exclusions are collected per star and
 *   applied as one simultaneous set.
 * - hidden single — a row, column or colour that holds no star and has
 *   exactly one remaining candidate ON THE FROZEN STATE (`row-singleton`,
 *   `column-singleton`, `colour-singleton`) places its star there. Candidate
 *   counts are computed before this wave's own writes, which is what makes
 *   the simultaneity real.
 *
 * A unit that holds no star and no remaining candidate is unsolvable
 * (rule R4 — every colour must end with exactly one star — makes a dead
 * colour fatal), and a demand that collides with a placed star, another
 * demand's exclusivity, or the 3×3 rule is a contradiction. Both stop the
 * loop honestly: `solved === false`, never a guess.
 *
 * What a caller may conclude:
 * - `solved === true` — the board has exactly one solution and `stars` is
 *   it. Propagation never guesses, so a full placement is a uniqueness
 *   certificate that is stronger than counting and far cheaper.
 * - `solved === false` — nothing about the true solution count; `waves`
 *   and `stalledRounds` say only where propagation stopped.
 *
 * `waves === 0` means the very first sweep found nothing deducible at all;
 * that is reported as-is (a board can be perfectly valid yet opaque to
 * this rule set).
 */
import { assertStarColours } from '../../domain/starBattle'

/**
 * The vocabulary of the propagation rule set. The simultaneous sweep does
 * not surface per-move reasons in {@link StarPropagationResult}; the type
 * is exported so lanes that wrap the solver (hint layers, replay tooling)
 * share one name for each deduction kind.
 */
export type StarPropagationReason =
  | 'row-excluded'
  | 'column-excluded'
  | 'colour-excluded'
  | 'proximity-excluded'
  | 'row-singleton'
  | 'column-singleton'
  | 'colour-singleton'

export interface StarPropagationResult {
  /** Whether propagation placed all n stars without contradiction. */
  readonly solved: boolean
  /**
   * Simultaneous sweeps that wrote at least one cell. The difficulty/depth
   * metric; see the module doc for the exact semantics.
   */
  readonly waves: number
  /**
   * The stars propagation placed, as `[row, col]` pairs in row order. The
   * full planted permutation when `solved`, the partial placement otherwise.
   */
  readonly stars: readonly (readonly [row: number, col: number])[]
  /**
   * Sweeps that produced no move. `0` whenever `solved`; at least 1
   * otherwise (an unsolved run always ends on a sweep that wrote nothing).
   */
  readonly stalledRounds: number
}

const UNKNOWN = 0
const BLANK = 1
const STAR = 2

export function propagateStarBoard(colours: Uint8Array, n: number): StarPropagationResult {
  assertStarColours(colours, n)

  const cells = new Uint8Array(n * n)
  const starColumnOfRow = new Int16Array(n).fill(-1)
  const starRowOfColumn = new Int16Array(n).fill(-1)
  const starCellOfColour = new Int32Array(n).fill(-1)
  const colourCells: number[][] = []
  for (let colour = 0; colour < n; colour += 1) {
    colourCells.push([])
  }
  for (let index = 0; index < n * n; index += 1) {
    colourCells[colours[index]].push(index)
  }

  let placed = 0
  let waves = 0
  let stalledRounds = 0
  let contradiction = false
  // Each wave writes at least one cell, so waves are bounded by the cell
  // count; the cap is a belt-and-braces guard against a future edit
  // breaking that monotonicity argument.
  const waveCap = n * n + 4

  while (placed < n && !contradiction && waves < waveCap) {
    // --- blanks: every unknown cell excluded by a placed star -------------
    // Collected per star; a cell reached twice is skipped at write time.
    const blanks: number[] = []
    for (let row = 0; row < n; row += 1) {
      const column = starColumnOfRow[row]
      if (column === -1) {
        continue
      }
      for (let c = 0; c < n; c += 1) {
        const index = row * n + c
        if (cells[index] === UNKNOWN) {
          blanks.push(index)
        }
      }
      for (let r = 0; r < n; r += 1) {
        const index = r * n + column
        if (cells[index] === UNKNOWN) {
          blanks.push(index)
        }
      }
      for (let dr = -1; dr <= 1; dr += 1) {
        const nearRow = row + dr
        if (nearRow < 0 || nearRow >= n) {
          continue
        }
        for (let dc = -1; dc <= 1; dc += 1) {
          const nearColumn = column + dc
          if (nearColumn < 0 || nearColumn >= n) {
            continue
          }
          const index = nearRow * n + nearColumn
          if (cells[index] === UNKNOWN) {
            blanks.push(index)
          }
        }
      }
      for (const index of colourCells[colours[row * n + column]]) {
        if (cells[index] === UNKNOWN) {
          blanks.push(index)
        }
      }
    }

    // --- hidden singles, counted on the FROZEN state ----------------------
    // A demand is a starless unit whose unknown cells number exactly one
    // before this wave's writes land.
    const demands: number[] = []
    let deadUnit = false
    const scanUnit = (indices: readonly number[]): void => {
      let hasStar = false
      let candidate = -1
      let count = 0
      for (const index of indices) {
        if (cells[index] === STAR) {
          hasStar = true
          break
        }
        if (cells[index] === UNKNOWN) {
          count += 1
          if (count > 1) {
            break
          }
          candidate = index
        }
      }
      if (hasStar) {
        return
      }
      if (count === 0) {
        // Rule R4: a unit that can host no remaining star is unsolvable.
        deadUnit = true
      } else if (count === 1) {
        demands.push(candidate)
      }
    }
    for (let row = 0; row < n; row += 1) {
      const indices: number[] = []
      for (let column = 0; column < n; column += 1) {
        indices.push(row * n + column)
      }
      scanUnit(indices)
    }
    for (let column = 0; column < n; column += 1) {
      const indices: number[] = []
      for (let row = 0; row < n; row += 1) {
        indices.push(row * n + column)
      }
      scanUnit(indices)
    }
    for (let colour = 0; colour < n; colour += 1) {
      scanUnit(colourCells[colour])
    }

    if (blanks.length === 0 && demands.length === 0) {
      stalledRounds += 1
      break
    }

    // --- simultaneous apply -----------------------------------------------
    for (const index of blanks) {
      if (cells[index] === UNKNOWN) {
        cells[index] = BLANK
      }
    }
    for (const index of new Set(demands)) {
      const row = Math.floor(index / n)
      const column = index % n
      const colour = colours[index]
      let proximate = false
      for (let nearRow = 0; nearRow < n && !proximate; nearRow += 1) {
        const nearColumn = starColumnOfRow[nearRow]
        if (nearColumn !== -1 && Math.abs(nearRow - row) <= 1 && Math.abs(nearColumn - column) <= 1) {
          proximate = true
        }
      }
      if (
        cells[index] !== UNKNOWN ||
        starColumnOfRow[row] !== -1 ||
        starRowOfColumn[column] !== -1 ||
        starCellOfColour[colour] !== -1 ||
        proximate
      ) {
        contradiction = true
        break
      }
      cells[index] = STAR
      starColumnOfRow[row] = column
      starRowOfColumn[column] = row
      starCellOfColour[colour] = index
      placed += 1
    }
    if (deadUnit) {
      contradiction = true
    }
    waves += 1
  }

  if (placed === n && !contradiction && waves < waveCap) {
    const stars: (readonly [number, number])[] = []
    for (let row = 0; row < n; row += 1) {
      stars.push(Object.freeze([row, starColumnOfRow[row]] as const))
    }
    return Object.freeze({ solved: true, waves, stars: Object.freeze(stars), stalledRounds: 0 })
  }
  const stars: (readonly [number, number])[] = []
  for (let row = 0; row < n; row += 1) {
    if (starColumnOfRow[row] !== -1) {
      stars.push(Object.freeze([row, starColumnOfRow[row]] as const))
    }
  }
  return Object.freeze({
    solved: false,
    waves,
    stars: Object.freeze(stars),
    stalledRounds: Math.max(1, stalledRounds),
  })
}
