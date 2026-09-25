# Minegram

Minegram is a browser puzzle game about ordered mine runs. Each row and column is described by significant run lengths, and every generated board is proven to have exactly one solution.

The playable implementation is in progress. See [`plan/PLAN.md`](plan/PLAN.md) for the product contract, generation algorithm, delivery phases, and verification budget.

## Planned features

- Custom board dimensions and mine density
- Uniquely solvable random puzzles generated in a Web Worker
- Difficulty based on required logical guesses
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

The solver and reference code are DOM-free. Budget exhaustion, cancellation, resource exhaustion, and incomplete searches fail closed as `unknown`; only a completed search may return `unique` or `multiple`. The transactional generator, game reducer, Worker adapter, and playable UI remain future phases.

Install dependencies and run the reproducible checks with:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

The Vite production base path is `/minegram/`, and the GitHub Pages workflow uploads the generated `dist/` directory.
