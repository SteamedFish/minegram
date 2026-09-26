import { describe, expect, it } from 'vitest'
import { derivePuzzleClues, type MinegramPuzzle } from '../domain'
import { generateMinegramPuzzle } from '../engine/generator'
import { selectColumns, selectRows } from '../application/gameSelectors'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import {
  createInitialGameState,
  gameReducer,
  type GameAction,
  type GameDifficulty,
  type GameFailureDiagnostics,
  type GameState,
  type GeneratedRound,
  type JsonObject,
} from '../application/gameReducer'
import { getCopy, type Copy } from './copy'
import {
  LINE_PATTERN_BUDGET_MS,
  SNAPSHOT_SCHEMA_VERSION,
  failureClipboardText,
  failureKind,
  projectPreview,
  projectResume,
  projectSnapshot,
  resumeAvailable,
  sameLastEvent,
  type PreviewView,
  type UiSnapshot,
} from './viewModel'

// --------------------------------------------------------------------------------------
// Fixtures
// --------------------------------------------------------------------------------------

const board = [1, 0, 0, 1] as const
const dimensions = { rows: 2, columns: 2 } as const
const puzzle: MinegramPuzzle = {
  dimensions,
  clues: derivePuzzleClues(board, dimensions),
}
const settings = normalizeGenerationSettings({
  rows: 2,
  columns: 2,
  densityPercent: 50,
  seed: 'fixture-seed',
  difficulty: 'starter',
  maxAttempts: 3,
})
const round: GeneratedRound = { settings, board, puzzle }
const t: Copy = getCopy('en')

const WHITELISTED_LABELS: readonly string[] = [
  t.failure.report.rows,
  t.failure.report.columns,
  t.failure.report.density,
  t.failure.report.mineCount,
  t.failure.report.difficultyBand,
  t.failure.report.maxAttempts,
  t.failure.report.seed,
  t.failure.report.seedSource,
  t.failure.report.attempts,
  t.failure.report.layouts,
  t.failure.report.candidates,
  t.failure.report.accepted,
  t.failure.report.rollbacks,
  t.failure.report.solverCalls,
  t.failure.report.difficultyNodesVisited,
  t.failure.report.difficultyNodeLimit,
  t.failure.report.proofStatus,
  t.failure.report.difficultyStatus,
  t.failure.report.difficultyReason,
  t.failure.report.minimumGuesses,
  t.failure.report.band,
  t.failure.report.solverStatuses,
  t.failure.report.resourceReasons,
]

const FULL_DETAILS: JsonObject = {
  settings: {
    rows: 2,
    columns: 2,
    densityPercent: 50,
    mineCount: 2,
    difficulty: 'starter',
    seed: 'fixture-seed',
    maxAttempts: 3,
    unlistedSetting: 'ignored',
  },
  diagnostics: {
    attempts: 3,
    layouts: 5,
    candidates: 2,
    accepted: 1,
    rollbacks: 4,
    solverCalls: 9,
    solverStatuses: ['unique', 'unique', 'unknown'],
    resourceReasons: [],
    difficultyNodesVisited: 11,
    difficultyNodeLimit: 2000,
    proofStatus: 'unique',
    difficultyStatus: 'known',
    difficultyReason: 'node-limit',
    minimumGuesses: 0,
    band: 'starter',
    unlistedDiagnostic: { nested: 'ignored' },
  },
  engineStack: 'at Object.generate (minegram/src/engine/generator/generator.ts:1:1)',
}

function transition(state: GameState, action: GameAction): GameState {
  const result = gameReducer(state, action)
  if (result.type !== 'transition') {
    throw new Error(`expected a transition, received ${result.type}: ${result.reason}`)
  }
  return result.state
}

function accept(state: GameState, generated: GeneratedRound = round): GameState {
  return transition(state, {
    type: 'generation/succeeded',
    generationId: state.generationId,
    round: generated,
  })
}

function start(state: GameState, action: GameAction = { type: 'generation/start' }): GameState {
  return transition(state, action)
}

/** Fails the pending request, keeping the engine's own machine message on purpose. */
function fail(state: GameState, reason: string, details: JsonObject = FULL_DETAILS): GameState {
  const failure: GameFailureDiagnostics = {
    reason,
    message: `Minegram generation failed: ${reason}`,
    details,
  }
  return transition(state, {
    type: 'generation/failed',
    generationId: state.generationId,
    failure,
  })
}

const idle = createInitialGameState({ settings, initialScore: 5 })
const generating = start(idle)
const playing = accept(generating)
const won = transition(playing, {
  type: 'round/markBatch',
  cells: [
    { index: 0, assertion: 'mine' },
    { index: 1, assertion: 'blank' },
    { index: 2, assertion: 'blank' },
    { index: 3, assertion: 'mine' },
  ],
})
const lostOnce = accept(start(createInitialGameState({ settings, initialScore: 1 })))
const lost = transition(lostOnce, { type: 'round/markBatch', cells: [{ index: 0, assertion: 'blank' }] })
const failedWithBoard = fail(start(playing), 'time-limit')
const failedWithoutBoard = fail(start(idle), 'worker-unavailable')
const failedAfterWin = fail(start(won), 'difficulty-not-found')

