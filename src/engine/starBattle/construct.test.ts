/**
 * Tests for the spanning-tree Star Battle generator (`./construct.ts`).
 *
 * What is pinned here, and why:
 *
 * - THE GENERATION CONTRACT on every produced board at every tier: the
 *   exact counter proves exactly one solution, the planted permutation is
 *   a valid puzzle, both connectivity nets agree. The contract does not
 *   vary with the path — a fallback board carries the same proof burden
 *   as a stream board.
 * - NEVER FAIL: a zero (or exhausted) wall-clock budget yields the
 *   fallback strips-and-sea board, honestly flagged `fallback: true`,
 *   never a throw.
 * - Determinism per (n, seed, difficulty) whenever the stream path
 *   accepts — wall clock gates only the fallback, never which stream board
 *   is accepted.
 * - The tier predicate ({@link starTierAcceptsGrade}) as the single
 *   contract both generation and feasibility consume — pinned directly,
 *   cheaply and deterministically, because the expensive integration-path
 *   pins (per-tier boards) build on it.
 * - Progress reporting: truthful candidate counts, phase changes, and the
 *   throwing-listener-is-swallowed contract.
 *
 * Per-test timeout policy (repo rule): any test exercising a generation
 * budget carries an explicit timeout and a cost comment. Costs are the
 * measured per-accepted-board figures (n = 4/5: milliseconds; n = 6: ~1.3 s
 * p50; n = 8: ~8 s p50) plus the stated budget override; nothing here is
 * allowed to sit on the global default and guess.
 */
import { describe, expect, it } from 'vitest'
import { assertStarBattlePuzzle, MIN_STAR_SIDE, MAX_STAR_SIDE } from '../../domain/starBattle'
import { countStarSolutions } from './count'
import { propagateStarBoard } from './propagate'
import { solveStarCatalogue } from './catalogue'
import { measureMinimumBasis } from './minimumBasis'
import { measureStarBoardStructure } from './structure'
import {
  STAR_DIFFICULTIES,
  STAR_STARTER_MAX_WAVES,
  defaultStarGenerationBudgetMs,
  generateStarBattle,
  starTierAcceptsGrade,
  type StarGenerationPhase,
  type StarGenerationProgress,
} from './construct'

/** The contract every shipped board must satisfy, whatever produced it. */
function expectContractBoard(board: ReturnType<typeof generateStarBattle>): void {
  const { puzzle } = board
  assertStarBattlePuzzle(puzzle)
  // THE gate: exactly one solution, proven by the exact counter.
  expect(countStarSolutions(puzzle.colours, puzzle.n, 2)).toBe(1)
  // Structural guarantee: every colour exactly one 4-connected component.
  expect(measureStarBoardStructure(puzzle.colours, puzzle.n).connected).toBe(true)
  // The reported wave count is a positive integer (the worker validates
  // exactly this before a board reaches the store).
  expect(Number.isSafeInteger(board.waves)).toBe(true)
  expect(board.waves).toBeGreaterThan(0)
  expect(STAR_DIFFICULTIES).toContain(board.difficulty)
}

describe('generateStarBattle input validation', () => {
  it('rejects bad sides, seeds and difficulties loudly', () => {
    expect(() => generateStarBattle({ n: 3, seed: 1, difficulty: 'starter' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: 6.5, seed: 1, difficulty: 'starter' })).toThrow(TypeError)
    expect(() => generateStarBattle({ n: 11, seed: 1, difficulty: 'starter' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: 6, seed: 1.5, difficulty: 'starter' })).toThrow(TypeError)
    expect(() => generateStarBattle({ n: 6, seed: 1, difficulty: 'absurd' as never })).toThrow(TypeError)
    expect(() =>
      generateStarBattle({ n: 6, seed: 1, difficulty: 'starter' }, { timeBudgetMs: -1 }),
    ).toThrow(RangeError)
  })
})

describe('the budget-expiry fallback (NEVER FAIL)', () => {
  it('returns a certified fallback board, honestly flagged, on a zero budget', () => {
    // Cost: painting and certification are milliseconds; the stream never
    // runs because the deadline has already passed.
    for (const difficulty of STAR_DIFFICULTIES) {
      const board = generateStarBattle({ n: 6, seed: 11, difficulty }, { timeBudgetMs: 0 })
      expect(board.fallback).toBe(true)
      expect(board.difficulty).toBe(difficulty)
      expectContractBoard(board)
    }
  }, 30_000)

  it('falls back at the small sides too (domino painting path)', () => {
    // Cost: milliseconds (see above).
    for (const n of [4, 5]) {
      const board = generateStarBattle({ n, seed: 13, difficulty: 'starter' }, { timeBudgetMs: 0 })
      expect(board.fallback).toBe(true)
      expectContractBoard(board)
    }
  }, 30_000)

  it('fallback boards are base-solvable (the old construction is a k = 0 class board)', () => {
    // Cost: milliseconds.
    const board = generateStarBattle({ n: 8, seed: 17, difficulty: 'expert' }, { timeBudgetMs: 0 })
    expect(board.fallback).toBe(true)
    const base = propagateStarBoard(board.puzzle.colours, 8)
    expect(base.solved).toBe(true)
  }, 30_000)
})

