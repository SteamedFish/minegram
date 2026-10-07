/**
 * Star Battle tier feasibility: which (side, tier) combinations the
 * generator can actually produce a board for, as a measured, exported
 * fact the UI consumes — never a literal table of which tiers work at
 * which sizes, and never a size threshold chosen by feel.
 *
 * Why this exists (player defect, measured on master `18992df`): picking
 * 4×4 + 专家 (`expert`) threw `StarTechniqueTierBudgetExhaustedError`
 * (48 walks, targetK 2, lastK 1) on every seed — no k = 2 board exists at
 * n = 4 — and the error state could not be escaped. After the hub-free
 * work, 15×15 反证 (`contradiction`) failed 6/6 seeds as well. The
 * (side, tier) matrix has holes, they are a PROPERTY OF THE BOARD SIZE,
 * and the UI must not offer a combination that cannot succeed.
 *
 * The model. Technique tiers generate by rejection over
 * {@link walkStarBattleBoard}: a generation succeeds iff at least one of
 * {@link TECHNIQUE_WALK_ATTEMPTS} walks returns a board whose
 * {@link measureMinimumBasis}.k hits the tier's
 * {@link TECHNIQUE_TIER_TARGET}. So per-generation success is
 *
 *     G(n, tier) = 1 - (1 - p(n, tier)) ^ TECHNIQUE_WALK_ATTEMPTS
 *
 * where p is the per-walk acceptance rate — one sampled walk is one
 * honest sample of the generation loop. p is MEASURED at runtime by this
 * module (seeded, deterministic walk streams identical to the generation
 * configuration: same seed difficulty, shape gate, and walk budgets), and
 * the tier is classified:
 *
 * - `available`   — the Wilson-95% LOWER bound on p clears the bar
 *                   p ≥ 1 - (1 - 0.9)^(1/48) ≈ 0.048, i.e. the measured
 *                   rate certifies ≥ 90% of generation attempts succeed.
 *                   A tier that succeeds ~50% of the time is NOT
 *                   available for a UI to offer as a normal choice.
 * - `unreliable`  — boards are found (p > 0) but the rate cannot certify
 *                   the 90% bar within the probe budget.
 * - `unavailable` — zero boards in every sampled unit. For technique
 *                   tiers a "unit" is one full-budget walk (a failed walk
 *                   already consumed a generation-scale attempt), so 0/N
 *                   walks is 0/N generation-scale tries; the interval
 *                   (rule of three) is reported for honesty.
 * - `unmeasured`  — no unit completed (wall-clock bound expired first).
 *
 * The 90% bar is a product decision recorded here, not derived; it is the
 * neighbourhood of "1 failure in 12 attempts", the largest failure rate
 * the pre-hub-free expert tier showed while still being treated as
 * working.
 *
 * Construction tiers ('starter', 'steady') never enter the rejection
 * model: the painting is theorem-backed (construct.ts module doc —
 * validity-rule compliance certifies uniqueness for every supported
 * side) and carries no budget-exhaustion path; steady's hub-free shaping
 * is the only throw, measured 0/220 give-ups at n = 6..15 (construct.ts
 * module doc). They are still probed — {@link generateStarBattle} is run
 * {@link StarTierFeasibilityOptions.generationSamples} times per side —
 * and any observed failure downgrades the entry honestly.
 *
 * Measured matrix (2026-10-07 probes, this machine; 24 base-meter walks
 * per side unless noted, shipped shape gate and budgets). Per-walk k
 * distribution, base meter:
 *
 *     n      k=1   k=2   k=-1        n      conf-meter walk success
 *     4      24    0     0           4      0/16, and 0/200 shipped +
 *     5      16    8     0                0/60 with 5× attempts;
 *     6      9     14    1           5      14/16
 *     7      13    9     2           6      16/16
 *     8      13    9     2           7      16/16
 *     9      11    8     5           8      18/24
 *     10     12    10    2           9      8/16
 *     11     16    8     0           10     8/24
 *     12     12    9     3           11     2/24
 *     13     12    8     4           12     4/24
 *     14     11    7     6           13     1/24
 *     15     13    10    1           14     2/24
 *     4 deep: 1200 walks, ALL k = 1      15     0/24 and 0/48 (deep)
 *     5 deep: 400 walks: k=1 233, k= 2 161, k=-1 6
 *
 * Conclusions. `expert` is unavailable at n = 4 (0/1200 walks; every
 * base-meter walk endpoint there is k = 1) and solidly available from
 * n = 5 up (per-walk acceptance ~30–45% ⇒ G ≈ 1; the old "~8% at n = 15"
 * figure predates the hub-free walk). `contradiction` decays smoothly
 * with side (75% → 33% → ~8–17% → ~4–8% → 0): n = 4 is a FAST failure
 * (walks exhaust 20k attempts in ~0.6 s — the descent landscape has no
 * route down, and not one k = -1 endpoint was seen in 1460+ walk
 * observations, though that is measurement, not a proof of
 * impossibility), while n = 15 is a SLOW failure (every walk burns its
 * full wall clock short of meter 0). The n = 15 answer is therefore
 * "over budget / below the measurement floor", NOT proven impossible —
 * n = 14 still produces k = -1 boards — and raising the walk budget
 * might find them; within the SHIPPED budgets the tier never succeeds, so
 * the UI signal is `unavailable` either way.
 *
 * Player ruling recorded for other lanes (2026-10-07): shape is NOT a
 * gate — a hub or whole-line board is legal and must stay generatable;
 * only the difficulty measurement may reject. Natural incidence measured
 * with NO shape gate (12 base-meter walks per side): technique boards
 * carry a hub 10/12 (n = 10) and 12/12 (n = 15) of the time, and a whole
 * row/column owned by one colour 12/12 at both sizes — the whole line is
 * GENERIC to the strips+sea construction (the absorber region's own star
 * row/column is monocromatic by construction; measured 8/8 on starter and
 * steady too), which is why ~100% of boards carry the freebie.
 *
 * Cost and warming. A walk costs a median ~10 ms at n = 4 up to ~0.5 s
 * (base meter) / ~5 s (confinement meter) at n = 15; a failed n = 15
 * contradiction walk burns the full 30 s walk budget. Probing a side
 * therefore CANNOT run on a UI render path: {@link measureStarBattleTierFeasibility}
 * is async, bounded by {@link StarTierFeasibilityOptions.maxWalksPerMeter}
 * walks AND a per-meter wall budget (whichever first), cached per side
 * for the session, and deduplicated against concurrent calls. Typical
 * cost: small sides resolve in well under a second; the pathological
 * cell (n ≥ 13 contradiction) spends the wall budget and reports thin
 * evidence. {@link isStarTierFeasible} is the synchronous read the
 * surface wraps: it kicks the measurement on first contact (lazy
 * warming), returns the optimistic answer (`true`) until the probe
 * resolves, and thereafter `true` only for `available`. Wall-clock
 * stopping makes the SAMPLED COUNT machine-dependent (which units fit
 * the budget); every completed unit is seeded and deterministic, and the
 * classification is a pure function of the units' outcomes.
 *
 * Determinism and state. All randomness comes from a seeded stream
 * derived per side (never `Math.random()`). The module-level cache is
 * the only state; {@link clearStarBattleTierFeasibilityCache} resets it
 * for tests. If generation semantics change (tier targets, walk budgets,
 * shape gate retirement), the probe follows through the shared exports
 * from construct.ts — that coupling is deliberate, not accidental.
 */
