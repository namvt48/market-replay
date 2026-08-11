import { describe, expect, it, vi } from 'vitest'
import type { EconomicEventMarker } from './chart-adapter'
import { EconomicEventMarkersPrimitive, economicMarkerUsesUsFlag, layoutEconomicEventMarkers } from './economic-event-markers-primitive'

function marker(id: string, time: number, state: EconomicEventMarker['state'] = 'scheduled'): EconomicEventMarker {
  return { id, time, country: 'US', currency: 'USD', title: id, importance: 'high', state }
}

describe('EconomicEventMarkersPrimitive', () => {
  it('uses a US flag visual instead of a US text badge', () => {
    expect(economicMarkerUsesUsFlag(marker('nfp', 100))).toBe(true)
    expect(economicMarkerUsesUsFlag({ ...marker('ecb', 100), country: 'EU', currency: 'EUR' })).toBe(false)
  })

  it('merges overlapping releases and promotes a contained high-impact event', () => {
    const layout = layoutEconomicEventMarkers(
      [
        { ...marker('claims', 100), importance: 'medium' },
        marker('cpi', 100),
        { ...marker('pmi', 101), importance: 'low' },
      ],
      (timestamp) => timestamp,
      300,
      120,
      220,
    )

    expect(layout).toHaveLength(1)
    expect(layout[0]).toMatchObject({ count: 3, marker: expect.objectContaining({ id: 'cpi', importance: 'high' }) })
    expect(layout.every((item) => item.y < 120)).toBe(true)
  })

  it('progressively separates a dense release cluster as the chart zooms in', () => {
    const releases = [marker('cpi', 100), marker('claims', 100), marker('pmi', 100), marker('jobs', 100)]
    const coordinate = (timestamp: number): number => timestamp

    expect(layoutEconomicEventMarkers(releases, coordinate, 300, 140, 220)).toHaveLength(1)
    expect(layoutEconomicEventMarkers(releases, coordinate, 300, 140, 100)).toHaveLength(2)
    expect(layoutEconomicEventMarkers(releases, coordinate, 300, 140, 50)).toHaveLength(4)
  })

  it('drops invalid events and requests one repaint after an update', () => {
    const primitive = new EconomicEventMarkersPrimitive()
    const requestUpdate = vi.fn()
    primitive.attached({
      chart: { timeScale: () => ({ timeToCoordinate: () => 10, getVisibleLogicalRange: () => ({ from: 0, to: 220 }) }) },
      series: {},
      requestUpdate,
    } as never)

    primitive.setMarkers([
      marker('nfp', 100, 'next'),
      marker('', 200),
      marker('bad-time', Number.NaN),
    ])

    expect(primitive.markers.map((item) => item.id)).toEqual(['nfp'])
    expect(requestUpdate).toHaveBeenCalledOnce()
  })
})
