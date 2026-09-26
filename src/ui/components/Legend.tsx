import type { Copy } from '../copy'

/**
 * The legend, in the right-hand aside.
 *
 * Every swatch is rendered with the SAME attribute the board uses, so the legend
 * cannot drift from the stylesheet: a legend entry is a claim about a selector, and
 * the cheapest way to keep that claim honest is to make it literally the selector.
 * Each entry pairs the shape with the words, because §0's second principle is that
 * colour is never the only channel — the legend has to teach the shape too.
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

export function Legend({ t }: LegendProps) {
  return (
    <section className="mg-legend" aria-labelledby="mg-legend-title">
      <h2 className="mg-legend__title" id="mg-legend-title">
        {t.legend.title}
      </h2>
      <p className="mg-legend__lead">{t.legend.lead}</p>
      <ul className="mg-legend__list">
        {ENTRIES.map((entry) => (
          <li className="mg-legend__item" key={entry} data-legend={entry}>
            <LegendSwatch entry={entry} />
            <span className="mg-legend__name">{t.legend.entries[entry].name}</span>
            <span className="mg-legend__cue">{t.legend.entries[entry].cue}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function LegendSwatch({ entry }: { readonly entry: (typeof ENTRIES)[number] }) {
  switch (entry) {
    case 'unmarked':
      return <span className="mg-legend__swatch mg-cell" data-state="unmarked" />
    case 'confirmedMine':
      return <span className="mg-legend__swatch mg-cell" data-state="mine-locked" />
    case 'confirmedEmpty':
      return <span className="mg-legend__swatch mg-cell" data-state="blank-locked" />
    case 'wrongMine':
      return <span className="mg-legend__swatch mg-cell" data-state="wrong-mine" data-texture="hatch" />
    case 'wrongBlank':
      return <span className="mg-legend__swatch mg-cell" data-state="wrong-blank" data-texture="hatch" />
    case 'dragPreview':
      return <span className="mg-legend__swatch mg-cell" data-state="unmarked" data-preview="hit" />
    case 'runTape':
      return (
        <span className="mg-legend__swatch">
          <span className="mg-run-tape" data-run="tape" data-cap="only" />
        </span>
      )
    case 'runComplete':
      /* The run completion signal lives ON the numeral now, so the swatch is a
         rail cell carrying one closed run — the same attributes ClueCell renders. */
      return (
        <span className="mg-legend__swatch mg-rail-cell">
          <span className="mg-rail-cell__clue">
            <span className="mg-rail-cell__run">
              <span className="mg-rail-cell__numeral" data-run-state="complete">
                3
              </span>
            </span>
          </span>
        </span>
      )
    case 'lineComplete':
      return (
        <span className="mg-legend__swatch mg-rail-cell" data-line-state="complete">
          <span className="mg-rail-cell__clue">
            <span className="mg-rail-cell__run">
              <span className="mg-rail-cell__numeral" data-run-state="complete">
                3
              </span>
            </span>
          </span>
        </span>
      )
    case 'contradiction':
      return (
        <span className="mg-legend__swatch mg-rail-cell" data-line-state="contradiction">
          <span className="mg-rail-cell__clue">
            <span className="mg-rail-cell__run">
              <span className="mg-rail-cell__numeral" data-run-state="open">
                3
              </span>
            </span>
          </span>
        </span>
      )
    case 'unresolved':
      return (
        <span className="mg-legend__swatch mg-rail-cell" data-line-state="unknown">
          <span className="mg-rail-cell__clue">
            <span className="mg-rail-cell__run">
              <span className="mg-rail-cell__numeral" data-run-state="open">
                3
              </span>
            </span>
          </span>
        </span>
      )
    case 'revealed':
      return <span className="mg-legend__swatch mg-rail-cell" data-revealed="true" />
    default:
      return <span className="mg-legend__swatch" />
  }
}
