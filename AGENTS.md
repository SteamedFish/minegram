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
- The remote is `git@github.com:SteamedFish/minegram.git`.

## Agent Model Policy
- Every AI agent and sub-agent must use `opencode/space-bunny-free` (Space Bunny Free) without fallback.

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
- Final boards contain at least one mine in every row and column.
- Ordered run clues preserve sequence; internal separators require at least one blank.
- Correct marks lock. Wrong marks cost one point and may be corrected without refund. Score is clamped to zero and zero ends the game.
- A drag applies each cell at most once and previews its score cost before commit.
- Correct completion of every cell wins and automatically generates the next puzzle with the same settings and a new seed.

## Quality Commands
Run the relevant checks from the repository root:
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Before release, also verify the built app from a nested GitHub Pages path and perform desktop/mobile visual and interaction checks.

## Documentation
Keep `plan/TODO.md` and `plan/CHANGELOG.md` current. Update both `README.md` and `README.zh-CN.md` when features, usage, or deployment change.
