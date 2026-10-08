/**
 * Star Battle tier feasibility: which (side, tier) combinations the
 * spanning-tree generator (`construct.ts`) can actually produce a board
 * for, as a measured, exported fact the UI consumes — never a literal
 * table of which tiers work at which sizes, and never a size threshold
 * chosen by feel.
 *
 * Why this exists (player defect, measured on master `18992df`): picking
 * an impossible (side, tier) pair threw a budget-exhausted error on every
 * seed and the error state could not be escaped. The (side, tier) matrix
 * has holes, they are a PROPERTY OF THE BOARD SIZE, and the UI must not
 * offer a combination that cannot succeed.
 *
 * The model. Generation (`generateStarBattle`) rejection-samples the
 * spanning-tree candidate stream inside a wall-clock budget: it succeeds
 * for a tier iff at least one examined candidate repairs to a unique board
 * whose grade class the tier accepts ({@link starTierAcceptsGrade} — the
 * SAME predicate generation uses, so the picker can never disagree with
 * the generator). So per-generation success is
 *
 *     G(n, tier) = 1 - (1 - p(n, tier)) ^ A(n)
 *
 * where p is the per-CANDIDATE acceptance rate (one sampled layout is one
 * honest sample of the generation stream, balance-rejects included — they
 * cost the generation time too) and A(n) is the number of candidates a
 * generation examines within its default budget,
 * `defaultStarGenerationBudgetMs(n) / meanCandidateWallMs(n)`, measured in
 * the same probe run. p is MEASURED at runtime by this module over a
 * seeded stream identical in distribution to generation's, graded once per
 * unique repaired board and credited to every tier simultaneously (repair
 * is the expensive stage; sharing it across tiers is what makes probing
 * three tiers from one stream affordable). The tier is classified:
 *
 * - `available`   — the Wilson-95% LOWER bound on p clears the bar
 *                   p ≥ 1 - (1 - 0.9)^(1/A(n)), i.e. the measured rate
 *                   certifies ≥ 90% of generation attempts succeed.
 *                   A tier that succeeds ~50% of the time is NOT
 *                   available for a UI to offer as a normal choice.
 * - `unreliable`  — boards are found (p > 0) but the rate cannot certify
 *                   the 90% bar within the probe budget.
 * - `unavailable` — zero matching candidates in every sampled unit. The
 *                   interval's upper end (rule of three) is reported for
 *                   honesty: "how rare could it actually be".
 * - `unmeasured`  — no candidate completed (wall-clock bound expired
 *                   first).
 *
 * The 90% bar is a product decision recorded here, not derived; it is the
 * neighbourhood of "1 failure in 12 attempts", carried over from the
 * pre-spanning-tree feasibility module.
 *
 * Measured per-GENERATION fallback rate and wall clock, 30 generations
 * per (side, tier) cell with the default budgets (probe, this machine,
 * 2026-10 — the post-retirement re-derivation, replacing the old pooled
 * five-tier figures). "fb" counts budget-expiry fallback boards:
 *
 *     tier           n = 6                n = 8                 n = 10
 *     challenging    0/30 fb, p50 8 ms,   0/30 fb, p50 162 ms,  1/30 fb, p50 9.1 s,
 *                    p95 33 ms             p95 1.13 s            p95 42.0 s (max 90 s)
 *     expert         0/30 fb, p50 12 ms,  0/30 fb, p50 446 ms,  0/30 fb, p50 6.0 s,
 *                    p95 87 ms             p95 3.27 s            p95 52.1 s (max 60.3 s)
 *     contradiction  0/30 fb, p50 39 ms,  0/30 fb, p50 449 ms,  2/30 fb, p50 20.3 s,
 *                    p95 119 ms            p95 1.79 s            p95 90.0 s (tail: 4/30 > 60 s)
 *
 * Reading: n ≤ 8 never fall back for any shipped tier (p95 is hundreds to
 * thousands of × under the 15 s budget). At n = 10 the tails are real —
 * challenging falls back 1/30 and contradiction 2/30 at the default 90 s
 * (Wilson 95 on 2/30 ≈ 0.9–21%), and contradiction's p95 sits AT the
 * budget. The fallbacks are the designed NEVER-FAIL escape hatch: honest
 * (`fallback: true`), contract-certified, reported by the picker through
 * the measured-generations basis. The 90 s envelope is player-approved
 * and has NOT been widened to hide the tail — doing so is a product
 * decision, not a generator tuning knob.
 *
 * THE MEASURED FACTS a UI must not contradict:
 * - expert at n = 10: 0/30 fallbacks under the current (much faster than
 *   the pre-implementation probe) repair engine; the old "~40% of
 *   generations fall back" figure is retired.
 * - contradiction at n = 10 is the tightest cell: a heavy board runs to
 *   the budget ~1 time in 15. The picker should warn, not promise.
 * - THE RETIRED k = 0 TIERS (player decision, 2026-10 — the game ships
 *   exactly three tiers): `starter` and `steady` accepted only
 *   base-solvable boards. The k = 0 pool measures 8%/10%/0% of accepted
 *   boards at n = 6/8/10 — zero at n = 9–10, making both tiers impossible
 *   at the largest sizes — and at n = 8 only ~10% of that pool (3/30
 *   measured) sat inside starter's shallow wave band, so starter fell back
 *   on 5/5 consecutive default-budget seeds. The mechanism is structural:
 *   shallowness and uniqueness are in tension inside the spanning-tree
 *   construction (a shallow board has many competitor solutions; repairing
 *   to uniqueness cannot stay shallow). The tiers, the wave band and the
 *   base-solved/baseWaves grade fields were deleted together; the record
 *   lives in construct.ts's module doc, not in dead code.
 *
 * Cost and warming. A candidate costs from microseconds (balance reject)
 * to seconds (a long repair round at n = 10) plus, for unique boards, the
 * grade (16-subset basis, and a depth-1 certificate for k = -1 boards).
 * Probing a side therefore CANNOT run on a UI render path:
 * {@link measureStarBattleTierFeasibility} is async, bounded by a candidate
 * count AND a wall budget (whichever first), cached per side for the
 * session, and deduplicated against concurrent calls. Wall-clock stopping
 * makes the SAMPLED COUNT machine-dependent (which candidates fit the
 * budget); every completed candidate is seeded and deterministic, and the
 * classification is a pure function of the candidates' outcomes.
 *
 * Determinism and state. All randomness comes from a seeded stream derived
 * per side (never `Math.random()`). The module-level cache is the only
 * state; {@link clearStarBattleTierFeasibilityCache} resets it for tests.
 * If generation semantics change (tier bands, budgets, repair), the probe
 * follows through the shared exports from construct.ts — that coupling is
 * deliberate, not accidental.
 */
