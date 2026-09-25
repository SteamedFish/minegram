import {
  assertBinaryLine,
  assertLineLength,
  type BinaryLine,
} from '../../domain/board'
import {
  assertLinePatternResourceBudget,
  createPatternGenerationStopChecker,
  throwIfPatternGenerationStopped,
  type PatternGenerationContext,
} from '../../domain/linePatternGeneration'
import {
  assertOrderedLineClue,
  decodeOrderedLineClue,
  normalizeOrderedLineClue,
  orderedLineMatchesClue,
  type OrderedLineClue,
} from '../../domain/orderedClues'

export interface LegalLinePattern {
  readonly cells: BinaryLine
  readonly mineCount: number
}

/** Complete cached entries are bounded by both entry count and retained binary cells. */
export const DEFAULT_LEGAL_PATTERN_CACHE_MAX_ENTRIES = 256
export const DEFAULT_LEGAL_PATTERN_CACHE_MAX_CELLS = 1_000_000

interface LegalPatternCacheEntry {
  readonly patterns: readonly LegalLinePattern[]
  readonly cellCost: number
}

const patternCache = new Map<string, LegalPatternCacheEntry>()
let cachedPatternCells = 0

function cacheKey(lineLength: number, normalizedClue: OrderedLineClue): string {
  return `${lineLength}:${JSON.stringify(normalizedClue)}`
}

function refreshCacheEntry(key: string, entry: LegalPatternCacheEntry): void {
  patternCache.delete(key)
  patternCache.set(key, entry)
}

function cacheCompletePatterns(
  key: string,
  patterns: readonly LegalLinePattern[],
  cellCost: number,
): void {
  // Oversized complete results are valid to return but are not retained by the bounded cache.
  if (cellCost > DEFAULT_LEGAL_PATTERN_CACHE_MAX_CELLS) {
    return
  }

  while (
    patternCache.size >= DEFAULT_LEGAL_PATTERN_CACHE_MAX_ENTRIES ||
    cachedPatternCells + cellCost > DEFAULT_LEGAL_PATTERN_CACHE_MAX_CELLS
  ) {
    const oldestKey = patternCache.keys().next().value
    if (oldestKey === undefined) {
      break
    }
    const oldest = patternCache.get(oldestKey)
    patternCache.delete(oldestKey)
    cachedPatternCells -= oldest?.cellCost ?? 0
  }

  patternCache.set(key, { patterns, cellCost })
  cachedPatternCells += cellCost
}

export function getLegalLinePatterns(
  lineLength: number,
  clue: OrderedLineClue,
  context?: PatternGenerationContext,
): readonly LegalLinePattern[] {
  const stopChecker = createPatternGenerationStopChecker(context)
  assertLineLength(lineLength, 'line pattern length')
  assertOrderedLineClue(lineLength, clue)
  throwIfPatternGenerationStopped(stopChecker)

  const normalizedClue = normalizeOrderedLineClue(clue)
  const key = cacheKey(lineLength, normalizedClue)
  const cached = patternCache.get(key)
  if (cached !== undefined) {
    throwIfPatternGenerationStopped(stopChecker)
    assertLinePatternResourceBudget(
      context,
      lineLength,
      normalizedClue,
      cached.patterns.length,
    )
    refreshCacheEntry(key, cached)
    return cached.patterns
  }

  // Bind the decoder to this call's checker so a direct time budget spans
  // validation, cache work, and the complete recursive enumeration. The
  // decoder still receives the same deterministic limits, but does not reset
  // its own clock while doing so.
  const decodeContext: PatternGenerationContext | undefined =
    context === undefined
      ? undefined
      : {
          maxPatternCount: context.maxPatternCount,
          maxMaterializedCells: context.maxMaterializedCells,
          shouldStop: stopChecker,
        }
  const decodedPatterns = decodeOrderedLineClue(lineLength, clue, decodeContext)
  const patterns = Object.freeze(
    decodedPatterns.map((cells) => {
      const mineCount = cells.reduce<number>((total, cell) => total + cell, 0)
      return Object.freeze({ cells, mineCount })
    }),
  )
  throwIfPatternGenerationStopped(stopChecker)
  cacheCompletePatterns(key, patterns, patterns.length * lineLength)
  throwIfPatternGenerationStopped(stopChecker)
  return patterns
}

export function getPatternCell(pattern: LegalLinePattern, cellIndex: number): 0 | 1 {
  if (pattern === null || typeof pattern !== 'object' || !Array.isArray(pattern.cells)) {
    throw new TypeError('pattern must contain a binary cells array')
  }
  if (!Number.isInteger(cellIndex)) {
    throw new TypeError(`pattern cell index must be an integer; received ${String(cellIndex)}`)
  }
  if (cellIndex < 0 || cellIndex >= pattern.cells.length) {
    throw new RangeError(
      `pattern cell index must be between 0 and ${pattern.cells.length - 1}; received ${cellIndex}`,
    )
  }
  const cell = pattern.cells[cellIndex]
  if (cell !== 0 && cell !== 1) {
    throw new TypeError(`pattern cell ${cellIndex} must be 0 or 1; received ${String(cell)}`)
  }
  return cell
}

export function isLegalLinePattern(
  lineLength: number,
  clue: OrderedLineClue,
  pattern: LegalLinePattern,
): boolean {
  assertLineLength(lineLength, 'line pattern length')
  assertOrderedLineClue(lineLength, clue)
  try {
    assertBinaryLine(pattern.cells, 'line pattern cells')
    if (pattern.cells.length !== lineLength) {
      return false
    }
    const expectedMineCount = pattern.cells.reduce<number>(
      (total, cell) => total + cell,
      0,
    )
    if (pattern.mineCount !== expectedMineCount) {
      return false
    }
    return orderedLineMatchesClue(pattern.cells, lineLength, clue)
  } catch {
    return false
  }
}

export function assertLegalLinePattern(
  lineLength: number,
  clue: OrderedLineClue,
  pattern: LegalLinePattern,
): void {
  if (!isLegalLinePattern(lineLength, clue, pattern)) {
    const cells =
      pattern !== null && typeof pattern === 'object' && Array.isArray(pattern.cells)
        ? pattern.cells.join(', ')
        : '<malformed pattern>'
    throw new RangeError(
      `line pattern [${cells}] does not match clue [${clue.join(', ')}] at length ${lineLength}`,
    )
  }
}
