/**
 * The single projection from application state to view data.
 *
 * Two invariants this module exists to hold:
 *
 * 1. **The solution board never crosses the boundary.** `GameState.board` is
 *    read only where a rail's own solution line is needed — the selectors and this
 *    module's per-rail derivation, which pins the same input — and none of its
 *    contents reach a `UiSnapshot`. The only solution-adjacent values a snapshot
 *    carries are the per-cell `correct` flag and `runs[].mineIndices`, both of
 *    which the selectors already derived.
 * 2. **Fail closed.** A line the pattern enumeration could not finish is
 *    published as `LineProgress.status === 'unknown'`, never as "fine". The
 *    only wall-clock reads in this file are the per-rail enumeration budget and
 *    the per-publish backstop, both of which trip as `'time-limit'`, i.e. a
 *    deliberate interruption rather than a silent truncation — and the budget
 *    is set far above the worst legitimate rail so that ordinary input never
 *    reaches it.
 *
 * Pure: no DOM, no `Math.random`, no `React`. `previewMarkBatch` is the store's
 * job (risk 3) and is deliberately not imported here.
 */
import type { PatternGenerationContext } from '../domain'
import {
  selectCell,
  selectColumns,
  selectRows,
  selectStatus,
  type GameStatusView,
} from '../application/gameSelectors'
import {
  NEXT_ROUND_SEED_LABEL_PREFIX,
  type CellMark,
  type GameDifficulty,
  type GameFailureDiagnostics,
  type GameLifecycle,
  type GameResultReason,
  type GameState,
  type GameTransition,
  type MarkBatchPreview,
} from '../application/gameReducer'
import { deriveLineProgress, type LineProgress } from '../application/lineProgress'
import type { GenerationSettings } from '../engine/generator/settings'
import type { RandomSeed } from '../engine/rng'
import type { DifficultyBand } from '../engine/solver/difficulty'
import {
  DEFAULT_LOCALE,
  failureCopy,
  formatDiagnostics,
  getCopy,
  interpolate,
  type Copy,
  type Locale,
} from './copy'

// --------------------------------------------------------------------------------------
// Verbatim prop contracts (§2.2)
// --------------------------------------------------------------------------------------

export type UiStatus = GameLifecycle
export type MarkingMode = 'mine' | 'blank' | 'erase'
export type ZoomStep = 'fit' | 's' | 'm' | 'l'

export const MARKING_MODES: readonly MarkingMode[] = Object.freeze(['mine', 'blank', 'erase'])
export const ZOOM_STEPS: readonly ZoomStep[] = Object.freeze(['fit', 's', 'm', 'l'])

export interface DimensionsView {
  readonly rows: number
  readonly columns: number
  readonly densityPercent: number
  /** Read-only derived echo of `densityPercent`; never an editable field. */
  readonly mineCount: number
  readonly difficulty: DifficultyBand
  readonly maxAttempts: number
  /** The string the user typed. Empty when the round derived its own seed. */
  readonly authoredSeed: string
}

export interface DifficultyView {
  readonly kind: 'known' | 'unknown' | 'absent'
  readonly band: DifficultyBand | null
  readonly minimumGuesses: number | null
  readonly reason: string | null
}

export interface ScoreView {
  readonly current: number
  readonly initial: number
}

export interface ReportLine {
  readonly label: string
  readonly value: string
}

export type FailureKind = 'deterministic' | 'retryable' | 'neutral'

export interface FailureView {
  readonly reason: string
  readonly kind: FailureKind
  readonly headline: string
  readonly explanation: string
  readonly remedies: readonly string[]
  readonly report: readonly ReportLine[]
  readonly canRetry: boolean
  readonly canChangeSeed: boolean
}

export interface StatusView {
  readonly status: UiStatus
  readonly score: ScoreView
  readonly round: number
  /** `generationRound`: the round being printed, or null when none is. */
  readonly nextRound: number | null
  readonly isGenerating: boolean
  readonly hasRound: boolean
  readonly difficulty: DifficultyView
  readonly dimensions: DimensionsView | null
  readonly failure: FailureView | null
  readonly interactive: boolean
}

export interface CellView {
  readonly index: number
  readonly row: number
  readonly column: number
  readonly mark: CellMark
  readonly locked: boolean
  readonly correct: boolean | null
}

