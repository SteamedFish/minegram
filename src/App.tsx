import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_STAR_LIVES, MAX_STAR_SIDE, MIN_STAR_LIVES, MIN_STAR_SIDE } from './domain/starBattle'
import { DEFAULT_LOCALE, failureCopy, getCopy, interpolate, type Locale } from './ui/copy'
import {
  getGameStore,
  normalizeDraft,
  type DraftValidation,
  type SettingsDraft,
} from './ui/gameStore'
import { useUiSnapshot } from './ui/useGameSnapshot'
import { useStarBattleSnapshot } from './ui/useStarBattleSnapshot'
import { getStarBattleStore } from './ui/starBattleStore'
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
import { GamePicker, getPickerCopy, type GameId } from './ui/components/GamePicker'
import { HelpDialog } from './ui/components/HelpDialog'
import { Legend } from './ui/components/Legend'
import { RoundBanner } from './ui/components/RoundBanner'
import { SettingsPanel } from './ui/components/SettingsPanel'
import { defaultDraft } from './ui/components/defaults'
import { StatusRegion } from './ui/components/StatusRegion'
import { StarBattleSurface, UNMEASURED_TIER_AVAILABILITY, type StarFailureInfo } from './ui/components/StarBattleSurface'
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
 *   minegram   The existing Minegram chrome, unchanged, under the shared
 *              games bar. Its panels, banner and dialogs stay minegram's;
 *              they are not shared chrome.
 *   starbattle The shared games bar (back + the game's name) as a sibling
 *              above the shell, then StarBattleSurface's own toolbar (meter,
 *              difficulty, size, lives) plus the global footer. No settings
 *              form, no legend — Star Battle has no minegram chrome. The
 *              surface renders in every state: while no certified board
 *              exists it states the case itself, and a generation failure
 *              becomes a card INSIDE the surface, under the toolbar, so the
 *              size and difficulty controls stay reachable from the failure
 *              state — a failed board is never a dead end. Failure strings
 *              are projected here from the shared failureCopy machinery,
 *              never from machine text.
 *
 * Both stores stay alive across screens (they are module singletons); leaving
 * a game does not destroy its round. Only `backToPicker` resets the Star
 * Battle store, and that action belongs to the shared games bar.
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

/**
 * The one shared top-of-screen bar, on both game screens: the way back to the
 * picker, and the current game's name, from the picker's own dictionary so
 * the front door and the in-game chrome can never disagree about the name.
 * The bar's box lives in screens.css; the name's voice lives here.
 */
function GameBar({ locale, game, onBack }: { locale: Locale; game: GameId; onBack: () => void }) {
  return (
    <div className="mg-gamesbar" data-screen={game}>
      <button
        type="button"
        className="mg-button mg-gamesbar__back"
        data-testid="gamesbar-back"
        onClick={onBack}
      >
        {getShellCopy(locale).back}
      </button>
      <span className="mg-gamesbar__name">{getPickerCopy(locale === 'zh-CN' ? 'zh' : 'en').games[game].name}</span>
    </div>
  )
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
    // The failure card lives inside the surface, so the surface always renders
    // and the toolbar is never replaced by the failure. The card's strings are
    // projected HERE, at the producer: failureCopy localises the reason token
    // and failureKind decides whether retry is meaningful, so the surface
    // receives player-facing strings only.
    const starFailure: StarFailureInfo | null =
      starSnapshot.failure === null
        ? null
        : (() => {
            const reason = starSnapshot.failure.reason
            const text = failureCopy(t, reason)
            return {
              reason,
              headline: text.headline,
              explanation: text.explanation,
              remedies: text.remedies,
              retryable: failureKind(reason) !== 'deterministic',
            }
          })()
    return (
      <>
        <GameBar locale={locale} game="starbattle" onBack={backToPicker} />
        <div className="mg-shell" data-screen="starbattle">
        <main className="mg-star-main">
          <StarBattleSurface
            locale={locale === 'zh-CN' ? 'zh' : 'en'}
            puzzle={starSnapshot.puzzle}
            side={starSnapshot.side}
            marks={starSnapshot.marks}
            status={starSnapshot.status}
            failure={starFailure}
            lives={starSnapshot.lives}
            maxLives={starSnapshot.maxLives}
            mistakes={starSnapshot.mistakes}
            streak={starSnapshot.streak}
            difficulty={starSnapshot.difficulty}
            progress={starSnapshot.progress}
            tierAvailability={(side, tier) =>
              // The snapshot carries the measured answer for the LIVE side;
              // another side is optimistic 'unmeasured' until its probe lands.
              side === starSnapshot.side
                ? starSnapshot.tierAvailability[tier]
                : UNMEASURED_TIER_AVAILABILITY
            }
            minSide={MIN_STAR_SIDE}
            maxSide={MAX_STAR_SIDE}
            minLives={MIN_STAR_LIVES}
            maxLivesCeiling={MAX_STAR_LIVES}
            onMark={(row, col, next) => {
              // `null` is a real retract and must pass through untouched.
              starStore.actions.onMark(row, col, next)
            }}
            onNewRound={() => {
              starStore.actions.nextRound()
            }}
            onRetry={() => {
              starStore.actions.retry()
            }}
            onDifficultyChange={(difficulty) => {
              starStore.actions.setDifficulty(difficulty)
            }}
            onSizeChange={(next) => {
              starStore.actions.setSide(next)
            }}
            onMaxLivesChange={(next) => {
              starStore.actions.setMaxLives(next)
            }}
            onBackToPicker={backToPicker}
          />
        </main>
        {footer}
        </div>
      </>
    )
  }

  return (
    <>
      <GameBar
        locale={locale}
        game="minegram"
        onBack={() => {
          setScreen('picker')
        }}
      />
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
