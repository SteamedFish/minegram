/**
 * Tests for the counterexample-guided recolouring repair (`./repair.ts`).
 *
 * Repair is the mechanism that makes a mine-balanced sampled layout
 * unique-solution — measured uniqueness-among-balanced is 0% from n = 6 up,
 * so without repair the generator cannot produce a playable board at any
 * played size. The pins here: repair terminates on an exact uniqueness
 * proof (not a budget guess), the planted answer survives as THE unique
 * solution, the structural guarantees (connectivity, one star per region,
 * every colour present) survive every applied move, abandonment is a
 * normal `null` (never a throw), and runs are deterministic per seed.
 *
 * Cost note: n = 6 repairs converge in a handful of guided rounds
 * (measured median 3, ~1 s wall including evaluations); n = 4 layouts are
 * frequently unique before repair runs at all. Every test below stays well
 * under a second except where documented.
 */
import { describe, expect, it } from 'vitest'
import { assertStarBattlePuzzle } from '../../domain/starBattle'
import { createSeededRandom } from '../rng'
import { countStarSolutions, findStarSolutions } from './count'
import { measureStarBoardStructure } from './structure'
import { sampleStarBattleLayout } from './sample'
import { repairStarBattleLayout, type StarRepairResult } from './repair'

/** Asserts the result is non-null and returns it typed accordingly. */
function expectRepaired(result: StarRepairResult | null): StarRepairResult {
  expect(result).not.toBeNull()
  return result as StarRepairResult
}

/** Samples balanced layouts until one passes `predicate`, failing after `cap` tries. */
function findLayout(
  n: number,
  label: string,
  predicate: (layout: NonNullable<ReturnType<typeof sampleStarBattleLayout>>) => boolean,
  cap = 20_000,
): NonNullable<ReturnType<typeof sampleStarBattleLayout>> {
  const rng = createSeededRandom(`repair-${label}`)
  for (let index = 0; index < cap; index += 1) {
    const layout = sampleStarBattleLayout(n, rng.derive(`layout-${index}`))
    if (layout !== null && predicate(layout)) {
      return layout
    }
  }
  throw new Error(`no matching layout found for ${label} after ${cap} samples`)
}

describe('repairStarBattleLayout', () => {
  it('repairs a non-unique balanced layout to exact uniqueness with the planted answer intact', () => {
    // A layout that is NOT already unique: repair must do real work.
    const layout = findLayout(6, 'nonunique', (candidate) => countStarSolutions(candidate.colours, 6, 2) > 1)
    const snapshot = layout.colours.slice()
    const rng = createSeededRandom('repair-rounds')
    const result = expectRepaired(
      repairStarBattleLayout({
        n: 6,
        colours: layout.colours,
        solution: layout.solution,
        rng,
      }),
    )
    // The exact contract: exactly one solution, and it is the planted one.
    expect(countStarSolutions(result.colours, 6, 2)).toBe(1)
    const solutions = findStarSolutions(result.colours, 6, 1)
    expect(solutions).toHaveLength(1)
    expect([...solutions[0]]).toEqual([...layout.solution])
    // Structural guarantees survived the recolouring.
    assertStarBattlePuzzle({ n: 6, seed: 0, colours: result.colours, solution: layout.solution })
    expect(measureStarBoardStructure(result.colours, 6).connected).toBe(true)
    // The request grid was never mutated.
    expect([...layout.colours]).toEqual([...snapshot])
  }, 30_000)

  it('accepts an already-unique layout in zero rounds without touching it', () => {
    const layout = findLayout(4, 'already-unique', (candidate) => countStarSolutions(candidate.colours, 4, 2) === 1)
    const snapshot = layout.colours.slice()
    const result = expectRepaired(
      repairStarBattleLayout({
        n: 4,
        colours: layout.colours,
        solution: layout.solution,
        rng: createSeededRandom('repair-zero'),
      }),
    )
    expect(result.rounds).toBe(0)
    expect([...result.colours]).toEqual([...snapshot])
  }, 15_000)

  it('is deterministic per (layout, solution, seed): same colours, same rounds', () => {
    const layout = findLayout(6, 'determinism', (candidate) => countStarSolutions(candidate.colours, 6, 2) > 1)
    const run = () =>
      repairStarBattleLayout({
        n: 6,
        colours: layout.colours,
        solution: layout.solution,
        rng: createSeededRandom('repair-determinism'),
      })
    const first = expectRepaired(run())
    const second = expectRepaired(run())
    expect([...second.colours]).toEqual([...first.colours])
    expect(second.rounds).toBe(first.rounds)
  }, 30_000)

  it('abandons with null — never throws — when the round budget is zero', () => {
    const layout = findLayout(6, 'abandon', (candidate) => countStarSolutions(candidate.colours, 6, 2) > 1)
    const result = repairStarBattleLayout({
      n: 6,
      colours: layout.colours,
      solution: layout.solution,
      rng: createSeededRandom('repair-abandon'),
      maxRounds: 0,
    })
    expect(result).toBeNull()
  }, 15_000)

  it('abandons with null when the wall-clock budget is already spent', () => {
    const layout = findLayout(6, 'abandon-clock', (candidate) => countStarSolutions(candidate.colours, 6, 2) > 1)
    const result = repairStarBattleLayout({
      n: 6,
      colours: layout.colours,
      solution: layout.solution,
      rng: createSeededRandom('repair-abandon-clock'),
      wallClockMs: 0,
    })
    expect(result).toBeNull()
  }, 15_000)

  it('keeps every colour present and one star per region across a long repair', () => {
    // n = 8 converges in a median of ~18 guided rounds; one run exercises
    // many moves. Cost: a few seconds (documented).
    const layout = findLayout(8, 'long', (candidate) => countStarSolutions(candidate.colours, 8, 2) > 1)
    const result = expectRepaired(
      repairStarBattleLayout({
        n: 8,
        colours: layout.colours,
        solution: layout.solution,
        rng: createSeededRandom('repair-long'),
      }),
    )
    const colours = result.colours
    expect(countStarSolutions(colours, 8, 2)).toBe(1)
    const structure = measureStarBoardStructure(colours, 8)
    expect(structure.connected).toBe(true)
    // One star per region: the planted solution's stars keep pairwise
    // distinct colours (assertStarBattlePuzzle enforces exactly that).
    assertStarBattlePuzzle({ n: 8, seed: 0, colours, solution: layout.solution })
  }, 60_000)

  it('validates its inputs loudly', () => {
    const layout = findLayout(4, 'validation', () => true)
    expect(() =>
      repairStarBattleLayout({
        n: 4,
        colours: new Uint8Array(3),
        solution: layout.solution,
        rng: createSeededRandom(1),
      }),
    ).toThrow(RangeError)
  })
})
