/**
 * Solver-independent Star Battle board structure: region adjacency, hubs,
 * region shares and connectivity — the measurement layer behind the
 * hub-free construction gate.
 *
 * Why this module exists (player requirement, 2026-10-07): the human rated
 * our strips+sea boards 「过于简单…大海里面全部都是单个的颜色块」. The
 * measured structural difference between our boards and the four boards the
 * human enjoys is not difficulty — it is topology:
 *
 *  - Our sea construction makes ONE region (the sea) orthogonally adjacent
 *    to EVERY other region at every size and tier — a HUB. Measured on the
 *    human's boards: no hub at all (largest region 25–40%, one board has a
 *    region adjacent to 8 of 9 others — near-hub without being one).
 *  - Our largest region is 39–67% of the board; the human's are 25–40%.
 *
 * So the construction gains a SHAPE GATE: no hub region, and the largest
 * region capped at {@link STAR_SHAPE_MAX_LARGEST_REGION_SHARE}. Everything
 * here is a pure function of the colour grid — no solver, no RNG — which is
 * what makes it usable as an acceptance gate inside deterministic
 * generation.
 *
 * Independence note (load-bearing): connectivity here is counted by UNION-
 * FIND over same-coloured orthogonal neighbour pairs, while the production
 * gates (`construct.ts` `regionsConnected`, `walk.ts`
 * `regionStaysConnectedWithout`) are flood fills. A traversal bug in one
 * implementation cannot hide behind the other; the tests pin agreement on
 * generated boards, and `construct.ts` re-runs both as its final safety
 * net on shaped boards.
 */
import { assertStarBattleSide } from '../../domain/starBattle'

/**
 * The largest-region share ceiling the human's reference boards suggest:
 * their four boards measure 25–40%; ours measured 39–67% with the sea. The
 * gate is `share <= 0.4` (the defect is the excess over this).
 */
export const STAR_SHAPE_MAX_LARGEST_REGION_SHARE = 0.4

/**
 * The measured structure of one colouring: per-colour adjacency degrees,
 * hub detection, region shares, and a union-find component count per
 * colour. `connected` is true iff every colour forms exactly ONE
 * 4-connected component (and every colour is present — a vacated colour
 * reports 0 components and fails the check, which is the conservative
 * answer).
 */
export interface StarBoardStructure {
  /** adjacencyDegrees[c] = number of OTHER colours region c touches orthogonally. */
  readonly adjacencyDegrees: readonly number[]
  /** How many regions touch every other region (degree n - 1). */
  readonly hubCount: number
  /** The hub regions themselves. */
  readonly hubColours: readonly number[]
  /** Largest colour region's share of the board, in (0, 1]. */
  readonly largestRegionShare: number
  /** componentCounts[c] = 4-connected components of colour c (union-find). */
  readonly componentCounts: readonly number[]
  /** True iff every colour is present as exactly one 4-connected component. */
  readonly connected: boolean
}

/**
 * The shape gate applied at acceptance: `noHub` rejects boards where some
 * region touches every other; `maxLargestRegionShare` rejects boards whose
 * biggest region exceeds the share. Either member may be omitted.
 */
export interface StarShapeGate {
  readonly noHub?: boolean
  readonly maxLargestRegionShare?: number
}

/**
 * The measured "structural core" of a colouring: how strongly SOME colour
 * exhibits the strips-and-sea monoculture profile. The five predicates are
 * the measured signature of the construction's absorber region (the sea):
 * it owns a whole line, it is the largest region, it spans nearly every
 * column, it covers a large share of the board, and it touches most of the
 * borders. Boards a human rated interesting score low on this profile
 * (structure.ts module doc: their largest region is 25–40% with no
 * line-owner), so the profile is the shape axis on which the construction
 * is monotone and the human's boards are not.
 *
 * Each predicate is evaluated per colour, existentially for the boolean
 * fields, and `coreScore` is the MAXIMUM over colours of the per-colour
 * predicate count (0..5). The max — not a fixed "dominant colour" — keeps a
 * gradient a fixed choice would erase: a colour that is not the largest can
 * still score 4, and which colour is "the sea" is a board fact, not a
 * parameter. On today's construction boards the sea scores 5; the human's
 * reference boards measure 2–3.
 */
export interface StarStructuralCore {
  /** Some colour owns an entire row or column. */
  readonly lineOwner: boolean
  /** Some colour has the maximum cell count (ties count). */
  readonly largestRegion: boolean
  /** Some colour occupies cells in at least `n − 1` distinct columns. */
  readonly columnSpan: boolean
  /** Some colour covers at least 35% of the board's cells. */
  readonly boardCoverage: boolean
  /** Some colour touches at least 3 of the 4 board borders. */
  readonly borderTouches: boolean
  /** The highest per-colour predicate count, 0..5. */
  readonly coreScore: number
}

/** The column-span predicate allows at most this many unoccupied columns. */
const CORE_MAX_MISSING_COLUMNS = 1

/** The coverage predicate is "covers at least this share of the board". */
const CORE_MIN_COVERAGE = 0.35

