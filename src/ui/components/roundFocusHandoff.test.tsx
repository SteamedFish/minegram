import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardSurface, ROUND_FOCUS_ID } from './BoardSurface'
import { RoundBanner } from './RoundBanner'
import { DifficultyChip, StatusChipRow } from './AppBanner'
import { SettingsPanel } from './SettingsPanel'
import { defaultDraft } from './defaults'
import { createGameStore, normalizeDraft, type GameStore, type SettingsDraft } from '../gameStore'
import { DEFAULT_LOCALE, getCopy, interpolate, type Copy } from '../copy'
import { MAX_BOARD_SIDE, MIN_BOARD_SIDE } from '../../domain/board'
import { derivePuzzleClues } from '../../domain'
import { deriveNextRoundSettings } from '../../application/gameReducer'
import { normalizeGenerationSettings } from '../../engine/generator/settings'
import type { DifficultyView, MarkingMode, UiSnapshot, ZoomStep } from '../viewModel'

/**
 * What a player can be left staring at: a round number that does not exist yet, a
 * machine token in the masthead, a fabricated mine count, and — the one that
 * actually strands a keyboard player — focus dropped on `<body>` every time the
 * win notice unmounts.
 *
 * The focus cases are the point of the file, so they run the real components
 * against a real store: the banner, the board, the round number and the interlude
 * are the production ones, and nothing about the sequence is stubbed except the
 * passage of time, which is driven by dispatching the interlude's own action
 * instead of waiting 1.2 seconds for it.
 */

// 1 0
// 0 1
// A 2×2 whose mines sit on a diagonal: marking cell 0 correctly completes row 0 and
// column 0 at once, which reveals 1 and 2, so cell 3 is the last mine in the round.
const BOARD = [1, 0, 0, 1] as const
const DIMENSIONS = { rows: 2, columns: 2 } as const
const SETTINGS = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  seed: 'focus-fixture',
  difficulty: 'starter',
  maxAttempts: 3,
})

const COPY: Copy = getCopy(DEFAULT_LOCALE)
const noop = (): void => undefined

let container: HTMLElement
let root: Root
let store: GameStore | null = null
const strays: HTMLButtonElement[] = []

function openStore(): GameStore {
  const created = createGameStore()
  created.dispatch({ type: 'generation/start', settings: SETTINGS, initialScore: 5 })
  created.dispatch({ type: 'generation/succeeded', generationId: 1, round: roundPayload(SETTINGS) })
  return created
}

/**
 * A round payload. `settings` is the PENDING generation's settings, because the
 * reducer only accepts a round whose settings match the request it answers — which
 * is the whole reason a won round's successor carries a derived seed.
 */
function roundPayload(settings: ReturnType<typeof normalizeGenerationSettings>): {
  readonly settings: ReturnType<typeof normalizeGenerationSettings>
  readonly board: typeof BOARD
  readonly puzzle: { readonly dimensions: typeof DIMENSIONS; readonly clues: ReturnType<typeof derivePuzzleClues> }
} {
  return {
    settings,
    board: BOARD,
    puzzle: { dimensions: DIMENSIONS, clues: derivePuzzleClues(BOARD, DIMENSIONS) },
  }
}

/** A store mid-first-generation: round 0, nothing played, one round in flight. */
function openingStore(): GameStore {
  const created = createGameStore()
  created.dispatch({ type: 'generation/start', settings: SETTINGS, initialScore: 5 })
  return created
}

function paintBoard(snapshot: UiSnapshot, live: GameStore, mode: MarkingMode = 'mine'): void {
  act(() => {
    root.render(
      <>
        <RoundBanner
          t={COPY}
          snapshot={snapshot}
          resume={{
            round: snapshot.status.round,
            body: COPY.resume.body,
            action: COPY.resume.action,
          }}
          settingsId="test-settings"
          onResume={noop}
          onNextRound={noop}
          onNewSeed={noop}
          onOpenSettings={noop}
        />
        <BoardSurface
          t={COPY}
          snapshot={snapshot}
          board={snapshot.board}
          mode={mode}
          zoom={'fit' as ZoomStep}
          fingerMarking={false}
          store={live}
          onMode={noop}
          onZoom={noop}
          onFingerMarking={noop}
          onGenerate={noop}
          onCancel={noop}
        />
      </>,
    )
  })
}

/**
 * A focusable button OUTSIDE the React container, standing in for the rest of the
 * page. It is deliberately not part of the rendered tree: React clears its
 * container on the first mount, so a node appended there would vanish and take the
 * focus with it.
 */
function strayButton(): HTMLButtonElement {
  const node = document.createElement('button')
  node.type = 'button'
  document.body.appendChild(node)
  strays.push(node)
  return node
}

function paintChipRow(status: Parameters<typeof StatusChipRow>[0]['status']): void {
  act(() => {
    root.render(
      <ul>
        <StatusChipRow t={COPY} status={status} />
      </ul>,
    )
  })
}

function paintDifficulty(difficulty: DifficultyView): void {
  act(() => {
    root.render(
      <ul>
        <DifficultyChip t={COPY} difficulty={difficulty} />
      </ul>,
    )
  })
}

