// Committed static guard for the style lane, run by `npm run verify:styles`
// (and as the first half of `npm test`).
//   node scripts/style-check.mjs
// 1. every sheet parses as CSS
// 2. every var(--x) referenced is defined by tokens.css, base.css, or one of the
//    six sheets this lane wrote
// 3. the §7.2 ceiling: no ID selectors, no element selectors, no chain deeper
//    than two compounds, and no !important outside a reduced-motion block
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import postcss from 'postcss'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const MINE = ['layout', 'board', 'clues', 'forms', 'overlays', 'starbattle', 'screens']
const BASE = ['tokens', 'base']
const read = (f) => readFileSync(join(root, 'src/styles', `${f}.css`), 'utf8')

let fail = 0
const bad = (msg) => {
  fail += 1
  console.log(`  FAIL ${msg}`)
}
const inReducedMotion = (node) => {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && p.name === 'media' && /prefers-reduced-motion/.test(p.params)) return true
  }
  return false
}

// --- 1. parse -----------------------------------------------------------------
console.log('1. parse')
const trees = {}
for (const f of [...BASE, ...MINE]) {
  try {
    trees[f] = postcss.parse(read(f), { from: `src/styles/${f}.css` })
    console.log(`  ok   src/styles/${f}.css`)
  } catch (e) {
    bad(`${f}.css: ${e.reason} at ${e.line}:${e.column}`)
  }
}

// --- 2. custom property graph --------------------------------------------------
// §7.2 allows exactly the board's own geometry to be set inline, by the board
// component, on the stage.
// `--k` is the column index a `.mg-board-column-reveal` strip is given inline by
// `BoardSurface`, and it has to be a custom property because
// `grid-column: calc(var(--k) + 1)` is the only way to place a strip on a grid line
// from CSS alone.
// `--rail-slots`, `--rail-digits` and `--rail-runs` are COUNTS, not lengths: the
// host reads them off the round's own clues and the CSS decides what each one
// spends. `--rail-col` and `--rail-band` are the two lengths they buy, and they
// are deliberately NOT host-set — three grids (the stage and every board row) have
// to resolve one identical width, and only a single declaration can guarantee that.
const HOST = new Set([
  '--cols',
  '--rows',
  '--cell',
  '--k',
  '--rail-slots',
  '--rail-digits',
  '--rail-runs',
])

const defined = new Set()
for (const f of [...BASE, ...MINE]) {
  trees[f]?.walkDecls((d) => {
    if (d.prop.startsWith('--')) defined.add(d.prop)
  })
}
console.log(`\n2. custom properties\n  ${defined.size} declared across ${BASE.length + MINE.length} sheets`)

for (const f of MINE) {
  const missing = new Set()
  const host = new Set()
  trees[f]?.walkDecls((d) => {
    for (const m of d.value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
      if (defined.has(m[1])) continue
      if (HOST.has(m[1])) host.add(m[1])
      else missing.add(m[1])
    }
  })
  if (missing.size === 0) {
    const h = host.size === 0 ? '' : ` (${[...host].sort().join(', ')} supplied inline by the stage)`
    console.log(`  ok   ${f}.css — every var() resolves${h}`)
  } else bad(`${f}.css references undefined: ${[...missing].sort().join(', ')}`)
}

// --- 3. the ceiling -----------------------------------------------------------
console.log('\n3. ceiling')
for (const f of MINE) {
  const issues = []
  let maxDepth = 0
  trees[f]?.walkRules((rule) => {
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    for (const sel of rule.selectors) {
      if (sel.includes('#')) issues.push(`ID selector: ${sel}`)
      if (!inReducedMotion(rule)) {
        rule.walkDecls((d) => {
          if (d.important) issues.push(`!important on \`${d.prop}\` in: ${sel}`)
        })
      }
      // `nth-*()` takes a formula, never a tag: its arguments are removed first, so
      // the `n` of `nth-child(n + 7)` is not read as an element and the `+` inside
      // it is not read as a combinator.
      const eless = sel.replace(/:nth-(child|last-child|of-type)\([^()]*\)/g, ':nth')
      // Strip the arguments of functional pseudo-classes: they are their own
      // selector lists, checked for element selectors but not for chain depth.
      // One level of nesting is allowed inside them, because `:has()` routinely
      // wraps an `An+B` formula — `:has(:nth-child(7))` — and without the nesting
      // the strip silently failed and a combinator inside `:has()` was charged to
      // the rule as chain depth.
      const bare = eless.replace(/:(is|not|where|has)\((?:[^()]|\([^()]*\))*\)/g, ':fn')
      const parts = bare.split(/\s*[>+~]\s*|\s+/).filter(Boolean)
      maxDepth = Math.max(maxDepth, parts.length)
      if (parts.length > 2) issues.push(`chain of ${parts.length} compounds: ${sel}`)
      for (const part of eless.split(/[\s>+~(),]+/).filter(Boolean)) {
        if (/^[a-z][a-z0-9]*$/.test(part) || part === '*') {
          issues.push(`element selector \`${part}\` in: ${sel}`)
        }
      }
    }
  })
  if (issues.length === 0) {
    console.log(`  ok   ${f}.css — no id, no element, no !important, deepest chain ${maxDepth}`)
  } else {
    for (const i of [...new Set(issues)]) bad(`${f}.css ${i}`)
  }
}

// --- 4. every animation and transition is neutralised in its OWN file ---------
// §7.3 keeps the motion budget honest by making each file that spends motion
// also carry the block that spends none of it. base.css's blanket !important
// block is the floor, not the answer: a sheet that animates something the blanket
// does not reach — a background-position sweep, a custom-property gate — has to
// stop it itself.
console.log('\n4. motion')
const classesOf = (sel) => (sel.match(/\.[a-z][a-z0-9_-]*/gi) ?? []).map((c) => c.toLowerCase())
for (const f of MINE) {
  const animated = new Map()
  const calm = []
  trees[f]?.walkRules((rule) => {
    const reduced = inReducedMotion(rule)
    if (reduced) {
      for (const s of rule.selectors) calm.push(...classesOf(s))
      return
    }
    if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return
    let moves = false
    rule.walkDecls((d) => {
      if (d.prop === 'transition' || d.prop === 'animation') {
        if (!/^(none|0s|0ms)\b/.test(d.value)) moves = true
      }
      if (d.prop === 'animation' && /mg-/.test(d.value)) moves = true
    })
    if (moves) for (const s of rule.selectors) animated.set(s, classesOf(s))
  })
  const orphans = []
  for (const [sel, cls] of animated) {
    const covered =
      cls.length === 0 ||
      cls.some((c) => calm.includes(c)) ||
      calm.includes('*') ||
      calm.some((c) => c === '.mg-app' || c === '.mg-cell')
    if (!covered) orphans.push(sel)
  }
  if (orphans.length === 0) {
    console.log(`  ok   ${f}.css — ${animated.size} moving rules, all covered by its own block`)
  } else bad(`${f}.css moves with nothing in its reduced-motion block: ${orphans.join(' | ')}`)
}

