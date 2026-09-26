import { bandLabel, interpolate, type Copy } from '../copy'
import type { DifficultyView, ScoreView, StatusView } from '../viewModel'

/**
 * The sticky masthead: wordmark, status chips, score, settings disclosure.
 *
 * It is presentational and reads only from `StatusView` (§2.3). The only
 * exception to "no literal strings" is the wordmark itself, which is the product
 * name and therefore copy (`t.app.wordmark`).
 */

export interface AppBannerProps {
  readonly t: Copy
  readonly status: StatusView
  readonly settingsExpanded: boolean
  readonly onToggleSettings: () => void
  readonly settingsId: string
}

export function AppBanner({
  t,
  status,
  settingsExpanded,
  onToggleSettings,
  settingsId,
}: AppBannerProps) {
  return (
    <header className="mg-banner">
      <Wordmark t={t} />
      <div className="mg-banner__row">
        <StatusChipRow t={t} status={status} />
        <ScoreDisplay t={t} score={status.score} />
        <SettingsToggle
          t={t}
          expanded={settingsExpanded}
          controls={settingsId}
          onToggle={onToggleSettings}
        />
      </div>
    </header>
  )
}

export function Wordmark({ t }: { readonly t: Copy }) {
  return (
    <div className="mg-banner__wordmark">
      {/* The page's only <h1> (§6.1). */}
      <h1 className="mg-banner__title">{t.app.wordmark}</h1>
      <p className="mg-banner__tagline">{t.app.tagline}</p>
    </div>
  )
}

/**
 * One chip, not two. `round` is 0 until the first round is accepted, so an
 * unconditional round chip tells a first-time visitor they are on "Round 0", and
 * the second chip (the next round) uses the very same template, so a first
 * generation reads "Round 0" and "Round 1" as two equally real rounds. While a
 * generation is in flight the single chip names the round being MADE — that is
 * the only round number the player can act on — and it keeps the busy styling, so
 * a moving target is visibly different from a settled one.
 */
export function StatusChipRow({ t, status }: { readonly t: Copy; readonly status: StatusView }) {
  const printing = status.isGenerating
  return (
    <ul className="mg-chip-row">
      {printing ? (
        <li className="mg-chip" data-chip="generating" data-busy="true">
          {interpolate(t.generation.printing, { round: status.nextRound ?? Math.max(1, status.round) })}
        </li>
      ) : status.hasRound ? (
        <li className="mg-chip" data-chip="round">
          {interpolate(t.status.roundChip, { round: status.round })}
        </li>
      ) : null}
      {status.interactive ? null : (
        <li className="mg-chip" data-chip="read-only">{t.status.readOnly}</li>
      )}
      {!status.hasRound ? null : <DifficultyChip t={t} difficulty={status.difficulty} />}
    </ul>
  )
}

/**
 * §4.7 + §8.15: the chip reports what the engine actually proved and nothing more.
 * `absent` is "difficulty unreported", `unknown` is "unresolved" with the reason in
 * prose, and only `known` names a band — an unproven band is never dressed up as a
 * rating.
 *
 * The reason is looked up in `t.tokens.unknownReasons`, the table that exists
 * precisely to render machine tokens as prose. A token with no entry is dropped
 * rather than printed: this is the primary chrome, and "difficulty-not-found" or
 * "stale-generation-id" leaking into it is worse than a chip that says only
 * "unresolved".
 */
export function DifficultyChip({
  t,
  difficulty,
}: {
  readonly t: Copy
  readonly difficulty: DifficultyView
}) {
  if (difficulty.kind === 'absent') {
    return (
      <li className="mg-chip" data-chip="difficulty" data-difficulty="absent">
        {t.difficulty.unreported}
      </li>
    )
  }
  if (difficulty.kind === 'unknown') {
    const reason = unknownReason(t, difficulty.reason)
    return (
      <li className="mg-chip" data-chip="difficulty" data-difficulty="unknown">
        {`${t.difficulty.unresolved}${reason === null ? '' : ` · ${reason}`}`}
      </li>
    )
  }
  return (
    <li className="mg-chip" data-chip="difficulty" data-difficulty="known">
      {`${t.difficulty.proved}: ${bandLabel(t, difficulty.band)}`}
    </li>
  )
}

/** Prose for a machine token, or null when the token has no entry in the table. */
function unknownReason(t: Copy, token: string | null): string | null {
  const table = t.tokens.unknownReasons
  if (token === null || !Object.prototype.hasOwnProperty.call(table, token)) {
    return null
  }
  return table[token as keyof typeof table]
}

/**
 * The numeral is the signal; the pips only reinforce it. That is deliberate: a
 * player who cannot separate the two pips still reads the score, and the pips
 * never animate a number that has not changed (§2.5).
 */
export function ScoreDisplay({ t, score }: { readonly t: Copy; readonly score: ScoreView }) {
  const pips = Array.from({ length: score.initial }, (_, index) => index < score.current)
  return (
    <div className="mg-score">
      <span className="mg-score__label">{t.status.score}</span>
      <span className="mg-score__value">{score.current}</span>
      <span className="mg-score__pips" aria-hidden="true">
        {pips.map((filled, index) => (
          <span className="mg-score__pip" data-spent={filled ? undefined : 'true'} key={index} />
        ))}
      </span>
      {score.current < score.initial ? (
        <span className="mg-score__spent">
          {interpolate(t.status.scoreSpent, { spent: score.initial - score.current })}
        </span>
      ) : null}
    </div>
  )
}

export function SettingsToggle({
  t,
  expanded,
  controls,
  onToggle,
}: {
  readonly t: Copy
  readonly expanded: boolean
  readonly controls: string
  readonly onToggle: () => void
}) {
  return (
    <button
      className="mg-banner__settings"
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
    >
      {expanded ? t.settings.close : t.settings.open}
    </button>
  )
}
