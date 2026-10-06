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
- [x] Implement the two gameplay rules the browser probe proved are missing. The user's contract is explicit: a line whose **mines** are all marked shows itself automatically (all gaps filled in for free), and the round is won when **all mines** are marked. Neither existed: `roundIsComplete` (`src/application/gameReducer.ts`) required all 225 cells explicitly asserted, and `grep reveal src/application/*.ts` was empty, so the app made the player hand-mark 90 blanks and the only "reveal" was a cosmetic tint for unmarked cells on an all-cells-marked line. The designer's spec inherited the wrong reading (`.tmp/ui-spec.md` §5.4: "conveys *confirmation*, never new information"). Oracle gate `ora-4` ruled the sound formulation first, and `revealEligibleLines` now implements it: a line is eligible when every mine in it is marked **and** it carries no wrong mark, read straight off the solution board with no pattern enumeration, so it can never fail closed on a resource limit; each pass writes `'blank'` only into a `board[i] === 0` cell and locks it, never overwrites, never charges, and is charged zero. The win gate moved **after** the reveal in `applyMarkBatch` (the batch that marks the last mine would otherwise soft-lock the round), and the reveal also runs in `round/clearMark` and `round/resume` but deliberately never in `generation/succeeded`, where every line is vacuously eligible. Two consequences were re-sequenced rather than deleted: `src/application/gameSelectors.test.ts` now asserts its wrong mark *before* its correct one (on a 2x2, marking the first mine auto-fills the rest of its row and column, leaving no free cell to assert wrongly), and `src/ui/gameStore.test.ts` has the same fixture problem, still open with the announcement wiring.
- [x] Announce the auto-revealed lines, and stop the terminal state being stated three times at once. `UiLastEvent` now carries `autoRevealedLines`/`autoRevealedCells` as counts (never `RevealedLine[]`, which a component may not import under `src/ui/layerBoundary.test.ts`); `src/ui/gameStore.ts` reads them off the reducer's `transition` result, which already reports zero for every transition that revealed nothing; `StatusRegion.tsx` subtracts the revealed cells from the count it credits to the player and names the closed lines in a separate clause, with `revealOnly*` covering a reveal-only change so the region never says "marked 0 cells". `SNAPSHOT_SCHEMA_VERSION` is 2 and four `announce.reveal*` keys exist in both dictionaries as singular/plural pairs. In a terminal state the banner is now the only *visible* statement: the status region's state and message spans take the project's own `.mg-visually-hidden`, so the polite live region keeps its text for assistive technology without `display: none`/`visibility: hidden` ever touching a `role="status"`. The `gameStore` 2x2 fixture was re-sequenced, not weakened: the wrong mark is asserted first, and a sixth assertion pins that a locked cell still refuses after the full solution. The reveal's writes are currently invisible to the accessibility diff, so a screen reader claims the player marked the machine-filled cells. `UiLastEvent` must carry `autoRevealedLines` / `autoRevealedCells` (threaded from the reducer's `transition` result through the store, not by importing `selectRevealedLines` into a component — `src/ui/layerBoundary.test.ts` rejects that), the `marks-applied` sentence must subtract them and add a confirmation clause, and `SNAPSHOT_SCHEMA_VERSION` must be bumped with a new key in both copy dictionaries. Separately, a loss shows the visible status region ("Round 1 lost" + "Round lost. The score reached zero.") *and* the round banner ("Round 1 lost" / "The score reached zero.") simultaneously; the banner should be the one visible statement and the status region should keep it for screen readers only.
- [x] Give the board region a pre-generate state. `.mg-board-empty` carries a title, a body line, and a hint, plus ten `board.empty.*` lines in en and zh-CN, and deliberately no button of its own: it reuses the settings form's Generate submit, so there is still exactly one way to print a round. Verified in a real browser: the state renders pre-generate, the board region's own controls stay the only action, and clicking Generate produces 225 cells and removes the empty state. With no board, `--cols` is 0 and `.mg-board-stage` is an empty void roughly 690x533 px between the rails; onboarding masks it on first visit, but a player who closes the dialog before generating sees nothing but a toolbar.
- [x] Fix the board fit and paint the reveal. Measured in real headless Chromium: `document.scrollHeight` was 1322 at every viewport because `.mg-board-scroll` carried `overflow-y: auto` with `max-block-size: none`, so it never scrolled and the sticky column rail resolved against a non-scrolling container; the fit at `BoardSurface.tsx` also took `Math.max(byWidth, byHeight)`, which grew a height-constrained board back out of its pane. Now `Math.min` clamped into `[24px, 44px]`, with a real `max-block-size` on the scroller. Re-measured: 15x15 at 1280x720 went from 150/225 cells visible to **225/225**; 24x24 scrolls internally with the rail pinned (it stayed at 313px while the stage moved 313 -> 158) and all 24 column clues readable at every scroll position. A closed line now wears the reveal (`data-line-revealed="row"` on `.mg-board-row`, an abspos `.mg-board-column-reveal` strip for a column).
- [x] Fix the reveal being dropped on a non-terminal commit. **The reveal was never dropped; the measurement was wrong and the sentence was broken.** Oracle gate `ora-5` re-derived the invariant `revealEligibleLines` guarantees (a line is pushed only when `written > 0`, and `revealedCellCount` sums those, so `lines.length === 1` with 0 cells is unreachable) and found the probe, not the product: `.tmp/reveal-probe.mjs` passed raw **column** numbers to the page function as cell indices, so it read `cell-8/9/14` (row 0) instead of the target row's `cell-83/84/89`, and its tint check compared the revealed row against `.mg-board-row[0]`, which *was* the revealed row. Repaired to an index map plus a comparison against a genuinely non-revealed row, the target row's 3 blanks are all `blank-locked`, `totalRevealed: 3` board-wide, `rowsRevealed: ["row"]` / `colsRevealed: []` — one pass, no cascade. The one real defect was the **status sentence**, and its blast radius was the whole game: `StatusRegion` ran one effect that both diffed the board and advanced its own diff base, and its dep array held the state the effect set, so it ran twice per commit — the first pass computed the right delta, the self-triggered second diffed the board against the base it had just stored, found nothing, and overwrote the sentence. On a commit that closed a line that read `You completed 1 line. The game filled 0 cell. Score 5.`; on **every plain mark with no reveal** it collapsed to the resting sentence, so the game never reported a marked-cell count at all. Fixed in `e67479d` — announced state moved to its own effect behind a ref mirror, the base read before it is advanced and advanced on every publish (writing it only after the guard is a bootstrap deadlock; capturing it on the first publish over-credits an erased cell), and a `diffed` ref making the diff run exactly once per event, which is load-bearing because `setLocale` republishes the same event object with a freshly projected board. Now `Marked 4 cells as mines. Wrong: 0. Score 5. The game filled 3 cell in the line you completed.` and `Marked 2 cells as mines. Wrong: 0. Score 5.`, both measured in real headless Chromium. Covered by the component's first-ever tests (`src/ui/components/StatusRegion.test.tsx`, 5 cases, four of which fail with the exact bad string before the fix) — a store-level test could not have caught it, because `src/ui/gameStore.test.ts:345-362` already pinned the store half correctly and the arithmetic lives in the component.
- [x] Pass component tests and desktop/mobile visual review; complete design handoff and Oracle gate. Oracle gate `ora-6` returned **APPROVE WITH CHANGES, no blockers**, and confirmed as already correct the parts most likely to be wrong: the auto-reveal rule, the claim that one rows-then-columns pass is the fixpoint (it gives two independent reasons — column eligibility is evaluated against the *input* marks, and a write lands only on a non-mine, so it can neither complete nor break a line), the win ordering, the layer contract, the DOM-free drag controller, the roving tabindex, the board fit's feedback-proof measurement, the per-rail pattern budget, and the `.mg-visually-hidden` terminal-state reasoning (both `display:none` and `visibility:hidden` would drop a `role="status"` subtree out of the a11y tree, so the project's clip-path technique is right). All seven should-fix items are closed:
  - **S1/S2 — the announcement guard was identity-based and therefore always open.** `projectSnapshot` re-freezes a fresh event object on every call, so `announced === lastEvent` could never hold; this broke the *render* gate as well as the effect's `diffed` ref, not only the one site the gate named. Guarding on the four fields the sentence derives from is what actually makes once-per-event work, and the publishing effect deliberately keeps the ability to republish equal content so a locale switch re-renders in the new language. (ora-6's own reproduction: on a 4x4 reference board the reducer -> store -> snapshot link is provably lossless, `{"transition":"marks-applied","autoRevealedLines":1,"autoRevealedCells":2}`.)
  - **S3 — pluralisation keyed on the wrong noun.** `marksApplied` had no singular, so one click read "Marked 1 cells"; the reveal sentences were selected on the *line* count while interpolating the *cell* count, which is the origin of "The game filled 3 cell". Both reveal sentences now carry both counts and are composed in each locale's own order (en cells-first, zh lines-first). The `Math.min(changed, autoRevealedCells)` clamp is deleted: a line is reported only when it wrote a cell, so `lines > 0` already implies `cells >= 1` and the clamp could only under-report.
  - **S4 — the reveal was silent on `round/clearMark` and `round/resume`**, which both run it, contradicting `AGENTS.md`. The clause is now appended to those branches too, and only when a line was actually filled.
  - **S5 — refusals were invisible and reasons were unprintable.** The store publishes a null-transition event carrying the reason, and a new `src/ui/reasonCopy.ts` labels all fourteen `GameResultReason` members in both locales behind a compile-time exhaustiveness assert, so a new reason cannot ship unlabelled. A free re-assertion stays silent because `AGENTS.md` makes it free and a no-op; `pendingReason` and the unread `announce.ignored` are deleted, along with a comment that claimed a behaviour the code could not perform.
  - **S6 — focus was destroyed on every round change.** The banner focused itself, then unmounted 1.2s later; the focused element left the DOM, focus fell to `<body>`, and the board's focus effect declined to act because it only ran while a cell was still in the board, so a keyboard player was dumped to the top of the document after *every* win. A permanent `ROUND_FOCUS_ID` landing target inside the board scroller is now claimed on a round change and handed focus as the banner stops rendering, which covers won -> generating, lost -> new seed, and resume -> playing (the last of which never changes the round number). The interlude is 2500ms and never elapses while the document is hidden, so a backgrounded tab cannot consume a round. The help row that promised focus lands on the banner now tells the truth instead.
  - **S7 — the store-level test the item itself demanded**, closing the link the announcement depends on.
  - **Measured while closing S5: a click on a locked cell is completely inert, and that is a ruling, not a bug.** The chain is `previewMarkBatch` (`src/application/gameReducer.ts`) *skips* locked cells, so an all-locked batch reports `affectedCount === 0`; the drag controller commits only when `affectedCount > 0`, so no dispatch is ever issued. The reducer *would* answer `ignored(state, 'locked-cell')` if asked, and the store would publish it. So the pointer cannot reach `locked-cell` at all, and `.tmp/refusal-probe.mjs` proves it in a real browser (no charge, no state change, no new sentence, and the machine reason never reaches the player). The probe originally asserted a refusal sentence, which is the one thing it could not have produced; it now asserts the actual contract. The silence is kept because it is the same rule as the already-ruling free re-assertion — an assertion that cannot change anything says nothing — the cell is visibly locked, and dispatching no-op batches would churn state for nothing and risk the drag contract the gate cleared as correct. The refusal machinery stays as defence in depth and is explicitly not to be deleted on the grounds that the pointer cannot reach it.

Retracted after measurement (recorded so the audit trail stays honest): the rails were never
misaligned, and mobile 390x844 has no overflow (`html`/`body`/`.mg-app` all at `top: 0`,
`document.scrollWidth === innerWidth === 390`). Both were first-pass probe misreadings.

## Phase 5 — Release
- [x] Verify GitHub Actions Pages deployment from a nested path. The production build is served at `http://localhost:4173/minegram/` and every one of the 2 local references in the built `index.html` resolves under that base; `npm run verify:base` asserts it in CI, and it is mutation-proven (rewriting the built HTML to root-absolute URLs produces 3 failures and a non-zero exit). The 24×24 board scrolling internally with the rail pinned, and the 15×15 board fitting fully, were both measured through this nested path rather than at the root.
- [x] Run lint, typecheck, tests, build, and browser smoke/performance checks. `tsc -b` clean; oxlint 0 errors / 9 warnings on 80 files; **516 tests across 32 files** passing; build 121 ms emitting `index.css` 51.26 kB (9.39 kB gzip), `index.js` 381.40 kB (112.90 kB gzip) and `generationWorker.js` 49.58 kB. Browser evidence against the production build: **load 258 ms, first contentful paint 276 ms, a default 15×15 round generated in 103 ms while the main thread kept painting (7 animation frames during generation)**, all 30 clue lines resolving with none left `unknown`, a real `Input.dispatchMouseEvent` mark landing in 175 ms, no console error and no failed request. `.tmp/win-mines-probe.mjs` drives two complete wins end to end and `.tmp/refusal-probe.mjs` is 17/17.
- [x] Finish bilingual documentation and changelog. Both READMEs were three phases stale — they opened with "the playable implementation is in progress" and closed with "the game reducer, Worker adapter, and playable UI remain future phases" — and now document how to play, the controls, the settings table, the difficulty bands, the transactional-uniqueness contract, and the two limits a reader is most likely to be surprised by (the 24-cell solver capacity ceiling, and the nonstarter difficulty bands being unreachable today). Constants were read from source rather than from memory, and a dangling `LICENSE` link was dropped rather than shipped.
- [x] Merge topic branch, push GPG-signed `master`, and verify remote/Actions state. `master` fast-forwarded to `3eb0bde` (all 30 commits GPG-signed) and `origin/master` matches exactly. The real Actions run then confirmed every gate on the actual runner: Install, Lint, Typecheck, Test, Build and `verify:base` all **succeeded**, so the suite is not merely green locally.
- [ ] **Deploy the Pages site — blocked on a repository setting, not on code.** The `Configure Pages` step is the only failing step, and it fails because the Pages build source has not been set to *GitHub Actions*; `actions/configure-pages` cannot enable that itself, and the repository reports `has_pages: true` with no usable site. Nothing in the repository can fix this — it needs one authenticated call to the Pages API, and no GitHub token is available in this environment (`gh auth status`: not logged in). Until it is set, `https://steamedfish.github.io/minegram/` returns 404. Set **Settings → Pages → Build and deployment → Source: GitHub Actions**, then re-run the workflow; the artifact is already built and verified, so the deploy is the only remaining step.

