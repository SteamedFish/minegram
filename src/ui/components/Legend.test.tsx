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
 * Four things are proved:
 *
 *   1. every rail swatch that claims a line state carries the board's own glyph span,
 *      with the character that state draws, and the span is the first child — none of
 *      those three entries carries a tape, and ClueCell's first child is the glyph. A
 *      legend that taught the edge without the bar is the defect.
 *   2. the two hint-layer entries say so, with the switch's own label, and the other
 *      ten do not. A gate that grows is a bug: the run highlight and the line's ✓ are
 *      the acknowledgement of the player's marking, not hints.
 *   3. the swatch is hidden from assistive technology, so the literal `3 ✕` is not
 *      read out as a fourth sentence beside an entry that already has two.
 *   4. the CLOSED run's tape — the one tape the board paints at BOTH settings — is
 *      keyed on the entry that already names the closed run, in the form the board
 *      paints (`data-run="complete"`), and on no other entry. It is the shape a
 *      2px confirm line on the board has to come from, and `runTape`'s pill saying
 *      提示 beside a solid line is the vocabulary the key used to get wrong.
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
      /* The glyph first, then the clue — ClueCell's order, and the whole child list
         for these three: they assert an OPEN run, whose tape is the gated shape and
         has a row of its own. `runComplete` carries the closed tape and is checked
         separately, because a swatch's first child is a claim about that too. */
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
    /* Deliberately not "the first child": this swatch also carries the closed run's
       tape, which comes first. What this test is about is the SPAN — a missing span
       would leave the entry unable to fill the strip clues.css paints for it. */
    expect(swatch?.querySelector('.mg-rail-cell__glyph')).not.toBeNull()
    /* Empty, because the board's is empty here: the strip is what clues.css fills. */
    expect(swatch?.querySelector('.mg-rail-cell__glyph')?.textContent).toBe('')
    expect(swatch?.hasAttribute('data-line-state')).toBe(false)
  })

  /* The closed run's tape is a second mark of the fact `runComplete` already names —
     the board's own cue calls it 「该段下方为实线下划线」 — so it is a CHILD of that
     swatch and not a thirteenth row. The order is a reading order: the tape is the
     underline the board draws, the numeral is what sits in the rail, and the player
     meets the underline first. It is not a paint order — the tape is absolutely
     positioned and out of flow, so it paints above the in-flow children either way. */
  it('keys the CLOSED run\'s tape on the entry that owns it, first in the swatch, in the board\'s own form', () => {
    const swatch = item('runComplete').querySelector<HTMLElement>('.mg-legend__swatch.mg-rail-cell')
    expect(swatch).not.toBeNull()
    const tape = swatch?.querySelector<HTMLElement>('.mg-run-tape') ?? null
    expect(tape).not.toBeNull()
    /* `complete`, never `tape`: the open form is the gated shape, and this entry is
       not a hint. Getting this backwards is the failure the gate named. */
    expect(tape?.getAttribute('data-run')).toBe('complete')
    /* The same two attributes `runTape`'s tape carries, minus the orientation a
       legend tape cannot own. */
    expect(tape?.getAttribute('data-cap')).toBe('only')
    expect(tape?.hasAttribute('data-orientation')).toBe(false)
    /* Tape, glyph, clue. */
    expect(swatch?.firstElementChild).toBe(tape)
    expect(swatch?.children[1]?.className).toBe('mg-rail-cell__glyph')
    expect(swatch?.children[2]?.className).toBe('mg-rail-cell__clue')
    /* One tape, so the shape is not printed twice. */
    expect(swatch?.querySelectorAll('.mg-run-tape')).toHaveLength(1)
  })

  /* The cut that decides the layer: `run.complete` is derived from the PLAYER's marks
     and `run.invariant` from the solution, and only the second is the machine talking.
     `RunGuides` therefore returns the closed tape at `hints === false`, so the key has
     to place it on an UNGATED entry — and to place the open one, and only the open one,
     on the gated row. */
  it('puts the closed tape on no other entry, the open tape on no other entry, and no gate on the run', () => {
    const carriers = (run: string): (string | null)[] =>
      legendItems()
        .filter((entry) => entry.querySelector(`.mg-run-tape[data-run=${run}]`) !== null)
        .map((entry) => entry.getAttribute('data-legend'))
    expect(carriers('complete')).toEqual(['runComplete'])
    expect(carriers('tape')).toEqual(['runTape'])
    /* Not a hint: no pill, and no gate attribute. */
    expect(item('runComplete').hasAttribute('data-legend-gate')).toBe(false)
    expect(item('runComplete').querySelector('.mg-legend__gate')).toBeNull()
    /* And there is no switch to turn inside the legend at all — `data-hints` belongs
       to the stage, and a legend that grew its own would be a second way to say it. */
    expect(container.querySelector('[data-hints]')).toBeNull()
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
