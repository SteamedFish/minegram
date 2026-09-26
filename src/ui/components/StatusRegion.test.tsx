import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCopy, interpolate, type Copy } from '../copy'
import type { BoardView, CellView, StatusView, UiLastEvent } from '../viewModel'
import { StatusRegion, type StatusRegionProps } from './StatusRegion'

/**
 * The polite live region's announcement sentence.
 *
 * `@testing-library/react` is deliberately not used, for the same reason as
 * `src/App.test.tsx:23-34`: the contract under test is rendered text, and every prop
 * is plain data, so the region mounts standalone through `createRoot` inside `act`.
 * That also keeps a failure legible as a byte-exact sentence, which is the point here —
 * the defects these cases cover did not crash or render nothing, they rendered fluent
 * and plausible sentences with a wrong number, a wrong plural or a lost clause in them.
 *
 * The expected sentences below are written out as English literals rather than
 * recomposed from the dictionary, so that a change to the composition itself fails
 * here. Only the locale case recomposes, from the *other* dictionary, because what it
 * proves is which dictionary the region rendered from.
 *
 * Nothing in the application layer is imported: the region is handed a board, a status
 * and an event, and the board is built by marking cells, which is the only thing the
 * diff effect reads.
 */

const t: Copy = getCopy('en')
const zh: Copy = getCopy('zh-CN')

const ROWS = 2
const COLUMNS = 8
const CELLS = ROWS * COLUMNS
const SCORE = 5

/**
 * Every mark starts `unknown`, so a commit is expressed as the marks the next board
 * carries. `index` is the row-major position, which is also what the region diffs.
 */
const UNKNOWN: readonly CellView['mark'][] = Array.from({ length: CELLS }, () => 'unknown')

/**
 * One `marks-applied` commit: the first `player` cells are the player's assertions
 * and the next `revealed` are the cells the game filled in the same commit.
 */
function batch(player: number, revealed: number): readonly CellView['mark'][] {
  return UNKNOWN.map((mark, index) =>
    index < player ? 'mine' : index < player + revealed ? 'blank' : mark,
  )
}

/** The two player marks and the three cells the game fills, in the same commit. */
const MIXED = batch(2, 3)

/** The same commit with the player's part removed: the game filled all three cells. */
const REVEAL_ONLY = batch(0, 3)

/** A plain mark batch, no reveal at all. */
const PLAIN = batch(2, 0)

const PLAYING: StatusView = {
  status: 'playing',
  score: { current: SCORE, initial: SCORE },
  round: 1,
  nextRound: null,
  isGenerating: false,
  hasRound: true,
  difficulty: { kind: 'absent', band: null, minimumGuesses: null, reason: null },
  dimensions: null,
  failure: null,
  interactive: true,
}

function boardWith(marks: readonly CellView['mark'][]): BoardView {
  return {
    rows: ROWS,
    columns: COLUMNS,
    cells: marks.map((mark, index) => ({
      index,
      row: Math.floor(index / COLUMNS),
      column: index % COLUMNS,
      mark,
      locked: mark !== 'unknown',
      correct: mark === 'unknown' ? null : true,
    })),
    rowProgress: [],
    columnProgress: [],
    interactive: true,
  }
}

/**
 * `reasonLabel` is declared on every literal here, so `UiLastEvent.reasonLabel` can stop
 * being optional in `src/ui/viewModel.ts` without leaving a hole in this file.
 */
function event(overrides: Partial<UiLastEvent> = {}): UiLastEvent {
  return {
    transition: 'marks-applied',
    reason: null,
    reasonLabel: null,
    autoRevealedLines: 0,
    autoRevealedCells: 0,
    ...overrides,
  }
}

/**
 * A refusal as the store publishes it: the reducer returned its input state by
 * reference, so the event carries no transition, the reason, and the reason already
 * resolved into a sentence. The identifier must never be what reaches the screen.
 */
function refusal(overrides: Partial<UiLastEvent> = {}): UiLastEvent {
  return event({
    transition: null,
    reason: 'locked-cell',
    reasonLabel: LOCKED_EN,
    ...overrides,
  })
}

let container: HTMLElement
let root: Root | null = null

function mount(props: StatusRegionProps): void {
  root = createRoot(container)
  update(props)
}

