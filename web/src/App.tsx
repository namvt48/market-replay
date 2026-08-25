import { lazy, Suspense } from 'react'
import { ChartWorkspace } from './components/chart/ChartWorkspace'
import { KeyboardCommandDialogs } from './components/KeyboardCommandDialogs'
import { EvalProgressPanel } from './components/eval/EvalProgressPanel'
import { Sidebar } from './components/panels/Sidebar'
import { TopBar } from './components/TopBar'
import { useHotkeys } from './hooks/use-hotkeys'
import { ChartWorkspaceProvider } from './chart-workspace/ChartWorkspaceContext'
import { useEvalTicker } from './replay/use-eval-session'
import { EconomicCalendarChartSync } from './components/calendar/EconomicCalendarChartSync'

const AnalyticsScreen = lazy(() => import('./components/analytics/AnalyticsScreen').then((module) => ({ default: module.AnalyticsScreen })))
// The /start setup screen and the chart workspace are never both on screen,
// so neither should be in the other's download.
const EvalSetupScreen = lazy(() => import('./components/eval/EvalSetupScreen').then((module) => ({ default: module.EvalSetupScreen })))

// Layout shell matching docs §16.5: chart+toolbar on the left, position/
// orders/watchlist/study-list stack on the right, replay transport strip
// full-width on the bottom.
/*
THESIS: Replay is a chart operation, so its transport belongs to the chart instead of the whole application frame.
OWN-WORLD: Flat night-session planes, hairline separators, pale transport glyphs, blue focus, semantic P&L only.
STORY: Select history above, inspect price in the center, control time from the chart edge, review trades at right.
FIRST VIEWPORT: One command strip, dominant chart, chart-scoped centered replay dock, fixed operations rail.
FORM: Familiar chart terminal grammar translated into Market Replay's own controls and assets.
*/

// Isolated so useHotkeys()/ChartWorkspaceProvider mount only on the chart
// path; the /start setup screen renders without booting the replay engine.
function Workspace() {
  return (
    <ChartWorkspaceProvider>
      <WorkspaceShell />
    </ChartWorkspaceProvider>
  )
}

function WorkspaceShell() {
  const hotkeys = useHotkeys()
  useEvalTicker()
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0 text-ink">
      <EconomicCalendarChartSync />
      <TopBar layoutMenuRequest={hotkeys.layoutMenuRequest} onOpenShortcuts={hotkeys.openShortcutHelp} />
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <ChartWorkspace />
        </div>
        <Sidebar />
      </main>
      <EvalProgressPanel />
      <KeyboardCommandDialogs state={hotkeys.dialog} onClose={hotkeys.closeDialog} />
      <span className="sr-only" role="status" aria-live="polite">{hotkeys.statusMessage}</span>
    </div>
  )
}

function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  const analyticsSource = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('analytics') : null
  if (path.startsWith('/analytics') || analyticsSource) {
    return <Suspense fallback={<div className="grid h-full place-items-center bg-surface-0 text-ui-body text-muted" role="status">Loading analytics…</div>}><AnalyticsScreen /></Suspense>
  }
  if (path.startsWith('/start')) {
    return <Suspense fallback={<div className="grid h-full place-items-center bg-surface-0 text-ui-body text-muted" role="status">Loading setup…</div>}><EvalSetupScreen /></Suspense>
  }
  return <Workspace />
}

export default App
