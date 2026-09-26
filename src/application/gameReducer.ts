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
  /**
   * `true` when this request continues the round after a win. The winning board
   * is still the last playable round, so its settings must not be restored when
   * this request fails: the derived next-round seed has to survive.
   */
  readonly continuesWonRound: boolean
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

export interface GameResumeRoundAction {
  readonly type: 'round/resume'
}

export type GameAction =
  | GameGenerationStartAction
  | GameGenerationSucceededAction
  | GameGenerationFailedAction
  | GameGenerationCancelledAction
  | GameMarkBatchAction
  | GameClearMarkAction
  | GameResumeRoundAction

export type GameTransition =
  | 'generation-started'
  | 'generation-succeeded'
  | 'generation-failed'
  | 'generation-cancelled'
  | 'marks-applied'
  | 'round-won'
  | 'round-lost'
  | 'mark-cleared'
  | 'round-resumed'

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
  | 'round-not-resumable'
  | 'locked-cell'
  | 'cell-already-marked'
  | 'cell-already-unknown'

/**
 * One line the game filled for free because the player had already located
 * every mine in it. The UI renders and announces these, so the shape is stable.
 */
export interface RevealedLine {
  readonly orientation: 'row' | 'column'
  readonly index: number
  /** Cells this pass wrote into this line. Always at least 1 when reported. */
  readonly cells: number
}

/** Result of {@link revealEligibleLines}: the lines filled and the folded arrays. */
export interface AutoRevealResult {
  readonly lines: readonly RevealedLine[]
  readonly marks: readonly CellMark[]
  readonly locked: readonly boolean[]
}