// --------------------------------------------------------------------------------------
// Snapshot walking helpers
// --------------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

interface Collected {
  readonly arrays: { readonly path: string; readonly value: readonly unknown[] }[]
  readonly strings: { readonly path: string; readonly value: string }[]
  readonly numbers: { readonly path: string; readonly value: number }[]
}

function collect(node: unknown, path = '$', out?: Collected): Collected {
  const sink: Collected = out ?? { arrays: [], strings: [], numbers: [] }
  if (Array.isArray(node)) {
    sink.arrays.push({ path, value: node })
    node.forEach((entry, index) => collect(entry, `${path}[${index}]`, sink))
    return sink
  }
  if (isPlainObject(node)) {
    for (const [key, entry] of Object.entries(node)) {
      collect(entry, `${path}.${key}`, sink)
    }
    return sink
  }
  if (typeof node === 'string') {
    sink.strings.push({ path, value: node })
  } else if (typeof node === 'number') {
    sink.numbers.push({ path, value: node })
  }
  return sink
}

function everyObject(node: unknown, visit: (value: Record<string, unknown>, path: string) => void, path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((entry, index) => everyObject(entry, visit, `${path}[${index}]`))
    return
  }
  if (isPlainObject(node)) {
    visit(node, path)
    for (const [key, entry] of Object.entries(node)) {
      everyObject(entry, visit, `${path}.${key}`)
    }
  }
}

/**
 * The projection source, read through Vite so the guards need no node types and
 * cannot be fooled by the transform.
 */
async function readModuleSource(name: 'viewModel.ts'): Promise<string> {
  const raw: { default: string } = await import('./viewModel.ts?raw')
  if (name !== 'viewModel.ts') {
    throw new Error(`no raw source for ${name}`)
  }
  return raw.default
}

// --------------------------------------------------------------------------------------
// Lifecycle
// --------------------------------------------------------------------------------------