import { assertStarBattleSide } from '../../domain/starBattle'
import { createSeededRandom, deriveRandomSeed, type SeededRandom } from '../rng'
import {
  STAR_DIFFICULTIES,
  defaultStarGenerationBudgetMs,
  starTierAcceptsGrade,
  type StarDifficulty,
} from './construct'
import { solveStarCatalogue } from './catalogue'
import { measureMinimumBasis } from './minimumBasis'
import { sampleStarBattleLayout } from './sample'
import { repairStarBattleLayout } from './repair'

/**
 * The availability classification for one (side, tier) cell.
 * `unmeasured` only appears when the probe's wall budget expired before a
 * single candidate completed; it asserts nothing and reads optimistically.
 */
export type StarTierFeasibilityStatus = 'available' | 'unreliable' | 'unavailable' | 'unmeasured'

/**
 * What one feasibility observation rests on. `measured-generations` — the
 * candidate-stream probe; every tier uses it. (`construction` and
 * `measured-walks` belong to the retired strips-and-sea/walk architecture
 * and remain in the union only so existing UI copy types keep compiling.)
 */
export type StarTierFeasibilityBasis = 'construction' | 'measured-walks' | 'measured-generations'

/**
 * The feasibility answer for one (side, tier) cell, with the evidence a
 * UI needs to say something honest instead of just disabling a control.
 */
export interface StarTierFeasibility {
  /**
   * `available` — certified ≥ 90% per-generation success. `unreliable` —
   * boards exist but the rate is below the certified bar; offer it, if at
   * all, as a warned choice. `unavailable` — zero matches in every sampled
   * candidate. `unmeasured` — no candidate completed.
   */
  readonly status: StarTierFeasibilityStatus
  /** `measured-generations` — sampled over the generation candidate stream. */
  readonly basis: StarTierFeasibilityBasis
  /** Candidates examined: balance-rejects, repair-abandons and graded boards all count. */
  readonly samples: number
  /** Candidates whose unique repaired board's grade class the tier accepts. */
  readonly hits: number
  /**
   * Wilson 95% interval on the per-candidate acceptance rate. For
   * `unavailable` cells the upper end is the rule-of-three bound
   * (~3/samples): the honest "how rare could it actually be".
   */
  readonly rate95: readonly [number, number]
  /**
   * Point estimate of per-GENERATION success,
   * `1 - (1 - p)^candidatesPerGenerationBudget`, where p is the measured
   * per-candidate rate and the exponent is the measured number of
   * candidates a generation examines inside its default wall-clock budget.
   * `null` only when no candidate completed.
   */
  readonly generationSuccess: number | null
}

