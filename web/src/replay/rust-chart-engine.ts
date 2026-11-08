import wasmUrl from './chart-engine.wasm?url'
import type { DisplayBar } from './chart-adapter'

const BAR_BYTES = 48
const BAR_GEOMETRY_STRIDE = 10
const INVALID_TIME = -(1n << 63n)

interface RustWasmExports {
  memory: WebAssembly.Memory
  chart_engine_alloc_bars(length: number): number
  chart_engine_alloc_times(length: number): number
  chart_engine_bar_count(engine: number): number
  chart_engine_focus_time(engine: number, time: bigint): number
  chart_engine_free(engine: number): void
  chart_engine_free_bars(bars: number, length: number): void
  chart_engine_free_times(times: number, length: number): void
  chart_engine_geometry_ptr(engine: number): number
  chart_engine_logical_to_time(engine: number, logical: number): bigint
  chart_engine_logical_to_x(engine: number, logical: number): number
  chart_engine_new(): number
  chart_engine_pan(engine: number, deltaPixels: number): void
  chart_engine_price_max(engine: number): number
  chart_engine_price_min(engine: number): number
  chart_engine_price_to_scale_coordinate(engine: number, price: number): number
  chart_engine_price_to_scale_value(engine: number, price: number): number
  chart_engine_price_to_y(engine: number, price: number): number
  chart_engine_scale_coordinate_to_price(engine: number, coordinate: number): number
  chart_engine_push_bars(engine: number, bars: number, length: number): void
  chart_engine_render(engine: number): number
  chart_engine_resize(engine: number, width: number, height: number): void
  chart_engine_select_logical(engine: number, logical: number): void
  chart_engine_set_bar_spacing(engine: number, spacing: number): void
  chart_engine_set_chart_type(engine: number, chartType: number): void
  chart_engine_set_history(engine: number, bars: number, length: number): void
  chart_engine_set_price_range(engine: number, enabled: number, min: number, max: number): void
  chart_engine_set_right_offset(engine: number, offset: number): void
  chart_engine_set_scale_mode(engine: number, mode: number): void
  chart_engine_set_inverted(engine: number, inverted: number): void
  chart_engine_set_spacer_times(engine: number, times: number, length: number): void
  chart_engine_set_visible_range(engine: number, from: number, to: number): number
  chart_engine_set_volume_height(engine: number, height: number): void
  chart_engine_time_to_logical(engine: number, time: bigint): number
  chart_engine_time_to_x(engine: number, time: bigint): number
  chart_engine_truncate_to(engine: number, time: bigint): void
  chart_engine_visible_from(engine: number): number
  chart_engine_visible_to(engine: number): number
  chart_engine_x_to_logical(engine: number, x: number): number
  chart_engine_x_to_time(engine: number, x: number): bigint
  chart_engine_y_to_price(engine: number, y: number): number
  chart_engine_zoom(engine: number, factor: number, anchorX: number): void
}

const REQUIRED_FUNCTIONS = [
  'chart_engine_alloc_bars',
  'chart_engine_alloc_times',
  'chart_engine_bar_count',
  'chart_engine_focus_time',
  'chart_engine_free',
  'chart_engine_free_bars',
  'chart_engine_free_times',
  'chart_engine_geometry_ptr',
  'chart_engine_logical_to_time',
  'chart_engine_logical_to_x',
  'chart_engine_new',
  'chart_engine_pan',
  'chart_engine_price_max',
  'chart_engine_price_min',
  'chart_engine_price_to_scale_coordinate',
  'chart_engine_price_to_scale_value',
  'chart_engine_price_to_y',
  'chart_engine_scale_coordinate_to_price',
  'chart_engine_render',
  'chart_engine_resize',
  'chart_engine_select_logical',
  'chart_engine_set_bar_spacing',
  'chart_engine_set_chart_type',
  'chart_engine_set_history',
  'chart_engine_set_price_range',
  'chart_engine_set_right_offset',
  'chart_engine_set_scale_mode',
  'chart_engine_set_inverted',
  'chart_engine_set_spacer_times',
  'chart_engine_set_visible_range',
  'chart_engine_set_volume_height',
  'chart_engine_time_to_logical',
  'chart_engine_time_to_x',
  'chart_engine_truncate_to',
  'chart_engine_visible_from',
  'chart_engine_visible_to',
  'chart_engine_x_to_logical',
  'chart_engine_x_to_time',
  'chart_engine_y_to_price',
  'chart_engine_zoom',
] as const

let exportsPromise: Promise<RustWasmExports> | null = null

async function instantiateRustEngine(): Promise<RustWasmExports> {
  const response = await fetch(wasmUrl)
  if (!response.ok) {
    throw new Error(`Failed to load chart engine WebAssembly (${response.status})`)
  }
  const { instance } = await WebAssembly.instantiate(await response.arrayBuffer(), {})
  const wasmExports = instance.exports
  if (!(wasmExports.memory instanceof WebAssembly.Memory)) {
    throw new Error('Chart engine WebAssembly does not export linear memory')
  }
  for (const name of REQUIRED_FUNCTIONS) {
    if (typeof wasmExports[name] !== 'function') {
      throw new Error(`Chart engine WebAssembly is missing export ${name}`)
    }
  }
  return wasmExports as unknown as RustWasmExports
}