describe('projectSnapshot lifecycle', () => {
  it('projects the idle state', () => {
    const snapshot = projectSnapshot(idle)
    expect(snapshot.version).toBe(idle.generationId)
    expect(snapshot.status.status).toBe('idle')
    expect(snapshot.status.round).toBe(0)
    expect(snapshot.status.nextRound).toBeNull()
    expect(snapshot.status.isGenerating).toBe(false)
    expect(snapshot.status.hasRound).toBe(false)
    expect(snapshot.status.interactive).toBe(false)
    expect(snapshot.status.score).toEqual({ current: 5, initial: 5 })
    expect(snapshot.status.failure).toBeNull()
    expect(snapshot.board).toBeNull()
    expect(snapshot.lastEvent).toBeNull()
    expect(snapshot.status.difficulty).toEqual({
      kind: 'absent',
      band: null,
      minimumGuesses: null,
      reason: null,
    })
    expect(snapshot.status.dimensions).toEqual({
      rows: 2,
      columns: 2,
      densityPercent: 50,
      mineCount: 2,
      difficulty: 'starter',
      maxAttempts: 3,
      authoredSeed: 'fixture-seed',
    })
  })

  it('projects the generating state', () => {
    const snapshot = projectSnapshot(generating)
    expect(snapshot.status.status).toBe('generating')
    expect(snapshot.status.isGenerating).toBe(true)
    expect(snapshot.status.nextRound).toBe(1)
    expect(snapshot.status.round).toBe(0)
    expect(snapshot.status.hasRound).toBe(false)
    expect(snapshot.status.interactive).toBe(false)
    expect(snapshot.board).toBeNull()
  })

  it('projects the playing state with a full board', () => {
    const snapshot = projectSnapshot(playing)
    expect(snapshot.status.status).toBe('playing')
    expect(snapshot.status.round).toBe(1)
    expect(snapshot.status.hasRound).toBe(true)
    expect(snapshot.status.nextRound).toBeNull()
    expect(snapshot.status.isGenerating).toBe(false)
    expect(snapshot.status.score).toEqual({ current: 5, initial: 5 })
    const view = snapshot.board
    expect(view).not.toBeNull()
    expect(view?.rows).toBe(2)
    expect(view?.columns).toBe(2)
    expect(view?.interactive).toBe(true)
    expect(view?.cells).toHaveLength(4)
    expect(view?.rowProgress).toHaveLength(2)
    expect(view?.columnProgress).toHaveLength(2)
    expect(view?.cells.map((cell) => cell.index)).toEqual([0, 1, 2, 3])
    for (const cell of view?.cells ?? []) {
      expect(Object.keys(cell).sort()).toEqual(['column', 'correct', 'index', 'locked', 'mark', 'row'])
      expect(cell.mark).toBe('unknown')
      expect(cell.locked).toBe(false)
      expect(cell.correct).toBeNull()
    }
    expect(view?.rowProgress.map((line) => line.clue)).toEqual([[1], [1]])
    for (const line of [...(view?.rowProgress ?? []), ...(view?.columnProgress ?? [])]) {
      expect(line.status).toBe('ready')
      expect(line.contradiction).toBe(false)
      expect(line.compatiblePatternCount).not.toBeNull()
    }
  })

  it('projects the won state as non-interactive but still readable', () => {
    const snapshot = projectSnapshot(won)
    expect(snapshot.status.status).toBe('won')
    expect(snapshot.status.interactive).toBe(false)
    expect(snapshot.status.hasRound).toBe(true)
    expect(snapshot.board).not.toBeNull()
    for (const cell of snapshot.board?.cells ?? []) {
      expect(cell.locked).toBe(true)
      expect(cell.correct).toBe(true)
      expect(cell.mark).not.toBe('unknown')
    }
    expect(snapshot.status.failure).toBeNull()
  })

  it('projects the lost state with the score clamped to zero', () => {
    const snapshot = projectSnapshot(lost)
    expect(snapshot.status.status).toBe('lost')
    expect(snapshot.status.score).toEqual({ current: 0, initial: 1 })
    expect(snapshot.status.interactive).toBe(false)
    expect(snapshot.status.hasRound).toBe(true)
    expect(snapshot.board?.interactive).toBe(false)
  })

  it('is interactive only while a round is playing', () => {
    const states: readonly [string, GameState][] = [
      ['idle', idle],
      ['generating', generating],
      ['playing', playing],
      ['won', won],
      ['lost', lost],
      ['failed with board', failedWithBoard],
      ['failed without board', failedWithoutBoard],
      ['failed after win', failedAfterWin],
    ]
    for (const [name, state] of states) {
      const snapshot = projectSnapshot(state)
      expect(snapshot.status.interactive, name).toBe(state.status === 'playing')
      expect(snapshot.board?.interactive ?? false, name).toBe(state.status === 'playing')
    }
  })

  it('passes the last event through when the store supplies one', () => {
    const snapshot = projectSnapshot(won, {
      lastEvent: { transition: 'round-won', reason: null, reasonLabel: null, autoRevealedLines: 0, autoRevealedCells: 0 },
    })
    expect(snapshot.lastEvent).toEqual({
      transition: 'round-won',
      reason: null,
      reasonLabel: null,
      autoRevealedLines: 0,
      autoRevealedCells: 0,
    })
    expect(projectSnapshot(won).lastEvent).toBeNull()
  })

  it('carries the auto-reveal counts into the snapshot', () => {
    // The region subtracts the revealed cells from the mark diff it computes
    // itself, so the counts have to survive the projection: a snapshot that
    // dropped them would credit the game-written cells to the player.
    const snapshot = projectSnapshot(playing, {
      lastEvent: { transition: 'marks-applied', reason: null, reasonLabel: null, autoRevealedLines: 2, autoRevealedCells: 2 },
    })
    expect(snapshot.lastEvent).toEqual({
      transition: 'marks-applied',
      reason: null,
      reasonLabel: null,
      autoRevealedLines: 2,
      autoRevealedCells: 2,
    })
    expect(Object.isFrozen(snapshot.lastEvent)).toBe(true)
  })

  it('resolves a refusal reason into a localised sentence', () => {
    const locked = projectSnapshot(playing, {
      lastEvent: {
        transition: null,
        reason: 'locked-cell',
        reasonLabel: null,
        autoRevealedLines: 0,
        autoRevealedCells: 0,
      },
    })
    expect(locked.lastEvent?.reason).toBe('locked-cell')
    expect(locked.lastEvent?.reasonLabel).toBe('That cell is already locked, so its mark cannot change.')
    expect(locked.lastEvent?.reasonLabel).not.toContain('locked-cell')

    const zh = projectSnapshot(playing, {
      locale: 'zh-CN',
      lastEvent: {
        transition: null,
        reason: 'locked-cell',
        reasonLabel: null,
        autoRevealedLines: 0,
        autoRevealedCells: 0,
      },
    })
    expect(zh.lastEvent?.reason).toBe('locked-cell')
    expect(zh.lastEvent?.reasonLabel).toBe('该格已被锁定，标记无法更改。')
  })

  it('treats two projections of the same event content as the same event', () => {
    // The invariant, not the symptom: `projectSnapshot` re-freezes its event on
    // every call, so object identity can NEVER hold across two publishes — a
    // consumer that compares with `===` re-announces an event the player has
    // already been told about, and a locale switch is exactly such a re-publish.
    const event = {
      transition: 'marks-applied',
      reason: null,
      reasonLabel: null,
      autoRevealedLines: 2,
      autoRevealedCells: 2,
    } as const
    const first = projectSnapshot(playing, { lastEvent: event })
    const second = projectSnapshot(playing, { lastEvent: event })

    expect(first.lastEvent).not.toBe(second.lastEvent)
    expect(sameLastEvent(first.lastEvent, second.lastEvent)).toBe(true)

    // A locale switch re-projects the same event in another language. Every
    // transition event has `reason: null`, hence a `null` label in every locale,
    // so the content is unchanged and the consumer must not re-announce.
    const localized = projectSnapshot(playing, { locale: 'zh-CN', lastEvent: event })
    expect(sameLastEvent(first.lastEvent, localized.lastEvent)).toBe(true)

    // Any single field differing is a different event, label included.
    const other = projectSnapshot(playing, {
      lastEvent: { ...event, autoRevealedCells: 1 },
    })
    expect(sameLastEvent(first.lastEvent, other.lastEvent)).toBe(false)
    const refusal = projectSnapshot(playing, {
      lastEvent: { transition: null, reason: 'locked-cell', reasonLabel: null, autoRevealedLines: 0, autoRevealedCells: 0 },
    })
    expect(sameLastEvent(first.lastEvent, refusal.lastEvent)).toBe(false)
    expect(sameLastEvent(null, first.lastEvent)).toBe(false)
    expect(sameLastEvent(null, null)).toBe(true)

    // A refusal's label IS its content, so a locale switch of a refusal is a
    // real change — the sentence the player must be told changed.
    const refusalZh = projectSnapshot(playing, {
      locale: 'zh-CN',
      lastEvent: { transition: null, reason: 'locked-cell', reasonLabel: null, autoRevealedLines: 0, autoRevealedCells: 0 },
    })
    expect(refusal.lastEvent?.reason).toBe(refusalZh.lastEvent?.reason)
    expect(sameLastEvent(refusal.lastEvent, refusalZh.lastEvent)).toBe(false)
  })
})

