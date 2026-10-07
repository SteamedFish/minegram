/**
 * Star Battle technique catalogue solver: a faithful TypeScript port of the
 * oracle2-lane Python catalogue (`.tmp/oracle2/catalogue.py`), which
 * characterised the richer deduction rules the production
 * {@link propagateStarBoard} solver does not implement.
 *
 * Rule classes (toggleable, for leave-one-out load-bearing fingerprints):
 * - `base` — exclusion (row/col/colour/proximity of placed stars) + hidden
 *   singles in rows/cols/colours. Exactly `propagate.ts` semantics.
 * - `c1`/`c2` — line confinement, ONE technique observed at two widths.
 *   Computed by an uncapped Hall/matching propagator (see below): `c1`
 *   reports deductions whose tight-set certificate spans ONE line ("this
 *   colour is confined to this row"), `c2` reports certificates spanning
 *   TWO OR MORE ("these j colours are confined to these j rows"). Humans
 *   count those as a single idea; only the COUNTING distinguishes them
 *   (see `minimumBasis.ts`), never the mechanism.
 * - `c3` — box confinement: exactly cap(B) starless colours confined to a
 *   small box B (2×2, 2×3, 3×2, 3×3; cap = exact Chebyshev packing):
 *   blank other colours' unknown cells in B.
 * - `c4` — shadow rule: a cell within Chebyshev distance 1 of EVERY
 *   candidate of a starless unit (row/col/colour) cannot host a star of any
 *   other unit: blank it unless it is itself a candidate of that unit.
 * - `cs` — bounded case-splitting: at a stall, tentatively STAR an unknown
 *   cell and run the deduction closure (depth-limited); a genuine
 *   contradiction (dead unit / forced collision) proves the cell blank.
 *   Depth-capped at 1 with a bounded trial budget. Every derived fact is
 *   globally sound, so a closure that places all n stars is a UNIQUENESS
 *   CERTIFICATE.
 *
 * The Hall/matching propagator (2026-10-07, replaces the oracle's
 * `closure_unions`): per axis (rows, cols), build the bipartite graph whose
 * left side is the starless colours, whose right side is the starless lines
 * of that axis, with an edge (colour, line) iff the colour has an unknown
 * cell in the line. Both sides always carry exactly `n - placed` vertices
 * (a placed star consumes one colour and one line of each axis), and every
 * solution induces a perfect matching of this graph (map each starless
 * colour to its star's line — the star cell is one of the colour's
 * unknowns). Therefore:
 * - If NO perfect matching exists, the state is dead: Hall's condition is
 *   violated, so some set of starless colours cannot be assigned distinct
 *   starless lines in ANY completion. The solver flags a contradiction
 *   (sound: the state admits no solution).
 * - If a perfect matching exists, fix one and orient the residual digraph
 *   (non-matching edges left→right, matching edges right→left). An edge
 *   (colour, line) belongs to SOME perfect matching iff its endpoints share
 *   a strongly connected component (Dulmage–Mendelsohn / Régin alldiff
 *   propagation). An edge in NO perfect matching is blanked: the colour's
 *   unknown cells in that line cannot host a star in any solution.
 *   The certificate width of a blanked edge (colour, line) is the number of
 *   starless lines reachable from `line` in the residual digraph — a tight
 *   Hall set (reachable-from-line left vertices vs their line union, equal
 *   cardinality) that consumes those lines; width 1 is reported as `c1`,
 *   width ≥ 2 as `c2`.
 *
 * Why matching and not zone enumeration (the defects it fixes, measured):
 * 1. MONOTONICITY. The oracle's `closure_unions` derived confinement zones
 *    as unions of footprint masks capped at popcount 3, seeded with the
 *    raw footprints. A qualifying zone of j = 4 lines survived only while
 *    some colour's footprint WAS the whole zone; any sound blank shrinking
 *    that footprint made the zone unrepresentable (a popcount-4 union can
 *    never be added — the cap rejects it), so adding `c3`/`c4` could turn
 *    a solved board into a stall. Matching derives deductions from the
 *    candidate graph directly: sound blanking only REMOVES edges, so any
 *    matching that survives was already a matching, and a disallowed edge
 *    stays disallowed. A sound-rules superset can never stall where a
 *    subset solves.
 * 2. THE CAP ITSELF. The popcount ≤ 3 cap silently filed j ≥ 4 multi-colour
 *    confinement as "requires contradiction" — measured at 14 of 109 boards
 *    of the recorded k = -1 population. Matching has no width cap: every
 *    tight Hall set is found, at polynomial cost (O(n³) per axis per wave).
 *
 * Scope note: matching-derived blanks cover starless colours only. A cell
 * of a colour that ALREADY has its star is blanked by `base`'s colour
 * exclusion in the same or the next wave; the old zone rule additionally
 * blanked such cells inside zones, which was sound but redundant — dropping
 * it may add a wave on some boards but never changes what is deducible.
 *
 * Wave semantics (identical to `propagate.ts`): deduction rules compute on
 * the frozen state and apply simultaneously; a wave counts iff it wrote; a
 * case-split pass counts as one wave when it derives at least one fact.
 * Cascading within a wave would collapse the chain into one wave and
 * destroy the depth metric, so it is a bug here exactly as there.
 *
 * Every rule is SOUND: it may only write cells that are blank in EVERY
 * solution consistent with the current state. That property is what makes a
 * full-catalogue solve a uniqueness certificate, so it is correctness-
 * critical, not an optimisation. A budget-exhausted or contradictory run
 * never reports `solved`.
 *
 * Determinism: same input ⇒ identical output. Colours/lines iterate in
 * fixed ascending order; case-split trials iterate unknown cells in
 * ascending index order, stably sorted by colour tightness — never over
 * search-history-dependent order. No rule uses randomness; the optional
 * `rng` in the options exists so a future rule that needs randomness can
 * take a `SeededRandom` without an API change, and is never consumed.
 */
