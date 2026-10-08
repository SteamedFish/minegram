/**
 * Star Battle layout sampler: the first stage of the spanning-tree
 * construction that replaced the retired strips-and-sea painting.
 *
 * The construction, in one paragraph, is: plant a uniformly random
 * admissible star permutation (the intended answer), grow a randomised
 * DFS spanning tree over the grid's 4-neighbour graph, cut `n - 1` tree
 * edges to split the board into exactly `n` connected components, and
 * accept the layout only when every component contains exactly one planted
 * star. Each accepted component becomes one colour region (its colour is
 * the row of its star, so all `n` colours are present, every region is
 * connected by construction, and the planted permutation is always a valid
 * solution of the colouring).
 *
 * The mine-balance filter is weak on its own — measured acceptance is
 * 1.11% at n = 6, 0.062% at n = 8, 0.012% at n = 10 and 0.0001% at n = 12 —
 * but sampling is cheap and the guided repair in `repair.ts` does the real
 * work, so this stage only has to be truthful: return `null` when the
 * balance fails, never bend the layout to force acceptance.
 */

import { assertStarBattleSide } from '../../domain/starBattle'
import type { SeededRandom } from '../rng'

/**
 * A mine-balanced sampled layout: a colouring whose regions are connected
 * and hold exactly one planted star each, plus the planted permutation
 * itself. The colouring is NOT necessarily unique-solution; that is the
 * repair stage's and the final counter's job.
 */
export interface StarSampledLayout {
  /** Region colouring, `colours[row * n + col]` in `[0, n)`. */
  readonly colours: Uint8Array
  /** The planted star permutation: `solution[row]` is the star column. */
  readonly solution: readonly number[]
}

/**
 * A uniformly random admissible column permutation (|T[r] - T[r+1]| ≥ 2
 * for every adjacent pair), drawn by rejection from the seeded RNG. The
 * side is validated first: below n = 4 no admissible permutation exists
 * and rejection would loop forever, so the assert is load-bearing, not
 * ceremonial.
 */
export function admissibleStarPermutation(n: number, rng: SeededRandom): readonly number[] {
  assertStarBattleSide(n)
  for (;;) {
    const columns = Array.from({ length: n }, (_, index) => index)
    for (let index = n - 1; index > 0; index -= 1) {
      const pick = rng.nextInt(index + 1)
      const swap = columns[index]
      columns[index] = columns[pick]
      columns[pick] = swap
    }
    let admissible = true
    for (let row = 0; row + 1 < n; row += 1) {
      if (Math.abs(columns[row] - columns[row + 1]) < 2) {
        admissible = false
        break
      }
    }
    if (admissible) {
      return columns
    }
  }
}

interface GridEdge {
  readonly a: number
  readonly b: number
}

/**
 * 4-neighbour indices of a cell, in a fixed order, with `-1` for edges of
 * the board. Fixed order plus seeded shuffling keeps every draw
 * reproducible from the seed alone.
 */
function neighboursOf(cell: number, n: number): [number, number, number, number] {
  const row = (cell / n) | 0
  const column = cell % n
  return [
    row > 0 ? cell - n : -1,
    row + 1 < n ? cell + n : -1,
    column > 0 ? cell - 1 : -1,
    column + 1 < n ? cell + 1 : -1,
  ]
}

/**
 * A randomised DFS spanning tree of the n×n grid's 4-neighbour graph,
 * drawn by the recursive-backtracker walk: start at a uniformly random
 * cell, always extend from the deepest reachable cell into a uniformly
 * random unvisited neighbour, backtrack when stuck. Returns the n² − 1
 * tree edges; every draw comes from `rng`, so a seed reproduces its tree.
 */
