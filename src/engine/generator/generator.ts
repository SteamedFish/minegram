import {
  assertBinaryMineBoard,
  assertBoardHasMineInEveryLine,
  countBoardMines,
  type BinaryMineBoard,
  type BoardDimensions,
} from '../../domain/board'
import {
  assertPatternGenerationLimits,
  type PatternGenerationLimits,
} from '../../domain/linePatternGeneration'
import { derivePuzzleClues, type MinegramPuzzle } from '../../domain/puzzle'
import { createSeededRandom, type SeededRandom } from '../rng'
import {
  analyzeDifficulty,
  DEFAULT_MAX_DIFFICULTY_NODES,
  isDifficultyBandSatisfied,
  type DifficultyBand,
  type DifficultyResult,
  type DifficultyUnknownReason,
} from '../solver/difficulty'
import {
  solvePuzzle,
  validateSolutionBoard,
  type SolverOptions,
  type SolverResult,
} from '../solver/constraintSolver'
import { createLayouts, type CandidateLayout } from './layout'
import {
  replayWitnessTransactions,
  validateGenerationWitness,
  type GenerationWitness,
  type TransactionReplayResult,
  type TransactionTraceEvent,
  type UniqueSolverProof,
} from './transaction'
import {
  DEFAULT_MAX_GENERATION_ATTEMPTS,
  normalizeGenerationSettings,
  type GenerationSettings,
  type GenerationSettingsInput,
} from './settings'

export type GenerationFailureReason =
  | 'cancelled'
  | 'time-limit'
  | 'resource-limit'
  | 'attempt-limit'
  | 'difficulty-not-found'
  | 'infeasible'

const DEFAULT_MAX_GENERATION_SOLVER_NODES = 100_000
const DEFAULT_MAX_GENERATION_DIFFICULTY_NODES = DEFAULT_MAX_DIFFICULTY_NODES
const DEFAULT_GENERATION_TIME_BUDGET_MS = 3_000

export type GenerationProofStatus = 'not-run' | 'unique' | 'multiple' | 'none' | 'unknown'
export type GenerationDifficultyStatus = 'not-run' | 'known' | 'unknown'

export type GenerationSignal = { readonly aborted: boolean }

export interface GenerationOptions extends PatternGenerationLimits {
  readonly maxSolverNodes?: number
  /** Total decision states allowed for exact difficulty analysis during generation. */
  readonly maxDifficultyNodes?: number
  /** Defaults to 3000ms; an explicit positive value requires now. */
  readonly timeBudgetMs?: number
  readonly signal?: GenerationSignal
  /** Injected wall clock; defaults to Date.now for the generator deadline. */
  readonly now?: () => number
}

export interface GenerationDiagnostics {
  readonly attempts: number
  readonly layouts: number
  readonly candidates: number
  readonly accepted: number
  readonly rollbacks: number
  readonly solverCalls: number
  readonly solverStatuses: readonly string[]
  readonly resourceReasons: readonly string[]
  readonly difficultyNodesVisited: number
  readonly difficultyNodeLimit: number
  readonly proofStatus: GenerationProofStatus
  readonly difficultyStatus: GenerationDifficultyStatus
  readonly difficultyReason?: DifficultyUnknownReason
  readonly minimumGuesses?: number
  readonly band?: DifficultyBand
}

export type GenerationResult =
  | {
      readonly status: 'success'
      readonly settings: GenerationSettings
      readonly board: BinaryMineBoard
      readonly puzzle: MinegramPuzzle
      readonly mineIndices: readonly number[]
      readonly proof: UniqueSolverProof
      readonly difficulty: Extract<DifficultyResult, { readonly status: 'known' }>
      readonly trace: readonly TransactionTraceEvent[]
      readonly diagnostics: GenerationDiagnostics
    }
  | {
      readonly status: 'failure'
      readonly reason: GenerationFailureReason
      readonly settings: GenerationSettings
      readonly diagnostics: GenerationDiagnostics
    }

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

function readClock(clock: () => number): number {
  const current = clock()
  if (!Number.isFinite(current)) {
    throw new TypeError('generator now must return a finite millisecond value')
  }
  return current
}

function defaultGenerationClock(): number {
  return Date.now()
}

