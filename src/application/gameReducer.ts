import {
  assertBinaryMineBoard,
  assertMinegramPuzzle,
  type BinaryMineBoard,
} from '../domain'
import {
  normalizeGenerationSettings,
  type GenerationSettings,
  type GenerationSettingsInput,
} from '../engine/generator/settings'
import { deriveRandomSeed, normalizeRandomSeed } from '../engine/rng'
import {
  DIFFICULTY_BANDS,
  type DifficultyBand,
  type DifficultyResult,
  type DifficultyUnknownReason,
} from '../engine/solver/difficulty'
import type { MinegramPuzzle } from '../domain/puzzle'

export const DEFAULT_INITIAL_SCORE = 5
export const NEXT_ROUND_SEED_LABEL_PREFIX = 'round:'

export type CellAssertion = 'mine' | 'blank'
export type CellMark = 'unknown' | CellAssertion
export type GameLifecycle = 'idle' | 'generating' | 'playing' | 'won' | 'lost' | 'failed'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue }
export type JsonObject = { readonly [key: string]: JsonValue }

export interface GameFailureDiagnostics {
  readonly reason: string
  readonly message: string
  readonly details?: JsonObject
}

/**
 * Minimal UI-facing projection of the engine difficulty analysis. Solver
 * diagnostics stay internal; only the analysed outcome is retained.
 */
export type GameDifficulty =
  | {
      readonly status: 'known'
      readonly band: DifficultyBand
      readonly minimumGuesses: number
    }
  | {
      readonly status: 'unknown'
      readonly reason: DifficultyUnknownReason
    }

export interface PendingGeneration {
  readonly id: number
  readonly settings: GenerationSettings
  readonly roundNumber: number
}

export interface GameState {
  readonly status: GameLifecycle
  readonly generationId: number
  readonly pendingGeneration: PendingGeneration | null
  readonly settings: GenerationSettings
  readonly initialScore: number
  readonly score: number
  readonly round: number
  readonly puzzle: MinegramPuzzle | null
  /** Difficulty analysis of the current playable round, when the engine reported one. */
  readonly difficulty: GameDifficulty | null
  /** Private application state. Normal UI code should use the selectors in gameSelectors.ts. */
  readonly board: BinaryMineBoard | null
  readonly marks: readonly CellMark[]
  readonly locked: readonly boolean[]
  readonly failure: GameFailureDiagnostics | null
}

export interface CellAssertionInput {
  readonly index: unknown
  readonly assertion: unknown
}

export interface GeneratedRound {
  readonly settings: GenerationSettings
  readonly board: BinaryMineBoard
  readonly puzzle: MinegramPuzzle
  /**
   * Pass through `GenerationResult.difficulty` unchanged. It may be a `known`
   * result or an `unknown`/bounded outcome; omit it only when the producer has
   * no analysis to report.
   */
  readonly difficulty?: DifficultyResult
}

export interface InitialGameStateOptions {
  readonly settings?: GenerationSettingsInput
  readonly initialScore?: number
}

export interface GameGenerationStartAction {
  readonly type: 'generation/start'
  readonly settings?: GenerationSettingsInput
  readonly initialScore?: number
}

export interface GameGenerationSucceededAction {
  readonly type: 'generation/succeeded'
  readonly generationId: number
  readonly round: GeneratedRound
}

export interface GameGenerationFailedAction {
  readonly type: 'generation/failed'
  readonly generationId: number
  readonly failure: GameFailureDiagnostics
}

export interface GameGenerationCancelledAction {
  readonly type: 'generation/cancelled'
  readonly generationId: number
}

export interface GameMarkBatchAction {
  readonly type: 'round/markBatch'
  readonly cells: readonly CellAssertionInput[]
}

export interface GameClearMarkAction {
  readonly type: 'round/clearMark'
  readonly index: number
}

export type GameAction =
  | GameGenerationStartAction
  | GameGenerationSucceededAction
  | GameGenerationFailedAction
  | GameGenerationCancelledAction
  | GameMarkBatchAction
  | GameClearMarkAction

export type GameTransition =
  | 'generation-started'
  | 'generation-succeeded'
  | 'generation-failed'
  | 'generation-cancelled'
  | 'marks-applied'
  | 'round-won'
  | 'round-lost'
  | 'mark-cleared'

