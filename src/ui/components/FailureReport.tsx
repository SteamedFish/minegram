import { useEffect, useRef, useState } from 'react'
import type { Copy } from '../copy'
import type { FailureView } from '../viewModel'

/**
 * The failure strip above the board: the ONLY assertive live region (§6.2,
 * region 2). It is a strip, not a modal — the board stays visible underneath so a
 * failure never hides the round it is talking about.
 *
 * The primary action is keyed on `kind` (§8.6): a deterministic failure gets no
 * Retry at all, because retrying settings the generator already rejected would
 * only burn time. A retryable failure, and a neutral cancellation, get Retry.
 */
export interface FailureReportProps {
  readonly t: Copy
  readonly failure: FailureView
  readonly hasBoard: boolean
  readonly settingsId: string
  readonly onRetry: () => void
  readonly onNewSeed: () => void
  readonly onOpenSettings: () => void
  readonly onDismiss: () => void
  /** Called at click time only. The text must never enter state or the DOM. */
  readonly onCopyReport: () => string
}

export function FailureReport({
  t,
  failure,
  hasBoard,
  settingsId,
  onRetry,
  onNewSeed,
  onOpenSettings,
  onDismiss,
  onCopyReport,
}: FailureReportProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    },
    [],
  )

  function copy(): void {
    const text = onCopyReport()
    if (text === '') {
      return
    }
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined) {
      return
    }
    void clipboard.writeText(text).then(
      () => {
        setCopied(true)
        if (timer.current !== null) {
          clearTimeout(timer.current)
        }
        timer.current = setTimeout(() => {
          setCopied(false)
        }, 2000)
      },
      () => {
        setCopied(false)
      },
    )
  }

  return (
    <section
      className="mg-failure"
      role="alert"
      aria-atomic="true"
      data-kind={failure.kind}
      data-reason={failure.reason}
    >
      <h2 className="mg-failure__headline">{failure.headline}</h2>
      <p className="mg-failure__explanation">{failure.explanation}</p>
      <ol className="mg-failure__remedies">
        {failure.remedies.map((remedy, index) => (
          <li className="mg-failure__remedy" key={index}>
            {remedy}
          </li>
        ))}
      </ol>
      <ReportDisclosure t={t} failure={failure} />
      <div className="mg-failure__actions">
        {failure.canRetry ? (
          <button className="mg-button" type="button" title={t.failure.actions.retryHint} onClick={onRetry}>
            {t.failure.actions.retry}
          </button>
        ) : null}
        {failure.canChangeSeed ? (
          <button className="mg-button" type="button" onClick={onNewSeed}>
            {t.failure.actions.newSeed}
          </button>
        ) : null}
        <button className="mg-button" type="button" onClick={onOpenSettings} aria-controls={settingsId}>
          {t.failure.actions.openSettings}
        </button>
        <button className="mg-button" type="button" onClick={copy}>
          {t.failure.actions.copyReport}
        </button>
        {/* Not a live region: §6.2 allows exactly three, and this confirmation is
            a visual echo of a click the player just made. */}
        {copied ? <span className="mg-failure__copied">{t.failure.actions.copied}</span> : null}
        {hasBoard ? (
          <button className="mg-button" type="button" onClick={onDismiss}>
            {t.failure.actions.backToBoard}
          </button>
        ) : null}
      </div>
    </section>
  )
}

/**
 * §5.7: a fixed, already-whitelisted field list. The rows arrive formatted from
 * `formatDiagnostics`, so this component never sees a raw diagnostics object and
 * cannot accidentally serialise one.
 */
function ReportDisclosure({ t, failure }: { readonly t: Copy; readonly failure: FailureView }) {
  return (
    <details className="mg-failure__report">
      <summary className="mg-failure__report-summary">{t.failure.actions.reportDisclosure}</summary>
      <table className="mg-report">
        <caption className="mg-report__caption">{t.failure.actions.reportDisclosure}</caption>
        <tbody>
          {failure.report.map((row) => (
            <tr className="mg-report__row" key={row.label}>
              <th className="mg-report__label" scope="row">
                {row.label}
              </th>
              <td className="mg-report__value">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  )
}
