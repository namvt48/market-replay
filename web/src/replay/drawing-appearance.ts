import type { Anchor, DrawingOptions, DrawingStyle, IDrawing } from 'lightweight-charts-drawing'

export type DrawingBorderStyle = 'solid' | 'dashed' | 'dotted'
export type DrawingHorizontalAlign = 'left' | 'center' | 'right'
export type DrawingVerticalAlign = 'top' | 'inside' | 'bottom'
export type DrawingLineEndStyle = 'normal' | 'arrow'
export type DrawingVisibilityUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks' | 'months'
export type FibonacciLabelPosition = 'left' | 'center' | 'right'
export type FibonacciLabelVerticalPosition = 'top' | 'middle' | 'bottom'
export type FibonacciLevelFormat = 'values' | 'percents'
export type PositionRiskMode = 'percent' | 'cash'
export type RangeStatKey = 'price-range' | 'percent-change' | 'change-in-pips' | 'bars-range' | 'date-time-range' | 'volume'
export type PositionStatKey =
  | 'tp-price-offset'
  | 'tp-percent-offset'
  | 'tp-tick-offset'
  | 'tp-amount'
  | 'tp-pl'
  | 'open-closed-pl'
  | 'qty'
  | 'risk-reward-ratio'
  | 'sl-price-offset'
  | 'sl-percent-offset'
  | 'sl-tick-offset'
  | 'sl-amount'
  | 'sl-pl'

export interface FibonacciLevelAppearance {
  value: number
  visible: boolean
  color: string
}

export interface DrawingCoordinate {
  price: number
  bar: number
}

export interface DrawingVisibilityRule {
  enabled: boolean
  min: number
  max: number
}

export type DrawingVisibility = Record<DrawingVisibilityUnit, DrawingVisibilityRule>

export const DEFAULT_DRAWING_VISIBILITY: DrawingVisibility = {
  seconds: { enabled: true, min: 1, max: 59 },
  minutes: { enabled: true, min: 1, max: 59 },
  hours: { enabled: true, min: 1, max: 24 },
  days: { enabled: true, min: 1, max: 366 },
  weeks: { enabled: true, min: 1, max: 52 },
  months: { enabled: true, min: 1, max: 12 },
}

export const FIBONACCI_LEVEL_SLOT_COUNT = 24

export const DEFAULT_POSITION_STATS: PositionStatKey[] = [
  'tp-price-offset',
  'tp-percent-offset',
  'tp-tick-offset',
  'tp-amount',
  'open-closed-pl',
  'qty',
  'risk-reward-ratio',
  'sl-price-offset',
  'sl-percent-offset',
  'sl-tick-offset',
  'sl-amount',
]

export const DEFAULT_PRICE_RANGE_STATS: RangeStatKey[] = ['price-range', 'percent-change', 'change-in-pips']
export const DEFAULT_DATE_RANGE_STATS: RangeStatKey[] = ['bars-range', 'date-time-range', 'volume']

export const DEFAULT_FIBONACCI_LEVELS: FibonacciLevelAppearance[] = [
  { value: -1, visible: false, color: '#787b86' },
  { value: -0.618, visible: false, color: '#2962ff' },
  { value: -0.382, visible: false, color: '#f6a53a' },
  { value: -0.236, visible: false, color: '#f23645' },
  { value: 0, visible: true, color: '#787b86' },
  { value: 0.236, visible: true, color: '#f23645' },
  { value: 0.382, visible: true, color: '#f6a53a' },
  { value: 0.5, visible: true, color: '#089981' },
  { value: 0.618, visible: true, color: '#2962ff' },
  { value: 0.65, visible: false, color: '#2962ff' },
  { value: 0.786, visible: true, color: '#9c6ade' },
  { value: 0.886, visible: false, color: '#9c6ade' },
  { value: 1, visible: true, color: '#787b86' },
  { value: 1.13, visible: false, color: '#089981' },
  { value: 1.272, visible: false, color: '#f6a53a' },
  { value: 1.414, visible: false, color: '#2962ff' },
  { value: 1.618, visible: true, color: '#00a6a6' },
  { value: 2, visible: false, color: '#787b86' },
  { value: 2.272, visible: false, color: '#f23645' },
  { value: 2.414, visible: false, color: '#2962ff' },
  { value: 2.618, visible: true, color: '#d14f8f' },
  { value: 3, visible: false, color: '#787b86' },
  { value: 3.618, visible: false, color: '#00a6a6' },
  { value: 4.236, visible: false, color: '#9c6ade' },
]

