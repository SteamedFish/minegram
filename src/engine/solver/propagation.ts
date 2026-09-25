import {
  assertBoardDimensions,
  indexToCoordinate,
  type BinaryCell,
  type BinaryMineBoard,
  type BoardDimensions,
  type Coordinate,
} from '../../domain/board'
import {
  createPatternGenerationStopChecker,
  PatternGenerationInterruptedError,
  throwIfPatternGenerationStopped,
  type PatternGenerationContext,
  type PatternGenerationInterruptionReason,
} from '../../domain/linePatternGeneration'
import { assertMinegramPuzzle, type MinegramPuzzle } from '../../domain/puzzle'
import { getLegalLinePatterns, type LegalLinePattern } from './patterns'

/** Domains contain pattern indices from getLegalLinePatterns for the corresponding line. */
export interface ConstraintDomains {
  readonly rowDomains: readonly (readonly number[])[]
  readonly columnDomains: readonly (readonly number[])[]
}

export interface MutableConstraintDomains {
  readonly rowDomains: number[][]
  readonly columnDomains: number[][]
}

export type PartialMineBoard = readonly (BinaryCell | undefined)[]
export type MutableAssignments = Array<BinaryCell | undefined>

export type PropagationStatus = 'stable' | 'contradiction' | 'stopped'

export interface PropagationResult {
  readonly status: 'stable' | 'contradiction'
  readonly domains: ConstraintDomains
  readonly assignments: PartialMineBoard
  readonly forcedCells: readonly Coordinate[]
}

interface LineConstraint {
  readonly orientation: 'row' | 'column'
  readonly index: number
  readonly cellIndices: readonly number[]
  readonly patterns: readonly LegalLinePattern[]
  readonly domain: number[]
}

