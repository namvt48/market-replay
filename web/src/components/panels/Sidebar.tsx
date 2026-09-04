import { Activity, ArrowLeft, CalendarDays, ClipboardCheck, FolderClock } from 'lucide-react'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useEvalStore } from '../../store/eval-store'
import { useUiStore } from '../../store/ui-store'
import { EvaluationPanel } from '../eval/EvaluationPanel'
import { CalendarErrorPanel, EconomicCalendarPanel } from '../calendar/EconomicCalendarPanel'
import { useEconMeta } from '../calendar/use-econ-meta'
import { SessionsPanel } from '../sessions/SessionsPanel'
import { ReviewPanel } from '../review/ReviewPanel'

export function Sidebar() {
  const open = useUiStore((state) => state.sidebarOpen)
  const storedTab = useUiStore((state) => state.sidebarTab)
  // Keep the persisted union backward-compatible while no longer exposing
  // Analytics as a constrained sidebar destination.
  const tab = storedTab === 'analytics' ? 'sessions' : storedTab
  const setTab = useUiStore((state) => state.setSidebarTab)
  const reviewSource = useUiStore((state) => state.reviewSource)
  const evalAccountId = useEvalStore((state) => state.accountId)
  const evalPhase = useEvalStore((state) => state.phase)
  const econMeta = useEconMeta()
  const calendarVisible = econMeta.state.status === 'error'
    || (econMeta.state.status === 'success' && econMeta.state.data.available)
    || tab === 'calendar'
  const tabs = [
    { id: 'sessions' as const, label: 'Sessions', icon: FolderClock },
    { id: 'evaluation' as const, label: 'Eval', icon: Activity },
    ...(calendarVisible ? [{ id: 'calendar' as const, label: 'Calendar', icon: CalendarDays }] : []),
  ]

  // The eval store hydrates accountId synchronously from localStorage at module
  // load, so seed the ref with the current value: a reload must not jump to Eval,
  // but activating an account mid-session still should.
  const lastEvalAccountId = useRef(evalAccountId)
  useEffect(() => {
    if (evalAccountId && evalAccountId !== lastEvalAccountId.current) setTab('evaluation')
    lastEvalAccountId.current = evalAccountId
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
          : <SessionsPanel />

  const handleTabListKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let target: number
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowLeft': {
        if (index === -1) return
        target = event.key === 'ArrowRight' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length
        break
      }
      case 'Home':
        target = 0
        break
      case 'End':
        target = buttons.length - 1
        break
      default:
        return
    }
    const button = buttons[target]
    if (!button) return
    event.preventDefault()
    button.focus()
    const tabId = button.dataset.tabId
    if (tabId) {
      const match = tabs.find((entry) => entry.id === tabId)
      if (match) setTab(match.id)
    }
  }

  if (!open) return null
  return (
    <aside className={`workspace-sidebar flex w-full shrink-0 flex-col border-t border-line bg-surface-1 xl:h-auto xl:w-80 xl:border-l xl:border-t-0 ${tab === 'calendar' ? 'h-[clamp(15rem,42dvh,28rem)]' : 'h-[clamp(14rem,38dvh,25rem)]'}`} aria-label="Workspace panels">
      {tab === 'review' ? (
        <nav className="flex h-11 shrink-0 items-center justify-between border-b border-line px-2" aria-label="Workspace panels">
          <button type="button" onClick={() => setTab(reviewSource?.type === 'evaluation' ? 'evaluation' : 'sessions')} className="flex min-w-0 items-center gap-1 text-ui-meta font-medium text-muted hover:text-ink">
            <ArrowLeft size={13} strokeWidth={1.75} />
            <span className="truncate">{reviewSource?.type === 'evaluation' ? 'Back to Eval' : 'Back to Sessions'}</span>
          </button>
          <span id="sidebar-tab-review" aria-current="page" className="flex shrink-0 items-center gap-1 border-b-2 border-active px-1 text-ui-meta font-medium text-ink"><ClipboardCheck size={13} strokeWidth={1.75} />Review</span>
        </nav>
      ) : (
        <nav aria-label="Workspace panels">
          <div role="tablist" onKeyDown={handleTabListKeyDown} className={`grid h-11 shrink-0 border-b border-line ${tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
            {tabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" id={`sidebar-tab-${id}`} data-tab-id={id} aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} aria-label={id === 'evaluation' ? evalPhase === 'running' ? 'Evaluation accounts, live' : 'Evaluation accounts' : undefined} className="relative flex min-w-0 items-center justify-center gap-1 px-1 text-ui-meta font-medium text-muted hover:bg-surface-2 hover:text-ink aria-selected:text-ink"><Icon size={13} strokeWidth={1.75} /><span className="truncate">{label}</span>{id === 'evaluation' && evalPhase === 'running' ? <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-active" /> : null}{tab === id ? <span aria-hidden="true" className="absolute inset-x-1 bottom-0 h-0.5 bg-active" /> : null}</button>)}
          </div>
        </nav>
      )}
      <div className="min-h-0 flex-1" role="tabpanel">
        <div role="tabpanel" id="sidebar-panel-review" aria-labelledby="sidebar-tab-review" className={tab === 'review' ? 'h-full' : 'hidden'}><ReviewPanel /></div>
        {tab === 'review' ? null : <div role="tabpanel" id={`sidebar-panel-${tab}`} aria-labelledby={`sidebar-tab-${tab}`} className="h-full">{panel}</div>}
      </div>
    </aside>
  )
}
