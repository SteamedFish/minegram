import { startTransition } from 'react'
import {
  createInitialGameState,
  gameReducer,
  previewMarkBatch,
  type CellAssertion,
  type GameAction,
  type GameFailureDiagnostics,
  type GameState,
  type GameTransition,
} from '../application/gameReducer'
import { GenerationClient, type GenerationWorkerFactory } from '../application/generationClient'
import { normalizeGenerationSettings, type GenerationSettings } from '../engine/generator/settings'
import { deriveRandomSeed, type RandomSeed } from '../engine/rng'
import { DEFAULT_LOCALE, getCopy, type Copy, type Locale } from './copy'
import {
  failureClipboardText,
  projectPreview,
  projectSnapshot,
  resumeAvailable,
  type PreviewView,
  type UiLastEvent,
  type UiSnapshot,
} from './viewModel'

// --------------------------------------------------------------------------------------
// Settings draft (§2.4)
// --------------------------------------------------------------------------------------

/**
 * Raw form values, exactly as the settings panel holds them: every numeric field
 * is the text the user typed, so a half-finished field can be reported instead of
 * silently coerced. The engine's normaliser owns the validation and the message.
 */
export interface SettingsDraft {
  readonly rows: string
  readonly columns: string
  readonly densityPercent: string
  readonly difficulty: string
  readonly seed: string
  readonly maxAttempts: string
  readonly initialScore: string
}

/**
 * What the panel needs after a submit attempt. `error` is the engine's own
 * `error.message`, rendered verbatim (§2.4), so no UI string is duplicated here.
 */
