import { describe, expect, it } from 'vitest'
import {
  LinePatternResourceLimitError,
  PatternGenerationInterruptedError,
} from '../../domain/linePatternGeneration'
import type { MinegramPuzzle } from '../../domain/puzzle'
import {
  createConstraintDomains,
  propagateMutableDomains,
  type MutableConstraintDomains,
} from './propagation'
import { getLegalLinePatterns } from './patterns'
import { solvePuzzle } from './constraintSolver'

const pathological30x1: MinegramPuzzle = {
  dimensions: { rows: 30, columns: 1 },
  clues: {
    rowClues: Array.from({ length: 30 }, () => []),
    columnClues: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]],
  },
}

const forced3x3: MinegramPuzzle = {
  dimensions: { rows: 3, columns: 3 },
  clues: {
    rowClues: [[3], [], []],
    columnClues: [[1], [1], [1]],
  },
}

function copyDomains(domains: MutableConstraintDomains): MutableConstraintDomains {
  return {
    rowDomains: domains.rowDomains.map((domain) => [...domain]),
    columnDomains: domains.columnDomains.map((domain) => [...domain]),
  }
}

describe('Oracle-gate resource and fail-closed boundaries', () => {
  it('preflights cancellation and zero budgets before pathological construction', () => {
    const controller = new AbortController()
    controller.abort()
    const cancelledStarted = Date.now()
    const cancelled = solvePuzzle(pathological30x1, { signal: controller.signal })
    const cancelledElapsed = Date.now() - cancelledStarted

    expect(cancelled).toMatchObject({ status: 'unknown', reason: 'cancelled' })
    expect(cancelledElapsed).toBeLessThan(100)
    expect(
      solvePuzzle(pathological30x1, {
        timeBudgetMs: 0,
        now: () => {
          throw new Error('the solver clock must not run for a zero budget')
        },
      }),
    ).toMatchObject({ status: 'unknown', reason: 'time-limit', diagnostics: { nodesVisited: 0 } })
    expect(solvePuzzle(pathological30x1, { maxNodes: 0 })).toMatchObject({
      status: 'unknown',
      reason: 'node-limit',
      diagnostics: { nodesVisited: 0 },
    })
  })

  it('fails closed at explicit line caps and recovers after interrupted enumeration', () => {
    const tenRunClue = Array.from({ length: 10 }, () => 1)
    let limitError: unknown
    try {
      getLegalLinePatterns(30, tenRunClue)
    } catch (error) {
      limitError = error
    }
    expect(limitError).toBeInstanceOf(LinePatternResourceLimitError)
    expect(limitError).toMatchObject({
      kind: 'pattern-count',
      lineLength: 30,
      allowed: 10_000,
    })

    expect(() =>
      getLegalLinePatterns(30, [1, 1, 1], { maxMaterializedCells: 1_000 }),
    ).toThrow(LinePatternResourceLimitError)
    expect(() =>
      getLegalLinePatterns(30, [1, 1, 1, 1], { timeBudgetMs: 0, now: () => 0 }),
    ).toThrow(PatternGenerationInterruptedError)
    expect(() => getLegalLinePatterns(1, [], { maxPatternCount: 0 })).toThrow(
      LinePatternResourceLimitError,
    )

    const recoveryClue = [1, 1, 1]
    let stopChecks = 0
    expect(() =>
      getLegalLinePatterns(30, recoveryClue, {
        shouldStop: () => {
          stopChecks += 1
          return stopChecks > 8 ? true : undefined
        },
      }),
    ).toThrow(PatternGenerationInterruptedError)
    const recovered = getLegalLinePatterns(30, recoveryClue)
    expect(recovered).toHaveLength(3_276)
    expect(getLegalLinePatterns(30, recoveryClue)).toBe(recovered)
  })

  it('does not build or cache a line after a pre-cancelled request', () => {
    const cancelledSignal = { aborted: true } as AbortSignal
    expect(() =>
      getLegalLinePatterns(30, [1, 1, 1], {
        signal: cancelledSignal,
        now: () => {
          throw new Error('a pre-cancelled request must not read the clock')
        },
      }),
    ).toThrow(PatternGenerationInterruptedError)
    expect(getLegalLinePatterns(30, [1, 1, 1])).toHaveLength(3_276)
  })

  it('maps line resource exhaustion to an explicit unknown result with diagnostics', () => {
    const result = solvePuzzle(pathological30x1)
    expect(result).toMatchObject({ status: 'unknown', reason: 'resource-limit' })
    if (result.status !== 'unknown') {
      return
    }
    expect(result.diagnostics.nodesVisited).toBe(0)
    expect(result.diagnostics.solutionsFound).toBe(0)
    expect(result.diagnostics.resource).toMatchObject({
      kind: 'pattern-count',
      lineLength: 30,
      allowed: 10_000,
    })
  })

  it('stops during search without turning a partial search into a unique result', () => {
    for (const clue of [[1], [1]]) {
      getLegalLinePatterns(2, clue)
    }
    let clockCalls = 0
    const result = solvePuzzle(
      {
        dimensions: { rows: 2, columns: 2 },
        clues: { rowClues: [[1], [1]], columnClues: [[1], [1]] },
      },
      {
        maxNodes: 1_000,
        timeBudgetMs: 1,
        now: () => {
          clockCalls += 1
          return clockCalls >= 30 ? 2 : 0
        },
      },
    )
    expect(result).toMatchObject({ status: 'unknown', reason: 'time-limit' })
    expect(result.diagnostics.nodesVisited).toBeGreaterThan(0)
  })
})

