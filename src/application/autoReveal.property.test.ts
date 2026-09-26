import { derivePuzzleClues, type BinaryMineBoard, type MinegramPuzzle } from '../domain'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import {
  countMatchingBoardsReference,
  MAX_REFERENCE_SIDE,
} from '../engine/referenceCounter'
import { solvePuzzle } from '../engine/solver/constraintSolver'
import { describe, expect, it } from 'vitest'
import {
  createInitialGameState,
  gameReducer,
  revealEligibleLines,
  type AutoRevealResult,
  type CellMark,
  type GeneratedRound,
} from './gameReducer'

/**
 * Exhaustive proof of the auto-reveal's safety properties.
 *
 * The unit tests in `gameReducer.test.ts` pin the rule on hand-picked boards.
 * This file removes the choice of board and of mark pattern: it takes boards the
 * exhaustive reference counter certifies as having exactly one solution, then
 * runs the reveal over EVERY mark pattern such a board can be in. Each check
 * below defends one of the hard invariants of the rule:
 *
 *  - P1 "a reveal never writes a wrong mark": every write lands on a cell the
 *    solution calls a blank.
 *  - P2 "a reveal never overwrites and never un-locks": a cell that already
 *    carries any mark keeps it, and a locked cell stays locked.
 *  - P3 "a reveal never charges": the helper has no score in its signature at
 *    all, so it structurally cannot touch one. The reducer-level suite at the
 *    end of this file proves the same property through `gameReducer`, which is
 *    the only layer that owns a score.
 *  - P4 "a reveal is a pure fold and is idempotent": the inputs are never
 *    mutated, and running the reveal again on its own output writes nothing and
 *    returns the identical arrays. This is the machine-checked form of "one pass
 *    over the rows and then the columns is already the fixpoint".
 */

const SIDE = 3
const DIMENSIONS = { rows: SIDE, columns: SIDE } as const
const CELLS = SIDE * SIDE

interface UniqueBoard {
  readonly board: BinaryMineBoard
  readonly puzzle: MinegramPuzzle
  readonly mask: number
}

/**
 * Every `SIDE x SIDE` board whose ordered clues have exactly one solution.
 *
 * `countMatchingBoardsReference` is the exhaustive oracle: it walks all
 * `2 ** CELLS` boards and reports how many match a puzzle's clues. `maxCount: 2`
 * stops it as soon as a second match appears, so `status === 'complete'` with
 * `count === 1` is a real "no other board fits" certificate rather than a
 * truncated search. Uniqueness is then decided independently by `solvePuzzle`,
 * and a board is kept only when the solver's unique solution is that very board.
 */
function uniqueBoards(): UniqueBoard[] {
  expect(SIDE).toBeLessThanOrEqual(MAX_REFERENCE_SIDE)
  const found: UniqueBoard[] = []
  for (let mask = 0; mask < 2 ** CELLS; mask += 1) {
    const board = Array.from({ length: CELLS }, (_, index) => (mask >>> index) & 1) as BinaryMineBoard
    const puzzle: MinegramPuzzle = {
      dimensions: DIMENSIONS,
      clues: derivePuzzleClues(board, DIMENSIONS),
    }
    const counted = countMatchingBoardsReference(puzzle, { maxCount: 2 })
    if (counted.status !== 'complete' || counted.count !== 1) {
      continue
    }
    const solved = solvePuzzle(puzzle)
    if (solved.status !== 'unique' || solved.solution.join('') !== board.join('')) {
      continue
    }
    found.push({ board, puzzle, mask })
  }
  return found
}

/**
 * The only way the reducer ever locks a cell: its mark is correct for the board.
 * A wrong UNLOCKED mark is left unlocked, and it is the interesting input to the
 * eligibility gate, so the sweep has to produce plenty of those.
 */
function lockedFor(board: BinaryMineBoard, marks: readonly CellMark[]): boolean[] {
  return marks.map(
    (mark, index) => mark !== 'unknown' && (mark === 'mine') === (board[index] === 1),
  )
}