export interface DrawingWorkbenchMetadata {
  strokeColor: string
  strokeOpacity: number
  borderStyle: DrawingBorderStyle
  fillColor: string
  fillOpacity: number
  drawingBackgroundVisible: boolean
  text: string
  textColor: string
  textOpacity: number
  backgroundColor: string
  backgroundOpacity: number
  textBackgroundVisible: boolean
  textBorderVisible: boolean
  textWrap: boolean
  textAnchored: boolean
  textAnchorX: number
  textAnchorY: number
  horizontalAlign: DrawingHorizontalAlign
  verticalAlign: DrawingVerticalAlign
  bold: boolean
  italic: boolean
  fontSize: number
  lineStartStyle: DrawingLineEndStyle
  lineEndStyle: DrawingLineEndStyle
  showMiddlePoint: boolean
  showPriceLabels: boolean
  visibility: DrawingVisibility
  fibonacciLevels: FibonacciLevelAppearance[]
  fibonacciExtend: boolean
  fibonacciLevelDecimals: number
  fibonacciLabelPosition: FibonacciLabelPosition
  fibonacciLabelVerticalPosition: FibonacciLabelVerticalPosition
  fibonacciReverse: boolean
  fibonacciPrices: boolean
  fibonacciLevelLabels: boolean
  fibonacciLevelFormat: FibonacciLevelFormat
  fibonacciTextVisible: boolean
  fibonacciTrendLineColor: string
  fibonacciTrendLineOpacity: number
  fibonacciTrendLineWidth: number
  fibonacciTrendLineStyle: DrawingBorderStyle
  rectangleMiddleLine: boolean
  rectangleMiddleLineColor: string
  rectangleMiddleLineOpacity: number
  rectangleMiddleLineWidth: number
  rectangleMiddleLineStyle: DrawingBorderStyle
  fibonacciDiagonalLine: boolean
  positionAccountSize: number
  positionLotSize: number
  positionRisk: number
  positionRiskMode: PositionRiskMode
  positionLeverage: number
  positionQtyPrecision: number | 'default'
  positionStopColor: string
  positionStopOpacity: number
  positionTargetColor: string
  positionTargetOpacity: number
  positionPriceLabels: boolean
  positionStats: PositionStatKey[]
  positionCompactStats: boolean
  positionAlwaysShowStats: boolean
  rangeLabelBackgroundVisible: boolean
  rangeStats: RangeStatKey[]
}

export interface DrawingAppearance extends DrawingWorkbenchMetadata {
  id: string
  type: string
  locked?: boolean
  lineWidth: number
  extendLeft: boolean
  extendRight: boolean
  supportsExtend: boolean
  coordinates?: DrawingCoordinate[]
  positionTickSize?: number
  positionPricePrecision?: number
  rangeVolume?: number
  rangeBarIntervalSeconds?: number
}

export type DrawingAppearancePatch = Partial<Omit<DrawingAppearance, 'id' | 'type' | 'locked' | 'supportsExtend' | 'positionTickSize' | 'positionPricePrecision' | 'rangeVolume' | 'rangeBarIntervalSeconds'>>