// --- 8. the board-pane geometry, the three facts a DOM test cannot see ---------
// jsdom loads no stylesheet, so `getComputedStyle` reports every authored value as its
// initial one, and `import.meta.glob('../../styles/board.css', { query: '?raw' })`
// resolves to an EMPTY string under this vitest config. Reading the sheet is therefore
// the only way these can be guarded at all — and reading the PARSED sheet, because these
// sheets carry long comment blocks that quote the very declarations being checked, and a
// regex over the raw text happily matches a comment that explains the wrong value.
console.log('8. board-pane geometry')
{
  // `topLevel` reads only the rules at the root of the sheet, i.e. the RESTING
  // answer rather than the last one authored. A band inside an at-rule is a
  // deliberate second answer and a last-wins merge cannot tell it from a bug: the
  // short-landscape band (section 15) drops the pane's cap on purpose, so a check
  // that wants the resting cap has to say so.
  const declsOf = (file, selector, exact = false, topLevel = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      if (topLevel && rule.parent.type !== 'root') return
      const hit = exact
        ? rule.selectors.length === 1 && rule.selectors[0] === selector
        : rule.selectors.some((s) => s.includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const prop = (file, name) => {
    let found = null
    trees[file].walkAtRules('property', (a) => {
      if (a.params.trim() === name) found = a
    })
    if (!found) return null
    const out = { syntax: null, initial: null }
    found.walkDecls((d) => {
      if (d.prop === 'syntax') out.syntax = d.value
      if (d.prop === 'initial-value') out.initial = d.value
    })
    return out
  }
  const need = (label, ok, detail = '') => {
    if (ok) console.log(`  ok   ${label}`)
    else bad(`${label}${detail ? ` — ${detail}` : ''}`)
  }
  const eq = (label, actual, expected) =>
    need(label, actual === expected, `expected \`${expected}\`, found \`${actual ?? 'nothing'}\``)

  const tokenValue = (name) => {
    let found = null
    trees.tokens.walkRules((rule) => {
      if (rule.selector !== ':root') return
      rule.walkDecls((d) => {
        if (d.prop === name && found === null) found = d.value
      })
    })
    return found
  }
  const scroll = declsOf('board', '.mg-board-scroll', false, true)
  // The cap is the whole argument against a resize loop. `--cell`, `--rows` and `--cols`
  // are written INLINE ON THE STAGE, which is this box's child, so a cap in any of them
  // is invalid at computed-value time and silently drops to `none`.
  // The cap is still a VIEWPORT FRACTION, but the value is no longer written here:
  // the small-screen band retunes it from tokens (section 13), so a check that read
  // the pane's own text would be a check of where the number lives, not of what it
  // is. What is pinned is the value and the fact that the pane spends the token.
  eq('pane cap is the token the band retunes', scroll['max-block-size'], 'var(--board-cap)')
  need(
    'and the token it spends is still the viewport fraction, never a px constant',
    /^min\(70vh,\s*46rem\)$/.test(tokenValue('--board-cap') ?? ''),
    tokenValue('--board-cap'),
  )
  for (const v of ['--cell', '--rows', '--cols']) {
    need(`pane cap reads no ${v}`, !(scroll['max-block-size'] ?? '').includes(v), scroll['max-block-size'])
  }
  // The stage is the containing block the column strip's absolute overlay needs.
  eq(
    'stage is a containing block',
    declsOf('board', '.mg-board-stage', true)['position'],
    'relative',
  )
  // The strip takes its own grid line from --k, and is OUT of flow. Both halves were
  // measured in the running app, not reasoned about: an in-flow strip at grid-row 2
  // pushes every auto-placed cell row into implicit tracks (stage 563px/16 tracks →
  // 1043px/31), and an abspos strip with auto insets resolves to 0x0, with `inset: 0`
  // but auto sizes to the end of the row (480px wide at column 0). Only the measured
  // combination puts a 32x480 box at the cell's own left edge on a stage that stayed
  // 563px tall.
  const strip = declsOf('board', '.mg-board-column-reveal', true)
  eq('strip is out of flow', strip['position'], 'absolute')
  eq('strip fills the grid area it is given', strip['inset'], '0')
  eq('strip takes grid-row 2 / -1', strip['grid-row'], '2 / -1')
  eq('strip takes its line from --k, past the rail column', strip['grid-column'], 'calc(var(--k) + 2)')
  eq('strip is one board column wide', strip['inline-size'], 'var(--cell)')
  eq('strip is every cell row tall', strip['block-size'], 'calc(var(--rows) * var(--cell))')
  // The reveal alpha is animated, so it has to be registered as a number or the
  // keyframe flips 0 → 1 in a single frame.
  const alpha = prop('tokens', '--line-reveal-alpha')
  eq('reveal alpha is registered as a number', alpha?.syntax, "'<number>'")
  eq('reveal alpha starts finished', alpha?.initial, '1')
  // The wash is a colour, and it multiplies the alpha INSIDE color-mix() — the carrier
  // re-declares it, which is the only reason the animation can drive it.
  need(
    'the reveal carrier re-declares the wash from the alpha',
    // `color-mix(` takes a nested `calc(`, so this cannot be a `[^)]*` class: the first
    // `)` it meets belongs to the `calc()`, and the check would read as a non-match.
    /--line-reveal-wash\s*:\s*color-mix\([\s\S]*?var\(--line-reveal-alpha\)/.test(trees.board.toString()),
  )
  // The empty region is the one place the pane may be taller than a board.
  eq(
    'empty region claims a minimum height',
    declsOf('board', '.mg-board-empty', true)['min-block-size'],
    'min(56vh, 28rem)',
  )
  // Reduced motion is LAST in its file, and it must still both reveal carriers or the
  // reveal animation is the one thing left moving for a player who asked it to stop.
  const ats = []
  trees.board.walkAtRules('media', (a) => ats.push(a))
  const last = ats[ats.length - 1]
  const motion = ats.findIndex((a) => /prefers-reduced-motion:\s*reduce/.test(a.params))
  need('reduced-motion block is last in board.css', motion === ats.length - 1, `${motion + 1} of ${ats.length}`)
  const stilled = new Set()
  for (const d of last.nodes.filter((n) => n.type === 'rule'))
    if (/\banimation:\s*none/.test(d.toString())) d.selectors.forEach((s) => stilled.add(s))
  for (const carrier of ['mg-board-row', 'mg-board-column-reveal']) {
    need(
      `reduced motion stills ${carrier}`,
      [...stilled].some((s) => s.includes(carrier)),
    )
  }
  // Every keyframe named in the reveal rule has to exist, or the animation is a
  // reference to nothing and the steady state is the only thing a player ever sees.
  const frames = new Set()
  trees.board.walkAtRules(/keyframes$/i, (a) => frames.add(a.params))
  const named = trees.board.toString().match(/animation:\s*([a-z-]+)\s+var\(/g) ?? []
  for (const n of named) {
    const key = n.match(/animation:\s*([a-z-]+)/)[1]
    need(`keyframes ${key} is defined`, frames.has(key))
  }
}

// --- 9. the rail, read off the round's own clues --------------------------------
// The player report: a 15x15 at 60% drew `1 1 1 1 1 2 1 3 2 2 2` in one rail cell
// at 9px, and a 24x24 dropped 14% of its column runs and 34% of its row runs behind
// a `display: none`. Everything here is the half of that a DOM test cannot see: the
// sheet side of the two budgets, the numeral floor, and the absence of the
// truncation and the separator glyph that caused it.
console.log('9. rail legibility')
{
  // `topLevel` reads only the rules at the root of the sheet, i.e. the RESTING
  // answer rather than the last one authored. A band inside an at-rule is a
  // deliberate second answer and a last-wins merge cannot tell it from a bug: the
  // short-landscape band (section 15) drops the pane's cap on purpose, so a check
  // that wants the resting cap has to say so.
  const declsOf = (file, selector, exact = false, topLevel = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      if (topLevel && rule.parent.type !== 'root') return
      const hit = exact
        ? rule.selectors.length === 1 && rule.selectors[0] === selector
        : rule.selectors.some((s) => s.includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const need = (label, ok, detail = '') => {
    if (ok) console.log(`  ok   ${label}`)
    else bad(`${label}${detail ? ` — ${detail}` : ''}`)
  }
  const rootDecl = (name) => {
    let found = null
    trees.tokens.walkRules((rule) => {
      if (rule.selector !== ':root') return
      rule.walkDecls((d) => {
        if (d.prop === name && found === null) found = d.value
      })
    })
    return found
  }

  // The numeral's floor IS the fix. 10px is the stated legibility line; 9px was the
  // reported defect, so anything that can answer 9 again is a regression.
  //
  // SUPERSEDED: this used to demand a FLAT 10px, and the reason it was flat is
  // worth keeping — "a flat numeral is what closes the fit loop, because
  // --rail-band and --rail-col are then a function of the round's clues alone, so
  // the host's fit measure cannot chase its own output." The numeral now SCALES with
  // --cell so the xl/xxl zoom steps draw type worth reading, which puts the rail's two
  // costs back into the loop. The loop is ITERATED to a fixed point instead
  // (`settleFitCell`), and the fit charge now includes the chrome the stage spends on
  // itself (`stageChrome`) — which is what makes it converge. A clamp keeps the floor
  // the old flat value enforced, and a 20px ceiling keeps the 72px cell from paying
  // for a 21.6px numeral. See section 12.
  // The FLOOR is a token now (section 13), because 「放大游戏区域不放大数字格子」 was a
  // floor written as a constant: the ratio beside it could not reach 10px on a board
  // that fits a tablet, so the clamp returned its constant every time. So this checks
  // the two halves where they live — the formula spends the token, the token carries
  // the number, and the number is still 10px by default.
  const railNum = rootDecl('--rail-num')
  const railFloor = rootDecl('--rail-num-floor')
  const railRatio = rootDecl('--rail-num-ratio')
  need('the rail numeral is a clamp, not a flat 10px any more', /^clamp\(/.test(railNum ?? ''), `found \`${railNum}\``)
  need(
    'and the clamp spends the floor token rather than a literal, so a band can move the legibility line in one place',
    /var\(--rail-num-floor\)/.test(railNum ?? ''),
    railNum,
  )
  // The floor is a RAMP now (a `clamp` of its own, in the window's block space),
  // so `parseFloat` on it returns NaN. The claim being pinned is unchanged and
  // is now stronger: the ramp never goes UNDER 10px, and it tops out at the 12px
  // the two now-deleted small-screen bands used to hand out by width.
  need(
    'the rail numeral never falls below the 10px legibility line by default',
    /^clamp\(\s*10px\s*,/.test(railFloor ?? ''),
    railFloor,
  )
  need(
    'and the ramp it is a ramp of tops out at the 12px those two bands used to spell out by width',
    /clamp\([^,]*,[^,]*,\s*12px\)$/.test((railFloor ?? '').replace(/\s+/g, ' ').trim()),
    railFloor,
  )
  need(
    'and the ratio beside it is a real number a band can raise, not a decorative one',
    Number.isFinite(Number.parseFloat(railRatio ?? '')) && Number.parseFloat(railRatio) > 0,
    railRatio,
  )
  need(
    'the rail numeral has a hard ceiling at or under 20px, so a 72px cell does not pay for a 21.6px numeral',
    Number.parseFloat((railNum ?? '').slice((railNum ?? '').lastIndexOf(',') + 1)) <= 20,
    railNum,
  )
  need(
    "the rail numeral reads --cell, which is why the fit loop is iterated (§12 checks the stage's copy)",
    /var\(\s*--cell/.test(railNum ?? ''),
    railNum,
  )

  // Both rail budgets are lengths in a `calc()` over a host-written COUNT, and both
  // are re-declared on the stage so they see the real count and not :root's fallback.
  const stage = declsOf('board', '.mg-board-stage', true)
  for (const [label, name] of [
    ['the band', '--rail-band'],
    ['the row rail track', '--rail-col'],
  ]) {
    const v = stage[name] ?? ''
    need(`${label} is a calc() over a host count`, /calc\(/.test(v) && /var\(--rail-/.test(v), v)
    need(
      `${label} is re-declared on the stage (it reads a host count)`,
      v.length > 0,
      'only inherited from :root, so it carries :root\'s fallback count',
    )
  }
  need(
    'the band is sized from the column clue\'s run count',
    /var\(--rail-slots\)/.test(stage['--rail-band'] ?? ''),
    stage['--rail-band'],
  )
  need(
    'the row rail track counts NUMERALS, not runs',
    /var\(--rail-digits\)/.test(stage['--rail-col'] ?? ''),
    stage['--rail-col'],
  )
  need(
    'the row rail track pays for its gutters',
    /var\(--rail-run-gap\)/.test(stage['--rail-col'] ?? ''),
    stage['--rail-col'],
  )

  // THE ALIGNMENT INVARIANT. The stage and every board row are three separate grids
  // and each states this template itself, so the row rail's track has to be the same
  // LENGTH in all of them. A `max-content` first track was measured at 86.5781px on
  // the stage, 73px in the board rows and 3px in the rails row, which put every
  // column clue 70.1px left of its own column.
  const stageCols = declsOf('board', '.mg-board-stage', true)['grid-template-columns']
  need(
    'the stage reads the shared row-rail length',
    (stageCols ?? '').startsWith('var(--rail-col) '),
    stageCols,
  )
  const rowCols = declsOf('board', '.mg-board-row', true)['grid-template-columns']
  need(
    'a board row reads the same shared length',
    rowCols === stageCols,
    `row \`${rowCols}\` vs stage \`${stageCols}\``,
  )
  need(
    'no grid uses a content-sized first track',
    !/^max-content/.test(rowCols ?? '') && !/^max-content/.test(stageCols ?? ''),
    `row \`${rowCols}\``,
  )

  // The clipping that dropped the runs. `display: none` on a run, or any `:has()`
  // ellipsis standing in for a run, is the reported defect's second half.
  const clues = trees.clues
  const hidden = []
  clues.walkDecls('display', (d) => {
    if (d.value === 'none') hidden.push(d.parent.toString())
  })
  need(
    'clues.css hides nothing at all (no truncated run, no dropped glyph)',
    hidden.length === 0,
    hidden.join(' | '),
  )
  need(
    'clues.css prints no ellipsis in place of a run',
    !/content:\s*['"]?\\2026/.test(clues.toString()),
  )
  need(
    'clues.css prints no run-count cap',
    !/nth-child\(n\s*\+\s*\d/.test(clues.toString()),
  )

  // The separator glyph. It cost 5.7px per run and 2.73px of centre offset; the
  // grouping is now `--rail-run-gap` plus the per-run underline.
  need(
    'the separator glyph is gone from the sheet',
    !/mg-rail-cell__separator/.test(clues.toString()),
  )
  need(
    'the gutter between runs is declared',
    /gap:\s*var\(--rail-run-gap\)/.test(clues.toString()),
  )
  need(
    'the per-run underline still groups a run (the second channel)',
    /box-shadow:\s*inset/.test(clues.toString()) && /mg-rail-cell__run/.test(clues.toString()),
  )
  need(
    'a run-complete numeral still carries a hook clues.css can bind to',
    /\[data-run-state='complete'\]/.test(clues.toString()),
  )
}

// --- 10. the hint layer's ON state ---------------------------------------------
// The second player report: hints are on by default and their marker is too
// subtle to see. The fix is a SHAPE — a closed run's numeral is its own box filled
// solid confirm with the digit knocked out, a closed line fills its badge strip —
// and the only place that can be guarded is here, because a committed vitest test
// cannot read a stylesheet in this project (`?raw` and `?inline` both resolve to
// an empty string under the test config; verified twice). So: four custom
// properties carry the whole treatment, one attribute turns it off, and these
// checks exist to make a revert of any of it loud rather than silent.
console.log('10. the hint layer ON state')
{
  const flat = (s) => s.replace(/\s+/g, ' ').trim()
  const declsOf = (file, selector, exact = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      const hit = exact
        ? rule.selectors.map(flat).includes(flat(selector))
        : rule.selectors.some((s) => flat(s).includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const need = (label, ok, detail = '') => {
    if (ok) console.log(`  ok   ${label}`)
    else bad(`${label}${detail ? ` — got \`${detail}\`` : ''}`)
  }
  const clues = trees.clues
  const ON = [
    '--clue-on-ground',
    '--clue-numeral-ink',
    '--clue-badge-ink',
    '--clue-on-weight',
    '--clue-on-line-weight',
    '--clue-on-badge-weight',
    '--clue-on-badge-size',
    '--clue-on-radius',
    '--clue-on-edge',
    '--clue-on-run-mark',
  ]
  // The vocabulary lives in tokens.css, so the theme switch happens once and the
  // legend — which sits outside the stage — keeps the loud form for free.
  const rootOn = {}
  trees.tokens.walkDecls((d) => {
    if (ON.includes(d.prop)) rootOn[d.prop] = d.value
  })
  need('tokens.css names all nine ON values', ON.every((p) => p in rootOn), JSON.stringify(rootOn))
  need(
    "the ON ground is the theme's confirm, not a wash",
    rootOn['--clue-on-ground'] === 'var(--confirm)',
    rootOn['--clue-on-ground'],
  )
  need(
    "a knocked-out digit is the rail's own surface (8.1:1 light / 6.6:1 dark)",
    rootOn['--clue-numeral-ink'] === 'var(--surface-1)' &&
      rootOn['--clue-badge-ink'] === 'var(--surface-1)',
    `${rootOn['--clue-numeral-ink']} / ${rootOn['--clue-badge-ink']}`,
  )
  need(
    "the closed run's underline is an INSET SHADOW token, so OFF can be its resting self",
    /^inset 0 calc\(var\(--rule-w-heavy\) \* -1\) 0 var\(--confirm\)$/.test(
      rootOn['--clue-on-run-mark'] ?? '',
    ),
    rootOn['--clue-on-run-mark'],
  )

  // The switch, which is the two ANNOTATIONS and nothing else. The player's
  // second correction: the run highlight and the tick are 必须做的, so no
  // `[data-hints='off']` rule may reach them, and "off" has to mean an annotated
  // line is treated as an ordinary line — no dashed edge, no wash, no glyph, and
  // the runs' own underline back, or the rail has a hole where the annotation was.
  const offCell = declsOf(
    'clues',
    ".mg-rail-cell[data-hints='off']:is([data-line-state='contradiction'], [data-line-state='unknown'])",
    true,
  )
  const offRules = []
  trees.clues.walkRules((rule) => {
    for (const sel of rule.selectors) {
      const f = flat(sel)
      if (!f.includes("[data-hints='off']")) continue
      offRules.push({ rule, sel: f })
    }
  })
  need(
    'every rule that reads the switch names BOTH annotations and no third state',
    offRules.length === 5 &&
      offRules.every(
        ({ sel }) =>
          sel.includes("[data-line-state='contradiction']") &&
          sel.includes("[data-line-state='unknown']") &&
          !sel.includes("[data-line-state='complete']"),
      ),
    `${offRules.length}: ${offRules.map((r) => r.sel).join(' || ')}`,
  )
  need(
    'the switch is read off the CELL, so an off-rule is two compounds deep and never three',
    offRules.every(({ sel }) => sel.startsWith('.mg-rail-cell[data-hints=\'off\']')),
  )
  const allHooks = ['base', 'board', 'clues', 'forms', 'layout', 'overlays', 'tokens'].flatMap((f) =>
    read(f)
      .split('[data-hints=')
      .slice(1)
      .map((rest) => `${f}.css: ${rest.slice(0, 40)}`),
  )
  need(
    'EXACTLY FIVE rules in the whole stylesheet read the switch, all of them in clues.css',
    allHooks.length === 5 &&
      allHooks.every((h) => h.startsWith(`clues.css: 'off']:is([data-line-state='`)),
    allHooks.join(' | '),
  )
  need(
    'no rule puts the switch on a COMPLETE line (that gate would have grown)',
    !offRules.some(({ sel }) => sel.includes("[data-line-state='complete']")),
  )
  need(
    "OFF restores the resting edge, so a contradiction cell is not left with a dash",
    offCell['--clue-edge'] === 'var(--clue-line-border)',
    offCell['--clue-edge'],
  )
  need(
    "OFF restores the RESTING surface, not transparency (a rail cell's body is --surface-1)",
    offCell['background-color'] === 'var(--surface-1)',
    offCell['background-color'],
  )
  const offGlyph = declsOf('clues', ".mg-rail-cell__glyph")
  need(
    'OFF clears the badge strip and the blink (the glyph element itself stays)',
    offGlyph['background-color'] === 'transparent' && offGlyph['animation'] === 'none',
    JSON.stringify(offGlyph),
  )
  const runSites = offRules.filter(({ sel }) =>
    /__run(?!:has)|__numeral\[data-run-state='complete'\]/.test(sel),
  )
  need(
    'all THREE run-highlight sites also match an annotated cell at OFF, so no run loses its underline',
    runSites.length === 3,
    `${runSites.length}: ${runSites.map((r) => r.sel).join(' || ')}`,
  )
  // The bug this section missed once, and the reason for the next check: adding the
  // off-alternative beside a run site WITHOUT the site's own trailing compound
  // promoted the whole rule to the cell, so every ordinary rail cell inherited a
  // closed run's filled block and the rail painted solid green. A rule that reads
  // the switch may change the CONDITION. It may never change the TARGET, so every
  // alternative in such a rule has to end with the same compound.
  const offRuleTails = []
  trees.clues.walkRules((rule) => {
    const sels = rule.selectors.map(flat)
    if (!sels.some((s) => s.includes("[data-hints='off']"))) return
    const tails = sels.map((s) => s.split(' ').pop())
    if (new Set(tails).size > 1) offRuleTails.push(tails.join('  vs  '))
  })
  need(
    'a rule that reads the switch changes the CONDITION only, never the TARGET (one trailing compound across all alternatives)',
    offRuleTails.length === 0,
    offRuleTails.join('  |  '),
  )
  const confirmGroundRules = []
  trees.clues.walkRules((rule) => {
    let paints = false
    rule.walkDecls((d) => {
      if (d.prop === 'background-color' && d.value === 'var(--clue-on-ground)') paints = true
    })
    if (paints) confirmGroundRules.push(rule.selectors.map(flat).join(' , '))
  })
  need(
    'only the closed run\'s numeral and the closed line\'s strip paint a confirm ground, and both end inside the clue',
    confirmGroundRules.length === 2 &&
      confirmGroundRules.every((sels) =>
        sels.split(' , ').every((s) => /__numeral\[data-run-state='complete'\]$|__glyph$/.test(s.trim())),
      ),
    confirmGroundRules.join('  |  '),
  )
  const setters = new Set()
  for (const tree of [clues, trees.tokens]) {
    tree.walkDecls((d) => {
      if (ON.includes(d.prop))
        setters.add(`${tree === clues ? 'clues' : 'tokens'} ${d.parent.toString().split('{')[0].trim()}`)
    })
  }
  need(
    'ONLY :root sets the ten acknowledgement values — a switch on them would be the bug',
    [...setters].every((sel) => /^tokens :root$/.test(sel)),
    [...setters].join(' | '),
  )

  // A closed run: a block. Not a tint, not a chip with padding.
  const run = declsOf('clues', ":not(:is([data-line-state='contradiction']")
  need(
    'a closed run is FILLED, not tinted',
    run['background-color'] === 'var(--clue-on-ground)' &&
      !/color-mix|%|transparent/.test(run['background-color'] ?? 'x'),
    run['background-color'],
  )
  need(
    "the digit is knocked out to the surface",
    run['color'] === 'var(--clue-numeral-ink)',
    run['color'],
  )
  need(
    'the closed run keeps the weight channel and a 1px radius, and NO padding',
    run['font-weight'] === 'var(--clue-on-weight)' &&
      run['border-radius'] === 'var(--clue-on-radius)' &&
      !('padding' in run) &&
      !('border' in run) &&
      !('inset' in run),
    JSON.stringify(run),
  )
  need(
    'contradiction and unknown still assert nothing about a run',
    /:not\(:is\(\[data-line-state='contradiction'\], \[data-line-state='unknown'\]\)\)/.test(
      clues.toString(),
    ),
  )

  // When the layer is ON the two annotations have to be loud, or the switch only
  // relocated the complaint: a filled badge strip in each state's own ink, using
  // the tick's knock-out, size, weight and radius so all three bars are one mark.
  for (const [state, ink] of [
    ['contradiction', 'var(--badge-color-contradiction)'],
    ['unknown', 'var(--badge-color-unknown)'],
  ]) {
    const g = declsOf('clues', `.mg-rail-cell[data-line-state='${state}'] .mg-rail-cell__glyph`, true)
    need(
      `an ON ${state} FILLS its badge strip in its own ink, knocked out to the surface`,
      g['background-color'] === ink &&
        g['color'] === 'var(--clue-badge-ink)' &&
        g['font-size'] === 'var(--clue-on-badge-size)' &&
        g['font-weight'] === 'var(--clue-on-badge-weight)' &&
        g['border-radius'] === 'var(--clue-on-radius)',
      JSON.stringify(g),
    )
  }
  const unknownCell = declsOf('clues', ".mg-rail-cell[data-line-state='unknown']", true)
  need(
    'the ? cell has a body of its own, so the annotation reads as the cell\'s state',
    unknownCell['background-color'] === 'var(--wash-unknown-soft)',
    unknownCell['background-color'],
  )
  need(
    'the annotations pulse the INK, not the element, so a filled bar does not strobe',
    /@keyframes mg-annot-blink\s*\{\s*50%\s*\{\s*color: transparent;/.test(clues.toString()) &&
      /@keyframes mg-blink\s*\{\s*50%\s*\{\s*opacity: 0.4;/.test(clues.toString()) &&
      /animation: mg-annot-blink/.test(clues.toString()),
  )

  // A closed line: the edge keeps its resting WIDTH, and the badge strip fills.
  const edge = declsOf('clues', ".mg-rail-cell[data-line-state='complete']", true)
  need(
    'a closed line keeps the RESTING edge width (no layout change)',
    edge['--clue-edge'] === 'var(--clue-on-edge)' && rootOn['--clue-on-edge'].startsWith('var(--rule-w) solid'),
    `${edge['--clue-edge']} / ${rootOn['--clue-on-edge']}`,
  )
  const badge = declsOf(
    'clues',
    ".mg-rail-cell[data-line-state='complete'] .mg-rail-cell__glyph",
    true,
  )
  need(
    'a closed line FILLS its badge strip',
    badge['background-color'] === 'var(--clue-on-ground)' &&
      badge['color'] === 'var(--clue-badge-ink)' &&
      badge['font-size'] === 'var(--clue-on-badge-size)' &&
      badge['font-weight'] === 'var(--clue-on-badge-weight)',
    JSON.stringify(badge),
  )
  need(
    'the filled badge does not animate, so it cannot be mistaken for a blink',
    badge['animation'] === 'none',
    badge['animation'],
  )
  const lineNumeral = declsOf(
    'clues',
    ".mg-rail-cell[data-line-state='complete'] .mg-rail-cell__numeral[data-run-state='complete']",
    true,
  )
  need(
    'a closed LINE reads heavier than a single closed run',
    lineNumeral['font-weight'] === 'var(--clue-on-line-weight)',
    lineNumeral['font-weight'],
  )
  need(
    'no rule leaves a closed line with NO edge (the old quiet treatment)',
    !/\[data-line-state='complete'\][^{}]*\{[^}]*--clue-edge:\s*none/.test(clues.toString()),
  )
}

// --- 11. the legend teaches the FILLED BAR, and still -------------------------
// A legend is a key. A key that draws the edge and the wash but not the bar teaches
// the quiet half of a shape the player is about to meet in full, and the copy for
// the always-on row (「数字加粗标绿并带对勾」) names a ✓ the swatch never showed. So
// the three state-bearing rail swatches now render the same glyph span ClueCell
// renders, and the CSS has to place it. Two facts are load-bearing and neither is
// visible in a screenshot: the bar must not blink (a key is read once, and a
// flicker is only ever a way of being noticed), and winning that fight rests on the
// sheet order in `index.css`, so that order is asserted here rather than assumed.
console.log('11. the legend teaches the filled bar')
{
  const flat = (s) => s.replace(/\s+/g, ' ').trim()
  // `topLevel` reads only the rules at the root of the sheet, i.e. the RESTING
  // answer rather than the last one authored. A band inside an at-rule is a
  // deliberate second answer and a last-wins merge cannot tell it from a bug: the
  // short-landscape band (section 15) drops the pane's cap on purpose, so a check
  // that wants the resting cap has to say so.
  const declsOf = (file, selector, exact = false, topLevel = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      if (topLevel && rule.parent.type !== 'root') return
      const hit = exact
        ? rule.selectors.length === 1 && rule.selectors[0] === selector
        : rule.selectors.some((s) => s.includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const need = (what, ok, got) => {
    if (ok) console.log(`  ok   ${what}`)
    else bad(`11. ${what}${got === undefined ? '' : ` — got ${got}`}`)
  }
  const SEL = '.mg-legend__swatch.mg-rail-cell[data-line-state] .mg-rail-cell__glyph'
  const bar = declsOf('overlays', SEL, true)
  need(
    'the bar rule is exactly one selector, two compounds deep like the rest of the lane',
    Object.keys(bar).length > 0,
    [...Object.keys(bar)].join(),
  )
  need(
    'the bar runs across the top at the cell width, the COLUMN treatment',
    bar['inset'] === '0 0 auto 0' && bar['block-size'] === 'var(--rail-badge)',
    `${bar['inset']} / ${bar['block-size']}`,
  )
  need(
    'the bar does not blink in a key',
    bar['animation'] === 'none',
    bar['animation'],
  )
  const order = readFileSync(join(root, 'src/index.css'), 'utf8')
  need(
    'index.css loads the overlays AFTER the board and the rails, which is what settles the tie',
    order.indexOf("'./styles/clues.css'") > -1 &&
      order.indexOf("'./styles/overlays.css'") > order.indexOf("'./styles/clues.css'"),
    order.replace(/\s+/g, ' ').match(/@import[^;]+;/g)?.join(' '),
  )
  const legendMotion = []
  trees.overlays.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.includes('.mg-legend'))) return
    rule.walkDecls((d) => {
      if (d.prop === 'animation' && d.value !== 'none') legendMotion.push(`${rule.selector} → ${d.value}`)
    })
  })
  need(
    'no legend rule animates anything: motion in a key is a way of being noticed, not a shape',
    legendMotion.length === 0,
    legendMotion.join(' | '),
  )
  const reserve = declsOf('overlays', '.mg-legend__swatch .mg-rail-cell__clue', true)
  need(
    'the clue reserves the strip out of its flow, or the numeral would sit under the bar',
    reserve['padding-block-start'] === 'var(--rail-badge)',
    reserve['padding-block-start'],
  )
  const pill = declsOf('overlays', '.mg-legend__gate', true)
  need(
    'the gated entries carry a pill that names the layer',
    Object.keys(pill).length >= 4 && flat(pill['border'] ?? '').startsWith('var(--rule-w) solid'),
    Object.keys(pill).join(),
  )
  need(
    'the pill says which LAYER a shape belongs to, never the switch current value',
    !/\.mg-legend__gate\{[^}]*(on|off|✓|✕)/.test(flat(read('overlays'))),
  )
}

// --- 12. the numeral scales with the board, and the tape is gated in REACT -------
// A committed vitest test cannot read a stylesheet in this repo (jsdom resolves
// every CSS import to ''), so the CSS half of the tape gate has no test at all and
// the React half is the one that is pinned. That splits this section in two: the
// scaling is pure CSS and is checked HERE, and the tape's visibility is React and is
// checked in BoardSurface.test.tsx — which is why the rule below forbids the
// stylesheet from touching the tape at all.
{
  const rootDecl = (name) => {
    let found = null
    trees.tokens.walkRules((rule) => {
      if (rule.selector !== ':root') return
      rule.walkDecls((d) => {
        if (d.prop === name && found === null) found = d.value
      })
    })
    return found
  }
  const need = (what, ok, got) => {
    if (ok) console.log(`  ok   ${what}`)
    else bad(`12. ${what}${got === undefined ? '' : ` — got ${got}`}`)
  }
  const flat = (t) => t.replace(/\s+/g, ' ').trim()
  // `topLevel` reads only the rules at the root of the sheet, i.e. the RESTING
  // answer rather than the last one authored. A band inside an at-rule is a
  // deliberate second answer and a last-wins merge cannot tell it from a bug: the
  // short-landscape band (section 15) drops the pane's cap on purpose, so a check
  // that wants the resting cap has to say so.
  const declsOf = (file, selector, exact = false, topLevel = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      if (topLevel && rule.parent.type !== 'root') return
      const hit = exact
        ? rule.selectors.length === 1 && rule.selectors[0] === selector
        : rule.selectors.some((s) => s.includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const rootNum = rootDecl('--rail-num') ?? ''
  // The floor is `--rail-num-floor` and not the clamp's first argument any more:
  // the floor is itself a `clamp` in the window's block space, so a check that read
  // the argument would be reading a token, and one that read the token with
  // `parseFloat` would read `clamp(`. The claim being pinned is the SHAPE: a ramp
  // whose hard lower bound is the 10px legibility line, a finite upper bound, and
  // a ceiling in the outer clamp that the ramp can never reach.
  const floorValue = rootDecl('--rail-num-floor') ?? ''
  const floorArgs = floorValue.startsWith('clamp(')
    ? floorValue.slice('clamp('.length, floorValue.lastIndexOf(')')).split(',').map((s) => s.trim())
    : []
  const floor = floorArgs.length === 3 ? Number.parseFloat(floorArgs[0]) : Number.parseFloat(floorValue)
  const floorTop = floorArgs.length === 3 ? Number.parseFloat(floorArgs[2]) : NaN
  const ceiling = Number.parseFloat(rootNum.slice(rootNum.lastIndexOf(',') + 1))
  need(
    'the rail numeral has a hard floor and a hard ceiling, so it never falls under the legibility minimum and never runs away',
    /clamp\(/.test(rootNum) &&
      /var\(--rail-num-floor\)/.test(rootNum) &&
      Number.isFinite(floor) &&
      floor === 10 &&
      Number.isFinite(floorTop) &&
      floorTop <= 12 &&
      Number.isFinite(ceiling) &&
      ceiling > floorTop &&
      ceiling <= 20,
    `${rootNum} with floor ramp ${floorValue} (${floor}px..${floorTop}px) → ceiling ${ceiling}`,
  )
  need(
    "the numeral's preferred size is a function of --cell, or the zoom steps would all draw the same type",
    /var\(--cell\)/.test(rootNum),
    rootNum,
  )
  const rootDigit = rootDecl('--rail-digit') ?? ''
  need(
    'one numeral advance is a FRACTION of the numeral, not a constant, so the clearance margin grows with the type instead of being spent by it',
    /var\(--rail-num\)/.test(rootDigit) && /0\.62/.test(rootDigit) && !/\d+px/.test(rootDigit),
    rootDigit,
  )
  need(
    'the badge strip is one numeral tall, or the ✓ escapes a scaling numeral',
    (rootDecl('--rail-badge') ?? '').trim() === 'var(--rail-num)',
    rootDecl('--rail-badge'),
  )
  const stage = declsOf('board', '.mg-board-stage', true)
  for (const prop of ['--rail-num', '--rail-step', '--rail-badge', '--rail-digit']) {
    need(
      `the stage re-declares ${prop}: a custom property substitutes its own var()s where it is DECLARED, so at :root --cell is still its resting value and the rail would arrive flat`,
      Object.keys(stage).includes(prop),
      Object.keys(stage).join(),
    )
  }
  need(
    'the row track still pays the digits and the gutters it measured, out of the scaled advance',
    /var\(--rail-digits\)\s*\*\s*var\(--rail-digit\)/.test(stage['--rail-col'] ?? '') &&
      /var\(--rail-runs\)\s*-\s*1\)\s*\*\s*var\(--rail-run-gap\)/.test(stage['--rail-col'] ?? ''),
    stage['--rail-col'],
  )
  need(
    'the band still pays one step per slot, out of the scaled step',
    /var\(--rail-step\)\s*\*\s*var\(--rail-slots\)/.test(stage['--rail-band'] ?? ''),
    stage['--rail-band'],
  )
  const railNum = flat(stage['--rail-num'] ?? '')
  need(
    'the stage re-declares the numeral with the SAME clamp the root does, not a second number to keep in step',
    railNum === flat(rootNum),
    `${railNum} vs ${rootNum}`,
  )
  // The tape: visible-when-on, and painted here, gated there.
  need(
    "the open run's tape is a DOTTED hairline, so 'the position is forced' never reads as a closed run at a glance",
    (rootDecl('--clue-run-underline') ?? '').startsWith('1px dotted'),
    rootDecl('--clue-run-underline'),
  )
  need(
    "a closed run's tape changes shape AND weight together (2px solid in the confirm hue), so it survives greyscale",
    (rootDecl('--clue-run-underline-complete') ?? '') === 'var(--rule-w-heavy) solid var(--confirm)',
    rootDecl('--clue-run-underline-complete'),
  )
  const tapeRules = []
  for (const f of MINE) {
    trees[f]?.walkRules((rule) => {
      if (rule.selectors.some((s) => s.includes('.mg-run-tape'))) {
        tapeRules.push(`${f}: ${rule.selector}`)
        if (rule.selectors.some((s) => s.includes('data-hints'))) {
          tapeRules.push(`${f}: GATED IN CSS — ${rule.selector}`)
        }
      }
    })
  }
  need(
    'no stylesheet gates the tape: a display:none here would be a gate with no committed test, and the React gate already owns the open run',
    tapeRules.length > 0 && tapeRules.every((r) => !r.includes('GATED IN CSS')),
    tapeRules.join(' | '),
  )
  const flagged = []
  for (const f of MINE) {
    trees[f]?.walkRules((rule) => {
      if (rule.selectors.some((s) => s.includes('data-hints'))) flagged.push(`${f}: ${rule.selector}`)
    })
  }
  need(
    "every remaining data-hints rule is one of the two ANNOTATION edges, and no other — a gate that grows is a bug",
    flagged.length > 0 &&
      flagged.every((r) => r.includes("[data-line-state='contradiction']") && r.includes("[data-line-state='unknown']")),
    flagged.join(' | '),
  )
}

// --- 12. the legend teaches the CLOSED tape, in the closed form ---------------
// The one tape the board paints at BOTH settings is a finished run's. The legend
// teaches it inside `runComplete`'s swatch, and `runTape`'s row — the gated one — is a
// 1px dotted hairline. overlays.css's legend tape rule is unconditional, so without an
// exception the closed tape would print the OPEN form: the gated shape, on the row with
// no 提示 pill, which is the exact confusion the gate named. The exception has to spend
// the board's own closed token and nothing else, or the two forms can drift.
console.log('12. the legend teaches the closed tape in the closed form')
{
  const need = (what, ok, got) => {
    if (ok) console.log(`  ok   ${what}`)
    else bad(`12. ${what}${got === undefined ? '' : ` — got ${got}`}`)
  }
  const tapeRules = []
  trees.overlays.walkRules((rule) => {
    if (!rule.selectors.some((s) => s.includes('.mg-run-tape'))) return
    const decls = []
    rule.walkDecls((d) => decls.push(`${d.prop}: ${d.value}`))
    tapeRules.push({ selector: rule.selectors.join(','), decls })
  })
  const open = tapeRules.filter((r) => r.selector === '.mg-legend__swatch .mg-run-tape')
  need('exactly one default rule for a tape inside a legend swatch', open.length === 1, open.map((r) => r.selector).join(' | '))
  need(
    'and it spends the OPEN token, so the default is the hint shape',
    open[0]?.decls.includes('border-block-end: var(--clue-run-underline)'),
    open[0]?.decls.join('; '),
  )
  const closed = tapeRules.filter((r) => r.selector.includes("[data-run='complete']"))
  need(
    "the closed tape has its own rule, keyed on data-run — that attribute is also what gives it the specificity to beat the default",
    closed.length === 1,
    closed.map((r) => r.selector).join(' | '),
  )
  need(
    "it spends the board's own CLOSED token, so the key's closed tape cannot drift from the board's",
    closed[0]?.decls.length === 1 && closed[0]?.decls[0] === 'border-block-end: var(--clue-run-underline-complete)',
    closed[0]?.decls.join('; '),
  )
  const idxOpen = tapeRules.indexOf(open[0])
  const idxClosed = tapeRules.indexOf(closed[0])
  need('the exception is written after the default, so a reader meets it in that order', idxOpen > -1 && idxClosed > idxOpen, `${idxOpen} then ${idxClosed}`)
  need(
    'no legend tape rule hands the tape an orientation: board.css keys its two rules on it, and a square has no sides to be wrong about',
    !tapeRules.some((r) => r.selector.includes('data-orientation')),
    tapeRules.map((r) => r.selector).join(' | '),
  )
  need(
    'no legend tape rule reads data-hints: a key carries the switch in a word, not in a second gate',
    !tapeRules.some((r) => r.selector.includes('data-hints')),
    tapeRules.map((r) => r.selector).join(' | '),
  )
  need(
    'the closed form is a heavier solid line and the open a dotted hairline, so the two are told apart by shape and not only by colour',
    /--clue-run-underline:\s*1px dotted/.test(read('tokens')) &&
      /--clue-run-underline-complete:\s*var\(--rule-w-heavy\) solid var\(--confirm\)/.test(read('tokens')),
  )
}

// --- 13. the small screen, spent as tokens ------------------------------------
// Three claims, and each is checked where it could fail. (a) The two numbers a
// small screen argues about — the side column's width and the board pane's cap —
// are tokens, so a band can answer them without the sheet that needs them
// restating a literal. (b) The rail numeral's floor and ratio are tokens, so the
// band can retune 「放大游戏区域不放大数字格子」 in two lines instead of a formula in
// two files. (c) The narrow stack puts the BOARD before the panels, which is the
// one change that is about information order rather than size, and it is checked
// STRUCTURALLY: every area template that has both a main row and a left row must
// name main first, so a revert fails here and not only in the browser.
console.log('13. the small screen, spent as tokens')
{
  const need = (what, ok, got) => {
    if (ok) console.log(`  ok   ${what}`)
    else bad(`13. ${what}${got === undefined ? '' : ` — got ${got}`}`)
  }
  const rootDecls = (tree) => {
    const out = []
    for (const rule of tree.nodes.filter((n) => n.type === 'rule')) {
      if (rule.selector !== ':root') continue
      if (rule.parent.type === 'atrule') continue
      rule.walkDecls((d) => out.push(`${d.prop}: ${d.value}`))
    }
    return out
  }
  const bandDecls = (tree, params) => {
    for (const at of tree.nodes.filter((n) => n.type === 'atrule' && n.name === 'media')) {
      if (at.params.replace(/\s/g, ' ') !== params) continue
      const out = []
      at.walkDecls((d) => out.push(`${d.prop}: ${d.value}`))
      return { params: at.params, decls: out }
    }
    return { params, decls: null }
  }
  const NARROW = '(width >= 48rem) and (width < 74rem)'
  const LAND = '(orientation: landscape) and (height < 56rem) and (width >= 48rem)'

  const root = rootDecls(trees.tokens)
  need('--side-col has a resting value outside any band', root.includes('--side-col: 20rem'), root.filter((d) => d.startsWith('--side-col')).join('; '))
  need(
    'and that value is the 20rem the templates used to spell out',
    /^\s*--side-col: 20rem;$/m.test(read('tokens')),
  )
  need('--board-cap has a resting value outside any band', root.includes('--board-cap: min(70vh, 46rem)'), root.filter((d) => d.startsWith('--board-cap')).join('; '))

  // The tablet band is GONE, and this is the check that says so. It spent
  // `--rail-num-floor: 12px` and `--rail-num-ratio: 0.34` — a step keyed on WIDTH
  // in a quantity the player's eye reads as continuous, and the reason 800x1280
  // painted 13.6px while 1184x900 painted 10px. Its answer is now the ramp at
  // `--rail-num-floor`, which every width has to read the same way. The check
  // asserts ABSENCE, so a band that came back would be caught here and not by a
  // reviewer noticing that the numeral stepped again.
  const narrow = bandDecls(trees.tokens, NARROW)
  need('the phablet/tablet band is gone — the numeral is a function of the window, not of a width range', narrow.decls === null, narrow.decls && narrow.decls.join('; '))

  const land = bandDecls(trees.tokens, LAND)
  need('the landscape band exists', land.decls !== null, land.decls)
  need(
    'and it spends only the two PANEL values, because the numeral left this band too',
    land.decls !== null &&
      land.decls.length === 2 &&
      land.decls.includes('--side-col: 15rem') &&
      land.decls.includes('--board-cap: 86dvh'),
    land.decls && land.decls.join('; '),
  )
  // The two values that survive are the two whose steps are monotonic in the
  // helpful direction, and this is the number that says so: at a fixed 1440 the
  // shorter window hands the board a wider main column, 888px at 880 against 728px
  // at 896, the 240 coming back out of the two 20rem panels as they go 320 -> 240.
  // A band may only keep a declaration whose step a measurement justified.
  need(
    'and every declaration it still spends is about the panels or the board\'s cap — never the numeral',
    land.decls !== null && land.decls.every((d) => d.startsWith('--side-col') || d.startsWith('--board-cap')),
    land.decls && land.decls.join('; '),
  )
  const rootFloor = (root.find((d) => d.startsWith('--rail-num-floor:')) ?? '').replace(/^--rail-num-floor:\s*/, '')
  need(
    'the ramp reaches the 12px both deleted bands spent, so no width loses the numeral it had',
    /^clamp\(\s*10px\s*,[^,]*,\s*12px\)$/.test(rootFloor.replace(/\s+/g, ' ').trim()),
    rootFloor,
  )

  // (b) no formula may keep a literal. The stage re-declares --rail-num (a custom
  // property substitutes its own var()s where it is DECLARED), so BOTH copies have
  // to spend the tokens or the band would be spent on the root and lost on the
  // stage — which is the shape of a bug that measures clean on a desktop.
  const railNum = []
  for (const f of ['tokens', 'board']) {
    trees[f].walkDecls('--rail-num', (d) => railNum.push(`${f}: ${d.value}`))
  }
  need(
    'both --rail-num copies spend the two tokens and neither keeps a literal floor or ratio',
    railNum.length >= 2 && railNum.every((v) => v.includes('var(--rail-num-floor)') && v.includes('var(--rail-num-ratio)')),
    railNum.join(' | '),
  )

  // (a) the cap is a token at the one place that spends it
  const capDecls = []
  trees.board.walkDecls('max-block-size', (d) => capDecls.push(d.value))
  need('the board pane reads the token', capDecls.includes('var(--board-cap)'), capDecls.join(' | '))
  need(
    'and no sheet but the token still holds the old cap literal: two caps means one of them is a lie, and the consumer is the one that counts',
    !MINE.some((f) => read(f).includes('min(70vh, 46rem)')),
    MINE.filter((f) => read(f).includes('min(70vh, 46rem)')).join(' | '),
  )
  // `none` is exempt, and only because a cap REMOVED where the layout has already
  // answered is one answer while a cap spelled out beside the token is two. The
  // short-landscape band spends `none` here, and section 15 checks that it is
  // gated on a coarse pointer and a short wide window.
  const strayCaps = capDecls.filter((v) => v !== 'var(--board-cap)' && v !== 'none')
  need(
    'and the only other max-block-size the pane carries is a removal, not a second cap',
    strayCaps.length === 0,
    strayCaps.join(' | '),
  )
  need(
    'and the token itself still spends the SAME value, because moving a number to a token is not permission to retune it',
    read('tokens').includes('--board-cap: min(70vh, 46rem);'),
  )

  // (a) the side track is a token in every app template
  const sideTracks = []
  trees.layout.walkDecls('grid-template-columns', (d) => sideTracks.push(d.value))
  const hardTracks = sideTracks.filter((v) => /minmax\(0,\s*20rem\)/.test(v))
  need(
    'no app template still holds a literal 20rem side track',
    hardTracks.length === 0,
    hardTracks.join(' | '),
  )
  need(
    'and the templates read the token instead',
    sideTracks.filter((v) => v.includes('var(--side-col)')).length >= 3,
    sideTracks.join(' | '),
  )

  // (c) STRUCTURAL: main before the panels, in every template that names both
  // The rows are separated by NEWLINES, not by semicolons: postcss keeps the raw
  // value, so splitting on `;` returns the whole template as one row and every
  // index comes back 0 — which makes the comparison below silently true. A check
  // that cannot fail is worse than no check, so the split is on both and the row
  // count is itself pinned.
  const orders = []
  trees.layout.walkDecls('grid-template-areas', (d) => {
    const rows = d.value.split(/[\n;]/).map((r) => r.trim()).filter(Boolean)
    orders.push({ rows, selector: d.parent.selector })
  })
  need('the area templates are all found', orders.length >= 9, orders.length)
  need(
    'and every one of them really parsed into rows, not into a single row (the check below is a comparison of indices, and one index cannot be compared)',
    orders.every((o) => o.rows.length >= 2),
    orders.filter((o) => o.rows.length < 2).map((o) => o.selector).join(' | '),
  )
  const rowIndex = (o, re) => o.rows.findIndex((r) => re.test(r))
  const reordered = orders.filter((o) => rowIndex(o, /main/) > -1 && rowIndex(o, /left/) > -1 && rowIndex(o, /main/) > rowIndex(o, /left/))
  need(
    'every template that has both a board and a left panel names the board FIRST (this is the reorder, checked structurally so a revert fails here)',
    reordered.length === 0,
    reordered.map((o) => `${o.selector}: ${o.rows.join(' / ')}`).join(' ;; '),
  )
  const rightBad = orders.filter(
    (o) => rowIndex(o, /main/) > -1 && rowIndex(o, /^'?right/) > -1 && rowIndex(o, /main/) > rowIndex(o, /^'?right/),
  )
  need(
    'and the board is first before the right panel too, on the stacks that separate them',
    rightBad.length === 0,
    rightBad.map((o) => `${o.selector}: ${o.rows.join(' / ')}`).join(' ;; '),
  )
  // The three-column resting template keeps the board BETWEEN the two panels: a
  // tablet-width window has room for all three, and a board on the left with a
  // legend 600px to its right is the same reach problem the reorder fixes.
  const base = orders[0]
  need(
    'and the resting three-column template still puts the board in the MIDDLE column, which is what the panels are for',
    base.rows.length === 3 && /left\s+main\s+right/.test(base.rows[1]),
    base.rows.join(' / '),
  )

  // the reveal follows the new visual order, or the narrow stack staggers itself
  const idx = []
  for (const sel of ['.mg-banner', '.mg-main > .mg-status', '.mg-main > .mg-board-surface', '.mg-side--left', '.mg-side--right', '.mg-footer']) {
    for (const rule of trees.layout.nodes.filter((n) => n.type === 'rule' && n.selector === sel)) {
      const d = rule.nodes.filter((n) => n.type === 'decl' && n.prop === '--i')[0]
      if (d) idx.push({ sel, i: Number(d.value) })
    }
  }
  // The list is walked in a FIXED selector order, so the string below is the same on
  // every run and proves nothing on its own — the NUMBERS are the claim. (Round 5:
  // the old check compared that string to a literal and passed only because the list
  // order happened to be the visual order that round. A check that cannot fail is
  // worse than no check.)
  const order = idx.map((e) => e.sel).join(' ')
  const nums = idx.map((e) => e.i).join(',')
  const bySel = (sel) => idx.find((e) => e.sel === sel)?.i
  // SUPERSEDED IN PLACE (round 5): the pair swapped, because the legend is the key the
  // board is drawn in and the settings form is 1112px of it. The order this now pins
  // is the visual order, not the DOM order, and it is the reason `--i` is 3 for the key.
  need(
    'the load reveal reads the VISUAL order, and the key is revealed before the form (the list order above is the check’s, not the sheet’s)',
    bySel('.mg-side--right') === 3 && bySel('.mg-side--left') === 4,
    `key ${bySel('.mg-side--right')}, form ${bySel('.mg-side--left')}`,
  )
  need(
    'and the six indices are 0..5, because a list of selectors proves nothing about the numbers a stagger reads',
    nums.split(',').sort().join(',') === '0,1,2,3,4,5',
    `${order} → ${nums}`,
  )

  // the landscape band: same query as the tokens' band, and it bounds the panels
  const layLand = bandDecls(trees.layout, LAND)
  need('layout.css answers to the SAME band query the tokens do, so a screen cannot get 12px numerals with a 20rem panel', layLand.decls !== null, layLand.decls)
  need(
    'and the two band queries are byte-identical across the two files',
    land.params === layLand.params,
    `${land.params} vs ${layLand.params}`,
  )
  need(
    'each panel is bounded by the window and scrolls inside itself',
    layLand.decls !== null &&
      layLand.decls.includes('overflow-y: auto') &&
      layLand.decls.includes('overscroll-behavior: contain') &&
      layLand.decls.includes('min-block-size: 0') &&
      layLand.decls.some((d) => /^max-block-size: calc\(100dvh/.test(d)),
    layLand.decls && layLand.decls.join('; '),
  )
  need(
    'and the cap is in dvh, not vh: a tablet browser grows a chrome that the panel must not be sized against',
    layLand.decls !== null && !layLand.decls.some((d) => d.includes('100vh')),
  )

  // the coarse-pointer list: the banner's disclosure and the footer's two controls
  const coarse = []
  for (const at of trees.forms.nodes.filter((n) => n.type === 'atrule' && n.name === 'media')) {
    if (at.params !== '(pointer: coarse)') continue
    at.walkRules((r) => r.walkDecls((d) => {
      if (d.prop === 'min-block-size' && d.value.includes('var(--target-touch)')) coarse.push(r.selector)
    }))
  }
  const needCoarse = ['.mg-banner__panel-toggle', '.mg-footer__select', '.mg-footer__source']
  for (const sel of needCoarse) {
    need(`${sel} is a 44px target on a coarse pointer`, coarse.some((s) => s.split(',').map((x) => x.trim()).includes(sel)), coarse.join(' | '))
  }
  const kept = ['.mg-button', '.mg-toolbar__mode', '.mg-toolbar__zoom', '.mg-help__open', '.mg-round-banner__primary', '.mg-seg__label', '.mg-toolbar__finger', '.mg-field--toggle']
  for (const sel of kept) {
    need(`the pre-existing coarse target ${sel} survives`, coarse.some((s) => s.split(',').map((x) => x.trim()).includes(sel)))
  }

  // (d) The PHONE band is gone as well, and this is the check that says so. It is
  // the band that FIXED the round-4 defect the player described as
  // 「放大游戏区域不放大数字格子」 with the arithmetic backwards — below 768px the
  // rail fell back to the 10px/0.3 defaults while 768px+ got 12px/0.34, so the
  // SMALLER board got the SMALLER numeral (measured 10.00px at 600x960 and at
  // 412x915 against 13.60px at 800x1280). Its answer was right; its instrument
  // was a WIDTH literal, and a portrait phone is never shorter than about 640px
  // while the ramp hands out 12px from 700px of window up. So the band is gone and
  // the regression it fixed cannot come back through it.
  const PHONE = '(width < 48rem)'
  const phone = bandDecls(trees.tokens, PHONE)
  need('the phone band is gone — the ramp reads the same at every width, which is what it was for', phone.decls === null, phone.decls && phone.decls.join('; '))
  need(
    'and the ratio it spent (0.34) is the single app-wide value, so a phone is not a second device here',
    root.some((d) => d.startsWith('--rail-num-ratio: 0.34')),
    root.filter((d) => d.startsWith('--rail-num-ratio')).join('; '),
  )

  // (e) the key gets its own cap token, in the same :root BAND block as the rest
  need('--key-cap has a resting value in the token block', root.includes('--key-cap: 60dvh'), root.filter((d) => d.startsWith('--key-cap')).join('; '))
  need(
    'and the key cap is a viewport fraction, because the thing being bounded IS the viewport (a legend is 768px on a phone and 1090px on a desktop)',
    root.some((d) => d.startsWith('--key-cap:') && d.includes('dvh')),
  )
  // EXACT selector, not `startsWith`: mutation-proving found a version of this check
  // that accepted `.mg-side--right, .mg-toolbar { max-block-size: var(--key-cap) }` —
  // a key-shaped cap on the toolbar, which is precisely the mistake.
  const keyDecls = []
  trees.layout.walkRules((rule) => {
    rule.walkDecls('max-block-size', (d) => {
      if (d.value.includes('var(--key-cap)')) keyDecls.push({ selector: rule.selector, value: d.value })
    })
  })
  need(
    'exactly one rule spends --key-cap, and that rule is nothing but the key',
    keyDecls.length === 1 && keyDecls[0].selector === '.mg-side--right',
    keyDecls.map((d) => `${d.selector} → ${d.value}`).join(' | '),
  )
  // STRUCTURAL, because the first attempt at this check was a text test and mutation
  // proved it dead: a rule written `.mg-side--right, .mg-side--left {` does not
  // contain the string the text test looked for, so bounding the form too passed a
  // check whose whole subject was that the form is unbounded. A check that cannot fail
  // is worse than no check.
  // `walkRules`, not a top-level `nodes` scan: the rule that matters lives inside an
  // `@media`, and a top-level scan cannot see it at all — which is how the SECOND
  // mutation-proof attempt found this check was still dead.
  const leftCapped = []
  trees.layout.walkRules((rule) => {
    if (!rule.selector.includes('.mg-side--left')) return
    rule.walkDecls('max-block-size', (d) => leftCapped.push(`${rule.selector} → ${d.value}`))
  })
  need(
    'the settings sheet is deliberately NOT bounded: its print button is its LAST control, so a bounded sheet hides the app’s primary action below its own fold',
    leftCapped.length === 0,
    leftCapped.join(' | '),
  )

  // (f) min-block-size is a DVH, not a vh. `100vh` is the LARGEST viewport, so on
  // Android the app handed the player a scroll before there was anything to scroll.
  const minBlock = []
  trees.layout.walkDecls('min-block-size', (d) => minBlock.push(`${d.parent.selector} → ${d.value}`))
  const appMin = minBlock.filter((m) => m.startsWith('.mg-app'))
  need('.mg-app sizes itself against dvh', appMin.length === 1 && appMin[0].includes('100dvh'), appMin.join(' | '))
  // Scoped to layout.css, which is the app's own box: board.css keeps ONE plain-vh
  // cap on the round banner (`min(56vh, 28rem)`), which is a card pinned to a viewport
  // on purpose and is not this round's business.
  const vhDecls = []
  trees.layout.walkDecls((d) => {
    if (/(^|[^d])vh\b/.test(d.value)) vhDecls.push(`${d.prop}: ${d.value}`)
  })
  need(
    'and layout.css sizes NOTHING against a plain vh (a comment may still name the token it replaced)',
    vhDecls.length === 0,
    vhDecls.join(' | '),
  )

  // (g) the key precedes the settings form in EVERY narrow template. Not a comment
  // claim: the row index of `right` must be less than the row index of `left` in
  // each template that separates them, because the legend is the vocabulary the
  // board is drawn in and the settings sheet is 1112px of it.
  const rightBeforeLeft = orders.filter(
    (o) => rowIndex(o, /^'?right/) > -1 && rowIndex(o, /^'?left/) > -1 && rowIndex(o, /^'?right/) > rowIndex(o, /^'?left/),
  )
  need(
    'every template that separates the two panels puts the key before the form',
    rightBeforeLeft.length === 0,
    rightBeforeLeft.map((o) => `${o.selector}: ${o.rows.join(' / ')}`).join(' ;; '),
  )
  need(
    'and the reveal is re-indexed to match, which is checked above in the same order',
    bySel('.mg-banner') === 0 && bySel('.mg-footer') === 5 && bySel('.mg-main > .mg-board-surface') === 2,
    `${order} → ${nums}`,
  )

  // (h) the pan arming. Two rules, each binding ONE axis to `hidden`, and they are
  // written as `:not()` on the other axis: a sheet that hid both axes at once would
  // be a board nobody can pan, and a sheet that hid neither is the nested scroller
  // this is here to answer. `hidden`, not `clip`: a clipped box does not scroll in
  // Chromium, and the column rail's `position: sticky` resolves against the pane, so
  // a clip would break a 1:1 rail alignment that is contract.
  const panRules = []
  for (const rule of (() => {
    const out = []
    trees.board.walkRules((r) => {
      if (/\.mg-board-scroll\[data-pan-/.test(r.selector)) out.push(r)
    })
    return out
  })()) {
    const decls = []
    rule.walkDecls((d) => decls.push(`${d.prop}: ${d.value}`))
    panRules.push({ selector: rule.selector, decls })
  }
  need('the pane has exactly two arming rules', panRules.length === 2, panRules.map((r) => r.selector).join(' | '))
  // The direction is the whole point and it is the easy thing to write backwards:
  // the armed axis is the one the PANE KEEPS (the board needs to be panned that way,
  // or the fit has just hidden the way out of it) and the OTHER axis is the one
  // RELEASED to the page, so a vertical flick moves the board and a horizontal one
  // moves the document — one surface per axis, never a choice the player has to make
  // from a still picture.
  need(
    'a vertically panning board KEEPS the block axis and RELEASES the inline one to the page',
    panRules.some(
      (r) =>
        r.selector.includes('data-pan-block') &&
        r.selector.includes(':not([data-pan-inline])') &&
        r.decls.includes('overflow-inline: hidden') &&
        !r.decls.some((d) => d.startsWith('overflow-block')),
    ),
    panRules.map((r) => `${r.selector} { ${r.decls.join('; ')} }`).join(' ;; '),
  )
  need(
    'and the mirror: a board that pans sideways releases the block axis to the page',
    panRules.some(
      (r) =>
        r.selector.includes('data-pan-inline') &&
        r.selector.includes(':not([data-pan-block])') &&
        r.decls.includes('overflow-block: hidden') &&
        !r.decls.some((d) => d.startsWith('overflow-inline')),
    ),
    panRules.map((r) => `${r.selector} { ${r.decls.join('; ')} }`).join(' ;; '),
  )
  need(
    'neither of them may use clip (a clipped pane does not scroll in Chromium, and the sticky column rail resolves against it)',
    !/overflow-(block|inline): clip/.test(read('board')),
  )
  const paneRest = []
  for (const rule of trees.base.nodes.filter((n) => n.type === 'rule' && n.selector === '.mg-board-scroll')) {
    rule.walkDecls('overflow', (d) => paneRest.push(d.value))
  }
  need(
    'and the resting pane still says `auto` in base.css (a check on board.css would have matched a COMMENT), so a board that overflows before the arming measures can still be panned',
    paneRest.length === 1 && paneRest[0] === 'auto',
    paneRest.join(' | '),
  )
}

// --- 15. the touch band is ONE band, and it has no height ceiling --------------------
// Four sheets carry a piece of the band, because each piece changes a property that
// sheet owns and `@import` order decides who wins: the app's shell, the banner and the
// asides' bound live in layout.css, the surface and the pane's cap in board.css (a
// `.mg-board-scroll` override in layout.css LOSES to board.css's own cap), the toolbar
// in forms.css, and the status row's padding in overlays.css. A band split across
// sheets is a band that rots in halves, so the whole of it is checked here from the one
// place that can see every sheet: one media query, spelled once, gating the same thing
// everywhere.
//
// The band used to be `(pointer: coarse) and (width >= 74rem) and (height < 56rem)`,
// which is a 1px cliff at exactly 896px: 1440x880 was one screenful and 1440x896 was
// a 780px page scroll, for 16px of window. The ceiling is gone, and the check below is
// that it STAYS gone — a height condition reintroduced here is the one edit that would
// bring the cliff back without any other check noticing.
console.log('15. the touch band, its missing ceiling, and the 24px floor')
const need = (label, ok, detail = '') => {
  if (ok) console.log(`  ok   ${label}`)
  else bad(`${label}${detail ? ` — ${detail}` : ''}`)
}
const eq = (label, actual, expected) =>
  need(label, actual === expected, `expected \`${expected}\`, found \`${actual ?? 'nothing'}\``)
{
  // postcss hands back the whole params string, wrapper parens included.
  const BAND = '(pointer: coarse) and (width >= 74rem)'
  const CARRIERS = ['layout', 'board', 'forms', 'overlays']
  // The local reader, because `declsOf` is section-scoped and this one needs the
  // `topLevel` flag as much as section 8 does.
  const declsOf = (file, selector, exact = false, topLevel = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      if (topLevel && rule.parent.type !== 'root') return
      const hit = exact
        ? rule.selectors.length === 1 && rule.selectors[0] === selector
        : rule.selectors.some((x) => x.includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }

  const bandAt = (file) => {
    let found = null
    trees[file].walkAtRules('media', (a) => {
      if (a.params.replace(/\s+/g, ' ') === BAND) found = a
    })
    return found
  }
  const bandSelectors = (file) => {
    const at = bandAt(file)
    if (!at) return null
    const out = []
    at.walkRules((r) => out.push(r.selector))
    return out
  }
  const bandDecls = (file, selector) => {
    const at = bandAt(file)
    if (!at) return {}
    const out = {}
    at.walkRules((r) => {
      if (!r.selector.split(',').some((x) => x.trim() === selector)) return
      r.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }

  need('the band exists', CARRIERS.every((f) => bandAt(f)))
  need(
    'and all four carriers spell the SAME query, to the character: a band whose halves disagree on a threshold is two bands',
    new Set(CARRIERS.map((f) => (bandAt(f) ? bandAt(f).params.replace(/\s+/g, ' ') : 'MISSING'))).size === 1,
    CARRIERS.map((f) => `${f}: ${bandAt(f) ? bandAt(f).params : 'MISSING'}`).join(' | '),
  )
  need(
    'and it is gated on a coarse pointer and the width floor — the two facts the measurements turned on',
    bandAt('layout') !== null &&
      bandAt('layout').params.includes('pointer: coarse') &&
      bandAt('layout').params.includes('width >= 74rem'),
    bandAt('layout')?.params,
  )
  // The height ceiling is the cliff. It was there to keep the asides from running past
  // the one-viewport app, and the asides' bound is what actually does that — so the
  // check is that no height condition has crept back in, in any of the four halves.
  need(
    'and no half has grown a height condition: 896px was a 1px cliff between a 0px page scroll and a 780px one',
    CARRIERS.every((f) => {
      const at = bandAt(f)
      return at !== null && !/height\s*[<>]/.test(at.params)
    }),
    CARRIERS.map((f) => `${f}: ${bandAt(f)?.params ?? 'MISSING'}`).join(' | '),
  )

  // The shell. A one-viewport shell is `block-size` + a definite middle row; without
  // the `minmax(0, 1fr)` the middle row is the row's content and the app is a
  // document again, which is the thing the band exists to stop.
  const app = bandDecls('layout', '.mg-app')
  eq('the app is one viewport tall inside the band', app['block-size'], '100dvh')
  need(
    'and its middle row is the leftover, not its content',
    /minmax\(0,\s*1fr\)/.test(app['grid-template-rows'] ?? ''),
    app['grid-template-rows'],
  )
  eq(
    'and the main column is allowed to shrink, without which the row cannot',
    bandDecls('layout', '.mg-main')['min-block-size'],
    '0',
  )

  // The surface. Same argument one level down, and this is the level that failed when
  // the band was injected at 1024x768: a grid item's automatic minimum is its content's,
  // the content includes the pane, and the pane collapsed to 0px — while the fit read
  // that as permission to paint 55px cells in a box with no height.
  const surface = bandDecls('board', '.mg-board-surface')
  eq('the surface may shrink', surface['min-block-size'], '0')
  need(
    'and the pane is its leftover row',
    /minmax\(0,\s*1fr\)/.test(surface['grid-template-rows'] ?? ''),
    surface['grid-template-rows'],
  )
  eq(
    'and the pane drops the cap, because a cap on a pane the grid has sized is a second stale answer',
    bandDecls('board', '.mg-board-scroll')['max-block-size'],
    'none',
  )

  // The asides' bound, carried into the band rather than inherited from 6c. This is
  // the rule that makes the missing ceiling safe: with `align-items: stretch` the
  // middle row is a DEFINITE height, and an aside taller than its row with
  // `overflow: visible` neither shrinks nor scrolls, so with the app at `100dvh` its
  // content — the settings sheet's Generate button last — is off the page and
  // unreachable. Measured before this rule at 1184x900: the button sat at y 1445 of a
  // 900px window, `visible: true`, `inViewportNow: false`, `reachByScrolling: false`.
  const side = bandDecls('layout', '.mg-side')
  eq('the asides are bounded to the window', side['max-block-size'], 'calc(100dvh - var(--sp-4) - var(--sp-5))')
  eq('and scroll', side['overflow-y'], 'auto')
  eq('and do not hand a flick to the page behind them', side['overscroll-behavior'], 'contain')
  eq(
    'and may shrink, because a scroller with an automatic minimum cannot give its space to the board',
    side['min-block-size'],
    '0',
  )

  // The chrome. The trims are the cheap half of the band and the only half that is
  // pure taste, so each is pinned to the element it was measured on.
  eq('the toolbar keeps a frame and two rows of 44px controls', bandDecls('forms', '.mg-toolbar')['padding'], 'var(--sp-1) var(--sp-2)')
  eq('and a 4px gap between its two rows', bandDecls('forms', '.mg-toolbar')['row-gap'], 'var(--sp-1)')
  eq('the status row gives up half its air', bandDecls('overlays', '.mg-main > .mg-status')['padding'], 'var(--sp-1) var(--sp-3)')
  eq('and the footer gives up the rest of its own', bandDecls('layout', '.mg-footer')['padding'], 'var(--sp-2) var(--sp-4)')
  eq(
    'and the banner says the least load-bearing thing it owns only once',
    bandDecls('layout', '.mg-banner__tagline')['display'],
    'none',
  )

  // The band must not touch anything else: a rule added to it is a claim about a
  // measurement, and the cheapest way to keep those claims honest is to make them few.
  need(
    'the band names only the seven elements it was measured on',
    CARRIERS.every((f) => {
      const sels = bandSelectors(f)
      if (!sels) return false
      const allowed = [
        '.mg-app',
        '.mg-main',
        '.mg-banner',
        '.mg-banner__tagline',
        '.mg-footer',
        '.mg-side',
        '.mg-board-surface',
        '.mg-board-scroll',
        '.mg-toolbar',
        '.mg-main > .mg-status',
      ]
      return sels.every((s) => allowed.includes(s.trim()))
    }),
    CARRIERS.map((f) => `${f}: ${(bandSelectors(f) ?? ['MISSING']).join(', ')}`).join(' | '),
  )

  // ---- the 24px floor, and it is not a coarse-only rule ----
  // The round-5 census measured the settings checkboxes at 13x13 on a FINE pointer and
  // 24x24 on a coarse one, because the 24 came from base.css's coarse net and from
  // nothing else: a floor that only exists on a touch device is no floor at all, and a
  // stylus and a mouse are both fine-pointer. The rules therefore live at the root of
  // the sheet, and a check inside a band would pass for a floor that is not there.
  for (const [label, file, selector] of [
    ['the settings switch', 'forms', '.mg-field__checkbox'],
    ["the toolbar's finger switch", 'forms', ".mg-toolbar__finger input[type='checkbox']"],
  ]) {
    // `file` is read here, not hardcoded: both rows are in `forms` today, and a loop
    // whose tuple carries a sheet the body ignores is a row waiting to be checked
    // against the wrong sheet without any of the assertions noticing.
    const d = declsOf(file, selector, true, true)
    need(
      `${label} is 24x24 at the ROOT of the sheet, not inside the coarse block`,
      d['inline-size'] === 'var(--target-min)' && d['block-size'] === 'var(--target-min)',
      JSON.stringify(d),
    )
  }
  eq(
    'the footer link is 24 tall at the root too (measured 129x14 before)',
    declsOf('forms', '.mg-footer__source', true, true)['min-block-size'],
    'var(--target-min)',
  )
  need(
    'and the coarse block still lifts what a finger has to aim at to 44 — the 24 is a floor, not a replacement',
    (() => {
      let at = null
      trees.forms.walkAtRules('media', (a) => {
        if (a.params.replace(/\s+/g, ' ') === '(pointer: coarse)') at = a
      })
      if (!at) return false
      const found = []
      at.walkRules((r) => r.walkDecls('min-block-size', (d) => found.push(`${r.selector}=${d.value}`)))
      return found.some((f) => f.includes('var(--target-touch)'))
    })(),
  )
  // `primitives.tsx` renders the control and its label as SIBLINGS, so the claim an
  // older comment made about a wrapping label is checkable at the source: if the two
  // ever become nested, the sizing above stops being a hit-area change and starts
  // being a drawing change, and this file is where someone would be told so.
  need(
    'and the comment that used to claim the label wraps the control has been superseded in place, not left standing next to a floor that contradicts it',
    !/\* A toggle row: the label is the target, the box stays the OS/.test(read('forms')),
  )
}

// --- 16. the narrow strip is a CONTAINER query, and 8a sits after 8 ------------------
// Two facts about the toolbar that only a reader of the whole sheet can see, and both
// of which are easy to break with a well-meaning edit:
//
//  1. The pill trim is gated on the WIDTH OF THE STRIP, not the width of the window.
//     At 1184x900 the window is wide and the strip is 454px, because the >= 74rem
//     template spends 640px on two 20rem panels. A viewport query misses the case that
//     needs it most, so the band is a `@container toolbar (width < 36rem)` and the
//     toolbar declares the container. 36rem = 576px of content is the arithmetic: two
//     untrimmed groups need 565px, the largest strip measured is 917px, and the widest
//     strip the trim helps is 525px.
//  2. 8a used to sit ABOVE 8, and 8 is `(pointer: coarse)` and owns the toolbar's
//     controls. A future line in 8 that set `.mg-toolbar` padding would win on source
//     order and 8a would silently stop trimming anything — a rule that is present,
//     parses, and does nothing.
console.log('16. the narrow strip, and 8a after 8')
{
  const forms = read('forms')
  // A local reader, for the same reason 15 has one: these helpers are section-scoped
  // and this section is a different section.
  const declsOf = (file, selector, exact = false, topLevel = false) => {
    const out = {}
    trees[file].walkRules((rule) => {
      if (topLevel && rule.parent.type !== 'root') return
      const hit = exact
        ? rule.selectors.length === 1 && rule.selectors[0] === selector
        : rule.selectors.some((x) => x.includes(selector))
      if (!hit) return
      rule.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const bandDecls = (file, selector) => {
    let at = null
    trees[file].walkAtRules('media', (a) => {
      if (a.params.replace(/\s+/g, ' ') === '(pointer: coarse) and (width >= 74rem)') at = a
    })
    const out = {}
    at?.walkRules((r) => {
      if (!r.selectors.some((x) => x.split(',').some((y) => y.trim() === selector))) return
      r.walkDecls((d) => {
        out[d.prop] = d.value
      })
    })
    return out
  }
  const toolbar = declsOf('forms', '.mg-toolbar', true, true)
  eq('the toolbar is the container the narrow strip is measured in', toolbar['container'], 'toolbar / inline-size')

  const containers = []
  trees.forms.walkAtRules('container', (a) => containers.push(a.params.replace(/\s+/g, ' ')))
  need(
    'the narrow strip is a NAMED container query, so it cannot be answered by some other container on the page',
    containers.includes('toolbar (width < 36rem)'),
    containers.join(' | ') || 'no @container rule at all',
  )
  {
    let at = null
    trees.forms.walkAtRules('container', (a) => {
      if (a.params.replace(/\s+/g, ' ') === 'toolbar (width < 36rem)') at = a
    })
    const pills = {}
    at?.walkRules((r) => {
      if (!r.selectors.some((x) => x.trim() === '.mg-toolbar__mode' || x.trim() === '.mg-toolbar__zoom')) return
      r.walkDecls((d) => {
        pills[d.prop] = d.value
      })
    })
    eq(
      'and it trims the pills\' INLINE padding only — the block axis is the 44px target',
      pills['padding-inline'],
      'var(--sp-1)',
    )
    need(
      'and it does not touch the block axis',
      !('padding-block' in pills) && !('padding' in pills) && !('min-block-size' in pills),
      JSON.stringify(pills),
    )
    need(
      'and it hides nothing: every rule in it is a padding on a class that already exists',
      (() => {
        const sels = []
        at?.walkRules((r) => r.selectors.forEach((x) => sels.push(x.trim())))
        return sels.every((x) => /\.mg-toolbar__(mode|zoom)$/.test(x))
      })(),
    )
  }

  // The trim is not repeated in the coarse band. A copy there would be a second
  // boundary for the same rule, and the two would answer to different windows.
  const bandPills = bandDecls('forms', '.mg-toolbar')
  need(
    'the coarse band trims the strip and never the pills — the pill trim is 6a\'s, and 6a is a container query',
    !('padding-inline' in bandPills),
    JSON.stringify(bandPills),
  )

  // 8a after 8, checked by position in the sheet rather than by opinion.
  const i8 = forms.search(/^   8\. Pointer-size targets$/m)
  const i8a = forms.search(/^   8a\./m)
  need('section 8 is declared before 8a', i8 > -1 && i8a > i8, `8 at ${i8}, 8a at ${i8a}`)
  need(
    'and 8a\'s comment says why it moved, so the next reader does not put it back above 8',
    /It is below\n   8 for that reason/.test(forms),
  )

  // The trim is only free if the pills are their own names. If a future pill ever got
  // an `aria-label` that differs from its text, or the group lost its own, the trim
  // would still be legal — but the comment in 6a that promises "nothing is hidden"
  // would be false, and that is the claim this checks.
  const src = readFileSync(join(root, 'src/ui/components/BoardSurface.tsx'), 'utf8')
  need(
    'and the pills really are their own accessible names (6a\'s promise, checked at the source)',
    /className="mg-toolbar__mode"[\s\S]{0,320}?\{t\.toolbar\.modes\[candidate\]\}/.test(src) &&
      /className="mg-toolbar__zoom"[\s\S]{0,320}?\{t\.toolbar\.zooms\[candidate\]\}/.test(src) &&
      (src.match(/aria-label=\{t\.toolbar\.(mode|zoom)\}/g) ?? []).length === 2,
  )
}

// --- 17. the numeral is one function, and no band is allowed to own it ---------
// The ramp at `--rail-num-floor` replaced two width-keyed bands, and it can only
// replace them if nothing else in the style system reintroduces a step. This
// section is the promise made in the token comment above the ramp, and every
// check in it is written so that it CAN go red: (a) and (b) were proved by
// reinstating a deleted band and by giving a live band a numeral declaration.
console.log('17. the numeral is one function, and no band may own it')
{
  const need = (what, ok, got) => {
    if (ok) console.log(`  ok   ${what}`)
    else bad(`17. ${what}${got === undefined || got === '' ? '' : ` — got ${got}`}`)
  }
  const SHEETS = [...BASE, ...MINE]

  // (a) Neither deleted band reappears, in the sheet that owned the ramp. A
  // condition is not evidence on its own — `layout.css` legitimately collapses to
  // one column at `(width < 48rem)` — so this is scoped to tokens.css, where the
  // two numeral bands lived and where a `:root` re-declaration of the numeral is
  // the only thing that could put the step back. Check (b) is the broader one:
  // it is about the DECLARATION, wherever it is, not about the condition.
  const DEAD = ['(width < 48rem)', '(width >= 48rem) and (width < 74rem)']
  const found = []
  for (const at of trees.tokens.nodes) {
    if (at.type !== 'atrule') continue
    if (!['media', 'container', 'supports'].includes(at.name)) continue
    const params = at.params.replace(/\s+/g, ' ')
    if (DEAD.includes(params)) found.push(`tokens: @${at.name} ${params}`)
  }
  need(
    'neither deleted numeral band is back in the sheet that owned the ramp',
    found.length === 0,
    found.join(' | '),
  )

  // (b) THE claim, and the one that matters: no band, anywhere, spends either
  // numeral knob. Every at-rule in every sheet is walked — media, container and
  // supports alike, and nested ones — and any declaration of either property
  // inside one is a step that a width or a container can reach and the window's
  // block space cannot. Outside an at-rule is where the ramp lives, and outside
  // is the only place it is allowed to live.
  const spends = []
  for (const f of SHEETS) {
    trees[f].walkDecls((d) => {
      if (d.prop !== '--rail-num-floor' && d.prop !== '--rail-num-ratio') return
      for (let p = d.parent; p; p = p.parent) {
        if (p.type === 'atrule' && ['media', 'container', 'supports'].includes(p.name)) {
          spends.push(`${f}: ${p.name} "${p.params.replace(/\s+/g, ' ')}" → ${d.prop}: ${d.value}`)
          return
        }
      }
    })
  }
  need(
    'no band anywhere spends the numeral — the floor is a function of the window, and a band is a step',
    spends.length === 0,
    spends.join(' | '),
  )
  // The same statement from the other side, and this is the one a mutation cannot
  // satisfy by accident: the two knobs must be declared EXACTLY ONCE across the
  // whole style system, at the root. A second declaration outside a band would
  // still be a second answer for the same window.
  const allNumeralDecls = []
  for (const f of SHEETS) {
    trees[f].walkDecls(/^--rail-num-(floor|ratio)$/, (d) => allNumeralDecls.push(`${f}:${d.source.start.line} ${d.prop}: ${d.value}`))
  }
  need(
    'and each knob is declared once, at the root, so there is one answer per window',
    allNumeralDecls.length === 2 && allNumeralDecls.every((d) => d.startsWith('tokens:')),
    allNumeralDecls.join(' | '),
  )

  // (c) The ramp is a floor with a bottom and a top, and the ratio beside it
  // cannot run away. Both are parsed out of the source rather than read from a
  // browser, so the numbers here are the ones a future edit has to beat.
  const tokens = trees.tokens
  const rootVal = (prop) => {
    for (const rule of tokens.nodes.filter((n) => n.type === 'rule' && n.selector === ':root' && n.parent.type !== 'atrule')) {
      let v = null
      rule.walkDecls(prop, (d) => {
        v = d.value
      })
      if (v !== null) return v
    }
    return null
  }
  const floorRaw = rootVal('--rail-num-floor') ?? ''
  const args = floorRaw.startsWith('clamp(') ? floorRaw.slice(6, floorRaw.lastIndexOf(')')).split(',').map((s) => s.trim()) : []
  need(
    'the ramp is a `clamp` of three arguments, so it has a bottom, a middle and a top',
    args.length === 3,
    floorRaw,
  )
  need(
    'and its bottom is the 10px legibility line, spelled as the number and not as a token that could move',
    Number.parseFloat(args[0]) === 10,
    args[0],
  )
  need(
    'and its top is 12px, the value the two deleted bands spent — so the ramp subsumes them',
    Number.parseFloat(args[2]) === 12,
    args[2],
  )
  // The middle is where the whole claim lives, so it is parsed rather than
  // pattern-matched: it must CONTAIN a `100dvh` term (the window's block space,
  // the only input a numeral's size can honestly be a function of) and that term
  // must be MULTIPLIED by a positive coefficient.
  const mid = args[1] ?? ''
  // The multiplier applies to a parenthesised group, not to the quantity inside
  // it: `(100dvh - 37.5rem) * 0.02`. So each `* k` is paired with the group it
  // multiplies AND with the sign that joins the group to the sum around it —
  // because `calc(10px + (100dvh - 37.5rem) * 0.02)` and
  // `calc(10px - (100dvh - 37.5rem) * 0.02)` have the same terms and the same
  // coefficient, and one of them makes a taller window paint a SMALLER numeral.
  // The sign is the only difference, so the sign is what the check reads.
  const terms = [...mid.matchAll(/([+-])?\s*\(([^()]*)\)\s*\*\s*([\d.]+)/g)]
  const slopes = terms
    .filter(([, , group]) => /100dvh/.test(group))
    .map(([, sign, , k]) => (sign === '-' ? -1 : 1) * Number.parseFloat(k))
  need(
    'and its middle is a function of the window\'s block space — a `100dvh` term multiplied by a real coefficient',
    slopes.length === 1 && Number.isFinite(slopes[0]),
    mid,
  )
  need(
    'and that coefficient is positive, so the ramp is MONOTONE: a window one pixel taller never paints a smaller numeral',
    slopes.length === 1 && slopes[0] > 0,
    `${slopes.join(' | ')} from ${mid}`,
  )
  // And it is bounded, which is the other half of monotone: the ramp has a
  // ceiling, so the coefficient cannot carry the numeral off the top either.
  need(
    'and the ramp is bounded at the top, so the coefficient cannot carry the numeral away either',
    Number.isFinite(Number.parseFloat(args[2] ?? '')) && Number.parseFloat(args[2]) <= 12,
    args[2],
  )
  const ratio = Number.parseFloat(rootVal('--rail-num-ratio') ?? 'NaN')
  const cellMax = Number.parseFloat((rootVal('--cell-max') ?? 'NaN').replace('px', ''))
  const numRaw = rootVal('--rail-num') ?? ''
  const ceiling = Number.parseFloat(numRaw.slice(numRaw.lastIndexOf(',') + 1).replace('px', ''))
  need(
    'the ratio is a real fraction of the cell, and the largest cell the zoom allows still lands under the ceiling',
    Number.isFinite(ratio) && ratio > 0 && Number.isFinite(cellMax) && ratio * cellMax <= 20,
    `ratio ${ratio} x cell-max ${cellMax}px = ${(ratio * cellMax).toFixed(2)}px against a ${ceiling}px ceiling`,
  )
  need(
    'and the outer clamp still has that ceiling as its top argument, so a bigger --cell cannot buy a bigger numeral',
    Number.isFinite(ceiling) && ceiling === 20,
    numRaw,
  )
  // The stage re-declares --rail-num (a custom property substitutes its own
  // var()s where it is DECLARED), so the same three arguments have to be there
  // twice or the ramp would be spent on the root and lost on the board.
  const copies = []
  for (const f of ['tokens', 'board']) trees[f].walkDecls('--rail-num', (d) => copies.push(d.value))
  need(
    'both --rail-num copies are the same clamp, so the stage reads the ramp the root computed',
    copies.length === 2 && new Set(copies).size === 1,
    copies.map((v, i) => `${['tokens', 'board'][i]}: ${v}`).join(' | '),
  )
}

// --- 18. the narrow chrome: two container queries, and the trap they both sit on --
// The chrome was reduced at the narrow end by exactly two rules — the banner's
// `@container banner` (layout.css 2a) and the toolbar's `@container toolbar` (forms.css
// 6b) — and both of them carry a claim that no browser will enforce for us:
//
//  1. A CONTAINER QUERY NEVER MATCHES THE ELEMENT THAT ESTABLISHES THE CONTAINER.
//     So the obvious version of either rule is inert: the first draft of 2a carried
//     `.mg-banner { padding-block; gap }` inside `@container banner` and it measured at
//     zero effect, and 6b cannot spend the strip's own padding for the same reason. The
//     dead declarations were removed rather than left in as a claim, and this section
//     fails if one comes back — a rule that parses, is present in the file, and does
//     nothing is worse than no rule, because the next reader counts it.
//  2. A container gate must not be duplicated in a viewport `@media`. The same
//     declaration answered from two conditions is two boundaries for one rule, which is
//     the whole family of defect the numeral ramp (section 17) was written to remove.
//
// Every check below is written so that it CAN go red, and (1) was proved by putting the
// dead pair back and by moving a gate, not by reading the file.
console.log('18. the narrow chrome: container gates, and no rule styling its own container')
{
  const layout = read('layout')
  const forms = read('forms')
  const containerAts = (file, name) => {
    const out = []
    trees[file].walkAtRules('container', (a) => {
      const p = a.params.replace(/\s+/g, ' ')
      if (p.startsWith(name + ' ')) out.push({ params: p, at: a, file })
    })
    return out
  }
  // The element that establishes each container, and the at-rules that query it. The
  // pairing is what makes the trap checkable rather than a general warning.
  const ESTABLISH = [
    { name: 'banner', file: 'layout', selector: '.mg-banner' },
    { name: 'toolbar', file: 'forms', selector: '.mg-toolbar' },
  ]
  for (const e of ESTABLISH) {
    const rules = containerAts(e.file, e.name)
    // Not "exactly one" -- the toolbar legitimately has two GATES (6a's padding trim
    // and 6b's segmented trim) and the banner has one. What must not exist is the same
    // GATE twice: two blocks reading one condition are two answers to one width, and
    // whichever is written second silently owns the other's rules.
    const seen = new Map()
    for (const r of rules) seen.set(r.params, (seen.get(r.params) ?? 0) + 1)
    const repeated = [...seen].filter(([, n]) => n > 1)
    need(
      `every \`@container ${e.name}\` GATE is declared once, in ${e.file}.css`,
      repeated.length === 0,
      repeated.map(([p, n]) => `${p} x${n}`).join(' | ') || rules.map((r) => `${r.file}: @container ${r.params}`).join(' | '),
    )
    // (1) THE trap. Read the establishing declaration so the check follows the CODE
    // rather than a hard-coded pair: if a future sheet moves the container, the
    // selector that must not be styled inside the query moves with it.
    const own = []
    trees[e.file].walkRules((r) => {
      if (r.parent.type !== 'root') return
      if (!r.selectors.some((x) => x.trim() === e.selector)) return
      r.walkDecls((d) => {
        own.push(`${d.prop}: ${d.value}`)
      })
    })
    eq(`and \`${e.selector}\` establishes \`container: ${e.name}\``, own.filter((d) => d.startsWith('container:')).join(', '), `container: ${e.name} / inline-size`)
    const offenders = []
    for (const r of rules) {
      r.at.walkRules((inner) => {
        if (inner.selectors.some((x) => x.split(',').some((y) => y.trim().split(/[\s:>+~]+/).some((part) => part === e.selector)))) {
          offenders.push(`${r.file}: @container ${r.params} → ${inner.selectors.join(', ')}`)
        }
      })
    }
    need(
      `and nothing inside @container ${e.name} styles \`${e.selector}\` itself — a container query never matches its own container, so such a rule is inert`,
      offenders.length === 0,
      offenders.join(' | '),
    )
  }

  // The banner gate, spelled out. One rule, one declaration: the sentence, gone.
  need('the banner container has exactly one gate, so the sentence has exactly one boundary', containerAts('layout', 'banner').length === 1, containerAts('layout', 'banner').map((r) => r.params).join(' | '))
  const banner = containerAts('layout', 'banner')[0]
  if (banner) {
    eq('the banner gate is 24rem', banner.params, 'banner (width < 24rem)')
    const inner = []
    banner.at.walkRules((r) => inner.push(r))
    need('and it holds exactly one rule', inner.length === 1, `${inner.length} rules: ${inner.map((r) => r.selectors.join(',')).join(' | ')}`)
    eq('and that rule is the tagline', inner[0]?.selectors.join(','), '.mg-banner__tagline')
    const dl = []
    inner[0]?.walkDecls((d) => dl.push(`${d.prop}: ${d.value}`))
    need('and its only declaration hides it, which is the only content this gate may spend', dl.length === 1 && dl[0] === 'display: none', JSON.stringify(dl))
  }
  // The toolbar gates, and their ORDER. 6a is the padding trim and 6b the segmented
  // trim; 6b must stay the narrower one, or the pill trim would fire in a strip that
  // never wrapped and tighten a control that was already correct — which is exactly
  // what a first draft at 21rem did, measured reaching 331px at 412x915.
  //
  // The gates are found by PARSING them and then asked for their identity and their
  // order, rather than looked up by their literals. Looking them up by literal is the
  // version that cannot be proved: with 6a moved to 10rem the lookup simply finds
  // nothing and the order check is skipped, so a mutation gets a clean run and a
  // reader gets a green light. Sorted by width, the narrowest gate is 6b's.
  const rem = (s) => Number.parseFloat(s.replace(/^toolbar \(width < /, '').replace(/\)$/, ''))
  const gates = containerAts('forms', 'toolbar')
    .map((r) => ({ ...r, rem: rem(r.params) }))
    .sort((a, b) => a.rem - b.rem)
  need('the toolbar has exactly two container gates — 6a the pill trim and 6b the segmented one', gates.length === 2, gates.map((r) => r.params).join(' | '))
  const seg = gates.find((r) => r.rem === 20) ?? gates[0]
  const trim = gates.find((r) => r.rem === 36)
  need('and they are 20rem and 36rem, in that order of narrowness', gates.map((r) => r.rem).join(' < ') === '20 < 36', gates.map((r) => r.rem).join(' < '))
  if (gates.length === 2) {
    // The real ordering claim, and the one that can go red: the SEGMENTED rule must
    // live at the narrowest gate. Sorting the gates and asking whether the smaller is
    // smaller is a tautology, which is why the first draft of this check was replaced:
    // it could not have failed. What must hold is that the gate carrying
    // `column-gap: 0` is the narrow one, so the segmented shape can only appear where
    // 6a could not finish.
    const carries = (g, prop, value) => {
      let found = false
      g.at.walkDecls((d) => {
        if (d.prop === prop && d.value === value) found = true
      })
      return found
    }
    const segmented = gates.find((g) => carries(g, 'column-gap', '0'))
    need('and the SEGMENTED rule (column-gap: 0) lives at the narrowest gate, so the segmented shape can only appear where 6a could not finish', !!segmented && segmented.rem === Math.min(...gates.map((g) => g.rem)), gates.map((g) => `${g.params}${carries(g, 'column-gap', '0') ? ' [segmented]' : ''}`).join(' | '))
  }
  need('and 6a\'s gate is still the 36rem that was measured, not a round number moved', !!trim, gates.map((r) => r.params).join(' | '))
  if (seg) {
    const rules = []
    seg.at.walkRules((r) => {
      const o = {}
      r.walkDecls((d) => (o[d.prop] = d.value))
      rules.push([r.selectors.join(','), o])
    })
    const flat = Object.fromEntries(rules)
    eq('6b zeroes the group gap', flat['.mg-toolbar__group']?.['column-gap'], '0')
    eq('and 6b trims the zoom pills\' inline padding to 2px, not 0', flat['.mg-toolbar__zoom']?.['padding-inline'], '2px')
    // The measured basis of both numbers, read back as a claim so a silent edit has
    // to leave the reason behind or break the check.
    need('and 6b does not touch a target size: no width, height or min-* in the block', rules.every(([, o]) => !Object.keys(o).some((p) => /^(width|height|min-|max-)/.test(p))), JSON.stringify(flat))
    need('and 6b\'s comment carries the ink measurement that justifies the zero gap', /13\.3, 6, 6, 17\.2 and 24\.5px/.test(forms) && /two 1px\n?\s*BORDERS, not two words/.test(forms))
    need('and 6b records the width where it does NOT fire, so a reader does not think it owns 320x800', /320x800 the\n?\s*strip's content box is 254/.test(forms))
  }
  // (2) No viewport COPY of either gate, with the one pre-existing and legitimate media
  // rule named so the exception is a checked one rather than a hole. The touch band
  // already hides the tagline, and it may: its condition is a POINTER, and a finger is
  // a reason to spend the sentence that a width is not. Any OTHER media rule that does
  // either job is a second boundary for one rule.
  const TOUCH_BAND = '(pointer: coarse) and (width >= 74rem)'
  // Scoped by SELECTOR **and** by the gated DECLARATION, because both halves are
  // needed. `display: none` is a normal thing for a `@media` to say (base.css hides a
  // box under `forced-colors: active`), and the coarse band legitimately sets the
  // control box on `.mg-toolbar__mode`; a COPY is the same declaration about the same
  // gated element answering at a second condition.
  const GATED = ['.mg-banner__tagline', '.mg-toolbar__group', '.mg-toolbar__mode', '.mg-toolbar__zoom']
  const copies = []
  for (const f of [...MINE, ...BASE]) {
    trees[f].walkAtRules('media', (a) => {
      const params = a.params.replace(/\s+/g, ' ')
      a.walkRules((r) => {
        const hit = r.selectors.filter((x) => GATED.includes(x.trim()))
        if (!hit.length) return
        const gated = []
        r.walkDecls((d) => {
          if (d.prop === 'display' && d.value === 'none') gated.push('display: none')
          if (d.prop === 'column-gap' && d.value === '0') gated.push('column-gap: 0')
        })
        if (!gated.length) return
        if (params === TOUCH_BAND && hit.every((x) => x.trim() === '.mg-banner__tagline')) return
        copies.push(`${f}: @media ${params} -> ${hit.join(', ')} { ${gated.join('; ')} }`)
      })
    })
  }
  need(
    'neither gate has a viewport COPY -- one rule, one condition, or it is two boundaries again (the touch band\'s own pointer-keyed tagline is the one allowed exception, and it is matched by selector)',
    copies.length === 0,
    copies.join(' | '),
  )
  // And the reason the banner is not a viewport query, which is the thing a future
  // editor is most likely to "simplify": the banner's content width is not the
  // window's, and the app's own padding moves under it.
  need('and the banner container records why it is a container and not a viewport query', /banner's CONTENT width is not the window's/.test(layout) && /349px/.test(layout))
}

console.log(fail === 0 ? '\nALL CHECKS PASS' : `\n${fail} FAILURES`)
