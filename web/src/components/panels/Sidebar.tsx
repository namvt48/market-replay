import { Activity, BarChart3, CalendarDays, FolderClock } from 'lucide-react'
import { useEffect } from 'react'
import { useEvalStore } from '../../store/eval-store'
import { useUiStore } from '../../store/ui-store'
import { EvaluationPanel } from '../eval/EvaluationPanel'
import { CalendarErrorPanel, EconomicCalendarPanel } from '../calendar/EconomicCalendarPanel'
import { useEconMeta } from '../calendar/use-econ-meta'
import { SessionsPanel } from '../sessions/SessionsPanel'
import { AnalyticsPanel } from '../analytics/AnalyticsPanel'
import { ReviewPanel } from '../review/ReviewPanel'

export function Sidebar() {
  const open = useUiStore((state) => state.sidebarOpen)
  const tab = useUiStore((state) => state.sidebarTab)
  const setTab = useUiStore((state) => state.setSidebarTab)
  const evalAccountId = useEvalStore((state) => state.accountId)
  const econMeta = useEconMeta()
  const calendarVisible = econMeta.state.status === 'error'
    || (econMeta.state.status === 'success' && econMeta.state.data.available)
    || tab === 'calendar'
  const tabs = [
    { id: 'sessions' as const, label: 'Sessions', icon: FolderClock },
    { id: 'evaluation' as const, label: 'Eval', icon: Activity },
    ...(calendarVisible ? [{ id: 'calendar' as const, label: 'Calendar', icon: CalendarDays }] : []),
    { id: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
  ]

  useEffect(() => {
    if (evalAccountId) setTab('evaluation')
  }, [evalAccountId, setTab])

  useEffect(() => {
    if (tab === 'calendar' && econMeta.state.status === 'success' && !econMeta.state.data.available) setTab('sessions')
  }, [econMeta.state, setTab, tab])

  const panel = tab === 'sessions'
      ? <SessionsPanel />
      : tab === 'calendar'
        ? econMeta.state.status === 'success'
          ? <EconomicCalendarPanel meta={econMeta.state.data} />
          : econMeta.state.status === 'error'
            ? <CalendarErrorPanel onRetry={econMeta.retry} />
            : <div role="status" className="grid h-full place-items-center text-ui-body text-dim">Loading calendar metadata…</div>
        : tab === 'evaluation'
          ? <EvaluationPanel />
          : <AnalyticsPanel />

  if (!open) return null
  return (
    <aside className={`flex w-full shrink-0 flex-col border-t border-line bg-surface-1 lg:h-auto lg:w-80 lg:border-l lg:border-t-0 ${tab === 'calendar' ? 'h-[46vh]' : 'h-[38vh]'}`} aria-label="Workspace panels">
      <nav className={`grid h-11 shrink-0 border-b border-line ${tabs.length === 4 ? 'grid-cols-4' : 'grid-cols-3'}`} aria-label="Workspace panels">
        {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} aria-label={id === 'evaluation' ? 'Evaluation accounts' : undefined} className="flex min-w-0 items-center justify-center gap-1 border-b-2 border-transparent px-1 text-ui-meta font-medium text-muted hover:bg-surface-2 hover:text-ink aria-[current=page]:border-active aria-[current=page]:text-ink"><Icon size={13} strokeWidth={1.75} /><span className="truncate">{label}</span></button>)}
      </nav>
      <div className="min-h-0 flex-1">
        <div className={tab === 'review' ? 'h-full' : 'hidden'}><ReviewPanel /></div>
        {tab === 'review' ? null : panel}
      </div>
    </aside>
  )
}
