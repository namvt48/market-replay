import { describe, expect, it } from 'vitest'
import { DEFAULT_CHART_APPEARANCE, parseChartAppearance } from './chart-settings'
import { chartPaneSettingsSchema, DEFAULT_CHART_PANE_SETTINGS } from './chart-settings-store'

describe('chart appearance settings', () => {
  it('upgrades existing saved settings with the axis text color default', () => {
    const { textColor: _textColor, ...legacyAppearance } = DEFAULT_CHART_APPEARANCE
    expect(parseChartAppearance({ version: 1, appearance: legacyAppearance })).toEqual(DEFAULT_CHART_APPEARANCE)
  })

  it('drops the legacy pane-scoped market session', () => {
    const parsed = chartPaneSettingsSchema.parse({ ...DEFAULT_CHART_PANE_SETTINGS, marketSession: 'rth' })
    expect(parsed).toEqual(DEFAULT_CHART_PANE_SETTINGS)
    expect('marketSession' in parsed).toBe(false)
  })
})