export interface BoardView {
  readonly rows: number
  readonly columns: number
  readonly cells: readonly CellView[]
  readonly rowProgress: readonly LineProgress[]
  readonly columnProgress: readonly LineProgress[]
  readonly interactive: boolean
}

export interface PreviewView {
  readonly affectedCount: number
  readonly scoreCost: number
  readonly projectedScore: number
  readonly reachesZero: boolean
  readonly cellIndices: readonly number[]
}

export interface UiLastEvent {
  readonly transition: GameTransition | null
  readonly reason: GameResultReason | null
}

export interface UiSnapshot {
  readonly version: number
  readonly status: StatusView
  readonly board: BoardView | null
  readonly lastEvent: UiLastEvent | null
}

/** Affordance offered when a failure kept a board (risk 9, `round/resume`). */
export interface ResumeView {
  readonly available: boolean
  readonly round: number
  readonly body: string
  readonly action: string
}

// --------------------------------------------------------------------------------------
// Budget
// --------------------------------------------------------------------------------------

/**
 * §4.5: a hard ceiling on the enumeration of ONE rail, so a pathological clue fails
 * closed instead of hanging the publish.
 *
 * This is a per-rail budget, not a per-publish one. It used to be a single 8 ms
 * ceiling shared by all 30 rails, and that guard — not any property of the rails —
 * is what the census caught: a full cold derivation of a default 15x15/60% board
 * costs 1.515 ms in Node (per-rail max 0.305 ms, `column7:[1,1,1,1,1]`), so an 8 ms
 * ceiling survives only a ~5x slowdown, and a browser's first projection after a
 * round arrives runs cold-JIT. Ten of thirty rails were reported `unknown`, which
 * disabled exactly the completion highlighting the rails exist to provide.
 *
 * 64 ms is ~210x the worst measured legitimate rail and still ~13x below the 4.787 ms
 * at which the engine's own `LinePatternResourceLimitError` already fails closed on
 * the widest clue constructible here (`30/[1x8]`). In other words the engine's
 * resource limit is the real bound; this ceiling is only reachable by a rail the
 * engine considers legitimate but slow, which is the one case worth truncating.
 */
export const LINE_PATTERN_BUDGET_MS = 64

/**
 * An anti-hang backstop for the whole publish: the worst *legitimate* 30-rail
 * projection measured 1.515 ms cold, so 250 ms is ~165x headroom. Past the deadline
 * the remaining rails are derived against a permanently tripped context, which yields
 * the sanctioned `status: 'unknown'` shape instead of hanging the render.
 */
export const LINE_PATTERN_PUBLISH_BUDGET_MS = 250

/** Bumped whenever a field changes shape, so a memoised tree can discard it. */
export const SNAPSHOT_SCHEMA_VERSION = 1

function defaultNow(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now()
}

/**
 * One context per rail, so a slow rail cannot spend a sibling's ceiling — the failure
 * stays local instead of cascading down the list. No `timeBudgetMs`: tripping the
 * budget must surface as `status: 'unknown'`, not as a silently smaller search.
 */
function createPatternContext(
  now: () => number,
  budgetMs: number,
): PatternGenerationContext {
  const startedAt = now()
  return {
    shouldStop: () => (now() - startedAt > budgetMs ? 'time-limit' : undefined),
  }
}

/**
 * A context that has already run out of time. Used once the publish deadline has
 * passed: `deriveLineProgress` catches the interruption and returns its own
 * fail-closed `unknown` rail, so this projection never hand-builds one.
 */
const EXHAUSTED_PATTERN_CONTEXT: PatternGenerationContext = Object.freeze({
  shouldStop: () => 'time-limit' as const,
})

// --------------------------------------------------------------------------------------
// Per-rail memoisation
// --------------------------------------------------------------------------------------

/**
 * A rail's `LineProgress` is a pure function of the line's own inputs — orientation,
 * index, line length, its clue, its own marks, and the solution line. Marking one cell
 * changes at most two rails, so a 30-rail board re-derives at most 2 rails per click
 * instead of all 30, and the untouched 28 keep their prior derivation.
 *
 * The cache is module-level because the store cannot pass one (it is not this lane's
 * to change) and because it is a *transparent* memo: it returns the very object a cold
 * call would have produced, so `projectSnapshot` stays pure with respect to a given
 * `GameState`. The outer map is keyed on the puzzle, so a finished round's entries are
 * collected with it, and each round is bounded by `LINE_RAIL_CACHE_MAX_ENTRIES`.
 */
