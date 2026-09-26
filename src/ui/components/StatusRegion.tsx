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
  /**
   * Cells the *player* changed, i.e. the mark diff minus the cells the auto-reveal
   * filled in the same commit. This is the number the region credits.
   */
  readonly cells: number
  readonly wrong: number
  readonly assertion: Exclude<CellMark, 'unknown'>
  readonly revealedCells: number
  readonly revealedLines: number
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
  /**
   * A mirror of `announced` for effects. `announced` is genuinely read during render
   * (the sentence is the event's only while it is the newest one), so it has to be
   * state — but an effect must never *depend* on a value it sets, or it re-runs itself
   * the moment it does. The effect that publishes `announced` reads this instead.
   */
  const announcedRef = useRef<UiLastEvent | null>(null)
  const base = useRef<{ marks: readonly CellMark[]; score: number } | null>(null)
  /** The event the mark diff was last taken for, so it is taken for it exactly once. */
  const diffed = useRef<UiLastEvent | null>(null)
  const toolbar = useRef<{ mode: MarkingMode; zoom: ZoomStep } | null>(null)
  const score = status.score.current
  /**
   * `won` and `lost` are the two states the round banner also states in full, in
   * the same words. Two visible statements of one fact is a screen-reader
   * interruption and a sighted duplication, so in those two states this region
   * keeps its text for assistive technology only: `mg-visually-hidden` clips the
   * box without leaving the accessibility tree, which `display: none` and
   * `visibility: hidden` would both do — and either of those would silence a
   * polite live region whose whole job is to say the round ended. Every other
   * state keeps the region visible and unchanged.
   */
  const terminal = status.status === 'won' || status.status === 'lost'
  const rest = terminal ? ' mg-visually-hidden' : ''

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
      diffed.current = null
      announcedRef.current = null
      setDelta(null)
      return
    }
    const before = base.current
    // The base is *read* before it is advanced. Storing it first, as this used to, made
    // the effect re-run against the board it had just stored — see `diffed` — so the
    // correct delta computed below was overwritten by an empty one in the same commit.
    // Advancing it here on every publish, rather than only on a commit that carries a
    // diff, is what keeps the next diff measuring one commit: a `mark-cleared` publish
    // also moves marks, and it is not a diff.
    base.current = { marks: board.cells.map((cell) => cell.mark), score }
    if (lastEvent?.transition !== 'marks-applied' || before === null) {
      return
    }
    /**
     * One diff per event. `setLocale` republishes the *same* `lastEvent` object with a
     * freshly projected board (`src/ui/gameStore.ts`), so the board identity changing
     * says nothing about whether the event is new; without this a locale switch would
     * diff the board against itself and empty the sentence again.
     */
    if (lastEvent === diffed.current) {
      return
    }
    diffed.current = lastEvent
    if (before.marks.length !== board.cells.length) {
      setDelta(null)
      return
    }
    let changed = 0
    let mines = 0
    for (let index = 0; index < board.cells.length; index += 1) {
      if (board.cells[index].mark !== before.marks[index]) {
        changed += 1
        if (board.cells[index].mark === 'mine') {
          mines += 1
        }
      }
    }
    // The auto-reveal writes into the same commit, so its cells are in this diff
    // and are not the player's assertions. They need no subtraction from `mines`:
    // a reveal only ever writes `blank`, so every mine in the diff is the
    // player's, and the count to credit is the diff minus the revealed cells.
    // `revealedCells` is the event's own count and `cells` is the diff's, so the two
    // come from different sources; the clamp exists only to keep `cells` non-negative
    // if they ever disagree. It is not what emptied this sentence before.
    const revealedCells = Math.max(0, Math.min(changed, lastEvent?.autoRevealedCells ?? 0))
    const revealedLines = lastEvent?.autoRevealedLines ?? 0
    const cells = changed - revealedCells
    setDelta({
      cells,
      wrong: Math.max(0, before.score - score),
      assertion: mines * 2 >= cells ? 'mine' : 'blank',
      revealedCells,
      revealedLines,
    })
  }, [board, lastEvent, score])

  useEffect(() => {
    if (lastEvent === null || announcedRef.current === lastEvent) {
      return
    }
    announcedRef.current = lastEvent
    setAnnounced(lastEvent)
    // A game event supersedes a toolbar note: the board changed, so the board is
    // what the region says next.
    setChrome(null)
  }, [lastEvent])

  return (
    <div
      className="mg-status"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      data-status={status.status}
    >
      <span className={`mg-status__state${rest}`}>{stateWord(t, status)}</span>
      {status.isGenerating ? (
        <span className="mg-status__caret" aria-hidden="true">
          {t.generation.caret}
        </span>
      ) : null}
      <span className={`mg-status__message${rest}`}>
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
 * transition, a reason and the auto-reveal's two counts, not the batch, so the cell
 * count comes from diffing this board against the previous one, minus the cells the
 * game filled itself, and the wrong count from the score delta. Both are exact — a
 * cell's mark only ever changes when a batch is applied, a reveal only ever writes
 * `blank`, and a cell is charged at most once per batch.
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
        return marksApplied(t, status, delta, mode)
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

/**
 * The `marks-applied` sentence, split so the auto-reveal's share is never read as
 * the player's.
 *
 * The same commit can do both things at once: the player marks the last mine in a
 * line and the game fills that line's gaps. Crediting the whole diff would tell the
 * player they asserted cells they never touched, so the revealed cells come off the
 * player's count and get their own clause, which also says how many lines the game
 * closed. If the fill is the whole change, there is nothing to credit and the
 * sentence says so instead of claiming "marked 0 cells".
 */
function marksApplied(t: Copy, status: StatusView, delta: MarkDelta | null, mode: MarkingMode): string {
  const resting = interpolate(t.announce.mode, { mode: modeLabel(t, mode) })
  if (delta === null || (delta.cells === 0 && delta.revealedLines === 0)) {
    return resting
  }
  if (delta.cells === 0) {
    return interpolate(delta.revealedLines === 1 ? t.announce.revealOnlyOne : t.announce.revealOnlyMany, {
      lines: delta.revealedLines,
      cells: delta.revealedCells,
      score: status.score.current,
    })
  }
  const marked = interpolate(t.announce.marksApplied, {
    cells: delta.cells,
    assertion: delta.assertion === 'mine' ? t.announce.assertions.mine : t.announce.assertions.blank,
    wrong: delta.wrong,
    score: status.score.current,
  })
  if (delta.revealedLines === 0) {
    return marked
  }
  const note = interpolate(
    delta.revealedLines === 1 ? t.announce.revealNoteOne : t.announce.revealNoteMany,
    { lines: delta.revealedLines, cells: delta.revealedCells },
  )
  return `${marked} ${note}`
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