function paintSettings(draft: SettingsDraft): void {
  act(() => {
    root.render(
      <SettingsPanel
        t={COPY}
        id="test-settings"
        draft={draft}
        validation={normalizeDraft(draft)}
        generating={false}
        onChange={noop}
        onGenerate={noop}
        hints={false}
        onHintsChange={noop}
        onDefaults={noop}
        onNewSeed={noop}
      />,
    )
  })
}

function active(): HTMLElement {
  return document.activeElement as HTMLElement
}

function boardRegion(): Element | null {
  return container.querySelector('.mg-board-scroll')
}

/** "Focus is somewhere a player can carry on from", as a single reusable claim. */
function expectFocusHeldInBoardRegion(): HTMLElement {
  const focus = active()
  expect(focus).not.toBe(document.body)
  expect(focus.isConnected).toBe(true)
  expect(boardRegion()?.contains(focus)).toBe(true)
  return focus
}

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  store?.dispose()
  store = null
  container.remove()
  for (const stray of strays.splice(0)) {
    stray.remove()
  }
})

describe('round change — focus lands where a player can carry on from', () => {
  it('keeps focus connected and inside the board region after a win, the interlude and the new round', () => {
    store = openStore()
    paintBoard(store.getSnapshot(), store)

    // The player is on the board, so the win notice is allowed to take focus.
    const firstCell = container.querySelector('[data-cell-index="0"]') as HTMLElement
    act(() => {
      firstCell.focus()
    })
    act(() => {
      store?.actions.mark([
        { index: 0, assertion: 'mine' },
        { index: 3, assertion: 'mine' },
      ])
    })
    const won = store.getSnapshot()
    expect(won.status.status).toBe('won')
    paintBoard(won, store)
    const primary = container.querySelector('.mg-round-banner__primary') as HTMLElement
    expect(document.activeElement).toBe(primary)

    // The interlude ends. The banner stops rendering content, so the node that held
    // focus leaves the document — this is the moment the old code dropped the
    // keyboard player on `<body>`.
    act(() => {
      store?.dispatch({ type: 'generation/start', settings: SETTINGS, initialScore: 5 })
    })
    const printing = store.getSnapshot()
    expect(printing.status.isGenerating).toBe(true)
    paintBoard(printing, store)
    expect(container.querySelector('.mg-round-banner__primary')).toBeNull()

    const afterUnmount = expectFocusHeldInBoardRegion()
    expect(afterUnmount.id).toBe(ROUND_FOCUS_ID)

    // And the round that replaces it keeps focus on the board rather than
    // returning it to the top of the document. A won round's successor is printed
    // from DERIVED settings, so the payload has to answer that request.
    act(() => {
      store?.dispatch({
        type: 'generation/succeeded',
        generationId: 2,
        round: roundPayload(deriveNextRoundSettings(SETTINGS, 2)),
      })
    })
    const next = store.getSnapshot()
    expect(next.status.round).toBe(2)
    paintBoard(next, store)
    expectFocusHeldInBoardRegion()
  })

  it('pulls focus into the board region when a round is printed from outside it', () => {
    store = openStore()
    paintBoard(store.getSnapshot(), store)
    const outside = strayButton()
    act(() => {
      outside.focus()
    })
    expect(document.activeElement).toBe(outside)

    act(() => {
      store?.dispatch({ type: 'generation/start', settings: SETTINGS, initialScore: 5 })
    })
    act(() => {
      store?.dispatch({ type: 'generation/succeeded', generationId: 2, round: roundPayload(SETTINGS) })
    })
    const next = store.getSnapshot()
    expect(next.status.round).toBe(2)
    paintBoard(next, store)
    const landed = expectFocusHeldInBoardRegion()
    expect(landed.id).toBe(ROUND_FOCUS_ID)
  })

  it('claims no focus on the first render, so opening the app cannot steal it', () => {
    store = openStore()
    const outside = strayButton()
    act(() => {
      outside.focus()
    })
    expect(document.activeElement).toBe(outside)

    paintBoard(store.getSnapshot(), store)
    expect(document.activeElement).toBe(outside)
    expect(outside.isConnected).toBe(true)
  })

  it('mounts the landing target in the board region in both branches, out of the tab order', () => {
    store = openStore()
    paintBoard(store.getSnapshot(), store)
    const onBoard = container.querySelector(`#${ROUND_FOCUS_ID}`) as HTMLElement
    expect(onBoard.getAttribute('data-testid')).toBe('round-focus')
    expect(onBoard.getAttribute('tabindex')).toBe('-1')
    expect(onBoard.className).toContain('mg-visually-hidden')
    expect(boardRegion()?.contains(onBoard)).toBe(true)
    expect(onBoard.getAttribute('aria-label')).not.toBeNull()

    // The empty branch needs one too: a generation can be cancelled or fail before
    // any board exists, and focus still has to land somewhere that names the region.
    act(() => {
      root.render(null)
    })
    const opening = openingStore()
    store = opening
    paintBoard(opening.getSnapshot(), opening)
    const onEmpty = container.querySelector(`#${ROUND_FOCUS_ID}`) as HTMLElement
    expect(onEmpty.isConnected).toBe(true)
    expect(onEmpty.getAttribute('aria-label')).toBe(COPY.board.empty.title)
    expect(container.querySelector('.mg-board-stage')).toBeNull()
  })
})

