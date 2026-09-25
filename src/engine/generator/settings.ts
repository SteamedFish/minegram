import {
  assertBoardDimensions,
  MAX_BOARD_CELLS,
  MAX_BOARD_SIDE,
  MIN_BOARD_SIDE,
  type BoardDimensions,
} from '../../domain/board'
import { normalizeRandomSeed, type RandomSeed } from '../rng'
import { DIFFICULTY_BANDS, type DifficultyBand } from '../solver/difficulty'

export const DEFAULT_GENERATION_ROWS = 15
export const DEFAULT_GENERATION_COLUMNS = 15
export const DEFAULT_GENERATION_DENSITY_PERCENT = 60
export const DEFAULT_GENERATION_DIFFICULTY: DifficultyBand = 'starter'
export const DEFAULT_GENERATION_SEED: RandomSeed = 0
export const DEFAULT_MAX_GENERATION_ATTEMPTS = 8

export interface GenerationSettings {
  readonly rows: number
  readonly columns: number
  readonly densityPercent: number
  readonly mineCount: number
  readonly difficulty: DifficultyBand
  readonly seed: RandomSeed
  readonly maxAttempts: number
}

export interface GenerationSettingsInput {
  readonly rows?: unknown
  readonly columns?: unknown
  readonly densityPercent?: unknown
  readonly difficulty?: unknown
  readonly seed?: unknown
  readonly maxAttempts?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInteger(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const candidate = value === undefined ? fallback : value
  if (typeof candidate !== 'number' || !Number.isSafeInteger(candidate)) {
    throw new TypeError(`${name} must be a safe integer; received ${String(candidate)}`)
  }
  if (candidate < minimum || candidate > maximum) {
    throw new RangeError(`${name} must be between ${minimum} and ${maximum}; received ${candidate}`)
  }
  return candidate
}

function readSeed(value: unknown): RandomSeed {
  const candidate = value === undefined ? DEFAULT_GENERATION_SEED : value
  // Reuse the RNG validator so numeric seeds and text seeds have one contract.
  normalizeRandomSeed(candidate as RandomSeed)
  return candidate as RandomSeed
}

function readDifficulty(value: unknown): DifficultyBand {
  const candidate = value === undefined ? DEFAULT_GENERATION_DIFFICULTY : value
  if (typeof candidate !== 'string' || !DIFFICULTY_BANDS.includes(candidate as DifficultyBand)) {
    throw new TypeError(
      `difficulty must be one of ${DIFFICULTY_BANDS.join(', ')}; received ${String(candidate)}`,
    )
  }
  return candidate as DifficultyBand
}

export function calculateMineCount(
  rows: number,
  columns: number,
  densityPercent: number,
): number {
  assertBoardDimensions({ rows, columns }, 'generation dimensions')
  if (typeof densityPercent !== 'number' || !Number.isSafeInteger(densityPercent)) {
    throw new TypeError(`densityPercent must be an integer; received ${String(densityPercent)}`)
  }
  if (densityPercent < 0 || densityPercent > 100) {
    throw new RangeError(`densityPercent must be between 0 and 100; received ${densityPercent}`)
  }

  const rounded = Math.round((rows * columns * densityPercent) / 100)
  const lower = Math.max(rows, columns)
  return Math.min(rows * columns, Math.max(lower, rounded))
}

export function normalizeGenerationSettings(
  input: GenerationSettingsInput | undefined = undefined,
): GenerationSettings {
  if (input !== undefined && !isRecord(input)) {
    throw new TypeError('generation settings must be a non-array object')
  }
  const source = input ?? {}
  const rows = readInteger(source.rows, DEFAULT_GENERATION_ROWS, 'rows', MIN_BOARD_SIDE, MAX_BOARD_SIDE)
  const columns = readInteger(
    source.columns,
    DEFAULT_GENERATION_COLUMNS,
    'columns',
    MIN_BOARD_SIDE,
    MAX_BOARD_SIDE,
  )
  const dimensions: BoardDimensions = { rows, columns }
  assertBoardDimensions(dimensions, 'generation dimensions')
  if (rows * columns > MAX_BOARD_CELLS) {
    throw new RangeError(`generation dimensions must contain at most ${MAX_BOARD_CELLS} cells`)
  }
  const densityPercent = readInteger(
    source.densityPercent,
    DEFAULT_GENERATION_DENSITY_PERCENT,
    'densityPercent',
    0,
    100,
  )
  const mineCount = calculateMineCount(rows, columns, densityPercent)
  const difficulty = readDifficulty(source.difficulty)
  const seed = readSeed(source.seed)
  const maxAttempts = readInteger(
    source.maxAttempts,
    DEFAULT_MAX_GENERATION_ATTEMPTS,
    'maxAttempts',
    1,
    Number.MAX_SAFE_INTEGER,
  )

  return Object.freeze({
    rows,
    columns,
    densityPercent,
    mineCount,
    difficulty,
    seed,
    maxAttempts,
  })
}

export function generationDimensions(settings: GenerationSettings): BoardDimensions {
  return Object.freeze({ rows: settings.rows, columns: settings.columns })
}
