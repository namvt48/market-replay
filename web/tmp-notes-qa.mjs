import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:8080'
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

await page.goto(`${baseUrl}/?qa=notes`, { waitUntil: 'networkidle' })
const chooseTool = async (targetPage, name) => {
  await targetPage.getByRole('button', { name: 'Text and notes' }).click()
  await targetPage.getByRole('menu', { name: 'Text and notes menu' }).getByRole('menuitem', { name, exact: true }).click()
}

await page.getByRole('button', { name: 'Text and notes' }).click()
const menu = page.getByRole('menu', { name: 'Text and notes menu' })
assert.deepEqual(await menu.getByRole('menuitem').allTextContents(), [
  'Text', 'Anchored Text', 'Note', 'Price Note', 'Pin', 'Table', 'Callout', 'Comment', 'Price Label', 'Signpost', 'Flag Mark',
])
assert.deepEqual(await menu.locator('[data-annotation-icon]').evaluateAll((icons) => icons.map((icon) => icon.getAttribute('data-annotation-icon'))), [
  'text-annotation', 'anchored-text', 'note', 'price-note', 'pin', 'table', 'callout', 'comment', 'price-label', 'signpost', 'flag-mark',
])
await page.screenshot({ path: '/tmp/notes-menu.png', fullPage: true })
await page.keyboard.press('Escape')

await chooseTool(page, 'Note')
await page.mouse.move(430, 470)
await page.mouse.down()
await page.mouse.move(620, 300, { steps: 8 })
await page.mouse.up()
const noteEditor = page.getByRole('textbox', { name: 'Inline Note editor' })
await noteEditor.waitFor()
assert.equal(await noteEditor.inputValue(), 'Add text')
assert.equal(await noteEditor.evaluate((input) => document.activeElement === input), true)
await noteEditor.fill('Plan entry')
await noteEditor.press('Enter')
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/note-drawing.png', fullPage: true })
await page.keyboard.press('Escape')

await chooseTool(page, 'Price Note')
await page.mouse.move(500, 500)
await page.mouse.down()
await page.mouse.move(680, 260, { steps: 8 })
await page.mouse.up()
await page.getByRole('toolbar', { name: 'Selected Price Note drawing' }).waitFor()
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/price-note-drawing.png', fullPage: true })
await page.keyboard.press('Escape')

await chooseTool(page, 'Callout')
await page.mouse.move(420, 500)
await page.mouse.down()
await page.mouse.move(650, 320, { steps: 8 })
await page.mouse.up()
const calloutEditor = page.getByRole('textbox', { name: 'Inline Callout editor' })
await calloutEditor.waitFor()
await calloutEditor.fill('Watch level')
await calloutEditor.press('Enter')
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/callout-drawing.png', fullPage: true })
await page.keyboard.press('Escape')

await chooseTool(page, 'Comment')
await page.mouse.click(760, 380)
const commentEditor = page.getByRole('textbox', { name: 'Inline Comment editor' })
await commentEditor.waitFor()
await commentEditor.fill('Review')
await commentEditor.press('Enter')
await page.waitForTimeout(100)
await page.screenshot({ path: '/tmp/comment-drawing.png', fullPage: true })
await page.keyboard.press('Escape')

await chooseTool(page, 'Price Label')
await page.mouse.click(800, 420)
await page.getByRole('toolbar', { name: 'Selected Price Label drawing' }).waitFor()

const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobile.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
mobile.on('pageerror', (error) => errors.push(error.message))
await mobile.goto(`${baseUrl}/?qa=notes-mobile`, { waitUntil: 'networkidle' })
const hidePanel = mobile.getByRole('button', { name: 'Hide operations panel' })
if (await hidePanel.count()) await hidePanel.click()
await chooseTool(mobile, 'Comment')
await mobile.mouse.click(190, 360)
const mobileCommentEditor = mobile.getByRole('textbox', { name: 'Inline Comment editor' })
await mobileCommentEditor.waitFor()
const mobileEditorBox = await mobileCommentEditor.boundingBox()
assert(mobileEditorBox)
assert(mobileEditorBox.x >= 0 && mobileEditorBox.x + mobileEditorBox.width <= 375)
assert(mobileEditorBox.y >= 0 && mobileEditorBox.y + mobileEditorBox.height <= 812)

assert.deepEqual(errors, [])
console.log(JSON.stringify({ result: 'pass', tools: 11, noteEditor: true, priceNote: true, calloutEditor: true, commentEditor: true, priceLabel: true, mobileEditorBox, consoleErrors: 0 }, null, 2))
await browser.close()