import { assertStarColours } from '../../domain/starBattle'
import type { SeededRandom } from '../rng'

/** The vocabulary of catalogue rule classes. */
export type StarCatalogueRule = 'base' | 'c1' | 'c2' | 'c3' | 'c4' | 'cs'

/** All rule classes, in canonical order. */
export const STAR_CATALOGUE_RULES: readonly StarCatalogueRule[] = [
  'base',
  'c1',
  'c2',
  'c3',
  'c4',
  'cs',
]

/**
 * The deduction-rule subset that matches the oracle's `ALL_RULES`: `base`
 * plus every confinement rule, case-splitting controlled separately by
 * `csDepth`.
 */
export const STAR_CATALOGUE_DEFAULT_RULES: ReadonlySet<StarCatalogueRule> = new Set([
  'base',
  'c1',
  'c2',
  'c3',
  'c4',
])

export interface StarCatalogueOptions {
  /**
   * Enabled rule subset. Any subset of {@link STAR_CATALOGUE_RULES} is
   * accepted; including `'cs'` is equivalent to `csDepth: 1`. The default
   * matches the oracle's `ALL_RULES` (`base` + `c1..c4`). `base` may be
   * disabled, but the oracle always kept it on — it is the frame the other
   * rules hang off — so no recorded fingerprint exercises that combination.
   */
  readonly rules?: ReadonlySet<StarCatalogueRule> | readonly StarCatalogueRule[]
  /**
   * Case-split depth: 0 (no case splitting) or 1 (one assumption level;
   * the oracle measured depth 2 as quadratic and never needed it).
   * Default 0. Values outside {0,1} are rejected.
   */
  readonly csDepth?: 0 | 1
  /**
   * Also try the symmetric blank assumption (a blank at x that contradicts
   * proves a star at x). Default false, matching the oracle.
   */
  readonly csBlank?: boolean
  /**
   * Trial budget for case-splitting; the oracle's rescued boards used at
   * most 91 trials, so the default 400 is generous. Default 400.
   */
  readonly csTrialCap?: number
  /**
   * Reserved for future rules that need randomness; never consumed by any
   * current rule, so different instances must not change the result.
   */
  readonly rng?: SeededRandom
}

export interface StarCatalogueResult {
  /** All n stars placed, no contradiction, no exhausted budget. */
  readonly solved: boolean
  /** Simultaneous sweeps that wrote, plus one per case-split pass that wrote. */
  readonly waves: number
  /** Stars placed when the run stopped. */
  readonly placed: number
  /**
   * The stars the solver placed, as `[row, col]` pairs in row order. The
   * full planted permutation when `solved`, the partial placement otherwise.
   */
  readonly stars: readonly (readonly [row: number, col: number])[]
  /**
   * Rule classes that wrote at least one cell during the run (on the outer
   * state — tentative case-split deductions do not count). This is the
   * "which techniques did this board engage" signal.
   */
  readonly used: ReadonlySet<StarCatalogueRule>
  /** Case-split passes that derived at least one fact. */
  readonly csPasses: number
  /** Assumption cells tested (the cost meter for case-splitting). */
  readonly csTrials: number
  /**
   * The 1-based wave index of the FIRST star the run's closure placed, or 0
   * when the run placed no star at all. Only closure (wave) placements
   * count: stars committed by a case-split pass sit between waves and are
   * reported through `csPasses`, and tentative case-split trials never
   * count (their instrumentation is rolled back with the rest of the
   * tentative run). For `csDepth: 0` runs — the only runs the board
   * signature reads — this is simply "the wave at which the first star was
   * placed".
   */
  readonly firstStarWave: number
  /** `!solved`: nothing about the true solution count follows. */
  readonly stalled: boolean
  /**
   * The final cell marks (0 unknown, 1 blank, 2 star), a copy private to
   * this result. Soundness contract: every blank here is blank in every
   * solution consistent with the state the run started from.
   */
  readonly marks: Uint8Array
}

const UNKNOWN = 0
const BLANK = 1
const STAR = 2

/** Box shapes for c3, in the oracle's evaluation order. */
const BOX_SHAPES: readonly (readonly [height: number, width: number])[] = [
  [2, 2],
  [2, 3],
  [3, 2],
  [3, 3],
]

/**
 * Exact Chebyshev packing capacity of a box: the largest set of cells
 * pairwise at Chebyshev distance > 1 (a direct port of the oracle's brute
 * force). (2,2)→1, (2,3)/(3,2)→2, (3,3)→4.
 */