export interface DrawingWorkbenchOptions extends DrawingOptions {
  workbench?: DrawingWorkbenchMetadata
  levelSettings?: FibonacciLevelAppearance[]
  extendLines?: boolean
  levelDecimals?: number
  labelPosition?: FibonacciLabelPosition
  labelVerticalPosition?: FibonacciLabelVerticalPosition
  labelFontSize?: number
  showPrices?: boolean
  showLevelLabels?: boolean
  levelFormat?: FibonacciLevelFormat
  reverseDirection?: boolean
  showMiddleLine?: boolean
  middleLineColor?: string
  middleLineWidth?: number
  middleLineDash?: number[]
  showDiagonalLine?: boolean
  diagonalLineColor?: string
  diagonalLineWidth?: number
  diagonalLineDash?: number[]
  accountSize?: number
  lotSize?: number
  riskValue?: number
  riskMode?: PositionRiskMode
  leverage?: number
  qtyPrecision?: number | 'default'
  stopColor?: string
  targetColor?: string
  showPositionPriceLabels?: boolean
  positionStats?: PositionStatKey[]
  compactStatsMode?: boolean
  alwaysShowStats?: boolean
  tickSize?: number
  pricePrecision?: number
  text?: string
  note?: string
  fontSize?: number
  fontFamily?: string
  fontWeight?: string
  textAlign?: CanvasTextAlign
  backgroundColor?: string
  borderColor?: string
  textWrap?: boolean
  iconColor?: string
  priceColor?: string
  noteColor?: string
  screenAnchored?: boolean
  screenXRatio?: number
  screenYRatio?: number
  filled?: boolean
  showRange?: boolean
  showPercentage?: boolean
  showPips?: boolean
  showBars?: boolean
  showDateTime?: boolean
  showVolume?: boolean
  labelBackgroundVisible?: boolean
  labelBackgroundColor?: string
  customText?: string
  barIntervalSeconds?: number
  volume?: number
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const SHORT_HEX_COLOR = /^#[0-9a-f]{3}$/i

export const DEFAULT_DRAWING_METADATA: DrawingWorkbenchMetadata = {
  strokeColor: '#2962ff',
  strokeOpacity: 1,
  borderStyle: 'solid',
  fillColor: '#2962ff',
  fillOpacity: 0.12,
  drawingBackgroundVisible: false,
  text: '',
  textColor: '#d1d4dc',
  textOpacity: 1,
  backgroundColor: '#131722',
  backgroundOpacity: 0.82,
  textBackgroundVisible: false,
  textBorderVisible: false,
  textWrap: false,
  textAnchored: false,
  textAnchorX: 0.5,
  textAnchorY: 0.5,
  horizontalAlign: 'center',
  verticalAlign: 'inside',
  bold: false,
  italic: false,
  fontSize: 13,
  lineStartStyle: 'normal',
  lineEndStyle: 'normal',
  showMiddlePoint: false,
  showPriceLabels: false,
  visibility: structuredClone(DEFAULT_DRAWING_VISIBILITY),
  fibonacciLevels: DEFAULT_FIBONACCI_LEVELS.map((level) => ({ ...level })),
  fibonacciExtend: false,
  fibonacciLevelDecimals: 3,
  fibonacciLabelPosition: 'right',
  fibonacciLabelVerticalPosition: 'middle',
  fibonacciReverse: false,
  fibonacciPrices: true,
  fibonacciLevelLabels: true,
  fibonacciLevelFormat: 'values',
  fibonacciTextVisible: false,
  fibonacciTrendLineColor: '#787b86',
  fibonacciTrendLineOpacity: 1,
  fibonacciTrendLineWidth: 1,
  fibonacciTrendLineStyle: 'dashed',
  rectangleMiddleLine: false,
  rectangleMiddleLineColor: '#2962ff',
  rectangleMiddleLineOpacity: 1,
  rectangleMiddleLineWidth: 1,
  rectangleMiddleLineStyle: 'solid',
  fibonacciDiagonalLine: true,
  positionAccountSize: 1000,
  positionLotSize: 1,
  positionRisk: 25,
  positionRiskMode: 'percent',
  positionLeverage: 10000,
  positionQtyPrecision: 'default',
  positionStopColor: '#f23645',
  positionStopOpacity: 0.3,
  positionTargetColor: '#089981',
  positionTargetOpacity: 0.3,
  positionPriceLabels: true,
  positionStats: [...DEFAULT_POSITION_STATS],
  positionCompactStats: false,
  positionAlwaysShowStats: false,
  rangeLabelBackgroundVisible: true,
  rangeStats: [...DEFAULT_PRICE_RANGE_STATS],
}

const POSITION_STAT_KEYS = new Set<PositionStatKey>([
  'tp-price-offset', 'tp-percent-offset', 'tp-tick-offset', 'tp-amount', 'tp-pl',
  'open-closed-pl', 'qty', 'risk-reward-ratio',
  'sl-price-offset', 'sl-percent-offset', 'sl-tick-offset', 'sl-amount', 'sl-pl',
])
const RANGE_STAT_KEYS = new Set<RangeStatKey>(['price-range', 'percent-change', 'change-in-pips', 'bars-range', 'date-time-range', 'volume'])

const EXTENDABLE_TYPES = new Set([
  'trend-line', 'extended-line', 'ray', 'horizontal-line', 'horizontal-ray', 'vertical-line', 'rectangle',
  'info-line', 'trend-angle', 'parallel-channel', 'disjoint-channel', 'flat-top-bottom',
  'regression-trend', 'fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-extension',
  'gann-fan', 'pitchfan', 'andrews-pitchfork', 'inside-pitchfork', 'schiff-pitchfork',
  'modified-schiff-pitchfork',
  'curve', 'price-range', 'date-range',
])

export const LINE_TOOL_TYPES = [
  'trend-line', 'ray', 'info-line', 'extended-line', 'trend-angle',
  'horizontal-line', 'horizontal-ray', 'vertical-line', 'cross-line',
] as const

export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value) || SHORT_HEX_COLOR.test(value)
}