function checkReveal(
  label: string,
  board: BinaryMineBoard,
  marks: readonly CellMark[],
  locked: readonly boolean[],
  result: AutoRevealResult,
): void {
  const marksBefore = marks.slice()
  const lockedBefore = locked.slice()
  let changed = 0

  result.marks.forEach((mark, index) => {
    if (mark === marksBefore[index]) {
      return
    }
    changed += 1
    // P1: a write is always 'blank', and always onto a cell the board calls blank.
    expect(`${label}: cell ${index} became ${mark}`).toBe(
      `${label}: cell ${index} became blank`,
    )
    expect(`${label}: wrote a mark onto board cell ${index} = ${board[index]}`).toBe(
      `${label}: wrote a mark onto board cell ${index} = 0`,
    )
    // P2: only an unmarked cell is ever written.
    expect(`${label}: overwrote ${marksBefore[index]} at cell ${index}`).toBe(
      `${label}: overwrote unknown at cell ${index}`,
    )
    // A revealed cell is locked.
    expect(result.locked[index]).toBe(true)
  })

  // P2: a locked cell is never un-locked.
  lockedBefore.forEach((isLocked, index) => {
    if (isLocked) {
      expect(result.locked[index], `${label}: un-locked cell ${index}`).toBe(true)
    }
  })
  expect(result.marks).toHaveLength(marksBefore.length)
  expect(result.locked).toHaveLength(lockedBefore.length)

  // P4: the inputs are untouched, so the fold really is pure.
  expect(marks).toEqual(marksBefore)
  expect(locked).toEqual(lockedBefore)

  // The reported counts must describe the writes that actually happened, and a
  // cell shared by two eligible lines must be counted exactly once.
  const summed = result.lines.reduce((total, line) => total + line.cells, 0)
  expect(`${label}: reported ${summed} cells for ${changed} writes`).toBe(
    `${label}: reported ${changed} cells for ${changed} writes`,
  )

  // P4: a second pass over the output is a fixed point, and an inert pass
  // returns the very same array references.
  const again = revealEligibleLines(board, result.marks, result.locked, SIDE, SIDE)
  expect(again.lines).toEqual([])
  expect(again.marks).toBe(result.marks)
  expect(again.locked).toBe(result.locked)
}

const CERTIFIED_BOARDS = uniqueBoards()
const SWEPT_BOARDS = CERTIFIED_BOARDS.slice(0, 4)
const SWEPT_TERNARY_BOARDS = CERTIFIED_BOARDS.slice(0, 2)

describe('revealEligibleLines is safe on every mark pattern', () => {
  it('certifies several uniquely solvable boards to sweep', () => {
    // Guards the sweeps below: an empty or tiny board list would make every
    // property in this file vacuous.
    expect(SWEPT_BOARDS.length).toBeGreaterThanOrEqual(3)
    expect(SWEPT_TERNARY_BOARDS.length).toBe(2)
  })

  for (const { board, mask } of SWEPT_BOARDS) {
    it(`writes only correct blanks over all 2 ** ${CELLS} mark patterns of board ${mask}`, () => {
      for (let pattern = 0; pattern < 2 ** CELLS; pattern += 1) {
        // Each cell is either unmarked or already carrying the mark the board
        // calls for, which is the 2 ** CELLS sweep the rule is specified over.
        const marks: CellMark[] = Array.from({ length: CELLS }, (_, index) =>
          (pattern >>> index) & 1 ? (board[index] === 1 ? 'mine' : 'blank') : 'unknown',
        )
        const locked = lockedFor(board, marks)
        const result = revealEligibleLines(board, marks, locked, SIDE, SIDE)
        checkReveal(`board ${mask} pattern ${pattern}`, board, marks, locked, result)

        if (
          marks.every(
            (mark, index) => mark !== 'unknown' && (mark === 'mine') === (board[index] === 1),
          )
        ) {
          // A board whose every cell is marked correctly is finished, so the
          // win gate over the post-reveal marks must hold: nothing may be left
          // 'unknown' and nothing may be left unlocked.
          expect(result.marks.every((mark) => mark !== 'unknown')).toBe(true)
          expect(result.locked.every(Boolean)).toBe(true)
        }
      }
    })
  }

  // The 3 ** CELLS sweep costs 19,683 folds per board, so it runs on the first
  // two certified boards only. Every board exercises the same rule, and two
  // boards with different mine placements already vary the only input the gate
  // reads.
  for (const { board, mask } of SWEPT_TERNARY_BOARDS) {
    it(`writes only correct blanks over all 3 ** ${CELLS} mark patterns of board ${mask}, wrong marks included`, () => {
      for (let pattern = 0; pattern < 3 ** CELLS; pattern += 1) {
        const marks: CellMark[] = Array.from({ length: CELLS }, (_, index) => {
          const digit = Math.floor(pattern / 3 ** index) % 3
          return digit === 0 ? 'mine' : digit === 1 ? 'blank' : 'unknown'
        })
        const locked = lockedFor(board, marks)
        const result = revealEligibleLines(board, marks, locked, SIDE, SIDE)
        checkReveal(`board ${mask} ternary ${pattern}`, board, marks, locked, result)

        // A wrong mark disqualifies its whole row and its whole column, so
        // neither may be reported as filled no matter what else is known.
        for (let index = 0; index < CELLS; index += 1) {
          if (marks[index] === 'unknown' || (marks[index] === 'mine') === (board[index] === 1)) {
            continue
          }
          const row = Math.floor(index / SIDE)
          const column = index % SIDE
          expect(
            result.lines.filter(
              (line) =>
                (line.orientation === 'row' && line.index === row) ||
                (line.orientation === 'column' && line.index === column),
            ),
            `board ${mask} ternary ${pattern}: the wrong mark at cell ${index} did not block row ${row} and column ${column}`,
          ).toEqual([])
        }
      }
    })
  }
})