Retracted after measurement, recorded for the same reason as the Phase 4 retraction above: **a performance probe reported "1 clue line stuck at `unknown`", and there is no such defect.** The probe counted every `.mg-rail-cell[data-line-state]`, which includes the three `.mg-legend__swatch` elements that carry `data-line-state="complete" | "contradiction" | "unknown"` *in order to display what each state looks like* — so the `unknown` it found was the legend's own swatch. Scoped to elements that actually have a `data-testid`, all **30 of 30** real clue lines read `neutral` with zero `unknown`. An intermediate version of the same probe was worse: it sampled from t=0 before generation finished and froze at 3 elements for 3 s, which supported the opposite (and equally wrong) conclusion that a rail was permanently stuck. Three probe generations to establish that the product was never wrong, and the lesson is the same as `ora-5`'s: confirm what the selector matches before believing what it counts.

## Player-reported fixes — round 1

A real player played a round on the deployed site and reported five problems. All five were investigated in the browser before any fix; the first four are being worked by the designer, the fifth was investigated as a possible logic defect and was not one.

- [x] Make the cell states unmistakable. "未标记，和确认是空，两者颜色过于相近有点难以区分" — unmarked and confirmed-empty are too close to tell apart. Done: blank/blank-locked now fill with `--cell-settled` (was a 20%-confirm wash at 1.36:1/1.42:1 vs unmarked) plus a 1px confirm border and a larger centred dot (0.38em), and the blank-locked ring is solid confirm (was a 30% wash at 1.50:1/1.57:1, below the 3:1 floor). Measured in Chromium, both themes: blank dot vs fill 4.13:1/3.40:1, blank border vs unmarked fill 6.54:1/5.61:1, locked ring vs fill 4.13:1/3.40:1. Three channels (fill + border + glyph) separate the states; colour is never the only one.
- [x] Let the board grow beyond the viewport and make the side panels hideable. "游戏区域有点过小，建议允许两侧各种设置，图例等点击允许隐藏以放大游戏区域；游戏区域允许放大到超出屏幕". Done: fit ceiling raised 44→56px and two fixed zoom steps added (XL 56px, XXL 72px) so the board can overflow the pane, which scrolls — measured: a 24x24 board at XXL lays out at 1852×1824 in a 508×504 pane, and the sticky column rail stays pinned (rail top 353px at pane scrollTop 0/200/600 while cell 0 travels 448→248→−152px). Each side panel has its own banner toggle (`aria-expanded`/`aria-controls`, persisted to `minegram.panel.settings`/`minegram.panel.legend`), and the layout grid re-spells its template for every hidden/shown combination in all three breakpoints — measured pane width 508px ↔ 1196px.
- [x] Remove the box around a completed clue and highlight the number itself. "数字旁边的方框不美观。区域标记好之后直接数字高亮即可，不需要搞额外的方框". Done: the complete-line fill+edge box (`.mg-revealed-line` + `--clue-line-fill-complete`/`--clue-line-border-complete`, all deleted) is gone; a completed run's numeral takes confirm ink at 600 with a 2px solid confirm underline (was a dotted hairline), and a completed line's numerals take confirm ink at 700 plus the ✓ badge. Verified live in Chromium: `data-run-state="complete"` → weight 600 colour `rgb(31,93,76)`; `data-line-state="complete"` → weight 700, no cell fill, no rail edge. The numeral-first signal survives every container-query tier because it needs no box. Legend swatches now contain real numerals so the highlight is visible there too.
- [x] Make settings always editable. "打开和关闭设置按钮有点反直觉（设置框并没有打开/关闭，只是修改了是否可编辑），实际上无必要，一直允许编辑即可". Done: the editability gate is deleted — the form has no disabled fieldset and is always editable, and the banner toggle now genuinely shows/hides the panel. The round/failure banners' "open settings" button re-opens a hidden panel and moves focus to the section (covered by a new App test).
- [x] Investigate "区域标记了之后, 行列对应的数字经常没有高亮" as a suspected logic bug. **It is not one.** `.tmp/clue-highlight-probe.mjs` measured in a real browser: marking every mine of a row auto-reveals the gaps, the line reaches 15/15 marked, `data-line-state="complete"` with the ✓ glyph and 600-weight numerals; marking only run 0 of a [3,3,4,1] row fills its chip (`data-run-chip="filled"`) but leaves the numerals at weight 400 — per-run completion is signalled **only** by the small tinted chip, which is the same "ugly box" the player dislikes, and the chip is `display: none`'d below 30px/33px container widths, so on a narrow screen the per-run signal vanishes entirely. The census found zero fully-labelled-but-not-complete lines and zero `unknown` rails, and a separate 24×24 census found 48/48 rails `neutral` at load, +3s and +6s. The fix is the design fix above, not a logic change. Probe lessons recorded: React controlled inputs ignore direct `el.value =` assignment (use the native setter + `input` event); stale CDP tabs accumulate across probes (pick the tab by URL *and* recency).

## Player-reported fixes — round 2

The player played again on the deployed site and reported three problems. Two were logic
defects in this layer; one is a design problem owned by a separate lane.

