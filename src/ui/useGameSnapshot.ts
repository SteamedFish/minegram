import { useSyncExternalStore } from 'react'
import { getGameStore } from './gameStore'
import type { BoardView, StatusView, UiSnapshot } from './viewModel'

/**
 * The whole read surface of the app: a frozen `UiSnapshot` and nothing else.
 *
 * `getGameStore()` is resolved on every render, so a test can install its own
 * store before mounting, while the three functions it yields (`subscribe`,
 * `getSnapshot`) keep one identity for the store's lifetime — which is what
 * `useSyncExternalStore` requires to avoid an infinite re-render.
 *
 * There is no way to obtain `GameState` here: the store exposes no state getter,
 * and the module re-exports nothing but the three hooks.
 */
export function useUiSnapshot(): UiSnapshot {
  const store = getGameStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

/** Status surface for the status region, score, chips, banners, and settings panel. */
export function useStatus(): StatusView {
  return useUiSnapshot().status
}

/** Board surface, or `null` while no puzzle exists. */
export function useBoard(): BoardView | null {
  return useUiSnapshot().board
}