const railCache = new WeakMap<object, Map<string, LineProgress>>()

/**
 * Ids for the two per-round inputs that are objects rather than values. The clue array
 * and the board are stable for a whole round, so a `WeakMap` id keeps the cache key
 * short and cheap without ever mistaking a new board for the old one. The ids come
 * from the puzzle and the board themselves, never from a `LineProgress` — a rail
 * result carries a *copy* of its clue, so its identity says nothing about the round.
 */
const railInputTokens = new WeakMap<object, number>()
let nextRailInputToken = 1

function railInputToken(value: object): number {
  const known = railInputTokens.get(value)
  if (known !== undefined) {
    return known
  }
  nextRailInputToken += 1
  railInputTokens.set(value, nextRailInputToken)
  return nextRailInputToken
}

/** Bounded per round: 60 rails x ~60 distinct mark states, then FIFO eviction. */
const LINE_RAIL_CACHE_MAX_ENTRIES = 4096

/** `unknown` is 3 characters; one char per cell keeps the key short and exact. */
function marksKey(marks: readonly CellMark[]): string {
  let key = ''
  for (const mark of marks) {
    key += mark === 'mine' ? 'm' : mark === 'blank' ? 'b' : '?'
  }
  return key
}

interface RailRequest {
  readonly orientation: 'row' | 'column'
  readonly index: number
  readonly lineLength: number
  readonly clue: readonly number[]
  readonly marks: readonly CellMark[]
  readonly solution: readonly (0 | 1)[]
}

/**
 * Derives one rail, reusing the previous derivation when this line's own inputs have
 * not moved. A rail whose derivation was cut short by a budget is deliberately NOT
 * cached: that value is a function of the clock, and caching it would let a transient
 * `unknown` outlive the pressure that caused it.
 */
function deriveCachedRail(
  puzzle: object,
  board: readonly number[],
  request: RailRequest,
  patternContext: PatternGenerationContext,
): LineProgress {
  const key = `${SNAPSHOT_SCHEMA_VERSION}|${request.orientation}|${request.index}|${request.lineLength}|${railInputToken(request.clue as object)}|${railInputToken(board as object)}|${marksKey(request.marks)}`
  const round = railCache.get(puzzle)
  if (round !== undefined) {
    const cached = round.get(key)
    if (cached !== undefined) {
      return cached
    }
  }
  const derived = deriveLineProgress({ ...request, patternContext })
  // `unknown` means the budget cut the enumeration short; it is not a derivation.
  if (derived.status === 'ready') {
    if (round === undefined) {
      railCache.set(puzzle, new Map([[key, derived]]))
    } else {
      if (round.size >= LINE_RAIL_CACHE_MAX_ENTRIES) {
        const oldest = round.keys().next()
        if (oldest.done !== true) {
          round.delete(oldest.value)
        }
      }
      round.set(key, derived)
    }
  }
  return derived
}

interface RailProjection {
  readonly rowProgress: readonly LineProgress[]
  readonly columnProgress: readonly LineProgress[]
}

/**
 * Projects every rail, one at a time so each gets its own budget, and reuses the
 * derivations that this click did not invalidate.
 *
 * The index arithmetic mirrors `selectRows`/`selectColumns` exactly — the same clue
 * array, the same mark slice, the same solution line, the same `LineProgress` — and a
 * test pins that equivalence, because the selectors cannot be asked for a single line
 * and a drift between the two paths would show up as rails that disagree with the
 * board they are drawn from.
 */
