# Minegram TODO

## Phase 0 — Foundation
- [x] Scaffold React/TypeScript/Vite project and scripts.
- [x] Add lint, typecheck, test, and production build configuration.
- [x] Create bilingual README files and GitHub Pages deployment workflow.
- [ ] Create and verify the initial GPG-signed foundation commit.

## Phase 1 — Domain and Solver
- [ ] Implement board types, coverage validation, and ordered clue codec.
- [ ] Implement seeded deterministic RNG.
- [ ] Implement exhaustive small-board reference counter.
- [ ] Implement finite-domain propagation and count-to-two uniqueness solver.
- [ ] Add cancellation, node/time budgets, and fail-closed result statuses.
- [ ] Pass differential, unit, and adversarial solver tests; complete Oracle gate.

## Phase 2 — Generator and Difficulty
- [ ] Implement transactional growth with unique-completion witnesses.
- [ ] Enforce row/column coverage and rollback invariants.
- [ ] Implement deterministic minimum-guess difficulty analysis and bands.
- [ ] Implement exact attempt budgets, cancellation, and diagnostic failure reports.
- [ ] Pass trace, replay, property, and benchmark checks; complete Oracle gate.

## Phase 3 — Game Core and Worker
- [ ] Implement pure game reducer and scoring/correction transitions.
- [ ] Implement completed-run/full-line/contradiction selectors.
- [ ] Implement typed Worker protocol, lifecycle, cancellation, and stale-result filtering.
- [ ] Pass state-transition and Worker integration tests; complete Oracle gate.

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