function boxCap(height: number, width: number): number {
  const cellCount = height * width
  let best = 0
  for (let mask = 1; mask < 1 << cellCount; mask += 1) {
    let size = 0
    for (let a = 0; a < cellCount; a += 1) {
      if ((mask & (1 << a)) !== 0) {
        size += 1
      }
    }
    if (size <= best) {
      continue
    }
    let ok = true
    for (let a = 0; a < cellCount && ok; a += 1) {
      if ((mask & (1 << a)) === 0) {
        continue
      }
      const ar = Math.floor(a / width)
      const ac = a % width
      for (let b = a + 1; b < cellCount; b += 1) {
        if ((mask & (1 << b)) === 0) {
          continue
        }
        const br = Math.floor(b / width)
        const bc = b % width
        if (Math.abs(ar - br) <= 1 && Math.abs(ac - bc) <= 1) {
          ok = false
          break
        }
      }
    }
    if (ok) {
      best = size
    }
  }
  return best
}

const BOX_CAP: ReadonlyMap<string, number> = new Map(
  BOX_SHAPES.map((shape) => [`${shape[0]}x${shape[1]}`, boxCap(shape[0], shape[1])]),
)

/** Mutable per-run counters; tentative case-split runs use scratch copies. */
interface RunCounters {
  waves: number
  used: Set<StarCatalogueRule>
  csPasses: number
  csTrials: number
  /** 1-based wave of the first closure-placed star; 0 = none yet. */
  firstStarWave: number
}

/** A deep copy of the mutable solver state, for snapshot/restore. */
interface Snapshot {
  readonly cells: Uint8Array
  readonly starColumnOfRow: Int16Array
  readonly starRowOfColumn: Int16Array
  readonly starCellOfColour: Int32Array
  readonly placed: number
  readonly contradiction: boolean
}

function intersect(a: ReadonlySet<number>, b: ReadonlySet<number>): Set<number> {
  const out = new Set<number>()
  for (const value of a) {
    if (b.has(value)) {
      out.add(value)
    }
  }
  return out
}

function normalizeRules(
  rules: ReadonlySet<StarCatalogueRule> | readonly StarCatalogueRule[] | undefined,
): Set<StarCatalogueRule> {
  if (rules === undefined) {
    return new Set(STAR_CATALOGUE_DEFAULT_RULES)
  }
  const normalized = new Set<StarCatalogueRule>()
  for (const rule of rules) {
    if (!STAR_CATALOGUE_RULES.includes(rule)) {
      throw new TypeError(`unknown catalogue rule ${String(rule)}`)
    }
    normalized.add(rule)
  }
  return normalized
}

interface ResolvedOptions {
  readonly enabled: ReadonlySet<StarCatalogueRule>
  readonly csDepth: 0 | 1
  readonly csBlank: boolean
  readonly csTrialCap: number
}

function resolveOptions(options: StarCatalogueOptions): ResolvedOptions {
  if (options.csDepth !== undefined && options.csDepth !== 0 && options.csDepth !== 1) {
    throw new RangeError(`csDepth must be 0 or 1; received ${String(options.csDepth)}`)
  }
  const csTrialCap = options.csTrialCap ?? 400
  if (
    typeof csTrialCap !== 'number' ||
    !Number.isSafeInteger(csTrialCap) ||
    csTrialCap <= 0
  ) {
    throw new RangeError(
      `csTrialCap must be a positive safe integer; received ${String(csTrialCap)}`,
    )
  }
  const enabled = normalizeRules(options.rules)
  // 'cs' in the enabled set selects depth 1, mirroring how the oracle
  // treated case-splitting as a separate axis from `enabled`.
  const csDepth = (options.csDepth ?? 0) === 1 || enabled.has('cs') ? 1 : 0
  if (csDepth === 1) {
    enabled.add('cs')
  }
  return { enabled, csDepth, csBlank: options.csBlank ?? false, csTrialCap }
}

/**
 * The port of the oracle's `CatSolver`. One instance per
 * {@link solveStarCatalogue} call: all state is instance-local, so the
 * solver is a pure function of its inputs with no shared mutable state
 * across calls.
 */
class CatalogueSolver {
  private readonly colours: Uint8Array
  private readonly n: number
  private readonly enabled: ReadonlySet<StarCatalogueRule>
  private readonly colourCells: readonly number[][]
  private readonly waveCap: number

  private cells: Uint8Array
  private starColumnOfRow: Int16Array
  private starRowOfColumn: Int16Array
  private starCellOfColour: Int32Array
  private placed = 0
  private contradiction = false

  constructor(colours: Uint8Array, n: number, enabled: ReadonlySet<StarCatalogueRule>) {
    this.colours = colours
    this.n = n
    this.enabled = enabled
    this.cells = new Uint8Array(n * n)
    this.starColumnOfRow = new Int16Array(n).fill(-1)
    this.starRowOfColumn = new Int16Array(n).fill(-1)
    this.starCellOfColour = new Int32Array(n).fill(-1)
    const colourCells: number[][] = []
    for (let colour = 0; colour < n; colour += 1) {
      colourCells.push([])
    }
    for (let index = 0; index < n * n; index += 1) {
      colourCells[colours[index]].push(index)
    }
    this.colourCells = colourCells
    this.waveCap = n * n + 4
  }