import { assertStarBattleSide } from '../../domain/starBattle'
import { createSeededRandom, deriveRandomSeed, type SeededRandom } from '../rng'
import {
  STAR_TIER_SHAPE_GATE,
  STAR_DIFFICULTIES,
  TECHNIQUE_TIER_TARGET,
  TECHNIQUE_TIER_WALL_CLOCK_MS,
  TECHNIQUE_WALK_ATTEMPTS,
  StarShapeBudgetExhaustedError,
  generateStarBattle,
  type StarDifficulty,
} from './construct'
import { measureMinimumBasis } from './minimumBasis'
import { StarWalkBudgetExhaustedError, walkStarBattleBoard } from './walk'

/**
 * The availability classification for one (side, tier) cell.
 * `unmeasured` only appears when the probe's wall budget expired before a
 * single unit completed; it asserts nothing and reads optimistically.
 */
export type StarTierFeasibilityStatus = 'available' | 'unreliable' | 'unavailable' | 'unmeasured'

/** What one feasibility observation rests on. */
export type StarTierFeasibilityBasis = 'construction' | 'measured-walks' | 'measured-generations'

/**
 * The feasibility answer for one (side, tier) cell, with the evidence a
 * UI needs to say something honest instead of just disabling a control.
 */
export interface StarTierFeasibility {
  /**
   * `available` — certified ≥ 90% per-generation success (technique
   * tiers) or theorem-backed generation with all probed samples passing
   * (construction tiers). `unreliable` — boards exist but the rate is
   * below the certified bar; offer it, if at all, as a warned choice.
   * `unavailable` — zero boards in every sampled unit. `unmeasured` —
   * no unit completed.
   */
  readonly status: StarTierFeasibilityStatus
  /**
   * `construction` — starter/steady, resting on the construct.ts theorem
   * with a bounded generation sample as the session-time check.
   * `measured-walks` — technique tiers, sampled over the generation walk
   * stream. `measured-generations` — reserved for construction tiers
   * after an observed failure (the theorem path no longer suffices).
   */
  readonly basis: StarTierFeasibilityBasis
  /** Units sampled: walks (technique tiers) or full generations (construction). */
  readonly samples: number
  /** Units that produced a board meeting the tier's target. */
  readonly hits: number
  /**
   * Wilson 95% interval on the per-unit acceptance rate. For
   * `unavailable` cells the upper end is the rule-of-three bound
   * (~3/samples): the honest "how rare could it actually be".
   */
  readonly rate95: readonly [number, number]
  /**
   * Point estimate of per-GENERATION success, `1 - (1 - p)^walkAttempts`;
   * `null` for construction tiers, where the sampled unit already IS a
   * generation.
   */
  readonly generationSuccess: number | null
}

