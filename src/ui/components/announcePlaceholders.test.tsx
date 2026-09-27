import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getCopy, type Copy } from '../copy'
import type { BoardView, CellView, FailureView, StatusView, UiLastEvent } from '../viewModel'
import { StatusRegion, type StatusRegionProps } from './StatusRegion'

/**
 * No announcement may reach the player with a `{placeholder}` still in it.
 *
 * This is a sweep, not a case: the defect it exists for was a *key* mismatch, not a
 * bad template. `src/ui/copy.ts` declares `announce.zoom` as `'Zoom {step}.'` while
 * `StatusRegion` supplied `{ zoom: … }`, and `interpolate` copies a placeholder it has
 * no value for out verbatim — so a live region politely announced the literal string
 * "Zoom {step}." to a player who had only changed the zoom. Both halves of that were
 * correct on their own: the template, the label, and the code that renders the branch
 * all read as if they worked, and only the assembled sentence was wrong. There was no
 * zoom test at all, so nothing noticed.
 *
 * A per-branch expectation cannot outlive a new branch; this one does. Every status,
 * every transition, both locales, and every toolbar note are rendered here, and the
 * only property asserted is that the region is finished composing: an unmatched `{`
 * or `}` is a defect whatever the sentence was supposed to be. A branch that cannot
 * be reached from these fixtures is a gap in the sweep, not a pass.
 *
 * The exact zoom sentence is asserted separately below, because "no braces" alone
 * would also be satisfied by a sentence that had stopped mentioning the zoom at all.
 */

const ROWS = 2
const COLUMNS = 8
const CELLS = ROWS * COLUMNS
const SCORE = 5

const UNKNOWN: readonly CellView['mark'][] = Array.from({ length: CELLS }, () => 'unknown')

function batch(player: number, revealed: number): readonly CellView['mark'][] {
  return UNKNOWN.map((mark, index) =>
    index < player ? 'mine' : index < player + revealed ? 'blank' : mark,
  )
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

function status(overrides: Partial<StatusView> = {}): StatusView {
  return {
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
    ...overrides,
  }
}

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

const LOCALES = ['en', 'zh-CN'] as const
const COPY: Record<(typeof LOCALES)[number], Copy> = {
  en: getCopy('en'),
  'zh-CN': getCopy('zh-CN'),
}

/** The bare minimum a failure view needs; the region only ever reads its `headline`. */
const FAILURE: FailureView = {
  reason: 'resource-limit',
  kind: 'retryable',
  headline: 'No board was produced.',
  explanation: 'x',
  remedies: [],
  report: [],
  canRetry: true,
  canChangeSeed: true,
}

/** Every status the region renders a distinct sentence for, including the two terminal ones. */
const STATUSES: readonly { name: string; view: StatusView }[] = [
  { name: 'idle', view: status({ status: 'idle', hasRound: false }) },
  { name: 'generating', view: status({ status: 'generating', isGenerating: true, nextRound: 2 }) },
  { name: 'playing', view: status() },
  { name: 'won', view: status({ status: 'won' }) },
  { name: 'lost', view: status({ status: 'lost', score: { current: 0, initial: SCORE } }) },
  { name: 'failed', view: status({ status: 'failed', failure: FAILURE }) },
]

/** Every transition `announcement` switches on, plus the refusal, which is `null`. */
const EVENTS: readonly { name: string; event: UiLastEvent }[] = [
  { name: 'generation-started', event: event({ transition: 'generation-started' }) },
  { name: 'generation-succeeded', event: event({ transition: 'generation-succeeded' }) },
  { name: 'round-won', event: event({ transition: 'round-won' }) },
  { name: 'round-lost', event: event({ transition: 'round-lost' }) },
  { name: 'marks-applied', event: event({ transition: 'marks-applied' }) },
  { name: 'mark-cleared', event: event({ transition: 'mark-cleared' }) },
  { name: 'round-resumed', event: event({ transition: 'round-resumed' }) },
  // `reason` on an event is a `GameResultReason`, so a generation fault publishes
  // none and the branch falls back to the failure view's headline — which is what
  // the `{reason}` slot actually receives in production.
  { name: 'generation-failed', event: event({ transition: 'generation-failed', reason: null }) },
  { name: 'refusal', event: event({ transition: null, reason: 'locked-cell', reasonLabel: 'locked' }) },
  { name: 'rejection-without-a-label', event: event({ transition: null, reason: 'locked-cell', reasonLabel: null }) },
  { name: 'mark-cleared-with-reveal', event: event({ transition: 'mark-cleared', autoRevealedLines: 2, autoRevealedCells: 3 }) },
  { name: 'round-resumed-with-reveal', event: event({ transition: 'round-resumed', autoRevealedLines: 1, autoRevealedCells: 1 }) },
]

const ZOOMS = ['fit', 's', 'm', 'l', 'xl', 'xxl'] as const
const MODES = ['mine', 'blank', 'erase'] as const

let host: HTMLElement
let root: Root | null = null

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  host = document.createElement('div')
  document.body.appendChild(host)
})

