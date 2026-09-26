import { derivePuzzleClues, type MinegramPuzzle } from '../domain'
import { normalizeGenerationSettings } from '../engine/generator/settings'
import { describe, expect, it } from 'vitest'
import { createInitialGameState, gameReducer, type GameState, type GeneratedRound } from './gameReducer'
import { selectCell, selectColumns, selectRows, selectStatus } from './gameSelectors'

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
  seed: 'selector-fixture',
})

function playingState(difficulty?: GeneratedRound['difficulty']): GameState {
  const initial = createInitialGameState({ settings, initialScore: 3 })
  const started = gameReducer(initial, { type: 'generation/start' })
  if (started.type !== 'transition') {
    throw new Error('expected generation to start')
  }
  const succeeded = gameReducer(started.state, {
    type: 'generation/succeeded',
    generationId: started.state.generationId,
    round: difficulty === undefined ? { settings, board, puzzle } : { settings, board, puzzle, difficulty },
  })
  if (succeeded.type !== 'transition') {
    throw new Error('expected generation to succeed')
  }
  return succeeded.state
}

function markAll(state: GameState): GameState {
  const result = gameReducer(state, {
    type: 'round/markBatch',
    cells: [
      { index: 0, assertion: 'mine' },
      { index: 1, assertion: 'blank' },
      { index: 2, assertion: 'blank' },
      { index: 3, assertion: 'mine' },
    ],
  })
  if (result.type !== 'transition') {
    throw new Error('expected marks to apply')
  }
  return result.state
}

describe('game selectors', () => {
  it('exposes a public status view without private board or mark fields', () => {
    const state = playingState()
    const status = selectStatus(state)
    expect(status).toMatchObject({
      status: 'playing',
      round: 1,
      score: 3,
      isGenerating: false,
      generationRound: null,
    })
    expect(Object.keys(status)).not.toContain('board')
    expect(Object.keys(status)).not.toContain('puzzle')
    expect(Object.keys(status)).not.toContain('marks')
  })

  it('exposes the analysed difficulty without solver diagnostics or solution data', () => {
    const known = selectStatus(
      playingState({
        status: 'known',
        minimumGuesses: 4,
        minimum: 4,
        band: 'steady',
        diagnostics: { nodesVisited: 99, statesEvaluated: 20, memoEntries: 8, maxDepth: 5 },
      }),
    )
    expect(known.difficulty).toEqual({ status: 'known', band: 'steady', minimumGuesses: 4 })

    const unknown = selectStatus(
      playingState({
        status: 'unknown',
        reason: 'time-limit',
        diagnostics: { nodesVisited: 1, statesEvaluated: 0, memoEntries: 0, maxDepth: 0 },
      }),
    )
    expect(unknown.difficulty).toEqual({ status: 'unknown', reason: 'time-limit' })

    expect(selectStatus(playingState()).difficulty).toBeNull()
    expect(selectStatus(createInitialGameState()).difficulty).toBeNull()
    const serialized = JSON.stringify(known.difficulty)
    expect(serialized).not.toContain('diagnostics')
    expect(Object.keys(known)).not.toContain('board')
  })

  it('returns safe cell views for unknown, correct, and wrong marks', () => {
    let state = playingState()
    expect(selectCell(state, 0)).toEqual({
      index: 0,
      row: 0,
      column: 0,
      mark: 'unknown',
      locked: false,
      correct: null,
    })
    // The wrong mark has to come first on this 2x2 fixture. Marking the mine at
    // 0 also makes row 0 and column 0 eligible for the auto-reveal, which fills
    // cells 1 and 2 as locked blanks and leaves only the mine at 3 free — so a
    // wrong mark asserted after a correct one is refused as `locked-cell`, not
    // charged. Asserting it first keeps every line ineligible (the wrong mark
    // breaks the row's no-wrong-mark gate and the other lines still hide mines).
    const wrong = gameReducer(state, {
      type: 'round/markBatch',
      cells: [{ index: 1, assertion: 'mine' }],
    })
    if (wrong.type !== 'transition') throw new Error('expected wrong mark')
    expect(selectCell(wrong.state, 1)).toMatchObject({
      mark: 'mine',
      locked: false,
      correct: false,
    })
    expect(selectCell(wrong.state, -1)).toBeNull()

    const correct = gameReducer(wrong.state, {
      type: 'round/markBatch',
      cells: [{ index: 0, assertion: 'mine' }],
    })
    if (correct.type !== 'transition') throw new Error('expected correct mark')
    state = correct.state
    expect(selectCell(state, 0)).toMatchObject({ mark: 'mine', locked: true, correct: true })
  })

  it('derives complete row and column views from a correct full board', () => {
    const state = markAll(playingState())
    const rows = selectRows(state)
    const columns = selectColumns(state)
    expect(rows).toHaveLength(2)
    expect(columns).toHaveLength(2)
    expect(rows.every((row) => row.complete)).toBe(true)
    expect(columns.every((column) => column.complete)).toBe(true)
    expect(rows.map((row) => row.runs.flatMap((run) => run.mineIndices))).toEqual([[0], [1]])
    expect(columns.map((column) => column.runs.flatMap((run) => run.mineIndices))).toEqual([[0], [1]])
  })

  it('propagates bounded pattern failures as unknown line views', () => {
    const rows = selectRows(playingState(), { maxPatternCount: 0 })
    expect(rows.every((row) => row.status === 'unknown')).toBe(true)
    expect(rows.every((row) => row.contradiction === false)).toBe(true)
    expect(rows.every((row) => row.compatiblePatternCount === null)).toBe(true)
  })

  it('returns empty cell and line views before a playable round exists', () => {
    const idle = createInitialGameState()
    expect(selectCell(idle, 0)).toBeNull()
    expect(selectRows(idle)).toEqual([])
    expect(selectColumns(idle)).toEqual([])
    expect(selectStatus(idle).status).toBe('idle')
  })
})
