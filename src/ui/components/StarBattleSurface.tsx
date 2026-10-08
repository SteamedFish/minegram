import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import { SegmentedControl } from './primitives'
import type { StarMarkToken } from './starMarkTokens'

/**
 * Star Battle surface: the whole second game as one props-driven view.
 * Presentational only — every mark request leaves through `onMark`, every
 * navigation through `onNewRound` / `onDifficultyChange` / `onSizeChange` /
 * `onMaxLivesChange` / `onRetry` / `onBackToPicker`. It never mutates a prop
 * and never reaches for a store.
 *
 * The surface renders in EVERY round state, including the two that have no
 * board: `puzzle === null` states the case with the empty card, and a
 * projected `failure` states the generation fault with the failure card. The
 * toolbar is a sibling of both, so a failed board can never be a dead end:
 * the size and difficulty controls stay reachable and are the natural escape.
 *
 * The availability signal tells the surface which tiers the engine can print
 * at a given side. It is the measured one: an `unavailable` tier renders as
 * a disabled pill with the honest note — no board in N generation-scale
 * tries, never a claim of impossibility — an `unreliable` tier stays
 * selectable but wears its thin evidence, and `unmeasured` renders exactly
 * like no signal at all. With no signal the surface treats every tier as
 * available. It is a plain predicate over (side, tier), so any engine table
 * or snapshot adapts with a one-line wrapper at the host.
 *
 * The interaction vocabulary, stated where the player meets it (the rules
 * block under the toolbar):
 *
 *   tap / left click    toggles a star (star → clear → star)
 *   press and hold /    toggles a blank
 *   right click
 *   drag                paints the stroke's tool, each cell at most once
 *
 * A re-assertion of the mark a cell already carries is silent, and locked
 * cells are inert. Keyboard: one roving tab stop, arrows/Home/End navigate,
 * Space/Enter toggle blank, `s`/`*` toggle a star, Backspace/Delete clear.
 *
 * Locked cells (code 3) are rendered by asking the solution what they locked
 * as — the mark array certifies correctness, the solution says whether a
 * locked cell is a star or a blank, and the game fills blanks the same way
 * (auto-blank arrives as 3 too).
 *
 * The copy object mirrors `src/ui/copy.ts`'s shape (exhaustive `en`, full
 * `zhCN` sibling) so the wiring lane can lift it into the central dictionary
 * without restructuring.
 */

/**
 * The five difficulty tiers, kept locally on purpose. The layer boundary
 * (`src/ui/layerBoundary.test.ts`) forbids a value import from the engine,
 * so the surface owns its own copy of the engine's `StarDifficulty` union
 * and `STAR_DIFFICULTIES` order. The copy below is the exhaustiveness
 * guard: `StarCopy.difficulties` is a `Record<StarDifficulty, string>`, so
 * an engine tier that lands here without a label fails `tsc` at this file,
 * not as an `undefined` pill on the player.
 *
 * What each tier is (the engine's `techniqueTierAcceptsBasis` doc is the
 * authority, re-tiered 2026-10-07):
 * - starter / steady: the base rules alone solve the board; they differ
 *   only in depth — starter in short chains, steady long but routine.
 *   Neither is a technique tier.
 * - challenging: the base rules place nothing, and exactly one idea beyond
 *   them finishes the board — but never the freebie: the witness must not
 *   be line confinement (a whole row or column of one colour handing the
 *   line over). The class decays with side, so this is a small-side tier:
 *   solid at n = 4–5, thin at n = 7–8, not offered at n >= 9. The measured
 *   availability signal, not this comment, is what tells the player where
 *   it prints.
 * - expert: the base rules place nothing; no single idea suffices, some
 *   pair does.
 * - contradiction: no confinement-technique subset solves at all; the
 *   board requires a proof by contradiction.
 */
export type StarDifficulty = 'starter' | 'steady' | 'challenging' | 'expert' | 'contradiction'

/** The ordered tier ids — the engine aligns its difficulty analysis to this. */
export const STAR_DIFFICULTIES: readonly StarDifficulty[] = [
  'starter',
  'steady',
  'challenging',
  'expert',
  'contradiction',
]

export interface StarBattlePuzzle {
  readonly n: number
  readonly seed: number
  /** `colours[row * n + col]` is a colour index in `[0, n)`. Read-only. */
  readonly colours: Uint8Array
  /** `solution[row]` is that row's star column. Read-only. */
  readonly solution: readonly number[]
}

/**
 * A generation failure, projected to player-facing strings by the host (the
 * surface never sees the raw diagnostics, and the raw `reason` token is
 * carried only for `data-reason`, never rendered). `remedies` is ordered.
 */
export interface StarFailureInfo {
  /** The raw failure token; a data attribute and nothing else. */
  readonly reason: string
  readonly headline: string
  readonly explanation: string
  readonly remedies: readonly string[]
  /** False for a deterministic fault, where retrying the same request cannot help. */
  readonly retryable: boolean
}

/**
 * The measured availability of one (side, tier) cell, in the engine's
 * vocabulary: `available` prints reliably, `unreliable` sometimes prints
 * (a warned but valid choice), `unavailable` produced no board in every
 * sampled unit, and `unmeasured` asserts nothing. The surface owns this
 * shape — the host projects the engine's report into it — so the component
 * never imports below the UI layer.
 */
export interface StarTierAvailability {
  readonly status: 'available' | 'unreliable' | 'unavailable' | 'unmeasured'
  /** Units sampled: the N in "no board was found in N tries". */
  readonly samples: number
  /** Units that produced a board: the evidence behind `unreliable`. */
  readonly hits: number
}

/** The cell before any measurement resolves; renders exactly like no signal. */
export const UNMEASURED_TIER_AVAILABILITY: StarTierAvailability = Object.freeze({
  status: 'unmeasured',
  samples: 0,
  hits: 0,
})

export type StarMark = 'blank' | 'star' | null

/**
 * Live generation progress, projected by the host from the store's snapshot.
 * Honest by construction: a candidate count and the current phase, never a
 * percentage — the generator cannot know how many candidates a board needs,
 * so the count of what has actually happened is the whole truth.
 */
export interface StarGenerationProgress {
  readonly candidates: number
  readonly accepted: number
  readonly phase: 'sampling' | 'repairing' | 'grading'
}