// --------------------------------------------------------------------------------------
// Failure, resume and round accounting
// --------------------------------------------------------------------------------------

describe('failure handling', () => {
  it('offers the resume affordance for a failed state that kept a board', () => {
    const snapshot = projectSnapshot(failedWithBoard)
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.status.hasRound).toBe(true)
    expect(snapshot.status.round).toBe(1)
    expect(resumeAvailable(snapshot)).toBe(true)
    expect(snapshot.board).not.toBeNull()
    const resume = projectResume(failedWithBoard, t)
    expect(resume.available).toBe(true)
    expect(resume.round).toBe(1)
    expect(resume.action).toBe('Resume round 1')
    expect(resume.body).toBe(t.resume.body)
    expect(snapshot.status.failure?.remedies[0]).toBe('Resume round 1')
  })

  it('withholds the resume affordance for a failed state without a board', () => {
    const snapshot = projectSnapshot(failedWithoutBoard)
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.status.hasRound).toBe(false)
    expect(snapshot.status.round).toBe(0)
    expect(resumeAvailable(snapshot)).toBe(false)
    expect(snapshot.board).toBeNull()
    const resume = projectResume(failedWithoutBoard, t)
    expect(resume.available).toBe(false)
    expect(resume.action).toBe(t.resume.unavailable)
    expect(snapshot.status.failure?.remedies).not.toContain('Resume round 0')
  })

  it('resumes a post-win failure through the same affordance', () => {
    const snapshot = projectSnapshot(failedAfterWin)
    expect(snapshot.status.hasRound).toBe(true)
    expect(resumeAvailable(snapshot)).toBe(true)
  })

  it('separates deterministic failures from retryable ones', () => {
    const deterministic: readonly string[] = [
      'difficulty-not-found',
      'infeasible',
      'invalid-settings',
      'invalid-initial-score',
      'invalid-difficulty',
    ]
    const retryable: readonly string[] = [
      'time-limit',
      'resource-limit',
      'attempt-limit',
      'worker-exception',
      'worker-error',
      'worker-message-error',
      'worker-unavailable',
      'worker-post-error',
      'invalid-worker-response',
      'invalid-generated-round',
      'a-reason-this-build-has-never-seen',
    ]
    const neutral: readonly string[] = ['cancelled', 'locked-cell', 'round-not-playing']
    for (const reason of deterministic) {
      expect(failureKind(reason), reason).toBe('deterministic')
    }
    for (const reason of retryable) {
      expect(failureKind(reason), reason).toBe('retryable')
    }
    for (const reason of neutral) {
      expect(failureKind(reason), reason).toBe('neutral')
    }
    for (const reason of deterministic) {
      const failure = projectSnapshot(fail(start(playing), reason)).status.failure
      expect(failure?.kind, reason).toBe('deterministic')
      expect(failure?.canRetry, reason).toBe(false)
    }
    const timedOut = projectSnapshot(failedWithBoard).status.failure
    expect(timedOut?.kind).toBe('retryable')
    expect(timedOut?.canRetry).toBe(true)
    expect(timedOut?.reason).toBe('time-limit')
    expect(timedOut?.headline).toBe(t.failure.reasons['time-limit'].headline)
    expect(timedOut?.explanation).toBe(t.failure.reasons['time-limit'].explanation)
    expect(timedOut?.remedies.length).toBeGreaterThan(1)
    const unknownReason = projectSnapshot(fail(start(idle), 'a-reason-this-build-has-never-seen')).status
      .failure
    expect(unknownReason?.headline).toBe(t.failure.unknownReason.headline)
    expect(unknownReason?.kind).toBe('retryable')
  })

  it('only offers a new seed when the seed can change the outcome', () => {
    expect(projectSnapshot(fail(start(playing), 'infeasible')).status.failure?.canChangeSeed).toBe(false)
    expect(projectSnapshot(fail(start(playing), 'time-limit')).status.failure?.canChangeSeed).toBe(true)
    expect(projectSnapshot(fail(start(playing), 'difficulty-not-found')).status.failure?.canChangeSeed).toBe(
      true,
    )
  })

  it('never renders the engine failure message', () => {
    const snapshot = projectSnapshot(failedWithBoard)
    const rendered = JSON.stringify(snapshot)
    expect(rendered).not.toContain('Minegram generation failed')
    expect(rendered).not.toContain('engineStack')
    expect(rendered).not.toContain('unlistedSetting')
    expect(rendered).not.toContain('unlistedDiagnostic')
    expect(snapshot.status.failure?.headline).not.toContain('time-limit')
  })

  it('reports only whitelisted report rows', () => {
    const failure = projectSnapshot(failedWithBoard).status.failure
    expect(failure).not.toBeNull()
    const labels = failure?.report.map((row) => row.label) ?? []
    for (const label of labels) {
      expect(WHITELISTED_LABELS, label).toContain(label)
    }
    expect(labels).toEqual(WHITELISTED_LABELS)
    for (const row of failure?.report ?? []) {
      expect(row.value.trim().length).toBeGreaterThan(0)
    }
    const value = (label: string): string =>
      failure?.report.find((row) => row.label === label)?.value ?? ''
    expect(value(t.failure.report.rows)).toBe('2')
    expect(value(t.failure.report.mineCount)).toBe('2')
    expect(value(t.failure.report.density)).toBe('50%')
    expect(value(t.failure.report.difficultyBand)).toBe(t.tokens.bands.starter)
    expect(value(t.failure.report.maxAttempts)).toBe('3')
    expect(value(t.failure.report.seed)).toBe('fixture-seed')
    expect(value(t.failure.report.solverStatuses)).toBe('3 · unique, unknown')
    expect(value(t.failure.report.proofStatus)).toBe(t.tokens.proof.unique)
  })

  it('translates the failure surface', () => {
    const zh = projectSnapshot(failedWithBoard, { locale: 'zh-CN' })
    const headline = zh.status.failure?.headline ?? ''
    expect(headline).not.toBe(t.failure.reasons['time-limit'].headline)
    expect(/[\u4e00-\u9fff]/.test(headline)).toBe(true)
    expect(zh.status.failure?.remedies[0]).toMatch(/[\u4e00-\u9fff]/)
    expect(zh.status.failure?.report.every((row) => row.label === row.label)).toBe(true)
  })

  it('fails closed when a failed state carries no failure diagnostics', () => {
    const broken: GameState = { ...failedWithBoard, failure: null }
    const snapshot = projectSnapshot(broken)
    expect(snapshot.status.status).toBe('failed')
    expect(snapshot.status.failure).toBeNull()
    expect(snapshot.status.hasRound).toBe(true)
    expect(snapshot.board).not.toBeNull()
  })
})