describe('starTierAcceptsGrade — the tier contract, pinned directly', () => {
  const baseSolvedShallow = { baseSolved: true, baseWaves: 4, k: 0 }
  const baseSolvedDeep = { baseSolved: true, baseWaves: 12, k: 0 }
  const k1 = { baseSolved: false, baseWaves: 0, k: 1 }
  const k2 = { baseSolved: false, baseWaves: 0, k: 2 }
  const k3 = { baseSolved: false, baseWaves: 0, k: 3 }
  const kMinus1Solved = {
    baseSolved: false,
    baseWaves: 0,
    k: -1,
    contradiction: { solved: true },
  }
  const kMinus1Stalled = {
    baseSolved: false,
    baseWaves: 0,
    k: -1,
    contradiction: { solved: false },
  }

  it('starter takes k = 0 at or under the wave cut; steady takes the deep half', () => {
    expect(starTierAcceptsGrade('starter', baseSolvedShallow)).toBe(true)
    expect(starTierAcceptsGrade('starter', baseSolvedDeep)).toBe(false)
    expect(starTierAcceptsGrade('steady', baseSolvedShallow)).toBe(false)
    expect(starTierAcceptsGrade('steady', baseSolvedDeep)).toBe(true)
  })

  it('the wave cut is the shared STAR_STARTER_MAX_WAVES constant, not a duplicated literal', () => {
    const atCut = { baseSolved: true, baseWaves: STAR_STARTER_MAX_WAVES, k: 0 }
    const pastCut = { baseSolved: true, baseWaves: STAR_STARTER_MAX_WAVES + 1, k: 0 }
    expect(starTierAcceptsGrade('starter', atCut)).toBe(true)
    expect(starTierAcceptsGrade('starter', pastCut)).toBe(false)
    expect(starTierAcceptsGrade('steady', pastCut)).toBe(true)
  })

  it('challenging is exactly k = 1, expert exactly k = 2, nothing else', () => {
    expect(starTierAcceptsGrade('challenging', k1)).toBe(true)
    expect(starTierAcceptsGrade('challenging', k2)).toBe(false)
    expect(starTierAcceptsGrade('challenging', baseSolvedShallow)).toBe(false)
    expect(starTierAcceptsGrade('expert', k2)).toBe(true)
    expect(starTierAcceptsGrade('expert', k1)).toBe(false)
    expect(starTierAcceptsGrade('expert', k3)).toBe(false)
  })

  it('contradiction is k = -1 AND a solving depth-1 certificate — a stall rejects', () => {
    expect(starTierAcceptsGrade('contradiction', kMinus1Solved)).toBe(true)
    expect(starTierAcceptsGrade('contradiction', kMinus1Stalled)).toBe(false)
    expect(starTierAcceptsGrade('contradiction', k2)).toBe(false)
  })

  it('k = 3 belongs to no tier', () => {
    for (const tier of STAR_DIFFICULTIES) {
      expect(starTierAcceptsGrade(tier, k3)).toBe(false)
    }
  })
})

