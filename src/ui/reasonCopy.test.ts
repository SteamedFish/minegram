import { describe, expect, it } from 'vitest'
import { LOCALES, type Locale } from './copy'
import { GAME_RESULT_REASONS, reasonLabel, reasonLabels } from './reasonCopy'

const EN: Locale = 'en'
const ZH_CN: Locale = 'zh-CN'

/**
 * The union in source order, spelled out here so this file fails if the
 * application adds or drops a member without the table following it.
 */
const EXPECTED_MEMBERS: readonly string[] = [
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

describe('reasonCopy', () => {
  it('labels every reason in every locale', () => {
    expect([...GAME_RESULT_REASONS].sort()).toEqual([...EXPECTED_MEMBERS].sort())
    expect(new Set(GAME_RESULT_REASONS).size).toBe(GAME_RESULT_REASONS.length)
    for (const locale of LOCALES) {
      for (const reason of GAME_RESULT_REASONS) {
        const label = reasonLabel(reason, locale)
        expect(typeof label, `${locale} ${reason}`).toBe('string')
        expect(label?.trim(), `${locale} ${reason}`).toBe(label)
        expect((label ?? '').length, `${locale} ${reason}`).toBeGreaterThan(0)
        expect(reasonLabels(locale)[reason], `${locale} ${reason}`).toBe(label)
      }
    }
  })

  it('shows no identifier, key, or placeholder to a player', () => {
    for (const locale of LOCALES) {
      for (const reason of GAME_RESULT_REASONS) {
        const label = reasonLabel(reason, locale) ?? ''
        const where = `${locale} ${reason}`
        // Not the reason itself, and not any other reason, in any casing.
        expect(label.toLowerCase(), where).not.toContain(reason.toLowerCase())
        // No snake_case identifier, no interpolation brace, no lookup artefact.
        expect(label, where).not.toMatch(/_/)
        expect(label, where).not.toMatch(/[{}]/)
        expect(label, where).not.toMatch(/\bundefined\b|\bnull\b|\bNaN\b/)
        // A sentence, not a noun: it ends in a full stop.
        expect(label, where).toMatch(/[.。]$/)
      }
    }
  })

  it('translates rather than falling back to English', () => {
    for (const reason of GAME_RESULT_REASONS) {
      expect(reasonLabel(reason, ZH_CN), reason).not.toBe(reasonLabel(reason, EN))
    }
  })

  it('keeps the two no-ops declarative and the refusals explanatory', () => {
    // The contract makes a free re-assertion free, so its sentence states a fact
    // and never scolds; a refusal says the game did not do what was asked.
    expect(reasonLabel('cell-already-marked', EN)).toBe('That cell already carries that mark.')
    expect(reasonLabel('cell-already-unknown', EN)).toBe('That cell is already empty.')
    for (const refusal of [
      'not-generating',
      'locked-cell',
      'round-not-playing',
      'invalid-cell-index',
    ] as const) {
      expect(reasonLabel(refusal, EN), refusal).toMatch(/[a-z]/)
    }
  })

  it('explains nothing when there is no reason to explain', () => {
    for (const locale of LOCALES) {
      expect(reasonLabel(null, locale), locale).toBeNull()
    }
    // A transition event carries a null reason in every locale, so a locale
    // switch cannot change its content.
    const en = reasonLabel(null, EN)
    const zh = reasonLabel(null, ZH_CN)
    expect(en).toBe(zh)
  })

  it('resolves the same reason to the same sentence every time', () => {
    for (const reason of GAME_RESULT_REASONS) {
      expect(reasonLabel(reason, EN), reason).toBe(reasonLabel(reason, EN))
    }
  })
})
