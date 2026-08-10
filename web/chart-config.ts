// Default per-tool drawing styles (color/width/fill for trendline, Fib,
// zones, ...) — docs §14.1 calls this out as living at exactly this path,
// version-controlled like a "DESIGN.md for the chart". Filled in once the
// drawing plugin (deepentropy/lightweight-charts-drawing, forked into
// web/vendor/ per §14.0) is wired up; the shape below is a starting point,
// not final.
export interface ChartStyleConfig {
  trendline: { color: string; width: number }
  fibonacci: { color: string; width: number }
  zone: { fillColor: string; opacity: number }
}

export const defaultChartStyle: ChartStyleConfig = {
  trendline: { color: '#60a5fa', width: 1 },
  fibonacci: { color: '#facc15', width: 1 },
  zone: { fillColor: '#60a5fa', opacity: 0.1 },
}
