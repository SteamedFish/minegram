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
- Added an independent exhaustive reference counter for boards up to 4×4 plus differential, propagation, budget, cancellation, and replay tests. The parent Oracle gate was later completed on signed commit `acd3812`; the Phase 1 hardening evidence is retained here.
- Hardened Phase 1 solving with fail-closed line-pattern limits (10,000 patterns / 300,000 materialized cells per line), a complete-result bounded LRU (256 entries / 1,000,000 cells), cooperative cancellation/time checks, preflight before domain construction, and typed resource diagnostics mapped to `unknown`; public propagation now rejects malformed or frozen domains/assignments before mutation.
- Hardened public ordered-clue normalization/equality and direct line-pattern resource-budget validation, fixed explicit-null propagation seed handling, avoided user-clock reads on cancelled/zero-time preflight, and made exhaustive differential coverage validate every returned unique/multiple witness. The parent Oracle gate was later completed on signed commit `acd3812`.
- Completed the Phase 1 parent Oracle gate on signed commit `acd3812`; corrected the bilingual cache documentation to state that only complete enumerations are eligible for bounded caching.
- Added the DOM-free Phase 2 generator: normalized settings, deterministic Fisher–Yates random layouts, a low-run structured-row fallback with coverage repair, immutable unique-witness transaction replay, fresh final solver proof, and typed attempt/cancellation/time/resource/difficulty diagnostics.
- Added exact minimum-worst-case binary-guess difficulty analysis with forced-propagation semantics, exact starter/steady/challenging bands, expert lower-bound semantics, memoized bounded decision-threshold exploration, and fail-closed budget handling. Pathological 30×30 searches may return `resource-limit` rather than weaken uniqueness or coverage.
- Bounded Phase 2 difficulty analysis with an exact decision-threshold search, a 3,000 ms default generator deadline, and a separate `maxDifficultyNodes` cap (default 2,000); added diagnostics and regression coverage for the 10×10/40% seed-5 reproduction, explicit limits, and clock-free preflight.
- Hardened Phase 2 layout robustness with deterministic minimum-count coverage for rectangular boards, expected-`RangeError`-only candidate rejection, and resource-limit precedence over difficulty mismatch; added 3×2/rectangular-layout and terminal-reason regressions. The parent Phase 2 Oracle gate passed with no blocking findings. Bounded searches did not reach nonstarter bands, so typed `difficulty-not-found` is documented as the permitted fail-closed outcome.
- Added the Phase 3 pure game core: immutable score/mark/lock transitions, zero-score loss, wrong-mark correction without refund, win handoff to a fresh deterministic round, typed difficulty projections, and conservative row/column run-progress selectors.
- Added the Phase 3 generation boundary: a serializable Worker protocol, injectable synchronous reducer bridge, bounded cancellation/termination fallback, stale-generation filtering, duplicate-start protection, structured failure diagnostics, and retry/next-round lifecycle tests.
- Parent validation for Phase 3 passed with 20 test files and 124 tests, plus lint, typecheck, production build, and diff checks; the mandatory Phase 3 Oracle gate remains pending.
