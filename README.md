# Minegram

Minegram is a browser puzzle game about ordered mine runs. Every row and column is
described by its significant run lengths, and every generated board is **proven** to
have exactly one solution before you are ever shown it.

The app now holds two games behind one front door: **Minegram**, the ordered
mine-run puzzle documented below, and **Star Battle**, an n × n star-placement
puzzle whose boards are likewise unique — by construction, with the uniqueness
certificate computed on every board. On load you choose between them on the game
picker. The picker supports a per-game record (rounds played, best streak) and a
ring on the game you last played, but neither is wired up yet — no game currently
records those figures, and inventing numbers would be a lie — so every card reads
"Not played yet".

Both games are playable. See [`plan/PLAN.md`](plan/PLAN.md) for the full product
contract, generation algorithm, delivery phases, and verification budget.

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

## Star Battle (星战)

Star Battle is the second game, a peer of Minegram rather than a mode of it. The
app opens on a **game picker** on every load — deliberately not on your last game,
so a returning player always chooses: each game is a card carrying its name and a
one-line description.

### Rules

- The board is an **n × n** grid carrying exactly **n stars** and **n colours**, with
  every cell coloured.
- Exactly **one star per row**, exactly **one per column**, and exactly **one per
  colour**.
- No two stars may touch — not even diagonally. Every star rules out its whole
  3 × 3 neighbourhood.
- `n` defaults to **10** and is supported from **4 to 15**. Four is the floor
  because no valid star placement exists below it: the stars form a permutation of
  the columns with adjacent rows at distance two or more, and no such permutation
  exists at n = 2 or n = 3. Fifteen is a product choice — the largest board the
  shipped palette and grid already cover. A **board size** control in the toolbar
  chooses `n` and the choice persists; the bounds come from `MIN_STAR_SIDE` /
  `MAX_STAR_SIDE` rather than from a repeated literal.

### How to play

Every cell must eventually carry your mark: **blank** (no star) or **star**. The
game never fills a cell for you — there is no auto-reveal, and every mark on the
board is yours.

- **Mark** a cell. A correct mark locks the cell; a locked cell silently refuses
  any later assertion and is never charged.
- A **wrong** mark costs one point. It stays visible so you can fix it, but the
  point is not refunded. Score starts at 5 and reaching zero ends the round.
- **Retract** a cell — Backspace / Delete, or clicking the mark it already carries —
  to return it to unmarked. Retraction is free, refunds nothing, and never locks.
- Re-stating the mark a cell already carries is free and changes nothing.
- Row, column and colour **counters** above the board state, for each unit, whether
  it holds no star yet, exactly one correct star, or a star that is misplaced; two
  stars inside one 3 × 3 neighbourhood are flagged on both cells.
- The round is won when **every cell carries a correct mark**.

### Controls

- **Left-click** cycles a cell toward blank; **right-click** (or a **500 ms
  long-press** on touch) toggles a star. **Drag** paints with the stroke's tool and
  visits each cell at most once.
