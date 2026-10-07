/**
 * Ground-truth validation for the technique-catalogue port
 * (`./catalogue.ts`) against the oracle2 lane's recorded Python
 * fingerprints at `.tmp/oracle2/*.jsonl`.
 *
 * The fixture files are read with `node:fs` and every fixture-derived
 * expectation is asserted against the RECORDED value — if the port ever
 * disagrees with a recording, these tests fail rather than being edited to
 * match the port.
 */
// The project tsconfig restricts global types to vite/client, so 'node:fs'
// has no type resolution here (pulling in global node types would break
// Timeout/number casts in unrelated suites). The import is runtime-only
// (vitest externalises node builtins); suppress the resolution error.
declare const process: { env: Record<string, string | undefined>; cwd(): string }
import { describe, expect, it } from 'vitest'
// @ts-expect-error node:fs resolves at runtime under vitest, not under tsc
import { existsSync, readFileSync } from 'node:fs'
import {
  fingerprintStarCatalogue,
  solveStarCatalogue,
  type StarCatalogueResult,
  type StarCatalogueRule,
} from './catalogue'
import { propagateStarBoard } from './propagate'
import { countStarSolutions, findStarSolutions } from './count'
import { SeededRandomGenerator } from '../rng'

// Minimal path helpers (node:path is deliberately not imported, see above).
const parentDir = (path: string): string => {
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const index = trimmed.lastIndexOf('/')
  return index <= 0 ? '/' : trimmed.slice(0, index)
}

const joinPath = (a: string, b: string): string => `${a.replace(/\/+$/, '')}/${b}`

// The oracle recordings live in the main checkout's `.tmp/oracle2/`
// (untracked, so possibly absent). Walk ancestors of the working directory
// (vitest runs from the project root) until found; override with
// MINEGRAM_ORACLE_DIR. When absent, fixture-backed suites skip loudly
// rather than asserting nothing.
function findOracleDir(): string | null {
  if (process.env.MINEGRAM_ORACLE_DIR) {
    return process.env.MINEGRAM_ORACLE_DIR
  }
  let dir = process.cwd()
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = joinPath(dir, '.tmp/oracle2')
    if (existsSync(joinPath(candidate, 'fixtures.jsonl'))) {
      return candidate
    }
    const parent = parentDir(dir)
    if (parent === dir) {
      break
    }
    dir = parent
  }
  return null
}

const ORACLE_DIR = findOracleDir()

interface FixtureRecord {
  readonly n: number
  readonly tier: string
  readonly seed: number
  readonly waves: number
  readonly colours: readonly number[]
}

interface CsPopulationRecord {
  readonly n: number
  readonly waves: number
  readonly cs_passes: number
  readonly cs_trials: number
  readonly used: readonly string[]
  readonly colours: readonly number[]
}

interface DescentRecord {
  readonly n: number
  readonly colours: readonly number[]
  readonly bases: readonly (readonly string[])[]
}

interface ShowboardRecord {
  readonly label: string
  readonly n: number
  readonly colours: readonly number[]
}

function loadRecords<T>(name: string): T[] {
  if (ORACLE_DIR === null) {
    throw new Error(`oracle recordings not found (set MINEGRAM_ORACLE_DIR)`)
  }
  return readFileSync(joinPath(ORACLE_DIR, name), 'utf8')
    .trim()
    .split('\n')
    .filter((line: string) => line.length > 0)
    .map((line: string) => JSON.parse(line) as T)
}

const fixtures = ORACLE_DIR ? loadRecords<FixtureRecord>('fixtures.jsonl') : []
const csPopulation = ORACLE_DIR ? loadRecords<CsPopulationRecord>('cs_population.jsonl') : []
const descentBoards = ORACLE_DIR ? loadRecords<DescentRecord>('descent_boards.jsonl') : []
const showboards = ORACLE_DIR ? loadRecords<ShowboardRecord>('showboards.jsonl') : []

function toColours(record: { readonly n: number; readonly colours: readonly number[] }): Uint8Array {
  return Uint8Array.from(record.colours)
}

function sortedUsed(result: StarCatalogueResult): string {
  return [...result.used].sort().join(',')
}