- [x] Kill the raw `{step}` placeholder. "就绪缩放 {step} 之类的 placeholder" — the live region announced the literal string "Zoom {step}." The region passed `{ zoom: … }` to a template that reads `{step}` in both locales, and `interpolate` copies a placeholder it has no value for straight into the output. It survived every review because **no test ever rendered the zoom branch**: the toolbar note only fires on a *change* in `zoom`, and the only test that mounted the region never changed it. `src/ui/components/announcePlaceholders.test.tsx` now renders every status, every transition, both locales and every toolbar note, and asserts the one property that catches this whole class — a region that has finished composing has no `{` or `}` left in it. Reverting the one-word key fails three cases with the reported string in the assertion. A per-branch expectation cannot outlive a new branch; this one can.
- [x] Light a run whose mines are marked, gaps or not. "数字高亮还是有 BUG… 有个 '7 2 2 1' 的列，我已经标记好了 7 2 2，没有标记 1，只高亮了 7，两个 2 均未正确高亮". This **is** a logic defect, and the round-1 investigation was wrong to conclude otherwise. `deriveRuns` required a *proved* start (`invariant`) **and** a separator before the run already marked blank, which is a strictly stronger condition than the rule the player was given — the player marks mines, the game fills gaps, and `revealEligibleLines` already accepts a whole line on exactly that condition. `complete` is now the mark test alone, and a run's window is read off the solution when the clue cannot force a start; `start`/`end`/`invariant` still report the pure deduction. **Why the round-1 probe missed it:** it only ever marked *run 0*, and for run 0 the separator condition is vacuously true by construction (`runIndex > 0` is the guard), so the second half of the conjunction was never exercised on any run that could fail it. A probe that only exercises the boundary's first case cannot clear the rule. The player's column is now a fixture of its own, and `complete: true` hardcoded fails three tests.
- [x] Make a many-run clue legible in a small play area. "在游戏区域比较小，数字又比较多的时候，数字展示不全，无法正常游戏" — with a small play area and many runs the numbers do not fit and the game cannot be played. Done: truncation-by-count is abolished outright. The column band is sized from the round's actual longest column clue (`--rail-slots` set inline from `board.columnProgress`, minimum 2), so the band grows exactly and the `nth-child(n+7)`/`…` machinery is deleted; the row rail is a fixed `max-content` track with a single-line, right-aligned (board-adjacent) clue — the canonical nonogram layout — so every run of every row is always visible with no ellipsis tier. Numeral floor raised 9px → 10px, and it is deliberately a **flat** `--rail-num: 10px` (`src/styles/tokens.css`), not a `--cell` ratio: a cell-relative numeral would make `--rail-col` depend on `--cell`, and `--cell` is itself chosen by the fit measurement, so the ratio would close a feedback loop in which sizing the board changes the rail, which changes the board. The flat value keeps the rail independent of the fit. Measured in a real headless browser (`.tmp/truncation-probe.mjs`): 15×15 default fit and 15×15 at 520×700 (the reported configuration) render every run of every rail, 0 truncated, no ellipsis, numerals 10px, rail track 75px, column drift 0; 24×24 renders a 9-run column clue and an 8-run row clue complete, track 98px, drift 0; the stress probe (`.tmp/truncation-maxprobe.mjs`) renders an injected 12-run clue (the 24×24 maximum) with 0px overflow. The sticky column rail re-verified pinned at top 353–354px at pane scrollTop 0/200/600 on 24×24. The full clue was and remains in every rail cell's `aria-label`, and with nothing ever hidden no expansion control or extra tab stops were needed. Owned by the design lane (`src/styles/clues.css`, `src/styles/tokens.css`, possibly `BoardSurface.tsx` rail markup). Hard constraints it must not break: one rail cell stays exactly one line aligned 1:1 with its board row/column, the column rail stays sticky inside the scrolling container, the numeral-first `data-run-state` highlight survives, the line ✓ survives, and the fit/zoom loop still works at 15×15 and 24×24 in both themes. `.tmp/run-highlight-probe.mjs` R5 records the same numbers independently. **These numbers are one-off manual measurements.** The probes live in the gitignored `.tmp/` by project rule, so they are not reproducible from the repository alone; the figures above stand as the record of what was seen, and a re-run is the only way to re-derive them.
- [x] Re-run the browser probes after the design lane lands. Done, all on the built bundle: `.tmp/run-highlight-probe.mjs` **4/4** (R1 a 6-run row with 5 of 6 placed → `["complete"×5,"open"]`; R2 a 5-run column with 4 placed likewise; R3 whole-board sweep 10 lit / 114 open / **0 wrong**, with each run's expected state derived from the solution so a false `complete` also fails; R4 a zoom click leaves no `{` in the live region; R5 legibility 0 clipped numerals, 0 scrolling rails, all 30 lines, 10px, widest row clue 6 runs in a 75×32 box), `.tmp/win-mines-probe.mjs` **52/52**, `.tmp/refusal-probe.mjs` **17/17** with `consoleErrors: []` and no failed request. Then merged and pushed: master fast-forwarded `002d62a`→`858c28a` in 8 signed commits, `master == origin/master`. Gate `ora-7` = APPROVE WITH CHANGES, no blockers.
- [x] Repair `ora-7`'s required changes. **Verdict: all six closed, no blockers.** Split by file ownership, no overlap. **Parent lane (`baf6fee`, `d478dff`):** R3 — the `OrderedRunProgress` doc comments now state that `end` is *not* pure deduction, and `AGENTS.md` was corrected to match, including the fact that `complete === true` with `start === null` is unreachable whenever marks are supplied, because marking a run's window forces its start. R6 — the gate's proposed fixture (`clue: [1]`, `marks: [MINE, …]`, expecting 4 compatible patterns, `start: null`, `complete: true`) **cannot hold**: with cell 0 marked MINE only the layout with its mine at 0 survives, so there is 1 compatible pattern and the start is *forced*. The fix is pinned instead by the reachable shapes — a non-empty `mineIndices` beside a null `start` (which fails against the pre-`029dc4a` code, where that branch returned `[]`), the forced-and-complete case, and a 2-cell run with one mine marked to keep `complete` tracking the marks. R5 and should-fix 2 — the flat `--rail-num` and the one-off status of the probe numbers are now stated in the round-2 entry above. **Design lane:** R1 — the ✓ is now withheld *in React*, not by CSS, because a committed vitest test cannot observe `display: none` in jsdom and "a switch whose removal cannot be asserted is a switch nobody will believe". Its narrow CSS rule was available and was declined on that ground; the glyph span stays because it also carries the `✕`/`?` and the badge-strip geometry, and the `contradiction`/`unknown` branches are matched **before** `complete`, so an error line can never show a ✓. The contradiction badges deliberately stay on at off: a wrong mark is an error warning, not progress feedback, and `AGENTS.md` does not list it in the hint layer. R2 — the inverted `mineIndices` comment now names all three real guards. R4 — a `BoardSurface`-level test requires a byte-identical fingerprint over every cell and an identical lock array when the flag flips, in both directions, with exactly 2 revealed cells asserted first so it cannot pass vacuously. should-fix 1 — `--rail-digit` **re-measured at the true worst case** (12 single-digit runs = 23 of 24 cells, built by hand because the generator never produced it): rendered advance 6.00px per digit, so 6.2px holds with **2.38px** of clearance, 6.0px leaves **exactly 0.00px** with the first numeral's left edge on the cell's content edge, and 5.3px pushes it **5.42px outside**. The token keeps 6.2px and the comment now records the three numbers plus "do not round it down to the measured advance".
  - Accepted, not changed: the 30px horizontal scroll at 24×24 with a 10-run row clue (the pane scrolls, nothing is dropped), so `FIT_FLOOR_PX` and the band are left alone.
  - ~~Known residual, accepted:~~ **CLOSED in round 5, by a route that was not the one predicted here.** The **CSS half** of the ON layer (the nine token pairs, the off re-point, the contradiction guard) is now guarded by `scripts/style-check.mjs`, which is **committed and wired into `npm test`** as its first half, so a regression in `src/styles/` fails the repository rather than an uncommitted probe. The prediction recorded here — that closing it "needs a vitest config that could import a stylesheet as text" — was wrong about the requirement and right only about the obstacle: the blocker was never *vitest*, it was that the checks were **in** a gitignored file. Vitest still cannot import a stylesheet (`import.meta.glob('*.css', {query:'?raw'})` and `?inline` both return `''`, verified three times now), and the guard does not need it to: a plain Node script that reads the sheets from disk and parses them with **postcss** needs no bundler at all. The residual that remains is the narrower true one — a CSS-only rule still cannot be asserted from inside a `*.test.tsx`, so the stylesheet's own invariants live in one script that must be re-run, which is what `npm test` now guarantees.
  - Known residual, accepted: `--rail-digit`'s 2.38px margin was measured on Chromium's resolved mono face. A platform whose tabular figure resolves more than 0.2px/digit wider would eat it and clip the first numeral. That margin is the buffer, which is why the value is not lowered.
  - Unrelated engine observation: 24×24 at 50% density produced no board within 150s. Inconclusive, engine-side, recorded rather than chased.
- [x] `Cannot update a component (App) while rendering a different component (App)`. **Closed, and one of my two legs was worthless — corrected here so nobody re-runs it.** The item was opened from a report the design lane saw while iterating against a live `vite dev` with HMR, and Fast Refresh re-rendering modules is sufficient to emit this warning. The valid leg is a **fresh dev load**: the warning fires unconditionally in dev when a render-phase setState runs, so **0 occurrences across eight interaction points** — load, both hint-toggle directions, theme, generate, three single marks, a real five-cell pointer drag, copy-report — with 0 exceptions is a positive refutation for those paths, not a silence. The **production-bundle leg is void and was a tautology**: `npm run build` resolves `react-dom/client` to the production build, which strips the warning string entirely (1 occurrence in `react-dom-client.development.js`, 0 in `.production.js`, therefore 0 in `dist/`), so that check cannot fail and tested nothing. Its absence carries no information. Residual, accepted: the eight paths are the ones a player meets first, and settings changes, the win interlude's auto-generate, generation failure, 24×24, touch drag and the hints toggle itself were not swept — a dev-build sweep of *those* transitions would close it, and the finding to look for is a render-phase setState, not a setState-in-effect (the 9 lint warnings are the latter, which is legal and does not produce this warning). No render-phase side effect was found, so nothing was changed; "fixing" an artefact would have meant editing correct code. Re-examine the board's fit loop only if the warning reappears on a **fresh dev load**.
- [x] Correct the hint layer's description in `AGENTS.md`: it listed "the run-state chips", and there are no such chips — the only chips in the app are `AppBanner`'s status chips, which are not part of the layer, and `data-run-state` is an attribute on the numeral. Now described as the numeral's `data-run-state` treatment.

## Player-reported fixes — round 3

Two reports, both about the same thing: the assist layer is always on and its
marker is easy to miss. The player wrote 提示 for both, which the shipped code has
no single word for, so the reading was settled by what each half of the sentence
could be true of at once — 提示 is the *display of deduced progress*, because that
is the only thing in the app that is (a) unconditionally on, (b) has a 标志 to
notice, and (c) can be off without making the game unplayable. Recorded as a
ruling in `AGENTS.md` so a later reader does not re-derive it.

- [x] Make the hint layer a preference, off by default. "提示现在是默认开启的。麻烦给个选项，默认关闭，可以随时选择开启提示." Done: a `minegram.hints` stored flag beside the theme and the panel toggles, surfaced as a switch in the settings form, defaulting to **off**, readable and writable at any time including mid-round, and costing nothing. The switch is a `role="switch"` and points at the dictionary's own explanation of what off means. `src/ui/components/hintsToggle.test.tsx` (11 tests) pins the two boundaries that a well-meaning refactor would quietly break: the auto-reveal is NOT the hint layer and may not be gated by it (it is part of the original win contract, where marking the mines wins the round), and the flag never enters `SettingsDraft`, because `onChange` is the draft the generator reads and flipping a hint would otherwise reprint the seed the player had typed.
- [x] Make the on-state marker loud. "提示标志非常不明显，可以调整一下" — the tick on a finished line and the lit numeral are a tint and a hairline. Done: the on-state is now a **shape change, not a tint** — a closed run's numeral is a knocked-out digit on a solid confirm block, a closed line adds the filled ✓ badge strip (clues.css §5 "THE ON STATE", tokens `--clue-on-*`), gated by `data-hints` on the board stage. The display wiring is the lane's own: `BoardSurface` takes an optional `hints` prop (absent = on) and writes `data-hints="off"|"on"` on `.mg-board-stage`; `App` passes the stored flag. Measured in a real browser (`.tmp/hints-gate-probe.mjs`, `.tmp/hints-shots.mjs`): the solid block reads at 6.95:1 (light) / 6.58:1 (dark) numeral contrast, an unmistakable change at a glance (screenshots `.tmp/shots/hints-{off,on}.png`). **This treatment is now unconditional and is not part of the hint layer** — it is the mandatory acknowledgement for a completed run, so there is no off phase for it and the `--clue-on-*` tokens are no longer re-pointed at off. The earlier note that "OFF renders the resting treatment … the bare ✓ glyph" is superseded: that quiet variant existed only because the layer was drawn in the wrong place, and it has been removed. What remains gated is the two-annotation layer, and `data-hints` on `.mg-board-stage` now reaches only that. Screen-reader labels stay truthful in both states; presentation alone is gated.
- [x] **Deployed and re-verified against the live artifact, not a local build.** master fast-forwarded `858c28a` → `bb519a8` in 5 signed commits and pushed; the live site began serving `index-u-gZN2qk.js`, which is the exact build verified locally. Re-run against `https://steamedfish.github.io/minegram/`: the hint gate is 4/4 in both themes (off → `glyphs ["",""]`, `onGround: transparent`, 0 numerals filled; on → `["✓","✓"]` filled), and the core win contract holds — a probe that marks **only** the mines, solving every clue from the DOM, finishes with `failed: []`, `skipped: []`, `consoleErrors: []`, `exitCode: 0`. No 404s, no exceptions.
- [x] ~~Withhold the ✓ when the layer is off~~ — **wrong, shipped, and corrected by the player. Read this entry as a record of the error, not as a decision.** I gated the ✓ and the run numeral's on-state behind `minegram.hints`, reasoning that the layer was "the display of deduced progress" and that an off switch that left the loudest cue standing had "relocated the complaint rather than answered it". The player answered: "你错误理解了我的意思。一个雷区完成标记之后，对应数字高亮，这是必须要做的，不属于提示。但是 虚框提示，也就是图例里面的 矛盾提示 格虚线边框加叉号 / 进度未解 提示格点线边框加问号 应该默认关闭." The layer is **exactly the two dashed/dotted annotations**, named in the legend's own words — 矛盾提示 (✕) and 进度未解 (?). The complete-run numeral highlight and the line's ✓ are 必须做的, and the fact I had already recorded myself, that a clue numeral "cannot be off" because turning it off makes the game unplayable, was the whole answer sitting in `AGENTS.md` while I widened the gate past it anyway. So the React-level withhold technique is kept and pointed at the other two marks: a committed vitest test cannot observe `display: none` in jsdom, so a CSS-only switch could only ever be checked by an uncommitted probe, and a switch whose removal cannot be asserted is a switch nobody will believe. What changed is *which* switch is in React. The `aria-label` stays unconditional in both phases — it is the only channel of state a screen reader has, and gating it would delete information rather than present it differently. `BoardSurface.test.tsx` now pins all four phases (off/on × the glyphs present), so a gate that grows again fails a test instead of needing someone to notice.

## Player-reported fixes — round 4

Two reports, both about the clue rails, and the first one is a question rather
than a complaint: 「段落位置已定 这个应该也属于提示？」 and 「数字实在太小了，放大游戏
区域不放大数字格子，数字很难看清」.

- [x] **Rule on the layer's membership, from the code rather than from the word.**
  Answer: yes, the open run's position tape belongs to the layer. The
  ground is `RunGuides` in `src/ui/components/BoardSurface.tsx` — it returns
  `null` unless `run.invariant`, and only then paints `data-run="tape"`, so the
  tape says *the solution pinned this run's window*, which the player has not
  done and cannot see. The **closed** run's tape, the filled numeral and the line's
  ✓ are keyed off `run.complete`, which is derived from the player's own marks, so
  they stay 必须做的. The layer is therefore the annotations keyed off **machine
  inference**, and the membership test for any future candidate is: name what the
  machine deduced, or name what the player finished. Recorded as a ruling in
  `AGENTS.md`. Note the previous grounding — the word 提示 occurring in exactly two
  legend cues — reached the right answer for the wrong reason and would have kept
  the tape outside the layer permanently; see the lesson below.
- [x] Gate the position tape behind `data-hints`, in React. `RunGuides` takes
  `hints` and renders nothing for an open run at off, while a complete run renders
  at both settings. React rather than CSS because a committed vitest test cannot
  observe `display: none` in jsdom, so a CSS-only switch ships unguarded — and this
  is the standing residual on this project. `runTape` joins the legend's gated set
  so its row carries the 提示 pill; the legend swatch itself keeps the true form,
  because a key must teach the shape. Shipped as the withhold
  `if (hints === false && !run.complete) { return null }`, placed AFTER the existing
  `run.invariant` guard, so the order of the two guards encodes the two answers:
  no pinned window paints nothing regardless, and a pinned window stays silent at
  off unless the player has already closed it. Measured on the BUILT bundle in both
  themes: open tapes 0 → 34 → 0 across off/on/off, with the numerals, glyphs and
  all 30 aria-labels byte-identical across the three phases. The one tape that
  survives a document-wide count is the LEGEND's own key, which carries no
  `data-hints` on purpose — see the lesson about believing what a selector counts.
- [x] Fix the zoom steps never painting, found while measuring the scaling. The
  fit's own probe leaves its LAST candidate on the stage, React then sees the value
  it already holds and bails out of `setState`, and nothing re-renders. So the six
  zoom steps all painted 32px with 10px numerals — the player's complaint surviving
  its own fix. The fit effect now returns early when the stage is not in fit mode.
  Measured after: `--cell` paints 32/26/32/40/56/72px across the six steps and the
  numeral 10/10/10/12/16.8/20px.
- [x] Fix the 3px chrome bias in the fit, found by the same measurement. The fit
  charged `pane - grid`, which never pays for the stage's own chrome: two 1px
  borders plus the rails row's 1px `border-block-end`, all outside the corner
  cell's box. On a 1×1 board that 3px bias ratcheted 32 → 35 → 38 → … → 56, so the
  fit could never settle on a small board. `stageChrome` now reads those PARTS
  (computed border/padding on the stage, plus `railsRow.offsetHeight -
  corner.offsetHeight`) rather than inferring them, and 1×1 paints 32px where the
  old one-pass solve painted 35px.
- [x] **Make the rail numerals scale with the board.** 「数字太小」. `--rail-num` is a
  flat `10px` **by design**, and the recorded reason is that a flat value "closes
  the fit loop on paper" so the host's fit measure cannot chase its own output
  (`tokens.css`, the `--rail-num` block). That is a convenience, not a proven
  necessity: `--cell` is `clamp(--cell-min, floor((scrollerInline - --rail-col) /
  cols), --cell-max)`, `--rail-col` grows ≈0.6px per px of cell, so the map's slope
  is ≈ −0.6/cols and a bounded fixed point exists — a monotone CONTRACTION, not a
  feedback loop with no fixed point, and the comment saying otherwise has been
  superseded in place rather than deleted. Shipped as
  `--rail-num: clamp(10px, calc(var(--cell) * 0.3), 20px)` with
  `--rail-digit: calc(var(--rail-num) * 0.62)`, `--rail-badge: var(--rail-num)`, all
  four re-declared on `.mg-board-stage` because a custom property substitutes its
  own `var()`s **where it is declared** (at `:root`, `--cell` is still 32px and the
  re-declaration would be a no-op). The fit now iterates to a verified fixed point
  over at most `FIT_PASSES = 4` and paints nothing at all when it has not
  converged, rather than painting a value it is still arguing with.
  The trap was closed rather than repeated: `--rail-digit` is a **function** of
  `--rail-num`, not a scaled constant, and the per-digit margin is now 0.20/0.24/
  0.34/0.40px and GROWING with the numeral, because the advance is exactly 0.6em at
  every size. Re-measured on the built bundle, the 12-single-digit-run case a
  24-cell line can hold clears by 2.40px at the smallest step (fit/s/m, numeral
  10px) and 2.88/4.03/4.80px at l/xl/xxl, against a pre-change figure of 2.38px
  and a 0.00px landing at a 6.0px digit. The worst case is now the SMALLEST numeral,
  not the largest, because the budget's 3px leading constant does not scale — which
  is the opposite of the assumption the old flat value encoded.

## Player-reported fixes — round 5 — Android tablet / small screen

One report, and it is a brief rather than a defect: 请优化一下 android pad
（小屏幕）的体验 — optimise the Android tablet (small screen) experience. So
this round opens by MEASURING what the layout does at real tablet viewports,
because an optimisation brief with no measurement in it is a redesign by
taste. `.tmp/small-probe.mjs` drives headless Chromium over CDP; `maxBlock` is
`.mg-board-scroll`'s `max-block-size: min(70vh, 46rem)`.

**A correction to the first survey below, which was measured in the wrong state.**
The two side panels are hidden behind a PERSISTED flag (`minegram.panel.settings`,
`minegram.panel.legend`), and the probe reuses one Chromium profile across every
round, so an earlier run left them `'false'` and the whole first survey measured a
state no player arrives in. The table immediately under this note is the CORRECTED
one, taken with both panels explicitly opened. What the hidden state produced, and
what it cost:

- It reported the left panel as **0px at every tablet width** and that became
  round-5 "defect 5". With the panels open the left aside measures 737px at
  800×1280, 569 at 600×960, 381 at 412×915 and 240 at 1280×800. **Defect 5 is
  withdrawn — it was never a defect.**
- It reported `keyOwnScroll false` at every viewport, which read as "the `--key-cap`
  bound is inert". With the panels open the computed `max-block-size` is 768px at
  800×1280, 576 at 600×960, 549 at 412×915, all with `overflow-y: auto`. **The bound
  is live.** A boolean read off a `display: none` aside is not a measurement of the
  thing the boolean names.
- It UNDERSTATED landscape. Fold slack is now −151px at 15×15 and −201px at 24×24,
  so the board's bottom edge is off-screen when the player arrives, in the most
  natural posture a tablet has.

**Corrected survey — both panels open, on the built bundle.** `slack` is
`window.innerHeight − pane.getBoundingClientRect().bottom` read at scroll 0, where
the player arrives; negative means the board is below the fold. The board is
`[data-testid="board-scroll"]`, which is also the element carrying `max-block-size`.

| viewport | 15×15 cell / numeral | 15×15 slack | 24×24 in view | 24×24 slack | banner / footer / toolbar |
|---|---|---|---|---|---|
| 800×1280 (10" portrait) | 40px / 13.6px | +278 in fold | 576/576 | +261 in fold | 108 / 58 / 90 |
| 800×1100 (portrait + chrome) | 40px / 13.6px | +98 in fold | 576/576 | +81 in fold | 108 / 58 / 90 |
| 1280×800 (10" LANDSCAPE) | 37px / 12.58px | **−151 NOT in fold** | 529/576, pane scrolls XY | **−201 NOT in fold** | 108 / 58 / 90 |
| 600×960 (8" portrait / split) | 29px / 12px | +78 in fold | 396/576, pane scrolls XY | **−79 NOT in fold** | 142 / 58 / 130 |
| 412×915 (phone floor check) | 24px / 12px | +14 in fold | 210/576, pane scrolls XY | **−176 NOT in fold** | 190 / 98 / 166 |

Portrait's page scroll is now 1759–2195px, because the settings sheet (1112–1140px
of content) and the key (768–828px) stack BELOW the board — the board itself is
above the fold in all three portrait viewports, which is the fact that matters and
the reason `vPageScroll` is the wrong headline metric in a portrait layout. 412×915
at 15×15 shows 165/225 in view with the pane panning inline.

Touch targets (`button, [role=switch], [role=button], .mg-cell, a[href], input,
select`), both panels open: **259** at 15×15 and **610** at 24×24. Under 44×44 —
251 and 602 respectively, at EVERY viewport. Under 24×24 — **3, all
`mg-field__checkbox` at 13×13**. The board cells cannot reach 44 at any measured
viewport (see defect 2), so 44×44 is available on the `xl`/`xxl` zoom steps, which
disarm both pan axes; the sub-24px floor is a real miss and is not about the board.

The app has exactly one width breakpoint: `src/styles/layout.css:83
@media (width >= 74rem)` and `:353 @media (width < 74rem)`. 74rem is 1184px, so
"narrow" spans 320px–1183px and a 400px phone takes the identical branch to an
800px tablet. There is no tablet-specific design in the app at all.

- [x] **Survey the small-screen layout before designing for it.** Done; the
  numbers are above. The board is NOT the problem in portrait — 800×1280 gives
  41px cells and 12.3px numerals, better than the 1440×900 desktop. The damage
  is elsewhere, which is the reason measuring first was worth it: three of the
  five defects below are invisible at the desktop viewport I had been tuning
  against, and the worst one only appears when the device is rotated.

- [x] **Defect 1 — landscape is worse than portrait, and self-contradictory.**
  At 1280×800 the page scrolled 163px while the cap had ALREADY reserved 240px
  (30% of the viewport) for chrome, so the reservation was both too large and not
  large enough. The board also SHRANK on rotation (41px/12.3px → 32px/10px) while
  1191px of width sat ~80% idle. Fixed, and the cause was not the layout at all:
  the fit's fixed-point walk is DECREASING (`--rail-num` is a function of
  `--cell`, so a bigger cell buys a bigger rail and leaves less room), so it
  settles into a 2-cycle that `next === cell` can never detect. Measured trace at
  1280×800: `32→40→39→40→39`, budget exhausted, `converged: false`, and the
  effect's response to that is to paint NOTHING — so the board was frozen at 32px
  with 128px of the pane's cap unspent, permanently, because every later resize
  walked the same cycle and failed the same way. Cycle detection in
  `settleFitCell` (`src/ui/components/BoardSurface.tsx`) now settles it at the
  SMALLER member of the cycle, the one that cannot overflow. Measured after:
  cell 32→40px, numeral 10→13.6px.

- [x] **Defect 1b — the board's bottom fell below the fold in landscape. FIXED by
  making the app one screenful, not by lowering the cap** (`b5e5b32`). The cap
  route was measured first and is arithmetically dead: at 527px the pane became
  515px and the cell fell 39 → 29 with the board still 70px below the fold; at
  455px the cell fell to 25 and the bottom was still 10px below. A 15×15 at the
  24px floor needs 440px of stage and this viewport's chrome is 402px before the
  board has any room at all, so 842 against 800 — the fold is out of reach, and
  the cap route buys 158px of a 227px deficit for a 26% smaller board. The space
  was bought from the page's height instead, in four sheets, gated on
  `pointer: coarse and width >= 74rem and height < 56rem`: `.mg-app`
  `block-size: 100dvh` with rows `auto minmax(0,1fr) auto`, `min-block-size: 0`
  on `.mg-main` (a grid item's automatic minimum is its content's, and the
  surface's content includes the pane's), the same rows on the surface,
  `max-block-size: none` on the pane, and chrome trims including
  `.mg-banner__tagline { display: none }`. Measured coarse with both panels open
  at 24×24: `vPageScroll` **0** at 1280×800, 1280×720, 1366×768 and 1440×880, the
  board wholly in the fold with **+117px** of slack, 0 console errors; at 1440×880
  the pane is 522 against a 522 stage, so nothing pans at all. The cost is the
  cell and it is named: 39 → 24px at 1280×800, 44 → 29px at 1440×880, which is the
  price of not asking a finger to scroll a page and is the floor the fit already
  refuses to pass. The zoom steps (`l` 40px, `xl` 56px) remain the escape hatch
  and arm both pan axes. Two boundaries are load-bearing and both were measured:
  the width floor, because below 74rem the panels are rows under the board and
  the band collapsed the pane to **0px** at 1024×768 and 960×600 — a band that
  zeroes the board is worse than no band; and `pointer: coarse`, because a mouse
  user pays the whole cost for a benefit only a finger can use (44 → 29px at
  1440×880 with the gate lifted).

- [x] **Defect 1c — the band had a one-pixel cliff, and a new instrument is what
  found it. CLOSED in `928ad35` by removing the condition that made it a cliff.**
  How it was found: the band's `height < 56rem` = 896px ceiling WAS the cliff, and
  the survey had been reading the app's worst state at 1440×896 (`vPageScroll` 780px,
  −86px of slack, 10px numeral) next to its best at 1440×880 (0, +117px, 12px).
  The height condition is GONE from all four carriers, which now all read
  `@media (pointer: coarse) and (width >= 74rem)` (`layout.css:708`, `board.css:193`,
  `overlays.css:118`, `forms.css:801`). Measured `vPageScroll` before → after:
  **776→0** @1184×900, **652→0** @1280×1024, **780→0** @1440×896, **476→0**
  @1440×1200, **76→0** @1440×1600, 0→0 at 1280×800/1280×880/1440×880. There is
  now no height at which the band stops being correct.
  **The second cause of the cliff was NOT the media condition, and this is the part
  worth keeping.** Measured with the ceiling dropped at 1184×900: the settings
  sheet's **Generate** button sat at content-y 1445 of a 900px window with
  `visible: true`, `insideApp: true`, `inViewportNow: false`,
  `reachByScrolling: false` — a primary action that exists and cannot be reached.
  `align-items: stretch` in a `100dvh` shell makes the middle grid row a DEFINITE
  height, and an aside taller than its row with `overflow: visible` neither shrinks
  nor scrolls: its content runs past the row and past the app's own box, and since
  the app is exactly `100dvh` there is no page scroll left to give it. The height
  ceiling had been silently holding this up. The band now bounds each aside with
  §6c's exact four properties (`layout.css:758-763`: `max-block-size: calc(100dvh -
  var(--sp-4) - var(--sp-5)); overflow-y: auto; overscroll-behavior: contain;
  min-block-size: 0`).
  **The band DROPS the pane's cap rather than raising it**, because
  `fitCellAt` computes `available = Math.max(paneBlock, paneBlockCap) -
  blockChrome - railBlock` — a cap is a FLOOR for the pane, never a ceiling, so
  "raise the cap to buy fold space" buys the opposite of space. The cap is made
  `max-block-size: none` inside the band on the ground that a cap on a pane the
  grid is already sizing "is a second, stale answer to a question the layout has
  answered".
  The cost is named and confined: at 1440×896 — the window the old ceiling
  excluded, so the band is at its most expensive there — pane 613→490, cell
  36→28, and a 24×24 pans in the block axis (pane 490 vs a 706px stage). At
  1440×1200/×1600 it costs nothing (panes 794/1194, no pan, cell 40). At the
  extreme (1280×600, 1184×600, 1440×400) it degrades to a letterbox rather than a
  defect: the cell sits on its 24px floor, the pan is armed, 124/124 and 300/300
  runs stay readable, and every control is reachable. Height is a GRADIENT, not a
  second cliff: the pane is the leftover after ~320px of chrome.
  Two boundaries are load-bearing and both are pinned by measurement: `pointer:
  coarse`, because a mouse user pays 44→29px cells at 1440×880 for a benefit only a
  finger can use; and the `74rem` width floor, because below it the panels are rows
  and injecting the band collapsed the pane to **0px** at 1024×768 and 960×600.
  One consequence recorded in `BoardSurface.tsx:354-362`: the fit's block-axis
  fallback `const byHeight = available > 0 ? Math.floor(available / rows) : byWidth`
  answers a zero-tall pane FROM ITS WIDTH, so a collapsed shell would paint
  oversized cells in a box with no height. The band's width floor is what prevents
  that, not the fit.

- [ ] **Defect 6 — below ~750px wide the control strip wraps to three rows and the
  chrome is most of the screen.** OPEN, with des-5. Measured coarse, 11 controls,
  `flex-wrap: wrap`, `overflow-x: visible`, 0 controls offscreen — so nothing is
  hidden, the strip simply stacks, and rows are counted as distinct child tops:

  | viewport | toolbar | rows | banner + status + toolbar + footer | % of vh | 15×15 slack | 24×24 slack |
  |---|---|---|---|---|---|---|
  | 800×1280 | 711×114 | 2 | 126+42+114+70 = 352 | 28% | +236 | +219 |
  | 600×960 | 543×166 | **3** | 178+42+166+70 = **456** | **48%** | **+6** | **−151** |
  | 412×915 | 355×214 | **3** | 226+42+214+122 = **604** | **66%** | **−70** | **−260** |
  | 360×800 | 303×214 | **3** | 604 | **76%** | **−185** | **−290** |

  The band's own trim takes the strip to 102px in 2 rows, which is why no
  landscape number shows this; in portrait the strip is untouched, and at
  600×960 — the 8" pad, the closest thing to what the player asked for — the
  board clears the fold by **six pixels** at 15×15 and misses it by 151 at 24×24.
  The banner grows with the wrap (126 → 178 → 226), so the strip and the banner
  charge the player twice for the same narrowness. Ruled out by the parent in the
  brief: a toolbar that hides controls behind a horizontal scroll the player has
  to discover, on the same WCAG 2.5.1/2.5.7 reasoning already in force for board
  drags, and any answer that buys chrome by making the board smaller.

  **The strip half CLOSED in `928ad35`; the banner half stays open.** The strip's
  own content box decides, not the window, and the two disagree: 1184×900 gives a
  1184px window but a **436px** strip, because the `>= 74rem` template spends 640px
  on two 20rem panels. Strip widths: 277 @360×800, 329 @412×915, 436 @1184×900,
  517 @600×960, 692 @1280×800 and @1440×896, 852 @1440×880, 845 @960×600,
  909 @1024×768 (±2px between runs). Group arithmetic untrimmed at 800×1280 (strip
  683, the trim inert): mode **195** + gap 16 + zoom **366** = **577**; trimmed to
  `--sp-1`: **150** + 16 + **307** = **473**. So `36rem` = 576 is the measured width
  at which the untrimmed pair stops fitting — 577, to the pixel — and
  `(width < 36rem)` reaches that region and nothing above it. Implemented as a
  CONTAINER query (`forms.css:507` `container: toolbar / inline-size`, plus §6a
  `@container toolbar (width < 36rem)` at `:611`) rather than a media query,
  because the strip's width is decided by the grid, not the window, and a media
  query would have to be re-derived at every template. Results: 600×960 **3 rows /
  166px → 2 rows / 114px**; 412×915 3 rows/214px with the zoom group a **329×92**
  box → 3 rows/**166** with the group **307×44**; 360×800 unchanged (the group's
  own 307 exceeds a 275 strip, and zero padding would "reach" one row at 328
  against a 327 strip — a rounding accident that would also make the pills touch);
  1184×900 unchanged (473 > 436). The expensive half was the second loss: a group
  wider than the strip does not become one clipped row, it WRAPS INSIDE ITS OWN ROW
  SLOT — 92px of box for a 44px row and 48px of nothing. Rejected with arithmetic:
  horizontal scroll (NOT-ACCEPTABLE, WCAG 2.5.1/2.5.7), micro type (buys no row),
  `flex-wrap: nowrap` (binds only below 286px of strip). Not pointer-gated — and
  that was checked with a fine pointer rather than assumed: the same 517px strip
  gives untrimmed 574, trimmed 436, two rows at 90px instead of 114px. Nothing is
  hidden by trimming padding, because each pill's text IS its label and each
  group's name comes from `aria-label` on the `role="radiogroup"`.
  §8a also MOVED to sit immediately after §8 (`forms.css:765`), because §8 is a
  `(pointer: coarse)` block that owns `.mg-toolbar__mode`; a future `.mg-toolbar`
  line inside §8 would otherwise win on source order and silently stop the trim.
  **STILL OPEN: the banner**, 226/226/178/126/100px at 360/412/600/800/1184, which
  charges the player a second time for the same narrowness. It lives in `App`'s
  banner markup, which the lane's write scope excluded, so it was not touched.

- [x] **Defect 2, in the part that is reachable — no touch target reaches 44×44,
  and the board cells cannot.** 251 of 259 targets at 15×15 and 602 of 610 at
  24×24 are under 44×44, at every viewport. The board's own cells are the bulk of
  that and the ceiling is arithmetic, not preference: 15×15 at 44px needs 660px of
  grid plus ~75px of rail chrome = 735px inline, which fits 800 and neither 600 nor
  412; 24×24 at 44px needs 1056px plus ~97px, exceeding every measured viewport in
  both axes. So 44×44 is available on the `xl`/`xxl` zoom steps (measured `xl` at
  1280×800 = 56px), which is the deliberate escape hatch and which des-5's pan-axis
  work made safe by disarming both axes. The coarse-pointer band raises the
  banner's panel disclosure, the footer's theme select and the footer's source link
  to 44px — the last two because a class rule at `forms.css:534` sized the select
  and beat `base.css`'s bare `select { 44px }`. STILL OPEN, and the only part
  actually in reach: **3 targets under 24×24**, all `mg-field__checkbox` at 13×13,
  the settings form's checkboxes. The known obstacle is that `primitives.tsx`
  renders `<input>` and `<label htmlFor>` as SIBLINGS in a 2-column grid, so the
  comment claiming the label wraps the control is false, and a native checkbox
  draws shadow content at the input's own size. A 24×24 input is a CSS change if
  the layout tolerates it; 44px would need the label to be the hit area, which is
  a component change.

- [x] **Defect 3 — below ~700px the numeral was back on its 10px floor**, so
  round 4's 「数字实在太小了」 was still present on an 8" tablet at default fit
  (600×960 → 30px cell → 10px). The floor and the ratio are now TOKENS
  (`--rail-num-floor`, `--rail-num-ratio`) and 12px/0.34 is spent in three bands:
  `width >= 48rem and width < 74rem`, the landscape band, AND the phone band
  `width < 48rem` that the first pass omitted. Measured with the panels open,
  15×15: 800×1280 40px cell / 13.6px numeral, 800×1100 40 / 13.6, 1280×800 37 /
  12.58, 600×960 29 / 12, 412×915 24 / 12. The phone band's floor costs the fit
  0.62 × 2px per column of rail, which it already counts, and 1px of cell at
  600×960. That the SMALLER board had the SMALLER numeral was the defect — the
  whole point of a floor is that it decouples legibility from the cell — and it
  is now monotonic in the right direction across all five viewports.

- [x] **Defect 4 — 24×24 on a small screen scrolled in two axes inside a page
  that also scrolled**, so a flick started on the board could move the page and
  leave the board apparently still. The pane now ARMS ONE AXIS AT A TIME: the
  axis with something to give is the one it keeps, and the other is released to
  the page (`panAxesFor` + `data-pan-block` / `data-pan-inline` on the pane, with
  `overflow-inline: hidden` on the disarmed axis — `hidden`, not `clip`, because
  `clip` is non-scrolling in Chromium and this is where the column rail's
  stickiness is bought). Measured with 12-step touch swipes at 412×915, 15×15:
  before, a vertical flick started on the board moved the board **0px** and the
  page 268px; after, the same flick moves the board and leaves the page at 0,
  while a horizontal flick still pans the board its full 77px. A 24×24 at 412×915
  arms BOTH axes (210/576 in view) and that is not fixable — a 24×24 is 684px of
  grid against a 355px pane, so no cap can hold it, and the zoom steps, which
  disarm both, are the escape hatch.

- [x] **Defect 5 — WITHDRAWN. The left panel was never 0px at a tablet width.**
  It measured 0 because the panel-hide flag is persisted and the probe's shared
  Chromium profile had it off, so the whole first survey ran against a state no
  player arrives in. With both panels open the left aside is 737px at 800×1280,
  569 at 600×960, 381 at 412×915 and 240 at 1280×800 — full width in every
  portrait band, a proper column in landscape. The banner's two
  `.mg-banner__panel-toggle` controls and the persisted hide remain as they were;
  there is no information-architecture work to do here.


- [x] **Defect 6 — CLOSED in `7575acc` (strip) and the banner half, and the last
  thing the small-screen bands were for: the rail numeral was a STEP, and it is
  now a ramp.** Every other item in this round is chrome, and this one was legibility.
  What the bands had done was reach the numeral with a WIDTH literal — `--rail-num-floor:
  12px` in `width < 48rem` and in `48rem <= width < 74rem` — so a step sat in the
  middle of a quantity the player reads as continuous. Measured consequence on the
  same 15×15, coarse: **800×1280 painted 13.6px while 1184×900 painted 10px**, a
  narrower window with a larger digit, and the `>= 74rem` window got the *floor*
  the phone was supposed to have raised. The touch band's own comment promised
  "a one-pixel difference must not flip a numeral from 12px to 10px" and was
  **false at its own edge**: 1440×880 painted 12px, 1440×896 painted 10px.
  `--rail-num-floor` is now `clamp(10px, calc(10px + (100dvh - 37.5rem) * 0.02), 12px)`
  and `--rail-num-ratio` is `0.34` app-wide; both number-sized bands are DELETED and
  the landscape band keeps only `--side-col` and `--board-cap`, the two values that
  are about the panels. So the numeral is `clamp(floor(window height), 0.34 × cell,
  20px)` — two inputs, both monotone, no media query anywhere in it. Measured after:
  **12px at every viewport measured**, 1440×896's inversion gone, the ratio's 0.34
  costing nothing (at 1440×1200 the numeral goes 12 → 13.6 and the rail's first
  track 687 → 693 inside a 700px pane).
  **The 700px line is the measured knee, not a tidy number.** Pinning the floor to
  12px and re-solving at each height (the pin charged through the same
  `ResizeObserver` the fit uses) costs **zero** visible cells at 700 and 780px of
  window at both 1184 and 1440 wide — 135/135 and 180/180 at 1184, 165/165 and
  210/210 at 1440 — because the pane is already shorter than the board there, and
  **15 cells, one row**, at 650 and 600 (105 → 90 at 1440×600, 75 → 60 at
  1184×600). 700 is exactly where the larger numeral becomes free, and 10px is a
  floor rather than a third stop because below 600px the pane is 194px tall and
  the board is dragged through it whatever the type does. The one honest caveat is
  written down in `tokens.css`: `100dvh` moves when a mobile browser's chrome moves
  and the ramp's live range is 100px wide, so in that one band the numeral can
  follow the chrome.
  **The band half of defect 6, and the banner.** The banner grows as the window
  narrows (100/126/178/160/226/226/208px at 1184/800/600/480/412/360/320) and its
  term-by-term measurement shows exactly three terms: 24px block padding, a 12px
  gap, and the tagline at 28px on two lines — the tagline being the only one that
  is CONTENT rather than air. `@container banner (width < 24rem)`
  (`layout.css`, `container: banner / inline-size` on the banner) spends it for
  **32px**, measured 226 → 194 at 360×800 and 412×915, 208 → 176 at 320×800, with
  the wordmark 58 → 26, the row unchanged at 130, the padding still 12/12, and the
  gate INERT at 480 (160 → 160). 24rem is arithmetic: the sentence needs 349px on
  one line, and the banner's own content box is 270/295/347/415/535/703 at a
  320/360/412/480/600/800px window, so the gate sits between the demand and the
  first width that fits it.
  The strip's other half: the zoom group was not "too big", it was **wrapping inside
  its own row slot** — 92px of box holding 44px of pills and 48px of nothing,
  because a group wider than the strip does not become one clipped line.
  `@container toolbar (width < 20rem)` (`forms.css` §6b) closes it with
  `column-gap: 0` on `.mg-toolbar__group` and `padding-inline: 2px` on
  `.mg-toolbar__zoom`, reaching 275 against a 279px content box at 360×800:
  **toolbar 214 → 166, group 277×92 → 275×44**, 412×915 unchanged at 166 with the
  group 307×44, which is the point of the gate. A zero gap is not the pills
  touching, and that was measured rather than asserted: what meets is two 1px
  **borders**, not two words — `Range.getClientRects()` on each label gives
  ink-to-ink gaps of 13.3, 6, 6, 17.2, 24.5px against 19.3, 14, 14, 23.2, 28.5px
  where the rule is inert, so the tightest pair of words in the app under this rule
  is 6px apart, and it is 6 rather than 0 because a centred label carries the
  typeface's side bearing inside a box 4px wider than the word. All six pills stay
  ≥ 44px wide, nothing is hidden, and no name changes.
  **Item 2 needed no change and I say so rather than adding the property for its
  own sake: the 320px floor is already there**, at `src/styles/base.css:65`
  `min-inline-size: 320px; /* the narrowest phone in portrait */`, and it is
  load-bearing in a way a new `min-inline-size` on the shell would not have been —
  the fit's inline guard (`BoardSurface.tsx:388-391`) means a window under 320px is
  not cramped, it is **unpainted**. That is why 280×800 and 320×800 measure
  identically: both render the 320px app and the page pans.
  **What this round does NOT buy, stated plainly: not one visible cell.** `inView`
  and `--cell` are unchanged at 360×800, 320×800 and 412×915, and at 24×24 on a phone
  −277 → −245 and −440 → −360 with the cell still on its 24px floor. The board is
  content-sized and the fit has already put the cell at its floor, so the 32px buys
  the **FOLD** — the board's bottom edge 185px below it at 360×800 and 19px at
  412×915 before, so 32px is 17% of the first figure and more than half of the
  second. At 412×915 the fold slack goes **−11 → +21**, i.e. the board now fits
  above the fold. Nothing above 600px moved a pixel: banner, toolbar, footer, pane
  and `vPageScroll` are byte-identical at 600×960, 800×1280 and all five ≥1184
  viewports, `hOverflow` 0, and Generate reachable everywhere.
  **Validation, and the part that is mine rather than the lane's.** The nine
  `style-check` assertions this change broke were **stale checks, not
  regressions** — they pinned the two bands the change deliberately removed — and
  deleting them is how a change like this loses its evidence, so they were
  rewritten to pin the new structure and §18 was added. I did not take the lane's
  "six mutations, all caught" for it: I reintroduced a deleted `--rail-num-floor`
  band into `tokens.css` myself and counted **4 failures**, then restored and got
  ALL CHECKS PASS. §18 is not vacuous, verified independently.

## Player-reported fixes — round 6 — locale authority and template placeholders

The report, verbatim, is one screen of chrome from a zh-CN player, and it
contains two separate defects: an ENGLISH sentence inside Chinese chrome, and
a raw uninterpolated `{round}` placeholder in a button.

```
生成失败
生成已停止：The requested difficulty was not reached
第 2 局仍在
棋盘原样保留，可以接着玩。

