import {
  assertBinaryMineBoard,
  assertBoardDimensions,
  assertBoardHasMineInEveryLine,
  countBoardMines,
  type BinaryCell,
  type BinaryMineBoard,
  type BoardDimensions,
} from '../../domain/board'
import { assertMinegramPuzzle, derivePuzzleClues, type MinegramPuzzle } from '../../domain/puzzle'
import { orderedCluesEqual } from '../../domain/orderedClues'
import { validateSolutionBoard, type SolverResult } from '../solver/constraintSolver'

export type UniqueSolverProof = Extract<SolverResult, { readonly status: 'unique' }>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface GenerationWitness {
  readonly dimensions: BoardDimensions
  readonly mineIndices: readonly number[]
  readonly board: BinaryMineBoard
  readonly puzzle: MinegramPuzzle
  readonly proof: UniqueSolverProof
}

export interface TransactionWitnessSnapshot {
  readonly dimensions: BoardDimensions
  readonly mineIndices: readonly number[]
  readonly board: BinaryMineBoard
  readonly puzzle: MinegramPuzzle
}

export interface TransactionTraceEvent {
  readonly acceptedMineIndices: readonly number[]
  readonly candidateMineIndex: number
  readonly witness: TransactionWitnessSnapshot
  readonly proof: UniqueSolverProof
  readonly proofStatus: 'unique'
  readonly solution: BinaryMineBoard
}

export type WitnessTransactionProbe = (
  candidate: ReadonlySet<number>,
  eventIndex: number,
) => boolean

export interface WitnessTransactionOptions {
  readonly probe?: WitnessTransactionProbe
  readonly mineOrder?: readonly number[]
}

export type TransactionReplayResult =
  | {
      readonly status: 'complete'
      readonly acceptedMineIndices: readonly number[]
      readonly trace: readonly TransactionTraceEvent[]
    }
  | {
      readonly status: 'rolled-back'
      readonly failedMineIndex: number
      readonly reason: 'candidate-rejected'
      readonly acceptedMineIndices: readonly number[]
      readonly trace: readonly TransactionTraceEvent[]
    }

function assertWitnessTransactionOptions(value: unknown): asserts value is WitnessTransactionOptions {
  if (value === undefined) {
    return
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new TypeError('transaction options must be a non-array object')
  }
  const options = value as Record<string, unknown>
  if (options.probe !== undefined && typeof options.probe !== 'function') {
    throw new TypeError('transaction probe must be a function')
  }
  if (options.mineOrder !== undefined && !Array.isArray(options.mineOrder)) {
    throw new TypeError('transaction mine order must be an array')
  }
}

function boardsEqual(left: BinaryMineBoard, right: BinaryMineBoard): boolean {
  if (left.length !== right.length) {
    return false
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false
    }
  }
  return true
}

function freezeDimensions(dimensions: BoardDimensions): BoardDimensions {
  return Object.freeze({ rows: dimensions.rows, columns: dimensions.columns })
}

function snapshotBoard(board: BinaryMineBoard): BinaryMineBoard {
  return Object.freeze([...board])
}

function snapshotPuzzle(puzzle: MinegramPuzzle): MinegramPuzzle {
  return Object.freeze({
    dimensions: freezeDimensions(puzzle.dimensions),
    clues: Object.freeze({
      rowClues: Object.freeze(
        puzzle.clues.rowClues.map((clue) => Object.freeze([...clue])),
      ),
      columnClues: Object.freeze(
        puzzle.clues.columnClues.map((clue) => Object.freeze([...clue])),
      ),
    }),
  })
}

function snapshotProof(proof: UniqueSolverProof): UniqueSolverProof {
  const resource = proof.diagnostics.resource
  return Object.freeze({
    status: 'unique',
    solution: snapshotBoard(proof.solution),
    diagnostics: Object.freeze({
      nodesVisited: proof.diagnostics.nodesVisited,
      solutionsFound: proof.diagnostics.solutionsFound,
      ...(resource === undefined
        ? {}
        : {
            resource: Object.freeze({
              ...resource,
              clue: Object.freeze([...resource.clue]),
            }),
          }),
    }),
  })
}

