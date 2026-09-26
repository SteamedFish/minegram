/**
 * `localStorage` access, wrapped once.
 *
 * Every read and write is guarded: Safari private mode throws on `setItem`, some
 * enterprise policies throw on *access* to `window.localStorage` itself, and a
 * blocked preference must never take the app down. A read that fails answers
 * `null` (the caller falls back to its default) and a write that fails is a
 * no-op, so the app keeps working with in-memory preferences only.
 */
export function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

export function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* A preference that cannot persist is a preference that lasts this session. */
  }
}
