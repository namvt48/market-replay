import type { DrawingOptions, DrawingStyle, IDrawing } from 'lightweight-charts-drawing'

export type DrawingBorderStyle = 'solid' | 'dashed' | 'dotted'
export type DrawingHorizontalAlign = 'left' | 'center' | 'right'
export type DrawingVerticalAlign = 'top' | 'inside' | 'bottom'
export type FibonacciLabelPosition = 'left' | 'center' | 'right'
export type FibonacciLabelVerticalPosition = 'top' | 'middle' | 'bottom'
export type FibonacciLevelFormat = 'values' | 'percents'

export interface FibonacciLevelAppearance {
  value: number
  visible: boolean
  color: string
}

export const FIBONACCI_LEVEL_SLOT_COUNT = 24

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
  text: string
  textColor: string
  textOpacity: number
  backgroundColor: string
  backgroundOpacity: number
  horizontalAlign: DrawingHorizontalAlign
  verticalAlign: DrawingVerticalAlign
  bold: boolean
  italic: boolean
  fontSize: number
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
  rectangleMiddleLine: boolean
  rectangleMiddleLineColor: string
  rectangleMiddleLineOpacity: number
  rectangleMiddleLineWidth: number
  rectangleMiddleLineStyle: DrawingBorderStyle
  fibonacciDiagonalLine: boolean
}

export interface DrawingAppearance extends DrawingWorkbenchMetadata {
  id: string
  type: string
  lineWidth: number
  extendLeft: boolean
  extendRight: boolean
  supportsExtend: boolean
}

export type DrawingAppearancePatch = Partial<Omit<DrawingAppearance, 'id' | 'type' | 'supportsExtend'>>

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
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const SHORT_HEX_COLOR = /^#[0-9a-f]{3}$/i

export const DEFAULT_DRAWING_METADATA: DrawingWorkbenchMetadata = {
  strokeColor: '#2962ff',
  strokeOpacity: 1,
  borderStyle: 'solid',
  fillColor: '#2962ff',
  fillOpacity: 0.12,
  text: '',
  textColor: '#d1d4dc',
  textOpacity: 1,
  backgroundColor: '#131722',
  backgroundOpacity: 0.82,
  horizontalAlign: 'center',
  verticalAlign: 'inside',
  bold: false,
  italic: false,
  fontSize: 12,
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
  rectangleMiddleLine: false,
  rectangleMiddleLineColor: '#2962ff',
  rectangleMiddleLineOpacity: 1,
  rectangleMiddleLineWidth: 1,
  rectangleMiddleLineStyle: 'solid',
  fibonacciDiagonalLine: true,
}

const EXTENDABLE_TYPES = new Set([
  'trend-line', 'extended-line', 'ray', 'horizontal-line', 'horizontal-ray', 'vertical-line',
  'info-line', 'trend-angle', 'parallel-channel', 'disjoint-channel', 'flat-top-bottom',
  'regression-trend', 'fib-retracement', 'fib-extension', 'fib-channel', 'fib-time-extension',
  'gann-fan', 'pitchfan', 'andrews-pitchfork', 'inside-pitchfork', 'schiff-pitchfork',
  'modified-schiff-pitchfork',
])

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
  return drawing.options
}

export function getDrawingAppearance(drawing: IDrawing): DrawingAppearance {
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
    strokeColor,
    fillColor,
    textColor,
    lineWidth: Math.max(1, Math.min(8, drawing.style.lineWidth)),
    extendLeft: drawing.options.extendLeft ?? false,
    extendRight: drawing.options.extendRight ?? false,
    supportsExtend: EXTENDABLE_TYPES.has(drawing.type),
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
    rectangleMiddleLine: stored?.rectangleMiddleLine ?? options.showMiddleLine ?? false,
    rectangleMiddleLineColor: normalizeHexColor(stored?.rectangleMiddleLineColor ?? options.middleLineColor ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineColor, DEFAULT_DRAWING_METADATA.rectangleMiddleLineColor),
    rectangleMiddleLineOpacity: clampOpacity(stored?.rectangleMiddleLineOpacity ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineOpacity),
    rectangleMiddleLineWidth: Math.max(1, Math.min(8, Math.round(stored?.rectangleMiddleLineWidth ?? options.middleLineWidth ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineWidth))),
    rectangleMiddleLineStyle: stored?.rectangleMiddleLineStyle ?? DEFAULT_DRAWING_METADATA.rectangleMiddleLineStyle,
    fibonacciDiagonalLine: stored?.fibonacciDiagonalLine ?? options.showDiagonalLine ?? true,
  }
}

export function mergeDrawingAppearance(current: DrawingAppearance, patch: DrawingAppearancePatch): DrawingAppearance {
  return {
    ...current,
    ...patch,
    strokeColor: normalizeHexColor(patch.strokeColor ?? current.strokeColor, current.strokeColor),
    fillColor: normalizeHexColor(patch.fillColor ?? current.fillColor, current.fillColor),
    textColor: normalizeHexColor(patch.textColor ?? current.textColor, current.textColor),
    backgroundColor: normalizeHexColor(patch.backgroundColor ?? current.backgroundColor, current.backgroundColor),
    rectangleMiddleLineColor: normalizeHexColor(patch.rectangleMiddleLineColor ?? current.rectangleMiddleLineColor, current.rectangleMiddleLineColor),
    strokeOpacity: clampOpacity(patch.strokeOpacity ?? current.strokeOpacity),
    fillOpacity: clampOpacity(patch.fillOpacity ?? current.fillOpacity),
    textOpacity: clampOpacity(patch.textOpacity ?? current.textOpacity),
    backgroundOpacity: clampOpacity(patch.backgroundOpacity ?? current.backgroundOpacity),
    rectangleMiddleLineOpacity: clampOpacity(patch.rectangleMiddleLineOpacity ?? current.rectangleMiddleLineOpacity),
    lineWidth: Math.max(1, Math.min(8, Math.round(patch.lineWidth ?? current.lineWidth))),
    rectangleMiddleLineWidth: Math.max(1, Math.min(8, Math.round(patch.rectangleMiddleLineWidth ?? current.rectangleMiddleLineWidth))),
    fontSize: Math.max(9, Math.min(32, Math.round(patch.fontSize ?? current.fontSize))),
    fibonacciLevels: normalizeFibonacciLevels(patch.fibonacciLevels ?? current.fibonacciLevels),
    fibonacciLevelDecimals: Math.max(0, Math.min(8, Math.round(patch.fibonacciLevelDecimals ?? current.fibonacciLevelDecimals))),
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
  const { id: _id, type: _type, lineWidth: _lineWidth, supportsExtend: _supportsExtend, extendLeft, extendRight, ...workbench } = appearance
  const options: DrawingWorkbenchOptions = { extendLeft, extendRight, workbench }
  if (appearance.type === 'rectangle') {
    return {
      ...options,
      showMiddleLine: appearance.rectangleMiddleLine,
      middleLineColor: colorWithOpacity(appearance.rectangleMiddleLineColor, appearance.rectangleMiddleLineOpacity),
      middleLineWidth: appearance.rectangleMiddleLineWidth,
      middleLineDash: lineDashFor(appearance.rectangleMiddleLineStyle),
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
  }
}
