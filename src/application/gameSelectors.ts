import type { PatternGenerationContext } from '../domain'
import type { GenerationSettings } from '../engine/generator/settings'
import {
  deriveLineProgress,
  type LineProgress,
} from './lineProgress'
import type {
  CellMark,
  GameDifficulty,
  GameFailureDiagnostics,
  GameLifecycle,
  GameState,
} from './gameReducer'

export interface GameStatusView {
  readonly status: GameLifecycle
  readonly score: number
  readonly initialScore: number
  readonly round: number
  readonly settings: GenerationSettings
  readonly generationId: number
  readonly isGenerating: boolean
  readonly generationRound: number | null
  /** Difficulty analysis of the current round; solver diagnostics stay internal. */
  readonly difficulty: GameDifficulty | null
  readonly failure: GameFailureDiagnostics | null
}

export interface GameCellView {
  readonly index: number
  readonly row: number
  readonly column: number
  readonly mark: CellMark
  readonly locked: boolean
  readonly correct: boolean | null
}

function snapshotSettings(settings: GenerationSettings): GenerationSettings {
  return Object.freeze({ ...settings })
}

export function selectStatus(state: GameState): GameStatusView {
  return Object.freeze({
    status: state.status,
    score: state.score,
    initialScore: state.initialScore,
    round: state.round,
    settings: snapshotSettings(state.settings),
    generationId: state.generationId,
    isGenerating: state.pendingGeneration !== null,
    generationRound: state.pendingGeneration?.roundNumber ?? null,
    difficulty: state.difficulty,
    failure: state.failure,
  })
}

export function selectCell(state: GameState, index: number): GameCellView | null {
  if (
    state.board === null ||
    !Number.isSafeInteger(index) ||
    index < 0 ||
    index >= state.board.length
  ) {
    return null
  }
  const mark = state.marks[index]
  return Object.freeze({
    index,
    row: Math.floor(index / state.settings.columns),
    column: index % state.settings.columns,
    mark,
    locked: state.locked[index],
    correct:
      mark === 'unknown'
        ? null
        : state.board[index] === (mark === 'mine' ? 1 : 0),
  })
}

export function selectRows(
  state: GameState,
  patternContext?: PatternGenerationContext,
): readonly LineProgress[] {
  if (state.board === null || state.puzzle === null) {
    return Object.freeze([])
  }
  const { board, puzzle, settings } = state
  return Object.freeze(
    Array.from({ length: settings.rows }, (_, row) => {
      const start = row * settings.columns
      return deriveLineProgress({
        orientation: 'row',
        index: row,
        lineLength: settings.columns,
        clue: puzzle.clues.rowClues[row],
        marks: state.marks.slice(start, start + settings.columns),
        solution: board.slice(start, start + settings.columns) as readonly (0 | 1)[],
        patternContext,
      })
    }),
  )
}

export function selectColumns(
  state: GameState,
  patternContext?: PatternGenerationContext,
): readonly LineProgress[] {
  if (state.board === null || state.puzzle === null) {
    return Object.freeze([])
  }
  const { board, puzzle, settings } = state
  return Object.freeze(
    Array.from({ length: settings.columns }, (_, column) =>
      deriveLineProgress({
        orientation: 'column',
        index: column,
        lineLength: settings.rows,
        clue: puzzle.clues.columnClues[column],
        marks: Array.from(
          { length: settings.rows },
          (_, row) => state.marks[row * settings.columns + column],
        ),
        solution: Array.from(
          { length: settings.rows },
          (_, row) => board[row * settings.columns + column],
        ) as readonly (0 | 1)[],
        patternContext,
      }),
    ),
  )
}
