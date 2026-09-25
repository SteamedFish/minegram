# Minegram

Minegram is a browser puzzle game about ordered mine runs. Each row and column is described by significant run lengths, and every generated board is proven to have exactly one solution.

The playable implementation is in progress. See [`plan/PLAN.md`](plan/PLAN.md) for the product contract, generation algorithm, delivery phases, and verification budget.

## Planned features

- Custom board dimensions and mine density
- Uniquely solvable deterministic puzzles in the pure engine (Worker integration remains a later phase)
- Exact minimum-guess difficulty analysis
- Mine/blank marking, corrections, scoring, drag painting, and keyboard controls
- Responsive, accessible interface
- GitHub Pages deployment

## Phase 1 domain and solver foundation

The pure TypeScript foundation now includes:

- `src/domain/`: row-major binary board types, dimension/coordinate validation, ordered row/column clue encoding and decoding, and puzzle clue derivation. Zero-valued runs are accepted as no-op aliases; public normalization and equality validate every run as a nonnegative safe integer, and normalization returns a frozen canonical positive-run array.
- `src/engine/rng.ts`: seeded uint32/float/integer random streams with reproducible restart and label-derived seeds.
- `src/engine/solver/`: memoized legal line patterns, finite-domain consistency filtering and forced-cell propagation, deterministic count-to-two search, and explicit `unique` / `multiple` / `none` / `unknown` results.
- `src/engine/referenceCounter.ts`: an independent binary-enumeration reference for boards up to 4×4, with explicit cap, node, time, and cancellation statuses.

Pattern materialization is fail-closed. Each line defaults to at most 10,000 complete patterns and 300,000 materialized binary cells; the bounded LRU retains at most 256 complete entries and 1,000,000 cells, refreshes entries on hits, and only complete enumerations are eligible for caching. A stop before completion never leaves partial enumeration data cached. Pattern/cell caps and materialized counts use nonnegative safe-integer validation, with zero caps remaining valid fail-closed limits; direct budget checks validate the context, line, clue, count, and safe cell arithmetic before comparison. Exceeding a cap raises a typed resource error, which the solver reports as `unknown` with resource diagnostics. Cancellation, zero node/time budgets, and cooperative mid-enumeration time checks also fail closed; cancelled and zero-time preflight paths do not invoke a user clock, and no partial domain is used as a uniqueness proof. Public low-level propagation validates domain dimensions, explicit non-empty integer pattern indices, and assignment descriptors before any mutation; only an explicitly `undefined` initial assignment is treated as omitted.

The solver and reference code are DOM-free. Budget exhaustion, cancellation, resource exhaustion, and incomplete searches fail closed as `unknown`; only a completed search may return `unique` or `multiple`.

## Phase 2 deterministic generator and difficulty

`src/engine/generator/` now provides a DOM-free `normalizeGenerationSettings` and `generateMinegramPuzzle` API. Settings accept 1–30 cells per side, at most 900 cells, integer density from 0–100%, a `starter` default, a string/number seed, and a positive safe `maxAttempts`. Mine count is `clamp(round(rows * columns * density / 100), max(rows, columns), rows * columns)`.

Each root derives independent seeded streams for Fisher–Yates random layouts and a low-run contiguous-row structured fallback with bounded column-coverage repair. When the clamped mine count equals the longer board side, deterministic seeded matching seeds one mine for every line of that side and covers every line of the other side, so rectangular minimum-count candidates remain coverage-feasible before the solver gate. A complete candidate must have the exact target count, a mine in every row and column, clues derived from its board, and a completed `unique` solver proof whose returned solution is the candidate. The generator then reuses that one proven immutable witness to replay prefixes transactionally: each accepted event records the prefix subset, exact witness, clues, unique proof, and solution identity. Delivery always performs a fresh independent uniqueness solve. Generation uses a 3,000 ms default wall-clock deadline; candidate and final-proof solves share the `maxSolverNodes` budget (default 100,000), while exact difficulty analysis uses a separate generation-wide `maxDifficultyNodes` budget (default 2,000). All work shares the deadline and cancellation signal, and every budget exhaustion remains fail-closed.

`src/engine/solver/difficulty.ts` computes the exact minimum worst-case number of binary cell guesses after forced propagation with a bounded decision-threshold search; it returns a known value only when the threshold is proven, and returns typed `unknown` for cancellation, time, node, or resource limits. Both values count as a guess only when both branches survive propagation; contradictory branches are inferred at zero cost. `starter=0`, `steady=1..2`, and `challenging=3..5` are exact bands; `expert` is the lower bound `>=6`. Unknown analysis or generation budgets fail closed. Ordinary fixed-seed 15×15/60% generation has a deterministic smoke path, while pathological 30×30 settings can return a clear typed `resource-limit` rather than accepting an unproven board. The parent Phase 2 Oracle gate passed with no blocking findings. Across bounded 6×6–10×10 generator searches and exhaustive unique 3×3/4×4 boards, no nonstarter band was observed; requested nonstarter settings therefore return the documented typed `difficulty-not-found` result rather than weakening uniqueness.

Game reducer, Worker adapter, and playable UI remain future phases.

Install dependencies and run the reproducible checks with:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The Vite production base path is `/minegram/`, and the GitHub Pages workflow uploads the generated `dist/` directory.