export function normalizeHexColor(value: string, fallback: string): string {
  if (HEX_COLOR.test(value)) return value.toLowerCase()
  if (SHORT_HEX_COLOR.test(value)) {
    const [r, g, b] = value.slice(1).split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  return fallback.toLowerCase()
}

export function clampOpacity(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1))
}

function normalizePositionStats(value: readonly string[] | undefined): PositionStatKey[] {
  if (!value) return [...DEFAULT_POSITION_STATS]
  return [...new Set(value.filter((item): item is PositionStatKey => POSITION_STAT_KEYS.has(item as PositionStatKey)))]
}

function normalizeRangeStats(value: readonly string[] | undefined, type: string): RangeStatKey[] {
  if (!value) return [...(type === 'date-range' ? DEFAULT_DATE_RANGE_STATS : DEFAULT_PRICE_RANGE_STATS)]
  return [...new Set(value.filter((item): item is RangeStatKey => RANGE_STAT_KEYS.has(item as RangeStatKey)))]
}

export function colorWithOpacity(color: string, opacity: number): string {
  const normalized = normalizeHexColor(color, '#000000')
  const red = Number.parseInt(normalized.slice(1, 3), 16)
  const green = Number.parseInt(normalized.slice(3, 5), 16)
  const blue = Number.parseInt(normalized.slice(5, 7), 16)
  return `rgba(${red}, ${green}, ${blue}, ${clampOpacity(opacity)})`
}

export function lineDashFor(style: DrawingBorderStyle): number[] {
  if (style === 'dashed') return [8, 6]
  if (style === 'dotted') return [2, 5]
  return []
}

export function normalizeFibonacciLevels(levels: readonly FibonacciLevelAppearance[] | undefined): FibonacciLevelAppearance[] {
  return Array.from({ length: FIBONACCI_LEVEL_SLOT_COUNT }, (_, index) => {
    const fallback = DEFAULT_FIBONACCI_LEVELS[index]
    const candidate = levels?.[index]
    return {
      value: candidate && Number.isFinite(candidate.value) ? candidate.value : fallback.value,
      visible: candidate?.visible ?? fallback.visible,
      color: normalizeHexColor(candidate?.color ?? fallback.color, fallback.color),
    }
  })
}

function optionsFor(drawing: IDrawing): DrawingWorkbenchOptions {
  return drawing.options as DrawingWorkbenchOptions
}