function loadRustExports(): Promise<RustWasmExports> {
  exportsPromise ??= instantiateRustEngine().catch((error: unknown) => {
    exportsPromise = null
    throw error
  })
  return exportsPromise
}

function assertBar(bar: DisplayBar): void {
  if (!Number.isSafeInteger(bar.time)) {
    throw new RangeError(`Chart bar time must be a safe integer in epoch seconds: ${bar.time}`)
  }
  if (
    !Number.isFinite(bar.open) ||
    !Number.isFinite(bar.high) ||
    !Number.isFinite(bar.low) ||
    !Number.isFinite(bar.close) ||
    !Number.isFinite(bar.volume) ||
    bar.volume < 0 ||
    bar.high < Math.max(bar.open, bar.close) ||
    bar.low > Math.min(bar.open, bar.close)
  ) {
    throw new RangeError(`Invalid OHLCV bar at ${bar.time}`)
  }
}

export type RustPriceScaleMode = 'normal' | 'logarithmic' | 'percentage'

const PRICE_SCALE_MODE_CODES: Readonly<Record<RustPriceScaleMode, number>> = {
  normal: 0,
  logarithmic: 1,
  percentage: 2,
}

export class RustChartEngine {
  private disposed = false
  private readonly wasm: RustWasmExports
  private readonly pointer: number
  private scaleMode: RustPriceScaleMode = 'normal'

  private constructor(wasm: RustWasmExports, pointer: number) {
    this.wasm = wasm
    this.pointer = pointer
  }

  static async create(): Promise<RustChartEngine> {
    const wasm = await loadRustExports()
    const pointer = wasm.chart_engine_new()
    if (pointer === 0) throw new Error('Chart engine allocation failed')
    return new RustChartEngine(wasm, pointer)
  }

  destroy(): void {
    if (!this.disposed) {
      this.wasm.chart_engine_free(this.pointer)
      this.disposed = true
    }
  }

  setHistory(bars: readonly DisplayBar[]): void {
    this.withBarBuffer(bars, (handle, pointer, length) =>
      this.wasm.chart_engine_set_history(handle, pointer, length),
    )
  }

  pushBars(bars: readonly DisplayBar[]): void {
    this.withBarBuffer(bars, (handle, pointer, length) =>
      this.wasm.chart_engine_push_bars(handle, pointer, length),
    )
  }


  truncateTo(time: number): void {
    this.wasm.chart_engine_truncate_to(this.handle(), this.toWasmTime(time))
  }

  setSpacerTimes(times: readonly number[]): void {
    const handle = this.handle()
    if (times.length === 0) {
      this.wasm.chart_engine_set_spacer_times(handle, 0, 0)
      return
    }
    const pointer = this.wasm.chart_engine_alloc_times(times.length)
    if (pointer === 0) throw new Error('Chart spacer buffer allocation failed')
    try {
      const view = new BigInt64Array(this.wasm.memory.buffer, pointer, times.length)
      for (let index = 0; index < times.length; index += 1) {
        view[index] = this.toWasmTime(times[index])
      }
      this.wasm.chart_engine_set_spacer_times(handle, pointer, times.length)
    } finally {
      this.wasm.chart_engine_free_times(pointer, times.length)
    }
  }


  resize(width: number, height: number): void {
    this.wasm.chart_engine_resize(this.handle(), width, height)
  }

  setVolumeHeight(height: number): void {
    this.wasm.chart_engine_set_volume_height(this.handle(), height)
  }

  setBarSpacing(spacing: number): void {
    this.wasm.chart_engine_set_bar_spacing(this.handle(), spacing)
  }

  setRightOffset(offset: number): void {
    this.wasm.chart_engine_set_right_offset(this.handle(), offset)
  }

  setChartType(type: 'candles' | 'line'): void {
    this.wasm.chart_engine_set_chart_type(this.handle(), type === 'candles' ? 0 : 1)
  }

  setPriceScaleMode(mode: RustPriceScaleMode): void {
    this.scaleMode = mode
    this.wasm.chart_engine_set_scale_mode(this.handle(), PRICE_SCALE_MODE_CODES[mode])
  }

  setInvertedScale(inverted: boolean): void {
    this.wasm.chart_engine_set_inverted(this.handle(), inverted ? 1 : 0)
  }

  priceScaleMode(): RustPriceScaleMode {
    return this.scaleMode
  }


  setPriceRange(range: { min: number; max: number } | null): void {
    if (range && (!Number.isFinite(range.min) || !Number.isFinite(range.max) || range.max <= range.min)) {
      throw new RangeError('Manual chart price range must be finite and increasing')
    }
    this.wasm.chart_engine_set_price_range(
      this.handle(),
      range ? 1 : 0,
      range?.min ?? 0,
      range?.max ?? 1,
    )
  }

