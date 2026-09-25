import {
  assertPatternGenerationLimits,
  LinePatternResourceLimitError,
  PatternGenerationInterruptedError,
  type PatternGenerationContext,
  type PatternGenerationLimits,
} from '../../domain/linePatternGeneration'
import { assertMinegramPuzzle, type MinegramPuzzle } from '../../domain/puzzle'
import {
  cloneConstraintDomainsForSearch,
  createConstraintDomains,
  propagateMutableDomainsForSearch,
  type MutableAssignments,
  type MutableConstraintDomains,
} from './propagation'

export type DifficultyBand = 'starter' | 'steady' | 'challenging' | 'expert'

export const DEFAULT_MAX_DIFFICULTY_NODES = 2_000

export type DifficultyUnknownReason =
  | 'cancelled'
  | 'time-limit'
  | 'node-limit'
  | 'resource-limit'
  | 'interrupted'
  | 'incomplete-search'

export interface DifficultyOptions extends PatternGenerationLimits {
  readonly maxNodes?: number
  readonly timeBudgetMs?: number
  readonly signal?: { readonly aborted: boolean }
  readonly now?: () => number
}

export interface DifficultyDiagnostics {
  readonly nodesVisited: number
  readonly statesEvaluated: number
  readonly memoEntries: number
  readonly maxDepth: number
}

export type DifficultyResult =
  | {
      readonly status: 'known'
      readonly minimumGuesses: number
      /** Alias retained for callers that use the shorter metric name. */
      readonly minimum: number
      readonly band: DifficultyBand
      readonly diagnostics: DifficultyDiagnostics
    }
  | {
      readonly status: 'unknown'
      readonly reason: DifficultyUnknownReason
      readonly diagnostics: DifficultyDiagnostics
    }

export const DIFFICULTY_BANDS: readonly DifficultyBand[] = Object.freeze([
  'starter',
  'steady',
  'challenging',
  'expert',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isAbortSignalLike(value: unknown): value is { readonly aborted: boolean } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'aborted' in value &&
    typeof value.aborted === 'boolean'
  )
}

function assertDifficultyOptions(value: unknown): asserts value is DifficultyOptions {
  if (value === undefined) {
    return
  }
  if (!isRecord(value)) {
    throw new TypeError('difficulty options must be a non-array object')
  }
  assertPatternGenerationLimits(value, 'difficulty options')
  if (
    value.maxNodes !== undefined &&
    (typeof value.maxNodes !== 'number' ||
      !Number.isSafeInteger(value.maxNodes) ||
      value.maxNodes < 0)
  ) {
    throw new RangeError(
      `difficulty maxNodes must be a nonnegative safe integer; received ${String(value.maxNodes)}`,
    )
  }
  if (
    value.timeBudgetMs !== undefined &&
    (typeof value.timeBudgetMs !== 'number' ||
      !Number.isFinite(value.timeBudgetMs) ||
      value.timeBudgetMs < 0)
  ) {
    throw new RangeError(
      `difficulty timeBudgetMs must be a finite nonnegative number; received ${String(value.timeBudgetMs)}`,
    )
  }
  if (value.now !== undefined && typeof value.now !== 'function') {
    throw new TypeError('difficulty now must be a function returning a finite millisecond value')
  }
  if (value.timeBudgetMs !== undefined && value.timeBudgetMs > 0 && value.now === undefined) {
    throw new TypeError('difficulty now is required when timeBudgetMs is supplied')
  }
  if (value.signal !== undefined && !isAbortSignalLike(value.signal)) {
    throw new TypeError('difficulty signal must be an AbortSignal-like object with a boolean aborted field')
  }
}

function readDifficultyClock(clock: () => number): number {
  const current = clock()
  if (!Number.isFinite(current)) {
    throw new TypeError('difficulty now must return a finite millisecond value')
  }
  return current
}

export function difficultyBandForMinimumGuesses(minimumGuesses: number): DifficultyBand {
  if (!Number.isSafeInteger(minimumGuesses) || minimumGuesses < 0) {
    throw new RangeError(
      `minimumGuesses must be a nonnegative safe integer; received ${String(minimumGuesses)}`,
    )
  }
  if (minimumGuesses === 0) {
    return 'starter'
  }
  if (minimumGuesses <= 2) {
    return 'steady'
  }
  if (minimumGuesses <= 5) {
    return 'challenging'
  }
  return 'expert'
}