/** Deep-equality snapshot of a result, for determinism assertions. */
function snapshotResult(result: StarCatalogueResult): Record<string, unknown> {
  return {
    solved: result.solved,
    waves: result.waves,
    placed: result.placed,
    stars: result.stars.map(([row, col]) => `${row}:${col}`),
    used: sortedUsed(result),
    csPasses: result.csPasses,
    csTrials: result.csTrials,
    stalled: result.stalled,
    marks: [...result.marks],
  }
}

const fullCatalogue = { rules: ['base', 'c1', 'c2', 'c3', 'c4'] as StarCatalogueRule[] }

describe.runIf(ORACLE_DIR !== null)('catalogue vs oracle ground truth', () => {
  it('fixture wave counts: base-only reproduces the recordings AND propagateStarBoard', () => {
    expect(fixtures.length).toBeGreaterThan(0)
    for (const record of fixtures) {
      const colours = toColours(record)
      const mine = solveStarCatalogue(colours, record.n, { rules: ['base'] })
      const production = propagateStarBoard(colours, record.n)
      expect(mine.solved, `n=${record.n} ${record.tier} seed=${record.seed}`).toBe(true)
      expect(mine.waves, `n=${record.n} ${record.tier} seed=${record.seed}`).toBe(record.waves)
      // The catalogue's `base` must be byte-for-byte the production engine.
      expect(production.solved).toBe(true)
      expect(production.waves).toBe(record.waves)
      expect(mine.waves).toBe(production.waves)
      expect(mine.stars).toEqual(production.stars)
    }
  })

  it('showcase boards match the shipping-engine measurements (base-only)', () => {
    const byPrefix = (prefix: string): ShowboardRecord => {
      const record = showboards.find((board) => board.label.startsWith(prefix))
      expect(record, `showboard ${prefix}`).toBeDefined()
      return record as ShowboardRecord
    }
    const solve = (prefix: string): StarCatalogueResult =>
      solveStarCatalogue(toColours(byPrefix(prefix)), byPrefix(prefix).n, { rules: ['base'] })

    // EASY-1 solves in 3 waves.
    expect(solve('EASY-1').solved).toBe(true)
    expect(solve('EASY-1').waves).toBe(3)
    // EASY-2 solves in 19 waves.
    expect(solve('EASY-2').solved).toBe(true)
    expect(solve('EASY-2').waves).toBe(19)
    // MEDIUM-1 / MEDIUM-2 stall placing 0 of 10 stars.
    for (const prefix of ['MEDIUM-1', 'MEDIUM-2']) {
      const result = solve(prefix)
      expect(result.solved).toBe(false)
      expect(result.placed).toBe(0)
    }
    // HARD-1 places 4 of 10 then stalls; HARD-2 places 2 of 10 then stalls.
    const hard1 = solve('HARD-1')
    expect(hard1.solved).toBe(false)
    expect(hard1.placed).toBe(4)
    const hard2 = solve('HARD-2')
    expect(hard2.solved).toBe(false)
    expect(hard2.placed).toBe(2)
  })

  it('cs population: full catalogue solves every rescued board with cs_passes 1 and exact fingerprints', () => {
    expect(csPopulation.length).toBeGreaterThan(0)
    for (const [index, record] of csPopulation.entries()) {
      const label = `cs_population[${index}] n=${record.n}`
      const result = solveStarCatalogue(toColours(record), record.n, {
        ...fullCatalogue,
        csDepth: 1,
        csTrialCap: 400,
      })
      expect(result.solved, label).toBe(true)
      expect(result.csPasses, label).toBe(record.cs_passes)
      expect(result.csPasses, label).toBe(1)
      expect(result.waves, label).toBe(record.waves)
      expect(result.csTrials, label).toBe(record.cs_trials)
      expect(sortedUsed(result), label).toBe([...record.used].sort().join(','))
    }
  })

  it('descent boards: recorded minimal bases solve, and nothing smaller does', () => {
    expect(descentBoards.length).toBeGreaterThan(0)
    for (const [index, record] of descentBoards.entries()) {
      const label = `descent_boards[${index}]`
      const colours = toColours(record)
      // The full confinement catalogue (no case-splitting) must solve.
      expect(solveStarCatalogue(colours, record.n, fullCatalogue).solved, label).toBe(true)
      const minSize = Math.min(...record.bases.map((basis) => basis.length))
      // Base alone is below every recorded minimal basis.
      if (minSize >= 1) {
        expect(
          solveStarCatalogue(colours, record.n, { rules: ['base'] }).solved,
          `${label} base-only`,
        ).toBe(false)
      }
      // Every recorded basis solves, and every strict subset of it does not
      // (minimality), checked one level down.
      for (const basis of record.bases) {
        const rules = ['base', ...basis] as StarCatalogueRule[]
        expect(solveStarCatalogue(colours, record.n, { rules }).solved, `${label} ${basis}`).toBe(
          true,
        )
        for (const rule of basis) {
          const reduced = ['base', ...basis.filter((r) => r !== rule)] as StarCatalogueRule[]
          expect(
            solveStarCatalogue(colours, record.n, { rules: reduced }).solved,
            `${label} ${basis} minus ${rule}`,
          ).toBe(false)
        }
      }
    }
  })

  it('recorded boards honour the colour-count and connectivity invariants', () => {
    const all = [
      ...fixtures.map((record) => ({ n: record.n, colours: record.colours })),
      ...csPopulation.map((record) => ({ n: record.n, colours: record.colours })),
      ...descentBoards.map((record) => ({ n: record.n, colours: record.colours })),
      ...showboards.map((record) => ({ n: record.n, colours: record.colours })),
    ]
    for (const [index, record] of all.entries()) {
      expect(new Set(record.colours).size, `record ${index}`).toBe(record.n)
      // 4-connectivity of every colour region (the construction guarantee).
      for (let colour = 0; colour < record.n; colour += 1) {
        const cells: number[] = []
        record.colours.forEach((c, i) => {
          if (c === colour) {
            cells.push(i)
          }
        })
        const seen = new Set<number>([cells[0]])
        const stack = [cells[0]]
        while (stack.length > 0) {
          const current = stack.pop() as number
          const r = Math.floor(current / record.n)
          const c = current % record.n
          for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const nr = r + dr
            const nc = c + dc
            if (nr < 0 || nr >= record.n || nc < 0 || nc >= record.n) {
              continue
            }
            const next = nr * record.n + nc
            if (record.colours[next] === colour && !seen.has(next)) {
              seen.add(next)
              stack.push(next)
            }
          }
        }
        expect(seen.size, `record ${index} colour ${colour}`).toBe(cells.length)
      }
    }
  })

  it('independent uniqueness cross-check: catalogue certificates agree with countStarSolutions', () => {
    const sample: { n: number; colours: readonly number[] }[] = [
      ...showboards,
      ...[4, 5, 6, 8, 10, 12, 15].flatMap((n) => fixtures.filter((f) => f.n === n).slice(0, 2)),
      ...descentBoards.slice(0, 2),
      ...csPopulation.filter((r) => r.n === 10).slice(0, 1),
      ...csPopulation.filter((r) => r.n === 15).slice(0, 1),
    ]
    expect(sample.length).toBeGreaterThanOrEqual(14)
    for (const [index, record] of sample.entries()) {
      const label = `sample[${index}] n=${record.n}`
      const colours = toColours(record)
      const solved = solveStarCatalogue(colours, record.n, { ...fullCatalogue, csDepth: 1 })
      expect(solved.solved, label).toBe(true)
      // Independent counter (separately implemented module): agreement is
      // real evidence for the catalogue's uniqueness certificate. If this
      // ever disagrees, the port has a soundness bug — surface it, never
      // weaken this assertion.
      expect(countStarSolutions(colours, record.n, 3), label).toBe(1)
    }
  })

  it('fingerprint reports cs as load-bearing exactly when depth-0 fails', () => {
    const record = csPopulation[0]
    const colours = toColours(record)
    const fingerprint = fingerprintStarCatalogue(colours, record.n, { csDepth: 1 })
    expect(fingerprint).not.toBeNull()
    expect(fingerprint?.has('cs')).toBe(true)
    const depth0 = solveStarCatalogue(colours, record.n, fullCatalogue)
    expect(depth0.solved).toBe(false)
  })

  it('every confinement rule fires on at least one recorded board', () => {
    // c1/c2: the recorded minimal bases name each as a singleton basis for
    // some descent board — base+rule alone must solve. c3/c4: the recorded
    // cs-population `used` fingerprints name boards where each fired — a
    // full-catalogue re-solve must reproduce that (no recorded board lists
    // c3 or c4 as a singleton basis, so the stronger check has no ground
    // truth there).
    for (const rule of ['c1', 'c2'] as const) {
      const board = descentBoards.find((record) =>
        record.bases.some((basis) => basis.length === 1 && basis[0] === rule),
      )
      expect(board, `no singleton basis recorded for ${rule}`).toBeDefined()
      const record = board as DescentRecord
      const result = solveStarCatalogue(toColours(record), record.n, {
        rules: ['base', rule],
      })
      expect(result.solved, `base+${rule} alone`).toBe(true)
      expect(result.used.has(rule)).toBe(true)
    }
    for (const rule of ['c3', 'c4'] as const) {
      const board = csPopulation.find((record) => record.used.includes(rule))
      expect(board, `no recorded board used ${rule}`).toBeDefined()
      const record = board as CsPopulationRecord
      const result = solveStarCatalogue(toColours(record), record.n, {
        ...fullCatalogue,
        csDepth: 1,
        csTrialCap: 400,
      })
      expect(result.solved, `board where ${rule} fired`).toBe(true)
      expect(result.used.has(rule)).toBe(true)
    }
  })
})

