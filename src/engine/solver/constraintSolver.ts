import {
  assertBinaryMineBoard,
  type BinaryMineBoard,
} from '../../domain/board'
import {
  assertPatternGenerationLimits,
  LinePatternResourceLimitError,
  PatternGenerationInterruptedError,
  type LinePatternResourceLimitKind,
  type PatternGenerationContext,
  type PatternGenerationLimits,
} from '../../domain/linePatternGeneration'
import {
  assertMinegramPuzzle,
  derivePuzzleClues,
  type MinegramPuzzle,
} from '../../domain/puzzle'
import { orderedCluesEqual } from '../../domain/orderedClues'
import {
  boardFromAssignments,
  cloneAssignments,
  cloneConstraintDomainsForSearch,
  createConstraintDomains,
  propagateMutableDomainsForSearch,
  type MutableAssignments,
  type MutableConstraintDomains,
} from './propagation'
import { getLegalLinePatterns, type LegalLinePattern } from './patterns'

export const DEFAULT_MAX_SOLVER_NODES = 100_000

export interface SolverOptions extends PatternGenerationLimits {
  readonly maxNodes?: number
  readonly timeBudgetMs?: number
  readonly signal?: { readonly aborted: boolean }
  readonly now?: () => number
}

export type SolverUnknownReason =
  | 'cancelled'
  | 'interrupted'
  | 'node-limit'
  | 'time-limit'
  | 'resource-limit'
  | 'incomplete-search'

export interface SolverResourceDiagnostics {
  readonly kind: LinePatternResourceLimitKind
  readonly allowed: number
  readonly attempted: number
  readonly lineLength: number
  readonly clue: readonly number[]
}

export interface SolverDiagnostics {
  readonly nodesVisited: number
  readonly solutionsFound: 0 | 1 | 2
  readonly resource?: SolverResourceDiagnostics
}

export type SolverResult =
  | {
      readonly status: 'unique'
      readonly solution: BinaryMineBoard
      readonly diagnostics: SolverDiagnostics
    }
  | {
      readonly status: 'multiple'
      readonly solutions: readonly [BinaryMineBoard, BinaryMineBoard]
      readonly diagnostics: SolverDiagnostics
    }
  | {
      readonly status: 'none'
      readonly diagnostics: SolverDiagnostics
    }
  | {
      readonly status: 'unknown'
      readonly reason: SolverUnknownReason
      readonly diagnostics: SolverDiagnostics
    }

interface BranchLine {
  readonly orientation: 'row' | 'column'
  readonly index: number
  readonly domain: readonly number[]
  readonly patterns: readonly LegalLinePattern[]
}

function isAbortSignalLike(value: unknown): value is { readonly aborted: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof value.aborted === 'boolean'
  )
}

function assertSolverOptions(value: unknown): asserts value is SolverOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('solver options must be a non-array object')
  }
  assertPatternGenerationLimits(value, 'solver options')
  const options = value as Record<string, unknown>
  if (
    options.maxNodes !== undefined &&
    (typeof options.maxNodes !== 'number' ||
      !Number.isSafeInteger(options.maxNodes) ||
      options.maxNodes < 0)
  ) {
    throw new RangeError(`solver maxNodes must be a nonnegative safe integer; received ${String(options.maxNodes)}`)
  }
  if (
    options.timeBudgetMs !== undefined &&
    (typeof options.timeBudgetMs !== 'number' ||
      !Number.isFinite(options.timeBudgetMs) ||
      options.timeBudgetMs < 0)
  ) {
    throw new RangeError(
      `solver timeBudgetMs must be a finite nonnegative number; received ${String(options.timeBudgetMs)}`,
    )
  }
  if (options.now !== undefined && typeof options.now !== 'function') {
    throw new TypeError('solver now must be a function returning a finite millisecond value')
  }
  if (options.timeBudgetMs !== undefined && options.timeBudgetMs > 0 && options.now === undefined) {
    throw new TypeError('solver now is required when timeBudgetMs is positive')
  }
  if (options.signal !== undefined && !isAbortSignalLike(options.signal)) {
    throw new TypeError('solver signal must be an AbortSignal-like object with a boolean aborted field')
  }
}

function makeUnknown(
  reason: SolverUnknownReason,
  nodesVisited: number,
  solutionsFound: 0 | 1 | 2,
  resource?: SolverResourceDiagnostics,
): SolverResult {
  return Object.freeze({
    status: 'unknown',
    reason,
    diagnostics: Object.freeze(
      resource === undefined
        ? { nodesVisited, solutionsFound }
        : {
            nodesVisited,
            solutionsFound,
            resource: Object.freeze({ ...resource }),
          },
    ),
  })
}

