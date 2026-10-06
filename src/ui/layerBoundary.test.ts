import { describe, expect, it } from 'vitest'
import { DEFAULT_INITIAL_SCORE } from '../application/gameReducer'
import { MAX_BOARD_CELLS, MAX_BOARD_SIDE, MIN_BOARD_SIDE } from '../domain/board'
import { DEFAULT_STAR_SIDE, MAX_STAR_SIDE, MIN_STAR_SIDE } from '../domain/starBattle'
import { DEFAULT_STAR_LIVES, MAX_STAR_LIVES, MIN_STAR_LIVES } from '../domain/starBattle'
import {
  DEFAULT_GENERATION_COLUMNS,
  DEFAULT_GENERATION_DENSITY_PERCENT,
  DEFAULT_GENERATION_DIFFICULTY,
  DEFAULT_GENERATION_ROWS,
  DEFAULT_GENERATION_SEED,
  DEFAULT_MAX_GENERATION_ATTEMPTS,
} from '../engine/generator/settings'
import { DIFFICULTY_BANDS } from '../engine/solver/difficulty'

// ======================================================================================
// Layer boundary guard — see plan/PLAN.md section 5, "Layer coupling from the UI layer"
// ======================================================================================
//
// WHY this exists: the UI layer may reach inward for *types* (erased at build time, so
// they cost nothing) and for a handful of pure constant tables, so that the settings
// form and the engine's defaults share one source of truth instead of duplicating
// literals. What it must never do is import a function, a class, or any value that can
// reach a board, a puzzle, a solver proof, or a generation trace.
//
// That coupling is invisible to the type checker: every forbidden export is public and
// well typed, so `npm run typecheck` stays green while a view component grows a second
// entry point into the engine. It is also invisible to the bundler, because a
// type-only import and a value import of the same module both "work". Nothing else in
// the repo enforced it — the other `?raw` guards (gameStore.test.ts, viewModel.test.ts)
// look for a leaked *name* such as `previewMarkBatch`, not for the import edges — so
// this file reads every component source as text and parses the import edges itself.

const RULE = [
  'Layer coupling from the UI layer (plan/PLAN.md section 5): components may import types',
  'from src/domain, src/engine, and src/application (erased at build time) and may import',
  'pure constant tables from them — DIFFICULTY_BANDS, the DEFAULT_GENERATION_* defaults,',
  'DEFAULT_INITIAL_SCORE, MAX_BOARD_SIDE, and the Star Battle side bounds (MIN_STAR_SIDE,',
  'MAX_STAR_SIDE, DEFAULT_STAR_SIDE) and lives bounds (MIN_STAR_LIVES, MAX_STAR_LIVES,',
  'DEFAULT_STAR_LIVES) — so the settings form and the form default values',
  'share one source of truth instead of duplicating literals. They must not import any',
  'function, class, or value that can reach a board, puzzle, solver proof, or generation trace.',
].join(' ')

/**
 * Lower layer directory names, matched against the first non-relative segment of a
 * specifier — the relative depth is deliberately ignored, because a component under
 * `src/ui/components/` writes `../../domain/board` while `src/App.tsx` writes
 * `./domain/board` and both reach the same module. `workers` is here on purpose: the
 * worker adapter is a lower layer too, and a component importing it would be reaching
 * straight into generation.
 */
const LOWER_LAYER_PREFIXES: readonly string[] = ['domain', 'engine', 'application', 'workers']

