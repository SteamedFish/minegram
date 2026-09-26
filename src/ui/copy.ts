/**
 * Every user-visible string in Minegram lives here.
 *
 * `en` is exhaustive and `as const`, so `Copy` is the source of truth: a string
 * that is not in this file does not exist in the product. `zhCN` is a
 * `Partial<Copy>` override; anything it omits falls back to `en` through
 * `mergeDeep`, so a partially translated section is safe by construction.
 *
 * No engine text, thrown `Error.message`, or `JSON.stringify` output is ever a
 * dictionary value. Machine tokens (a failure reason, a proof status) are
 * rendered through the dictionaries below, never passed through raw.
 *
 * Pure module: no DOM access, no `Math.random`, no wall clock.
 */
import type { CellMark, GameResultReason, JsonObject, JsonValue } from '../application/gameReducer'
import type { GenerationFailureReason } from '../engine/generator'
import type { DifficultyBand } from '../engine/solver/difficulty'

// --------------------------------------------------------------------------------------
// en — the exhaustive dictionary
// --------------------------------------------------------------------------------------

const en = {
  app: {
    wordmark: 'MINEGRAM',
    product: 'Minegram',
    tagline: 'A mine-run puzzle printed one round at a time.',
  },

  locale: {
    label: 'Language',
    en: 'English',
    zhCN: '简体中文',
  },

  theme: {
    label: 'Theme',
    auto: 'Auto',
    light: 'Light',
    dark: 'Dark',
  },

  footer: {
    seed: 'Seed',
    seedUnavailable: 'This round derives its own seed.',
    language: 'Language',
    theme: 'Theme',
    source: 'Source repository',
  },

  /** Local storage keys. Owned here so the seed/theme/locale chrome has one home. */
  storage: {
    locale: 'minegram.lang',
    theme: 'minegram.theme',
    onboarded: 'minegram.onboarded',
    fingerMarking: 'minegram.fingerMarking',
  },

  status: {
    region: {
      idle: 'Ready',
      generating: 'Printing round {round}…',
      playing: 'Playing',
      won: 'Round {round} complete',
      lost: 'Round {round} lost',
      failed: 'Generation failed',
    },
    readOnly: 'Read only',
    printing: 'Printing',
    score: 'Score',
    scoreSpent: '{spent} spent',
    round: 'Round',
    roundChip: 'Round {round}',
    nextRound: 'Round {round}',
    difficulty: 'Difficulty',
  },

  generation: {
    printing: 'Printing round {round}',
    waiting: 'Waiting for the generator',
    background: 'A worker prints the board, so the page stays responsive.',
    caret: '▍',
  },

  round: {
    wonTitle: 'Round {round} complete',
    wonBody: 'Score {score}. The next round starts on its own.',
    wonPrimary: 'Next round',
    lostTitle: 'Round {round} lost',
    lostBody: 'The score reached zero.',
    lostPrimary: 'New seed',
    sameSeed: 'Same seed, identical board',
    newSeed: 'New seed',
    openSettings: 'Open settings',
  },

  resume: {
    title: 'Round {round} kept',
    body: 'The board is untouched. Continue where you stopped.',
    action: 'Resume round {round}',
    unavailable: 'No round to resume.',
  },

  toolbar: {
    mode: 'Marking',
    modes: {
      mine: 'Mine',
      blank: 'Empty',
      erase: 'Erase',
    },
    zoom: 'Zoom',
    zooms: {
      fit: 'Fit',
      s: 'Small',
      m: 'Medium',
      l: 'Large',
    },
    fingerMarking: 'Finger marking',
    fingerMarkingHint: 'On: a finger drag marks. Off: a tap marks one cell and a swipe scrolls the board.',
    generate: 'Generate',
    cancel: 'Cancel printing',
    keepWaiting: 'Keep waiting',
    capReached: 'Erase limit reached: {max} cells per drag',
    preview: {
      idle: 'Nothing to apply',
      score: '{cells} cells, score {from} to {to}',
      endsRound: '{cells} cells, score {from} to 0, the round ends',
      badge: 'Warning',
    },
  },

  board: {
    label: 'Minegram board, {rows} rows by {columns} columns',
    corner: 'Rows and columns',
    row: 'Row {index}',
    column: 'Column {index}',
    readOnly: 'The board is read only until a round is playing.',
    revealed: 'Line revealed',
    empty: {
      title: 'No round printed yet',
      body: 'Choose a size and a density, then print a board. One mine-run puzzle at a time, proved to have a single answer.',
      hint: 'Every line you close fills itself in.',
    },
  },

  cell: {
    unmarked: 'unmarked',
    confirmedMine: 'confirmed mine',
    confirmedEmpty: 'confirmed empty',
    wrongMine: 'claimed mine, incorrect',
    wrongBlank: 'claimed empty, incorrect',
    describe: '{position}, {state}',
    position: 'row {row}, column {column}',
  },

  clue: {
    empty: 'no mines',
    describe: '{line}: {clue}',
    rowLine: 'row {index}',
    columnLine: 'column {index}',
    runComplete: 'run {position} of {total} complete',
    lineComplete: 'line complete',
    contradiction: 'contradiction: no arrangement matches your marks',
    unresolvedTitle: 'progress unresolved: the pattern search hit its budget',
    unresolved: 'progress unresolved',
    separator: 'gap of at least one cell',
    runStates: {
      complete: 'complete',
      positioned: 'position forced, not finished',
      ambiguous: 'position not forced yet',
    },
  },

  /** Machine tokens rendered as prose. Anything missing falls back to the raw token. */
  tokens: {
    bands: {
      starter: 'Starter',
      steady: 'Steady',
      challenging: 'Challenging',
      expert: 'Expert',
    },
    proof: {
      'not-run': 'not run',
      unique: 'unique',
      multiple: 'more than one solution',
      none: 'no solution',
      unknown: 'unresolved',
    },
    difficultyStatus: {
      'not-run': 'not run',
      known: 'analysed',
      unknown: 'unresolved',
    },
    unknownReasons: {
      cancelled: 'cancelled',
      'time-limit': 'out of time',
      'node-limit': 'node limit reached',
      'resource-limit': 'resource limit reached',
      interrupted: 'interrupted',
      'incomplete-search': 'search incomplete',
    },
  },

  difficulty: {
    label: 'Difficulty',
    hint: 'The board is printed only if the analysis proves the requested band.',
    requested: 'Requested',
    proved: 'Proved',
    unverified: 'Unverified',
    unreported: 'Difficulty unreported',
    unresolved: 'Difficulty unresolved',
    minimumGuesses: 'Minimum guesses: {count}',
    definitions: {
      starter: 'No binary guesses needed.',
      steady: 'One or two binary guesses needed.',
      challenging: 'Three to five binary guesses needed.',
      expert: 'Six or more binary guesses needed.',
    },
    nonStarterNote: 'Only the Starter band is printed so far, so a harder request may not succeed.',
  },

  settings: {
    title: 'Settings',
    open: 'Settings',
    close: 'Close settings',
    rows: {
      label: 'Rows',
      hint: 'Between 1 and 24. Rows times columns must stay at 576 or fewer.',
    },
    columns: {
      label: 'Columns',
      hint: 'Between 1 and 24. Rows times columns must stay at 576 or fewer.',
    },
    density: {
      label: 'Density',
      hint: 'Mines as a share of all cells.',
      echo: 'mines: {count}',
    },
    seed: {
      label: 'Seed',
      hint: 'Later rounds derive their own seed from this one, so only this value is shown.',
      placeholder: 'Text or number',
    },
    maxAttempts: {
      label: 'Root attempts',
      hint: 'The generator deadline is 3 s. Values above 64 are not accepted.',
    },
    initialScore: {
      label: 'Initial score',
      hint: 'Each wrong claim costs one point. At zero the round ends.',
    },
    units: {
      percent: '%',
      points: 'points',
      cells: 'cells',
      seconds: 's',
    },
    actions: {
      generate: 'Generate',
      defaults: 'Defaults',
      newSeed: 'New seed',
    },
    infeasible: 'The generator rejected these settings.',
    infeasiblePrefix: 'The generator says:',
    derivedSeedNote: 'The printed round derives its own seed from the authored one.',
  },

  legend: {
    title: 'Legend',
    lead: 'Every state carries a shape, so the board reads without colour.',
    entries: {
      unmarked: { name: 'Unmarked', cue: 'Plain cell' },
      confirmedMine: { name: 'Confirmed mine', cue: 'Filled diamond with a corner stamp' },
      confirmedEmpty: { name: 'Confirmed empty', cue: 'Dot pressed into the cell' },
      wrongMine: { name: 'Claimed mine, incorrect', cue: 'Hollow diamond, dashed border, hatched' },
      wrongBlank: { name: 'Claimed empty, incorrect', cue: 'Hollow ring, dashed border, hatched' },
      dragPreview: { name: 'Drag preview', cue: 'Dotted outline, with a badge when the round would end' },
      runTape: { name: 'Run position forced', cue: 'Dotted underline under the run' },
      runComplete: { name: 'Run complete', cue: 'Solid underline under the run, and a tick on the chip' },
      lineComplete: { name: 'Line complete', cue: 'Filled rail cell with a tick' },
      contradiction: { name: 'Contradiction', cue: 'Dashed rail border with a cross' },
      unresolved: { name: 'Progress unresolved', cue: 'Dotted rail border with a question mark' },
      revealed: { name: 'Revealed line', cue: 'Faint tint and an edge along the closed line' },
    },
  },

  help: {
    open: 'Help',
    close: 'Close',
    title: 'How to read a gram',
    skip: 'Skip',
    sections: {
      gram: {
        title: 'What a gram is',
        body: 'Every row and every column is one gram: an ordered list of runs of mines, with at least one empty cell between neighbouring runs.',
        caption: '3 5 1 reads as three mines, a gap, five mines, a gap, then one mine, in that order along the line.',
      },
      claims: {
        title: 'The two claims',
        body: 'A cell is unmarked, claimed as a mine, or claimed as empty. A correct claim locks in place; a wrong claim stays visible and costs one point.',
        caption: 'Claiming the mark a cell already carries is always free.',
      },
      scoring: {
        title: 'Scoring',
        body: 'A correct claim costs nothing. A wrong claim costs one point. At zero the round ends.',
        caption: 'The score is the only resource the board asks for.',
      },
      controls: {
        title: 'Controls',
        body: 'Every action below is available by mouse, by touch, and by keyboard.',
      },
    },
    table: {
      caption: 'Controls',
      action: 'Action',
      mouse: 'Mouse',
      touch: 'Touch',
      keyboard: 'Keyboard',
    },
    actions: {
      markMine: {
        action: 'Mark a mine',
        mouse: 'Left click or drag with Mine selected, or right-click while Empty is selected',
        touch: 'Tap or drag with finger marking on',
        keyboard: 'M on the focused cell',
      },
      markEmpty: {
        action: 'Mark empty',
        mouse: 'Left click or drag with Empty selected, or right-click while Mine is selected',
        touch: 'Tap or drag with finger marking on',
        keyboard: 'B on the focused cell',
      },
      erase: {
        action: 'Erase a mark',
        mouse: 'Erase mode click, or Shift with right-click',
        touch: 'Erase mode tap',
        keyboard: 'Backspace or Delete',
      },
      cancelDrag: {
        action: 'Cancel a drag',
        mouse: 'Release outside the board, or Escape',
        touch: 'Swipe, the board scrolls',
        keyboard: 'Escape',
      },
      moveFocus: {
        action: 'Move focus',
        mouse: 'Click a cell',
        touch: 'Tap a cell',
        keyboard: 'Arrow keys, Home, End, Ctrl+Home, Ctrl+End',
      },
      zoom: {
        action: 'Zoom',
        mouse: 'Zoom control',
        touch: 'Zoom control',
        keyboard: 'Tab to the control, then the arrow keys',
      },
      settings: {
        action: 'Settings',
        mouse: 'Banner disclosure',
        touch: 'Banner disclosure',
        keyboard: 'Tab, then Enter or Space',
      },
      nextRound: {
        action: 'Next round',
        mouse: 'Banner button',
        touch: 'Banner button',
        keyboard: 'Focus lands on it after a win',
      },
    },
  },

  /** Polite live-region sentences. One short, concrete sentence per event. */
  announce: {
    generationStarted: 'Printing round {round}',
    roundReady: 'Round {round} ready',
    roundWon: 'Round {round} complete. Score {score}. The next round starts now.',
    roundLost: 'Round lost. The score reached zero.',
    marksApplied: 'Marked {cells} cells as {assertion}. Wrong: {wrong}. Score {score}.',
    /**
     * Appended to `marksApplied` when the same commit also closed a line. The
     * pair is singular/plural in English; Chinese has no plural inflection, so
     * its two entries are the same sentence.
     */
    revealNoteOne: 'The game filled {cells} cell in the line you completed.',
    revealNoteMany: 'The game filled {cells} cells in the {lines} lines you completed.',
    /** Used when the fill accounts for the whole change, so nothing is credited. */
    revealOnlyOne: 'You completed {lines} line. The game filled {cells} cell. Score {score}.',
    revealOnlyMany: 'You completed {lines} lines. The game filled {cells} cells. Score {score}.',
    markCleared: 'Mark cleared.',
    roundResumed: 'Round {round} restored. Nothing was lost.',
    generationFailed: 'Generation stopped: {reason}',
    generationCancelled: 'The round was cancelled before it was printed.',
    ignored: 'Nothing changed: {reason}',
    rejected: 'Not applied: {reason}',
    assertions: {
      mine: 'mines',
      blank: 'empty',
    },
    mode: 'Marking: {mode}',
    fingerMarking: 'Finger marking {state}.',
    zoom: 'Zoom {step}.',
    on: 'on',
    off: 'off',
  },

  failure: {
    headlineFallback: 'Generation failed',
    explanationFallback: 'The round was not printed. Nothing you have marked was changed.',
    remediesFallback: ['Open the settings and print again.', 'Try a different seed.'],
    unknownReason: {
      headline: 'Generation failed',
      explanation: 'The generator stopped for a reason the app does not recognise.',
      remedies: ['Retry the same settings.', 'Open the settings and change one value.', 'Try a different seed.'],
    },
    actions: {
      retry: 'Retry',
      retryHint: 'Retry the same settings',
      newSeed: 'New seed',
      openSettings: 'Open settings',
      dismiss: 'Dismiss',
      copyReport: 'Copy reproducible report (includes seed)',
      copied: 'Report copied',
      reportDisclosure: 'Reproducible report',
      backToBoard: 'Back to the board',
    },
    report: {
      rows: 'Rows',
      columns: 'Columns',
      density: 'Density',
      mineCount: 'Mines',
      difficultyBand: 'Requested band',
      maxAttempts: 'Root attempts',
      seed: 'Authored seed',
      seedUnavailable: 'Derived for this round',
      seedSource: 'Seed source',
      seedSourceAuthored: 'authored',
      seedSourceDerived: 'derived for round {round}',
      seedDerived: 'Derived seed (clipboard only)',
      attempts: 'Attempts',
      layouts: 'Layouts',
      candidates: 'Candidates',
      accepted: 'Accepted',
      rollbacks: 'Rollbacks',
      solverCalls: 'Solver calls',
      solverStatuses: 'Solver outcomes',
      resourceReasons: 'Resource stops',
      difficultyNodesVisited: 'Difficulty nodes visited',
      difficultyNodeLimit: 'Difficulty node limit',
      proofStatus: 'Proof',
      difficultyStatus: 'Difficulty analysis',
      difficultyReason: 'Difficulty reason',
      minimumGuesses: 'Minimum guesses',
      band: 'Analysed band',
      list: '{count} · {values}',
      emptyList: 'none',
    },
    reasons: {
      // GenerationFailureReason
      cancelled: {
        headline: 'Cancelled',
        explanation: 'Nothing was lost and the settings are unchanged.',
        remedies: ['Print the round again when you are ready.'],
      },
      'time-limit': {
        headline: 'The generator ran out of time',
        explanation: 'The generator has a three second deadline and stopped before it could prove a board.',
        remedies: ['Retry the same settings.', 'Reduce the board size or the density.', 'Raise the root attempts.'],
      },
      'resource-limit': {
        headline: 'The generator hit a resource limit',
        explanation: 'A layout asked for more line patterns than the solver is allowed to materialise.',
        remedies: ['Reduce the board size or the density.', 'Raise the root attempts.', 'Try a different seed.'],
      },
      'attempt-limit': {
        headline: 'No layout succeeded within the root attempts',
        explanation: 'Every layout was tried and none passed. The same settings would stop the same way.',
        remedies: ['Raise the root attempts.', 'Ask for the Starter band.', 'Try a different seed.'],
      },
      'difficulty-not-found': {
        headline: 'The requested difficulty was not reached',
        explanation: 'The generator cannot prove the requested band at these settings.',
        remedies: ['Ask for the Starter band.', 'Change the seed.', 'Reduce the root attempts.'],
      },
      infeasible: {
        headline: 'These settings cannot produce a board',
        explanation: 'The mine count leaves no room for the ordered runs that every row and every column needs.',
        remedies: ['Lower the density.', 'Reduce the board size.', 'Try a different seed.'],
      },

      // Generation Worker / client reasons
      'worker-exception': {
        headline: 'The generator stopped unexpectedly',
        explanation: 'The worker did not finish printing the round.',
        remedies: ['Retry the same settings.', 'Open the settings and change one value.'],
      },
      'worker-error': {
        headline: 'The generator stopped unexpectedly',
        explanation: 'The worker reported a fault and was closed.',
        remedies: ['Retry the same settings.', 'Reload the page if it happens again.'],
      },
      'worker-message-error': {
        headline: 'The generator sent an unreadable message',
        explanation: 'The worker replied with something the app could not read, so the round was not accepted.',
        remedies: ['Retry the same settings.', 'Reload the page if it happens again.'],
      },
      'worker-unavailable': {
        headline: 'The generator could not be started',
        explanation: 'This browser did not provide a worker, so no round can be printed.',
        remedies: ['Reload the page.', 'Use a browser that supports module workers.'],
      },
      'worker-post-error': {
        headline: 'The request to the generator was not accepted',
        explanation: 'The worker refused the request before it could start printing.',
        remedies: ['Retry the same settings.', 'Reload the page if it happens again.'],
      },
      'invalid-worker-response': {
        headline: 'The generator replied with something unreadable',
        explanation: 'The reply did not match the protocol, so the round was not accepted.',
        remedies: ['Retry the same settings.', 'Reload the page if it happens again.'],
      },
      'invalid-generated-round': {
        headline: 'The printed round was not accepted',
        explanation: 'The round did not match the settings that were requested.',
        remedies: ['Open the settings and print again.', 'Try a different seed.'],
      },

      // GameResultReason — a rejected or ignored action, not a generation fault
      'not-generating': {
        headline: 'A round is already printing',
        explanation: 'Wait for the current round, then start again.',
        remedies: ['Keep waiting.'],
      },
      'stale-generation-id': {
        headline: 'An earlier request was dropped',
        explanation: 'A reply arrived after its request had already been replaced, so it was ignored.',
        remedies: ['Wait for the round that is printing.'],
      },
      'invalid-settings': {
        headline: 'The generator rejected these settings',
        explanation: 'One value is outside the range the generator accepts.',
        remedies: ['Open the settings and correct the highlighted value.'],
      },
      'invalid-initial-score': {
        headline: 'The initial score is not usable',
        explanation: 'The initial score must be a whole number above zero.',
        remedies: ['Set an initial score from 1 to 99.'],
      },
      'invalid-difficulty': {
        headline: 'That difficulty band is not usable',
        explanation: 'The generator did not report a difficulty the app understands.',
        remedies: ['Ask for the Starter band.', 'Try a different seed.'],
      },
      'round-not-playing': {
        headline: 'Only a playing round accepts marks',
        explanation: 'Marks are ignored while a round is printing, finished, or lost.',
        remedies: ['Resume the kept round.', 'Start a new round.'],
      },
      'invalid-batch': {
        headline: 'That mark could not be read',
        explanation: 'The batch was empty or malformed, so nothing was applied.',
        remedies: ['Mark one cell at a time, or drag across the cells you want.'],
      },
      'conflicting-assertions': {
        headline: 'One cell was claimed twice in one gesture',
        explanation: 'A single drag cannot mark the same cell as a mine and as empty.',
        remedies: ['Drag across the cells once, then correct any cell on its own.'],
      },
      'invalid-cell-index': {
        headline: 'That cell is outside the board',
        explanation: 'Nothing was applied.',
        remedies: ['Mark a cell inside the board.'],
      },
      'invalid-cell-assertion': {
        headline: 'A cell can only be claimed as a mine or as empty',
        explanation: 'Nothing was applied.',
        remedies: ['Pick Mine or Empty in the toolbar.'],
      },
      'round-not-resumable': {
        headline: 'There is no kept round to resume',
        explanation: 'The round is already playing, or no round was kept.',
        remedies: ['Start a new round.'],
      },
      'locked-cell': {
        headline: 'A confirmed cell cannot be changed',
        explanation: 'Correct claims lock in place, so the batch was skipped.',
        remedies: ['Erase an unlocked cell to change it.'],
      },
      'cell-already-marked': {
        headline: 'Those cells already carry that mark',
        explanation: 'Re-claiming the same mark is free and changes nothing.',
        remedies: ['Use Erase to clear a cell first.'],
      },
      'cell-already-unknown': {
        headline: 'That cell is already unmarked',
        explanation: 'There was nothing to clear.',
        remedies: ['Pick a cell that carries a mark.'],
      },
    },
  },
} as const

