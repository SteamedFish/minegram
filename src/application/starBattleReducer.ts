/**
 * Star Battle play-state transitions. Mirrors the Minegram gameplay contract
 * (see `src/application/gameReducer.ts`, which this module deliberately does
 * NOT import): correct marks lock and refuse any later assertion, wrong marks
 * cost one point and stay visible so the player can fix them, re-asserting
 * the mark a cell already carries is free, an all-inert batch is silent and
 * charges nothing, score clamps at zero and zero loses, and the single win
 * predicate runs AFTER the batch is applied so the batch that completes the
 * round wins instead of soft-locking it.
 *
 * One deliberate difference from Minegram: there is no auto-reveal. A Star
 * Battle round is complete only when EVERY cell carries a correct mark, and
 * the game never writes marks itself — every mark on the board is the
 * player's, so `roundIsComplete` reads the mark array directly with no
 * reveal pass between the batch and the win gate. Because every one of the
 * n² cells must be asserted, the player can also RETRACT a cell back to
 * unmarked (`'clear'`): a misclick would otherwise make the round
 * permanently unwinnable. Retraction is free, refunds nothing, never locks,
 * and a locked cell refuses it silently — see `StarCellAssertion`.
 */
import {
  STAR_BLANK,
  STAR_LOCKED,
  STAR_STAR,
  STAR_UNMARKED,
  assertStarBattlePuzzle,
  type StarBattlePuzzle,
} from '../domain/starBattle'

export const DEFAULT_STAR_INITIAL_SCORE = 5

export type StarBattleStatus = 'idle' | 'playing' | 'won' | 'lost'
/**
 * The player's assertion vocabulary. `'blank'` and `'star'` place a mark;
 * `'clear'` retracts the cell back to unmarked. `clear` is FREE — it costs no
 * score and refunds nothing, because a retraction is not a new assertion: it
 * follows Minegram's rule that a wrong mark "may be corrected without refund"
 * one step further, letting the player undo the assertion itself. It never
 * writes a mark that is wrong for the solution and it never locks; a locked
 * cell refuses it silently, exactly as it refuses a changed assertion.
 */
export type StarCellAssertion = 'blank' | 'star' | 'clear'

/**
 * Play state. `marks` is a flat array of the domain mark constants with
 * `STAR_LOCKED` written only by the reducer. State objects are frozen and
 * every transition emits a fresh `Uint8Array`; callers must treat the array
 * as read-only (a frozen `Uint8Array` does not freeze its elements, so the
 * discipline is enforced by convention here, exactly as Minegram's frozen
 * mark arrays are).
 */
export interface StarBattleState {
  readonly status: StarBattleStatus
  readonly puzzle: StarBattlePuzzle | null
  readonly marks: Uint8Array
  readonly score: number
  readonly mistakes: number
  readonly streak: number
}

export interface StarCellAssertionInput {
  readonly index: unknown
  readonly mark: unknown
}

export interface InitialStarBattleStateOptions {
  readonly initialScore?: number
}

export type StarBattleAction =
  | { readonly type: 'round/start'; readonly puzzle: StarBattlePuzzle; readonly initialScore?: number }
  | { readonly type: 'round/markBatch'; readonly cells: readonly StarCellAssertionInput[] }

export type StarBattleTransition = 'round-started' | 'marks-applied' | 'round-won' | 'round-lost'

export type StarBattleResultReason =
  | 'round-not-startable'
  | 'invalid-puzzle'
  | 'round-not-playing'
  | 'invalid-batch'
  | 'invalid-cell-index'
  | 'invalid-cell-mark'
  | 'conflicting-assertions'
  | 'locked-cell'
  | 'cell-already-marked'

export type StarBattleReducerResult =
  | { readonly type: 'transition'; readonly transition: StarBattleTransition; readonly state: StarBattleState }
  | { readonly type: 'ignored'; readonly reason: StarBattleResultReason; readonly state: StarBattleState }
  | { readonly type: 'rejected'; readonly reason: StarBattleResultReason; readonly state: StarBattleState }

export interface StarBatchPreview {
  readonly valid: boolean
  /** Cells the commit would actually change; 0 means the gesture is inert. */
  readonly affectedCount: number
  readonly scoreCost: number
  readonly projectedScore: number
  readonly reachesZero: boolean
  readonly reason?: StarBattleResultReason
}

interface PreparedStarAssertion {
  readonly index: number
  readonly mark: StarCellAssertion
}

type PreparedStarBatch =
  | { readonly valid: true; readonly cells: readonly PreparedStarAssertion[] }
  | { readonly valid: false; readonly reason: StarBattleResultReason }

function isStarCellAssertion(value: unknown): value is StarCellAssertion {
  return value === 'blank' || value === 'star' || value === 'clear'
}