// --------------------------------------------------------------------------------------
// Difficulty
// --------------------------------------------------------------------------------------

describe('difficulty projection', () => {
  const cases: readonly [string, GameDifficulty | null, UiSnapshot['status']['difficulty']][] = [
    [
      'known',
      { status: 'known', band: 'challenging', minimumGuesses: 4 },
      { kind: 'known', band: 'challenging', minimumGuesses: 4, reason: null },
    ],
    ['unknown', { status: 'unknown', reason: 'node-limit' }, { kind: 'unknown', band: null, minimumGuesses: null, reason: 'node-limit' }],
    ['absent', null, { kind: 'absent', band: null, minimumGuesses: null, reason: null }],
  ]
  for (const [name, difficulty, expected] of cases) {
    it(`projects ${name}`, () => {
      const snapshot = projectSnapshot({ ...playing, difficulty })
      expect(snapshot.status.difficulty).toEqual(expected)
    })
  }

  it('never invents a band for an unresolved analysis', () => {
    const unresolved = projectSnapshot({
      ...playing,
      difficulty: { status: 'unknown', reason: 'cancelled' },
    })
    expect(unresolved.status.difficulty.band).toBeNull()
    expect(unresolved.status.difficulty.minimumGuesses).toBeNull()
    expect(unresolved.status.difficulty.reason).toBe('cancelled')
  })
})

// --------------------------------------------------------------------------------------
// Fail-closed line progress
// --------------------------------------------------------------------------------------