  // ---------------------------------------------------------- state io
  private snapshot(): Snapshot {
    return {
      cells: this.cells.slice(),
      starColumnOfRow: this.starColumnOfRow.slice(),
      starRowOfColumn: this.starRowOfColumn.slice(),
      starCellOfColour: this.starCellOfColour.slice(),
      placed: this.placed,
      contradiction: this.contradiction,
    }
  }

  private restore(snap: Snapshot): void {
    // Replace (not mutate) so snapshots stay valid for repeated restores.
    this.cells = snap.cells.slice()
    this.starColumnOfRow = snap.starColumnOfRow.slice()
    this.starRowOfColumn = snap.starRowOfColumn.slice()
    this.starCellOfColour = snap.starCellOfColour.slice()
    this.placed = snap.placed
    this.contradiction = snap.contradiction
  }

  /** Place a star at `index`, assuming its row/col/colour are all free. */
  private placeStar(index: number): void {
    const row = Math.floor(index / this.n)
    const column = index % this.n
    this.cells[index] = STAR
    this.starColumnOfRow[row] = column
    this.starRowOfColumn[column] = row
    this.starCellOfColour[this.colours[index]] = index
    this.placed += 1
  }

  // ---------------------------------------------------------- closure
  /**
   * One wave: compute ALL forced moves on the frozen state, apply them
   * simultaneously, count one wave iff something wrote. Loops until a wave
   * writes nothing (stall), a contradiction stops the board, or the wave
   * cap trips. Never captures `this.cells` across a snapshot/restore.
   */
  private closure(counters: RunCounters): void {
    const { n, colours } = this
    const enabled = this.enabled
    while (this.placed < n && !this.contradiction && counters.waves < this.waveCap) {
      const cells = this.cells
      const blanks: number[] = []
      const usedWave = new Set<StarCatalogueRule>()

      // --- base exclusions -------------------------------------------------
      if (enabled.has('base')) {
        for (let row = 0; row < n; row += 1) {
          const column = this.starColumnOfRow[row]
          if (column === -1) {
            continue
          }
          const base = row * n
          for (let c = 0; c < n; c += 1) {
            if (cells[base + c] === UNKNOWN) {
              blanks.push(base + c)
            }
          }
          for (let r = 0; r < n; r += 1) {
            const index = r * n + column
            if (cells[index] === UNKNOWN) {
              blanks.push(index)
            }
          }
          for (let dr = -1; dr <= 1; dr += 1) {
            const nearRow = row + dr
            if (nearRow < 0 || nearRow >= n) {
              continue
            }
            for (let dc = -1; dc <= 1; dc += 1) {
              const nearColumn = column + dc
              if (nearColumn < 0 || nearColumn >= n) {
                continue
              }
              const index = nearRow * n + nearColumn
              if (cells[index] === UNKNOWN) {
                blanks.push(index)
              }
            }
          }
          for (const index of this.colourCells[colours[row * n + column]]) {
            if (cells[index] === UNKNOWN) {
              blanks.push(index)
            }
          }
        }
        if (blanks.length > 0) {
          usedWave.add('base')
        }
      }

      // --- candidate sets of starless colours (ascending colour order) -----
      const confined: number[][] = []
      for (let k = 0; k < n; k += 1) {
        if (this.starCellOfColour[k] !== -1) {
          continue
        }
        const unknowns: number[] = []
        for (const index of this.colourCells[k]) {
          if (cells[index] === UNKNOWN) {
            unknowns.push(index)
          }
        }
        if (unknowns.length > 0) {
          confined.push(unknowns)
        }
      }

      // --- c1/c2: line confinement via Hall/matching -----------------------
      // One mechanism, two observed widths: `c1` reports deductions whose
      // tight-set certificate spans one line, `c2` spans two or more. Runs
      // when EITHER rule id is enabled — the ids name widths of the same
      // idea, so a run never restricts itself to one width class (see
      // module doc). Monotonic by construction: sound blanking only removes
      // graph edges, so disallowed edges stay disallowed.
      if (enabled.has('c1') || enabled.has('c2')) {
        let starlessRowsMask = 0
        let starlessColsMask = 0
        for (let r = 0; r < n; r += 1) {
          if (this.starColumnOfRow[r] === -1) {
            starlessRowsMask |= 1 << r
          }
          if (this.starRowOfColumn[r] === -1) {
            starlessColsMask |= 1 << r
          }
        }
        for (const axis of ['row', 'col'] as const) {
          const starlessMask =
            axis === 'row' ? starlessRowsMask : starlessColsMask
          // Left vertices: starless colours, in ascending order (confined
          // is already ascending and starless-with-unknowns; a starless
          // colour with zero unknowns is dead and simply has no edges,
          // which the matching reports as unsaturated below).
          // Edge (colour, line): the colour has an unknown cell in the
          // starless line `line`.
          const lineMaskOf = (unknowns: readonly number[]): number => {
            let mask = 0
            for (const index of unknowns) {
              mask |=
                1 << (axis === 'row' ? Math.floor(index / n) : index % n)
            }
            return mask & starlessMask
          }
          // Kuhn augmenting-path matching: matchLine[line] = colour.
          const matchLine = new Int16Array(n).fill(-1)
          const seenLine = new Uint8Array(n)
          const tryAugment = (colourIndex: number, edgeMask: number): boolean => {
            for (let line = 0; line < n; line += 1) {
              if ((edgeMask & (1 << line)) === 0 || seenLine[line] === 1) {
                continue
              }
              seenLine[line] = 1
              if (matchLine[line] === -1 || tryAugment(matchLine[line], edgeMasks[matchLine[line]])) {
                matchLine[line] = colourIndex
                return true
              }
            }
            return false
          }
          const edgeMasks: number[] = confined.map((unknowns) => lineMaskOf(unknowns))
          let perfect = true
          for (let c = 0; c < confined.length; c += 1) {
            seenLine.fill(0)
            if (edgeMasks[c] !== 0 && !tryAugment(c, edgeMasks[c])) {
              perfect = false
              break
            }
            if (edgeMasks[c] === 0) {
              // A starless colour with no starless-line candidates can
              // never be matched: the state is dead.
              perfect = false
              break
            }
          }
          if (perfect) {
            for (let line = 0; line < n; line += 1) {
              if ((starlessMask & (1 << line)) !== 0 && matchLine[line] === -1) {
                perfect = false
                break
              }
            }
          }
          if (!perfect) {
            // Hall violation: the starless colours cannot all be assigned
            // distinct starless lines in any completion. Sound: the state
            // admits no solution. The apply phase still lands this wave's
            // (sound) blanks and demands; the loop exits on the flag.
            this.contradiction = true
            continue
          }
          // Residual digraph for the Dulmage–Mendelsohn / Régin criterion:
          // non-matching edges run colour→line, matching edges line→colour.
          // Vertices: 0..n-1 = colours (left), n..2n-1 = lines (right).
          const adjacency: number[][] = []
          for (let v = 0; v < 2 * n; v += 1) {
            adjacency.push([])
          }
          for (let c = 0; c < confined.length; c += 1) {
            let mask = edgeMasks[c]
            while (mask !== 0) {
              const line = Math.floor(Math.log2(mask & -mask))
              mask &= mask - 1
              if (matchLine[line] === c) {
                adjacency[n + line].push(c)
              } else {
                adjacency[c].push(n + line)
              }
            }
          }
          // Tarjan SCC (iterative), fixed vertex order for determinism.
          const indexOf = new Int32Array(2 * n).fill(-1)
          const lowlink = new Int32Array(2 * n)
          const onStack = new Uint8Array(2 * n)
          const stack: number[] = []
          let counter = 0
          let sccCount = 0
          const sccOf = new Int32Array(2 * n).fill(-1)
          for (let root = 0; root < 2 * n; root += 1) {
            if (indexOf[root] !== -1) {
              continue
            }
            const callStack: number[] = [root]
            indexOf[root] = lowlink[root] = counter
            counter += 1
            stack.push(root)
            onStack[root] = 1
            while (callStack.length > 0) {
              const v = callStack[callStack.length - 1]
              let descended = false
              const edges = adjacency[v]
              for (let i = 0; i < edges.length; i += 1) {
                const w = edges[i]
                if (indexOf[w] === -1) {
                  indexOf[w] = lowlink[w] = counter
                  counter += 1
                  stack.push(w)
                  onStack[w] = 1
                  callStack.push(w)
                  descended = true
                  break
                }
                if (onStack[w] === 1 && indexOf[w] < lowlink[v]) {
                  lowlink[v] = indexOf[w]
                }
              }
              if (descended) {
                continue
              }
              if (lowlink[v] === indexOf[v]) {
                for (;;) {
                  const w = stack.pop() as number
                  onStack[w] = 0
                  sccOf[w] = sccCount
                  if (w === v) {
                    break
                  }
                }
                sccCount += 1
              }
              callStack.pop()
              if (callStack.length > 0) {
                const parent = callStack[callStack.length - 1]
                if (lowlink[v] < lowlink[parent]) {
                  lowlink[parent] = lowlink[v]
                }
              }
            }
          }
          // Certificate width per line: number of starless lines reachable
          // from the line vertex in the residual digraph (including the
          // line itself). Reachable-from-line left vertices vs that line
          // union form a tight Hall set (see module doc).
          const widthOf = new Int16Array(n).fill(0)
          for (let line = 0; line < n; line += 1) {
            if ((starlessMask & (1 << line)) === 0) {
              continue
            }
            const visited = new Uint8Array(2 * n)
            const queue = [n + line]
            visited[n + line] = 1
            let width = 0
            for (let head = 0; head < queue.length; head += 1) {
              const v = queue[head]
              if (v >= n) {
                width += 1
              }
              for (const w of adjacency[v]) {
                if (visited[w] === 0) {
                  visited[w] = 1
                  queue.push(w)
                }
              }
            }
            widthOf[line] = width
          }
          // Blank every edge that belongs to NO perfect matching.
          for (let c = 0; c < confined.length; c += 1) {
            let mask = edgeMasks[c]
            while (mask !== 0) {
              const line = Math.floor(Math.log2(mask & -mask))
              mask &= mask - 1
              if (matchLine[line] === c) {
                continue
              }
              if (sccOf[c] === sccOf[n + line]) {
                continue
              }
              const rule: StarCatalogueRule = widthOf[line] === 1 ? 'c1' : 'c2'
              let wrote = false
              const memberUnknowns = confined[c]
              for (const index of memberUnknowns) {
                const cellLine = axis === 'row' ? Math.floor(index / n) : index % n
                if (cellLine === line && cells[index] === UNKNOWN) {
                  blanks.push(index)
                  wrote = true
                }
              }
              if (wrote) {
                usedWave.add(rule)
              }
            }
          }
        }
      }

      // --- c3: box confinement ------------------------------------------------
      if (enabled.has('c3')) {
        for (const [height, width] of BOX_SHAPES) {
          const cap = BOX_CAP.get(`${height}x${width}`)
          if (cap === undefined || height > n || width > n) {
            continue
          }
          for (let r0 = 0; r0 <= n - height; r0 += 1) {
            for (let c0 = 0; c0 <= n - width; c0 += 1) {
              const r1 = r0 + height
              const c1 = c0 + width
              const memberColours = new Set<number>()
              let memberCount = 0
              for (const unknowns of confined) {
                let inside = true
                for (const index of unknowns) {
                  const r = Math.floor(index / n)
                  const c = index % n
                  if (r < r0 || r >= r1 || c < c0 || c >= c1) {
                    inside = false
                    break
                  }
                }
                if (inside) {
                  memberCount += 1
                  memberColours.add(colours[unknowns[0]])
                }
              }
              if (memberCount !== cap) {
                continue
              }
              let wrote = false
              for (let r = r0; r < r1; r += 1) {
                for (let c = c0; c < c1; c += 1) {
                  const index = r * n + c
                  if (cells[index] === UNKNOWN && !memberColours.has(colours[index])) {
                    blanks.push(index)
                    wrote = true
                  }
                }
              }
              if (wrote) {
                usedWave.add('c3')
              }
            }
          }
        }
      }

      // --- c4: shadow ----------------------------------------------------------
      if (enabled.has('c4')) {
        const units: number[][] = confined.map((unknowns) => [...unknowns])
        for (let row = 0; row < n; row += 1) {
          if (this.starColumnOfRow[row] === -1) {
            const unit: number[] = []
            for (let c = 0; c < n; c += 1) {
              if (cells[row * n + c] === UNKNOWN) {
                unit.push(row * n + c)
              }
            }
            units.push(unit)
          }
        }
        for (let column = 0; column < n; column += 1) {
          if (this.starRowOfColumn[column] === -1) {
            const unit: number[] = []
            for (let row = 0; row < n; row += 1) {
              if (cells[row * n + column] === UNKNOWN) {
                unit.push(row * n + column)
              }
            }
            units.push(unit)
          }
        }
        for (const unit of units) {
          if (unit.length < 2) {
            continue
          }
          let shadow: Set<number> | null = null
          for (const p of unit) {
            const pr = Math.floor(p / n)
            const pc = p % n
            const nb = new Set<number>()
            for (let dr = -1; dr <= 1; dr += 1) {
              for (let dc = -1; dc <= 1; dc += 1) {
                const nr = pr + dr
                const nc = pc + dc
                if (nr >= 0 && nr < n && nc >= 0 && nc < n) {
                  nb.add(nr * n + nc)
                }
              }
            }
            shadow = shadow === null ? nb : intersect(shadow, nb)
            if (shadow.size === 0) {
              break
            }
          }
          if (shadow === null || shadow.size === 0) {
            continue
          }
          const unitSet = new Set(unit)
          let wrote = false
          for (const index of shadow) {
            if (!unitSet.has(index) && cells[index] === UNKNOWN) {
              blanks.push(index)
              wrote = true
            }
          }
          if (wrote) {
            usedWave.add('c4')
          }
        }
      }

      // --- hidden singles (frozen state) --------------------------------------
      const demands: number[] = []
      let deadUnit = false
      if (enabled.has('base')) {
        const scanUnit = (indices: readonly number[]): void => {
          let hasStar = false
          let candidate = -1
          let count = 0
          for (const index of indices) {
            if (cells[index] === STAR) {
              hasStar = true
              break
            }
            if (cells[index] === UNKNOWN) {
              count += 1
              if (count > 1) {
                break
              }
              candidate = index
            }
          }
          if (hasStar) {
            return
          }
          if (count === 0) {
            deadUnit = true
          } else if (count === 1) {
            demands.push(candidate)
          }
        }
        for (let row = 0; row < n; row += 1) {
          const indices: number[] = []
          for (let column = 0; column < n; column += 1) {
            indices.push(row * n + column)
          }
          scanUnit(indices)
        }
        for (let column = 0; column < n; column += 1) {
          const indices: number[] = []
          for (let row = 0; row < n; row += 1) {
            indices.push(row * n + column)
          }
          scanUnit(indices)
        }
        for (let colour = 0; colour < n; colour += 1) {
          scanUnit(this.colourCells[colour])
        }
        if (demands.length > 0) {
          usedWave.add('base')
        }
      }

      if (blanks.length === 0 && demands.length === 0) {
        return
      }

      // --- simultaneous apply --------------------------------------------------
      for (const index of blanks) {
        if (cells[index] === UNKNOWN) {
          cells[index] = BLANK
        }
      }
      const seenDemands = new Set<number>()
      for (const index of demands) {
        if (seenDemands.has(index)) {
          continue
        }
        seenDemands.add(index)
        const row = Math.floor(index / n)
        const column = index % n
        const colour = colours[index]
        let proximate = false
        for (let nearRow = 0; nearRow < n && !proximate; nearRow += 1) {
          const nearColumn = this.starColumnOfRow[nearRow]
          if (
            nearColumn !== -1 &&
            Math.abs(nearRow - row) <= 1 &&
            Math.abs(nearColumn - column) <= 1
          ) {
            proximate = true
          }
        }
        if (
          cells[index] !== UNKNOWN ||
          this.starColumnOfRow[row] !== -1 ||
          this.starRowOfColumn[column] !== -1 ||
          this.starCellOfColour[colour] !== -1 ||
          proximate
        ) {
          this.contradiction = true
          return
        }
        if (counters.firstStarWave === 0) {
          // The wave that writes counts only after the apply (counters.waves
          // increments below), so the current wave is waves + 1.
          counters.firstStarWave = counters.waves + 1
        }
        this.placeStar(index)
      }
      if (deadUnit) {
        this.contradiction = true
        return
      }
      counters.waves += 1
      for (const rule of usedWave) {
        counters.used.add(rule)
      }
    }
  }

