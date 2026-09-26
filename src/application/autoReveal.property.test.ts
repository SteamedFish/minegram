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
  type GameState,
  type GeneratedRound,
} from './gameReducer'

/**
 * Exhaustive proof of the auto-reveal's properties.
 *
 * The unit tests in `gameReducer.test.ts` pin the rule on hand-picked boards.
 * This file removes the choice of board and of mark pattern: it certifies boards
 * with exactly one solution, keeps the ones the game could actually generate,
 * and then runs the reveal over EVERY mark pattern such a board can be in, over
 * several board FAMILIES rather than one square shape.
 *
 * The properties, each checked below:
 *
 *  - P1 "a reveal never writes a wrong mark": every write lands on a cell the
 *    solution calls a blank.
 *  - P2 "a reveal never overwrites and never un-locks": a cell that already
 *    carries any mark keeps it, and a locked cell stays locked.
 *  - P3 "a reveal never charges": the helper has no score in its signature at
 *    all, so it structurally cannot touch one. The reducer-level suite proves
 *    the same property through `gameReducer`, the only layer that owns a score.
 *  - P4 "a reveal is a pure fold and is idempotent": the inputs are never
 *    mutated, and running the reveal again on its own output writes nothing and
 *    returns the identical arrays. This is the machine-checked form of "one pass
 *    over the rows and then the columns is already the fixpoint".
 *  - P5 "eligibility is decided from the marks as they were at the start of the
 *    pass": the lines a pass reports, and the cell count it attributes to each,
 *    are exactly those derived from the INPUT marks alone. A line the player has
 *    not yet resolved must not be reported just because an earlier write in the
 *    same pass touched it. This is the general form of the 2x2 Oracle finding:
 *    on `board = [1,0,0,1]`, marking index 0 makes COLUMN 0 eligible in the same
 *    pass, so cells 1 and 2 are both revealed and locked, and a later wrong mark
 *    on cell 1 is refused `locked-cell` rather than charged. See
 *    `eligibleLinesFrom` for why the count half of the property is the part that
 *    actually discriminates.
 *  - P6 "a mine-less line is not revealed": a line with no mine satisfies
 *    "every mine marked" vacuously, so without the guard it would be filled for
 *    no reason. Unreachable through the real game, but `revealEligibleLines` is
 *    exported and this file sweeps arbitrary boards.
 *  - P7 "the win check runs AFTER the reveal": for every certified board and
 *    every mark pattern that marks all mines and no blank, the round WINS and
 *    every non-mine cell is `blank` and locked. Checked at the helper level and
 *    again through the real reducer, batch by batch, because the ordering bug
 *    this defends against is a soft-lock rather than a wrong mark.
 */


interface Family {
  readonly name: string
  readonly rows: number
  readonly columns: number
  /** Certified exhaustively by the reference counter, or only by the solver. */
  readonly certifiedBy: 'counter' | 'solver'
  /** How many certified boards take part in the full binary and ternary sweeps. */
  readonly swept: number
  /** Ternary sweep size: `'all'`, or a fixed-seed sample of this many patterns. */
  readonly ternary: 'all' | number
}

/**
 * The board shapes the sweep covers. One square family is not enough: the rule
 * reads a line with a `start`, a `stride` and a `length`, and only a non-square
 * family makes a wrong stride or a swapped row/column count show up.
 *
 *  - `1x8` is the degenerate case: one row of eight cells against eight columns
 *    of one cell each, so the two orientations have wildly different lengths.
 *    It is beyond `MAX_REFERENCE_SIDE` (4), so the solver certifies it.
 *  - `2x2` is the sharpest board in the rule, and the one the Oracle probed.
 *  - `2x5` is the widest non-square family and is also beyond the counter.
 *
 * Sweep sizes are full enumeration wherever the space is small, so the results
 * are exhaustive and reproducible with no sampling. Only `2x5` is sampled, and
 * it is sampled rather than truncated because its ternary space (3 ** 10 =
 * 59,049 per board) is the one family that would blow the budget: a fixed-seed
 * LCG keeps a large sample reproducible run to run, which a truncated range
 * would too but at the cost of only ever covering low pattern indices.
 */