/** One row per tier; the shape the UI's picker consults. */
export type StarTierFeasibilityReport = Readonly<Record<StarDifficulty, StarTierFeasibility>>

/**
 * Probe tuning. Defaults bound a worst-case side probe to roughly the wall
 * budget (pathological cells only); typical sides resolve far sooner via
 * the early-break.
 */
export interface StarTierFeasibilityOptions {
  /**
   * Seed base for the probe's candidate stream. Same options ⇒ same
   * report (up to wall-clock-bound sample counts). Default 0x5751b7
   * (arbitrary fixed constant; "WS" in leetspeak — the only requirement is
   * that it never changes once shipped, so cached reports are stable
   * across sessions).
   */
  readonly seedBase?: number
  /**
   * Maximum examined candidates per probe. Default 200_000 — candidates
   * are microseconds to milliseconds each (unlike the walk-era units this
   * field is named for), so the wall budget normally binds first; the cap
   * exists for small sides, where hundreds of thousands of candidates run
   * in seconds. (The field name is kept so existing callers' option bags
   * stay type-compatible; the unit is now a candidate, not a walk.)
   */
  readonly maxWalksPerMeter?: number
  /**
   * Kept for type compatibility with the walk-era options; unused by the
   * candidate-stream probe (generations are not sampled separately — the
   * stream IS the generation distribution). Accepted and validated, never
   * consumed.
   */
  readonly generationSamples?: number
  /** Wall-clock budget for the whole probe. Default 30 s. */
  readonly probeWallClockMsPerMeter?: number
}

/**
 * The per-generation success bar: a tier is `available` only when the
 * measured candidate rate certifies (Wilson lower bound) at least 90% of
 * generation attempts succeeding. 0.9 is a product decision recorded in
 * the module doc, not a derived constant.
 */
const GENERATION_SUCCESS_BAR = 0.9

const DEFAULT_SEED_BASE = 0x5751b7
// Candidates cost microseconds to milliseconds each (balance rejects are
// ~20 µs; a full repair at n = 8 is ~60 ms), so a walk-era cap of ~50
// units would finish a probe in milliseconds and report on a uselessly
// thin sample. 200k candidates is tens of seconds of probing at the played
// sizes — the wall budget binds long before the count at large sides.
const DEFAULT_MAX_CANDIDATES = 200_000
const DEFAULT_PROBE_WALL_CLOCK_MS = 30_000
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

/** Classify one cell from its candidate counts and the per-generation bar. */
function classifyStatus(hits: number, samples: number, rateBar: number): StarTierFeasibilityStatus {
  if (samples === 0) {
    return 'unmeasured'
  }
  if (hits === 0) {
    return 'unavailable'
  }
  return wilson95(hits, samples)[0] >= rateBar ? 'available' : 'unreliable'
}

function buildEntry(
  hits: number,
  samples: number,
  rateBar: number,
  attemptsPerGeneration: number | null,
): StarTierFeasibility {
  const [low, high] = wilson95(hits, samples)
  const p = samples === 0 ? 0 : hits / samples
  return Object.freeze({
    status: classifyStatus(hits, samples, rateBar),
    basis: 'measured-generations',
    samples,
    hits,
    rate95: Object.freeze([low, high]) as readonly [number, number],
    generationSuccess:
      samples === 0 || attemptsPerGeneration === null
        ? null
        : 1 - (1 - p) ** attemptsPerGeneration,
  })
}

