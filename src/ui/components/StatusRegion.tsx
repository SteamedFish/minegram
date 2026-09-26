import { useEffect, useRef, useState } from 'react'
import type { CellMark } from '../../application/gameReducer'
import { interpolate, type Copy } from '../copy'
import type { BoardView, MarkingMode, StatusView, UiLastEvent, ZoomStep } from '../viewModel'

/**
 * The single polite live region (§6.2, region 1).
 *
 * It renders two things: a short state word that is always present, and the
 * announcement sentence, which is derived from `lastEvent` — never from anything
 * that happens *during* a drag. A drag that announced every hit-tested cell would
 * flood a screen reader, so the sentence is only fed committed outcomes.
 *
 * The caret is decorative: it is `aria-hidden`, and the reduced-motion block in
 * `base.css` neutralises its animation, leaving the words to carry the state.
 */
export interface StatusRegionProps {
  readonly t: Copy
  readonly status: StatusView
  readonly board: BoardView | null
  readonly lastEvent: UiLastEvent | null
  readonly mode: MarkingMode
  readonly zoom: ZoomStep
}

interface MarkDelta {
  readonly cells: number
  readonly wrong: number
  readonly assertion: Exclude<CellMark, 'unknown'>
}

/**
 * A toolbar change worth announcing. §6.2 gives the polite region one job — say what
 * just happened — and a mode or zoom switch is a thing that just happened, so it goes
 * here rather than into a fourth live region.
 */
type ChromeNote = { readonly kind: 'mode' } | { readonly kind: 'zoom' }

export function StatusRegion({
  t,
  status,
  board,
  lastEvent,
  mode,
  zoom,
}: StatusRegionProps) {
  const [delta, setDelta] = useState<MarkDelta | null>(null)
  const [chrome, setChrome] = useState<ChromeNote | null>(null)
  /** The last event whose sentence has already been shown, as state so render can read it. */
  const [announced, setAnnounced] = useState<UiLastEvent | null>(null)
  const base = useRef<{ marks: readonly CellMark[]; score: number } | null>(null)
  const toolbar = useRef<{ mode: MarkingMode; zoom: ZoomStep } | null>(null)
  const score = status.score.current

  useEffect(() => {
    const before = toolbar.current
    toolbar.current = { mode, zoom }
    if (before === null || (before.mode === mode && before.zoom === zoom)) {
      return
    }
    setChrome({ kind: before.zoom === zoom ? 'mode' : 'zoom' })
  }, [mode, zoom])

  useEffect(() => {
    if (board === null) {
      base.current = null
      setDelta(null)
      return
    }
    const before = base.current
    base.current = { marks: board.cells.map((cell) => cell.mark), score }
    if (lastEvent !== null && announced !== lastEvent) {
      setAnnounced(lastEvent)
      // A game event supersedes a toolbar note: the board changed, so the board is
      // what the region says next.
      setChrome(null)
    }
    if (lastEvent?.transition !== 'marks-applied' || before === null) {
      return
    }
    if (before.marks.length !== board.cells.length) {
      setDelta(null)
      return
    }
    let cells = 0
    let mines = 0
    for (let index = 0; index < board.cells.length; index += 1) {
      if (board.cells[index].mark !== before.marks[index]) {
        cells += 1
        if (board.cells[index].mark === 'mine') {
          mines += 1
        }
      }
    }
    setDelta({
      cells,
      wrong: Math.max(0, before.score - score),
      assertion: mines * 2 >= cells ? 'mine' : 'blank',
    })
  }, [announced, board, lastEvent, score])

  return (
    <div
      className="mg-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-status={status.status}
    >
      <span className="mg-status__state">{stateWord(t, status)}</span>
      {status.isGenerating ? (
        <span className="mg-status__caret" aria-hidden="true">
          {t.generation.caret}
        </span>
      ) : null}
      <span className="mg-status__message">
        {announcement(t, status, lastEvent, delta, mode, zoom, chrome, announced)}
      </span>
      {status.isGenerating ? (
        <span className="mg-status__detail">{t.generation.background}</span>
      ) : null}
    </div>
  )
}