export function isDifficultyBandSatisfied(
  minimumGuesses: number,
  requestedBand: DifficultyBand,
): boolean {
  if (!DIFFICULTY_BANDS.includes(requestedBand)) {
    throw new TypeError(`unknown difficulty band: ${String(requestedBand)}`)
  }
  const band = difficultyBandForMinimumGuesses(minimumGuesses)
  if (requestedBand === 'expert') {
    return band === 'expert'
  }
  return band === requestedBand
}

function isComplete(assignments: MutableAssignments): boolean {
  return assignments.every((cell) => cell !== undefined)
}

function stateKey(
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
): string {
  let key = assignments.map((cell) => (cell === undefined ? '?' : String(cell))).join('')
  for (const domain of domains.rowDomains) {
    key += `|r${domain.join(',')}`
  }
  for (const domain of domains.columnDomains) {
    key += `|c${domain.join(',')}`
  }
  return key
}

function orderedUnresolvedCells(
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
  columns: number,
): number[] {
  const candidates: Array<{ readonly index: number; readonly score: number }> = []
  for (let cellIndex = 0; cellIndex < assignments.length; cellIndex += 1) {
    if (assignments[cellIndex] !== undefined) {
      continue
    }
    const row = Math.floor(cellIndex / columns)
    const column = cellIndex % columns
    const rowPatterns = domains.rowDomains[row]?.length ?? Number.MAX_SAFE_INTEGER
    const columnPatterns = domains.columnDomains[column]?.length ?? Number.MAX_SAFE_INTEGER
    candidates.push({ index: cellIndex, score: rowPatterns + columnPatterns })
  }
  candidates.sort((left, right) => left.score - right.score || left.index - right.index)
  return candidates.map(({ index }) => index)
}

function makeUnknown(
  reason: DifficultyUnknownReason,
  diagnostics: DifficultyDiagnostics,
): DifficultyResult {
  return Object.freeze({ status: 'unknown', reason, diagnostics: Object.freeze(diagnostics) })
}

function mapPatternError(error: unknown): DifficultyUnknownReason | undefined {
  if (error instanceof PatternGenerationInterruptedError) {
    return error.reason
  }
  if (error instanceof LinePatternResourceLimitError) {
    return 'resource-limit'
  }
  return undefined
}

class DifficultyBudgetStop {
  readonly reason: DifficultyUnknownReason

  constructor(reason: DifficultyUnknownReason) {
    this.reason = reason
  }
}

class AnalysisBudget {
  maxNodes: number
  timeBudgetMs: number | undefined
  clock: (() => number) | undefined
  signal: { readonly aborted: boolean } | undefined
  startTime: number | undefined
  nodesVisited: number
  maxDepth: number

  constructor(fields: {
    readonly maxNodes: number
    readonly timeBudgetMs: number | undefined
    readonly clock: (() => number) | undefined
    readonly signal: { readonly aborted: boolean } | undefined
    readonly startTime: number | undefined
  }) {
    this.maxNodes = fields.maxNodes
    this.timeBudgetMs = fields.timeBudgetMs
    this.clock = fields.clock
    this.signal = fields.signal
    this.startTime = fields.startTime
    this.nodesVisited = 0
    this.maxDepth = 0
  }

  stopReason(): DifficultyUnknownReason | undefined {
    if (this.signal?.aborted) {
      return 'cancelled'
    }
    if (this.timeBudgetMs === 0) {
      return 'time-limit'
    }
    if (this.startTime !== undefined) {
      const elapsed = readDifficultyClock(this.clock!) - this.startTime
      if (elapsed >= this.timeBudgetMs!) {
        return 'time-limit'
      }
    }
    if (this.nodesVisited >= this.maxNodes) {
      return 'node-limit'
    }
    return undefined
  }

  check(): void {
    const reason = this.stopReason()
    if (reason !== undefined) {
      throw new DifficultyBudgetStop(reason)
    }
  }
}

