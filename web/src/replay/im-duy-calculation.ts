// This Pine Script™ code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © I'm Duy
import type { ChartBarTicks, IndicatorInputValue, IndicatorRunResult, Timeframe } from '../api/types'
import { zonedDateParts } from './local-indicator-session'

import {
  aggregateBars, colorInput, draw, fontPixels, groupBars, htfLabel,
  parseSessionRange, pineTimeframe, screenText, sessionContainsMinute,
  styleColor, timeframeSeconds, val, validHigherTimeframe, withTransparency,
  zonedBarTimes,
} from './im-duy-helpers'
import type { DrawEx, PxBar, ZonedBarTime } from './im-duy-helpers'

import { HTF_DEFAULTS, KILLZONES, MACROS, MAX_DRAWS, NY, OPEN_DEFAULTS } from './im-duy-config'
interface HtfSet { tf: string; count: number; index: number }
interface HtfCandle { bars: PxBar[]; first: PxBar; last: PxBar; o: number; c: number; h: number; l: number }
interface BarRange { first: number; last: number; high: number; low: number }
interface CalculationContext {
  px: PxBar[]
  inputs: Record<string, IndicatorInputValue>
  tickSize: number
  timeframe: Timeframe
  timeframeSeconds: number
  sessionTz: string
  symbol: string
  dailyBars: ChartBarTicks[]
  last: PxBar
  draws: DrawEx[]
  emit: (drawing: DrawEx) => void
  isFuture: boolean
  calendarCache: Map<string, ZonedBarTime[]>
  htfCache: Map<string, HtfCandle[]>
}

function localTimes(context: CalculationContext, zone: string): ZonedBarTime[] {
  let times = context.calendarCache.get(zone)
  if (!times) {
    times = zonedBarTimes(context.px, zone)
    context.calendarCache.set(zone, times)
  }
  return times
}


function selectHtfSets(inputs: Record<string, IndicatorInputValue>, chartSeconds: number): HtfSet[] {
  const enabled: HtfSet[] = []
  for (let index = 0; index < HTF_DEFAULTS.length; index += 1) {
    const tf = String(val(inputs, `htf${index + 1}Timeframe`, HTF_DEFAULTS[index][0]))
    if (!val(inputs, `htf${index + 1}Show`, true) || !validHigherTimeframe(tf, chartSeconds)) continue
    const count = Math.max(1, Math.min(100, Number(val(inputs, `htf${index + 1}Count`, 10))))
    enabled.push({ tf, count, index })
  }
  const limit = Math.max(1, Math.min(6, Number(val(inputs, 'maxSets', 6))))
  return enabled.slice(0, limit)
}

function toHtfCandle(bars: PxBar[]): HtfCandle | undefined {
  const first = bars[0]
  const last = bars[bars.length - 1]
  if (!first || !last) return undefined
  return {
    bars, first, last, o: first.o, c: last.c,
    h: Math.max(...bars.map((bar) => bar.h)),
    l: Math.min(...bars.map((bar) => bar.l)),
  }
}

function htfCandles(context: CalculationContext, set: HtfSet): HtfCandle[] {
  const key = `${set.index}:${set.tf}:${set.count}`
  const cached = context.htfCache.get(key)
  if (cached) return cached
  const { px, inputs, sessionTz, isFuture } = context
  const custom = val(inputs, 'customDaily', false)
  const customAt = String(val(inputs, 'customDailyAt', 'Midnight'))
  const zone = custom && set.tf === '1D' ? NY : sessionTz
  const groups = groupBars(
    px, set.tf, zone, custom, customAt, isFuture, localTimes(context, zone),
  ).slice(-Math.max(1, Math.min(100, set.count)))
  const candles = groups.map(toHtfCandle)
    .filter((candle): candle is HtfCandle => candle !== undefined)
  context.htfCache.set(key, candles)
  return candles
}

