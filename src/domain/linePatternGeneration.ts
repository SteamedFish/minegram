import { assertLineLength } from './board'
import { assertOrderedLineClue } from './orderedClueValidation'

/**
 * Fail-closed resource controls for materializing one ordered line's legal patterns.
 *
 * The defaults are intentionally far above normal 15×15/60% clues while bounding
 * pathological 24-cell clues (the longest line `MAX_BOARD_SIDE` allows). Reaching
 * either limit is an error, never a reason
 * to return a partial domain.
 */
export const DEFAULT_MAX_LINE_PATTERNS = 10_000
export const DEFAULT_MAX_LINE_PATTERN_CELLS = 300_000

export type PatternGenerationInterruptionReason = 'cancelled' | 'time-limit' | 'interrupted'
export type LinePatternResourceLimitKind = 'pattern-count' | 'materialized-cells'

export interface PatternGenerationLimits {
  /** Maximum complete patterns materialized for one line. Zero is a valid fail-closed cap. */
  readonly maxPatternCount?: number
  /** Maximum binary cells retained across all complete patterns for one line. */
  readonly maxMaterializedCells?: number
}

export interface PatternGenerationContext extends PatternGenerationLimits {
  /** Checked cooperatively throughout recursive pattern enumeration. */
  readonly signal?: { readonly aborted: boolean }
  /** A solver can return its own precise cancellation/time reason from this callback. */
  readonly shouldStop?: () => boolean | PatternGenerationInterruptionReason | undefined
  /** Used with a positive `timeBudgetMs`; no global clock is consulted. */
  readonly now?: () => number
  /** A direct per-call enumeration budget. Zero stops before the first pattern is built. */
  readonly timeBudgetMs?: number
}

export type PatternGenerationStopChecker = () => PatternGenerationInterruptionReason | undefined

const NO_PATTERN_GENERATION_STOP: PatternGenerationStopChecker = () => undefined

export class PatternGenerationInterruptedError extends Error {
  readonly reason: PatternGenerationInterruptionReason

  constructor(reason: PatternGenerationInterruptionReason) {
    super(`line pattern generation stopped: ${reason}`)
    this.name = 'PatternGenerationInterruptedError'
    this.reason = reason
  }
}

export interface LinePatternResourceLimitErrorDetails {
  readonly kind: LinePatternResourceLimitKind
  readonly allowed: number
  readonly attempted: number
  readonly lineLength: number
  readonly clue: readonly number[]
}

export class LinePatternResourceLimitError extends Error {
  readonly kind: LinePatternResourceLimitKind
  readonly allowed: number
  readonly attempted: number
  readonly lineLength: number
  readonly clue: readonly number[]