继续第 {round} 局
```

Both are copy-projection defects, and both hazards were already written down
before they shipped: the locale one at `src/ui/viewModel.ts:670` ("a
non-default `copy` must also pass `locale` or reason copy stays English") —
documented and not enforced — and the placeholder one as the round-2
`{step}`/`{zoom}` class, whose fix swept only the announcement path.

**Defect A — the store's dictionary was stuck on English while the UI rendered
Chinese.** `src/App.tsx:58` creates the singleton store with no locale, so its
`locale` is `DEFAULT_LOCALE` (`'en'`) and its `copy` the English dictionary
(`src/ui/gameStore.ts:235-236`). `useLocale`
(`src/ui/components/preferences.ts:26-47`) seeds its React state from persisted
storage (`minegram.lang`) but called `store.setLocale` only inside the
language-change callback — there was no mount-time push. So a returning player
who had chosen zh-CN had `locale === 'zh-CN'` in the tree (Chinese chrome)
while the store still held `'en'` — and every `projectSnapshot` call projects
with the STORE's closure `copy`/`locale`, so failure headlines, remedies,
announcements and reason labels all came out English. The player saw
`生成已停止：The requested difficulty was not reached` where the dictionary has
`没有达到所选难度` (`src/ui/copy.ts:1132`).

The ruling (recorded in `AGENTS.md`): the store is the single source of truth
for locale, and a persisted preference must be APPLIED to the store on mount.
`useLocale` now carries a one-way sync effect that calls
`store.setLocale(locale)` whenever the effective locale differs from the
store's — mount covers the restored persisted value, later renders cover an
active change. `setLocale` early-returns on equality
(`src/ui/gameStore.ts:522-529`), so the effect is idempotent, and re-publishes
`lastEvent` on a real change — which is what the sync relies on and what
`StatusRegion`'s content-comparison de-duplication
(`src/ui/components/StatusRegion.tsx:76`) already treats as a label change.

Pinned in `src/App.test.tsx`, `describe('App locale authority')`: seed
`minegram.lang = 'zh-CN'`, install a store left on the default locale, render,
and assert the store converges to `'zh-CN'`, `.mg-failure` carries
`没有达到所选难度` and the English headline is absent; the negative arm asserts
that with NO persisted value the store stays `'en'` and the headline is
English, so the sync must not manufacture a change. The zh arm fails against
the pre-fix code with `expected 'en' to be 'zh-CN'`.

**Defect B — a raw `{round}` in the Resume button.** `src/App.tsx` rebuilds
the resume object inline (it needs its own `canResume`, so it cannot use
`projectResume`) and passed `t.resume.action` RAW, while the sibling title was
interpolated and `projectResume` (`src/ui/viewModel.ts:786-796`) interpolates
correctly. `RoundBanner.tsx:155` renders the action verbatim, so the button
printed `继续第 {round} 局`. The fix interpolates at the producer, with the
same `status.round` the sibling uses and the same `canResume` ternary as the
body: `action: canResume ? interpolate(t.resume.action, { round: status.round })
: t.resume.unavailable`. `interpolate` deliberately leaves unknown placeholders
verbatim so a missing value stays visible — that design choice stands; the
producer was the bug.

**Defect C — the guard that should have caught B, widened rather than
duplicated.** `src/ui/components/announcePlaceholders.test.tsx` asserts no
`{`/`}` survives, but only on the ANNOUNCEMENT path; a button is a different
component and sailed past it. Instead of a second narrow test,
`src/App.test.tsx` `describe('App placeholder sweep')` renders the real App in
both locales across the surfaces reachable from a `failed` state —
kept-round-with-failure, won, lost — and asserts the one property that covers
the whole class: the rendered `textContent` is non-empty and contains no `{`
or `}`. A static per-branch expectation cannot outlive a new branch; the sweep
can. The exact button text is additionally pinned per locale against
`interpolate(getCopy(locale).resume.action, { round: 1 })`, so a failure names
WHICH template broke.

**Validation.** `npx tsc -b` exit 0. `npx vitest run`: 35 files, 597 tests,
all pass. `node scripts/style-check.mjs`: ALL CHECKS PASS. `npx oxlint`: 12
warnings, 0 errors — the pre-existing baseline, no new warnings. Every new
test was run against the pre-fix code first (the fix was saved to
`.tmp/round6-fix.patch` and the sources reverted): **5 failed, 26 passed** on
`src/App.test.tsx`, with the exact reported strings in the assertions
(`'Resume round {round}'`, `继续第 {round} 局`, the English headline inside the
zh sweep). The patch was then re-applied and the full suite re-run green.

## Star Battle

Minegram gains a second mini-game, Star Battle (星战), plus a game picker that is the
app's entry point on every load. Uniqueness is guaranteed by construction and certified
by a wave propagation solver on every board — never by rejection sampling, which
measurement rejected (uniqueness is measure-zero among well-spread colourings past
about n = 8).

- [x] Domain: n × n star/colour puzzle types, the four wire-format mark constants, and
  the size bounds — `MIN_STAR_SIDE` 4 (no admissible column permutation exists at n = 2
  or 3), `MAX_STAR_SIDE` 15, `DEFAULT_STAR_SIDE` 10 (`src/domain/starBattle.ts`).
- [x] Engine: the exact solution counter with a budget-limited variant whose exhaustion
  can never be misread as a count (`count.ts`), the deduction-depth analyser
  (`analyze.ts`), the wave propagation solver that is both the depth metric and the
  production uniqueness certificate (`propagate.ts`), and the CHAIN constructive
  generator whose acceptance is that certificate (`construct.ts`). The three tiers
  (starter / steady / challenging) differ only in how decoys are biased across the
  valid proof regions; measured wave bands are starter 3–5, steady ≈ 1.7n,
  challenging up to ~2n, pinned by tests at every supported side.
- [x] Application: the play reducer mirroring the Minegram contract (correct marks lock
  and silently refuse later assertions, a wrong star costs one life without refund,
  lives clamp at zero and zero loses, re-assertion is free and silent, the win
  predicate runs after the batch), plus mark retraction (`'clear'`) so a misclick
  cannot permanently void a round (`src/application/starBattleReducer.ts`).
- [x] **Replace the score with lives, and let a correct star fill its exclusions.**
  Both arrived from one phone test. The old `score` only ever fell by one per
  mistake, so it *was* lives under a misleading name and a configurable maximum
  beside it would have been incoherent: `MIN_STAR_LIVES` 1, `MAX_STAR_LIVES` 9,
  `DEFAULT_STAR_LIVES` **5** (the player's 「3 只是我随便想的数字」 left to judgement;
  the hard tier is ~19 deduction waves and a wrong star is the only way to lose a
  life, so 3 made the hardest board a coin flip). `setMaxLives(n)` in
  `src/ui/starBattleStore.ts` mirrors `setSide` and persists under
  `minegram.star-battle.lives`; the three names joined the layer-boundary allowlist
  for the same reason the side bounds did. A **wrong star now auto-fills** that
  star's row, column, colour and 3 × 3 as locked blanks (`fillStarExclusions`),
  which is safe on three counts recorded in `AGENTS.md`: it fires only on a
  *correct* star so it leaks no solution, it structurally cannot overwrite a player
  mark (the inner `fill` returns unless the target is `STAR_UNMARKED`), and it is
  idempotent because every write lands on a cell that is blank in the solution.
  Independently probed over 24 boards × 3 tiers: after placing one correct star
  every other solution star is still `STAR_UNMARKED` — the failure mode that would
  silently make a round unwinnable — a wrong star already paid for survives a later
  fill, and placing every star wins in one commit with no life charged. `d738983`.
- [x] **Make marking a mine discoverable on a phone, and drop the redundant
  counters.** The player wrote 「不知道怎么切换雷或者空白」 after testing on a phone:
  right-click does not exist on touch and a 500 ms long-press is invisible, so the
  shipped model had no discoverable way to place a star at all. A tap now marks a
  **star** — the assertion the game is about — and long-press / right-click toggles
  **blank**; the rules block above the board now states that in words. The row /
  column / colour counter groups and their ✓/✗ badges are **deleted** at the
  player's request (「我感觉上面的图例是冗余的…不如改成游戏规则说明+图例」): they
  only restated what the board already shows, and the space is worth more as
  instruction. The proximity-conflict outline is **kept** — adjacency is the one
  rule with no count to read off the board, so deleting the counters without it
  would have removed the only feedback for that rule. Also: locked cells now render
  from the solution rather than from the mark code, because auto-fill writes locked
  blanks that the old renderer counted as stars. One shared `GameBar` names the
  current game on both screens with exactly one back affordance. `932a34c`.
- [x] Worker + store: the typed generation Worker with the same request/cancel and
  identity-based stale-result protection as Minegram's, and the closure-private store
  owning the `generating` lifecycle, the persisted difficulty preference
  (`minegram.star-battle.difficulty`, never a generation setting), the win interlude
  (2500 ms, never elapsing while hidden) and generation-failure retry.
- [x] UI: the game picker (`src/ui/components/GamePicker.tsx`, per-game record of
  rounds played and best streak, ring on the last-played game) and the props-driven
  Star Battle surface with pointer drag, 500 ms long-press, roving-tab-stop keyboard
  play, per-cell `aria-label` and one polite `role="status"` region, styled purely in
  CSS so larger boards scroll rather than break (`src/styles/starbattle.css`).
  Designer lane: `0dcb549`.
- [x] Widen the ceiling from 13 to 15 and correct its rationale (`4debee8`): the exact
  counter's 14 × 14 cliff on adversarial colourings is irrelevant because production
  acceptance is the propagation certificate, which forces all n stars and is strictly
  stronger than a count of 1 at a fraction of the cost; no repair loop can exist,
  because uniqueness is measure-zero past n ≈ 8 so repair-by-recolouring is a random
  walk on a non-monotone objective; and 15 is the largest board the shipped palette
  and grid already cover. The counter stays as a test cross-check at n ≤ 10.
- [x] **Add a Star Battle board-size selector.** Shipped: `setSide(n)` in
  `src/ui/starBattleStore.ts` refuses anything outside `MIN_STAR_SIDE`..`MAX_STAR_SIDE`
  without throwing, persists under `minegram.star-battle.side`, and is a no-op while
  a board is generating; a `SegmentedControl` beside the difficulty control in
  `src/ui/components/StarBattleSurface.tsx` renders `minSide..maxSide` from props,
  and `src/App.tsx` passes the bounds read from `src/domain/starBattle.ts` — which is
  why those three names joined the layer-boundary allowlist in
  `src/ui/layerBoundary.test.ts` rather than being written as literals in the shell.

- [ ] **Give the game picker a real per-game record.** `GamePicker` already renders
  a rounds-played / best-streak line and rings the selected card, but `src/App.tsx`
  passes `selected={null}` and no `stats`, so every card reads "Not played yet".
  Nothing is missing on the UI side; no game records those figures, and fabricating
  them would be worse than the honest empty state. Needs a durable per-game tally.

## Lessons

- **A measurement probe that reads the WRONG element will report a defect that does not exist — and the fix is to print the element, not just the count.** The first run of this round's probe reported `openTapes=1` with the layer off and I was one step from calling it a leak. The one surviving tape is the LEGEND's own key: the legend deliberately carries no `data-hints` so it always teaches the true shape, and its swatch is literally `<span class="mg-run-tape" data-run="tape" data-cap="only">`, which a document-wide `.mg-run-tape[data-run="tape"]` selector matches. Scoped to the board stage the count is 0 → 34 → 0 as designed. This is lesson (1) from the Phase 4 round recurring in its sharpest form: the same shape of mistake, three rounds apart, in a file I wrote myself. The generalisation: **when a count disagrees with a design claim, dump `outerHTML` of the offender before theorising** — a two-line diagnostic that would have cost thirty seconds and is now built into the probe permanently (`offenders`).
- **A `waitFor` that swallows exceptions will report a bug in its own predicate as a page that will not load.** This round's probe timed out at 60s pointing at `document.readyState === 'complete'`, which is the canonical "the page is dead" signature. The page was fine. The cause was mine: the module declared `const URL = 'http://localhost:4173/minegram/'`, which **shadows the global `URL` constructor** for the whole file, so `new URL(URL).origin` threw a `TypeError` inside the predicate, `waitFor`'s `catch {}` ate it, and the loop spun to timeout with no diagnostic. Two independent lessons: (a) never `catch {}` inside a polling predicate without recording why — `waitFor` now keeps the last failure reason and puts it in the timeout message, so this class of failure can never again masquerade as an unreachable server; (b) a `const URL` / `const fetch` / `const crypto` at module scope is a shadowing bug waiting for the first call that needs the global, and in a probe the only symptom is a timeout.
- **A constant justified by an INCONVENIENCE will read as a CONSTRAINT forever, and the fit loop is exactly where the difference shows.** `--rail-num` was flat at 10px with a recorded reason that a flat value "closes the fit loop on paper" so the host's measure cannot chase its own output. That is a real concern about a real cycle, answered by a blunt instrument. The cycle's map has slope ≈ −0.6/cols, so it is a monotone **contraction** with a bounded fixed point — the loop was always convergent and the flat value was a convenience traded for certainty. Scaling the value was correct, and it is worth recording *why* the original reasoning felt airtight: a 1.62×–3.6× overcount reads like a mechanism rather than an estimate, and nothing in the code would ever contradict it. The generalisation: **when a constant carries a prose justification, check whether the prose is a proof or a workaround, and record which.** A workaround that has hardened into a stated constraint will keep dictating the design long after the reason stopped applying.
- **The rule that decides a membership question must be a fact about the CODE, not a fact about the WORD the player used — and the two are not substitutes.** Round 3 grounded the hint layer on the word 提示 occurring in exactly two legend cues, and that grounding was correct about those two and silent about everything else. It was a *search* result, not a *rule*: it could enumerate what already matched and had no way to say what else belonged. Round 4 the player asked whether 段落位置已定 was a 提示 too, and under the search-result reading the honest answer would have been "no, the word is not there" — while the right answer was yes, because `RunGuides` returns `null` unless `run.invariant`, so that tape reports a deduction the solution made and the player did not. The generalisable form: **quote the artifact to find the candidates, then apply a code-grounded test to each one.** A word tells you what the player is pointing at; it cannot tell you where the boundary is. Here the boundary is inference versus acknowledgement — name what the machine deduced, or name what the player finished — and that cut is legible in the components, survives a new candidate appearing, and would have answered the player's question before it was asked. The corollary is about my own record-keeping: the round-3 entry in this file still reads as a completed justification, and a completed justification is exactly what stops the next question from being asked properly. Record the *rule* a decision was reached by, not only the decision.

- **A probe that cannot reach the server will report a product defect that does not exist.** `vite preview` bound `[::1]:4173` only, so every probe's hardcoded `http://127.0.0.1:4173/minegram/` got a connection-refused page. The failure was invisible because `document.readyState === 'complete'` is just as true on `chrome-error://chromewebdata/` as on `about:blank` — the probe's readiness wait passed instantly on an error page, then timed out sixty seconds later waiting for a board that was never on screen. Two probes failed this way and neither failure was a product bug. The two defences: have a probe **print the URL it actually landed on** and assert the origin, and never treat a `waitFor` timeout as a defect until `location.href` has been read. Always drive the app at `localhost`, never `127.0.0.1`.
- **A measurement that cannot fail is not evidence, and it will look like evidence for months.** I closed the `Cannot update a component` item partly on "0 occurrences in the production bundle". That check is a tautology: the production build of `react-dom` strips the warning string, so the count is necessarily 0 and the check cannot fail. The gate caught it by counting the string in each `react-dom-client` build. A result that is zero because the thing cannot appear is not a refutation. Before recording any count as proof, ask what would make it non-zero — and if the answer is "nothing in this configuration ever could", say so instead of claiming the result.
- **Confirm a gate's claim by mutating the code it claims to guard, not by reading the assertion.** The gate verified the two new hint tests by reverting the withhold and confirming the exact arrays the tests reported, and verified the boundary test two ways — leaking `data-locked` into the cell state fails it, and no-oping `revealEligibleLines` fails it *earlier* at the `+0 to be 2` reveal count. The second failure is the one that matters: it proves the pre-fingerprint assertion is doing the job it appears to do, which is the usual way a "the test is not vacuous" claim turns out to be false.
- **A component whose docstring claims it cannot drift is not thereby exempt from drifting — and two comments that agree are not two pieces of evidence.** Gate `ora-7`'s should-fix on the legend: the three rail swatches carried `data-line-state` and a coloured edge but no `.mg-rail-cell__glyph` child, so the key taught the quiet half of the loud shape and omitted the FILLED BAR, which was the entire point of that commit. `Legend.tsx`'s docstring claimed "Every swatch is rendered with the SAME attribute the board uses, so the legend cannot drift from the stylesheet", and `clues.css` claimed the swatches "keep the loud form" while they carried no `data-hints` at all. Both were false, and they agreed with each other — which is exactly why the hole survived a gate I had run over this code. The lesson is not "write a better comment" but that **a self-describing comment is a claim, not a check**: it documents an intent and is falsified by nothing, and when a second comment restates the same intent in a second file the pair *feels* like corroboration while resting on one unverified assumption. The always-on legend row made it worse in a way worth naming: its own copy told the player 「Bold green numeral with a tick」 while the swatch next to it drew no tick, so the legend was contradicting its own text rather than merely omitting a shape. Where a component is the designated guard for a class of defect — here, the key that teaches the rail's vocabulary — check it *as* the thing it guards, against the same inventory the rail is held to, rather than trusting that its presence satisfies the requirement.
- **A CSS-only rule cannot be regression-tested under this vitest config, so a change that only exists in CSS ships unguarded.** `import.meta.glob('*.css', { query: '?raw' })` and `?inline` both return `''` — verified twice — so `src/styles/` has no committed test at all, and the five `data-hints='off'` rules are guarded only by `scripts/style-check.mjs`. Where a change can be made assertable in the component instead of the stylesheet, make it there: the two annotation characters are withheld by a render-time predicate for exactly this reason, and the gate confirmed the component acquired an *input*, not a responsibility — `ClueCell` already chose the character in the render and CSS only styled it, so the repair moved one predicate's operand. The corollary is now a bug as well as a gap: a rule that reads the switch may change the **condition** and must never change the **target**, because dropping a trailing compound while adding a second alternative silently repaints the whole rail. Neither mistake is visible to a committed test. **The closing sentence of this lesson was itself wrong and is corrected here: the gap did NOT need a vitest config.** Vitest still cannot read a stylesheet, and the guard that now covers this class ships without it — `scripts/style-check.mjs` is plain Node, reads the sheets from disk, and parses them with postcss, so it needs no bundler, no glob import and no config change. The obstacle was never the *test runner*; it was that the checks lived in a **gitignored** file, which is a much smaller mistake with a much smaller fix, and it survived here because the gap was filed under "config" and therefore read as expensive. Before filing a gap as needing a new tool, ask whether the existing tool is merely not committed.
- **Find out what the player's word actually names before you build a gate around it.** I inferred that 提示 meant "the display of deduced progress" — the lit numeral, the ✓, the underline — and shipped a switch that removed all of it, plus an Oracle gate that approved it. The player meant two specific cells in the legend, which they named by their legend labels: 矛盾提示 (dashed + ✕) and 进度未解 (dotted + ?). A gate is a claim about which things the player's word covers, and I had no evidence for the claim: the two candidates I chose were the ones that *looked* like progress, not the ones the player pointed at. The cheapest fix is to ask or to quote the artifact the word appears in — here, the legend, whose whole job is to enumerate the rail's states. Failing that, do not gate more than the complaint strictly requires; the complaint was "this is always on", not "this is on and also that".
- **An off-layer must go genuinely quiet, not partially — and the corollary is that a layer must not be widened to include something mandatory.** The first attempt at the ✓ removed the numerals and the underline and left the tick standing, which is the exact failure the switch existed to prevent: relocating the complaint rather than answering it. I then answered it by widening the layer, which broke a different thing. The symmetric rule survives: *if it is on it must be loud, and if it is off it must be silent* — applied to the two annotations, which is all it ever applied to.
- **Withholding information and withholding *presentation* are different decisions.** The `aria-label` is the line's state in the only form a screen reader receives, so gating it deletes information rather than presenting it differently, and it stays unconditional while the annotation glyph beside it comes and goes. The asymmetry is deliberate and is now written down, because the next reader will see one gated and one not and reasonably assume an oversight.
- **Reverting the fix must fail the test.** A gate that cannot go red is a gate that cannot be trusted. Both new hint tests were checked by removing the withhold and confirming the reported arrays, and the boundary test asserts its 2 revealed cells *before* asserting invariance, so a broken boundary cannot pass by never producing a reveal to compare.

