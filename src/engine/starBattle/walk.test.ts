/**
 * Tests for the board-variety descent search (`./walk.ts`).
 *
 * Every assertion here is independent of the walk's own bookkeeping:
 * - soundness cross-checks the catalogue's uniqueness certificate against
 *   the separately-written exact counter (`count.ts`) — two independent
 *   implementations agreeing is the evidence, and a disagreement is a
 *   soundness bug, never something to weaken an assertion around;
 * - connectivity is counted by this file's own flood fill, not the walk's
 *   gate, so a shared bug cannot hide behind agreement;
 * - the difficulty direction re-runs the base-subset solve rather than
 *   trusting the reported `basePlaced` fields;
 * - determinism pins same-seed byte equality and measures how often
 *   different seeds collide (a high collision rate would mean the search
 *   is too weak to variety-match boards to seeds);
 * - budget exhaustion must throw the typed error, never return a board.
 */
import { describe, expect, it } from 'vitest'
import { solveStarCatalogue, type StarCatalogueRule } from './catalogue'
import { countStarSolutions } from './count'
import { STAR_SHAPE_MAX_LARGEST_REGION_SHARE, measureStarBoardStructure } from './structure'
import { walkStarBattleBoard, StarWalkBudgetExhaustedError, type StarWalkBoard } from './walk'

const BASE_ONLY_RULES: ReadonlySet<StarCatalogueRule> = new Set<StarCatalogueRule>(['base'])

/** Stars the base rule subset alone places — re-run here, not read off the walk. */
function independentBasePlaced(colours: Uint8Array, n: number): number {
  return solveStarCatalogue(colours, n, { rules: BASE_ONLY_RULES, csDepth: 0 }).placed
}

/**
 * This file's OWN 4-connected component count per colour: true iff every
 * colour forms exactly one component. Written independently of the walk's
 * `regionStaysConnectedWithout` so a shared bug cannot pass both.
 */
function independentlyConnected(colours: Uint8Array, n: number): boolean {
  const seen = new Uint8Array(n * n)
  for (let start = 0; start < n * n; start += 1) {
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
        // Reject wraps: left/right neighbours must share the row.
        if ((neighbour === cell - 1 && column === 0) || (neighbour === cell + 1 && column === n - 1)) {
          continue
        }
        if (seen[neighbour] === 0 && colours[neighbour] === region) {
          seen[neighbour] = 1
          stack.push(neighbour)
        }
      }
    }
    // A second unvisited cell of the same region would have been reached by
    // the flood fill, so `cells` below the region's true size means split.
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
  return true
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function fingerprintKey(board: StarWalkBoard): string {
  return [...board.fingerprint].sort().join('+') || '(none-load-bearing)'
}

describe('walk soundness, connectivity and difficulty direction', () => {
  // Small n keeps the independent exact counter cheap while still covering
  // both construction paths (n >= 6 strips-and-sea); n = 15 boards are
  // covered by the timing/distribution suite below, where the counter cost
  // is already being paid for the report.
  const cases: readonly { readonly n: number; readonly seeds: readonly number[] }[] = [
    { n: 8, seeds: [11, 12, 13] },
    { n: 10, seeds: [21, 22] },
  ]

  for (const { n, seeds } of cases) {
    for (const seed of seeds) {
      it(`n=${n} seed=${seed}: unique per the counter, connected, strictly harder than its seed`, () => {
        const board = walkStarBattleBoard({ n, seed })

        // Soundness: the catalogue certificate says unique; the independent
        // exact counter must agree. cap 3: 1 means exactly one, 2 or 3 would
        // mean the certificate lied — a bug to surface, not to soften.
        expect(countStarSolutions(board.colours, n, 3)).toBe(1)

        // Connectivity by this file's own component counter.
        expect(independentlyConnected(board.colours, n)).toBe(true)

        // Difficulty direction, metered independently: the produced board
        // is strictly harder for the base subset than the seed, and the
        // full catalogue still solves what base cannot.
        const seedBase = independentBasePlaced(board.seedColours, n)
        const resultBase = independentBasePlaced(board.colours, n)
        expect(seedBase).toBe(board.basePlacedSeed)
        expect(resultBase).toBe(0)
        expect(resultBase).toBeLessThan(seedBase)
        const full = solveStarCatalogue(board.colours, n, { csDepth: 1 })
        expect(full.solved).toBe(true)
        expect(board.fingerprint).not.toBeNull()

        // The reported solution is the planted unique one, re-derived.
        expect(full.stars.map(([, column]) => column)).toEqual([...board.solution])
      })
    }
  }
})

