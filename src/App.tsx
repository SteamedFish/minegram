import { useCallback, useEffect, useMemo, useState } from 'react'
import { DEFAULT_LOCALE, getCopy } from './ui/copy'
import {
  getGameStore,
  normalizeDraft,
  type DraftValidation,
  type SettingsDraft,
} from './ui/gameStore'
import { useUiSnapshot } from './ui/useGameSnapshot'
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
import { HelpDialog } from './ui/components/HelpDialog'
import { Legend } from './ui/components/Legend'
import { RoundBanner } from './ui/components/RoundBanner'
import { SettingsPanel } from './ui/components/SettingsPanel'
import { defaultDraft } from './ui/components/defaults'
import { StatusRegion } from './ui/components/StatusRegion'
import {
  defaultFingerMarking,
  useLocale,
  useStoredFlag,
  useTheme,
} from './ui/components/preferences'

/**
 * The app root, and the only component that decides *when* the store is asked to do
 * something. Every other piece is presentational: it renders a frozen view and calls a
 * prop. That is the whole architecture in one sentence — the components are the read
 * side, the store is the write side, and this file is the only wire between them.
 *
 * §1.1 fixes the region order, and that order is a reading order: what the round is,
 * what you asked for, what you are looking at, what the symbols mean, and where the
 * text came from. The board is in `<main>`; both asides are landmarked, so either can
 * be skipped by a screen reader without losing the puzzle.
 */
const SETTINGS_ID = 'mg-settings'
/* The disclosures control the asides, not the panel sections inside them: the
   aside is the element that appears and disappears, so it is the element
   `aria-controls` must name. The section keeps its own id for its field ids. */
const SETTINGS_PANEL_ID = 'mg-settings-panel'
const LEGEND_PANEL_ID = 'mg-legend-panel'

/** The editable form and the verdict on it, kept together so they cannot disagree. */
interface FormState {
  readonly draft: SettingsDraft
  readonly validation: DraftValidation
}

export function App() {
  const store = getGameStore()
  const snapshot = useUiSnapshot()
  const status = snapshot.status
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

  return (
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
            action: t.resume.action,
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