/** One row per tier; the shape the UI's picker consults. */
export type StarTierFeasibilityReport = Readonly<Record<StarDifficulty, StarTierFeasibility>>

/**
 * Probe tuning. Defaults bound a worst-case side probe to ~2 × the
 * per-meter wall budget (~60 s, pathological cells only); typical sides
 * resolve in a handful of walks and finish far sooner.
 */
export interface StarTierFeasibilityOptions {
  /**
   * Seed base for the probe's walk/generation streams. Same options ⇒
   * same report (up to wall-clock-bound sample counts). Default
   * 0x5751b7 (arbitrary fixed constant; "WS" in leetspeak — the only
   * requirement is that it never changes once shipped, so cached reports
   * are stable across sessions).
   */
  readonly seedBase?: number
  /** Maximum walk units per meter stream. Default 48 — exactly one generation's walk budget of evidence. */
  readonly maxWalksPerMeter?: number
  /** Construction-tier generations sampled per side. Default 8. */
  readonly generationSamples?: number
  /** Per-meter wall-clock budget for the whole probe. Default 30 s. */
  readonly probeWallClockMsPerMeter?: number
}

/**
 * The per-generation success bar: a tier is `available` only when the
 * measured walk rate certifies (Wilson lower bound) at least 90% of
 * generation attempts succeeding. 0.9 is a product decision recorded in
 * the module doc, not a derived constant.
 */
const GENERATION_SUCCESS_BAR = 0.9

/**
 * The per-walk acceptance rate whose 48-walk generation success equals
 * {@link GENERATION_SUCCESS_BAR}: `1 - (1 - p)^48 = 0.9`.
 */
const WALK_RATE_BAR =
  1 - (1 - GENERATION_SUCCESS_BAR) ** (1 / TECHNIQUE_WALK_ATTEMPTS)

const DEFAULT_SEED_BASE = 0x5751b7
const DEFAULT_MAX_WALKS_PER_METER = TECHNIQUE_WALK_ATTEMPTS
const DEFAULT_GENERATION_SAMPLES = 8
const DEFAULT_PROBE_WALL_CLOCK_MS_PER_METER = 30_000
const WILSON_Z = 1.96

/** The Wilson score interval at 95% for a hits/samples binomial rate. */
function wilson95(hits: number, samples: number): readonly [number, number] {
  if (samples === 0) {
    return [0, 1]
  }
  const p = hits / samples
  const z2 = WILSON_Z * WILSON_Z
  const denominator = 1 + z2 / samples
  const centre = p + z2 / (2 * samples)
  const half = WILSON_Z * Math.sqrt(p * ((1 - p) / samples) + z2 / (4 * samples * samples))
  return [
    Math.max(0, (centre - half) / denominator),
    Math.min(1, (centre + half) / denominator),
  ]
}