/** The border predicate is "touches at least this many of the 4 borders". */
const CORE_MIN_BORDERS = 3

/**
 * Measure the structural core profile of a colouring in one O(n²) pass.
 * Pure and deterministic; safe on any valid colour grid (solvability is
 * not required — this is shape, not difficulty).
 */
export function measureStarStructuralCore(colours: Uint8Array, n: number): StarStructuralCore {
  assertStarBattleSide(n)
  if (colours.length !== n * n) {
    throw new RangeError(`colours must have ${n * n} cells; received ${colours.length}`)
  }

  const counts = new Uint32Array(n)
  const columnMasks = new Uint32Array(n)
  const borderMasks = new Uint8Array(n)
  const wholeLines = new Uint8Array(n) // bit 0: some whole row; bit 1: some whole column
  for (let index = 0; index < n * n; index += 1) {
    const colour = colours[index]
    counts[colour] += 1
    columnMasks[colour] |= 1 << (index % n)
    const row = (index / n) | 0
    if (row === 0) {
      borderMasks[colour] |= 1 // top
    } else if (row === n - 1) {
      borderMasks[colour] |= 2 // bottom
    }
    if (index % n === 0) {
      borderMasks[colour] |= 4 // left
    } else if (index % n === n - 1) {
      borderMasks[colour] |= 8 // right
    }
  }
  let maxCount = 0
  for (let colour = 0; colour < n; colour += 1) {
    if (counts[colour] > maxCount) {
      maxCount = counts[colour]
    }
  }
  // Whole-line ownership: for each row, if every cell shares one colour that
  // colour owns the row; same per column. Two O(n²) scans, no state carried
  // across lines.
  for (let row = 0; row < n; row += 1) {
    const colour = colours[row * n]
    let whole = true
    for (let column = 1; column < n; column += 1) {
      if (colours[row * n + column] !== colour) {
        whole = false
        break
      }
    }
    if (whole) {
      wholeLines[colour] |= 1
    }
  }
  for (let column = 0; column < n; column += 1) {
    const colour = colours[column]
    let whole = true
    for (let row = 1; row < n; row += 1) {
      if (colours[row * n + column] !== colour) {
        whole = false
        break
      }
    }
    if (whole) {
      wholeLines[colour] |= 2
    }
  }

  let lineOwner = false
  let largestRegion = false
  let columnSpan = false
  let boardCoverage = false
  let borderTouches = false
  let coreScore = 0
  for (let colour = 0; colour < n; colour += 1) {
    let score = 0
    const ownsLine = wholeLines[colour] !== 0
    if (ownsLine) {
      lineOwner = true
      score += 1
    }
    if (counts[colour] === maxCount) {
      largestRegion = true
      score += 1
    }
    const occupiedColumns = bitCount32(columnMasks[colour])
    if (n - occupiedColumns <= CORE_MAX_MISSING_COLUMNS) {
      columnSpan = true
      score += 1
    }
    if (counts[colour] / (n * n) >= CORE_MIN_COVERAGE) {
      boardCoverage = true
      score += 1
    }
    if (bitCount32(borderMasks[colour]) >= CORE_MIN_BORDERS) {
      borderTouches = true
      score += 1
    }
    if (score > coreScore) {
      coreScore = score
    }
  }

  return Object.freeze({ lineOwner, largestRegion, columnSpan, boardCoverage, borderTouches, coreScore })
}

/** Population count for the 16-bit masks used above (n ≤ 15, borders ≤ 4 bits). */
function bitCount32(mask: number): number {
  let count = 0
  let value = mask
  while (value !== 0) {
    value &= value - 1
    count += 1
  }
  return count
}

/**
 * Measures the structure of a colouring in one O(n²) pass: a region-size
 * histogram, an adjacency scan over right/down neighbour pairs, and a
 * union-find over same-coloured pairs for the component counts. Pure and
 * deterministic; safe to call on every accepted mutation of a search.
 */