export function getDrawingAppearance(drawing: IDrawing, resolveBar?: (time: Anchor['time']) => number): DrawingAppearance {
  const options = optionsFor(drawing)
  const stored = options.workbench
  const strokeColor = normalizeHexColor(stored?.strokeColor ?? drawing.style.lineColor, DEFAULT_DRAWING_METADATA.strokeColor)
  const fillColor = normalizeHexColor(stored?.fillColor ?? drawing.style.fillColor ?? strokeColor, strokeColor)
  const textColor = normalizeHexColor(stored?.textColor ?? drawing.style.labelColor ?? DEFAULT_DRAWING_METADATA.textColor, DEFAULT_DRAWING_METADATA.textColor)

  return {
    ...DEFAULT_DRAWING_METADATA,
    ...stored,
    id: drawing.id,
    type: drawing.type,
    locked: drawing.options.locked ?? false,
    strokeColor,
    fillColor,
    drawingBackgroundVisible: stored?.drawingBackgroundVisible ?? options.filled ?? false,
    textColor,
    lineWidth: Math.max(1, Math.min(8, drawing.style.lineWidth)),
    extendLeft: drawing.options.extendLeft ?? false,
    extendRight: drawing.options.extendRight ?? false,
    supportsExtend: EXTENDABLE_TYPES.has(drawing.type),
    coordinates: drawing.anchors.map((anchor, index) => ({
      price: anchor.price,
      bar: resolveBar ? resolveBar(anchor.time) : index,
    })),
    positionTickSize: 0.25,
    positionPricePrecision: 2,
    fibonacciLevels: normalizeFibonacciLevels(stored?.fibonacciLevels ?? options.levelSettings),
    fibonacciExtend: stored?.fibonacciExtend ?? options.extendLines ?? false,
    fibonacciLevelDecimals: Math.max(0, Math.min(8, Math.round(stored?.fibonacciLevelDecimals ?? options.levelDecimals ?? 3))),
    fibonacciLabelPosition: stored?.fibonacciLabelPosition ?? options.labelPosition ?? 'right',
    fibonacciLabelVerticalPosition: stored?.fibonacciLabelVerticalPosition ?? options.labelVerticalPosition ?? 'middle',
    fibonacciReverse: stored?.fibonacciReverse ?? options.reverseDirection ?? false,
    fibonacciPrices: stored?.fibonacciPrices ?? options.showPrices ?? true,
    fibonacciLevelLabels: stored?.fibonacciLevelLabels ?? options.showLevelLabels ?? true,
    fibonacciLevelFormat: stored?.fibonacciLevelFormat ?? options.levelFormat ?? 'values',
    fibonacciTextVisible: stored?.fibonacciTextVisible ?? false,
    fibonacciTrendLineColor: normalizeHexColor(stored?.fibonacciTrendLineColor ?? options.diagonalLineColor ?? DEFAULT_DRAWING_METADATA.fibonacciTrendLineColor, DEFAULT_DRAWING_METADATA.fibonacciTrendLineColor),
    fibonacciTrendLineOpacity: clampOpacity(stored?.fibonacciTrendLineOpacity ?? DEFAULT_DRAWING_METADATA.fibonacciTrendLineOpacity),
    fibonacciTrendLineWidth: Math.max(1, Math.min(8, Math.round(stored?.fibonacciTrendLineWidth ?? options.diagonalLineWidth ?? DEFAULT_DRAWING_METADATA.fibonacciTrendLineWidth))),
    fibonacciTrendLineStyle: stored?.fibonacciTrendLineStyle ?? (options.diagonalLineDash?.length ? 'dashed' : DEFAULT_DRAWING_METADATA.fibonacciTrendLineStyle),
    rectangleMiddleLine: stored?.rectangleMiddleLine ?? options.showMiddleLine ?? false,
    rectangleMiddleLineColor: normalizeHexColor(stored?.rectangleMiddleLineColor ?? options.middleLineColor ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineColor, DEFAULT_DRAWING_METADATA.rectangleMiddleLineColor),
    rectangleMiddleLineOpacity: clampOpacity(stored?.rectangleMiddleLineOpacity ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineOpacity),
    rectangleMiddleLineWidth: Math.max(1, Math.min(8, Math.round(stored?.rectangleMiddleLineWidth ?? options.middleLineWidth ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineWidth))),
    rectangleMiddleLineStyle: stored?.rectangleMiddleLineStyle ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineStyle,
    fibonacciDiagonalLine: stored?.fibonacciDiagonalLine ?? options.showDiagonalLine ?? true,
    positionAccountSize: Math.max(0, stored?.positionAccountSize ?? options.accountSize ?? DEFAULT_DRAWING_METADATA.positionAccountSize),
    positionLotSize: Math.max(0.000001, stored?.positionLotSize ?? options.lotSize ?? DEFAULT_DRAWING_METADATA.positionLotSize),
    positionRisk: Math.max(0, stored?.positionRisk ?? options.riskValue ?? DEFAULT_DRAWING_METADATA.positionRisk),
    positionRiskMode: stored?.positionRiskMode ?? options.riskMode ?? DEFAULT_DRAWING_METADATA.positionRiskMode,
    positionLeverage: Math.max(0, stored?.positionLeverage ?? options.leverage ?? DEFAULT_DRAWING_METADATA.positionLeverage),
    positionQtyPrecision: stored?.positionQtyPrecision ?? options.qtyPrecision ?? DEFAULT_DRAWING_METADATA.positionQtyPrecision,
    positionStopColor: normalizeHexColor(stored?.positionStopColor ?? DEFAULT_DRAWING_METADATA.positionStopColor, DEFAULT_DRAWING_METADATA.positionStopColor),
    positionStopOpacity: clampOpacity(stored?.positionStopOpacity ?? DEFAULT_DRAWING_METADATA.positionStopOpacity),
    positionTargetColor: normalizeHexColor(stored?.positionTargetColor ?? DEFAULT_DRAWING_METADATA.positionTargetColor, DEFAULT_DRAWING_METADATA.positionTargetColor),
    positionTargetOpacity: clampOpacity(stored?.positionTargetOpacity ?? DEFAULT_DRAWING_METADATA.positionTargetOpacity),
    positionPriceLabels: stored?.positionPriceLabels ?? options.showPositionPriceLabels ?? DEFAULT_DRAWING_METADATA.positionPriceLabels,
    positionStats: normalizePositionStats(stored?.positionStats ?? options.positionStats),
    positionCompactStats: stored?.positionCompactStats ?? options.compactStatsMode ?? DEFAULT_DRAWING_METADATA.positionCompactStats,
    positionAlwaysShowStats: stored?.positionAlwaysShowStats ?? options.alwaysShowStats ?? DEFAULT_DRAWING_METADATA.positionAlwaysShowStats,
    rangeLabelBackgroundVisible: stored?.rangeLabelBackgroundVisible ?? options.labelBackgroundVisible ?? DEFAULT_DRAWING_METADATA.rangeLabelBackgroundVisible,
    rangeStats: normalizeRangeStats(stored?.rangeStats ?? (
      drawing.type === 'date-range'
        ? [options.showBars !== false ? 'bars-range' : '', options.showDateTime !== false ? 'date-time-range' : '', options.showVolume !== false ? 'volume' : '']
        : [options.showRange !== false ? 'price-range' : '', options.showPercentage !== false ? 'percent-change' : '', options.showPips !== false ? 'change-in-pips' : '']
    ), drawing.type),
    rangeVolume: options.volume,
    rangeBarIntervalSeconds: options.barIntervalSeconds,
  }
}