function drawHtfCandle(
  context: CalculationContext,
  candle: HtfCandle,
  set: HtfSet,
  logical: number,
  width: number,
): void {
  const { inputs, last, emit } = context
  const bull = candle.c > candle.o
  const side = bull ? 'bull' : 'bear'
  const body = colorInput(inputs, `${side}Body`, bull
    ? { r: 0, g: 128, b: 0, a: 0.9 }
    : { r: 255, g: 0, b: 0, a: 0.9 })
  const border = colorInput(inputs, `${side}Border`, { r: 0, g: 0, b: 0, a: 0.9 })
  const wick = colorInput(inputs, `${side}Wick`, { r: 0, g: 0, b: 0, a: 0.9 })
  const center = logical + Math.floor(width / 2)
  emit(draw('rectangle', last.time, candle.o, last.time, candle.c,
    { fillColor: body, borderColor: border, borderWidth: 1 }, undefined, logical, logical + width))
  emit(draw('line', last.time, candle.h, last.time, Math.max(candle.o, candle.c),
    styleColor(wick, { lineWidth: 1 }), undefined, center, center))
  emit(draw('line', last.time, Math.min(candle.o, candle.c), last.time, candle.l,
    styleColor(wick, { lineWidth: 1 }), undefined, center, center))
  if (val(inputs, 'dailyName', false) && set.tf === '1D') {
    const local = localTimes(context, NY)[candle.first.index]
    if (!local) return
    const letters = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
    emit(draw('marker', last.time, candle.h, undefined, undefined, {
      char: letters[local.weekday],
      position: 'above',
      textColor: colorInput(inputs, 'dowColor', 'black'),
      fontSize: fontPixels(String(val(inputs, 'dowSize', 'small'))),
    }, undefined, center))
  }

}

function drawHtfLabels(
  context: CalculationContext,
  set: HtfSet,
  active: HtfSet[],
  candles: HtfCandle[],
  offset: number,
  width: number,
  gap: number,
): void {
  const { inputs, last, emit } = context

  if (!val(inputs, 'htfLabelShow', true) || candles.length === 0) return
  const position = String(val(inputs, 'labelPosition', 'Both'))
  const align = String(val(inputs, 'labelAlignment', 'Align')) === 'Align'
  const current = active.flatMap((item) =>
    htfCandles(context, item).at(-1)?.bars ?? [])

  const alignedBars = align ? current : candles
  const top = Math.max(...alignedBars.map((bar) => bar.h))
  const bottom = Math.min(...alignedBars.map((bar) => bar.l))
  const x = offset + Math.floor(candles.length * (width + gap) / 2)
  const timer = val(inputs, 'timerShow', true) ? ' (n/a)' : ''
  const label = `${htfLabel(set.tf)}${timer}`
  const style = {
    char: '',
    textColor: colorInput(inputs, 'htfLabelColor', 'black'),
    fontSize: fontPixels(String(val(inputs, 'htfLabelSize', 'large'))),
  }
  if (position !== 'Bottom') {
    emit(draw('marker', last.time, top, undefined, undefined, { ...style, position: 'above' }, label, undefined, x))
  }
  if (position !== 'Top') {
    emit(draw('marker', last.time, bottom, undefined, undefined, { ...style, position: 'below' }, label, undefined, x))
  }
}