/** The only bindings allowed to cross a layer edge by value. */
const SANCTIONED_VALUES: readonly string[] = [
  'MAX_BOARD_SIDE',
  'MAX_BOARD_CELLS',
  'MIN_BOARD_SIDE',
  // The Star Battle board-size bounds are the same shape of constant as
  // MIN_BOARD_SIDE / MAX_BOARD_SIDE: plain numbers in src/domain/starBattle.ts,
  // the single source of truth the size selector must read instead of
  // repeating literals. None of them can reach a board, a puzzle or a solver.
  'MIN_STAR_SIDE',
  'MAX_STAR_SIDE',
  'DEFAULT_STAR_SIDE',
  // The Star Battle lives bounds are the same shape of constant as the side
  // bounds: plain numbers in src/domain/starBattle.ts, the single source of
  // truth the lives selector must read instead of repeating literals. None of
  // them can reach a board, a puzzle or a solver.
  'MIN_STAR_LIVES',
  'MAX_STAR_LIVES',
  'DEFAULT_STAR_LIVES',
  'DIFFICULTY_BANDS',
  'DEFAULT_GENERATION_ROWS',
  'DEFAULT_GENERATION_COLUMNS',
  'DEFAULT_GENERATION_DENSITY_PERCENT',
  'DEFAULT_GENERATION_DIFFICULTY',
  'DEFAULT_GENERATION_SEED',
  'DEFAULT_MAX_GENERATION_ATTEMPTS',
  'DEFAULT_INITIAL_SCORE',
]

type ImportKind = 'type' | 'value' | 'namespace' | 'default' | 'side-effect' | 'dynamic'

interface Binding {
  readonly name: string
  readonly isType: boolean
}

interface ParsedImport {
  readonly kind: ImportKind
  readonly bindings: readonly Binding[]
  readonly specifier: string
  readonly line: number
}

interface ImportViolation {
  readonly file: string
  readonly line: number
  readonly binding: string
  readonly specifier: string
  readonly kind: ImportKind
  readonly reason: string
}

const WORD = /[A-Za-z0-9_$]/
const IMPORT_KEYWORD = 'import'
const CLAUSE_WINDOW = 2_000
/** Pseudo-binding name reported for a default import; never sanctioned. */
const DEFAULT_BINDING = '<default>'

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && WORD.test(char)
}

function skipWhitespace(code: string, from: number): number {
  let cursor = from
  while (cursor < code.length && /\s/.test(code[cursor] ?? '')) cursor += 1
  return cursor
}

/**
 * Produces two views of the same source, aligned character for character:
 *
 * - `code` has comment bodies and string/template bodies blanked out, so a commented-out
 *   import neither trips nor satisfies the rule, and an `import(` inside a string is not
 *   mistaken for a dynamic import. Newlines survive, so line numbers stay accurate.
 * - `text` is the untouched original, needed because a module specifier *is* a string
 *   literal and blanking it in `code` would erase the very thing being checked.
 *
 * Quote characters are preserved in `code` so quoted positions can be located there and
 * their contents read back out of `text`.
 */
function maskSource(source: string): { code: string; text: string } {
  const out = source.split('')
  const ranges: Array<[number, number]> = []
  const mask = (from: number, toExclusive: number): void => {
    ranges.push([from, toExclusive])
  }

  const n = source.length
  let i = 0
  while (i < n) {
    const char = source[i]
    const next = source[i + 1]

    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', i)
      const stop = end === -1 ? n : end
      mask(i, stop)
      i = stop
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      mask(i, stop)
      i = stop
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      const quote = char
      let literalStart = i + 1
      i += 1
      while (i < n) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i += 1
          break
        }
        if (quote === '`' && source[i] === '$' && source[i + 1] === '{') {
          // A template substitution is real code: mask only the literal text around it
          // and leave the `${ ... }` span untouched, so an import inside it is still seen.
          mask(literalStart, i)
          let depth = 1
          i += 2
          while (i < n && depth > 0) {
            if (source[i] === '{') depth += 1
            else if (source[i] === '}') depth -= 1
            i += 1
          }
          literalStart = i
          continue
        }
        i += 1
      }
      if (i > n) i = n
      mask(literalStart, i - 1)
      continue
    }

    i += 1
  }

  for (const [from, toExclusive] of ranges) {
    for (let k = from; k < toExclusive; k += 1) {
      if (out[k] !== '\n') out[k] = ' '
    }
  }

  return { code: out.join(''), text: source }
}

function readBalanced(code: string, openIndex: number): { body: string; end: number } {
  const open = code[openIndex]
  const close = open === '(' ? ')' : open === '{' ? '}' : open === '[' ? ']' : ''
  if (close === '' || open === undefined) return { body: '', end: openIndex }
  let depth = 0
  for (let i = openIndex; i < code.length; i += 1) {
    if (code[i] === open) depth += 1
    else if (code[i] === close) {
      depth -= 1
      if (depth === 0) return { body: code.slice(openIndex + 1, i), end: i + 1 }
    }
  }
  return { body: code.slice(openIndex + 1), end: code.length }
}

