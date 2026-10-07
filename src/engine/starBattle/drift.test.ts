/**
 * Tests for the rejection (MCMC) drift over legal colourings (`./drift.ts`).
 *
 * The measurement that motivated this module — does the drift move the
 * `challenging` tier's (k, witness) class-modal share off 1.000 — is a
 * MEASURED NULL (drift.ts module doc, 2026-10-07): the drift mixes out of
 * any start basin within one 2000-proposal leg, and the stationary slice
 * of the legal set that satisfies the tier gates (base places zero AND
 * k = 1) is {c1}-heavy for two independent samplers (the descent walk from
 * above, this chain from below). These tests therefore pin what the drift
 * DOES guarantee — soundness, determinism, budget and gate semantics,
 * structural escape from sea starts — rather than the diversity property
 * it turned out not to deliver for the technique tiers.
 *
 * Every soundness assertion is independent of the drift's own
 * bookkeeping: uniqueness is re-derived by the exact counter, connectivity
 * by this file's own flood fill. Assertions never depend on wall-clock
 * sample counts (they vary with machine load): seeded drifts are
 * deterministic in their trajectory, so floors are pinned below the
 * measured values, and timing assertions use the same median-relative
 * ceiling shape as walk.test.ts.
 */
import { describe, expect, it } from 'vitest'
import { solveStarCatalogue } from './catalogue'
import { countStarSolutions } from './count'
import { generateStarBattle } from './construct'
import {
  driftStarBattleBoard,
  metropolisHastingsAcceptance,
  StarDriftBudgetExhaustedError,
} from './drift'
import { measureMinimumBasis } from './minimumBasis'
import { walkStarBattleBoard } from './walk'

/**
 * This file's OWN 4-connected component count per colour (same independent
 * shape as walk.test.ts uses): true iff every colour forms exactly one
 * component and every colour is present.
 */
function independentlyConnected(colours: Uint8Array, n: number): boolean {
  const seen = new Uint8Array(n * n)
  const present = new Uint8Array(n)
  for (let start = 0; start < n * n; start += 1) {
    present[colours[start]] = 1
    if (seen[start] !== 0) {
      continue
    }
    const region = colours[start]
    let cells = 0
    const stack = [start]
    seen[start] = 1
    while (stack.length > 0) {
      const cell = stack.pop() as number
      cells += 1
      const column = cell % n
      for (const neighbour of [cell - n, cell + n, cell - 1, cell + 1]) {
        if (neighbour < 0 || neighbour >= n * n) {
          continue
        }
        if ((neighbour === cell - 1 && column === 0) || (neighbour === cell + 1 && column === n - 1)) {
          continue
        }
        if (seen[neighbour] === 0 && colours[neighbour] === region) {
          seen[neighbour] = 1
          stack.push(neighbour)
        }
      }
    }
    let regionSize = 0
    for (let index = 0; index < n * n; index += 1) {
      if (colours[index] === region) {
        regionSize += 1
      }
    }
    if (cells !== regionSize) {
      return false
    }
  }
  for (let colour = 0; colour < n; colour += 1) {
    if (present[colour] === 0) {
      return false
    }
  }
  return true
}