function mapPatternGenerationError(
  error: unknown,
  nodesVisited: number,
  solutionsFound: 0 | 1 | 2,
): SolverResult | undefined {
  if (error instanceof PatternGenerationInterruptedError) {
    return makeUnknown(error.reason, nodesVisited, solutionsFound)
  }
  if (error instanceof LinePatternResourceLimitError) {
    return makeUnknown('resource-limit', nodesVisited, solutionsFound, {
      kind: error.kind,
      allowed: error.allowed,
      attempted: error.attempted,
      lineLength: error.lineLength,
      clue: error.clue,
    })
  }
  return undefined
}

function chooseBranchLine(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  context?: PatternGenerationContext,
): BranchLine | undefined {
  let selected: BranchLine | undefined

  for (let row = 0; row < puzzle.dimensions.rows; row += 1) {
    const domain = domains.rowDomains[row]
    if (domain.length > 1 && (selected === undefined || domain.length < selected.domain.length)) {
      selected = {
        orientation: 'row',
        index: row,
        domain,
        patterns: getLegalLinePatterns(
          puzzle.dimensions.columns,
          puzzle.clues.rowClues[row],
          context,
        ),
      }
    }
  }
  for (let column = 0; column < puzzle.dimensions.columns; column += 1) {
    const domain = domains.columnDomains[column]
    if (domain.length > 1 && (selected === undefined || domain.length < selected.domain.length)) {
      selected = {
        orientation: 'column',
        index: column,
        domain,
        patterns: getLegalLinePatterns(
          puzzle.dimensions.rows,
          puzzle.clues.columnClues[column],
          context,
        ),
      }
    }
  }
  return selected
}

function applyBranch(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
  branch: BranchLine,
  patternIndex: number,
): void {
  const pattern = branch.patterns[patternIndex]
  if (branch.orientation === 'row') {
    domains.rowDomains[branch.index] = [patternIndex]
    const start = branch.index * puzzle.dimensions.columns
    for (let column = 0; column < puzzle.dimensions.columns; column += 1) {
      assignments[start + column] = pattern.cells[column]
    }
    return
  }

  domains.columnDomains[branch.index] = [patternIndex]
  for (let row = 0; row < puzzle.dimensions.rows; row += 1) {
    assignments[row * puzzle.dimensions.columns + branch.index] = pattern.cells[row]
  }
}

function isComplete(assignments: MutableAssignments): boolean {
  return assignments.every((cell) => cell !== undefined)
}

function readSolverClock(clock: () => number): number {
  const current = clock()
  if (!Number.isFinite(current)) {
    throw new TypeError('solver now must return a finite millisecond value')
  }
  return current
}

function getNonNodeStop(
  options: SolverOptions,
  startTime: number | undefined,
): 'cancelled' | 'time-limit' | undefined {
  if (options.signal?.aborted) {
    return 'cancelled'
  }
  if (startTime !== undefined) {
    const clock = options.now!
    if (readSolverClock(clock) - startTime >= options.timeBudgetMs!) {
      return 'time-limit'
    }
  }
  return undefined
}

