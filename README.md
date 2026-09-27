# Minegram

Minegram is a browser puzzle game about ordered mine runs. Every row and column is
described by its significant run lengths, and every generated board is **proven** to
have exactly one solution before you are ever shown it.

The game is playable. See [`plan/PLAN.md`](plan/PLAN.md) for the full product contract,
generation algorithm, delivery phases, and verification budget.

## How to play

Each row and column carries a clue such as `3 5 1`: nine mines, in a run of three, then
a gap, then a run of five, then a gap, then a single mine. **Order matters** — `3 5 1`
and `3 1 5` describe different boards. Every gap between two runs is at least one
mine-free cell, and a run never has to be maximal: `3 5 1` on a 12-cell line is a valid
shape.

Every row and every column of a finished board holds at least one mine, so a clue of `0`
never appears and no line is vacuous.

- **Mark** a cell as a mine or as empty. A correct mark locks the cell.
- A **wrong** mark costs one point. You can correct it later, but the point is not
  refunded, and your score reaching zero ends the game.
- Re-stating the mark a cell already carries is free and changes nothing.
- When **every mine in a row or column is marked** and that line holds no wrong mark, the
  game fills the rest of that line in for you, for free. You never pay for a cell the game
  filled.
- When **every mine of a run is marked**, that run's number lights up immediately. You do
  not have to mark the gaps around it first — the game fills those. So on a `7 2 2 1`
  column, marking the `7` and both `2`s lights all three, while the unplaced `1` stays
  plain.
- The round is won when every cell carries a correct mark, and a new round starts
  automatically.

### Controls

- **Left-drag** to paint a run of cells with the current mode, **left-click** for one cell.
- **Right-drag** paints the opposite mode without changing your current mode;
  **Shift + right-click** erases a single cell. `Erase` is also a mode of its own.
- Every drag has a non-drag equivalent: a mode selector in the toolbar plus arrow-key
  navigation, so the game is fully playable from the keyboard.
- Theme follows your system, or is pinned to light or dark from the footer. The interface
  is available in English and Simplified Chinese.

## Configuration

| Setting | Default | Range |
| --- | --- | --- |
| Rows / columns | 15 × 15 | 1–24 per side, at most 576 cells |
| Mine density | 60% | clamped to a count between `max(rows, columns)` and `rows × columns` |
| Difficulty | `starter` | see [difficulty](#difficulty) |
| Seed | 0 | any string or number; the same seed always prints the same first board |
| Initial score | 5 | any positive number |

Only the **authored** seed is shown. Each round after the first is generated from a seed
derived from the one you typed, and that derived value is never displayed — it appears
only in the clipboard diagnostic report, if you ask for it.

The 24-cell ceiling is a real capacity limit, not a search budget: the solver enumerates
the legal patterns of a single line, and that enumeration is the binding constraint.
25 × 25 always fails closed with a `resource-limit` diagnostic rather than shipping an
unproven board.

## Difficulty

Difficulty is the **exact minimum number of binary cell guesses** needed after forced
propagation — that is, how many times pure logic stalls and you must commit to a coin
flip.

| Band | Guesses needed |
| --- | --- |
| `starter` | 0 — pure logic solves it outright |
| `steady` | 1–2 |
| `challenging` | 3–5 |
| `expert` | 6 or more |

If you request a band, the generator keeps trying, up to a bounded number of attempts, and
tells you plainly when it cannot reach it instead of quietly handing you something easier.

**Known limitation.** Across bounded 6 × 6 – 10 × 10 searches, roughly 2,300 random
uniquely-solvable boards, and *every* uniquely-solvable 3 × 3 and 4 × 4 board, the
generator has never produced a board that needs a single guess. In practice that means a
non-`starter` request returns a typed `difficulty-not-found` result. This is recorded in
[`plan/TODO.md`](plan/TODO.md) as open work, not as a claim of impossibility.

## Architecture

The four layers depend inward — `domain` ← `engine` ← `application` ← `ui` — and nothing
imports outward. `src/ui/layerBoundary.test.ts` enforces this by parsing every import edge
in the source, comments and strings included, so a component cannot reach a board, a
puzzle, a proof, or a trace.

- `src/domain/` — row-major binary board types, dimension and coordinate validation, the
  ordered clue codec, and clue derivation. Zero-valued runs are accepted as no-op aliases;
  normalization validates every run as a nonnegative safe integer and returns a frozen
  canonical array.
- `src/engine/` — seeded RNG streams, the solver, the generator, and the difficulty
  analysis. All of it is DOM-free and runs unchanged in a Worker or in Node.
- `src/application/` — the game reducer and its selectors. Authoritative state is
  immutable and never leaves this layer except as a projection.
- `src/ui/` — components, the closure-private store, copy dictionaries, and the snapshot
  projection. A component can only ever see selector output.

### Uniqueness is proven, never assumed

The literal requirement "adding each mine must leave a unique solution" is mathematically
impossible to satisfy literally on any board larger than 1 × 1: after the first mine there
are many placements that still admit a unique solution, so almost every addition would
fail. The contract actually implemented is:

1. The accepted set starts empty.
2. Each candidate mine is added **transactionally** and is accepted only if a complete
   target-density layout exists that contains every mine accepted so far, satisfies
   row and column coverage, and whose derived clues have a **unique** solution.
3. Otherwise the candidate is rolled back and another is drawn.
4. At the target count, a **fresh, independent** uniqueness proof is run on the board that
   will actually be delivered.

A board that reaches the player therefore has exactly the target mine count, a mine in
every row and column, and exactly one solution — the last of which is re-proven on
delivery rather than inherited from the search that built it.

### Fail-closed everywhere

Every bounded search — line patterns, uniqueness, difficulty — reports `unknown` rather
than a guess when its budget runs out, and only a *completed* search may return `unique`
or `multiple`. Line patterns default to at most 10,000 complete patterns and 300,000
materialized cells; the LRU retains at most 256 complete entries and 1,000,000 cells, and
only complete enumerations are ever cached. Cancellation, zero budgets, and exhausted
deadlines all fail closed, and the UI shows a typed diagnostic instead of a board it
cannot vouch for.

## Development

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run verify:base   # asserts every built asset resolves under /minegram/
```

Run the game locally with `npm run dev`, or build and serve the production bundle with
`npm run build && npm run preview`.

The Vite production base path is `/minegram/`, and the GitHub Pages workflow deploys
`dist/` under that base. `verify:base` exists because a root-absolute asset URL works
perfectly in `vite dev` and breaks only in production.
