import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:4173'
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
const canvasSignature = async (targetPage = page) => targetPage.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => canvas.toDataURL()).join('|'))

await page.goto(`${baseUrl}/?qa=position-properties`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Projection tools' }).click()
await page.getByRole('menu', { name: 'Projection tools menu' }).getByRole('menuitem', { name: 'Long Position' }).click()
await page.mouse.click(300, 470)

const toolbar = page.getByRole('toolbar', { name: 'Selected Long Position drawing' })
await toolbar.waitFor()
assert.deepEqual(await toolbar.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), [
  'Move selected drawing toolbar',
  'Drawing templates',
  'Drawing text',
  'Position target color',
  'Position stop color',
  'Drawing properties',
  'Lock drawing',
  'Remove drawing',
  'More drawing actions',
])
assert.equal(await toolbar.getByRole('button', { name: /Create limit order/i }).count(), 0)
assert.equal(await toolbar.getByRole('button', { name: 'Drawing properties' }).locator('[data-icon="line-properties"]').count(), 1)

await toolbar.getByRole('button', { name: 'Position target color' }).click()
await page.getByRole('menu', { name: 'Position target color palette' }).getByRole('menuitemradio', { name: 'Set position target color #26a69a' }).first().click()
await toolbar.getByRole('button', { name: 'Position stop color' }).click()
await page.getByRole('menu', { name: 'Position stop color palette' }).getByRole('menuitemradio', { name: 'Set position stop color #f23645' }).click()

await toolbar.getByRole('button', { name: 'Drawing properties' }).click()
const dialog = page.getByRole('dialog', { name: 'Edit long-position drawing' })
await dialog.waitFor()
assert.equal(await toolbar.count(), 0)
assert.deepEqual(await dialog.getByRole('tab').allTextContents(), ['Style', 'Text', 'Coordinates', 'Visibility'])
const centeredBox = await dialog.boundingBox()
assert(centeredBox)
assert(Math.abs(centeredBox.x + centeredBox.width / 2 - 720) < 2)
assert(Math.abs(centeredBox.y + centeredBox.height / 2 - 500) < 2)
assert.deepEqual(await dialog.getByRole('combobox', { name: 'Position risk mode' }).locator('option').allTextContents(), ['%', 'Cash'])
await dialog.screenshot({ path: '/tmp/long-position-inputs.png' })

const signatureBeforeInputs = await canvasSignature()
await dialog.getByRole('spinbutton', { name: 'Position account size' }).fill('1000')
await dialog.getByRole('spinbutton', { name: 'Position lot size' }).fill('1')
await dialog.getByRole('spinbutton', { name: 'Position risk' }).fill('25')
await dialog.getByRole('combobox', { name: 'Position risk mode' }).selectOption('percent')
await dialog.getByRole('spinbutton', { name: 'Position profit ticks' }).fill('80')
await dialog.getByRole('spinbutton', { name: 'Position stop ticks' }).fill('60')
await page.waitForTimeout(100)
assert.notEqual(await canvasSignature(), signatureBeforeInputs)

await dialog.screenshot({ path: '/tmp/long-position-style.png' })
await dialog.getByRole('tab', { name: 'Text' }).click()
await dialog.getByRole('button', { name: 'Position stats' }).click()
const stats = page.getByRole('dialog', { name: 'Position stats options' })
await stats.waitFor()
assert.equal(await stats.getByRole('checkbox').count(), 13)
assert.equal(await dialog.evaluate((node, popover) => node.contains(popover), await stats.elementHandle()), false)
const statsBox = await stats.boundingBox()
assert(statsBox)
assert(statsBox.x >= 8 && statsBox.x + statsBox.width <= 1432)
assert(statsBox.y >= 8 && statsBox.y + statsBox.height <= 992)
await page.screenshot({ path: '/tmp/long-position-stats-menu.png', fullPage: true })
await stats.getByRole('checkbox', { name: 'TP PL' }).click()
await stats.getByRole('checkbox', { name: 'TP PL' }).click()
await dialog.getByRole('button', { name: 'Position stats' }).click()
await dialog.getByRole('checkbox', { name: 'Always show stats' }).click()
await dialog.getByRole('checkbox', { name: 'Always show stats' }).click()