export function solvePuzzle(
  puzzle: MinegramPuzzle,
  options: SolverOptions = {},
): SolverResult {
  assertMinegramPuzzle(puzzle)
  assertSolverOptions(options)

  const maxNodes = options.maxNodes ?? DEFAULT_MAX_SOLVER_NODES
  let nodesVisited = 0
  const solutions: BinaryMineBoard[] = []

  // These checks intentionally precede all domain/pattern construction. A
  // cancelled or zero-budget solve must not pay for a large legal-pattern set.
  if (options.signal?.aborted) {
    return makeUnknown('cancelled', nodesVisited, 0)
  }
  if (maxNodes === 0) {
    return makeUnknown('node-limit', nodesVisited, 0)
  }
  if (options.timeBudgetMs === 0) {
    return makeUnknown('time-limit', nodesVisited, 0)
  }

  const startTime =
    options.timeBudgetMs === undefined
      ? undefined
      : readSolverClock(options.now!)
  const getStop = (): SolverUnknownReason | undefined => {
    if (options.signal?.aborted) {
      return 'cancelled'
    }
    if (nodesVisited >= maxNodes) {
      return 'node-limit'
    }
    return getNonNodeStop(options, startTime)
  }

  const initialStop = getStop()
  if (initialStop !== undefined) {
    return makeUnknown(initialStop, nodesVisited, 0)
  }

  const hasPatternGenerationControl =
    options.signal !== undefined ||
    options.timeBudgetMs !== undefined ||
    options.maxPatternCount !== undefined ||
    options.maxMaterializedCells !== undefined
  const patternContext: PatternGenerationContext | undefined = hasPatternGenerationControl
    ? {
        maxPatternCount: options.maxPatternCount,
        maxMaterializedCells: options.maxMaterializedCells,
        signal: options.signal,
        now: options.now,
        shouldStop: () => {
          const stop = getNonNodeStop(options, startTime)
          return stop === undefined ? undefined : stop
        },
      }
    : undefined

  let initialDomains: MutableConstraintDomains
  try {
    initialDomains = createConstraintDomains(puzzle, patternContext)
  } catch (error) {
    const unknown = mapPatternGenerationError(error, nodesVisited, 0)
    if (unknown !== undefined) {
      return unknown
    }
    throw error
  }
  const initialAssignments: MutableAssignments = Array.from(
    { length: puzzle.dimensions.rows * puzzle.dimensions.columns },
    () => undefined,
  )

  const search = (
    domains: MutableConstraintDomains,
    assignments: MutableAssignments,
  ): SolverUnknownReason | undefined => {
    const entryStop = getStop()
    if (entryStop !== undefined) {
      return entryStop
    }
    nodesVisited += 1

    const propagationStop = getNonNodeStop(options, startTime)
    if (propagationStop !== undefined) {
      return propagationStop
    }
    const propagationStatus = propagateMutableDomainsForSearch(
      puzzle,
      domains,
      assignments,
      undefined,
      patternContext,
    )
    if (propagationStatus === 'stopped') {
      return getNonNodeStop(options, startTime) ?? 'interrupted'
    }
    const postPropagationStop = getNonNodeStop(options, startTime)
    if (postPropagationStop !== undefined) {
      return postPropagationStop
    }
    if (propagationStatus === 'contradiction') {
      return undefined
    }

    if (isComplete(assignments)) {
      // Do not accept a witness if cancellation or the elapsed-time budget
      // became true at the completion boundary.
      const completionStop = getNonNodeStop(options, startTime)
      if (completionStop !== undefined) {
        return completionStop
      }
      solutions.push(boardFromAssignments(assignments, puzzle.dimensions))
      return undefined
    }

    const branch = chooseBranchLine(puzzle, domains, patternContext)
    if (branch === undefined) {
      return getNonNodeStop(options, startTime) ?? 'incomplete-search'
    }

    for (const patternIndex of branch.domain) {
      const childDomains = cloneConstraintDomainsForSearch(domains)
      const childAssignments = cloneAssignments(assignments, puzzle.dimensions)
      applyBranch(puzzle, childDomains, childAssignments, branch, patternIndex)
      const stop = search(childDomains, childAssignments)
      if (stop !== undefined) {
        return stop
      }
      if (solutions.length >= 2) {
        return getNonNodeStop(options, startTime)
      }
    }
    return getNonNodeStop(options, startTime)
  }

  let stop: SolverUnknownReason | undefined
  try {
    stop = search(initialDomains, initialAssignments)
  } catch (error) {
    const unknown = mapPatternGenerationError(
      error,
      nodesVisited,
      Math.min(solutions.length, 2) as 0 | 1 | 2,
    )
    if (unknown !== undefined) {
      return unknown
    }
    throw error
  }
  if (stop !== undefined) {
    return makeUnknown(stop, nodesVisited, Math.min(solutions.length, 2) as 0 | 1 | 2)
  }

  const diagnostics = Object.freeze({
    nodesVisited,
    solutionsFound: solutions.length as 0 | 1 | 2,
  })
  if (solutions.length === 0) {
    return Object.freeze({ status: 'none', diagnostics })
  }
  if (solutions.length === 1) {
    return Object.freeze({ status: 'unique', solution: solutions[0], diagnostics })
  }

  return Object.freeze({
    status: 'multiple',
    solutions: Object.freeze([solutions[0], solutions[1]] as const),
    diagnostics,
  })
}

export function validateSolutionBoard(
  solution: BinaryMineBoard,
  puzzle: MinegramPuzzle,
): void {
  assertMinegramPuzzle(puzzle)
  assertBinaryMineBoard(solution, puzzle.dimensions, 'solver solution')

  const actualClues = derivePuzzleClues(solution, puzzle.dimensions)
  for (let row = 0; row < puzzle.dimensions.rows; row += 1) {
    if (!orderedCluesEqual(actualClues.rowClues[row], puzzle.clues.rowClues[row])) {
      throw new RangeError(
        `solver solution row ${row} does not match its ordered clue [${puzzle.clues.rowClues[row].join(', ')}]`,
      )
    }
  }
  for (let column = 0; column < puzzle.dimensions.columns; column += 1) {
    if (!orderedCluesEqual(actualClues.columnClues[column], puzzle.clues.columnClues[column])) {
      throw new RangeError(
        `solver solution column ${column} does not match its ordered clue [${puzzle.clues.columnClues[column].join(', ')}]`,
      )
    }
  }
}
