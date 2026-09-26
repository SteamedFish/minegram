# Minegram Implementation Plan

## 1. Goal and Quality Bar

Build a polished, fully client-side web game that:

- generates a fresh puzzle for every round;
- accepts customizable board dimensions, mine density/count, score, target difficulty, seed, and retry budget;
- guarantees every delivered board has exactly one solution;
- never delivers a board merely because the solver ran out of budget;
- supports clear ordered row/column clues, scoring, corrections, completion/loss states, and multi-cell drag marking;
- remains usable with mouse, touch, and keyboard;
- builds and deploys cleanly to GitHub Pages.

## 2. Autonomous Requirement Interpretations

### 2.1 Mine count and dimensions

- Default: 15 rows × 15 columns, 60% density, initial score 5.
- Dimensions: 1–30 per side and at most 900 cells.
- Density input is an integer percentage and maps to `round(rows * columns * density / 100)`.
- The accepted mine count is clamped to `[max(rows, columns), rows * columns]` so every row and column can contain a mine.
- Exact mine-count input, if included in the final UI, uses the same feasible interval and is reflected back visibly.

### 2.2 Growth and uniqueness

The literal requirement “the clue system after every mine addition is unique” is mathematically impossible for any non-1×1 board: after the first mine, many placements satisfy the one row clue and one column clue while all other lines are empty.

The implementation therefore uses the strongest playable interpretation:

1. Start with an empty accepted-mine set.
2. Add a candidate mine transactionally.
3. Find a complete target-density mine layout containing every accepted mine and satisfying row/column coverage, then prove its clue system has exactly one solution.
4. Accept the candidate only with that complete unique witness.
5. If no unique witness is found within the candidate budget, roll back and try another mine.
6. Reuse the already-proven complete witness to replay each accepted prefix; the witness is immutable and every trace event records its exact count, coverage, derived clues, unique proof, and solution identity.
7. At the target count, run a fresh independent uniqueness proof before delivery.

Thus every added mine is validated, failed additions are rolled back, and no multi-solution board can be delivered. The witness replay is intentionally an already-proven-witness reuse, not a fresh solver search for every prefix; only delivery receives a fresh proof.

### 2.3 Difficulty

Difficulty is based on the minimum number of binary cell guesses needed by the deterministic constraint solver to finish a proof, after all forced propagation is exhausted.

- `starter`: 0 guesses (pure propagation).
- `steady`: 1–2 guesses.
- `challenging`: 3–5 guesses.
- `expert`: 6 or more guesses.

The metric is the exact minimum worst-case number of binary cell guesses under the game’s documented inference rules, not a claim of arbitrary human optimality. A guess is counted only when both cell values remain possible after forced propagation; a branch that immediately contradicts is inferred and costs zero. `starter`, `steady`, and `challenging` are exact bands, while `expert` is a lower bound (`minimumGuesses >= 6`). Difficulty analysis uses an exact bounded decision-threshold search and returns a value only after proving a threshold. Generation has a 3,000 ms default wall-clock deadline; candidate/final-proof solves use `maxSolverNodes` (default 100,000), while difficulty uses a separate generation-wide `maxDifficultyNodes` cap (default 2,000). If any analysis or generation budget is exhausted, generation fails closed. After the configured number of full root attempts, the generator reports a typed failure; bounded 30×30/pathological cases may fail with `resource-limit` rather than weakening uniqueness.

### 2.4 Wrong marks

- A correct mark locks and does not increase score.
- A wrong mark costs one point and remains visibly wrong.
- The player may change a wrong mark to the opposite value; correcting it does not refund the point.
- A locked cell rejects any later assertion; a correct mark is final.
- Re-asserting the mark a cell already carries is a no-op and never costs again; a cell is charged only when its mark is changed to a different value and that new value is wrong, and a drag can charge each affected cell only once.
- Reaching zero ends the round immediately.

## 3. Technical Architecture

### 3.1 Stack

- React + TypeScript + Vite.
- Vitest for domain, solver, generator, reducer, and component tests.
- Web Worker for generation and solver work.
- GitHub Actions for Pages deployment.
- Relative Vite base path so the production bundle works under a repository subpath.

### 3.2 Modules

