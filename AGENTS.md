# Minegram Project Rules

## Product
Minegram is a client-side ordered mine-run puzzle game deployed through GitHub Pages.

## Runtime and Stack
- Node.js 24+ and npm.
- TypeScript, React, Vite, Vitest.
- No backend or runtime secret.
- All generator/solver code must remain independent of React and DOM APIs.

## Git Workflow
- This is a personal project: use a topic branch and worktree for implementation, create focused GPG-signed commits, then merge to `master` and push `origin` after all required verification passes.
- Never include unrelated changes. Never disable commit signing.
- **Never `git add -A` while a writer lane is running.** A designer's in-flight edits sit in the
  shared worktree, so a blanket add silently folds a half-finished lane into an unrelated commit
  and a reset afterwards is the only way out. Stage explicit paths, and read
  `git show --stat` before believing a commit is as small as its message claims.
- The remote is `git@github.com:SteamedFish/minegram.git`.

## Agent Model Policy
- Every AI agent and sub-agent must use `opencode/space-bunny-free` (Space Bunny Free) without fallback.
- **Temporary exception, granted 2026-09-25:** the user authorised other models when Space Bunny
  Free rate-limits (`space-bunny-free rate limit 了，可以暂时使用其他模型工作`). A 403 from that
  provider is a licence to switch, not a reason to stall. The default stays Space Bunny Free.

## Architecture
- `src/domain/`: pure types, board and ordered line clues.
- `src/engine/`: deterministic RNG, constraint solver, difficulty analysis, transactional generator.
- `src/application/`: game reducer, derived line progress, generation controller.
- `src/workers/`: typed Web Worker adapter for CPU-heavy generation.
- `src/ui/`: React components and user interaction.
- `src/styles/`: visual system and responsive rules.

Dependencies point inward: `domain <- engine <- application <- ui`; the worker adapts the engine without changing domain types.

## Generation Contract
- Every accepted board is independently proven to have exactly one mine solution.
- Literal unique-prefix growth is impossible after the first mine on a non-1×1 board. The accepted interpretation is transactional growth: every added mine must participate in at least one uniquely solvable full-size completion; otherwise the addition rolls back. The completed board receives a fresh independent uniqueness proof.
- All randomness comes from a seeded generator. Never use `Math.random()` in production engine code.
- Unknown/budget-exhausted solver results are failures, never treated as unique.
- Generation runs in a Worker and supports cancellation and stale-result protection.