export function mergeDrawingAppearance(current: DrawingAppearance, patch: DrawingAppearancePatch): DrawingAppearance {
  const positionQtyPrecision = patch.positionQtyPrecision ?? current.positionQtyPrecision
  return {
    ...current,
    ...patch,
    strokeColor: normalizeHexColor(patch.strokeColor ?? current.strokeColor, current.strokeColor),
    fillColor: normalizeHexColor(patch.fillColor ?? current.fillColor, current.fillColor),
    textColor: normalizeHexColor(patch.textColor ?? current.textColor, current.textColor),
    backgroundColor: normalizeHexColor(patch.backgroundColor ?? current.backgroundColor, current.backgroundColor),
    rectangleMiddleLineColor: normalizeHexColor(patch.rectangleMiddleLineColor ?? current.rectangleMiddleLineColor, current.rectangleMiddleLineColor),
    fibonacciTrendLineColor: normalizeHexColor(patch.fibonacciTrendLineColor ?? current.fibonacciTrendLineColor, current.fibonacciTrendLineColor),
    positionStopColor: normalizeHexColor(patch.positionStopColor ?? current.positionStopColor, current.positionStopColor),
    positionTargetColor: normalizeHexColor(patch.positionTargetColor ?? current.positionTargetColor, current.positionTargetColor),
    strokeOpacity: clampOpacity(patch.strokeOpacity ?? current.strokeOpacity),
    fillOpacity: clampOpacity(patch.fillOpacity ?? current.fillOpacity),
    textOpacity: clampOpacity(patch.textOpacity ?? current.textOpacity),
    backgroundOpacity: clampOpacity(patch.backgroundOpacity ?? current.backgroundOpacity),
    rectangleMiddleLineOpacity: clampOpacity(patch.rectangleMiddleLineOpacity ?? current.rectangleMiddleLineOpacity),
    fibonacciTrendLineOpacity: clampOpacity(patch.fibonacciTrendLineOpacity ?? current.fibonacciTrendLineOpacity),
    positionStopOpacity: clampOpacity(patch.positionStopOpacity ?? current.positionStopOpacity),
    positionTargetOpacity: clampOpacity(patch.positionTargetOpacity ?? current.positionTargetOpacity),
    lineWidth: Math.max(1, Math.min(8, Math.round(patch.lineWidth ?? current.lineWidth))),
    rectangleMiddleLineWidth: Math.max(1, Math.min(8, Math.round(patch.rectangleMiddleLineWidth ?? current.rectangleMiddleLineWidth))),
    fibonacciTrendLineWidth: Math.max(1, Math.min(8, Math.round(patch.fibonacciTrendLineWidth ?? current.fibonacciTrendLineWidth))),
    fontSize: Math.max(8, Math.min(40, Math.round(patch.fontSize ?? current.fontSize))),
    textAnchorX: Math.max(0, Math.min(1, patch.textAnchorX ?? current.textAnchorX)),
    textAnchorY: Math.max(0, Math.min(1, patch.textAnchorY ?? current.textAnchorY)),
    coordinates: (patch.coordinates ?? current.coordinates)?.map((coordinate) => ({
      price: Number.isFinite(coordinate.price) ? coordinate.price : 0,
      bar: Number.isFinite(coordinate.bar) ? Math.round(coordinate.bar) : 0,
    })),
    fibonacciLevels: normalizeFibonacciLevels(patch.fibonacciLevels ?? current.fibonacciLevels),
    fibonacciLevelDecimals: Math.max(0, Math.min(8, Math.round(patch.fibonacciLevelDecimals ?? current.fibonacciLevelDecimals))),
    positionAccountSize: Math.max(0, patch.positionAccountSize ?? current.positionAccountSize),
    positionLotSize: Math.max(0.000001, patch.positionLotSize ?? current.positionLotSize),
    positionRisk: Math.max(0, patch.positionRisk ?? current.positionRisk),
    positionLeverage: Math.max(0, patch.positionLeverage ?? current.positionLeverage),
    positionQtyPrecision: positionQtyPrecision === 'default' ? 'default' : Math.max(0, Math.min(8, Math.round(positionQtyPrecision))),
    positionStats: normalizePositionStats(patch.positionStats ?? current.positionStats),
    rangeStats: normalizeRangeStats(patch.rangeStats ?? current.rangeStats, current.type),
  }
}

