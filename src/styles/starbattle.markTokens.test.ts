import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { STAR_MARK_TOKENS } from '../ui/components/starMarkTokens'

/**
 * The data-mark contract, both directions:
 *
 *   component → sheet   every token displayMark can emit (STAR_MARK_TOKENS,
 *                       the single source of truth the component's return
 *                       type derives from) has at least one rule in
 *                       starbattle.css
 *   sheet → component   every [data-mark='X'] selector in the sheet names a
 *                       token the component can emit
 *
 * The bug this pins: the component renamed its locked tokens to
 * locked-star/locked-blank while the sheet still keyed on a bare 'locked' —
 * every locked rule was dead, locked cells silently lost their glyph sizing
 * and confirm ring, and nothing failed a gate because CSS rot is invisible
 * to typecheck, vitest, and the browser console alike.
 *
 * The structural pins go further and record the design decision: blank and
 * locked-blank share ONE rule (a game-filled cell must read exactly like a
 * player-filled one), and only locked-star carries the confirm ring — the
 * ring acknowledges the player's correct mark, not the game's own fill, and
 * ringing every auto-filled blank would paint the board the moment one star
 * lands.
 */

/* Same fs access pattern as starbattle.palette.test.ts — see the comment
   there for why node:fs arrives through process.getBuiltinModule. */
interface FsLike {
  readFileSync(path: string, encoding: 'utf8'): string
}
const runtime = globalThis as { process?: { getBuiltinModule?(id: 'node:fs'): FsLike } }
if (runtime.process?.getBuiltinModule === undefined) {
  throw new Error('node:fs unavailable in this test runtime')
}
const css: string = runtime.process.getBuiltinModule('node:fs').readFileSync('src/styles/starbattle.css', 'utf8')

const root = postcss.parse(css)

/** Every selector in the sheet, flattened out of comma groups. */
const selectors: string[] = []
root.walkRules((rule) => {
  for (const part of rule.selector.split(',')) {
    selectors.push(part.trim())
  }
})

const styledTokens = new Set<string>()
for (const m of css.matchAll(/\[data-mark='([^']+)'\]/g)) {
  styledTokens.add(m[1])
}

describe('starbattle data-mark contract', () => {
  it('the component and the sheet agree on the token vocabulary, both directions', () => {
    const emitted = new Set<string>(STAR_MARK_TOKENS)
    for (const token of emitted) {
      expect(
        styledTokens.has(token),
        `token '${token}' is emitted by the component but has no rule in starbattle.css`,
      ).toBe(true)
    }
    for (const token of styledTokens) {
      expect(
        emitted.has(token),
        `selector [data-mark='${token}'] exists in starbattle.css but the component never emits it`,
      ).toBe(true)
    }
  })

  it('blank and locked-blank share one rule, so a game-filled cell reads exactly like a player-filled one', () => {
    const sharing = root.nodes.filter(
      (node) =>
        node.type === 'rule' &&
        node.selector.includes("[data-mark='blank']") &&
        node.selector.includes("[data-mark='locked-blank']"),
    )
    expect(sharing.length, 'blank and locked-blank must be styled by the SAME rule').toBeGreaterThan(0)
  })

  it('only locked-star carries the confirm ring; locked-blank never does', () => {
    const ringed = selectors.filter(
      (selector) => selector.includes("[data-mark='locked-star']") && !selector.includes('__glyph'),
    )
    expect(ringed.length, 'locked-star must have its confirm-ring rule').toBeGreaterThan(0)
    for (const rule of root.nodes) {
      if (rule.type !== 'rule') continue
      const ringDecl = rule.nodes.find(
        (d) => d.type === 'decl' && d.prop === 'box-shadow' && d.value.includes('--confirm'),
      )
      if (ringDecl !== undefined) {
        expect(
          rule.selector.includes("[data-mark='locked-blank']"),
          'locked-blank must not carry the confirm ring — the ring acknowledges the player, not the fill',
        ).toBe(false)
      }
    }
  })
})