## Gameplay Contract
- Default board: 15×15, 60% mines, initial score 5.
- Supported board range: 1..24 per side, at most 576 cells. `MAX_BOARD_SIDE` / `MAX_BOARD_CELLS` in `src/domain/board.ts` are the single source of truth and the settings form must read them instead of repeating a literal. The ceiling is the solver's per-line legal-pattern enumeration (10,000 patterns / 300,000 materialized cells per line): a ~25-cell line carrying the required internal blanks no longer fits that budget, so every larger board exhausts the resource limit and fails closed with `resource-limit`. Measured over 25 seeds at 60% density with a 30s budget: 0/24 failures at 24x24 (slowest 968ms) versus 5/24 at 25x25, then 2/2 at 26x26, 28x28 and 30x30. Larger solver-node budgets (400k/1.6M/6.4M) and a 600s time budget do not change the outcome, so this is a capacity fact, not a search-effort problem.
- Final boards contain at least one mine in every row and column.
- Ordered run clues preserve sequence; internal separators require at least one blank.
- Correct marks lock, and a locked cell rejects any later assertion. Wrong marks cost one point and may be corrected without refund. Score is clamped to zero and zero ends the game.
- Re-asserting the mark a cell already carries is free. A cell is charged only when its mark is changed to a different value and that new value is wrong.
- A drag applies each cell at most once and previews its score cost before commit.
- Correct completion of every cell wins and automatically generates the next puzzle with the same settings and a new seed.
- **Silent inert assertions.** An assertion that cannot change anything says nothing. Concretely: a re-assertion of a mark the cell already carries is free and silent, and a gesture whose every cell is locked is inert and silent, so it charges nothing, changes nothing, and announces nothing. The controller enforces this structurally rather than by special-casing: `previewMarkBatch` in `src/application/gameReducer.ts` skips locked cells, so an all-locked batch reports `affectedCount === 0`, and the drag controller commits only when `affectedCount > 0` — so no dispatch is ever issued. The reducer would still answer `ignored(state, 'locked-cell')` if it were asked, and the store would publish it; the refusal machinery in `src/ui/reasonCopy.ts` is defence in depth behind a correctly inert UI, not dead code, and must not be deleted because the pointer cannot currently reach it. A locked cell already shows its state visually, and a keyboard player gets the same answer. A refusal that *is* dispatched must be announced with a localised label, never a machine token.
- **Win interlude.** A won round holds its banner for 2500ms and then generates the next round automatically, because auto-advance is part of the contract; the interlude never elapses while the document is hidden, so a backgrounded tab cannot consume a round. A player who prefers to act is not blocked: the banner's own primary control starts the next round immediately, so waiting out the interlude is a default and never a gate. There is deliberately no second new-round control in the board toolbar; the banner is the single place the round result is stated, and a duplicate control would restate it.
- **Run highlight.** A run's numeral lights as soon as **every one of its mines is marked**, and that is the whole condition. It must not additionally require a proved start or a marked separator, because the player marks mines — filling gaps is the game's job, and the auto-reveal fills a whole line on exactly that condition. A stricter highlight is a bug report, not a stronger guarantee: it made a player who had placed three of the four runs of a `7 2 2 1` column see only the first one lit. `src/application/lineProgress.ts` reads a run's window off the solution when the clue cannot force a start, and `complete` is the mark test alone; a run with neither a solution nor a forced start stays open, which is the conservative answer. **`start` and `invariant` report the pure deduction; `end` does not.** When the solution pins a run's end but leaves its start free, `end` is reported and `start` stays `null`, so `end !== null` is not a proof of position — which is why the renderers test `invariant` *and* "not exactly one of the two ends is null", together. A consequence worth recording, because it makes the defect hard to reproduce: marking every cell of a run's window *forces* that run's start, so the deduced path takes over and `complete === true` with `start === null` is unreachable whenever marks are supplied. The reachable proof that a window is inference, not deduction, is a non-empty `mineIndices` alongside a null `start`; `src/application/lineProgress.test.ts` pins exactly that.
- **Hints (提示) are a preference, OFF by default, and the layer is exactly the annotations keyed off machine inference.** Three members: the `矛盾提示` cell — dashed border plus ✕ — the `进度未解` cell — dotted border plus ? — and, since the player's question of 2026-09-25 「段落位置已定 这个应该也属于提示？」, the open run's **position tape** (段落位置已定, the underline under a run whose position the solution has forced). They are off until the player turns them on, at any time, without costing a point. **What is NOT the hint layer, and must never be made switchable:** a run's numeral highlighting once every one of its mines is marked, its CLOSED run tape, and the line's ✓ badge. The player called that 必须做的 — mandatory — and it is the game's acknowledgement that they finished something, not an assist. A switch that could take it away would be a switch that can make the game unplayable, which is why the earlier reasoning that a clue numeral "cannot be off" stands: it is not a preference, it is the feedback the marking is for. Do not re-litigate this boundary on the grounds that the annotations would look tidier bundled with the highlight.
  **The membership rule is INFERENCE versus ACKNOWLEDGEMENT, and it is a code fact rather than a reading of the player's word.** A member of the layer says something the MACHINE worked out that the player has not done; a non-member says something the PLAYER has done. `RunGuides` (`src/ui/components/BoardSurface.tsx`) returns `null` unless `run.invariant` — the solution has pinned the run's window — and only then paints `data-run="tape"`, so an open run's tape is inference, while `data-run="complete"` is keyed off `run.complete`, which is derived from the player's own marks, and is therefore an acknowledgement. The same cut separates the ✓ and the filled numeral (acknowledgement) from `contradiction` and `unknown` (a pattern search the player cannot see). This rule is what decided the tape, and it is the rule to apply to any future candidate: name what the machine deduced, or name what the player finished. If a candidate fits neither, do not add it and do not remove it on taste — ask. Note that the previous grounding — the word 提示 appearing in exactly two legend cues — reached the right answer for the wrong reason, and would have kept the tape outside the layer forever while the player was still asking about it. At `data-hints="off"` the three annotations render nothing at all — no dashed edge, no dotted edge, no ✕, no ?, and no position tape under any run; at `on` they are conspicuous, because the player's other complaint about them was that they were easy to miss. The `aria-label` is deliberately exempt and stays unconditional, because for a screen-reader user it is the line's only channel of state and gating it deletes information rather than presenting it differently. Four boundaries, all load-bearing:
  - **The hint layer is not the auto-reveal.** Filling a line the player has finished is part of the win contract from the original specification — a round is won by marking its mines — so it can never be switched off. Hiding a marker the player already placed is a presentation choice; deleting the machine's own work would break the game. A change here must not touch `revealEligibleLines` or `roundIsComplete`.
  - **The hint layer is not a generation setting.** It lives in `useStoredFlag` under `minegram.hints` beside the theme and the panel toggles, never in `SettingsDraft`. `onChange` is the draft the generator reads; a player who flips a hint mid-round must not have their typed seed reprinted on the next Generate. `src/ui/components/hintsToggle.test.tsx` pins the panel field, the `role="switch"`, the dictionary wiring and the storage round-trip.
  - **When it is on it must be loud.** A default-off flag that switches to an easy-to-miss marker has not answered the request, only relocated it. The three annotations have to read as an obvious state change, not a tint — a dashed hairline and a small ✕ are exactly what the player already called too subtle.
  - **The hint layer is not the completion highlight, and a gate that grows is a bug.** This boundary has already been got wrong once, so it is written down as a trap: the hint layer was briefly widened to include the ✓ and the run numeral's on-state, on the reasoning that "deduced progress" was a tidier description. It was not tidier, it was wrong — those two are mandatory. `BoardSurface.test.tsx` pins all four phases, so a gate that grows fails a test rather than needing someone to notice. A future change that wants the layer to include more must first answer why the marking feedback can be switched off, and the answer cannot be "it would look more consistent".