function assertInitialStarScore(value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`initialScore must be a positive safe integer; received ${String(value)}`)
  }
}

export function createInitialStarBattleState(options: InitialStarBattleStateOptions = {}): StarBattleState {
  const initialScore = options.initialScore ?? DEFAULT_STAR_INITIAL_SCORE
  assertInitialStarScore(initialScore)
  return Object.freeze({
    status: 'idle',
    puzzle: null,
    marks: new Uint8Array(0),
    score: initialScore,
    mistakes: 0,
    streak: 0,
  })
}

function transition(state: StarBattleState, transitionName: StarBattleTransition): StarBattleReducerResult {
  return Object.freeze({ type: 'transition', transition: transitionName, state })
}

function ignored(state: StarBattleState, reason: StarBattleResultReason): StarBattleReducerResult {
  return Object.freeze({ type: 'ignored', reason, state })
}

function rejected(state: StarBattleState, reason: StarBattleResultReason): StarBattleReducerResult {
  return Object.freeze({ type: 'rejected', reason, state })
}

/**
 * The mark a cell carries once the assertion is applied, while it is still
 * the player's (unlocked): `'blank'`/`'star'` write their mark, `'clear'`
 * writes `STAR_UNMARKED`. Used both for the re-assertion test and for the
 * write itself.
 */
function assertionToMark(assertion: StarCellAssertion): number {
  if (assertion === 'star') {
    return STAR_STAR
  }
  if (assertion === 'blank') {
    return STAR_BLANK
  }
  return STAR_UNMARKED
}

function assertionMatchesPuzzle(puzzle: StarBattlePuzzle, index: number, assertion: StarCellAssertion): boolean {
  const row = Math.floor(index / puzzle.n)
  const column = index % puzzle.n
  const isStar = puzzle.solution[row] === column
  return assertion === 'star' ? isStar : !isStar
}

function prepareStarBatch(state: StarBattleState, value: unknown): PreparedStarBatch {
  if (state.status !== 'playing' || state.puzzle === null) {
    return { valid: false, reason: 'round-not-playing' }
  }
  if (!Array.isArray(value)) {
    return { valid: false, reason: 'invalid-batch' }
  }
  const cells: PreparedStarAssertion[] = []
  const firstMarkByIndex = new Map<number, StarCellAssertion>()
  for (const candidate of value) {
    if (
      typeof candidate !== 'object' ||
      candidate === null ||
      !('index' in candidate) ||
      !('mark' in candidate)
    ) {
      return { valid: false, reason: 'invalid-batch' }
    }
    const { index, mark } = candidate as { readonly index: unknown; readonly mark: unknown }
    if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0 || index >= state.marks.length) {
      return { valid: false, reason: 'invalid-cell-index' }
    }
    if (!isStarCellAssertion(mark)) {
      return { valid: false, reason: 'invalid-cell-mark' }
    }
    const firstMark = firstMarkByIndex.get(index)
    if (firstMark !== undefined) {
      if (firstMark !== mark) {
        return { valid: false, reason: 'conflicting-assertions' }
      }
      continue
    }
    firstMarkByIndex.set(index, mark)
    cells.push(Object.freeze({ index, mark }))
  }
  return { valid: true, cells: Object.freeze(cells) }
}

/**
 * The single win predicate: every cell carries a mark that is correct for the
 * solution. `STAR_LOCKED` always counts (the reducer writes it only on a
 * correct assertion); an unlocked `STAR_STAR`/`STAR_BLANK` counts only when
 * it matches the solution — unreachable in real play, since a correct first
 * assertion locks immediately, but the semantic check keeps the predicate
 * honest if the locking invariant ever breaks. A wrong mark therefore never
 * coexists with a win.
 */
export function roundIsComplete(puzzle: StarBattlePuzzle, marks: Uint8Array): boolean {
  const { n, solution } = puzzle
  if (marks.length !== n * n) {
    return false
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const mark = marks[row * n + column]
      if (mark === STAR_LOCKED) {
        continue
      }
      const isStar = solution[row] === column
      const correct = isStar ? mark === STAR_STAR : mark === STAR_BLANK
      if (!correct) {
        return false
      }
    }
  }
  return true
}

function startStarBattleRound(
  state: StarBattleState,
  puzzle: unknown,
  requestedInitialScore: number | undefined,
): StarBattleReducerResult {
  if (state.status === 'playing') {
    return ignored(state, 'round-not-startable')
  }
  try {
    assertStarBattlePuzzle(puzzle)
  } catch {
    return rejected(state, 'invalid-puzzle')
  }
  const initialScore = requestedInitialScore ?? DEFAULT_STAR_INITIAL_SCORE
  try {
    assertInitialStarScore(initialScore)
  } catch {
    return rejected(state, 'invalid-puzzle')
  }
  // Uniqueness is the generator's contract, not the reducer's gate: the
  // reducer accepts any well-formed puzzle and plays it as given.
  return transition(
    Object.freeze({
      status: 'playing',
      puzzle,
      marks: new Uint8Array(puzzle.n * puzzle.n).fill(STAR_UNMARKED),
      score: initialScore,
      mistakes: 0,
      streak: 0,
    }),
    'round-started',
  )
}

