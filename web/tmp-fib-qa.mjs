import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:8080'
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
const errors = []
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))

const drawingCanvasSignature = async () => page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => canvas.toDataURL()).join('|'))

await page.goto(`${baseUrl}/?qa=fib-properties`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Favorite Fibonacci Retracement' }).click()
await page.mouse.click(280, 720)
await page.mouse.click(820, 300)

const selectedToolbar = page.getByRole('toolbar', { name: 'Selected Fibonacci Retracement drawing' })
await selectedToolbar.waitFor()
const propertiesButton = selectedToolbar.getByRole('button', { name: 'Drawing properties' })
assert.equal(await propertiesButton.locator('[data-icon="line-properties"]').count(), 1)
await propertiesButton.click()

const dialog = page.getByRole('dialog', { name: 'Edit fib-retracement drawing' })
await dialog.waitFor()
assert.equal(await selectedToolbar.count(), 0)
assert.deepEqual(await dialog.getByRole('tab').allTextContents(), ['Style', 'Text', 'Coordinates', 'Visibility'])
assert.equal(await dialog.getByRole('spinbutton', { name: /Level \d+ value/ }).count(), 24)

const desktopBox = await dialog.boundingBox()
assert(desktopBox)
assert(Math.abs(desktopBox.x + desktopBox.width / 2 - 720) < 2)
assert(Math.abs(desktopBox.y + desktopBox.height / 2 - 500) < 2)
await dialog.screenshot({ path: '/tmp/fib-properties-top-polished.png' })

const firstLevel = dialog.getByRole('spinbutton', { name: 'Level 1 value' })
assert.equal(await firstLevel.isDisabled(), true)
await dialog.getByRole('checkbox', { name: 'Show level 1', exact: true }).click()
assert.equal(await firstLevel.isEnabled(), true)
await firstLevel.fill('-0.75')

const signatureBeforeTrend = await drawingCanvasSignature()
await dialog.getByRole('checkbox', { name: 'Trend line' }).click()
await page.waitForTimeout(100)
const signatureAfterTrend = await drawingCanvasSignature()
assert.notEqual(signatureAfterTrend, signatureBeforeTrend)

await dialog.getByRole('button', { name: 'Levels line style' }).click()
await page.getByRole('menu', { name: 'Levels line style menu' }).getByRole('menuitemradio').nth(2).click()
await dialog.getByRole('button', { name: 'Levels line thickness' }).click()
await page.getByRole('menu', { name: 'Levels line thickness menu' }).getByRole('menuitemradio').nth(2).click()
await dialog.getByRole('combobox', { name: 'Fibonacci line extension' }).selectOption('extend')
await dialog.getByRole('checkbox', { name: 'Reverse' }).click()
await dialog.getByRole('checkbox', { name: 'Prices' }).click()
await dialog.getByRole('tab', { name: 'Text' }).click()
await dialog.getByRole('combobox', { name: 'Level label format' }).selectOption('percents')
await dialog.getByRole('combobox', { name: 'Label horizontal position' }).selectOption('left')
await dialog.getByRole('combobox', { name: 'Label vertical position' }).selectOption('bottom')
await dialog.getByRole('checkbox', { name: 'Text' }).click()
await dialog.getByRole('textbox', { name: 'Fibonacci text' }).fill('Golden pocket')
await dialog.getByRole('combobox', { name: 'Text horizontal position' }).selectOption('right')
await dialog.getByRole('combobox', { name: 'Fibonacci font size' }).selectOption('14')
await dialog.screenshot({ path: '/tmp/fib-properties-style-polished.png' })

await dialog.getByRole('tab', { name: 'Coordinates' }).click()
assert.equal(await dialog.getByRole('spinbutton', { name: /Point \d+ price/ }).count(), 2)
const firstPrice = dialog.getByRole('spinbutton', { name: 'Point 1 price' })
const originalPrice = await firstPrice.inputValue()
await firstPrice.fill(String(Number(originalPrice) + 1))

await dialog.getByRole('tab', { name: 'Visibility' }).click()
assert.equal(await dialog.getByRole('checkbox').count(), 6)
const signatureBeforeVisibility = await drawingCanvasSignature()
await dialog.getByRole('checkbox', { name: 'Minutes' }).click()
await page.waitForTimeout(100)
const signatureHidden = await drawingCanvasSignature()
assert.notEqual(signatureHidden, signatureBeforeVisibility)
await dialog.getByRole('checkbox', { name: 'Minutes' }).click()

const moveHandle = dialog.getByRole('button', { name: 'Move drawing properties' })
const beforeDrag = await dialog.boundingBox()
assert(beforeDrag)
await moveHandle.hover()
await page.mouse.down()
await page.mouse.move(beforeDrag.x + 180, beforeDrag.y + 100)
await page.mouse.up()
const afterDrag = await dialog.boundingBox()
assert(afterDrag)
assert.notDeepEqual(afterDrag, beforeDrag)

await page.screenshot({ path: '/tmp/fib-properties-desktop.png', fullPage: true })
await dialog.getByRole('tab', { name: 'Style' }).click()
await dialog.getByRole('combobox', { name: 'Fibonacci line extension' }).selectOption('none')
await dialog.getByRole('tab', { name: 'Text' }).click()
await dialog.getByRole('combobox', { name: 'Level label format' }).selectOption('values')
await dialog.getByRole('combobox', { name: 'Label vertical position' }).selectOption('middle')
await dialog.getByRole('tab', { name: 'Style' }).click()
await dialog.getByRole('button', { name: 'Levels line style' }).click()
await page.getByRole('menu', { name: 'Levels line style menu' }).getByRole('menuitemradio').first().click()
await dialog.getByRole('button', { name: 'Levels line thickness' }).click()
await page.getByRole('menu', { name: 'Levels line thickness menu' }).getByRole('menuitemradio').first().click()
await dialog.getByRole('button', { name: 'Ok' }).click()
await page.screenshot({ path: '/tmp/fib-level-labels-outside.png', fullPage: true })
const mobilePage = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobilePage.on('console', (message) => {
  if (message.type() === 'error') errors.push(`mobile console: ${message.text()}`)
})
mobilePage.on('pageerror', (error) => errors.push(`mobile pageerror: ${error.message}`))
await mobilePage.goto(`${baseUrl}/?qa=fib-properties-mobile`, { waitUntil: 'networkidle' })
const hidePanel = mobilePage.getByRole('button', { name: 'Hide operations panel' })
if (await hidePanel.count()) await hidePanel.click()
await mobilePage.getByRole('button', { name: 'Favorite Fibonacci Retracement' }).click()
await mobilePage.mouse.click(110, 650)
await mobilePage.mouse.click(310, 250)
const mobileToolbar = mobilePage.getByRole('toolbar', { name: 'Selected Fibonacci Retracement drawing' })
await mobileToolbar.waitFor()
await mobileToolbar.getByRole('button', { name: 'Drawing properties' }).click()
const mobileDialog = mobilePage.getByRole('dialog', { name: 'Edit fib-retracement drawing' })
await mobileDialog.waitFor()
const mobileBox = await mobileDialog.boundingBox()
assert(mobileBox)
assert(mobileBox.x >= 0)
assert(mobileBox.x + mobileBox.width <= 375)
assert.equal(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
await mobilePage.screenshot({ path: '/tmp/fib-properties-mobile.png', fullPage: true })

assert.deepEqual(errors, [])
console.log(JSON.stringify({
  result: 'pass',
  desktopBox,
  draggedTo: afterDrag,
  mobileBox,
  tabs: ['Style', 'Text', 'Coordinates', 'Visibility'],
  levelSlots: 24,
  canvasLiveSync: true,
  visibilityCanvasSync: true,
  consoleErrors: errors.length,
}, null, 2))

await browser.close()