describe('board cells — a focus cursor is not a selection', () => {
  it('claims no selection on any cell, and still describes every one of them', () => {
    store = openStore()
    paintBoard(store.getSnapshot(), store)
    const cells = Array.from(container.querySelectorAll('[role="gridcell"]'))
    expect(cells).toHaveLength(4)
    for (const cell of cells) {
      expect(cell.hasAttribute('aria-selected')).toBe(false)
      expect(cell.getAttribute('aria-label')).toBeTruthy()
    }
    // The roving tabindex is the cursor, and it is still exactly one stop.
    expect(cells.filter((cell) => cell.getAttribute('tabindex') === '0')).toHaveLength(1)
    const grid = container.querySelector('[role="grid"]')
    expect(grid?.hasAttribute('aria-multiselectable')).toBe(false)
  })
})

describe('status chips — no round that does not exist, and one round, not two', () => {
  it('prints no round chip before the first round, and names the round being made', () => {
    store = openingStore()
    const opening = store.getSnapshot()
    expect(opening.status.round).toBe(0)
    expect(opening.status.hasRound).toBe(false)
    expect(opening.status.isGenerating).toBe(true)
    paintChipRow(opening.status)

    expect(container.querySelectorAll('[data-chip="round"]')).toHaveLength(0)
    expect(container.textContent).not.toContain(interpolate(COPY.status.roundChip, { round: 0 }))
    const busy = container.querySelectorAll('[data-chip="generating"]')
    expect(busy).toHaveLength(1)
    expect(busy[0]?.textContent).toBe(
      interpolate(COPY.generation.printing, { round: opening.status.nextRound ?? 1 }),
    )
  })

  it('shows a single round chip once a round is on the board', () => {
    store = openStore()
    const playing = store.getSnapshot()
    expect(playing.status.hasRound).toBe(true)
    paintChipRow(playing.status)
    const chips = container.querySelectorAll('[data-chip="round"]')
    expect(chips).toHaveLength(1)
    expect(chips[0]?.textContent).toBe(interpolate(COPY.status.roundChip, { round: playing.status.round }))
    // The second round chip used the same template, so "Round 1" and "Round 2" read
    // as two equally real rounds during a generation.
    expect(container.querySelectorAll('[data-chip="next-round"]')).toHaveLength(0)
  })
})

describe('difficulty chip — a reason in prose, or none at all', () => {
  const unknown = (reason: string | null): DifficultyView => ({
    kind: 'unknown',
    band: null,
    minimumGuesses: null,
    reason,
  })

  it('renders a known machine token as prose', () => {
    paintDifficulty(unknown('time-limit'))
    expect(container.textContent).toBe(
      `${COPY.difficulty.unresolved} · ${COPY.tokens.unknownReasons['time-limit']}`,
    )
  })

  it('drops a token it has no prose for rather than printing an identifier', () => {
    paintDifficulty(unknown('difficulty-not-found'))
    expect(container.textContent).toBe(COPY.difficulty.unresolved)
    expect(container.textContent).not.toContain('difficulty-not-found')
  })

  it('drops a reason that is not a string at all', () => {
    paintDifficulty(unknown(null))
    expect(container.textContent).toBe(COPY.difficulty.unresolved)
  })
})

describe('settings panel — no fabricated answer, no second copy of the bounds', () => {
  it('omits the mine-count echo while the draft is not printable', () => {
    const broken: SettingsDraft = { ...defaultDraft(), rows: '0' }
    const validation = normalizeDraft(broken)
    expect(validation.settings).toBeNull()
    paintSettings(broken)
    const echo = container.querySelector('.mg-field__echo') as HTMLElement
    // The percentage is still shown; only the derived count is absent.
    expect(echo.textContent).toBe('60')
    expect(echo.textContent).not.toContain(interpolate(COPY.settings.density.echo, { count: 0 }))
  })

  it('shows the mine count once the draft is printable again', () => {
    const draft = defaultDraft()
    const validation = normalizeDraft(draft)
    expect(validation.settings).not.toBeNull()
    paintSettings(draft)
    const echo = container.querySelector('.mg-field__echo') as HTMLElement
    expect(echo.textContent).toContain(
      interpolate(COPY.settings.density.echo, { count: validation.settings?.mineCount ?? -1 }),
    )
  })

  it('takes the board bounds from the engine instead of restating them', () => {
    paintSettings(defaultDraft())
    for (const side of ['rows', 'columns']) {
      const input = container.querySelector(`#test-settings-${side}`) as HTMLInputElement
      expect(input.getAttribute('min')).toBe(String(MIN_BOARD_SIDE))
      expect(input.getAttribute('max')).toBe(String(MAX_BOARD_SIDE))
    }
  })
})