function assertOptions(options: StarTierFeasibilityOptions): Required<StarTierFeasibilityOptions> {
  const {
    seedBase = DEFAULT_SEED_BASE,
    maxWalksPerMeter = DEFAULT_MAX_CANDIDATES,
    generationSamples = 1,
    probeWallClockMsPerMeter = DEFAULT_PROBE_WALL_CLOCK_MS,
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
 * Yield one macrotask between probe candidates so a lazily-warmed picker
 * does not freeze the event loop for the probe's whole budget. Never
 * affects outcomes — the candidate streams are seeded and ordered
 * independently of wall-clock timing.
 */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * The single probe stream serving all three tiers: one seeded candidate
 * sequence (same sample + repair + exact-count gate as generation), each
 * unique repaired board graded ONCE (the 16-subset minimum basis and —
 * for k = -1 boards only — the depth-1 certificate) and credited to every
 * tier through {@link starTierAcceptsGrade}. A balance-reject or
 * repair-abandon is a miss for every tier, exactly as it is for
 * generation.
 *
 * Early-break: once every cell that can certify `available` has certified
 * it, more samples cannot change any classification in the direction that
 * matters for the UI, so the probe stops.
 */
async function probeCandidateStream(
  n: number,
  rng: SeededRandom,
  options: Required<StarTierFeasibilityOptions>,
): Promise<StarTierFeasibilityReport> {
  const hits: Record<StarDifficulty, number> = {
    challenging: 0,
    expert: 0,
    contradiction: 0,
  }
  let samples = 0
  let candidateWallTotalMs = 0
  const startedAt = performance.now()

  for (let i = 0; i < options.maxWalksPerMeter; i += 1) {
    if (performance.now() - startedAt >= options.probeWallClockMsPerMeter) {
      break
    }
    const candidateStart = performance.now()
    samples += 1
    const candidateRng = rng.derive(`candidate-${i}`)
    const layout = sampleStarBattleLayout(n, candidateRng)
    if (layout !== null) {
      const repaired = repairStarBattleLayout({
        n,
        colours: layout.colours,
        solution: layout.solution,
        rng: candidateRng,
        wallClockMs: Math.max(
          1_000,
          options.probeWallClockMsPerMeter - (performance.now() - startedAt),
        ),
      })
      if (repaired !== null) {
        // The same exact-uniqueness gate generation applies; a non-1 count
        // is a reject for every tier (and a loud probe failure, because
        // repair's terminal round already proved count = 1 — the probe and
        // the generator share the repair module, so disagreement is an
        // engine bug, never a data point).
        const basis = measureMinimumBasis(repaired.colours, n)
        const contradiction =
          basis.k === -1 ? solveStarCatalogue(repaired.colours, n, { csDepth: 1 }) : undefined
        const grade = {
          k: basis.k,
          contradiction:
            contradiction === undefined
              ? undefined
              : { solved: contradiction.solved },
        }
        for (const tier of STAR_DIFFICULTIES) {
          if (starTierAcceptsGrade(tier, grade)) {
            hits[tier] += 1
          }
        }
      }
    }
    candidateWallTotalMs += performance.now() - candidateStart
    await yieldToEventLoop()

    // A(n): candidates per generation budget, from the measured mean
    // candidate wall time in THIS stream (including grades — the mean is
    // generation-faithful because generation grades the same repaired
    // boards against the same tier set).
    const attemptsPerGeneration = Math.max(
      1,
      Math.floor(defaultStarGenerationBudgetMs(n) / Math.max(1e-3, candidateWallTotalMs / samples)),
    )
    const rateBar = 1 - (1 - GENERATION_SUCCESS_BAR) ** (1 / attemptsPerGeneration)
    let allCertified = samples > 0
    for (const tier of STAR_DIFFICULTIES) {
      if (classifyStatus(hits[tier], samples, rateBar) !== 'available') {
        // A cell can only move unavailable/unreliable → available with
        // more samples; if it is not available now it never certifies
        // earlier, so "all available" is the only stable break condition.
        allCertified = false
        break
      }
    }
    if (allCertified) {
      break
    }
  }

  const attemptsPerGeneration =
    samples === 0
      ? null
      : Math.max(
          1,
          Math.floor(defaultStarGenerationBudgetMs(n) / Math.max(1e-3, candidateWallTotalMs / samples)),
        )
  const rateBar =
    attemptsPerGeneration === null
      ? 1
      : 1 - (1 - GENERATION_SUCCESS_BAR) ** (1 / attemptsPerGeneration)
  const report = {} as Record<StarDifficulty, StarTierFeasibility>
  for (const tier of STAR_DIFFICULTIES) {
    report[tier] = buildEntry(hits[tier], samples, rateBar, attemptsPerGeneration)
  }
  return Object.freeze(report) as StarTierFeasibilityReport
}

/**
 * Run the full feasibility probe for one side: one seeded candidate
 * stream, graded boards credited to all three tiers. Bounded by the
 * candidate count AND the wall budget, whichever binds first; deterministic
 * up to wall-clock-bound sample counts (see module doc).
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
  return probeCandidateStream(n, rng, resolved)
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
    basis: 'measured-generations',
    samples: 0,
    hits: 0,
    rate95: Object.freeze([0, 1]) as readonly [number, number],
    generationSuccess: null,
  })
}

/**
 * Reset the session cache. Test-only hook; production never calls this.
 */
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

/** Kept for type compatibility with the walk-era options; see {@link StarTierFeasibilityOptions.generationSamples}. */
export type { SeededRandom }
