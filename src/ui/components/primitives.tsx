import { bandLabel, type Copy } from '../copy'

/**
 * The five form primitives §2.3 names, each presentational: props in, markup out,
 * no state of their own. The settings panel owns the draft; these components
 * only report edits, which keeps the draft a single object the store can be
 * handed verbatim (`GameStoreActions.start(draft)`).
 *
 * Every control is labelled visibly and accessibly — a single control through a
 * real `<label for>`, the segmented group through a visible label named by
 * `aria-labelledby` (`label[for]` cannot name a group, only a single control) —
 * and every hint through `aria-describedby`, so a screen reader reaches the
 * same sentence the eye does.
 */

export interface NumberFieldProps {
  readonly id: string
  readonly label: string
  readonly value: string
  readonly min: number
  readonly max: number
  readonly step?: number
  readonly suffix?: string
  readonly hint?: string
  readonly invalid?: boolean
  readonly onChange: (value: string) => void
}

/** A text input that keeps whatever the user typed, including a half-typed number. */
export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  hint,
  invalid = false,
  onChange,
}: NumberFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`
  return (
    <div className="mg-field" data-invalid={invalid ? 'true' : undefined}>
      <label className="mg-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="mg-field__control">
        <input
          className="mg-field__input"
          id={id}
          type="number"
          inputMode="numeric"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-describedby={hintId}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
        />
        {suffix === undefined ? null : (
          <span className="mg-field__suffix" aria-hidden="true">
            {suffix}
          </span>
        )}
      </span>
      {hint === undefined ? null : (
        <p className="mg-field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

export interface RangeFieldProps {
  readonly id: string
  readonly label: string
  readonly value: number
  readonly min: number
  readonly max: number
  readonly step?: number
  /** Read-only derived echo, e.g. `mines: 135`. */
  readonly echo?: string
  readonly hint?: string
  readonly onChange: (value: number) => void
}

/**
 * Density. The mine count is a *derived echo* of the density, never an input
 * (§9.2): converting a mine count back to a density is lossy and the engine owns
 * the clamp, so the count is displayed and the slider stays the single input.
 */
export function RangeField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  echo,
  hint,
  onChange,
}: RangeFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`
  return (
    <div className="mg-field">
      <label className="mg-field__label" htmlFor={id}>
        {label}
      </label>
      <span className="mg-field__control">
        <input
          className="mg-field__range"
          id={id}
          type="range"
          value={value}
          min={min}
          max={max}
          step={step}
          aria-describedby={hintId}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <output className="mg-field__echo" htmlFor={id}>
          {`${value}${echo === undefined ? '' : ` · ${echo}`}`}
        </output>
      </span>
      {hint === undefined ? null : (
        <p className="mg-field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

export interface SegmentedOption<T extends string> {
  readonly value: T
  readonly label: string
}

export interface SegmentedControlProps<T extends string> {
  readonly id: string
  /** The group's visible label; it names the group through `aria-labelledby`. */
  readonly label: string
  readonly value: T
  readonly options: readonly SegmentedOption<T>[]
  /** One short line under the group, wired to it through `aria-describedby`. */
  readonly hint?: string
  readonly onChange: (value: T) => void
  readonly disabled?: boolean
}

/**
 * A radio group styled as segments. Native radios keep the arrow-key and
 * `role="radiogroup"` semantics for free, which is the whole point: §3.7 promises
 * "arrows inside the segmented control" and this is what delivers it.
 *
 * The group is named by a real visible label, not an invisible `aria-label`:
 * a group has no control to point `label[for]` at, so the label sits beside
 * the group and is referenced through `aria-labelledby` — the same visible
 * text serves the eye and the screen reader, which is this file's contract.
 */
export function SegmentedControl<T extends string>({
  id,
  label,
  value,
  options,
  hint,
  onChange,
  disabled = false,
}: SegmentedControlProps<T>) {
  const labelId = `${id}-label`
  const hintId = hint === undefined ? undefined : `${id}-hint`
  return (
    <div className="mg-seg-group">
      <span className="mg-field__label" id={labelId}>
        {label}
      </span>
      <div className="mg-seg" role="radiogroup" aria-labelledby={labelId} aria-describedby={hintId} id={id}>
        {options.map((option) => {
          const optionId = `${id}-${option.value}`
          const selected = option.value === value
          return (
            <span className="mg-seg__item" key={option.value}>
              <input
                className="mg-seg__input"
                type="radio"
                id={optionId}
                name={id}
                value={option.value}
                checked={selected}
                disabled={disabled}
                onChange={() => onChange(option.value)}
              />
              <label className="mg-seg__label" htmlFor={optionId}>
                {option.label}
              </label>
            </span>
          )
        })}
      </div>
      {hint === undefined ? null : (
        <p className="mg-field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

export interface ToggleFieldProps {
  readonly id: string
  readonly label: string
  readonly checked: boolean
  readonly hint?: string
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}

export function ToggleField({
  id,
  label,
  checked,
  hint,
  disabled = false,
  onChange,
}: ToggleFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`
  return (
    <div className="mg-field mg-field--toggle">
      <input
        className="mg-field__checkbox"
        type="checkbox"
        id={id}
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-describedby={hintId}
        onChange={(event) => onChange(event.target.checked)}
      />
      <label className="mg-field__label" htmlFor={id}>
        {label}
      </label>
      {hint === undefined ? null : (
        <p className="mg-field__hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  )
}

export interface DifficultySelectProps {
  readonly id: string
  readonly t: Copy
  readonly value: string
  readonly bands: readonly string[]
  readonly onChange: (value: string) => void
}

/**
 * §2.4 + §8.15. Every option shows its own definition, and a non-Starter choice
 * also carries the soft note that only Starter is printed today — the UI must
 * never imply a harder band will arrive.
 */
export function DifficultySelect({
  id,
  t,
  value,
  bands,
  onChange,
}: DifficultySelectProps) {
  const hintId = `${id}-hint`
  const noteId = `${id}-note`
  return (
    <div className="mg-field">
      <label className="mg-field__label" htmlFor={id}>
        {t.difficulty.label}
      </label>
      <select
        className="mg-field__select"
        id={id}
        value={value}
        aria-describedby={`${hintId} ${noteId}`}
        onChange={(event) => onChange(event.target.value)}
      >
        {bands.map((band) => (
          <option value={band} key={band}>
            {bandLabel(t, band)}
          </option>
        ))}
      </select>
      <ul className="mg-field__glossary">
        {bands.map((band) => (
          <li key={band} data-band={band}>
            {`${bandLabel(t, band)}: ${definitionOf(t, band)}`}
          </li>
        ))}
      </ul>
      <p className="mg-field__hint" id={hintId}>
        {t.difficulty.hint}
      </p>
      <p className="mg-field__note" id={noteId}>
        {t.difficulty.nonStarterNote}
      </p>
    </div>
  )
}

function definitionOf(t: Copy, band: string): string {
  switch (band) {
    case 'starter':
      return t.difficulty.definitions.starter
    case 'steady':
      return t.difficulty.definitions.steady
    case 'challenging':
      return t.difficulty.definitions.challenging
    case 'expert':
      return t.difficulty.definitions.expert
    default:
      return ''
  }
}
