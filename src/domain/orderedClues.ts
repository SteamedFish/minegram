import {
  assertBinaryLine,
  assertLineLength,
  type BinaryLine,
} from './board'
import {
  assertLinePatternResourceBudget,
  createPatternGenerationStopChecker,
  throwIfPatternGenerationStopped,
  type PatternGenerationContext,
} from './linePatternGeneration'
import {
  assertOrderedLineClue,
  canonicalizeOrderedLineClue,
  type OrderedLineClue,
} from './orderedClueValidation'

export { assertOrderedLineClue, type OrderedLineClue }

export type RowClues = readonly OrderedLineClue[]
export type ColumnClues = readonly OrderedLineClue[]

/** Zero-valued runs are accepted as no-op aliases; canonical clues contain only positive runs. */
export function normalizeOrderedLineClue(clue: OrderedLineClue): OrderedLineClue {
  return canonicalizeOrderedLineClue(clue)
}

export function orderedCluesEqual(
  left: OrderedLineClue,
  right: OrderedLineClue,
): boolean {
  const normalizedLeft = normalizeOrderedLineClue(left)
  const normalizedRight = normalizeOrderedLineClue(right)
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
  )
}

export function encodeOrderedLineClue(line: BinaryLine): OrderedLineClue {
  assertBinaryLine(line)

  const runs: number[] = []
  let currentRun = 0
  for (const cell of line) {
    if (cell === 1) {
      currentRun += 1
    } else if (currentRun > 0) {
      runs.push(currentRun)
      currentRun = 0
    }
  }
  if (currentRun > 0) {
    runs.push(currentRun)
  }

  return Object.freeze(runs)
}

export function decodeOrderedLineClue(
  lineLength: number,
  clue: OrderedLineClue,
  context?: PatternGenerationContext,
): readonly BinaryLine[] {
  const stopChecker = createPatternGenerationStopChecker(context)
  assertLineLength(lineLength, 'ordered line clue length')
  assertOrderedLineClue(lineLength, clue)
  throwIfPatternGenerationStopped(stopChecker)

  const normalizedClue = normalizeOrderedLineClue(clue)
  const patterns: BinaryLine[] = []
  const cells = Array.from({ length: lineLength }, () => 0 as BinaryLine[number])

  const placeRuns = (runIndex: number, minimumStart: number): void => {
    throwIfPatternGenerationStopped(stopChecker)
    if (runIndex === normalizedClue.length) {
      const patternCount = patterns.length + 1
      assertLinePatternResourceBudget(context, lineLength, normalizedClue, patternCount)
      patterns.push(Object.freeze([...cells]))
      return
    }

    const runLength = normalizedClue[runIndex]
    const finalStart = lineLength - runLength
    for (let start = minimumStart; start <= finalStart; start += 1) {
      throwIfPatternGenerationStopped(stopChecker)
      for (let offset = 0; offset < runLength; offset += 1) {
        cells[start + offset] = 1
      }
      placeRuns(runIndex + 1, start + runLength + 1)
      for (let offset = 0; offset < runLength; offset += 1) {
        cells[start + offset] = 0
      }
    }
  }

  placeRuns(0, 0)
  throwIfPatternGenerationStopped(stopChecker)

  const sortedPatterns = patterns.sort((left, right) => {
    for (let index = 0; index < lineLength; index += 1) {
      if (left[index] !== right[index]) {
        return left[index] - right[index]
      }
    }
    return 0
  })
  throwIfPatternGenerationStopped(stopChecker)
  return Object.freeze(sortedPatterns)
}

export function orderedLineMatchesClue(
  line: BinaryLine,
  lineLength: number,
  clue: OrderedLineClue,
): boolean {
  assertBinaryLine(line)
  if (line.length !== lineLength) {
    throw new RangeError(
      `binary line length ${line.length} does not match expected line length ${lineLength}`,
    )
  }

  return decodeOrderedLineClue(lineLength, clue).some((pattern) =>
    pattern.every((cell, index) => cell === line[index]),
  )
}

export function assertOrderedLineMatchesClue(
  line: BinaryLine,
  lineLength: number,
  clue: OrderedLineClue,
  context = 'binary line',
): void {
  if (!orderedLineMatchesClue(line, lineLength, clue)) {
    throw new RangeError(`${context} does not match ordered clue [${clue.join(', ')}]`)
  }
}
