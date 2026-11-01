import gb69 from '../../../internal/indicators/scripts/gb69-cbmor.js?raw'
import daySeparator from '../../../internal/indicators/scripts/day-separator.js?raw'
import killzones from '../../../internal/indicators/scripts/killzones.js?raw'
import openPriceMarkers from '../../../internal/indicators/scripts/open-price-markers.js?raw'
import fractals from '../../../internal/indicators/scripts/fractals.js?raw'
import ipdaRanges from '../../../internal/indicators/scripts/ipda-ranges.js?raw'
import type { ChartBarTicks, IndicatorDescriptor, IndicatorDrawIntent, IndicatorInputValue, IndicatorRunResult } from '../api/types'
import { calculateLocalPlot } from './local-indicator-math'
import { isIndicatorHistoryPrefix, zonedDateParts } from './local-indicator-session'

const SOURCES: Record<string, { name: string; source: string }> = {
  'gb69-cbmor': { name: 'GB69 / CB MOR Range & Levels', source: gb69 },
  'day-separator': { name: 'Day Separator', source: daySeparator },
  killzones: { name: 'Killzones', source: killzones },
  'open-price-markers': { name: 'Open Price Markers', source: openPriceMarkers },
  fractals: { name: 'Fractals', source: fractals },
  'ipda-ranges': { name: 'IPDA Ranges', source: ipdaRanges },
}

const descriptorCache = new Map<string, IndicatorDescriptor>()
type Draw = IndicatorDrawIntent
interface MomentValue {
  tz(zone: string): MomentValue
  hour(): number
  minute(): number
  clone(): MomentValue
  startOf(unit: string): MomentValue
  add(amount: number, unit: string): MomentValue
  valueOf(): number
}

function createMoment(initialSeconds: number, initialZone = 'UTC'): MomentValue {
  let seconds = initialSeconds
  let zone = initialZone
  return {
    tz(next: string) { zone = next; return this },
    hour() { return zonedDateParts(seconds, zone)[3] },
    minute() { return zonedDateParts(seconds, zone)[4] },
    clone() { return createMoment(seconds, zone) },
    startOf(unit: string) {
      if (unit !== 'day') throw new Error(`Unsupported startOf(${unit})`)
      const [year, month, day] = zonedDateParts(seconds, zone)
      const target = Date.UTC(year, month - 1, day)
      let candidate = target / 1000
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const [localYear, localMonth, localDay, hour, minute] = zonedDateParts(candidate, zone)
        candidate -= (Date.UTC(localYear, localMonth - 1, localDay, hour, minute) - target) / 1000
      }
      seconds = candidate
      return this
    },
    add(amount: number, unit: string) {
      if (unit === 'hours') seconds += amount * 3600
      else if (unit === 'minutes') seconds += amount * 60
      else throw new Error(`Unsupported add unit ${unit}`)
      return this
    },
    valueOf() { return Math.floor(seconds) },
  }
}

interface ScriptRunner {
  advance(bars: ChartBarTicks[], dailyBars: ChartBarTicks[]): IndicatorRunResult
}