export type GameResultReason =
  | 'not-generating'
  | 'stale-generation-id'
  | 'invalid-settings'
  | 'invalid-initial-score'
  | 'invalid-difficulty'
  | 'round-not-playing'
  | 'invalid-batch'
  | 'conflicting-assertions'
  | 'invalid-cell-index'
  | 'invalid-cell-assertion'
  | 'locked-cell'
  | 'cell-already-unknown'

export type GameReducerResult =
  | {
      readonly type: 'transition'
      readonly transition: GameTransition
      readonly state: GameState
    }
  | {
      readonly type: 'ignored'
      readonly reason: GameResultReason
      readonly state: GameState
    }
  | {
      readonly type: 'rejected'
      readonly reason: GameResultReason
      readonly state: GameState
    }

export interface MarkBatchPreview {
  readonly valid: boolean
  readonly affectedCount: number
  readonly scoreCost: number
  readonly projectedScore: number
  readonly reachesZero: boolean
  readonly reason?: GameResultReason
}

/** Mirrors the `DifficultyUnknownReason` union in engine/solver/difficulty.ts. */
const DIFFICULTY_UNKNOWN_REASONS: readonly DifficultyUnknownReason[] = Object.freeze([
  'cancelled',
  'time-limit',
  'node-limit',
  'resource-limit',
  'interrupted',
  'incomplete-search',
])

interface PreparedCellAssertion {
  readonly index: number
  readonly assertion: CellAssertion
}

type PreparedBatch =
  | {
      readonly valid: true
      readonly cells: readonly PreparedCellAssertion[]
    }
  | {
      readonly valid: false
      readonly reason: GameResultReason
    }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCellAssertion(value: unknown): value is CellAssertion {
  return value === 'mine' || value === 'blank'
}

function assertInitialScore(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`initialScore must be a positive safe integer; received ${String(value)}`)
  }
}

function snapshotMarks(length: number): readonly CellMark[] {
  return Object.freeze(Array.from({ length }, () => 'unknown' as const))
}

function snapshotLocked(length: number): readonly boolean[] {
  return Object.freeze(Array.from({ length }, () => false))
}

function snapshotBoard(board: BinaryMineBoard): BinaryMineBoard {
  return Object.freeze([...board]) as BinaryMineBoard
}

function snapshotPuzzle(puzzle: MinegramPuzzle): MinegramPuzzle {
  const rowClues = puzzle.clues.rowClues.map((clue) => Object.freeze([...clue]))
  const columnClues = puzzle.clues.columnClues.map((clue) => Object.freeze([...clue]))
  return Object.freeze({
    dimensions: Object.freeze({ rows: puzzle.dimensions.rows, columns: puzzle.dimensions.columns }),
    clues: Object.freeze({
      rowClues: Object.freeze(rowClues),
      columnClues: Object.freeze(columnClues),
    }),
  })
}

function snapshotFailure(failure: GameFailureDiagnostics): GameFailureDiagnostics {
  const details: JsonObject = Object.freeze({ ...(failure.details ?? {}) })
  return Object.freeze({
    reason: failure.reason,
    message: failure.message,
    details,
  })
}

function sameGenerationSettings(left: GenerationSettings, right: GenerationSettings): boolean {
  return (
    left.rows === right.rows &&
    left.columns === right.columns &&
    left.densityPercent === right.densityPercent &&
    left.mineCount === right.mineCount &&
    left.difficulty === right.difficulty &&
    left.seed === right.seed &&
    left.maxAttempts === right.maxAttempts
  )
}

/** Projects a `DifficultyResult` onto the small UI-facing `GameDifficulty` shape. */
function projectDifficulty(value: unknown): GameDifficulty | null {
  if (value === undefined || value === null) {
    return null
  }
  if (!isRecord(value)) {
    throw new TypeError(
      `generated round difficulty must be a non-array object; received ${String(value)}`,
    )
  }
  if (value.status === 'known') {
    const { band } = value
    if (typeof band !== 'string' || !DIFFICULTY_BANDS.includes(band as DifficultyBand)) {
      throw new TypeError(
        `known difficulty band must be one of ${DIFFICULTY_BANDS.join(', ')}; received ${String(band)}`,
      )
    }
    const { minimumGuesses } = value
    if (typeof minimumGuesses !== 'number' || !Number.isFinite(minimumGuesses)) {
      throw new TypeError(
        `known difficulty minimumGuesses must be a finite number; received ${String(minimumGuesses)}`,
      )
    }
    return Object.freeze({
      status: 'known',
      band: band as DifficultyBand,
      minimumGuesses,
    })
  }
  if (value.status === 'unknown') {
    const { reason } = value
    if (
      typeof reason !== 'string' ||
      !DIFFICULTY_UNKNOWN_REASONS.includes(reason as DifficultyUnknownReason)
    ) {
      throw new TypeError(
        `unknown difficulty reason must be one of ${DIFFICULTY_UNKNOWN_REASONS.join(', ')}; received ${String(reason)}`,
      )
    }
    return Object.freeze({ status: 'unknown', reason: reason as DifficultyUnknownReason })
  }
  throw new TypeError(`difficulty status must be known or unknown; received ${String(value.status)}`)
}