const beforeVisibility = await canvasSignature()
await dialog.getByRole('tab', { name: 'Visibility' }).click()
await page.waitForTimeout(150)
const visibilityBox = await dialog.boundingBox()
assert(visibilityBox)
assert.equal(Math.round(visibilityBox.width), 456)
assert.equal(await dialog.getByRole('tabpanel').evaluate((panel) => panel.scrollWidth <= panel.clientWidth), true)
await dialog.screenshot({ path: '/tmp/long-position-visibility.png' })
await dialog.getByRole('checkbox', { name: 'Minutes' }).click()
await page.waitForTimeout(100)
assert.notEqual(await canvasSignature(), beforeVisibility)
await dialog.getByRole('checkbox', { name: 'Minutes' }).click()

const moveHandle = dialog.getByRole('button', { name: 'Move drawing properties' })
const beforeDrag = await dialog.boundingBox()
assert(beforeDrag)
await moveHandle.hover()
await page.mouse.down()
await page.mouse.move(beforeDrag.x + 140, beforeDrag.y + 100)
await page.mouse.up()
const afterDrag = await dialog.boundingBox()
assert(afterDrag)
assert.notDeepEqual(afterDrag, beforeDrag)
await dialog.getByRole('button', { name: 'Ok' }).click()
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/long-position-canvas.png', fullPage: true })

await page.getByRole('button', { name: 'Projection tools' }).click()
await page.getByRole('menu', { name: 'Projection tools menu' }).getByRole('menuitem', { name: 'Short Position' }).click()
await page.mouse.click(720, 450)
const shortToolbar = page.getByRole('toolbar', { name: 'Selected Short Position drawing' })
await shortToolbar.waitFor()
await shortToolbar.getByRole('button', { name: 'Drawing properties' }).click()
const shortDialog = page.getByRole('dialog', { name: 'Edit short-position drawing' })
await shortDialog.waitFor()
const shortBefore = await canvasSignature()
await shortDialog.getByRole('spinbutton', { name: 'Position profit ticks' }).fill('500')
await shortDialog.getByRole('spinbutton', { name: 'Position stop ticks' }).fill('250')
await page.waitForTimeout(100)
assert.notEqual(await canvasSignature(), shortBefore)
await shortDialog.getByRole('button', { name: 'Ok' }).click()
await page.screenshot({ path: '/tmp/short-position-canvas.png', fullPage: true })

const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobilePage.on('console', (message) => { if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`) })
mobilePage.on('pageerror', (error) => errors.push(`mobile pageerror: ${error.message}`))
await mobilePage.goto(`${baseUrl}/?qa=position-properties-mobile`, { waitUntil: 'networkidle' })
const hidePanel = mobilePage.getByRole('button', { name: 'Hide operations panel' })
if (await hidePanel.count()) await hidePanel.click()
await mobilePage.getByRole('button', { name: 'Projection tools' }).click()
await mobilePage.getByRole('menu', { name: 'Projection tools menu' }).getByRole('menuitem', { name: 'Long Position' }).click()
await mobilePage.mouse.click(180, 430)
const mobileToolbar = mobilePage.getByRole('toolbar', { name: 'Selected Long Position drawing' })
await mobileToolbar.waitFor()
await mobileToolbar.getByRole('button', { name: 'Drawing properties' }).click()
const mobileDialog = mobilePage.getByRole('dialog', { name: 'Edit long-position drawing' })
await mobileDialog.waitFor()
const mobileBox = await mobileDialog.boundingBox()
assert(mobileBox)
assert(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 375)
assert(mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 812)
assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
await mobileDialog.getByRole('tab', { name: 'Text' }).click()
await mobileDialog.getByRole('button', { name: 'Position stats' }).click()
const mobileStats = mobilePage.getByRole('dialog', { name: 'Position stats options' })
const mobileStatsBox = await mobileStats.boundingBox()
assert(mobileStatsBox)
assert(mobileStatsBox.x >= 8 && mobileStatsBox.x + mobileStatsBox.width <= 367)
assert(mobileStatsBox.y >= 8 && mobileStatsBox.y + mobileStatsBox.height <= 804)
await mobilePage.screenshot({ path: '/tmp/long-position-mobile.png', fullPage: true })

assert.deepEqual(errors, [])
console.log(JSON.stringify({
  result: 'pass',
  toolbarButtons: 9,
  createLimitOrderRemoved: true,
  centeredBox,
  draggedTo: afterDrag,
  mobileBox,
  inputsLiveSync: true,
  statsLiveSync: true,
  visibilityWidth: Math.round(visibilityBox.width),
  longAndShort: true,
  consoleErrors: errors.length,
}, null, 2))

await browser.close()