  constructor(details: LinePatternResourceLimitErrorDetails) {
    super(
      `line pattern generation exceeded the ${details.kind} budget at length ${details.lineLength}: ` +
        `attempted ${details.attempted}, allowed ${details.allowed}`,
    )
    this.name = 'LinePatternResourceLimitError'
    this.kind = details.kind
    this.allowed = details.allowed
    this.attempted = details.attempted
    this.lineLength = details.lineLength
    this.clue = Object.freeze([...details.clue])
  }
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

export function assertPatternGenerationLimits(
  value: unknown,
  context = 'pattern generation limits',
): asserts value is PatternGenerationLimits {
  if (value === undefined) {
    return
  }
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be a non-array object`)
  }

  const limits = value as Record<string, unknown>
  if (
    limits.maxPatternCount !== undefined &&
    (typeof limits.maxPatternCount !== 'number' ||
      !Number.isSafeInteger(limits.maxPatternCount) ||
      limits.maxPatternCount < 0)
  ) {
    throw new RangeError(
      `${context}.maxPatternCount must be a nonnegative safe integer; received ${String(limits.maxPatternCount)}`,
    )
  }
  if (
    limits.maxMaterializedCells !== undefined &&
    (typeof limits.maxMaterializedCells !== 'number' ||
      !Number.isSafeInteger(limits.maxMaterializedCells) ||
      limits.maxMaterializedCells < 0)
  ) {
    throw new RangeError(
      `${context}.maxMaterializedCells must be a nonnegative safe integer; received ${String(limits.maxMaterializedCells)}`,
    )
  }
}

export function assertPatternGenerationContext(
  value: unknown,
  context = 'pattern generation context',
): asserts value is PatternGenerationContext | undefined {
  if (value === undefined) {
    return
  }
  if (!isRecord(value)) {
    throw new TypeError(`${context} must be a non-array object`)
  }

  const candidate = value as Record<string, unknown>
  assertPatternGenerationLimits(candidate, context)
  if (candidate.signal !== undefined && !isAbortSignalLike(candidate.signal)) {
    throw new TypeError(`${context}.signal must be an AbortSignal-like object`)
  }
  if (candidate.shouldStop !== undefined && typeof candidate.shouldStop !== 'function') {
    throw new TypeError(`${context}.shouldStop must be a function`)
  }
  if (candidate.now !== undefined && typeof candidate.now !== 'function') {
    throw new TypeError(`${context}.now must be a function returning a finite millisecond value`)
  }
  if (
    candidate.timeBudgetMs !== undefined &&
    (typeof candidate.timeBudgetMs !== 'number' ||
      !Number.isFinite(candidate.timeBudgetMs) ||
      candidate.timeBudgetMs < 0)
  ) {
    throw new RangeError(
      `${context}.timeBudgetMs must be a finite nonnegative number; received ${String(candidate.timeBudgetMs)}`,
    )
  }
  if (candidate.timeBudgetMs !== undefined && candidate.timeBudgetMs > 0 && candidate.now === undefined) {
    throw new TypeError(`${context}.now is required when timeBudgetMs is positive`)
  }
}

function readPatternClock(clock: () => number): number {
  const current = clock()
  if (!Number.isFinite(current)) {
    throw new TypeError('pattern generation now must return a finite millisecond value')
  }
  return current
}

function readCallbackStopReason(value: boolean | PatternGenerationInterruptionReason | undefined):
  | PatternGenerationInterruptionReason
  | undefined {
  if (value === undefined || value === false) {
    return undefined
  }
  if (value === true) {
    return 'interrupted'
  }
  if (value === 'cancelled' || value === 'time-limit' || value === 'interrupted') {
    return value
  }
  throw new TypeError(
    'pattern generation shouldStop must return a boolean, cancelled, time-limit, interrupted, or undefined',
  )
}

/** Creates one reusable stop checker so a direct time budget spans the whole enumeration. */
export function createPatternGenerationStopChecker(
  context?: PatternGenerationContext,
): PatternGenerationStopChecker {
  if (context === undefined) {
    return NO_PATTERN_GENERATION_STOP
  }
  assertPatternGenerationContext(context)
  const signal = context?.signal
  const callback = context?.shouldStop
  const clock = context?.now
  const timeBudgetMs = context?.timeBudgetMs
  let startTime: number | undefined
  let clockStarted = false

  return () => {
    if (signal?.aborted) {
      return 'cancelled'
    }

    const callbackReason = readCallbackStopReason(callback?.())
    if (callbackReason !== undefined) {
      return callbackReason
    }

    if (timeBudgetMs === undefined) {
      return undefined
    }
    if (timeBudgetMs === 0) {
      return 'time-limit'
    }
    if (!clockStarted) {
      startTime = readPatternClock(clock!)
      clockStarted = true
    }
    return readPatternClock(clock!) - startTime! >= timeBudgetMs ? 'time-limit' : undefined
  }
}

export function throwIfPatternGenerationStopped(checker: PatternGenerationStopChecker): void {
  const reason = checker()
  if (reason !== undefined) {
    throw new PatternGenerationInterruptedError(reason)
  }
}

export function assertLinePatternResourceBudget(
  context: PatternGenerationContext | undefined,
  lineLength: number,
  clue: readonly number[],
  patternCount: number,
): void {
  assertPatternGenerationContext(context)
  assertLineLength(lineLength, 'line pattern resource budget line length')
  assertOrderedLineClue(lineLength, clue, 'line pattern resource budget clue')
  if (!Number.isSafeInteger(patternCount)) {
    throw new TypeError(
      `line pattern resource budget pattern count must be a nonnegative safe integer; received ${String(patternCount)}`,
    )
  }
  if (patternCount < 0) {
    throw new RangeError(
      `line pattern resource budget pattern count must be nonnegative; received ${patternCount}`,
    )
  }

  const materializedCells = patternCount * lineLength
  if (!Number.isSafeInteger(materializedCells)) {
    throw new RangeError(
      `line pattern resource budget materialized cell count must be a safe integer; received ${materializedCells}`,
    )
  }

  const maxPatternCount = context?.maxPatternCount ?? DEFAULT_MAX_LINE_PATTERNS
  if (patternCount > maxPatternCount) {
    throw new LinePatternResourceLimitError({
      kind: 'pattern-count',
      allowed: maxPatternCount,
      attempted: patternCount,
      lineLength,
      clue,
    })
  }

  const maxMaterializedCells = context?.maxMaterializedCells ?? DEFAULT_MAX_LINE_PATTERN_CELLS
  if (materializedCells > maxMaterializedCells) {
    throw new LinePatternResourceLimitError({
      kind: 'materialized-cells',
      allowed: maxMaterializedCells,
      attempted: materializedCells,
      lineLength,
      clue,
    })
  }
}