function transition(
  state: GameState,
  transitionName: GameTransition,
): GameReducerResult {
  return Object.freeze({ type: 'transition', transition: transitionName, state })
}

function ignored(state: GameState, reason: GameResultReason): GameReducerResult {
  return Object.freeze({ type: 'ignored', reason, state })
}

function rejected(state: GameState, reason: GameResultReason): GameReducerResult {
  return Object.freeze({ type: 'rejected', reason, state })
}

export function createInitialGameState(options: InitialGameStateOptions = {}): GameState {
  const initialScore = options.initialScore ?? DEFAULT_INITIAL_SCORE
  assertInitialScore(initialScore)
  const settings = normalizeGenerationSettings(options.settings)
  return Object.freeze({
    status: 'idle',
    generationId: 0,
    pendingGeneration: null,
    settings,
    initialScore,
    score: initialScore,
    round: 0,
    puzzle: null,
    difficulty: null,
    board: null,
    marks: Object.freeze([]),
    locked: Object.freeze([]),
    failure: null,
  })
}

export function deriveNextRoundSettings(
  settings: GenerationSettings,
  nextRoundNumber: number,
): GenerationSettings {
  if (!Number.isSafeInteger(nextRoundNumber) || nextRoundNumber <= 0) {
    throw new RangeError(`nextRoundNumber must be a positive safe integer; received ${String(nextRoundNumber)}`)
  }
  const label = `${NEXT_ROUND_SEED_LABEL_PREFIX}${nextRoundNumber}`
  let seed = deriveRandomSeed(settings.seed, label)
  if (seed === normalizeRandomSeed(settings.seed)) {
    seed = deriveRandomSeed(settings.seed, `${label}:retry`)
  }
  return Object.freeze({ ...settings, seed })
}

/**
 * A generation action is only honoured for the current in-flight request. A
 * `won` state carries no pending request, so a new round must be started with
 * an explicit `generation/start` action.
 */
function matchingPendingGeneration(
  state: GameState,
  generationId: number,
): PendingGeneration | null {
  if (state.pendingGeneration === null || state.pendingGeneration.id !== generationId) {
    return null
  }
  if (state.generationId !== generationId) {
    return null
  }
  if (state.status !== 'generating') {
    return null
  }
  return state.pendingGeneration
}

function startGeneration(
  state: GameState,
  input: GenerationSettingsInput | undefined,
  requestedInitialScore: number | undefined,
): GameReducerResult {
  if (state.pendingGeneration !== null) {
    return ignored(state, 'not-generating')
  }

  const initialScore = requestedInitialScore ?? state.initialScore
  try {
    assertInitialScore(initialScore)
  } catch {
    return rejected(state, 'invalid-initial-score')
  }

  let requestedSettings: GenerationSettings
  try {
    const baseSettings = input === undefined ? state.settings : normalizeGenerationSettings(input)
    requestedSettings =
      state.status === 'won' && state.round > 0
        ? deriveNextRoundSettings(baseSettings, state.round + 1)
        : baseSettings
  } catch {
    return rejected(state, 'invalid-settings')
  }

  const id = state.generationId + 1
  const roundNumber = state.round + 1
  const pendingGeneration: PendingGeneration = Object.freeze({
    id,
    settings: requestedSettings,
    roundNumber,
  })
  const hasPlayableRound = state.board !== null && state.puzzle !== null
  return transition(
    Object.freeze({
      ...state,
      status: 'generating',
      generationId: id,
      pendingGeneration,
      settings: hasPlayableRound ? state.settings : requestedSettings,
      initialScore,
      score: hasPlayableRound ? state.score : initialScore,
      failure: null,
    }),
    'generation-started',
  )
}