function assertGenerationOptions(value: unknown): asserts value is GenerationOptions {
  if (!isRecord(value)) {
    throw new TypeError('generation options must be a non-array object')
  }
  assertPatternGenerationLimits(value, 'generation options')
  if (
    value.maxSolverNodes !== undefined &&
    (typeof value.maxSolverNodes !== 'number' ||
      !Number.isSafeInteger(value.maxSolverNodes) ||
      value.maxSolverNodes < 0)
  ) {
    throw new RangeError(
      `generation maxSolverNodes must be a nonnegative safe integer; received ${String(value.maxSolverNodes)}`,
    )
  }
  if (
    value.maxDifficultyNodes !== undefined &&
    (typeof value.maxDifficultyNodes !== 'number' ||
      !Number.isSafeInteger(value.maxDifficultyNodes) ||
      value.maxDifficultyNodes < 0)
  ) {
    throw new RangeError(
      `generation maxDifficultyNodes must be a nonnegative safe integer; received ${String(value.maxDifficultyNodes)}`,
    )
  }
  if (
    value.timeBudgetMs !== undefined &&
    (typeof value.timeBudgetMs !== 'number' ||
      !Number.isFinite(value.timeBudgetMs) ||
      value.timeBudgetMs < 0)
  ) {
    throw new RangeError(
      `generation timeBudgetMs must be a finite nonnegative number; received ${String(value.timeBudgetMs)}`,
    )
  }
  if (value.signal !== undefined && !isAbortSignalLike(value.signal)) {
    throw new TypeError('generation signal must be an AbortSignal-like object')
  }
  if (value.now !== undefined && typeof value.now !== 'function') {
    throw new TypeError('generation now must be a function returning a finite millisecond value')
  }
  if (value.timeBudgetMs !== undefined && value.timeBudgetMs > 0 && value.now === undefined) {
    throw new TypeError('generation now is required when timeBudgetMs is supplied')
  }
}

class GenerationBudget {
  private readonly signal: GenerationSignal | undefined
  private readonly now: () => number
  private readonly timeBudgetMs: number
  private readonly startTime: number | undefined
  private remainingSolverNodes: number
  private remainingDifficultyNodes: number

  constructor(options: GenerationOptions) {
    this.signal = options.signal
    this.now = options.now ?? defaultGenerationClock
    this.timeBudgetMs = options.timeBudgetMs ?? DEFAULT_GENERATION_TIME_BUDGET_MS
    this.remainingSolverNodes = options.maxSolverNodes ?? DEFAULT_MAX_GENERATION_SOLVER_NODES
    this.remainingDifficultyNodes =
      options.maxDifficultyNodes ?? DEFAULT_MAX_GENERATION_DIFFICULTY_NODES
    // Cancellation, zero node budgets, and zero time budgets are preflight
    // conditions and must not read a clock.
    this.startTime =
      options.signal?.aborted ||
      this.remainingSolverNodes === 0 ||
      this.remainingDifficultyNodes === 0 ||
      options.timeBudgetMs === 0
        ? undefined
        : readClock(this.now)
  }

  stopReason(): GenerationFailureReason | undefined {
    if (this.signal?.aborted) {
      return 'cancelled'
    }
    if (this.timeBudgetMs === 0) {
      return 'time-limit'
    }
    if (
      this.startTime !== undefined &&
      readClock(this.now) - this.startTime >= this.timeBudgetMs
    ) {
      return 'time-limit'
    }
    if (this.remainingSolverNodes === 0 || this.remainingDifficultyNodes === 0) {
      return 'resource-limit'
    }
    return undefined
  }

  remainingTimeMs(): number {
    // Solver calls receive only the remaining wall-clock budget. Difficulty
    // node exhaustion is handled by the generator, not misreported as a
    // solver time-limit. Cancellation and an explicit zero deadline remain
    // clock-free preflights.
    if (this.signal?.aborted || this.timeBudgetMs === 0 || this.startTime === undefined) {
      return 0
    }
    return Math.max(0, this.timeBudgetMs - (readClock(this.now) - this.startTime))
  }

  solverNodesRemaining(): number {
    return this.remainingSolverNodes
  }

  difficultyNodesRemaining(): number {
    return this.remainingDifficultyNodes
  }

  consumeSolverNodes(nodesVisited: number): void {
    if (!Number.isSafeInteger(nodesVisited) || nodesVisited < 0) {
      throw new RangeError('solver node accounting must be a nonnegative safe integer')
    }
    this.remainingSolverNodes = Math.max(0, this.remainingSolverNodes - nodesVisited)
  }

  consumeDifficultyNodes(nodesVisited: number): void {
    if (!Number.isSafeInteger(nodesVisited) || nodesVisited < 0) {
      throw new RangeError('difficulty node accounting must be a nonnegative safe integer')
    }
    this.remainingDifficultyNodes = Math.max(0, this.remainingDifficultyNodes - nodesVisited)
  }
}

