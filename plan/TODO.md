# Minegram TODO

## Phase 0 — Foundation
- [x] Scaffold React/TypeScript/Vite project and scripts.
- [x] Add lint, typecheck, test, and production build configuration.
- [x] Create bilingual README files and GitHub Pages deployment workflow.
- [x] Create and verify the initial GPG-signed foundation commit.

## Phase 1 — Domain and Solver
- [x] Implement board types, coverage validation, and ordered clue codec.
- [x] Implement seeded deterministic RNG.
- [x] Implement exhaustive small-board reference counter.
- [x] Implement finite-domain propagation and count-to-two uniqueness solver.
- [x] Add cancellation, node/time budgets, and fail-closed result statuses.
- [x] Pass differential, unit, and adversarial solver tests in this worktree.
- [x] Complete the parent Oracle validation gate (PASS on signed commit `acd3812`).

## Phase 2 — Generator and Difficulty
- [x] Implement deterministic random/structured layout search and transactional growth with immutable unique-witness replay.
- [x] Enforce exact mine count, row/column coverage, witness identity, and rollback invariants.
- [x] Implement exact minimum-worst-case-guess difficulty analysis and starter/steady/challenging/expert band semantics.
- [x] Implement root attempt budgets, global cancellation/deadline/node budgets, and serializable diagnostic failure reports.
- [x] Bound exact difficulty analysis with a 3,000 ms default generator deadline and separate 2,000-node difficulty cap, preserving typed fail-closed limits.
- [x] Pass focused trace, replay, property, differential, and 15×15/60% benchmark checks in this worktree.
- [x] Make minimum-count rectangular layout construction coverage-feasible, rethrow unexpected repair errors, and prioritize resource exhaustion over difficulty mismatch.
- [x] Complete the parent Phase 2 Oracle validation gate (PASS; nonstarter reachability remains a bounded, documented limitation).
- [ ] Investigate a future generator/search improvement if nonstarter difficulty bands must be reachable in normal play.

## Phase 3 — Game Core and Worker
- [x] Implement pure game reducer and scoring/correction transitions.
- [x] Implement completed-run/full-line/contradiction selectors.
- [x] Implement typed Worker protocol, lifecycle, cancellation, and stale-result filtering.
- [x] Pass state-transition and Worker integration tests; complete parent validation.
- [ ] Complete the parent Phase 3 Oracle validation gate.

## Phase 4 — UI/UX
- [ ] Implement responsive shell, settings, status, clue rails, and board.
- [ ] Implement mouse/touch drag transaction previews and keyboard marking.
- [ ] Implement onboarding, legend, result/failure states, zoom, and accessibility.
- [ ] Pass component tests and desktop/mobile visual review; complete design handoff and Oracle gate.

## Phase 5 — Release
- [ ] Verify GitHub Actions Pages deployment from a nested path.
- [ ] Run lint, typecheck, tests, build, and browser smoke/performance checks.
- [ ] Finish bilingual documentation and changelog.
- [ ] Merge topic branch, push GPG-signed `master`, and verify remote/Actions state.