function projectRails(
  state: GameState,
  now: () => number,
  patternBudgetMs: number,
  bypassCache: boolean,
): RailProjection {
  const { board, puzzle, settings } = state
  if (board === null || puzzle === null) {
    return { rowProgress: Object.freeze([]), columnProgress: Object.freeze([]) }
  }
  if (bypassCache) {
    // The verification seam: exactly the original selector path, with no memoisation
    // and one context for the whole publish. Production never takes this branch, and
    // a test pins that it agrees with the per-rail derivation rail for rail.
    const context = createPatternContext(now, patternBudgetMs)
    return { rowProgress: selectRows(state, context), columnProgress: selectColumns(state, context) }
  }
  const deadline = now() + LINE_PATTERN_PUBLISH_BUDGET_MS
  const rows: LineProgress[] = []
  const columns: LineProgress[] = []

  for (let row = 0; row < settings.rows; row += 1) {
    const start = row * settings.columns
    const request: RailRequest = {
      orientation: 'row',
      index: row,
      lineLength: settings.columns,
      clue: puzzle.clues.rowClues[row],
      marks: state.marks.slice(start, start + settings.columns),
      solution: board.slice(start, start + settings.columns) as readonly (0 | 1)[],
    }
    rows.push(deriveCachedRail(puzzle, board, request, railContext(now, deadline, patternBudgetMs)))
  }

  for (let column = 0; column < settings.columns; column += 1) {
    const marks: CellMark[] = []
    const solution: (0 | 1)[] = []
    for (let row = 0; row < settings.rows; row += 1) {
      const index = row * settings.columns + column
      marks.push(state.marks[index])
      solution.push(board[index] as 0 | 1)
    }
    const request: RailRequest = {
      orientation: 'column',
      index: column,
      lineLength: settings.rows,
      clue: puzzle.clues.columnClues[column],
      marks,
      solution,
    }
    columns.push(deriveCachedRail(puzzle, board, request, railContext(now, deadline, patternBudgetMs)))
  }

  return {
    rowProgress: Object.freeze(rows),
    columnProgress: Object.freeze(columns),
  }
}

/** The rail's own budget, or the exhausted context once the publish deadline is past. */
function railContext(
  now: () => number,
  deadline: number,
  patternBudgetMs: number,
): PatternGenerationContext {
  return now() > deadline ? EXHAUSTED_PATTERN_CONTEXT : createPatternContext(now, patternBudgetMs)
}


// --------------------------------------------------------------------------------------
// Failure classification (risk 6)
// --------------------------------------------------------------------------------------

/**
 * Settings- or band-level faults. Retrying the identical request would fail
 * identically, so the UI must not offer Retry as the primary action.
 */
const DETERMINISTIC_REASONS: ReadonlySet<string> = new Set([
  'difficulty-not-found',
  'infeasible',
  'invalid-settings',
  'invalid-initial-score',
  'invalid-difficulty',
])

/** Faults a different seed cannot address. */
const SEED_INSENSITIVE_REASONS: ReadonlySet<string> = new Set([
  'infeasible',
  'invalid-settings',
  'invalid-initial-score',
  'invalid-difficulty',
])

/** A rejected or ignored action, not a generation fault. */
const ACTION_REASONS: ReadonlySet<string> = new Set<GameResultReason>([
  'not-generating',
  'stale-generation-id',
  'round-not-playing',
  'invalid-batch',
  'conflicting-assertions',
  'invalid-cell-index',
  'invalid-cell-assertion',
  'round-not-resumable',
  'locked-cell',
  'cell-already-marked',
  'cell-already-unknown',
])

/**
 * Time, resource and worker faults are retryable; an unknown reason is treated
 * as retryable too, because the app cannot claim a failure is impossible.
 */
export function failureKind(reason: string): FailureKind {
  if (DETERMINISTIC_REASONS.has(reason)) {
    return 'deterministic'
  }
  if (reason === 'cancelled' || ACTION_REASONS.has(reason)) {
    return 'neutral'
  }
  return 'retryable'
}

// --------------------------------------------------------------------------------------
// Seed policy (§4.6)
// --------------------------------------------------------------------------------------

function isDerivedSeed(seed: RandomSeed): boolean {
  return typeof seed === 'string' && seed.startsWith(NEXT_ROUND_SEED_LABEL_PREFIX)
}

/**
 * The seed the user typed, or `''` when the engine derived this round's seed.
 * A derived seed is never rendered; the UI shows `footer.seedUnavailable`
 * instead, and the value is only reachable through `failureClipboardText`.
 */
function authoredSeedOf(settings: GenerationSettings, seedDerived: boolean): string {
  return seedDerived || isDerivedSeed(settings.seed) ? '' : String(settings.seed)
}

/**
 * Whether the current settings carry a seed the engine derived itself.
 *
 * `startGeneration` swaps in `deriveNextRoundSettings(base, round + 1)` only
 * when the state was `won`, and `failGeneration` keeps that swapped settings
 * only when the pending request `continuesWonRound`. Every cell of a `won` board
 * is locked, and finishing a board always transitions to `won`, so a failed
 * state whose every cell is locked is the post-win path and its seed is
 * derived. Reads `marks`/`locked` only, never `state.board`.
 */