export interface StarBattleSurfaceProps {
  readonly locale: 'en' | 'zh'
  /** `null` while no certified board exists — the empty card states the case. */
  readonly puzzle: StarBattlePuzzle | null
  /** Length `n * n`: 0 unmarked, 1 blank, 2 star, 3 locked-correct. Read-only. */
  readonly marks: Uint8Array
  readonly status: 'idle' | 'generating' | 'playing' | 'won' | 'lost'
  /** A generation failure to state in place of the board; `null` when there is none. */
  readonly failure?: StarFailureInfo | null
  /**
   * Live generation progress while `status === 'generating'`; absent or
   * `null` shows no indicator. Only ever shown while a board is actually
   * printing — the empty card owns it, so it is never a band of its own.
   */
  readonly progress?: StarGenerationProgress | null
  /**
   * The measured per-tier availability at a given side; absent = every tier
   * is available, the behaviour before the signal existed. `unavailable` is
   * an unselectable pill with the honest note, `unreliable` is selectable
   * but marked, and `unmeasured` renders exactly like no signal at all.
   */
  readonly tierAvailability?: (side: number, tier: StarDifficulty) => StarTierAvailability
  /** Remaining lives; `maxLives` is this round's configured maximum, `>= lives`. */
  readonly lives: number
  readonly maxLives: number
  readonly mistakes: number
  readonly streak: number
  readonly difficulty: StarDifficulty
  /** The store's current board side; drives the size selector even before a board exists. */
  readonly side: number
  /** The supported board-side range; the host reads it off the domain constants. */
  readonly minSide: number
  readonly maxSide: number
  /** The supported starting-lives range; the host reads it off the domain constants. */
  readonly minLives: number
  /** The absolute ceiling of the starting-lives range (a domain constant). */
  readonly maxLivesCeiling: number
  readonly onMark: (row: number, col: number, next: StarMark) => void
  readonly onNewRound: () => void
  /** Reuses the exact seed of the most recent failed request (the failure card's retry). */
  readonly onRetry: () => void
  readonly onDifficultyChange: (difficulty: StarDifficulty) => void
  readonly onSizeChange: (n: number) => void
  readonly onMaxLivesChange: (n: number) => void
  readonly onBackToPicker: () => void
}

/* --------------------------------------------------------------------------------------
 * Copy — lifted from `src/ui/copy.ts`'s dictionary shape.
 * -------------------------------------------------------------------------------------- */

interface StarCopy {
  readonly boardLabel: string
  readonly lives: string
  /** The pips' accessible name; `{lives}`/`{max}` are interpolated by the meter. */
  readonly livesStatus: string
  readonly mistakes: string
  readonly streak: string
  readonly back: string
  readonly difficultyLabel: string
  readonly difficulties: Record<StarDifficulty, string>
  /**
   * What the live tier is, said in words under the control — the labels
   * alone ('Steady', 'Challenging') promise nothing the engine must keep.
   * The statements are tier contracts, not board promises: within a tier
   * the SHAPES vary, the solving idea does not (measured: three generator
   * mechanisms all landed on one technique per tier), so no description
   * may imply the technique itself rotates board to board.
   */
  readonly difficultyDescriptions: Record<StarDifficulty, string>
  readonly size: {
    /** The group's visible label; the options are the numerals themselves. */
    readonly label: string
    /** One line saying what N means here: an N × N grid carrying N stars. */
    readonly hint: string
  }
  readonly maxLives: {
    /** The group's visible label; the options are the numerals themselves. */
    readonly label: string
    /** One line on the asymmetry: a wrong star costs a life, a wrong empty does not. */
    readonly hint: string
  }
  /** The rules and legend block: the rules, what the player's marks mean, the gestures. */
  readonly rules: {
    readonly label: string
    readonly items: readonly string[]
    readonly marks: {
      readonly star: string
      readonly blank: string
      readonly locked: string
    }
    readonly gestures: string
    readonly keys: string
  }
  readonly empty: {
    readonly idleTitle: string
    readonly idleBody: string
    readonly generatingTitle: string
    readonly generatingBody: string
  }
  /**
   * The generation progress line inside the empty card: the working caret,
   * the phase names, and the one-line template ('{phase} — {candidates}
   * layouts tried'). The phase is the milestone, the count is the honest
   * "it is working" signal; a percentage would be invented.
   */
  readonly progress: {
    /** The blinking working caret, matched to the main game's status caret. */
    readonly caret: string
    readonly phases: Record<'sampling' | 'repairing' | 'grading', string>
    readonly line: string
  }
  /**
   * The generation-failure card. Headline, explanation and remedies are
   * projected by the host from the shared failure dictionary; only the two
   * affordance strings — and the note that points at the toolbar, the way out
   * of a failed board — live here.
   */
  readonly failure: {
    readonly retry: string
    /** Said under the card's actions: the toolbar above is the real escape. */
    readonly changeNote: string
  }
  /** Why a difficulty pill is disabled: the engine cannot print this tier at this size. */
  /**
   * The pill suffix and live-tier note for a tier the measurement could not
   * print. The note states the evidence — no board in `{samples}`
   * generation-scale tries — and must never claim the combination is
   * impossible: a slow-failing cell is over the measurement's budget, not
   * proven empty.
   */
  readonly tierUnavailableMeasured: string
  readonly tierUnavailableMeasuredNote: string
  /** The measured-signal markings for a tier that sometimes prints: selectable, but the label says how thin the evidence is. */
  readonly tierUnreliable: string
  readonly tierUnreliableNote: string
  readonly banner: {
    readonly wonTitle: string
    readonly wonBody: string
    readonly wonPrimary: string
    readonly lostTitle: string
    readonly lostBody: string
    readonly restart: string
  }
  readonly cell: {
    readonly at: string
    readonly colour: string
    readonly states: {
      readonly unmarked: string
      readonly blank: string
      readonly star: string
      readonly lockedStar: string
      readonly lockedBlank: string
      readonly wrongStar: string
      readonly conflict: string
    }
  }
  readonly live: {
    readonly wrong: string
    readonly won: string
    readonly lost: string
  }
}