describe('line progress', () => {
  it('resolves small lines without the budget guard', () => {
    const snapshot = projectSnapshot(playing)
    const lines = [...(snapshot.board?.rowProgress ?? []), ...(snapshot.board?.columnProgress ?? [])]
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(line.status).toBe('ready')
      // A two-cell line with a single-mine clue has two compatible patterns, both honest.
      expect(line.compatiblePatternCount).toBe(2)
    }
  })

  it('reports an unresolved line rather than a fabricated one when the budget trips', () => {
    let tick = 0
    const now = (): number => {
      tick += 1_000
      return tick
    }
    // `bypassLineCache` so this measures the guard on work that is genuinely new: a
    // rail that was already derived is served from the memo and needs no budget.
    const snapshot = projectSnapshot(playing, {
      now,
      patternBudgetMs: LINE_PATTERN_BUDGET_MS,
      bypassLineCache: true,
    })
    const lines = [...(snapshot.board?.rowProgress ?? []), ...(snapshot.board?.columnProgress ?? [])]
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(line.status).toBe('unknown')
      expect(line.compatiblePatternCount).toBeNull()
      expect(line.contradiction).toBe(false)
      expect(line.complete).toBe(false)
      expect(line.runs.every((run) => run.complete === false)).toBe(true)
    }
    // The board still renders: unresolved progress is not a crash.
    expect(snapshot.board?.cells).toHaveLength(4)
    expect(snapshot.status.status).toBe('playing')
  })

  it('serves an already-derived rail without spending a budget on it', () => {
    // The first projection derived every rail honestly; a tripped clock afterwards
    // cannot un-know them, and re-deriving them would be work for no new information.
    const first = projectSnapshot(playing)
    let tick = 0
    const now = (): number => {
      tick += 1_000
      return tick
    }
    const second = projectSnapshot(playing, { now, patternBudgetMs: LINE_PATTERN_BUDGET_MS })
    // The snapshot itself is a fresh frozen object every call, so the memo is asserted
    // on the rails: the very objects the first derivation returned.
    for (let line = 0; line < 2; line += 1) {
      expect(second.board?.rowProgress?.[line]).toBe(first.board?.rowProgress?.[line])
      expect(second.board?.columnProgress?.[line]).toBe(first.board?.columnProgress?.[line])
    }
    for (const line of [...(second.board?.rowProgress ?? []), ...(second.board?.columnProgress ?? [])]) {
      expect(line.status).toBe('ready')
    }
  })

  it('gives every rail its own budget, so a trip localises instead of cascading', () => {
    // Under one shared guard the rails after the trip were the ones that lost their
    // answer. With a per-rail guard a tripped budget reaches the same verdict for all
    // of them, and the publish still completes.
    const snapshot = projectSnapshot(playing, { patternBudgetMs: 0, bypassLineCache: true })
    const lines = [...(snapshot.board?.rowProgress ?? []), ...(snapshot.board?.columnProgress ?? [])]
    expect(lines).toHaveLength(4)
    for (const line of lines) {
      expect(line.status).toBe('unknown')
    }
    // An exhausted budget is a rendering state, not a generation failure: the round
    // keeps playing and the failure card stays away.
    expect(snapshot.status.status).toBe('playing')
    expect(snapshot.status.failure).toBeNull()
  })

  it('reads the clock a bounded number of times per rail', () => {
    let calls = 0
    const now = (): number => {
      calls += 1
      return calls
    }
    projectSnapshot(playing, { now, bypassLineCache: true })
    // Four rails, one context each: the deadline check, the start, and the guard.
    expect(calls).toBeLessThan(200)
  })
})

// --------------------------------------------------------------------------------------
// The default board, for real
// --------------------------------------------------------------------------------------

/**
 * The regression this pins: a 15x15 / 60% round published with ten of its thirty rails
 * reported `unknown`, which switched off the run and separator completion highlighting
 * the rails exist to draw. The board is produced by the real generator entry point, not
 * a hand-written fixture, because the shape of the clues *is* what the budget has to
 * survive.
 */
function generatedPlaying(seed: string): { state: GameState; board: readonly number[] } {
  const result = generateMinegramPuzzle({
    rows: 15,
    columns: 15,
    densityPercent: 60,
    seed,
    difficulty: 'starter',
    maxAttempts: 8,
  })
  if (result.status !== 'success') {
    throw new Error(`generation failed for ${seed}: ${result.reason}`)
  }
  const generated: GeneratedRound = {
    settings: result.settings,
    board: result.board,
    puzzle: result.puzzle,
    difficulty: result.difficulty,
  }
  const base = createInitialGameState({ settings: result.settings, initialScore: 5 })
  return { state: accept(start(base), generated), board: result.board }
}

function rails(snapshot: UiSnapshot): readonly {
  status: string
  compatiblePatternCount: number | null
}[] {
  return [...(snapshot.board?.rowProgress ?? []), ...(snapshot.board?.columnProgress ?? [])]
}

function mark(state: GameState, index: number, board: readonly number[]): GameState {
  return transition(state, {
    type: 'round/markBatch',
    cells: [{ index, assertion: board[index] === 1 ? 'mine' : 'blank' }],
  })
}

