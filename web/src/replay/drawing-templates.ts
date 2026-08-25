import { z } from 'zod'
import { deleteDrawingTemplateRemote, fetchDrawingTemplates, putDrawingTemplate } from '../api/client'
import { preferenceStorage, withTimeout } from '../store/preference-sync'
import {
  DEFAULT_DRAWING_METADATA,
  FIBONACCI_LEVEL_SLOT_COUNT,
  normalizeFibonacciLevels,
  type DrawingAppearance,
  type DrawingAppearancePatch,
} from './drawing-appearance'

export const DRAWING_TEMPLATES_STORAGE_KEY = 'market-replay:drawing-templates:v1'
const HYDRATE_TIMEOUT_MS = 1_200

export type DrawingTemplateAppearance = Required<Omit<DrawingAppearancePatch, 'coordinates'>>

export interface DrawingTemplate {
  id: string
  name: string
  toolType: string
  appearance: DrawingTemplateAppearance
  createdAt: number
  updatedAt: number
}

interface DrawingTemplateStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i)
const fibonacciLevelSchema = z.object({
  value: z.number().finite(),
  visible: z.boolean(),
  color: hexColorSchema,
})
const visibilityRuleSchema = z.object({
  enabled: z.boolean(),
  min: z.number().int().positive(),
  max: z.number().int().positive(),
})
const appearanceSchema = z.object({
  strokeColor: hexColorSchema,
  strokeOpacity: z.number().min(0).max(1),
  borderStyle: z.enum(['solid', 'dashed', 'dotted']),
  fillColor: hexColorSchema,
  fillOpacity: z.number().min(0).max(1),
  drawingBackgroundVisible: z.boolean().default(DEFAULT_DRAWING_METADATA.drawingBackgroundVisible),
  text: z.string(),
  textColor: hexColorSchema,
  textOpacity: z.number().min(0).max(1),
  backgroundColor: hexColorSchema,
  backgroundOpacity: z.number().min(0).max(1),
  textBackgroundVisible: z.boolean().default(DEFAULT_DRAWING_METADATA.textBackgroundVisible),
  textBorderVisible: z.boolean().default(DEFAULT_DRAWING_METADATA.textBorderVisible),
  textWrap: z.boolean().default(DEFAULT_DRAWING_METADATA.textWrap),
  textAnchored: z.boolean().default(DEFAULT_DRAWING_METADATA.textAnchored),
  textAnchorX: z.number().min(0).max(1).default(DEFAULT_DRAWING_METADATA.textAnchorX),
  textAnchorY: z.number().min(0).max(1).default(DEFAULT_DRAWING_METADATA.textAnchorY),
  horizontalAlign: z.enum(['left', 'center', 'right']),
  verticalAlign: z.enum(['top', 'inside', 'bottom']),
  bold: z.boolean(),
  italic: z.boolean(),
  fontSize: z.number().min(8).max(40),
  lineStartStyle: z.enum(['normal', 'arrow']).default(DEFAULT_DRAWING_METADATA.lineStartStyle),
  lineEndStyle: z.enum(['normal', 'arrow']).default(DEFAULT_DRAWING_METADATA.lineEndStyle),
  showMiddlePoint: z.boolean().default(DEFAULT_DRAWING_METADATA.showMiddlePoint),
  showPriceLabels: z.boolean().default(DEFAULT_DRAWING_METADATA.showPriceLabels),
  visibility: z.object({
    seconds: visibilityRuleSchema,
    minutes: visibilityRuleSchema,
    hours: visibilityRuleSchema,
    days: visibilityRuleSchema,
    weeks: visibilityRuleSchema,
    months: visibilityRuleSchema,
  }).default(() => structuredClone(DEFAULT_DRAWING_METADATA.visibility)),
  lineWidth: z.number().min(1).max(8),
  extendLeft: z.boolean(),
  extendRight: z.boolean(),
  fibonacciLevels: z.array(fibonacciLevelSchema).length(FIBONACCI_LEVEL_SLOT_COUNT).default(() => normalizeFibonacciLevels(undefined)),
  fibonacciExtend: z.boolean().default(DEFAULT_DRAWING_METADATA.fibonacciExtend),
  fibonacciLevelDecimals: z.number().int().min(0).max(8).default(DEFAULT_DRAWING_METADATA.fibonacciLevelDecimals),
  fibonacciLabelPosition: z.enum(['left', 'center', 'right']).default(DEFAULT_DRAWING_METADATA.fibonacciLabelPosition),
  fibonacciLabelVerticalPosition: z.enum(['top', 'middle', 'bottom']).default(DEFAULT_DRAWING_METADATA.fibonacciLabelVerticalPosition),
  fibonacciReverse: z.boolean().default(DEFAULT_DRAWING_METADATA.fibonacciReverse),
  fibonacciPrices: z.boolean().default(DEFAULT_DRAWING_METADATA.fibonacciPrices),
  fibonacciLevelLabels: z.boolean().default(DEFAULT_DRAWING_METADATA.fibonacciLevelLabels),
  fibonacciLevelFormat: z.enum(['values', 'percents']).default(DEFAULT_DRAWING_METADATA.fibonacciLevelFormat),
  fibonacciTextVisible: z.boolean().default(DEFAULT_DRAWING_METADATA.fibonacciTextVisible),
  fibonacciTrendLineColor: hexColorSchema.default(DEFAULT_DRAWING_METADATA.fibonacciTrendLineColor),
  fibonacciTrendLineOpacity: z.number().min(0).max(1).default(DEFAULT_DRAWING_METADATA.fibonacciTrendLineOpacity),
  fibonacciTrendLineWidth: z.number().min(1).max(8).default(DEFAULT_DRAWING_METADATA.fibonacciTrendLineWidth),
  fibonacciTrendLineStyle: z.enum(['solid', 'dashed', 'dotted']).default(DEFAULT_DRAWING_METADATA.fibonacciTrendLineStyle),
  rectangleMiddleLine: z.boolean().default(DEFAULT_DRAWING_METADATA.rectangleMiddleLine),
  rectangleMiddleLineColor: hexColorSchema.default(DEFAULT_DRAWING_METADATA.rectangleMiddleLineColor),
  rectangleMiddleLineOpacity: z.number().min(0).max(1).default(DEFAULT_DRAWING_METADATA.rectangleMiddleLineOpacity),
  rectangleMiddleLineWidth: z.number().min(1).max(8).default(DEFAULT_DRAWING_METADATA.rectangleMiddleLineWidth),
  rectangleMiddleLineStyle: z.enum(['solid', 'dashed', 'dotted']).default(DEFAULT_DRAWING_METADATA.rectangleMiddleLineStyle),
  fibonacciDiagonalLine: z.boolean().default(DEFAULT_DRAWING_METADATA.fibonacciDiagonalLine),
  positionAccountSize: z.number().min(0).default(DEFAULT_DRAWING_METADATA.positionAccountSize),
  positionLotSize: z.number().positive().default(DEFAULT_DRAWING_METADATA.positionLotSize),
  positionRisk: z.number().min(0).default(DEFAULT_DRAWING_METADATA.positionRisk),
  positionRiskMode: z.enum(['percent', 'cash']).default(DEFAULT_DRAWING_METADATA.positionRiskMode),
  positionLeverage: z.number().min(0).default(DEFAULT_DRAWING_METADATA.positionLeverage),
  positionQtyPrecision: z.union([z.literal('default'), z.number().int().min(0).max(8)]).default(DEFAULT_DRAWING_METADATA.positionQtyPrecision),
  positionStopColor: hexColorSchema.default(DEFAULT_DRAWING_METADATA.positionStopColor),
  positionStopOpacity: z.number().min(0).max(1).default(DEFAULT_DRAWING_METADATA.positionStopOpacity),
  positionTargetColor: hexColorSchema.default(DEFAULT_DRAWING_METADATA.positionTargetColor),
  positionTargetOpacity: z.number().min(0).max(1).default(DEFAULT_DRAWING_METADATA.positionTargetOpacity),
  positionPriceLabels: z.boolean().default(DEFAULT_DRAWING_METADATA.positionPriceLabels),
  positionStats: z.array(z.enum(['tp-price-offset', 'tp-percent-offset', 'tp-tick-offset', 'tp-amount', 'tp-pl', 'open-closed-pl', 'qty', 'risk-reward-ratio', 'sl-price-offset', 'sl-percent-offset', 'sl-tick-offset', 'sl-amount', 'sl-pl'])).default(DEFAULT_DRAWING_METADATA.positionStats),
  positionCompactStats: z.boolean().default(DEFAULT_DRAWING_METADATA.positionCompactStats),
  positionAlwaysShowStats: z.boolean().default(DEFAULT_DRAWING_METADATA.positionAlwaysShowStats),
  rangeLabelBackgroundVisible: z.boolean().default(DEFAULT_DRAWING_METADATA.rangeLabelBackgroundVisible),
  rangeStats: z.array(z.enum(['price-range', 'percent-change', 'change-in-pips', 'bars-range', 'date-time-range', 'volume'])).default(DEFAULT_DRAWING_METADATA.rangeStats),
})

const drawingTemplateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  toolType: z.string().min(1),
  appearance: appearanceSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
})

const drawingTemplatesSchema = z.array(drawingTemplateSchema)

function getBrowserStorage(): DrawingTemplateStorage | null {
  return typeof window === 'undefined' ? null : preferenceStorage
}

function createTemplateId(now: number): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return `drawing-template-${now}`
}

export function drawingAppearanceToTemplate(appearance: DrawingAppearance): DrawingTemplateAppearance {
  const { id: _id, type: _type, locked: _locked, supportsExtend: _supportsExtend, coordinates: _coordinates, positionTickSize: _positionTickSize, positionPricePrecision: _positionPricePrecision, rangeVolume: _rangeVolume, rangeBarIntervalSeconds: _rangeBarIntervalSeconds, ...template } = appearance
  return template
}

export function defaultDrawingTemplateAppearance(drawing: DrawingAppearance): DrawingTemplateAppearance {
  const extendLeft = drawing.type === 'extended-line'
  const extendRight = drawing.type === 'extended-line' || drawing.type === 'ray' || drawing.type === 'horizontal-ray'
  const isPosition = drawing.type === 'long-position' || drawing.type === 'short-position'
  return {
    ...drawingAppearanceToTemplate(drawing),
    ...DEFAULT_DRAWING_METADATA,
    fibonacciLevels: DEFAULT_DRAWING_METADATA.fibonacciLevels.map((level) => ({ ...level })),
    ...(isPosition ? { strokeColor: '#9e9e9e', textColor: '#ffffff', fontSize: 12 } : {}),
    lineWidth: isPosition ? 1 : 2,
    extendLeft,
    extendRight,
  }
}