function drawImbalances(
  context: CalculationContext,
  candles: HtfCandle[],
  offset: number,
  width: number,
  gap: number,
): void {
  const { inputs, last, emit } = context
  if (val(inputs, 'fvgShow', true)) {
    for (let index = 0; index < candles.length - 2; index += 1) {
      const older = candles[index]
      const newer = candles[index + 2]
      const left = offset + (candles.length - index - 3) * (width + gap)
      const right = offset + (candles.length - index - 1) * (width + gap) + width
      if (older.l > newer.h && Math.min(older.o, older.c) > Math.max(newer.o, newer.c)) {
        emit(draw('rectangle', last.time, newer.h, last.time, older.l,
          { fillColor: colorInput(inputs, 'fvgColor', 'rgba(128,128,128,.2)') }, undefined, left, right))
      }
      if (older.h < newer.l && Math.max(older.o, older.c) < Math.min(newer.o, newer.c)) {
        emit(draw('rectangle', last.time, older.h, last.time, newer.l,
          { fillColor: colorInput(inputs, 'fvgColor', 'rgba(128,128,128,.2)') }, undefined, right, left))
      }
    }
  }
  if (!val(inputs, 'viShow', true)) return
  for (let index = 0; index < candles.length - 1; index += 1) {
    const older = candles[index]
    const newer = candles[index + 1]
    const left = offset + (candles.length - index - 2) * (width + gap)
    const right = offset + (candles.length - index - 1) * (width + gap) + width
    if (older.l < newer.h && Math.min(older.o, older.c) > Math.max(newer.o, newer.c)) {
      emit(draw('rectangle', last.time, Math.min(older.o, older.c), last.time,
        Math.max(newer.o, newer.c),
        { fillColor: colorInput(inputs, 'viColor', 'rgba(255,0,0,.5)') }, undefined, left, right))
    }
    if (older.h > newer.l && Math.max(older.o, older.c) < Math.min(newer.o, newer.c)) {
      emit(draw('rectangle', last.time, Math.min(newer.o, newer.c), last.time,
        Math.max(older.o, older.c),
        { fillColor: colorInput(inputs, 'viColor', 'rgba(255,0,0,.5)') }, undefined, right, left))
    }
  }
}

function drawHigherTimeframes(context: CalculationContext): HtfSet[] {
  const { inputs } = context

  const active = selectHtfSets(inputs, context.timeframeSeconds)
  const width = Math.max(1, Number(val(inputs, 'width', 2)))
  const gap = Math.max(0, Number(val(inputs, 'buffer', 1)))
  let offset = Math.max(1, Number(val(inputs, 'offset', 10)))
  for (const set of active) {
    const candles = htfCandles(context, set)
    drawHtfLabels(context, set, active, candles, offset, width, gap)

    for (let index = 0; index < candles.length; index += 1) {
      const logical = offset + (candles.length - index - 1) * (width + gap)
      drawHtfCandle(context, candles[index], set, logical, width)
    }
    drawImbalances(context, candles, offset, width, gap)
    offset += candles.length * width + Math.max(0, candles.length - 1) * gap
      + Number(val(inputs, 'htfBuffer', 10))
  }
  return active
}

function drawTrace(context: CalculationContext, active: HtfSet[]): void {
  const { px, inputs, last, emit } = context
  if (!val(inputs, 'traceShow', false) || active.length === 0) return
  const setIndex = String(val(inputs, 'traceAnchor', 'First Timeframe')) === 'Last Timeframe'
    ? active.length - 1 : 0
  const customDaily = val(inputs, 'customDaily', false)
  const customAt = String(val(inputs, 'customDailyAt', 'Midnight'))
  const zone = customDaily && active[setIndex].tf === '1D' ? NY : context.sessionTz
  const bars = groupBars(
    px, active[setIndex].tf, zone, customDaily, customAt, context.isFuture,
    localTimes(context, zone),
  ).at(-1)
  if (!bars || bars.length === 0) return
  const first = bars[0]
  const current = bars[bars.length - 1]
  const values: [string, number][] = [
    ['Open', first.o], ['Close', current.c],
    ['High', Math.max(...bars.map((bar) => bar.h))],
    ['Low', Math.min(...bars.map((bar) => bar.l))],
  ]
  for (const [key, price] of values) {
    const inputPrefix = `trace${key}`
    const styleName = String(val(inputs, `${inputPrefix}Style`, '····'))
    const lineStyle = styleName === '----' ? 'dashed' : styleName === '····' ? 'dotted' : 'solid'
    const colorValue = colorInput(inputs, `${inputPrefix}Color`, 'rgba(128,128,128,.5)')
    emit(draw('line', first.time, price, last.time, price, styleColor(colorValue, {
      lineStyle, lineWidth: Number(val(inputs, `${inputPrefix}Width`, 1)),
    })))
    if (val(inputs, 'priceLabelShow', false)) {
      emit(draw('marker', last.time, price, undefined, undefined, {
        char: '',
        position: 'center',
        textColor: colorInput(inputs, 'priceLabelColor', 'black'),
        fontSize: fontPixels(String(val(inputs, 'priceLabelSize', 'normal'))),
      }, `${key} ${price}`))
    }
  }
}

