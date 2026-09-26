import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BoardEmptyState } from './BoardEmptyState'
import { DEFAULT_LOCALE, getCopy, type Locale } from '../copy'

/**
 * The board region's pre-generate state.
 *
 * `@testing-library/react` is deliberately not used, for the reason `App.test.tsx`
 * gives: every assertion here is a plain DOM read about the rendered contract, and
 * mounting through `createRoot` inside `act` proves the component needs nothing to be
 * driven.
 *
 * What is asserted is the SHAPE of the contract and nothing about layout, because jsdom
 * has no layout: the strings come from the dictionary in both locales, the decorative
 * glyph is hidden from assistive technology, the root carries the test id the app's
 * other selectors key off, and nothing of the board's own contract is left behind for
 * the drag controller or the grid roles to find.
 */

let container: HTMLElement
let unmount: (() => void) | null = null

function render(locale: Locale = DEFAULT_LOCALE): void {
  const root = createRoot(container)
  act(() => {
    root.render(<BoardEmptyState t={getCopy(locale)} />)
  })
  unmount = () => {
    act(() => {
      root.unmount()
    })
  }
}

function one(selector: string): Element {
  const found = container.querySelectorAll(selector)
  expect(found.length).toBe(1)
  return found[0] as Element
}

/**
 * Every text node a screen reader would reach, joined by a space.
 *
 * `textContent` is the wrong instrument twice over here: it includes the decorative
 * glyph, which `aria-hidden` takes out of the accessibility tree but not out of the
 * DOM, and JSX drops the whitespace between sibling elements, so adjacent strings
 * run together. Skipping `aria-hidden` subtrees and joining the survivors is what
 * "the only visible text" actually means.
 */
function spokenText(root: Node): string {
  const parts: string[] = []
  const walk = (node: Node): void => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).getAttribute('aria-hidden') === 'true') return
    }
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = (child.nodeValue ?? '').replace(/\s+/g, ' ').trim()
        if (text !== '') parts.push(text)
      } else {
        walk(child)
      }
    }
  }
  walk(root)
  return parts.join(' ')
}

beforeEach(() => {
  // The same line `App.test.tsx` sets, for the same reason: without it React warns
  // that the testing environment is not configured to support `act`.
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  if (unmount !== null) {
    unmount()
    unmount = null
  }
  container.remove()
})

describe('BoardEmptyState', () => {
  it('renders the dictionary strings, in order, as the only visible text', () => {
    render()
    const t = getCopy(DEFAULT_LOCALE)
    const spoken = spokenText(container)
    expect(spoken).toBe(`${t.board.empty.title} ${t.board.empty.body} ${t.board.empty.hint}`)
    // The order is the dictionary's — title, explanation, hint — and each string is
    // said once, so the card cannot gain a stray duplicate of its own copy.
    expect(spoken.indexOf(t.board.empty.title)).toBe(0)
    expect(spoken.indexOf(t.board.empty.body)).toBe(t.board.empty.title.length + 1)
    expect(spoken.split(t.board.empty.hint)).toHaveLength(2)
  })

  it('is a plain region, not a live one', () => {
    render()
    const root = one('.mg-board-empty')
    expect(root.getAttribute('data-testid')).toBe('board-empty')
    // §6.2 gives the app ONE polite region and the status strip already owns it. A
    // placeholder that announced itself would talk over "READY" and over every mark.
    expect(root.getAttribute('aria-live')).toBeNull()
    expect(root.getAttribute('role')).toBeNull()
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('hides the decorative glyph and its fold from assistive technology', () => {
    render()
    const glyph = one('.mg-board-empty__glyph')
    expect(glyph.getAttribute('aria-hidden')).toBe('true')
    // The mark and the fold, and nothing else: no text of its own can leak.
    expect(glyph.querySelectorAll('*')).toHaveLength(2)
    expect(glyph.textContent).toBe('◆')
  })

  it('gives the title a heading so the region is reachable by landmark', () => {
    render()
    const title = one('.mg-board-empty__title')
    expect(title.tagName).toBe('H2')
    expect(title.textContent).toBe(getCopy(DEFAULT_LOCALE).board.empty.title)
  })

  it('speaks 简体中文 when the locale says so', () => {
    render('zh-CN')
    const zh = getCopy('zh-CN')
    const en = getCopy(DEFAULT_LOCALE)
    expect(one('.mg-board-empty__title').textContent).toBe(zh.board.empty.title)
    expect(zh.board.empty.title).not.toBe(en.board.empty.title)
    expect(one('.mg-board-empty__hint').textContent).toBe(zh.board.empty.hint)
  })

  it('leaves none of the board contract behind', () => {
    render()
    // A board region with no board must not leave the board's hooks lying around for
    // anything to find: no grid, no cell, no rail, and nothing the drag controller's
    // `cellIndexAt` resolves an index from.
    expect(container.querySelector('[role="grid"]')).toBeNull()
    expect(container.querySelector('[data-cell-index]')).toBeNull()
    expect(container.querySelector('.mg-board-stage')).toBeNull()
    expect(container.querySelector('.mg-board-column-reveal')).toBeNull()
  })
})
