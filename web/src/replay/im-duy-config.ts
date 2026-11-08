// This Pine Script™ code is subject to the terms of the Mozilla Public License 2.0 at https://mozilla.org/MPL/2.0/
// © I'm Duy
import type { IndicatorDescriptor, IndicatorInputDescriptor, IndicatorInputValue } from '../api/types'
interface IndicatorColor { r: number; g: number; b: number; a: number }

export const NY = 'America/New_York'
export const MAX_DRAWS = 500
export const HTF_DEFAULTS: [string, number][] = [
  ['5', 10], ['15', 10], ['60', 10], ['240', 10], ['1D', 10], ['1W', 10],
]
export const MACROS: [string, number, number][] = [
  ['02:45 - 03:15', 165, 195],
  ['03:45 - 04:15', 225, 255],
  ['08:45 - 09:15', 525, 555],
  ['09:45 - 10:15', 585, 615],
  ['10:45 - 11:15', 645, 675],
  ['11:45 - 12:15', 705, 735],
  ['13:10 - 13:40', 790, 820],
  ['15:15 - 15:45', 915, 945],
  ['18:45 - 19:15', 1125, 1155],
  ['19:45 - 20:15', 1185, 1215],
  ['20:45 - 21:15', 1245, 1275],
  ['21:45 - 22:15', 1305, 1335],
  ['Zeussy Macro: 02:45 - 03:15', 165, 195],
  ['Zeussy Macro: 03:45 - 04:15', 225, 255],
  ['Zeussy Macro: 09:45 - 10:15', 585, 615],
  ['Zeussy Macro: 10:45 - 11:15', 645, 675],
  ['Zeussy Macro: 13:45 - 14:15', 825, 855],
  ['Zeussy Macro: 14:45 - 15:15', 885, 915],
]
export const KILLZONES: [string, string, boolean][] = [
  ['Asia', '2000-0000', true],
  ['London', '0200-0500', true],
  ['NY AM', '0830-1100', true],
  ['NY Lunch', '1200-1300', false],
  ['NY PM', '1300-1600', true],
]
export const OPEN_DEFAULTS: [string, string, boolean][] = [
  ['00:00', '0000-0001', true],
  ['08:30', '0830-0831', true],
  ['09:30', '0930-0931', true],
  ['00:00', '0000-0001', false],
  ['00:00', '0000-0001', false],
]
const color = (
  r: number,
  g: number,
  b: number,
  a = 1,
): IndicatorInputValue => ({ r, g, b, a })
const inputs: IndicatorInputDescriptor[] = []
const add = (
  key: string,
  label: string,
  kind: IndicatorInputDescriptor['kind'],
  value: IndicatorInputValue,
  group: string,
  extra: Partial<IndicatorInputDescriptor> = {},
): void => {
  inputs.push({ key, label, kind, default: value, group, ...extra })
}

for (let index = 0; index < 6; index += 1) {
  add(`htf${index + 1}Show`, `HTF ${index + 1} enabled`, 'bool', true, 'HTF Candles')
  add(`htf${index + 1}Timeframe`, `HTF ${index + 1} timeframe`, 'str',
    HTF_DEFAULTS[index][0], 'HTF Candles')
  add(`htf${index + 1}Count`, `HTF ${index + 1} history`, 'int', 10,
    'HTF Candles', { min: 1, max: 100 })
}
add('maxSets', 'Limit to next HTFs only', 'int', 6, 'HTF Candles', { min: 1, max: 6 })
add('customDaily', 'Custom daily candle open', 'bool', false, 'HTF Candles')
add('customDailyAt', 'Custom daily boundary', 'str', 'Midnight', 'HTF Candles',
  { options: ['Midnight', '8:30', '9:30'] })