interface PropagatedState {
  readonly domains: MutableConstraintDomains
  readonly assignments: MutableAssignments
  readonly status: 'stable' | 'contradiction'
}

function childState(
  puzzle: MinegramPuzzle,
  state: { readonly domains: MutableConstraintDomains; readonly assignments: MutableAssignments },
  cellIndex: number,
  value: 0 | 1,
  context: PatternGenerationContext,
  budget: AnalysisBudget,
): PropagatedState {
  const domains = cloneConstraintDomainsForSearch(state.domains)
  const assignments = [...state.assignments]
  assignments[cellIndex] = value
  const status = propagateMutableDomainsForSearch(puzzle, domains, assignments, undefined, context)
  if (status === 'stopped') {
    const reason = budget.stopReason() ?? 'interrupted'
    throw new DifficultyBudgetStop(
      reason === 'cancelled' || reason === 'time-limit' || reason === 'node-limit'
        ? reason
        : 'interrupted',
    )
  }
  return { domains, assignments, status }
}

function propagationStatus(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
  context: PatternGenerationContext,
  budget: AnalysisBudget,
): 'stable' | 'contradiction' {
  const status = propagateMutableDomainsForSearch(
    puzzle,
    domains,
    assignments,
    undefined,
    context,
  )
  if (status === 'stopped') {
    const reason = budget.stopReason() ?? 'interrupted'
    throw new DifficultyBudgetStop(
      reason === 'cancelled' || reason === 'time-limit' || reason === 'node-limit'
        ? reason
        : 'interrupted',
    )
  }
  return status
}

