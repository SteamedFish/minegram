/**
 * Feasibility query tests. These run REAL probes — walks and generations —
 * but only at small, cheap sides with shrunken budgets, so the file stays
 * fast while exercising the true code path (no mocks: the contract being
 * pinned is that the probe's answer comes out of the same instruments
 * generation uses).
 *
 * Measured anchors the assertions rest on (2026-10-07 probes, this
 * machine; see feasibility.ts module doc):
 * - n = 4: every base-meter walk endpoint is k = 1 (0/1200 k = 2 across a
 *   deep probe), so 'expert' reads `unavailable`; every confinement-meter
 *   walk gives up (0/200 shipped-budget), so 'contradiction' reads
 *   `unavailable`; 'challenging' accepts ~100% of walks.
 * - n = 5: 'expert' accepts ~40% of walks and 'contradiction' ~88% of
 *   walks, so both read `available` quickly under DEFAULT budgets — the
 *   side this file uses to exercise the default-option path end to end.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { MIN_STAR_SIDE, MAX_STAR_SIDE } from '../../domain/starBattle'
import {
  clearStarBattleTierFeasibilityCache,
  measureStarBattleTierFeasibility,
  readStarBattleTierFeasibility,
  type StarTierFeasibilityOptions,
} from './feasibility'

/** Small-side probe budgets: fast in CI, still real walks/generations. */
const FAST: StarTierFeasibilityOptions = {
  maxWalksPerMeter: 12,
  generationSamples: 3,
  probeWallClockMsPerMeter: 2_500,
}

afterEach(() => {
  clearStarBattleTierFeasibilityCache()
})

describe('starBattle feasibility validation', () => {
  it('rejects out-of-range sides and invalid options loudly', async () => {
    expect(() => readStarBattleTierFeasibility(MIN_STAR_SIDE - 1, 'expert')).toThrow(RangeError)
    expect(() => readStarBattleTierFeasibility(MAX_STAR_SIDE + 1, 'expert')).toThrow(RangeError)
    expect(() => readStarBattleTierFeasibility(4, 'absurd' as never)).toThrow(TypeError)
    await expect(
      measureStarBattleTierFeasibility(4, { maxWalksPerMeter: 0 }),
    ).rejects.toThrow(RangeError)
    await expect(
      measureStarBattleTierFeasibility(4, { probeWallClockMsPerMeter: -1 }),
    ).rejects.toThrow(RangeError)
  })
})

describe('starBattle feasibility at n = 4 (measured holes)', () => {
  it('marks expert and contradiction unavailable, challenging and construction available', async () => {
    const report = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)

    expect(report.starter.status).toBe('available')
    expect(report.starter.basis).toBe('construction')
    expect(report.starter.hits).toBe(report.starter.samples)
    expect(report.starter.samples).toBe(FAST.generationSamples)

    expect(report.steady.status).toBe('available')
    expect(report.steady.basis).toBe('construction')

    expect(report.challenging.status).toBe('available')
    expect(report.challenging.hits).toBeGreaterThan(0)
    expect(report.challenging.hits).toBe(report.challenging.samples)
    expect(report.challenging.generationSuccess).toBeGreaterThan(0.9)
    expect(report.challenging.rate95[0]).toBeGreaterThan(0)

    expect(report.expert.status).toBe('unavailable')
    expect(report.expert.hits).toBe(0)
    expect(report.expert.samples).toBeGreaterThan(0)
    expect(report.expert.rate95[0]).toBe(0)
    expect(report.expert.generationSuccess).toBe(0)

    expect(report.contradiction.status).toBe('unavailable')
    expect(report.contradiction.hits).toBe(0)
    // The honest bound: with zero hits the upper end is the only
    // information, and it must sit below the availability bar.
    expect(report.contradiction.rate95[1]).toBeLessThan(1)
  }, 60_000)

  it('is deterministic for identical options across a cache reset', async () => {
    const first = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    clearStarBattleTierFeasibilityCache()
    const second = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    // The count-bound streams (construction generations, base-meter walks:
    // ~10 ms a unit at n = 4, far under the wall budget even under CPU
    // contention) reproduce exactly. The wall-bound confinement stream
    // may sample a different COUNT under load — what must survive is the
    // classification and the zero-hit fact, per the module doc's
    // determinism caveat.
    expect(second.starter).toEqual(first.starter)
    expect(second.steady).toEqual(first.steady)
    expect(second.challenging).toEqual(first.challenging)
    expect(second.expert).toEqual(first.expert)
    expect(second.contradiction.status).toBe(first.contradiction.status)
    expect(second.contradiction.hits).toBe(first.contradiction.hits)
  }, 60_000)

  it('caches per side: a second measure returns the identical report', async () => {
    const first = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    const second = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    expect(second).toBe(first)
  }, 60_000)

  it('readStarBattleTierFeasibility is unmeasured before, identical after', async () => {
    const before = readStarBattleTierFeasibility(MIN_STAR_SIDE, 'expert')
    expect(before.status).toBe('unmeasured')
    expect(before.samples).toBe(0)

    const report = await measureStarBattleTierFeasibility(MIN_STAR_SIDE, FAST)
    expect(readStarBattleTierFeasibility(MIN_STAR_SIDE, 'expert')).toBe(report.expert)
    expect(readStarBattleTierFeasibility(MIN_STAR_SIDE, 'challenging')).toBe(
      report.challenging,
    )
  }, 60_000)
})
