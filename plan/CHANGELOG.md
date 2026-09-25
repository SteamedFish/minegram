# Changelog

All notable Minegram changes are documented here. The format follows Keep a Changelog and the project uses semantic versioning once the first playable release is tagged.

## [Unreleased]

### Added
- Initial product and architecture plan for the ordered mine-run puzzle generator.
- Defined fail-closed uniqueness, transactional growth, scoring, difficulty, accessibility, and GitHub Pages requirements.
- Scaffolded the Node 24+ React/TypeScript/Vite foundation with oxlint, Vitest/jsdom, and reproducible npm scripts.
- Added a typed Phase 0 placeholder shell, a minimal component test, and a GitHub Pages workflow that deploys `dist/` under the `/minegram/` base path.
- Verified the Phase 0 foundation with a clean install, lint, typecheck, tests, nested-path build, and Oracle gate; committed it with GPG signing.
- Added the Phase 1 pure domain foundation: row-major binary boards, precise dimension/coordinate/clue validation, ordered clue codec, and puzzle clue derivation.
- Added deterministic seeded RNG streams, memoized legal line-pattern domains, finite-domain propagation, and a deterministic count-to-two solver with explicit `unique`/`multiple`/`none`/`unknown` results.
- Added an independent exhaustive reference counter for boards up to 4×4 plus differential, propagation, budget, cancellation, and replay tests. The parent Oracle gate remains pending.
- Hardened Phase 1 solving with fail-closed line-pattern limits (10,000 patterns / 300,000 materialized cells per line), a complete-result bounded LRU (256 entries / 1,000,000 cells), cooperative cancellation/time checks, preflight before domain construction, and typed resource diagnostics mapped to `unknown`; public propagation now rejects malformed or frozen domains/assignments before mutation.
- Hardened public ordered-clue normalization/equality and direct line-pattern resource-budget validation, fixed explicit-null propagation seed handling, avoided user-clock reads on cancelled/zero-time preflight, and made exhaustive differential coverage validate every returned unique/multiple witness. The parent Oracle gate remains pending.
- Completed the Phase 1 parent Oracle gate on signed commit `acd3812`; corrected the bilingual cache documentation to state that only complete enumerations are eligible for bounded caching.
