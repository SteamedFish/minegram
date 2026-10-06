import { describe, expect, it } from 'vitest'
import {
  DEFAULT_STAR_SIDE,
  MAX_STAR_SIDE,
  MIN_STAR_SIDE,
  STAR_BLANK,
  STAR_LOCKED,
  STAR_STAR,
  STAR_UNMARKED,
  assertStarBattlePuzzle,
  type StarBattlePuzzle,
} from './starBattle'

const solution = [1, 3, 0, 2]

function fixtureColours(): Uint8Array {
  // Star cells (0,1), (1,3), (2,0), (3,2) carry distinct colours 0,1,2,3.
  return new Uint8Array([
    0, 0, 1, 2, //
    1, 2, 3, 1, //
    2, 3, 0, 3, //
    3, 0, 3, 1,
  ])
}

function fixture(): StarBattlePuzzle {
  return { n: 4, seed: 7, colours: fixtureColours(), solution }
}

describe('star battle domain constants', () => {
  it('pins the mark wire values', () => {
    expect(STAR_UNMARKED).toBe(0)
    expect(STAR_BLANK).toBe(1)
    expect(STAR_STAR).toBe(2)
    expect(STAR_LOCKED).toBe(3)
  })

  it('exposes a defensible side range with the default at 10', () => {
    expect(MIN_STAR_SIDE).toBe(4)
    // 15 is a product ceiling, not a solver one: production acceptance is the
    // propagation certificate, and the palette/grid cover 20 colours. The test
    // pins the VALUE so a future widening is a deliberate, visible change.
    expect(MAX_STAR_SIDE).toBe(15)
    expect(DEFAULT_STAR_SIDE).toBe(10)
    expect(DEFAULT_STAR_SIDE).toBeGreaterThan(MIN_STAR_SIDE)
    expect(DEFAULT_STAR_SIDE).toBeLessThan(MAX_STAR_SIDE)
  })
})

describe('assertStarBattlePuzzle', () => {
  it('accepts a well-formed puzzle at the minimum side', () => {
    expect(() => assertStarBattlePuzzle(fixture())).not.toThrow()
  })

  it('rejects non-objects and wrong sides', () => {
    expect(() => assertStarBattlePuzzle(null)).toThrow(TypeError)
    expect(() => assertStarBattlePuzzle('puzzle')).toThrow(TypeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), n: MIN_STAR_SIDE - 1 })).toThrow(RangeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), n: MAX_STAR_SIDE + 1 })).toThrow(RangeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), n: 4.5 })).toThrow(TypeError)
  })

  it('rejects malformed seeds and colour grids', () => {
    expect(() => assertStarBattlePuzzle({ ...fixture(), seed: 'seed' })).toThrow(TypeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), seed: 1.5 })).toThrow(TypeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), colours: new Uint8Array(15) })).toThrow(RangeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), colours: Array.from(fixtureColours()) })).toThrow(TypeError)
    const outOfRange = fixtureColours()
    outOfRange[0] = 4
    expect(() => assertStarBattlePuzzle({ ...fixture(), colours: outOfRange })).toThrow(RangeError)
  })

  it('rejects malformed solutions', () => {
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: [1, 3, 0] })).toThrow(RangeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: '1302' })).toThrow(TypeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: [1, 3, 0, 9] })).toThrow(TypeError)
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: [1, 1, 0, 2] })).toThrow(RangeError)
  })

  it('rejects stars within Chebyshev distance 1', () => {
    // [1, 2, 0, 3]: rows 0 and 1 have columns 1 and 2 — distance 1.
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: [1, 2, 0, 3] })).toThrow(RangeError)
    // [1, 3, 2, 0]: a valid permutation whose rows 1 and 2 place stars at
    // columns 3 and 2 — Chebyshev distance 1.
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: [1, 3, 2, 0] })).toThrow(RangeError)
  })

  it('rejects stars that share a colour', () => {
    // Same grid, but swap the solution so two stars land on colour 3 cells.
    expect(() => assertStarBattlePuzzle({ ...fixture(), solution: [2, 0, 3, 1] })).toThrow(RangeError)
  })
})
