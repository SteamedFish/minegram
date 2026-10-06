import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LOCALE, failureCopy, getCopy, interpolate, type Copy, type Locale } from './ui/copy'
import {
  getGameStore,
  normalizeDraft,
  type DraftValidation,
  type SettingsDraft,
} from './ui/gameStore'
import { useUiSnapshot } from './ui/useGameSnapshot'
import { useStarBattleSnapshot } from './ui/useStarBattleSnapshot'
import { getStarBattleStore, type StarBattleUiStatus } from './ui/starBattleStore'
import { failureKind } from './ui/viewModel'
import {
  resumeAvailable,
  type MarkingMode,
  type UiSnapshot,
  type ZoomStep,
} from './ui/viewModel'
import { AppBanner } from './ui/components/AppBanner'
import { AppFooter } from './ui/components/AppFooter'
import { BoardSurface } from './ui/components/BoardSurface'
import { FailureReport } from './ui/components/FailureReport'
import { GamePicker, type GameId } from './ui/components/GamePicker'
import { HelpDialog } from './ui/components/HelpDialog'
import { Legend } from './ui/components/Legend'
import { RoundBanner } from './ui/components/RoundBanner'
import { SettingsPanel } from './ui/components/SettingsPanel'
import { defaultDraft } from './ui/components/defaults'
import { StatusRegion } from './ui/components/StatusRegion'
import { StarBattleSurface, getStarCopy } from './ui/components/StarBattleSurface'
import {
  defaultFingerMarking,
  useLocale,
  useStoredFlag,
  useTheme,
} from './ui/components/preferences'

/**
 * The app root: the only component that decides *when* a store is asked to do
 * something, and now also WHICH game is on screen.
 *
 * The screen model is a plain three-way switch owned here as local state and
 * deliberately NOT persisted: every load opens on the picker (a returning
 * player is asked, never silently restored into a game). Picking a game is
 * the only act that can touch a store — no generation request fires on mount.
 *
 *   picker     GamePicker + the global footer (locale and theme live there,
 *              so both stay reachable before a game is chosen).
 *   minegram   The existing Minegram chrome, unchanged, under a slim games bar
 *              that is the way back. Its panels, banner and dialogs stay
 *              minegram's; they are not shared chrome.
 *   starbattle StarBattleSurface's own toolbar (back, meter, difficulty) plus
 *              the global footer. No settings form, no legend — Star Battle
 *              has no minegram chrome. While no certified board exists the
 *              surface is not rendered at all: an idle/generating card states
 *              the case, and a generation failure gets its own card built from
 *              the shared failureCopy machinery, never from machine text.
 *
 * Both stores stay alive across screens (they are module singletons); leaving
 * a game does not destroy its round. Only `backToPicker` resets the Star
 * Battle store, and that action is the surface's own button.
 */
const SETTINGS_ID = 'mg-settings'
/* The disclosures control the asides, not the panel sections inside them: the
   aside is the element that appears and disappears, so it is the element
   `aria-controls` must name. The section keeps its own id for its field ids. */
const SETTINGS_PANEL_ID = 'mg-settings-panel'
const LEGEND_PANEL_ID = 'mg-legend-panel'

type Screen = 'picker' | GameId

/** The editable form and the verdict on it, kept together so they cannot disagree. */
interface FormState {
  readonly draft: SettingsDraft
  readonly validation: DraftValidation
}

/** The only shell-level strings, colocated copy.ts-style because copy.ts is frozen. */
interface ShellCopy {
  /** The way back to the picker, shown as minegram's games-bar control. */
  readonly back: string
}

const shellEn: ShellCopy = { back: 'All games' }
const shellZh: ShellCopy = { back: '全部游戏' }

function getShellCopy(locale: Locale): ShellCopy {
  return locale === 'zh-CN' ? shellZh : shellEn
}