export function analyzeDifficulty(
  puzzle: MinegramPuzzle,
  options: DifficultyOptions = {},
): DifficultyResult {
  assertMinegramPuzzle(puzzle)
  assertDifficultyOptions(options)

  const maxNodes = options.maxNodes ?? DEFAULT_MAX_DIFFICULTY_NODES
  const signal = options.signal
  if (signal?.aborted) {
    return makeUnknown('cancelled', {
      nodesVisited: 0,
      statesEvaluated: 0,
      memoEntries: 0,
      maxDepth: 0,
    })
  }
  if (maxNodes === 0) {
    return makeUnknown('node-limit', {
      nodesVisited: 0,
      statesEvaluated: 0,
      memoEntries: 0,
      maxDepth: 0,
    })
  }
  if (options.timeBudgetMs === 0) {
    return makeUnknown('time-limit', {
      nodesVisited: 0,
      statesEvaluated: 0,
      memoEntries: 0,
      maxDepth: 0,
    })
  }

  const clock = options.timeBudgetMs === undefined ? undefined : options.now
  const startTime = clock === undefined ? undefined : readDifficultyClock(clock)
  const mutableBudget = new AnalysisBudget({
    maxNodes,
    timeBudgetMs: options.timeBudgetMs,
    clock,
    signal,
    startTime,
  })

  const memo = new Map<string, boolean>()
  let statesEvaluated = 0
  let maxDepth = 0
  let initialDomains: MutableConstraintDomains
  const patternContext: PatternGenerationContext = {
    maxPatternCount: options.maxPatternCount,
    maxMaterializedCells: options.maxMaterializedCells,
    signal: options.signal,
    shouldStop: () => {
      const reason = mutableBudget.stopReason()
      if (reason === undefined) {
        return undefined
      }
      return reason === 'node-limit' ||
        reason === 'resource-limit' ||
        reason === 'incomplete-search'
        ? 'interrupted'
        : reason
    },
  }
  try {
    initialDomains = createConstraintDomains(puzzle, patternContext)
  } catch (error) {
    const reason = mapPatternError(error)
    if (reason !== undefined) {
      return makeUnknown(reason, {
        nodesVisited: 0,
        statesEvaluated: 0,
        memoEntries: memo.size,
        maxDepth: 0,
      })
    }
    throw error
  }

  const canSolveWithin = (
    domains: MutableConstraintDomains,
    assignments: MutableAssignments,
    remainingGuesses: number,
    depth: number,
  ): boolean => {
    mutableBudget.check()
    const key = `${remainingGuesses}|${stateKey(domains, assignments)}`
    const cached = memo.get(key)
    if (cached !== undefined) {
      return cached
    }

    mutableBudget.nodesVisited += 1
    statesEvaluated += 1
    maxDepth = Math.max(maxDepth, depth)
    mutableBudget.maxDepth = maxDepth

    if (isComplete(assignments)) {
      memo.set(key, true)
      return true
    }

    const unresolvedCells = orderedUnresolvedCells(
      domains,
      assignments,
      puzzle.dimensions.columns,
    )
    let sawViableBranch = false
    for (const cellIndex of unresolvedCells) {
      mutableBudget.check()
      const zero = childState(
        puzzle,
        { domains, assignments },
        cellIndex,
        0,
        patternContext,
        mutableBudget,
      )
      mutableBudget.check()
      if (zero.status === 'stable') {
        const one = childState(
          puzzle,
          { domains, assignments },
          cellIndex,
          1,
          patternContext,
          mutableBudget,
        )
        mutableBudget.check()
        if (one.status === 'stable') {
          sawViableBranch = true
          if (
            remainingGuesses > 0 &&
            canSolveWithin(zero.domains, zero.assignments, remainingGuesses - 1, depth + 1) &&
            canSolveWithin(one.domains, one.assignments, remainingGuesses - 1, depth + 1)
          ) {
            memo.set(key, true)
            return true
          }
        } else {
          sawViableBranch = true
          if (canSolveWithin(zero.domains, zero.assignments, remainingGuesses, depth + 1)) {
            memo.set(key, true)
            return true
          }
        }
      } else {
        const one = childState(
          puzzle,
          { domains, assignments },
          cellIndex,
          1,
          patternContext,
          mutableBudget,
        )
        mutableBudget.check()
        if (one.status === 'stable') {
          sawViableBranch = true
          if (canSolveWithin(one.domains, one.assignments, remainingGuesses, depth + 1)) {
            memo.set(key, true)
            return true
          }
        }
      }
    }

    // A state with no viable binary branch is the existing zero-cost
    // contradiction/base case. Otherwise, at least one guess is required.
    const result = !sawViableBranch
    memo.set(key, result)
    return result
  }

  const initialAssignments: MutableAssignments = Array.from(
    { length: puzzle.dimensions.rows * puzzle.dimensions.columns },
    () => undefined,
  )
  let minimumGuesses = 0
  let analysisComplete = false
  try {
    const status = propagationStatus(
      puzzle,
      initialDomains,
      initialAssignments,
      patternContext,
      mutableBudget,
    )
    if (status === 'contradiction') {
      analysisComplete = true
    } else {
      const unresolvedCount = initialAssignments.reduce<number>(
        (count, assignment) => count + (assignment === undefined ? 1 : 0),
        0,
      )
      for (let limit = 0; limit <= unresolvedCount; limit += 1) {
        if (canSolveWithin(initialDomains, initialAssignments, limit, 0)) {
          minimumGuesses = limit
          analysisComplete = true
          break
        }
      }
      if (!analysisComplete) {
        return makeUnknown('incomplete-search', {
          nodesVisited: mutableBudget.nodesVisited,
          statesEvaluated,
          memoEntries: memo.size,
          maxDepth,
        })
      }
    }
  } catch (error) {
    if (error instanceof DifficultyBudgetStop) {
      return makeUnknown(error.reason, {
        nodesVisited: mutableBudget.nodesVisited,
        statesEvaluated,
        memoEntries: memo.size,
        maxDepth,
      })
    }
    const reason = mapPatternError(error)
    if (reason !== undefined) {
      return makeUnknown(reason, {
        nodesVisited: mutableBudget.nodesVisited,
        statesEvaluated,
        memoEntries: memo.size,
        maxDepth,
      })
    }
    throw error
  }

  return Object.freeze({
    status: 'known',
    minimumGuesses,
    minimum: minimumGuesses,
    band: difficultyBandForMinimumGuesses(minimumGuesses),
    diagnostics: Object.freeze({
      nodesVisited: mutableBudget.nodesVisited,
      statesEvaluated,
      memoEntries: memo.size,
      maxDepth,
    }),
  })
}

export const analyzePuzzleDifficulty = analyzeDifficulty
export const getDifficultyBand = difficultyBandForMinimumGuesses
