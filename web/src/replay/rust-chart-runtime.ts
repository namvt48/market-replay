import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  defaultHorzScaleBehavior,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type MouseEventParams,
  type SeriesAttachedParameter,
  type SeriesType,
  type Time,
} from 'lightweight-charts'
import type { DisplayBar } from './chart-adapter'
import { DEFAULT_CHART_APPEARANCE, type ChartAppearanceSettings } from './chart-settings'
import { DEFAULT_CHART_TIMEZONE, type ChartTimezone } from './chart-timezone'
import { RustChartEngine } from './rust-chart-engine'
import { measureRustChartLayout, paintRustChart, type RustChartIndicatorPaneSize, type RustChartLayout } from './rust-chart-painter'
import type { RustIndicatorSeries } from './rust-chart-indicator-painter'
import { RustIndicatorPaneScales } from './rust-chart-runtime-indicator-scales'
import { createRustRuntimePainter } from './rust-chart-runtime-painter'
import { isSpacer, normalizedBar, barMatches, volumeAt } from './rust-chart-runtime-bars'
import { RuntimeSeries, type RuntimeSeriesHost } from './rust-chart-runtime-series'
import { createRustRuntimeTimeScale } from './rust-chart-runtime-time-scale'
import { createRustRuntimePriceScale } from './rust-chart-runtime-price-scale'
import {
  asTime,
  numberOption,
  stamp,
  toLogicalRange,
  type Handler,
  type NumericLogicalRange,
  type RuntimeDatum,
  type RuntimePriceLine,
  type RuntimePrimitive,
  type RuntimeSeriesOptions,
  type SeriesKind,
} from './rust-chart-runtime-types'


