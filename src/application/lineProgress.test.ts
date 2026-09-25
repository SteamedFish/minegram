import { describe, expect, it } from 'vitest'
import { deriveLineProgress } from './lineProgress'

const UNKNOWN = 'unknown' as const
const MINE = 'mine' as const
const BLANK = 'blank' as const

describe('deriveLineProgress', () => {
  it('completes a fully labeled empty line', () => {
    const progress = deriveLineProgress({
      orientation: 'row',
      index: 0,
      lineLength: 3,
      clue: [],
      marks: [BLANK, BLANK, BLANK],
      solution: [0, 0, 0],
    })
    expect(progress.fullyLabeled).toBe(true)
    expect(progress.compatiblePatternCount).toBe(1)
    expect(progress.contradiction).toBe(false)
    expect(progress.status).toBe('ready')
    expect(progress.complete).toBe(true)
    expect(progress.runs).toEqual([])
  })

  it('completes a single run only when its compatible mine positions are explicit', () => {
    const ambiguous = deriveLineProgress({
      lineLength: 4,
      clue: [1],
      marks: [BLANK, UNKNOWN, UNKNOWN, BLANK],
      solution: [0, 0, 0, 0],
    })
    expect(ambiguous.compatiblePatternCount).toBe(2)
    expect(ambiguous.fullyLabeled).toBe(false)
    expect(ambiguous.status).toBe('ready')
    expect(ambiguous.complete).toBe(false)
    expect(ambiguous.runs[0].invariant).toBe(false)
    expect(ambiguous.runs[0].complete).toBe(false)
    expect(ambiguous.runs[0].mineIndices).toEqual([])

    const resolved = deriveLineProgress({
      lineLength: 4,
      clue: [1],
      marks: [MINE, BLANK, BLANK, BLANK],
      solution: [1, 0, 0, 0],
    })
    expect(resolved.runs[0]).toMatchObject({
      invariant: true,
      start: 0,
      end: 0,
      mineIndices: [0],
      complete: true,
    })
  })

  it('tracks multiple ordered runs and explicit correct separators', () => {
    const complete = deriveLineProgress({
      lineLength: 6,
      clue: [2, 1],
      marks: [MINE, MINE, BLANK, BLANK, MINE, BLANK],
      solution: [1, 1, 0, 0, 1, 0],
    })
    expect(complete.fullyLabeled).toBe(true)
    expect(complete.complete).toBe(true)
    expect(complete.runs.map((run) => run.mineIndices)).toEqual([[0, 1], [4]])
    expect(complete.runs.every((run) => run.complete)).toBe(true)

    const missingMine = deriveLineProgress({
      lineLength: 6,
      clue: [2, 1],
      marks: [MINE, MINE, BLANK, BLANK, UNKNOWN, BLANK],
      solution: [1, 1, 0, 0, 1, 0],
    })
    expect(missingMine.complete).toBe(false)
    expect(missingMine.runs[1].complete).toBe(false)

    const missingSeparator = deriveLineProgress({
      lineLength: 6,
      clue: [2, 1],
      marks: [MINE, MINE, UNKNOWN, UNKNOWN, MINE, BLANK],
      solution: [1, 1, 0, 0, 1, 0],
    })
    expect(missingSeparator.runs[0].complete).toBe(true)
    expect(missingSeparator.runs[1].complete).toBe(false)
  })

  it('does not highlight a run while compatible placements leave its position ambiguous', () => {
    const progress = deriveLineProgress({
      lineLength: 4,
      clue: [1],
      marks: [BLANK, UNKNOWN, UNKNOWN, BLANK],
      solution: [0, 0, 0, 0],
    })
    expect(progress.compatiblePatternCount).toBe(2)
    expect(progress.runs[0].invariant).toBe(false)
    expect(progress.runs[0].mineIndices).toEqual([])
    expect(progress.runs[0].complete).toBe(false)
  })

  it('marks a fully labeled contradiction only when there are zero compatible patterns', () => {
    const contradiction = deriveLineProgress({
      lineLength: 3,
      clue: [1],
      marks: [BLANK, BLANK, BLANK],
      solution: [1, 0, 0],
    })
    expect(contradiction.fullyLabeled).toBe(true)
    expect(contradiction.compatiblePatternCount).toBe(0)
    expect(contradiction.contradiction).toBe(true)
    // Enumeration itself succeeded, so the line is ready; "complete" stays false.
    expect(contradiction.status).toBe('ready')
    expect(contradiction.complete).toBe(false)

    const partial = deriveLineProgress({
      lineLength: 3,
      clue: [1],
      marks: [UNKNOWN, MINE, MINE],
    })
    expect(partial.fullyLabeled).toBe(false)
    expect(partial.compatiblePatternCount).toBe(0)
    expect(partial.contradiction).toBe(true)
    expect(partial.status).toBe('ready')
    expect(partial.complete).toBe(false)
  })

  it('does not highlight a run whose preceding run placement still varies around the separator', () => {
    // Legal placements (0,3,5) and (1,3,5) both satisfy the explicit marks, so
    // the second run's separator range is not settled yet. Run 2 stays complete
    // because its own start and the run 1 gap are both invariant.
    const marks = [UNKNOWN, UNKNOWN, BLANK, MINE, BLANK, MINE, BLANK, BLANK] as const
    const solution = [0, 1, 0, 1, 0, 1, 0, 0] as const
    const progress = deriveLineProgress({
      lineLength: 8,
      clue: [1, 1, 1],
      marks,
      solution,
    })
    expect(progress.compatiblePatternCount).toBeGreaterThan(1)
    expect(progress.fullyLabeled).toBe(false)
    expect(progress.complete).toBe(false)
    expect(progress.runs[0].invariant).toBe(false)
    expect(progress.runs[1].invariant).toBe(true)
    expect(progress.runs[1].mineIndices).toEqual([3])
    expect(progress.runs[1].complete).toBe(false)
    expect(progress.runs[2]).toMatchObject({
      invariant: true,
      start: 5,
      mineIndices: [5],
      complete: true,
    })

    const column = deriveLineProgress({
      orientation: 'column',
      index: 4,
      lineLength: 8,
      clue: [1, 1, 1],
      marks,
      solution,
    })
    expect(progress).toEqual({ ...column, orientation: 'row', index: 0 })
  })

  it('maps resource exhaustion to unknown rather than contradiction', () => {
    const progress = deriveLineProgress({
      lineLength: 3,
      clue: [1],
      marks: [UNKNOWN, UNKNOWN, UNKNOWN],
      patternContext: { maxPatternCount: 0 },
    })
    expect(progress.compatiblePatternCount).toBeNull()
    expect(progress.contradiction).toBe(false)
    expect(progress.status).toBe('unknown')
    expect(progress.complete).toBe(false)
    expect(progress.runs.every((run) => !run.complete)).toBe(true)
  })

  it('maps cancellation and other pattern interruptions to unknown', () => {
    const cancelled = deriveLineProgress({
      lineLength: 3,
      clue: [1],
      marks: [UNKNOWN, UNKNOWN, UNKNOWN],
      patternContext: { signal: { aborted: true } },
    })
    expect(cancelled.compatiblePatternCount).toBeNull()
    expect(cancelled.contradiction).toBe(false)

    const interrupted = deriveLineProgress({
      lineLength: 3,
      clue: [1],
      marks: [UNKNOWN, UNKNOWN, UNKNOWN],
      patternContext: { shouldStop: () => 'interrupted' },
    })
    expect(interrupted.status).toBe('unknown')
    expect(interrupted.contradiction).toBe(false)
  })

  it('keeps row and column progress symmetric for a transposed-compatible fixture', () => {
    const row = deriveLineProgress({
      orientation: 'row',
      index: 0,
      lineLength: 3,
      clue: [1, 1],
      marks: [MINE, BLANK, MINE],
      solution: [1, 0, 1],
    })
    const column = deriveLineProgress({
      orientation: 'column',
      index: 0,
      lineLength: 3,
      clue: [1, 1],
      marks: [MINE, BLANK, MINE],
      solution: [1, 0, 1],
    })
    expect(row).toEqual({ ...column, orientation: 'row', index: 0 })
    expect(row.complete).toBe(true)
    expect(row.runs.map((run) => run.mineIndices)).toEqual([[0], [2]])
  })

  it('returns deeply frozen readonly-friendly line data', () => {
    const progress = deriveLineProgress({
      lineLength: 4,
      clue: [1, 1],
      marks: [MINE, BLANK, BLANK, MINE],
      solution: [1, 0, 0, 1],
    })
    expect(Object.isFrozen(progress)).toBe(true)
    expect(Object.isFrozen(progress.clue)).toBe(true)
    expect(Object.isFrozen(progress.runs)).toBe(true)
    expect(Object.isFrozen(progress.runs[0])).toBe(true)
    expect(Object.isFrozen(progress.runs[0].mineIndices)).toBe(true)
  })
})
