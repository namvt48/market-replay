/*
THESIS: Edge is a statistical claim that must survive evidence, regimes, and sizing—not a brighter P&L number.
OWN-WORLD: Replay Desk graphite sheets, mono measurements, one blue evidence band, and semantic verdict color.
STORY: Read the verdict, inspect uncertainty, locate the edge source, test stability, then size only what survived.
FIRST VIEWPORT: One wide evidence verdict with sample guardrails, followed by a confidence interval work surface.
FORM: A vertical quantitative review that extends the incumbent Analytics operating surface.
*/
import { FlaskConical, Scale, ShieldCheck, TrendingUp } from 'lucide-react'
import type { AnalyticsEdge } from '../../api/analytics'
import { ConfidenceBand, StabilityChart } from './DecisionIntelligenceCharts'
import { DecisionMetric, DecisionPanel, DecisionSectionTitle, SignalBadge } from './DecisionIntelligenceUi'

interface EdgeTabProps { report: AnalyticsEdge }

const verdictCopy: Record<AnalyticsEdge['edge']['verdict'], { title: string; description: string; tone: 'positive' | 'negative' | 'warning' | 'neutral' }> = {
  edge: { title: 'Statistically supported edge', description: 'The observed win rate clears breakeven and the mean R is distinguishable from zero in this sample.', tone: 'positive' },
  insufficient: { title: 'Sample still too small', description: 'Fewer than 50 eligible trades. Treat every estimate below as exploratory, not actionable.', tone: 'warning' },
  'no-evidence': { title: 'Edge is not yet proven', description: 'The sample does not reject a zero-mean outcome at the 5% significance threshold.', tone: 'warning' },
  'zero-edge': { title: 'Payoff does not clear breakeven', description: 'The current win rate is below the breakeven rate implied by the average payoff ratio.', tone: 'negative' },
}