function createScriptRunner(scriptId: string, initialBars: ChartBarTicks[], inputs: Record<string, IndicatorInputValue>, tickSize: number, initialDailyBars: ChartBarTicks[]): ScriptRunner {
  const item = SOURCES[scriptId]
  if (!item) throw new Error(`Unknown local indicator: ${scriptId}`)
  const descriptors: IndicatorDescriptor['inputs'] = []
  const effective: Record<string, IndicatorInputValue> = {}
  const draws = new Map<number, Draw>()
  const plots: IndicatorRunResult['plots'] = []
  let nextDrawId = 0
  let cursor = 0
  let processed = 0
  let bars = initialBars
  let dailyBars = initialDailyBars
  const resolve = (kind: IndicatorDescriptor['inputs'][number]['kind'], label: string, value: IndicatorInputValue, key: string, min?: number, max?: number, step?: number, options?: string[], group?: string, tooltip?: string): IndicatorInputValue => {
    descriptors.push({ kind, key, label, default: value, ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }), ...(step === undefined ? {} : { step }), ...(options === undefined ? {} : { options }), ...(group === undefined ? {} : { group }), ...(tooltip === undefined ? {} : { tooltip }) })
    const supplied = Object.hasOwn(inputs, key) ? inputs[key] : value
    if (typeof supplied !== typeof value) throw new Error(`Invalid input ${key}: expected ${typeof value}`)
    if (typeof supplied === 'number') {
      if (!Number.isFinite(supplied) || (min !== undefined && supplied < min) || (max !== undefined && supplied > max)) throw new Error(`Invalid input ${key}`)
      effective[key] = kind === 'int' ? Math.trunc(supplied) : supplied
    } else if (typeof supplied === 'string') {
      if (kind === 'session' && !/^\d{4}-\d{4}$/.test(supplied)) throw new Error(`Invalid session input ${key}`)
      if (options && !options.includes(supplied)) throw new Error(`Invalid option for ${key}`)
      effective[key] = supplied
    } else if (typeof supplied === 'boolean') {
      effective[key] = supplied
    } else if (supplied && typeof supplied === 'object') {
      if (!['r', 'g', 'b'].every((field) => Number.isInteger(supplied[field as keyof typeof supplied])) || !Number.isFinite(supplied.a)) throw new Error(`Invalid color input ${key}`)
      effective[key] = supplied
    } else throw new Error(`Invalid input ${key}`)
    return effective[key]
  }
  const input = {
    session: (label: string, def: string, key: string, _options?: unknown, group?: string) => resolve('session', label, def, key, undefined, undefined, undefined, undefined, group),
    time: (label: string, def: number, key: string, min: number, max: number, tooltip?: string, group?: string) => resolve('time', label, def, key, min, max, undefined, undefined, group, tooltip),
    str: (label: string, def: string, key: string, options: string[], tooltip?: string, group?: string) => resolve('str', label, def, key, undefined, undefined, undefined, options, group, tooltip),
    float: (label: string, def: number, key: string, min: number, max: number, step: number, tooltip?: string, group?: string) => resolve('float', label, def, key, min, max, step, undefined, group, tooltip),
    int: (label: string, def: number, key: string, min: number, max: number, step: number, tooltip?: string, group?: string) => resolve('int', label, def, key, min, max, step, undefined, group, tooltip),
    bool: (label: string, def: boolean, key: string, tooltipOrGroup?: string, group?: string) => resolve('bool', label, def, key, undefined, undefined, undefined, undefined, group ?? tooltipOrGroup, group ? tooltipOrGroup : undefined),
    color: (label: string, def: IndicatorInputValue, key: string, group?: string, tooltip?: string) => resolve('color', label, def, key, undefined, undefined, undefined, undefined, group, tooltip),
  }
  let meta = { onMainPanel: false, format: undefined as string | undefined }
  let script: Record<string, (...args: unknown[]) => unknown> = {}
  const globals: Record<string, unknown> = {
    input, color: { gray: { r: 128, g: 128, b: 128, a: 1 }, black: { r: 0, g: 0, b: 0, a: 1 } },
    indicator: (options: { onMainPanel?: boolean; format?: string }) => { meta = { onMainPanel: options.onMainPanel ?? false, format: options.format } },
    time: (n = 0) => bars[cursor - Number(n)]?.time ?? NaN,
    openC: (n = 0) => (bars[cursor - Number(n)]?.openTicks ?? NaN) * tickSize,
    high: (n = 0) => (bars[cursor - Number(n)]?.highTicks ?? NaN) * tickSize,
    low: (n = 0) => (bars[cursor - Number(n)]?.lowTicks ?? NaN) * tickSize,
    closeC: (n = 0) => (bars[cursor - Number(n)]?.closeTicks ?? NaN) * tickSize,
    volume: (n = 0) => bars[cursor - Number(n)]?.volume ?? NaN,
    horizontalRay: (t0: number, y0: number, style: Record<string, unknown>, label = '') => { const id = ++nextDrawId; draws.set(id, { id, kind: 'ray', t0, y0, label, style }); return id },
    rectangle: (t0: number, y0: number, t1: number, y1: number, style: Record<string, unknown>) => { const id = ++nextDrawId; draws.set(id, { id, kind: 'rectangle', t0, y0, t1, y1, style }); return id },
    verticalLine: (t0: number, style: Record<string, unknown>) => { const id = ++nextDrawId; draws.set(id, { id, kind: 'vline', t0, y0: 0, style }); return id },
    marker: (t0: number, y0: number, label: string, style: Record<string, unknown>) => { const id = ++nextDrawId; draws.set(id, { id, kind: 'marker', t0, y0, label, style }); return id },
    deleteDrawingById: (id: number) => { draws.delete(Number(id)) },
    plot: (key: string, value: number) => { plots.push({ key, time: bars[cursor]?.time ?? 0, value: Number(value) }) },
    dailyRange: (n: number) => {
      // The Go engine's dailyRange takes n+2 daily buckets and drops the last
      // bucket as the active/unconfirmed session. The caller supplies 62
      // buckets, so applying that same rule preserves the Go window exactly.
      const complete = dailyBars.slice(0, -1)
      if (complete.length < Number(n)) return undefined
      const chosen = complete.slice(-Number(n))
      return { time: chosen[0].time, high: Math.max(...chosen.map((bar) => bar.highTicks)) * tickSize, low: Math.min(...chosen.map((bar) => bar.lowTicks)) * tickSize }
    },
    _moment: createMoment,
  }
  // These six embedded sources are application-owned code, never user-provided input.
  const execute = new Function('globals', `with (globals) { ${item.source}\nreturn { init, onTick }; }`) as (globals: Record<string, unknown>) => { init: () => void; onTick: (...args: unknown[]) => void }
  script = execute(globals)
  script.init()
  const descriptor: IndicatorDescriptor = { id: scriptId, name: item.name, version: 1, meta, inputs: descriptors }
  descriptorCache.set(scriptId, descriptor)
  return {
    advance(nextBars, nextDailyBars) {
      bars = nextBars
      dailyBars = nextDailyBars
      for (cursor = processed; cursor < bars.length; cursor += 1) {
        script.onTick(cursor + 1, globals._moment as never, undefined, undefined, effective)
      }
      processed = bars.length
      return { draws: [...draws.values()], plots: [...plots], onMainPanel: descriptor.meta.onMainPanel }
    },
  }
}

