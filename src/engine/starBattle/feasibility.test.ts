/**
 * Tests for the tier-feasibility probe (`./feasibility.ts`).
 *
 * The probe measures per-candidate tier acceptance over the SAME stream
 * the generator samples (shared sampler/repair modules, shared tier
 * predicate), so the picker's availability story can never disagree with
 * the generator. The pins here: input validation, the session cache's
 * exactly-once semantics, the unmeasured-before shape of synchronous
 * reads, and one real probe at the minimum side whose assertions stick to
 * what is structurally guaranteed (report shape, samples/hits discipline)
 * plus the measured k = 0 dominance at n = 4.
 *
 * Per-test timeout policy (repo rule): the real-probe test carries an
 * explicit timeout and a cost comment — n = 4 candidates are microseconds
 * to milliseconds each (balance filter generous, repair converges in a
 * few rounds, basis enumeration trivial at that size).
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { MAX_STAR_SIDE, MIN_STAR_SIDE } from '../../domain/starBattle'
import {
  clearStarBattleTierFeasibilityCache,
  measureStarBattleTierFeasibility,
  readStarBattleTierFeasibility,
  type StarTierFeasibilityOptions,
} from './feasibility'
import { STAR_DIFFICULTIES } from './construct'

const FAST: StarTierFeasibilityOptions = {
  seedBase: 99,
  maxWalksPerMeter: 60,
  probeWallClockMsPerMeter: 60_000,
}

beforeEach(() => {
  clearStarBattleTierFeasibilityCache()
})

describe('input validation', () => {
  it('rejects bad sides, tiers and options loudly', async () => {
    expect(() => readStarBattleTierFeasibility(MIN_STAR_SIDE - 1, 'expert')).toThrow(RangeError)
    expect(() => readStarBattleTierFeasibility(MAX_STAR_SIDE + 1, 'expert')).toThrow(RangeError)
    expect(() => readStarBattleTierFeasibility(4, 'absurd' as never)).toThrow(TypeError)
    await expect(measureStarBattleTierFeasibility(4, { maxWalksPerMeter: 0 })).rejects.toThrow(RangeError)
    await expect(measureStarBattleTierFeasibility(4, { probeWallClockMsPerMeter: -1 })).rejects.toThrow(
      RangeError,
    )
  })
})

describe('readStarBattleTierFeasibility', () => {
  it('is unmeasured before the probe resolves and never triggers work', () => {
    const entry = readStarBattleTierFeasibility(MIN_STAR_SIDE, 'expert')
    expect(entry.status).toBe('unmeasured')
    expect(entry.samples).toBe(0)
    expect(entry.hits).toBe(0)
    expect(entry.basis).toBe('measured-generations')
    expect(entry.generationSuccess).toBeNull()
  })
})

describe('measureStarBattleTierFeasibility at the minimum side', () => {
  it('probes every tier from one shared stream and reports honest evidence', async () => {
    // Cost: n = 4 candidates run microseconds–milliseconds each; 60
    // candidates with grading land well under a second. (The wall budget
    // is a backstop, not the expected cost.)
    const report = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    for (const tier of STAR_DIFFICULTIES) {
      const entry = report[tier]
      expect(entry.samples).toBeGreaterThan(0)
      expect(entry.hits).toBeGreaterThanOrEqual(0)
      expect(entry.hits).toBeLessThanOrEqual(entry.samples)
      expect(entry.basis).toBe('measured-generations')
      expect(entry.rate95[0]).toBeLessThanOrEqual(entry.rate95[1])
      expect(entry.rate95[0]).toBeGreaterThanOrEqual(0)
      expect(entry.rate95[1]).toBeLessThanOrEqual(1)
      if (entry.status === 'available' || entry.status === 'unreliable') {
        expect(entry.generationSuccess).not.toBeNull()
        expect(entry.generationSuccess as number).toBeGreaterThan(0)
        expect(entry.generationSuccess as number).toBeLessThanOrEqual(1)
      }
    }
    // Measured dominance at n = 4: uniqueness-among-balanced is ~85%, so
    // the k = 0 pool (starter + steady) is the overwhelming majority of
    // accepted boards and at least one shallow k = 0 board appears in any
    // 60-candidate stream. This is the one tier-availability assertion the
    // test makes — everything else is distribution-dependent and belongs
    // to the measured matrix in the module doc, not a unit pin.
    expect(report.starter.hits).toBeGreaterThan(0)
  }, 120_000)

  it('caches per side: a second call returns the identical report', async () => {
    // Cost: one probe (see above).
    const first = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    const second = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, {
      ...FAST,
      seedBase: 12345, // would differ — and must be ignored while cached
    })
    expect(second).toBe(first)
  }, 120_000)

  it('clearStarBattleTierFeasibilityCache makes the next call probe again', async () => {
    // Cost: two probes (see above).
    const first = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    clearStarBattleTierFeasibilityCache()
    const second = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    expect(second).not.toBe(first)
    expect(second.starter.samples).toBe(first.starter.samples)
  }, 120_000)

  it('readStarBattleTierFeasibility returns the cached entry after the probe', async () => {
    // Cost: one probe (see above).
    const report = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    expect(readStarBattleTierFeasibility(MIN_STAR_SIDE, 'expert')).toBe(report.expert)
    expect(readStarBattleTierFeasibility(MIN_STAR_SIDE, 'challenging')).toBe(report.challenging)
  }, 120_000)

  it('deduplicates concurrent calls into one probe', async () => {
    // Cost: one probe (see above).
    const [first, second] = await Promise.all([
      measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST),
      measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST),
    ])
    expect(first).toBe(second)
  }, 120_000)
})