  // ---------------------------------------------------------- case split
  /**
   * Port of the oracle's `solve`: run the closure, then bounded case-split
   * passes while stalled. `depth` is 0 or 1 (the public API caps it at 1).
   */
  solve(counters: RunCounters, depth: number, csBlank: boolean, csTrialCap: number): void {
    this.closure(counters)
    const { n } = this
    while (
      this.placed < n &&
      !this.contradiction &&
      depth >= 1 &&
      counters.csTrials < csTrialCap
    ) {
      const unknowns: number[] = []
      for (let index = 0; index < n * n; index += 1) {
        if (this.cells[index] === UNKNOWN) {
          unknowns.push(index)
        }
      }
      if (unknowns.length === 0) {
        break
      }
      // Trial order: ascending index, stably sorted by colour tightness
      // (fewer remaining candidates first), matching the oracle.
      const tightness = new Map<number, number>()
      for (const index of unknowns) {
        let count = 0
        for (const j of this.colourCells[this.colours[index]]) {
          if (this.cells[j] === UNKNOWN) {
            count += 1
          }
        }
        tightness.set(index, count)
      }
      unknowns.sort((a, b) => (tightness.get(a) ?? 0) - (tightness.get(b) ?? 0))

      let wrote = false
      for (const x of unknowns) {
        if (this.cells[x] !== UNKNOWN) {
          continue
        }
        if (counters.csTrials >= csTrialCap) {
          break
        }
        counters.csTrials += 1
        // Assume a star at x.
        const snap = this.snapshot()
        let innerContra = false
        const xr = Math.floor(x / n)
        const xc = x % n
        if (
          this.starColumnOfRow[xr] === -1 &&
          this.starRowOfColumn[xc] === -1 &&
          this.starCellOfColour[this.colours[x]] === -1
        ) {
          this.placeStar(x)
          innerContra = this.solveInner(counters, depth - 1)
        }
        this.restore(snap)
        if (innerContra) {
          this.cells[x] = BLANK
          wrote = true
          counters.used.add('cs')
          continue
        }
        if (csBlank) {
          counters.csTrials += 1
          const blankSnap = this.snapshot()
          this.cells[x] = BLANK
          const blankContra = this.solveInner(counters, depth - 1)
          this.restore(blankSnap)
          if (blankContra) {
            const row = Math.floor(x / n)
            const column = x % n
            if (
              this.starColumnOfRow[row] === -1 &&
              this.starRowOfColumn[column] === -1 &&
              this.starCellOfColour[this.colours[x]] === -1
            ) {
              this.placeStar(x)
              wrote = true
              counters.used.add('cs')
            }
          }
        }
      }
      if (!wrote) {
        break
      }
      counters.csPasses += 1
      counters.waves += 1
      this.closure(counters)
    }
  }