describe('catalogue determinism and API contracts', () => {
  const boards: { n: number; colours: number[] }[] = [
    { n: 4, colours: [3, 0, 3, 3, 3, 3, 3, 1, 2, 3, 3, 3, 3, 3, 3, 3] },
    { n: 4, colours: [1, 2, 0, 2, 2, 0, 1, 0, 2, 2, 2, 3, 1, 1, 2, 1] },
  ]
  const hard1 = showboards.find((board) => board.label.startsWith('HARD-1'))
  if (hard1) {
    boards.push({ n: hard1.n, colours: [...hard1.colours] })
  }

  it('same input gives identical output across every result field', () => {
    for (const board of boards) {
      const colours = Uint8Array.from(board.colours)
      for (const options of [
        { rules: ['base'] as StarCatalogueRule[] },
        fullCatalogue,
        { ...fullCatalogue, csDepth: 1 as const },
      ]) {
        const first = solveStarCatalogue(colours, board.n, options)
        const second = solveStarCatalogue(colours, board.n, options)
        expect(snapshotResult(second)).toEqual(snapshotResult(first))
      }
    }
  })

  it('a different SeededRandom label changes nothing (no rule consumes randomness)', () => {
    for (const board of boards) {
      const colours = Uint8Array.from(board.colours)
      const a = solveStarCatalogue(colours, board.n, {
        ...fullCatalogue,
        csDepth: 1,
        rng: new SeededRandomGenerator('catalogue-probe-a'),
      })
      const b = solveStarCatalogue(colours, board.n, {
        ...fullCatalogue,
        csDepth: 1,
        rng: new SeededRandomGenerator('catalogue-probe-b'),
      })
      expect(snapshotResult(b)).toEqual(snapshotResult(a))
    }
  })

  it('rejects a case-split depth above the cap of 1', () => {
    const colours = Uint8Array.from(boards[0].colours)
    expect(() =>
      solveStarCatalogue(colours, boards[0].n, { csDepth: 2 as unknown as 0 | 1 }),
    ).toThrow(RangeError)
  })

  it('rejects malformed boards in the same voice as the engine', () => {
    const colours = Uint8Array.from(boards[0].colours)
    expect(() => solveStarCatalogue(colours, 5)).toThrow(RangeError)
    expect(() => solveStarCatalogue(Uint8Array.from([0, 1, 2, 3]), 2)).toThrow(RangeError)
  })
})