export function appearanceStyle(appearance: DrawingAppearance): Partial<DrawingStyle> {
  const fontStyle = appearance.italic ? 'italic ' : ''
  const fontWeight = appearance.bold ? '700 ' : '400 '
  return {
    lineColor: colorWithOpacity(appearance.strokeColor, appearance.strokeOpacity),
    lineWidth: appearance.lineWidth,
    lineDash: lineDashFor(appearance.borderStyle),
    fillColor: colorWithOpacity(appearance.fillColor, appearance.fillOpacity),
    fillOpacity: appearance.fillOpacity,
    labelColor: colorWithOpacity(appearance.textColor, appearance.textOpacity),
    labelFont: `${fontStyle}${fontWeight}${appearance.fontSize}px -apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif`,
  }
}

export function appearanceOptions(appearance: DrawingAppearance): DrawingWorkbenchOptions {
  const { id: _id, type: _type, locked: _locked, lineWidth: _lineWidth, supportsExtend: _supportsExtend, coordinates: _coordinates, positionTickSize, positionPricePrecision, rangeVolume, rangeBarIntervalSeconds, extendLeft, extendRight, ...workbench } = appearance
  const options: DrawingWorkbenchOptions = { extendLeft, extendRight, workbench }
  if (appearance.type === 'text-annotation') {
    return {
      ...options,
      text: appearance.text,
      fontSize: appearance.fontSize,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
      fontWeight: `${appearance.italic ? 'italic ' : ''}${appearance.bold ? '700' : '400'}`,
      textAlign: appearance.horizontalAlign,
      backgroundColor: appearance.textBackgroundVisible ? colorWithOpacity(appearance.backgroundColor, appearance.backgroundOpacity) : '',
      borderColor: appearance.textBorderVisible ? colorWithOpacity(appearance.strokeColor, appearance.strokeOpacity) : '',
      textWrap: appearance.textWrap,
      screenAnchored: appearance.textAnchored,
      screenXRatio: appearance.textAnchorX,
      screenYRatio: appearance.textAnchorY,
    }
  }
  if (appearance.type === 'note' || appearance.type === 'anchored-text') {
    return {
      ...options,
      text: appearance.text,
      fontSize: appearance.fontSize,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Trebuchet MS", Roboto, Ubuntu, sans-serif',
      fontWeight: `${appearance.italic ? 'italic ' : ''}${appearance.bold ? '700' : '400'}`,
      backgroundColor: colorWithOpacity(appearance.backgroundColor, appearance.backgroundOpacity),
      iconColor: colorWithOpacity(appearance.textColor, appearance.textOpacity),
    }
  }
  if (appearance.type === 'callout' || appearance.type === 'comment') {
    return {
      ...options,
      text: appearance.text,
      fontSize: appearance.fontSize,
      backgroundColor: colorWithOpacity(appearance.fillColor, appearance.fillOpacity),
      borderColor: colorWithOpacity(appearance.strokeColor, appearance.strokeOpacity),
    }
  }
  if (appearance.type === 'price-note') {
    return {
      ...options,
      note: appearance.text,
      fontSize: appearance.fontSize,
      backgroundColor: colorWithOpacity(appearance.fillColor, appearance.fillOpacity),
      priceColor: colorWithOpacity(appearance.strokeColor, appearance.strokeOpacity),
      noteColor: colorWithOpacity(appearance.textColor, appearance.textOpacity),
    }
  }
  if (appearance.type === 'rectangle') {
    return {
      ...options,
      showMiddleLine: appearance.rectangleMiddleLine,
      middleLineColor: colorWithOpacity(appearance.rectangleMiddleLineColor, appearance.rectangleMiddleLineOpacity),
      middleLineWidth: appearance.rectangleMiddleLineWidth,
      middleLineDash: lineDashFor(appearance.rectangleMiddleLineStyle),
    }
  }
  if (appearance.type === 'curve') {
    return { ...options, filled: appearance.drawingBackgroundVisible }
  }
  if (appearance.type === 'price-range') {
    return {
      ...options,
      filled: appearance.drawingBackgroundVisible,
      showRange: appearance.rangeStats.includes('price-range'),
      showPercentage: appearance.rangeStats.includes('percent-change'),
      showPips: appearance.rangeStats.includes('change-in-pips'),
      labelBackgroundVisible: appearance.rangeLabelBackgroundVisible,
      labelBackgroundColor: colorWithOpacity(appearance.backgroundColor, appearance.backgroundOpacity),
      customText: appearance.text,
      tickSize: positionTickSize ?? 0.25,
      pricePrecision: positionPricePrecision ?? 2,
    }
  }
  if (appearance.type === 'date-range') {
    return {
      ...options,
      filled: appearance.drawingBackgroundVisible,
      showBars: appearance.rangeStats.includes('bars-range'),
      showDateTime: appearance.rangeStats.includes('date-time-range'),
      showVolume: appearance.rangeStats.includes('volume'),
      labelBackgroundVisible: appearance.rangeLabelBackgroundVisible,
      labelBackgroundColor: colorWithOpacity(appearance.backgroundColor, appearance.backgroundOpacity),
      customText: appearance.text,
      barIntervalSeconds: rangeBarIntervalSeconds ?? 60,
      volume: rangeVolume ?? 0,
    }
  }
  if (appearance.type === 'long-position' || appearance.type === 'short-position') {
    return {
      ...options,
      accountSize: appearance.positionAccountSize,
      lotSize: appearance.positionLotSize,
      riskValue: appearance.positionRisk,
      riskMode: appearance.positionRiskMode,
      leverage: appearance.positionLeverage,
      qtyPrecision: appearance.positionQtyPrecision,
      stopColor: colorWithOpacity(appearance.positionStopColor, appearance.positionStopOpacity),
      targetColor: colorWithOpacity(appearance.positionTargetColor, appearance.positionTargetOpacity),
      showPositionPriceLabels: appearance.positionPriceLabels,
      positionStats: normalizePositionStats(appearance.positionStats),
      compactStatsMode: appearance.positionCompactStats,
      alwaysShowStats: appearance.positionAlwaysShowStats,
      tickSize: positionTickSize ?? 0.25,
      pricePrecision: positionPricePrecision ?? 2,
    }
  }
  if (appearance.type !== 'fib-retracement') return options
  return {
    ...options,
    levelSettings: normalizeFibonacciLevels(appearance.fibonacciLevels),
    extendLines: appearance.fibonacciExtend,
    levelDecimals: appearance.fibonacciLevelDecimals,
    labelPosition: appearance.fibonacciLabelPosition,
    labelVerticalPosition: appearance.fibonacciLabelVerticalPosition,
    labelFontSize: appearance.fontSize,
    showPrices: appearance.fibonacciPrices,
    showLevelLabels: appearance.fibonacciLevelLabels,
    levelFormat: appearance.fibonacciLevelFormat,
    reverseDirection: appearance.fibonacciReverse,
    showDiagonalLine: appearance.fibonacciDiagonalLine,
    diagonalLineColor: colorWithOpacity(appearance.fibonacciTrendLineColor, appearance.fibonacciTrendLineOpacity),
    diagonalLineWidth: appearance.fibonacciTrendLineWidth,
    diagonalLineDash: lineDashFor(appearance.fibonacciTrendLineStyle),
  }
}
