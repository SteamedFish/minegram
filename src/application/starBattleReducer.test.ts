/**
 * Behaviour tests for the Star Battle play reducer, mirroring the contract
 * pinned in `src/application/gameReducer.test.ts`: correct marks lock, locked
 * cells refuse silently, re-assertion is free, wrong marks cost exactly one
 * point without locking, score clamps at zero and zero loses, the win gate
 * runs after the batch, and an all-inert batch returns the identical state.
 */
import { describe, expect, it } from 'vitest'
import { STAR_BLANK, STAR_LOCKED, STAR_STAR, STAR_UNMARKED, type StarBattlePuzzle } from '../domain/starBattle'
import {
  createInitialStarBattleState,
  previewStarMarkBatch,
  roundIsComplete,
  starBattleReducer,
  type StarBattleState,
} from './starBattleReducer'

// n = 4, stars at (0,1), (1,3), (2,0), (3,2) — the star cells carry distinct
// colours 0,1,2,3, so the fixture passes full puzzle validation.
const solution = [1, 3, 0, 2]
const colours = new Uint8Array([
  0, 0, 1, 2, //
  1, 2, 3, 1, //
  2, 3, 0, 3, //
  3, 0, 3, 1,
])
const puzzle: StarBattlePuzzle = { n: 4, seed: 7, colours, solution }

const at = (row: number, column: number): number => row * 4 + column

function start(initialScore?: number): StarBattleState {
  const initial = createInitialStarBattleState()
  const result = starBattleReducer(initial, { type: 'round/start', puzzle, initialScore })
  if (result.type !== 'transition') {
    throw new Error(`expected round to start, received ${result.type}: ${result.reason}`)
  }
  return result.state
}

function apply(state: StarBattleState, cells: readonly { index: number; mark: 'blank' | 'star' }[]): StarBattleState {
  const result = starBattleReducer(state, { type: 'round/markBatch', cells })
  if (result.type !== 'transition') {
    throw new Error(`expected transition, received ${result.type}: ${result.reason}`)
  }
  return result.state
}

/** The batch that completes the round: every cell asserted correctly. */
function fullSolutionBatch(): { index: number; mark: 'blank' | 'star' }[] {
  const cells: { index: number; mark: 'blank' | 'star' }[] = []
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      cells.push({ index: at(row, column), mark: solution[row] === column ? 'star' : 'blank' })
    }
  }
  return cells
}

/** Asserts a batch is ignored for `reason` and returns the identical state. */
function expectIgnored(
  state: StarBattleState,
  cells: readonly { index: number; mark: 'blank' | 'star' }[],
  reason: string,
): void {
  const result = starBattleReducer(state, { type: 'round/markBatch', cells })
  if (result.type !== 'ignored') {
    throw new Error(`expected ignored, received ${result.type}`)
  }
  expect(result.reason).toBe(reason)
  expect(result.state).toBe(state)
}

describe('createInitialStarBattleState and round/start', () => {
  it('creates frozen idle state with the default score', () => {
    const state = createInitialStarBattleState()
    expect(state.status).toBe('idle')
    expect(state.score).toBe(5)
    expect(state.puzzle).toBeNull()
    expect(state.mistakes).toBe(0)
    expect(state.streak).toBe(0)
    expect(Object.isFrozen(state)).toBe(true)
  })

  it('starts a round with unmarked cells and resets score, mistakes and streak', () => {
    const state = start(9)
    expect(state.status).toBe('playing')
    expect(state.score).toBe(9)
    expect(state.marks.length).toBe(16)
    expect(Array.from(state.marks)).toEqual(Array.from({ length: 16 }, () => STAR_UNMARKED))
    expect(Object.isFrozen(state)).toBe(true)
  })

  it('rejects an invalid puzzle and refuses to start over a playing round', () => {
    const bad = starBattleReducer(createInitialStarBattleState(), {
      type: 'round/start',
      puzzle: { ...puzzle, solution: [1, 1, 1, 1] },
    })
    if (bad.type !== 'rejected') {
      throw new Error(`expected rejected, received ${bad.type}`)
    }
    expect(bad.reason).toBe('invalid-puzzle')
    const over = starBattleReducer(start(), { type: 'round/start', puzzle })
    if (over.type !== 'ignored') {
      throw new Error(`expected ignored, received ${over.type}`)
    }
    expect(over.reason).toBe('round-not-startable')
  })
})