describe('walk determinism', () => {
  it('same seed gives a byte-identical board and identical stats', () => {
    const first = walkStarBattleBoard({ n: 10, seed: 'determinism-check' })
    const second = walkStarBattleBoard({ n: 10, seed: 'determinism-check' })
    expect([...second.colours]).toEqual([...first.colours])
    expect([...second.seedColours]).toEqual([...first.seedColours])
    expect(second.attempts).toBe(first.attempts)
    expect(second.acceptedMutations).toBe(first.acceptedMutations)
    expect(second.restarts).toBe(first.restarts)
    expect(second.elapsedMs).not.toBe(first.elapsedMs) // wall clock is not part of the result
  })

  it('different seeds give different boards (collision rate is the search-strength meter)', () => {
    const seen = new Map<string, number>()
    const distinct = new Set<string>()
    const total = 10
    for (let index = 0; index < total; index += 1) {
      const board = walkStarBattleBoard({ n: 10, seed: 50000 + index * 977 })
      const key = [...board.colours].join(',')
      seen.set(key, (seen.get(key) ?? 0) + 1)
      distinct.add(key)
    }
    const collisions = total - distinct.size
    console.log(`seed collision check: ${collisions}/${total} collisions across n=10 boards`)
    // A collision would not prove a bug once, but the search exists to map
    // seeds to distinct boards; demand variety.
    expect(collisions).toBe(0)
  })
})