function drawFractals(context: CalculationContext): void {
  const { px, inputs, emit } = context
  const swing = Math.max(3, Math.min(50, Number(val(inputs, 'swingLength', 3))))
  if (!val(inputs, 'showFractals', true) || px.length <= 2 * swing) return

  for (let confirmation = 2 * swing; confirmation < px.length; confirmation += 1) {
    const pivot = confirmation - swing
    let isHigh = true
    let isLow = true
    for (let distance = 1; distance <= swing; distance += 1) {
      isHigh = isHigh && px[pivot].h > px[pivot - distance].h
        && px[pivot].h > px[pivot + distance].h
      isLow = isLow && px[pivot].l < px[pivot - distance].l
        && px[pivot].l < px[pivot + distance].l
    }
    if (isHigh) emit(draw('marker', px[pivot].time, px[pivot].h, undefined, undefined, {
      char: String(val(inputs, 'swingHighChar', '⮝')),
      position: 'above', textColor: colorInput(inputs, 'swingHighColor', 'red'),
    }))
    if (isLow) emit(draw('marker', px[pivot].time, px[pivot].l, undefined, undefined, {
      char: String(val(inputs, 'swingLowChar', '⮟')),
      position: 'below', textColor: colorInput(inputs, 'swingLowColor', 'green'),
    }))
  }
}

function drawDayMarkers(context: CalculationContext): void {
  const { px, inputs, emit, sessionTz } = context
  const showSeparator = val(inputs, 'showSeparator', true)
  const showDays = val(inputs, 'showDividerAndDow', true)
  if (!showSeparator && !showDays) return
  const newYorkTimes = localTimes(context, NY)
  const exchangeTimes = localTimes(context, sessionTz)

  for (let index = 1; index < px.length; index += 1) {
    const currentNy = newYorkTimes[index]
    const previousNy = newYorkTimes[index - 1]
    const exchangeTime = exchangeTimes[index]
    if (!currentNy || !previousNy || !exchangeTime) continue
    const newNyDay = currentNy.day !== previousNy.day
    if (newNyDay && showSeparator && currentNy.hour === 0) {
      emit(draw('vline', px[index].time, px[index].l, undefined, undefined, styleColor(
        colorInput(inputs, 'lineColor', 'black'),
        { lineStyle: String(val(inputs, 'lineStyle', 'Dotted')).toLowerCase(),
          lineWidth: Number(val(inputs, 'lineWidth', 1)) },
      )))
    }

    if (!showDays || exchangeTime.hour !== 12 || exchangeTime.minute !== 0) continue
    const name = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', '', ''][exchangeTime.weekday]
    if (!name) continue
    emit(screenText(
      px[index],
      name,
      String(val(inputs, 'dowLocation', 'Bottom')).toLowerCase(),
      'center',
      fontPixels(String(val(inputs, 'dowSize', 'small'))),
      colorInput(inputs, 'dividerColor', 'black'),
      'center',
    ))
  }
}

function collectRanges(
  context: CalculationContext,
  session: string,
  zone: string,
  splitAtMidnight: boolean,
): BarRange[] {
  const parsed = parseSessionRange(session)
  if (!parsed) return []
  const ranges: BarRange[] = []
  const { px } = context
  const times = localTimes(context, zone)
  let active: BarRange | undefined
  let activeDay = ''
  for (let index = 0; index < px.length; index += 1) {
    const local = times[index]
    if (!local) continue
    const inside = sessionContainsMinute(local.minuteOfDay, parsed)
    if (inside && (!active || (splitAtMidnight && local.day !== activeDay))) {
      if (active) ranges.push(active)
      active = { first: index, last: index, high: px[index].h, low: px[index].l }
      activeDay = local.day
    } else if (inside && active) {
      active.last = index
      active.high = Math.max(active.high, px[index].h)
      active.low = Math.min(active.low, px[index].l)
    } else if (!inside && active) {
      ranges.push(active)
      active = undefined
    }
  }
  if (active) ranges.push(active)
  return ranges
}