/** Canvas-backed compatibility host for the Replay subset of Lightweight Charts. */
export async function createRustChart(element: HTMLElement, initialOptions: Record<string, unknown>): Promise<IChartApi> {
  const engine = await RustChartEngine.create()
  const horzScaleBehavior = new (defaultHorzScaleBehavior())()
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y'
  element.appendChild(canvas)
  const contextResult = canvas.getContext('2d')
  if (!contextResult) {
    canvas.remove()
    engine.destroy()
    throw new Error('Canvas 2D is unavailable')
  }
  const context: CanvasRenderingContext2D = contextResult
  let disposed = false
  let raf = 0
  let appearance: ChartAppearanceSettings = { ...DEFAULT_CHART_APPEARANCE }
  let timezone: ChartTimezone = DEFAULT_CHART_TIMEZONE
  let secondsVisible = true
  let options = initialOptions
  let seriesId = 0
  let crosshair: { x: number; y: number } | null = null
  let dragging: { pointerId: number; x: number; y: number; mode: 'pan' | 'price' | 'indicator-price' | 'touch'; paneIndex?: number } | null = null
  let pinchDistance = 0
  const activePointers = new Map<number, { x: number; y: number; type: string }>()
  let manualPriceRange: { min: number; max: number } | null = null
  let manualVisibleRange: NumericLogicalRange | null = null
  const series = new Set<RuntimeSeries>()
  const primitives = new Set<{ primitive: RuntimePrimitive; series: RuntimeSeries }>()
  const crosshairHandlers = new Set<Handler<MouseEventParams<Time>>>()
  const clickHandlers = new Set<Handler<MouseEventParams<Time>>>()
  const logicalHandlers = new Set<Handler<LogicalRange | null>>()
  const timeHandlers = new Set<Handler<{ from: Time; to: Time } | null>>()
  const dataHandlers = new Map<RuntimeSeries, Set<Handler<'full' | 'update'>>>()
  const priceLines = new Set<RuntimePriceLine>()
  const panes = new Map<number, { height: number; stretchFactor: number }>()
  let priceScaleOptions: Record<string, unknown> = {
    autoScale: true, invertScale: false, mode: 0,
    ...((initialOptions.rightPriceScale ?? {}) as Record<string, unknown>),
  }
  let rangeRevision = 0
  let effectiveRangeSignature = ''
  let engineDirty = false
  let engineBars: DisplayBar[] = []
  let engineSource: RuntimeSeries | null = null
  let spacerSignature = ''
  let dataNotificationDepth = 0
  const indicatorScales = new RustIndicatorPaneScales({
    engineTimeToX: (timestamp) => engine.timeToX(timestamp),
    flushEngine,
    getIndicatorPaneSeries: secondaryIndicatorSeries,
    getLayout: getChartLayout,
    getUsedPaneIndices: () => [...series]
      .filter((item) => item.kind === 'line' && item.paneIndex > 0 && !isSpacer(item))
      .map((item) => item.paneIndex),
    schedule,
  })

  function sizeCanvas(width = element.clientWidth, height = element.clientHeight): void {
    flushEngine()
    if (!(width > 0 && height > 0)) return
    const dpr = window.devicePixelRatio || 1
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const bitmapWidth = Math.max(1, Math.round(width * dpr))
    const bitmapHeight = Math.max(1, Math.round(height * dpr))
    if (canvas.width !== bitmapWidth || canvas.height !== bitmapHeight) {
      canvas.width = bitmapWidth
      canvas.height = bitmapHeight
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0)
    const layout = measureRustChartLayout(canvas, appearance.showVolume, getVolumeHeight(), getIndicatorPaneSizes())
    if (layout) {
      engine.resize(layout.plotWidth, layout.priceHeight)
      engine.setVolumeHeight(layout.volumeHeight)
      rangeRevision += 1
      effectiveRangeSignature = ''
      emitRanges()
    }
    schedule()
  }

  function emitRanges(): void {
    applyEffectivePriceRange()
    const range = engine.visibleRange()
    if (!range) return
    const width = getChartLayout()?.plotWidth ?? 0
    const span = range.to - range.from
    if (width > 0 && span > 0) {
      options = { ...options, timeScale: { ...(options.timeScale as object), barSpacing: width / span } }
    }
    const logicalRange = toLogicalRange(range)
    if (logicalRange) for (const handler of logicalHandlers) handler(logicalRange)
    const from = engine.logicalToTime(range.from)
    const to = engine.logicalToTime(range.to)
    const timeRange = from != null && to != null ? { from: asTime(from), to: asTime(to) } : null
    for (const handler of timeHandlers) handler(timeRange)
  }
  function schedule(): void {
    if (disposed || raf) return
    raf = requestAnimationFrame(() => { raf = 0; flushEngine(); render() })
  }
  function markEngineDirty(): void { engineDirty = true; schedule() }
  function flushEngine(): void {
    if (!engineDirty || !engine || disposed) return
    engineDirty = false
    rebuildEngine()
  }

  const runtimePainter = createRustRuntimePainter({
    canvas,
    context,
    engine,
    getEngineSource: () => engineSource,
    getChartType: () => appearance.chartType,
    series,
    primitives,
    priceLines,
    getAppearance: () => appearance,
    getOptions: () => ({
      crosshair: options.crosshair === false ? false : undefined,
      localization: options.localization as { priceFormatter?: (price: number) => string } | undefined,
    }),
    getCrosshair: () => crosshair,
    getLayout: getChartLayout,
    getIndicatorPaneSizes,
    getSecondaryIndicatorSeries: secondaryIndicatorSeries,
    getIndicatorManualRanges: () => indicatorScales.manualRangesView(),
    getIndicatorScaleOptions: (paneIndex) => indicatorScales.options(paneIndex),
    getIndicatorScale: (paneIndex) => indicatorScales.scale(paneIndex),
    isSpacer,
    numberOption,
    stamp,
  })

  function render(): void {
    flushEngine()
    if (!engine || disposed) return
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width <= 0 || height <= 0) return
    const geometry = engine.renderGeometry()
    const priceFormat = [...series].find((item) => item.kind !== 'histogram' && item.kind !== 'spacer')?.opts.priceFormat as { precision?: number } | undefined
    const indicatorPaneSizes = getIndicatorPaneSizes()
    paintRustChart({ context, canvas, geometry, engine, appearance,
      symbol: { priceDecimals: numberOption(priceFormat?.precision, 2) }, timezone, secondsVisible,
      volumeHeight: getVolumeHeight(), indicatorPaneSizes })
    runtimePainter.drawIndicatorSeries()
    runtimePainter.drawSecondaryIndicatorSeries(indicatorPaneSizes)
    runtimePainter.drawPriceLines()
    runtimePainter.drawSeriesMarkers()
    runtimePainter.drawPrimitives()
    runtimePainter.drawCrosshair()
  }

  function getVolumeHeight(): number {
    const pane = panes.get(1)
    return pane?.height ?? 120
  }
  function getIndicatorPaneSizes(): RustChartIndicatorPaneSize[] {
    const volumeVisible = [...series].some((item) => item.kind === 'histogram' && item.opts.visible !== false)
    const firstIndicatorPane = volumeVisible ? 2 : 1
    const paneSizes = new Map<number, number>()
    for (const item of series) {
      if (item.kind !== 'line' || item.paneIndex < firstIndicatorPane || isSpacer(item)) continue
      const pane = panes.get(item.paneIndex)
      paneSizes.set(item.paneIndex, pane ? pane.height * pane.stretchFactor : 120)
    }
    return [...paneSizes].map(([index, height]) => ({ index, height })).sort((left, right) => left.index - right.index)
  }
  function getChartLayout() {
    return measureRustChartLayout(canvas, appearance.showVolume, getVolumeHeight(), getIndicatorPaneSizes())
  }
  function secondaryIndicatorSeries(): RustIndicatorSeries[] {
    return [...series]
      .filter((item) => item.kind === 'line' && item.paneIndex > 0 && item.opts.visible !== false && !isSpacer(item))
      .map((item) => ({
        paneIndex: item.paneIndex,
        color: String(item.opts.color ?? '#2962ff'),
        lineWidth: numberOption(item.opts.lineWidth, 1),
        data: item.values,
      }))
  }


  function notifyData(seriesItem: RuntimeSeries, scope: 'full' | 'update'): void {
    dataNotificationDepth += 1
    try {
      for (const handler of dataHandlers.get(seriesItem) ?? []) handler(scope)
    } finally {
      dataNotificationDepth -= 1
    }
  }

  function rebuildEngine(): void {
    rangeRevision += 1
    const main = [...series].filter((item) => (item.kind === 'candle' || item.kind === 'line') && !isSpacer(item))
    const active = main.find((item) => item.opts.visible !== false && item.values.length > 0)
      ?? main.find((item) => item.opts.visible !== false)
    const histogram = [...series].find((item) => item.kind === 'histogram' && item.opts.visible !== false)
    appearance = { ...appearance, showVolume: histogram !== undefined }
    if (active) {
      let cursor = { index: 0 }
      let shared = 0
      if (active === engineSource) {
        const sharedLimit = Math.min(engineBars.length, active.values.length)
        while (shared < sharedLimit) {
          const datum = active.values[shared]
          const volume = volumeAt(stamp(datum.time), histogram, cursor)
          if (!barMatches(datum, volume, engineBars[shared])) break
          shared += 1
        }
      }
      const fullReplace = active !== engineSource || (shared === 0 && engineBars.length > 0)
      const suffix: DisplayBar[] = []
      for (let index = fullReplace ? 0 : shared; index < active.values.length; index += 1) {
        const datum = active.values[index]
        const bar = normalizedBar(datum, volumeAt(stamp(datum.time), histogram, cursor))
        if (bar) suffix.push(bar)
      }
      if (fullReplace) {
        engine.setHistory(suffix)
        engineBars = suffix
      } else {
        const oldLength = engineBars.length
        const nextLength = shared + suffix.length
        if (shared < oldLength && (suffix.length > 0 || nextLength < oldLength)) {
          if (shared === 0) engine.setHistory([])
          else engine.truncateTo(engineBars[shared - 1].time)
        }
        if (suffix.length > 0) engine.pushBars(suffix)
        engineBars.splice(shared, engineBars.length - shared, ...suffix)
      }
      engineSource = active
      const chartType = active.kind === 'line' ? 'line' : 'candles'
      engine.setChartType(chartType)
      appearance = { ...appearance, chartType,
        ...(typeof active.opts.color === 'string' ? { lineColor: active.opts.color } : {}),
        ...(typeof active.opts.upColor === 'string' ? { upColor: active.opts.upColor } : {}),
        ...(typeof active.opts.downColor === 'string' ? { downColor: active.opts.downColor } : {}),
        ...(typeof active.opts.wickUpColor === 'string' ? { wickUpColor: active.opts.wickUpColor } : {}),
        ...(typeof active.opts.wickDownColor === 'string' ? { wickDownColor: active.opts.wickDownColor } : {}) }
    } else if (engineBars.length > 0 || engineSource) {
      engine.setHistory([])
      engineBars = []
      engineSource = null
    }
    const spacerItems = [...series].filter(isSpacer)
    const nextSpacerSignature = spacerItems.map((item) => `${item.id}:${item.version}`).join(',')
    if (nextSpacerSignature !== spacerSignature) {
      const spacerTimes = spacerItems.flatMap((item) => item.values.map((datum) => stamp(datum.time))).sort((a, b) => a - b)
      engine.setSpacerTimes(spacerTimes)
      spacerSignature = nextSpacerSignature
    }
    if (manualVisibleRange) engine.setVisibleRange(manualVisibleRange.from, manualVisibleRange.to)
    applyEffectivePriceRange()
    emitRanges()
  }

  function applyEffectivePriceRange(): void {
    if (!engine) return
    const visible = engine.visibleRange()
    const signature = `${rangeRevision}|${visible?.from ?? ''}|${visible?.to ?? ''}|${manualPriceRange?.min ?? ''}|${manualPriceRange?.max ?? ''}|${priceScaleOptions.autoScale}`
    if (signature === effectiveRangeSignature) return
    if (priceScaleOptions.autoScale !== true) {
      if (manualPriceRange) {
        const current = engine.priceRange()
        if (current.min !== manualPriceRange.min || current.max !== manualPriceRange.max) engine.setPriceRange(manualPriceRange)
      }
      effectiveRangeSignature = signature
      return
    }
    engine.setPriceRange(null)
    const base = engine.priceRange()
    let min = base.min
    let max = base.max
    let above = 0
    let below = 0
    if (visible) {
      for (const { primitive, series: seriesItem } of primitives) {
        if (seriesItem.opts.visible === false) continue
        const info = primitive.autoscaleInfo?.(visible.from, visible.to)
        if (!info?.priceRange) continue
        const lower = info.priceRange.minValue
        const upper = info.priceRange.maxValue
        if (Number.isFinite(lower)) min = Math.min(min, lower)
        if (Number.isFinite(upper)) max = Math.max(max, upper)
        above = Math.max(above, info.margins?.above ?? 0)
        below = Math.max(below, info.margins?.below ?? 0)
      }
    }
    const height = getChartLayout()?.priceHeight ?? 0
    const inverted = priceScaleOptions.invertScale === true
    const transformedMin = engine.priceToScaleCoordinate(min)
    const transformedMax = engine.priceToScaleCoordinate(max)
    const transformedBaseMin = engine.priceToScaleCoordinate(base.min)
    const transformedBaseMax = engine.priceToScaleCoordinate(base.max)
    if (
      transformedMin !== null &&
      transformedMax !== null &&
      transformedBaseMin !== null &&
      transformedBaseMax !== null
    ) {
      const low = Math.min(transformedMin, transformedMax, transformedBaseMin, transformedBaseMax)
      const high = Math.max(transformedMin, transformedMax, transformedBaseMin, transformedBaseMax)
      const plotFraction = 1 - 0.08 - 0.06
      const plotPixels = height * plotFraction
      const highPadding = inverted ? below : above
      const lowPadding = inverted ? above : below
      if (plotPixels > 0 && high > low && highPadding + lowPadding > 0) {
        const maxPaddingFraction = 0.45
        const topFraction = Math.min(maxPaddingFraction, highPadding / plotPixels)
        const bottomFraction = Math.min(maxPaddingFraction, lowPadding / plotPixels)
        const paddingTotal = Math.min(0.9, topFraction + bottomFraction)
        const ratio = paddingTotal < topFraction + bottomFraction
          ? paddingTotal / (topFraction + bottomFraction) : 1
        const top = topFraction * ratio
        const bottom = bottomFraction * ratio
        const span = (high - low) / (1 - top - bottom)
        const adjustedLow = low - span * bottom
        const adjustedHigh = high + span * top
        const rawLow = engine.scaleCoordinateToPrice(adjustedLow)
        const rawHigh = engine.scaleCoordinateToPrice(adjustedHigh)
        if (rawLow !== null && rawHigh !== null) {
          min = Math.min(rawLow, rawHigh)
          max = Math.max(rawLow, rawHigh)
        }
      }
    }
    if (Number.isFinite(min) && Number.isFinite(max) && max > min &&
      (base.min !== min || base.max !== max)) engine.setPriceRange({ min, max })
    effectiveRangeSignature = signature
  }


  const timeScale = createRustRuntimeTimeScale({
    engine,
    logicalHandlers,
    timeHandlers,
    getChartLayout,
    getOptions: () => options,
    updateTimeScaleOptions: (next) => {
      options = { ...options, timeScale: { ...(options.timeScale as object), ...next } }
    },
    setSecondsVisible: (value) => { secondsVisible = value },
    series: () => series,
    getManualVisibleRange: () => manualVisibleRange,
    setManualVisibleRange: (range) => { manualVisibleRange = range },
    isFollowingRange,
    flushEngine,
    schedule,
    emitRanges,
  })

  const priceScaleApi = createRustRuntimePriceScale({
    engine,
    getChartLayout,
    getOptions: () => priceScaleOptions,
    setOptions: (next) => { priceScaleOptions = next },
    getManualRange: () => manualPriceRange,
    setManualRange: (range) => { manualPriceRange = range },
    invalidateEffectiveRange: () => { rangeRevision += 1; effectiveRangeSignature = '' },
    applyEffectivePriceRange,
    schedule,
  })


  function attachedParams(seriesItem: RuntimeSeries): SeriesAttachedParameter<Time, SeriesType> {
    return { chart: chart as unknown as IChartApi,
      series: seriesItem as unknown as ISeriesApi<SeriesType, Time>,
      requestUpdate: () => {
        if (dataNotificationDepth > 0) {
          schedule()
          return
        }
        flushEngine()
        rangeRevision += 1
        effectiveRangeSignature = ''
        applyEffectivePriceRange()
        schedule()
      },
      horzScaleBehavior }
  }

  function paneApi(index: number) {
    return {
      paneIndex: () => index,
      getHeight: () => index === 0 ? getChartLayout()?.priceHeight ?? 0 : panes.get(index)?.height ?? 120,
      setHeight: (height: number) => {
        if (index === 0) return
        const pane = panes.get(index) ?? { height: 120, stretchFactor: 1 }
        pane.height = Math.max(0, height); panes.set(index, pane)
        if (index === 1) engine?.setVolumeHeight(pane.height)
        sizeCanvas(); schedule()
      },
      moveTo: (target: number) => {
        for (const item of series) if (item.paneIndex === index) item.paneIndex = target
        indicatorScales.prune()
        sizeCanvas()
      },
      get stretchFactor() { return panes.get(index)?.stretchFactor ?? 1 },
      setStretchFactor: (factor: number) => {
        const pane = panes.get(index) ?? { height: 120, stretchFactor: 1 }
        pane.stretchFactor = Number.isFinite(factor) && factor > 0 ? factor : 1
        panes.set(index, pane)
        sizeCanvas()
      },
    }
  }
  function priceFormatter(seriesOptions: RuntimeSeriesOptions) {
    const formatter = (options.localization as { priceFormatter?: (n: number) => string } | undefined)?.priceFormatter
      ?? ((value: number) => value.toFixed(numberOption((seriesOptions.priceFormat as { precision?: number } | undefined)?.precision, 2)))
    return { format: formatter, formatTickmarks: (prices: readonly number[]) => prices.map(formatter) }
  }
  const runtimeSeriesHost: RuntimeSeriesHost = {
    nextSeriesId: () => ++seriesId,
    series,
    primitives,
    dataHandlers,
    priceLines,
    panes,
    engine,
    indicatorScales,
    getChartLayout,
    priceScaleApi: () => priceScaleApi,
    attachedParams,
    paneApi,
    notifyData,
    markEngineDirty,
    sizeCanvas: () => sizeCanvas(),
    onPrimitiveChanged: () => {
      rangeRevision += 1
      effectiveRangeSignature = ''
      applyEffectivePriceRange()
      schedule()
    },
    schedule,
    rebuildEngine,
    priceFormatter,
  }

  const chart = {
    addSeries: (definition: unknown, opts: RuntimeSeriesOptions = {}, paneIndex = 0) => {
      const kind: SeriesKind = definition === CandlestickSeries ? 'candle' : definition === HistogramSeries ? 'histogram' : definition === LineSeries ? 'line' : 'line'
      return new RuntimeSeries(runtimeSeriesHost, kind, opts, paneIndex)
    },
    removeSeries: (target: RuntimeSeries) => {
      target.detachAll(); target.values.length = 0; target.version += 1
      series.delete(target); dataHandlers.delete(target)
      indicatorScales.prune()
      sizeCanvas()
    },
    panes: () => Array.from({ length: Math.max(1, ...[...series].map((item) => item.paneIndex + 1)) }, (_, index) => paneApi(index)),
    priceScale: () => priceScaleApi,
    timeScale: () => timeScale,
    options: () => options,
    applyOptions: (next: Record<string, unknown>) => {
      options = { ...options, ...next }
      const layout = next.layout as Record<string, unknown> | undefined
      const grid = next.grid as Record<string, unknown> | undefined
      const horz = grid?.horzLines as { visible?: boolean; color?: string } | undefined
      const vert = grid?.vertLines as { visible?: boolean; color?: string } | undefined
      const background = layout?.background as { color?: string } | undefined
      appearance = { ...appearance,
        ...(background?.color ? { backgroundColor: background.color } : {}),
        ...(typeof layout?.textColor === 'string' ? { textColor: layout.textColor } : {}),
        ...(grid ? { showGrid: horz?.visible ?? vert?.visible ?? appearance.showGrid,
          horizontalGridColor: horz?.color ?? appearance.horizontalGridColor,
          verticalGridColor: vert?.color ?? appearance.verticalGridColor } : {}) }
      if (next.rightPriceScale && typeof next.rightPriceScale === 'object') {
        priceScaleApi.applyOptions(next.rightPriceScale as Record<string, unknown>)
      }
      if (next.handleScroll === false) canvas.style.cursor = 'default'
      timeScale.applyOptions((next.timeScale ?? {}) as Record<string, unknown>)
      schedule()
    },
    resize: (width: number, height: number) => sizeCanvas(width, height),
    subscribeCrosshairMove: (handler: Handler<MouseEventParams<Time>>) => crosshairHandlers.add(handler),
    unsubscribeCrosshairMove: (handler: Handler<MouseEventParams<Time>>) => crosshairHandlers.delete(handler),
    subscribeClick: (handler: Handler<MouseEventParams<Time>>) => clickHandlers.add(handler),
    unsubscribeClick: (handler: Handler<MouseEventParams<Time>>) => clickHandlers.delete(handler),
    setCrosshairPosition: (price: number, time: Time, target: RuntimeSeries) => {
      const x = timeScale.timeToCoordinate(time), y = target.priceToCoordinate(price)
      crosshair = x == null || y == null ? null : { x, y }; schedule()
    },
    clearCrosshairPosition: () => { crosshair = null; schedule() },
    takeScreenshot: () => {
      render()
      const image = document.createElement('canvas')
      image.width = canvas.width; image.height = canvas.height
      image.getContext('2d')?.drawImage(canvas, 0, 0)
      return image
    },
    remove: () => {
      if (disposed) return
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      for (const item of [...primitives]) item.primitive.detached?.()
      primitives.clear(); series.clear(); dataHandlers.clear(); priceLines.clear()
      canvas.remove(); engine.destroy()
    },
    priceScaleOptions: () => priceScaleOptions,
  }

  function interactionOption(group: 'handleScroll' | 'handleScale', key: string, fallback: boolean): boolean {
    const setting = options[group]
    if (setting === false) return false
    if (setting === true) return true
    if (setting && typeof setting === 'object') {
      const value = (setting as Record<string, unknown>)[key]
      return typeof value === 'boolean' ? value : fallback
    }
    return fallback
  }
  function axisScaleEnabled(): boolean {
    const setting = options.handleScale
    if (setting === false) return false
    if (!setting || typeof setting !== 'object') return true
    const axis = (setting as Record<string, unknown>).axisPressedMouseMove
    if (typeof axis === 'boolean') return axis
    if (!axis || typeof axis !== 'object') return true
    const mode = priceScaleOptions.mode === 1 ? 'logarithmic'
      : priceScaleOptions.mode === 2 ? 'percentage' : 'price'
    return (axis as Record<string, unknown>)[mode] !== false
  }

  function isFollowingRange(range: NumericLogicalRange | null): boolean {
    const latest = engineSource ? engineSource.values.length - 1 : engine.barCount() - 1
    return !range || range.to >= latest
  }

  function updateManualViewport(): void {
    const range = engine.visibleRange()
    manualVisibleRange = isFollowingRange(range) ? null : range
  }
  function zoomPriceRange(factor: number, y: number): void {
    const range = engine.priceRange()
    const height = getChartLayout()?.priceHeight ?? 0
    if (!height || !Number.isFinite(factor) || factor <= 0) return
    const transformedMin = engine.priceToScaleCoordinate(range.min)
    const transformedMax = engine.priceToScaleCoordinate(range.max)
    if (transformedMin === null || transformedMax === null) return
    const low = Math.min(transformedMin, transformedMax)
    const high = Math.max(transformedMin, transformedMax)
    if (high <= low) return
    const plotFraction = 0.86
    const yFraction = Math.max(0, Math.min(1, (y / height - 0.08) / plotFraction))
    const inverted = priceScaleOptions.invertScale === true
    const anchorFraction = inverted ? yFraction : 1 - yFraction
    const anchor = low + (high - low) * anchorFraction
    const span = (high - low) * factor
    const rawMin = engine.scaleCoordinateToPrice(anchor - anchorFraction * span)
    const rawMax = engine.scaleCoordinateToPrice(anchor + (1 - anchorFraction) * span)
    if (rawMin === null || rawMax === null) return
    const min = Math.min(rawMin, rawMax)
    const max = Math.max(rawMin, rawMax)
    if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return
    priceScaleOptions = { ...priceScaleOptions, autoScale: false }
    manualPriceRange = { min, max }
    rangeRevision += 1
    effectiveRangeSignature = ''
    engine.setPriceRange(manualPriceRange)
    schedule()
  }

  function resetPriceScale(): void {
    priceScaleOptions = { ...priceScaleOptions, autoScale: true }
    manualPriceRange = null
    engine.setPriceRange(null)
    rangeRevision += 1
    effectiveRangeSignature = ''
    applyEffectivePriceRange()
    schedule()
  }

  function paneAt(y: number, layout: RustChartLayout): { index: number; top: number } | null {
    if (y >= 0 && y <= layout.priceHeight) return { index: 0, top: 0 }
    if (appearance.showVolume && y >= layout.priceHeight && y <= layout.priceHeight + layout.volumeHeight) {
      return { index: 1, top: layout.priceHeight }
    }
    for (const pane of layout.indicatorPanes) {
      if (y >= pane.top && y <= pane.top + pane.height) return { index: pane.index, top: pane.top }
    }
    return null
  }
  function pointInPlot(x: number, y: number, layout: RustChartLayout | null): boolean {
    return !!layout && x >= 0 && x <= layout.plotWidth && paneAt(y, layout) !== null
  }
  function mouseEvent(event: MouseEvent, clicked: boolean): void {
    flushEngine()
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    const layout = getChartLayout()
    const pane = layout ? paneAt(y, layout) : null
    const inPlot = pointInPlot(x, y, layout)
    const logical = inPlot ? engine.xToLogical(x) : null
    const time = inPlot ? engine.xToTime(x) : null
    const point = inPlot && pane ? { x, y: y - pane.top } : undefined
    crosshair = inPlot ? { x, y } : null
    const paneIndex = pane?.index ?? 0
    const data = new Map<RuntimeSeries, RuntimeDatum>()
    if (time !== null) for (const item of series) {
      let low = 0, high = item.values.length
      const target = Number(time)
      while (low < high) {
        const middle = (low + high) >>> 1
        if (stamp(item.values[middle].time) < target) low = middle + 1
        else high = middle
      }
      const datum = item.values[low]
      if (datum && stamp(datum.time) === target) data.set(item, datum)
    }
    const payload = { time: time == null ? undefined : asTime(time), logical: logical ?? undefined,
      point, seriesData: data, paneIndex, sourceEvent: event, hoveredObject: undefined } as unknown as MouseEventParams<Time>
    for (const handler of clicked ? clickHandlers : crosshairHandlers) handler(payload)
    schedule()
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (disposed || event.defaultPrevented) return
    flushEngine()
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    const layout = getChartLayout()
    if (!layout) return
    activePointers.set(event.pointerId, { x, y, type: event.pointerType })
    if (event.pointerType === 'touch' && activePointers.size > 1) {
      const points = [...activePointers.values()]
      pinchDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      dragging = null
      if (interactionOption('handleScale', 'pinch', true)) canvas.setPointerCapture(event.pointerId)
      return
    }
    const pane = paneAt(y, layout)
    const onPriceAxis = x > layout.plotWidth && x <= canvas.clientWidth && pane?.index === 0
    const onIndicatorPriceAxis = x > layout.plotWidth && x <= canvas.clientWidth &&
      pane !== null && layout.indicatorPanes.some((item) => item.index === pane.index)
    const canScaleAxis = axisScaleEnabled()
    const canPan = interactionOption('handleScroll', event.pointerType === 'touch' ? 'horzTouchDrag' : 'pressedMouseMove', true)
    const inPane = x >= 0 && x <= layout.plotWidth && pane !== null
    if (onPriceAxis && canScaleAxis) dragging = { pointerId: event.pointerId, x, y, mode: 'price' }
    else if (onIndicatorPriceAxis && canScaleAxis && pane) {
      dragging = { pointerId: event.pointerId, x, y, mode: 'indicator-price', paneIndex: pane.index }
    }
    else if (inPane && canPan) dragging = { pointerId: event.pointerId, x, y, mode: event.pointerType === 'touch' ? 'touch' : 'pan' }
    if (dragging?.pointerId === event.pointerId || event.pointerType === 'touch' && interactionOption('handleScale', 'pinch', true)) {
      canvas.setPointerCapture(event.pointerId)
    }
  })

  canvas.addEventListener('pointermove', (event) => {
    flushEngine()
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    const previous = activePointers.get(event.pointerId)
    if (previous) activePointers.set(event.pointerId, { x, y, type: event.pointerType })
    if (activePointers.size >= 2 && pinchDistance > 0 && interactionOption('handleScale', 'pinch', true)) {
      const points = [...activePointers.values()]
      const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)
      if (distance > 0) {
        const center = (points[0].x + points[1].x) / 2
        engine.zoom(pinchDistance / distance, center)
        pinchDistance = distance
        updateManualViewport()
        emitRanges()
      }
    } else if (dragging?.pointerId === event.pointerId) {
      if (dragging.mode === 'price') zoomPriceRange(Math.exp((y - dragging.y) * 0.01), y)
      else if (dragging.mode === 'indicator-price' && dragging.paneIndex !== undefined) {
        indicatorScales.zoom(dragging.paneIndex, Math.exp((y - dragging.y) * 0.01), y)
      } else if (dragging.mode === 'pan' || dragging.mode === 'touch') {
        engine.pan(x - dragging.x)
        updateManualViewport()
        emitRanges()
      }
      dragging.x = x; dragging.y = y
    }
    mouseEvent(event, false)
  })

  const endPointer = (event: PointerEvent) => {
    activePointers.delete(event.pointerId)
    if (dragging?.pointerId === event.pointerId) dragging = null
    if (activePointers.size < 2) pinchDistance = 0
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId)
    updateManualViewport()
    emitRanges()
  }
  canvas.addEventListener('pointerup', endPointer)
  canvas.addEventListener('pointercancel', endPointer)
  canvas.addEventListener('pointerleave', () => {
    if (activePointers.size > 0) return
    crosshair = null
    const payload = { time: undefined, logical: undefined, point: undefined, seriesData: new Map(), paneIndex: 0 } as unknown as MouseEventParams<Time>
    for (const handler of crosshairHandlers) handler(payload)
    schedule()
  })
  canvas.addEventListener('click', (event) => mouseEvent(event, true))
  canvas.addEventListener('dblclick', (event) => {
    const rect = canvas.getBoundingClientRect()
    const layout = getChartLayout()
    const pane = layout ? paneAt(event.clientY - rect.top, layout) : null
    if (layout && event.clientX - rect.left > layout.plotWidth &&
      (priceScaleOptions.axisDoubleClickReset ?? true)) {
      if (pane?.index === 0) resetPriceScale()
      else if (pane && layout.indicatorPanes.some((item) => item.index === pane.index)) indicatorScales.reset(pane.index)
    }
  })
  canvas.addEventListener('wheel', (event) => {
    if (event.defaultPrevented) return
    flushEngine()
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left, y = event.clientY - rect.top
    const layout = getChartLayout()
    if (!layout) return
    const pane = paneAt(y, layout)
    const overPriceAxis = x > layout.plotWidth && pane?.index === 0
    const overIndicatorPriceAxis = x > layout.plotWidth && pane !== null &&
      layout.indicatorPanes.some((item) => item.index === pane.index)
    const inPane = x >= 0 && x <= layout.plotWidth && pane !== null
    const scaleWheel = interactionOption('handleScale', 'mouseWheel', false)
    const scrollWheel = interactionOption('handleScroll', 'mouseWheel', false)
    if (overPriceAxis && scaleWheel) {
      zoomPriceRange(Math.exp(event.deltaY * 0.001), y)
    } else if (overIndicatorPriceAxis && pane && scaleWheel) {
      indicatorScales.zoom(pane.index, Math.exp(event.deltaY * 0.001), y)
    } else if (inPane && scaleWheel) {
      engine.zoom(Math.exp(event.deltaY * 0.001), x)
      updateManualViewport(); emitRanges()
    } else if (inPane && scrollWheel) {
      engine.pan(Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY)
      updateManualViewport(); emitRanges()
    } else return
    event.preventDefault()
    schedule()
  }, { passive: false })

  chart.applyOptions(initialOptions)
  sizeCanvas()
  rebuildEngine()
  emitRanges()
  return chart as unknown as IChartApi
}
