import { describe, expect, it } from 'vitest'
import {
  assertLinePatternResourceBudget,
  createPatternGenerationStopChecker,
  LinePatternResourceLimitError,
  PatternGenerationInterruptedError,
  throwIfPatternGenerationStopped,
  type PatternGenerationContext,
} from './linePatternGeneration'
import type { OrderedLineClue } from './orderedClues'

function assertBudget(
  context: unknown,
  lineLength: unknown,
  clue: unknown,
  patternCount: unknown,
): void {
  assertLinePatternResourceBudget(
    context as PatternGenerationContext | undefined,
    lineLength as number,
    clue as OrderedLineClue,
    patternCount as number,
  )
}

describe('line pattern generation controls', () => {
  it('rejects invalid resource contexts before comparing budgets', () => {
    for (const invalidCap of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(() =>
        assertBudget({ maxPatternCount: invalidCap }, 4, [1], 1),
      ).toThrow(/maxPatternCount.*nonnegative safe integer/)
      expect(() =>
        assertBudget({ maxMaterializedCells: invalidCap }, 4, [1], 1),
      ).toThrow(/maxMaterializedCells.*nonnegative safe integer/)
    }

    expect(() => assertBudget(null, 4, [1], 1)).toThrow(/non-array object/)
    expect(() =>
      assertBudget({ timeBudgetMs: Number.POSITIVE_INFINITY }, 4, [1], 1),
    ).toThrow(/timeBudgetMs.*finite nonnegative/)
  })

  it('validates line length, clue values, pattern count, and materialized arithmetic', () => {
    for (const invalidLineLength of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      31,
    ]) {
      expect(() => assertBudget(undefined, invalidLineLength, [], 0)).toThrow(
        /line pattern resource budget line length/,
      )
    }

    for (const invalidClue of [
      null,
      '1',
      [-1],
      [1.5],
      ['1'],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [2, 2],
    ]) {
      expect(() => assertBudget(undefined, 3, invalidClue, 0)).toThrow(
        /line pattern resource budget clue/,
      )
    }

    for (const invalidCount of [
      Number.NaN,
      Number.POSITIVE_INFINITY,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      '1',
    ]) {
      expect(() => assertBudget(undefined, 4, [1], invalidCount)).toThrow(
        /pattern count/,
      )
    }

    expect(() =>
      assertBudget(
        {
          maxPatternCount: Number.MAX_SAFE_INTEGER,
          maxMaterializedCells: Number.MAX_SAFE_INTEGER,
        },
        24,
        [],
        Number.MAX_SAFE_INTEGER,
      ),
    ).toThrow(/materialized cell count must be a safe integer/)
  })

  it('treats zero caps as valid fail-closed limits', () => {
    expect(() =>
      assertBudget({ maxPatternCount: 0, maxMaterializedCells: 0 }, 4, [1], 0),
    ).not.toThrow()
    expect(() => assertBudget({ maxPatternCount: 0 }, 4, [1], 1)).toThrow(
      LinePatternResourceLimitError,
    )
    expect(() => assertBudget({ maxMaterializedCells: 0 }, 4, [1], 1)).toThrow(
      LinePatternResourceLimitError,
    )
    expect(() => assertBudget({ maxPatternCount: 4 }, 4, [0], 0)).not.toThrow()
  })

  it('returns a zero-time interruption before invoking the clock', () => {
    let clockCalls = 0
    const checker = createPatternGenerationStopChecker({
      timeBudgetMs: 0,
      now: () => {
        clockCalls += 1
        throw new Error('clock must not be called')
      },
    })

    expect(checker()).toBe('time-limit')
    expect(() => throwIfPatternGenerationStopped(checker)).toThrow(
      PatternGenerationInterruptedError,
    )
    expect(clockCalls).toBe(0)
  })

  it('preserves cancellation precedence and normal elapsed-time checks', () => {
    const throwingNow = (): never => {
      throw new Error('clock must not be called')
    }
    expect(
      createPatternGenerationStopChecker({
        signal: { aborted: true } as never,
        timeBudgetMs: 0,
        now: throwingNow,
      })(),
    ).toBe('cancelled')

    let currentTime = 10
    let clockCalls = 0
    const checker = createPatternGenerationStopChecker({
      timeBudgetMs: 5,
      now: () => {
        clockCalls += 1
        return currentTime
      },
    })
    expect(checker()).toBeUndefined()
    currentTime = 14
    expect(checker()).toBeUndefined()
    currentTime = 15
    expect(checker()).toBe('time-limit')
    expect(clockCalls).toBe(4)
  })
})