/** Classify a technique-tier cell from its walk counts. */
function techniqueStatus(hits: number, samples: number): StarTierFeasibilityStatus {
  if (samples === 0) {
    return 'unmeasured'
  }
  if (hits === 0) {
    return 'unavailable'
  }
  return wilson95(hits, samples)[0] >= WALK_RATE_BAR ? 'available' : 'unreliable'
}

/** Classify a construction-tier cell; the theorem path means all-or-nothing per sample set. */
function constructionStatus(hits: number, samples: number): StarTierFeasibilityStatus {
  if (samples === 0) {
    return 'unmeasured'
  }
  if (hits === samples) {
    return 'available'
  }
  return hits === 0 ? 'unavailable' : 'unreliable'
}

function techniqueEntry(
  hits: number,
  samples: number,
  basis: StarTierFeasibilityBasis = 'measured-walks',
): StarTierFeasibility {
  const [low, high] = wilson95(hits, samples)
  const p = samples === 0 ? 0 : hits / samples
  return Object.freeze({
    status: techniqueStatus(hits, samples),
    basis,
    samples,
    hits,
    rate95: Object.freeze([low, high]) as readonly [number, number],
    generationSuccess:
      samples === 0 ? null : 1 - (1 - p) ** TECHNIQUE_WALK_ATTEMPTS,
  })
}

function constructionEntry(hits: number, samples: number): StarTierFeasibility {
  const [low, high] = wilson95(hits, samples)
  const clean = hits === samples && samples > 0
  return Object.freeze({
    status: constructionStatus(hits, samples),
    basis: clean ? 'construction' : 'measured-generations',
    samples,
    hits,
    rate95: Object.freeze([low, high]) as readonly [number, number],
    generationSuccess: null,
  })
}

function assertOptions(options: StarTierFeasibilityOptions): Required<StarTierFeasibilityOptions> {
  const {
    seedBase = DEFAULT_SEED_BASE,
    maxWalksPerMeter = DEFAULT_MAX_WALKS_PER_METER,
    generationSamples = DEFAULT_GENERATION_SAMPLES,
    probeWallClockMsPerMeter = DEFAULT_PROBE_WALL_CLOCK_MS_PER_METER,
  } = options
  for (const [name, value] of [
    ['seedBase', seedBase],
    ['maxWalksPerMeter', maxWalksPerMeter],
    ['generationSamples', generationSamples],
  ] as const) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new RangeError(`${name} must be a positive safe integer; received ${String(value)}`)
    }
  }
  if (typeof probeWallClockMsPerMeter !== 'number' || !(probeWallClockMsPerMeter > 0)) {
    throw new RangeError(
      `probeWallClockMsPerMeter must be a positive number; received ${String(probeWallClockMsPerMeter)}`,
    )
  }
  return { seedBase, maxWalksPerMeter, generationSamples, probeWallClockMsPerMeter }
}

/**
 * Yield one macrotask between probe units so a lazily-warmed picker does
 * not freeze the event loop for the probe's whole budget. Never affects
 * outcomes — the walk streams are seeded and ordered independently of
 * wall-clock timing.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * The meter stream that serves 'challenging' and 'expert' from one walk
 * sequence: every completed walk's minimum basis k is measured once and
 * credited to the tier whose target it hits. A walk that exhausts its own
 * budget is a miss for both, exactly as it is for generation.
 */
