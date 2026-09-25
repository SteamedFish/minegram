import { assertLineLength } from './board'

export type OrderedLineClue = readonly number[]

/** @internal Validates clue values and returns a frozen canonical snapshot. */
export function canonicalizeOrderedLineClue(
  clue: unknown,
  context = 'ordered line clue',
): OrderedLineClue {
  if (!Array.isArray(clue)) {
    throw new TypeError(`${context} must be an array of nonnegative integers`)
  }

  const canonicalRuns: number[] = []
  let mineRunLength = 0
  for (let index = 0; index < clue.length; index += 1) {
    const runLength = clue[index]
    if (!Number.isSafeInteger(runLength)) {
      throw new TypeError(
        `${context}[${index}] must be a nonnegative safe integer; received ${String(runLength)}`,
      )
    }
    if (runLength < 0) {
      throw new RangeError(
        `${context}[${index}] must be nonnegative; received ${String(runLength)}`,
      )
    }
    if (runLength > 0) {
      canonicalRuns.push(runLength)
      mineRunLength += runLength
      if (!Number.isSafeInteger(mineRunLength)) {
        throw new RangeError(`${context} is too large to fit in a line`)
      }
    }
  }

  return Object.freeze(canonicalRuns)
}

export function assertOrderedLineClue(
  lineLength: number,
  clue: unknown,
  context = 'ordered line clue',
): asserts clue is OrderedLineClue {
  assertLineLength(lineLength, `${context} line length`)
  const canonicalRuns = canonicalizeOrderedLineClue(clue, context)
  const minimumLength =
    canonicalRuns.length === 0
      ? 0
      : canonicalRuns.reduce((total, runLength) => total + runLength, 0) +
        canonicalRuns.length -
        1

  if (minimumLength > lineLength) {
    throw new RangeError(
      `${context} requires at least ${minimumLength} cells but the line length is ${lineLength}`,
    )
  }
}