/**
 * Reads a quoted literal starting at or after `from`. The quotes are located in `code`
 * (the body is blanked there, so the next quote character is the true closing one) and
 * the value is read from `text`.
 */
function readQuotedSpan(code: string, text: string, from: number): { specifier: string; end: number } {
  let open = -1
  for (let i = from; i < code.length && i - from <= CLAUSE_WINDOW; i += 1) {
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      open = i
      break
    }
  }
  if (open === -1) return { specifier: '', end: from }
  for (let i = open + 1; i < code.length; i += 1) {
    if (code[i] === '"' || code[i] === "'" || code[i] === '`') {
      return { specifier: text.slice(open + 1, i), end: i + 1 }
    }
  }
  return { specifier: text.slice(open + 1), end: code.length }
}

function readQuoted(code: string, text: string, from: number): string | undefined {
  return readQuotedSpan(code, text, from).specifier || undefined
}

function lineAt(source: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < source.length; i += 1) {
    if (source[i] === '\n') line += 1
  }
  return line
}

function parseBindingList(body: string): Binding[] {
  return body
    .split(',')
    .map((part) => part.replace(/\/\*[\s\S]*?\*\//g, ' ').trim())
    .filter((part) => part !== '')
    .map((part) => {
      const [original = '', alias] = part.split(/\s+as\s+/)
      // `type A` names `A`; the `type` modifier is not part of the binding.
      const head = original.trim().replace(/^type\s+/, '')
      return { name: (alias ?? head).trim(), isType: /^type\s+/.test(original) }
    })
    .filter((binding) => binding.name !== '')
}

/**
 * Parses the real import edges out of a module source.
 *
 * Static forms: `import 'x'`, `import d from 'x'`, `import * as ns from 'x'`,
 * `import { a, b as c } from 'x'` (binding list spanning lines), `import type ...` in
 * both the whole-clause and the per-binding `{ type A }` form, and a default import
 * combined with a named list. Dynamic forms: `import('x')` and `import type('x')`.
 */
function parseImports(source: string): ParsedImport[] {
  const { code, text } = maskSource(source)
  const lineSource = source
  const found: ParsedImport[] = []
  let cursor = 0

  while (cursor < code.length) {
    const index = code.indexOf(IMPORT_KEYWORD, cursor)
    if (index === -1) break
    cursor = index + IMPORT_KEYWORD.length
    if (isWordChar(code[index - 1]) || isWordChar(code[index + IMPORT_KEYWORD.length])) continue

    let position = skipWhitespace(code, cursor)
    let statementIsType = false
    if (
      code.startsWith('type', position) &&
      !isWordChar(code[position + 4]) &&
      // `import type from 'x'` is a default import named `type`, not a type import.
      !code.startsWith('from', skipWhitespace(code, position + 4))
    ) {
      statementIsType = true
      position = skipWhitespace(code, position + 4)
    }

    const next = code[position]

    if (next === '(') {
      const { body, end } = readBalanced(code, position)
      const specifier = readQuoted(code, text, position + 1) ?? body.trim()
      if (specifier !== '') {
        found.push({
          kind: statementIsType ? 'type' : 'dynamic',
          bindings: [],
          specifier,
          line: lineAt(lineSource, index),
        })
      }
      cursor = end
      continue
    }
    if (next === '.') {
      // `import.meta` is a meta-property, not an import edge.
      continue
    }

    // A side-effect import (`import 'x'`) is nothing but a quoted specifier, and it has
    // to be recognised *before* the `from` search: the specifier body is blanked in
    // `code`, so a windowed `from` search would run past the end of this statement and
    // swallow the next import's `from` clause, reporting the wrong specifier.
    if (code[position] === "'" || code[position] === '"' || code[position] === '`') {
      const literal = readQuotedSpan(code, text, position)
      if (literal.specifier !== '') {
        found.push({
          kind: 'side-effect',
          bindings: [],
          specifier: literal.specifier,
          line: lineAt(lineSource, index),
        })
      }
      cursor = Math.max(literal.end, cursor)
      continue
    }

    const clause = code.slice(position, position + CLAUSE_WINDOW)
    const fromIndex = /\bfrom\b/.exec(clause)?.index
    // Anything without a `from` is not an import clause this rule can judge.
    if (fromIndex === undefined) continue

    const specifier = readQuoted(code, text, position + fromIndex + 'from'.length)
    if (specifier === undefined || specifier === '') continue

    // The clause window deliberately runs past `from` so a multi-line binding list is
    // fully covered, which means `head` is the only part guaranteed to belong to *this*
    // statement. Searching the whole window for a brace would let a default import on
    // one line adopt the `{ ... }` of the import on the next.
    const head = clause.slice(0, fromIndex)
    const braceIndex = head.indexOf('{')
    const beforeBrace = braceIndex === -1 ? head : head.slice(0, braceIndex)
    // A default binding can sit before the named list: `import Foo, { A } from 'x'`.
    const hasDefault = /^[A-Za-z_$][\w$]*\s*(,|$)/.test(beforeBrace.trimStart())
    let bindings: Binding[] = []
    let kind: ImportKind

    if (/\*\s*as\s+[A-Za-z_$]/.test(head)) kind = 'namespace'
    else if (braceIndex !== -1) {
      const { body } = readBalanced(code, position + braceIndex)
      const named = parseBindingList(body)
      // `import type { A, B }` and `import { type A, type B }` are both type-only;
      // any untyped binding makes the clause a value edge.
      const namedOnlyTypes = named.every((binding) => binding.isType)
      bindings = hasDefault
        ? [{ name: DEFAULT_BINDING, isType: statementIsType }, ...named]
        : named
      kind = statementIsType || (namedOnlyTypes && !hasDefault) ? 'type' : 'value'
    } else kind = statementIsType ? 'type' : 'default'

    found.push({ kind, bindings, specifier, line: lineAt(lineSource, index) })
  }

  return found
}

/**
 * True when a specifier points into a lower layer the UI must not reach by value. Only
 * the first segment after the leading `./`/`../` markers is compared, so `./ui/copy`
 * and `./components/primitives` stay out of the check while `./domain/board` and
 * `../../domain/board` are both caught.
 */
function isLowerLayer(specifier: string): boolean {
  if (!specifier.startsWith('.')) return false
  const segments = specifier.split('/')
  while (segments[0] === '.' || segments[0] === '..') segments.shift()
  const layer = segments[0]
  return layer !== undefined && LOWER_LAYER_PREFIXES.includes(layer)
}

function classify(edge: ParsedImport): ImportViolation[] {
  if (!isLowerLayer(edge.specifier)) return []
  const base = { file: '', line: edge.line, specifier: edge.specifier, kind: edge.kind }

  if (edge.kind === 'type') return []
  if (edge.kind === 'namespace') {
    return [
      {
        ...base,
        binding: '<namespace>',
        reason: 'a namespace import reaches every export of the module, functions and classes included',
      },
    ]
  }
  if (edge.kind === 'default') {
    return [
      {
        ...base,
        binding: '<default>',
        reason: 'a default import is a value, and a lower-layer default may be a function or class',
      },
    ]
  }
  if (edge.kind === 'dynamic') {
    return [
      {
        ...base,
        binding: '<dynamic import>',
        reason: 'a dynamic import executes lower-layer module code at runtime',
      },
    ]
  }
  if (edge.kind === 'side-effect') {
    return [
      {
        ...base,
        binding: '<side-effect import>',
        reason: 'a side-effect import executes lower-layer module code at runtime',
      },
    ]
  }

  return edge.bindings
    // A per-binding `type` marker is erased just like an `import type` clause, so only
    // genuinely value bindings can cross the boundary as values.
    .filter((binding) => !binding.isType)
    .filter((binding) => !SANCTIONED_VALUES.includes(binding.name))
    .map((binding) => ({
      ...base,
      binding: binding.name,
      reason: `only pure constant tables may cross by value; sanctioned: ${SANCTIONED_VALUES.join(', ')}`,
    }))
}

function findLayerBoundaryViolations(file: string, source: string): ImportViolation[] {
  return parseImports(source)
    .flatMap((edge) => classify(edge))
    .map((violation) => ({ ...violation, file }))
}

function formatViolations(violations: readonly ImportViolation[]): string {
  const detail = violations
    .map(
      (violation) =>
        `  ${violation.file}:${violation.line} imports ${violation.binding} from ` +
        `'${violation.specifier}' [${violation.kind} import] — ${violation.reason}`,
    )
    .join('\n')
  return `UI layer boundary violation(s):\n${detail}\n\nRule: ${RULE}`
}

/**
 * Every component source plus the app root, discovered by Vite rather than hard-coded,
 * so a newly added component is covered the moment it lands. `import.meta.glob` is used
 * instead of `node:fs` because `tsconfig.app.json` pins `"types": ["vite/client"]`:
 * Node ambient types are deliberately kept out of `src/`, and adding them for this one
 * file leaks Node's `Timeout` into the whole program and breaks the sibling test files.
 *
 * `src/App.tsx` is named explicitly — it is the single UI entry point, and it sits in
 * `src/`, so it reaches a lower layer as `./domain/board` where a component reaches the
 * same module as `../../domain/board`. The guard judges both spellings alike.
 */
const RAW_UI_SOURCES: Record<string, string> = {
  ...import.meta.glob<string>('./components/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }),
  ...import.meta.glob<string>('../App.tsx', { query: '?raw', import: 'default', eager: true }),
}

const APP_SOURCE_FILE = '../App.tsx'

/** Component and app-root sources, keyed by their specifier. Test files are excluded. */
function enumerateUiSources(): Array<{ file: string; source: string }> {
  return Object.entries(RAW_UI_SOURCES)
    .filter(([file]) => !/\.test\.tsx?$/.test(file) && !/\.d\.tsx?$/.test(file))
    .map(([file, source]) => ({ file, source }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

// ======================================================================================
// Parser unit tests — a guard with no negative test is not a guard
// ======================================================================================

describe('layer boundary import parser', () => {
  it('rejects a value import of a lower-layer function', () => {
    const source = ["import { analyzeDifficulty } from '../../engine/solver/difficulty'", ''].join(
      '\n',
    )
    const violations = findLayerBoundaryViolations('synthetic.ts', source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.binding).toBe('analyzeDifficulty')
    expect(violations[0]?.kind).toBe('value')
    expect(violations[0]?.line).toBe(1)
  })

  it('rejects a multi-line value import, naming only the offending binding', () => {
    const source = [
      'import {',
      '  DEFAULT_GENERATION_ROWS,',
      '  normalizeGenerationSettings,',
      "} from '../../engine/generator/settings'",
    ].join('\n')
    const violations = findLayerBoundaryViolations('synthetic.ts', source)
    expect(violations.map((violation) => violation.binding)).toEqual([
      'normalizeGenerationSettings',
    ])
    expect(violations[0]?.line).toBe(1)
  })

  it('rejects a namespace import from a lower layer', () => {
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "import * as engine from '../../engine/rng'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('namespace')
  })

  it('rejects a default import from a lower layer', () => {
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "import reducer from '../../application/gameReducer'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('default')
  })

  it('rejects a side-effect import from a lower layer', () => {
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "import '../../application/gameStore'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('side-effect')
  })

  it('rejects a dynamic import of a lower-layer module', () => {
    const source = [
      'export async function load() {',
      "  const mod = await import('../../application/gameStore')",
      '  return mod.createGameStore()',
      '}',
    ].join('\n')
    const violations = findLayerBoundaryViolations('synthetic.ts', source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('dynamic')
    expect(violations[0]?.line).toBe(2)
  })

  it('rejects an import type(...) expression that names a runtime module path', () => {
    const source = "type Store = import type('../../application/gameStore')"
    expect(findLayerBoundaryViolations('synthetic.ts', source)).toEqual([])
    const mixed = "type Store = import('../../application/gameStore')"
    expect(findLayerBoundaryViolations('synthetic.ts', mixed)).toHaveLength(1)
  })

  it('rejects a default import combined with a type-only named list', () => {
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "import reducer, { type CellMark } from '../../application/gameReducer'",
    )
    expect(violations.map((violation) => violation.binding)).toEqual([DEFAULT_BINDING])
  })

  it('accepts a type-only default import', () => {
    expect(
      findLayerBoundaryViolations(
        'synthetic.ts',
        "import type GameStore from '../../application/gameStore'",
      ),
    ).toEqual([])
  })

  // Regression: the clause window used to be searched for a `{`, so a default import on
  // one line adopted the binding list of the import on the *next* line and reported a
  // bogus second violation. Each statement must only ever see its own bindings.
  it('does not let a default import adopt the next statement’s bindings', () => {
    const source = [
      "import reducer from '../../application/gameReducer'",
      "import type { Copy } from '../copy'",
    ].join('\n')
    const violations = findLayerBoundaryViolations('synthetic.ts', source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.binding).toBe(DEFAULT_BINDING)
    expect(violations[0]?.line).toBe(1)
    expect(violations[0]?.specifier).toBe('../../application/gameReducer')
  })

  it('keeps two adjacent lower-layer imports attributed to their own specifiers', () => {
    const source = [
      "import { normalizeGenerationSettings } from '../../engine/generator/settings'",
      "import { getBoardCell } from '../../domain/board'",
    ].join('\n')
    expect(findLayerBoundaryViolations('synthetic.ts', source).map((v) => [v.line, v.binding, v.specifier])).toEqual([
      [1, 'normalizeGenerationSettings', '../../engine/generator/settings'],
      [2, 'getBoardCell', '../../domain/board'],
    ])
  })

  it('rejects the worker layer, which is a lower layer too', () => {
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "import { createGenerationWorker } from '../../workers/generationWorker'",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.specifier).toBe('../../workers/generationWorker')
  })

  it('rejects a deep import that bypasses the layer index', () => {
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "import { generateBoard } from '../../engine/generator/generate'",
    )
    expect(violations).toHaveLength(1)
  })

  it('accepts type-only and sanctioned constant imports', () => {
    const source = [
      "import type { CellMark } from '../../application/gameReducer'",
      "import { MAX_BOARD_SIDE } from '../../domain/board'",
      "import { MIN_BOARD_SIDE, MAX_BOARD_CELLS } from '../../domain/board'",
      "import { MIN_STAR_SIDE, MAX_STAR_SIDE, DEFAULT_STAR_SIDE } from '../../domain/starBattle'",
      "import { MIN_STAR_LIVES, MAX_STAR_LIVES, DEFAULT_STAR_LIVES } from '../../domain/starBattle'",
      "import type { LineProgress } from '../../application/lineProgress'",
      "import type { generateBoard } from '../../engine/generator'",
      "import { type BoardDimensions } from '../../domain/board'",
      "import type GameStore from '../../application/gameStore'",
    ].join('\n')
    expect(findLayerBoundaryViolations('synthetic.ts', source)).toEqual([])
  })

  it('reports import(...) in a type position, erring toward the strict reading', () => {
    // `type X = import('m').T` is erased at build time and is genuinely harmless, but a
    // bare `import(...)` is indistinguishable from a runtime call without type
    // information, so the guard reports it. Reporting is the safe direction: the fix is
    // to spell it `import type('m')`, which is unambiguous.
    const violations = findLayerBoundaryViolations(
      'synthetic.ts',
      "export type Maybe = import('../../domain/board').BoardDimensions",
    )
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('dynamic')
    expect(
      findLayerBoundaryViolations(
        'synthetic.ts',
        "export type Maybe = import type('../../domain/board').BoardDimensions",
      ),
    ).toEqual([])
  })

  it('ignores a commented-out import instead of tripping on it', () => {
    const source = [
      "import { MAX_BOARD_SIDE } from '../../domain/board'",
      "// import { analyzeDifficulty } from '../../engine/solver/difficulty'",
      '/*',
      "import { previewMarkBatch } from '../../application/gameReducer'",
      '*/',
    ].join('\n')
    expect(findLayerBoundaryViolations('synthetic.ts', source)).toEqual([])
  })

  it('ignores imports that only appear inside strings', () => {
    const source = [
      'const hint = "import { analyzeDifficulty } from \'../../engine/solver/difficulty\'"',
      "const literal = 'import('../../application/gameStore')'",
      "const withSlash = 'a string with a // slash and a /* star'",
      'const template = `import { previewMarkBatch } from \'../../application/gameReducer\'`',
    ].join('\n')
    expect(findLayerBoundaryViolations('synthetic.ts', source)).toEqual([])
  })

  it('still sees an import inside a template substitution', () => {
    // `${ ... }` holds real code, so an import there must not be masked away.
    const source = [
      "const mod = `${await import('../../application/gameStore')}`",
    ].join('\n')
    const violations = findLayerBoundaryViolations('synthetic.ts', source)
    expect(violations).toHaveLength(1)
    expect(violations[0]?.kind).toBe('dynamic')
    expect(violations[0]?.specifier).toBe('../../application/gameStore')
  })

  it('does not treat import.meta as an import edge', () => {
    expect(findLayerBoundaryViolations('synthetic.ts', 'const url = import.meta.url')).toEqual([])
  })

  it('ignores imports from the UI layer and from sibling modules', () => {
    const source = [
      "import { createGameStore } from './gameStore'",
      "import { DEFAULT_LOCALE } from './copy'",
      "import { helper } from '../domain-testing/fake'",
    ].join('\n')
    expect(findLayerBoundaryViolations('synthetic.ts', source)).toEqual([])
  })

  // `src/App.tsx` sits in `src/`, so it spells a lower-layer specifier `./domain/...`
  // where a component under `src/ui/components/` spells `../../domain/...`. The guard
  // matches the layer directory, not the depth, so both spellings are judged alike —
  // without this, App.tsx would be silently unguarded.
  it('judges a lower layer written at the shallower depth src/App.tsx uses', () => {
    const rejected = findLayerBoundaryViolations(
      'App.tsx',
      [
        "import { getBoardCell } from './domain/board'",
        "import { analyzeDifficulty } from './engine/solver/difficulty'",
        "import { createGameStore } from './application/gameStore'",
        "import { createGenerationWorker } from './workers/generationWorker'",
      ].join('\n'),
    )
    expect(rejected.map((violation) => violation.specifier)).toEqual([
      './domain/board',
      './engine/solver/difficulty',
      './application/gameStore',
      './workers/generationWorker',
    ])

    const accepted = findLayerBoundaryViolations(
      'App.tsx',
      [
        "import type { SettingsDraft } from './ui/gameStore'",
        "import { AppBanner } from './ui/components/AppBanner'",
        "import { defaultDraft } from './ui/components/defaults'",
        "import { MAX_BOARD_SIDE } from './domain/board'",
      ].join('\n'),
    )
    expect(accepted).toEqual([])
  })

  it('names the file, line, binding, specifier, and the rule in the failure message', () => {
    const source = "import { gameReducer } from '../../application/gameReducer'"
    const message = formatViolations(findLayerBoundaryViolations('SettingsPanel.tsx', source))
    expect(message).toContain('SettingsPanel.tsx:1')
    expect(message).toContain('gameReducer')
    expect(message).toContain("'../../application/gameReducer'")
    expect(message).toContain('Layer coupling from the UI layer')
    expect(message).toContain('generation trace')
  })
})

// ======================================================================================
// Sanctioned constants must still be constants
// ======================================================================================

describe('sanctioned UI layer constants', () => {
  it('still exist and are primitives or frozen tables', () => {
    expect(typeof MAX_BOARD_SIDE).toBe('number')
    expect(typeof MAX_BOARD_CELLS).toBe('number')
    expect(typeof MIN_BOARD_SIDE).toBe('number')
    expect(typeof MIN_STAR_SIDE).toBe('number')
    expect(typeof MAX_STAR_SIDE).toBe('number')
    expect(typeof DEFAULT_STAR_SIDE).toBe('number')
    expect(typeof MIN_STAR_LIVES).toBe('number')
    expect(typeof MAX_STAR_LIVES).toBe('number')
    expect(typeof DEFAULT_STAR_LIVES).toBe('number')
    expect(typeof DEFAULT_GENERATION_ROWS).toBe('number')
    expect(typeof DEFAULT_GENERATION_COLUMNS).toBe('number')
    expect(typeof DEFAULT_GENERATION_DENSITY_PERCENT).toBe('number')
    expect(typeof DEFAULT_GENERATION_DIFFICULTY).toBe('string')
    expect(typeof DEFAULT_GENERATION_SEED).toBe('number')
    expect(typeof DEFAULT_MAX_GENERATION_ATTEMPTS).toBe('number')
    expect(typeof DEFAULT_INITIAL_SCORE).toBe('number')
    expect(Object.isFrozen(DIFFICULTY_BANDS)).toBe(true)
    expect(Array.isArray(DIFFICULTY_BANDS)).toBe(true)
  })

  it('blesses no name that no longer resolves to a real constant', () => {
    // Every sanctioned name is bound here from its real module. If a name is deleted or
    // renamed the import stops compiling, and the equality below still fails if someone
    // adds a name to the sanctioned list without wiring it to a live constant.
    const live: Readonly<Record<string, unknown>> = {
      MAX_BOARD_SIDE,
      MAX_BOARD_CELLS,
      MIN_BOARD_SIDE,
      MIN_STAR_SIDE,
      MAX_STAR_SIDE,
      DEFAULT_STAR_SIDE,
      MIN_STAR_LIVES,
      MAX_STAR_LIVES,
      DEFAULT_STAR_LIVES,
      DIFFICULTY_BANDS,
      DEFAULT_GENERATION_ROWS,
      DEFAULT_GENERATION_COLUMNS,
      DEFAULT_GENERATION_DENSITY_PERCENT,
      DEFAULT_GENERATION_DIFFICULTY,
      DEFAULT_GENERATION_SEED,
      DEFAULT_MAX_GENERATION_ATTEMPTS,
      DEFAULT_INITIAL_SCORE,
    }
    expect(SANCTIONED_VALUES.length).toBe(new Set(SANCTIONED_VALUES).size)
    expect(Object.keys(live).sort()).toEqual([...SANCTIONED_VALUES].sort())
    for (const name of SANCTIONED_VALUES) {
      expect(live[name], `sanctioned constant ${name} resolves to undefined`).toBeDefined()
    }
  })
})

// ======================================================================================
// The guard itself, over the real component sources
// ======================================================================================

describe('UI layer boundary over component sources', () => {
  it('discovers the component sources, so it cannot pass vacuously', () => {
    const sources = enumerateUiSources()
    expect(sources.length).toBeGreaterThan(0)
    expect(sources.map((entry) => entry.file)).toContain(APP_SOURCE_FILE)
    // Every component, not a hand-picked few.
    expect(sources.map((entry) => entry.file)).toContain('./components/SettingsPanel.tsx')
    expect(sources.map((entry) => entry.file)).toContain('./components/BoardSurface.tsx')
    for (const { source } of sources) expect(source.length).toBeGreaterThan(0)
  })

  it('imports only types and pure constant tables from domain, engine, and application', () => {
    const violations = enumerateUiSources().flatMap(({ file, source }) =>
      findLayerBoundaryViolations(file, source),
    )
    expect(violations, formatViolations(violations)).toEqual([])
  })

  it('sees the real inward imports, so the pass above is not an empty match', () => {
    const edges: ParsedImport[] = []
    for (const { source } of enumerateUiSources()) {
      for (const edge of parseImports(source)) {
        if (isLowerLayer(edge.specifier)) edges.push(edge)
      }
    }
    const typeEdges = edges.filter((edge) => edge.kind === 'type')
    const valueEdges = edges.filter((edge) => edge.kind === 'value')
    expect(typeEdges.length).toBeGreaterThan(0)
    expect(valueEdges.length).toBeGreaterThan(0)
    for (const edge of valueEdges) {
      expect(edge.bindings.length).toBeGreaterThan(0)
      for (const binding of edge.bindings) {
        expect(SANCTIONED_VALUES, `${binding.name} is not sanctioned`).toContain(binding.name)
      }
    }
  })
})