function drawMacros(context: CalculationContext): void {
  const { px, inputs, tickSize } = context
  const tfSec = context.timeframeSeconds
  if (!val(inputs, 'showMacro', true) || tfSec > 300) return
  const lookback = Math.max(1, Math.round(900 / tfSec))
  const macroTop = Math.max(...px.slice(-lookback).map((bar) => bar.h)) + tickSize * 15
  for (let macroIndex = 0; macroIndex < MACROS.length; macroIndex += 1) {
    if (!val(inputs, `macro${macroIndex + 1}`, false)) continue
    const [name, start, end] = MACROS[macroIndex]
    const ranges = collectMacroRanges(context, start, end)
    for (const range of ranges) {
      drawMacroRange(context, range, name, macroTop)
    }
  }
}

function collectMacroRanges(context: CalculationContext, start: number, end: number): BarRange[] {
  const { px } = context
  const times = localTimes(context, NY)
  const ranges: BarRange[] = []
  let active: BarRange & { day: string } | undefined
  for (let index = 0; index < px.length; index += 1) {
    const local = times[index]
    if (!local) continue
    const inside = local.minuteOfDay >= start && local.minuteOfDay < end
    if (inside) {
      if (!active || active.day !== local.day) {
        active = { first: index, last: index, high: px[index].h, low: px[index].l, day: local.day }
        ranges.push(active)
      } else {
        active.last = index
        active.high = Math.max(active.high, px[index].h)
      }
    } else {
      active = undefined
    }
  }
  return ranges
}

function drawMacroRange(
  context: CalculationContext,
  range: BarRange,
  name: string,
  top: number,
): void {
  const { px, inputs, emit } = context
  const colorValue = colorInput(inputs, 'macroColor', 'black')
  const first = px[range.first]
  const last = px[range.last]
  emit(draw('vline', first.time, first.l, undefined, undefined, styleColor(colorValue)))
  if (range.first > 0) emit(draw('line', px[range.first - 1].time, top, first.time, top,
    styleColor(colorValue)))
  if (val(inputs, 'macroProjections', false)) {
    emit(draw('line', first.time, first.h, first.time, top,
      styleColor(colorValue, { lineStyle: 'dotted' })))
  }
  if (val(inputs, 'macroLabel', true)) {
    const label = val(inputs, 'macroTime', false) ? `MACRO\n${name}` : 'MACRO'
    emit(draw('marker', first.time, range.high, undefined, undefined, {
      char: 'M', position: 'above', textColor: colorValue,
    }, label))
  }
  const next = px[range.last + 1]
  if (!next) return
  emit(draw('vline', next.time, next.l, undefined, undefined, styleColor(colorValue)))
  emit(draw('line', last.time, top, next.time, top, styleColor(colorValue)))
  if (val(inputs, 'macroProjections', false)) {
    emit(draw('line', next.time, next.h, next.time, top,
      styleColor(colorValue, { lineStyle: 'dotted' })))
  }
}

function drawKillzones(context: CalculationContext): void {
  const { inputs, timeframeSeconds: tfSec } = context

  const maxDays = Math.max(1, Math.min(30, Number(val(inputs, 'maxDays', 1))))
  const limit = timeframeSeconds(String(val(inputs, 'tfLimit', '15')))
  if (!val(inputs, 'showKillzone', true) || tfSec > limit) return
  for (let index = 0; index < KILLZONES.length; index += 1) {
    if (!val(inputs, `kz${index + 1}Show`, KILLZONES[index][2])) continue
    const session = String(val(inputs, `kz${index + 1}Session`, KILLZONES[index][1]))
    const ranges = collectRanges(context, session, NY, true).slice(-maxDays)

    for (const range of ranges) drawKillzoneRange(context, range, index)
  }
}

function drawKillzoneRange(context: CalculationContext, range: BarRange, index: number): void {
  const { px, inputs, emit } = context
  if (!val(inputs, 'showKzBoxes', true)) return
  const colorValue = colorInput(inputs, `kz${index + 1}Color`, 'black')
  const opacity = 1 - Number(val(inputs, 'boxTransparency', 90)) / 100
  const label = val(inputs, 'showKzText', false)
    ? String(val(inputs, `kz${index + 1}Text`, KILLZONES[index][0])) : undefined
  emit(draw('rectangle', px[range.first].time, range.high, px[range.last].time, range.low, {
    fillColor: withTransparency(colorValue, opacity),
    borderColor: withTransparency(colorValue, opacity),
    borderWidth: 1,
  }, label))
}