- **A test double that is also the thing under test will invalidate the check without failing loudly.** The new "re-solves once the pane is measurable again" test re-stubbed the pane's box mid-test and then fired the observer — but `stubPane` also cleared the callback registry, so the re-stub threw away the very callback the test then tried to fire. The re-solve never ran, the cell stayed at the held 32px, and the test failed for a reason that read exactly like a defect in the fix I had just written. The registry reset belongs to *setting up* a pane, not to *re-reporting* one, so the two are now separate functions (`stubPane` vs `definePane`) and the distinction is documented at the split. The generalisation: **when a test fails immediately after a fix, suspect the test's own scaffolding before the fix** — a scaffolding fault and a product fault produce identical output, and the one that produces *a* failure is the one you are tempted to accept as evidence. A test that never ran its own second half is not a test of the second half.
- **A gate's computed prediction is a hypothesis with a confident tone; measure it before you record it as a consequence.** Gate `ora-8` computed that at 24×24 the fit would now land on the 24px floor where the old flat value gave 29px, and called it "the trade, not a bug" — correct as an argument, wrong as a fact: measured on the built bundle, both arms sit on the 24px floor at fit, because the band spends 9 × `0.95em + 1px` ≈ 95px of a 620px pane before the grid is divided at all, and because the app caps its main column at 653px so no viewport reaches the regime the arithmetic assumed. The prediction had to be run to be believed, and running it is cheap: `--rail-badge` and `--rail-digit` are both functions of `--rail-num`, so pinning `--rail-num: 10px` on the stage restores the pre-change token set byte for byte — a two-arm A/B with no second build. Corollary: **do not write a predicted consequence into a changelog as though it had been observed.** It is a guess with arithmetic behind it, and a reader cannot tell it from a measurement unless the record says which.
- **A check that demands a difference which cannot exist reports a defect in the check, not in the fix.** Twice this round. First, "the new tokens buy a bigger numeral than the flat one" was written as `>` and failed at fit, where the numeral is 10px in *both* arms because the fit lands where `0.3 * cell` clamps back to the 10px floor — demanding growth there demands the impossible, and the fix is `>=` plus a separate assertion that growth happens at the explicit zoom steps, which is where the player actually asked for it. Second, the zoom-step readings all came back at 10px and read as a total failure of the scaling, when the probe had measured them *after* pinning the 10px override it was A/B-ing — the flat arm, six times, reported as a failure of the new tokens. Both were the harness asserting something about an arm it was not measuring. The rule: **before believing a check that fails on a fix you have just verified, read which arm the numbers came from and whether the expectation could ever hold.** A check whose expectation is unsatisfiable in some regime of its own matrix is not a strict check, it is a wrong one.
- **A check that asserts a check's PREMISE rather than its subject will break the day a premise stops being true — and it will report the change as a regression.** `round4-probe.mjs`'s "the numeral never shrinks as the cell grows" walked the zoom steps in CLICK order, which was the same as cell order only for as long as `fit` was the smallest step. The moment `fit` learned to grow into the pane's cap, `fit` became 37px while `xs` stayed at 26px, so `fit -> xs` legitimately goes DOWN in the cell and the numeral goes down with it. The check read `11.1 -> 10 -> 10 -> 12 -> 16.8 -> 20` and called the first dip a failure of the scaling, and the tempting fix — loosen it until it goes green — would have buried a real invariant. The invariant is monotonicity IN THE CELL, and by the cell the sequence is non-decreasing throughout. **When a check fails right after a change you believe is an improvement, ask whether the change moved a premise the check was resting on, before touching the check.** The tell is that the failure looks like the improvement's opposite: an improvement that the check reports as a regression is a premise that moved, not a defect.
- **A "fit" that reads its own output back as a constraint cannot grow — and the symptom is a board that looks right.** The pane is `max-content` under a `max-block-size`, so while the board is shorter than the cap the pane's height IS the board's height. The solve was reading that as a limit, which made it a no-op that could only confirm whatever size the board already had, and the exact-no-op comment in the code called it "the only correct answer" without saying which regime it was in — true at the cap, wrong below it. This is a third instance of one shape in this project: a claim in prose that is correct in the regime it was written for and silently wrong in every other, sitting in a comment that a reader has no way to falsify. Where a measure can be a report rather than a constraint, the pair has to be named, and a comment that says "the only correct answer" without naming the regime is the defect. The measurement that found it was a probe phase written to check something else — the check that was supposed to be about the previous fix reported a failure that was not about it, and the honest move was to diagnose that before weakening either side.

