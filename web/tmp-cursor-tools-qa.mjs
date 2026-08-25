import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:5173'
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(`${baseUrl}/?qa=cursor-tools`, { waitUntil: 'networkidle' })
const trigger = page.getByRole('button', { name: 'Cursor tools' })
const chooseCursor = async (name) => {
  await trigger.click()
  await page.getByRole('menu', { name: 'Cursor tools menu' }).getByRole('menuitem', { name, exact: true }).click()
}

await trigger.click()
const menu = page.getByRole('menu', { name: 'Cursor tools menu' })
assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), ['Cross', 'Dot', 'Arrow', 'Demonstration', 'Eraser'])
assert.deepEqual(await menu.locator('[data-cursor-icon]').evaluateAll((icons) => icons.map((icon) => icon.getAttribute('data-cursor-icon'))), ['cross', 'dot', 'arrow', 'demonstration', 'eraser'])
await page.screenshot({ path: '/tmp/cursor-tools-menu.png', fullPage: true })
await page.keyboard.press('Escape')

await chooseCursor('Dot')
await page.mouse.move(500, 330)
const dot = page.locator('.chart-cursor-indicator[data-mode="dot"]')
await dot.waitFor()
assert.deepEqual(await dot.evaluate((element) => {
  const style = getComputedStyle(element)
  return { width: style.width, backgroundColor: style.backgroundColor, borderColor: style.borderColor, borderWidth: style.borderWidth }
}), { width: '7px', backgroundColor: 'rgb(0, 0, 0)', borderColor: 'rgb(255, 255, 255)', borderWidth: '1px' })

await chooseCursor('Arrow')
assert.equal(await page.locator('[data-active-chart] [data-chart-host]').evaluate((element) => element.classList.contains('chart-cursor-arrow')), true)
assert.equal(await page.locator('.chart-cursor-indicator').count(), 0)

await chooseCursor('Demonstration')
await page.mouse.move(510, 340)
const demonstration = page.locator('.chart-cursor-indicator[data-mode="demonstration"]')
await demonstration.waitFor()
const demonstrationBox = await demonstration.boundingBox()
assert(demonstrationBox)
assert.equal(Math.round(demonstrationBox.width), 36)
assert.equal(Math.round(demonstrationBox.height), 36)
assert(Math.abs(demonstrationBox.x + demonstrationBox.width / 2 - 510) <= 2)
assert(Math.abs(demonstrationBox.y + demonstrationBox.height / 2 - 340) <= 2)
await page.screenshot({ path: '/tmp/cursor-demonstration.png', fullPage: true })

await page.getByRole('button', { name: 'Line tools' }).click()
await page.getByRole('menu', { name: 'Line tools menu' }).getByRole('menuitem', { name: 'Trend Line', exact: true }).click()
await page.mouse.click(350, 480)
await page.mouse.click(550, 320)
await page.getByRole('toolbar', { name: 'Selected Trend Line drawing' }).waitFor()
await chooseCursor('Eraser')
await page.mouse.click(450, 400)
await page.waitForTimeout(100)
assert.equal(await page.getByRole('toolbar', { name: 'Selected Trend Line drawing' }).count(), 0)

const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobile.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
mobile.on('pageerror', (error) => errors.push(error.message))
await mobile.goto(`${baseUrl}/?qa=cursor-tools-mobile`, { waitUntil: 'networkidle' })
const hidePanel = mobile.getByRole('button', { name: 'Hide operations panel' })
if (await hidePanel.count()) await hidePanel.click()
await mobile.getByRole('button', { name: 'Cursor tools' }).click()
const mobileMenu = mobile.getByRole('menu', { name: 'Cursor tools menu' })
const mobileMenuBox = await mobileMenu.boundingBox()
assert(mobileMenuBox)
assert(mobileMenuBox.x >= 0 && mobileMenuBox.x + mobileMenuBox.width <= 375)
assert(mobileMenuBox.y >= 0 && mobileMenuBox.y + mobileMenuBox.height <= 812)

assert.deepEqual(errors, [])
console.log(JSON.stringify({ result: 'pass', modes: 5, dot: true, arrow: true, demonstrationBox, eraser: true, mobileMenuBox, consoleErrors: 0 }, null, 2))
await browser.close()