function acceptGeneratedRound(
  state: GameState,
  pending: PendingGeneration,
  generated: GeneratedRound,
): GameReducerResult {
  let settings: GenerationSettings
  try {
    settings = normalizeGenerationSettings(generated.settings)
  } catch {
    return rejected(state, 'invalid-settings')
  }
  if (!sameGenerationSettings(settings, pending.settings)) {
    return rejected(state, 'invalid-settings')
  }

  try {
    assertBinaryMineBoard(
      generated.board,
      { rows: settings.rows, columns: settings.columns },
      'generated round board',
    )
    assertMinegramPuzzle(generated.puzzle, 'generated round puzzle')
  } catch {
    return rejected(state, 'invalid-settings')
  }
  if (
    generated.puzzle.dimensions.rows !== settings.rows ||
    generated.puzzle.dimensions.columns !== settings.columns
  ) {
    return rejected(state, 'invalid-settings')
  }

  let difficulty: GameDifficulty | null
  try {
    difficulty = projectDifficulty(generated.difficulty)
  } catch {
    return rejected(state, 'invalid-difficulty')
  }

  const board = snapshotBoard(generated.board)
  return transition(
    Object.freeze({
      ...state,
      status: 'playing',
      pendingGeneration: null,
      settings,
      score: state.initialScore,
      round: pending.roundNumber,
      puzzle: snapshotPuzzle(generated.puzzle),
      difficulty,
      board,
      marks: snapshotMarks(board.length),
      locked: snapshotLocked(board.length),
      failure: null,
    }),
    'generation-succeeded',
  )
}

function failGeneration(
  state: GameState,
  pending: PendingGeneration,
  failure: GameFailureDiagnostics,
  transitionName: 'generation-failed' | 'generation-cancelled',
): GameReducerResult {
  const hasPlayableRound = state.board !== null && state.puzzle !== null
  return transition(
    Object.freeze({
      ...state,
      status: 'failed',
      pendingGeneration: null,
      settings: hasPlayableRound ? state.settings : pending.settings,
      failure: snapshotFailure(failure),
    }),
    transitionName,
  )
}

function prepareBatch(state: GameState, value: unknown): PreparedBatch {
  if (state.status !== 'playing' || state.board === null) {
    return { valid: false, reason: 'round-not-playing' }
  }
  if (!Array.isArray(value)) {
    return { valid: false, reason: 'invalid-batch' }
  }

  const cells: PreparedCellAssertion[] = []
  const firstAssertionByIndex = new Map<number, CellAssertion>()
  for (const candidate of value) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('index' in candidate) ||
      !('assertion' in candidate)
    ) {
      return { valid: false, reason: 'invalid-batch' }
    }
    const { index, assertion } = candidate as { readonly index: unknown; readonly assertion: unknown }
    if (
      typeof index !== 'number' ||
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= state.board.length
    ) {
      return { valid: false, reason: 'invalid-cell-index' }
    }
    if (!isCellAssertion(assertion)) {
      return { valid: false, reason: 'invalid-cell-assertion' }
    }
    const firstAssertion = firstAssertionByIndex.get(index)
    if (firstAssertion !== undefined) {
      if (firstAssertion !== assertion) {
        return { valid: false, reason: 'conflicting-assertions' }
      }
      continue
    }
    firstAssertionByIndex.set(index, assertion)
    cells.push(Object.freeze({ index, assertion }))
  }
  return { valid: true, cells: Object.freeze(cells) }
}

function assertionMatchesBoard(board: BinaryMineBoard, index: number, assertion: CellAssertion): boolean {
  return board[index] === (assertion === 'mine' ? 1 : 0)
}

/**
 * A win keeps the finished board, marks, and score so the UI can show the
 * completed round, and deliberately consumes no generation slot. The next round
 * is requested by an explicit `generation/start`, which derives the new
 * deterministic seed, advances the round, and keeps the same settings.
 */
function beginNextRound(state: GameState): GameState {
  return Object.freeze({
    ...state,
    status: 'won',
    failure: null,
  })
}