interface MutablePropagationOutcome {
  readonly status: PropagationStatus
  readonly stopReason?: PatternGenerationInterruptionReason
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertDomainCollection(
  value: unknown,
  expectedLength: number,
  context: string,
): asserts value is number[][] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array of nonempty pattern-index arrays`)
  }
  if (value.length !== expectedLength) {
    throw new RangeError(
      `${context} must contain exactly ${expectedLength} domains; received ${value.length}`,
    )
  }

  for (let domainIndex = 0; domainIndex < value.length; domainIndex += 1) {
    const domainDescriptor = Object.getOwnPropertyDescriptor(value, domainIndex)
    const domainContext = `${context}[${domainIndex}]`
    if (domainDescriptor === undefined) {
      throw new TypeError(`${domainContext} must be an explicit pattern-index array`)
    }
    if (!Object.hasOwn(domainDescriptor, 'value')) {
      throw new TypeError(`${domainContext} must be a data property`)
    }
    const domain = domainDescriptor.value
    if (!Array.isArray(domain)) {
      throw new TypeError(`${domainContext} must be an array of pattern indices`)
    }
    if (domain.length === 0) {
      throw new RangeError(`${domainContext} must contain at least one pattern index`)
    }
    for (let patternIndex = 0; patternIndex < domain.length; patternIndex += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(domain, patternIndex)
      if (descriptor === undefined) {
        throw new TypeError(
          `${domainContext}[${patternIndex}] must be an explicit pattern index`,
        )
      }
      if (!Object.hasOwn(descriptor, 'value')) {
        throw new TypeError(`${domainContext}[${patternIndex}] must be a data property`)
      }
      const index = descriptor.value
      if (!Number.isSafeInteger(index)) {
        throw new TypeError(
          `${domainContext}[${patternIndex}] must be a safe integer; received ${String(index)}`,
        )
      }
      if (index < 0) {
        throw new RangeError(
          `${domainContext}[${patternIndex}] must be nonnegative; received ${index}`,
        )
      }
    }
  }
}

function assertMutableConstraintDomainsShape(
  puzzle: MinegramPuzzle,
  value: unknown,
): asserts value is MutableConstraintDomains {
  if (!isRecord(value)) {
    throw new TypeError('constraint domains must be a non-array object')
  }
  const rowDomainsDescriptor = Object.getOwnPropertyDescriptor(value, 'rowDomains')
  const columnDomainsDescriptor = Object.getOwnPropertyDescriptor(value, 'columnDomains')
  if (
    rowDomainsDescriptor === undefined ||
    !Object.hasOwn(rowDomainsDescriptor, 'value')
  ) {
    throw new TypeError('constraint domains.rowDomains must be an own data property')
  }
  if (
    columnDomainsDescriptor === undefined ||
    !Object.hasOwn(columnDomainsDescriptor, 'value')
  ) {
    throw new TypeError('constraint domains.columnDomains must be an own data property')
  }
  assertDomainCollection(
    rowDomainsDescriptor.value,
    puzzle.dimensions.rows,
    'constraint domains.rowDomains',
  )
  assertDomainCollection(
    columnDomainsDescriptor.value,
    puzzle.dimensions.columns,
    'constraint domains.columnDomains',
  )
}

function assertLineDomainRange(
  domain: readonly number[],
  patternCount: number,
  context: string,
): void {
  for (let index = 0; index < domain.length; index += 1) {
    const patternIndex = domain[index]
    if (patternIndex >= patternCount) {
      throw new RangeError(
        `${context}[${index}] pattern index must be between 0 and ${patternCount - 1}; received ${patternIndex}`,
      )
    }
  }
}

export function assertPartialMineBoard(
  value: unknown,
  dimensions: BoardDimensions,
  context = 'partial mine board',
): asserts value is PartialMineBoard {
  assertBoardDimensions(dimensions, `${context} dimensions`)
  if (!Array.isArray(value)) {
    throw new TypeError(`${context} must be an array of optional binary cells`)
  }
  const expectedLength = dimensions.rows * dimensions.columns
  if (value.length !== expectedLength) {
    throw new RangeError(
      `${context} must contain exactly ${expectedLength} cells; received ${value.length}`,
    )
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index)
    if (descriptor === undefined) {
      throw new TypeError(
        `${context}[${index}] must be an explicit undefined, 0, or 1 value`,
      )
    }
    if (!Object.hasOwn(descriptor, 'value')) {
      throw new TypeError(`${context}[${index}] must be a data property`)
    }
    const cell = descriptor.value
    if (cell !== undefined && cell !== 0 && cell !== 1) {
      throw new TypeError(
        `${context}[${index}] must be undefined, 0, or 1; received ${String(cell)}`,
      )
    }
  }
}

function assertMutableForPropagation(
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
): void {
  for (const name of ['rowDomains', 'columnDomains'] as const) {
    const descriptor = Object.getOwnPropertyDescriptor(domains, name)
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || descriptor.writable !== true) {
      throw new TypeError(`constraint domains.${name} must be a writable data property`)
    }
  }

  const domainGroups: Array<{ readonly name: string; readonly values: number[][] }> = [
    { name: 'rowDomains', values: domains.rowDomains },
    { name: 'columnDomains', values: domains.columnDomains },
  ]
  for (const group of domainGroups) {
    const groupLength = Object.getOwnPropertyDescriptor(group.values, 'length')
    if (groupLength?.writable !== true) {
      throw new TypeError(`constraint domains.${group.name} must have a writable length`)
    }
    for (let domainIndex = 0; domainIndex < group.values.length; domainIndex += 1) {
      const groupDescriptor = Object.getOwnPropertyDescriptor(group.values, domainIndex)
      if (
        groupDescriptor === undefined ||
        !Object.hasOwn(groupDescriptor, 'value') ||
        !groupDescriptor.writable
      ) {
        throw new TypeError(
          `constraint domains.${group.name}[${domainIndex}] must be a writable data property`,
        )
      }
      const domain = group.values[domainIndex]
      const context = `constraint domain array ${domainIndex}`
      const lengthDescriptor = Object.getOwnPropertyDescriptor(domain, 'length')
      if (lengthDescriptor?.writable !== true) {
        throw new TypeError(`${context} must have a writable length`)
      }
      for (let index = 0; index < domain.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(domain, index)
        if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) {
          throw new TypeError(`${context}[${index}] must be a writable data property`)
        }
      }
    }
  }

  const lengthDescriptor = Object.getOwnPropertyDescriptor(assignments, 'length')
  if (lengthDescriptor?.writable !== true) {
    throw new TypeError('constraint assignments must have a writable length')
  }
  for (let index = 0; index < assignments.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(assignments, index)
    if (descriptor === undefined || !Object.hasOwn(descriptor, 'value') || !descriptor.writable) {
      throw new TypeError(`constraint assignments[${index}] must be a writable data property`)
    }
  }
}

function createLineConstraints(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  context?: PatternGenerationContext,
  validateDomainIndices = true,
): LineConstraint[] {
  const { dimensions, clues } = puzzle
  const lines: LineConstraint[] = []

  for (let row = 0; row < dimensions.rows; row += 1) {
    const cellIndices = Array.from(
      { length: dimensions.columns },
      (_, column) => row * dimensions.columns + column,
    )
    const patterns = getLegalLinePatterns(dimensions.columns, clues.rowClues[row], context)
    if (validateDomainIndices) {
      assertLineDomainRange(domains.rowDomains[row], patterns.length, `row domain ${row}`)
    }
    lines.push({
      orientation: 'row',
      index: row,
      cellIndices,
      patterns,
      domain: domains.rowDomains[row],
    })
  }
  for (let column = 0; column < dimensions.columns; column += 1) {
    const cellIndices = Array.from(
      { length: dimensions.rows },
      (_, row) => row * dimensions.columns + column,
    )
    const patterns = getLegalLinePatterns(dimensions.rows, clues.columnClues[column], context)
    if (validateDomainIndices) {
      assertLineDomainRange(
        domains.columnDomains[column],
        patterns.length,
        `column domain ${column}`,
      )
    }
    lines.push({
      orientation: 'column',
      index: column,
      cellIndices,
      patterns,
      domain: domains.columnDomains[column],
    })
  }

  return lines
}

function assertConstraintDomains(
  puzzle: MinegramPuzzle,
  domains: unknown,
  context?: PatternGenerationContext,
): asserts domains is MutableConstraintDomains {
  assertMinegramPuzzle(puzzle)
  assertMutableConstraintDomainsShape(puzzle, domains)
  const stopChecker = createPatternGenerationStopChecker(context)
  throwIfPatternGenerationStopped(stopChecker)
  const boundContext: PatternGenerationContext | undefined =
    context === undefined
      ? undefined
      : {
          maxPatternCount: context.maxPatternCount,
          maxMaterializedCells: context.maxMaterializedCells,
          shouldStop: stopChecker,
        }
  createLineConstraints(puzzle, domains, boundContext)
  throwIfPatternGenerationStopped(stopChecker)
}

export function createConstraintDomains(
  puzzle: MinegramPuzzle,
  context?: PatternGenerationContext,
): MutableConstraintDomains {
  assertMinegramPuzzle(puzzle)
  const stopChecker = createPatternGenerationStopChecker(context)
  const reason = stopChecker()
  if (reason !== undefined) {
    throw new PatternGenerationInterruptedError(reason)
  }

  // Reuse one checker for the whole domain construction pass. In particular,
  // do not let each line reset a direct enumeration time budget.
  const generationContext: PatternGenerationContext | undefined =
    context === undefined
      ? undefined
      : {
          maxPatternCount: context.maxPatternCount,
          maxMaterializedCells: context.maxMaterializedCells,
          shouldStop: stopChecker,
        }
  const rowDomains = puzzle.clues.rowClues.map((clue) =>
    getLegalLinePatterns(puzzle.dimensions.columns, clue, generationContext).map(
      (_, index) => index,
    ),
  )
  const columnDomains = puzzle.clues.columnClues.map((clue) =>
    getLegalLinePatterns(puzzle.dimensions.rows, clue, generationContext).map(
      (_, index) => index,
    ),
  )
  throwIfPatternGenerationStopped(stopChecker)
  return { rowDomains, columnDomains }
}

export function cloneConstraintDomains(
  domains: MutableConstraintDomains,
  puzzle: MinegramPuzzle,
  context?: PatternGenerationContext,
): MutableConstraintDomains {
  assertConstraintDomains(puzzle, domains, context)
  return {
    rowDomains: domains.rowDomains.map((domain) => [...domain]),
    columnDomains: domains.columnDomains.map((domain) => [...domain]),
  }
}

/** @internal Solver-owned state is cloned without repeating public-input validation. */
export function cloneConstraintDomainsForSearch(
  domains: MutableConstraintDomains,
): MutableConstraintDomains {
  return {
    rowDomains: domains.rowDomains.map((domain) => [...domain]),
    columnDomains: domains.columnDomains.map((domain) => [...domain]),
  }
}

export function cloneAssignments(
  assignments: MutableAssignments,
  dimensions: BoardDimensions,
): MutableAssignments {
  assertPartialMineBoard(assignments, dimensions, 'constraint assignments')
  return [...assignments]
}

function propagateMutableDomainsWithReason(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
  shouldStop?: () => boolean,
  context?: PatternGenerationContext,
  trustedState = false,
): MutablePropagationOutcome {
  assertMinegramPuzzle(puzzle)
  if (!trustedState) {
    if (shouldStop !== undefined && typeof shouldStop !== 'function') {
      throw new TypeError('propagation shouldStop must be a function')
    }
    assertMutableConstraintDomainsShape(puzzle, domains)
    assertPartialMineBoard(assignments, puzzle.dimensions, 'constraint assignments')
    assertMutableForPropagation(domains, assignments)
  }

  const hasStopControl = shouldStop !== undefined || context !== undefined
  const baseStopChecker = hasStopControl
    ? createPatternGenerationStopChecker(context)
    : undefined
  let stopReason: PatternGenerationInterruptionReason | undefined
  const getStopReason = (): PatternGenerationInterruptionReason | undefined => {
    if (shouldStop?.()) {
      stopReason = 'interrupted'
      return stopReason
    }
    stopReason = baseStopChecker?.()
    return stopReason
  }
  const effectiveContext: PatternGenerationContext | undefined = hasStopControl
    ? {
        maxPatternCount: context?.maxPatternCount,
        maxMaterializedCells: context?.maxMaterializedCells,
        shouldStop: getStopReason,
      }
    : undefined

  let lines: LineConstraint[]
  try {
    lines = createLineConstraints(puzzle, domains, effectiveContext, !trustedState)
  } catch (error) {
    if (error instanceof PatternGenerationInterruptedError) {
      stopReason = error.reason
      return { status: 'stopped', stopReason }
    }
    throw error
  }
  while (true) {
    if (getStopReason() !== undefined) {
      return { status: 'stopped', stopReason }
    }

    let changed = false
    for (const line of lines) {
      const filtered: number[] = []
      for (const patternIndex of line.domain) {
        const pattern = line.patterns[patternIndex]
        let matches = true
        for (let position = 0; position < line.cellIndices.length; position += 1) {
          const assigned = assignments[line.cellIndices[position]]
          if (assigned !== undefined && pattern.cells[position] !== assigned) {
            matches = false
            break
          }
        }
        if (matches) {
          filtered.push(patternIndex)
        }
      }

      if (filtered.length === 0) {
        return { status: 'contradiction' }
      }
      if (filtered.length !== line.domain.length) {
        line.domain.splice(0, line.domain.length, ...filtered)
        changed = true
      }
    }

    for (const line of lines) {
      const firstPattern = line.patterns[line.domain[0]]
      for (let position = 0; position < line.cellIndices.length; position += 1) {
        const forcedValue = firstPattern.cells[position]
        let allPatternsAgree = true
        for (const patternIndex of line.domain) {
          if (line.patterns[patternIndex].cells[position] !== forcedValue) {
            allPatternsAgree = false
            break
          }
        }
        if (!allPatternsAgree) {
          continue
        }

        const cellIndex = line.cellIndices[position]
        const currentValue = assignments[cellIndex]
        if (currentValue === undefined) {
          assignments[cellIndex] = forcedValue
          changed = true
        } else if (currentValue !== forcedValue) {
          return { status: 'contradiction' }
        }
      }
    }

    if (!changed) {
      return { status: 'stable' }
    }
  }
}

export function propagateMutableDomains(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
  shouldStop?: () => boolean,
  context?: PatternGenerationContext,
): PropagationStatus {
  return propagateMutableDomainsWithReason(
    puzzle,
    domains,
    assignments,
    shouldStop,
    context,
  ).status
}

/** @internal Only solver-owned domains and assignments may use this fast path. */
export function propagateMutableDomainsForSearch(
  puzzle: MinegramPuzzle,
  domains: MutableConstraintDomains,
  assignments: MutableAssignments,
  shouldStop?: () => boolean,
  context?: PatternGenerationContext,
): PropagationStatus {
  return propagateMutableDomainsWithReason(
    puzzle,
    domains,
    assignments,
    shouldStop,
    context,
    true,
  ).status
}

function freezeDomains(domains: MutableConstraintDomains): ConstraintDomains {
  return Object.freeze({
    rowDomains: Object.freeze(domains.rowDomains.map((domain) => Object.freeze([...domain]))),
    columnDomains: Object.freeze(
      domains.columnDomains.map((domain) => Object.freeze([...domain])),
    ),
  })
}

export function propagateConstraints(
  puzzle: MinegramPuzzle,
  initialAssignments?: PartialMineBoard,
  context?: PatternGenerationContext,
): PropagationResult {
  assertMinegramPuzzle(puzzle)
  const seedAssignments: PartialMineBoard =
    initialAssignments === undefined
      ? Array.from(
          { length: puzzle.dimensions.rows * puzzle.dimensions.columns },
          () => undefined,
        )
      : initialAssignments
  assertPartialMineBoard(seedAssignments, puzzle.dimensions)
  const initial = [...seedAssignments]
  const assignments: MutableAssignments = [...seedAssignments]
  const domains = createConstraintDomains(puzzle, context)
  const propagation = propagateMutableDomainsWithReason(
    puzzle,
    domains,
    assignments,
    undefined,
    context,
  )
  if (propagation.status === 'stopped') {
    throw new PatternGenerationInterruptedError(propagation.stopReason ?? 'interrupted')
  }

  const forcedCells: Coordinate[] = []
  for (let index = 0; index < assignments.length; index += 1) {
    if (initial[index] === undefined && assignments[index] !== undefined) {
      forcedCells.push(indexToCoordinate(index, puzzle.dimensions))
    }
  }

  return Object.freeze({
    status: propagation.status,
    domains: freezeDomains(domains),
    assignments: Object.freeze([...assignments]),
    forcedCells: Object.freeze(forcedCells),
  })
}

export function boardFromAssignments(
  assignments: PartialMineBoard,
  dimensions: BoardDimensions,
): BinaryMineBoard {
  assertPartialMineBoard(assignments, dimensions)
  if (assignments.some((cell) => cell === undefined)) {
    throw new RangeError('cannot create a complete board from partial assignments')
  }
  return Object.freeze(assignments.map((cell) => cell as BinaryCell))
}