function freezeDimensions(settings: GenerationSettings): BoardDimensions {
  return Object.freeze({ rows: settings.rows, columns: settings.columns })
}

function makePuzzle(board: BinaryMineBoard, settings: GenerationSettings): MinegramPuzzle {
  const dimensions = freezeDimensions(settings)
  const clues = derivePuzzleClues(board, dimensions)
  return Object.freeze({ dimensions, clues })
}

function makeDiagnostics(values: {
  readonly attempts: number
  readonly layouts: number
  readonly candidates: number
  readonly accepted: number
  readonly rollbacks: number
  readonly solverCalls: number
  readonly solverStatuses: readonly string[]
  readonly resourceReasons: readonly string[]
  readonly difficultyNodesVisited: number
  readonly difficultyNodeLimit: number
  readonly proofStatus: GenerationProofStatus
  readonly difficultyStatus: GenerationDifficultyStatus
  readonly difficultyReason?: DifficultyUnknownReason
  readonly minimumGuesses?: number
  readonly band?: DifficultyBand
}): GenerationDiagnostics {
  return Object.freeze({
    attempts: values.attempts,
    layouts: values.layouts,
    candidates: values.candidates,
    accepted: values.accepted,
    rollbacks: values.rollbacks,
    solverCalls: values.solverCalls,
    solverStatuses: Object.freeze([...values.solverStatuses]),
    resourceReasons: Object.freeze([...values.resourceReasons]),
    difficultyNodesVisited: values.difficultyNodesVisited,
    difficultyNodeLimit: values.difficultyNodeLimit,
    proofStatus: values.proofStatus,
    difficultyStatus: values.difficultyStatus,
    ...(values.difficultyReason === undefined ? {} : { difficultyReason: values.difficultyReason }),
    ...(values.minimumGuesses === undefined ? {} : { minimumGuesses: values.minimumGuesses }),
    ...(values.band === undefined ? {} : { band: values.band }),
  })
}

function makeFailure(
  reason: GenerationFailureReason,
  settings: GenerationSettings,
  diagnostics: GenerationDiagnostics,
): GenerationResult {
  return Object.freeze({ status: 'failure', reason, settings, diagnostics })
}

function recordResourceReason(
  result: SolverResult,
  resourceReasons: string[],
): void {
  if (result.status === 'unknown') {
    resourceReasons.push(result.reason)
  }
}

function resourceFailure(result: SolverResult): boolean {
  return (
    result.status === 'unknown' &&
    (result.reason === 'node-limit' ||
      result.reason === 'resource-limit' ||
      result.reason === 'incomplete-search' ||
      result.reason === 'interrupted')
  )
}

function globalSolverFailure(result: SolverResult): GenerationFailureReason | undefined {
  if (result.status !== 'unknown') {
    return undefined
  }
  if (result.reason === 'cancelled') {
    return 'cancelled'
  }
  if (result.reason === 'time-limit') {
    return 'time-limit'
  }
  return undefined
}

function makeWitness(
  layout: CandidateLayout,
  settings: GenerationSettings,
  proof: UniqueSolverProof,
): GenerationWitness {
  return {
    dimensions: freezeDimensions(settings),
    mineIndices: layout.mineIndices,
    board: layout.board,
    puzzle: makePuzzle(layout.board, settings),
    proof,
  }
}

function validateLayout(layout: CandidateLayout, settings: GenerationSettings): void {
  const dimensions = freezeDimensions(settings)
  assertBinaryMineBoard(layout.board, dimensions, 'candidate layout board')
  if (countBoardMines(layout.board, dimensions) !== settings.mineCount) {
    throw new RangeError('candidate layout has the wrong exact mine count')
  }
  if (layout.mineIndices.length !== settings.mineCount) {
    throw new RangeError('candidate layout mine indices have the wrong exact mine count')
  }
  const seen = new Set<number>()
  for (const cellIndex of layout.mineIndices) {
    if (
      !Number.isSafeInteger(cellIndex) ||
      cellIndex < 0 ||
      cellIndex >= settings.rows * settings.columns ||
      seen.has(cellIndex)
    ) {
      throw new RangeError('candidate layout mine indices must be unique in-range cell indices')
    }
    if (layout.board[cellIndex] !== 1) {
      throw new RangeError('candidate layout mine indices must identify board mines')
    }
    seen.add(cellIndex)
  }
  assertBoardHasMineInEveryLine(layout.board, dimensions, 'candidate layout coverage')
  // Clue derivation is performed by the witness validator before acceptance.
  makePuzzle(layout.board, settings)
}

