import {
  LinePatternResourceLimitError,
  PatternGenerationInterruptedError,
  type BinaryLine,
  type OrderedLineClue,
  type PatternGenerationContext,
} from '../domain'
import { getLegalLinePatterns, type LegalLinePattern } from '../engine/solver/patterns'
import type { CellMark } from './gameReducer'

export type LineOrientation = 'row' | 'column'
/**
 * `ready` means pattern enumeration succeeded, so `compatiblePatternCount` is
 * known. `unknown` means enumeration was interrupted or hit a resource limit
 * and no count exists. Whether the line is finished is reported separately by
 * `complete`, which also requires every cell to be explicitly labeled.
 */
export type LineProgressStatus = 'ready' | 'unknown'

export interface OrderedRunProgress {
  readonly runIndex: number
  readonly length: number
  readonly start: number | null
  readonly end: number | null
  readonly invariant: boolean
  readonly mineIndices: readonly number[]
  readonly complete: boolean
}

export interface LineProgress {
  readonly orientation: LineOrientation
  readonly index: number
  readonly clue: OrderedLineClue
  readonly fullyLabeled: boolean
  readonly compatiblePatternCount: number | null
  readonly contradiction: boolean
  readonly status: LineProgressStatus
  readonly complete: boolean
  readonly runs: readonly OrderedRunProgress[]
}

export interface DeriveLineProgressInput {
  readonly orientation?: LineOrientation
  readonly index?: number
  readonly lineLength: number
  readonly clue: OrderedLineClue
  readonly marks: readonly CellMark[]
  /** Optional true solution used to distinguish an explicit correct blank from a merely legal blank. */
  readonly solution?: BinaryLine
  readonly patternContext?: PatternGenerationContext
}

function isCellMark(value: unknown): value is CellMark {
  return value === 'unknown' || value === 'mine' || value === 'blank'
}

function patternMatchesMarks(pattern: LegalLinePattern, marks: readonly CellMark[]): boolean {
  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]
    if (mark === 'unknown') {
      continue
    }
    if (pattern.cells[index] !== (mark === 'mine' ? 1 : 0)) {
      return false
    }
  }
  return true
}

function findRunStart(cells: BinaryLine, runIndex: number): number {
  let currentRun = 0
  for (let index = 0; index < cells.length; index += 1) {
    if (cells[index] !== 1) {
      continue
    }
    if (index > 0 && cells[index - 1] === 1) {
      continue
    }
    if (currentRun === runIndex) {
      return index
    }
    currentRun += 1
  }
  throw new Error(`legal pattern does not contain ordered run ${runIndex}`)
}

function incompleteRuns(clue: OrderedLineClue): readonly OrderedRunProgress[] {
  return Object.freeze(
    clue.map((length, runIndex) =>
      Object.freeze({
        runIndex,
        length,
        start: null,
        end: null,
        invariant: false,
        mineIndices: Object.freeze([]),
        complete: false,
      }),
    ),
  )
}

/**
 * The start of `runIndex` in a concrete mine line, or `null` when the line does
 * not contain that run at all.
 *
 * `findRunStart` throws for a line that lacks the run, and a `solution` handed
 * to this module is not re-validated against the clue, so a test or a stale
 * board can produce a line with fewer runs than the clue claims. Returning
 * `null` keeps that case a plain "unknown" instead of an exception.
 */
function solutionRunStart(solution: BinaryLine, runIndex: number): number | null {
  let currentRun = 0
  for (let index = 0; index < solution.length; index += 1) {
    if (solution[index] !== 1) {
      continue
    }
    if (index > 0 && solution[index - 1] === 1) {
      continue
    }
    if (currentRun === runIndex) {
      return index
    }
    currentRun += 1
  }
  return null
}

/**
 * Every cell of `runIndex` in a concrete mine line, or `null` when the line does not
 * contain that run. The length is measured from the line rather than taken from the
 * clue, so a line that disagrees with the clue reports what it actually holds.
 */
function solutionRunCells(solution: BinaryLine, runIndex: number): readonly number[] | null {
  const start = solutionRunStart(solution, runIndex)
  if (start === null) {
    return null
  }
  let end = start
  while (end + 1 < solution.length && solution[end + 1] === 1) {
    end += 1
  }
  return Object.freeze(Array.from({ length: end - start + 1 }, (_, offset) => start + offset))
}

