/*
THESIS: Outcome quality and decision quality are different measurements; the review must make their disagreement visible.
OWN-WORLD: Replay Desk graphite sheets, mono evidence, blue inspection controls, and semantic green/red outcomes.
STORY: Inspect execution after costs, separate skill from luck, then review behavior under pressure.
FIRST VIEWPORT: One concise survival verdict and a focused three-mode evidence workspace.
FORM: A segmented forensic review that extends the incumbent Analytics operating surface.
*/
import { BrainCircuit, Crosshair, Scale, ShieldAlert } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { AnalyticsExecution, DecisionClassification } from '../../api/analytics'
import { MfeDistributionChart } from './DecisionIntelligenceCharts'
import { DecisionMetric, DecisionPanel, DecisionSectionTitle, SignalBadge } from './DecisionIntelligenceUi'

type ReviewMode = 'execution' | 'decision' | 'psychology'

interface ExecutionDisciplineTabProps {
  report: AnalyticsExecution
}

const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

const modes: Array<{ id: ReviewMode; label: string; icon: typeof Crosshair }> = [
  { id: 'execution', label: 'Execution quality', icon: Crosshair },
  { id: 'decision', label: 'Decision quality', icon: Scale },
  { id: 'psychology', label: 'Psychology', icon: BrainCircuit },
]

const matrixCopy: Record<DecisionClassification, { title: string; eyebrow: string; description: string; tone: string }> = {
  goodWin: { title: 'Good win', eyebrow: 'Skill rewarded', description: 'Followed the plan and the outcome paid.', tone: 'border-profit/70 bg-profit/15 text-profit-bright' },
  goodLoss: { title: 'Good loss', eyebrow: 'Healthy variance', description: 'A valid decision that happened to lose.', tone: 'border-[#4f6f8f] bg-[#12253a] text-[#8fc5ff]' },
  badWin: { title: 'Bad win', eyebrow: 'Luck rewarded', description: 'The outcome can hide a broken process.', tone: 'border-[#9c7b27] bg-[#2c260f] text-[#e4b740]' },
  badLoss: { title: 'Bad loss', eyebrow: 'Process leak', description: 'Plan drift and a negative outcome aligned.', tone: 'border-loss/70 bg-loss/15 text-loss-bright' },
}

const profileCopy = {
  composed: { title: 'Composed operator', detail: 'Sizing and pace remain stable when recent outcomes turn negative.', tone: 'positive' as const },
  'size-chaser': { title: 'Size-chasing tendency', detail: 'Contract size varies enough to distort otherwise comparable decisions.', tone: 'warning' as const },
  'revenge-risk': { title: 'Revenge-risk pattern', detail: 'Losses are followed by faster re-entry and elevated size.', tone: 'negative' as const },
  'plan-drifter': { title: 'Plan-drift pattern', detail: 'Stops are moved away from their original risk boundary too often.', tone: 'negative' as const },
}

