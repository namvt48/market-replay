import { z } from 'zod'

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i)

export const chartAppearanceSchema = z.object({
  upColor: hexColorSchema,
  downColor: hexColorSchema,
  wickUpColor: hexColorSchema,
  wickDownColor: hexColorSchema,
  borderUpColor: hexColorSchema,
  borderDownColor: hexColorSchema,
  borderVisible: z.boolean(),
  backgroundColor: hexColorSchema,
  textColor: hexColorSchema.default('#a3a6af'),
  showGrid: z.boolean(),
  verticalGridColor: hexColorSchema,
  horizontalGridColor: hexColorSchema,
  showVolume: z.boolean(),
})

export type ChartAppearanceSettings = z.infer<typeof chartAppearanceSchema>

export const DEFAULT_CHART_APPEARANCE: ChartAppearanceSettings = {
  upColor: '#089981',
  downColor: '#f23645',
  wickUpColor: '#089981',
  wickDownColor: '#f23645',
  borderUpColor: '#089981',
  borderDownColor: '#f23645',
  borderVisible: false,
  backgroundColor: '#131722',
  textColor: '#a3a6af',
  showGrid: true,
  verticalGridColor: '#2a2e39',
  horizontalGridColor: '#2a2e39',
  showVolume: true,
}

const persistedSchema = z.object({ version: z.literal(1), appearance: chartAppearanceSchema })

export function parseChartAppearance(input: unknown): ChartAppearanceSettings {
  const parsed = persistedSchema.safeParse(input)
  return parsed.success ? parsed.data.appearance : { ...DEFAULT_CHART_APPEARANCE }
}

export function serializeChartAppearance(appearance: ChartAppearanceSettings): string {
  return JSON.stringify({ version: 1, appearance: chartAppearanceSchema.parse(appearance) })
}