  setVisibleRange(from: number, to: number): boolean {
    return this.wasm.chart_engine_set_visible_range(this.handle(), from, to) !== 0
  }

  visibleRange(): { from: number; to: number } | null {
    const from = this.wasm.chart_engine_visible_from(this.handle())
    const to = this.wasm.chart_engine_visible_to(this.handle())
    return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : null
  }

  priceRange(): { min: number; max: number } {
    return {
      min: this.wasm.chart_engine_price_min(this.handle()),
      max: this.wasm.chart_engine_price_max(this.handle()),
    }
  }

  pan(deltaPixels: number): void {
    this.wasm.chart_engine_pan(this.handle(), deltaPixels)
  }

  zoom(factor: number, anchorX: number): void {
    this.wasm.chart_engine_zoom(this.handle(), factor, anchorX)
  }

  focusTime(time: number): boolean {
    return this.wasm.chart_engine_focus_time(this.handle(), this.toWasmTime(time)) !== 0
  }

  selectLogical(logical: number): void {
    this.wasm.chart_engine_select_logical(this.handle(), logical)
  }

  timeToLogical(time: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_time_to_logical(this.handle(), this.toWasmTime(time)))
  }

  logicalToTime(logical: number): number | null {
    const time = this.wasm.chart_engine_logical_to_time(this.handle(), logical)
    if (time === INVALID_TIME) return null
    const number = Number(time)
    return Number.isSafeInteger(number) ? number : null
  }

  logicalToX(logical: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_logical_to_x(this.handle(), logical))
  }

  xToLogical(x: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_x_to_logical(this.handle(), x))
  }

  timeToX(time: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_time_to_x(this.handle(), this.toWasmTime(time)))
  }

  xToTime(x: number): number | null {
    const time = this.wasm.chart_engine_x_to_time(this.handle(), x)
    if (time === INVALID_TIME) return null
    const number = Number(time)
    return Number.isSafeInteger(number) ? number : null
  }

  priceToY(price: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_price_to_y(this.handle(), price))
  }
  priceToScaleValue(price: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_price_to_scale_value(this.handle(), price))
  }

  priceToScaleCoordinate(price: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_price_to_scale_coordinate(this.handle(), price))
  }

  scaleCoordinateToPrice(coordinate: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_scale_coordinate_to_price(this.handle(), coordinate))
  }

  yToPrice(y: number): number | null {
    return this.numberOrNull(this.wasm.chart_engine_y_to_price(this.handle(), y))
  }

  barCount(): number {
    return this.wasm.chart_engine_bar_count(this.handle())
  }

  /** The returned view is invalid after any mutating engine call. */
  renderGeometry(): Float64Array {
    const length = this.wasm.chart_engine_render(this.handle())
    if (length === 0) return new Float64Array()
    const pointer = this.wasm.chart_engine_geometry_ptr(this.handle())
    if (pointer === 0) throw new Error('Chart engine rendered geometry without a memory pointer')
    return new Float64Array(this.wasm.memory.buffer, pointer, length * BAR_GEOMETRY_STRIDE)
  }

  private withBarBuffer(
    bars: readonly DisplayBar[],
    apply: (handle: number, pointer: number, length: number) => void,
  ): void {
    const handle = this.handle()
    for (const bar of bars) assertBar(bar)
    if (bars.length === 0) {
      apply(handle, 0, 0)
      return
    }
    const pointer = this.wasm.chart_engine_alloc_bars(bars.length)
    if (pointer === 0) throw new Error('Chart bar buffer allocation failed')
    try {
      const view = new DataView(this.wasm.memory.buffer, pointer, bars.length * BAR_BYTES)
      for (let index = 0; index < bars.length; index += 1) {
        const bar = bars[index]
        const offset = index * BAR_BYTES
        view.setBigInt64(offset, this.toWasmTime(bar.time), true)
        view.setFloat64(offset + 8, bar.open, true)
        view.setFloat64(offset + 16, bar.high, true)
        view.setFloat64(offset + 24, bar.low, true)
        view.setFloat64(offset + 32, bar.close, true)
        view.setFloat64(offset + 40, bar.volume, true)
      }
      apply(handle, pointer, bars.length)
    } finally {
      this.wasm.chart_engine_free_bars(pointer, bars.length)
    }
  }

  private toWasmTime(time: number): bigint {
    if (!Number.isSafeInteger(time)) {
      throw new RangeError(`Chart time must be a safe integer in epoch seconds: ${time}`)
    }
    return BigInt(time)
  }

  private numberOrNull(value: number): number | null {
    return Number.isFinite(value) ? value : null
  }

  private handle(): number {
    if (this.disposed) throw new Error('Chart engine has been destroyed')
    return this.pointer
  }
}