export function measureStarBoardStructure(colours: Uint8Array, n: number): StarBoardStructure {
  assertStarBattleSide(n)
  if (colours.length !== n * n) {
    throw new RangeError(`colours must have ${n * n} cells; received ${colours.length}`)
  }

  const counts = new Uint32Array(n)
  for (let index = 0; index < n * n; index += 1) {
    counts[colours[index]] += 1
  }
  let largest = 0
  for (let colour = 0; colour < n; colour += 1) {
    if (counts[colour] > largest) {
      largest = counts[colour]
    }
  }

  // Adjacency: one right/down scan records every orthogonally touching
  // colour pair. (Touching own colour is ignored.)
  const adjacent: boolean[][] = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const touch = (a: number, b: number): void => {
    if (a !== b) {
      adjacent[a][b] = true
      adjacent[b][a] = true
    }
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column
      if (column + 1 < n) {
        touch(colours[index], colours[index + 1])
      }
      if (row + 1 < n) {
        touch(colours[index], colours[index + n])
      }
    }
  }
  const adjacencyDegrees: number[] = []
  const hubColours: number[] = []
  for (let colour = 0; colour < n; colour += 1) {
    let degree = 0
    for (let other = 0; other < n; other += 1) {
      if (adjacent[colour][other]) {
        degree += 1
      }
    }
    adjacencyDegrees.push(degree)
    if (degree === n - 1) {
      hubColours.push(colour)
    }
  }

  // Connectivity: union-find over same-coloured orthogonal pairs — a
  // DIFFERENT algorithm from the production flood fills, per the module
  // doc. A colour with 0 components is absent; with > 1 it is split; both
  // fail `connected`.
  const parent = new Int32Array(n * n)
  for (let index = 0; index < n * n; index += 1) {
    parent[index] = index
  }
  const find = (value: number): number => {
    let root = value
    while (parent[root] !== root) {
      root = parent[root]
    }
    let walk = value
    while (parent[walk] !== root) {
      const next = parent[walk]
      parent[walk] = root
      walk = next
    }
    return root
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      const index = row * n + column
      if (column + 1 < n && colours[index] === colours[index + 1]) {
        const a = find(index)
        const b = find(index + 1)
        if (a !== b) {
          parent[a] = b
        }
      }
      if (row + 1 < n && colours[index] === colours[index + n]) {
        const a = find(index)
        const b = find(index + n)
        if (a !== b) {
          parent[a] = b
        }
      }
    }
  }
  const rootSets = new Map<number, Set<number>>()
  for (let index = 0; index < n * n; index += 1) {
    const colour = colours[index]
    const set = rootSets.get(colour) ?? new Set<number>()
    set.add(find(index))
    rootSets.set(colour, set)
  }
  const componentCounts = new Array<number>(n).fill(0)
  for (const [colour, roots] of rootSets) {
    componentCounts[colour] = roots.size
  }
  let connected = true
  for (let colour = 0; colour < n; colour += 1) {
    if (componentCounts[colour] !== 1) {
      connected = false
      break
    }
  }

  return Object.freeze({
    adjacencyDegrees: Object.freeze(adjacencyDegrees),
    hubCount: hubColours.length,
    hubColours: Object.freeze(hubColours),
    largestRegionShare: largest / (n * n),
    componentCounts: Object.freeze(componentCounts),
    connected,
  })
}

/**
 * The scalarised shape defect used as a DESCENT signal (not just a gate):
 * the number of hub regions (when `noHub`) plus the largest-share excess
 * over the cap (when set). Zero exactly when the gate is satisfied. The
 * continuous share excess gives the search gradient even while a hub
 * persists, and the integer hub count is the terminal signal — the
 * two-part sum was measured to guide a recolour walk to defect 0 in tens
 * to hundreds of accepted mutations (construct.ts module doc).
 */
export function starShapeDefect(structure: StarBoardStructure, gate: StarShapeGate): number {
  let defect = 0
  if (gate.noHub === true) {
    defect += structure.hubCount
  }
  if (gate.maxLargestRegionShare !== undefined) {
    defect += Math.max(0, structure.largestRegionShare - gate.maxLargestRegionShare)
  }
  return defect
}

/** True iff the gate's every member holds on the measured structure. */
export function starShapeSatisfied(structure: StarBoardStructure, gate: StarShapeGate): boolean {
  return starShapeDefect(structure, gate) === 0
}

/**
 * True iff the region `region` of `colours`, with cell `index` removed,
 * forms at most one non-empty 4-connected component — the per-move
 * connectivity gate shared by the variety walk (`walk.ts`) and the
 * construction shaper (`construct.ts`). A region that keeps its shape minus
 * `index` in one flood fill is safe to vacate. (The gained region cannot
 * split: the move only ever repaints to a neighbour's colour, so the new
 * cell attaches to an existing component.) A vacate that would delete the
 * region entirely (its last cell) is rejected, which is what keeps every
 * colour present on generated boards.
 */
export function regionStaysConnectedWithout(
  colours: Uint8Array,
  n: number,
  index: number,
  region: number,
): boolean {
  let start = -1
  let regionSize = 0
  for (let cell = 0; cell < n * n; cell += 1) {
    if (colours[cell] === region) {
      regionSize += 1
      if (cell !== index && start === -1) {
        start = cell
      }
    }
  }
  // region minus index is empty: vacating would delete the region entirely.
  if (start === -1) {
    return false
  }
  const seen = new Uint8Array(n * n)
  const stack = [start]
  seen[start] = 1
  let reached = 1
  while (stack.length > 0) {
    const cell = stack.pop() as number
    const row = (cell / n) | 0
    const column = cell % n
    const neighbours = [
      row > 0 ? cell - n : -1,
      row + 1 < n ? cell + n : -1,
      column > 0 ? cell - 1 : -1,
      column + 1 < n ? cell + 1 : -1,
    ]
    for (const neighbour of neighbours) {
      if (
        neighbour >= 0 &&
        neighbour !== index &&
        seen[neighbour] === 0 &&
        colours[neighbour] === region
      ) {
        seen[neighbour] = 1
        reached += 1
        stack.push(neighbour)
      }
    }
  }
  return reached === regionSize - 1
}
