import { describe, expect, it } from 'vitest'
import {
  countBoardMines,
  assertBoardHasMineInEveryLine,
  type BinaryMineBoard,
} from '../../domain/board'
import { validateSolutionBoard } from '../solver/constraintSolver'
import {
  DEFAULT_GENERATION_TIME_BUDGET_MS,
  DEFAULT_MAX_GENERATION_DIFFICULTY_NODES,
  calculateMineCount,
  generateMinegramPuzzle,
  normalizeGenerationSettings,
  replayWitnessTransactions,
  validateGenerationWitness,
  type GenerationWitness,
} from './index'

function makeWitness(): GenerationWitness {
  const dimensions = { rows: 2, columns: 2 }
  const board: BinaryMineBoard = Object.freeze([1, 0, 0, 1] as BinaryMineBoard)
  const puzzle = {
    dimensions,
    clues: { rowClues: [[1], [1]], columnClues: [[1], [1]] },
  }
  return {
    dimensions,
    mineIndices: Object.freeze([0, 3]),
    board,
    puzzle,
    proof: {
      status: 'unique',
      solution: board,
      diagnostics: { nodesVisited: 1, solutionsFound: 1 },
    },
  }
}

describe('Minegram deterministic generator', () => {
  it('normalizes dimensions, density, clamping, and defaults', () => {
    expect(normalizeGenerationSettings()).toMatchObject({
      rows: 15,
      columns: 15,
      densityPercent: 60,
      mineCount: 135,
      difficulty: 'starter',
      maxAttempts: 8,
    })
    expect(calculateMineCount(1, 1, 0)).toBe(1)
    expect(calculateMineCount(1, 1, 100)).toBe(1)
    expect(calculateMineCount(2, 3, 0)).toBe(3)
    expect(calculateMineCount(2, 3, 100)).toBe(6)
    expect(normalizeGenerationSettings({ rows: 30, columns: 30, densityPercent: 0 }).mineCount).toBe(30)
    expect(Object.isFrozen(normalizeGenerationSettings({ seed: 'phase-2' }))).toBe(true)
    for (const invalid of [
      { rows: 0 },
      { rows: 31 },
      { columns: 1.5 },
      { densityPercent: -1 },
      { densityPercent: 101 },
      { densityPercent: 1.5 },
      { maxAttempts: 0 },
      { seed: '' },
    ]) {
      expect(() => normalizeGenerationSettings(invalid)).toThrow()
    }
  })

  it('generates a deterministic exact-count covered board with a fresh unique proof', () => {
    const first = generateMinegramPuzzle({ rows: 2, columns: 2, densityPercent: 100, seed: 7 })
    const second = generateMinegramPuzzle({ rows: 2, columns: 2, densityPercent: 100, seed: 7 })
    expect(first.status).toBe('success')
    expect(second.status).toBe('success')
    if (first.status === 'success' && second.status === 'success') {
      expect(first.board).toEqual(second.board)
      expect(first.puzzle).toEqual(second.puzzle)
      expect(countBoardMines(first.board, first.settings)).toBe(first.settings.mineCount)
      expect(() => assertBoardHasMineInEveryLine(first.board, first.settings)).not.toThrow()
      expect(() => validateSolutionBoard(first.proof.solution, first.puzzle)).not.toThrow()
      expect(first.proof.solution).toEqual(first.board)
      expect(first.diagnostics.solverCalls).toBeGreaterThanOrEqual(2)
      expect(first.diagnostics.solverStatuses.at(-1)).toBe('unique')
      expect(first.trace).toHaveLength(first.settings.mineCount)
      for (const event of first.trace) {
        expect(event.proofStatus).toBe('unique')
        expect(event.proof.solution).toEqual(first.board)
        expect(event.acceptedMineIndices.every((index) => event.witness.mineIndices.includes(index))).toBe(true)
        expect(event.witness.mineIndices).toEqual(first.mineIndices)
      }
      expect(Object.isFrozen(first)).toBe(true)
      expect(Object.isFrozen(first.trace)).toBe(true)
    }
  })

  it('replays a witness transactionally and rolls back a rejected prefix', () => {
    const witness = makeWitness()
    const complete = replayWitnessTransactions(witness)
    expect(complete.status).toBe('complete')
    if (complete.status === 'complete') {
      expect(complete.acceptedMineIndices).toEqual([0, 3])
      expect(complete.trace).toHaveLength(2)
      expect(complete.trace[1].acceptedMineIndices).toEqual([0, 3])
      expect(complete.trace[0].witness.mineIndices).toEqual([0, 3])
    }

    const rolledBack = replayWitnessTransactions(witness, {
      probe: (_candidate, eventIndex) => eventIndex === 0,
    })
    const legacyRolledBack = replayWitnessTransactions(
      witness,
      (_candidate, eventIndex) => eventIndex === 0,
      [3, 0],
    )
    expect(legacyRolledBack.status).toBe('rolled-back')
    expect(rolledBack.status).toBe('rolled-back')
    if (rolledBack.status === 'rolled-back') {
      expect(rolledBack.failedMineIndex).toBe(3)
      expect(rolledBack.acceptedMineIndices).toEqual([0])
      expect(rolledBack.trace).toHaveLength(1)
    }
  })

  it('rejects incomplete or non-unique witness proofs and inconsistent mine indices', () => {
    const witness = makeWitness()
    expect(() =>
      validateGenerationWitness({ ...witness, mineIndices: Object.freeze([0, 1]) }),
    ).toThrow(/exactly represent|must identify/)

    const multiple = {
      ...witness,
      proof: {
        status: 'multiple',
        solutions: Object.freeze([witness.board, witness.board]),
        diagnostics: witness.proof.diagnostics,
      },
    } as unknown as GenerationWitness
    expect(() => validateGenerationWitness(multiple)).toThrow(/unique status/)

    const unknown = {
      ...witness,
      proof: {
        status: 'unknown',
        reason: 'node-limit',
        diagnostics: witness.proof.diagnostics,
      },
    } as unknown as GenerationWitness
    expect(() => validateGenerationWitness(unknown)).toThrow(/unique status/)
    expect(() =>
      validateGenerationWitness({
        ...witness,
        proof: {
          ...witness.proof,
          diagnostics: { ...witness.proof.diagnostics, solutionsFound: 0 },
        },
      }),
    ).toThrow(/diagnostics/)
  })

  it('generates a covered rectangular board with the exact clamped count', () => {
    const result = generateMinegramPuzzle({
      rows: 3,
      columns: 5,
      densityPercent: 40,
      seed: 'rectangular',
      maxAttempts: 2,
    })
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.settings.mineCount).toBe(6)
      expect(countBoardMines(result.board, result.settings)).toBe(6)
      expect(() => assertBoardHasMineInEveryLine(result.board, result.settings)).not.toThrow()
    }
  }, 30_000)

  it('generates a unique 3x2 board at the minimum feasible mine count', () => {
    let successful:
      | Extract<ReturnType<typeof generateMinegramPuzzle>, { readonly status: 'success' }>
      | undefined
    for (let seed = 0; seed < 64; seed += 1) {
      const candidate = generateMinegramPuzzle(
        {
          rows: 3,
          columns: 2,
          densityPercent: 0,
          seed,
          maxAttempts: 2,
        },
        { timeBudgetMs: 60_000, now: () => 0 },
      )
      if (candidate.status === 'success') {
        successful = candidate
        break
      }
    }

    expect(successful).toBeDefined()
    if (successful !== undefined) {
      expect(successful.settings.mineCount).toBe(3)
      expect(countBoardMines(successful.board, successful.settings)).toBe(3)
      expect(() => assertBoardHasMineInEveryLine(successful.board, successful.settings)).not.toThrow()
      expect(successful.proof.status).toBe('unique')
      expect(successful.proof.solution).toEqual(successful.board)
    }
  }, 30_000)

  it('prioritizes resource exhaustion over an earlier difficulty mismatch', () => {
    const result = generateMinegramPuzzle(
      {
        rows: 4,
        columns: 3,
        densityPercent: 40,
        difficulty: 'steady',
        seed: 23,
        maxAttempts: 4,
      },
      { maxSolverNodes: 17, timeBudgetMs: 60_000, now: () => 0 },
    )

    expect(result).toMatchObject({ status: 'failure', reason: 'resource-limit' })
    if (result.status === 'failure') {
      expect(result.diagnostics.solverStatuses).toContain('unknown')
      expect(result.diagnostics.resourceReasons).toContain('node-limit')
    }
  }, 30_000)

  it('smoke-generates a fixed-seed 15x15/60% puzzle within the bounded budget', () => {
    const result = generateMinegramPuzzle(
      { rows: 15, columns: 15, densityPercent: 60, seed: 'phase-2-smoke', maxAttempts: 2 },
      { maxSolverNodes: 20_000 },
    )
    expect(result.status).toBe('success')
    if (result.status === 'success') {
      expect(result.settings.mineCount).toBe(135)
      expect(countBoardMines(result.board, result.settings)).toBe(135)
      expect(result.diagnostics.attempts).toBeGreaterThan(0)
      expect(result.diagnostics.solverStatuses.at(-1)).toBe('unique')
    }
  }, 30_000)

  it('fails closed with diagnostics on a bounded pathological 30x30 budget', () => {
    const result = generateMinegramPuzzle(
      { rows: 30, columns: 30, densityPercent: 60, seed: 99, maxAttempts: 1 },
      { maxSolverNodes: 1_000 },
    )
    expect(result.status).toBe('failure')
    if (result.status === 'failure') {
      expect(result.reason).toBe('resource-limit')
      expect(result.diagnostics.attempts).toBe(1)
      expect(result.diagnostics.layouts).toBeGreaterThan(0)
      expect(result.diagnostics.solverCalls).toBeGreaterThan(0)
      expect(result.diagnostics.solverStatuses).toContain('unknown')
      expect(result.diagnostics.resourceReasons).toContain('resource-limit')
    }
  }, 30_000)

  it('fails closed before clock/pattern work for cancellation and zero budgets', () => {
    const throwingNow = (): never => {
      throw new Error('clock must not be called')
    }
    expect(
      generateMinegramPuzzle(
        { rows: 2, columns: 2, densityPercent: 100 },
        { signal: { aborted: true }, timeBudgetMs: 0, now: throwingNow },
      ),
    ).toMatchObject({ status: 'failure', reason: 'cancelled' })
    expect(
      generateMinegramPuzzle(
        { rows: 2, columns: 2, densityPercent: 100 },
        { timeBudgetMs: 0, now: throwingNow },
      ),
    ).toMatchObject({ status: 'failure', reason: 'time-limit' })
    expect(
      generateMinegramPuzzle(
        { rows: 2, columns: 2, densityPercent: 100 },
        { maxSolverNodes: 0 },
      ),
    ).toMatchObject({ status: 'failure', reason: 'resource-limit' })
  })

  it('bounds the default 10x10/40% seed-5 reproduction and reports difficulty accounting', () => {
    const startedAt = Date.now()
    const result = generateMinegramPuzzle(
      { rows: 10, columns: 10, densityPercent: 40, seed: 5 },
    )
    const elapsedMs = Date.now() - startedAt

    expect(elapsedMs).toBeLessThan(DEFAULT_GENERATION_TIME_BUDGET_MS + 2_000)
    expect(result).toMatchObject({ status: 'success' })
    expect(result.diagnostics.difficultyNodeLimit).toBe(DEFAULT_MAX_GENERATION_DIFFICULTY_NODES)
    expect(result.diagnostics.solverCalls).toBeGreaterThan(0)
    expect(result.diagnostics.difficultyNodesVisited).toBeGreaterThan(0)
    expect(result.diagnostics.difficultyNodesVisited).toBeLessThanOrEqual(
      DEFAULT_MAX_GENERATION_DIFFICULTY_NODES,
    )
    if (result.status === 'success') {
      expect(result.difficulty.minimumGuesses).toBe(0)
    }
  }, 6_000)

  it('fails closed at a positive difficulty-state cap', () => {
    const result = generateMinegramPuzzle(
      { rows: 5, columns: 5, densityPercent: 40, seed: 1, maxAttempts: 1 },
      { maxDifficultyNodes: 1 },
    )
    expect(result).toMatchObject({ status: 'failure', reason: 'resource-limit' })
    expect(result.diagnostics.difficultyNodesVisited).toBeLessThanOrEqual(1)
    expect(result.diagnostics.resourceReasons).toContain('node-limit')
  })

  it('uses the default deadline with an injected clock when no time option is supplied', () => {
    let clockCalls = 0
    const result = generateMinegramPuzzle(
      { rows: 2, columns: 2, densityPercent: 100, seed: 'default-deadline', maxAttempts: 1 },
      {
        now: () => {
          clockCalls += 1
          return clockCalls === 1 ? 0 : DEFAULT_GENERATION_TIME_BUDGET_MS + 1
        },
      },
    )
    expect(result).toMatchObject({ status: 'failure', reason: 'time-limit' })
    expect(clockCalls).toBeGreaterThan(0)
  })

  it('fails closed for explicit small time and difficulty budgets', () => {
    const throwingNow = (): never => {
      throw new Error('clock must not be called')
    }
    expect(
      generateMinegramPuzzle(
        { rows: 2, columns: 2, densityPercent: 100 },
        { maxDifficultyNodes: 0, now: throwingNow },
      ),
    ).toMatchObject({ status: 'failure', reason: 'resource-limit' })

    let clockCalls = 0
    const timed = generateMinegramPuzzle(
      { rows: 2, columns: 2, densityPercent: 100, seed: 'small-time' },
      {
        timeBudgetMs: 1,
        now: () => {
          clockCalls += 1
          return clockCalls === 1 ? 0 : 2
        },
      },
    )
    expect(timed).toMatchObject({ status: 'failure', reason: 'time-limit' })

    for (const maxDifficultyNodes of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '2']) {
      expect(() =>
        generateMinegramPuzzle(
          { rows: 2, columns: 2, densityPercent: 100 },
          { maxDifficultyNodes: maxDifficultyNodes as number },
        ),
      ).toThrow()
    }
  })

  it('does not accept an unknown candidate and reports a resource failure', () => {
    const result = generateMinegramPuzzle(
      { rows: 2, columns: 2, densityPercent: 100, seed: 'unknown-candidate' },
      { maxPatternCount: 0 },
    )
    expect(result.status).toBe('failure')
    if (result.status === 'failure') {
      expect(result.reason).toBe('resource-limit')
      expect(result.diagnostics.solverStatuses).toContain('unknown')
      expect(result.diagnostics.resourceReasons).toContain('resource-limit')
    }
  })

  it('fails closed for a zero time budget without requiring a clock', () => {
    expect(generateMinegramPuzzle({ rows: 2, columns: 2 }, { timeBudgetMs: 0 })).toMatchObject({
      status: 'failure',
      reason: 'time-limit',
    })
    expect(() => generateMinegramPuzzle({ rows: 2, columns: 2 }, { timeBudgetMs: 1 })).toThrow(
      /now is required/,
    )
  })
})
