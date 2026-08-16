export interface ConfidenceInterval {
  median: number
  lower: number
  upper: number
}

export interface BootstrapResult {
  expectancy: ConfidenceInterval
  maxDrawdown: ConfidenceInterval
  sharpe: ConfidenceInterval
  iterations: number
  confidence: number
  seed: number
}

export interface BootstrapOptions {
  iterations?: number
  confidence?: number
  seed?: number
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 4_294_967_296
  }
}

function average(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
}

function maxDrawdown(values: number[]): number {
  let equity = 0
  let peak = 0
  let maximum = 0
  for (const value of values) {
    equity += value
    peak = Math.max(peak, equity)
    maximum = Math.min(maximum, equity - peak)
  }
  return maximum
}

function sharpe(values: number[]): number {
  if (values.length < 2) return 0
  const mean = average(values)
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1)
  const deviation = Math.sqrt(Math.max(0, variance))
  return deviation === 0 ? 0 : mean / deviation * Math.sqrt(values.length)
}

function quantile(sorted: number[], percentile: number): number {
  if (sorted.length === 0) return 0
  const position = Math.min(sorted.length - 1, Math.max(0, percentile * (sorted.length - 1)))
  const lower = Math.floor(position)
  const upper = Math.ceil(position)
  const weight = position - lower
  return (sorted[lower] ?? 0) * (1 - weight) + (sorted[upper] ?? 0) * weight
}

function interval(values: number[], confidence: number): ConfidenceInterval {
  const sorted = values.toSorted((a, b) => a - b)
  const tail = (1 - confidence) / 2
  return { lower: quantile(sorted, tail), median: quantile(sorted, 0.5), upper: quantile(sorted, 1 - tail) }
}

export function bootstrapAnalytics(values: number[], options: BootstrapOptions = {}): BootstrapResult {
  const r = values.filter(Number.isFinite)
  const iterations = Math.min(50_000, Math.max(100, Math.round(options.iterations ?? 10_000)))
  const confidence = Math.min(0.99, Math.max(0.5, options.confidence ?? 0.9))
  const seed = options.seed ?? 20_250_816
  if (r.length === 0) {
    const empty = { median: 0, lower: 0, upper: 0 }
    return { expectancy: empty, maxDrawdown: empty, sharpe: empty, iterations, confidence, seed }
  }
  const random = seededRandom(seed)
  const expectancy: number[] = []
  const drawdown: number[] = []
  const sharpeValues: number[] = []
  const sample = new Array<number>(r.length)
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    for (let index = 0; index < r.length; index += 1) sample[index] = r[Math.floor(random() * r.length)] ?? 0
    expectancy.push(average(sample))
    drawdown.push(maxDrawdown(sample))
    sharpeValues.push(sharpe(sample))
  }
  return {
    expectancy: interval(expectancy, confidence),
    maxDrawdown: interval(drawdown, confidence),
    sharpe: interval(sharpeValues, confidence),
    iterations,
    confidence,
    seed,
  }
}
