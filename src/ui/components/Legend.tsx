import type { Copy } from '../copy'

/**
 * The legend, in the right-hand aside.
 *
 * Every swatch is rendered with the SAME attribute the board uses, so the legend
 * cannot drift from the stylesheet: a legend entry is a claim about a selector, and
 * the cheapest way to keep that claim honest is to make it literally the selector.
 * Each entry pairs the shape with the words, because §0's second principle is that
 * colour is never the only channel — the legend has to teach the shape too.
 *
 * "The same attribute" is NOT enough, and this file used to believe that it was. The
 * three rail swatches carried `data-line-state` and no `.mg-rail-cell__glyph`, so the
 * legend taught the edge and the wash and never the FILLED BAR — which is the whole
 * of the loud form, and the whole answer to 「提示标志非常不明显」. A legend that
 * shows the quiet half of a shape teaches the quiet half, and a player meets the bar
 * on the rail having never been shown it. So the glyph span is rendered wherever
 * `ClueCell` renders one, in the same place among the children, and `RailSwatch`
 * exists so the three rail entries cannot fall out of step with each other — or with
 * the board — one edit at a time.
 *
 * The two annotation entries are the only shapes the board does not draw by default,
 * so the legend says which switch owns them: `data-legend-gate="hints"`, and the
 * switch's OWN label borrowed from `t.settings.hints.label` rather than retyped, so
 * the legend and the settings panel can never end up calling 提示 two different
 * things. The pill names the LAYER a shape belongs to and deliberately does not claim
 * what state the switch is in: the switch reports its own state, and a static "off"
 * printed here would become a lie the first time a player turned it on.
 */
export interface LegendProps {
  readonly t: Copy
}

const ENTRIES = [
  'unmarked',
  'confirmedMine',
  'confirmedEmpty',
  'wrongMine',
  'wrongBlank',
  'dragPreview',
  'runTape',
  'runComplete',
  'lineComplete',
  'contradiction',
  'unresolved',
  'revealed',
] as const

/* The hint layer, as the legend states it, and the cut is INFERENCE against
   ACKNOWLEDGEMENT: a member says something the MACHINE worked out that the player
   has not done, a non-member says something the PLAYER has done. So the two
   annotations are in it, and now so is the run's position tape — the player's own
   question decided that (「段落位置已定 这个应该也属于提示？」), because an open run's tape is
   the machine placing the run for them. What is NOT in it, and must not be: the
   CLOSED run's tape, the filled numeral and the line's ✓, all of which are keyed
   off the player's own marks. A gate that grows is a bug, so this is a named list
   rather than only a test's expectation — the test asserts this set exactly.

   `runTape` here is the swatch for the OPEN run's tape, `data-run="tape"`, which
   is the same element `RunGuides` renders. The CLOSED run's tape is not a legend
   entry of its own, and it is not missing from the key either: it is the first
   child of `runComplete`'s swatch, `data-run="complete"`, the same element the
   board renders. It is keyed there rather than given a row because it is a second
   mark of the SAME fact the entry already names — the board's cue calls it
   「该段下方为实线下划线」 / "a solid underline under the run" — and a key that
   spent a second row on the underline of the thing in the row above would read as
   though the two were separable. It is drawn in `RailSwatch`, which is where a rail
   cell's children are assembled; the gate itself lives in `RunGuides`. */
const HINT_GATED: ReadonlySet<string> = new Set(['contradiction', 'unresolved', 'runTape'])

