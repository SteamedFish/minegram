import { useCallback, useEffect, useRef, type FocusEvent } from 'react'
import { interpolate, type Copy } from '../copy'
import { resumeAvailable, type UiSnapshot } from '../viewModel'
import { ROUND_FOCUS_ID } from './BoardSurface'

/**
 * The round banner: a full-width strip directly above the board, never a modal.
 *
 * It owns three jobs and nothing else — the resume affordance for a failed
 * generation that kept a board, the win handoff, and the loss notice. When the
 * round is merely playing it renders an empty strip, so the vertical rhythm of
 * §1.1 does not jump as the banner comes and goes.
 */
export interface RoundBannerProps {
  readonly t: Copy
  readonly snapshot: UiSnapshot
  readonly resume: { readonly round: number; readonly body: string; readonly action: string }
  readonly settingsId: string
  readonly onResume: () => void
  readonly onNextRound: () => void
  readonly onNewSeed: () => void
  readonly onOpenSettings: () => void
}

type BannerState = 'none' | 'won' | 'lost' | 'resume'

export function RoundBanner(props: RoundBannerProps) {
  const { t, snapshot } = props
  const state = bannerState(snapshot)
  const primary = useRef<HTMLButtonElement | null>(null)
  // The last node inside this banner that held focus, captured on the way IN. A
  // node being removed cannot report where it was afterwards, so the answer has to
  // exist before the unmount.
  const held = useRef<HTMLElement | null>(null)

  const remember = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target = event.target
    held.current = target instanceof HTMLElement ? target : null
  }, [])

  useEffect(() => {
    if (state !== 'won' && state !== 'lost') {
      return
    }
    // §3.6: only take focus if it was already inside the board. Announcing a
    // win must not steal focus from whatever the player was reading.
    const active = document.activeElement
    if (active !== null && active.closest('.mg-board-scroll') !== null) {
      primary.current?.focus()
    }
  }, [state])

  // The banner is about to stop rendering content — the interlude ended and the
  // next round is printing, a loss was restarted, or a kept board came back. The
  // node that held focus is being removed, and the browser's answer to that is
  // `<body>`: a keyboard player lands at the top of the document with no way back
  // to the board. Hand focus to the board region's always-mounted landing target,
  // which outlives this banner.
  //
  // Guarded twice over: only a transition INTO 'none' counts, and only when focus
  // is genuinely gone (`<body>` or a detached node). If the player had already
  // tabbed somewhere else, that place keeps focus.
  const previous = useRef(state)
  useEffect(() => {
    const before = previous.current
    previous.current = state
    if (before === 'none' || state !== 'none') {
      return
    }
    const active = document.activeElement
    const lost = active === null || active === document.body || active.isConnected === false
    if (held.current === null || !lost) {
      return
    }
    held.current = null
    document.getElementById(ROUND_FOCUS_ID)?.focus({ preventScroll: true })
  }, [state])

  return (
    <div
      className="mg-round-banner"
      data-round-state={state}
      data-status={snapshot.status.status}
      onFocus={remember}
    >
      {state === 'resume' ? <ResumeNote t={t} resume={props.resume} onResume={props.onResume} /> : null}
      {state === 'won' ? (
        <div className="mg-round-banner__body" data-tone="won">
          <h2 className="mg-round-banner__title">
            {interpolate(t.round.wonTitle, { round: snapshot.status.round })}
          </h2>
          <p className="mg-round-banner__text">
            {interpolate(t.round.wonBody, { score: snapshot.status.score.current })}
          </p>
          <button className="mg-round-banner__primary" type="button" ref={primary} onClick={props.onNextRound}>
            {t.round.wonPrimary}
          </button>
        </div>
      ) : null}
      {state === 'lost' ? (
        <div className="mg-round-banner__body" data-tone="lost">
          <h2 className="mg-round-banner__title">
            {interpolate(t.round.lostTitle, { round: snapshot.status.round })}
          </h2>
          <p className="mg-round-banner__text">{t.round.lostBody}</p>
          <p className="mg-round-banner__text" data-tone="muted">
            {/* §8.7: a replay reuses the identical board, so say so rather than
                letting the player assume a new layout is coming. */}
            {t.round.sameSeed}
          </p>
          <div className="mg-round-banner__actions">
            <button className="mg-round-banner__primary" type="button" ref={primary} onClick={props.onNextRound}>
              {t.round.lostPrimary}
            </button>
            <button className="mg-button" type="button" onClick={props.onNewSeed}>
              {t.round.newSeed}
            </button>
            <button className="mg-button" type="button" onClick={props.onOpenSettings} aria-controls={props.settingsId}>
              {t.round.openSettings}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function bannerState(snapshot: UiSnapshot): BannerState {
  if (snapshot.status.status === 'won') {
    return 'won'
  }
  if (snapshot.status.status === 'lost') {
    return 'lost'
  }
  if (resumeAvailable(snapshot)) {
    return 'resume'
  }
  return 'none'
}

function ResumeNote({
  t,
  resume,
  onResume,
}: {
  readonly t: Copy
  readonly resume: RoundBannerProps['resume']
  readonly onResume: () => void
}) {
  return (
    <div className="mg-round-banner__body" data-tone="resume">
      <h2 className="mg-round-banner__title">{interpolate(t.resume.title, { round: resume.round })}</h2>
      <p className="mg-round-banner__text">{resume.body}</p>
      <button className="mg-round-banner__primary" type="button" onClick={onResume}>
        {resume.action}
      </button>
    </div>
  )
}