function drawOpenPrices(context: CalculationContext): void {
  const { px, inputs, timeframeSeconds: tfSec } = context
  if (!val(inputs, 'showOpenPrice', true) || tfSec > 300) return
  const times = localTimes(context, NY)
  for (let level = 0; level < OPEN_DEFAULTS.length; level += 1) {
    if (!val(inputs, `open${level + 1}Show`, OPEN_DEFAULTS[level][2])) continue
    const sessionText = String(val(inputs, `open${level + 1}Session`, OPEN_DEFAULTS[level][1]))
    const session = parseSessionRange(sessionText)
    if (!session) continue
    for (let index = 0; index < px.length; index += 1) {
      const current = times[index]
      const previous = index > 0 ? times[index - 1] : undefined
      if (!current || !sessionContainsMinute(current.minuteOfDay, session)) continue
      if (previous && sessionContainsMinute(previous.minuteOfDay, session)) continue
      drawOpenPrice(context, level, index)
    }
  }
}

function drawOpenPrice(context: CalculationContext, level: number, index: number): void {
  const { px, inputs, emit } = context
  const bar = px[index]
  const colorValue = colorInput(inputs, `open${level + 1}Color`, 'black')
  const label = String(val(inputs, `open${level + 1}Text`, OPEN_DEFAULTS[level][0]))
  const style = String(val(inputs, 'openStyle', 'Dotted')).toLowerCase()
  const width = Number(val(inputs, 'openWidth', 1))
  emit(draw('ray', bar.time, bar.o, undefined, undefined, styleColor(colorValue, {
    lineStyle: style,
    lineWidth: width,
    labelPosition: 'right',
    textAlign: 'right',
    textColor: colorInput(inputs, 'openTextColor', 'black'),
    fontSize: fontPixels(String(val(inputs, 'openLabelSize', 'normal'))),
  }), label))
}


function drawIpda(context: CalculationContext): void {
  const { px, inputs, dailyBars, tickSize, sessionTz, last } = context
  const type = String(val(inputs, 'ipdaType', 'CLASSIC'))
  const daily = dailyBars.length
    ? dailyBars.filter((bar) => bar.time <= last.time).map((bar, index) => ({
      time: bar.time,
      o: bar.openTicks * tickSize,
      h: bar.highTicks * tickSize,
      l: bar.lowTicks * tickSize,
      c: bar.closeTicks * tickSize,
      index,
    }))
    : aggregateBars(px, '1D', sessionTz, context.isFuture, localTimes(context, sessionTz))

  const source = type === 'LTF' ? px : daily
  const plot = String(val(inputs, 'plotType', 'Boxes'))
  const levels = calculateIpdaLevels(source, last.c)
  drawIpdaBoxes(context, levels, type, plot, context.timeframe)
  drawIpdaAlerts(context, levels)
  drawIpdaTables(context, levels, plot)
}

interface IpdaLevel {
  period: number
  high: number
  low: number
  equilibrium: number
  start: number
  discount: boolean
  percent: number
}

function calculateIpdaLevels(source: PxBar[], close: number): IpdaLevel[] {
  const levels: IpdaLevel[] = []
  for (const period of [20, 40, 60]) {
    if (source.length <= period) continue
    const window = source.slice(-period - 1, -1)
    const high = Math.max(...window.map((bar) => bar.h))
    const low = Math.min(...window.map((bar) => bar.l))
    const equilibrium = (high + low) / 2
    const percent = high === low ? 0 : Math.round(((close - low) / (high - low)) * 1000) / 10
    levels.push({
      period, high, low, equilibrium, start: window[0].time,
      discount: close < equilibrium, percent,
    })
  }
  return levels
}

