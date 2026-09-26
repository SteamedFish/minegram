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

/**
 * Whether two events are the *same* event, asked about content rather than identity.
 *
 * `projectSnapshot` freezes a new `lastEvent` out of the stored event on every call
 * (`src/ui/viewModel.ts:680-688`), so a republish of one event arrives as a different
 * object with identical fields. Compared by identity it read as a brand-new event, which
 * cost the player their sentence twice over: the diff was recomputed against the board it
 * had just stored and came out empty, and the render gate refused the event outright, so
 * the region fell back to the resting mode sentence. `setLocale` republishes, so that was
 * the switch-to-Chinese path.
 *
 * The two reveal counts are part of the content: a commit that closed a line is not the
 * same commit as one that did not, even though both are `marks-applied`.
 *
 * `reasonLabel` is deliberately NOT one of the fields, and this predicate is deliberately
 * not `sameLastEvent` from `src/ui/viewModel.ts`, which compares five. They are two
 * different questions. `sameLastEvent` is the snapshot contract — "did the event content
 * change?" — and a locale switch does change the content, because it changes
 * `reasonLabel`, so it correctly reports a difference. This one is the announcement gate:
 * "is this still the current announcement?", and it has to stay locale-INsensitive,
 * because a language switch has to keep the sentence and rebuild it from the new `t` and
 * the new `reasonLabel`. Treating a relabelled event as a new one would drop the
 * announcement on every language switch, which is the defect this whole arrangement
 * exists to fix. Merging the two predicates reinstates it, so do not.
 */