const FAMILIES: readonly Family[] = [
  { name: '1x1', rows: 1, columns: 1, certifiedBy: 'counter', swept: 1, ternary: 'all' },
  { name: '1x8', rows: 1, columns: 8, certifiedBy: 'solver', swept: 1, ternary: 'all' },
  { name: '2x2', rows: 2, columns: 2, certifiedBy: 'counter', swept: 5, ternary: 'all' },
  { name: '2x3', rows: 2, columns: 3, certifiedBy: 'counter', swept: 8, ternary: 'all' },
  { name: '2x5', rows: 2, columns: 5, certifiedBy: 'solver', swept: 6, ternary: 1500 },
  { name: '3x3', rows: 3, columns: 3, certifiedBy: 'counter', swept: 6, ternary: 6000 },
]

interface CertifiedBoard {
  readonly board: BinaryMineBoard
  readonly puzzle: MinegramPuzzle
  readonly mask: number
}

/** Whether the board has at least one mine in every row and every column. */
function hasAMinePerLine(board: BinaryMineBoard, rows: number, columns: number): boolean {
  for (let row = 0; row < rows; row += 1) {
    let found = false
    for (let column = 0; column < columns; column += 1) {
      if (board[row * columns + column] === 1) {
        found = true
      }
    }
    if (!found) {
      return false
    }
  }
  for (let column = 0; column < columns; column += 1) {
    let found = false
    for (let row = 0; row < rows; row += 1) {
      if (board[row * columns + column] === 1) {
        found = true
      }
    }
    if (!found) {
      return false
    }
  }
  return true
}

/**
 * Every board of the family whose ordered clues have exactly one solution.
 *
 * Two oracles, because neither covers every family. `countMatchingBoardsReference`
 * is the exhaustive one: it walks all `2 ** CELLS` boards and reports how many
 * match a puzzle's clues, and `maxCount: 2` stops it as soon as a second match
 * appears, so `status === 'complete'` with `count === 1` is a real "no other
 * board fits" certificate rather than a truncated search. It refuses a side
 * above `MAX_REFERENCE_SIDE`, so the wide families fall back to `solvePuzzle`,
 * whose `'unique'` status is likewise only reachable when the search ran to
 * exhaustion: every budget, node-limit, and cancellation stop returns
 * `'unknown'` (see `constraintSolver.ts:418`). Either way the answer is then
 * cross-checked by `solvePuzzle`, and a board is kept only when the solver's
 * unique solution is that very board.
 */
function certifiedBoards(family: Family): CertifiedBoard[] {
  const { rows, columns } = family
  const cells = rows * columns
  const dimensions = { rows, columns } as const
  if (family.certifiedBy === 'counter') {
    expect(rows).toBeLessThanOrEqual(MAX_REFERENCE_SIDE)
    expect(columns).toBeLessThanOrEqual(MAX_REFERENCE_SIDE)
  }
  const found: CertifiedBoard[] = []
  for (let mask = 0; mask < 2 ** cells; mask += 1) {
    const board = Array.from(
      { length: cells },
      (_, index) => (mask >>> index) & 1,
    ) as BinaryMineBoard
    const puzzle: MinegramPuzzle = {
      dimensions,
      clues: derivePuzzleClues(board, dimensions),
    }
    if (family.certifiedBy === 'counter') {
      const counted = countMatchingBoardsReference(puzzle, { maxCount: 2 })
      if (counted.status !== 'complete' || counted.count !== 1) {
        continue
      }
    }
    const solved = solvePuzzle(puzzle)
    if (solved.status !== 'unique' || solved.solution.join('') !== board.join('')) {
      continue
    }
    found.push({ board, puzzle, mask })
  }
  return found
}

/** A reproducible 32-bit LCG, so a sampled sweep is identical on every run. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state
  }
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

/**
 * P5's oracle, part one: which lines the INPUT marks make eligible.
 *
 * Deliberately an independent restatement of the rule rather than a call into
 * the implementation, so that a regression shows up as a mismatch instead of
 * being mirrored on both sides. It reads nothing but the incoming marks, which
 * is what "eligibility is decided at the start of the pass" means.
 */