function spanningTree(n: number, rng: SeededRandom): GridEdge[] {
  const total = n * n
  const visited = new Uint8Array(total)
  const edges: GridEdge[] = []
  const stack: number[] = [rng.nextInt(total)]
  visited[stack[0]] = 1
  while (stack.length > 0) {
    const cell = stack[stack.length - 1]
    const neighbours = neighboursOf(cell, n)
    let chosen = -1
    let candidates = 0
    for (const neighbour of neighbours) {
      if (neighbour >= 0 && visited[neighbour] === 0) {
        candidates += 1
        if (rng.nextInt(candidates) === 0) {
          chosen = neighbour
        }
      }
    }
    if (chosen === -1) {
      stack.pop()
      continue
    }
    visited[chosen] = 1
    edges.push({ a: cell, b: chosen })
    stack.push(chosen)
  }
  return edges
}

/**
 * Sample one mine-balanced layout. Draws the planted permutation, grows
 * the spanning tree, cuts `n - 1` uniformly chosen distinct tree edges and
 * flood-fills the resulting components; returns `null` unless every
 * component contains exactly one planted star. Pure function of `rng`'s
 * draw sequence: same seed, same accept/reject decision and same layout.
 */
export function sampleStarBattleLayout(n: number, rng: SeededRandom): StarSampledLayout | null {
  assertStarBattleSide(n)
  const solution = admissibleStarPermutation(n, rng)
  const total = n * n

  // Planted star cells, as a lookup set.
  const mineCells = new Uint8Array(total)
  for (let row = 0; row < n; row += 1) {
    mineCells[row * n + solution[row]] = 1
  }

  const edges = spanningTree(n, rng)

  // Cut n − 1 distinct tree edges: partial Fisher–Yates over the edge
  // list, then take the first n − 1 slots. A tree minus n − 1 edges always
  // yields exactly n components.
  const cut: GridEdge[] = []
  for (let index = 0; index < n - 1; index += 1) {
    const pick = index + rng.nextInt(edges.length - index)
    const swap = edges[index]
    edges[index] = edges[pick]
    edges[pick] = swap
    cut.push(edges[index])
  }
  const edgeKey = (a: number, b: number): number => (a < b ? a * total + b : b * total + a)
  const cutSet = new Set<number>()
  for (const edge of cut) {
    cutSet.add(edgeKey(edge.a, edge.b))
  }
  // The components are formed by TREE edges only: the grid has cycles the
  // tree does not include, and a flood fill that crossed every non-cut
  // grid edge would merge the components back together (measured: the
  // balance filter then rejects ~everything). So the traversal set is the
  // spanning tree minus the cut.
  const treeSet = new Set<number>()
  for (const edge of edges) {
    treeSet.add(edgeKey(edge.a, edge.b))
  }

  // Flood fill the components. Track each component's planted-star row:
  // exactly one star per component is the balance condition, and the star's
  // row doubles as the component's colour index (all rows distinct).
  const colours = new Uint8Array(total)
  const componentOf = new Int32Array(total).fill(-1)
  let componentCount = 0
  for (let start = 0; start < total; start += 1) {
    if (componentOf[start] !== -1) {
      continue
    }
    let starRow = -1
    let starCount = 0
    const stack = [start]
    componentOf[start] = componentCount
    while (stack.length > 0) {
      const cell = stack.pop() as number
      const row = (cell / n) | 0
      if (mineCells[cell] === 1) {
        starCount += 1
        starRow = row
      }
      for (const neighbour of neighboursOf(cell, n)) {
        if (neighbour < 0 || componentOf[neighbour] !== -1) {
          continue
        }
        if (!treeSet.has(edgeKey(cell, neighbour)) || cutSet.has(edgeKey(cell, neighbour))) {
          continue
        }
        componentOf[neighbour] = componentCount
        stack.push(neighbour)
      }
    }
    if (starCount !== 1) {
      return null
    }
    // Paint every cell of this component with the star's row-colour.
    for (let cell = 0; cell < total; cell += 1) {
      if (componentOf[cell] === componentCount) {
        colours[cell] = starRow
      }
    }
    componentCount += 1
  }
  if (componentCount !== n) {
    return null
  }
  return Object.freeze({ colours, solution })
}