- **A fixed-point walk over a DECREASING map settles in a 2-cycle, and a solver that tests only `next === cell` will declare it unconverged forever.** This was a real, live defect, and the mechanism is the opposite of what the code claimed. The fit's map is decreasing, not merely "shallow": `--rail-num` is a function of `--cell`, so a larger cell buys a larger clue rail, which leaves less room, which asks for a smaller cell. The walk therefore alternates around the answer. Measured trace at 1280×800: `32→40→39→40→39` — no step equals the step before it, the 4-pass budget runs out, `converged` is `false`, and the effect's response to that is to paint NOTHING and keep the last size React rendered. So the board was frozen at 32px with 128px of the pane's cap unspent, and because every later resize walks the same cycle and fails the same way, the staleness was permanent rather than momentary. The fix detects a REPEAT (proof) rather than a small residual (a guess) and takes the smaller member of the cycle, which is the one that cannot overflow. The docstring had asserted "the chain is monotone and its links are shallow, so this converges" — true in the sense that mattered for the magnitude, and wrong in the only sense that mattered for termination. **Monotone convergence and decreasing-map contraction are different properties, and only one of them lets an equality test pass.** Check which one a walk actually has before writing the termination condition.
- **A fixture modelled from the FORMULA instead of from the MEASUREMENT passed the old code — the same mistake as round 4, re-learned inside the same fix.** The new cycle test derived the rail costs from the clamp arithmetic and put the 39px rail at 85.25 where the browser says 84, which moved the fixed point onto an exact value, so the chain converged under the *pre-fix* code and the test passed while testing nothing. It passed because the defect had been smoothed out of its own fixture. The corrected fixture carries the browser's measured pairs (77, 85) at 32px and (86, 92) at 40px, and asserts the cycle as a PREMISE (`f(40) === 39`, `f(39) === 40`) so the test dies if the fixture ever stops having the defect. Round 4's lesson said fixtures must be the browser's own numbers; the sharper form is that a fixture derived from the same arithmetic as the code under test cannot disagree with it, and a fixture that cannot disagree is not evidence. **Every number in a regression fixture must be traceable to an observation, not to a restatement of the implementation.**
- **In a decreasing map, "does it fit" is `f(x) >= x`, and writing it the other way round makes the test fail on the FIX.** I asserted `fitCellAt(probe, …, settled.cell) <= settled.cell` and the correct implementation failed it, because in a decreasing map a solve that asks for a SMALLER cell than the one asked about is the OVERFLOWING one. This is the second time this round family flipped that direction — round 4 had the same inversion on the numeral's growth check — and the tell was the same both times: the failure looked exactly like the opposite of the improvement, which is what a premise that moved looks like and what a wrong inequality looks like. **An inequality that encodes a safety property is worth deriving out loud before it is written, because its direction is not guessable and the two forms are silently opposite.**
- **Two probe faults, both of which cost real time and neither of which was a product defect.** (1) A probe that assembles from a shared prelude must carry the prelude's SHUTDOWN too — an open CDP WebSocket keeps node's event loop alive forever, so the probe does not fail, it HANGS; `small-body.mjs` ends with `await fetch(\`http://127.0.0.1:${PORT}/json/close/${target.id}\`)` followed by `process.exit(0)` and slicing the prelude without those two lines produced a 20-minute run. (2) `getComputedStyle(el).maxBlockSize` must be read from the element that CARRIES the `max-block-size` — here `.mg-board-scroll`, which is also the element the app reads `clientWidth`/`clientHeight` from, not `.mg-board-stage`, which reports `none`. That is the third wrong-element read in this project's probe history after `getComputedStyle(el)['--cell']` (a property lookup, not a custom-property one) and a wrong numeral selector. **Every one of the three produced a number that looked entirely reasonable.**