describe('marking contract', () => {
  it('locks a correct mark and counts it as a streak point', () => {
    const state = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    expect(state.marks[at(0, 1)]).toBe(STAR_LOCKED)
    expect(state.streak).toBe(1)
    expect(state.score).toBe(5)
    expect(state.mistakes).toBe(0)
  })

  it('refuses a later assertion on a locked cell, silently and for free', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    expectIgnored(locked, [{ index: at(0, 1), mark: 'blank' }], 'locked-cell')
  })

  it('re-asserting the mark a cell already carries is free and changes nothing', () => {
    const wrong = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(wrong.score).toBe(4)
    expectIgnored(wrong, [{ index: at(0, 0), mark: 'star' }], 'cell-already-marked')
  })

  it('a wrong star costs exactly one point, does not lock, and resets the streak', () => {
    const warmed = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    expect(warmed.streak).toBe(1)
    const state = apply(warmed, [{ index: at(0, 0), mark: 'star' }])
    expect(state.score).toBe(4)
    expect(state.mistakes).toBe(1)
    expect(state.streak).toBe(0)
    expect(state.marks[at(0, 0)]).toBe(STAR_STAR)
    expect(state.marks[at(0, 0)]).not.toBe(STAR_LOCKED)
  })

  it('correcting a wrong mark costs nothing extra and does not refund', () => {
    const wrong = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(wrong.score).toBe(4)
    const fixed = apply(wrong, [{ index: at(0, 0), mark: 'blank' }])
    expect(fixed.score).toBe(4)
    expect(fixed.mistakes).toBe(1)
    expect(fixed.marks[at(0, 0)]).toBe(STAR_LOCKED)
  })

  it('a wrong blank on a star cell is charged like a wrong star', () => {
    const state = apply(start(), [{ index: at(2, 0), mark: 'blank' }])
    expect(state.score).toBe(4)
    expect(state.mistakes).toBe(1)
    expect(state.marks[at(2, 0)]).toBe(STAR_BLANK)
  })
})

describe('score and win/loss', () => {
  it('clamps the score at zero and zero loses the round', () => {
    let state = start(1)
    state = apply(state, [{ index: at(0, 0), mark: 'star' }])
    expect(state.status).toBe('lost')
    expect(state.score).toBe(0)
    // A lost round accepts no further marks.
    const result = starBattleReducer(state, {
      type: 'round/markBatch',
      cells: [{ index: at(0, 2), mark: 'blank' }],
    })
    if (result.type !== 'rejected') {
      throw new Error(`expected rejected, received ${result.type}`)
    }
    expect(result.reason).toBe('round-not-playing')
  })

  it('a wrong mark never coexists with a win', () => {
    // Every star placed correctly, but one star cell is wrongly blanked.
    const cells = fullSolutionBatch().map((cell) =>
      cell.index === at(1, 3) ? { index: cell.index, mark: 'blank' as const } : cell,
    )
    const state = apply(start(), cells)
    expect(state.status).toBe('playing')
    expect(roundIsComplete(puzzle, state.marks)).toBe(false)
  })

  it('win requires every cell correct and is checked after the batch commits', () => {
    const state = apply(start(), fullSolutionBatch())
    expect(state.status).toBe('won')
    expect(state.marks.every((mark) => mark === STAR_LOCKED)).toBe(true)
    expect(roundIsComplete(puzzle, state.marks)).toBe(true)
  })

  it('a batch that includes the last correct cells wins in a single commit', () => {
    // Lock everything except the last row, then finish it in one batch: the
    // win gate must see the committed marks, or the locked board soft-locks.
    const first = fullSolutionBatch().filter((cell) => Math.floor(cell.index / 4) < 3)
    const rest = fullSolutionBatch().filter((cell) => Math.floor(cell.index / 4) === 3)
    const state = apply(apply(start(), first), rest)
    expect(state.status).toBe('won')
  })
})

