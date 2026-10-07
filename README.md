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

Every cell must eventually carry a correct mark: **blank** (no star) or **star**.

- **Mark** a cell. A correct mark locks the cell; a locked cell silently refuses
  any later assertion, retraction included, and is never charged.
- A **wrong** star costs one **life**. It stays visible so you can fix it, but the
  life is not refunded. Lives default to **5** and a toolbar control sets the
  maximum from 1 to 9; reaching zero ends the round. Mistaking a cell for blank
  costs nothing, because an untrue blank is not chargeable — only a claimed star
  can be.
- **Retract** a cell — Backspace / Delete, or clicking the mark it already carries —
  to return it to unmarked. Retraction is free, refunds nothing, and never locks.
- Re-stating the mark a cell already carries is free and changes nothing.
- **A correct star fills its own exclusions for you.** The rest of its row, the
  rest of its column, every other cell of its colour, and its 3 × 3 neighbourhood
  become locked blanks, in the same move. This is what the rules already imply, so
  it never tells you where a star *is* — it only saves you the bookkeeping. It
  never overwrites a mark you have already made, including a wrong star you have
  already paid for, and it is free.
- Two stars inside one 3 × 3 neighbourhood are flagged on both cells. That is the
  only rule without a count you could read off the board, so it is the one
  conflict the game still draws for you.
- The round is won when **every cell carries a correct mark**.

### Controls

A tap marks a **star** — that is the assertion the game is about, so it is the
one a tap should make. **Right-click**, or a **500 ms long-press** on touch,
toggles **blank**. **Drag** paints every cell it crosses with the gesture's own
tool, visiting each at most once. The rules block above the board states this in
words, because having to discover it is what made it unusable on a phone.

