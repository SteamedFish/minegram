import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Legend } from './Legend'
import { DEFAULT_LOCALE, getCopy } from '../copy'

/**
 * The legend's structural contract, and only what this file can see.
 *
 * jsdom has no layout, so nothing here measures a bar. What it CAN see is the reason
 * the bar went missing in the first place: a legend entry is a claim about a shape,
 * and the claim was carried by an ATTRIBUTE (`data-line-state`) while the loud part of
 * the shape is a CHILD (`.mg-rail-cell__glyph`). Deleting that child is invisible to
 * every rule on the board — the cascade matches what is there — and invisible to the
 * stylesheet, and visible only here and in a screenshot. So the assertions are on
 * the children the board renders, in the order the board renders them.
 *
 * Three things are proved:
 *
 *   1. every rail swatch that claims a line state carries the board's own glyph span,
 *      with the character that state draws, and the span is the FIRST child, because
 *      ClueCell's is. A legend that taught the edge without the bar is the defect.
 *   2. the two hint-layer entries say so, with the switch's own label, and the other
 *      ten do not. A gate that grows is a bug: the run highlight and the line's ✓ are
 *      the acknowledgement of the player's marking, not hints.
 *   3. the swatch is hidden from assistive technology, so the literal `3 ✕` is not
 *      read out as a fourth sentence beside an entry that already has two.
 */

const RAIL_GLYPHS: ReadonlyArray<readonly [string, string, string, string]> = [
  /* legend entry, data-line-state, the character ClueCell draws for it, the run state */
  ['lineComplete', 'complete', '✓', 'complete'],
  ['contradiction', 'contradiction', '✕', 'open'],
  ['unresolved', 'unknown', '?', 'open'],
]

let container: HTMLElement
let root: Root | null = null
const t = getCopy(DEFAULT_LOCALE)

function legendItems(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.mg-legend__item'))
}

function item(entry: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[data-legend=${entry}]`)
  if (found === null) {
    throw new Error(`the legend has no ${entry} entry`)
  }
  return found
}

describe('Legend', () => {
  beforeEach(() => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    act(() => {
      root?.render(<Legend t={t} />)
    })
  })

  afterEach(() => {
    act(() => {
      root?.unmount()
    })
    root = null
    container.remove()
  })

  it('renders twelve entries, each with a swatch, a name and a cue', () => {
    expect(legendItems()).toHaveLength(12)
    for (const entry of legendItems()) {
      expect(entry.querySelector('.mg-legend__swatch')).not.toBeNull()
      const name = entry.querySelector('.mg-legend__name')?.textContent ?? ''
      const cue = entry.querySelector('.mg-legend__cue')?.textContent ?? ''
      expect(name.length).toBeGreaterThan(0)
      expect(cue.length).toBeGreaterThan(0)
    }
  })

  it('gives every rail entry that claims a line state the board\'s own glyph span, first', () => {
    for (const [entry, state, glyph, runState] of RAIL_GLYPHS) {
      const swatch = item(entry).querySelector<HTMLElement>('.mg-legend__swatch.mg-rail-cell')
      expect(swatch).not.toBeNull()
      expect(swatch?.getAttribute('data-line-state')).toBe(state)
      /* Same children as ClueCell, in the same order: the glyph span, then the clue. */
      expect(swatch?.firstElementChild?.className).toBe('mg-rail-cell__glyph')
      expect(swatch?.querySelector('.mg-rail-cell__glyph')?.textContent).toBe(glyph)
      expect(swatch?.querySelector('.mg-rail-cell__clue')).not.toBeNull()
      expect(swatch?.querySelector('.mg-rail-cell__numeral')?.getAttribute('data-run-state')).toBe(
        runState,
      )
    }
  })

  it('renders the glyph span even where the entry asserts a run and not a line', () => {
    const swatch = item('runComplete').querySelector<HTMLElement>('.mg-legend__swatch.mg-rail-cell')
    expect(swatch?.firstElementChild?.className).toBe('mg-rail-cell__glyph')
    /* Empty, because the board's is empty here: the strip is what clues.css fills, and
       a missing span would leave the entry unable to show a strip at all. */
    expect(swatch?.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('')
    expect(swatch?.hasAttribute('data-line-state')).toBe(false)
  })

  it('hides the swatch from assistive technology', () => {
    for (const entry of legendItems()) {
      expect(entry.querySelector('.mg-legend__swatch')?.getAttribute('aria-hidden')).toBe('true')
    }
  })

  /* The layer is the annotations keyed off MACHINE INFERENCE — the two rail
     annotations and the open run's position tape — and the order here is the
     legend's own, so a fourth member cannot slip in at the end unnoticed. */
  it('names the hint layer on exactly the two annotations and the position tape, in the switch\'s own words', () => {
    const gated = legendItems().filter((entry) => entry.hasAttribute('data-legend-gate'))
    expect(gated.map((entry) => entry.getAttribute('data-legend'))).toEqual([
      'runTape',
      'contradiction',
      'unresolved',
    ])
    for (const entry of gated) {
      expect(entry.getAttribute('data-legend-gate')).toBe('hints')
      /* The switch's own label, not a second spelling of it. */
      expect(entry.querySelector('.mg-legend__gate')?.textContent).toBe(t.settings.hints.label)
    }
    /* And nothing else claims to be a hint: the CLOSED run's tape, the filled
       numeral and the line's ✓ are the acknowledgement of the player's own marking,
       and the player called that 必须做的. A gate that grows is a bug — which is why
       this list is the assertion and not a comment. */
    for (const entry of legendItems()) {
      if (entry.hasAttribute('data-legend-gate')) continue
      expect(entry.querySelector('.mg-legend__gate')).toBeNull()
    }
  })
})
