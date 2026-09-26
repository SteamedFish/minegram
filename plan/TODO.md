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
- [x] Close the Phase 3 Oracle findings (post-win seed replay, dispose liveness, per-cell charging) and tighten the documented scoring rule.
- [x] Add `round/resume` so a board kept by a failed or cancelled generation attempt stays playable.
- [x] Resume a kept finished board as a win instead of soft-locking it (shared `roundIsComplete` win predicate).
- [x] Complete the parent Phase 3 Oracle validation gate (PASS on signed commit `0abea57`).

## Phase 4 — UI/UX
- [x] Implement localized copy dictionaries (en/zh-CN) and the pure snapshot/view-model projection layer.
- [x] Implement the pointer drag state machine with erase mode, per-drag single charge, and `Shift`+right-click cell erase.
- [x] Implement the state store and `useSyncExternalStore` hooks with worker ownership and win→next-round handoff.
- [x] Implement responsive shell, settings, status, clue rails, and board components.
- [x] Implement the plain-CSS token layer with Auto/Light/Dark themes and non-color state vocabulary.
- [x] Implement onboarding, legend, result/failure states, zoom, and accessibility.
- [x] Write the layout/board/clue/form/overlay style pass bound to the emitted DOM inventory (2,320 lines across five sheets).
- [x] Make the drag snapshot and subscription methods safe to pass detached to `useSyncExternalStore` (arrow class fields; prototype methods crashed the hook).
- [x] Fix clue clipping in both rails: keep the constrained rail axis exactly `--cell` (alignment verified at 0.0 px delta for all 15 rows and 15 columns) and fit the clue in the free axis. Measured on a real 15x15/60% board: `column-clue-0` "1 1 1 3 4" needs 93 px of clue box in a 39 px cell (54 px clipped), `row-clue-2` "1 2 1 1 1 1" needs 55 px in a 40 px cell. The column rail now spends its free axis on height (one run per line) and the row rail packs two runs per line across `--rail-col`; both drop chrome through container queries as space runs out. Re-measured worst overflow ratio exactly 1.00 at every viewport.
- [x] Fix the corner label overflowing its 68x39 box into the first column clue, the density echo wrapping `60 · mines: 135` onto 3 ragged lines (95.2x72 px), and the board bottom row clipped mid-cell (stage 642 px vs scroll client height 630 px at 1440x900). The clip had a second cause: `--cell`/`--rows` are set inline on `.mg-board-stage`, a *child* of `.mg-board-scroll`, which fits by width only, so no `max-block-size` on the scroller could ever hold. Re-measured: density echo 1 line, stage vs pane client 689.5/690 at 1440x900, 532.8/533 at 1280x620, 442.8/443 at 390x844.
- [x] Eliminate the `unknown` rail state on ordinary input. Root cause was not a slow rail: one publish-level `PatternGenerationContext` was shared by all 30 rails, so a single trip (a browser's first cold-JIT projection costs ~1.5 ms for the whole publish and ~0.6 ms for the widest legal clue, and the old 8 ms budget only survived a ~5x slowdown) failed *every* later rail closed. Fixed with per-rail budgets plus per-rail memoisation on the rail's own inputs, so one mark re-derives at most 2 rails; a budget-truncated `unknown` is never cached. Real-browser census after the fix: 0 unknown across 25 publishes over 3 rounds.
- [x] Inline an SVG favicon so the nested Pages base never 404s on `/favicon.ico`.
- [x] Cap the offered board range at 1–24 per side (576 cells). The settings form used to accept 30, but every board above 24 could only fail as `resource-limit`; the bound is the solver's per-line pattern capacity (0/24 failures at 24x24 vs 5/24 at 25x25 over 25 seeds, unaffected by node or time budgets), so `MAX_BOARD_SIDE` in `src/domain/board.ts` is now the single source of truth and the form reads it instead of a literal.
- [ ] Implement the two gameplay rules the browser probe proved are missing. The user's contract is explicit: a line whose **mines** are all marked shows itself automatically (all gaps filled in for free), and the round is won when **all mines** are marked. Neither exists: `roundIsComplete` (`src/application/gameReducer.ts:590`) requires all 225 cells explicitly asserted, and `grep reveal src/application/*.ts` is empty, so the app makes the player hand-mark 90 blanks and the only "reveal" is a cosmetic tint for unmarked cells on an all-cells-marked line (`src/ui/components/BoardSurface.tsx:723-734`). The designer's spec inherited the wrong reading (`.tmp/ui-spec.md` §5.4: "conveys *confirmation*, never new information"). Oracle gate `ora-4` is ruling on the sound formulation before implementation.
- [ ] Stop the terminal state being stated three times at once. A loss shows the visible status region ("Round 1 lost" + "Round lost. The score reached zero.") *and* the round banner ("Round 1 lost" / "The score reached zero.") simultaneously; the banner should be the one visible statement and the status region should keep it for screen readers only.
- [ ] Give the board region a pre-generate state. With no board, `--cols` is 0 and `.mg-board-stage` is an empty void roughly 690x533 px between the rails; onboarding masks it on first visit, but a player who closes the dialog before generating sees nothing but a toolbar.
- [ ] Pass component tests and desktop/mobile visual review; complete design handoff and Oracle gate.

Retracted after measurement (recorded so the audit trail stays honest): the rails were never
misaligned, and mobile 390x844 has no overflow (`html`/`body`/`.mg-app` all at `top: 0`,
`document.scrollWidth === innerWidth === 390`). Both were first-pass probe misreadings.

## Phase 5 — Release
- [ ] Verify GitHub Actions Pages deployment from a nested path.
- [ ] Run lint, typecheck, tests, build, and browser smoke/performance checks.
- [ ] Finish bilingual documentation and changelog.
- [ ] Merge topic branch, push GPG-signed `master`, and verify remote/Actions state.