- **A PERSISTED UI flag in a shared browser profile will silently measure a state no player ever arrives in — and it does not merely add noise, it invents a defect and hides two real ones.** Both side panels sit behind a persisted `minegram.panel.*` flag, and every round's probe reuses one Chromium profile on port 9224, so whatever the last run left behind became this round's baseline. The first survey of round 5 therefore reported the left panel as 0px wide at every tablet width — which I wrote into this file as "defect 5" and briefed a designer against — when the panel measures 737/569/381/240px with the flag set. The same hidden state reported `keyOwnScroll false` at every viewport, which read as "the `--key-cap` bound is inert", and it also **understated the defect I was actually chasing**: fold slack at 1280×800 is −151px, larger than the hidden-state run implied. So one leaked flag produced one phantom defect, one false "this feature is broken", and one understated real defect, all at once. The generalisation is about the ORDER of operations: **a probe must set every piece of persisted state it measures, in the state the measurement claims to be about, and a survey that reports a whole region as absent is reporting its own setup.** Related and equally cheap to honour: **a boolean read off a hidden element is not a measurement of the thing the boolean names** — `scrollHeight > clientHeight + 1` on a `display: none` aside is `0 > 1`, which is not a fact about scrollability. Both are the same failure as the three wrong-element reads above, and the fifth instance of the family earns the general rule written once: **before believing a measurement, print the element it came from, its computed `display`, and its box.** A number with no element attached to it is a guess with a decimal point.

