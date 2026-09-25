import { describe, expect, it } from 'vitest'
import {
  assertLegalLinePattern,
  getLegalLinePatterns,
  getPatternCell,
  isLegalLinePattern,
} from './patterns'

describe('legal line patterns', () => {
  it('enumerates separator-valid patterns and memoizes by length and clue', () => {
    const first = getLegalLinePatterns(5, [2, 1])
    const second = getLegalLinePatterns(5, [2, 1])
    expect(first).toBe(second)
    expect(first.map((pattern) => [...pattern.cells])).toEqual([
      [0, 1, 1, 0, 1],
      [1, 1, 0, 0, 1],
      [1, 1, 0, 1, 0],
    ])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(first[0])).toBe(true)
  })

  it('maps pattern cells and validates generated patterns against the codec', () => {
    const patterns = getLegalLinePatterns(4, [1, 1])
    expect(patterns).toHaveLength(3)
    for (const pattern of patterns) {
      expect(isLegalLinePattern(4, [1, 1], pattern)).toBe(true)
      expect(() => assertLegalLinePattern(4, [1, 1], pattern)).not.toThrow()
      for (let index = 0; index < 4; index += 1) {
        expect(getPatternCell(pattern, index)).toBe(pattern.cells[index])
      }
      expect(pattern.mineCount).toBe(2)
    }
  })

  it('rejects inconsistent patterns and malformed pattern inputs', () => {
    const pattern = getLegalLinePatterns(3, [1])[0]
    expect(isLegalLinePattern(3, [2], pattern)).toBe(false)
    expect(() => assertLegalLinePattern(3, [2], pattern)).toThrow(/does not match clue/)
    expect(() => getPatternCell(pattern, 3)).toThrow(/between 0 and 2/)
    expect(() => getPatternCell(pattern, -1)).toThrow(/between 0 and 2/)
    expect(() => getPatternCell(null as never, 0)).toThrow(/pattern must contain/)
    expect(() => getLegalLinePatterns(2, [1, 1])).toThrow(/requires at least 3 cells/)
  })
})
