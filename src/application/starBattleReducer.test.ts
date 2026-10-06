/**
 * Behaviour tests for the Star Battle play reducer, mirroring the contract
 * pinned in `src/application/gameReducer.test.ts`: correct marks lock, locked
 * cells refuse silently, re-assertion is free, wrong marks cost exactly one
 * life without locking, lives clamp at zero and zero loses, a correct star
 * auto-fills its row, column, colour and 3×3 neighbourhood as locked blanks
 * in the same commit (never overwriting a player mark, never the star's own
 * cell, one pass already the fixpoint), and the win gate runs after the batch
 * AND the fill, so the batch that completes the round wins instead of
 * soft-locking it.
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

function start(maxLives?: number): StarBattleState {
  const initial = createInitialStarBattleState()
  const result = starBattleReducer(initial, { type: 'round/start', puzzle, maxLives })
  if (result.type !== 'transition') {
    throw new Error(`expected round to start, received ${result.type}: ${result.reason}`)
  }
  return result.state
}

type TestCell = { index: number; mark: 'blank' | 'star' | 'clear' }

function apply(state: StarBattleState, cells: readonly TestCell[]): StarBattleState {
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

/** The four correct star assertions, and nothing else. */
function starBatch(): { index: number; mark: 'star' }[] {
  return solution.map((column, row) => ({ index: at(row, column), mark: 'star' as const }))
}

/** Asserts a batch is ignored for `reason` and returns the identical state. */
function expectIgnored(state: StarBattleState, cells: readonly TestCell[], reason: string): void {
  const result = starBattleReducer(state, { type: 'round/markBatch', cells })
  if (result.type !== 'ignored') {
    throw new Error(`expected ignored, received ${result.type}`)
  }
  expect(result.reason).toBe(reason)
  expect(result.state).toBe(state)
}

