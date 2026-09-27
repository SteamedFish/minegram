import { act, renderHook } from '@testing-library/react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsPanel } from './SettingsPanel'
import { defaultDraft } from './defaults'
import { normalizeDraft, type SettingsDraft } from '../gameStore'
import { getCopy } from '../copy'
import { useStoredFlag } from './preferences'
import { readStored } from './storage'

/**
 * The hint switch, split by who owns what.
 *
 * The *panel* owns the field: it shows the flag, it reports a new value, and — the
 * property that actually matters — it must not touch the draft, because `onChange`
 * is the draft the generator reads and a player who flips a hint mid-round must
 * not have their typed seed reprinted on the next Generate.
 *
 * The *hook* owns persistence: `useStoredFlag` is what reads the key on boot and
 * writes it on a turn, and it is the same hook the theme and the panel toggles
 * already use. Pinned here too, because the complaint was that the hints are on by
 * default, and "off by default" is a claim about the key's absent state.
 */

const t = getCopy('en')

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  window.localStorage.clear()
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  window.localStorage.clear()
})

interface Mounted {
  readonly onChange: ReturnType<typeof vi.fn>
  readonly onGenerate: ReturnType<typeof vi.fn>
  readonly onHintsChange: ReturnType<typeof vi.fn>
  readonly submitCount: () => number
}

function mount(draft: SettingsDraft = defaultDraft(), hints = false): Mounted {
  const onChange = vi.fn()
  const onGenerate = vi.fn()
  const onHintsChange = vi.fn()
  let submits = 0
  act(() => {
    root.render(
      <SettingsPanel
        t={t}
        id="test-settings"
        draft={draft}
        validation={normalizeDraft(draft)}
        generating={false}
        onChange={onChange}
        onGenerate={() => {
          submits += 1
          onGenerate()
        }}
        onDefaults={vi.fn()}
        onNewSeed={vi.fn()}
        hints={hints}
        onHintsChange={onHintsChange}
      />,
    )
  })
  return { onChange, onGenerate, onHintsChange, submitCount: () => submits }
}

function switchEl(): HTMLInputElement {
  const el = container.querySelector<HTMLInputElement>('[data-testid="hints-toggle"] input')
  if (el === null) throw new Error('the hints switch is not in the form')
  return el
}

function click(): void {
  act(() => {
    switchEl().click()
  })
}

describe('the hint switch field', () => {
  it('reflects the flag it is given, off and on', () => {
    mount(defaultDraft(), false)
    expect(switchEl().checked).toBe(false)
    act(() => root.unmount())
    root = createRoot(container)
    mount(defaultDraft(), true)
    expect(switchEl().checked).toBe(true)
  })

  it('is a switch, not a checkbox, so the on/off state is announced as one', () => {
    mount()
    expect(switchEl().getAttribute('role')).toBe('switch')
  })

  it('carries the dictionary label and the rule that off means the numbers only', () => {
    mount()
    const id = switchEl().id
    expect(container.querySelector(`label[for="${id}"]`)?.textContent).toBe(t.settings.hints.label)
    const describedBy = switchEl().getAttribute('aria-describedby')
    expect(describedBy).not.toBeNull()
    expect(container.querySelector(`#${describedBy}`)?.textContent).toBe(t.settings.hints.hint)
  })

  it('reports a turn and the direction of it', () => {
    const { onHintsChange } = mount()
    click()
    expect(onHintsChange).toHaveBeenCalledWith(true)
  })

  it('never reaches the draft, so flipping a hint cannot reprint the round', () => {
    const { onChange, onGenerate } = mount()
    click()
    expect(onChange).not.toHaveBeenCalled()
    expect(onGenerate).not.toHaveBeenCalled()
  })

  it('is not a submit: clicking it never prints a board', () => {
    const { submitCount } = mount()
    click()
    expect(submitCount()).toBe(0)
  })
})

describe('the hint preference', () => {
  it('reads an absent key as off, which is the whole point of the complaint', () => {
    const { result } = renderHook(() => useStoredFlag(t.storage.hints, false))
    expect(result.current[0]).toBe(false)
  })

  it('reads a stored turn-on back on the next visit', () => {
    window.localStorage.setItem(t.storage.hints, 'true')
    const { result } = renderHook(() => useStoredFlag(t.storage.hints, false))
    expect(result.current[0]).toBe(true)
  })

  it('round-trips both directions, so "off by default" is a default and not a one-way door', () => {
    const { result } = renderHook(() => useStoredFlag(t.storage.hints, false))
    act(() => result.current[1](true))
    expect(readStored(t.storage.hints)).toBe('true')
    act(() => result.current[1](false))
    expect(readStored(t.storage.hints)).toBe('false')
    const { result: reloaded } = renderHook(() => useStoredFlag(t.storage.hints, false))
    expect(reloaded.current[0]).toBe(false)
  })

  it('uses its own key, so it cannot collide with the theme or the panels', () => {
    expect(t.storage.hints).toBe('minegram.hints')
    expect(new Set(Object.values(t.storage)).size).toBe(Object.values(t.storage).length)
  })

  it('is described in both locales, with the same keys in each', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const copy = getCopy(locale)
      expect(copy.settings.hints.label.length).toBeGreaterThan(0)
      expect(copy.settings.hints.hint.length).toBeGreaterThan(0)
    }
  })
})
