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

/**
 * Star Battle surface: the whole second game as one props-driven view.
 * Presentational only — every mark request leaves through `onMark`, every
 * navigation through `onNewRound` / `onDifficultyChange` / `onBackToPicker`.
 * It never mutates a prop and never reaches for a store.
 *
 * Interaction vocabulary mirrors Minegram: left click (or a left drag)
 * paints blank, right click (or a right drag, or a long-press on touch)
 * paints star, a drag visits each cell at most once, and a re-assertion of
 * the mark a cell already carries is silent. Locked cells are inert.
 *
 * The copy object mirrors `src/ui/copy.ts`'s shape (exhaustive `en`, full
 * `zhCN` sibling) so the wiring lane can lift it into the central dictionary
 * without restructuring.
 */

export type StarDifficulty = 'starter' | 'steady' | 'challenging'

/** The ordered tier ids — the engine aligns its difficulty analysis to this. */
export const STAR_DIFFICULTIES: readonly StarDifficulty[] = ['starter', 'steady', 'challenging']

export interface StarBattlePuzzle {
  readonly n: number
  readonly seed: number
  /** `colours[row * n + col]` is a colour index in `[0, n)`. Read-only. */
  readonly colours: Uint8Array
  /** `solution[row]` is that row's star column. Read-only. */
  readonly solution: readonly number[]
}

export type StarMark = 'blank' | 'star' | null

export interface StarBattleSurfaceProps {
  readonly locale: 'en' | 'zh'
  readonly puzzle: StarBattlePuzzle
  /** Length `n * n`: 0 unmarked, 1 blank, 2 star, 3 locked-correct. Read-only. */
  readonly marks: Uint8Array
  readonly status: 'idle' | 'generating' | 'playing' | 'won' | 'lost'
  readonly score: number
  readonly mistakes: number
  readonly streak: number
  readonly difficulty: StarDifficulty
  readonly onMark: (row: number, col: number, next: StarMark) => void
  readonly onNewRound: () => void
  readonly onDifficultyChange: (difficulty: StarDifficulty) => void
  readonly onBackToPicker: () => void
}

/* --------------------------------------------------------------------------------------
 * Copy — lifted from `src/ui/copy.ts`'s dictionary shape.
 * -------------------------------------------------------------------------------------- */

interface StarCopy {
  readonly boardLabel: string
  readonly score: string
  readonly mistakes: string
  readonly streak: string
  readonly back: string
  readonly difficultyLabel: string
  readonly difficulties: Record<StarDifficulty, string>
  readonly counters: {
    readonly rows: string
    readonly columns: string
    readonly colours: string
    readonly group: string
  }
  readonly hint: string
  readonly empty: {
    readonly idleTitle: string
    readonly idleBody: string
    readonly generatingTitle: string
    readonly generatingBody: string
  }
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
      readonly locked: string
      readonly wrongStar: string
      readonly wrongBlank: string
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
  score: 'Score',
  mistakes: 'Mistakes',
  streak: 'Streak',
  back: 'All games',
  difficultyLabel: 'Difficulty',
  difficulties: { starter: 'Starter', steady: 'Steady', challenging: 'Challenging' },
  counters: {
    rows: 'Rows',
    columns: 'Columns',
    colours: 'Colours',
    group: '{label}: {done}/{total} satisfied',
  },
  hint: 'Left-click marks empty, right-click or long-press marks a star. Arrows move, Space marks empty, S marks a star.',
  empty: {
    idleTitle: 'No board yet',
    idleBody: 'Choose a difficulty to print one.',
    generatingTitle: 'Printing the board',
    generatingBody: 'This takes a moment.',
  },
  banner: {
    wonTitle: 'Board complete',
    wonBody: 'Score {score}. The next board starts on its own.',
    wonPrimary: 'Next board',
    lostTitle: 'Out of points',
    lostBody: 'The score reached zero.',
    restart: 'Restart',
  },
  cell: {
    at: 'Row {row} column {col}, colour {colour}',
    colour: 'colour {index}',
    states: {
      unmarked: 'unmarked',
      blank: 'empty',
      star: 'star',
      locked: 'locked star',
      wrongStar: 'wrong star, minus one point',
      wrongBlank: 'wrong empty mark, minus one point',
      conflict: 'too close to another star',
    },
  },
  live: {
    wrong: 'Wrong mark: {label}',
    won: 'Board complete',
    lost: 'Out of points',
  },
}