describe('the reducer charges for wrong marks only, never for the auto-reveal', () => {
  const [first] = SWEPT_BOARDS

  it('spends a point per wrong mark and nothing for a revealed cell', () => {
    const settings = normalizeGenerationSettings({
      rows: SIDE,
      columns: SIDE,
      densityPercent: 50,
      seed: 'auto-reveal-property',
      difficulty: 'starter',
      maxAttempts: 3,
    })
    const initial = createInitialGameState({ settings, initialScore: 5 })
    const started = gameReducer(initial, { type: 'generation/start' })
    if (started.type !== 'transition') {
      throw new Error('expected transition')
    }
    const round: GeneratedRound = { settings, board: first.board, puzzle: first.puzzle }
    const accepted = gameReducer(started.state, {
      type: 'generation/succeeded',
      generationId: started.state.generationId,
      round,
    })
    if (accepted.type !== 'transition') {
      throw new Error('expected transition')
    }
    // The accept path must not reveal: a mark-less board satisfies the gate
    // vacuously, so this is where an ungated reveal would hand over the board.
    expect(accepted.state.marks.every((mark) => mark === 'unknown')).toBe(true)
    expect(accepted.autoRevealedCells).toBe(0)

    let revealedCells = 0
    for (let index = 0; index < CELLS; index += 1) {
      for (const assertion of ['mine', 'blank'] as const) {
        const played = gameReducer(accepted.state, {
          type: 'round/markBatch',
          cells: [{ index, assertion }],
        })
        if (played.type !== 'transition') {
          throw new Error(`expected transition, received ${played.type}: ${played.reason}`)
        }
        revealedCells += played.autoRevealedCells
        // The score follows the wrong marks alone, never the revealed cells.
        const wrongMarks = played.state.marks.filter(
          (mark, cell) => mark !== 'unknown' && (mark === 'mine') !== (first.board[cell] === 1),
        ).length
        expect(`${index}:${assertion}:${played.state.score}`).toBe(
          `${index}:${assertion}:${Math.max(0, 5 - wrongMarks)}`,
        )
        // Every cell the reducer locked carries the mark the board calls for,
        // whether the player or the auto-reveal locked it.
        played.state.locked.forEach((isLocked, cell) => {
          if (!isLocked) {
            return
          }
          expect(
            (played.state.marks[cell] === 'mine') === (first.board[cell] === 1),
            `cell ${cell} locked as ${played.state.marks[cell]}`,
          ).toBe(true)
        })
      }
    }
    // The sweep must actually exercise the reveal, or the score check above
    // would pass trivially.
    expect(revealedCells).toBeGreaterThan(0)
  })
})
