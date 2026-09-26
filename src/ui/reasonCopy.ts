/**
 * Player-facing sentences for every {@link GameResultReason}.
 *
 * This table exists because the alternative is a raw reducer identifier on
 * screen: `copy.ts`'s `failure.reasons` covers `GenerationFailureReason`, a
 * different type, so nothing in the project could label these 14 reasons.
 * It deliberately lives outside the `Copy` dictionary — reason copy is a
 * projection concern, keyed by the application's union rather than by a
 * `Copy` key, and a dictionary entry would let a reason ship unlabelled.
 *
 * Data only: no React, no DOM, no `Math.random`, and the application layer is
 * reached through a *type-only* import, so this module cannot become a runtime
 * dependency edge.
 */
import type { GameResultReason } from '../application/gameReducer'
import type { Locale } from './copy'

/**
 * One short sentence per reason. `Readonly<Record<GameResultReason, string>>`
 * is the `assertNever` of this module: a member ADDED to `GameResultReason`
 * upstream is a missing-property error here, and a key that is not a member is
 * an excess-property error, so a future reason breaks `npx tsc -b` in this file
 * instead of reaching a player as `locked-cell`.
 */
type ReasonLabel = Readonly<Record<GameResultReason, string>>

/**
 * The twelve members the reducer can reach through `rejected()`, plus the two
 * it reaches through `ignored()` while still refusing a *request*: the player
 * asked for something the game will not do. These read as feedback — what was
 * refused, and why. The two no-ops below are not refusals and do not read like
 * one.
 *
 * @see ./gameStore.ts, which keeps the free re-assertion silent and publishes
 * everything else as a null-transition event.
 */
const EN: ReasonLabel = Object.freeze({
  // `not-generating` is emitted only when a generation is ALREADY in flight
  // (gameReducer.ts `startGeneration`), so the sentence says exactly that.
  'not-generating': 'A round is already being printed, so that request was skipped.',
  'stale-generation-id': 'That answer belonged to an earlier generation, so it was ignored.',
  'invalid-settings': 'Those settings are not allowed, so no round was printed.',
  'invalid-initial-score': 'That starting score is not allowed, so no round was printed.',
  'invalid-difficulty': 'That difficulty is not available, so no round was printed.',
  'round-not-playing': 'This round is not being played, so no mark was written.',
  'invalid-batch': 'That batch was empty, so no cell was marked.',
  'conflicting-assertions': 'That batch asked for two different marks on the same cell.',
  'invalid-cell-index': 'That cell is not on the board.',
  'invalid-cell-assertion': 'A cell can only be marked as a mine or as empty.',
  'round-not-resumable': 'There is no paused round to pick up.',
  'locked-cell': 'That cell is already locked, so its mark cannot change.',
  // A no-op, not a refusal: the contract makes a free re-assertion cost
  // nothing, and the store does not publish it at all. The sentence stays
  // declarative — a statement of fact, not a correction to the player.
  'cell-already-marked': 'That cell already carries that mark.',
  'cell-already-unknown': 'That cell is already empty.',
})

const ZH_CN: ReasonLabel = Object.freeze({
  'not-generating': '已经有一个关卡正在生成，该请求已跳过。',
  'stale-generation-id': '该结果属于更早的一次生成，已被忽略。',
  'invalid-settings': '这组设置不被接受，没有生成新关卡。',
  'invalid-initial-score': '该初始分数不被接受，没有生成新关卡。',
  'invalid-difficulty': '该难度不可用，没有生成新关卡。',
  'round-not-playing': '当前这一局不在进行中，没有写入任何标记。',
  'invalid-batch': '该批次为空，没有标记任何格子。',
  'conflicting-assertions': '该批次对同一个格子给出了两种不同的标记。',
  'invalid-cell-index': '该格子不在棋盘上。',
  'invalid-cell-assertion': '格子只能标记为雷或空。',
  'round-not-resumable': '没有可继续的暂停关卡。',
  'locked-cell': '该格已被锁定，标记无法更改。',
  'cell-already-marked': '该格已经是这个标记。',
  'cell-already-unknown': '该格本来就是空的。',
})

/**
 * Keyed by `Locale` as well as by reason, so adding a locale to `copy.ts` is a
 * build error here rather than an English sentence in a Chinese UI.
 */
const TABLES: Readonly<Record<Locale, ReasonLabel>> = Object.freeze({ en: EN, 'zh-CN': ZH_CN })

/**
 * Every member, in the order `GameResultReason` declares them. Exported for the
 * coverage test, which is the reason this list cannot drift from the union.
 */
export const GAME_RESULT_REASONS: readonly GameResultReason[] = Object.freeze([
  'not-generating',
  'stale-generation-id',
  'invalid-settings',
  'invalid-initial-score',
  'invalid-difficulty',
  'round-not-playing',
  'invalid-batch',
  'conflicting-assertions',
  'invalid-cell-index',
  'invalid-cell-assertion',
  'round-not-resumable',
  'locked-cell',
  'cell-already-marked',
  'cell-already-unknown',
])

/**
 * The runtime half of the `assertNever` above: the tables are total by TYPE,
 * and types are erased, so a value that escaped the union (a cast, a parsed
 * payload) must still fail loudly instead of printing itself.
 */
function assertLabelled(): never {
  throw new TypeError('reasonCopy: a GameResultReason reached the label table without a label')
}

/**
 * The localised sentence for a reason, or `null` when there is no reason to
 * explain. Pure, so `projectSnapshot` can call it while freezing an event.
 */
export function reasonLabel(reason: GameResultReason | null, locale: Locale): string | null {
  if (reason === null) {
    return null
  }
  const label: string | undefined = TABLES[locale][reason]
  return typeof label === 'string' ? label : assertLabelled()
}

/** Test seam: the whole table for one locale, so coverage is assertable. */
export function reasonLabels(locale: Locale): ReasonLabel {
  return TABLES[locale]
}
