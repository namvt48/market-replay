import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173'
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

const canvasSignature = async (targetPage = page) => targetPage.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => canvas.toDataURL()).join('|'))

await page.goto(`${baseUrl}/?qa=rectangle-properties`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Favorite Rectangle' }).click()
await page.mouse.click(300, 270)
await page.mouse.click(690, 620)

const toolbar = page.getByRole('toolbar', { name: 'Selected Rectangle drawing' })
await toolbar.waitFor()
assert.deepEqual(await toolbar.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), [
  'Move selected drawing toolbar',
  'Drawing templates',
  'Drawing color',
  'Drawing fill',
  'Drawing text',
  'Line thickness',
  'Line style',
  'Drawing properties',
  'Lock drawing',
  'Remove drawing',
  'More drawing actions',
])
assert.equal(await toolbar.getByRole('button', { name: 'Drawing properties' }).locator('[data-icon="line-properties"]').count(), 1)

const toolbarBox = await toolbar.boundingBox()
assert(toolbarBox)
await toolbar.getByRole('button', { name: 'Drawing fill' }).click()
const fillPalette = page.getByRole('menu', { name: 'Drawing fill color palette' })
await fillPalette.waitFor()
const fillBox = await fillPalette.boundingBox()
assert(fillBox)
assert(fillBox.y >= toolbarBox.y + toolbarBox.height)
await fillPalette.getByRole('menuitemradio', { name: 'Set drawing fill color #2962ff' }).click()

await toolbar.getByRole('button', { name: 'Drawing text' }).click()
const textPalette = page.getByRole('menu', { name: 'Drawing text color palette' })
await textPalette.waitFor()
const textBox = await textPalette.boundingBox()
assert(textBox)
assert(textBox.y >= toolbarBox.y + toolbarBox.height)
await textPalette.getByRole('menuitemradio', { name: 'Set drawing text color #7e57c2' }).first().click()
assert.equal(await textPalette.count(), 0)

await toolbar.getByRole('button', { name: 'Lock drawing' }).click()
assert.equal(await toolbar.getByRole('button', { name: 'Unlock drawing' }).count(), 1)
await toolbar.getByRole('button', { name: 'Unlock drawing' }).click()
assert.equal(await toolbar.getByRole('button', { name: 'Lock drawing' }).count(), 1)

await toolbar.getByRole('button', { name: 'Drawing properties' }).click()
const dialog = page.getByRole('dialog', { name: 'Edit rectangle drawing' })
await dialog.waitFor()
assert.equal(await toolbar.count(), 0)
assert.deepEqual(await dialog.getByRole('tab').allTextContents(), ['Style', 'Text', 'Coordinates', 'Visibility'])
const centeredBox = await dialog.boundingBox()
assert(centeredBox)
assert(Math.abs(centeredBox.x + centeredBox.width / 2 - 720) < 2)
assert(Math.abs(centeredBox.y + centeredBox.height / 2 - 500) < 2)
await dialog.screenshot({ path: '/tmp/rectangle-properties-style.png' })

