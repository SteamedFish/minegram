import { useSyncExternalStore } from 'react'
import { getStarBattleStore, type StarBattleSnapshot } from './starBattleStore'

/**
 * The Star Battle read surface, mirroring `useGameSnapshot.ts`: a frozen
 * `StarBattleSnapshot` and nothing else.
 *
 * `getStarBattleStore()` is resolved on every render, so a test can install its
 * own store before mounting, while `subscribe`/`getSnapshot` keep one identity
 * for the store's lifetime — which is what `useSyncExternalStore` requires.
 */
export function useStarBattleSnapshot(): StarBattleSnapshot {
  const store = getStarBattleStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