describe('the default 15x15 / 60% board', () => {
  it('reports every rail as ready, and keeps doing so through twenty marks', () => {
    const { state, board } = generatedPlaying('view-model-defaults')
    expect(board).toHaveLength(225)
    expect(board.filter((cell) => cell === 1)).toHaveLength(135)
    // The generator's own contract: every row and column carries a mine.
    for (let line = 0; line < 15; line += 1) {
      expect(board.filter((_, index) => Math.floor(index / 15) === line)).toContain(1)
      expect(board.filter((_, index) => index % 15 === line)).toContain(1)
    }

    let current = state
    const census: number[] = []
    for (let step = 0; step < 21; step += 1) {
      const snapshot = projectSnapshot(current)
      const lines = rails(snapshot)
      expect(lines).toHaveLength(30)
      const unknown = lines.filter((line) => line.status === 'unknown')
      census.push(unknown.length)
      expect(unknown).toEqual([])
      for (const line of lines) {
        expect(line.compatiblePatternCount).not.toBeNull()
      }
      if (step === 20) {
        break
      }
      // A different row and a different column every time, so no single rail is the
      // only thing being re-derived.
      current = mark(current, step * 7 + step * 3, board)
    }
    expect(census).toEqual(new Array(21).fill(0))
  })

  it('returns from the memo exactly what a cold derivation returns', () => {
    const { state, board } = generatedPlaying('view-model-memo-drift')
    let current = state
    for (let step = 0; step < 21; step += 1) {
      const memoised = projectSnapshot(current)
      const cold = projectSnapshot(current, { bypassLineCache: true })
      expect(memoised.board?.rowProgress).toEqual(cold.board?.rowProgress)
      expect(memoised.board?.columnProgress).toEqual(cold.board?.columnProgress)
      if (step === 20) {
        break
      }
      current = mark(current, step * 11 + 2, board)
    }
  })

  it('agrees with the selectors it replaced, rail for rail', () => {
    const { state, board } = generatedPlaying('view-model-selector-drift')
    const current = mark(mark(state, 3, board), 199, board)
    const snapshot = projectSnapshot(current)
    expect(snapshot.board?.rowProgress).toEqual(selectRows(current))
    expect(snapshot.board?.columnProgress).toEqual(selectColumns(current))
  })

  it('reuses a rail whose inputs did not move, and re-derives the ones that did', () => {
    const { state, board } = generatedPlaying('view-model-reuse')
    const before = projectSnapshot(state)
    const after = projectSnapshot(mark(state, 0, board))
    // Marking (0,0) can only move row 0 and column 0.
    expect(after.board?.rowProgress?.[0]).not.toBe(before.board?.rowProgress?.[0])
    expect(after.board?.columnProgress?.[0]).not.toBe(before.board?.columnProgress?.[0])
    for (let line = 1; line < 15; line += 1) {
      expect(after.board?.rowProgress?.[line]).toBe(before.board?.rowProgress?.[line])
      expect(after.board?.columnProgress?.[line]).toBe(before.board?.columnProgress?.[line])
    }
  })

  it('keys the memo on the snapshot schema version', async () => {
    const source = await readModuleSource('viewModel.ts')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    // A memo that outlived the shape it was built for would serve a stale rail.
    expect(code).toMatch(/\$\{SNAPSHOT_SCHEMA_VERSION\}\|\$\{request\.orientation\}/)
    expect(SNAPSHOT_SCHEMA_VERSION).toBeGreaterThanOrEqual(1)
  })
})

// --------------------------------------------------------------------------------------
// Safety of the projection
// --------------------------------------------------------------------------------------