| Module | Responsibility |
|---|---|
| `src/domain/` | Shared types, coordinates, board validation, ordered clue encode/encode helpers |
| `src/engine/rng.ts` | Seeded deterministic RNG and restart seed derivation |
| `src/engine/solver/` | Legal line patterns, propagation, count-to-two uniqueness proof, guess analysis |
| `src/engine/generator/` | Deterministic random/structured layouts, immutable witness replay, fresh final proof, coverage, difficulty filtering, rollback, and typed budgets |
| `src/application/gameReducer.ts` | Pure game state transitions and score rules |
| `src/application/lineProgress.ts` | Derived completed runs, full-line state, and clue highlighting |
| `src/application/generationClient.ts` | Request IDs, worker lifecycle, cancellation, stale-message filtering |
| `src/application/generationWorker.ts` | Typed generation protocol and Worker adapter |
| `src/ui/` | Settings, status, clue rails, board, legend, help, result/failure dialogs |
| `src/styles/` | Responsive visual system and interaction states |

## 4. Core Algorithms

### 4.1 Ordered line clues

A clue `[a, b, c]` describes `a` consecutive mines, at least one blank, `b` consecutive mines, at least one blank, and `c` consecutive mines. The order is significant. Empty lines use `[]`.

The engine generates legal line patterns once per distinct line length/clue and uses those patterns as finite domains.

### 4.2 Uniqueness proof

1. Initialize row and column domains from all legal ordered-run patterns.
2. Apply known mine totals.
3. Remove patterns inconsistent with assignments.
4. Propagate cells whose value is identical across every remaining row/column possibility.
5. If unresolved, choose the most constrained line and branch.
6. Stop after finding two complete solutions.
7. Return `unique`, `multiple`, `none`, or `unknown`; only `unique` passes generation.

A small-board exhaustive reference counter provides an independent test oracle.

### 4.3 Transactional growth

- Use seeded Fisher–Yates candidate ordering plus a low-run contiguous-row structured fallback; at the minimum clamped count, construct a deterministic matching that covers every row and column before bounded repair; repair missing coverage without changing the exact mine count.
- Validate every complete layout for exact count, row/column coverage, and board/mine-index identity before solving.
- Prove a complete unique target witness, then replay its prefixes transactionally from the empty accepted set. The already-proven witness is intentionally reused for every prefix; each event records the accepted subset, exact witness, derived clues, unique proof, and solution identity.
- Roll back any rejected candidate without changing the parent accepted set or trace prefix.
- Independently re-solve the completed board for delivery; do not reuse candidate domains, assignments, or proof state (only bounded pure line-pattern caching may be shared).
- Count root-level restarts against `maxAttempts`; pass the remaining cancellation and 3,000 ms default deadline through candidate, difficulty, and final-proof work. Candidate/final-proof solves share `maxSolverNodes` (default 100,000); difficulty uses a separate generation-wide `maxDifficultyNodes` cap (default 2,000). Candidate-local multiple/resource failures roll back, while global cancellation, time, resource, attempt, or difficulty exhaustion fails closed with serializable diagnostics.

### 4.4 Line progress

- A line is fully labeled when no unknown cells remain.
- A correct fully labeled line is automatically revealed and its clue is shown as complete.
- A run is complete only when all mine cells for a compatible placement are marked mine and each internal separator has at least one explicitly correct blank.
- Ambiguous compatible placements do not trigger completion highlighting.
- Contradictory lines receive a distinct error treatment independent of color.

## 5. Interaction and UX

- Persistent top status: score, difficulty, seed, round, and generation state.
- Settings drawer/panel: rows, columns, density, score, difficulty, attempts, optional seed.
- Central board framed by ordered row clues on the left and column clues on top.
- Explicit Mine/Blank toolbar; right-click is optional acceleration only.
- Pointer Events with pointer capture; one commit per cell per drag.
- Preview affected cells and score cost before pointer release on desktop.
- Touch marking mode prevents board panning only while actively marking; normal page scrolling remains available outside the mode.
- Native buttons, arrow-key navigation, `M`/`B` shortcuts, Escape cancellation, visible focus, ARIA live status, reduced-motion support.
- Zoom control for boards up to 30×30; cell targets remain usable.
- Clear onboarding, legend, clue grammar explanation, and actionable generation-failure report with reproducible seed/settings.

Phase 4 rulings that refine this section:

