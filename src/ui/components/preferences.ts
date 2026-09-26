import { useCallback, useEffect, useState } from 'react'
import {
  DEFAULT_LOCALE,
  THEME_PREFERENCES,
  isLocale,
  isThemePreference,
  type Copy,
  type Locale,
  type ThemePreference,
} from '../copy'
import { getGameStore } from '../gameStore'
import { readStored, writeStored } from './storage'

/**
 * The three document-level preferences. All three are read from `localStorage`
 * through `storage.ts`, all three write back through the same guarded path, and
 * all three are applied as a side effect on `document.documentElement` — the one
 * hook §6.4 asks for, so a real i18n library can take this over later.
 *
 * `t` is passed in rather than read here: the copy module owns every string, and
 * the keys happen to be locale-independent, but a component must never reach for
 * a dictionary the store has not published.
 */

/** The store's locale is authoritative; `localStorage` only remembers it. */
export function useLocale(t: Copy): readonly [Locale, (next: Locale) => void] {
  const store = getGameStore()
  const [locale, setLocaleState] = useState<Locale>(() => {
    const stored = readStored(t.storage.locale)
    return stored !== null && isLocale(stored) ? stored : store.getLocale()
  })

  const setLocale = useCallback(
    (next: Locale) => {
      setLocaleState(next)
      writeStored(t.storage.locale, next)
      store.setLocale(next)
    },
    [store, t.storage.locale],
  )

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return [locale, setLocale] as const
}

/** `auto` removes the attribute entirely, so `prefers-color-scheme` decides. */
export function useTheme(t: Copy): readonly [ThemePreference, (next: ThemePreference) => void] {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    const stored = readStored(t.storage.theme)
    return stored !== null && isThemePreference(stored) ? stored : 'auto'
  })

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next)
      writeStored(t.storage.theme, next)
    },
    [t.storage.theme],
  )

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'auto') {
      root.removeAttribute('data-theme')
    } else {
      root.setAttribute('data-theme', theme)
    }
  }, [theme])

  return [theme, setTheme] as const
}

/**
 * A persisted on/off preference. The default is decided by the caller because the
 * two flags in the app want opposite answers: finger marking defaults ON for a
 * fine pointer and OFF for a coarse one, while onboarding defaults to "not seen".
 */
export function useStoredFlag(
  key: string,
  defaultValue: boolean,
): readonly [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = readStored(key)
    return stored === null ? defaultValue : stored === 'true'
  })

  const setFlag = useCallback(
    (next: boolean) => {
      setValue(next)
      writeStored(key, next ? 'true' : 'false')
    },
    [key],
  )

  return [value, setFlag] as const
}

/** §3.2: painting is the default on a fine pointer and off on a coarse one. */
export function defaultFingerMarking(): boolean {
  if (typeof window.matchMedia !== 'function') {
    return true
  }
  try {
    return !window.matchMedia('(pointer: coarse)').matches
  } catch {
    return true
  }
}

export { DEFAULT_LOCALE, THEME_PREFERENCES }
export type { Locale, ThemePreference }
