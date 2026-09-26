import { LOCALES, THEME_PREFERENCES, type Copy, type Locale, type ThemePreference } from '../copy'
import type { DimensionsView } from '../viewModel'

/**
 * The footer chrome: the authored seed, the language, the theme, and the source link.
 *
 * §4.6 + §8.8: the seed chip shows `DimensionsView.authoredSeed` and nothing else. A
 * round whose seed the engine derived is rendered as "this round derives its own
 * seed" — the value itself reaches the player only through the clipboard report,
 * which is a deliberate act, not something that happens by scrolling to the bottom.
 */
export interface AppFooterProps {
  readonly t: Copy
  readonly dimensions: DimensionsView | null
  readonly locale: Locale
  readonly theme: ThemePreference
  readonly onLocale: (locale: Locale) => void
  readonly onTheme: (theme: ThemePreference) => void
}

const SOURCE_URL = 'https://github.com/SteamedFish/minegram'

export function AppFooter({ t, dimensions, locale, theme, onLocale, onTheme }: AppFooterProps) {
  const authored = dimensions?.authoredSeed ?? ''
  return (
    <footer className="mg-footer">
      <p className="mg-footer__seed" data-seed={authored === '' ? 'derived' : 'authored'}>
        <span className="mg-footer__seed-label">{t.footer.seed}</span>
        <span className="mg-footer__seed-value">
          {authored === '' ? t.footer.seedUnavailable : authored}
        </span>
      </p>
      <label className="mg-footer__control">
        <span className="mg-footer__control-label">{t.locale.label}</span>
        <select
          className="mg-footer__select"
          value={locale}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (LOCALES.some((candidate) => candidate === next)) {
              onLocale(next as Locale)
            }
          }}
        >
          {LOCALES.map((candidate) => (
            <option value={candidate} key={candidate}>
              {candidate === 'zh-CN' ? t.locale.zhCN : t.locale.en}
            </option>
          ))}
        </select>
      </label>
      <label className="mg-footer__control">
        <span className="mg-footer__control-label">{t.footer.theme}</span>
        <select
          className="mg-footer__select"
          value={theme}
          onChange={(event) => {
            const next = event.currentTarget.value
            if (THEME_PREFERENCES.some((candidate) => candidate === next)) {
              onTheme(next as ThemePreference)
            }
          }}
        >
          {THEME_PREFERENCES.map((candidate) => (
            <option value={candidate} key={candidate}>
              {t.theme[candidate]}
            </option>
          ))}
        </select>
      </label>
      <a className="mg-footer__source" href={SOURCE_URL} rel="noreferrer noopener" target="_blank">
        {t.footer.source}
      </a>
    </footer>
  )
}