function drawIpdaBoxes(
  context: CalculationContext,
  levels: IpdaLevel[],
  type: string,
  plot: string,
  timeframe: Timeframe,
): void {
  const { inputs, px, last, emit } = context
  const boxesAllowed = type !== 'CLASSIC' || timeframe === '1d'
  if (plot !== 'Boxes' || !boxesAllowed) return
  const end = px.at(-2)?.time ?? last.time
  for (const level of levels) {
    if (!val(inputs, `ipda${level.period}Show`, true)) continue
    emit(draw('rectangle', level.start, level.high, end, level.equilibrium, {
      fillColor: colorInput(inputs, 'premiumColor', 'navy'),
    }))
    emit(draw('line', level.start, level.equilibrium, end, level.equilibrium,
      styleColor(colorInput(inputs, 'equilibriumColor', 'black'))))
    const label = val(inputs, 'showIpdaText', true) ? `IPDA${level.period}` : undefined
    emit(draw('rectangle', level.start, level.equilibrium, end, level.low, {
      fillColor: colorInput(inputs, 'discountColor', 'maroon'),
    }, label))
  }
}

function drawIpdaAlerts(context: CalculationContext, levels: IpdaLevel[]): void {
  const { px, inputs, last, emit } = context
  if (!val(inputs, 'alerts', false) || px.length < 2) return
  const previous = px[px.length - 2]
  const names = ['High', 'Equilibrium up', 'Equilibrium down', 'Low']
  for (const level of levels) {
    if (!val(inputs, `ipda${level.period}Show`, true)) continue
    const crosses = [
      previous.h < level.high && last.h > level.high,
      previous.h < level.equilibrium && last.h > level.equilibrium,
      previous.l > level.equilibrium && last.l < level.equilibrium,
      previous.l > level.low && last.l < level.low,
    ]
    for (const [index, crossed] of crosses.entries()) {
      if (!crossed) continue
      emit(draw('marker', last.time, last.c, undefined, undefined, {
        char: '!',
        position: 'above',
        textColor: colorInput(inputs, 'equilibriumColor', 'black'),
      }, `IPDA${level.period} ${names[index]} crossed`))
    }
  }
}

function drawIpdaTables(context: CalculationContext, levels: IpdaLevel[], plot: string): void {
  const { last, emit } = context
  if (plot !== 'Table A' && plot !== 'Table B') return
  const ordered = levels.slice().sort((left, right) => right.period - left.period)
  for (const [index, level] of ordered.entries()) {
    const value = plot === 'Table A' ? level.discount ? 'Discount' : 'Premium'
      : `${level.percent.toFixed(1)}%`
    const colorValue = level.discount ? '#800000' : '#000080'
    const y = index * 30
    emit(screenText(last, `IPDA${level.period}`, 'top', 'right', 12, '#202124',
      'left', '#d1d4dc', -180, y, 88))
    emit(screenText(last, value, 'top', 'right', 12, colorValue,
      'left', '#d1d4dc', -86, y, 88))
  }
}