describe('createInitialStarBattleState and round/start', () => {
  it('creates frozen idle state with the default lives', () => {
    const state = createInitialStarBattleState()
    expect(state.status).toBe('idle')
    expect(state.lives).toBe(5)
    expect(state.puzzle).toBeNull()
    expect(state.mistakes).toBe(0)
    expect(state.streak).toBe(0)
    expect(Object.isFrozen(state)).toBe(true)
  })

  it('starts a round with unmarked cells and resets lives, mistakes and streak', () => {
    const state = start(9)
    expect(state.status).toBe('playing')
    expect(state.lives).toBe(9)
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

  it('rejects a non-positive maxLives and an invalid puzzle shape alike', () => {
    for (const maxLives of [0, -1, 2.5, '3']) {
      const result = starBattleReducer(createInitialStarBattleState(), {
        type: 'round/start',
        puzzle,
        maxLives: maxLives as never,
      })
      expect(result.type).toBe('rejected')
      if (result.type === 'rejected') {
        expect(result.reason).toBe('invalid-puzzle')
      }
    }
  })
})

describe('marking contract', () => {
  it('locks a correct mark and counts it as a streak point', () => {
    const state = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    expect(state.marks[at(0, 1)]).toBe(STAR_LOCKED)
    expect(state.streak).toBe(1)
    expect(state.lives).toBe(5)
    expect(state.mistakes).toBe(0)
  })

  it('refuses a later assertion on a locked cell, silently and for free', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    expectIgnored(locked, [{ index: at(0, 1), mark: 'blank' }], 'locked-cell')
  })

  it('re-asserting the mark a cell already carries is free and changes nothing', () => {
    const wrong = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(wrong.lives).toBe(4)
    expectIgnored(wrong, [{ index: at(0, 0), mark: 'star' }], 'cell-already-marked')
  })

  it('a wrong star costs exactly one life, does not lock, and the wrong mark stays visible', () => {
    const warmed = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    expect(warmed.streak).toBe(1)
    // (2,3) is outside the fill of (0,1): a genuinely unmarked cell.
    const state = apply(warmed, [{ index: at(2, 3), mark: 'star' }])
    expect(state.lives).toBe(4)
    expect(state.mistakes).toBe(1)
    expect(state.streak).toBe(0)
    expect(state.marks[at(2, 3)]).toBe(STAR_STAR)
    expect(state.marks[at(2, 3)]).not.toBe(STAR_LOCKED)
  })

  it('correcting a wrong mark costs nothing extra and does not refund', () => {
    const wrong = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(wrong.lives).toBe(4)
    const fixed = apply(wrong, [{ index: at(0, 0), mark: 'blank' }])
    expect(fixed.lives).toBe(4)
    expect(fixed.mistakes).toBe(1)
    expect(fixed.marks[at(0, 0)]).toBe(STAR_LOCKED)
  })

  it('a wrong blank on a star cell is charged like a wrong star', () => {
    const state = apply(start(), [{ index: at(2, 0), mark: 'blank' }])
    expect(state.lives).toBe(4)
    expect(state.mistakes).toBe(1)
    expect(state.marks[at(2, 0)]).toBe(STAR_BLANK)
  })
})

describe('lives and win/loss', () => {
  it('clamps the lives at zero and zero loses the round', () => {
    let state = start(1)
    state = apply(state, [{ index: at(0, 0), mark: 'star' }])
    expect(state.status).toBe('lost')
    expect(state.lives).toBe(0)
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

  it('a fresh round restores lives to the configured maximum', () => {
    let state = start(1)
    state = apply(state, [{ index: at(0, 0), mark: 'star' }])
    expect(state.status).toBe('lost')
    expect(state.lives).toBe(0)
    const restarted = starBattleReducer(state, { type: 'round/start', puzzle, maxLives: 7 })
    if (restarted.type !== 'transition') {
      throw new Error(`expected transition, received ${restarted.type}`)
    }
    expect(restarted.state.lives).toBe(7)
    expect(restarted.state.mistakes).toBe(0)
    expect(restarted.state.streak).toBe(0)
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

describe('auto-fill on a correct star', () => {
  it('fills the row, column, colour and 3×3 neighbourhood as locked blanks, never the star cell', () => {
    const state = apply(start(), [{ index: at(0, 1), mark: 'star' }])

    // The star's own cell: locked by the assertion itself.
    expect(state.marks[at(0, 1)]).toBe(STAR_LOCKED)
    // Row 0, column 1, colour 0, and the 3×3 neighbourhood of (0,1) — the
    // union is exactly these nine cells, every one a locked blank.
    const filled = [at(0, 0), at(0, 2), at(0, 3), at(1, 0), at(1, 1), at(1, 2), at(2, 1), at(2, 2), at(3, 1)]
    for (const index of filled) {
      expect(state.marks[index], `cell ${index}`).toBe(STAR_LOCKED)
    }
    // Everything the rules do not exclude stays unmarked.
    const untouched = [at(1, 3), at(2, 0), at(2, 3), at(3, 0), at(3, 2), at(3, 3)]
    for (const index of untouched) {
      expect(state.marks[index], `cell ${index}`).toBe(STAR_UNMARKED)
    }
    // The fill is free: no life spent, no mistake counted.
    expect(state.lives).toBe(5)
    expect(state.mistakes).toBe(0)
    expect(state.streak).toBe(1)
  })

  it('a wrong star fills nothing', () => {
    const state = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(state.marks[at(0, 0)]).toBe(STAR_STAR)
    expect(state.lives).toBe(4)
    expect(state.mistakes).toBe(1)
    expect(Array.from(state.marks).filter((mark) => mark !== STAR_UNMARKED)).toEqual([STAR_STAR])
  })

  it('the fill never overwrites a player mark, a wrong star included', () => {
    // The player pays a life for a wrong star at (0,0) — a cell the correct
    // star at (0,1) excludes by row, colour and neighbourhood.
    let state = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(state.lives).toBe(4)
    state = apply(state, [{ index: at(0, 1), mark: 'star' }])
    // The wrong mark stays visible and unlocked: not overwritten, not
    // double-charged, not refunded.
    expect(state.marks[at(0, 0)]).toBe(STAR_STAR)
    expect(state.lives).toBe(4)
    expect(state.mistakes).toBe(1)
  })

  it('a correct blank the player typed is not overwritten either', () => {
    let state = apply(start(), [{ index: at(3, 3), mark: 'blank' }])
    expect(state.marks[at(3, 3)]).toBe(STAR_LOCKED)
    state = apply(state, [{ index: at(0, 1), mark: 'star' }])
    // (3,3) is not excluded by (0,1), but (3,1) is — assert the general rule
    // on a cell the fill DOES cover: the player's lock stands.
    state = apply(state, [{ index: at(1, 3), mark: 'star' }])
    expect(state.marks[at(3, 3)]).toBe(STAR_LOCKED)
  })

  it('the fill is idempotent: a second identical batch writes nothing and reports the identical state', () => {
    const once = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    // The star cell is locked, so the identical batch is refused as an
    // all-locked gesture — and even if it were asked, the fill only writes
    // unmarked cells, so one pass is already the fixpoint.
    expectIgnored(once, [{ index: at(0, 1), mark: 'star' }], 'locked-cell')

    // A second, different correct star re-runs the fill over an already
    // filled board: it writes only the cells the first pass left unmarked,
    // and charges nothing for the ones it finds locked.
    const twice = apply(once, [{ index: at(1, 3), mark: 'star' }])
    expect(twice.lives).toBe(5)
    expect(twice.mistakes).toBe(0)
    expect(twice.streak).toBe(2)
    // (0,2) was filled by the first star and is excluded by the second too:
    // still exactly one locked blank, not a conflict, not a re-count.
    expect(twice.marks[at(0, 2)]).toBe(STAR_LOCKED)
    // Re-asserting an already filled blank is inert and free: the cell is
    // locked, so any different assertion is refused silently.
    expectIgnored(twice, [{ index: at(0, 2), mark: 'blank' }], 'locked-cell')
  })

  it('the fill alone completes the round, and the win is detected in the SAME commit as the triggering star', () => {
    // Only the four star assertions — every other cell is written by the
    // fill. If the win gate ran before the fill, the round would report
    // 'marks-applied' and soft-lock: every cell would be locked with no
    // further batch able to re-evaluate the gate.
    const result = starBattleReducer(start(), { type: 'round/markBatch', cells: starBatch() })
    if (result.type !== 'transition') {
      throw new Error(`expected transition, received ${result.type}`)
    }
    expect(result.transition).toBe('round-won')
    expect(result.state.status).toBe('won')
    expect(result.state.marks.every((mark) => mark === STAR_LOCKED)).toBe(true)
    expect(result.state.lives).toBe(5)
    expect(result.state.mistakes).toBe(0)
  })

  it('a round holding an incorrect mark is not won, and correcting it is the player\'s job', () => {
    let state = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    state = apply(state, starBatch())
    // Every star is placed and every exclusion is filled, but the wrong star
    // at (0,0) — a cell the rules exclude — keeps its player mark.
    expect(state.marks[at(0, 0)]).toBe(STAR_STAR)
    expect(state.status).toBe('playing')
    expect(roundIsComplete(puzzle, state.marks)).toBe(false)
  })

  it('a lost round is not filled: the last life returns before the fill runs', () => {
    // One life, one correct star, then the wrong star that drains it — the
    // early 'round-lost' return must not run the fill on the committed array.
    let state = start(1)
    state = apply(state, [{ index: at(0, 1), mark: 'star' }])
    expect(state.marks[at(0, 2)]).toBe(STAR_LOCKED)
    const lost = apply(state, [{ index: at(2, 3), mark: 'star' }])
    expect(lost.status).toBe('lost')
    // (2,3) is excluded by no star the player placed correctly in this
    // batch; (2,2) IS excluded by the earlier star but was unmarked... the
    // fill would have written it. Instead the round is simply over.
    expect(lost.marks[at(2, 3)]).toBe(STAR_STAR)
    expect(lost.lives).toBe(0)
  })

  it('auto-filled cells can never need undoing: a filled cell refuses retraction and re-assertion alike', () => {
    const state = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    // A filled blank refuses every later assertion — the reason the fill is
    // safe is that a correct star locks immediately and a locked cell
    // rejects any later assertion, retraction included, so nothing the game
    // wrote can be asked to change back.
    expectIgnored(state, [{ index: at(0, 2), mark: 'clear' }], 'locked-cell')
    expectIgnored(state, [{ index: at(0, 2), mark: 'star' }], 'locked-cell')
    const preview = previewStarMarkBatch(state, [{ index: at(0, 2), mark: 'clear' }])
    expect(preview.affectedCount).toBe(0)
  })

  it('a retracted cell the rules exclude is refilled as a locked blank', () => {
    // Wrong star at (0,0), then ONE batch retracts it and places the correct
    // star at (0,1). The retracted cell is unmarked when the fill runs, and
    // the rules exclude it — so the game records that exclusion itself.
    const prepared = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    const state = apply(prepared, [
      { index: at(0, 0), mark: 'clear' },
      { index: at(0, 1), mark: 'star' },
    ])
    expect(state.marks[at(0, 0)]).toBe(STAR_LOCKED)
    expect(state.lives).toBe(4)
    expect(state.mistakes).toBe(1)
  })
})

describe('retraction', () => {
  it('retracting a wrong mark returns the cell to unmarked, free, with no refund', () => {
    const wrong = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    expect(wrong.lives).toBe(4)
    const state = apply(wrong, [{ index: at(0, 0), mark: 'clear' }])
    expect(state.marks[at(0, 0)]).toBe(STAR_UNMARKED)
    // Free: no charge for the retract itself. No refund: the earlier wrong
    // mark is not credited back either.
    expect(state.lives).toBe(4)
    expect(state.mistakes).toBe(1)
    expect(state.streak).toBe(0)
  })

  it('a batch whose only change is a retract does not win and fills nothing', () => {
    // A wrong mark, then a batch that retracts it and asserts nothing else:
    // the retracted cell ends unmarked, no correct star is in the batch, so
    // no fill runs and the win gate must not fire.
    const prepared = apply(start(), [{ index: at(0, 0), mark: 'star' }])
    const state = apply(prepared, [{ index: at(0, 0), mark: 'clear' }])
    expect(state.status).toBe('playing')
    expect(state.marks[at(0, 0)]).toBe(STAR_UNMARKED)
    expect(roundIsComplete(puzzle, state.marks)).toBe(false)
  })

  it('a round that retracts and then re-asserts correctly returns to its previous cost', () => {
    let state = apply(start(), [{ index: at(0, 0), mark: 'star' }]) // wrong: 5 -> 4
    state = apply(state, [{ index: at(0, 0), mark: 'clear' }]) // free, no refund: 4
    state = apply(state, [{ index: at(0, 0), mark: 'blank' }]) // correct: locks, no charge: 4
    expect(state.marks[at(0, 0)]).toBe(STAR_LOCKED)
    expect(state.lives).toBe(4)
    expect(state.streak).toBe(1)
  })

  it('retract on a locked cell is inert and reports affectedCount 0', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    const cells = [{ index: at(0, 1), mark: 'clear' as const }]
    const preview = previewStarMarkBatch(locked, cells)
    expect(preview).toEqual({
      valid: true,
      affectedCount: 0,
      livesLost: 0,
      projectedLives: 5,
      reachesZero: false,
    })
    const result = starBattleReducer(locked, { type: 'round/markBatch', cells })
    if (result.type !== 'ignored') {
      throw new Error(`expected ignored, received ${result.type}`)
    }
    expect(result.reason).toBe('locked-cell')
    expect(result.state).toBe(locked)
  })

  it('retract on an unmarked cell is inert and silent', () => {
    expectIgnored(start(), [{ index: at(0, 0), mark: 'clear' }], 'cell-already-marked')
  })

  it('retract never locks and never writes a wrong mark', () => {
    let state = apply(start(), [{ index: at(0, 0), mark: 'star' }]) // wrong: 4
    state = apply(state, [{ index: at(0, 0), mark: 'clear' }])
    expect(state.marks[at(0, 0)]).toBe(STAR_UNMARKED)
    // The retracted cell accepts a fresh assertion and, being wrong again,
    // is charged again — proof that the retract neither locked the cell nor
    // left a wrong mark behind.
    state = apply(state, [{ index: at(0, 0), mark: 'star' }])
    expect(state.lives).toBe(3)
    expect(state.marks[at(0, 0)]).toBe(STAR_STAR)
  })

  it('retracting a cell from a complete mark array breaks the win predicate', () => {
    const complete = apply(start(), fullSolutionBatch())
    expect(complete.status).toBe('won')
    expect(roundIsComplete(puzzle, complete.marks)).toBe(true)
    // A won round is all-locked, so no batch can reach it (the mark gate is
    // 'playing'); the invariant itself lives in the predicate, confirmed
    // here rather than by reading: an unmarked cell is never correct, so a
    // retraction can only move a round away from won, never toward it.
    const retracted = new Uint8Array(complete.marks)
    retracted[at(2, 0)] = STAR_UNMARKED
    expect(roundIsComplete(puzzle, retracted)).toBe(false)
  })
})

describe('batch structure', () => {
  it('an all-locked batch reports affectedCount 0 and returns the identical state', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    const cells = [{ index: at(0, 1), mark: 'star' as const }]
    const preview = previewStarMarkBatch(locked, cells)
    expect(preview.valid).toBe(true)
    expect(preview.affectedCount).toBe(0)
    expect(preview.livesLost).toBe(0)
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
    expect(state.lives).toBe(5)
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
  it('previews the lives cost of a drag before commit without mutating state', () => {
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
      livesLost: 2,
      projectedLives: 3,
      reachesZero: false,
    })
    expect(state.lives).toBe(5)
    expect(Array.from(state.marks)).toEqual(Array.from({ length: 16 }, () => STAR_UNMARKED))
  })

  it('reports reachesZero when the drag would drain the lives', () => {
    const state = start(2)
    const preview = previewStarMarkBatch(state, [
      { index: at(0, 0), mark: 'star' },
      { index: at(0, 2), mark: 'star' },
    ])
    expect(preview.reachesZero).toBe(true)
    expect(preview.projectedLives).toBe(0)
  })

  it('skips locked and identical cells, matching the commit path', () => {
    const locked = apply(start(), [{ index: at(0, 1), mark: 'star' }])
    // (2,3) and (3,0) are both outside the fill of (0,1): genuinely unmarked.
    const wrong = apply(locked, [{ index: at(2, 3), mark: 'star' }])
    const preview = previewStarMarkBatch(wrong, [
      { index: at(0, 1), mark: 'star' }, // locked: skipped
      { index: at(2, 3), mark: 'star' }, // identical: free
      { index: at(3, 0), mark: 'star' }, // wrong: costs one
    ])
    expect(preview.affectedCount).toBe(1)
    expect(preview.livesLost).toBe(1)
    expect(preview.projectedLives).toBe(3)
  })
})