/**
 * `en` is `as const`, so its leaves are literals and `Partial<Copy>` would be
 * unsatisfiable. `Copy` widens the literals to `string`, which is what makes
 * `zhCN: Partial<Copy>` mean "override any subset of these keys".
 */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? readonly Widen<U>[]
        : T extends object
          ? { readonly [K in keyof T]: Widen<T[K]> }
          : T

export type Copy = Widen<typeof en>

// --------------------------------------------------------------------------------------
// zh-CN — partial override, merged over en
// --------------------------------------------------------------------------------------

export const zhCN: Partial<Copy> = {
  app: {
    wordmark: 'MINEGRAM',
    product: 'Minegram',
    tagline: '一局一印的有序雷区推理。',
  },

  locale: {
    label: '语言',
    en: 'English',
    zhCN: '简体中文',
  },

  theme: {
    label: '主题',
    auto: '跟随系统',
    light: '浅色',
    dark: '深色',
  },

  footer: {
    seed: '种子',
    seedUnavailable: '本局使用派生种子。',
    language: '语言',
    theme: '主题',
    source: '源码仓库',
  },

  storage: {
    locale: 'minegram.lang',
    theme: 'minegram.theme',
    onboarded: 'minegram.onboarded',
    fingerMarking: 'minegram.fingerMarking',
  },

  status: {
    region: {
      idle: '就绪',
      generating: '正在生成第 {round} 局…',
      playing: '进行中',
      won: '第 {round} 局完成',
      lost: '第 {round} 局失败',
      failed: '生成失败',
    },
    readOnly: '只读',
    printing: '生成中',
    score: '分数',
    scoreSpent: '已用 {spent}',
    round: '局数',
    roundChip: '第 {round} 局',
    nextRound: '第 {round} 局',
    difficulty: '难度',
  },

  generation: {
    printing: '正在生成第 {round} 局',
    waiting: '等待生成器',
    background: '棋盘在 Worker 中生成，页面保持可用。',
    caret: '▍',
  },

  round: {
    wonTitle: '第 {round} 局完成',
    wonBody: '分数 {score}。下一局将自动开始。',
    wonPrimary: '下一局',
    lostTitle: '第 {round} 局结束',
    lostBody: '分数已归零。',
    lostPrimary: '换个种子',
    sameSeed: '同一种子，棋盘完全相同',
    newSeed: '换个种子',
    openSettings: '打开设置',
  },

  resume: {
    title: '第 {round} 局仍在',
    body: '棋盘原样保留，可以接着玩。',
    action: '继续第 {round} 局',
    unavailable: '没有可继续的棋局。',
  },

  toolbar: {
    mode: '标记方式',
    modes: {
      mine: '雷',
      blank: '空',
      erase: '擦除',
    },
    zoom: '缩放',
    zooms: {
      fit: '适应',
      s: '小',
      m: '中',
      l: '大',
    },
    fingerMarking: '手指标记',
    fingerMarkingHint: '开启：手指拖动即标记。关闭：轻点标记一格，滑动则滚动棋盘。',
    generate: '生成',
    cancel: '取消生成',
    keepWaiting: '继续等待',
    capReached: '已达擦除上限：每次拖动 {max} 格',
    preview: {
      idle: '没有可应用的改动',
      score: '{cells} 格，分数 {from} → {to}',
      endsRound: '{cells} 格，分数 {from} → 0，本局结束',
      badge: '注意',
    },
  },

  board: {
    label: 'Minegram 棋盘，{rows} 行 {columns} 列',
    corner: '行与列',
    row: '第 {index} 行',
    column: '第 {index} 列',
    readOnly: '只有本局进行中时棋盘才可操作。',
    revealed: '该行或列已确认',
    empty: {
      title: '还没有印出棋局',
      body: '选定尺寸与密度，然后印出棋盘。一次一局矿道谜题，并已证明只有一个答案。',
      hint: '你确认的每一行或列都会自动填满。',
    },
  },

  cell: {
    unmarked: '未标记',
    confirmedMine: '确认是雷',
    confirmedEmpty: '确认是空',
    wrongMine: '标为雷，错误',
    wrongBlank: '标为空，错误',
    describe: '{position}，{state}',
    position: '第 {row} 行第 {column} 列',
  },

  clue: {
    empty: '没有雷',
    describe: '{line}：{clue}',
    rowLine: '第 {index} 行',
    columnLine: '第 {index} 列',
    runComplete: '第 {position} 段（共 {total} 段）已完成',
    lineComplete: '本行或本列已确认',
    contradiction: '矛盾：没有任何排列与你的标记相符',
    unresolvedTitle: '进度未解：模式搜索已到预算上限',
    unresolved: '进度未解',
    separator: '至少一格的间隔',
    runStates: {
      complete: '已完成',
      positioned: '位置已确定，尚未完成',
      ambiguous: '位置尚未确定',
    },
  },

  tokens: {
    bands: {
      starter: '入门',
      steady: '稳定',
      challenging: '进阶',
      expert: '专家',
    },
    proof: {
      'not-run': '未执行',
      unique: '唯一解',
      multiple: '存在多个解',
      none: '无解',
      unknown: '未解',
    },
    difficultyStatus: {
      'not-run': '未执行',
      known: '已分析',
      unknown: '未解',
    },
    unknownReasons: {
      cancelled: '已取消',
      'time-limit': '超出时间',
      'node-limit': '超出节点上限',
      'resource-limit': '超出资源上限',
      interrupted: '被中断',
      'incomplete-search': '搜索未完成',
    },
  },

  difficulty: {
    label: '难度',
    hint: '只有在分析证明达到所选难度时，棋盘才会被生成。',
    requested: '所选难度',
    proved: '已证明',
    unverified: '未经证实',
    unreported: '生成器未报告难度',
    unresolved: '难度未解',
    minimumGuesses: '最少猜测次数：{count}',
    definitions: {
      starter: '不需要任何二值猜测。',
      steady: '需要一到两次二值猜测。',
      challenging: '需要三到五次二值猜测。',
      expert: '需要六次及以上二值猜测。',
    },
    nonStarterNote: '目前只能生成入门档，选择更高难度可能失败。',
  },

  settings: {
    title: '设置',
    open: '设置',
    close: '关闭设置',
    rows: {
      label: '行数',
      hint: '1 到 24。行数乘列数不超过 576。',
    },
    columns: {
      label: '列数',
      hint: '1 到 24。行数乘列数不超过 576。',
    },
    density: {
      label: '雷密度',
      hint: '雷数占全部格子的比例。',
      echo: '雷数：{count}',
    },
    seed: {
      label: '种子',
      hint: '之后的局会从这个种子派生新种子，因此只显示这里填写的值。',
      placeholder: '文字或数字',
    },
    maxAttempts: {
      label: '根尝试次数',
      hint: '生成器的截止时间为 3 秒。超过 64 的值不被接受。',
    },
    initialScore: {
      label: '初始分数',
      hint: '每标错一格扣一分。分数归零时本局结束。',
    },
    units: {
      percent: '%',
      points: '分',
      cells: '格',
      seconds: '秒',
    },
    actions: {
      generate: '生成',
      defaults: '恢复默认',
      newSeed: '换个种子',
    },
    infeasible: '生成器拒绝了这些设置。',
    infeasiblePrefix: '生成器的说明：',
    derivedSeedNote: '本局使用的种子由你填写的种子派生而来。',
  },

  legend: {
    title: '图例',
    lead: '每种状态都带有形状提示，不依赖颜色也能读懂。',
    entries: {
      unmarked: { name: '未标记', cue: '空白格' },
      confirmedMine: { name: '确认是雷', cue: '实心菱形加右上角印记' },
      confirmedEmpty: { name: '确认是空', cue: '中心圆点，像压进纸面' },
      wrongMine: { name: '标为雷，错误', cue: '空心菱形，虚线边框，加斜纹' },
      wrongBlank: { name: '标为空，错误', cue: '空心圆环，虚线边框，加斜纹' },
      dragPreview: { name: '拖动预览', cue: '点线描边，本局将结束时出现角标' },
      runTape: { name: '段落位置已定', cue: '该段下方有点线下划线' },
      runComplete: { name: '段落已完成', cue: '该段下方实线下划线，数字块上有对勾' },
      lineComplete: { name: '行列已确认', cue: '整格填色并带对勾' },
      contradiction: { name: '矛盾', cue: '提示格虚线边框加叉号' },
      unresolved: { name: '进度未解', cue: '提示格点线边框加问号' },
      revealed: { name: '已确认的行或列', cue: '淡淡的底色与该行或列的边缘线' },
    },
  },

  help: {
    open: '帮助',
    close: '关闭',
    title: '如何读一条 gram',
    skip: '跳过',
    sections: {
      gram: {
        title: '什么是 gram',
        body: '每一行、每一列都是一条 gram：按顺序排列的雷段，相邻两段之间至少有一格空位。',
        caption: '3 5 1 表示：三个雷、一段间隔、五个雷、一段间隔、一个雷，顺序沿着该行或该列。',
      },
      claims: {
        title: '两种断言',
        body: '每格只有三种状态：未标记、标为雷、标为空。正确的断言会被锁定，错误的断言会保留显示并扣一分。',
        caption: '重复标记一格已有的标记永远不扣分。',
      },
      scoring: {
        title: '计分',
        body: '标对不扣分，标错扣一分，分数归零时本局结束。',
        caption: '分数是棋盘唯一需要的资源。',
      },
      controls: {
        title: '操作方式',
        body: '下面的每个操作都可以用鼠标、触屏和键盘完成。',
      },
    },
    table: {
      caption: '操作对照',
      action: '操作',
      mouse: '鼠标',
      touch: '触屏',
      keyboard: '键盘',
    },
    actions: {
      markMine: {
        action: '标为雷',
        mouse: '选中「雷」后左键点击或拖动；选中「空」时右键',
        touch: '开启手指标记后轻点或拖动',
        keyboard: 'M 标记当前格',
      },
      markEmpty: {
        action: '标为空',
        mouse: '选中「空」后左键点击或拖动；选中「雷」时右键',
        touch: '开启手指标记后轻点或拖动',
        keyboard: 'B 标记当前格',
      },
      erase: {
        action: '擦除标记',
        mouse: '切到擦除模式点击，或 Shift 加右键',
        touch: '切到擦除模式轻点',
        keyboard: 'Backspace 或 Delete',
      },
      cancelDrag: {
        action: '取消拖动',
        mouse: '在棋盘外松开，或按 Escape',
        touch: '滑动，棋盘会滚动',
        keyboard: 'Escape',
      },
      moveFocus: {
        action: '移动焦点',
        mouse: '点击某一格',
        touch: '轻点某一格',
        keyboard: '方向键、Home、End、Ctrl+Home、Ctrl+End',
      },
      zoom: {
        action: '缩放',
        mouse: '缩放控件',
        touch: '缩放控件',
        keyboard: 'Tab 移到控件，再用方向键',
      },
      settings: {
        action: '设置',
        mouse: '顶栏的展开按钮',
        touch: '顶栏的展开按钮',
        keyboard: 'Tab，然后 Enter 或空格',
      },
      nextRound: {
        action: '下一局',
        mouse: '横幅上的按钮',
        touch: '横幅上的按钮',
        keyboard: '胜利后焦点会落在该按钮上',
      },
    },
  },

  announce: {
    generationStarted: '正在生成第 {round} 局',
    roundReady: '第 {round} 局已就绪',
    roundWon: '第 {round} 局完成。分数 {score}。下一局即将开始。',
    roundLost: '本局结束，分数已归零。',
    marksApplied: '已把 {cells} 格标为{assertion}，其中 {wrong} 格标错。分数 {score}。',
    revealNoteOne: '你完成的那一行里，游戏替你填上了 {cells} 格。',
    revealNoteMany: '你完成的 {lines} 行里，游戏替你填上了 {cells} 格。',
    revealOnlyOne: '你完成了 {lines} 行，游戏替你填上了 {cells} 格。分数 {score}。',
    revealOnlyMany: '你完成了 {lines} 行，游戏替你填上了 {cells} 格。分数 {score}。',
    markCleared: '已擦除标记。',
    roundResumed: '第 {round} 局已恢复，没有丢失任何内容。',
    generationFailed: '生成已停止：{reason}',
    generationCancelled: '这一局在生成前已取消。',
    ignored: '没有变化：{reason}',
    rejected: '未生效：{reason}',
    assertions: {
      mine: '雷',
      blank: '空',
    },
    mode: '标记方式：{mode}',
    fingerMarking: '手指标记{state}。',
    zoom: '缩放 {step}。',
    on: '已开启',
    off: '已关闭',
  },

  failure: {
    headlineFallback: '生成失败',
    explanationFallback: '本局没有生成，你标记的内容没有任何变化。',
    remediesFallback: ['打开设置后重新生成。', '换一个种子试试。'],
    unknownReason: {
      headline: '生成失败',
      explanation: '生成器因为一个应用无法识别的原因停止了。',
      remedies: ['用相同的设置重试。', '打开设置，改动一个数值。', '换一个种子试试。'],
    },
    actions: {
      retry: '重试',
      retryHint: '用相同的设置重试',
      newSeed: '换个种子',
      openSettings: '打开设置',
      dismiss: '关闭',
      copyReport: '复制可复现报告（含种子）',
      copied: '报告已复制',
      reportDisclosure: '可复现报告',
      backToBoard: '回到棋盘',
    },
    report: {
      rows: '行数',
      columns: '列数',
      density: '密度',
      mineCount: '雷数',
      difficultyBand: '所选难度',
      maxAttempts: '根尝试次数',
      seed: '你填写的种子',
      seedUnavailable: '本局为派生种子',
      seedSource: '种子来源',
      seedSourceAuthored: '由你填写',
      seedSourceDerived: '第 {round} 局派生',
      seedDerived: '派生种子（仅复制到剪贴板时出现）',
      attempts: '尝试次数',
      layouts: '布局数',
      candidates: '候选数',
      accepted: '接受数',
      rollbacks: '回滚数',
      solverCalls: '求解调用',
      solverStatuses: '求解结果',
      resourceReasons: '资源中止原因',
      difficultyNodesVisited: '难度分析访问节点',
      difficultyNodeLimit: '难度分析节点上限',
      proofStatus: '唯一性证明',
      difficultyStatus: '难度分析',
      difficultyReason: '难度分析中止原因',
      minimumGuesses: '最少猜测次数',
      band: '分析出的难度',
      list: '{count} 项 · {values}',
      emptyList: '无',
    },
    reasons: {
      cancelled: {
        headline: '已取消',
        explanation: '没有丢失任何内容，设置保持不变。',
        remedies: ['准备好之后重新生成本局。'],
      },
      'time-limit': {
        headline: '生成器超出时间',
        explanation: '生成器的截止时间是三秒，它在证明出棋盘之前就停止了。',
        remedies: ['用相同的设置重试。', '减小棋盘尺寸或密度。', '提高根尝试次数。'],
      },
      'resource-limit': {
        headline: '生成器触及资源上限',
        explanation: '某个布局需要的模式数量超过了求解器允许展开的上限。',
        remedies: ['减小棋盘尺寸或密度。', '提高根尝试次数。', '换一个种子试试。'],
      },
      'attempt-limit': {
        headline: '在根尝试次数内没有可用布局',
        explanation: '所有布局都试过了，没有一个通过。相同的设置会以同样的方式停止。',
        remedies: ['提高根尝试次数。', '改选入门难度。', '换一个种子试试。'],
      },
      'difficulty-not-found': {
        headline: '没有达到所选难度',
        explanation: '在这些设置下，生成器无法证明所选的难度档。',
        remedies: ['改选入门难度。', '换一个种子。', '减少根尝试次数。'],
      },
      infeasible: {
        headline: '这些设置无法生成棋盘',
        explanation: '雷数没有给每一行每一列所需的有序雷段留下空间。',
        remedies: ['降低密度。', '减小棋盘尺寸。', '换一个种子试试。'],
      },
      'worker-exception': {
        headline: '生成器意外停止',
        explanation: 'Worker 没有完成本局的生成。',
        remedies: ['用相同的设置重试。', '打开设置，改动一个数值。'],
      },
      'worker-error': {
        headline: '生成器意外停止',
        explanation: 'Worker 报告了故障并被关闭。',
        remedies: ['用相同的设置重试。', '如果再次发生，请刷新页面。'],
      },
      'worker-message-error': {
        headline: '生成器返回了无法识别的消息',
        explanation: 'Worker 的回复无法读取，因此本局没有被接受。',
        remedies: ['用相同的设置重试。', '如果再次发生，请刷新页面。'],
      },
      'worker-unavailable': {
        headline: '无法启动生成器',
        explanation: '当前浏览器没有提供 Worker，因此无法生成棋盘。',
        remedies: ['刷新页面。', '换一个支持 module worker 的浏览器。'],
      },
      'worker-post-error': {
        headline: '生成器没有接受这次请求',
        explanation: 'Worker 在开始生成之前就拒绝了这个请求。',
        remedies: ['用相同的设置重试。', '如果再次发生，请刷新页面。'],
      },
      'invalid-worker-response': {
        headline: '生成器的回复无法识别',
        explanation: '回复不符合协议，因此本局没有被接受。',
        remedies: ['用相同的设置重试。', '如果再次发生，请刷新页面。'],
      },
      'invalid-generated-round': {
        headline: '生成的棋局未被接受',
        explanation: '该棋局与请求时的设置不一致。',
        remedies: ['打开设置后重新生成。', '换一个种子试试。'],
      },
      'not-generating': {
        headline: '已经有一局在生成中',
        explanation: '等当前这局结束，再重新开始。',
        remedies: ['继续等待。'],
      },
      'stale-generation-id': {
        headline: '丢弃了一次过期的结果',
        explanation: '回复到达时它对应的请求已经被替换，因此被忽略。',
        remedies: ['等待正在生成的那一局。'],
      },
      'invalid-settings': {
        headline: '生成器拒绝了这些设置',
        explanation: '有一个数值超出了生成器接受的范围。',
        remedies: ['打开设置，修正被标出的数值。'],
      },
      'invalid-initial-score': {
        headline: '初始分数不可用',
        explanation: '初始分数必须是不小于 1 的整数。',
        remedies: ['把初始分数设为 1 到 99 之间的值。'],
      },
      'invalid-difficulty': {
        headline: '该难度档不可用',
        explanation: '生成器没有报告应用能够理解的难度。',
        remedies: ['改选入门难度。', '换一个种子试试。'],
      },
      'round-not-playing': {
        headline: '只有进行中的棋局可以标记',
        explanation: '在生成、完成或结束状态下，标记会被忽略。',
        remedies: ['继续保留的那一局。', '开始新的一局。'],
      },
      'invalid-batch': {
        headline: '无法读取这次标记',
        explanation: '这次批量标记为空或格式不正确，因此没有生效。',
        remedies: ['一次标记一格，或直接拖过想要标记的格子。'],
      },
      'conflicting-assertions': {
        headline: '同一次操作里同一格被断言了两次',
        explanation: '一次拖动不能把同一格同时标为雷和标为空。',
        remedies: ['先拖过一次，再单独修改需要改的格子。'],
      },
      'invalid-cell-index': {
        headline: '该格子不在棋盘上',
        explanation: '没有生效。',
        remedies: ['标记棋盘内的格子。'],
      },
      'invalid-cell-assertion': {
        headline: '一格只能标为雷或标为空',
        explanation: '没有生效。',
        remedies: ['在工具栏里选择「雷」或「空」。'],
      },
      'round-not-resumable': {
        headline: '没有可以继续的棋局',
        explanation: '当前棋局已经在进行中，或者没有保留棋盘。',
        remedies: ['开始新的一局。'],
      },
      'locked-cell': {
        headline: '已确认的格子不能更改',
        explanation: '正确的断言会被锁定，因此这次批量标记被跳过。',
        remedies: ['先擦除未锁定的格子再重新标记。'],
      },
      'cell-already-marked': {
        headline: '这些格子已经是这个标记',
        explanation: '重复标记同一个标记不扣分，也不会改变任何内容。',
        remedies: ['先用擦除清掉，再重新标记。'],
      },
      'cell-already-unknown': {
        headline: '这一格本来就没有标记',
        explanation: '没有可清除的内容。',
        remedies: ['选择一格带标记的格子。'],
      },
    },
  },
}