Keyboard: one roving tab stop on the grid. **Arrow keys** move, **Home** / **End**
jump within the row (with Ctrl, to the board's ends), **Space** or **Enter**
toggles blank, **s** or **\*** toggles a star, and **Backspace** / **Delete**
retracts.

The toolbar names the game you are playing and offers a way back to the picker;
there is exactly one such control per screen.

### Difficulty

Each tier names **how many independent techniques a solver must use** to finish a
board. The count is measured and enforced on every board the generator accepts,
not asserted:

| Tier | 中文 | What a board requires |
| --- | --- | --- |
| `starter` | 入门 | The basic rules alone finish it, in about 3 propagation waves |
| `steady` | 进阶 | The basic rules alone finish it, but the chain is long — 13 to 29 waves by size |
| `challenging` | 挑战 | The basic rules **stall**; exactly one extra technique is needed |
| `expert` | 专家 | The basic rules stall; no single technique suffices, a pair does |
| `contradiction` | 反证 | The basic rules stall and **every** technique combination fails; only proof by contradiction works |

A "technique" is line confinement — a colour can only hold a star on certain
lines — which is what makes several colours confined to the same few lines
deduce things. The first three tiers are built directly; the last three come from
a seeded search that recolours single cells until the basic rules stop making
progress, and every accepted board is re-verified by enumerating all sixteen
technique subsets.

**This is an honest measurement, not a calibrated difficulty scale.** Longer does
not reliably mean harder for a person: across four boards a human singled out as
interesting, the one they rated highest needed only *one* technique but took 12
waves to pay off, while our easiest one-technique boards take 4. So treat the tier
names as a statement about the board's *shape*, and expect the player-facing
ordering to be worth revisiting against real play.

The `contradiction` tier is measured at a single assumption level across every
board observed so far — none has needed an assumption stacked on an assumption.
That is also the limit of what this solver can currently produce.

Generation cost: about 1.1 ms at n = 10 for the basic tiers, rising to about
2.8 ms at n = 15, measured over 200 boards per point. The technique tiers are
far slower, because they search — roughly 36 ms and 150 ms at n = 10, reaching
seconds at n = 15. The tier choice persists, and changing it prints a fresh board
with the same seed.

### Uniqueness is by construction — and certified

Unlike Minegram's search-and-proof generator, a Star Battle board is unique **by
construction**, and the acceptance test certifies it on every board:

- A board is solvable exactly when some permutation `T` of the columns with
  `|T(r) − T(r+1)| >= 2` — one star per row and column, never orthogonally or
  diagonally adjacent — selects n cells of pairwise-distinct colours.
- The generator paints colours by **strips and a sea**. The star placement is
  chosen so its first two stars take the two edge columns, and each difficulty
  decides how many horizontal strips to lay down; everything not claimed by a
  strip or a star becomes one large absorbing **sea** region. A strip cell always
  shares a row with an already-forced star, so it is provably blank, which means
  each region holds exactly one viable cell and the colour rule forces it.
  Induction forces all n stars, and a fully forced star set is the unique one.
- **Every colour is a single contiguous region.** The generator counts connected
  components per colour and rejects any board where a region splits, so the
  property is structural rather than incidental. The previous construction could
  not deliver this — it produced **zero** fully-connected boards at any tier,
  because a colour's cells formed a horizontal strip with a hole where the
  neighbouring region's star sat. The difficult tier is not the one that suffered
  most: `starter` was the worst offender, with the worst region splitting into 13
  pieces at n = 10 and 25 at n = 15.
- **The sea dominates the board, and the player does not like it.** Because it
  absorbs everything unclaimed, one colour covers most of the grid: on `starter`,
  where no strips are laid, it reaches 81% of the board at n = 4 and 94% at
  n = 15, leaving n single cells of distinct colours scattered on a field. The
  player reported 「长条+大海的构造实在是过于简单了，丧失了非常多的趣味性」, and the
  measurement behind that complaint is structural: **the sea is adjacent to every
  other region at every board size and tier**, so it is a *hub* in the region
  adjacency graph. Four boards the player picked out of the game they actually
  enjoy were measured and **none of them has a hub** — their largest region is
  25% to 40% of the board against our 39% to 59%. No renumbering and no hue
  assignment can move a hub's colour away from anything, so that half of
  "keep similar colours apart" has to come from the palette; but the other half
  is a layout problem, and the answer to it is not to have a hub at all.
- **Difficulty is not graded by wave count.** Measured across the four reference
  boards and our own output, waves do not separate the levels: one-technique
  boards span 3 to 5 waves, two-technique boards 4 to 8, contradiction boards 3
  to 8 — heavily overlapping. Wave count measures how long a *solver* grinds,
  which is not how hard a person finds it.
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

### Telling the colours apart

Colour identity carries the rules, so the palette is derived rather than
hand-picked. It is a **5 hue slots × 4 lightness levels** grid — `slot = i mod 5`
sets the hue, `level = floor(i / 5)` sets the lightness, and the hue shifts by a
further 36° per level so a cross-level pair differs in hue *as well as* lightness.
The objective is the **maximum minimum pairwise perceptual distance** over every
prefix of 4 to 20 colours, because any pair can end up adjacent and only the worst
pair matters.

Measured worst pair (CIEDE2000): 26.4 at n = 4 falling to 18.0 at n = 20 in the
light theme, and 34.1 falling to 13.7 at n = 20 in the dark theme. For comparison
the previous palette's worst pair was about **4** — effectively indistinguishable
adjacent cells, which is what the player reported. Light and dark are two separate
palettes, not inversions of each other.

The reason no hue assignment could have solved this on its own: 15 colours spread
evenly around the wheel is 24° apart, already at the edge of what the eye
resolves between large flat patches. Hue alone cannot carry 15 colours, so the
palette spends lightness as well. No hatch or glyph channel was needed on top —
the numbers say two channels suffice, and adding a third would only have made
cells harder to read.

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
- `src/engine/starBattle/construct.ts` — the strips-and-sea constructive generator,
  which enforces one contiguous region per colour by counting connected
  components; every accepted board is certified by the propagation solver before
  it leaves the engine.
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