describe('snapshot safety', () => {
  it('exposes no board array, no derived seed and no engine text', () => {
    for (const state of [idle, generating, playing, won, lost, failedWithBoard, failedWithoutBoard, failedAfterWin]) {
      const snapshot = projectSnapshot(state)
      const found = collect(snapshot)
      const boardShaped = found.arrays.filter(
        (entry) => entry.value.length === 4 && entry.value.every((cell) => typeof cell === 'number'),
      )
      expect(boardShaped.map((entry) => entry.path)).toEqual([])
      const seeds = found.strings.filter((entry) => entry.value.includes('round:'))
      expect(seeds.map((entry) => entry.path)).toEqual([])
      expect(found.strings.filter((entry) => entry.value.includes('Minegram')).map((e) => e.value)).toEqual([])
      const cells = snapshot.board?.cells ?? []
      for (const cell of cells) {
        expect([true, false, null]).toContain(cell.correct)
        expect(Object.keys(cell)).toHaveLength(6)
      }
    }
  })

  it('renders only the authored seed and hides a derived one', () => {
    expect(projectSnapshot(playing).status.dimensions?.authoredSeed).toBe('fixture-seed')
    const derived = projectSnapshot(failedAfterWin)
    expect(derived.status.dimensions?.authoredSeed).toBe('')
    expect(collect(derived).strings.filter((entry) => entry.value.includes('round:'))).toEqual([])
    const seedRow = derived.status.failure?.report.find((row) => row.label === t.failure.report.seed)
    const sourceRow = derived.status.failure?.report.find(
      (row) => row.label === t.failure.report.seedSource,
    )
    expect(seedRow?.value).toBe(t.failure.report.seedUnavailable)
    expect(sourceRow?.value).toBe('derived for round 2')
  })

  it('never imports the reducer preview helper', async () => {
    const source = await readModuleSource('viewModel.ts')
    // Comments are allowed to name the helper; code is not allowed to reach for it.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    expect(code).not.toMatch(/previewMarkBatch/)
    expect(code).not.toMatch(/Math\.random/)
    expect(code).not.toMatch(/document\.|window\./)
    expect(code).not.toMatch(/timeBudgetMs/)
    // The helper plus its two call sites: the per-rail budget and the cold seam.
    expect(code.match(/createPatternContext\(/g)).toHaveLength(3)
    expect(source).toMatch(/from '\.\.\/application\/gameSelectors'/)
  })

  it('is frozen all the way down', () => {
    const snapshot = projectSnapshot(failedWithBoard)
    const mutable: string[] = []
    expect(Object.isFrozen(snapshot)).toBe(true)
    expect(Object.isFrozen(snapshot.status)).toBe(true)
    expect(Object.isFrozen(snapshot.status.score)).toBe(true)
    expect(Object.isFrozen(snapshot.status.dimensions)).toBe(true)
    expect(Object.isFrozen(snapshot.status.difficulty)).toBe(true)
    expect(Object.isFrozen(snapshot.status.failure)).toBe(true)
    expect(Object.isFrozen(snapshot.status.failure?.report)).toBe(true)
    expect(Object.isFrozen(snapshot.status.failure?.remedies)).toBe(true)
    expect(Object.isFrozen(snapshot.board)).toBe(true)
    expect(Object.isFrozen(snapshot.board?.cells)).toBe(true)
    expect(Object.isFrozen(snapshot.board?.rowProgress)).toBe(true)
    expect(Object.isFrozen(snapshot.board?.columnProgress)).toBe(true)
    for (const cell of snapshot.board?.cells ?? []) {
      expect(Object.isFrozen(cell)).toBe(true)
    }
    for (const line of snapshot.board?.rowProgress ?? []) {
      expect(Object.isFrozen(line)).toBe(true)
      expect(Object.isFrozen(line.runs)).toBe(true)
    }
    everyObject(snapshot, (value, path) => {
      if (!Object.isFrozen(value)) {
        mutable.push(path)
      }
    })
    expect(mutable).toEqual([])
  })

  it('is pure: two projections of one state are equal and independent', () => {
    const first = projectSnapshot(failedWithBoard)
    const second = projectSnapshot(failedWithBoard)
    expect(first).toEqual(second)
    expect(first).not.toBe(second)
    expect(first.board).not.toBe(second.board)
    expect(first.board?.cells).not.toBe(second.board?.cells)
    expect(failedWithBoard.board).toEqual(board)
    expect(failedWithBoard.marks).toHaveLength(4)
  })
})

// --------------------------------------------------------------------------------------
// Helpers for the store lane
// --------------------------------------------------------------------------------------

describe('projectPreview', () => {
  it('copies a preview and freezes it', () => {
    const indices = [0, 3]
    const view: PreviewView = projectPreview(
      {
        valid: true,
        affectedCount: 2,
        scoreCost: 1,
        projectedScore: 4,
        reachesZero: false,
      },
      indices,
    )
    expect(view).toEqual({
      affectedCount: 2,
      scoreCost: 1,
      projectedScore: 4,
      reachesZero: false,
      cellIndices: [0, 3],
    })
    expect(Object.isFrozen(view)).toBe(true)
    expect(Object.isFrozen(view.cellIndices)).toBe(true)
    indices.push(4)
    expect(view.cellIndices).toEqual([0, 3])
  })

  it('defaults to no cells so a malformed call renders nothing', () => {
    const view = projectPreview({
      valid: false,
      affectedCount: 0,
      scoreCost: 0,
      projectedScore: 5,
      reachesZero: false,
      reason: 'locked-cell',
    })
    expect(view.cellIndices).toEqual([])
    expect(Object.isFrozen(view.cellIndices)).toBe(true)
  })
})

describe('failureClipboardText', () => {
  it('is empty without a failure', () => {
    expect(failureClipboardText(null, failedWithBoard.settings, t)).toBe('')
    expect(failureClipboardText(null, null, t)).toBe('')
  })

  it('reproduces the report for an authored seed', () => {
    const text = failureClipboardText(failedWithBoard.failure, failedWithBoard.settings, t)
    expect(text).toContain(`${t.failure.report.seed}: fixture-seed`)
    expect(text).toContain(`${t.failure.report.rows}: 2`)
    expect(text.split('\n').length).toBe(WHITELISTED_LABELS.length)
  })

  it('is the only place an engine-derived seed appears', () => {
    const derivedSeed = failedAfterWin.settings.seed
    expect(typeof derivedSeed).toBe('number')
    const text = failureClipboardText(failedAfterWin.failure, failedAfterWin.settings, t, true)
    expect(text).toContain(`${t.failure.report.seed}: ${t.failure.report.seedUnavailable}`)
    expect(text).toContain(`${t.failure.report.seedDerived}: ${String(derivedSeed)}`)
    expect(collect(projectSnapshot(failedAfterWin)).strings.filter((e) => e.value.includes('round:'))).toEqual(
      [],
    )
  })
})