function percentage(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

function sensitivityTone(value: number, minimum: number, maximum: number): string {
  const span = Math.max(0.001, maximum - minimum)
  const ratio = (value - minimum) / span
  if (ratio >= 0.8) return 'border-profit/50 bg-profit/20 text-profit-bright'
  if (ratio >= 0.55) return 'border-[#356b5e] bg-[#15312a] text-[#b8e3d8]'
  if (ratio >= 0.3) return 'border-[#5b563d] bg-[#292618] text-[#d9c980]'
  return 'border-loss/40 bg-loss/15 text-loss-bright'
}

export function EdgeTab({ report }: EdgeTabProps) {
  const model = { edge: report.edge, bootstrap: report.bootstrap, decomposition: report.decomposition, robustness: report.walkForward, sizing: report.sizing }
  const verdict = verdictCopy[model.edge.verdict]
  const sensitivity = model.robustness.parameterSensitivity
  const sensitivityValues = sensitivity?.points.map((point) => point.expectancyR) ?? []
  const sensitivityMinimum = Math.min(...sensitivityValues)
  const sensitivityMaximum = Math.max(...sensitivityValues)
  const timingLabel = model.decomposition.timingFlag === 'exit-leak' ? 'Exit leak detected' : model.decomposition.timingFlag === 'entry-good' ? 'Entry quality leads' : model.decomposition.timingFlag === 'entry-risk' ? 'Entry heat elevated' : 'Timing balanced'

  return (
    <div className="space-y-11">
      <section>
        <DecisionSectionTitle info="The verdict combines sample size, a two-sided Student t-test, and win rate versus payoff-implied breakeven.">Edge verdict</DecisionSectionTitle>
        <DecisionPanel className="overflow-hidden">
          <div className="grid gap-8 p-5 sm:p-7 lg:grid-cols-[1.35fr_1fr] lg:items-center">
            <div className="max-w-2xl">
              <SignalBadge label={model.edge.verdict === 'edge' ? 'Evidence passed' : 'Guardrail active'} tone={verdict.tone} />
              <h3 className="mt-4 text-[26px] font-semibold leading-8 tracking-[-0.025em] text-white sm:text-[30px]">{verdict.title}</h3>
              <p className="mt-3 max-w-[66ch] text-[14px] leading-6 text-[#aeb5bf]">{verdict.description}</p>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-t border-[#343940] pt-6 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
              <DecisionMetric label="Eligible sample" value={`${model.edge.sampleSize} trades`} note={model.edge.sampleSize >= 50 ? 'Sample guardrail cleared' : 'Minimum 50 required'} tone={model.edge.sampleSize >= 50 ? 'positive' : 'warning'} />
              <DecisionMetric label="p-value" value={model.edge.pValue < 0.001 ? '<0.001' : model.edge.pValue.toFixed(3)} note="Two-sided Student t-test" tone={model.edge.pValue < 0.05 ? 'positive' : 'warning'} />
              <DecisionMetric label="t-statistic" value={model.edge.tStatistic?.toFixed(2) ?? '—'} note="Mean R scaled by uncertainty" />
              <DecisionMetric label="Win rate / BE" value={`${model.edge.winRate.toFixed(1)}% / ${model.edge.breakevenRate?.toFixed(1) ?? '—'}%`} tone={model.edge.breakevenRate !== null && model.edge.winRate > model.edge.breakevenRate ? 'positive' : 'negative'} />
            </dl>
          </div>
        </DecisionPanel>
      </section>

      <section>
        <DecisionSectionTitle info="The 90% interval is generated by seeded bootstrap resampling of trade R multiples. It shows estimation uncertainty, not a guaranteed future range.">Expectancy and validity</DecisionSectionTitle>
        <DecisionPanel className="grid gap-3 p-4 sm:p-6 lg:grid-cols-[260px_1fr] lg:items-center">
          <div className="border-b border-[#343940] pb-5 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
            <p className="text-[13px] text-[#aeb5bf]">Observed expectancy</p>
            <p className={`mt-1 font-mono text-[34px] font-semibold tracking-[-0.03em] tabular-nums ${model.edge.expectancyR >= 0 ? 'text-profit-bright' : 'text-loss-bright'}`}>{model.edge.expectancyR.toFixed(3)}R</p>
            <p className="mt-2 text-xs leading-5 text-[#8f97a3]">The bootstrap interval runs from <span className="font-mono text-[#cbd0d7]">{model.bootstrap.expectancyR.lower.toFixed(3)}R</span> to <span className="font-mono text-[#cbd0d7]">{model.bootstrap.expectancyR.upper.toFixed(3)}R</span>.</p>
          </div>
          <div className="overflow-x-auto"><ConfidenceBand lower={model.bootstrap.expectancyR.lower} median={model.bootstrap.expectancyR.median} upper={model.bootstrap.expectancyR.upper} actual={model.edge.expectancyR} /></div>
        </DecisionPanel>
      </section>

      <section>
        <DecisionSectionTitle info="Separates edge into hit rate, payoff asymmetry, execution timing, and dependence on the largest winning trades.">Edge decomposition</DecisionSectionTitle>
        <div className="grid gap-3 lg:grid-cols-3">
          <DecisionPanel className="p-5">
            <div className="flex items-center justify-between"><h3 className="text-[16px] font-semibold text-white">Hit rate × payoff</h3><Scale size={17} className="text-active-bright" /></div>
            <p className="mt-5 font-mono text-[28px] font-semibold text-active-bright">{model.decomposition.payoffAsymmetry.toFixed(2)}×</p>
            <p className="mt-2 text-xs leading-5 text-[#99a1ab]">Average win <span className="font-mono text-profit-bright">{model.edge.averageWinR.toFixed(2)}R</span> versus average loss <span className="font-mono text-loss-bright">{model.edge.averageLossR.toFixed(2)}R</span>.</p>
          </DecisionPanel>
          <DecisionPanel className="p-5">
            <div className="flex items-center justify-between"><h3 className="text-[16px] font-semibold text-white">Timing edge</h3><TrendingUp size={17} className="text-active-bright" /></div>
            <p className="mt-5 text-[20px] font-semibold text-active-bright">{timingLabel}</p>
            <p className="mt-2 text-xs leading-5 text-[#99a1ab]">Captures <span className="font-mono text-[#dce1e7]">{percentage(model.decomposition.captureRatio)}</span> of average MFE; average MAE is <span className="font-mono text-[#dce1e7]">{model.decomposition.averageMaeR.toFixed(2)}R</span>.</p>
          </DecisionPanel>
          <DecisionPanel className="p-5">
            <div className="flex items-center justify-between"><h3 className="text-[16px] font-semibold text-white">Profit concentration</h3><FlaskConical size={17} className="text-active-bright" /></div>
            <p className={`mt-5 font-mono text-[28px] font-semibold ${model.decomposition.concentrationFlag === 'diversified' ? 'text-profit-bright' : 'text-caution-bright'}`}>{model.decomposition.topNConcentrationPercent.toFixed(1)}%</p>
            <p className="mt-2 text-xs leading-5 text-[#99a1ab]">Top {model.decomposition.topN} wins contribute this share of gross winning R. Status: <span className="font-medium text-[#dce1e7]">{model.decomposition.concentrationFlag}</span>.</p>
          </DecisionPanel>
        </div>
      </section>

      <section>
        <DecisionSectionTitle info="Compares the first 80% of trades with the latest 20%, then checks rolling windows and a phase-one SL/TP sensitivity proxy.">Walk-forward robustness</DecisionSectionTitle>
        <DecisionPanel className="p-4 sm:p-6">
          <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
            <div>
              <dl className="grid grid-cols-2 gap-5">
                <DecisionMetric label="In-sample E[R]" value={`${model.robustness.inSample.expectancyR.toFixed(3)}R`} note={`${model.robustness.inSample.trades} trades`} tone={model.robustness.inSample.expectancyR > 0 ? 'positive' : 'negative'} />
                <DecisionMetric label="Out-of-sample E[R]" value={`${model.robustness.outOfSample.expectancyR.toFixed(3)}R`} note={`${model.robustness.outOfSample.trades} latest trades`} tone={model.robustness.outOfSample.expectancyR > 0 ? 'positive' : 'negative'} />
                <DecisionMetric label="OOS retention" value={percentage(model.robustness.retentionRatio)} tone={model.robustness.retentionRatio >= 0.65 ? 'positive' : 'warning'} />
                <DecisionMetric label="Sensitivity" value={sensitivity ? (sensitivity.shape === 'plateau' ? 'Broad plateau' : 'Knife-edge peak') : 'Unavailable'} tone={sensitivity?.shape === 'plateau' ? 'positive' : 'warning'} />
              </dl>
              <p className="mt-5 text-xs leading-5 text-[#858d98]">Parameter sensitivity is an explicitly labelled phase-one proxy until OHLC trade re-walk is connected.</p>
            </div>
            <div className="overflow-x-auto border-t border-[#343940] pt-4 lg:border-l lg:border-t-0 lg:pl-6 lg:pt-0"><StabilityChart windows={model.robustness.windows} /></div>
          </div>
          {sensitivity ? <div className="mt-6 border-t border-[#343940] pt-5"><div className="mb-3 flex items-center justify-between gap-3"><h3 className="text-[15px] font-semibold text-white">SL / TP sensitivity</h3><SignalBadge label={sensitivity.shape === 'plateau' ? 'Stable plateau' : 'Parameter-sensitive'} tone={sensitivity.shape === 'plateau' ? 'positive' : 'warning'} /></div><div className="overflow-x-auto"><div className="grid min-w-[650px] grid-cols-7 gap-1.5">{sensitivity.points.map((point) => <div key={`${point.stopDeltaPercent}-${point.targetDeltaPercent}`} aria-label={`Stop ${point.stopDeltaPercent}%, target ${point.targetDeltaPercent}%: ${point.expectancyR.toFixed(3)}R`} className={`grid h-11 place-items-center rounded-md border font-mono text-[11px] tabular-nums ${sensitivityTone(point.expectancyR, sensitivityMinimum, sensitivityMaximum)}`}>{point.expectancyR.toFixed(2)}R</div>)}</div></div></div> : <p className="mt-6 border-t border-[#343940] pt-4 text-xs text-[#858d98]">Sensitivity requires sufficient initial-risk and market-data coverage.</p>}
        </DecisionPanel>
      </section>

      <section>
        <DecisionSectionTitle info="Kelly sizing is hidden unless the edge verdict passes every guardrail. The recommendation uses one-quarter Kelly and is capped at 2% account risk per trade.">Position sizing</DecisionSectionTitle>
        <DecisionPanel className="p-5 sm:p-7">
          {model.sizing ? <div className="grid gap-7 lg:grid-cols-[1.2fr_1fr] lg:items-center"><div><div className="flex items-center gap-3"><ShieldCheck size={22} className="text-profit-bright" /><h3 className="text-[20px] font-semibold text-ink">Sizing unlocked by evidence</h3></div><p className="mt-3 max-w-[68ch] text-ui-body leading-6 text-muted">Fractional Kelly translates the measured edge into a conservative risk budget. The product cap remains the final guardrail.</p></div><dl className="grid grid-cols-2 gap-5"><DecisionMetric label="Full Kelly" value={percentage(model.sizing.fullKelly)} /><DecisionMetric label="Fractional Kelly" value={percentage(model.sizing.fractionalKelly)} /><DecisionMetric label="Suggested risk / trade" value={percentage(model.sizing.suggestedRiskPerTrade)} tone="positive" /><DecisionMetric label="Risk cap" value={percentage(model.sizing.maxRiskCap)} note={model.sizing.capped ? 'Recommendation capped' : 'Cap not binding'} /></dl></div> : <div className="flex items-start gap-4"><ShieldCheck size={22} className="mt-0.5 text-caution-bright" /><div><h3 className="text-[18px] font-semibold text-ink">Sizing remains locked</h3><p className="mt-2 text-ui-body leading-6 text-muted">Kelly output is withheld until sample size, statistical evidence, and breakeven guardrails all pass.</p></div></div>}
        </DecisionPanel>
      </section>
    </div>
  )
}