// --------------------------------------------------------------------------------------
// Dictionaries
// --------------------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Six lines, no library: nested plain objects merge, everything else replaces. */
/**
 * Recursive override: plain objects merge key by key, everything else replaces.
 * Exported so a caller can build a partial dictionary with the same semantics.
 */
export function mergeDeep<T>(base: T, override: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return (override === undefined ? base : (override as T))
  }
  const merged: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue
    }
    merged[key] = key in merged ? mergeDeep(merged[key], value) : value
  }
  return merged as T
}

export const dictionaries = {
  en,
  'zh-CN': mergeDeep(en, zhCN),
} as const

export type Locale = keyof typeof dictionaries

export const LOCALES = Object.freeze(Object.keys(dictionaries) as Locale[])

export const DEFAULT_LOCALE: Locale = 'en'

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(dictionaries, value)
}

export function getCopy(locale: Locale): Copy {
  return dictionaries[locale]
}

/** `html[data-theme]` value persisted in `localStorage['minegram.theme']`. */
export type ThemePreference = 'auto' | 'light' | 'dark'

export const THEME_PREFERENCES = Object.freeze<readonly ThemePreference[]>([
  'auto',
  'light',
  'dark',
])

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'auto' || value === 'light' || value === 'dark'
}

// --------------------------------------------------------------------------------------
// Interpolation
// --------------------------------------------------------------------------------------

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g