function snapshotWitness(witness: GenerationWitness): TransactionWitnessSnapshot {
  return Object.freeze({
    dimensions: freezeDimensions(witness.dimensions),
    mineIndices: Object.freeze([...witness.mineIndices]),
    board: snapshotBoard(witness.board),
    puzzle: snapshotPuzzle(witness.puzzle),
  })
}

function assertMineIndices(
  mineIndices: unknown,
  dimensions: BoardDimensions,
  context: string,
): asserts mineIndices is number[] {
  if (!Array.isArray(mineIndices)) {
    throw new TypeError(`${context} must be an array of cell indices`)
  }
  const seen = new Set<number>()
  const cellCount = dimensions.rows * dimensions.columns
  for (let index = 0; index < mineIndices.length; index += 1) {
    const cellIndex = mineIndices[index]
    if (!Number.isSafeInteger(cellIndex) || cellIndex < 0 || cellIndex >= cellCount) {
      throw new RangeError(`${context}[${index}] must be a cell index within the board`)
    }
    if (seen.has(cellIndex)) {
      throw new RangeError(`${context} must not contain duplicate cell index ${cellIndex}`)
    }
    seen.add(cellIndex)
  }
}

/** @internal Validate the complete witness once before transactional replay. */
export function validateGenerationWitness(
  witness: GenerationWitness,
  expectedMineCount?: number,
): void {
  assertBoardDimensions(witness.dimensions, 'generation witness dimensions')
  assertMinegramPuzzle(witness.puzzle, 'generation witness puzzle')
  assertBinaryMineBoard(witness.board, witness.dimensions, 'generation witness board')
  assertMineIndices(witness.mineIndices, witness.dimensions, 'generation witness mine indices')
  if (witness.proof?.status !== 'unique') {
    throw new Error('generation witness proof must have unique status')
  }
  if (
    !isRecord(witness.proof.diagnostics) ||
    !Number.isSafeInteger(witness.proof.diagnostics.nodesVisited) ||
    witness.proof.diagnostics.nodesVisited < 0 ||
    witness.proof.diagnostics.solutionsFound !== 1
  ) {
    throw new Error('generation witness unique proof diagnostics are invalid')
  }
  if (witness.mineIndices.length !== countBoardMines(witness.board, witness.dimensions)) {
    throw new RangeError('generation witness mine indices must exactly represent its board')
  }
  for (const cellIndex of witness.mineIndices) {
    if (witness.board[cellIndex] !== 1) {
      throw new RangeError(
        `generation witness mine index ${cellIndex} must identify a mine in its board`,
      )
    }
  }
  if (
    expectedMineCount !== undefined &&
    witness.mineIndices.length !== expectedMineCount
  ) {
    throw new RangeError('generation witness has the wrong target mine count')
  }
  assertBoardHasMineInEveryLine(witness.board, witness.dimensions, 'generation witness coverage')
  validateSolutionBoard(witness.proof.solution, witness.puzzle)
  if (!boardsEqual(witness.proof.solution, witness.board)) {
    throw new RangeError('generation witness proof solution does not match its board')
  }
  if (
    witness.puzzle.dimensions.rows !== witness.dimensions.rows ||
    witness.puzzle.dimensions.columns !== witness.dimensions.columns
  ) {
    throw new RangeError('generation witness puzzle dimensions do not match its board')
  }
  const derived = derivePuzzleClues(witness.board, witness.dimensions)
  for (let row = 0; row < witness.dimensions.rows; row += 1) {
    if (!orderedCluesEqual(derived.rowClues[row], witness.puzzle.clues.rowClues[row])) {
      throw new RangeError(`generation witness row clue ${row} does not match its board`)
    }
  }
  for (let column = 0; column < witness.dimensions.columns; column += 1) {
    if (!orderedCluesEqual(
      derived.columnClues[column],
      witness.puzzle.clues.columnClues[column],
    )) {
      throw new RangeError(`generation witness column clue ${column} does not match its board`)
    }
  }
}