const htfColorInputs: [string, string, IndicatorColor][] = [
  ['bullBody', 'Bull body', { r: 0, g: 128, b: 0, a: 0.9 }],
  ['bearBody', 'Bear body', { r: 255, g: 0, b: 0, a: 0.9 }],
  ['bullBorder', 'Bull border', { r: 0, g: 0, b: 0, a: 0.9 }],
  ['bearBorder', 'Bear border', { r: 0, g: 0, b: 0, a: 0.9 }],
  ['bullWick', 'Bull wick', { r: 0, g: 0, b: 0, a: 0.9 }],
  ['bearWick', 'Bear wick', { r: 0, g: 0, b: 0, a: 0.9 }],
]
for (const [key, label, value] of htfColorInputs) add(key, label, 'color', value, 'HTF Style')
add('offset', 'Padding from current candles', 'int', 10, 'HTF Style', { min: 1, max: 100 })
add('buffer', 'Space between candles', 'int', 1, 'HTF Style', { min: 1, max: 4 })
add('htfBuffer', 'Space between higher timeframes', 'int', 10, 'HTF Style', { min: 1, max: 10 })
add('width', 'Candle width', 'int', 2, 'HTF Style', { min: 1, max: 8 })

add('htfLabelShow', 'HTF label', 'bool', true, 'HTF Labels')
add('htfLabelColor', 'HTF label color', 'color', color(0, 0, 0, 0.9), 'HTF Labels')
add('labelPosition', 'Label positions', 'str', 'Both', 'HTF Labels',
  { options: ['Both', 'Top', 'Bottom'] })
add('labelAlignment', 'Label alignment', 'str', 'Align', 'HTF Labels',
  { options: ['Align', 'Follow Candles'] })
add('timerShow', 'Remaining time', 'bool', true, 'HTF Labels')
add('timerColor', 'Timer color', 'color', color(0, 0, 0, 0.9), 'HTF Labels')
add('dailyName', 'Interval value / weekday', 'bool', false, 'HTF Labels')
add('dowColor', 'Weekday label color', 'color', color(0, 0, 0), 'HTF Labels')
add('htfLabelSize', 'HTF label size', 'str', 'large', 'HTF Labels',
  { options: ['tiny', 'small', 'normal', 'large', 'huge'] })
add('timerSize', 'Timer size', 'str', 'normal', 'HTF Labels',
  { options: ['tiny', 'small', 'normal', 'large', 'huge'] })
add('dowSize', 'Weekday size', 'str', 'small', 'HTF Labels',
  { options: ['tiny', 'small', 'normal', 'large', 'huge'] })

for (const key of ['Open', 'Close', 'High', 'Low']) {
  add(`trace${key}Color`, `${key} trace color`, 'color', color(128, 128, 128, 0.5), 'Trace')
  add(`trace${key}Style`, `${key} trace style`, 'str', '····', 'Trace',
    { options: ['⎯⎯⎯', '----', '····'] })
  add(`trace${key}Width`, `${key} trace width`, 'int', 1, 'Trace', { min: 1, max: 4 })
}
add('priceLabelSize', 'Price label size', 'str', 'small', 'Trace',
  { options: ['tiny', 'small', 'normal', 'large', 'huge'] })
add('openLabelSize', 'Open-price label size', 'str', 'normal', 'Open Price',
  { options: ['auto', 'tiny', 'small', 'normal', 'large', 'huge'] })
add('textTransparency', 'Text transparency', 'int', 50, 'Killzone', { min: 0, max: 100 })

add('watermarkBackground', 'Watermark background', 'color', color(255, 255, 255, 0), 'Watermark')
add('watermarkTextVertical', 'Text vertical position', 'str', 'top', 'Watermark',
  { options: ['top', 'middle', 'bottom'] })
add('watermarkTextHorizontal', 'Text horizontal position', 'str', 'center', 'Watermark',
  { options: ['left', 'center', 'right'] })
add('watermarkSymbolVertical', 'Symbol vertical position', 'str', 'bottom', 'Watermark',
  { options: ['top', 'middle', 'bottom'] })
