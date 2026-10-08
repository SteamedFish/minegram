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
    expect(() => generateStarBattle({ n: 3, seed: 1, difficulty: 'challenging' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: 6.5, seed: 1, difficulty: 'challenging' })).toThrow(TypeError)
    expect(() => generateStarBattle({ n: 11, seed: 1, difficulty: 'challenging' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: 6, seed: 1.5, difficulty: 'challenging' })).toThrow(TypeError)
    expect(() => generateStarBattle({ n: 6, seed: 1, difficulty: 'absurd' as never })).toThrow(TypeError)
    expect(() =>
      generateStarBattle({ n: 6, seed: 1, difficulty: 'challenging' }, { timeBudgetMs: -1 }),
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
      const board = generateStarBattle({ n, seed: 13, difficulty: 'challenging' }, { timeBudgetMs: 0 })
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
  const k0 = { k: 0 }
  const k1 = { k: 1 }
  const k2 = { k: 2 }
  const k3 = { k: 3 }
  const kMinus1Solved = {
    k: -1,
    contradiction: { solved: true },
  }
  const kMinus1Stalled = {
    k: -1,
    contradiction: { solved: false },
  }

  it('challenging is exactly k = 1, expert exactly k = 2, nothing else', () => {
    expect(starTierAcceptsGrade('challenging', k1)).toBe(true)
    expect(starTierAcceptsGrade('challenging', k2)).toBe(false)
    expect(starTierAcceptsGrade('challenging', k0)).toBe(false)
    expect(starTierAcceptsGrade('expert', k2)).toBe(true)
    expect(starTierAcceptsGrade('expert', k1)).toBe(false)
    expect(starTierAcceptsGrade('expert', k3)).toBe(false)
  })

  it('the k = 0 class belongs to no tier since the starter/steady retirement', () => {
    // Base-solvable boards are legal puzzles but no shipped tier accepts
    // them (the shallow boards the retired tiers served are structurally
    // unreachable from the spanning-tree stream at the played sizes —
    // construct.ts's module doc has the measurement). This pin exists so a
    // future "easy tier" proposal re-derives the band instead of silently
    // widening this predicate.
    for (const tier of STAR_DIFFICULTIES) {
      expect(starTierAcceptsGrade(tier, k0)).toBe(false)
    }
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
    // size (measured probe, 2026-10: at n = 4 the repaired pool is
    // {k=0: 8, k=1: 7} over 200 candidates — k = 2 and k = -1 boards did
    // not occur, matching the old walk-era matrix that expert and
    // contradiction are unavailable there) burn the 15 s default budget
    // and answer with the honest fallback, which is the NEVER-FAIL
    // contract, not a failure. So this test pins the CONTRACT on every
    // board and pins the stream path only for challenging, whose k = 1
    // class measured ~47% of the n = 4 repaired pool and provably exists.
    for (const n of [4, 5]) {
      for (const difficulty of STAR_DIFFICULTIES) {
        const board = generateStarBattle({ n, seed: 100 + n, difficulty })
        expectContractBoard(board)
      }
      const challenging = generateStarBattle({ n, seed: 100 + n, difficulty: 'challenging' })
      expect(challenging.fallback).not.toBe(true)
      expectContractBoard(challenging)
      expect(measureMinimumBasis(challenging.puzzle.colours, n).k).toBe(1)
    }
  }, 120_000)

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

  it('challenging acceptance measured over 30 generations per side: 0 fallbacks at n = 6 and n = 8, every accepted board graded k = 1', () => {
    // MEASURED BAND (probe, this machine, 2026-10 — the starter/steady
    // retirement made challenging the shallowest shipped tier, so its
    // acceptance re-derives against the real per-tier supply): 30
    // generations per side, default budgets, seeds 910_000 + i·131 + n:
    // 0 fallbacks at n = 6 (p50 8 ms, p95 33 ms) and 0 at n = 8 (p50
    // 162 ms, p95 1 127 ms). The headroom is enormous — the n = 8 p95 is
    // ~75× under the 15 s budget — so 0/30 is a stable pin, not luck.
    // Every accepted board is re-measured to k = 1: the fallback board is
    // base-solvable (k = 0) and belongs to no tier, so a fallback sneaking
    // in would fail this grade assertion even if wall clock lied.
    //
    // Cost: 60 generations ≈ seconds at these sizes (the measured p95s
    // above) plus 60 basis re-measurements (milliseconds each).
    const SEED_BASE = 910_000
    for (const n of [6, 8] as const) {
      for (let i = 0; i < 30; i += 1) {
        const board = generateStarBattle({ n, seed: SEED_BASE + i * 131 + n, difficulty: 'challenging' })
        expect(board.fallback).not.toBe(true)
        expectContractBoard(board)
        expect(measureMinimumBasis(board.puzzle.colours, n).k).toBe(1)
      }
    }
  }, 300_000)

  it('challenging at n = 10: the band is reachable — three generations land k = 1 under a generous explicit budget', () => {
    // MEASURED CONTEXT (probe, this machine, 2026-10 — the full 30-sample
    // cell is recorded in the feasibility module doc): at the DEFAULT 90 s
    // budget challenging at n = 10 fell back 1/30 (p50 9.1 s, p95 42 s,
    // one tail board at the budget) — a real but rare tail. The fallback
    // count is wall-clock-dependent (which candidate index the stream
    // reached), so it is a documented measured fact, not an assertion.
    // What IS deterministic and pinned here: the k = 1 class supplies the
    // tier at n = 10 — three fixed seeds all land stream boards graded
    // k = 1 under a 300 s budget, ~10× the measured p95 (the budget
    // override removes the expiry boundary, so the outcomes are stable).
    //
    // Cost: 3 × the measured p50 ≈ 9 s wall each (the probe's per-step
    // walls for these seeds: 14.3 / 26.5 / 12.9 s), plus 3 basis
    // re-measurements (seconds each at n = 10).
    const SEED_BASE = 920_000
    for (let i = 0; i < 3; i += 1) {
      const board = generateStarBattle(
        { n: 10, seed: SEED_BASE + i * 131, difficulty: 'challenging' },
        { timeBudgetMs: 300_000 },
      )
      expect(board.fallback).not.toBe(true)
      expectContractBoard(board)
      expect(measureMinimumBasis(board.puzzle.colours, 10).k).toBe(1)
    }
  }, 600_000)

  it('contradiction at n = 10: the tightest cell still supplies the tier under a generous explicit budget', () => {
    // MEASURED CONTEXT (probe, 2026-10 — full cell in the feasibility
    // module doc): at the DEFAULT budget contradiction at n = 10 fell
    // back 2/30 with p95 AT the budget (4/30 boards exceeded 60 s) — the
    // tightest shipped cell, ~1 fallback in 15 generations (Wilson 95 ≈
    // 0.9–21%). Like challenging's tail above, the count itself is
    // wall-clock-dependent and lives in the doc, not here. Pinned: two
    // fixed seeds land stream boards graded k = −1 with a solving
    // depth-1 certificate under a 600 s budget (~30× the measured p50 of
    // 20.3 s, well past the 60 s tail knee).
    //
    // Cost: the probe's first two contradiction walls were 65.3 s and
    // 12.1 s; at 600 s the budget cannot bind, so the test costs ~1–2
    // min wall under suite contention. This is the deliberate price of
    // pinning the hardest cell; do not shrink the budget to speed the
    // suite up — that would reintroduce the timing dependence this pin
    // exists to exclude.
    const SEED_BASE = 920_000
    for (let i = 0; i < 2; i += 1) {
      const board = generateStarBattle(
        { n: 10, seed: SEED_BASE + i * 131, difficulty: 'contradiction' },
        { timeBudgetMs: 600_000 },
      )
      expect(board.fallback).not.toBe(true)
      expectContractBoard(board)
      const basis = measureMinimumBasis(board.puzzle.colours, 10)
      expect(basis.k).toBe(-1)
      expect(solveStarCatalogue(board.puzzle.colours, 10, { csDepth: 1 }).solved).toBe(true)
      expect(board.csPasses).toBeGreaterThanOrEqual(1)
    }
  }, 900_000)

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
      generateStarBattle({ n: 6, seed, difficulty: 'challenging' }, { timeBudgetMs: 60_000 }),
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
    const board = generateStarBattle({ n: 6, seed: 502, difficulty: 'challenging' }, {
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
    const board = generateStarBattle({ n: 6, seed: 503, difficulty: 'challenging' }, {
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
    expect(() => generateStarBattle({ n: MIN_STAR_SIDE, seed: 1, difficulty: 'challenging' }, { timeBudgetMs: 0 })).not.toThrow()
    expect(() => generateStarBattle({ n: MAX_STAR_SIDE, seed: 1, difficulty: 'challenging' }, { timeBudgetMs: 0 })).not.toThrow()
    expect(() => generateStarBattle({ n: MIN_STAR_SIDE - 1, seed: 1, difficulty: 'challenging' })).toThrow(RangeError)
    expect(() => generateStarBattle({ n: MAX_STAR_SIDE + 1, seed: 1, difficulty: 'challenging' })).toThrow(RangeError)
  }, 30_000)
})