describe('low-level propagation input atomicity', () => {
  it('rejects malformed domains and assignments before mutating either input', () => {
    const validDomains = createConstraintDomains(forced3x3)
    const validAssignments = Array.from({ length: 9 }, () => undefined)

    expect(() =>
      propagateMutableDomains(
        forced3x3,
        null as never,
        [...validAssignments],
      ),
    ).toThrow(/non-array object/)
    expect(() =>
      propagateMutableDomains(
        forced3x3,
        { rowDomains: [], columnDomains: [] } as never,
        [...validAssignments],
      ),
    ).toThrow(/exactly 3 domains/)
    expect(() =>
      propagateMutableDomains(
        forced3x3,
        Object.create(validDomains) as MutableConstraintDomains,
        [...validAssignments],
      ),
    ).toThrow(/own data property/)

    const frozenGroups = copyDomains(validDomains)
    Object.freeze(frozenGroups.rowDomains)
    expect(() =>
      propagateMutableDomains(forced3x3, frozenGroups, [...validAssignments]),
    ).toThrow(/rowDomains must have a writable length/)

    const staleDomains = copyDomains(validDomains)
    staleDomains.rowDomains[0] = [1]
    const staleSnapshot = JSON.stringify(staleDomains)
    const staleAssignments = [...validAssignments]
    expect(() =>
      propagateMutableDomains(forced3x3, staleDomains, staleAssignments),
    ).toThrow(/pattern index must be between/)
    expect(JSON.stringify(staleDomains)).toBe(staleSnapshot)
    expect(staleAssignments).toEqual(validAssignments)

    const sparseAssignments = Array(9) as Array<0 | 1 | undefined>
    expect(() =>
      propagateMutableDomains(forced3x3, copyDomains(validDomains), sparseAssignments),
    ).toThrow(/explicit undefined/)
    expect(Object.hasOwn(sparseAssignments, 0)).toBe(false)

    const invalidAssignments = [2, ...Array.from({ length: 8 }, () => undefined)] as Array<
      0 | 1 | undefined
    >
    expect(() =>
      propagateMutableDomains(forced3x3, copyDomains(validDomains), invalidAssignments),
    ).toThrow(/must be undefined, 0, or 1/)
    expect(invalidAssignments[0]).toBe(2)
  })

  it('rejects frozen mutable inputs before propagation can partially mutate them', () => {
    const domains = createConstraintDomains(forced3x3)
    Object.freeze(domains.rowDomains[0])
    const assignments = Array.from({ length: 9 }, () => undefined)
    expect(() => propagateMutableDomains(forced3x3, domains, assignments)).toThrow(
      /writable (length|data property)/,
    )
    expect(assignments.every((cell) => cell === undefined)).toBe(true)
  })
})
