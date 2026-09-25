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
3. Search for complete target-density mine layouts containing every accepted mine and satisfying row/column coverage.
4. Accept the candidate only if at least one such completion has a uniquely solvable clue system.
5. If no unique completion is found within the candidate budget, roll back and try another mine.
6. At the target count, derive clues from the actual board and run a fresh, independent uniqueness proof.

Thus every added mine is validated, failed additions are rolled back, and no multi-solution board can be delivered.

### 2.3 Difficulty

Difficulty is based on the minimum number of binary cell guesses needed by the deterministic constraint solver to finish a proof, after all forced propagation is exhausted.

- `starter`: 0 guesses (pure propagation).
- `steady`: 1–2 guesses.
- `challenging`: 3–5 guesses.
- `expert`: 6 or more guesses.

The metric is the easiest complete proof path under the game’s documented inference rules, not a claim of arbitrary human optimality. If the analysis budget is exhausted, generation fails closed. Requested difficulty acts as a lower-bound band; after the configured number of full generation attempts, the UI reports that no board in that band was found.

### 2.4 Wrong marks

- A correct mark locks and does not increase score.
- A wrong mark costs one point and remains visibly wrong.
- The player may change a wrong mark to the opposite value; correcting it does not refund the point.
- A repeated wrong assertion still costs one point, but a drag can charge each affected cell only once.
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
| `src/engine/generator/` | Transactional growth, unique-completion lookahead, coverage, difficulty filtering, rollback |
| `src/application/gameReducer.ts` | Pure game state transitions and score rules |
| `src/application/lineProgress.ts` | Derived completed runs, full-line state, and clue highlighting |
| `src/application/generationController.ts` | Request IDs, worker lifecycle, cancellation, stale-message filtering |
| `src/workers/` | Typed generation protocol and Worker adapter |
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

- Use seeded candidate ordering and coverage anchors.
- Reject additions that make final row/column coverage impossible.
- For every candidate addition, sample/find bounded complete layouts containing the accepted mine set and run the uniqueness solver.
- Roll back any addition without a unique completion witness.
- Cache the final witness and independently re-prove the completed board.
- Count root-level restarts against `maxAttempts`; count canceled/budget-exhausted searches separately in diagnostics.

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

## 6. Delivery Phases and Review Gates

### Phase 0 — Contract and project foundation

- Create project governance, bilingual docs skeleton, plan/TODO/changelog, toolchain, and CI skeleton.
- Gate rationale: freeze semantics and establish reproducible commands before algorithm/UI work.

### Phase 1 — Domain, reference solver, and exact solver

- Implement clue codec, deterministic RNG, exhaustive small-board counter, finite-domain propagation/count-to-two solver, cancellation/budget statuses.
- Gate rationale: solver correctness is the highest-risk invariant.

### Phase 2 — Generator and difficulty

- Implement transactional growth, unique-completion witness per added mine, coverage, rollback, replay, difficulty filtering, and bounded attempts.
- Gate rationale: prove the no-multi-solution delivery invariant before wiring gameplay.

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
| Difficulty is monotonic and bounded | Tiny-board decision-tree comparisons and budget tests | Parent |
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