describe('batch structure', () => {
  it('an all-locked batch reports affectedCount 0 and returns the identical state', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    const cells = [{ index: at(0, 1), mark: 'star' as const }]
    const preview = previewStarMarkBatch(locked, cells)
    expect(preview.valid).toBe(true)
    expect(preview.affectedCount).toBe(0)
    expect(preview.scoreCost).toBe(0)
    const result = starBattleReducer(locked, { type: 'round/markBatch', cells })
    expect(result.type).toBe('ignored')
    expect(result.state).toBe(locked)
  })

  it('a batch painting a run applies each cell at most once', () => {
    const cells = [
      { index: at(0, 1), mark: 'star' as const },
      { index: at(0, 1), mark: 'star' as const },
      { index: at(0, 1), mark: 'star' as const },
    ]
    const preview = previewStarMarkBatch(start(), cells)
    expect(preview.affectedCount).toBe(1)
    const state = apply(start(), cells)
    expect(state.streak).toBe(1)
    expect(state.score).toBe(5)
  })

  it('rejects conflicting assertions for the same cell', () => {
    const result = starBattleReducer(start(), {
      type: 'round/markBatch',
      cells: [
        { index: at(0, 0), mark: 'star' },
        { index: at(0, 0), mark: 'blank' },
      ],
    })
    if (result.type !== 'rejected') {
      throw new Error(`expected rejected, received ${result.type}`)
    }
    expect(result.reason).toBe('conflicting-assertions')
  })

  it('rejects malformed batches, cells and marks without touching state', () => {
    const state = start()
    const cases: { cells: unknown; reason: string }[] = [
      { cells: 'not-an-array', reason: 'invalid-batch' },
      { cells: [{ index: -1, mark: 'star' }], reason: 'invalid-cell-index' },
      { cells: [{ index: 16, mark: 'star' }], reason: 'invalid-cell-index' },
      { cells: [{ index: 0, mark: 'mine' }], reason: 'invalid-cell-mark' },
      { cells: [{ index: 0 }], reason: 'invalid-batch' },
    ]
    for (const { cells, reason } of cases) {
      const result = starBattleReducer(state, { type: 'round/markBatch', cells: cells as never })
      expect(result.type).toBe('rejected')
      if (result.type === 'rejected') {
        expect(result.reason).toBe(reason)
      }
      expect(result.state).toBe(state)
    }
    const idle = createInitialStarBattleState()
    const notPlaying = starBattleReducer(idle, { type: 'round/markBatch', cells: [] })
    expect(notPlaying.type).toBe('rejected')
    if (notPlaying.type === 'rejected') {
      expect(notPlaying.reason).toBe('round-not-playing')
    }
  })
})

describe('previewStarMarkBatch', () => {
  it('previews the score cost of a drag before commit without mutating state', () => {
    const state = start()
    const cells = [
      { index: at(0, 1), mark: 'star' as const }, // correct
      { index: at(0, 0), mark: 'star' as const }, // wrong
      { index: at(0, 2), mark: 'star' as const }, // wrong
    ]
    const preview = previewStarMarkBatch(state, cells)
    expect(preview).toEqual({
      valid: true,
      affectedCount: 3,
      scoreCost: 2,
      projectedScore: 3,
      reachesZero: false,
    })
    expect(state.score).toBe(5)
    expect(Array.from(state.marks)).toEqual(Array.from({ length: 16 }, () => STAR_UNMARKED))
  })

  it('reports reachesZero when the drag would drain the score', () => {
    const state = start(2)
    const preview = previewStarMarkBatch(state, [
      { index: at(0, 0), mark: 'star' },
      { index: at(0, 2), mark: 'star' },
    ])
    expect(preview.reachesZero).toBe(true)
    expect(preview.projectedScore).toBe(0)
  })

  it('skips locked and identical cells, matching the commit path', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    const wrong = apply(locked, [{ index: at(0, 0), mark: 'star' }])
    const preview = previewStarMarkBatch(wrong, [
      { index: at(0, 1), mark: 'star' }, // locked: skipped
      { index: at(0, 0), mark: 'star' }, // identical: free
      { index: at(0, 3), mark: 'star' }, // wrong: costs one
    ])
    expect(preview.affectedCount).toBe(1)
    expect(preview.scoreCost).toBe(1)
    expect(preview.projectedScore).toBe(3)
  })
})