function applyMarkBatch(state: GameState, value: unknown): GameReducerResult {
  const prepared = prepareBatch(state, value)
  if (!prepared.valid) {
    return rejected(state, prepared.reason)
  }
  if (prepared.cells.length === 0) {
    return ignored(state, 'invalid-batch')
  }

  const board = state.board
  if (board === null) {
    return ignored(state, 'round-not-playing')
  }
  const marks = [...state.marks]
  const locked = [...state.locked]
  let score = state.score
  let changed = false

  for (const { index, assertion } of prepared.cells) {
    if (locked[index]) {
      continue
    }
    marks[index] = assertion
    changed = true
    if (assertionMatchesBoard(board, index, assertion)) {
      locked[index] = true
      continue
    }

    score = Math.max(0, score - 1)
    if (score === 0) {
      return transition(
        Object.freeze({
          ...state,
          status: 'lost',
          score,
          marks: Object.freeze(marks),
          locked: Object.freeze(locked),
          failure: null,
        }),
        'round-lost',
      )
    }
  }

  if (!changed) {
    return ignored(state, 'locked-cell')
  }
  const completed = marks.every(
    (mark, index) => mark !== 'unknown' && assertionMatchesBoard(board, index, mark),
  )
  const nextState = Object.freeze({
    ...state,
    score,
    marks: Object.freeze(marks),
    locked: Object.freeze(locked),
    failure: null,
  })
  return transition(
    completed ? beginNextRound(nextState) : nextState,
    completed ? 'round-won' : 'marks-applied',
  )
}

function clearMark(state: GameState, index: number): GameReducerResult {
  if (state.status !== 'playing' || state.board === null) {
    return ignored(state, 'round-not-playing')
  }
  if (!Number.isSafeInteger(index) || index < 0 || index >= state.board.length) {
    return rejected(state, 'invalid-cell-index')
  }
  if (state.locked[index]) {
    return ignored(state, 'locked-cell')
  }
  if (state.marks[index] === 'unknown') {
    return ignored(state, 'cell-already-unknown')
  }

  const marks = [...state.marks]
  marks[index] = 'unknown'
  return transition(
    Object.freeze({ ...state, marks: Object.freeze(marks) }),
    'mark-cleared',
  )
}

export function gameReducer(state: GameState, action: GameAction): GameReducerResult {
  switch (action.type) {
    case 'generation/start':
      return startGeneration(state, action.settings, action.initialScore)
    case 'generation/succeeded': {
      const pending = matchingPendingGeneration(state, action.generationId)
      return pending === null
        ? ignored(state, 'stale-generation-id')
        : acceptGeneratedRound(state, pending, action.round)
    }
    case 'generation/failed': {
      const pending = matchingPendingGeneration(state, action.generationId)
      return pending === null
        ? ignored(state, 'stale-generation-id')
        : failGeneration(state, pending, action.failure, 'generation-failed')
    }
    case 'generation/cancelled': {
      const pending = matchingPendingGeneration(state, action.generationId)
      return pending === null
        ? ignored(state, 'stale-generation-id')
        : failGeneration(
            state,
            pending,
            { reason: 'cancelled', message: 'Generation cancelled', details: {} },
            'generation-cancelled',
          )
    }
    case 'round/markBatch':
      return applyMarkBatch(state, action.cells)
    case 'round/clearMark':
      return clearMark(state, action.index)
  }
}

export function previewMarkBatch(
  state: GameState,
  value: unknown,
): MarkBatchPreview {
  const prepared = prepareBatch(state, value)
  if (!prepared.valid) {
    return Object.freeze({
      valid: false,
      affectedCount: 0,
      scoreCost: 0,
      projectedScore: state.score,
      reachesZero: false,
      reason: prepared.reason,
    })
  }

  const board = state.board
  if (board === null) {
    return Object.freeze({
      valid: false,
      affectedCount: 0,
      scoreCost: 0,
      projectedScore: state.score,
      reachesZero: false,
      reason: 'round-not-playing',
    })
  }

  let affectedCount = 0
  let scoreCost = 0
  for (const { index, assertion } of prepared.cells) {
    if (state.locked[index]) {
      continue
    }
    affectedCount += 1
    if (!assertionMatchesBoard(board, index, assertion)) {
      scoreCost += 1
      if (scoreCost >= state.score) {
        break
      }
    }
  }
  const projectedScore = Math.max(0, state.score - scoreCost)
  return Object.freeze({
    valid: true,
    affectedCount,
    scoreCost,
    projectedScore,
    reachesZero: projectedScore === 0,
  })
}