function snapshotTrace(
  trace: readonly TransactionTraceEvent[],
): readonly TransactionTraceEvent[] {
  return Object.freeze([...trace])
}

/**
 * @internal Replays the witness-guided growth interpretation. A rejected
 * candidate returns a rolled-back snapshot; it never mutates the parent set or
 * trace. Reusing the already-proven complete witness is intentional: every
 * prefix is checked as a subset of the same exact-count, covered, unique witness.
 */
export function replayWitnessTransactions(
  witness: GenerationWitness,
  options?: WitnessTransactionOptions,
): TransactionReplayResult
export function replayWitnessTransactions(
  witness: GenerationWitness,
  probe?: WitnessTransactionProbe,
  mineOrder?: readonly number[],
): TransactionReplayResult
export function replayWitnessTransactions(
  witness: GenerationWitness,
  optionsOrProbe: WitnessTransactionOptions | WitnessTransactionProbe = {},
  legacyMineOrder?: readonly number[],
): TransactionReplayResult {
  const options: WitnessTransactionOptions =
    typeof optionsOrProbe === 'function'
      ? { probe: optionsOrProbe, mineOrder: legacyMineOrder }
      : optionsOrProbe
  assertWitnessTransactionOptions(options)
  validateGenerationWitness(witness)
  const mineOrder = options.mineOrder ?? witness.mineIndices
  assertMineIndices(mineOrder, witness.dimensions, 'transaction mine order')
  if (mineOrder.length !== witness.mineIndices.length) {
    throw new RangeError('transaction mine order must contain every witness mine exactly once')
  }
  const witnessSet = new Set(witness.mineIndices)
  const orderSet = new Set(mineOrder)
  if (witnessSet.size !== orderSet.size) {
    throw new RangeError('transaction mine order must be a permutation of witness mines')
  }
  for (const index of orderSet) {
    if (!witnessSet.has(index)) {
      throw new RangeError('transaction mine order contains a non-witness mine')
    }
  }
  let accepted: readonly number[] = Object.freeze([])
  const trace: TransactionTraceEvent[] = []
  const witnessSnapshot = snapshotWitness(witness)
  const proofSnapshot = snapshotProof(witness.proof)

  for (let eventIndex = 0; eventIndex < mineOrder.length; eventIndex += 1) {
    const candidateMineIndex = mineOrder[eventIndex]
    const candidate = new Set(accepted)
    candidate.add(candidateMineIndex)
    const probeResult = options.probe?.(candidate, eventIndex)
    if (probeResult !== undefined && typeof probeResult !== 'boolean') {
      throw new TypeError('transaction probe must return a boolean')
    }
    const acceptedByProbe = probeResult ?? true
    if (!acceptedByProbe) {
      return Object.freeze({
        status: 'rolled-back',
        failedMineIndex: candidateMineIndex,
        reason: 'candidate-rejected',
        acceptedMineIndices: accepted,
        trace: snapshotTrace(trace),
      })
    }

    const acceptedSnapshot = Object.freeze([...accepted, candidateMineIndex])
    trace.push(
      Object.freeze({
        acceptedMineIndices: acceptedSnapshot,
        candidateMineIndex,
        witness: witnessSnapshot,
        proof: proofSnapshot,
        proofStatus: 'unique',
        solution: proofSnapshot.solution,
      }),
    )
    accepted = acceptedSnapshot
  }

  return Object.freeze({
    status: 'complete',
    acceptedMineIndices: accepted,
    trace: snapshotTrace(trace),
  })
}

export function boardFromMineIndices(
  mineIndices: readonly number[],
  dimensions: BoardDimensions,
): BinaryMineBoard {
  assertBoardDimensions(dimensions, 'mine-index board dimensions')
  assertMineIndices(mineIndices, dimensions, 'mine-index board mine indices')
  const cells: BinaryCell[] = Array.from(
    { length: dimensions.rows * dimensions.columns },
    () => 0,
  )
  for (const index of mineIndices) {
    cells[index] = 1
  }
  const board: BinaryMineBoard = Object.freeze(cells)
  assertBinaryMineBoard(board, dimensions, 'mine-index board')
  return board
}