- Keyboard: one roving tab stop on the grid. **Arrow keys** move, **Home** / **End**
  jump within the row (with Ctrl, to the board's ends), **Space** or **Enter**
  toggles blank, **s** or **\*** toggles a star, and **Backspace** / **Delete**
  retracts.

### Difficulty

Star Battle difficulty is the measured **depth of the deduction path** — how many
simultaneous propagation waves a pure-logic solver needs to place all n stars —
not a guess count. The three tiers differ only in how the generator spreads
non-star cells across the colour regions:

| Tier | Construction | Measured depth at n = 10 |
| --- | --- | --- |
| `starter` | decoys biased to the largest valid region; the early regions stay singletons, so the colour hidden-single resolves most of the board at once — these are the boards containing a one-cell colour | 3–5 waves |
| `steady` | decoys uniform over the valid range | ≈ 1.7 n (13–17 waves) |
| `challenging` | decoys biased to the smallest valid region, plus a bounded search over the proof order for the deepest construction | up to ~2 n (19 waves, the deepest measured band) |

A higher wave count is a longer deduction path, not necessarily harder human
reasoning — that caveat is stated plainly rather than smoothed over. Generation
itself is cheap: about 1.3 ms at n = 10 for the hardest tier, rising to about
3.0 ms at n = 15. The tier choice persists, and changing it prints a fresh board
with the same seed.

### Uniqueness is by construction — and certified

Unlike Minegram's search-and-proof generator, a Star Battle board is unique **by
construction**, and the acceptance test certifies it on every board:

- A board is solvable exactly when some permutation `T` of the columns with
  `|T(r) − T(r+1)| >= 2` — one star per row and column, never orthogonally or
  diagonally adjacent — selects n cells of pairwise-distinct colours.
- The generator paints colours by **chain**. Writing `pos[r]` for the position of
  row `r` in a proof order, row `r`'s own star cell takes colour `pos[r]`, and its
  non-star cells flow **forward** into the next proof region. Region `R_k` is then
  the forced star `m_k` plus the previous row's decoys, every one of which shares
  a row with an already-forced star and is therefore provably blank — so `R_k`
  holds exactly one viable cell and the colour rule forces it. Induction forces
  all n stars, and a fully forced star set is the unique one.
- Acceptance is a **wave propagation solver** (`propagateStarBoard`): freeze the
  state, compute every forced move, apply them all simultaneously, and count one
  wave. A board ships only if propagation solves it to completion — strictly
  stronger than a solution count of 1. Every generated board therefore carries its
  own uniqueness certificate, and no counting is needed in production.
- `countStarSolutions` remains as an **independent exact counter** for test
  cross-checks (exhaustive agreement at n ≤ 10), alongside a budget-limited
  variant whose exhaustion result can never be misread as a count.
- Rejection sampling was measured and rejected: among well-spread colourings,
  uniqueness is measure-zero past about n = 8, so no amount of resampling could
  ever serve as the acceptance gate.

Generation runs in a Web Worker with cancellation and stale-result protection; a
generation failure is shown with a retry, never swallowed. Every cell's full
state is in its `aria-label`, and one polite `role="status"` region carries wrong
marks, proximity conflicts and the round's end. The palette and grid are pure
CSS, so a larger board scrolls inside its pane rather than breaking the layout.
A won round holds its banner for 2500 ms and then generates the next board
automatically; the interlude never elapses while the document is hidden, and the
banner's own button starts the next board immediately.

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

The same inward-pointing layering holds for Star Battle, and the Worker adapts the
engine without changing domain types:

- `src/domain/starBattle.ts` — puzzle types, the mark constants, and the size
  bounds. `MIN_STAR_SIDE` / `MAX_STAR_SIDE` / `DEFAULT_STAR_SIDE` are the single
  source of truth for the supported range.
- `src/engine/starBattle/construct.ts` — the CHAIN constructive generator; every
  accepted board is certified by the propagation solver before it leaves the engine.
- `src/engine/starBattle/propagate.ts` — the wave propagation solver: the
  production uniqueness certificate and the depth metric in one pass.
- `src/engine/starBattle/count.ts` — the independent exact solution counter and its
  budget-limited variant; a test cross-check, never a production gate.
- `src/engine/starBattle/analyze.ts` — deduction-depth analysis over the same rule
  set.
- `src/application/starBattleReducer.ts` — the play-state transitions: locking,
  scoring, retraction, and the single win predicate.
- `src/workers/starBattleWorker.ts` — the typed Worker adapter with cancellation
  and stale-result protection.
- `src/ui/starBattleStore.ts` — the closure-private store: generation lifecycle,
  the persisted difficulty preference, and the win interlude with its visibility
  guard.
- `src/ui/components/GamePicker.tsx` and `src/ui/components/StarBattleSurface.tsx`
  — the front door and the whole second game as props-driven views, styled by
  `src/styles/starbattle.css`.

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
