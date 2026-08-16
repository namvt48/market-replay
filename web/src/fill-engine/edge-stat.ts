export type EdgeVerdict = 'insufficient' | 'no-evidence' | 'zero-edge' | 'edge'

export interface EdgeStatsInput {
  winRate?: number
  avgWinR?: number
  avgLossR?: number
}

export interface EdgeStats {
  n: number
  expectancyR: number
  breakevenRate: number
  avgRR: number
  tStat: number
  pValue: number
  winRate: number
  avgWinR: number
  avgLossR: number
  verdict: EdgeVerdict
}

const EPSILON = 1e-12

function logGamma(value: number): number {
  const coefficients = [
    676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7,
  ]
  if (value < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * value)) - logGamma(1 - value)
  let x = 0.9999999999998099
  const shifted = value - 1
  coefficients.forEach((coefficient, index) => { x += coefficient / (shifted + index + 1) })
  const t = shifted + coefficients.length - 0.5
  return 0.5 * Math.log(2 * Math.PI) + (shifted + 0.5) * Math.log(t) - t + Math.log(x)
}

function betaContinuedFraction(a: number, b: number, x: number): number {
  const maxIterations = 200
  const fpMinimum = 1e-30
  let qab = a + b
  let qap = a + 1
  let qam = a - 1
  let c = 1
  let d = 1 - qab * x / qap
  if (Math.abs(d) < fpMinimum) d = fpMinimum
  d = 1 / d
  let result = d
  for (let iteration = 1; iteration <= maxIterations; iteration += 1) {
    const doubled = iteration * 2
    let numerator = iteration * (b - iteration) * x / ((qam + doubled) * (a + doubled))
    d = 1 + numerator * d
    if (Math.abs(d) < fpMinimum) d = fpMinimum
    c = 1 + numerator / c
    if (Math.abs(c) < fpMinimum) c = fpMinimum
    d = 1 / d
    result *= d * c
    numerator = -(a + iteration) * (qab + iteration) * x / ((a + doubled) * (qap + doubled))
    d = 1 + numerator * d
    if (Math.abs(d) < fpMinimum) d = fpMinimum
    c = 1 + numerator / c
    if (Math.abs(c) < fpMinimum) c = fpMinimum
    d = 1 / d
    const delta = d * c
    result *= delta
    if (Math.abs(delta - 1) < 3e-10) break
  }
  return result
}

function regularizedIncompleteBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x))
  return x < (a + 1) / (a + b + 2)
    ? factor * betaContinuedFraction(a, b, x) / a
    : 1 - factor * betaContinuedFraction(b, a, 1 - x) / b
}

function twoSidedStudentTPValue(tStat: number, degreesOfFreedom: number): number {
  if (!Number.isFinite(tStat)) return 0
  if (degreesOfFreedom <= 0) return 1
  const x = degreesOfFreedom / (degreesOfFreedom + tStat * tStat)
  return Math.min(1, Math.max(0, regularizedIncompleteBeta(x, degreesOfFreedom / 2, 0.5)))
}

function finiteValues(values: number[]): number[] {
  return values.filter(Number.isFinite)
}

export function calculateEdgeStats(values: number[], input: EdgeStatsInput = {}): EdgeStats {
  const r = finiteValues(values)
  const n = r.length
  const wins = r.filter((value) => value > 0)
  const losses = r.filter((value) => value < 0)
  const winRate = input.winRate ?? (n === 0 ? 0 : wins.length / n)
  const avgWinR = input.avgWinR ?? (wins.length === 0 ? 0 : wins.reduce((sum, value) => sum + value, 0) / wins.length)
  const avgLossR = Math.abs(input.avgLossR ?? (losses.length === 0 ? 0 : losses.reduce((sum, value) => sum + value, 0) / losses.length))
  const avgRR = avgLossR <= EPSILON ? 0 : avgWinR / avgLossR
  const breakevenRate = avgRR <= EPSILON ? 1 : 1 / (1 + avgRR)
  const expectancyR = n === 0 ? 0 : r.reduce((sum, value) => sum + value, 0) / n
  const variance = n < 2 ? 0 : r.reduce((sum, value) => sum + (value - expectancyR) ** 2, 0) / (n - 1)
  const standardDeviation = Math.sqrt(Math.max(0, variance))
  const tStat = standardDeviation <= EPSILON
    ? expectancyR > 0 ? Number.POSITIVE_INFINITY : expectancyR < 0 ? Number.NEGATIVE_INFINITY : 0
    : expectancyR * Math.sqrt(n) / standardDeviation
  const pValue = standardDeviation <= EPSILON ? (Math.abs(expectancyR) <= EPSILON ? 1 : 0) : twoSidedStudentTPValue(tStat, n - 1)
  const verdict: EdgeVerdict = n < 50
    ? 'insufficient'
    : pValue >= 0.05
      ? 'no-evidence'
      : winRate <= breakevenRate
        ? 'zero-edge'
        : 'edge'
  return { n, expectancyR, breakevenRate, avgRR, tStat, pValue, winRate, avgWinR, avgLossR, verdict }
}