function seedIsEngineDerived(state: GameState): boolean {
  if (state.status !== 'failed' || state.marks.length === 0) {
    return false
  }
  return state.marks.every((_, index) => state.locked[index] === true)
}

// --------------------------------------------------------------------------------------
// Sub-projections
// --------------------------------------------------------------------------------------

function projectDifficulty(difficulty: GameDifficulty | null): DifficultyView {
  if (difficulty === null) {
    return Object.freeze({
      kind: 'absent' as const,
      band: null,
      minimumGuesses: null,
      reason: null,
    })
  }
  if (difficulty.status === 'known') {
    return Object.freeze({
      kind: 'known' as const,
      band: difficulty.band,
      minimumGuesses: difficulty.minimumGuesses,
      reason: null,
    })
  }
  return Object.freeze({
    kind: 'unknown' as const,
    band: null,
    minimumGuesses: null,
    reason: difficulty.reason,
  })
}

function projectDimensions(settings: GenerationSettings, seedDerived: boolean): DimensionsView {
  return Object.freeze({
    rows: settings.rows,
    columns: settings.columns,
    densityPercent: settings.densityPercent,
    // `normalizeGenerationSettings` fixes mineCount to the density echo, so the
    // settings field is the derived value and never an independent input.
    mineCount: settings.mineCount,
    difficulty: settings.difficulty,
    maxAttempts: settings.maxAttempts,
    authoredSeed: authoredSeedOf(settings, seedDerived),
  })
}

function projectFailure(
  t: Copy,
  reason: string,
  details: GameFailureDiagnostics,
  settings: GenerationSettings,
  round: number,
  resumable: boolean,
  seedDerived: boolean,
): FailureView {
  const kind = failureKind(reason)
  const text = failureCopy(t, reason)
  const remedies = resumable
    ? [interpolate(t.resume.action, { round }), ...text.remedies]
    : [...text.remedies]
  return Object.freeze({
    reason,
    kind,
    headline: text.headline,
    explanation: text.explanation,
    remedies: Object.freeze(remedies),
    report: formatDiagnostics(t, {
      details: details.details ?? {},
      authoredSeed: authoredSeedOf(settings, seedDerived),
      seedDerived,
      round: round + 1,
    }),
    canRetry: kind !== 'deterministic',
    canChangeSeed: !SEED_INSENSITIVE_REASONS.has(reason),
  })
}

function projectCells(state: GameState): readonly CellView[] {
  const cells: CellView[] = []
  const total = state.marks.length
  for (let index = 0; index < total; index += 1) {
    const cell = selectCell(state, index)
    if (cell === null) {
      break
    }
    cells.push(
      Object.freeze({
        index: cell.index,
        row: cell.row,
        column: cell.column,
        mark: cell.mark,
        locked: cell.locked,
        correct: cell.correct,
      }),
    )
  }
  return Object.freeze(cells)
}

// --------------------------------------------------------------------------------------
// Entry point
// --------------------------------------------------------------------------------------

export interface ProjectOptions {
  /** Dictionary to project with. Takes precedence over `locale`. */
  readonly copy?: Copy
  readonly locale?: Locale
  /** Monotonic counter for `UiSnapshot.version`; defaults to the state generation. */
  readonly version?: number
  readonly lastEvent?: UiLastEvent | null
  /** Enumeration ceiling in ms. Only lower it in tests. */
  readonly patternBudgetMs?: number
  /** Clock seam for the budget guard. Only override it in tests. */
  readonly now?: () => number
  /**
   * Derives every rail through the original selectors with no memoisation. Only
   * override it in tests, to prove the memo returns what a cold call returns.
   */
  readonly bypassLineCache?: boolean
  /**
   * Overrides the derived-seed detection. The store knows which request it
   * sent; the default infers it from the state (§4.6).
   */
  readonly seedDerived?: boolean
}

/**
 * Projects a `GameState` into a frozen `UiSnapshot`. Returns a fresh object
 * every call; the store owns the memoisation key.
 */
