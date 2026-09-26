import { useEffect, useRef } from 'react'
import type { Copy } from '../copy'
import { readStored, writeStored } from './storage'

/**
 * The help dialog: a native `<dialog>` opened with `showModal()`, so the focus trap,
 * the inert background and the Escape key are the browser's job rather than ours.
 *
 * It opens once per browser. The flag is `minegram.onboarded`, and both Close and
 * Skip write it — a first-time player is told once, not nagged. A player who
 * arrived with the flag already set never sees it interrupt anything.
 *
 * The controls table is rendered from `t.help.actions`, not from a second list, so
 * there is exactly one place in the dictionary that says what a gesture does.
 */
export interface HelpDialogProps {
  readonly t: Copy
  readonly open: boolean
  readonly onOpen: () => void
  readonly onClose: () => void
}

const ACTIONS = [
  'markMine',
  'markEmpty',
  'erase',
  'cancelDrag',
  'moveFocus',
  'zoom',
  'settings',
  'nextRound',
] as const

const SECTIONS = ['gram', 'claims', 'scoring', 'controls'] as const

export function HelpDialog({ t, open, onOpen, onClose }: HelpDialogProps) {
  const dialog = useRef<HTMLDialogElement | null>(null)
  const opened = useRef(false)

  useEffect(() => {
    if (readStored(t.storage.onboarded) === 'true') {
      return
    }
    if (opened.current) {
      return
    }
    opened.current = true
    onOpen()
  }, [onOpen, t.storage.onboarded])

  useEffect(() => {
    const node = dialog.current
    if (node === null) {
      return
    }
    if (open && node.open !== true) {
      // A second automatic open in the same mount is suppressed by `opened`; this
      // path is the player's own Help button.
      if (typeof node.showModal === 'function') {
        node.showModal()
      } else {
        node.setAttribute('open', '')
      }
      return
    }
    if (!open && node.open === true) {
      node.close()
    }
  }, [open])

  function dismiss(): void {
    writeStored(t.storage.onboarded, 'true')
    onClose()
  }

  return (
    <>
      <button className="mg-help__open" type="button" aria-haspopup="dialog" onClick={onOpen}>
        {t.help.open}
      </button>
      <dialog
        className="mg-help"
        ref={dialog}
        aria-labelledby="mg-help-title"
        data-testid="help-dialog"
        /* Escape closes a modal dialog natively; without these the `open` prop
           would stay true and the next render would re-open it. */
        onClose={onClose}
        onCancel={onClose}
      >
        <h2 className="mg-help__title" id="mg-help-title">
          {t.help.title}
        </h2>
        {SECTIONS.map((section) => {
          const content = t.help.sections[section]
          return (
            <section className="mg-help__section" key={section} data-section={section}>
              <h3 className="mg-help__section-title">{content.title}</h3>
              <p className="mg-help__body">{content.body}</p>
              {'caption' in content ? <p className="mg-help__caption">{content.caption}</p> : null}
            </section>
          )
        })}
        <ControlsTable t={t} />
        <div className="mg-help__actions">
          <button className="mg-button mg-button--primary" type="button" onClick={dismiss}>
            {t.help.close}
          </button>
          <button className="mg-button" type="button" onClick={dismiss}>
            {t.help.skip}
          </button>
        </div>
      </dialog>
    </>
  )
}

function ControlsTable({ t }: { readonly t: Copy }) {
  return (
    <table className="mg-help__table">
      <caption className="mg-help__caption">{t.help.table.caption}</caption>
      <thead>
        <tr>
          <th scope="col">{t.help.table.action}</th>
          <th scope="col">{t.help.table.mouse}</th>
          <th scope="col">{t.help.table.touch}</th>
          <th scope="col">{t.help.table.keyboard}</th>
        </tr>
      </thead>
      <tbody>
        {ACTIONS.map((action) => (
          <tr key={action} data-action={action}>
            <th scope="row">{t.help.actions[action].action}</th>
            <td>{t.help.actions[action].mouse}</td>
            <td>{t.help.actions[action].touch}</td>
            <td>{t.help.actions[action].keyboard}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