add('watermarkSymbolHorizontal', 'Symbol horizontal position', 'str', 'center', 'Watermark',
  { options: ['left', 'center', 'right'] })
add('watermarkTitleColor', 'Title color', 'color', color(0, 0, 0), 'Watermark')
add('watermarkTitleSize', 'Title size', 'str', 'large', 'Watermark',
  { options: ['tiny', 'small', 'normal', 'large', 'huge', 'auto'] })
add('watermarkTitleAlign', 'Title alignment', 'str', 'center', 'Watermark',
  { options: ['center', 'left', 'right'] })
add('watermarkSubtitleColor', 'Subtitle color', 'color', color(0, 0, 0), 'Watermark')
add('watermarkSubtitleSize', 'Subtitle size', 'str', 'normal', 'Watermark',
  { options: ['tiny', 'small', 'normal', 'large', 'huge', 'auto'] })
add('watermarkSubtitleAlign', 'Subtitle alignment', 'str', 'center', 'Watermark',
  { options: ['center', 'left', 'right'] })
add('watermarkSymbolColor', 'Symbol color', 'color', color(0, 0, 0), 'Watermark')
add('watermarkSymbolSize', 'Symbol size', 'str', 'normal', 'Watermark',
  { options: ['tiny', 'small', 'normal', 'large', 'huge', 'auto'] })
add('watermarkSymbolAlign', 'Symbol alignment', 'str', 'center', 'Watermark',
  { options: ['center', 'left', 'right'] })
add('watermarkTitle', 'Watermark title', 'str', 'TEXT', 'Watermark')
add('watermarkSubtitle', 'Watermark subtitle', 'str',
  'PATIENCE  |  DISCIPLINE  |  FEARLESS', 'Watermark')
add('watermarkShow', 'Show watermark', 'bool', true, 'Watermark')

add('fvgShow', 'Fair Value Gap', 'bool', true, 'Imbalance')
add('fvgColor', 'FVG color', 'color', color(128, 128, 128, 0.2), 'Imbalance')
add('viShow', 'Volume Imbalance', 'bool', true, 'Imbalance')
add('viColor', 'VI color', 'color', color(255, 0, 0, 0.5), 'Imbalance')
add('traceShow', 'Trace lines', 'bool', false, 'Trace')
add('traceAnchor', 'Anchor to', 'str', 'First Timeframe', 'Trace',
  { options: ['First Timeframe', 'Last Timeframe'] })
add('priceLabelShow', 'Price labels', 'bool', false, 'Trace')
add('traceColor', 'Trace color', 'color', color(128, 128, 128, 0.5), 'Trace')
add('priceLabelColor', 'Price label color', 'color', color(0, 0, 0, 0.9), 'Trace')

add('showFractals', 'Show Fractal', 'bool', true, 'Fractals')
add('swingLength', 'Swing Length', 'int', 3, 'Fractals', { min: 3, max: 50 })
add('swingHighChar', 'Swing high character', 'str', '⮝', 'Fractals')
add('swingHighColor', 'Swing high color', 'color', color(255, 0, 0), 'Fractals')
add('swingLowChar', 'Swing low character', 'str', '⮟', 'Fractals')
add('swingLowColor', 'Swing low color', 'color', color(0, 128, 0), 'Fractals')
add('showSeparator', 'Show Day Separator', 'bool', true, 'Day Separator')
add('lineColor', 'Separator color', 'color', color(0, 0, 0), 'Day Separator')
add('lineStyle', 'Separator style', 'str', 'Dotted', 'Day Separator',
  { options: ['Solid', 'Dotted', 'Dashed'] })
add('lineWidth', 'Separator width', 'int', 1, 'Day Separator', { min: 1, max: 4 })
add('showDividerAndDow', 'Show Daily Divider & Days Of Week', 'bool', true, 'Daily Divider')
add('dividerColor', 'Divider and weekday color', 'color', color(0, 0, 0), 'Daily Divider')
add('dowLocation', 'Days of Week Labels', 'str', 'Bottom', 'Daily Divider',
  { options: ['Top', 'Bottom'] })

