import { useEffect, useRef } from 'react'
import { interpolate, type Copy } from '../copy'
import { resumeAvailable, type UiSnapshot } from '../viewModel'

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

  return (
    <div className="mg-round-banner" data-round-state={state} data-status={snapshot.status.status}>
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