export type CopyValues = Readonly<Record<string, string | number>>

/**
 * Replaces `{name}` placeholders. An unknown placeholder is left in place so a
 * missing value is visible in development instead of rendering as "undefined".
 */
export function interpolate(template: string, values: CopyValues = {}): string {
  return template.replace(PLACEHOLDER, (match, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
  )
}

// --------------------------------------------------------------------------------------
// Reason copy
// --------------------------------------------------------------------------------------

/** Reasons the Generation Worker or its client wrapper can report. */
export type ClientFailureReason =
  | 'worker-exception'
  | 'worker-error'
  | 'worker-message-error'
  | 'worker-unavailable'
  | 'worker-post-error'
  | 'invalid-worker-response'
  | 'invalid-generated-round'

export type FailureReason = GameResultReason | GenerationFailureReason | ClientFailureReason

export interface FailureCopy {
  readonly headline: string
  readonly explanation: string
  readonly remedies: readonly string[]
}

type ReasonCopyMap = Readonly<Record<FailureReason, FailureCopy>>

/**
 * The annotation is what makes this exhaustive: assigning `en.failure.reasons`
 * to it fails to compile if a reason token has no copy, and a copy that no
 * reason can produce fails too.
 */
const REASON_COPY: ReasonCopyMap = en.failure.reasons

export function isKnownFailureReason(reason: string): reason is FailureReason {
  return Object.prototype.hasOwnProperty.call(REASON_COPY, reason)
}

/**
 * Headline, explanation and ordered remedies for any reason string, including a
 * reason this build has never seen. The engine's own `failure.message` is never
 * used: it is machine text.
 */
export function failureCopy(t: Copy, reason: string): FailureCopy {
  if (isKnownFailureReason(reason)) {
    // Read from the resolved dictionary so a translated dictionary wins over
    // the en table that proves the token union is exhaustive.
    const entry = t.failure.reasons[reason]
    return {
      headline: entry.headline,
      explanation: entry.explanation,
      remedies: entry.remedies,
    }
  }
  return {
    headline: t.failure.unknownReason.headline,
    explanation: t.failure.unknownReason.explanation,
    remedies: t.failure.unknownReason.remedies,
  }
}

// --------------------------------------------------------------------------------------
// Difficulty copy
// --------------------------------------------------------------------------------------

const BAND_GUARD: Readonly<Record<DifficultyBand, true>> = Object.freeze({
  starter: true,
  steady: true,
  challenging: true,
  expert: true,
})

export function isDifficultyBand(value: unknown): value is DifficultyBand {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(BAND_GUARD, value)
}

export function bandLabel(t: Copy, band: unknown): string {
  return isDifficultyBand(band) ? t.tokens.bands[band] : String(band)
}

// --------------------------------------------------------------------------------------
// Cell and clue copy
// --------------------------------------------------------------------------------------

/** Structural subset of `CellView`; keeps this module free of the projection. */
export interface DescribedCell {
  readonly row: number
  readonly column: number
  readonly mark: CellMark
  readonly locked: boolean
  readonly correct: boolean | null
}

function cellState(t: Copy, cell: DescribedCell): string {
  if (cell.mark === 'unknown' || cell.correct === null) {
    return t.cell.unmarked
  }
  if (cell.correct) {
    return cell.mark === 'mine' ? t.cell.confirmedMine : t.cell.confirmedEmpty
  }
  return cell.mark === 'mine' ? t.cell.wrongMine : t.cell.wrongBlank
}

/** Screen-reader text for one grid cell. Distinct for all five resting states. */
export function describeCell(t: Copy, cell: DescribedCell): string {
  return interpolate(t.cell.describe, {
    position: interpolate(t.cell.position, {
      row: cell.row + 1,
      column: cell.column + 1,
    }),
    state: cellState(t, cell),
  })
}

/** Ordered-run grammar: `[]` is "no mines", `[3, 5, 1]` is `3 5 1` in that order. */
export function describeClue(t: Copy, clue: readonly number[]): string {
  return clue.length === 0 ? t.clue.empty : clue.join(' ')
}

/** Structural subset of `LineProgress`; `runs` only needs its completion flags. */
export interface DescribedLine {
  readonly orientation: 'row' | 'column'
  readonly index: number
  readonly clue: readonly number[]
  readonly status: 'ready' | 'unknown'
  readonly contradiction: boolean
  readonly complete: boolean
  readonly runs: readonly { readonly complete: boolean }[]
}

/** Screen-reader text for one rail cell. Fails closed: an unresolved line says so. */
export function describeLine(t: Copy, line: DescribedLine): string {
  const label = interpolate(
    line.orientation === 'row' ? t.clue.rowLine : t.clue.columnLine,
    { index: line.index + 1 },
  )
  const head = interpolate(t.clue.describe, { line: label, clue: describeClue(t, line.clue) })
  if (line.contradiction) {
    return `${head}. ${t.clue.contradiction}`
  }
  if (line.status === 'unknown') {
    return `${head}. ${t.clue.unresolvedTitle}`
  }
  if (line.complete) {
    return `${head}. ${t.clue.lineComplete}`
  }
  const completed = line.runs.filter((run) => run.complete).length
  if (completed > 0) {
    return `${head}. ${interpolate(t.clue.runComplete, { position: completed, total: line.runs.length })}`
  }
  return head
}

// --------------------------------------------------------------------------------------
// Failure report
// --------------------------------------------------------------------------------------

/** Structurally identical to `viewModel.ReportLine`, declared here to stay a leaf. */
export interface ReportRow {
  readonly label: string
  readonly value: string
}

export interface DiagnosticsReportInput {
  /** `failure.details`; `settings` and `diagnostics` are read, never dumped. */
  readonly details: JsonObject
  /** The seed the user typed. The engine's derived seed is never a value here. */
  readonly authoredSeed: string
  /**
   * Whether the failed request printed with an engine-derived seed. The
   * projection decides this; the dictionary never sniffs a seed value.
   */
  readonly seedDerived?: boolean
  /** The round the failed request was printing. Omitted when unknown. */
  readonly round?: number
}

/** The dictionary label of every report row, in the order the rows are emitted. */
type ReportLabel = keyof Copy['failure']['report']
type SettingsSource = 'rows' | 'columns' | 'densityPercent' | 'mineCount' | 'difficulty' | 'maxAttempts'
type DiagnosticsSource =
  | 'attempts'
  | 'layouts'
  | 'candidates'
  | 'accepted'
  | 'rollbacks'
  | 'solverCalls'
  | 'solverStatuses'
  | 'resourceReasons'
  | 'difficultyNodesVisited'
  | 'difficultyNodeLimit'
  | 'proofStatus'
  | 'difficultyStatus'
  | 'difficultyReason'
  | 'minimumGuesses'
  | 'band'

function isRecordValue(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenLabel(table: Readonly<Record<string, string>>, value: string): string {
  return Object.prototype.hasOwnProperty.call(table, value) ? table[value] : value
}

function listValue(t: Copy, value: JsonValue): string {
  if (!Array.isArray(value)) {
    return value === null ? t.failure.report.emptyList : String(value)
  }
  if (value.length === 0) {
    return t.failure.report.emptyList
  }
  const distinct = Array.from(new Set(value.map((entry) => String(entry))))
  return interpolate(t.failure.report.list, { count: value.length, values: distinct.join(', ') })
}

function reportValue(t: Copy, key: SettingsSource | DiagnosticsSource, value: JsonValue): string {
  switch (key) {
    case 'densityPercent':
      return `${String(value)}${t.settings.units.percent}`
    case 'difficulty':
    case 'band':
      return bandLabel(t, value)
    case 'proofStatus':
      return tokenLabel(t.tokens.proof, String(value))
    case 'difficultyStatus':
      return tokenLabel(t.tokens.difficultyStatus, String(value))
    case 'difficultyReason':
      return tokenLabel(t.tokens.unknownReasons, String(value))
    default:
      return String(value)
  }
}

const SETTINGS_ROWS = [
  ['rows', 'rows'],
  ['columns', 'columns'],
  ['densityPercent', 'density'],
  ['mineCount', 'mineCount'],
  ['difficulty', 'difficultyBand'],
  ['maxAttempts', 'maxAttempts'],
] as const satisfies readonly (readonly [SettingsSource, ReportLabel])[]

const DIAGNOSTIC_ROWS = [
  ['attempts', 'attempts'],
  ['layouts', 'layouts'],
  ['candidates', 'candidates'],
  ['accepted', 'accepted'],
  ['rollbacks', 'rollbacks'],
  ['solverCalls', 'solverCalls'],
  ['difficultyNodesVisited', 'difficultyNodesVisited'],
  ['difficultyNodeLimit', 'difficultyNodeLimit'],
  ['proofStatus', 'proofStatus'],
  ['difficultyStatus', 'difficultyStatus'],
  ['difficultyReason', 'difficultyReason'],
  ['minimumGuesses', 'minimumGuesses'],
  ['band', 'band'],
  ['solverStatuses', 'solverStatuses'],
  ['resourceReasons', 'resourceReasons'],
] as const satisfies readonly (readonly [DiagnosticsSource, ReportLabel])[]

function isListSource(key: DiagnosticsSource): boolean {
  return key === 'solverStatuses' || key === 'resourceReasons'
}

function readRow(
  t: Copy,
  label: ReportLabel,
  key: SettingsSource | DiagnosticsSource,
  source: Readonly<Record<string, JsonValue>>,
): ReportRow | null {
  if (!Object.prototype.hasOwnProperty.call(source, key)) {
    return null
  }
  const value = source[key]
  if (value === null) {
    return null
  }
  const rendered = isListSource(key as DiagnosticsSource) ? listValue(t, value) : reportValue(t, key, value)
  return { label: t.failure.report[label], value: rendered }
}

/**
 * Formats the whitelisted failure report: dimensions, density, derived mine
 * count, requested band, root attempts, authored seed, then the numeric
 * diagnostics. A fixed field list, never `JSON.stringify(details)`, so an
 * engine addition cannot leak a payload into the DOM.
 */
export function formatDiagnostics(t: Copy, input: DiagnosticsReportInput): readonly ReportRow[] {
  const details = isRecordValue(input.details) ? input.details : {}
  const settings = isRecordValue(details.settings) ? details.settings : {}
  const diagnostics = isRecordValue(details.diagnostics) ? details.diagnostics : {}
  const rows: ReportRow[] = []

  for (const [key, label] of SETTINGS_ROWS) {
    const row = readRow(t, label, key, settings)
    if (row !== null) {
      rows.push(row)
    }
  }

  rows.push({
    label: t.failure.report.seed,
    value: input.authoredSeed.length > 0 ? input.authoredSeed : t.failure.report.seedUnavailable,
  })
  const derived = input.seedDerived === true
  if (!derived || input.round === undefined || input.round < 1) {
    rows.push({ label: t.failure.report.seedSource, value: t.failure.report.seedSourceAuthored })
  } else {
    rows.push({
      label: t.failure.report.seedSource,
      value: interpolate(t.failure.report.seedSourceDerived, { round: input.round }),
    })
  }

  for (const [key, label] of DIAGNOSTIC_ROWS) {
    const row = readRow(t, label, key, diagnostics)
    if (row !== null) {
      rows.push(row)
    }
  }

  return Object.freeze(rows.map((row) => Object.freeze(row)))
}
