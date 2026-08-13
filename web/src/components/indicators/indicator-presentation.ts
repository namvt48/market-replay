import {
  CalendarDays,
  ChartNoAxesCombined,
  ChartSpline,
  Clock3,
  Flag,
  GitBranch,
  Layers3,
  type LucideIcon,
} from 'lucide-react'
import type { IndicatorDescriptor } from '../../api/types'

export interface IndicatorPresentation {
  family: string
  summary: string
  code: string
  icon: LucideIcon
}

const BUILTIN_PRESENTATION: Readonly<Record<string, IndicatorPresentation>> = {
  'gb69-cbmor': {
    family: 'Range models',
    summary: 'Goldbach, Range 69 and CB MOR projection levels',
    code: 'GB69',
    icon: ChartNoAxesCombined,
  },
  'day-separator': {
    family: 'Sessions & time',
    summary: 'Marks each New York midnight on the chart',
    code: 'DAY',
    icon: CalendarDays,
  },
  killzones: {
    family: 'Sessions & time',
    summary: 'Asia, London and New York session range boxes',
    code: 'KZ',
    icon: Clock3,
  },
  'open-price-markers': {
    family: 'Reference levels',
    summary: 'Tracks configurable daily opening prices',
    code: 'OPEN',
    icon: Flag,
  },
  fractals: {
    family: 'Market structure',
    summary: 'Confirmed swing-high and swing-low pivots',
    code: 'FRACT',
    icon: GitBranch,
  },
  'ipda-ranges': {
    family: 'Range models',
    summary: '20, 40 and 60-day premium, equilibrium and discount',
    code: 'IPDA',
    icon: Layers3,
  },
}

export const INDICATOR_FAMILY_ORDER = ['Range models', 'Sessions & time', 'Market structure', 'Reference levels', 'Other'] as const

export function getIndicatorPresentation(descriptor: IndicatorDescriptor): IndicatorPresentation {
  return BUILTIN_PRESENTATION[descriptor.id] ?? {
    family: 'Other',
    summary: descriptor.meta.onMainPanel ? 'Overlays the main price chart' : 'Runs in a separate indicator pane',
    code: descriptor.name.slice(0, 5).toUpperCase(),
    icon: ChartSpline,
  }
}

export function indicatorMatchesQuery(descriptor: IndicatorDescriptor, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return true
  const presentation = getIndicatorPresentation(descriptor)
  return [descriptor.name, descriptor.id, presentation.family, presentation.summary]
    .some((value) => value.toLocaleLowerCase().includes(normalized))
}