export function App() {
  const store = getGameStore()
  const snapshot = useUiSnapshot()
  const status = snapshot.status
  const starStore = getStarBattleStore()
  const starSnapshot = useStarBattleSnapshot()
  /* Not persisted: the picker is the entry point on every load. */
  const [screen, setScreen] = useState<Screen>('picker')
  /* The storage keys are identical in every dictionary, so the preference hooks are
     seeded from the default one and only the visible strings follow the locale. */
  const keys = useMemo(() => getCopy(DEFAULT_LOCALE), [])
  const [locale, setLocale] = useLocale(keys)
  const t = useMemo(() => getCopy(locale), [locale])
  const shell = useMemo(() => getShellCopy(locale), [locale])
  const starCopy = useMemo(() => getStarCopy(locale === 'zh-CN' ? 'zh' : 'en'), [locale])
  const [theme, setTheme] = useTheme(keys)

  // Local UI state lives here, not in the store (§4.2): the store owns the game, this
  // component owns the chrome. None of it is part of a snapshot, and none of it
  // survives a reload except through the five preferences that are persisted.
  const [mode, setMode] = useState<MarkingMode>('mine')
  const [zoom, setZoom] = useState<ZoomStep>('fit')
  const [helpOpen, setHelpOpen] = useState(false)
  const [fingerMarking, setFingerMarking] = useStoredFlag(
    t.storage.fingerMarking,
    defaultFingerMarking(),
  )
  /* The side panels are genuinely shown and hidden — the grid column collapses
     with the aside — and both states are remembered, so a hidden panel is never
     unreachable: the banner is sticky and its disclosure is always there. The
     settings FORM is always editable while shown; settings take effect on
     Generate and only on Generate, so there is no editability gate to own. */
  const [settingsPanelOpen, setSettingsPanelOpen] = useStoredFlag(t.storage.panelSettings, true)
  const [legendPanelOpen, setLegendPanelOpen] = useStoredFlag(t.storage.panelLegend, true)
  /* The hint layer is OFF by default. The player asked for it that way: the numbers
   * and their own marks are the game, and a run that lights itself up is an answer
   * handed over. Toggling it changes nothing about the round, so it is a stored
   * preference and never a generation setting — the seed the player typed must not
   * be reprinted because they switched a hint on. */
  const [hints, setHints] = useStoredFlag(t.storage.hints, false)

  // The draft is seeded once, from what the store is actually running, and then left
  // alone: re-seeding it on every snapshot would erase half-typed input. The draft and
  // its last validation live in ONE object so an update can never leave them disagreeing.
  const [form, setForm] = useState<FormState>(() => {
    const draft = draftFromSnapshot(snapshot)
    return { draft, validation: normalizeDraft(draft) }
  })

  /** A dismissed report stays dismissed until a *different* failure arrives. */
  const [dismissed, setDismissed] = useState<string | null>(null)

  /**
   * The store is the only thing allowed to choose a seed, so when a generation starts
   * from somewhere other than this panel — the win banner, the failure report, a
   * retry — the panel adopts the seed the store is now running. An empty authored seed
   * means the round derives its own, and the panel then keeps the seed the player can
   * see and edit rather than inventing one.
   */
  const authoredSeed = status.dimensions?.authoredSeed ?? ''
  useEffect(() => {
    if (authoredSeed === '') {
      return
    }
    setForm((current) => {
      if (current.draft.seed === authoredSeed) {
        return current
      }
      const draft = { ...current.draft, seed: authoredSeed }
      return { draft, validation: normalizeDraft(draft) }
    })
  }, [authoredSeed])

  const failure = status.failure
  const visibleFailure = failure !== null && failure.reason !== dismissed ? failure : null

  const generate = useCallback(() => {
    setForm((current) => ({
      draft: current.draft,
      validation: store.actions.start(current.draft),
    }))
  }, [store])

  const resetDraft = useCallback(() => {
    const draft = defaultDraft()
    setForm({ draft, validation: normalizeDraft(draft) })
  }, [])

  const deriveSeed = useCallback(() => {
    // `newSeed` derives through `deriveRandomSeed` and starts; the adoption effect
    // above pulls the result back into the draft.
    store.actions.newSeed()
  }, [store])

  const canResume = resumeAvailable(snapshot)

  /** Leaving Star Battle for the picker: the store cancels, resets, and the screen follows. */
  const backToPicker = useCallback(() => {
    getStarBattleStore().actions.backToPicker()
    setScreen('picker')
  }, [])

  /**
   * Picking a game is the first store-touching act allowed. Star Battle has no
   * settings form: choosing it starts a round immediately, with the store's own
   * authored-or-derived seed. Minegram opens on its empty state, as it always has.
   */
  const selectGame = useCallback((id: GameId) => {
    setScreen(id)
    if (id === 'starbattle') {
      getStarBattleStore().actions.startNewRound()
    }
  }, [])

  /* The banner buttons promise "open the settings", so opening a hidden panel is
     only half the job: focus has to land on the section, or a keyboard player is
     left holding a button that no longer says anything about where the panel is.
     The rAF waits out the commit that un-hides the aside; scrollIntoView is
     guarded because jsdom does not implement it. */
  const openSettings = useCallback(() => {
    setSettingsPanelOpen(true)
    requestAnimationFrame(() => {
      const section = document.getElementById(SETTINGS_ID)
      if (section === null) {
        return
      }
      if (typeof section.scrollIntoView === 'function') {
        section.scrollIntoView({ block: 'nearest' })
      }
      section.focus()
    })
  }, [setSettingsPanelOpen])

  const footer = (
    <AppFooter
      t={t}
      dimensions={screen === 'minegram' ? status.dimensions : null}
      locale={locale}
      theme={theme}
      onLocale={setLocale}
      onTheme={setTheme}
    />
  )

  if (screen === 'picker') {
    return (
      <div className="mg-shell" data-screen="picker">
        <main className="mg-picker-main">
          <GamePicker locale={locale === 'zh-CN' ? 'zh' : 'en'} selected={null} onSelect={selectGame} />
        </main>
        {footer}
      </div>
    )
  }

  if (screen === 'starbattle') {
    return (
      <div className="mg-shell" data-screen="starbattle">
        <main className="mg-star-main">
          {starSnapshot.failure !== null ? (
            <StarFailureCard
              t={t}
              reason={starSnapshot.failure.reason}
              backLabel={starCopy.back}
              onRetry={() => {
                starStore.actions.retry()
              }}
              onBack={backToPicker}
            />
          ) : starSnapshot.puzzle === null ? (
            <StarEmptyState status={starSnapshot.status} copy={starCopy} />
          ) : (
            <StarBattleSurface
              locale={locale === 'zh-CN' ? 'zh' : 'en'}
              puzzle={starSnapshot.puzzle}
              marks={starSnapshot.marks}
              status={starSnapshot.status}
              score={starSnapshot.score}
              mistakes={starSnapshot.mistakes}
              streak={starSnapshot.streak}
              difficulty={starSnapshot.difficulty}
              onMark={(row, col, next) => {
                // `null` is a real retract and must pass through untouched.
                starStore.actions.onMark(row, col, next)
              }}
              onNewRound={() => {
                starStore.actions.nextRound()
              }}
              onDifficultyChange={(difficulty) => {
                starStore.actions.setDifficulty(difficulty)
              }}
              onBackToPicker={backToPicker}
            />
          )}
        </main>
        {footer}
      </div>
    )
  }

  return (
    <>
      <div className="mg-gamesbar" data-screen="minegram">
        <button
          type="button"
          className="mg-button mg-gamesbar__back"
          data-testid="gamesbar-back"
          onClick={() => {
            setScreen('picker')
          }}
        >
          {shell.back}
        </button>
      </div>
      <div
        className="mg-app"
        data-left-panel={settingsPanelOpen ? 'shown' : 'hidden'}
        data-right-panel={legendPanelOpen ? 'shown' : 'hidden'}
      >
        <AppBanner
          t={t}
          status={status}
          settingsExpanded={settingsPanelOpen}
          settingsId={SETTINGS_PANEL_ID}
          onToggleSettings={() => {
            setSettingsPanelOpen(!settingsPanelOpen)
          }}
          legendExpanded={legendPanelOpen}
          legendId={LEGEND_PANEL_ID}
          onToggleLegend={() => {
            setLegendPanelOpen(!legendPanelOpen)
          }}
        />
        <aside className="mg-side mg-side--left" id={SETTINGS_PANEL_ID} hidden={!settingsPanelOpen}>
          <SettingsPanel
            t={t}
            id={SETTINGS_ID}
            draft={form.draft}
            validation={form.validation}
            generating={status.isGenerating}
            onChange={(next) => {
              setForm((current) => ({ ...current, draft: next }))
            }}
            onGenerate={generate}
            onDefaults={resetDraft}
            onNewSeed={deriveSeed}
            hints={hints}
            onHintsChange={setHints}
          />
        </aside>
        <main className="mg-main">
          <StatusRegion
            t={t}
            status={status}
            board={snapshot.board}
            lastEvent={snapshot.lastEvent}
            mode={mode}
            zoom={zoom}
          />
          <RoundBanner
            t={t}
            snapshot={snapshot}
            resume={{
              round: status.round,
              body: canResume ? t.resume.body : t.resume.unavailable,
              // This object is built inline because it needs this component's
              // `canResume`, which means it cannot borrow `projectResume`'s
              // interpolated action — the interpolation has to happen HERE, at the
              // producer, or the button leaks the raw `{round}` template.
              action: canResume ? interpolate(t.resume.action, { round: status.round }) : t.resume.unavailable,
            }}
            settingsId={SETTINGS_ID}
            onResume={() => {
              store.actions.resume()
            }}
            onNextRound={() => {
              store.actions.nextRound()
            }}
            onNewSeed={deriveSeed}
            onOpenSettings={openSettings}
          />
          {visibleFailure === null ? null : (
            <FailureReport
              t={t}
              failure={visibleFailure}
              hasBoard={status.hasRound}
              settingsId={SETTINGS_ID}
              onRetry={() => {
                setDismissed(null)
                store.actions.retry()
              }}
              onNewSeed={() => {
                setDismissed(null)
                deriveSeed()
              }}
              onOpenSettings={openSettings}
              onDismiss={() => {
                setDismissed(visibleFailure.reason)
              }}
              onCopyReport={() => store.copyReport()}
            />
          )}
          <BoardSurface
            t={t}
            snapshot={snapshot}
            board={snapshot.board}
            mode={mode}
            zoom={zoom}
            fingerMarking={fingerMarking}
            hints={hints}
            store={store}
            onMode={setMode}
            onZoom={setZoom}
            onFingerMarking={setFingerMarking}
            onGenerate={generate}
            onCancel={() => {
              store.actions.cancel()
            }}
          />
        </main>
        <aside className="mg-side mg-side--right" id={LEGEND_PANEL_ID} hidden={!legendPanelOpen}>
          <Legend t={t} />
          <HelpDialog
            t={t}
            open={helpOpen}
            onOpen={() => {
              setHelpOpen(true)
            }}
            onClose={() => {
              setHelpOpen(false)
            }}
          />
        </aside>
        <AppFooter
          t={t}
          dimensions={status.dimensions}
          locale={locale}
          theme={theme}
          onLocale={setLocale}
          onTheme={setTheme}
        />
      </div>
    </>
  )
}