export function parseDrawingTemplates(raw: string | null): DrawingTemplate[] {
  if (!raw) return []
  try {
    const result = drawingTemplatesSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : []
  } catch {
    return []
  }
}

export function loadDrawingTemplates(storage: DrawingTemplateStorage | null = getBrowserStorage()): DrawingTemplate[] {
  return storage ? parseDrawingTemplates(storage.getItem(DRAWING_TEMPLATES_STORAGE_KEY)) : []
}

export function persistDrawingTemplates(templates: DrawingTemplate[], storage: DrawingTemplateStorage | null = getBrowserStorage()): void {
  if (!storage) return
  const validated = drawingTemplatesSchema.parse(templates)
  storage.setItem(DRAWING_TEMPLATES_STORAGE_KEY, JSON.stringify(validated))
}

/**
 * Pulls the server's drawing templates into the local cache before the
 * toolbar's initial `useState(loadDrawingTemplates)` read runs — mirrors
 * hydratePreferences in store/preference-sync.ts (bounded, never rejects: a
 * slow or unreachable backend delays the workspace, it does not stop it).
 */
export async function hydrateDrawingTemplates(storage: DrawingTemplateStorage | null = getBrowserStorage()): Promise<void> {
  if (!storage) return
  try {
    const remote = await withTimeout(fetchDrawingTemplates(), HYDRATE_TIMEOUT_MS, 'drawing template hydrate timed out')
    const parsed = drawingTemplatesSchema.safeParse(remote)
    if (parsed.success) storage.setItem(DRAWING_TEMPLATES_STORAGE_KEY, JSON.stringify(parsed.data))
  } catch {
    // Keep whatever this browser already had.
  }
}

/** Fire-and-forget mirror of a local template save to the backend — local storage is already the source of truth by the time this is called. */
export function syncDrawingTemplateUpsert(template: DrawingTemplate): void {
  void putDrawingTemplate(template).catch(() => undefined)
}

/** Fire-and-forget mirror of a local template delete to the backend. */
export function syncDrawingTemplateDelete(id: string): void {
  void deleteDrawingTemplateRemote(id).catch(() => undefined)
}

export function saveNamedDrawingTemplate(
  templates: DrawingTemplate[],
  name: string,
  drawing: DrawingAppearance,
  now: number = Date.now(),
  idFactory: (timestamp: number) => string = createTemplateId,
): DrawingTemplate[] {
  const normalizedName = name.trim()
  if (!normalizedName) throw new Error('Template name is required')

  const existing = templates.find((template) => template.toolType === drawing.type && template.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase())
  const next: DrawingTemplate = {
    id: existing?.id ?? idFactory(now),
    name: normalizedName,
    toolType: drawing.type,
    appearance: drawingAppearanceToTemplate(drawing),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  }
  return existing ? templates.map((template) => template.id === existing.id ? next : template) : [...templates, next]
}

export function deleteDrawingTemplate(templates: DrawingTemplate[], id: string): DrawingTemplate[] {
  return templates.filter((template) => template.id !== id)
}