function drawWatermark(context: CalculationContext): void {
  const { inputs, last, sessionTz, timeframe, symbol, emit } = context
  if (!val(inputs, 'watermarkShow', true)) return
  const vertical = String(val(inputs, 'watermarkTextVertical', 'top'))
  const horizontal = String(val(inputs, 'watermarkTextHorizontal', 'center'))
  const titleSize = fontPixels(String(val(inputs, 'watermarkTitleSize', 'large')))
  const subtitleSize = fontPixels(String(val(inputs, 'watermarkSubtitleSize', 'normal')))
  const subtitleOffset = vertical === 'bottom' ? -subtitleSize * 1.4
    : vertical === 'middle' ? titleSize * 0.7 : titleSize * 1.4
  const background = colorInput(inputs, 'watermarkBackground', 'rgba(255,255,255,0)')
  drawWatermarkText(context, 'watermarkTitle', 'TEXT', vertical, horizontal,
    titleSize, 0, background)
  drawWatermarkText(context, 'watermarkSubtitle', 'PATIENCE  |  DISCIPLINE  |  FEARLESS',
    vertical, horizontal, subtitleSize, subtitleOffset, background)
  const parts = zonedDateParts(last.time, sessionTz)
  const date = `${parts[2]}/${parts[1]}/${parts[0]}`
  const symbolInfo = `${symbol || 'Unknown'} | ${pineTimeframe(String(timeframe))}`
  const symbolVertical = String(val(inputs, 'watermarkSymbolVertical', 'bottom'))
  const symbolHorizontal = String(val(inputs, 'watermarkSymbolHorizontal', 'center'))
  const align = String(val(inputs, 'watermarkSymbolAlign', 'center'))
  const dateOffset = symbolVertical === 'top' ? 0 : symbolVertical === 'bottom' ? -18 : -9
  const symbolOffset = symbolVertical === 'top' ? 18 : symbolVertical === 'bottom' ? 0 : 9
  const colorValue = colorInput(inputs, 'watermarkSymbolColor', 'black')
  const size = fontPixels(String(val(inputs, 'watermarkSymbolSize', 'normal')))
  emit(screenText(last, date, symbolVertical, symbolHorizontal, size, colorValue,
    align, background, 0, dateOffset))
  emit(screenText(last, symbolInfo, symbolVertical, symbolHorizontal, size, colorValue,
    align, background, 0, symbolOffset))
}

function drawWatermarkText(
  context: CalculationContext,
  key: 'watermarkTitle' | 'watermarkSubtitle',
  fallback: string,
  vertical: string,
  horizontal: string,
  size: number,
  offset: number,
  background: string,
): void {
  const { inputs, last, emit } = context
  const colorKey = key === 'watermarkTitle' ? 'watermarkTitleColor' : 'watermarkSubtitleColor'
  const alignKey = key === 'watermarkTitle' ? 'watermarkTitleAlign' : 'watermarkSubtitleAlign'
  emit(screenText(last, String(val(inputs, key, fallback)), vertical, horizontal, size,
    colorInput(inputs, colorKey, 'black'), String(val(inputs, alignKey, 'center')),
    background, 0, offset))
}
function createCalculationContext(
  bars: ChartBarTicks[],
  inputs: Record<string, IndicatorInputValue>,
  tickSize: number,
  timeframe: Timeframe,
  sessionTz: string,
  dailyBars: ChartBarTicks[],
  symbol: string,
  isFuture: boolean,
): CalculationContext | undefined {
  if (bars.length === 0) return undefined
  const px = bars.map((bar, index) => ({
    time: bar.time,
    o: bar.openTicks * tickSize,
    h: bar.highTicks * tickSize,
    l: bar.lowTicks * tickSize,
    c: bar.closeTicks * tickSize,
    index,
  }))
  const last = px[px.length - 1]
  if (!last) return undefined

  const draws: DrawEx[] = []
  let drawId = 0
  const emit = (drawing: DrawEx): void => {
    if (draws.length >= MAX_DRAWS) draws.shift()
    draws.push({ ...drawing, id: ++drawId })
  }
  return {
    px, inputs, tickSize, timeframe,
    timeframeSeconds: timeframeSeconds(timeframe),
    sessionTz, symbol, dailyBars, last, draws, emit, isFuture,
    calendarCache: new Map(),
    htfCache: new Map(),
  }
}

export function calculateImDuy(
  bars: ChartBarTicks[],
  inputs: Record<string, IndicatorInputValue>,
  tickSize: number,
  timeframe: Timeframe,
  sessionTz: string,
  isFuture = false,
  dailyBars: ChartBarTicks[] = [],
  symbol = '',
): IndicatorRunResult {
  const context = createCalculationContext(
    bars, inputs, tickSize, timeframe, sessionTz, dailyBars, symbol, isFuture,
  )
  if (!context) return { draws: [], plots: [], onMainPanel: true }

  const activeHtf = drawHigherTimeframes(context)
  drawTrace(context, activeHtf)
  drawFractals(context)
  drawDayMarkers(context)
  drawMacros(context)
  drawKillzones(context)
  drawOpenPrices(context)
  drawIpda(context)
  drawWatermark(context)
  return { draws: context.draws, plots: [], onMainPanel: true }
}