- **Auto-reveal.** When every mine in a row or column is correctly marked and that line holds no incorrect mark, the reducer itself fills every remaining cell of that line as a correct, locked `blank` in the same commit as the batch that triggered it. The player is never charged for a cell the game filled, and the game must never write a mark that is wrong for the solution. Revealing is a property of the mark array, never of the renderer: a line the player filled by hand and a line the game filled must be indistinguishable in the stored state, and the game must announce which lines it filled. A round is won when every cell carries a correct mark, which is reached as soon as every mine is marked **and** no line whose mines are all marked still carries an incorrect mark; a round holding an incorrect mark is not won, and correcting it is the player's job. The reveal never runs when a round is accepted or when a round holds no mark at all, and it is idempotent: one pass over rows then columns is already the fixpoint, because a write lands only on a cell that is not a mine and can therefore neither complete a line nor break one. `roundIsComplete` in `src/application/gameReducer.ts` stays the single win predicate; the win check must run **after** the reveal, or the batch that marks the last mine soft-locks the round.

## Quality Commands
Run the relevant checks from the repository root:
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Before release, also verify the built app from a nested GitHub Pages path and perform desktop/mobile visual and interaction checks.

## Documentation
Keep `plan/TODO.md` and `plan/CHANGELOG.md` current. Update both `README.md` and `README.zh-CN.md` when features, usage, or deployment change.