function uniqueProofMatches(result: SolverResult, board: BinaryMineBoard): result is UniqueSolverProof {
  if (result.status !== 'unique' || result.solution.length !== board.length) {
    return false
  }
  for (let index = 0; index < board.length; index += 1) {
    if (result.solution[index] !== board[index]) {
      return false
    }
  }
  return true
}

function makeReplayOrder(
  mineIndices: readonly number[],
  replayRng: SeededRandom,
): readonly number[] {
  const order = [...mineIndices]
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = replayRng.nextInt(index + 1)
    const temporary = order[index]
    order[index] = order[swapIndex]
    order[swapIndex] = temporary
  }
  return Object.freeze(order)
}

function replayWithOrder(
  witness: GenerationWitness,
  replayRng: SeededRandom,
): TransactionReplayResult {
  return replayWitnessTransactions(witness, {
    mineOrder: makeReplayOrder(witness.mineIndices, replayRng),
  })
}

function validateSuccessfulWitness(
  witness: GenerationWitness,
  settings: GenerationSettings,
): UniqueSolverProof {
  validateGenerationWitness(witness, settings.mineCount)
  validateSolutionBoard(witness.proof.solution, witness.puzzle)
  return witness.proof
}

/**
 * Generate a deterministic, fully proven Minegram puzzle.
 *
 * The transaction trace intentionally replays one already-proven complete
 * witness for each prefix. Every prefix is a subset of that same exact-count,
 * covered, clue-consistent unique witness; a final independent solve prevents a
 * candidate proof from being reused as the delivery proof.
 */