- **A media query is a property of the DEVICE, and a viewport override does not set it — so a survey of a phone can be a survey of a mouse.** The third instance of this family and the most consequential, because it invalidates the instrument rather than one reading. `Emulation.setDeviceMetricsOverride` sets the viewport and nothing else: it does not touch `pointer`, `hover` or `any-pointer`, which are **features** describing the input device, and `maxTouchPoints` is a property of the navigator. So every "small screen" number in `.tmp/` before this round — the 241/241 sub-44px targets, the landscape fold at −151px, the 10px numerals, the 13×13 checkboxes — was taken with `pointer: fine`, `hover: hover` and a mouse, at a window the size of a tablet, and the app's entire `pointer: coarse` branch was **off in all of them**. `Emulation.setTouchEmulationEnabled` is what flips the features. The fix is one call, and the rule that came with it is the part worth keeping: **read the media features back out of the page (`matchMedia('(pointer: coarse)').matches`) and print them on every row, rather than printing the CDP call that asked for them** — a request that silently did nothing leaves both readings false and the report is then indistinguishable from a report of a broken app. This is the same shape as the persisted-flag leak, the hidden-element boolean and the three wrong-element reads, and the generalisation is worth stating once for all of them: **a number is evidence about a state, and the state has to be part of the report or the number is unattached.** A viewport is not a state; a viewport plus a pointer is.
- **A band gated on a rem threshold is a cliff, and a cliff needs a measurement behind it or it is a preference.** The short-landscape band is gated on `height < 56rem`, and 56rem is 896px, so 1440×880 is inside it and 1440×896 is outside — the best state the app has (page scroll 0, board wholly in the fold, 12px numerals) one pixel above the worst (page scroll 780px, the board 86px below the fold, 10px numerals). What made this a cliff rather than a boundary is that the threshold had **no evidence behind it**: the only measurement in the file that could justify a height condition (the pane collapsing to 0px at 1024×768 and 960×600) is already excluded by the width floor, because both viewports are below 74rem. So the condition is doing nothing yet shown, while changing the answer at an arbitrary coordinate. The generalisation covers every responsive boundary in the app, of which there is now one width breakpoint and two height ones: **a threshold that selects a behaviour needs either a measurement of what breaks on the far side of it, or a rationale that is not a round number** — and `74rem` is defensible precisely because it is the ≥74rem template's own literal, while `56rem` is defensible only if something is actually measured at 896. A boundary is allowed to be a cliff. A boundary that is a cliff *because nobody checked either side* is the defect, and the instrument that finds it is a matrix that straddles the threshold on purpose rather than one that sits inside it.
- **A refusal to act must be checked against which TERM binds, not against whether the lever is the right shape.** des-5 declined to lower `--board-cap` in the landscape band, reasoning "a cap cannot buy space, only the chrome can" — a correct statement about the page and an irrelevant one about the pane, because the pane is `max-content` under a `max-block-size`. At 1280×800 the pane measured 672px against a 688px cap: the cap was 16px short of binding, and the stage's content was what set the height. So `--board-cap` was not a slack ceiling there at all; lowering it would have become the binding term on the next measure, and `fitCellAt` reads it as `Math.max(paneBlock, paneBlockCap)` precisely so that it can. The refusal was a correct principle applied to the wrong term, and it survived because the evidence column was `vPageScroll` — a metric perfectly compatible with the board being cut off, and in a portrait layout dominated by content below the board. **Where a "max" is documented as a ceiling, measure the gap between the ceiling and the content before concluding the ceiling does nothing; a bound that is not currently binding is still a bound, and the regime in which it starts to bind is the one the design has to survive.** The second half is a scoring rule: **a report's headline number should be the one that would go red if the defect were fixed**, and `vPageScroll` is not that number in either orientation. The cap was then made *literally* a non-constraint in the one place it conflicted with the layout — `max-block-size: none` inside the band — because a cap on a pane whose height the grid is already deciding is a second, stale answer to a question the layout has answered.
- **A stretch mode in a scroll container is not overflow, so a whole class of
  reachability metric is uncomputable from the outside — and the honest answer is
  `scrollIntoView`, not a bigger number.** `overflow-y: auto` means a box that
  spills does not overflow: it scrolls. So `scrollHeight > clientHeight`, the
  relation every other check in this project uses, is `false` for a perfectly
  scrollable aside, and the two halves of the metric disagree in opposite
  directions — the *block* half answers "is it out of reach" for an element
  beyond the fold when it is merely scrolled to, and the *inline* half cannot
  answer anything at all, because a stretched grid item has no inline overflow of
  its own to report and the offending ancestor is not reachable from the
  measurement function. My `REACH` reported a 12.05× "unreachable" ratio at
  1184×900 and a **0.63×** "over-budget" ratio in the same run, and both were
  artefacts of the same missing reachability model. The check that actually holds
  is `el.scrollIntoView()` followed by a re-measured `getBoundingClientRect()`,
  because that is the only operation that answers "can a player get there" without
  a hand-written reachability graph. The instrument stays in `.tmp/`, marked, and
  was explicitly excluded from a specialist's brief rather than quietly passed on.

- **A container query is the right tool when the thing that decides the layout is
  a box, and a media query is the right tool when it is the device — the two are
  not interchangeable and the mistake is silent.** The control strip's own content
  box decides whether it needs trimming, and at 1184×900 that box is **436px**
  inside a 1184px window because the `>= 74rem` template spends 640px on two 20rem
  panels. A media query would have had to be re-derived at every template and
  would have been wrong at 1184×900 by construction. The same reasoning retires
  the other direction: the `pointer: coarse` gate IS a device property, so it
  stays a media query, and it was checked with a fine pointer rather than assumed
  (the trim helps there too: 114px → 90px at the same 517px strip). And the
  numeric that made the boundary legible is the reason to prefer this instrument:
  `36rem` = 576 is the measured width at which the untrimmed groups stop fitting
  (577, to the pixel), not a round number that looked tidy.

- **A grid row that stretches is a DEFINE; an item taller than its row does not
  shrink and does not scroll, and the page cannot rescue it either.** In a
  `block-size: 100dvh` shell, `grid-template-rows: auto minmax(0,1fr) auto` plus
  `align-items: stretch` gives the middle row a definite height, and a child with
  `overflow: visible` that exceeds it runs past the row, past the app's own box,
  and out of the document's scrollable area — `document.scrollingElement` is
  exactly as tall as the app, so the overflow has nowhere to go. This is the
  mirror image of the fit's own trap (`BoardSurface.tsx:354-362`, where a zero-tall
  pane is answered from its width): both are the same mistake, that a box which
  has been given a size by its parent can be treated as having no size
  constraint. The measurement that finds it is not "did the page scroll" but
  "for each control, scroll it into view and re-measure" — at 1184×900 that puts
  the settings sheet's **Generate** button at content-y 1445 with
  `reachByScrolling: false`. The remedy is four properties, and the fourth is the
  one that matters: `max-block-size: calc(100dvh - …)`, `overflow-y: auto`,
  `overscroll-behavior: contain`, and **`min-block-size: 0`**, since a grid item's
  automatic minimum size is its content size and defeats the bound on its own.
- **A container query never matches the element that establishes it, so a rule
  written "just inside" the query it gates is inert — and it is inert
  SILENTLY.** `@container banner` cannot style `.mg-banner`; the banner is the
  container, and a container's own box is not among its descendants. Two
  declarations were written that way (`padding-block`, `gap` on `.mg-banner`
  inside the query), measured at **zero effect** — the padding still read 12px
  16px and the gap still 12px — and then **deleted rather than left in as a
  claim**. The same trap has a reach clause: the only container that can reach
  the banner's own air is `.mg-app` or `.mg-main`, and moving it there converts
  the query into a viewport query wearing a container's name, which moves the
  gate that was measured on the strip. So 16px was left on the table and the
  refusal written down, which is cheaper than a rule that does nothing. The
  generalisable form: before believing a rule inside `@container NAME` has any
  effect, check that its subject is not `NAME` itself or an ancestor of it — the
  test is a measurement of the property, not a read of the stylesheet.

- **A zero gap is not "the content touches", and the only way to know is to
  measure INK rather than boxes.** The narrow strip's 6b rule sets
  `column-gap: 0`, which reads in a diff as six pills pressed together and would
  have been refused on that reading. What actually meets is two 1px **borders**,
  because a label centred in its box keeps the typeface's own side bearings
  inside it: measured with `Range.getClientRects()` on each label, the ink-to-ink
  gaps are 13.3, 6, 6, 17.2 and 24.5px under the rule against 19.3, 14, 14, 23.2
  and 28.5px where it is inert. So the tightest pair of words in the app is 6px
  apart, 3px a side, and 6 rather than 0 because each box is 4px wider than its
  word. **Boxes say how the layout is built; ink says whether it reads.** A
  check that compares `getBoundingClientRect()` of two controls answers a
  different question from the one a player is asking, and the cheap version of
  the cheap check is what produces a "touching" design that is not touching.

- **A check that goes red when you do the RIGHT thing is a debt the check was
  hiding, and deleting it is the cheap repair that loses the evidence.** The
  numeral ramp removed two media bands deliberately, and nine `style-check`
  assertions went red — every one of them a check *I* had written, pinning the
  structure the change deliberately removed. Nothing was regressed. The tempting
  moves were both wrong: deleting nine failures is faster than rewriting them, and
  re-asserting the old shape would have been faster still. What made it
  tractable was that the assertions' SUBJECTS were named in their own strings
  ("the phablet/tablet band exists", "the two are byte-identical to the tablet
  band's knobs"), so a red line said *which* promise had been retired. A check
  whose failure message does not name the promise it kept is one you cannot
  retire deliberately, and you will either keep a wrong rule or delete a
  right one. Then, because a rewritten check is a claim like any other, I
  reintroduced a deleted band myself and counted the failures: **4**, and ALL
  CHECKS PASS after restoring. A specialist's "six mutations, all caught" is a
  report about a harness in `.tmp/`, which is gitignored; the check that matters
  is one the parent re-ran.

- **Report the number that did NOT move, or the report is a press release.**
  The narrow-window work spent 32px of banner and 48px of empty row, and the
  honest summary is "**not one visible cell**: `inView` and `--cell` are
  unchanged at 360×800, 320×800 and 412×915, and at 24×24 on a phone the cell is
  still on its 24px floor." The board is content-sized and the fit has already
  put the cell at its floor, so the win is the FOLD, not the board — at 412×915
  the fold slack goes −11 → +21, so the board now fits above the fold, and at
  360×800 it goes −174 → −94, which is 17% of a 185px overhang and still not a
  win. A lane that reported only "32px saved" would have implied the board
  changed shape. The discipline is the same one that made a headline number be
  "the one that would go red if the defect were fixed": a report's own negative
  result is the part a reader cannot get from the diff.

- **A persisted preference that the state owner never learns about is the
  same class as a persisted UI flag that measures a state no player arrives
  in — round 5's lesson, one level up.** There the leaked flag corrupted the
  MEASUREMENT; here the unapplied preference corrupted the PRODUCT.
  `useLocale` seeded React state from `minegram.lang` and told the store
  nothing, so the component tree and the store's projection disagreed for
  exactly the players the persistence exists for — returning players. The
  component-local view was self-consistent (Chinese chrome, zh copy inside the
  tree), which is why nothing caught it: every store-level test installs a
  store whose locale matches the assertion, and the component tests either
  never set persisted state or never asserted a store-projected string. The
  trap was even documented — `src/ui/viewModel.ts:670` warns that a
  non-default `copy` must also pass `locale` — and a documented-but-enforced-
  nowhere hazard is a comment, not a guard. The generalisation: **whoever owns
  the state a preference describes must be told the preference on RESTORE,
  not only on CHANGE; a seed-without-sync is a half-write that compiles.** An
  idempotent sync effect is the cheap enforcement, and it is safe precisely
  because `setLocale` early-returns on equality.

  The sharpest form of the evidence is one line I did not look for first:
  `src/ui/components/preferences.ts:25` already carried the docstring "**The
  store's locale is authoritative; `localStorage` only remembers it**" — the
  exact ruling, stated correctly, directly above a hook that did the opposite,
  while `src/ui/viewModel.ts:670` warned about the same hazard in prose. Two
  comments, both RIGHT, one on the function that violated them. This is the
  inverse of the round-3 `Legend.tsx` defect, where two agreeing comments were
  both wrong, and it suggests a sharper reading rule than "a comment is a
  claim": **a comment that states an invariant is a testable claim — check the
  code against it, and if they disagree the comment is usually the one telling
  the truth about intent, because the invariant was written down before the
  behaviour drifted.** Two agreeing comments that are both wrong (round 3) and a
  correct comment contradicted by its own function (round 6) are the same
  failure of *not checking*, and the second is strictly more actionable: it
  names the invariant the fix has to restore.

- **A guard that covers one call path cannot clear a whole defect class — it
  can only choose where the next instance ships.** The round-2 `{step}`/`{zoom}`
  fix swept the ANNOUNCEMENT path for placeholders; defect B was the same
  class one component over, on a BUTTON path, and sailed past the guard. The
  widened guard sweeps the rendered document rather than a region: both
  locales, every surface reachable from the states that compose copy
  (failed-kept-round, won, lost), asserting the absence of `{`/`}` in the whole
  `textContent` plus non-emptiness, so a blank render cannot pass vacuously.
  The shape that cannot miss the next one is property-over-rendering, not
  expectation-per-branch — a static per-branch expectation is stale the day a
  new branch exists, and "no braces anywhere in what the player can read" is
  the property the player is actually reporting. The exact-sentence assertions
  stay alongside the sweep: the property catches the class; the sentence says
  WHICH template broke when one does.