afterEach(() => {
  const current = root
  root = null
  if (current !== null) {
    act(() => {
      current.unmount()
    })
  }
  host.remove()
})

function render(props: StatusRegionProps): void {
  act(() => {
    if (root === null) {
      root = createRoot(host)
    }
    root.render(<StatusRegion {...props} />)
  })
}

/** Everything the region says, state word and message alike. */
function said(): string {
  return host.querySelector('.mg-status')?.textContent ?? ''
}

function message(): string {
  return host.querySelector('.mg-status__message')?.textContent ?? ''
}

describe('no announcement keeps a placeholder', () => {
  for (const locale of LOCALES) {
    const t = COPY[locale]

    for (const { name, view } of STATUSES) {
      it(`renders every transition on a ${name} round in ${locale} without a leftover brace`, () => {
        for (const { name: eventName, event: published } of EVENTS) {
          render({
            t,
            status: view,
            board: boardWith(UNKNOWN),
            lastEvent: published,
            mode: 'mine',
            zoom: 'm',
          })
          const text = said()
          expect(text, `${locale} / ${name} / ${eventName}`).not.toMatch(/[{}]/)
          expect(text.length, `${locale} / ${name} / ${eventName}`).toBeGreaterThan(0)
        }
      })
    }

    it('renders every zoom step as a finished sentence in ' + locale, () => {
      // The toolbar note needs a *change* to fire, and the resting step is the one the
      // region mounted with, so it has nothing to say: it is still swept for braces.
      const RESTING_ZOOM = 'm'
      render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode: 'mine', zoom: RESTING_ZOOM })
      for (const zoom of ZOOMS) {
        render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode: 'mine', zoom })
        const text = said()
        expect(text, `${locale} / zoom ${zoom}`).not.toMatch(/[{}]/)
        if (zoom !== RESTING_ZOOM) {
          expect(text, `${locale} / zoom ${zoom}`).toContain(t.toolbar.zooms[zoom])
        }
      }
    })

    it('renders every marking mode as a finished sentence in ' + locale, () => {
      const RESTING_MODE = 'mine'
      render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode: RESTING_MODE, zoom: 'm' })
      for (const mode of MODES) {
        render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode, zoom: 'm' })
        const text = said()
        expect(text, `${locale} / mode ${mode}`).not.toMatch(/[{}]/)
        if (mode !== RESTING_MODE) {
          expect(text, `${locale} / mode ${mode}`).toContain(t.toolbar.modes[mode])
        }
      }
    })
  }

  it('states the zoom the player actually chose', () => {
    // The regression itself. `t.announce.zoom` is a `{step}` template, and the region
    // used to hand `interpolate` a `{ zoom: … }` value, so this assertion is what the
    // missing zoom test cost: the branch was never rendered, so its key was never
    // compared with its template.
    const t = COPY.en
    render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode: 'mine', zoom: 'm' })
    render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode: 'mine', zoom: 'xxl' })
    expect(message()).toBe(`Zoom ${t.toolbar.zooms.xxl}.`)
  })

  it('composes a mark commit without a leftover brace in either locale', () => {
    // The one branch with arithmetic in it: the count is diffed off the board, so it
    // needs a first render to diff against.
    for (const locale of LOCALES) {
      const t = COPY[locale]
      render({ t, status: status(), board: boardWith(UNKNOWN), lastEvent: null, mode: 'mine', zoom: 'm' })
      for (const [player, revealed, lines, cells] of [
        [1, 0, 0, 0],
        [3, 0, 0, 0],
        [0, 1, 1, 1],
        [2, 3, 1, 3],
        [0, 4, 2, 4],
        [1, 2, 2, 2],
      ] as const) {
        render({
          t,
          status: status(),
          board: boardWith(batch(player, revealed)),
          lastEvent: event({ transition: 'marks-applied', autoRevealedLines: lines, autoRevealedCells: cells }),
          mode: 'mine',
          zoom: 'm',
        })
        const text = said()
        expect(text, `${locale} / ${player}+${revealed}`).not.toMatch(/[{}]/)
      }
    }
  })
})