  /**
   * Port of the oracle's `solve_inner`: run the closure (plus deeper
   * case-splits) on the current tentative state and report whether a
   * genuine contradiction arises. Tentative deductions must not count
   * toward the board's waves/used rules, so those counters are saved and
   * restored around the whole inner run (the csPasses/csTrials counters
   * are never touched by an inner run).
   */
  private solveInner(counters: RunCounters, depth: number): boolean {
    const outerUsed = counters.used
    const savedWaves = counters.waves
    const savedFirstStarWave = counters.firstStarWave
    counters.used = new Set()
    const contra = this.closureInner(counters, depth)
    counters.used = outerUsed
    counters.waves = savedWaves
    counters.firstStarWave = savedFirstStarWave
    return contra
  }

  /**
   * Port of the oracle's `closure_inner`. The `depth >= 1` branch (one
   * nested assumption level) is unreachable through the public API, which
   * caps `csDepth` at 1 — it is kept so this method is a complete port of
   * the oracle's logic.
   */
  private closureInner(counters: RunCounters, depth: number): boolean {
    this.closure(counters)
    if (this.contradiction) {
      return true
    }
    if (this.placed === this.n) {
      return false
    }
    if (depth >= 1) {
      const { n } = this
      const unknowns: number[] = []
      for (let index = 0; index < n * n; index += 1) {
        if (this.cells[index] === UNKNOWN) {
          unknowns.push(index)
        }
      }
      for (const x of unknowns) {
        if (this.cells[x] !== UNKNOWN) {
          continue
        }
        const snap = this.snapshot()
        const xr = Math.floor(x / n)
        const xc = x % n
        if (
          this.starColumnOfRow[xr] === -1 &&
          this.starRowOfColumn[xc] === -1 &&
          this.starCellOfColour[this.colours[x]] === -1
        ) {
          this.placeStar(x)
          this.closure(counters)
        }
        const innerContra = this.contradiction
        this.restore(snap)
        if (innerContra) {
          this.cells[x] = BLANK
          this.closure(counters)
          break
        }
      }
    }
    return this.contradiction
  }

