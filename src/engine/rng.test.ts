import { describe, expect, it } from 'vitest'
import {
  createSeededRandom,
  deriveRandomSeed,
  normalizeRandomSeed,
  type SeededRandom,
} from './rng'

function takeSequence(random: SeededRandom): number[] {
  return [
    random.nextUint32(),
    random.nextInt(6),
    random.nextInt(17),
    Math.floor(random.nextFloat() * 1000),
    random.nextUint32(),
  ]
}

describe('seeded random generator', () => {
  it('replays exactly from the same seed and restarts from the original state', () => {
    const first = createSeededRandom('phase-1')
    const second = createSeededRandom('phase-1')
    const firstSequence = takeSequence(first)
    expect(takeSequence(second)).toEqual(firstSequence)
    expect(takeSequence(first.restart())).toEqual(firstSequence)
  })

  it('derives independent reproducible streams by label', () => {
    const parent = createSeededRandom(42)
    const childA = parent.derive('rows')
    const childB = parent.derive('columns')
    const replayA = parent.derive('rows')
    expect(takeSequence(childA)).toEqual(takeSequence(replayA))
    expect(takeSequence(childA)).not.toEqual(takeSequence(childB))
    expect(deriveRandomSeed(42, 'rows')).toBe(normalizeRandomSeed(deriveRandomSeed(42, 'rows')))
  })

  it('keeps generated values in range and validates inputs', () => {
    const random = createSeededRandom('range')
    for (let index = 0; index < 100; index += 1) {
      const value = random.nextInt(5)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(5)
      const float = random.nextFloat()
      expect(float).toBeGreaterThanOrEqual(0)
      expect(float).toBeLessThan(1)
    }
    expect(() => createSeededRandom('')).toThrow(/nonempty string/)
    expect(() => createSeededRandom(-1)).toThrow(/nonnegative safe integer/)
    expect(() => random.nextInt(0)).toThrow(/between 1 and/)
    expect(() => random.nextInt(1.5)).toThrow(/between 1 and/)
    expect(() => random.derive('')).toThrow(/label must be a nonempty string/)
  })
})