function applyStarMarkBatch(state: StarBattleState, value: unknown): StarBattleReducerResult {
  const prepared = prepareStarBatch(state, value)
  if (!prepared.valid) {
    return rejected(state, prepared.reason)
  }
  if (prepared.cells.length === 0) {
    return ignored(state, 'invalid-batch')
  }
  const puzzle = state.puzzle
  if (puzzle === null) {
    return ignored(state, 'round-not-playing')
  }

  const marks = new Uint8Array(state.marks)
  let score = state.score
  let mistakes = state.mistakes
  let streak = state.streak
  let changed = false
  let sawLockedCell = false

  for (const { index, mark } of prepared.cells) {
    // Strict contract, as in Minegram: re-asserting the mark a cell already
    // carries is free in any batch. Only a different assertion can charge
    // again. For 'clear' this also makes a retract on an already-unmarked
    // cell inert and silent.
    if (marks[index] === assertionToMark(mark)) {
      continue
    }
    if (marks[index] === STAR_LOCKED) {
      // A locked cell's later assertions are refused, not charged — a
      // retraction included: the locked state is information the player has
      // earned and the game does not delete it.
      sawLockedCell = true
      continue
    }
    marks[index] = assertionToMark(mark)
    changed = true
    if (mark === 'clear') {
      // The one write 'clear' performs: back to unmarked. No charge, no
      // refund, no lock, no streak — a retraction is not an assertion about
      // the solution, so it can never be right or wrong for it.
      continue
    }
    if (assertionMatchesPuzzle(puzzle, index, mark)) {
      marks[index] = STAR_LOCKED
      streak += 1
      continue
    }
    // Wrong mark: one point, no lock, the player's mark stays so they can see
    // and fix it. Correcting it later is a fresh first assertion on that
    // value — no refund, and (when the correction is right) no charge.
    score = Math.max(0, score - 1)
    mistakes += 1
    streak = 0
    if (score === 0) {
      return transition(
        Object.freeze({ ...state, status: 'lost', score, marks, mistakes, streak }),
        'round-lost',
      )
    }
  }

  if (!changed) {
    // Nothing was written: an all-identical batch is 'cell-already-marked',
    // an all-locked (or mixed identical+locked) batch is 'locked-cell'. The
    // returned state is the identical object, so an inert gesture charges,
    // mutates and announces nothing.
    if (sawLockedCell) {
      return ignored(state, 'locked-cell')
    }
    return ignored(state, 'cell-already-marked')
  }

  // The win gate runs AFTER the batch is applied. A gate evaluated on the
  // pre-batch marks would soft-lock the round: the batch that marks the last
  // correct cells locks them, and a locked cell accepts no further batch that
  // could re-evaluate the gate.
  const completed = roundIsComplete(puzzle, marks)
  return transition(
    Object.freeze({
      ...state,
      status: completed ? 'won' : state.status,
      score,
      marks,
      mistakes,
      streak,
    }),
    completed ? 'round-won' : 'marks-applied',
  )
}

export function starBattleReducer(state: StarBattleState, action: StarBattleAction): StarBattleReducerResult {
  switch (action.type) {
    case 'round/start':
      return startStarBattleRound(state, action.puzzle, action.initialScore)
    case 'round/markBatch':
      return applyStarMarkBatch(state, action.cells)
  }
}

/**
 * Cost preview for a drag or tap before commit. Mirrors `applyStarMarkBatch`
 * cell-for-cell — an identical assertion is free, a locked cell is skipped —
 * so `affectedCount === 0` is the structural inert-gesture signal: the drag
 * controller can skip dispatch entirely, and the gesture charges, mutates and
 * announces nothing. Never mutates `state`.
 */
export function previewStarMarkBatch(state: StarBattleState, value: unknown): StarBatchPreview {
  const prepared = prepareStarBatch(state, value)
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
  const puzzle = state.puzzle
  if (puzzle === null) {
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
  for (const { index, mark } of prepared.cells) {
    if (state.marks[index] === assertionToMark(mark)) {
      continue
    }
    if (state.marks[index] === STAR_LOCKED) {
      continue
    }
    affectedCount += 1
    if (mark === 'clear') {
      // A retraction previews as affected but never as a cost: it is neither
      // charged nor refunded, so it cannot reach zero either.
      continue
    }
    if (!assertionMatchesPuzzle(puzzle, index, mark)) {
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