add('showMacro', 'Show Macro Time', 'bool', true, 'Macro Time')
add('macroLabel', 'Macro label', 'bool', true, 'Macro Time')
add('macroTime', 'Show time', 'bool', false, 'Macro Time')
add('macroProjections', 'Macro projections', 'bool', false, 'Macro Time')
add('macroColor', 'Macro color', 'color', color(0, 0, 0), 'Macro Time')
MACROS.forEach(([name], index) => add(`macro${index + 1}`, name, 'bool', false, 'Macro Time'))

add('showKillzone', 'Show Killzone', 'bool', true, 'Killzone')
add('maxDays', 'Session drawing limit', 'int', 1, 'Killzone', { min: 1, max: 30 })
add('tfLimit', 'Timeframe limit', 'str', '15', 'Killzone')
add('showKzBoxes', 'Show Killzone Boxes', 'bool', true, 'Killzone')
add('showKzText', 'Display Text', 'bool', false, 'Killzone')
KILLZONES.forEach(([name, session, enabled], index) => {
  add(`kz${index + 1}Show`, `${name} enabled`, 'bool', enabled, 'Killzone')
  add(`kz${index + 1}Text`, `${name} label`, 'str', name, 'Killzone')
  add(`kz${index + 1}Session`, `${name} session`, 'session', session, 'Killzone')
  add(`kz${index + 1}Color`, `${name} color`, 'color', color(0, 0, 0), 'Killzone')
})
add('boxTransparency', 'Box transparency', 'int', 90, 'Killzone', { min: 0, max: 100 })

add('showOpenPrice', 'Show Open Price', 'bool', true, 'Open Price')
add('openTextColor', 'Text color', 'color', color(0, 0, 0), 'Open Price')
add('openStyle', 'Style', 'str', 'Dotted', 'Open Price',
  { options: ['Solid', 'Dashed', 'Dotted'] })
add('openWidth', 'Width', 'int', 1, 'Open Price', { min: 1, max: 4 })
for (let index = 0; index < OPEN_DEFAULTS.length; index += 1) {
  const [label, session, enabled] = OPEN_DEFAULTS[index]
  add(`open${index + 1}Show`, `Open level ${index + 1} enabled`, 'bool', enabled, 'Open Price')
  add(`open${index + 1}Text`, `Open level ${index + 1} label`, 'str', label, 'Open Price')
  add(`open${index + 1}Session`, `Open level ${index + 1} session`, 'session', session, 'Open Price')
  add(`open${index + 1}Color`, `Open level ${index + 1} color`, 'color',
    color(0, 0, 0), 'Open Price')
}


add('alerts', 'Alerts? (replay markers)', 'bool', false, 'IPDA')
add('plotType', 'IPDA Plot Format', 'str', 'Boxes', 'IPDA',
  { options: ['Boxes', 'Table A', 'Table B'] })
add('showIpdaText', 'Show Text', 'bool', true, 'IPDA')
add('discountColor', 'Discount', 'color', color(128, 0, 0, 0.2), 'IPDA')
add('equilibriumColor', 'Equilibrium', 'color', color(0, 0, 0), 'IPDA')
add('premiumColor', 'Premium', 'color', color(0, 0, 128, 0.2), 'IPDA')
for (const period of [20, 40, 60]) {
  add(`ipda${period}Show`, `IPDA${period}`, 'bool', true, 'IPDA')
}
add('ipdaType', 'IPDA Data Ranges Type', 'str', 'CLASSIC', 'IPDA',
  { options: ['CLASSIC', 'CLASSIC+LTF', 'LTF'] })

export const imDuyDescriptor: IndicatorDescriptor = {
  id: 'im-duy',
  name: "I'm Duy",
  version: 1,
  meta: { onMainPanel: true },
  inputs,
}