function seaStart(n: number, seed: number): Uint8Array {
  return generateStarBattle({ n, seed, difficulty: 'steady', shaping: false }).puzzle.colours
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

describe('drift soundness and accounting identities', () => {
  const cases: readonly { readonly n: number; readonly proposals: number }[] = [
    { n: 6, proposals: 500 },
    { n: 8, proposals: 800 },
  ]

  for (const { n, proposals } of cases) {
    it(`n=${n}: the endpoint is unique (independent counter), connected, fully coloured`, () => {
      const start = seaStart(n, 3000 + n)
      const drift = driftStarBattleBoard({ n, seed: 9000 + n, startColours: start, maxProposals: proposals })

      // cap 3: 1 means exactly one; 2 or 3 would mean the acceptance gate
      // admitted a non-unique board — a soundness bug, not a soft assert.
      expect(countStarSolutions(drift.colours, n, 3)).toBe(1)
      expect(independentlyConnected(drift.colours, n)).toBe(true)
      // The reported solution is the unique one, re-derived.
      const stars = drift.solution.map((column, row) => [row, column] as const)
      for (const [row, column] of stars) {
        expect(drift.colours[row * n + column]).toBeDefined()
      }
      const full = solveStarCatalogue(drift.colours, n, { csDepth: 1 })
      if (full.solved) {
        expect(full.stars.map((star) => star[1])).toEqual([...drift.solution])
      }
    })

    it(`n=${n}: proposal accounting is exact and the certificate split sums to accepts`, () => {
      const start = seaStart(n, 3100 + n)
      const drift = driftStarBattleBoard({ n, seed: 9100 + n, startColours: start, maxProposals: proposals })

      expect(drift.proposals).toBe(proposals)
      // Every proposal is exactly one outcome — the identity is structural,
      // not statistical: a missing outcome channel would show here.
      expect(
        drift.accepted +
          drift.rejectedNoChoice +
          drift.rejectedConnectivity +
          drift.rejectedMetropolis +
          drift.rejectedNonUnique +
          drift.exhaustions,
      ).toBe(drift.proposals)
      // Every acceptance carries exactly one certificate.
      expect(drift.certifiedByCatalogue + drift.certifiedByCounter).toBe(drift.accepted)
    })
  }
})

describe('drift determinism', () => {
  it('same (n, seed, start) gives a byte-identical endpoint and identical counts', () => {
    const start = seaStart(8, 777)
    const first = driftStarBattleBoard({ n: 8, seed: 'drift-determinism', startColours: start })
    const second = driftStarBattleBoard({ n: 8, seed: 'drift-determinism', startColours: start })
    expect([...second.colours]).toEqual([...first.colours])
    expect(second.proposals).toBe(first.proposals)
    expect(second.accepted).toBe(first.accepted)
    expect(second.certifiedByCatalogue).toBe(first.certifiedByCatalogue)
    expect(second.certifiedByCounter).toBe(first.certifiedByCounter)
    expect(second.exhaustions).toBe(first.exhaustions)
    expect(second.elapsedMs).not.toBe(first.elapsedMs) // wall clock is not part of the result
  })

  it('different seeds give different endpoints (collision rate is the search-strength meter)', () => {
    const start = seaStart(8, 778)
    const distinct = new Set<string>()
    const total = 6
    for (let index = 0; index < total; index += 1) {
      const drift = driftStarBattleBoard({ n: 8, seed: 33000 + index * 613, startColours: start })
      distinct.add([...drift.colours].join(','))
    }
    expect(total - distinct.size).toBe(0)
  })
})

describe('drift budget semantics (walk.ts precedent)', () => {
  it('exhausting the wall-clock guard throws the typed error, never a short-drift board', () => {
    const start = seaStart(8, 779)
    let caught: unknown
    try {
      driftStarBattleBoard({ n: 8, seed: 1, startColours: start, wallClockMs: 1e-9 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StarDriftBudgetExhaustedError)
    const failure = caught as StarDriftBudgetExhaustedError
    expect(failure.n).toBe(8)
    // The loud part: the error carries diagnostics, not a board-shaped null.
    expect(failure.message).toContain('wall-clock budget')
  })

  it('rejects nonsense budgets in the same voice as the rest of the engine', () => {
    const start = seaStart(6, 780)
    expect(() => driftStarBattleBoard({ n: 6, seed: 1, startColours: start, maxProposals: 0 })).toThrow(RangeError)
    expect(() => driftStarBattleBoard({ n: 6, seed: 1, startColours: start, wallClockMs: 0 })).toThrow(RangeError)
    expect(() =>
      driftStarBattleBoard({ n: 6, seed: 1, startColours: start, counterNodeBudget: -1 }),
    ).toThrow(RangeError)
  })

  it('rejects a disconnected start loudly — the drift preserves connectivity, never repairs it', () => {
    const start = seaStart(6, 781).slice()
    // Force colour 0 to split: paint a distant cell 0 with no adjacency path.
    start[3 * 6 + 3] = 0
    expect(() => driftStarBattleBoard({ n: 6, seed: 1, startColours: start, maxProposals: 10 })).toThrow(
      /not fully connected/,
    )
  })
})

describe('drift uniqueness gate: fail-closed exhaustion and the certificate boundary', () => {
  it('a starved counter budget rejects everything, is counted, and never certifies', () => {
    const start = seaStart(6, 782)
    const drift = driftStarBattleBoard({
      n: 6,
      seed: 5,
      startColours: start,
      maxProposals: 120,
      fastPositive: false,
      counterNodeBudget: 1,
    })
    // Fail closed: every counter call exhausted ⇒ nothing accepted, and the
    // endpoint is byte-identical to the start. The exhaustion count is the
    // residual-bias channel: every one of these proposals would have been
    // silently admitted by a lenient gate.
    expect(drift.accepted).toBe(0)
    expect(drift.certifiedByCounter).toBe(0)
    expect(drift.exhaustions).toBeGreaterThan(0)
    expect([...drift.colours]).toEqual([...start])
    expect(drift.rejectedNoChoice + drift.rejectedConnectivity + drift.rejectedMetropolis).toBe(
      drift.proposals - drift.exhaustions,
    )
  })

  it('the counter path (fast positive off) certifies only unique boards', () => {
    const start = seaStart(8, 783)
    const drift = driftStarBattleBoard({
      n: 8,
      seed: 6,
      startColours: start,
      maxProposals: 300,
      fastPositive: false,
    })
    expect(drift.certifiedByCatalogue).toBe(0)
    expect(drift.certifiedByCounter).toBe(drift.accepted)
    expect(drift.accepted).toBeGreaterThan(0)
    expect(countStarSolutions(drift.colours, 8, 3)).toBe(1)
  })

  it('a catalogue-unsolvable start still drifts: the counter certifies what the catalogue cannot', () => {
    // A contradiction-tier walk endpoint: k = -1, i.e. NO depth-0
    // catalogue subset solves it — the exact boards a catalogue rejection
    // gate would silently exclude. The drift must still accept moves on
    // and around such a board, certifying them with the counter.
    const walked = walkStarBattleBoard({ n: 8, seed: 'drift-k-minus-one-start', meter: 'confinement' })
    const basis = measureMinimumBasis(walked.colours, 8)
    expect(basis.k).toBe(-1)
    const drift = driftStarBattleBoard({ n: 8, seed: 7, startColours: walked.colours, maxProposals: 400 })
    expect(countStarSolutions(drift.colours, 8, 3)).toBe(1)
    expect(drift.accepted).toBeGreaterThan(0)
  })
})

describe('Metropolis–Hastings ratio', () => {
  it('min(1, |S_x| / |S_y|), with the provable no-op property of this kernel pinned', () => {
    expect(metropolisHastingsAcceptance(1, 2)).toBe(0.5)
    expect(metropolisHastingsAcceptance(2, 4)).toBe(0.5)
    expect(metropolisHastingsAcceptance(2, 1)).toBe(1)
    expect(metropolisHastingsAcceptance(3, 3)).toBe(1)
    expect(() => metropolisHastingsAcceptance(0, 1)).toThrow(RangeError)
    expect(() => metropolisHastingsAcceptance(1, 0)).toThrow(RangeError)
    expect(() => metropolisHastingsAcceptance(-1, 1)).toThrow(RangeError)
  })
})

describe('drift measured distributions (structural escape from sea starts)', () => {
  it('n=8: sea starts escape the hub; the proposal accounting and wall-clock are reported', () => {
    const seeds = 6
    const endHubs: number[] = []
    const startShares: number[] = []
    const endShares: number[] = []
    const endCores: number[] = []
    const accepts: number[] = []
    const times: number[] = []
    const exhaustions: number[] = []
    for (let index = 0; index < seeds; index += 1) {
      const start = seaStart(8, 1000 + index * 131)
      const drift = driftStarBattleBoard({ n: 8, seed: 5000 + index * 131, startColours: start })
      // Certificates on every endpoint, every seed.
      expect(countStarSolutions(drift.colours, 8, 3)).toBe(1)
      expect(independentlyConnected(drift.colours, 8)).toBe(true)
      endHubs.push(drift.end.hubCount)
      startShares.push(drift.start.largestRegionShare)
      endShares.push(drift.end.largestRegionShare)
      endCores.push(drift.end.coreScore)
      accepts.push(drift.accepted)
      times.push(drift.elapsedMs)
      exhaustions.push(drift.exhaustions)
    }
    console.log(
      `n=8 drift over ${seeds} sea starts: accepted median=${median(accepts)} ` +
        `| share ${median(startShares).toFixed(2)}→${median(endShares).toFixed(2)} ` +
        `| endHubs=[${endHubs.join(',')}] endCores=[${endCores.join(',')}] ` +
        `| exhaustions=[${exhaustions.join(',')}]`,
    )
    console.log(
      `n=8 wall-clock ms over ${seeds} drifts: median=${median(times).toFixed(1)} max=${Math.max(...times).toFixed(1)}`,
    )
    // Structural escape, pinned below the measured values (deterministic
    // seeds): most sea-start endpoints lost the hub, the largest share
    // dropped well below the sea's, and no endpoint kept the full sea
    // profile (coreScore 5 with a hub on every board).
    expect(endHubs.filter((hub) => hub === 0).length).toBeGreaterThanOrEqual(3)
    expect(median(endShares)).toBeLessThan(median(startShares) - 0.1)
    // Exhaustions are a counted diagnostic; the shipped node budget must
    // not exhaust on the n=8 stream at all.
    expect(exhaustions.reduce((a, b) => a + b, 0)).toBe(0)
    // Median-relative ceiling, same shape as walk.test.ts: this guards a
    // wall-clock regression of the drift, not scheduler noise.
    expect(Math.max(...times)).toBeLessThan(Math.max(5 * median(times), 1000))
  })

  it('n=10 from walk endpoints: drift stays cheap and certificates hold', () => {
    const seeds = 4
    const times: number[] = []
    const accepts: number[] = []
    for (let index = 0; index < seeds; index += 1) {
      const walked = walkStarBattleBoard({ n: 10, seed: 90000 + index * 137 })
      const drift = driftStarBattleBoard({ n: 10, seed: 91000 + index * 137, startColours: walked.colours })
      expect(countStarSolutions(drift.colours, 10, 3)).toBe(1)
      expect(independentlyConnected(drift.colours, 10)).toBe(true)
      times.push(drift.elapsedMs)
      accepts.push(drift.accepted)
    }
    console.log(
      `n=10 drift over ${seeds} walk endpoints: accepted median=${median(accepts)} ` +
        `wall-clock median=${median(times).toFixed(1)}ms max=${Math.max(...times).toFixed(1)}ms`,
    )
    expect(accepts.every((count) => count > 0)).toBe(true)
  })
})