/** Re-renders into the existing root, which is how a new publish reaches the region. */
function update(props: StatusRegionProps): void {
  act(() => {
    root?.render(<StatusRegion {...props} />)
  })
}

function readMessage(host: Element): string {
  const node = host.querySelector('.mg-status__message')
  if (node === null) {
    throw new Error('the status region rendered no .mg-status__message')
  }
  return node.textContent ?? ''
}

function message(): string {
  return readMessage(container)
}

/**
 * A whole publish sequence in a throwaway container, for the cases that need more
 * than one root. Returns the message the last publish left behind.
 */
function renders(steps: readonly StatusRegionProps[]): string {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const local = createRoot(host)
  try {
    for (const step of steps) {
      act(() => {
        local.render(<StatusRegion {...step} />)
      })
    }
    return readMessage(host)
  } finally {
    act(() => {
      local.unmount()
    })
    host.remove()
  }
}

function props(overrides: Partial<StatusRegionProps> = {}): StatusRegionProps {
  return {
    t,
    status: PLAYING,
    board: boardWith(UNKNOWN),
    lastEvent: null,
    mode: 'mine',
    zoom: 'm',
    ...overrides,
  }
}

// The two counts a commit can carry, in the four combinations the region has to keep
// apart: one line can hold three filled cells, and two lines can hold one.
const NOTE_ONE_CELL = 'The game filled 1 cell in the line you completed.'
const NOTE_THREE_CELLS = 'The game filled 3 cells in the line you completed.'
const NOTE_TWO_LINES_ONE_CELL = 'The game filled 1 cell in the 2 lines you completed.'
const NOTE_TWO_LINES_SEVEN_CELLS = 'The game filled 7 cells in the 2 lines you completed.'

const MARKED_ONE = 'Marked 1 cell as mines. Wrong: 0. Score 5.'
const MARKED_TWO = 'Marked 2 cells as mines. Wrong: 0. Score 5.'

// The sentences `src/ui/reasonCopy.ts` resolves `locked-cell` into, written out rather
// than imported: the region must be handed the label and must not be able to reach the
// table itself, and importing it here would test the table twice instead of the wire.
const LOCKED_EN = 'That cell is already locked, so its mark cannot change.'
const LOCKED_ZH = '该格已被锁定，标记无法更改。'

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  const current = root
  root = null
  if (current !== null) {
    act(() => {
      current.unmount()
    })
  }
  container.remove()
})