function deriveRuns(
  clue: OrderedLineClue,
  compatiblePatterns: readonly LegalLinePattern[],
  marks: readonly CellMark[],
  solution: BinaryLine | undefined,
): readonly OrderedRunProgress[] {
  // A contradiction has no compatible placement, so no run can be settled.
  if (compatiblePatterns.length === 0) {
    return incompleteRuns(clue)
  }

  // A run start is usable only when every compatible pattern agrees on it.
  // Separator ranges are derived from two consecutive run starts, so both the
  // preceding run and the current run must be invariant before a separator can
  // be called complete; otherwise the run is conservatively incomplete.
  const starts = clue.map((_length, runIndex) => {
    const first = findRunStart(compatiblePatterns[0].cells, runIndex)
    return compatiblePatterns.every(
      (pattern) => findRunStart(pattern.cells, runIndex) === first,
    )
      ? first
      : null
  })

  return Object.freeze(
    clue.map((length, runIndex) => {
      /**
       * Which cells are this run's mines.
       *
       * The clue only forces a run's position once the ambiguity is resolved, so
       * a run whose start still varies has no window the clue can offer. The
       * rule that matters is the player's, not the deduction's: a run reads as
       * located as soon as every one of its mines is marked, which is exactly
       * the condition `revealEligibleLines` accepts for a whole line before the
       * game fills its gaps. Gating the highlight on a *proved* start and a
       * *proved* separator made it strictly stronger than that rule, so a player
       * who had correctly placed the `7` and both `2`s of `7 2 2 1` and left the
       * trailing `1` open saw only the `7` lit. With a solution the window is
       * read straight off it; without one an unforced run stays open, which is
       * the conservative answer.
       */
      const deducedStart = starts[runIndex]
      const mineCells =
        deducedStart !== null
          ? Object.freeze(Array.from({ length }, (_, offset) => deducedStart + offset))
          : solution === undefined
            ? null
            : solutionRunCells(solution, runIndex)

      if (mineCells === null) {
        return Object.freeze({
          runIndex,
          length,
          start: null,
          end: null,
          invariant: false,
          mineIndices: Object.freeze([]),
          complete: false,
        })
      }

      let mineCellsMarked = true
      for (const index of mineCells) {
        if (
          marks[index] !== 'mine' ||
          (solution !== undefined && solution[index] !== 1)
        ) {
          mineCellsMarked = false
          break
        }
      }

      return Object.freeze({
        runIndex,
        length,
        start: deducedStart,
        end: mineCells[mineCells.length - 1],
        invariant: deducedStart !== null,
        mineIndices: mineCells,
        complete: mineCellsMarked,
      })
    }),
  )
}

function resourceOrInterruption(error: unknown): boolean {
  return (
    error instanceof PatternGenerationInterruptedError ||
    error instanceof LinePatternResourceLimitError
  )
}

export function deriveLineProgress(input: DeriveLineProgressInput): LineProgress {
  if (!Number.isSafeInteger(input.lineLength) || input.lineLength <= 0) {
    throw new RangeError(`lineLength must be a positive safe integer; received ${String(input.lineLength)}`)
  }
  if (input.marks.length !== input.lineLength) {
    throw new RangeError(`marks must contain exactly ${input.lineLength} cells; received ${input.marks.length}`)
  }
  for (const mark of input.marks) {
    if (!isCellMark(mark)) {
      throw new TypeError(`line marks must contain only unknown, mine, or blank; received ${String(mark)}`)
    }
  }
  if (input.solution !== undefined) {
    if (input.solution.length !== input.lineLength) {
      throw new RangeError(
        `solution must contain exactly ${input.lineLength} cells; received ${input.solution.length}`,
      )
    }
    for (const cell of input.solution) {
      if (cell !== 0 && cell !== 1) {
        throw new TypeError(`solution cells must be binary; received ${String(cell)}`)
      }
    }
  }

  const orientation = input.orientation ?? 'row'
  const index = input.index ?? 0
  const clue = Object.freeze([...input.clue])
  const fullyLabeled = input.marks.every((mark) => mark !== 'unknown')

  let compatiblePatterns: readonly LegalLinePattern[]
  try {
    compatiblePatterns = getLegalLinePatterns(
      input.lineLength,
      clue,
      input.patternContext,
    ).filter((pattern) => patternMatchesMarks(pattern, input.marks))
  } catch (error) {
    if (!resourceOrInterruption(error)) {
      throw error
    }
    return Object.freeze({
      orientation,
      index,
      clue,
      fullyLabeled,
      compatiblePatternCount: null,
      contradiction: false,
      status: 'unknown',
      complete: false,
      runs: incompleteRuns(clue),
    })
  }

  const compatiblePatternCount = compatiblePatterns.length
  // Enumeration succeeded, so the count is known even when the line is not fully
  // labeled yet. "Complete" stays the stronger fully-labeled condition.
  const complete = fullyLabeled && compatiblePatternCount > 0
  return Object.freeze({
    orientation,
    index,
    clue,
    fullyLabeled,
    compatiblePatternCount,
    contradiction: compatiblePatternCount === 0,
    status: 'ready',
    complete,
    runs: deriveRuns(clue, compatiblePatterns, input.marks, input.solution),
  })
}