const en: StarCopy = {
  boardLabel: 'Star Battle board, {n} by {n}',
  lives: 'Lives',
  livesStatus: '{lives} of {max} lives',
  mistakes: 'Mistakes',
  streak: 'Streak',
  back: 'All games',
  difficultyLabel: 'Difficulty',
  difficulties: {
    starter: 'Starter',
    steady: 'Steady',
    challenging: 'Challenging',
    expert: 'Expert',
    contradiction: 'Contradiction',
  },
  difficultyDescriptions: {
    starter: 'The placement rules alone solve it; the chains are short.',
    steady: 'The placement rules alone solve it too, but the chains run long — routine work throughout.',
    challenging:
      'One idea beyond the rules finishes it — and not the free one: no single colour owns a whole row or column to hand you the line.',
    expert: 'Two ideas beyond the rules are needed; either one alone is not enough.',
    contradiction: 'No set of ideas suffices on its own; the board yields only to a proof by contradiction.',
  },
  size: {
    label: 'Board size',
    hint: 'An N × N grid carrying N stars — larger is more stars to place, not just more cells.',
  },
  maxLives: {
    label: 'Starting lives',
    hint: 'A wrong star costs one life; a wrong empty costs nothing — clear it and move on.',
  },
  rules: {
    label: 'How to play',
    items: [
      'One star in every row.',
      'One star in every column.',
      'One star in every colour.',
      'Stars may not touch, even diagonally.',
    ],
    marks: {
      star: 'your star',
      blank: 'your empty',
      locked: 'correct, locked',
    },
    gestures:
      'Tap (or click) marks a star; press and hold (or right-click) marks empty. Tap a mark again to clear it.',
    keys: 'Arrows move. Space marks empty, S marks a star, Backspace clears.',
  },
  empty: {
    idleTitle: 'No board yet',
    idleBody: 'Choose a difficulty to print one.',
    generatingTitle: 'Printing the board',
    generatingBody: 'This takes a moment.',
  },
  progress: {
    caret: '▍',
    phases: {
      sampling: 'Sampling colourings',
      repairing: 'Repairing the layout',
      grading: 'Grading difficulty',
    },
    line: '{phase} — {candidates} layouts tried',
  },
  failure: {
    retry: 'Retry',
    changeNote: 'Change the board size or difficulty above, or go back to pick another game.',
  },
  tierUnavailableMeasured: 'No board found in {samples} tries',
  tierUnavailableMeasuredNote: '{tier}: no board was found at this size in {samples} generation-scale tries.',
  tierUnreliable: 'Only {hits} of {samples} tries produced a board',
  tierUnreliableNote: '{tier} produced a board in only {hits} of {samples} tries at this size, so printing may fail.',
  banner: {
    wonTitle: 'Board complete',
    wonBody: 'Lives {lives}. The next board starts on its own.',
    wonPrimary: 'Next board',
    lostTitle: 'Out of lives',
    lostBody: 'The lives ran out.',
    restart: 'Restart',
  },
  cell: {
    at: 'Row {row} column {col}, colour {colour}',
    colour: 'colour {index}',
    states: {
      unmarked: 'unmarked',
      blank: 'empty',
      star: 'star',
      lockedStar: 'locked star',
      lockedBlank: 'locked empty',
      wrongStar: 'wrong star, minus one life',
      conflict: 'too close to another star',
    },
  },
  live: {
    wrong: 'Wrong mark: {label}',
    won: 'Board complete',
    lost: 'Out of lives',
  },
}

const zhCN: StarCopy = {
  boardLabel: '星战棋盘，{n} × {n}',
  lives: '生命',
  livesStatus: '生命 {lives}/{max}',
  mistakes: '失误',
  streak: '连胜',
  back: '全部游戏',
  difficultyLabel: '难度',
  difficulties: {
    starter: '入门',
    steady: '进阶',
    challenging: '挑战',
    expert: '专家',
    // 反证, not 矛盾: the tier means "solvable only by proof by
    // contradiction", and 矛盾 would read as the adjacency conflict this
    // game already draws on the cells.
    contradiction: '反证',
  },
  difficultyDescriptions: {
    starter: '只靠摆放规则就能解开，链条很短。',
    steady: '只靠摆放规则也能解开，只是链条很长——全程都是常规推理。',
    challenging: '需要规则之外的一个想法才能解开——但不是白送的那种：不会有颜色独占整行或整列，把答案直接交到你手上。',
    expert: '需要规则之外的两个想法，只有一个不够。',
    contradiction: '任何技巧组合单独都不够，只能靠反证法解开。',
  },
  size: {
    label: '棋盘尺寸',
    hint: 'N × N 的棋盘要放 N 颗星——变大不只是格子变多，要放的星也更多。',
  },
  maxLives: {
    label: '初始生命',
    hint: '星标错扣一条命；空白标错不扣命，随时可以直接改。',
  },
  rules: {
    label: '玩法',
    items: [
      '每一行各放一颗星。',
      '每一列各放一颗星。',
      '每种颜色各放一颗星。',
      '星与星不能相邻，斜向也算。',
    ],
    marks: {
      star: '你标的星',
      blank: '你标的空白',
      locked: '标对了，已锁定',
    },
    gestures: '点按（单击）标星；长按（右键）标空白。再点一次取消标记。',
    keys: '方向键移动。空格标空白，S 键标星，退格取消标记。',
  },
  empty: {
    idleTitle: '还没有棋盘',
    idleBody: '选择难度后开始一局。',
    generatingTitle: '正在生成棋盘',
    generatingBody: '需要一点时间。',
  },
  progress: {
    caret: '▍',
    phases: {
      sampling: '采样配色',
      repairing: '修补布局',
      grading: '评估难度',
    },
    line: '{phase}，已尝试 {candidates} 种配色',
  },
  failure: {
    retry: '重试',
    changeNote: '可以在上方更改棋盘尺寸或难度，或返回选择其他游戏。',
  },
  tierUnavailableMeasured: '尝试 {samples} 次都没有生成出棋盘',
  tierUnavailableMeasuredNote: '{tier}：在此尺寸 {samples} 次生成尝试都没有得到棋盘。',
  tierUnreliable: '只有 {hits}/{samples} 次尝试能生成棋盘',
  tierUnreliableNote: '{tier}：在此尺寸只有 {hits}/{samples} 次尝试能生成出棋盘，生成可能失败。',
  banner: {
    wonTitle: '棋盘完成',
    wonBody: '剩余生命 {lives}。下一局会自动开始。',
    wonPrimary: '下一局',
    lostTitle: '生命耗尽',
    lostBody: '生命用完了。',
    restart: '重新开始',
  },
  cell: {
    at: '第 {row} 行第 {col} 列，{colour}',
    colour: '颜色 {index}',
    states: {
      unmarked: '未标记',
      blank: '空白',
      star: '星标',
      lockedStar: '已锁定的星标',
      lockedBlank: '已锁定的空白',
      wrongStar: '错误的星标，扣一条命',
      conflict: '与另一颗星相邻',
    },
  },
  live: {
    wrong: '标记错误：{label}',
    won: '棋盘完成',
    lost: '生命耗尽',
  },
}