describe('StatusRegion announcement', () => {
  it('credits the player only for their own cells when one commit marks and reveals', () => {
    mount(props())

    update(
      props({
        board: boardWith(MIXED),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    // Two player mines and three game-filled blanks in one commit. The two counts
    // are separate numbers in one sentence, and the five-cell diff is never
    // reported as five player assertions.
    expect(message()).toBe(`${MARKED_TWO} ${NOTE_THREE_CELLS}`)
    expect(message()).not.toContain('0 cell')
    expect(message()).not.toContain('Marked 5')
  })

  it('announces a genuine reveal-only commit without claiming the player marked anything', () => {
    mount(props())

    update(
      props({
        board: boardWith(REVEAL_ONLY),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    expect(message()).toBe('You completed 1 line. The game filled 3 cells. Score 5.')
    expect(message()).not.toContain('Marked')
  })

  it('announces a plain mark batch with no reveal at all', () => {
    mount(props())

    update(props({ board: boardWith(PLAIN), lastEvent: event() }))

    expect(message()).toBe(MARKED_TWO)
    expect(message()).not.toContain(interpolate(t.announce.mode, { mode: t.toolbar.modes.mine }))
  })

  it('uses the singular when the player marked exactly one cell', () => {
    const marked = renders([
      props(),
      props({ board: boardWith(batch(1, 0)), lastEvent: event() }),
    ])

    expect(marked).toBe(MARKED_ONE)
    expect(marked).not.toContain('1 cells')
  })

  it('pluralises the reveal\'s line count and cell count independently', () => {
    const one = (lines: number, cells: number) =>
      renders([
        props(),
        props({
          board: boardWith(batch(2, cells)),
          lastEvent: event({ autoRevealedLines: lines, autoRevealedCells: cells }),
        }),
      ])

    // One line, one cell; one line, three cells; two lines, one cell; two lines,
    // seven cells. Each number is inflected for itself, so no combination produces
    // "1 cell" next to a plural noun or "1 lines".
    expect(one(1, 1)).toBe(`${MARKED_TWO} ${NOTE_ONE_CELL}`)
    expect(one(1, 3)).toBe(`${MARKED_TWO} ${NOTE_THREE_CELLS}`)
    expect(one(2, 1)).toBe(`${MARKED_TWO} ${NOTE_TWO_LINES_ONE_CELL}`)
    expect(one(2, 7)).toBe(`${MARKED_TWO} ${NOTE_TWO_LINES_SEVEN_CELLS}`)
  })

  it('keeps the sentence when an equal event is republished with a new board', () => {
    // `setLocale` republishes the newest event, and `projectSnapshot` freezes a *new*
    // `lastEvent` object out of it every time (`src/ui/viewModel.ts:680-688`), so the
    // republish carries a different identity for the same event and a freshly projected
    // board. Comparing by identity would drop the sentence to the resting one, and
    // re-diffing the board against itself would empty it again.
    mount(props())
    update(props({ board: boardWith(MIXED), lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }) }))
    const first = message()

    update(
      props({
        board: boardWith(MIXED),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    expect(message()).toBe(first)
    expect(message()).toBe(`${MARKED_TWO} ${NOTE_THREE_CELLS}`)
  })

  it('renders a republish of an equal event in the new locale\'s words', () => {
    // The copy object is part of the publish, so a locale switch changes the strings
    // the same sentence is built from. The sentence must come from the new copy and
    // must not fall back to the resting one.
    mount(props())
    update(
      props({
        board: boardWith(MIXED),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    update(
      props({
        t: zh,
        board: boardWith(MIXED),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    const cells = interpolate(zh.announce.revealCellsMany, { cells: 3 })
    const lines = interpolate(zh.announce.revealLinesOne, { lines: 1 })
    const expected = `${interpolate(zh.announce.marksAppliedMany, {
      cells: 2,
      assertion: zh.announce.assertions.mine,
      wrong: 0,
      score: SCORE,
    })} ${interpolate(zh.announce.revealNote, { cells, lines })}`
    expect(message()).toBe(expected)
    expect(message()).not.toBe(`${MARKED_TWO} ${NOTE_THREE_CELLS}`)
  })

  it('never claims the game filled nothing when the board diff is empty', () => {
    // A republish that carries a revealing event can leave the marks untouched, so
    // the reveal's cell count has to come from the event rather than from the diff:
    // the reducer only reports a line that actually wrote a cell
    // (`src/application/gameReducer.ts:201`), so "filled 0 cell" could only ever be
    // an artefact of measuring the wrong thing.
    const revealed = renders([
      props(),
      props({
        board: boardWith(UNKNOWN),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    ])

    expect(revealed).toBe('You completed 1 line. The game filled 3 cells. Score 5.')
    expect(revealed).not.toContain('0 cell')
  })

  it('keeps the event sentence over a toolbar note when an equal event is republished', () => {
    // Priority is event, then toolbar, then the resting mode sentence, and the event
    // wins by *content*: the third publish carries a new object for the same event, so a
    // render gate that asked for identity would drop the event and let the mode change
    // take the region over instead.
    mount(props())
    update(props({ board: boardWith(MIXED), lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }) }))
    update(
      props({
        mode: 'blank',
        board: boardWith(MIXED),
        lastEvent: event({ autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    expect(message()).toBe(`${MARKED_TWO} ${NOTE_THREE_CELLS}`)
  })

  it('diffs a new batch that carries the same event content', () => {
    // Two consecutive batches both report `marks-applied` with nothing revealed, so
    // the events are equal in content. The marks moving is the only thing that tells
    // the second commit from a republish of the first, and each batch has to be
    // counted for itself.
    mount(props())
    update(props({ board: boardWith(PLAIN), lastEvent: event() }))
    expect(message()).toBe(MARKED_TWO)

    update(props({ board: boardWith(batch(5, 0)), lastEvent: event() }))

    expect(message()).toBe('Marked 3 cells as mines. Wrong: 0. Score 5.')
  })

  it('counts the current batch only when an erase was published in between', () => {
    // An erase moves marks without being a `marks-applied` commit, so the diff base has
    // to advance on that publish too. A base that only moved on a diffed commit would
    // carry the erased cell into the next batch's count and credit the player for it.
    mount(props())
    update(props({ board: boardWith(PLAIN), lastEvent: event() }))
    const erased = PLAIN.map((mark, index) => (index === 0 ? 'unknown' : mark))
    update(props({ board: boardWith(erased), lastEvent: event({ transition: 'mark-cleared' }) }))
    // The player now marks one further cell, and re-marks nothing: the erased cell
    // stays erased, so the only mark that moved in this batch is the new one.
    const second = UNKNOWN.map((mark, index) => (index === 1 || index === 2 ? 'mine' : mark))
    update(props({ board: boardWith(second), lastEvent: event() }))

    expect(message()).toBe(MARKED_ONE)
  })

  it('appends the reveal clause to a cleared mark', () => {
    // The reducer reveals on `round/clearMark` as well, so erasing a wrong mine can
    // fill a line. `AGENTS.md` requires the filled lines to be announced, whatever the
    // entry point was.
    mount(props())
    update(
      props({
        board: boardWith(batch(1, 3)),
        lastEvent: event({ transition: 'mark-cleared', autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    expect(message()).toBe(`Mark cleared. ${NOTE_THREE_CELLS}`)
  })

  it('leaves a cleared mark byte-identical when nothing was revealed', () => {
    mount(props())
    update(props({ board: boardWith(batch(1, 0)), lastEvent: event({ transition: 'mark-cleared' }) }))

    expect(message()).toBe('Mark cleared.')
  })

  it('appends the reveal clause to a resumed round', () => {
    mount(props())
    update(
      props({
        board: boardWith(batch(2, 3)),
        lastEvent: event({ transition: 'round-resumed', autoRevealedLines: 1, autoRevealedCells: 3 }),
      }),
    )

    expect(message()).toBe(`Round 1 restored. Nothing was lost. ${NOTE_THREE_CELLS}`)
  })

  it('leaves a resumed round byte-identical when nothing was revealed', () => {
    mount(props())
    update(props({ board: boardWith(PLAIN), lastEvent: event({ transition: 'round-resumed' }) }))

    expect(message()).toBe('Round 1 restored. Nothing was lost.')
  })

  it('answers a refusal with the reason label and never the identifier', () => {
    mount(props())

    update(props({ lastEvent: refusal() }))

    expect(message()).toBe(`Not applied: ${LOCKED_EN}`)
    expect(message()).not.toContain('locked-cell')
  })

  it('answers a refusal in the locale its snapshot was projected for', () => {
    mount(props({ t: zh }))

    update(props({ t: zh, lastEvent: refusal({ reasonLabel: LOCKED_ZH }) }))

    expect(message()).toBe(`未生效：${LOCKED_ZH}`)
    expect(message()).not.toContain(LOCKED_EN)
  })

  it('renders the refusal frame alone when the snapshot carries no label', () => {
    // `projectSnapshot` always resolves the label, so a missing one means a hand-built
    // or older snapshot. The frame alone is the truthful answer; a raw identifier, or
    // a dangling colon where the clause would have been, is not.
    mount(props())

    update(props({ lastEvent: refusal({ reasonLabel: null }) }))

    expect(message()).toBe('Not applied.')
    expect(message()).not.toContain('locked-cell')
    expect(message()).not.toContain(':')
  })

  it('does not answer for a null-transition event that carries no reason', () => {
    mount(props())

    update(props({ lastEvent: event({ transition: null, reason: null }) }))

    expect(message()).toBe(interpolate(t.announce.mode, { mode: t.toolbar.modes.mine }))
    expect(message()).not.toContain('Not applied')
  })

  it('keeps the refusal over a toolbar note, because a refusal is an event', () => {
    mount(props())
    update(props({ lastEvent: refusal() }))

    update(props({ mode: 'blank', lastEvent: refusal() }))

    expect(message()).toBe(`Not applied: ${LOCKED_EN}`)
  })

  it('renders nothing for a free re-assertion, which the store never publishes', () => {
    // `isFreeReassertion` suppresses the one refusal the scoring contract makes free, so
    // from the region's side nothing is published: no event, no sentence, and the
    // resting mode line. The region cannot prove the store did that — this case pins
    // what it does with the absence of an event.
    mount(props())

    expect(message()).toBe(interpolate(t.announce.mode, { mode: t.toolbar.modes.mine }))
    expect(message()).not.toContain('Not applied')
  })
})