- **Theme:** an explicit `Auto / Light / Dark` switch, persisted and applied as `html[data-theme]`, defaulting to `Auto`. `Auto` must follow `prefers-color-scheme` with no JavaScript, and both palettes must be correct in CSS alone.
- **Seed policy:** only the authored seed is ever rendered. The engine's derived next-round seed exists only inside the failure/copy report payload, which is formatted at click time and never stored in a value a component can read.
- **Mine count:** a read-only echo of density, never an editable field, so the two cannot disagree.
- **Resume:** a failed or cancelled generation attempt that kept a board leaves that board playable through an explicit `round/resume` action. Resuming a board that is already fully correct resolves to a win rather than an unfinishable round.
- **Right button:** plain right-click applies the opposite of the current marking mode and never changes the mode. `Erase` is a real marking mode, so the left button clears in it; `Shift`+right-click erases a single cell without changing the mode.
- **Non-drag alternative:** every drag gesture is also reachable by a single-cell path (native buttons, arrow keys, `M`/`B`/Escape), because drag alone fails WCAG 2.5.7.
- **State containment:** the authoritative game state lives only in a module closure; components receive projected view data, and no view type can express the mine solution.

## 6. Delivery Phases and Review Gates

### Phase 0 — Contract and project foundation

- Create project governance, bilingual docs skeleton, plan/TODO/changelog, toolchain, and CI skeleton.
- Gate rationale: freeze semantics and establish reproducible commands before algorithm/UI work.

### Phase 1 — Domain, reference solver, and exact solver

- Implement clue codec, deterministic RNG, exhaustive small-board counter, finite-domain propagation/count-to-two solver, cancellation/budget statuses.
- Gate rationale: solver correctness is the highest-risk invariant.

### Phase 2 — Generator and difficulty

- Implement deterministic random/structured layout search, immutable witness-guided transactional replay, coverage, rollback, exact minimum-guess difficulty filtering, and bounded root attempts.
- Gate rationale: prove the no-multi-solution delivery invariant before wiring gameplay. Parent validation and the Oracle gate passed on the live Phase 2 overlay; nonstarter reachability remains a tracked bounded-search limitation.

### Phase 3 — Game core and Worker integration

- Implement reducer, score/correction rules, line progress, success/loss, typed Worker protocol, cancellation, stale-result protection.
- Gate rationale: isolate game rules from rendering and prove state transitions.

### Phase 4 — UI/UX implementation

- Implement responsive visual system, settings, clue rails, board interactions, help, status, generation/failure/success/loss experiences.
- Gate rationale: visuals and input behavior require specialist design judgment.

### Phase 5 — Release engineering and verification

- Add GitHub Pages workflow, polish bilingual docs, run tests/typecheck/lint/build, browser interaction checks, nested-path production smoke/performance checks.
- Gate rationale: deployability and user-visible quality are release blockers.

Each phase requires parent validation, an Oracle review gate, reconciliation of material findings, and a focused GPG-signed commit before the next phase.

## 7. Verification Budget

| Claim | Minimum decisive evidence | Owner |
|---|---|---|
| Clue grammar and order are correct | Unit fixtures including ambiguous order, separators, and empty lines | Parent + solver lane |
| Solver never reports budget exhaustion as unique | Status-union tests plus adversarial/cancellation tests | Parent + solver lane |
| Solver matches an independent oracle | Exhaustive comparison for all small boards up to 4×4 with feasible mine counts | Parent |
| Every mine addition is transactional | Seeded trace test: failed candidate absent from parent; accepted candidate has unique-completion witness | Parent + generator lane |
| Delivered puzzles are unique | Fresh final proof in generator plus fixture/property tests | Parent |
| Every row/column has a mine | Generator invariant and output validation | Parent |
| Difficulty is exact and bounded | Tiny-board decision-tree comparisons for bands 0/1/2/3 plus deterministic band-boundary checks, default-deadline reproduction, and budget-unknown tests | Parent |
| Game score/state transitions are correct | Reducer transition-table tests including correction, zero, win precedence | Parent |
| Drag marks each cell once | Component interaction test plus browser pointer smoke test | Parent + UI lane |
| UI is responsive and accessible | Desktop/mobile screenshots, keyboard-only flow, reduced-motion and ARIA checks | Parent + designer lane |
| GitHub Pages build works | Production build served from a nested path, assets/worker load without console errors | Parent |

A 15×15/60% benchmark is a release check, not a reason to weaken uniqueness. If bounded search cannot satisfy a requested difficulty, the game reports failure and offers a reproducible seed/settings report.

## 8. Git and Release Steps

1. Commit Phase 0 foundation on `master` with GPG signing.
2. Create `feature/minegram-v1` worktree and topic branch.
3. Implement and validate phases in order, committing each independent delivery boundary.
4. Merge only after the full verification budget passes.
5. Push `master` to `origin`.
6. Verify GitHub Actions deployment and the public Pages URL when the runner becomes available.