function eligibleFromInput(
  board: BinaryMineBoard,
  marks: readonly CellMark[],
  rows: number,
  columns: number,
): Set<string> {
  const eligible = new Set<string>()
  const inspect = (key: string, start: number, stride: number, length: number): void => {
    let mines = 0
    let markedMines = 0
    for (let offset = 0; offset < length; offset += 1) {
      const index = start + offset * stride
      const isMine = board[index] === 1
      if (isMine) {
        mines += 1
      }
      const mark = marks[index]
      if (mark === 'unknown') {
        continue
      }
      if ((mark === 'mine') !== isMine) {
        return
      }
      if (isMine) {
        markedMines += 1
      }
    }
    // A mine-less line confirms nothing, so it is never eligible (P6).
    if (mines > 0 && mines === markedMines) {
      eligible.add(key)
    }
  }
  for (let row = 0; row < rows; row += 1) {
    inspect(`row:${row}`, row * columns, 1, columns)
  }
  for (let column = 0; column < columns; column += 1) {
    inspect(`column:${column}`, column, columns, rows)
  }
  return eligible
}

/**
 * P5's oracle, part two: the exact line set and per-line cell count a pass must
 * report, i.e. eligibility from part one plus the shared-cell attribution.
 *
 * The two halves are separated because only this half can actually fail. A write
 * never marks a mine and never creates a wrong mark, so a cascade loop can never
 * make a *new* line eligible, and P5's membership half is therefore close to
 * unfalsifiable in isolation. The COUNT is different, and it is what this
 * function pins. Two details are load-bearing and both were found by this
 * sweep rather than by reading the code:
 *
 *  - A line is only REPORTED when it actually has a cell left to fill. A line
 *    whose every non-mine cell already carries a mark is eligible but silent.
 *    On the 2x2 board `[1,1,1,0]` with cells 1 and 2 marked, row 1 takes cell 3
 *    and column 1 is then left with nothing to write, so it is eligible yet
 *    unreported.
 *  - Rows are filled before columns, so a column's cells that a row already took
 *    are no longer available to it.
 *  - A cell two eligible lines share is written once and attributed to whichever
 *    line reaches it first, so the two `cells` counts sum to the number of
 *    distinct writes rather than double-counting the overlap.
 */
function expectedLines(
  board: BinaryMineBoard,
  marks: readonly CellMark[],
  rows: number,
  columns: number,
): Map<string, number> {
  const eligible = eligibleFromInput(board, marks, rows, columns)
  const written = new Set<number>()
  const expected = new Map<string, number>()
  const fill = (key: string, start: number, stride: number, length: number): void => {
    let fresh = 0
    for (let offset = 0; offset < length; offset += 1) {
      const index = start + offset * stride
      // A fresh write requires all three of: a non-mine cell, a cell that still
      // carries no mark, and a cell no earlier line in this same pass has taken.
      // The middle condition is the one that is easy to forget: a line whose
      // remaining cells are all already marked is eligible but has nothing to
      // show, so it must not be reported at all.
      if (board[index] === 1 || marks[index] !== 'unknown' || written.has(index)) {
        continue
      }
      written.add(index)
      fresh += 1
    }
    if (fresh > 0) {
      expected.set(key, fresh)
    }
  }
  for (let row = 0; row < rows; row += 1) {
    if (eligible.has(`row:${row}`)) {
      fill(`row:${row}`, row * columns, 1, columns)
    }
  }
  for (let column = 0; column < columns; column += 1) {
    if (eligible.has(`column:${column}`)) {
      fill(`column:${column}`, column, columns, rows)
    }
  }
  return expected
}

