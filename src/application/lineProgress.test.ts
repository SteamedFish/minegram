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

    // A run reads as located as soon as its own mines are marked, whatever its gaps
    // say. That is the rule the player was given, and it is the rule the auto-reveal
    // already uses for a whole line before the game fills that line's gaps itself.
    //
    // This case asserted `false` for the second run and was what kept the stricter
    // rule alive: a run stayed dark until the gap *before* it was also marked blank,
    // so a player who marks mines — which is the whole interaction — saw only the
    // first segment of a line light up. The line is still not complete, because the
    // gaps are unmarked, and the two claims are not the same one.
    const gapsUnmarked = deriveLineProgress({
      lineLength: 6,
      clue: [2, 1],
      marks: [MINE, MINE, UNKNOWN, UNKNOWN, MINE, BLANK],
      solution: [1, 1, 0, 0, 1, 0],
    })
    expect(gapsUnmarked.runs[0].complete).toBe(true)
    expect(gapsUnmarked.runs[1].complete).toBe(true)
    expect(gapsUnmarked.fullyLabeled).toBe(false)
    expect(gapsUnmarked.complete).toBe(false)
  })

  it('highlights every located run of a line whose last run is still open', () => {
    // The report this fixes, verbatim as a fixture. A `7 2 2 1` column on a 15-cell
    // board is the *minimum* length that clue can occupy (7+1+2+1+2+1+1), so the
    // layout is forced and every start is provable — and the player had still seen
    // only the `7` lit, because the two `2`s each sat behind a gap they had not
    // marked. Marking the three finished segments and nothing else must light all
    // three, and leave the trailing `1` open.
    const solution = [1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1] as const
    const marks = solution.map((cell, index) =>
      index === 14 ? UNKNOWN : cell === 1 ? MINE : UNKNOWN,
    )
    const progress = deriveLineProgress({
      lineLength: 15,
      clue: [7, 2, 2, 1],
      marks,
      solution,
    })
    // The clue fills the line exactly, so there is one legal placement and no
    // separator is ever in doubt.
    expect(progress.compatiblePatternCount).toBe(1)
    expect(progress.runs.map((run) => run.mineIndices)).toEqual([
      [0, 1, 2, 3, 4, 5, 6],
      [8, 9],
      [11, 12],
      [14],
    ])
    expect(progress.runs.map((run) => run.complete)).toEqual([true, true, true, false])
    expect(progress.complete).toBe(false)

    // Marking the last mine completes the line: this is the batch that both reveals
    // it and wins the round, and the run must not have been left dark until now.
    const finished = deriveLineProgress({
      lineLength: 15,
      clue: [7, 2, 2, 1],
      marks: marks.map((mark, index) => (index === 14 ? MINE : mark)),
      solution,
    })
    expect(finished.runs.every((run) => run.complete)).toBe(true)
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

  it('highlights a run whose own mines are marked even while an earlier run still varies', () => {
    // Legal placements (0,3,5) and (1,3,5) both satisfy the explicit marks, so the
    // first run's position is genuinely unknown — the deduction could not prove where
    // it starts. That says nothing about the second run, whose own cell is marked: it
    // is located, so it lights. The old rule made it wait on the first run's ambiguity
    // and on a marked gap, which is the same coupling the `7 2 2 1` case exposed.
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
    // Its window is read off the solution even though the clue cannot fix it, and it is
    // still open because that mine is unmarked.
    expect(progress.runs[0].mineIndices).toEqual([1])
    expect(progress.runs[0].complete).toBe(false)
    expect(progress.runs[1].invariant).toBe(true)
    expect(progress.runs[1].mineIndices).toEqual([3])
    expect(progress.runs[1].complete).toBe(true)
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
