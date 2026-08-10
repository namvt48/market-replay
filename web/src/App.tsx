import { ChartWorkspace } from './components/chart/ChartWorkspace'
import { EvalProgressPanel } from './components/eval/EvalProgressPanel'
import { EvalSetupScreen } from './components/eval/EvalSetupScreen'
import { Sidebar } from './components/panels/Sidebar'
import { ReplayBar } from './components/replay-bar/ReplayBar'
import { TopBar } from './components/TopBar'
import { useHotkeys } from './hooks/use-hotkeys'
import { ChartWorkspaceProvider } from './chart-workspace/ChartWorkspaceContext'
import { useEvalTicker } from './replay/use-eval-session'

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
  useHotkeys()
  useEvalTicker()
  return (
    <ChartWorkspaceProvider>
      <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-0 text-ink">
        <TopBar />
        <main className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <ChartWorkspace />
            <ReplayBar />
          </div>
          <Sidebar />
        </main>
        <EvalProgressPanel />
      </div>
    </ChartWorkspaceProvider>
  )
}

function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : ''
  if (path.startsWith('/start')) {
    return <EvalSetupScreen />
  }
  return <Workspace />
}

export default App