export function getStarCopy(locale: 'en' | 'zh'): StarCopy {
  return locale === 'zh' ? zhCN : en
}

function fill(template: string, vars: Record<string, number | string>): string {
  return template.replace(/\{(\w+)\}/g, (raw, name: string) =>
    name in vars ? String(vars[name]) : raw,
  )
}

/** Every supported board side, inclusive. An inverted range yields nothing. */
function boardSizes(minSide: number, maxSide: number): readonly number[] {
  if (!Number.isSafeInteger(minSide) || !Number.isSafeInteger(maxSide) || maxSide < minSide) {
    return []
  }
  return Array.from({ length: maxSide - minSide + 1 }, (_, index) => minSide + index)
}

/* --------------------------------------------------------------------------------------
 * Derived state — pure functions of marks, colours and solution.
 * -------------------------------------------------------------------------------------- */

const LOCKED = 3

function isSolutionCell(index: number, puzzle: StarBattlePuzzle): boolean {
  return puzzle.solution[Math.floor(index / puzzle.n)] === index % puzzle.n
}

/**
 * Only a wrong STAR is flagged: a blank — right or wrong — renders exactly
 * like any other blank. Flagging a blank on a star cell would leak the
 * solution (the player would see which cells are stars without earning it),
 * and charging or announcing it is equally forbidden: an untrue blank cannot
 * be distinguished from a player's note, so only a claimed star can be wrong
 * in a way the game answers.
 */
function isWrong(index: number, code: number, puzzle: StarBattlePuzzle): boolean {
  return code === 2 && !isSolutionCell(index, puzzle)
}

/**
 * What a cell displays as. A locked cell is certified correct, so the solution
 * — not the mark code — says whether it locked as a star or a blank; the game
 * fills blanks (auto-blank) with the same locked code, and this stays right
 * under both shapes of the write. The token vocabulary is STAR_MARK_TOKENS,
 * whose type this derives from, so a new token cannot exist here without
 * existing there — where the stylesheet contract test can see it.
 */
function displayMark(index: number, code: number, puzzle: StarBattlePuzzle): StarMarkToken {
  if (code === LOCKED) {
    return isSolutionCell(index, puzzle) ? 'locked-star' : 'locked-blank'
  }
  return code === 2 ? 'star' : code === 1 ? 'blank' : 'unmarked'
}

interface StarDerived {
  /** Every cell that displays as a star: the player's stars plus locked solution stars. */
  readonly starIndices: readonly number[]
  /** The proximity constraint's whole signal: both cells of every touching pair. */
  readonly conflicts: ReadonlySet<number>
}

function deriveStarState(marks: Uint8Array, puzzle: StarBattlePuzzle): StarDerived {
  const { n } = puzzle
  const starIndices: number[] = []
  for (let i = 0; i < marks.length; i += 1) {
    const code = marks[i] ?? 0
    if (code === 2 || (code === LOCKED && isSolutionCell(i, puzzle))) {
      starIndices.push(i)
    }
  }
  // The adjacency rule has no counter — the player asked for the board
  // without them — so it is stated on the cells: any two displayed stars
  // within Chebyshev distance 1 conflict, and both carry it.
  const conflicts = new Set<number>()
  for (let a = 0; a < starIndices.length; a += 1) {
    for (let b = a + 1; b < starIndices.length; b += 1) {
      const ia = starIndices[a] ?? 0
      const ib = starIndices[b] ?? 0
      if (Math.abs(Math.floor(ia / n) - Math.floor(ib / n)) <= 1 && Math.abs((ia % n) - (ib % n)) <= 1) {
        conflicts.add(ia)
        conflicts.add(ib)
      }
    }
  }
  return { starIndices, conflicts }
}

/* --------------------------------------------------------------------------------------
 * Pointer gesture — one stroke, one tool, each cell painted at most once.
 * -------------------------------------------------------------------------------------- */

interface StarGesture {
  readonly pointerId: number
  tool: 'blank' | 'star'
  readonly origin: number
  readonly painted: Set<number>
  moved: boolean
  longPressFired: boolean
  readonly downX: number
  readonly downY: number
  longPressTimer: ReturnType<typeof setTimeout> | null
}

const LONG_PRESS_MS = 500
const DRAG_THRESHOLD_PX = 8

/* --------------------------------------------------------------------------------------
 * The surface
 * -------------------------------------------------------------------------------------- */