const zhCN: StarCopy = {
  boardLabel: '星战棋盘，{n} 乘 {n}',
  score: '分数',
  mistakes: '失误',
  streak: '连胜',
  back: '全部游戏',
  difficultyLabel: '难度',
  difficulties: { starter: '入门', steady: '进阶', challenging: '挑战' },
  counters: {
    rows: '行',
    columns: '列',
    colours: '颜色',
    group: '{label}：已满足 {done}/{total}',
  },
  hint: '左键标空，右键或长按标星。方向键移动，空格标空，S 键标星。',
  empty: {
    idleTitle: '还没有棋盘',
    idleBody: '选择难度后开始一局。',
    generatingTitle: '正在生成棋盘',
    generatingBody: '需要一点时间。',
  },
  banner: {
    wonTitle: '棋盘完成',
    wonBody: '得分 {score}。下一局会自动开始。',
    wonPrimary: '下一局',
    lostTitle: '分数耗尽',
    lostBody: '分数已经扣到零。',
    restart: '重新开始',
  },
  cell: {
    at: '第 {row} 行第 {col} 列，{colour}',
    colour: '颜色 {index}',
    states: {
      unmarked: '未标记',
      blank: '空白',
      star: '星标',
      locked: '已锁定的星标',
      wrongStar: '错误的星标，扣一分',
      wrongBlank: '错误的空白，扣一分',
      conflict: '与另一颗星相邻',
    },
  },
  live: {
    wrong: '标记错误：{label}',
    won: '棋盘完成',
    lost: '分数耗尽',
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

/* --------------------------------------------------------------------------------------
 * Derived state — pure functions of marks, colours and solution.
 * -------------------------------------------------------------------------------------- */

const LOCKED = 3

function isStarCode(code: number): boolean {
  return code === 2 || code === LOCKED
}

function isWrong(index: number, code: number, puzzle: StarBattlePuzzle): boolean {
  const row = Math.floor(index / puzzle.n)
  const col = index % puzzle.n
  return (code === 2 && puzzle.solution[row] !== col) || (code === 1 && puzzle.solution[row] === col)
}

export type StarLineState = 'open' | 'satisfied' | 'violated'

export interface StarLineCounter {
  readonly index: number
  readonly count: number
  readonly state: StarLineState
}

/**
 * One constraint line's counter. Satisfied means exactly one star AND it sits
 * on the solution — a single misplaced star reads as violated, because it is a
 * mark the player must correct, not a line that is merely unfinished.
 */
function lineCounter(
  indices: readonly number[],
  starIndices: readonly number[],
  misplaced: ReadonlySet<number>,
  index: number,
): StarLineCounter {
  let count = 0
  let wrong = false
  for (const i of indices) {
    if (starIndices.includes(i)) {
      count += 1
      if (misplaced.has(i)) {
        wrong = true
      }
    }
  }
  return {
    index,
    count,
    state: count === 0 ? 'open' : count === 1 && !wrong ? 'satisfied' : 'violated',
  }
}

interface StarDerived {
  readonly starIndices: readonly number[]
  readonly conflicts: ReadonlySet<number>
  readonly rows: readonly StarLineCounter[]
  readonly columns: readonly StarLineCounter[]
  readonly colours: readonly StarLineCounter[]
  readonly satisfied: { readonly rows: number; readonly columns: number; readonly colours: number }
}

function deriveStarState(marks: Uint8Array, puzzle: StarBattlePuzzle): StarDerived {
  const { n, colours } = puzzle
  const starIndices: number[] = []
  const misplaced = new Set<number>()
  for (let i = 0; i < marks.length; i += 1) {
    if (isStarCode(marks[i] ?? 0)) {
      starIndices.push(i)
      if (isWrong(i, marks[i] ?? 0, puzzle)) {
        misplaced.add(i)
      }
    }
  }
  // The proximity constraint has no counter, so it is computed for the cells:
  // any two star marks within Chebyshev distance 1 conflict, and both carry it.
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
  const rows: StarLineCounter[] = []
  const columns: StarLineCounter[] = []
  const colourCounters: StarLineCounter[] = []
  const byColour: number[][] = Array.from({ length: n }, () => [])
  for (let i = 0; i < n * n; i += 1) {
    byColour[colours[i] ?? 0]?.push(i)
  }
  for (let k = 0; k < n; k += 1) {
    const rowIdx: number[] = []
    const colIdx: number[] = []
    for (let c = 0; c < n; c += 1) {
      rowIdx.push(k * n + c)
      colIdx.push(c * n + k)
    }
    rows.push(lineCounter(rowIdx, starIndices, misplaced, k))
    columns.push(lineCounter(colIdx, starIndices, misplaced, k))
    colourCounters.push(lineCounter(byColour[k] ?? [], starIndices, misplaced, k))
  }
  const countSatisfied = (list: readonly StarLineCounter[]): number =>
    list.filter((c) => c.state === 'satisfied').length
  return {
    starIndices,
    conflicts,
    rows,
    columns,
    colours: colourCounters,
    satisfied: {
      rows: countSatisfied(rows),
      columns: countSatisfied(columns),
      colours: countSatisfied(colourCounters),
    },
  }
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
  const n = puzzle.n
  const copy = getStarCopy(props.locale)
  const playing = status === 'playing'

  const gridRef = useRef<HTMLDivElement | null>(null)
  const cellsRef = useRef<(HTMLDivElement | null)[]>([])
  const gestureRef = useRef<StarGesture | null>(null)
  const marksRef = useRef(marks)
  const previousMarksRef = useRef(marks)
  const previousStatusRef = useRef(status)
  const seenSeedRef = useRef(puzzle.seed)
  const liveRef = useRef<HTMLDivElement | null>(null)
  const [roving, setRoving] = useState(0)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    marksRef.current = marks
  }, [marks])

  const derived = useMemo(() => deriveStarState(marks, puzzle), [marks, puzzle])

  // A new board invalidates the roving index. Cell refs are NOT cleared here:
  // this effect runs after the refs attach, so clearing would leave the focus
  // table empty for the whole round; the ref callbacks overwrite entries as
  // cells render, which is enough.
  useEffect(() => {
    setRoving(0)
  }, [puzzle.seed])

  // Announce newly wrong marks and the round's end through the one polite region.
  useEffect(() => {
    if (seenSeedRef.current !== puzzle.seed) {
      // The round turned over; the new board's marks are the new baseline.
      seenSeedRef.current = puzzle.seed
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

  /** A click TOGGLES: the carried mark cycles to the next assertive state. */
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
      tool: event.button === 2 ? 'star' : 'blank',
      origin,
      painted: new Set([origin]),
      moved: false,
      longPressFired: false,
      downX: event.clientX,
      downY: event.clientY,
      longPressTimer: null,
    }
    // Touch has no right button: holding still promotes the stroke to a star.
    if (event.pointerType === 'touch') {
      gesture.longPressTimer = setTimeout(() => {
        if (gestureRef.current !== gesture || gesture.moved) {
          return
        }
        gesture.longPressFired = true
        gesture.tool = 'star'
        applySet(origin, 'star')
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
      // click toggle on release stands down.
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

  function cellLabel(index: number): string {
    const code = marks[index] ?? 0
    const at = fill(copy.cell.at, {
      row: Math.floor(index / n) + 1,
      col: (index % n) + 1,
      colour: (puzzle.colours[index] ?? 0) + 1,
    })
    const state = (() => {
      if (code === LOCKED) {
        return copy.cell.states.locked
      }
      if (code === 2) {
        if (isWrong(index, code, puzzle)) {
          return copy.cell.states.wrongStar
        }
        return derived.conflicts.has(index) ? copy.cell.states.conflict : copy.cell.states.star
      }
      if (code === 1) {
        return isWrong(index, code, puzzle) ? copy.cell.states.wrongBlank : copy.cell.states.blank
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

  return (
    <div className="mg-star-surface" data-status={status} data-testid="star-surface">
      <div className="mg-star-toolbar">
        <button
          type="button"
          className="mg-button mg-star-toolbar__back"
          onClick={props.onBackToPicker}
        >
          {copy.back}
        </button>
        <div className="mg-star-meter">
          <span className="mg-star-meter__item">
            <span className="mg-star-meter__label">{copy.score}</span>
            <span className="mg-star-meter__value" data-testid="star-score">
              {props.score}
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
        <SegmentedControl
          id="mg-star-difficulty"
          label={copy.difficultyLabel}
          value={props.difficulty}
          options={STAR_DIFFICULTIES.map((tier) => ({
            value: tier,
            label: copy.difficulties[tier],
          }))}
          disabled={status === 'generating'}
          onChange={props.onDifficultyChange}
        />
      </div>

      <ConstraintCounters
        kind="rows"
        counters={derived.rows}
        satisfied={derived.satisfied.rows}
        copy={copy}
      />
      <ConstraintCounters
        kind="columns"
        counters={derived.columns}
        satisfied={derived.satisfied.columns}
        copy={copy}
      />
      <ConstraintCounters
        kind="colours"
        counters={derived.colours}
        satisfied={derived.satisfied.colours}
        copy={copy}
      />

      {status === 'idle' || status === 'generating' ? (
        <div className="mg-star-empty" data-testid="star-empty">
          <h2 className="mg-star-empty__title">
            {status === 'idle' ? copy.empty.idleTitle : copy.empty.generatingTitle}
          </h2>
          <p className="mg-star-empty__body">
            {status === 'idle' ? copy.empty.idleBody : copy.empty.generatingBody}
          </p>
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
                      data-mark={
                        code === LOCKED ? 'locked' : code === 2 ? 'star' : code === 1 ? 'blank' : 'unmarked'
                      }
                      data-wrong={wrong ? 'true' : undefined}
                      data-conflict={
                        code !== 0 && code !== LOCKED && derived.conflicts.has(index) ? 'true' : undefined
                      }
                      data-inert={playing ? undefined : 'true'}
                      data-testid="star-cell"
                      aria-label={cellLabel(index)}
                      tabIndex={roving === index ? 0 : -1}
                      onFocus={() => {
                        setRoving(index)
                      }}
                      ref={(node) => {
                        cellsRef.current[index] = node
                      }}
                    >
                      <span className="mg-star-cell__glyph" aria-hidden="true">
                        {code === 1 ? '·' : '★'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mg-star-hint">{copy.hint}</p>

      {status === 'won' ? (
        <div className="mg-star-banner" data-tone="won" data-testid="star-banner">
          <div className="mg-star-banner__body">
            <h2 className="mg-star-banner__title">{copy.banner.wonTitle}</h2>
            <p className="mg-star-banner__text">
              {fill(copy.banner.wonBody, { score: props.score })}
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

function ConstraintCounters({
  kind,
  counters,
  satisfied,
  copy,
}: {
  readonly kind: 'rows' | 'columns' | 'colours'
  readonly counters: readonly StarLineCounter[]
  readonly satisfied: number
  readonly copy: StarCopy
}) {
  const label = copy.counters[kind]
  return (
    <div
      className="mg-star-counters__group"
      data-kind={kind}
      data-testid={`star-counters-${kind}`}
      aria-label={fill(copy.counters.group, {
        label,
        done: satisfied,
        total: counters.length,
      })}
    >
      <p className="mg-star-counters__label">{label}</p>
      <div className="mg-star-counters__chips">
        {counters.map((counter) => (
          <span
            key={counter.index}
            className="mg-star-chip"
            data-kind={kind === 'colours' ? 'colour' : 'line'}
            data-colour={kind === 'colours' ? counter.index : undefined}
            data-state={counter.state}
            data-testid={`counter-${kind}-${counter.index}`}
          >
            {counter.index + 1}
          </span>
        ))}
      </div>
    </div>
  )
}