async function probeBaseMeter(
  n: number,
  rng: SeededRandom,
  options: Required<StarTierFeasibilityOptions>,
): Promise<Pick<StarTierFeasibilityReport, 'challenging' | 'expert'>> {
  let challengingHits = 0
  let expertHits = 0
  let samples = 0
  const startedAt = performance.now()

  for (let i = 0; i < options.maxWalksPerMeter; i += 1) {
    if (performance.now() - startedAt >= options.probeWallClockMsPerMeter) {
      break
    }
    samples += 1
    try {
      const walked = walkStarBattleBoard({
        n,
        seed: rng.derive(`base-walk-${i}`).seed,
        seedDifficulty: 'steady',
        meter: 'base',
        shape: STAR_TIER_SHAPE_GATE,
        wallClockMs: TECHNIQUE_TIER_WALL_CLOCK_MS,
      })
      const k = measureMinimumBasis(walked.colours, n).k
      if (k === TECHNIQUE_TIER_TARGET.challenging) {
        challengingHits += 1
      }
      if (k === TECHNIQUE_TIER_TARGET.expert) {
        expertHits += 1
      }
    } catch (error) {
      if (!(error instanceof StarWalkBudgetExhaustedError)) {
        throw error
      }
    }
    await yieldToEventLoop()
    // Both tiers resolved 'available': more samples cannot change the
    // classification in the favourable direction that matters for the UI.
    if (
      techniqueStatus(challengingHits, samples) === 'available' &&
      techniqueStatus(expertHits, samples) === 'available'
    ) {
      break
    }
  }

  return {
    challenging: techniqueEntry(challengingHits, samples),
    expert: techniqueEntry(expertHits, samples),
  }
}

/**
 * The meter stream for 'contradiction'. A successful 'confinement'-meter
 * walk stops only when the FULL depth-0 confinement catalogue places
 * nothing; by the upward-closedness {@link measureMinimumBasis} verifies,
 * no subset solves either, so every successful walk IS a k = -1 board —
 * the basis enumeration is not re-run here (probes confirmed the
 * invariant on every successful confinement walk).
 */
async function probeConfinementMeter(
  n: number,
  rng: SeededRandom,
  options: Required<StarTierFeasibilityOptions>,
): Promise<Pick<StarTierFeasibilityReport, 'contradiction'>> {
  let hits = 0
  let samples = 0
  const startedAt = performance.now()

  for (let i = 0; i < options.maxWalksPerMeter; i += 1) {
    if (performance.now() - startedAt >= options.probeWallClockMsPerMeter) {
      break
    }
    samples += 1
    try {
      walkStarBattleBoard({
        n,
        seed: rng.derive(`conf-walk-${i}`).seed,
        seedDifficulty: 'steady',
        meter: 'confinement',
        shape: STAR_TIER_SHAPE_GATE,
        wallClockMs: TECHNIQUE_TIER_WALL_CLOCK_MS,
      })
      hits += 1
    } catch (error) {
      if (!(error instanceof StarWalkBudgetExhaustedError)) {
        throw error
      }
    }
    await yieldToEventLoop()
    if (techniqueStatus(hits, samples) === 'available') {
      break
    }
  }

  return { contradiction: techniqueEntry(hits, samples) }
}

/**
 * Construction tiers: run real generations (shaping on — the product
 * path) and count failures. Cheap (tens of milliseconds per board), so
 * the full sample always runs. Only the documented give-up failure
 * ({@link StarShapeBudgetExhaustedError}) counts as a miss; an internal
 * invariant violation from generation propagates loudly — an engine bug
 * must never be reported as "tier unavailable".
 */
async function probeConstructionTiers(
  n: number,
  rng: SeededRandom,
  options: Required<StarTierFeasibilityOptions>,
): Promise<Pick<StarTierFeasibilityReport, 'starter' | 'steady'>> {
  let starterHits = 0
  let steadyHits = 0
  for (let i = 0; i < options.generationSamples; i += 1) {
    try {
      generateStarBattle({ n, seed: rng.derive(`starter-gen-${i}`).seed, difficulty: 'starter' })
      starterHits += 1
    } catch (error) {
      if (!(error instanceof StarShapeBudgetExhaustedError)) {
        throw error
      }
    }
    try {
      generateStarBattle({ n, seed: rng.derive(`steady-gen-${i}`).seed, difficulty: 'steady' })
      steadyHits += 1
    } catch (error) {
      if (!(error instanceof StarShapeBudgetExhaustedError)) {
        throw error
      }
    }
    await yieldToEventLoop()
  }
  return {
    starter: constructionEntry(starterHits, options.generationSamples),
    steady: constructionEntry(steadyHits, options.generationSamples),
  }
}

/**
 * Run the full feasibility probe for one side: real generation samples
 * for the construction tiers, seeded walk streams (identical
 * configuration to {@link generateStarBattle}'s technique path) for the
 * technique tiers. Bounded by `maxWalksPerMeter` walks AND the per-meter
 * wall budget per meter stream, whichever binds first; deterministic up
 * to wall-clock-bound sample counts (see module doc).
 *
 * Results are cached per side for the session: a second call returns the
 * first call's report (options only apply to the first measure of a
 * side). Concurrent calls share one in-flight probe.
 */
