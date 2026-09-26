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
 * the defect these cases cover did not crash or render nothing, it rendered a fluent
 * and plausible sentence with the wrong number in it.
 *
 * Nothing in the application layer is imported: the region is handed a board, a status
 * and an event, and the board is built by marking cells, which is the only thing the
 * diff effect reads.
 */

const t: Copy = getCopy('en')

const ROWS = 2
const COLUMNS = 8
const CELLS = ROWS * COLUMNS
const SCORE = 5

/**
 * Every mark starts `unknown`, so a commit is expressed as the marks the next board
 * carries. `index` is the row-major position, which is also what the region diffs.
 */
const UNKNOWN: readonly CellView['mark'][] = Array.from({ length: CELLS }, () => 'unknown')

/** The two player marks and the three cells the game fills, in the same commit. */
const MIXED: readonly CellView['mark'][] = UNKNOWN.map((mark, index) =>
  index === 0 || index === 1 ? 'mine' : index <= 4 ? 'blank' : mark,
)

/** The same commit with the player's part removed: the game filled all three cells. */
const REVEAL_ONLY: readonly CellView['mark'][] = UNKNOWN.map((mark, index) =>
  index <= 2 ? 'blank' : mark,
)

/** A plain mark batch, no reveal at all. */
const PLAIN: readonly CellView['mark'][] = UNKNOWN.map((mark, index) =>
  index === 0 || index === 1 ? 'mine' : mark,
)

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

function event(overrides: Partial<UiLastEvent> = {}): UiLastEvent {
  return {
    transition: 'marks-applied',
    reason: null,
    autoRevealedLines: 0,
    autoRevealedCells: 0,
    ...overrides,
  }
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

function message(): string {
  const node = container.querySelector('.mg-status__message')
  if (node === null) {
    throw new Error('the status region rendered no .mg-status__message')
  }
  return node.textContent ?? ''
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

const MARKED_TWO = interpolate(t.announce.marksApplied, {
  cells: 2,
  assertion: t.announce.assertions.mine,
  wrong: 0,
  score: SCORE,
})

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
    expect(message()).toBe(`${MARKED_TWO} ${interpolate(t.announce.revealNoteOne, { lines: 1, cells: 3 })}`)
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

    expect(message()).toBe(interpolate(t.announce.revealOnlyOne, { lines: 1, cells: 3, score: SCORE }))
    expect(message()).not.toContain('Marked')
  })

  it('announces a plain mark batch with no reveal at all', () => {
    mount(props())

    update(props({ board: boardWith(PLAIN), lastEvent: event() }))

    expect(message()).toBe(MARKED_TWO)
    expect(message()).not.toContain(interpolate(t.announce.mode, { mode: t.toolbar.modes.mine }))
  })

  it('keeps the sentence when the same event is published again with a new board', () => {
    // `setLocale` calls `publish(lastEvent, null)` with the same event object and a
    // freshly projected board (src/ui/gameStore.ts:393-399), so the board identity
    // changes while the event object does not. A diff taken here would compare the
    // board against itself and empty the sentence again.
    const last = event({ autoRevealedLines: 1, autoRevealedCells: 3 })
    mount(props())
    update(props({ board: boardWith(MIXED), lastEvent: last }))
    const first = message()

    update(props({ board: boardWith(MIXED), lastEvent: last }))

    expect(message()).toBe(first)
    expect(message()).toContain(interpolate(t.announce.revealNoteOne, { lines: 1, cells: 3 }))
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

    expect(message()).toBe(
      interpolate(t.announce.marksApplied, {
        cells: 1,
        assertion: t.announce.assertions.mine,
        wrong: 0,
        score: SCORE,
      }),
    )
  })
})