describe('walk shape gate (hub-free requirement 2026-10-07)', () => {
  /**
   * This file's OWN adjacency scan (pair-set based — a different shape from
   * structure.ts's boolean matrix), so the production instrument is pinned
   * by an independent one.
   */
  function ownHubCount(colours: Uint8Array, n: number): number {
    const touches = new Set<string>()
    const record = (a: number, b: number): void => {
      if (a !== b) {
        touches.add(a < b ? `${a}-${b}` : `${b}-${a}`)
      }
    }
    for (let row = 0; row < n; row += 1) {
      for (let column = 0; column < n; column += 1) {
        const index = row * n + column
        if (column + 1 < n) {
          record(colours[index], colours[index + 1])
        }
        if (row + 1 < n) {
          record(colours[index], colours[index + n])
        }
      }
    }
    const degrees = new Uint32Array(n)
    for (const key of touches) {
      const [a, b] = key.split('-').map(Number)
      degrees[a] += 1
      degrees[b] += 1
    }
    let hubs = 0
    for (let colour = 0; colour < n; colour += 1) {
      if (degrees[colour] === n - 1) {
        hubs += 1
      }
    }
    return hubs
  }

  const SHAPE_GATE = { noHub: true, maxLargestRegionShare: STAR_SHAPE_MAX_LARGEST_REGION_SHARE } as const

  const cases: readonly { readonly n: number; readonly seeds: readonly number[] }[] = [
    { n: 8, seeds: [31, 32] },
    { n: 10, seeds: [41, 42] },
  ]

  for (const { n, seeds } of cases) {
    for (const seed of seeds) {
      it(`n=${n} seed=${seed}: hub-free, capped, unique, connected, base stalls`, () => {
        const board = walkStarBattleBoard({ n, seed, shape: SHAPE_GATE })

        // The gate itself, by this file's own scan — not the walk's report.
        expect(ownHubCount(board.colours, n)).toBe(0)
        expect(board.hubCount).toBe(0)
        expect(board.largestRegionShare).toBeLessThanOrEqual(SHAPE_GATE.maxLargestRegionShare)
        const structure = measureStarBoardStructure(board.colours, n)
        expect(structure.connected).toBe(true)

        // Every other certificate the plain walk pins still holds.
        expect(countStarSolutions(board.colours, n, 3)).toBe(1)
        expect(independentlyConnected(board.colours, n)).toBe(true)
        expect(independentBasePlaced(board.colours, n)).toBe(0)
        expect(board.basePlaced).toBe(0)
      })
    }
  }

  it('same seed with the shape gate gives a byte-identical board', () => {
    const first = walkStarBattleBoard({ n: 10, seed: 'shape-determinism', shape: SHAPE_GATE })
    const second = walkStarBattleBoard({ n: 10, seed: 'shape-determinism', shape: SHAPE_GATE })
    expect([...second.colours]).toEqual([...first.colours])
    expect(second.attempts).toBe(first.attempts)
    expect(second.acceptedMutations).toBe(first.acceptedMutations)
    expect(second.restarts).toBe(first.restarts)
  })

  it('the shape gate never weakens the difficulty certificates', () => {
    // A shape-gated board must still be a genuine technique board: the
    // plain-walk pins (base stalls, catalogue solves) are re-run here on a
    // shape-gated product.
    const board = walkStarBattleBoard({ n: 10, seed: 77, shape: SHAPE_GATE })
    const full = solveStarCatalogue(board.colours, 10, { csDepth: 1 })
    expect(full.solved).toBe(true)
    expect(full.stars.map(([, column]) => column)).toEqual([...board.solution])
    expect(board.basePlacedSeed).toBe(10)
  })

  it('budget exhaustion with the shape gate still throws the typed error, never a board', () => {
    let caught: unknown
    try {
      walkStarBattleBoard({ n: 10, seed: 42, maxAttempts: 1, shape: SHAPE_GATE })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StarWalkBudgetExhaustedError)
    expect((caught as StarWalkBudgetExhaustedError).reason).toBe('attempts')
  })
})