export interface DraftValidation {
  readonly ok: boolean
  readonly settings: GenerationSettings | null
  readonly initialScore: number | null
  readonly error: string | null
  /** False when the draft validated but the client refused (already generating). */
  readonly started: boolean
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A blank field is a number the user has not finished typing, not a zero, so it
 * becomes `NaN` and the engine's own "must be a safe integer" message is reported.
 */
function readIntegerField(value: string): number {
  const trimmed = value.trim()
  return trimmed === '' ? Number.NaN : Number(trimmed)
}

function readSettingsInput(draft: SettingsDraft) {
  return {
    rows: readIntegerField(draft.rows),
    columns: readIntegerField(draft.columns),
    densityPercent: readIntegerField(draft.densityPercent),
    // Passed through unvalidated so a bad select value is reported, not coerced.
    difficulty: draft.difficulty,
    seed: draft.seed,
    maxAttempts: readIntegerField(draft.maxAttempts),
  }
}

/**
 * Validates a draft through the engine. `createInitialGameState` is called for its
 * validators (`assertInitialScore` and the settings normaliser) so the panel shows
 * the engine's own wording; the throwaway state is discarded.
 */
export function normalizeDraft(draft: SettingsDraft): DraftValidation {
  try {
    const settings = normalizeGenerationSettings(readSettingsInput(draft))
    const initialScore = readIntegerField(draft.initialScore)
    createInitialGameState({ settings, initialScore })
    return { ok: true, settings, initialScore, error: null, started: false }
  } catch (error) {
    return { ok: false, settings: null, initialScore: null, error: messageOf(error), started: false }
  }
}

// --------------------------------------------------------------------------------------
// Store surface
// --------------------------------------------------------------------------------------

/** One cell of a mark batch; structurally identical to `dragController.DragCell`. */
export interface CellAssertionCell {
  readonly index: number
  readonly assertion: CellAssertion
}

export type PreviewVerdict = 'hit' | 'risk' | 'none'

export interface GameStoreActions {
  /** Normalises the draft, then starts a generation. Never throws. */
  start(draft: SettingsDraft): DraftValidation
  /** The win-handoff accelerator: clears the interlude and starts immediately. */
  nextRound(): void
  retry(): void
  cancel(): void
  /** Derives a fresh seed from the last authored one. Deterministic, never random. */
  newSeed(): void
  mark(cells: readonly CellAssertionCell[]): void
  clear(index: number): void
  /** `true` when `round/resume` was dispatched, `false` when it was not available. */
  resume(): boolean
}

export interface GameStore {
  getSnapshot(): UiSnapshot
  subscribe(listener: () => void): () => void
  dispatch(action: GameAction): void
  actions: GameStoreActions
  /** `null` when the store cannot answer (not playing, invalid batch, disposed). */
  preview(cells: readonly CellAssertionCell[]): PreviewView | null
  previewOf(index: number, assertion: CellAssertion): PreviewVerdict
  /** Clipboard-only text; the one path an engine-derived seed can escape through. */
  copyReport(): string
  getLocale(): Locale
  /** Re-projects the snapshot with another dictionary. */
  setLocale(locale: Locale): void
  dispose(): void
}

export type TimerHandle = ReturnType<typeof setTimeout>

/**
 * The page-visibility seam the win handoff reads (§4.8). Injected so the hidden
 * tab path is testable, and so the single `document` read this module needs sits
 * in one function instead of spread through the store.
 */
export interface VisibilityProbe {
  /** `false` only while the page is in the background. */
  readonly isVisible: () => boolean
  /** Notifies on every visibility change; returns the unsubscribe. */
  readonly subscribe: (handler: () => void) => () => void
}

export interface GameStoreOptions {
  readonly initialState?: GameState
  readonly locale?: Locale
  readonly copy?: Copy
  readonly workerFactory?: GenerationWorkerFactory
  /** Win interlude in ms. Lower it in tests. */
  readonly interludeMs?: number
  readonly setTimer?: (handler: () => void, ms: number) => TimerHandle
  readonly clearTimer?: (handle: TimerHandle) => void
  /** Wraps the listener notification after `generation/succeeded` (§4.5.2). */
  readonly paintPriority?: (notify: () => void) => void
  readonly newSeedLabel?: string
  /** Page visibility. Defaults to `document`, and to "always visible" without one. */
  readonly visibility?: VisibilityProbe
}

/**
 * §4.8: how long the won banner holds before the next round starts itself. Long
 * enough to read the result sentence and reach "Next round" — the banner is the
 * only place the round outcome is stated in full — and still automatic, because
 * the contract requires a fresh round with no human input.
 */
export const DEFAULT_WIN_INTERLUDE_MS = 2_500

/** A host with no document (a bare test, a worker) is treated as foreground. */
const ALWAYS_VISIBLE: VisibilityProbe = Object.freeze({
  isVisible: () => true,
  subscribe: () => () => {},
})

/**
 * The one `document` read in this file. A backgrounded tab must not silently
 * burn a round nobody is looking at, so the handoff waits for this.
 */
function documentVisibility(): VisibilityProbe {
  if (typeof document === 'undefined') {
    return ALWAYS_VISIBLE
  }
  return Object.freeze({
    isVisible: () => document.visibilityState !== 'hidden',
    subscribe: (handler: () => void) => {
      document.addEventListener('visibilitychange', handler)
      return () => {
        document.removeEventListener('visibilitychange', handler)
      }
    },
  })
}

/** The pure label `newSeed` mixes into the last authored seed. */
export const DEFAULT_NEW_SEED_LABEL = 'minegram:new-seed'

/**
 * §4.5.2. The snapshot is already updated when this runs; only the notification
 * is wrapped, so the client's synchronous `getState()` contract cannot be bent by
 * a scheduler. The fallback keeps a non-React host (a bare test) working.
 */
function defaultPaintPriority(notify: () => void): void {
  try {
    startTransition(notify)
  } catch {
    notify()
  }
}

// --------------------------------------------------------------------------------------
// The store
// --------------------------------------------------------------------------------------

export function createGameStore(options: GameStoreOptions = {}): GameStore {
  const setTimer =
    options.setTimer ?? ((handler: () => void, ms: number): TimerHandle => setTimeout(handler, ms))
  const clearTimer = options.clearTimer ?? ((handle: TimerHandle): void => clearTimeout(handle))
  const paintPriority = options.paintPriority ?? defaultPaintPriority
  const interludeMs = options.interludeMs ?? DEFAULT_WIN_INTERLUDE_MS
  const newSeedLabel = options.newSeedLabel ?? DEFAULT_NEW_SEED_LABEL
  const visibility = options.visibility ?? documentVisibility()

  // ---- closure state (never reachable from a property, a snapshot, or `this`) ----
  let locale = options.locale ?? DEFAULT_LOCALE
  let copy = options.copy ?? getCopy(locale)
  let state: GameState = options.initialState ?? createInitialGameState()
  let version = 0
  /**
   * The last published event, and the single source of truth for it: `publish`
   * is the only writer and every reader goes through it, which is what lets
   * `setLocale` re-publish the very same event in another language instead of
   * republishing `null`. `null` means nothing has been announced yet.
   */
  let lastEvent: UiLastEvent | null = null
  let interlude: TimerHandle | null = null
  let client: GenerationClient | null = null
  let disposed = false
  let internalTeardown = false
  /**
   * Whether the current settings carry a seed the engine derived itself (§4.6).
   * Mirrors the reducer's own rule: it derives only when the state it was
   * dispatched from was a won round, and it hands the derived seed to the pending
   * request, which acceptance later copies into `state.settings`.
   */
  let seedDerived = false
  /** The last seed the user (or `newSeed`) authored, so `newSeed` never forks a derived one. */
  let authoredSeed: RandomSeed = state.settings.seed

  const listeners = new Set<() => void>()
  // Armed once per store and torn down in `dispose()`. This is the only listener
  // the store owns outside React, and it exists so a hidden tab can defer the win
  // handoff and still get it without human input (§4.8).
  const stopWatchingVisibility = visibility.subscribe(rewatchVisibility)

  let snapshot: UiSnapshot = projectSnapshot(state, {
    copy,
    locale,
    version,
    lastEvent: null,
    seedDerived,
  })

  function publish(event: UiLastEvent | null, transition: GameTransition | null): void {
    // Recorded BEFORE the projection, because the closure is the source of truth:
    // a re-publish must be able to hand this exact event back to `setLocale`.
    lastEvent = event
    version += 1
    snapshot = projectSnapshot(state, { copy, locale, version, lastEvent: event, seedDerived })
    const current = [...listeners]
    if (current.length === 0) {
      return
    }
    const notify = (): void => {
      for (const listener of current) {
        listener()
      }
    }
    if (transition === 'generation-succeeded') {
      paintPriority(notify)
      return
    }
    notify()
  }

  function clearInterlude(): void {
    if (interlude === null) {
      return
    }
    clearTimer(interlude)
    interlude = null
  }

  function ensureClient(): GenerationClient | null {
    if (disposed) {
      return null
    }
    if (client === null) {
      client = new GenerationClient({
        // The only place the raw state is readable: the client contract requires a
        // synchronous read, and the client itself is a closure local.
        store: { getState: () => state },
        dispatch,
        workerFactory: options.workerFactory,
      })
    }
    return client
  }

  function scheduleInterlude(): void {
    clearInterlude()
    if (!visibility.isVisible()) {
      // A backgrounded tab must not silently burn a round (§4.8). The visibility
      // listener re-arms the handoff the moment the page is shown again, so the
      // handoff still happens without a human pressing anything.
      return
    }
    interlude = setTimer(() => {
      interlude = null
      if (disposed || state.status !== 'won' || state.pendingGeneration !== null) {
        return
      }
      if (!visibility.isVisible()) {
        // Hidden between arming and firing: hand the round back to the listener.
        return
      }
      ensureClient()?.startNextRound()
    }, interludeMs)
  }

  /**
   * Re-arms a handoff that a hidden tab deferred. Guarded on `interlude === null`
   * so a normal visibility change never doubles the timer.
   */
  function rewatchVisibility(): void {
    if (disposed || interlude !== null || state.status !== 'won') {
      return
    }
    if (state.pendingGeneration !== null || !visibility.isVisible()) {
      return
    }
    scheduleInterlude()
  }

  /**
   * Tracks whether the settings now in flight carry an engine-derived seed. The
   * reducer derives the next-round seed exactly when the state it processes is a
   * completed round, and passes it to the pending request.
   */
  function trackSeed(previous: GameState, action: GameAction, next: GameState): void {
    if (action.type !== 'generation/start') {
      return
    }
    const pending = next.pendingGeneration
    if (pending === null) {
      return
    }
    const derived = previous.status === 'won' && previous.round > 0
    seedDerived = derived
    if (!derived) {
      authoredSeed = pending.settings.seed
    }
  }

  /**
   * Whether the request is a FREE re-assertion: every cell it asserts already
   * carries exactly that mark. The reducer skips such a cell before it ever looks
   * at the lock (`marks[index] === assertion` wins in `applyMarkBatch`), so such a
   * batch can only come back as `cell-already-marked` — a no-op the scoring
   * contract makes free (§4.2). Announcing it would nag the player for the exact
   * interaction the contract protects, so it is the one refusal that stays
   * silent. Everything else refuses loudly; a partial batch is not a refusal at
   * all, because the reducer returns a real transition for it.
   */
  function isFreeReassertion(action: GameAction, before: GameState): boolean {
    if (action.type !== 'round/markBatch' || before.status !== 'playing') {
      return false
    }
    const cells = action.cells
    if (cells.length === 0) {
      // An empty batch is `invalid-batch`, a real refusal.
      return false
    }
    return cells.every((cell) => {
      if (typeof cell.index !== 'number' || typeof cell.assertion !== 'string') {
        return false
      }
      return before.marks[cell.index] === cell.assertion
    })
  }

  function dispatch(action: GameAction): void {
    if (disposed) {
      return
    }
    const previous = state
    const result = gameReducer(previous, action)
    if (result.type === 'transition') {
      state = result.state
    } else if (result.state === previous) {
      // A refusal returns its input state BY REFERENCE, so there is no new board
      // to project — but a player who clicked a cell the game has locked still
      // needs an answer, and silence reads as a broken game. So the refusal is
      // published as a null-transition event carrying its reason, which is the
      // only event `reasonLabel` has anything to resolve.
      if (internalTeardown || isFreeReassertion(action, previous)) {
        return
      }
      publish(
        {
          transition: null,
          reason: result.reason,
          // The pre-projection event carries no label: it has no locale yet.
          // `projectSnapshot` resolves the sentence from `reason` + locale.
          reasonLabel: null,
          // A refusal folded nothing, so there is no reveal to report. Zeros, not
          // a guess: the region subtracts these from the player's own diff.
          autoRevealedLines: 0,
          autoRevealedCells: 0,
        },
        null,
      )
      return
    } else {
      // Unreachable with the current reducer, which refuses by returning its input
      // unchanged. Adopt the state and publish anyway, so a future non-refusing
      // result still reaches the UI.
      state = result.state
    }
    trackSeed(previous, action, state)
    if (internalTeardown) {
      // `client.dispose()` dispatches `generation/cancelled`; adopting the state
      // keeps the closure consistent, but nothing is published, so an internal
      // teardown can never render a cancellation failure card (§4.3).
      return
    }
    const event: UiLastEvent = {
      transition: result.type === 'transition' ? result.transition : null,
      // A transition carries no reason: a refusal is published as its own event
      // above, so a reason never rides along with a later, unrelated change.
      reason: null,
      // As above: `projectSnapshot` is what turns a reason into a sentence.
      reasonLabel: null,
      // The reducer owns the reveal's accounting and already reports `0`/`[]` for
      // every transition that did not reveal — the round-accepting one included.
      autoRevealedLines: result.type === 'transition' ? result.autoRevealedLines.length : 0,
      autoRevealedCells: result.type === 'transition' ? result.autoRevealedCells : 0,
    }
    const transition = result.type === 'transition' ? result.transition : null
    if (transition === 'round-won') {
      scheduleInterlude()
    } else {
      // Every other transition, `round-lost` included, cancels the handoff.
      clearInterlude()
    }
    publish(event, transition)
  }

  function getSnapshot(): UiSnapshot {
    return snapshot
  }

  function subscribe(listener: () => void): () => void {
    if (disposed) {
      return () => {}
    }
    listeners.add(listener)
    let subscribed = true
    return () => {
      if (!subscribed) {
        return
      }
      subscribed = false
      listeners.delete(listener)
    }
  }

  function preview(cells: readonly CellAssertionCell[]): PreviewView | null {
    if (disposed || state.status !== 'playing') {
      return null
    }
    const result = previewMarkBatch(state, cells)
    if (!result.valid) {
      return null
    }
    return projectPreview(result, cells.map((cell) => cell.index))
  }

  function previewOf(index: number, assertion: CellAssertion): PreviewVerdict {
    if (disposed || state.status !== 'playing') {
      return 'none'
    }
    const result = previewMarkBatch(state, [{ index, assertion }])
    if (!result.valid || result.affectedCount === 0) {
      return 'none'
    }
    return result.scoreCost === 0 ? 'hit' : 'risk'
  }

  function copyReport(): string {
    const failure: GameFailureDiagnostics | null = state.failure
    if (failure === null) {
      return ''
    }
    return failureClipboardText(failure, state.settings, copy, seedDerived)
  }

  function getLocale(): Locale {
    return locale
  }

  function setLocale(next: Locale): void {
    if (next === locale) {
      return
    }
    locale = next
    copy = getCopy(next)
    publish(lastEvent, null)
  }

  function dispose(): void {
    if (disposed) {
      return
    }
    clearInterlude()
    stopWatchingVisibility()
    listeners.clear()
    const active = client
    client = null
    if (active !== null) {
      internalTeardown = true
      try {
        active.dispose()
      } finally {
        internalTeardown = false
      }
    }
    disposed = true
  }

  const actions: GameStoreActions = {
    start(draft) {
      const validation = normalizeDraft(draft)
      if (!validation.ok || validation.settings === null || validation.initialScore === null) {
        return validation
      }
      clearInterlude()
      const active = ensureClient()
      if (active === null) {
        return validation
      }
      return {
        ...validation,
        started: active.start(validation.settings, validation.initialScore),
      }
    },
    nextRound() {
      clearInterlude()
      ensureClient()?.startNextRound()
    },
    retry() {
      clearInterlude()
      ensureClient()?.retry()
    },
    cancel() {
      clearInterlude()
      ensureClient()?.cancel()
    },
    newSeed() {
      clearInterlude()
      const active = ensureClient()
      if (active === null) {
        return
      }
      const seed = deriveRandomSeed(authoredSeed, newSeedLabel)
      active.start({ ...state.settings, seed }, state.initialScore)
    },
    mark(cells) {
      dispatch({ type: 'round/markBatch', cells })
    },
    clear(index) {
      dispatch({ type: 'round/clearMark', index })
    },
    resume() {
      if (!resumeAvailable(snapshot)) {
        return false
      }
      dispatch({ type: 'round/resume' })
      return true
    },
  }

  return Object.freeze({
    getSnapshot,
    subscribe,
    dispatch,
    actions: Object.freeze(actions),
    preview,
    previewOf,
    copyReport,
    getLocale,
    setLocale,
    dispose,
  })
}

// --------------------------------------------------------------------------------------
// App singleton
// --------------------------------------------------------------------------------------

let singleton: GameStore | null = null

export function getGameStore(): GameStore {
  singleton ??= createGameStore()
  return singleton
}

/**
 * Installs `store` as the app singleton. Test seam only: it swaps a store object,
 * which holds no game state, and returns a restore function.
 */
export function setGameStore(store: GameStore): () => void {
  const previous = singleton
  singleton = store
  return () => {
    if (singleton === store) {
      singleton = previous
    }
  }
}

/** Idempotent. Called from `pagehide` and `beforeunload`, and from tests. */
export function disposeGameStore(): void {
  singleton?.dispose()
}

if (typeof window !== 'undefined') {
  // Registered once, at module load, and nowhere else: `dispose()` is never wired
  // to a React effect, because client teardown also cancels the pending generation
  // and would flash a false failure card on every StrictMode mount.
  const teardown = (): void => {
    disposeGameStore()
  }
  window.addEventListener('pagehide', teardown)
  window.addEventListener('beforeunload', teardown)
}