  buildResult(counters: RunCounters): StarCatalogueResult {
    const solved = this.placed === this.n && !this.contradiction
    const stars: (readonly [number, number])[] = []
    for (let row = 0; row < this.n; row += 1) {
      if (this.starColumnOfRow[row] !== -1) {
        stars.push(Object.freeze([row, this.starColumnOfRow[row]] as const))
      }
    }
    return Object.freeze({
      solved,
      waves: counters.waves,
      placed: this.placed,
      stars: Object.freeze(stars),
      used: Object.freeze(new Set(counters.used)) as ReadonlySet<StarCatalogueRule>,
      csPasses: counters.csPasses,
      csTrials: counters.csTrials,
      firstStarWave: counters.firstStarWave,
      stalled: !solved,
      marks: this.cells.slice(),
    })
  }
}

/**
 * Solve a Star Battle board with the technique catalogue.
 *
 * What a caller may conclude:
 * - `solved === true` — every rule is sound and the solver never guesses,
 *   so a full placement is a uniqueness certificate: the board has exactly
 *   one solution and `stars` is it. Cross-check with
 *   `countStarSolutions` when the certificate needs independent evidence.
 * - `solved === false` — nothing about the true solution count; the rule
 *   subset simply stalled (or the trial budget ran out). A budget-exhausted
 *   result is a failure, never "unique".
 */