function sameEvent(a: UiLastEvent | null, b: UiLastEvent | null): boolean {
  if (a === null || b === null) {
    return a === b
  }
  return (
    a.transition === b.transition &&
    a.reason === b.reason &&
    a.autoRevealedLines === b.autoRevealedLines &&
    a.autoRevealedCells === b.autoRevealedCells
  )
}

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
     * One diff per event *content*, not per object. `setLocale` republishes the newest
     * event with a freshly projected board, and the new snapshot carries a new frozen
     * object for it, so the board identity changing says nothing about whether the event
     * is new.
     *
     * The mark diff is the discriminator that identity can no longer be. A republish
     * leaves the marks exactly where they were, so `changed === 0` with an equal event is
     * the same publish arriving twice and keeps the delta standing. Two *consecutive*
     * batches both report `marks-applied` with nothing revealed, so their events are
     * equal in content too — there the marks moved, and each batch has to be counted for
     * itself, which is why the guard below sits after the diff rather than before it.
     */
    if (before.marks.length !== board.cells.length) {
      diffed.current = lastEvent
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
    if (changed === 0 && sameEvent(lastEvent, diffed.current)) {
      return
    }
    diffed.current = lastEvent
    // The auto-reveal writes into the same commit, so its cells are in this diff and are
    // not the player's assertions. They need no subtraction from `mines`: a reveal only
    // ever writes `blank`, so every mine in the diff is the player's, and the count to
    // credit is the diff minus the revealed cells.
    //
    // The revealed count is the *event's*, not the diff's, and that is the whole point of
    // the split. A republish of a revealing event can leave the marks untouched — the
    // store re-projects a board it already published — and clamping the event's count to
    // the diff turned that into "The game filled 0 cell". The reducer only ever reports a
    // line that actually wrote at least one cell (`src/application/gameReducer.ts:201`),
    // so `autoRevealedLines > 0` already guarantees `autoRevealedCells >= 1` and the
    // reveal clause can never claim the game filled nothing.
    const revealedCells = lastEvent?.autoRevealedCells ?? 0
    const revealedLines = lastEvent?.autoRevealedLines ?? 0
    const cells = Math.max(0, changed - revealedCells)
    setDelta({
      cells,
      wrong: Math.max(0, before.score - score),
      assertion: mines * 2 >= cells ? 'mine' : 'blank',
      revealedCells,
      revealedLines,
    })
  }, [board, lastEvent, score])

  useEffect(() => {
    /**
     * Publishing is what makes a new dictionary render: a locale switch re-renders this
     * region with a different `t`, and the sentence has to be rebuilt from those new
     * strings or the player keeps reading the language they switched away from. So the
     * sentence is not gated here at all — an equal event is republished and re-rendered
     * on purpose, and the sentence is gated on the event's *content* in `announcement`
     * below, which is what stops one event being shown twice. Gating this on content as
     * well would be redundant, and gating *that* one on identity is the defect.
     */
    if (lastEvent === null || sameEvent(announcedRef.current, lastEvent)) {
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
 * still gets its own sentence instead of being drowned out by the mark. A refusal is
 * an event: it is published as its own null-transition event, it names something the
 * player just tried, and it outranks a toolbar note for the same reason a mark does.
 * Its branch is `case null`, so it can only ever be reached by an event that has no
 * transition — it cannot shadow a sentence for a real one.
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
  if (lastEvent !== null && sameEvent(announced, lastEvent)) {
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
        return withReveal(t, t.announce.markCleared, lastEvent)
      case 'round-resumed':
        return withReveal(
          t,
          interpolate(t.announce.roundResumed, { round: status.round }),
          lastEvent,
        )
      case 'generation-failed':
        return interpolate(t.announce.generationFailed, {
          reason: reason ?? status.failure?.headline ?? t.failure.headlineFallback,
        })
      case 'generation-cancelled':
        return t.announce.generationCancelled
      case null: {
        /**
         * A refusal. The store publishes it when the reducer returns its input state by
         * reference, so there is no transition to switch on: without this the region fell
         * through every branch and answered a refused click with "Marking: Mine".
         *
         * `reason` is the identifier and is only ever tested here. What the player reads
         * is `reasonLabel`, the sentence `src/ui/reasonCopy.ts` resolved it into for this
         * locale — `locked-cell` must not reach the screen, and the whole reason table
         * exists to stop it. A refusal with a reason but no label answers with the bare
         * frame, because inventing a clause would be as untrue as printing the token.
         */
        if (reason === null) {
          break
        }
        const label = lastEvent.reasonLabel ?? null
        return label === null
          ? t.announce.rejectedBare
          : interpolate(t.announce.rejected, { reason: label })
      }
      default:
        break
    }
  }
  if (chrome !== null) {
    return chrome.kind === 'zoom'
      ? interpolate(t.announce.zoom, { zoom: zoomLabel(t, zoom) })
      : interpolate(t.announce.mode, { mode: modeLabel(t, mode) })
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
    return interpolate(t.announce.revealOnly, {
      lines: revealCount(t, delta.revealedLines),
      cells: revealCells(t, delta.revealedCells),
      score: status.score.current,
    })
  }
  const marked = interpolate(delta.cells === 1 ? t.announce.marksAppliedOne : t.announce.marksAppliedMany, {
    cells: delta.cells,
    assertion: delta.assertion === 'mine' ? t.announce.assertions.mine : t.announce.assertions.blank,
    wrong: delta.wrong,
    score: status.score.current,
  })
  return delta.revealedLines === 0 ? marked : `${marked} ${revealNote(t, delta)}`
}

/**
 * The reveal clause, appended to whichever sentence the entry point produced. The
 * reducer reveals on `mark-cleared` and on `round-resumed` as well as on
 * `marks-applied`, so erasing a wrong mine can fill a line while the board visibly
 * changes; `AGENTS.md` requires the filled lines to be announced whatever the entry
 * point was, and it is the same clause each time.
 *
 * `autoRevealedLines > 0` implies `autoRevealedCells >= 1` — the reducer only reports
 * a line that actually wrote a cell — so there is no "filled nothing" case to word.
 */
function withReveal(t: Copy, sentence: string, lastEvent: UiLastEvent): string {
  if (lastEvent.autoRevealedLines === 0) {
    return sentence
  }
  return `${sentence} ${revealNote(t, {
    revealedLines: lastEvent.autoRevealedLines,
    revealedCells: lastEvent.autoRevealedCells,
  })}`
}

function revealNote(t: Copy, revealed: { readonly revealedLines: number; readonly revealedCells: number }): string {
  return interpolate(t.announce.revealNote, {
    cells: revealCells(t, revealed.revealedCells),
    lines:
      revealed.revealedLines === 1
        ? t.announce.revealLinesOne
        : interpolate(t.announce.revealLinesMany, { lines: revealed.revealedLines }),
  })
}

/** The filled-cell count, inflected on its own: one line can hold three of them. */
function revealCells(t: Copy, cells: number): string {
  return interpolate(cells === 1 ? t.announce.revealCellsOne : t.announce.revealCellsMany, { cells })
}

/** The closed-line count on its own, for the sentence that credits no cells. */
function revealCount(t: Copy, lines: number): string {
  return interpolate(lines === 1 ? t.announce.revealCountOne : t.announce.revealCountMany, { lines })
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
    case 'xl':
      return t.toolbar.zooms.xl
    case 'xxl':
      return t.toolbar.zooms.xxl
    default:
      return t.toolbar.zooms.m
  }
}