describe('catalogue soundness', () => {
  /**
   * Enumerate every solution of a small board and assert the solver only
   * ever wrote cells that are blank in ALL of them. With ≥2 solutions this
   * is the meaningful case: a rule that over-writes a flexible cell is
   * caught here. Boards whose solution count hits the enumeration cap are
   * skipped loudly (never asserted vacuously).
   */
  function assertSound(colours: Uint8Array, n: number, result: StarCatalogueResult): void {
    const solutions = findStarSolutions(colours, n, 2000)
    expect(solutions.length).toBeGreaterThan(0)
    expect(solutions.length).toBeLessThan(2000)
    const starSets = solutions.map((solution) => {
      const set = new Set<number>()
      solution.forEach((column, row) => set.add(row * n + column))
      return set
    })
    for (let index = 0; index < n * n; index += 1) {
      if (result.marks[index] === 1) {
        expect(
          starSets.some((set) => set.has(index)),
          `cell ${index} blanked but starred in a solution`,
        ).toBe(false)
      }
      if (result.marks[index] === 2) {
        expect(
          starSets.some((set) => set.has(index)),
          `cell ${index} starred but blank in every solution`,
        ).toBe(true)
      }
    }
    if (result.solved) {
      const mine = new Set(result.stars.map(([row, col]) => row * n + col))
      expect(starSets.some((set) => set.size === mine.size && [...set].every((i) => mine.has(i)))).toBe(
        true,
      )
    }
  }

  const subsets: StarCatalogueRule[][] = [
    ['base'],
    ['base', 'c1'],
    ['base', 'c2'],
    ['base', 'c3'],
    ['base', 'c4'],
    ['base', 'c1', 'c2', 'c3', 'c4'],
  ]

  it('never writes a cell that some solution stars (seeded random n=4 sweep)', () => {
    const rng = new SeededRandomGenerator(0x5eed)
    let checked = 0
    let attempts = 0
    while (checked < 60 && attempts < 4000) {
      attempts += 1
      const colours = Array.from({ length: 16 }, () => rng.nextInt(4))
      if (new Set(colours).size !== 4) {
        continue
      }
      const board = Uint8Array.from(colours)
      const solutions = findStarSolutions(board, 4, 2000)
      if (solutions.length === 0 || solutions.length >= 2000) {
        continue
      }
      checked += 1
      for (const rules of subsets) {
        assertSound(board, 4, solveStarCatalogue(board, 4, { rules }))
      }
      assertSound(board, 4, solveStarCatalogue(board, 4, { ...fullCatalogue, csDepth: 1 }))
    }
    expect(checked).toBe(60)
  })

  it('never writes a cell that some solution stars (fixture boards n=4..6)', () => {
    for (const record of fixtures.filter((fixture) => fixture.n <= 6)) {
      const colours = toColours(record)
      for (const rules of [
        ...subsets,
        ['base', 'c1', 'c2', 'c3', 'c4', 'cs'] as StarCatalogueRule[],
      ]) {
        assertSound(colours, record.n, solveStarCatalogue(colours, record.n, { rules }))
      }
    }
  })

  it('catches an over-write: naive shadow blanks a solution star, the port does not', () => {
    // n=4 board with unique solution [2,0,3,1] (row 0's star is cell 2).
    // Colour 0 occupies cells {2,5,7}; the common Chebyshev-1 shadow of
    // that unit is {2,6}. A naive shadow rule that blanks every shadow
    // cell INCLUDING the unit's own candidates would blank cell 2 — the
    // actual star — and kill the board. The port's c4 exempts a unit's own
    // candidates precisely to stay sound.
    const n = 4
    const colours = Uint8Array.from([1, 2, 0, 2, 2, 0, 1, 0, 2, 2, 2, 3, 1, 1, 2, 1])
    const naiveShadow = new Set<number>()
    for (const p of [2, 5, 7]) {
      const pr = Math.floor(p / n)
      const pc = p % n
      for (let dr = -1; dr <= 1; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const nr = pr + dr
          const nc = pc + dc
          if (nr >= 0 && nr < n && nc >= 0 && nc < n) {
            const q = nr * n + nc
            if ([2, 5, 7].every((o) => Math.abs(Math.floor(o / n) - nr) <= 1 && Math.abs((o % n) - nc) <= 1)) {
              naiveShadow.add(q)
            }
          }
        }
      }
    }
    // The naive rule WOULD over-write the solution star: the violation is real.
    expect(naiveShadow.has(2)).toBe(true)
    const solutions = findStarSolutions(colours, n, 10)
    expect(solutions).toEqual([[2, 0, 3, 1]])
    // The port does not: it solves the board and never blanks cell 2.
    const result = solveStarCatalogue(colours, n, { rules: ['base', 'c4'] })
    expect(result.solved).toBe(true)
    expect(result.marks[2]).toBe(2)
    expect(result.marks[6]).toBe(1)
  })
})