/**
 * The pre-generate placeholder, owned by the shell rather than the surface:
 * `StarBattleSurface.puzzle` is non-nullable, so until a certified board
 * arrives the shell states the case itself, with the surface's own copy and
 * classes. Never a fabricated board.
 */
function StarEmptyState({
  status,
  copy,
}: {
  readonly status: StarBattleUiStatus
  readonly copy: ReturnType<typeof getStarCopy>
}) {
  const idle = status === 'idle'
  return (
    <div className="mg-star-empty" data-testid="star-empty">
      <h2 className="mg-star-empty__title">
        {idle ? copy.empty.idleTitle : copy.empty.generatingTitle}
      </h2>
      <p className="mg-star-empty__body">
        {idle ? copy.empty.idleBody : copy.empty.generatingBody}
      </p>
    </div>
  )
}

/**
 * The Star Battle generation-failure card. Every string comes from the shared
 * dictionaries — `failureCopy` localises the reason, `t.failure.actions` names
 * the buttons — so no star-battle-specific failure copy exists. Unlike
 * Minegram's `FailureReport` there is deliberately no Open-settings action:
 * Star Battle has no settings form, and a button that opens nothing is a lie.
 */
function StarFailureCard({
  t,
  reason,
  backLabel,
  onRetry,
  onBack,
}: {
  readonly t: Copy
  readonly reason: string
  readonly backLabel: string
  readonly onRetry: () => void
  readonly onBack: () => void
}) {
  const text = failureCopy(t, reason)
  const deterministic = failureKind(reason) === 'deterministic'
  return (
    <section
      className="mg-star-failure"
      role="alert"
      aria-atomic="true"
      data-kind={deterministic ? 'deterministic' : 'retryable'}
      data-reason={reason}
      data-testid="star-failure"
    >
      <h2 className="mg-star-failure__headline">{text.headline}</h2>
      <p className="mg-star-failure__explanation">{text.explanation}</p>
      <ol className="mg-star-failure__remedies">
        {text.remedies.map((remedy, index) => (
          <li className="mg-star-failure__remedy" key={index}>
            {remedy}
          </li>
        ))}
      </ol>
      <div className="mg-star-failure__actions">
        {deterministic ? null : (
          <button type="button" className="mg-button" onClick={onRetry}>
            {t.failure.actions.retry}
          </button>
        )}
        <button type="button" className="mg-button" onClick={onBack}>
          {backLabel}
        </button>
      </div>
    </section>
  )
}

/**
 * The panel opens on what is running, so it can never disagree with the board above
 * it. A derived round reports an empty authored seed; the draft then shows the
 * engine's own default rather than inventing a value the store never had.
 */
function draftFromSnapshot(snapshot: UiSnapshot): SettingsDraft {
  const dimensions = snapshot.status.dimensions
  if (dimensions === null) {
    return defaultDraft()
  }
  const fallback = defaultDraft()
  return {
    rows: String(dimensions.rows),
    columns: String(dimensions.columns),
    densityPercent: String(dimensions.densityPercent),
    difficulty: dimensions.difficulty,
    seed: dimensions.authoredSeed === '' ? fallback.seed : dimensions.authoredSeed,
    maxAttempts: String(dimensions.maxAttempts),
    initialScore: String(snapshot.status.score.initial),
  }
}