export function solveStarCatalogue(
  colours: Uint8Array,
  n: number,
  options: StarCatalogueOptions = {},
): StarCatalogueResult {
  assertStarColours(colours, n)
  const resolved = resolveOptions(options)
  const solver = new CatalogueSolver(colours, n, resolved.enabled)
  const counters: RunCounters = {
    waves: 0,
    used: new Set(),
    csPasses: 0,
    csTrials: 0,
    firstStarWave: 0,
  }
  solver.solve(counters, resolved.csDepth, resolved.csBlank, resolved.csTrialCap)
  return solver.buildResult(counters)
}

/**
 * Load-bearing technique set: rule classes whose removal stalls the solve,
 * plus `cs` when depth-0 (no case-splitting) fails. Returns `null` if the
 * board is not solvable with the selected catalogue. This is the signal a
 * difficulty grader builds on: `used` in {@link StarCatalogueResult} says
 * which techniques a solve engaged, this says which techniques the board
 * genuinely REQUIRED.
 *
 * Leave-one-out unit is the IDEA, not the rule id (2026-10-07): `c1` and
 * `c2` are two widths of the same line-confinement mechanism (see module
 * doc), so removing the idea disables BOTH ids at once; when the idea is
 * load-bearing BOTH ids are reported. `c3`/`c4` are genuinely distinct
 * techniques and stay individual. `base` is always on — it is the frame,
 * not a technique — and `cs` is tested via a depth-0 run.
 */
export function fingerprintStarCatalogue(
  colours: Uint8Array,
  n: number,
  options: StarCatalogueOptions = {},
): ReadonlySet<StarCatalogueRule> | null {
  assertStarColours(colours, n)
  const resolved = resolveOptions(options)
  const full = solveStarCatalogue(colours, n, options)
  if (!full.solved) {
    return null
  }
  const loadBearing = new Set<StarCatalogueRule>()
  // Idea units: line confinement (c1+c2), box confinement (c3), shadow (c4).
  const ideaUnits: readonly (readonly StarCatalogueRule[])[] = [
    ['c1', 'c2'],
    ['c3'],
    ['c4'],
  ]
  for (const unit of ideaUnits) {
    if (!unit.some((rule) => resolved.enabled.has(rule))) {
      continue
    }
    const reduced = new Set(resolved.enabled)
    for (const rule of unit) {
      reduced.delete(rule)
    }
    const attempt = solveStarCatalogue(colours, n, {
      rules: reduced,
      csDepth: resolved.csDepth,
      csBlank: resolved.csBlank,
      csTrialCap: resolved.csTrialCap,
      rng: options.rng,
    })
    if (!attempt.solved) {
      for (const rule of unit) {
        loadBearing.add(rule)
      }
    }
  }
  if (resolved.csDepth >= 1) {
    // The depth-0 control must actually disable case-splitting: 'cs' was
    // folded into the enabled set above, so strip it here.
    const depth0Rules = new Set(resolved.enabled)
    depth0Rules.delete('cs')
    const depth0 = solveStarCatalogue(colours, n, {
      rules: depth0Rules,
      csDepth: 0,
      csBlank: resolved.csBlank,
      csTrialCap: resolved.csTrialCap,
      rng: options.rng,
    })
    if (!depth0.solved) {
      loadBearing.add('cs')
    }
  }
  return Object.freeze(loadBearing) as ReadonlySet<StarCatalogueRule>
}