export function Legend({ t }: LegendProps) {
  return (
    <section className="mg-legend" aria-labelledby="mg-legend-title">
      <h2 className="mg-legend__title" id="mg-legend-title">
        {t.legend.title}
      </h2>
      <p className="mg-legend__lead">{t.legend.lead}</p>
      <ul className="mg-legend__list">
        {ENTRIES.map((entry) => (
          <li
            className="mg-legend__item"
            key={entry}
            data-legend={entry}
            data-legend-gate={HINT_GATED.has(entry) ? 'hints' : undefined}
          >
            <LegendSwatch entry={entry} />
            <span className="mg-legend__name">{t.legend.entries[entry].name}</span>
            <span className="mg-legend__cue">{t.legend.entries[entry].cue}</span>
            {HINT_GATED.has(entry) ? (
              /* The switch's own name, so the two places that use the word agree. */
              <span className="mg-legend__gate">{t.settings.hints.label}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  )
}

/**
 * One swatch, rendered as a picture and hidden from assistive technology: the entry
 * beside it carries the words, and a swatch that a screen reader reads out would add
 * a third sentence saying something the first two already say — and, now that the
 * rail swatches carry a literal numeral and a literal mark, would say it in digits.
 */
function LegendSwatch({ entry }: { readonly entry: (typeof ENTRIES)[number] }) {
  switch (entry) {
    case 'unmarked':
      return <span className="mg-legend__swatch mg-cell" aria-hidden="true" data-state="unmarked" />
    case 'confirmedMine':
      return <span className="mg-legend__swatch mg-cell" aria-hidden="true" data-state="mine-locked" />
    case 'confirmedEmpty':
      return <span className="mg-legend__swatch mg-cell" aria-hidden="true" data-state="blank-locked" />
    case 'wrongMine':
      return <span className="mg-legend__swatch mg-cell" aria-hidden="true" data-state="wrong-mine" data-texture="hatch" />
    case 'wrongBlank':
      return <span className="mg-legend__swatch mg-cell" aria-hidden="true" data-state="wrong-blank" data-texture="hatch" />
    case 'dragPreview':
      return <span className="mg-legend__swatch mg-cell" aria-hidden="true" data-state="unmarked" data-preview="hit" />
    case 'runTape':
      return (
        <span className="mg-legend__swatch" aria-hidden="true">
          <span className="mg-run-tape" data-run="tape" data-cap="only" />
        </span>
      )
    case 'runComplete':
      /* The run completion signal lives ON the numeral, so the swatch is a rail cell
         carrying one closed run — the same attributes ClueCell renders. It also
         carries the CLOSED TAPE, which is the other mark a finished run draws: the
         board paints it under the run's cells, and a legend that showed only the
         numeral would leave a 2px confirm line on the board that no key explains. It
         is `complete`, never `tape`, because the OPEN form is the gated shape and
         this entry is not a hint. */
      return <RailSwatch tape="complete" />
    case 'lineComplete':
      return <RailSwatch lineState="complete" glyph="✓" />
    case 'contradiction':
      /* An OPEN run: a contradiction is a line that cannot be finished by marking,
         so the numeral is not a closed run's block here. */
      return <RailSwatch lineState="contradiction" runState="open" glyph="✕" />
    case 'unresolved':
      return <RailSwatch lineState="unknown" runState="open" glyph="?" />
    case 'revealed':
      return <span className="mg-legend__swatch mg-rail-cell" aria-hidden="true" data-revealed="true" />
    default:
      return <span className="mg-legend__swatch" aria-hidden="true" />
  }
}

/**
 * One rail clue, built from the SAME children `ClueCell` builds: the glyph span, then
 * the clue, one run, one numeral. The glyph is empty for `runComplete`, which asserts
 * a run and not a line state — the span is still rendered, because on the board it is
 * always rendered and that is what lets clues.css fill its strip.
 *
 * `tape` adds a child `ClueCell` does NOT have, and the asymmetry is the point. On the
 * board the closed run's tape is drawn by `RunGuides`, INSIDE a board cell and not
 * inside a rail cell at all; a legend swatch is a rail cell, so the tape is rendered
 * as its first child — the same element, the same class, the same `data-run` value the
 * board renders for a closed run, and nothing else. It is first because it is the
 * underline the board draws: reading the DOM, the mark that sits under the run comes
 * before the numeral that sits in the rail, which is the order a player meets them in.
 * It is not first for painting — the tape is absolutely positioned and out of flow, so
 * it paints above the in-flow children whichever way round the source is.
 *
 * The type admits ONLY `'complete'`. The open tape is the gated shape and it has its
 * own entry with a cell-shaped swatch, so there is no reading of this component that
 * wants it; a union would let a future entry print a 1px dotted line on a rail swatch
 * at `hints=off` with nothing in the key saying it is a hint.
 *
 * `runState` defaults to `complete`, because three of the four rail entries are about
 * a finished run; the two annotations pass `open` themselves.
 *
 * No `data-orientation`, following `runTape`'s tape: overlays.css gives a legend tape
 * its own edge rule because board.css's two orientation rules are keyed on that
 * attribute, and a square has no sides to be wrong about.
 *
 * The whole swatch is `aria-hidden`, where the board hides only the glyph and the
 * clue: a rail cell on the board carries an `aria-label` that spells the state, so
 * hiding its contents loses nothing, and a swatch has no label to carry — the entry's
 * `name` and `cue` are the description, and without this the literal `3 ✕` would be
 * read out as a fourth sentence.
 */
function RailSwatch({
  lineState,
  runState = 'complete',
  glyph = '',
  tape,
}: {
  readonly lineState?: 'complete' | 'contradiction' | 'unknown'
  readonly runState?: 'complete' | 'open'
  readonly glyph?: string
  /** The closed run's tape, or nothing. See the comment for why `tape` is not a value. */
  readonly tape?: 'complete'
}) {
  return (
    <span
      className="mg-legend__swatch mg-rail-cell"
      aria-hidden="true"
      data-line-state={lineState}
    >
      {tape === undefined ? null : (
        <span className="mg-run-tape" data-run="complete" data-cap="only" />
      )}
      <span className="mg-rail-cell__glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="mg-rail-cell__clue">
        <span className="mg-rail-cell__run">
          <span className="mg-rail-cell__numeral" data-run-state={runState}>
            3
          </span>
        </span>
      </span>
    </span>
  )
}