export function generateMinegramPuzzle(
  input?: GenerationSettingsInput,
  options: GenerationOptions = {},
): GenerationResult {
  const settings = normalizeGenerationSettings(input)
  assertGenerationOptions(options)
  const dimensions = freezeDimensions(settings)
  const rootRng = createSeededRandom(settings.seed)
  const budget = new GenerationBudget(options)
  const difficultyNodeLimit =
    options.maxDifficultyNodes ?? DEFAULT_MAX_GENERATION_DIFFICULTY_NODES
  let difficultyNodesVisited = 0
  const solverStatuses: string[] = []
  const resourceReasons: string[] = []
  let layouts = 0
  let candidates = 0
  let rollbacks = 0
  let solverCalls = 0
  let layoutFailureSeen = false
  let difficultyMismatch = false
  let resourceFailureSeen = false
  let lastDifficultyStatus: GenerationDifficultyStatus = 'not-run'
  let lastDifficultyReason: DifficultyUnknownReason | undefined
  let proofStatus: GenerationProofStatus = 'not-run'

  const preflight = budget.stopReason()
  if (preflight !== undefined) {
    return makeFailure(
      preflight,
      settings,
      makeDiagnostics({
        attempts: 0,
        layouts: 0,
        candidates: 0,
        accepted: 0,
        rollbacks: 0,
        solverCalls: 0,
        solverStatuses,
        resourceReasons,
        difficultyNodesVisited,
        difficultyNodeLimit,
        proofStatus,
        difficultyStatus: lastDifficultyStatus,
        ...(lastDifficultyReason === undefined ? {} : { difficultyReason: lastDifficultyReason }),
      }),
    )
  }

  for (let attempt = 0; attempt < settings.maxAttempts; attempt += 1) {
    const rootStream = rootRng.derive(`root:${attempt}`)
    let attemptLayouts: readonly CandidateLayout[]
    try {
      attemptLayouts = createLayouts(dimensions, settings.mineCount, rootStream)
    } catch (error) {
      if (!(error instanceof RangeError)) {
        throw error
      }
      layoutFailureSeen = true
      rollbacks += 1
      continue
    }
    if (attemptLayouts.length === 0) {
      layoutFailureSeen = true
      continue
    }

    for (const layout of attemptLayouts) {
      const stop = budget.stopReason()
      if (stop !== undefined) {
        return makeFailure(
          stop,
          settings,
          makeDiagnostics({
            attempts: attempt + 1,
            layouts,
            candidates,
            accepted: 0,
            rollbacks,
            solverCalls,
            solverStatuses,
            resourceReasons,
            difficultyNodesVisited,
            difficultyNodeLimit,
            proofStatus,
            difficultyStatus: lastDifficultyStatus,
            ...(lastDifficultyReason === undefined ? {} : { difficultyReason: lastDifficultyReason }),
          }),
        )
      }
      layouts += 1
      try {
        validateLayout(layout, settings)
      } catch (error) {
        if (!(error instanceof RangeError)) {
          throw error
        }
        rollbacks += 1
        continue
      }
      candidates += 1
      const puzzle = makePuzzle(layout.board, settings)
      lastDifficultyStatus = 'not-run'
      lastDifficultyReason = undefined
      const solve = solvePuzzle(puzzle, {
        maxNodes: budget.solverNodesRemaining(),
        timeBudgetMs: budget.remainingTimeMs(),
        signal: options.signal as SolverOptions['signal'],
        now: options.now ?? defaultGenerationClock,
        maxPatternCount: options.maxPatternCount,
        maxMaterializedCells: options.maxMaterializedCells,
      })
      solverCalls += 1
      budget.consumeSolverNodes(solve.diagnostics.nodesVisited)
      solverStatuses.push(solve.status)
      proofStatus = solve.status
      recordResourceReason(solve, resourceReasons)
      const solverStop = globalSolverFailure(solve)
      if (solverStop !== undefined) {
        return makeFailure(
          solverStop,
          settings,
          makeDiagnostics({
            attempts: attempt + 1,
            layouts,
            candidates,
            accepted: 0,
            rollbacks,
            solverCalls,
            solverStatuses,
            resourceReasons,
            difficultyNodesVisited,
            difficultyNodeLimit,
            proofStatus,
            difficultyStatus: lastDifficultyStatus,
            ...(lastDifficultyReason === undefined ? {} : { difficultyReason: lastDifficultyReason }),
          }),
        )
      }
      if (!uniqueProofMatches(solve, layout.board)) {
        if (resourceFailure(solve)) {
          resourceFailureSeen = true
        }
        rollbacks += 1
        continue
      }

      const candidateWitness = makeWitness(layout, settings, solve)
      const difficulty: DifficultyResult = analyzeDifficulty(puzzle, {
        maxNodes: budget.difficultyNodesRemaining(),
        timeBudgetMs: budget.remainingTimeMs(),
        signal: options.signal as SolverOptions['signal'],
        now: options.now ?? defaultGenerationClock,
        maxPatternCount: options.maxPatternCount,
        maxMaterializedCells: options.maxMaterializedCells,
      })
      budget.consumeDifficultyNodes(difficulty.diagnostics.nodesVisited)
      difficultyNodesVisited += difficulty.diagnostics.nodesVisited
      if (difficulty.status === 'unknown') {
        lastDifficultyStatus = 'unknown'
        lastDifficultyReason = difficulty.reason
        if (
          difficulty.reason !== 'cancelled' &&
          difficulty.reason !== 'time-limit'
        ) {
          resourceReasons.push(difficulty.reason)
        }
        if (difficulty.reason === 'cancelled' || difficulty.reason === 'time-limit') {
          const reason: GenerationFailureReason =
            difficulty.reason === 'cancelled' ? 'cancelled' : 'time-limit'
          return makeFailure(
            reason,
            settings,
            makeDiagnostics({
              attempts: attempt + 1,
              layouts,
              candidates,
              accepted: 0,
              rollbacks: rollbacks + 1,
              solverCalls,
              solverStatuses,
              resourceReasons,
              difficultyNodesVisited,
              difficultyNodeLimit,
              proofStatus: 'unique',
              difficultyStatus: 'unknown',
              difficultyReason: difficulty.reason,
            }),
          )
        }
        resourceFailureSeen = true
        rollbacks += 1
        continue
      }
      lastDifficultyStatus = 'known'
      lastDifficultyReason = undefined
      if (!isDifficultyBandSatisfied(difficulty.minimumGuesses, settings.difficulty)) {
        difficultyMismatch = true
        rollbacks += 1
        continue
      }

      const replayStop = budget.stopReason()
      if (replayStop !== undefined) {
        return makeFailure(
          replayStop,
          settings,
          makeDiagnostics({
            attempts: attempt + 1,
            layouts,
            candidates,
            accepted: 0,
            rollbacks,
            solverCalls,
            solverStatuses,
            resourceReasons,
            difficultyNodesVisited,
            difficultyNodeLimit,
            proofStatus,
            difficultyStatus: 'known',
            minimumGuesses: difficulty.minimumGuesses,
            band: difficulty.band,
          }),
        )
      }

      const replayRng = rootStream.derive(`replay:${attempt}:${layout.kind}`)
      const replay = replayWithOrder(candidateWitness, replayRng)
      if (replay.status !== 'complete') {
        rollbacks += 1
        continue
      }

      // This is deliberately a new solve call after difficulty analysis and
      // replay. It does not reuse candidate domains, assignments, or proof
      // state; only the bounded pure line-pattern cache may be shared.
      const finalProof = solvePuzzle(puzzle, {
        maxNodes: budget.solverNodesRemaining(),
        timeBudgetMs: budget.remainingTimeMs(),
        signal: options.signal as SolverOptions['signal'],
        now: options.now ?? defaultGenerationClock,
        maxPatternCount: options.maxPatternCount,
        maxMaterializedCells: options.maxMaterializedCells,
      })
      solverCalls += 1
      budget.consumeSolverNodes(finalProof.diagnostics.nodesVisited)
      solverStatuses.push(finalProof.status)
      proofStatus = finalProof.status
      recordResourceReason(finalProof, resourceReasons)
      const finalSolverStop = globalSolverFailure(finalProof)
      if (finalSolverStop !== undefined) {
        return makeFailure(
          finalSolverStop,
          settings,
          makeDiagnostics({
            attempts: attempt + 1,
            layouts,
            candidates,
            accepted: 0,
            rollbacks,
            solverCalls,
            solverStatuses,
            resourceReasons,
            difficultyNodesVisited,
            difficultyNodeLimit,
            proofStatus,
            difficultyStatus: 'known',
            minimumGuesses: difficulty.minimumGuesses,
            band: difficulty.band,
          }),
        )
      }
      if (!uniqueProofMatches(finalProof, layout.board)) {
        if (resourceFailure(finalProof)) {
          resourceFailureSeen = true
        }
        rollbacks += 1
        continue
      }
      proofStatus = 'unique'
      const finalWitness = makeWitness(layout, settings, finalProof)
      const finalProofValidated = validateSuccessfulWitness(finalWitness, settings)
      const finalTrace = replay.trace
      return Object.freeze({
        status: 'success',
        settings,
        board: layout.board,
        puzzle,
        mineIndices: finalWitness.mineIndices,
        proof: finalProofValidated,
        difficulty,
        trace: finalTrace,
        diagnostics: makeDiagnostics({
          attempts: attempt + 1,
          layouts,
          candidates,
          accepted: finalTrace.length,
          rollbacks,
          solverCalls,
          solverStatuses,
          resourceReasons,
          difficultyNodesVisited,
          difficultyNodeLimit,
          proofStatus,
          difficultyStatus: 'known',
          minimumGuesses: difficulty.minimumGuesses,
          band: difficulty.band,
        }),
      })
    }
  }

  const reason: GenerationFailureReason =
    budget.stopReason() ??
    (resourceFailureSeen
      ? 'resource-limit'
      : difficultyMismatch
        ? 'difficulty-not-found'
        : layoutFailureSeen
          ? 'infeasible'
          : 'attempt-limit')
  return makeFailure(
    reason,
    settings,
    makeDiagnostics({
      attempts: settings.maxAttempts,
      layouts,
      candidates,
      accepted: 0,
      rollbacks,
      solverCalls,
      solverStatuses,
      resourceReasons,
      difficultyNodesVisited,
      difficultyNodeLimit,
      proofStatus,
      difficultyStatus: lastDifficultyStatus,
      ...(lastDifficultyReason === undefined ? {} : { difficultyReason: lastDifficultyReason }),
    }),
  )
}

export {
  DEFAULT_GENERATION_TIME_BUDGET_MS,
  DEFAULT_MAX_GENERATION_ATTEMPTS,
  DEFAULT_MAX_GENERATION_DIFFICULTY_NODES,
  DEFAULT_MAX_GENERATION_SOLVER_NODES,
}
export {
  calculateMineCount,
  generationDimensions,
  normalizeGenerationSettings,
} from './settings'
export type {
  GenerationSettings,
  GenerationSettingsInput,
} from './settings'
export type { CandidateLayout, CandidateLayoutKind } from './layout'
export type {
  GenerationWitness,
  TransactionReplayResult,
  TransactionTraceEvent,
  TransactionWitnessSnapshot,
  UniqueSolverProof,
  WitnessTransactionProbe,
} from './transaction'
export type { WitnessTransactionOptions } from './transaction'
export { replayWitnessTransactions, validateGenerationWitness } from './transaction'
