import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LOCALE,
  LOCALES,
  THEME_PREFERENCES,
  bandLabel,
  describeCell,
  describeClue,
  describeLine,
  dictionaries,
  failureCopy,
  formatDiagnostics,
  getCopy,
  interpolate,
  isDifficultyBand,
  isLocale,
  isThemePreference,
  mergeDeep,
  zhCN,
  type Copy,
  type DescribedCell,
  type Locale,
} from './copy'
import type { JsonObject } from '../application/gameReducer'

const EN = dictionaries.en
const ZH = dictionaries['zh-CN']
const LOCALES_TESTED: readonly Locale[] = LOCALES

// --------------------------------------------------------------------------------------
// Dictionary shape helpers
// --------------------------------------------------------------------------------------

interface Leaf {
  readonly path: string
  readonly value: unknown
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Arrays are leaves, so a remedy list is compared as a whole. */
function leaves(node: unknown, prefix = '', out: Leaf[] = []): Leaf[] {
  if (isPlainObject(node)) {
    for (const key of Object.keys(node).sort()) {
      leaves(node[key], prefix === '' ? key : `${prefix}.${key}`, out)
    }
    return out
  }
  out.push({ path: prefix, value: node })
  return out
}

function readAt(node: unknown, path: string): unknown {
  let current: unknown = node
  for (const key of path.split('.')) {
    if (!isPlainObject(current)) {
      return undefined
    }
    current = current[key]
  }
  return current
}

function leafStrings(leaf: Leaf): string[] {
  return Array.isArray(leaf.value) ? leaf.value.map((entry) => String(entry)) : [String(leaf.value)]
}

const EN_LEAVES = leaves(EN)
const ZH_LEAVES = leaves(ZH)
const OVERRIDE_PATHS = new Set(leaves(zhCN).map((leaf) => leaf.path))

/** Every reason token the app can surface, from all three unions. */
const REASON_TOKENS: readonly string[] = [
  // GenerationFailureReason
  'cancelled',
  'time-limit',
  'resource-limit',
  'attempt-limit',
  'difficulty-not-found',
  'infeasible',
  // generationClient / generationWorker
  'worker-exception',
  'worker-error',
  'worker-message-error',
  'worker-unavailable',
  'worker-post-error',
  'invalid-worker-response',
  'invalid-generated-round',
  // GameResultReason
  'not-generating',
  'stale-generation-id',
  'invalid-settings',
  'invalid-initial-score',
  'invalid-difficulty',
  'round-not-playing',
  'invalid-batch',
  'conflicting-assertions',
  'invalid-cell-index',
  'invalid-cell-assertion',
  'round-not-resumable',
  'locked-cell',
  'cell-already-marked',
  'cell-already-unknown',
]

// Machine text the dictionary must never surface.
const ENGINE_TEXT: readonly string[] = [
  'Minegram generation failed',
  'Minegram generation threw an exception',
  'Generation cancelled',
  'generation dimensions must',
  'should be a number',
  'must be one of',
  'received an unreadable',
  'Received:',
]
const ENGINE_PATTERN = /Minegram generation (?:failed|threw)|\b(?:Type|Range|Reference|DOM)Error\b/

describe('copy', () => {
  it('exposes the two locales and resolves each of them', () => {
    expect(LOCALES_TESTED).toEqual(['en', 'zh-CN'])
    expect(DEFAULT_LOCALE).toBe('en')
    expect(isLocale('en')).toBe(true)
    expect(isLocale('zh-CN')).toBe(true)
    expect(isLocale('fr')).toBe(false)
    expect(isLocale(null)).toBe(false)
    for (const locale of LOCALES_TESTED) {
      expect(getCopy(locale)).toBe(dictionaries[locale])
    }
  })

  it('en is exhaustive: every leaf is a non-empty string or a non-empty list', () => {
    expect(EN_LEAVES.length).toBeGreaterThan(150)
    for (const leaf of EN_LEAVES) {
      const values = leafStrings(leaf)
      expect(values.length, leaf.path).toBeGreaterThan(0)
      for (const value of values) {
        expect(value.trim().length, leaf.path).toBeGreaterThan(0)
      }
    }
  })

  it('zh-CN has exactly the en key shape', () => {
    expect(ZH_LEAVES.map((leaf) => leaf.path).sort()).toEqual(EN_LEAVES.map((leaf) => leaf.path).sort())
    for (const path of OVERRIDE_PATHS) {
      expect(readAt(EN, path), `override without an en key: ${path}`).toBeDefined()
    }
  })

  it('falls back to en for every key zh-CN does not override', () => {
    // Phase 4 ships a complete dictionary, so the fallback is exercised with a
    // deliberately sparse override rather than by dropping real copy.
    const sparse = mergeDeep(EN, { status: { region: { idle: '空闲' } } })
    expect(readAt(sparse, 'status.region.idle')).toBe('空闲')
    let missing = 0
    for (const leaf of EN_LEAVES) {
      const resolved = readAt(sparse, leaf.path)
      if (leaf.path === 'status.region.idle') {
        expect(resolved, leaf.path).toBe('空闲')
      } else {
        missing += 1
        expect(resolved, leaf.path).toEqual(leaf.value)
      }
    }
    expect(missing).toBe(EN_LEAVES.length - 1)
    expect(mergeDeep(EN, {})).toEqual(EN)
    for (const leaf of EN_LEAVES) {
      expect(readAt(ZH, leaf.path), leaf.path).toEqual(
        OVERRIDE_PATHS.has(leaf.path) ? readAt(zhCN, leaf.path) : leaf.value,
      )
    }
  })

  it('ships real 简体中文 for the chrome copy rather than a stub', () => {
    // Product names, storage keys, units, symbols, key names, and the two
    // templates whose Chinese form is full-width punctuation rather than hanzi.
    const KEEP_AS_IS: readonly string[] = [
      'app.wordmark',
      'app.product',
      'locale.en',
      'locale.zhCN',
      'generation.caret',
      'settings.units.percent',
      'storage.locale',
      'storage.theme',
      'storage.onboarded',
      'storage.fingerMarking',
      'storage.panelSettings',
      'storage.panelLegend',
      'help.actions.cancelDrag.keyboard',
      'cell.describe',
      'clue.describe',
    ]
    const overrides = EN_LEAVES.filter(
      (leaf) => OVERRIDE_PATHS.has(leaf.path) && !KEEP_AS_IS.includes(leaf.path),
    )
    expect(overrides.length).toBeGreaterThanOrEqual(EN_LEAVES.length / 2)
    const chinese = overrides.filter((leaf) =>
      leafStrings({ path: leaf.path, value: readAt(ZH, leaf.path) }).some((value) =>
        /[\u4e00-\u9fff]/.test(value),
      ),
    )
    expect(chinese.length).toBe(overrides.length)
    // Chinese copy is a translation, not a copy of the Latin string.
    const translated = overrides.filter(
      (leaf) => JSON.stringify(readAt(ZH, leaf.path)) !== JSON.stringify(leaf.value),
    )
    expect(translated.length).toBe(overrides.length)
  })

  it('never stores engine or exception text in any dictionary', () => {
    for (const [name, dictionary] of [
      ['en', EN],
      ['zh-CN', ZH],
    ] as const) {
      for (const leaf of leaves(dictionary)) {
        for (const value of leafStrings(leaf)) {
          for (const fragment of ENGINE_TEXT) {
            expect(value, `${name}:${leaf.path}`).not.toContain(fragment)
          }
          expect(ENGINE_PATTERN.test(value), `${name}:${leaf.path}`).toBe(false)
        }
      }
    }
  })

  it('covers every failure reason the app can report', () => {
    const reasons = EN.failure.reasons
    for (const token of REASON_TOKENS) {
      const entry = reasons[token as keyof typeof reasons]
      expect(entry, token).toBeDefined()
      expect(entry.headline.trim().length, token).toBeGreaterThan(0)
      expect(entry.explanation.trim().length, token).toBeGreaterThan(0)
      expect(entry.remedies.length, token).toBeGreaterThan(0)
    }
    expect(Object.keys(reasons).sort()).toEqual([...REASON_TOKENS].sort())
  })

  it('keeps the dictionary calm: no exclamation marks and no emoji', () => {
    const emoji = /[\u{1f300}-\u{1faff}\u{2600}-\u{27bf}]/u
    for (const leaf of EN_LEAVES) {
      for (const value of leafStrings(leaf)) {
        expect(value, leaf.path).not.toContain('!')
        expect(emoji.test(value), leaf.path).toBe(false)
      }
    }
  })
})

// --------------------------------------------------------------------------------------
// Interpolation
// --------------------------------------------------------------------------------------

describe('interpolate', () => {
  it('fills known placeholders and leaves unknown ones in place', () => {
    expect(interpolate('Round {round} of {total}', { round: 3, total: 9 })).toBe('Round 3 of 9')
    expect(interpolate('Round {round}')).toBe('Round {round}')
    expect(interpolate('Round {round}', { round: 0 })).toBe('Round 0')
    expect(interpolate('no placeholders')).toBe('no placeholders')
  })
})

// --------------------------------------------------------------------------------------
// Cell description
// --------------------------------------------------------------------------------------

const CELLS: readonly { readonly name: string; readonly cell: DescribedCell }[] = [
  {
    name: 'unmarked',
    cell: { row: 0, column: 0, mark: 'unknown', locked: false, correct: null },
  },
  { name: 'confirmed mine', cell: { row: 0, column: 1, mark: 'mine', locked: true, correct: true } },
  {
    name: 'confirmed empty',
    cell: { row: 1, column: 0, mark: 'blank', locked: true, correct: true },
  },
  { name: 'wrong mine', cell: { row: 1, column: 1, mark: 'mine', locked: false, correct: false } },
  { name: 'wrong blank', cell: { row: 2, column: 2, mark: 'blank', locked: false, correct: false } },
]

describe('describeCell', () => {
  for (const locale of LOCALES_TESTED) {
    it(`produces distinct non-empty text for all five states in ${locale}`, () => {
      const t = getCopy(locale)
      const texts = CELLS.map(({ name, cell }) => {
        const text = describeCell(t, cell)
        expect(text.trim().length, name).toBeGreaterThan(0)
        return text
      })
      expect(new Set(texts).size).toBe(CELLS.length)
    })

    it(`keeps the one-based position in ${locale}`, () => {
      const t = getCopy(locale)
      expect(describeCell(t, CELLS[3].cell)).toContain(
        interpolate(t.cell.position, { row: 2, column: 2 }),
      )
    })
  }

  it('treats a null correctness the same as an unmarked cell', () => {
    const t = getCopy('en')
    const unmarked = describeCell(t, CELLS[0].cell)
    const markedButUnscored = describeCell(t, {
      row: 0,
      column: 0,
      mark: 'mine',
      locked: false,
      correct: null,
    })
    expect(markedButUnscored).toContain(t.cell.unmarked)
    expect(unmarked).toContain(t.cell.unmarked)
  })
})

// --------------------------------------------------------------------------------------
// Clue and line description
// --------------------------------------------------------------------------------------

describe('describeClue', () => {
  for (const locale of LOCALES_TESTED) {
    it(`renders the ordered run grammar in ${locale}`, () => {
      const t = getCopy(locale)
      const forward = describeClue(t, [3, 5, 1])
      const shuffled = describeClue(t, [3, 1, 5])
      const empty = describeClue(t, [])
      expect(forward).toBe('3 5 1')
      expect(shuffled).toBe('3 1 5')
      expect(forward).not.toBe(shuffled)
      expect(empty).toBe(t.clue.empty)
      expect(empty.trim().length).toBeGreaterThan(0)
      expect(new Set([forward, shuffled, empty]).size).toBe(3)
    })
  }
})

describe('describeLine', () => {
  const t: Copy = getCopy('en')
  const base = {
    orientation: 'row',
    index: 0,
    clue: [1, 2],
    status: 'ready',
    contradiction: false,
    complete: false,
    runs: [{ complete: false }],
  } as const

  it('fails closed: a contradiction is never described as complete', () => {
    const text = describeLine(t, { ...base, contradiction: true, complete: true })
    expect(text).toContain(t.clue.contradiction)
    expect(text).not.toContain(t.clue.lineComplete)
  })

  it('fails closed: an unresolved line says so', () => {
    const text = describeLine(t, { ...base, status: 'unknown' })
    expect(text).toContain(t.clue.unresolvedTitle)
    expect(text).toContain('row 1')
  })

  it('names a complete run and a complete line distinctly', () => {
    const runText = describeLine(t, { ...base, runs: [{ complete: true }, { complete: false }] })
    const lineText = describeLine(t, { ...base, complete: true })
    expect(runText).toContain(interpolate(t.clue.runComplete, { position: 1, total: 2 }))
    expect(lineText).toContain(t.clue.lineComplete)
    expect(runText).not.toBe(lineText)
  })

  it('keeps the clue digits verbatim in both orientations', () => {
    expect(describeLine(t, base)).toContain('1 2')
    expect(describeLine(t, { ...base, orientation: 'column', index: 4 })).toContain('column 5')
  })
})

// --------------------------------------------------------------------------------------
// Failure copy
// --------------------------------------------------------------------------------------

describe('failureCopy', () => {
  it('returns the mapped copy for a known reason', () => {
    const t = getCopy('en')
    for (const token of REASON_TOKENS) {
      const text = failureCopy(t, token)
      expect(text.headline.trim().length, token).toBeGreaterThan(0)
      expect(text.explanation.trim().length, token).toBeGreaterThan(0)
      expect(text.remedies.length, token).toBeGreaterThan(0)
    }
    expect(failureCopy(t, 'difficulty-not-found').headline).not.toBe(
      failureCopy(t, 'time-limit').headline,
    )
  })

  it('never leaks an unrecognised reason token', () => {
    const t = getCopy('en')
    const text = failureCopy(t, 'engine-threw-something-new')
    expect(text).toEqual(t.failure.unknownReason)
    expect(text.headline).not.toContain('engine-threw-something-new')
  })

  it('is translated', () => {
    expect(failureCopy(getCopy('zh-CN'), 'infeasible').headline).toBe(
      getCopy('zh-CN').failure.reasons.infeasible.headline,
    )
  })
})

describe('reveal announcement copy', () => {
  /**
   * Every reveal sentence is composed in the component from an independently
   * pluralised line phrase and an independently pluralised cell phrase, because one
   * line can hide three filled cells: selecting the sentence on the line count while
   * interpolating the cell count is what put "3 cell" in the live region. These keys
   * are the guard against that coming back, so each pair has to exist in both
   * locales, and the English forms of a pair have to differ.
   */
  const PAIRS: readonly (readonly [string, string])[] = [
    ['marksAppliedOne', 'marksAppliedMany'],
    ['revealCellsOne', 'revealCellsMany'],
    ['revealLinesOne', 'revealLinesMany'],
    ['revealCountOne', 'revealCountMany'],
  ]

  /** `announce` is a flat string map; the pairs above name its keys. */
  function announceOf(t: Copy): Record<string, string> {
    return t.announce as unknown as Record<string, string>
  }

  function placeholdersOf(text: string): readonly string[] {
    return [...text.matchAll(/\{([a-z]+)\}/g)].map((match) => match[1]).sort()
  }

  it('has a singular and a plural form for every pluralised pair, in both locales', () => {
    for (const locale of LOCALES_TESTED) {
      const announce = announceOf(getCopy(locale))
      for (const [one, many] of PAIRS) {
        expect(announce[one].trim().length, `${locale}:${one}`).toBeGreaterThan(0)
        expect(announce[many].trim().length, `${locale}:${many}`).toBeGreaterThan(0)
      }
      // English needs the pair; the en forms must actually differ. Chinese has no
      // plural inflection, so its two forms are the same phrase on purpose.
      if (locale === 'en') {
        for (const [one, many] of PAIRS) {
          expect(announce[one], one).not.toBe(announce[many])
        }
      }
    }
  })

  it('gives every reveal template exactly the placeholders it is composed with', () => {
    // `{cells}` and `{lines}` take whole phrases, so both locales carry both
    // placeholders in their own order; a missing one would reach the player as a
    // literal `{lines}`.
    const expected: readonly (readonly [string, readonly string[]])[] = [
      ['marksAppliedOne', ['assertion', 'cells', 'score', 'wrong']],
      ['marksAppliedMany', ['assertion', 'cells', 'score', 'wrong']],
      ['revealNote', ['cells', 'lines']],
      ['revealOnly', ['cells', 'lines', 'score']],
      ['revealCellsOne', ['cells']],
      ['revealCellsMany', ['cells']],
      ['revealLinesOne', []],
      ['revealLinesMany', ['lines']],
      ['revealCountOne', ['lines']],
      ['revealCountMany', ['lines']],
    ]
    for (const locale of LOCALES_TESTED) {
      const announce = announceOf(getCopy(locale))
      for (const [key, placeholders] of expected) {
        expect(placeholdersOf(announce[key]), `${locale}:${key}`).toEqual(placeholders)
      }
      const note = interpolate(announce.revealNote, {
        cells: interpolate(announce.revealCellsMany, { cells: 5 }),
        lines: interpolate(announce.revealLinesMany, { lines: 2 }),
      })
      expect(note, `${locale}:revealNote`).not.toMatch(/\{[a-z]+\}/)
      expect(note, `${locale}:revealNote`).toContain('5')
      expect(note, `${locale}:revealNote`).toContain('2')
      const only = interpolate(announce.revealOnly, {
        cells: interpolate(announce.revealCellsOne, { cells: 1 }),
        lines: interpolate(announce.revealCountOne, { lines: 1 }),
        score: 4,
      })
      expect(only, `${locale}:revealOnly`).not.toMatch(/\{[a-z]+\}/)
      expect(only, `${locale}:revealOnly`).toContain('4')
    }
  })

  it('never credits the game-written cells to the player', () => {
    // The player's own count is the `cells` of the `marksApplied` pair, and it excludes
    // the reveal. The reveal's sentence must not reuse that wording, or the region
    // would be claiming an assertion the player never made.
    const t = getCopy('en')
    const revealSentences = [t.announce.revealNote, t.announce.revealOnly]
    for (const sentence of revealSentences) {
      expect(sentence).not.toContain(t.announce.marksAppliedOne)
      expect(sentence).not.toContain(t.announce.marksAppliedMany)
      expect(sentence).toContain('game')
    }
    expect(revealSentences.join(' ')).not.toContain('Marked')
  })
})

describe('bandLabel', () => {
  it('names a known band and passes an unknown token through', () => {
    const t = getCopy('en')
    expect(isDifficultyBand('starter')).toBe(true)
    expect(isDifficultyBand('impossible')).toBe(false)
    expect(bandLabel(t, 'expert')).toBe(t.tokens.bands.expert)
    expect(bandLabel(t, 'impossible')).toBe('impossible')
  })
})

// --------------------------------------------------------------------------------------
// Failure report whitelist
// --------------------------------------------------------------------------------------

const DETAILS: JsonObject = {
  settings: {
    rows: 15,
    columns: 15,
    densityPercent: 60,
    mineCount: 135,
    difficulty: 'starter',
    seed: 'alpha',
    maxAttempts: 8,
    unlistedSetting: 'ignored',
  },
  diagnostics: {
    attempts: 8,
    layouts: 12,
    candidates: 3,
    accepted: 1,
    rollbacks: 2,
    solverCalls: 40,
    solverStatuses: ['unique', 'unique', 'unknown'],
    resourceReasons: [],
    difficultyNodesVisited: 120,
    difficultyNodeLimit: 2000,
    proofStatus: 'unique',
    difficultyStatus: 'known',
    difficultyReason: null,
    minimumGuesses: 0,
    band: 'starter',
    unlistedDiagnostic: { nested: 'ignored' },
  },
  engineStack: 'at Object.generate',
}

describe('formatDiagnostics', () => {
  it('emits only whitelisted rows, in the documented order', () => {
    const t = getCopy('en')
    const rows = formatDiagnostics(t, { details: DETAILS, authoredSeed: 'alpha' })
    expect(rows.map((row) => row.label)).toEqual([
      t.failure.report.rows,
      t.failure.report.columns,
      t.failure.report.density,
      t.failure.report.mineCount,
      t.failure.report.difficultyBand,
      t.failure.report.maxAttempts,
      t.failure.report.seed,
      t.failure.report.seedSource,
      t.failure.report.attempts,
      t.failure.report.layouts,
      t.failure.report.candidates,
      t.failure.report.accepted,
      t.failure.report.rollbacks,
      t.failure.report.solverCalls,
      t.failure.report.difficultyNodesVisited,
      t.failure.report.difficultyNodeLimit,
      t.failure.report.proofStatus,
      t.failure.report.difficultyStatus,
      t.failure.report.minimumGuesses,
      t.failure.report.band,
      t.failure.report.solverStatuses,
      t.failure.report.resourceReasons,
    ])
    const rendered = JSON.stringify(rows)
    expect(rendered).not.toContain('unlistedSetting')
    expect(rendered).not.toContain('unlistedDiagnostic')
    expect(rendered).not.toContain('engineStack')
    expect(rendered).not.toContain('difficultyReason')
  })

  it('formats values as prose rather than raw tokens', () => {
    const t = getCopy('en')
    const rows = formatDiagnostics(t, { details: DETAILS, authoredSeed: 'alpha' })
    const value = (label: string): string => {
      const row = rows.find((entry) => entry.label === label)
      expect(row, label).toBeDefined()
      return row?.value ?? ''
    }
    expect(value(t.failure.report.density)).toBe(`60${t.settings.units.percent}`)
    expect(value(t.failure.report.mineCount)).toBe('135')
    expect(value(t.failure.report.difficultyBand)).toBe(t.tokens.bands.starter)
    expect(value(t.failure.report.band)).toBe(t.tokens.bands.starter)
    expect(value(t.failure.report.proofStatus)).toBe(t.tokens.proof.unique)
    expect(value(t.failure.report.difficultyStatus)).toBe(t.tokens.difficultyStatus.known)
    expect(value(t.failure.report.solverStatuses)).toBe(
      interpolate(t.failure.report.list, { count: 3, values: 'unique, unknown' }),
    )
    expect(value(t.failure.report.resourceReasons)).toBe(t.failure.report.emptyList)
    expect(value(t.failure.report.seed)).toBe('alpha')
    expect(value(t.failure.report.seedSource)).toBe(t.failure.report.seedSourceAuthored)
  })

  it('marks a derived seed without ever printing its value', () => {
    const t = getCopy('en')
    const rows = formatDiagnostics(t, {
      details: DETAILS,
      authoredSeed: '',
      seedDerived: true,
      round: 2,
    })
    const seed = rows.find((row) => row.label === t.failure.report.seed)
    const source = rows.find((row) => row.label === t.failure.report.seedSource)
    expect(seed?.value).toBe(t.failure.report.seedUnavailable)
    expect(source?.value).toBe(interpolate(t.failure.report.seedSourceDerived, { round: 2 }))
    expect(JSON.stringify(rows)).not.toContain('round:')
  })

  it('degrades to the seed rows alone when the engine sent no details', () => {
    const t = getCopy('en')
    const rows = formatDiagnostics(t, { details: {}, authoredSeed: 'alpha' })
    expect(rows.map((row) => row.label)).toEqual([
      t.failure.report.seed,
      t.failure.report.seedSource,
    ])
    expect(formatDiagnostics(t, { details: DETAILS, authoredSeed: '' })).toHaveLength(
      formatDiagnostics(t, { details: DETAILS, authoredSeed: 'alpha' }).length,
    )
    expect(Object.isFrozen(rows)).toBe(true)
  })
})

// --------------------------------------------------------------------------------------
// Chrome
// --------------------------------------------------------------------------------------

describe('footer chrome', () => {
  it('names the seed, the theme and the locale', () => {
    const t = getCopy('en')
    expect(t.footer.seed.trim().length).toBeGreaterThan(0)
    expect(t.footer.seedUnavailable.trim().length).toBeGreaterThan(0)
    expect(t.footer.language).toBe(t.locale.label)
    expect(t.footer.theme).toBe(t.theme.label)
    expect(t.storage.locale).toBe('minegram.lang')
    expect(t.storage.theme).toBe('minegram.theme')
    expect(t.storage.onboarded).toBe('minegram.onboarded')
  })

  it('ships the three theme preferences and keeps the derived seed clipboard-only', () => {
    const t = getCopy('en')
    expect(THEME_PREFERENCES).toEqual(['auto', 'light', 'dark'])
    expect(isThemePreference('auto')).toBe(true)
    expect(isThemePreference('sepia')).toBe(false)
    expect(t.failure.report.seedDerived).toContain('clipboard')
    expect(getCopy('zh-CN').failure.report.seedDerived).toContain('剪贴板')
    expect(t.settings.seed.hint).toContain('derive')
  })
})