export type GameReducerResult =
  | {
      readonly type: 'transition'
      readonly transition: GameTransition
      /**
       * Lines this transition filled for free, in the order they were written.
       * Only lines that actually wrote at least one cell are reported.
       */
      readonly autoRevealedLines: readonly RevealedLine[]
      /**
       * Cells the auto-reveal turned visible. A cell shared by two eligible
       * lines is attributed to the first of them, so this equals the sum of
       * `autoRevealedLines[].cells` and counts every cell exactly once.
       */
      readonly autoRevealedCells: number
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

const NO_REVEALED_LINES: readonly RevealedLine[] = Object.freeze([])

/**
 * `transition` takes only the reported line list, never a whole reveal result,
 * so a caller can never accidentally commit the `marks`/`locked` of a gated-out
 * placeholder instead of its own arrays.
 */
function transition(
  state: GameState,
  transitionName: GameTransition,
  autoRevealedLines: readonly RevealedLine[] = NO_REVEALED_LINES,
): GameReducerResult {
  return Object.freeze({
    type: 'transition',
    transition: transitionName,
    autoRevealedLines,
    autoRevealedCells: revealedCellCount(autoRevealedLines),
    state,
  })
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
    continuesWonRound: state.status === 'won',
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
  // Deliberately NO auto-reveal here. A fresh board has no marks, so every row
  // and column satisfies the reveal gate vacuously ("every mine marked" and "no
  // wrong mark" both hold over an empty mark set). Revealing now would blank the
  // whole board before the player's first click and fire the win gate at accept
  // time. The gate on the reveal therefore requires a live round that already
  // carries at least one mark; see `revealForRound`.
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
  // A post-win failure must not roll the settings back to the solved round's
  // seed, otherwise a later plain start would deterministically replay the
  // already-solved board under a new round number.
  const keepsOwnSettings = hasPlayableRound && !pending.continuesWonRound
  return transition(
    Object.freeze({
      ...state,
      status: 'failed',
      pendingGeneration: null,
      settings: keepsOwnSettings ? state.settings : pending.settings,
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
 * The single win gate: every cell is explicitly asserted and every assertion is
 * correct. Both the `applyMarkBatch` win transition and the `resumeRound`
 * completed-board guard call this, so the two can never drift apart.
 */
function roundIsComplete(board: BinaryMineBoard, marks: readonly CellMark[]): boolean {
  return marks.every((mark, index) => mark !== 'unknown' && assertionMatchesBoard(board, index, mark))
}

/**
 * A line is eligible when the player has located every mine in it AND the line
 * carries no wrong mark. Both conditions are read straight off the solution
 * board: no legal-pattern enumeration, so this can never fail closed on a
 * resource limit or burn a search budget the way a pattern-based check would.
 */
function lineIsEligible(
  board: BinaryMineBoard,
  marks: readonly CellMark[],
  start: number,
  stride: number,
  length: number,
): boolean {
  let mines = 0
  let markedMines = 0
  for (let offset = 0; offset < length; offset += 1) {
    const index = start + offset * stride
    const isMine = board[index] === 1
    if (isMine) {
      mines += 1
    }
    const mark = marks[index]
    if (mark === 'unknown') {
      continue
    }
    // A wrong mark anywhere in the line disqualifies it, whatever else is known.
    if ((mark === 'mine') !== isMine) {
      return false
    }
    if (isMine) {
      markedMines += 1
    }
  }
  return mines === markedMines
}

/**
 * Fills the gaps of every line whose mines the player has already located,
 * exactly as the game rule requires: a fully known line is shown for free.
 *
 * This is a pure fold over `(board, marks, locked)` and is idempotent. A single
 * pass over the rows and then the columns is already the fixpoint, because a
 * write can never feed either eligibility gate: it lands on a
 * `board[index] === 0` cell, so it cannot satisfy the "every mine marked" half,
 * and `'unknown'` was not a wrong mark, so it cannot break the other half.
 * There is deliberately no cascade loop here. Two eligible lines that share a
 * cell both write `'blank'` there, which is a no-op rather than a conflict.
 *
 * When nothing is eligible the incoming arrays are returned unchanged (same
 * references), so an inert pass is free.
 */
export function revealEligibleLines(
  board: BinaryMineBoard,
  marks: readonly CellMark[],
  locked: readonly boolean[],
  rows: number,
  columns: number,
): AutoRevealResult {
  let nextMarks: CellMark[] | null = null
  let nextLocked: boolean[] | null = null
  const lines: RevealedLine[] = []

  const fill = (
    start: number,
    stride: number,
    length: number,
    orientation: 'row' | 'column',
    line: number,
  ): void => {
    let written = 0
    for (let offset = 0; offset < length; offset += 1) {
      const index = start + offset * stride
      // Never overwrite: a cell that already carries any mark keeps it. The
      // working copy is consulted so a cell shared with an already-filled line
      // is written once and counted once.
      if ((nextMarks ?? marks)[index] !== 'unknown') {
        continue
      }
      // A gate-eligible line has no unmarked mine left, so this only makes the
      // "a reveal never writes a wrong mark" invariant structural.
      if (board[index] === 1) {
        continue
      }
      if (nextMarks === null || nextLocked === null) {
        nextMarks = [...marks]
        nextLocked = [...locked]
      }
      nextMarks[index] = 'blank'
      nextLocked[index] = true
      written += 1
    }
    if (written > 0) {
      lines.push(Object.freeze({ orientation, index: line, cells: written }))
    }
  }

  for (let row = 0; row < rows; row += 1) {
    if (lineIsEligible(board, marks, row * columns, 1, columns)) {
      fill(row * columns, 1, columns, 'row', row)
    }
  }
  for (let column = 0; column < columns; column += 1) {
    if (lineIsEligible(board, marks, column, columns, rows)) {
      fill(column, columns, rows, 'column', column)
    }
  }

  if (nextMarks === null || nextLocked === null) {
    return Object.freeze({ lines: NO_REVEALED_LINES, marks, locked })
  }
  return Object.freeze({
    lines: Object.freeze(lines),
    marks: Object.freeze(nextMarks),
    locked: Object.freeze(nextLocked),
  })
}

/** Distinct cells written by a reveal; a cell shared by two lines counts once. */
function revealedCellCount(lines: readonly RevealedLine[]): number {
  let total = 0
  for (const line of lines) {
    total += line.cells
  }
  return total
}

/** Whether the round carries at least one player mark (the reveal's live gate). */
function hasAnyMark(marks: readonly CellMark[]): boolean {
  for (const mark of marks) {
    if (mark !== 'unknown') {
      return true
    }
  }
  return false
}

/**
 * The auto-reveal only runs on a live round that already carries a mark. Both
 * halves of that gate are load-bearing: a `generating`/`failed` round must keep
 * the exact arrays it was handed, and a mark-less board would satisfy the
 * reveal gate vacuously in every line (see `acceptGeneratedRound`).
 *
 * The board is stored with its round dimensions in `puzzle`, so that is the
 * authoritative source for the row/column geometry here.
 */
function revealForRound(
  state: GameState,
  marks: readonly CellMark[],
  locked: readonly boolean[],
): AutoRevealResult {
  if (state.status !== 'playing' || state.puzzle === null || state.board === null) {
    return { lines: NO_REVEALED_LINES, marks, locked }
  }
  if (!hasAnyMark(marks)) {
    return { lines: NO_REVEALED_LINES, marks, locked }
  }
  const { rows, columns } = state.puzzle.dimensions
  return revealEligibleLines(state.board, marks, locked, rows, columns)
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
  let sawLockedCell = false

  for (const { index, assertion } of prepared.cells) {
    // Strict contract: re-asserting the mark a cell already carries is always
    // free, in any batch. Only a different assertion can charge again.
    if (marks[index] === assertion) {
      continue
    }
    if (locked[index]) {
      sawLockedCell = true
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
      // The auto-reveal deliberately does NOT run before this. The round is
      // over, the score is already clamped to zero, and nothing further can be
      // asserted, so filling gaps here would only repaint a board the player
      // can no longer act on. The reveal runs on the committed arrays below,
      // after the loop, and the win gate runs after that.
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
    // Nothing was written. A locked cell in the batch is the reported reason
    // (including mixed identical+locked batches); an all-identical batch is
    // never mislabeled as 'locked-cell'. The round's state is returned
    // untouched, so there is nothing for the auto-reveal to fold.
    if (sawLockedCell) {
      return ignored(state, 'locked-cell')
    }
    return ignored(state, 'cell-already-marked')
  }

  // The reveal runs on the committed arrays, and the win gate runs AFTER it.
  // Ordering matters: the batch that marks the round's last mine leaves the
  // remaining blanks 'unknown', so evaluating `roundIsComplete` first would
  // return false, return `marks-applied`, and then soft-lock the round — every
  // cell is now locked, so no further batch can ever arrive to re-evaluate it.
  const reveal = revealForRound(state, marks, locked)
  const completed = roundIsComplete(board, reveal.marks)
  const nextState = Object.freeze({
    ...state,
    score,
    marks: reveal.marks,
    locked: reveal.locked,
    failure: null,
  })
  return transition(
    completed ? beginNextRound(nextState) : nextState,
    completed ? 'round-won' : 'marks-applied',
    reveal.lines,
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
  // Clearing can free a line that was blocked by the erased wrong mark: erasing
  // a wrong 'mine' on a blank removes a gate-(b) violation, so the line's mines
  // may now all be marked and the line fills itself again. Clearing a wrong
  // 'blank' on a mine instead breaks gate (a) and the line stops being
  // eligible. Either way the extra pass is one O(cells) fold, and it is
  // idempotent, so the second and later passes cost nothing.
  const reveal = revealForRound(state, marks, state.locked)
  return transition(
    Object.freeze({ ...state, marks: reveal.marks, locked: reveal.locked }),
    'mark-cleared',
    reveal.lines,
  )
}

/**
 * Restores play on a board that a failed or cancelled generation attempt kept.
 * A failure while a playable round is present leaves `board`, `puzzle`, marks
 * and score in place, but `failGeneration` must report the failure, so the kept
 * board would otherwise be stuck: `applyMarkBatch` only accepts a `playing`
 * round. Resuming is not a new round: score, marks, round, seed and generation
 * id are carried over untouched, and no generation is requested.
 *
 * A failure can also keep a board that is already finished — a failure after a
 * win leaves the fully correct, fully locked board behind. Resuming that as
 * `playing` would soft-lock: every cell is locked, so no batch can fire the win
 * gate again. Such a board is handed to `beginNextRound` instead, which is the
 * same post-win handoff the win gate uses. `won` is not resumable, so the round
 * cannot loop back into this branch.
 */
function resumeRound(state: GameState): GameReducerResult {
  if (state.puzzle === null || state.board === null || state.status !== 'failed') {
    return ignored(state, 'round-not-resumable')
  }
  // The reveal runs BEFORE the completed-board guard, and directly rather than
  // through `revealForRound`, because this transition is about re-entering a
  // kept round: the guard and the win path must test the same predicate the win
  // gate tests, which is `roundIsComplete` over post-reveal marks. In practice
  // the fold is a no-op — a kept board's marks only ever move through
  // `applyMarkBatch`, which already revealed them, and the reveal is idempotent
  // — but running it here means the guard can never disagree with the win path
  // about whether a kept board is finished.
  //
  // The `status === 'playing'` half of `revealForRound`'s gate is deliberately
  // NOT applied here (this state is `failed` by definition), but the
  // at-least-one-mark half is: a kept board can legitimately hold an all-unknown
  // mark array (accept a round, start a generation, let it fail), and every row
  // and column of that board is then vacuously eligible, so an ungated fold
  // would hand the player the whole board with only the mines left to find.
  const reveal = hasAnyMark(state.marks)
    ? revealEligibleLines(
        state.board,
        state.marks,
        state.locked,
        state.puzzle.dimensions.rows,
        state.puzzle.dimensions.columns,
      )
    : { lines: NO_REVEALED_LINES, marks: state.marks, locked: state.locked }
  if (roundIsComplete(state.board, reveal.marks)) {
    return transition(
      beginNextRound({ ...state, marks: reveal.marks, locked: reveal.locked }),
      'round-resumed',
      reveal.lines,
    )
  }
  return transition(
    Object.freeze({
      ...state,
      marks: reveal.marks,
      locked: reveal.locked,
      status: 'playing',
      pendingGeneration: null,
      failure: null,
    }),
    'round-resumed',
    reveal.lines,
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
    case 'round/resume':
      return resumeRound(state)
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
    // Mirrors applyMarkBatch: an identical assertion is free and changes nothing.
    if (state.marks[index] === assertion) {
      continue
    }
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
