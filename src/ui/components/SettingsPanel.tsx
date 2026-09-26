import { MAX_BOARD_SIDE, MIN_BOARD_SIDE } from '../../domain/board'
import { DIFFICULTY_BANDS } from '../../engine/solver/difficulty'
import { interpolate, type Copy } from '../copy'
import type { DraftValidation, SettingsDraft } from '../gameStore'
import { DifficultySelect, NumberField, RangeField } from './primitives'

/**
 * The settings panel, in the left aside.
 *
 * It edits a DRAFT of raw strings and never a live `GenerationSettings`. That is
 * deliberate: `normalizeGenerationSettings` is the only thing allowed to decide
 * whether a draft is printable, so a half-typed number reaches the engine and comes
 * back as its own message instead of being second-guessed here.
 *
 * §8.14: root attempts are clamped to 1–64 *in the input*, and the number input's own
 * `max` makes the same statement to a browser that validates ranges.
 */
export interface SettingsPanelProps {
  readonly t: Copy
  readonly id: string
  readonly draft: SettingsDraft
  readonly validation: DraftValidation
  readonly generating: boolean
  readonly onChange: (draft: SettingsDraft) => void
  readonly onGenerate: () => void
  readonly onDefaults: () => void
  readonly onNewSeed: () => void
}

export function SettingsPanel({
  t,
  id,
  draft,
  validation,
  generating,
  onChange,
  onGenerate,
  onDefaults,
  onNewSeed,
}: SettingsPanelProps) {
  const invalid = validation.error !== null
  return (
    <section className="mg-panel" id={id} aria-labelledby={`${id}-title`}>
      <h2 className="mg-panel__title" id={`${id}-title`}>
        {t.settings.title}
      </h2>
      <form
        className="mg-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          onGenerate()
        }}
      >
        <NumberField
          id={`${id}-rows`}
          label={t.settings.rows.label}
          value={draft.rows}
          /* The bounds come from the engine, not from a second copy of them here. */
          min={MIN_BOARD_SIDE}
          max={MAX_BOARD_SIDE}
          step={1}
          hint={t.settings.rows.hint}
          invalid={invalid}
          onChange={(value) => {
            onChange({ ...draft, rows: value })
          }}
        />
        <NumberField
          id={`${id}-columns`}
          label={t.settings.columns.label}
          value={draft.columns}
          min={MIN_BOARD_SIDE}
          max={MAX_BOARD_SIDE}
          step={1}
          hint={t.settings.columns.hint}
          invalid={invalid}
          onChange={(value) => {
            onChange({ ...draft, columns: value })
          }}
        />
        <RangeField
          id={`${id}-density`}
          label={t.settings.density.label}
          value={Number(draft.densityPercent)}
          min={0}
          max={100}
          step={1}
          hint={t.settings.density.hint}
          /* §9.2: the mine count is a read-only derived echo, never an input. There
             is no inverse — a mine count does not determine a density.

             A draft that does not currently produce settings has no mine count, and
             `?? 0` would print "mines: 0" exactly when the panel is lying to the
             player: a half-typed one-digit rows field yields no settings, and a
             fabricated zero reads like a rule rather than like a missing answer.
             The echo is simply absent until the draft is real again. */
          echo={
            validation.settings === null
              ? undefined
              : interpolate(t.settings.density.echo, { count: validation.settings.mineCount })
          }
          onChange={(value) => {
            onChange({ ...draft, densityPercent: String(value) })
          }}
        />
        <DifficultySelect
          id={`${id}-difficulty`}
          t={t}
          value={draft.difficulty}
          bands={DIFFICULTY_BANDS}
          onChange={(band) => {
            onChange({ ...draft, difficulty: band })
          }}
        />
        <div className="mg-field">
          <label className="mg-field__label" htmlFor={`${id}-seed`}>
            {t.settings.seed.label}
          </label>
          <input
            className="mg-field__input"
            id={`${id}-seed`}
            type="text"
            value={draft.seed}
            placeholder={t.settings.seed.placeholder}
            aria-describedby={`${id}-seed-hint`}
            onChange={(event) => {
              onChange({ ...draft, seed: event.currentTarget.value })
            }}
          />
          <p className="mg-field__hint" id={`${id}-seed-hint`}>
            {t.settings.seed.hint}
          </p>
        </div>
        <NumberField
          id={`${id}-max-attempts`}
          label={t.settings.maxAttempts.label}
          value={draft.maxAttempts}
          min={1}
          max={64}
          step={1}
          hint={t.settings.maxAttempts.hint}
          invalid={invalid}
          onChange={(value) => {
            onChange({ ...draft, maxAttempts: value })
          }}
        />
        <NumberField
          id={`${id}-initial-score`}
          label={t.settings.initialScore.label}
          value={draft.initialScore}
          min={1}
          max={99}
          step={1}
          hint={t.settings.initialScore.hint}
          invalid={invalid}
          onChange={(value) => {
            onChange({ ...draft, initialScore: value })
          }}
        />
        {invalid ? <DraftWarning t={t} message={validation.error} /> : null}
        <FormActions
          t={t}
          generating={generating}
          onDefaults={onDefaults}
          onNewSeed={onNewSeed}
        />
      </form>
    </section>
  )
}

/**
 * §2.4: the generator's own words. `normalizeGenerationSettings` throws a message
 * written for a human ("text seed must be a nonempty string", "rows times columns
 * must not exceed 576"), and paraphrasing it would be a second, drifting source of
 * truth about what the engine accepts. So it is rendered verbatim, behind the
 * dictionary's own label, and never as a sentence the app invented.
 */
function DraftWarning({ t, message }: { readonly t: Copy; readonly message: string | null }) {
  return (
    <p className="mg-form__warning" data-testid="draft-warning">
      <span className="mg-form__warning-label">{t.settings.infeasible}</span>{' '}
      <span className="mg-form__warning-detail">{message ?? ''}</span>
    </p>
  )
}

/**
 * The Generate button is the form's submit, so a keyboard Enter in any field and a
 * click reach the same handler. The other two are ghost buttons that never submit.
 */
function FormActions({
  t,
  generating,
  onDefaults,
  onNewSeed,
}: {
  readonly t: Copy
  readonly generating: boolean
  readonly onDefaults: () => void
  readonly onNewSeed: () => void
}) {
  return (
    <div className="mg-form__actions">
      <button className="mg-button mg-button--primary" type="submit" disabled={generating}>
        {t.settings.actions.generate}
      </button>
      <button className="mg-button" type="button" disabled={generating} onClick={onDefaults}>
        {t.settings.actions.defaults}
      </button>
      <button
        className="mg-button mg-form__new-seed"
        type="button"
        disabled={generating}
        onClick={onNewSeed}
      >
        {t.settings.actions.newSeed}
      </button>
    </div>
  )
}
