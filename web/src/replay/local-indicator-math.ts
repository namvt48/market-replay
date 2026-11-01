import type { ChartBarTicks, IndicatorRunResult } from '../api/types'

export function calculateLocalPlot(id: 'ema' | 'rsi', bars: ChartBarTicks[], rawPeriod: unknown, tickSize: number): IndicatorRunResult['plots'] {

  const defaultPeriod = id === 'ema' ? 20 : 14
  const period = Number(rawPeriod ?? defaultPeriod)
  if (!Number.isInteger(period) || period < 1 || period > 500) throw new Error(`Invalid ${id.toUpperCase()} period`)
  const out: IndicatorRunResult['plots'] = []
  if (id === 'ema') {
    if (bars.length < period) return out
    const alpha = 2 / (period + 1)
    let ema = 0
    for (let index = 0; index < bars.length; index += 1) {
      const close = bars[index].closeTicks * tickSize
      if (index < period - 1) continue
      if (index === period - 1) ema = bars.slice(0, period).reduce((sum, bar) => sum + bar.closeTicks * tickSize, 0) / period
      else ema += alpha * (close - ema)
      out.push({ key: 'ema', time: bars[index].time, value: ema })
    }
    return out
  }
  let gain = 0
  let loss = 0
  for (let index = 1; index < bars.length; index += 1) {
    const change = (bars[index].closeTicks - bars[index - 1].closeTicks) * tickSize
    const up = Math.max(change, 0)
    const down = Math.max(-change, 0)
    if (index <= period) {
      gain += up
      loss += down
      if (index === period) {
        gain /= period
        loss /= period
        out.push({ key: 'rsi', time: bars[index].time, value: rsiValue(gain, loss) })
      }
      continue
    }
    gain = (gain * (period - 1) + up) / period
    loss = (loss * (period - 1) + down) / period
    out.push({ key: 'rsi', time: bars[index].time, value: rsiValue(gain, loss) })
  }
  return out
}

function rsiValue(averageGain: number, averageLoss: number): number {
  if (averageGain === 0 && averageLoss === 0) return 50
  if (averageLoss === 0) return 100
  if (averageGain === 0) return 0
  return 100 - 100 / (1 + averageGain / averageLoss)
}