function checkReveal(
  label: string,
  board: BinaryMineBoard,
  marks: readonly CellMark[],
  locked: readonly boolean[],
  result: AutoRevealResult,
  rows: number,
  columns: number,
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

  // P5: a line may only be reported if the INPUT marks already made it
  // eligible. A line the player has not resolved must never be reported merely
  // because an earlier write in this same pass happened to touch it, which is
  // what forbids a cascade.
  const eligible = eligibleFromInput(board, marksBefore, rows, columns)
  result.lines.forEach((line) => {
    const key = `${line.orientation}:${line.index}`
    expect(
      eligible.has(key),
      `${label}: reported ${key}, which the input marks did not make eligible; eligible ${JSON.stringify([...eligible])}`,
    ).toBe(true)
  })

  // P5: the reported set and every per-line cell count match exactly, including
  // the shared-cell attribution between the two orientations.
  const expected = expectedLines(board, marksBefore, rows, columns)
  const reported = new Map(
    result.lines.map((line) => [`${line.orientation}:${line.index}`, line.cells]),
  )
  expect(
    JSON.stringify([...reported]),
    `${label}: reported lines ${JSON.stringify([...reported])}`,
  ).toBe(JSON.stringify([...expected]))
  // The counts must also be distinct cells: a cell two eligible lines share is
  // written once and attributed to whichever line reaches it first.
  const summed = result.lines.reduce((total, line) => total + line.cells, 0)
  expect(summed, `${label}: reported ${summed} cells for ${changed} writes`).toBe(changed)

  // P4: a second pass over the output is a fixed point, and an inert pass
  // returns the very same array references.
  const again = revealEligibleLines(board, result.marks, result.locked, rows, columns)
  expect(again.lines).toEqual([])
  expect(again.marks).toBe(result.marks)
  expect(again.locked).toBe(result.locked)
}

describe('revealEligibleLines is safe on every mark pattern of every family', () => {
  for (const family of FAMILIES) {
    describe(`${family.name}`, () => {
      const { rows, columns } = family
      const cells = rows * columns
      const all = certifiedBoards(family)
      // The game's own input contract: the generator guarantees a mine in every
      // row and column, so only these boards are reachable in a real round. The
      // all-mine-less boards are still certified, which is why P6 needs its own
      // test below.
      const playable = all.filter((entry) =>
        hasAMinePerLine(entry.board, rows, columns),
      )
      const swept = playable.slice(0, family.swept)

      it(`certifies ${all.length} unique boards, ${playable.length} of them playable`, () => {
        expect(playable.length).toBeGreaterThanOrEqual(swept.length)
        expect(swept.length).toBe(family.swept)
        // Guard against a vacuous sweep: every swept board must be a real
        // unique solution and must satisfy the game's per-line mine contract.
        swept.forEach(({ mask }) => {
          expect(playable.some((entry) => entry.mask === mask)).toBe(true)
        })
      })

      for (const { board, mask } of swept) {
        it(`writes only correct blanks over all 2 ** ${cells} mark patterns of board ${mask}`, () => {
          for (let pattern = 0; pattern < 2 ** cells; pattern += 1) {
            // Each cell is either unmarked or already carrying the mark the
            // board calls for, which is the 2 ** CELLS sweep the rule is
            // specified over.
            const marks: CellMark[] = Array.from({ length: cells }, (_, index) =>
              (pattern >>> index) & 1
                ? board[index] === 1
                  ? 'mine'
                  : 'blank'
                : 'unknown',
            )
            const locked = lockedFor(board, marks)
            const result = revealEligibleLines(board, marks, locked, rows, columns)
            checkReveal(
              `board ${mask} pattern ${pattern}`,
              board,
              marks,
              locked,
              result,
              rows,
              columns,
            )
          }
        })
      }

      it(`writes only correct blanks over ${
        family.ternary === 'all' ? `all 3 ** ${cells}` : `${family.ternary} sampled`
      } mark patterns of the first ${Math.min(family.ternary === 'all' ? swept.length : 1, swept.length)} board(s), wrong marks included`, () => {
        const boards =
          family.ternary === 'all' ? swept : swept.slice(0, 1)
        const space = 3 ** cells
        boards.forEach(({ board, mask }, boardIndex) => {
          const full = family.ternary === 'all'
          const next = makeLcg(0x5eed + mask)
          const total = full ? space : Math.min(family.ternary as number, space)
          for (let sample = 0; sample < total; sample += 1) {
            // A full sweep walks the space; a sampled one draws from it with a
            // fixed-seed LCG, so a failure is always reproducible.
            const pattern = full ? sample : next() % space
            const marks: CellMark[] = Array.from({ length: cells }, (_, index) => {
              const digit = Math.floor(pattern / 3 ** index) % 3
              return digit === 0 ? 'mine' : digit === 1 ? 'blank' : 'unknown'
            })
            const locked = lockedFor(board, marks)
            const label = `board ${mask} ternary ${pattern} (board ${boardIndex})`
            const result = revealEligibleLines(board, marks, locked, rows, columns)
            checkReveal(label, board, marks, locked, result, rows, columns)

            // A wrong mark disqualifies its whole row and its whole column, so
            // neither may be reported as filled no matter what else is known.
            for (let index = 0; index < cells; index += 1) {
              if (
                marks[index] === 'unknown' ||
                (marks[index] === 'mine') === (board[index] === 1)
              ) {
                continue
              }
              const eligible = eligibleFromInput(board, marks, rows, columns)
              const row = Math.floor(index / columns)
              const column = index % columns
              expect(
                eligible.has(`row:${row}`),
                `${label}: the wrong mark at cell ${index} did not block row ${row}; eligible ${JSON.stringify([...eligible])}`,
              ).toBe(false)
              expect(
                eligible.has(`column:${column}`),
                `${label}: the wrong mark at cell ${index} did not block column ${column}; eligible ${JSON.stringify([...eligible])}`,
              ).toBe(false)
            }
          }
        })
      })
    })
  }
})