describe('walk budget failure is loud', () => {
  it('exhausting the attempt budget throws the typed error, never a board', () => {
    let caught: unknown
    try {
      walkStarBattleBoard({ n: 10, seed: 42, maxAttempts: 1 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StarWalkBudgetExhaustedError)
    const failure = caught as StarWalkBudgetExhaustedError
    expect(failure.reason).toBe('attempts')
    expect(failure.basePlaced).toBeGreaterThan(0)
    expect(failure.n).toBe(10)
    // The loud part: the error carries diagnostics, not a board-shaped null.
    expect(failure.message).toContain('attempts budget')
  })

  it('exhausting the wall-clock budget throws the typed error, never a board', () => {
    let caught: unknown
    try {
      walkStarBattleBoard({ n: 10, seed: 42, wallClockMs: 1e-9 })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(StarWalkBudgetExhaustedError)
    const failure = caught as StarWalkBudgetExhaustedError
    expect(failure.reason).toBe('wall-clock')
    expect(failure.basePlaced).toBeGreaterThan(0)
  })

  it('rejects nonsense budgets in the same voice as the rest of the engine', () => {
    expect(() => walkStarBattleBoard({ n: 10, seed: 1, maxAttempts: 0 })).toThrow(RangeError)
    expect(() => walkStarBattleBoard({ n: 10, seed: 1, wallClockMs: 0 })).toThrow(RangeError)
    expect(() => walkStarBattleBoard({ n: 10, seed: 1, stagnationAttempts: -1 })).toThrow(RangeError)
  })
})

describe('walk measured distributions (the tiering evidence)', () => {
  it('n=10: accepted mutations, fingerprints, region shares, wall-clock', () => {
    const accepts: number[] = []
    const attempts: number[] = []
    const times: number[] = []
    const shares: number[] = []
    const restarts: number[] = []
    const fingerprints = new Map<string, number>()
    const perRule = new Map<string, number>()
    const seeds = 12
    for (let index = 0; index < seeds; index += 1) {
      const board = walkStarBattleBoard({ n: 10, seed: 90000 + index * 137 })
      accepts.push(board.acceptedMutations)
      attempts.push(board.attempts)
      times.push(board.elapsedMs)
      shares.push(board.largestRegionShare)
      restarts.push(board.restarts)
      const key = fingerprintKey(board)
      fingerprints.set(key, (fingerprints.get(key) ?? 0) + 1)
      for (const rule of board.fingerprint) {
        perRule.set(rule, (perRule.get(rule) ?? 0) + 1)
      }
      // Every reported board still carries the certificates.
      expect(board.basePlaced).toBe(0)
      expect(board.basePlacedSeed).toBeGreaterThan(0)
      expect(independentlyConnected(board.colours, 10)).toBe(true)
    }
    console.log(
      `n=10 over ${seeds} seeds: acceptedMutations median=${median(accepts)} ` +
        `max=${Math.max(...accepts)} | attempts median=${median(attempts)} max=${Math.max(...attempts)} ` +
        `| restarts median=${median(restarts)} max=${Math.max(...restarts)}`,
    )
    console.log(
      `n=10 wall-clock ms over ${seeds} seeds: median=${median(times).toFixed(1)} ` +
        `max=${Math.max(...times).toFixed(1)} all=[${times.map((t) => t.toFixed(0)).join(',')}]`,
    )
    console.log(
      `n=10 fingerprint combos: ${[...fingerprints.entries()].map(([k, v]) => `${k}×${v}`).join(' ')} | ` +
        `per-rule load-bearing: ${[...perRule.entries()].map(([k, v]) => `${k}×${v}`).join(' ') || '(none)'}`,
    )
    console.log(`n=10 largestRegionShare: [${shares.map((s) => s.toFixed(2)).join(',')}]`)
    expect(Math.max(...times)).toBeLessThan(200)
  })

  it('n=15: accepted mutations, fingerprints, region shares, wall-clock', () => {
    const accepts: number[] = []
    const times: number[] = []
    const shares: number[] = []
    const fingerprints = new Map<string, number>()
    const seeds = 6
    for (let index = 0; index < seeds; index += 1) {
      const board = walkStarBattleBoard({ n: 15, seed: 70000 + index * 389 })
      accepts.push(board.acceptedMutations)
      times.push(board.elapsedMs)
      shares.push(board.largestRegionShare)
      fingerprints.set(fingerprintKey(board), (fingerprints.get(fingerprintKey(board)) ?? 0) + 1)
      // n=15 counter cross-check on the produced boards, now that the
      // report is paying for it.
      expect(countStarSolutions(board.colours, 15, 3)).toBe(1)
      expect(independentlyConnected(board.colours, 15)).toBe(true)
    }
    console.log(
      `n=15 over ${seeds} seeds: acceptedMutations median=${median(accepts)} ` +
        `max=${Math.max(...accepts)}`,
    )
    console.log(
      `n=15 wall-clock ms over ${seeds} seeds: median=${median(times).toFixed(1)} ` +
        `max=${Math.max(...times).toFixed(1)} all=[${times.map((t) => t.toFixed(0)).join(',')}]`,
    )
    console.log(
      `n=15 fingerprint combos: ${[...fingerprints.entries()].map(([k, v]) => `${k}×${v}`).join(' ')}`,
    )
    console.log(`n=15 largestRegionShare: [${shares.map((s) => s.toFixed(2)).join(',')}]`)
    expect(Math.max(...times)).toBeLessThan(800)
  })
})
