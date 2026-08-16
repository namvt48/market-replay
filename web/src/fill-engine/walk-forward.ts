export interface WalkForwardInput {
  r: number[]
  exitTs: number[]
}

export interface WalkForwardConfig {
  split?: number
  windows?: number
  baseStopPercent?: number
  baseTargetR?: number
}

export interface WalkForwardWindow {
  label: string
  startTs: number | null
  endTs: number | null
  trades: number
  expectancyR: number
}

export interface SensitivityPoint {
  stopDeltaPercent: number
  targetDeltaPercent: number
  expectancyR: number
}

export interface WalkForwardResult {
  inSample: { trades: number; expectancyR: number }
  outOfSample: { trades: number; expectancyR: number }
  expectancyDeltaR: number
  retentionRatio: number
  windows: WalkForwardWindow[]
  parameterSensitivity: {
    points: SensitivityPoint[]
    rangeR: number
    shape: 'plateau' | 'knife-edge'
    proxy: true
  }
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

export function analyzeWalkForward(input: WalkForwardInput, config: WalkForwardConfig = {}): WalkForwardResult {
  const entries = input.r.map((value, index) => ({ r: Number.isFinite(value) ? value : 0, ts: input.exitTs[index] ?? index })).toSorted((a, b) => a.ts - b.ts)
  const split = Math.min(0.95, Math.max(0.5, config.split ?? 0.8))
  const splitIndex = Math.min(entries.length, Math.max(0, Math.floor(entries.length * split)))
  const inSampleValues = entries.slice(0, splitIndex).map((entry) => entry.r)
  const outOfSampleValues = entries.slice(splitIndex).map((entry) => entry.r)
  const inSampleExpectancy = average(inSampleValues)
  const outOfSampleExpectancy = average(outOfSampleValues)
  const windowCount = Math.min(12, Math.max(2, Math.round(config.windows ?? 5)))
  const windowSize = Math.max(1, Math.ceil(entries.length / windowCount))
  const windows = Array.from({ length: Math.ceil(entries.length / windowSize) }, (_, index) => {
    const items = entries.slice(index * windowSize, (index + 1) * windowSize)
    return {
      label: `W${index + 1}`,
      startTs: items[0]?.ts ?? null,
      endTs: items.at(-1)?.ts ?? null,
      trades: items.length,
      expectancyR: average(items.map((entry) => entry.r)),
    }
  })
  const deltas = [-20, -10, -5, 0, 5, 10, 20]
  const base = average(entries.map((entry) => entry.r))
  const points = deltas.flatMap((stopDelta) => deltas.map((targetDelta) => {
    const favorable = entries.filter((entry) => entry.r > 0).length / Math.max(1, entries.length)
    const sensitivity = targetDelta * favorable * 0.0018 - Math.abs(stopDelta) * 0.0011 - Math.abs(targetDelta - stopDelta) * 0.0007
    return { stopDeltaPercent: stopDelta, targetDeltaPercent: targetDelta, expectancyR: base + sensitivity }
  }))
  const sensitivityValues = points.map((point) => point.expectancyR)
  const rangeR = Math.max(...sensitivityValues, 0) - Math.min(...sensitivityValues, 0)
  return {
    inSample: { trades: inSampleValues.length, expectancyR: inSampleExpectancy },
    outOfSample: { trades: outOfSampleValues.length, expectancyR: outOfSampleExpectancy },
    expectancyDeltaR: outOfSampleExpectancy - inSampleExpectancy,
    retentionRatio: Math.abs(inSampleExpectancy) < 1e-9 ? 0 : outOfSampleExpectancy / inSampleExpectancy,
    windows,
    parameterSensitivity: { points, rangeR, shape: rangeR <= Math.max(0.18, Math.abs(base) * 0.8) ? 'plateau' : 'knife-edge', proxy: true },
  }
}
