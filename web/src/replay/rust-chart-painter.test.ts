import { describe, expect, it } from 'vitest'
import { createRustIndicatorScale } from './rust-chart-indicator-painter'
import { measureRustChartLayout, paintRustChart } from './rust-chart-painter'
import { DEFAULT_CHART_APPEARANCE } from './chart-settings'
import { DEFAULT_CHART_TIMEZONE } from './chart-timezone'

function canvas(width: number, height: number): HTMLCanvasElement {
  return { clientWidth: width, clientHeight: height, width, height } as HTMLCanvasElement
}

type Point = readonly [number, number]

function recordingContext(): {
  context: CanvasRenderingContext2D
  strokes: Array<{ color: string; points: Point[] }>
  labels: string[]
} {
  const strokes: Array<{ color: string; points: Point[] }> = []
  const labels: string[] = []
  let points: Point[] = []
  let strokeStyle = ''
  const context = {
    get strokeStyle() {
      return strokeStyle
    },
    set strokeStyle(value: string) {
      strokeStyle = value
    },
    save() {},
    restore() {},
    setTransform() {},
    fillRect() {},
    strokeRect() {},
    fillText(text: string) {
      labels.push(text)
    },
    rect() {},
    clip() {},
    beginPath() {
      points = []
    },
    moveTo(x: number, y: number) {
      points.push([x, y])
    },
    lineTo(x: number, y: number) {
      points.push([x, y])
    },
    stroke() {
      strokes.push({ color: strokeStyle, points: [...points] })
    },
  } as unknown as CanvasRenderingContext2D
  return { context, strokes, labels }
}

describe('Rust chart painter layout', () => {
  it('shares plot and volume dimensions for the Rust geometry', () => {
    expect(measureRustChartLayout(canvas(1100, 640), true, 120)).toEqual({
      width: 1100,
      height: 640,
      plotWidth: 1024,
      plotHeight: 612,
      priceHeight: 492,
      volumeHeight: 120,
      priceAxisWidth: 76,
      timeAxisHeight: 28,
      indicatorPanes: [],
    })
  })

  it('omits the volume pane when hidden and rejects zero-sized surfaces', () => {
    expect(measureRustChartLayout(canvas(600, 400), false)?.volumeHeight).toBe(0)
    expect(measureRustChartLayout(canvas(0, 400), true)).toBeNull()
  })
  it('reserves distinct indicator panes below volume while preserving the main price area', () => {
    expect(measureRustChartLayout(canvas(1100, 640), true, 120, [{ index: 2, height: 120 }])).toMatchObject({
      priceHeight: 372,
      volumeHeight: 120,
      indicatorPanes: [{ index: 2, top: 492, height: 120 }],
    })
    const crowded = measureRustChartLayout(
      canvas(600, 240),
      true,
      120,
      Array.from({ length: 4 }, (_, index) => ({ index: index + 2, height: 120 })),
    )
    expect(crowded?.priceHeight).toBeGreaterThanOrEqual(64)
    expect(crowded?.indicatorPanes.reduce((total, pane) => total + pane.height, 0)).toBeLessThanOrEqual(
      (crowded?.plotHeight ?? 0) - (crowded?.volumeHeight ?? 0) - 64,
    )
  })

  it('draws a continuous close-price path in line mode', () => {
    const { context, strokes } = recordingContext()
    const geometry = new Float64Array([
      0, 60, 300, 220, 70, 120, 0, 0, 1, 1,
      1, 120, 320, 230, 80, 90, 0, 0, 1, 1,
      2, 180, 310, 200, 90, 150, 0, 0, 0, 1,
    ])
    paintRustChart({
      context,
      canvas: canvas(1100, 640),
      geometry,
      engine: {
        visibleRange: () => ({ from: 0, to: 2 }),
        priceRange: () => ({ min: 0, max: 100 }),
        priceScaleMode: () => 'normal',
        priceToScaleValue: (price) => price,
        logicalToTime: (logical) => 1_700_000_000 + Math.round(logical),
        xToTime: (x) => 1_700_000_000 + Math.round(x),
        priceToY: (price) => 492 - price * 4.92,
        yToPrice: (y) => (492 - y) / 4.92,
      },
      appearance: { ...DEFAULT_CHART_APPEARANCE, chartType: 'line', showVolume: false },
      symbol: { priceDecimals: 2 },
      timezone: DEFAULT_CHART_TIMEZONE,
    })

    const line = strokes.find((stroke) => stroke.color === DEFAULT_CHART_APPEARANCE.upColor)
    expect(line?.points).toEqual([[60, 120], [120, 90], [180, 150]])
  })

  it('formats main price-axis ticks as percentages in percentage mode', () => {
    const { context, labels } = recordingContext()
    const geometry = new Float64Array([
      0, 60, 300, 220, 70, 120, 0, 0, 1, 1,
      1, 120, 320, 230, 80, 90, 0, 0, 1, 1,
      2, 180, 310, 200, 90, 150, 0, 0, 0, 1,
    ])
    paintRustChart({
      context,
      canvas: canvas(1100, 640),
      geometry,
      engine: {
        visibleRange: () => ({ from: 0, to: 2 }),
        priceRange: () => ({ min: 10, max: 20 }),
        priceScaleMode: () => 'percentage',
        priceToScaleValue: (price) => ((price - 10) / 10) * 100,
        logicalToTime: (logical) => 1_700_000_000 + Math.round(logical),
        xToTime: (x) => 1_700_000_000 + Math.round(x),
        priceToY: (price) => (20 - price) * 49.2,
        yToPrice: (y) => 20 - y / 49.2,
      },
      appearance: { ...DEFAULT_CHART_APPEARANCE, chartType: 'line', showVolume: false },
      symbol: { priceDecimals: 2 },
      timezone: DEFAULT_CHART_TIMEZONE,
    })

    const priceLabels = labels.filter((label) => label.endsWith('%'))
    expect(priceLabels).toHaveLength(6)
    expect(priceLabels.every((label) => label.endsWith('%'))).toBe(true)
  })
  it('matches Lightweight Charts logarithmic and percentage transforms', () => {
    const logarithmic = createRustIndicatorScale(1, null)
    for (const value of [-100, -1, 0, 1, 100]) {
      const scaled = logarithmic.toScale(value)
      expect(scaled).not.toBeNull()
      expect(logarithmic.fromScale(scaled!)).toBeCloseTo(value, 8)
    }

    const positiveBase = createRustIndicatorScale(2, 100)
    expect(positiveBase.toScale(110)).toBeCloseTo(10)
    expect(positiveBase.fromScale(10)).toBeCloseTo(110)

    const negativeBase = createRustIndicatorScale(2, -10)
    expect(negativeBase.toScale(-12)).toBeCloseTo(-20)
    expect(negativeBase.fromScale(-20)).toBeCloseTo(-12)
    expect(negativeBase.formatScale(-20)).toBe('-20.00%')

    const zeroBase = createRustIndicatorScale(2, 0)
    expect(zeroBase.toScale(25)).toBe(25)
    expect(zeroBase.fromScale(25)).toBe(25)
    expect(zeroBase.formatScale(25)).toBe('25.00')
  })

})