describe('a mine-less line is not revealed', () => {
  it('leaves every line of an all-blank board alone, on every mark pattern', () => {
    // The all-blank 3x3 is vacuously uniquely solvable, so boards like this do
    // reach the exported helper. Before the `mines > 0` guard it was filled
    // whole on any mark pattern, which is a state change with no cause.
    const board: BinaryMineBoard = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    const rows = 3
    const columns = 3
    for (let pattern = 0; pattern < 3 ** 9; pattern += 1) {
      const marks: CellMark[] = Array.from({ length: 9 }, (_, index) => {
        const digit = Math.floor(pattern / 3 ** index) % 3
        return digit === 0 ? 'mine' : digit === 1 ? 'blank' : 'unknown'
      })
      const locked = lockedFor(board, marks)
      const result = revealEligibleLines(board, marks, locked, rows, columns)
      expect(
        result.lines,
        `all-blank 3x3 pattern ${pattern}: reported ${JSON.stringify(result.lines)}`,
      ).toEqual([])
    }
  })

  it('leaves the mine-less lines of a partly mined board alone', () => {
    // A 3x3 with mines only in row 0: row 0 and column 0 are eligible once index
    // 0 is marked, and rows 1-2 plus columns 1-2 hold nothing to confirm.
    const board: BinaryMineBoard = [1, 0, 0, 0, 0, 0, 0, 0, 0]
    const marks: CellMark[] = [
      'mine', 'unknown', 'unknown',
      'unknown', 'unknown', 'unknown',
      'unknown', 'unknown', 'unknown',
    ]
    const result = revealEligibleLines(board, marks, lockedFor(board, marks), 3, 3)
    expect(result.lines).toEqual([
      { orientation: 'row', index: 0, cells: 2 },
      { orientation: 'column', index: 0, cells: 2 },
    ])
    // Cell 6 is the only cell of the eligible lines the pass may not write, and
    // it belongs to mine-less row 2 and mine-less column 0's neighbour set only.
    expect(result.marks[6]).toBe('blank')
    expect(result.marks[4]).toBe('unknown')
    expect(result.marks[5]).toBe('unknown')
  })
})