function runScript(scriptId: string, bars: ChartBarTicks[], inputs: Record<string, IndicatorInputValue>, tickSize: number, dailyBars: ChartBarTicks[]): IndicatorRunResult {
  if (scriptId === 'ema' || scriptId === 'rsi') {
    const descriptor: IndicatorDescriptor = {
      id: scriptId,
      name: scriptId === 'ema' ? 'Exponential Moving Average' : 'Relative Strength Index',
      version: 1,
      meta: { onMainPanel: scriptId === 'ema', format: scriptId === 'rsi' ? '0.00' : 'inherit' },
      inputs: [{ kind: 'int', key: 'period', label: 'Period', default: scriptId === 'ema' ? 20 : 14, min: 1, max: 500, step: 1 }],
    }
    descriptorCache.set(scriptId, descriptor)
    return { draws: [], plots: calculateLocalPlot(scriptId, bars, inputs.period, tickSize), onMainPanel: descriptor.meta.onMainPanel }
  }
  return createScriptRunner(scriptId, bars, inputs, tickSize, dailyBars).advance(bars, dailyBars)
}


const descriptors = (): IndicatorDescriptor[] => {
  for (const id of [...Object.keys(SOURCES), 'ema', 'rsi']) {
    if (!descriptorCache.has(id)) runScript(id, [], {}, 1, [])
  }
  return [...descriptorCache.values()].sort((a, b) => a.id.localeCompare(b.id))
}

interface RunSession {
  bars: ChartBarTicks[]
  dailyBars: ChartBarTicks[]
  runner: ScriptRunner
}

const runSessions = new Map<string, RunSession>()
const MAX_RUN_SESSIONS = 16


self.addEventListener('message', (event: MessageEvent<{ id: number; type: string; payload?: unknown }>) => {
  const { id, type, payload } = event.data
  let sessionKey: string | undefined
  try {
    let value: unknown
    if (type === 'list') {
      value = descriptors()
    } else if (type === 'run') {
      const [symbol, timeframe, scriptId, bars, inputs, tickSize, sessionTz, dailyBars, isFuture] = payload as [string, string, string, ChartBarTicks[], Record<string, IndicatorInputValue>, number, string, ChartBarTicks[], boolean]
      if (scriptId === 'ema' || scriptId === 'rsi') {
        value = runScript(scriptId, bars, inputs, tickSize, dailyBars)
      } else {
        const normalizedInputs = Object.keys(inputs).sort().map((key) => [key, inputs[key]])
        sessionKey = JSON.stringify([symbol, timeframe, scriptId, normalizedInputs, tickSize, sessionTz, isFuture, bars[0]?.time ?? 0])
        let session = runSessions.get(sessionKey)
        if (!session || !isIndicatorHistoryPrefix(session.bars, session.dailyBars, bars, dailyBars, sessionTz, isFuture)) {
          session = { bars: [], dailyBars: [], runner: createScriptRunner(scriptId, bars, inputs, tickSize, dailyBars) }
        }
        value = session.runner.advance(bars, dailyBars)
        session.bars = bars
        session.dailyBars = dailyBars
        runSessions.delete(sessionKey)
        runSessions.set(sessionKey, session)
        while (runSessions.size > MAX_RUN_SESSIONS) {
          const oldestKey = runSessions.keys().next().value as string | undefined
          if (oldestKey === undefined) break
          runSessions.delete(oldestKey)
        }
      }
    }
    self.postMessage({ id, value })
  } catch (error) {
    if (sessionKey) runSessions.delete(sessionKey)
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) })
  }
})