function percent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`
}

function ScoreRail({ label, score, inverse = false }: { label: string; score: number; inverse?: boolean }) {
  const safeScore = Math.min(100, Math.max(0, score))
  const active = Math.round(safeScore / 10)
  const favorable = inverse ? safeScore <= 25 : safeScore >= 70
  const caution = inverse ? safeScore <= 50 : safeScore >= 45
  const color = favorable ? 'bg-profit' : caution ? 'bg-[#d09b16]' : 'bg-loss'
  return (
    <div tabIndex={0} title={`${label}: ${safeScore.toFixed(1)} out of 100`} className="group rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-active">
      <div className="mb-2 flex items-center justify-between gap-4"><span className="text-[13px] text-[#aeb5bf]">{label}</span><strong className="font-mono text-[14px] text-white tabular-nums">{safeScore.toFixed(1)}</strong></div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(safeScore)} className="grid grid-cols-10 gap-1">
        {Array.from({ length: 10 }, (_, index) => <span key={index} className={`h-2 rounded-sm ${index < active ? color : 'bg-[#292d32]'}`} />)}
      </div>
    </div>
  )
}

function ReviewSwitcher({ mode, onChange }: { mode: ReviewMode; onChange: (mode: ReviewMode) => void }) {
  return (
    <div className="overflow-x-auto">
      <div className="grid w-full grid-cols-3 rounded-xl border border-[#41464d] bg-[#0a0c0e] p-1 sm:max-w-[560px]" role="tablist" aria-label="Execution and discipline review">
        {modes.map(({ id, label, icon: Icon }) => <button key={id} type="button" role="tab" aria-selected={mode === id} onClick={() => onChange(id)} className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-transparent px-1.5 text-center text-[12px] font-medium leading-4 text-[#aeb5bf] transition-colors hover:text-white aria-selected:border-[#424851] aria-selected:bg-[#1a1d21] aria-selected:text-white sm:px-4 sm:text-[13px]"><Icon size={15} strokeWidth={1.8} className="shrink-0" />{label}</button>)}
      </div>
    </div>
  )
}

function EvidenceHeader({ children }: { children: ReactNode }) {
  return <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#848c97]">{children}</p>
}

export function ExecutionDisciplineTab({ report }: ExecutionDisciplineTabProps) {
  const [mode, setMode] = useState<ReviewMode>('execution')
  const model = { execution: report.execution, decision: report.decision, tilt: report.psychology }
  const profile = profileCopy[model.tilt.profile]
  const exitReasons = [
    ['manual', model.execution.exitReasonBreakdown.manual], ['stopLoss', model.execution.exitReasonBreakdown.stopLoss],
    ['takeProfit', model.execution.exitReasonBreakdown.takeProfit], ['unknown', model.execution.exitReasonBreakdown.unknown ?? 0],
  ] as const
  const exitTotal = exitReasons.reduce((sum, [, value]) => sum + value, 0)

  return (
    <div className="space-y-7">
      <section>
        <DecisionSectionTitle info="Separates entry/exit quality, rule adherence, and behavior under pressure so a profitable outcome cannot conceal a weak decision.">Execution &amp; discipline</DecisionSectionTitle>
        <DecisionPanel className="overflow-hidden">
          <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.35fr_1fr] lg:items-center">
            <div>
              <SignalBadge label={model.execution.edgeAfterCosts ? 'Edge survives modeled costs' : 'Costs consume the edge'} tone={model.execution.edgeAfterCosts ? 'positive' : 'negative'} />
              <h3 className="mt-4 text-[25px] font-semibold leading-8 tracking-[-0.025em] text-white">Outcome, process, and behavior—reviewed separately.</h3>
              <p className="mt-3 max-w-[68ch] text-[13px] leading-6 text-[#aeb5bf]">Fees, spread, and slippage are modeled server-side, then plan changes and post-loss behavior are audited across all {report.source.tradeCount} trades.</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[#343940] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <DecisionMetric label="Net expectancy" value={`${model.execution.netExpectancyR.toFixed(3)}R`} tone={model.execution.edgeAfterCosts ? 'positive' : 'negative'} />
              <DecisionMetric label="Plan adherence" value={percent(model.decision.planAdherenceScore)} tone={model.decision.planAdherenceScore >= 80 ? 'positive' : 'warning'} />
              <DecisionMetric label="Tilt pressure" value={percent(model.tilt.tiltScore)} tone={model.tilt.tiltScore <= 25 ? 'positive' : 'warning'} />
              <DecisionMetric label="Behavior profile" value={profile.title} note="Derived from loss-response telemetry" />
            </dl>
          </div>
        </DecisionPanel>
      </section>

      <ReviewSwitcher mode={mode} onChange={setMode} />

      {mode === 'execution' ? <div className="space-y-7" role="tabpanel" aria-label="Execution quality evidence">
        <section>
          <DecisionSectionTitle info="MFE is normalized by initial risk. Capture ratio compares realized R with the maximum favorable excursion available during each trade.">Execution quality</DecisionSectionTitle>
          <div className="grid gap-3 xl:grid-cols-[1.45fr_.75fr]">
            <DecisionPanel className="overflow-x-auto p-4 sm:p-6">
              <div className="flex items-center justify-between gap-4"><div><EvidenceHeader>Exit location</EvidenceHeader><h3 className="mt-1 text-[17px] font-semibold text-white">Maximum favorable excursion</h3></div><Crosshair size={18} className="text-active-bright" /></div>
              <MfeDistributionChart bins={model.execution.mfeHistogram} />
            </DecisionPanel>
            <DecisionPanel className="grid content-start gap-6 p-5 sm:p-6">
              <DecisionMetric label="Average exit percentile" value={percent(model.execution.averageMfePercentile)} note="Exit position inside strategy MFE distribution" tone="blue" />
              <DecisionMetric label="Average capture ratio" value={percent(model.execution.averageCaptureRatio * 100)} note="Realized R divided by available MFE" tone={model.execution.averageCaptureRatio >= 0.55 ? 'positive' : 'warning'} />
              <DecisionMetric label="Gross expectancy" value={`${model.execution.grossExpectancyR.toFixed(3)}R`} />
              <DecisionMetric label="Modeled cost" value={`−${model.execution.averageCostR.toFixed(3)}R`} note="Fees + spread + slippage per trade" tone="negative" />
              <DecisionMetric label="Net win rate" value={percent(model.execution.netWinRate)} />
            </DecisionPanel>
          </div>
        </section>
        <section>
          <DecisionSectionTitle info="Counts the recorded reason that closed each trade. Hover or focus a row for the exact count and share.">Exit reason mix</DecisionSectionTitle>
          <DecisionPanel className="grid gap-2 p-4 sm:grid-cols-3 sm:p-5">
            {exitReasons.filter(([reason, count]) => reason !== 'unknown' || count > 0).map(([reason, count]) => {
              const share = exitTotal === 0 ? 0 : count / exitTotal * 100
              const label = reason === 'takeProfit' ? 'Take profit' : reason === 'stopLoss' ? 'Stop loss' : reason === 'unknown' ? 'Unknown' : 'Manual exit'
              return <div key={reason} tabIndex={0} title={`${label}: ${count} trades (${share.toFixed(1)}%)`} className="rounded-lg border border-[#343940] bg-[#0e1012] p-4 outline-none transition-colors hover:border-[#555c66] focus-visible:ring-2 focus-visible:ring-active"><EvidenceHeader>{label}</EvidenceHeader><p className="mt-2 font-mono text-[24px] font-semibold text-white tabular-nums">{count}</p><p className="mt-1 font-mono text-xs text-[#929aa5]">{share.toFixed(1)}% of exits</p></div>
            })}
          </DecisionPanel>
        </section>
      </div> : null}

      {mode === 'decision' ? <div className="space-y-7" role="tabpanel" aria-label="Decision quality evidence">
        <section>
          <DecisionSectionTitle info="A good decision follows the original risk plan regardless of whether variance produces a win or loss. A bad win is still a process failure.">Decision matrix</DecisionSectionTitle>
          <div className="grid gap-3 lg:grid-cols-[1.4fr_.6fr]">
            <DecisionPanel className="grid gap-2 p-4 sm:grid-cols-2 sm:p-5">
              {(Object.keys(matrixCopy) as DecisionClassification[]).map((classification) => {
                const item = matrixCopy[classification]
                const count = model.decision.matrix[classification]
                return <article key={classification} tabIndex={0} title={`${item.title}: ${count} trades — ${item.description}`} className={`min-h-36 rounded-xl border p-5 outline-none transition-transform hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-active ${item.tone}`}><p className="text-[11px] font-semibold uppercase tracking-[0.14em] opacity-80">{item.eyebrow}</p><div className="mt-3 flex items-end justify-between gap-4"><h3 className="text-[18px] font-semibold text-white">{item.title}</h3><strong className="font-mono text-[30px] leading-none tabular-nums">{count}</strong></div><p className="mt-4 text-xs leading-5 text-[#b7bec7]">{item.description}</p></article>
              })}
            </DecisionPanel>
            <DecisionPanel className="grid content-start gap-7 p-5 sm:p-6">
              <DecisionMetric label="Plan adherence score" value={percent(model.decision.planAdherenceScore)} note="Penalizes harmful and repeated protection changes" tone={model.decision.planAdherenceScore >= 80 ? 'positive' : 'warning'} />
              <DecisionMetric label="Rule-following dividend" value={model.decision.ruleFollowingDividendR === null ? 'Unavailable' : `${model.decision.ruleFollowingDividendR >= 0 ? '+' : ''}${model.decision.ruleFollowingDividendR.toFixed(3)}R`} note="Estimated average benefit of respecting original stops" tone={model.decision.ruleFollowingDividendR !== null && model.decision.ruleFollowingDividendR > 0 ? 'positive' : 'neutral'} />
              <DecisionMetric label="Dividend per trade" value={model.decision.ruleFollowingDividendCents === null ? 'Unavailable' : money.format(model.decision.ruleFollowingDividendCents / 100)} note="Available when protection telemetry is sufficient" tone={model.decision.ruleFollowingDividendCents !== null && model.decision.ruleFollowingDividendCents > 0 ? 'positive' : 'neutral'} />
            </DecisionPanel>
          </div>
        </section>
      </div> : null}

      {mode === 'psychology' ? <div className="space-y-7" role="tabpanel" aria-label="Psychology evidence">
        <section>
          <DecisionSectionTitle info="Behavior scores use position size, stop edits, entry timing, and response to losing streaks. They indicate patterns, not a clinical assessment.">Behavior under pressure</DecisionSectionTitle>
          <DecisionPanel className="overflow-hidden">
            <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[.8fr_1.2fr]">
              <div className="border-b border-[#343940] pb-7 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-7">
                <ShieldAlert size={24} className={profile.tone === 'positive' ? 'text-profit-bright' : profile.tone === 'negative' ? 'text-loss-bright' : 'text-[#e4b740]'} />
                <SignalBadge label={model.tilt.profile.replace('-', ' ')} tone={profile.tone} />
                <h3 className="mt-4 text-[24px] font-semibold tracking-[-0.02em] text-white">{profile.title}</h3>
                <p className="mt-3 text-[13px] leading-6 text-[#aeb5bf]">{profile.detail}</p>
              </div>
              <div className="grid content-center gap-6">
                <ScoreRail label="Tilt pressure" score={model.tilt.tiltScore} inverse />
                <ScoreRail label="Stop-loss integrity" score={100 - model.tilt.slTamperingScore} />
                <ScoreRail label="Sizing consistency" score={model.tilt.sizingConsistency} />
                <ScoreRail label="Anti-streak discipline" score={model.tilt.antiStreakScore} />
              </div>
            </div>
          </DecisionPanel>
        </section>
        <section>
          <DecisionSectionTitle>Loss-response telemetry</DecisionSectionTitle>
          <div className="grid gap-3 sm:grid-cols-2">
            <DecisionPanel className="p-5"><DecisionMetric label="Post-loss size escalations" value={String(model.tilt.postLossSizeEscalations)} note="Size exceeded recent baseline after a losing streak" tone={model.tilt.postLossSizeEscalations === 0 ? 'positive' : 'warning'} /></DecisionPanel>
            <DecisionPanel className="p-5"><DecisionMetric label="Rapid re-entries after loss" value={String(model.tilt.rapidReentriesAfterLoss)} note="Next entry occurred within 15 minutes" tone={model.tilt.rapidReentriesAfterLoss === 0 ? 'positive' : 'warning'} /></DecisionPanel>
          </div>
        </section>
      </div> : null}
    </div>
  )
}