describe('the win check runs after the reveal', () => {
  for (const family of FAMILIES) {
    const { rows, columns } = family
    const cells = rows * columns
    const playable = certifiedBoards(family).filter((entry) =>
      hasAMinePerLine(entry.board, rows, columns),
    )

    /** Accepts `board` as a live round so the real reducer can be driven. */
    const play = (board: BinaryMineBoard, puzzle: MinegramPuzzle): GameState => {
      const settings = normalizeGenerationSettings({
        rows,
        columns,
        densityPercent: 50,
        seed: `auto-reveal-win-${family.name}`,
        difficulty: 'starter',
        maxAttempts: 3,
      })
      const round: GeneratedRound = { settings, board, puzzle }
      const initial = createInitialGameState({ settings, initialScore: 5 })
      const started = gameReducer(initial, { type: 'generation/start' })
      if (started.type !== 'transition') {
        throw new Error('expected transition')
      }
      const accepted = gameReducer(started.state, {
        type: 'generation/succeeded',
        generationId: started.state.generationId,
        round,
      })
      if (accepted.type !== 'transition') {
        throw new Error('expected transition')
      }
      return accepted.state
    }

    it(`wins ${family.name} as soon as every mine is marked and no blank is`, () => {
      const boards = playable.slice(0, 2)
      expect(boards.length).toBeGreaterThan(0)
      for (const { board, puzzle, mask } of boards) {
        const mines: number[] = []
        board.forEach((cell, index) => {
          if (cell === 1) {
            mines.push(index)
          }
        })
        const blanks = cells - mines.length

        // P7, helper level: the mark pattern that marks every mine and no blank.
        const marks: CellMark[] = board.map((cell) => (cell === 1 ? 'mine' : 'unknown'))
        const filled = revealEligibleLines(
          board,
          marks,
          lockedFor(board, marks),
          rows,
          columns,
        )
        // Every cell now carries the mark the board calls for, so the win gate
        // `roundIsComplete` is satisfied by the reveal alone.
        const required = board.map((cell) => (cell === 1 ? 'mine' : 'blank'))
        filled.marks.forEach((mark, index) => {
          expect(
            mark,
            `${family.name} board ${mask}: cell ${index} is ${mark}, the board calls for ${required[index]}; marks ${JSON.stringify(filled.marks)}`,
          ).toBe(required[index])
        })
        expect(filled.locked.every(Boolean)).toBe(true)

        // P7, reducer level, one batch carrying every mine at once.
        const together = gameReducer(play(board, puzzle), {
          type: 'round/markBatch',
          cells: mines.map((index) => ({ index, assertion: 'mine' as const })),
        })
        if (together.type !== 'transition') {
          throw new Error(`expected transition, received ${together.type}: ${together.reason}`)
        }
        expect(
          together.transition,
          `${family.name} board ${mask}: a single batch of all ${mines.length} mines -> ${together.transition}, status ${together.state.status}, marks ${JSON.stringify(together.state.marks)}`,
        ).toBe('round-won')
        expect(together.state.status).toBe('won')
        expect(together.state.score).toBe(5)

        // P7, reducer level, the soft-lock case: one mine per batch, so the LAST
        // batch is the one that completes the board. If the win check ran before
        // the reveal, that batch would return `marks-applied` with the blanks
        // still 'unknown' and the round could never be finished.
        let state = play(board, puzzle)
        mines.forEach((index, position) => {
          const played = gameReducer(state, {
            type: 'round/markBatch',
            cells: [{ index, assertion: 'mine' as const }],
          })
          if (played.type !== 'transition') {
            throw new Error(
              `expected transition on mine ${index}, received ${played.type}: ${played.reason}`,
            )
          }
          const last = position === mines.length - 1
          const want = last ? 'round-won' : 'marks-applied'
          expect(
            played.transition,
            `${family.name} board ${mask}: batch ${position + 1}/${mines.length} (mine ${index}) -> ${played.transition}, expected ${want}; status ${played.state.status}, marks ${JSON.stringify(played.state.marks)}`,
          ).toBe(want)
          state = played.state
        })
        expect(state.status).toBe('won')
        // Every blank was filled by the reveal, never asserted by the player, so
        // the round cannot be won without it.
        const finalMarks: readonly CellMark[] = state.marks
        finalMarks.forEach((mark, index) => {
          if (board[index] === 1) {
            return
          }
          expect(
            mark,
            `${family.name} board ${mask}: blank ${index} is ${mark}, expected blank; marks ${JSON.stringify(finalMarks)}`,
          ).toBe('blank')
        })
        expect(state.locked.every(Boolean)).toBe(true)
        if (blanks > 0) {
          expect(finalMarks.filter((mark) => mark === 'blank').length).toBe(blanks)
        }
      }
    })
  }
})

describe('the reducer charges for wrong marks only, never for the auto-reveal', () => {
  const family = FAMILIES.find((entry) => entry.name === '3x3') as Family
  const { rows, columns } = family
  const cells = rows * columns
  const [first] = certifiedBoards(family).filter((entry) =>
    hasAMinePerLine(entry.board, rows, columns),
  ).slice(0, 1)

  it('spends a point per wrong mark and nothing for a revealed cell', () => {
    const settings = normalizeGenerationSettings({
      rows,
      columns,
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
    for (let index = 0; index < cells; index += 1) {
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