export function projectSnapshot(state: GameState, options: ProjectOptions = {}): UiSnapshot {
  const t = options.copy ?? getCopy(options.locale ?? DEFAULT_LOCALE)
  const view: GameStatusView = selectStatus(state)
  const now = options.now ?? defaultNow
  const { rowProgress, columnProgress } = projectRails(
    state,
    now,
    options.patternBudgetMs ?? LINE_PATTERN_BUDGET_MS,
    options.bypassLineCache === true,
  )

  const interactive = state.status === 'playing'
  const hasRound = state.puzzle !== null && state.round > 0
  const hasBoard = state.puzzle !== null && rowProgress.length > 0 && columnProgress.length > 0
  const seedDerived = options.seedDerived ?? seedIsEngineDerived(state)

  const failure =
    state.status === 'failed' && state.failure !== null
      ? projectFailure(
          t,
          state.failure.reason,
          state.failure,
          view.settings,
          state.round,
          hasRound,
          seedDerived,
        )
      : null

  const dimensions = state.puzzle?.dimensions ?? null
  const board: BoardView | null = hasBoard && dimensions !== null
    ? Object.freeze({
        rows: dimensions.rows,
        columns: dimensions.columns,
        cells: projectCells(state),
        rowProgress: Object.freeze([...rowProgress]),
        columnProgress: Object.freeze([...columnProgress]),
        interactive,
      })
    : null

  const lastEvent = options.lastEvent
    ? Object.freeze({
        transition: options.lastEvent.transition,
        reason: options.lastEvent.reason,
      })
    : null

  const status: StatusView = Object.freeze({
    status: state.status,
    score: Object.freeze({ current: state.score, initial: state.initialScore }),
    round: state.round,
    nextRound: view.generationRound,
    isGenerating: view.isGenerating,
    hasRound,
    difficulty: projectDifficulty(state.difficulty),
    dimensions: projectDimensions(view.settings, seedDerived),
    failure,
    interactive,
  })

  return Object.freeze({
    version: options.version ?? state.generationId,
    status,
    board,
    lastEvent,
  })
}

// --------------------------------------------------------------------------------------
// Derived affordances
// --------------------------------------------------------------------------------------

/** Whether `round/resume` can return the kept board to `playing`. */
export function resumeAvailable(snapshot: UiSnapshot): boolean {
  return snapshot.status.status === 'failed' && snapshot.status.hasRound
}

/**
 * State-shaped resume affordance, for the store and for tests. Components that
 * only hold a snapshot should use `resumeAvailable` plus `copy.resume`.
 */
export function projectResume(state: GameState, t: Copy = getCopy(DEFAULT_LOCALE)): ResumeView {
  const available = state.status === 'failed' && state.puzzle !== null && state.round > 0
  return Object.freeze({
    available,
    round: state.round,
    body: available ? t.resume.body : t.resume.unavailable,
    action: available
      ? interpolate(t.resume.action, { round: state.round })
      : t.resume.unavailable,
  })
}

// --------------------------------------------------------------------------------------
// Drag preview (risk 3: the store calls previewMarkBatch, this only reshapes it)
// --------------------------------------------------------------------------------------

/**
 * Copies a `MarkBatchPreview` into a frozen, render-safe `PreviewView`. The
 * store owns the call to `previewMarkBatch`; this lane never imports it.
 */
export function projectPreview(
  preview: MarkBatchPreview,
  cellIndices: readonly number[] = [],
): PreviewView {
  return Object.freeze({
    affectedCount: preview.affectedCount,
    scoreCost: preview.scoreCost,
    projectedScore: preview.projectedScore,
    reachesZero: preview.reachesZero,
    cellIndices: Object.freeze([...cellIndices]),
  })
}

// --------------------------------------------------------------------------------------
// Clipboard-only report (§4.6)
// --------------------------------------------------------------------------------------

/**
 * Plain-text reproducible report, formatted at click time for the clipboard.
 * This is the ONLY path by which an engine-derived seed reaches the user: the
 * value never enters a snapshot, a React value, or a rendered string.
 */
export function failureClipboardText(
  failure: GameFailureDiagnostics | null,
  settings: GenerationSettings | null,
  t: Copy = getCopy(DEFAULT_LOCALE),
  seedDerived = settings !== null && isDerivedSeed(settings.seed),
): string {
  if (failure === null) {
    return ''
  }
  const rows = formatDiagnostics(t, {
    details: failure.details ?? {},
    authoredSeed: settings === null ? '' : authoredSeedOf(settings, seedDerived),
    seedDerived,
  })
  const lines = rows.map((row) => `${row.label}: ${row.value}`)
  if (settings !== null && seedDerived) {
    lines.push(`${t.failure.report.seedDerived}: ${String(settings.seed)}`)
  }
  return lines.join('\n')
}