function stateWord(t: Copy, status: StatusView): string {
  switch (status.status) {
    case 'idle':
      return t.status.region.idle
    case 'generating':
      return interpolate(t.status.region.generating, { round: status.nextRound ?? status.round })
    case 'playing':
      return t.status.region.playing
    case 'won':
      return interpolate(t.status.region.won, { round: status.round })
    case 'lost':
      return interpolate(t.status.region.lost, { round: status.round })
    case 'failed':
      return t.status.region.failed
    default:
      return t.status.region.idle
  }
}

/**
 * The announcement sentence. Every branch is driven by a transition the store
 * already committed, so this can never claim something that did not happen.
 *
 * `marks-applied` is the one branch that needs arithmetic: `UiLastEvent` carries a
 * transition and a reason, not the batch, so the cell count comes from diffing
 * this board against the previous one and the wrong count from the score delta.
 * Both are exact — a cell's mark only ever changes when a batch is applied, and a
 * cell is charged at most once per batch.
 *
 * Priority is event, then toolbar, then the resting mode sentence. An event is used
 * only while it is the *newest* one (`announced`), so a toolbar change after a mark
 * still gets its own sentence instead of being drowned out by the mark.
 */
function announcement(
  t: Copy,
  status: StatusView,
  lastEvent: UiLastEvent | null,
  delta: MarkDelta | null,
  mode: MarkingMode,
  zoom: ZoomStep,
  chrome: ChromeNote | null,
  announced: UiLastEvent | null,
): string {
  const reason = lastEvent?.reason ?? null
  if (lastEvent !== null && announced === lastEvent) {
    switch (lastEvent.transition) {
      case 'generation-started':
        return interpolate(t.announce.generationStarted, {
          round: status.nextRound ?? status.round,
        })
      case 'generation-succeeded':
        return interpolate(t.announce.roundReady, { round: status.round })
      case 'round-won':
        return interpolate(t.announce.roundWon, {
          round: status.round,
          score: status.score.current,
        })
      case 'round-lost':
        return t.announce.roundLost
      case 'marks-applied':
        return delta === null
          ? interpolate(t.announce.mode, { mode: modeLabel(t, mode) })
          : interpolate(t.announce.marksApplied, {
              cells: delta.cells,
              assertion:
                delta.assertion === 'mine' ? t.announce.assertions.mine : t.announce.assertions.blank,
              wrong: delta.wrong,
              score: status.score.current,
            })
      case 'mark-cleared':
        return t.announce.markCleared
      case 'round-resumed':
        return interpolate(t.announce.roundResumed, { round: status.round })
      case 'generation-failed':
        return interpolate(t.announce.generationFailed, {
          reason: reason ?? status.failure?.headline ?? t.failure.headlineFallback,
        })
      case 'generation-cancelled':
        return t.announce.generationCancelled
      default:
        break
    }
  }
  if (chrome !== null) {
    return chrome.kind === 'zoom'
      ? interpolate(t.announce.zoom, { zoom: zoomLabel(t, zoom) })
      : interpolate(t.announce.mode, { mode: modeLabel(t, mode) })
  }
  if (reason !== null) {
    return interpolate(t.announce.ignored, { reason })
  }
  return interpolate(t.announce.mode, { mode: modeLabel(t, mode) })
}

function modeLabel(t: Copy, mode: MarkingMode): string {
  switch (mode) {
    case 'mine':
      return t.toolbar.modes.mine
    case 'blank':
      return t.toolbar.modes.blank
    case 'erase':
      return t.toolbar.modes.erase
    default:
      return t.toolbar.modes.mine
  }
}

function zoomLabel(t: Copy, zoom: ZoomStep): string {
  switch (zoom) {
    case 'fit':
      return t.toolbar.zooms.fit
    case 's':
      return t.toolbar.zooms.s
    case 'm':
      return t.toolbar.zooms.m
    case 'l':
      return t.toolbar.zooms.l
    default:
      return t.toolbar.zooms.m
  }
}
