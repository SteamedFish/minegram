import {
  DEFAULT_GENERATION_COLUMNS,
  DEFAULT_GENERATION_DENSITY_PERCENT,
  DEFAULT_GENERATION_DIFFICULTY,
  DEFAULT_GENERATION_ROWS,
  DEFAULT_GENERATION_SEED,
  DEFAULT_MAX_GENERATION_ATTEMPTS,
} from '../../engine/generator/settings'
import { DEFAULT_INITIAL_SCORE } from '../../application/gameReducer'
import type { SettingsDraft } from '../gameStore'

/**
 * The panel's starting point, and the engine's own defaults spelled out as strings.
 *
 * It lives outside `SettingsPanel.tsx` for two reasons: the app root needs it to seed
 * the draft before the panel mounts, and a module that exports a plain function is
 * cheaper to reason about than one that exports both a component and a factory.
 *
 * The numbers come from the engine, never from a second copy of the defaults, so the
 * "Restore defaults" button cannot drift from what the engine would have used.
 */
export function defaultDraft(): SettingsDraft {
  return {
    rows: String(DEFAULT_GENERATION_ROWS),
    columns: String(DEFAULT_GENERATION_COLUMNS),
    densityPercent: String(DEFAULT_GENERATION_DENSITY_PERCENT),
    difficulty: DEFAULT_GENERATION_DIFFICULTY,
    seed: String(DEFAULT_GENERATION_SEED),
    maxAttempts: String(DEFAULT_MAX_GENERATION_ATTEMPTS),
    initialScore: String(DEFAULT_INITIAL_SCORE),
  }
}