const signatureBeforeStyle = await canvasSignature()
await dialog.getByRole('combobox', { name: 'Rectangle extension' }).selectOption('both')
const middleCheckbox = dialog.getByRole('checkbox', { name: 'Middle line' })
if (!(await middleCheckbox.isChecked())) await middleCheckbox.click()
await dialog.getByRole('button', { name: 'Middle line appearance' }).click()
const middlePalette = page.getByRole('dialog', { name: 'Middle line color palette' })
await middlePalette.waitFor()
const middlePaletteBox = await middlePalette.boundingBox()
assert(middlePaletteBox)
assert(middlePaletteBox.x >= 8)
assert(middlePaletteBox.x + middlePaletteBox.width <= 1432)
assert(middlePaletteBox.y >= 8)
assert(middlePaletteBox.y + middlePaletteBox.height <= 992)
assert.equal(await dialog.evaluate((node, palette) => node.contains(palette), await middlePalette.elementHandle()), false)
assert.equal(await dialog.getByRole('tabpanel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth), true)
await page.screenshot({ path: '/tmp/rectangle-palette-portal-desktop.png', fullPage: true })
await dialog.getByRole('button', { name: 'Middle line appearance' }).click()
const backgroundCheckbox = dialog.getByRole('checkbox', { name: 'Background' })
if (await backgroundCheckbox.isChecked()) await backgroundCheckbox.click()
await page.waitForTimeout(100)
assert.notEqual(await canvasSignature(), signatureBeforeStyle)

await dialog.getByRole('tab', { name: 'Text' }).click()
await dialog.getByRole('button', { name: 'Rectangle text color' }).click()
await page.getByRole('button', { name: 'Set color #7e57c2' }).click()
assert.equal(await page.getByRole('button', { name: 'Set color #7e57c2' }).count(), 0)
await dialog.getByRole('combobox', { name: 'Rectangle font size' }).selectOption('14')
await dialog.getByRole('textbox', { name: 'Rectangle text' }).fill('abcbcb')
await dialog.getByRole('combobox', { name: 'Rectangle vertical text alignment' }).selectOption('inside')
await dialog.getByRole('combobox', { name: 'Rectangle horizontal text alignment' }).selectOption('center')
await dialog.screenshot({ path: '/tmp/rectangle-properties-text.png' })

await dialog.getByRole('tab', { name: 'Coordinates' }).click()
assert.equal(await dialog.getByRole('spinbutton', { name: /Point \d+ price/ }).count(), 2)
const firstPrice = dialog.getByRole('spinbutton', { name: 'Point 1 price' })
const beforeCoordinate = await canvasSignature()
await firstPrice.fill(String(Number(await firstPrice.inputValue()) + 1))
await page.waitForTimeout(100)
assert.notEqual(await canvasSignature(), beforeCoordinate)

await dialog.getByRole('tab', { name: 'Visibility' }).click()
const beforeVisibility = await canvasSignature()
await dialog.getByRole('checkbox', { name: 'Minutes' }).click()
await page.waitForTimeout(100)
assert.notEqual(await canvasSignature(), beforeVisibility)
await dialog.getByRole('checkbox', { name: 'Minutes' }).click()

await dialog.getByRole('tab', { name: 'Style' }).click()
await dialog.getByRole('combobox', { name: 'Rectangle extension' }).selectOption('none')

const moveHandle = dialog.getByRole('button', { name: 'Move drawing properties' })
const beforeDrag = await dialog.boundingBox()
assert(beforeDrag)
await moveHandle.hover()
await page.mouse.down()
await page.mouse.move(beforeDrag.x + 130, beforeDrag.y + 90)
await page.mouse.up()
const afterDrag = await dialog.boundingBox()
assert(afterDrag)
assert.notDeepEqual(afterDrag, beforeDrag)

await dialog.getByRole('tab', { name: 'Text' }).click()
await dialog.getByRole('button', { name: 'Ok' }).click()
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/rectangle-text-inside.png', fullPage: true })

await toolbar.getByRole('button', { name: 'Drawing properties' }).click()
await dialog.getByRole('tab', { name: 'Text' }).click()
await dialog.getByRole('combobox', { name: 'Rectangle vertical text alignment' }).selectOption('top')
await dialog.getByRole('combobox', { name: 'Rectangle horizontal text alignment' }).selectOption('left')
await dialog.getByRole('button', { name: 'Ok' }).click()
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/rectangle-text-top-left.png', fullPage: true })

const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobilePage.on('console', (message) => {
  if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`)
})
mobilePage.on('pageerror', (error) => errors.push(`mobile pageerror: ${error.message}`))
await mobilePage.goto(`${baseUrl}/?qa=rectangle-properties-mobile`, { waitUntil: 'networkidle' })
const hidePanel = mobilePage.getByRole('button', { name: 'Hide operations panel' })
if (await hidePanel.count()) await hidePanel.click()
await mobilePage.getByRole('button', { name: 'Favorite Rectangle' }).click()
await mobilePage.mouse.click(90, 250)
await mobilePage.mouse.click(300, 600)
const mobileToolbar = mobilePage.getByRole('toolbar', { name: 'Selected Rectangle drawing' })
await mobileToolbar.waitFor()
await mobileToolbar.getByRole('button', { name: 'Drawing properties' }).click()
const mobileDialog = mobilePage.getByRole('dialog', { name: 'Edit rectangle drawing' })
await mobileDialog.waitFor()
const mobileBox = await mobileDialog.boundingBox()
assert(mobileBox)
assert(mobileBox.x >= 0)
assert(mobileBox.x + mobileBox.width <= 375)
assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
const mobileMiddleCheckbox = mobileDialog.getByRole('checkbox', { name: 'Middle line' })
if (!(await mobileMiddleCheckbox.isChecked())) await mobileMiddleCheckbox.click()
await mobileDialog.getByRole('button', { name: 'Middle line appearance' }).click()
const mobilePalette = mobilePage.getByRole('dialog', { name: 'Middle line color palette' })
await mobilePalette.waitFor()
const mobilePaletteBox = await mobilePalette.boundingBox()
assert(mobilePaletteBox)
assert(mobilePaletteBox.x >= 8)
assert(mobilePaletteBox.x + mobilePaletteBox.width <= 367)
assert(mobilePaletteBox.y >= 8)
assert(mobilePaletteBox.y + mobilePaletteBox.height <= 804)
assert.equal(await mobileDialog.evaluate((node, palette) => node.contains(palette), await mobilePalette.elementHandle()), false)
assert.equal(await mobileDialog.getByRole('tabpanel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth), true)
await mobilePage.screenshot({ path: '/tmp/rectangle-palette-portal-mobile.png', fullPage: true })
await mobilePage.screenshot({ path: '/tmp/rectangle-properties-mobile.png', fullPage: true })

assert.deepEqual(errors, [])
console.log(JSON.stringify({
  result: 'pass',
  toolbarControls: 11,
  centeredBox,
  draggedTo: afterDrag,
  mobileBox,
  canvasLiveSync: true,
  visibilityCanvasSync: true,
  textColorPaletteCloses: true,
  palettesEscapeInspectorOverflow: true,
  lockUnlock: true,
  consoleErrors: errors.length,
}, null, 2))

await browser.close()