export async function measureStarBattleTierFeasibility(
  n: number,
  options: StarTierFeasibilityOptions = {},
): Promise<StarTierFeasibilityReport> {
  assertStarBattleSide(n)
  const resolved = cache.get(n)
  if (resolved?.state === 'done') {
    return resolved.report as StarTierFeasibilityReport
  }
  if (resolved?.state === 'pending' && resolved.promise !== null) {
    return resolved.promise
  }

  const promise = probe(n, options)
  cache.set(n, { state: 'pending', promise, report: null })
  try {
    const report = await promise
    cache.set(n, { state: 'done', promise: null, report })
    return report
  } catch (error) {
    // A failed probe (internal invariant violation, never expected) must
    // not wedge the cache: drop the entry so a later call can retry, and
    // let the caller see the error.
    cache.delete(n)
    throw error
  }
}

/** The body of {@link measureStarBattleTierFeasibility}. */
async function probe(n: number, options: StarTierFeasibilityOptions): Promise<StarTierFeasibilityReport> {
  const resolved = assertOptions(options)
  const rng = createSeededRandom(deriveRandomSeed(resolved.seedBase, `star-battle-tier-feasibility-${n}`))
  return Object.freeze({
    ...(await probeConstructionTiers(n, rng, resolved)),
    ...(await probeBaseMeter(n, rng, resolved)),
    ...(await probeConfinementMeter(n, rng, resolved)),
  })
}

/**
 * Synchronous read of the cached feasibility for one cell, for UI copy
 * richer than a boolean. Before the probe resolves (or if it failed),
 * returns an `unmeasured` entry — the honest "no data yet" the surface
 * can render as "checking…" or default-allow. Never triggers work.
 */
export function readStarBattleTierFeasibility(n: number, tier: StarDifficulty): StarTierFeasibility {
  assertStarBattleSide(n)
  if (!STAR_DIFFICULTIES.includes(tier)) {
    throw new TypeError(`difficulty must be one of ${STAR_DIFFICULTIES.join(', ')}; received ${String(tier)}`)
  }
  const entry = cache.get(n)
  if (entry?.state === 'done' && entry.report !== null) {
    return entry.report[tier]
  }
  return Object.freeze({
    status: 'unmeasured',
    basis: 'measured-walks',
    samples: 0,
    hits: 0,
    rate95: Object.freeze([0, 1]) as readonly [number, number],
    generationSuccess: null,
  })
}

/**
 * The boolean the surface wraps (`tierFeasibility: (side, tier) =>
 * boolean`). Answers `true` unless measurement has shown the cell NOT
 * `available`. On first contact for a side this KICKS OFF the probe
 * (lazy warming, fire-and-forget, deduplicated by the cache) and returns
 * the optimistic `true` — today's behaviour — until the probe resolves;
 * thereafter the measured answer. A cell the probe left `unmeasured`
 * (wall budget expired first) also reads `true`: thin evidence must not
 * silently disable a control.
 */
export function isStarTierFeasible(n: number, tier: StarDifficulty): boolean {
  assertStarBattleSide(n)
  if (!STAR_DIFFICULTIES.includes(tier)) {
    throw new TypeError(`difficulty must be one of ${STAR_DIFFICULTIES.join(', ')}; received ${String(tier)}`)
  }
  const entry = cache.get(n)
  if (entry === undefined) {
    void measureStarBattleTierFeasibility(n).catch(() => {
      // The rejection path already cleared the cache; the boolean read
      // stays optimistic. Nothing actionable for a render-path caller.
    })
    return true
  }
  if (entry.state === 'done' && entry.report !== null) {
    return entry.report[tier].status === 'available'
  }
  return true
}

/** Reset the session cache. Test-only hook; production never calls this. */
export function clearStarBattleTierFeasibilityCache(): void {
  cache.clear()
}

interface CacheEntry {
  state: 'pending' | 'done'
  promise: Promise<StarTierFeasibilityReport> | null
  report: StarTierFeasibilityReport | null
}

const cache = new Map<number, CacheEntry>()

/** Re-exported so consumers of this module see the same tier vocabulary. */
export type { StarDifficulty }