export function StarBattleSurface(props: StarBattleSurfaceProps) {
  const { puzzle, marks, status } = props
  // The grid's side; before a board exists the store's configured side drives
  // the size selector, so `n` is never borrowed from a puzzle that isn't there.
  const n = puzzle?.n ?? props.side
  const copy = getStarCopy(props.locale)
  const playing = status === 'playing'
  const controlsDisabled = status === 'generating'
  const progress = props.progress ?? null

  const gridRef = useRef<HTMLDivElement | null>(null)
  const cellsRef = useRef<(HTMLDivElement | null)[]>([])
  const gestureRef = useRef<StarGesture | null>(null)
  const marksRef = useRef(marks)
  const previousMarksRef = useRef(marks)
  const previousStatusRef = useRef(status)
  const seenSeedRef = useRef(puzzle?.seed ?? 0)
  const liveRef = useRef<HTMLDivElement | null>(null)
  const [roving, setRoving] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    marksRef.current = marks
  }, [marks])

  const derived = useMemo<StarDerived>(
    () => (puzzle === null ? { starIndices: [], conflicts: new Set<number>() } : deriveStarState(marks, puzzle)),
    [marks, puzzle],
  )

  // A new board invalidates the roving index. Cell refs are NOT cleared here:
  // this effect runs after the refs attach, so clearing would leave the focus
  // table empty for the whole round; the ref callbacks overwrite entries as
  // cells render, which is enough.
  useEffect(() => {
    setRoving(0)
  }, [puzzle?.seed])

  // Announce newly wrong marks and the round's end through the one polite region.
  useEffect(() => {
    if (seenSeedRef.current !== puzzle?.seed) {
      // The round turned over; the new board's marks are the new baseline.
      seenSeedRef.current = puzzle?.seed ?? 0
      previousMarksRef.current = marks
      previousStatusRef.current = status
      return
    }
    if (puzzle === null) {
      // No board, nothing to announce; the failure card states the case itself.
      previousMarksRef.current = marks
      previousStatusRef.current = status
      return
    }
    const priorStatus = previousStatusRef.current
    previousStatusRef.current = status
    if (status === 'won') {
      setNotice(copy.live.won)
      previousMarksRef.current = marks
      return
    }
    if (status === 'lost') {
      setNotice(copy.live.lost)
      previousMarksRef.current = marks
      return
    }
    if (priorStatus === 'won' || priorStatus === 'lost') {
      previousMarksRef.current = marks
      return
    }
    for (let i = 0; i < marks.length; i += 1) {
      const now = marks[i] ?? 0
      const before = previousMarksRef.current[i] ?? 0
      if (now !== before && now !== 0 && isWrong(i, now, puzzle)) {
        const row = Math.floor(i / n) + 1
        const col = (i % n) + 1
        const label = fill(copy.cell.at, {
          row,
          col,
          colour: (puzzle.colours[i] ?? 0) + 1,
        })
        setNotice(fill(copy.live.wrong, { label }))
        break
      }
    }
    previousMarksRef.current = marks
  }, [marks, status, puzzle, copy, n])

  // Generation progress shares the one polite region, throttled to phase
  // changes. The candidate count ticks far too often to announce and means
  // little read aloud, while a phase change (sampling → repairing →
  // grading) is the real milestone: the first message of a generation
  // announces its phase, and later messages with the same phase only move
  // the visible counter. The ref resets when the surface leaves
  // `generating`, so the next generation announces its first phase too.
  const announcedPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (status !== 'generating') {
      announcedPhaseRef.current = null
      return
    }
    if (progress === null || announcedPhaseRef.current === progress.phase) {
      return
    }
    announcedPhaseRef.current = progress.phase
    setNotice(
      fill(copy.progress.line, {
        phase: copy.progress.phases[progress.phase],
        candidates: progress.candidates,
      }),
    )
  }, [status, progress, copy])

  // Banner focus: a keyboard player who is inside the board when the round ends
  // lands on the banner's primary control; anyone else's focus is left alone.
  const primaryRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    if (status !== 'won' && status !== 'lost') {
      return
    }
    const active = document.activeElement
    if (active !== null && active.closest('.mg-star-surface') !== null) {
      primaryRef.current?.focus()
    }
  }, [status])

  const cellIndexAtPoint = useCallback(
    (x: number, y: number, fallback: EventTarget | null): number | null => {
      const within = (node: Element | null): number | null => {
        if (node === null || gridRef.current?.contains(node) !== true) {
          return null
        }
        const raw = node.getAttribute('data-cell-index')
        const index = raw === null ? NaN : Number(raw)
        return Number.isInteger(index) ? index : null
      }
      if (typeof document.elementFromPoint === 'function') {
        const hit = within(document.elementFromPoint(x, y)?.closest('[data-cell-index]') ?? null)
        if (hit !== null) {
          return hit
        }
      }
      const target = fallback instanceof Element ? fallback.closest('[data-cell-index]') : null
      return within(target)
    },
    [],
  )

  const focusCell = useCallback((index: number) => {
    const node = cellsRef.current[index]
    if (node === undefined || node === null) {
      return
    }
    node.focus({ preventScroll: true })
    if (typeof node.scrollIntoView === 'function') {
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    }
  }, [])

  /** A paint (drag / long-press) SETS the tool's mark; a re-assertion stays silent. */
  const applySet = useCallback(
    (index: number, tool: 'blank' | 'star') => {
      const code = marksRef.current[index] ?? 0
      if (code === LOCKED) {
        return
      }
      if ((tool === 'star' && code === 2) || (tool === 'blank' && code === 1)) {
        return
      }
      props.onMark(Math.floor(index / n), index % n, tool)
    },
    [props, n],
  )

  /** A tap TOGGLES the stroke's tool: the carried mark cycles to the next assertive state. */
  const applyToggle = useCallback(
    (index: number, tool: 'blank' | 'star') => {
      const code = marksRef.current[index] ?? 0
      if (code === LOCKED) {
        return
      }
      const next: StarMark =
        tool === 'blank' ? (code === 1 ? null : 'blank') : code === 2 ? null : 'star'
      if (next === null && code === 0) {
        return
      }
      props.onMark(Math.floor(index / n), index % n, next)
    },
    [props, n],
  )

  const clearLongPress = useCallback((gesture: StarGesture) => {
    if (gesture.longPressTimer !== null) {
      clearTimeout(gesture.longPressTimer)
      gesture.longPressTimer = null
    }
  }, [])

  const endGesture = useCallback(
    (pointerId: number) => {
      const gesture = gestureRef.current
      if (gesture === null || gesture.pointerId !== pointerId) {
        return
      }
      clearLongPress(gesture)
      if (!gesture.moved && !gesture.longPressFired) {
        applyToggle(gesture.origin, gesture.tool)
      }
      gestureRef.current = null
      const node = gridRef.current
      if (node !== null && typeof node.releasePointerCapture === 'function') {
        try {
          node.releasePointerCapture(pointerId)
        } catch {
          // The pointer may already be released; nothing to undo.
        }
      }
    },
    [applyToggle, clearLongPress],
  )

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (!playing || gestureRef.current !== null) {
      return
    }
    if (event.isPrimary === false) {
      return
    }
    if (event.button !== 0 && event.button !== 2) {
      return
    }
    const origin = cellIndexAtPoint(event.clientX, event.clientY, event.target)
    if (origin === null) {
      return
    }
    const gesture: StarGesture = {
      pointerId: event.pointerId,
      // A tap is a star; the secondary button is a blank — the mouse half of
      // press-and-hold.
      tool: event.button === 2 ? 'blank' : 'star',
      origin,
      painted: new Set([origin]),
      moved: false,
      longPressFired: false,
      downX: event.clientX,
      downY: event.clientY,
      longPressTimer: null,
    }
    // Touch has no secondary button: holding still promotes the stroke to a
    // blank, and a drag that follows keeps painting blanks.
    if (event.pointerType === 'touch') {
      gesture.longPressTimer = setTimeout(() => {
        if (gestureRef.current !== gesture || gesture.moved) {
          return
        }
        gesture.longPressFired = true
        gesture.tool = 'blank'
        applySet(origin, 'blank')
      }, LONG_PRESS_MS)
    }
    gestureRef.current = gesture
    setRoving(origin)
    // preventDefault above already cancelled the browser's own focus shift,
    // so the cell takes focus explicitly (a touch stroke does not: it would
    // scroll and pop the visual viewport).
    if (event.pointerType !== 'touch') {
      focusCell(origin)
    }
    const node = gridRef.current
    if (node !== null && typeof node.setPointerCapture === 'function') {
      try {
        node.setPointerCapture(event.pointerId)
      } catch {
        // jsdom and older browsers lack pointer capture; the gesture still works.
      }
    }
    event.preventDefault()
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const gesture = gestureRef.current
    if (gesture === null || gesture.pointerId !== event.pointerId) {
      return
    }
    if (
      !gesture.moved &&
      Math.hypot(event.clientX - gesture.downX, event.clientY - gesture.downY) > DRAG_THRESHOLD_PX
    ) {
      // The stroke became a drag: the origin takes the tool's mark now, and the
      // tap toggle on release stands down.
      gesture.moved = true
      clearLongPress(gesture)
      applySet(gesture.origin, gesture.tool)
    }
    const native = event.nativeEvent as Event & {
      getCoalescedEvents?: () => readonly { clientX: number; clientY: number }[]
    }
    const samples = native.getCoalescedEvents?.() ?? [
      { clientX: event.clientX, clientY: event.clientY },
    ]
    for (const sample of samples) {
      const index = cellIndexAtPoint(sample.clientX, sample.clientY, event.target)
      if (index === null || gesture.painted.has(index)) {
        continue
      }
      gesture.painted.add(index)
      applySet(index, gesture.tool)
    }
    if (gesture.moved) {
      event.preventDefault()
    }
  }

  function onPointerEnd(event: ReactPointerEvent<HTMLDivElement>): void {
    endGesture(event.pointerId)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    const target = event.target instanceof Element ? event.target.closest('[data-cell-index]') : null
    const raw = target === null ? roving : Number(target.getAttribute('data-cell-index'))
    const index = Number.isInteger(raw) ? (raw as number) : roving
    const rowStart = Math.floor(index / n) * n
    const rowEnd = Math.min(rowStart + n - 1, n * n - 1)
    const move = (next: number): void => {
      const bounded = Math.max(0, Math.min(n * n - 1, next))
      setRoving(bounded)
      focusCell(bounded)
    }
    switch (event.key) {
      case 'ArrowRight':
        move(Math.min(index + 1, rowEnd))
        break
      case 'ArrowLeft':
        move(Math.max(index - 1, rowStart))
        break
      case 'ArrowDown':
        move(Math.min(index + n, n * n - 1))
        break
      case 'ArrowUp':
        move(Math.max(index - n, 0))
        break
      case 'Home':
        move(event.ctrlKey ? 0 : rowStart)
        break
      case 'End':
        move(event.ctrlKey ? n * n - 1 : rowEnd)
        break
      default:
        if (!playing) {
          return
        }
        switch (event.key) {
          case ' ':
          case 'Enter':
            applyToggle(index, 'blank')
            break
          case 's':
          case 'S':
          case '*':
            applyToggle(index, 'star')
            break
          case 'Backspace':
          case 'Delete': {
            const code = marksRef.current[index] ?? 0
            if (code !== 0 && code !== LOCKED) {
              props.onMark(Math.floor(index / n), index % n, null)
            }
            break
          }
          default:
            return
        }
        event.preventDefault()
        return
    }
    event.preventDefault()
  }

  // Unmount safety: a pending long-press must not outlive the surface.
  useEffect(() => {
    return () => {
      const gesture = gestureRef.current
      if (gesture !== null) {
        clearLongPress(gesture)
      }
    }
  }, [clearLongPress])

  function cellLabel(index: number, board: StarBattlePuzzle): string {
    const code = marks[index] ?? 0
    const at = fill(copy.cell.at, {
      row: Math.floor(index / n) + 1,
      col: (index % n) + 1,
      colour: (board.colours[index] ?? 0) + 1,
    })
    const state = (() => {
      if (code === LOCKED) {
        return isSolutionCell(index, board)
          ? copy.cell.states.lockedStar
          : copy.cell.states.lockedBlank
      }
      if (code === 2) {
        if (isWrong(index, code, board)) {
          return copy.cell.states.wrongStar
        }
        return derived.conflicts.has(index) ? copy.cell.states.conflict : copy.cell.states.star
      }
      if (code === 1) {
        // A typed blank reads as a blank no matter what the solution says:
        // isWrong never fires for code 1, so no wrong-blank label exists.
        return copy.cell.states.blank
      }
      return copy.cell.states.unmarked
    })()
    return `${at}，${state}`
  }

  const interactiveAttrs = {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
    onLostPointerCapture: onPointerEnd,
    onContextMenu: (event: { preventDefault: () => void }) => {
      event.preventDefault()
    },
    onKeyDown,
  }

  const pipCount = Math.max(0, props.maxLives)
  const failure = props.failure ?? null

  // The engine's availability signal: the measured report when the host
  // supplies one; with none, every cell is unmeasured, which is
  // bit-for-bit the game before the signal existed.
  const availabilityOf = (tier: StarDifficulty): StarTierAvailability =>
    props.tierAvailability !== undefined
      ? props.tierAvailability(n, tier)
      : UNMEASURED_TIER_AVAILABILITY
  /** A pill's suffix naming the evidence; `null` when the pill needs none. */
  const availabilityLabel = (tier: StarDifficulty): string | null => {
    const availability = availabilityOf(tier)
    if (availability.status === 'unavailable') {
      return fill(copy.tierUnavailableMeasured, { samples: availability.samples })
    }
    if (availability.status === 'unreliable') {
      return fill(copy.tierUnreliable, { hits: availability.hits, samples: availability.samples })
    }
    return null
  }
  const liveAvailability = availabilityOf(props.difficulty)
  const liveTierUnavailable = liveAvailability.status === 'unavailable'
  const liveTierUnreliable = liveAvailability.status === 'unreliable'

  return (
    <div className="mg-star-surface" data-status={status} data-testid="star-surface">
      <div className="mg-star-toolbar">
        <div className="mg-star-meter">
          <span className="mg-star-meter__item">
            <span className="mg-star-meter__label">{copy.lives}</span>
            <span
              className="mg-star-pips"
              role="img"
              data-testid="star-lives"
              aria-label={fill(copy.livesStatus, { lives: props.lives, max: props.maxLives })}
            >
              {Array.from({ length: pipCount }, (_, index) => (
                <span
                  className="mg-star-pips__pip"
                  key={index}
                  data-spent={index < props.lives ? undefined : 'true'}
                  aria-hidden="true"
                >
                  ♥
                </span>
              ))}
            </span>
          </span>
          <span className="mg-star-meter__item">
            <span className="mg-star-meter__label">{copy.mistakes}</span>
            <span
              className="mg-star-meter__value"
              data-tone={props.mistakes > 0 ? 'danger' : undefined}
              data-testid="star-mistakes"
            >
              {props.mistakes}
            </span>
          </span>
          <span className="mg-star-meter__item">
            <span className="mg-star-meter__label">{copy.streak}</span>
            <span className="mg-star-meter__value" data-testid="star-streak">
              {props.streak}
            </span>
          </span>
        </div>
        {/* Difficulty: the segmented idiom with one addition the shared
            SegmentedControl does not have — a per-option availability state,
            so a tier the engine cannot print at the current side is a legible
            but unselectable pill and a tier that only sometimes prints stays
            selectable but wears its thin evidence. The markup and classes are
            SegmentedControl's own, so the look and the radiogroup semantics
            are unchanged. When the live tier is unavailable or unreliable at
            the live size, that is said in words under the control: a marked
            pill alone would look like a rendering bug. */}
        <div className="mg-star-difficulty" data-testid="star-difficulty">
          <span className="mg-field__label" id="mg-star-difficulty-label">
            {copy.difficultyLabel}
          </span>
          <div className="mg-seg" role="radiogroup" aria-labelledby="mg-star-difficulty-label" id="mg-star-difficulty">
            {STAR_DIFFICULTIES.map((tier) => {
              const optionId = `mg-star-difficulty-${tier}`
              const availability = availabilityOf(tier)
              const unavailable = availability.status === 'unavailable'
              const unreliable = availability.status === 'unreliable'
              const suffix = availabilityLabel(tier)
              return (
                <span className="mg-seg__item" key={tier}>
                  <input
                    className="mg-seg__input"
                    type="radio"
                    id={optionId}
                    name="mg-star-difficulty"
                    value={tier}
                    checked={props.difficulty === tier}
                    disabled={controlsDisabled || unavailable}
                    aria-label={suffix === null ? undefined : `${copy.difficulties[tier]} — ${suffix}`}
                    onChange={() => {
                      props.onDifficultyChange(tier)
                    }}
                  />
                  <label
                    className="mg-seg__label"
                    htmlFor={optionId}
                    data-tier={tier}
                    data-unavailable={unavailable ? 'true' : undefined}
                    data-availability={unreliable ? 'unreliable' : undefined}
                  >
                    {copy.difficulties[tier]}
                  </label>
                </span>
              )
            })}
          </div>
          {/* What the live tier IS, said in words: the label alone promises
              nothing the engine must keep. Hidden when the live tier is
              unavailable at this size — a description sitting next to the
              honest "no board found" note would read as a promise the size
              cannot keep; the note alone is the truth there. */}
          {liveTierUnavailable ? null : (
            <p className="mg-star-difficulty__description" data-testid="star-tier-description">
              {copy.difficultyDescriptions[props.difficulty]}
            </p>
          )}
          {liveTierUnavailable ? (
            <p className="mg-star-difficulty__note" data-testid="star-tier-note" role="note">
              {fill(copy.tierUnavailableMeasuredNote, {
                tier: copy.difficulties[props.difficulty],
                samples: liveAvailability.samples,
              })}
            </p>
          ) : liveTierUnreliable ? (
            <p className="mg-star-difficulty__note" data-testid="star-tier-note" role="note">
              {fill(copy.tierUnreliableNote, {
                tier: copy.difficulties[props.difficulty],
                hits: liveAvailability.hits,
                samples: liveAvailability.samples,
              })}
            </p>
          ) : null}
        </div>
        {/* Board size: the same segmented idiom as difficulty, one chip per
           supported side, the numerals themselves as the labels so nothing is
           locale-specific. The checked chip is the store's configured side,
           which is the live board's own n once one exists. */}
        <div className="mg-star-size" data-testid="star-size">
          <SegmentedControl
            id="mg-star-size"
            label={copy.size.label}
            hint={copy.size.hint}
            value={String(props.side)}
            options={boardSizes(props.minSide, props.maxSide).map((side) => ({
              value: String(side),
              label: String(side),
            }))}
            disabled={controlsDisabled}
            onChange={(value) => {
              props.onSizeChange(Number(value))
            }}
          />
        </div>
        {/* Starting lives: same idiom again, the live configured maximum as the
           checked chip, the domain range as the options. */}
        <div className="mg-star-lives" data-testid="star-max-lives">
          <SegmentedControl
            id="mg-star-max-lives"
            label={copy.maxLives.label}
            hint={copy.maxLives.hint}
            value={String(props.maxLives)}
            options={boardSizes(props.minLives, props.maxLivesCeiling).map((lives) => ({
              value: String(lives),
              label: String(lives),
            }))}
            disabled={controlsDisabled}
            onChange={(value) => {
              props.onMaxLivesChange(Number(value))
            }}
          />
        </div>
      </div>

      {/* The rules and legend: the three placement rules and the adjacency
          rule, what the player's own marks mean, and the gestures — the
          discoverability answer for "how do I switch", stated where the
          phone player meets it, above the board. */}
      <section className="mg-star-rules" data-testid="star-rules" aria-label={copy.rules.label}>
        <ul className="mg-star-rules__list">
          {copy.rules.items.map((rule, index) => (
            <li className="mg-star-rules__rule" key={index}>
              {rule}
            </li>
          ))}
        </ul>
        <ul className="mg-star-rules__legend">
          <li className="mg-star-rules__legend-item">
            <span className="mg-star-rules__swatch" data-swatch="star" aria-hidden="true">
              ★
            </span>
            {copy.rules.marks.star}
          </li>
          <li className="mg-star-rules__legend-item">
            <span className="mg-star-rules__swatch" data-swatch="blank" aria-hidden="true">
              ·
            </span>
            {copy.rules.marks.blank}
          </li>
          <li className="mg-star-rules__legend-item">
            <span className="mg-star-rules__swatch" data-swatch="locked" aria-hidden="true">
              ★
            </span>
            {copy.rules.marks.locked}
          </li>
        </ul>
        <p className="mg-star-rules__gestures">{copy.rules.gestures}</p>
        <p className="mg-star-rules__gestures" data-keys="true">
          {copy.rules.keys}
        </p>
      </section>

      {/* The three faces of "no playable board", in precedence order. A
          generation failure states the fault and its remedy but never hides
          the toolbar: changing the size or difficulty above — or retrying, or
          going back — is the way out, and every one of those controls stays
          on screen. While nothing has been requested yet (or the request is
          still printing) the empty card states the case. Otherwise the board. */}
      {failure !== null ? (
        <section
          className="mg-star-failure"
          role="alert"
          aria-atomic="true"
          data-kind={failure.retryable ? 'retryable' : 'deterministic'}
          data-reason={failure.reason}
          data-testid="star-failure"
        >
          <h2 className="mg-star-failure__headline">{failure.headline}</h2>
          <p className="mg-star-failure__explanation">{failure.explanation}</p>
          <ol className="mg-star-failure__remedies">
            {failure.remedies.map((remedy, index) => (
              <li className="mg-star-failure__remedy" key={index}>
                {remedy}
              </li>
            ))}
          </ol>
          <div className="mg-star-failure__actions">
            {failure.retryable ? (
              <button type="button" className="mg-button" onClick={props.onRetry}>
                {copy.failure.retry}
              </button>
            ) : null}
            <button type="button" className="mg-button" onClick={props.onBackToPicker}>
              {copy.back}
            </button>
          </div>
          <p className="mg-star-failure__note">{copy.failure.changeNote}</p>
        </section>
      ) : status === 'idle' || status === 'generating' || puzzle === null ? (
        <div className="mg-star-empty" data-testid="star-empty">
          <h2 className="mg-star-empty__title">
            {status === 'idle' ? copy.empty.idleTitle : copy.empty.generatingTitle}
          </h2>
          <p className="mg-star-empty__body">
            {status === 'idle' ? copy.empty.idleBody : copy.empty.generatingBody}
          </p>
          {/* The progress line lives INSIDE the empty card: it says the card's
              own sentence with live numbers, and a phone never sees it as a
              new band — the card's centered grid already owns that space. The
              caret idiom is the main game's status caret, so "the machine is
              working" looks and blinks the same in both games. */}
          {status === 'generating' && progress !== null ? (
            <p className="mg-star-progress" data-phase={progress.phase} data-testid="star-progress">
              <span className="mg-star-progress__caret" aria-hidden="true">
                {copy.progress.caret}
              </span>
              <span className="mg-star-progress__line">
                {fill(copy.progress.line, {
                  phase: copy.progress.phases[progress.phase],
                  candidates: progress.candidates,
                })}
              </span>
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mg-star-gridwrap" data-testid="star-gridwrap">
          <div
            className="mg-star-grid"
            ref={gridRef}
            role="grid"
            aria-rowcount={n}
            aria-colcount={n}
            aria-label={fill(copy.boardLabel, { n })}
            aria-readonly={playing ? undefined : true}
            data-testid="star-grid"
            style={{ '--cols': String(n), '--rows': String(n) } as CSSProperties}
            {...interactiveAttrs}
          >
            {Array.from({ length: n }, (_, row) => (
              <div className="mg-star-row" role="row" key={row} data-row={row}>
                {Array.from({ length: n }, (_, col) => {
                  const index = row * n + col
                  const code = marks[index] ?? 0
                  const shown = displayMark(index, code, puzzle)
                  const wrong = code !== 0 && code !== LOCKED && isWrong(index, code, puzzle)
                  return (
                    <div
                      className="mg-star-cell"
                      role="gridcell"
                      key={col}
                      data-cell-index={index}
                      data-row={row}
                      data-col={col}
                      data-colour={puzzle.colours[index] ?? 0}
                      data-mark={shown}
                      data-wrong={wrong ? 'true' : undefined}
                      data-conflict={
                        shown !== 'unmarked' && shown !== 'locked-blank' && derived.conflicts.has(index)
                          ? 'true'
                          : undefined
                      }
                      data-inert={playing ? undefined : 'true'}
                      data-testid="star-cell"
                      aria-label={cellLabel(index, puzzle)}
                      tabIndex={roving === index ? 0 : -1}
                      onFocus={() => {
                        setRoving(index)
                      }}
                      ref={(node) => {
                        cellsRef.current[index] = node
                      }}
                    >
                      <span className="mg-star-cell__glyph" aria-hidden="true">
                        {shown === 'blank' || shown === 'locked-blank' ? '·' : '★'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      {status === 'won' ? (
        <div className="mg-star-banner" data-tone="won" data-testid="star-banner">
          <div className="mg-star-banner__body">
            <h2 className="mg-star-banner__title">{copy.banner.wonTitle}</h2>
            <p className="mg-star-banner__text">
              {fill(copy.banner.wonBody, { lives: props.lives })}
            </p>
            <div className="mg-star-banner__actions">
              <button
                type="button"
                className="mg-button"
                ref={primaryRef}
                onClick={props.onNewRound}
              >
                {copy.banner.wonPrimary}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {status === 'lost' ? (
        <div className="mg-star-banner" data-tone="lost" data-testid="star-banner">
          <div className="mg-star-banner__body">
            <h2 className="mg-star-banner__title">{copy.banner.lostTitle}</h2>
            <p className="mg-star-banner__text">{copy.banner.lostBody}</p>
            <div className="mg-star-banner__actions">
              <button
                type="button"
                className="mg-button"
                ref={primaryRef}
                onClick={props.onNewRound}
              >
                {copy.banner.restart}
              </button>
              <button type="button" className="mg-button" onClick={props.onBackToPicker}>
                {copy.back}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mg-star-live" role="status" aria-live="polite" ref={liveRef}>
        {notice}
      </div>
    </div>
  )
}
