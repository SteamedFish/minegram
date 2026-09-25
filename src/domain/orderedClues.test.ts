import { describe, expect, it } from 'vitest'
import {
  assertOrderedLineClue,
  assertOrderedLineMatchesClue,
  decodeOrderedLineClue,
  encodeOrderedLineClue,
  normalizeOrderedLineClue,
  orderedCluesEqual,
  orderedLineMatchesClue,
  type OrderedLineClue,
} from './orderedClues'

const orderedThreeFiveOne: OrderedLineClue = [3, 5, 1]
const orderedThreeOneFive: OrderedLineClue = [3, 1, 5]

describe('ordered line clue codec', () => {
  it('encodes maximal mine runs in their significant order', () => {
    expect(encodeOrderedLineClue([1, 1, 0, 1, 0, 0, 1])).toEqual([2, 1, 1])
    expect(encodeOrderedLineClue([0, 0, 0])).toEqual([])
    expect(orderedCluesEqual([1, 2], [1, 2])).toBe(true)
    expect(orderedCluesEqual([0, 1, 0], [1])).toBe(true)
    expect(normalizeOrderedLineClue([0, 1, 0, 2])).toEqual([1, 2])
    expect(orderedCluesEqual([1, 2], [2, 1])).toBe(false)
  })

  it('validates public clue normalization and equality without rejecting zero aliases', () => {
    const malformedClues: unknown[] = [
      '1,1',
      [1.5],
      ['1'],
      [-1],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
    ]

    for (const malformedClue of malformedClues) {
      const clue = malformedClue as OrderedLineClue
      expect(() => normalizeOrderedLineClue(clue)).toThrow()
      expect(() => orderedCluesEqual(clue, [1])).toThrow()
      expect(() => orderedCluesEqual([1], clue)).toThrow()
      expect(() => orderedCluesEqual(clue, clue)).toThrow()
    }

    const emptyAlias = normalizeOrderedLineClue([0, 0])
    expect(emptyAlias).toEqual([])
    expect(Object.isFrozen(emptyAlias)).toBe(true)
    expect(normalizeOrderedLineClue([0, 2, 0, 1])).toEqual([2, 1])
    expect(orderedCluesEqual([0, 1, 0], [])).toBe(false)
    expect(orderedCluesEqual([0, 1, 0], [1])).toBe(true)
    expect(orderedCluesEqual([0], [])).toBe(true)
  })

  it('decodes the separator grammar for ordered [3, 5, 1] and [3, 1, 5]', () => {
    expect(decodeOrderedLineClue(11, orderedThreeFiveOne)).toEqual([
      [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1],
    ])
    const threeOneFive = decodeOrderedLineClue(12, orderedThreeOneFive)
    expect(threeOneFive).toHaveLength(4)
    expect(threeOneFive).toContainEqual([1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0])
    expect(
      orderedLineMatchesClue(
        [1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 0],
        12,
        orderedThreeOneFive,
      ),
    ).toBe(true)
    expect(
      orderedLineMatchesClue(
        [1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1],
        12,
        orderedThreeOneFive,
      ),
    ).toBe(false)
  })

  it('enforces at least one blank between internal runs and supports empty lines', () => {
    expect(() => assertOrderedLineClue(5, [2, 1])).not.toThrow()
    expect(() => assertOrderedLineClue(2, [1, 1])).toThrow(/requires at least 3 cells/)
    expect(() => assertOrderedLineClue(5, [1, 1, 1])).not.toThrow()
    expect(decodeOrderedLineClue(4, [])).toEqual([[0, 0, 0, 0]])
    expect(decodeOrderedLineClue(4, [0])).toEqual([[0, 0, 0, 0]])
    expect(decodeOrderedLineClue(3, [1, 0, 1])).toEqual(decodeOrderedLineClue(3, [1, 1]))
  })

  it('rejects malformed run values and clues that cannot fit', () => {
    expect(() => assertOrderedLineClue(5, '1,1')).toThrow(/must be an array/)
    expect(() => assertOrderedLineClue(5, [1, -1])).toThrow(/must be nonnegative/)
    expect(() => assertOrderedLineClue(5, [1, 1.5])).toThrow(/must be a nonnegative safe integer/)
    expect(() => assertOrderedLineClue(5, [3, 3])).toThrow(/requires at least 7 cells/)
    expect(() => assertOrderedLineClue(5, [Number.MAX_SAFE_INTEGER])).toThrow(
      /requires at least/,
    )
  })

  it('validates decoded lines and preserves immutability', () => {
    const decoded = decodeOrderedLineClue(5, [2, 1])
    expect(decoded).toHaveLength(3)
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded[0])).toBe(true)
    expect(() =>
      assertOrderedLineMatchesClue(decoded[0], 5, [2, 1]),
    ).not.toThrow()
    expect(() => assertOrderedLineMatchesClue([0, 0, 0, 0, 0], 5, [2, 1])).toThrow(
      /does not match ordered clue/,
    )
  })
})