describe('stream generation: contract, tiers and determinism', () => {
  it('every generated board at the small sides satisfies the full contract, whatever path produced it', () => {
    // Cost: n = 4/5 stream generation is milliseconds per board for the
    // reachable classes; tiers whose grade class does not exist at the
    // size (measured: k = 2 and k = -1 boards essentially do not occur at
    // n = 4 — the old walk-era matrix already showed expert and
    // contradiction unavailable there) burn the 15 s default budget and
    // answer with the honest fallback, which is the NEVER-FAIL contract,
    // not a failure. So this test pins the CONTRACT on every board and
    // pins the stream path only for starter, whose class provably exists.
    for (const n of [4, 5]) {
      for (const difficulty of STAR_DIFFICULTIES) {
        const board = generateStarBattle({ n, seed: 100 + n, difficulty })
        expectContractBoard(board)
      }
      const starter = generateStarBattle({ n, seed: 100 + n, difficulty: 'starter' })
      expect(starter.fallback).not.toBe(true)
      expectContractBoard(starter)
    }
  }, 120_000)

  it('starter at n = 8 with the default budget is measured to fall back — a recorded fact, not a bug', () => {
    // MEASURED FACT (probe, this machine, 2026-10): within the 15 s default
    // budget starter at n = 8 fell back 5/5 seeds, because only ~10% of
    // the n = 8 k = 0 pool (3/30 measured boards) sits inside the starter
    // band (waves ≤ 5) — a starter-eligible board arrives roughly every
    // 20+ s against the 15 s budget. Steady at the same size succeeded
    // 5/5 in 0.4–3.2 s (the k = 0 pool is ~90% deep-wave). The band is
    // deliberately NOT widened to make the tier pass (spec: a widened band
    // would ship 7–9-wave boards as "starter"); the picker learns the
    // unavailability through feasibility.ts and this test pins that the
    // fallback path answers honestly (fallback: true, full contract) when
    // the stream cannot supply the tier.
    //
    // Cost: one default-budget generation at n = 8 = the 15 s budget when
    // the stream cannot supply the tier (this test always takes the full
    // budget).
    const board = generateStarBattle({ n: 8, seed: 700, difficulty: 'starter' })
    expect(board.fallback).toBe(true)
    expectContractBoard(board)
  }, 30_000)

  it('starter and steady boards at n = 6 carry the k = 0 grade with the wave split', () => {
    // Cost: n = 6 accepted boards measure ~1.3 s p50; the k = 0 pool is
    // ~15% of accepted boards, so a targeted generation lands within a
    // few seconds. Budget 60 s is ~40× the p50 — fallback would mean the
    // stream broke, and the assertion on `fallback` says so.
    const starter = generateStarBattle({ n: 6, seed: 201, difficulty: 'starter' }, { timeBudgetMs: 60_000 })
    expect(starter.fallback).not.toBe(true)
    expectContractBoard(starter)
    const starterBase = propagateStarBoard(starter.puzzle.colours, 6)
    expect(starterBase.solved).toBe(true)
    expect(starterBase.waves).toBeLessThanOrEqual(STAR_STARTER_MAX_WAVES)
    expect(starter.waves).toBe(starterBase.waves)

    const steady = generateStarBattle({ n: 6, seed: 202, difficulty: 'steady' }, { timeBudgetMs: 60_000 })
    expect(steady.fallback).not.toBe(true)
    expectContractBoard(steady)
    const steadyBase = propagateStarBoard(steady.puzzle.colours, 6)
    expect(steadyBase.solved).toBe(true)
    expect(steadyBase.waves).toBeGreaterThan(STAR_STARTER_MAX_WAVES)
  }, 150_000)

  it('challenging, expert and contradiction boards at n = 6 carry their measured grade', () => {
    // Cost: the technique tiers rejection-sample the repaired stream; the
    // k = 1 / k = 2 / k = -1 classes are the MAJORITY at n = 6 (measured),
    // so each generation is a few accepted boards ≈ tens of seconds worst
    // case. Budget 120 s per board with the contract asserted on the
    // outcome — a fallback here is a measured report, not a silent pass,
    // so the test pins `fallback` to false to catch a stream regression.
    const challenging = generateStarBattle({ n: 6, seed: 203, difficulty: 'challenging' }, { timeBudgetMs: 120_000 })
    expect(challenging.fallback).not.toBe(true)
    expectContractBoard(challenging)
    expect(measureMinimumBasis(challenging.puzzle.colours, 6).k).toBe(1)

    const expert = generateStarBattle({ n: 6, seed: 204, difficulty: 'expert' }, { timeBudgetMs: 120_000 })
    expect(expert.fallback).not.toBe(true)
    expectContractBoard(expert)
    expect(measureMinimumBasis(expert.puzzle.colours, 6).k).toBe(2)

    const contradiction = generateStarBattle({ n: 6, seed: 205, difficulty: 'contradiction' }, { timeBudgetMs: 120_000 })
    expect(contradiction.fallback).not.toBe(true)
    expectContractBoard(contradiction)
    const contradictionBasis = measureMinimumBasis(contradiction.puzzle.colours, 6)
    expect(contradictionBasis.k).toBe(-1)
    const certificate = solveStarCatalogue(contradiction.puzzle.colours, 6, { csDepth: 1 })
    expect(certificate.solved).toBe(true)
    expect(contradiction.csPasses).toBe(certificate.csPasses)
    expect(contradiction.csTrials).toBe(certificate.csTrials)
  }, 420_000)

  it('same (n, seed, difficulty) yields a byte-identical stream board', () => {
    // Cost: two n = 6 generations ≈ a few seconds each (see above).
    const first = generateStarBattle({ n: 6, seed: 301, difficulty: 'challenging' }, { timeBudgetMs: 60_000 })
    const second = generateStarBattle({ n: 6, seed: 301, difficulty: 'challenging' }, { timeBudgetMs: 60_000 })
    expect(first.fallback).not.toBe(true)
    expect(second.fallback).not.toBe(true)
    expect([...second.puzzle.colours]).toEqual([...first.puzzle.colours])
    expect(second.puzzle.solution).toEqual(first.puzzle.solution)
  }, 150_000)

  it('different seeds overwhelmingly yield different boards', () => {
    // Cost: two n = 6 generations (see above).
    const boards = [401, 402, 403].map((seed) =>
      generateStarBattle({ n: 6, seed, difficulty: 'starter' }, { timeBudgetMs: 60_000 }),
    )
    const distinct = new Set(boards.map((board) => [...board.puzzle.colours].join(',')))
    expect(distinct.size).toBeGreaterThan(1)
  }, 150_000)
})

describe('progress reporting', () => {
  it('emits phase changes and a truthful candidate count, ending at accepted = 1', () => {
    // Cost: one n = 6 generation (~1.3 s p50).
    const seen: StarGenerationProgress[] = []
    const phases = new Set<StarGenerationPhase>()
    const board = generateStarBattle({ n: 6, seed: 501, difficulty: 'challenging' }, {
      timeBudgetMs: 60_000,
      onProgress: (progress) => {
        seen.push(progress)
        phases.add(progress.phase)
      },
    })
    expect(board.fallback).not.toBe(true)
    expect(seen.length).toBeGreaterThan(0)
    // candidates only ever grows, is always truthful (≥ 1 once sampled),
    // and the final snapshot reports the acceptance.
    let lastCandidates = 0
    for (const progress of seen) {
      expect(progress.candidates).toBeGreaterThanOrEqual(lastCandidates)
      lastCandidates = progress.candidates
    }
    expect(lastCandidates).toBeGreaterThanOrEqual(1)
    expect(seen[seen.length - 1].accepted).toBe(1)
    // Every phase label is one of the declared three — no percentages, no
    // invented fields.
    expect([...phases].every((phase) => ['sampling', 'repairing', 'grading'].includes(phase))).toBe(true)
  }, 120_000)

  it('a throwing onProgress is swallowed and never corrupts generation', () => {
    // Cost: one n = 6 generation (see above).
    const board = generateStarBattle({ n: 6, seed: 502, difficulty: 'starter' }, {
      timeBudgetMs: 60_000,
      onProgress: () => {
        throw new Error('broken listener')
      },
    })
    expect(board.fallback).not.toBe(true)
    expectContractBoard(board)
  }, 120_000)

  it('the fallback path also reports progress', () => {
    // Cost: milliseconds (zero budget — the stream never starts).
    const seen: StarGenerationProgress[] = []
    const board = generateStarBattle({ n: 6, seed: 503, difficulty: 'starter' }, {
      timeBudgetMs: 0,
      onProgress: (progress) => seen.push(progress),
    })
    expect(board.fallback).toBe(true)
    expect(seen.length).toBeGreaterThan(0)
  }, 30_000)
})

describe('default budgets', () => {
  it('n ≤ 8 stay inside ~15 s and n ≥ 9 inside ~90 s (the player-approved envelope)', () => {
    expect(defaultStarGenerationBudgetMs(4)).toBe(15_000)
    expect(defaultStarGenerationBudgetMs(8)).toBe(15_000)
    expect(defaultStarGenerationBudgetMs(9)).toBe(90_000)
    expect(defaultStarGenerationBudgetMs(10)).toBe(90_000)
    expect(() => defaultStarGenerationBudgetMs(3)).toThrow(RangeError)
  })
})

describe('side range', () => {
  it('generation honours the domain side constants as the single source of truth', () => {
    // The range pins live in src/domain/starBattle.test.ts; here we only
    // confirm the generator reads the same constants (no repeated
    // literals) by probing the boundaries.
    expect(() => generateStarBattle({ n: MIN_STAR_SIDE, seed: 1, difficulty: 'starter' }, { timeBudgetMs: 0 })).not.toThrow()
    expect(() => generateStarBattle({ n: MAX_STAR_SIDE, seed: 1, difficulty: 'starter' }, { timeBudgetMs: 0 })).not.toThrow()
    expect(() => generateStarBattle({ n: MIN_STAR_SIDE - 1, seed: 1, difficulty: 'starter' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: MAX_STAR_SIDE + 1, seed: 1, difficulty: 'starter' })).toThrow(RangeError)
  }, 30_000)
})
