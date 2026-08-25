import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const baseUrl = process.env.QA_BASE_URL ?? 'http://127.0.0.1:8080'
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))
const signature = () => page.locator('canvas').evaluateAll((canvases) => canvases.map((canvas) => canvas.toDataURL()).join('|'))
const longestBlueHorizontalRunNear = (pageX, pageY) => page.locator('canvas').evaluateAll((canvases, target) => {
  let longest = 0
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect()
    if (target.x < rect.left - 12 || target.x > rect.right + 120 || target.y < rect.top - 32 || target.y > rect.bottom + 32) continue
    const context = canvas.getContext('2d')
    if (!context || rect.width <= 0 || rect.height <= 0) continue
    const scaleX = canvas.width / rect.width
    const scaleY = canvas.height / rect.height
    const left = Math.max(0, Math.floor((target.x - rect.left - 12) * scaleX))
    const top = Math.max(0, Math.floor((target.y - rect.top - 32) * scaleY))
    const width = Math.min(canvas.width - left, Math.ceil(132 * scaleX))
    const height = Math.min(canvas.height - top, Math.ceil(64 * scaleY))
    if (width <= 0 || height <= 0) continue
    const image = context.getImageData(left, top, width, height)
    for (let y = 0; y < height; y += 1) {
      let run = 0
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4
        const blue = image.data[offset + 2] > 190 && image.data[offset + 2] > image.data[offset] * 1.7 && image.data[offset + 2] > image.data[offset + 1] * 1.5 && image.data[offset + 3] > 160
        run = blue ? run + 1 : 0
        longest = Math.max(longest, run)
      }
    }
  }
  return longest
}, { x: pageX, y: pageY })

await page.goto(`${baseUrl}/?qa=text-properties`, { waitUntil: 'networkidle' })
await page.mouse.move(10, 10)
await page.waitForTimeout(100)
const beforeEmptyText = await signature()
await page.getByRole('button', { name: 'Text and notes' }).click()
await page.getByRole('menu', { name: 'Text and notes menu' }).getByRole('menuitem', { name: 'Text', exact: true }).click()
await page.mouse.click(520, 350)
const inlineEditor = page.getByRole('textbox', { name: 'Inline text editor' })
await inlineEditor.waitFor()
assert.equal(await inlineEditor.inputValue(), 'Add text')
assert.equal(await inlineEditor.evaluate((input) => document.activeElement === input), true, 'Inline editor must receive focus after placement')
assert.deepEqual(await inlineEditor.evaluate((input) => [input.selectionStart, input.selectionEnd]), [0, 8], 'Placeholder text must be selected for immediate typing')
await page.screenshot({ path: '/tmp/text-inline-editor.png', fullPage: true })
await page.getByRole('toolbar', { name: 'Selected Text drawing' }).waitFor()
await inlineEditor.press('Escape')
await page.mouse.move(10, 10)
await page.waitForTimeout(100)
assert.equal(await signature(), beforeEmptyText, 'An empty Text drawing must remove itself after deselection')

await page.getByRole('button', { name: 'Text and notes' }).click()
await page.getByRole('menu', { name: 'Text and notes menu' }).getByRole('menuitem', { name: 'Text', exact: true }).click()
await page.mouse.click(620, 300)
const authoredInlineEditor = page.getByRole('textbox', { name: 'Inline text editor' })
await authoredInlineEditor.waitFor()
await authoredInlineEditor.fill('Breakout')
await authoredInlineEditor.press('Enter')
await page.waitForTimeout(100)
const selectionOutlineRun = await longestBlueHorizontalRunNear(620, 300)
assert(selectionOutlineRun >= 36, `Selected Text must draw a bounding outline instead of an anchor dot (longest blue run: ${selectionOutlineRun})`)
await page.screenshot({ path: '/tmp/text-selection-outline.png', fullPage: true })
const toolbar = page.getByRole('toolbar', { name: 'Selected Text drawing' })
await toolbar.waitFor()
await page.keyboard.press('Escape')
await toolbar.waitFor({ state: 'hidden' })
await page.mouse.click(650, 300)
await toolbar.waitFor()
await page.waitForTimeout(100)
assert(await longestBlueHorizontalRunNear(620, 300) >= 36, 'Clicking authored Text must select it with the bounding outline')
assert.deepEqual(await toolbar.getByRole('button').evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label'))), [
  'Move selected drawing toolbar',
  'Drawing templates',
  'Drawing text',
  'Font size',
  'Drawing properties',
  'Lock drawing',
  'Anchor drawing',
  'Remove drawing',
  'More drawing actions',
])
await toolbar.getByRole('button', { name: 'Font size' }).click()
const fontMenu = page.getByRole('menu', { name: 'Font size menu' })
assert.deepEqual(await fontMenu.getByRole('menuitemradio').allTextContents(), ['8', '10', '11', '12', '14', '16', '18', '20', '22', '24', '28', '32', '40'])
await page.screenshot({ path: '/tmp/text-toolbar-font-menu.png', fullPage: true })
await fontMenu.getByRole('menuitemradio', { name: '24' }).click()
const anchorButton = toolbar.getByRole('button', { name: 'Anchor drawing' })
assert.equal(await anchorButton.getAttribute('aria-pressed'), 'false')
await anchorButton.click()
assert.equal(await toolbar.getByRole('button', { name: 'Unanchor drawing' }).getAttribute('aria-pressed'), 'true')
await toolbar.getByRole('button', { name: 'Unanchor drawing' }).click()
await toolbar.getByRole('button', { name: 'Drawing properties' }).click()
const dialog = page.getByRole('dialog', { name: 'Edit text-annotation drawing' })
await dialog.waitFor()
assert.deepEqual(await dialog.getByRole('tab').allTextContents(), ['Text', 'Visibility'])
assert.equal(await dialog.getByRole('textbox', { name: 'Text' }).getAttribute('placeholder'), 'Add text')
assert.deepEqual(await dialog.getByRole('combobox', { name: 'Font size' }).locator('option').allTextContents(), ['8', '10', '11', '12', '14', '16', '18', '20', '22', '24', '28', '32', '40'])
assert.equal(await dialog.getByRole('checkbox', { name: 'Background' }).count(), 1)
assert.equal(await dialog.getByRole('checkbox', { name: 'Border' }).count(), 1)
assert.equal(await dialog.getByRole('checkbox', { name: 'Text wrap' }).count(), 1)
assert.equal(await dialog.getByRole('combobox', { name: 'Font size' }).inputValue(), '24')
await dialog.getByRole('textbox', { name: 'Text' }).fill('Text follows the chart and wraps when requested')
await dialog.getByRole('checkbox', { name: 'Background' }).click()
await dialog.getByRole('checkbox', { name: 'Border' }).click()
await dialog.getByRole('checkbox', { name: 'Text wrap' }).click()
await dialog.getByRole('button', { name: 'Text background color' }).click()
const backgroundPalette = page.getByRole('dialog', { name: 'Text background color palette' })
assert.equal(await dialog.evaluate((node, palette) => node.contains(palette), await backgroundPalette.elementHandle()), false)
await backgroundPalette.getByRole('button', { name: 'Set color #393b40' }).click()
await dialog.screenshot({ path: '/tmp/text-properties.png' })
await dialog.getByRole('button', { name: 'Ok' }).click()
await page.keyboard.press('Escape')
await page.mouse.move(10, 10)
await page.waitForTimeout(100)
assert.notEqual(await signature(), beforeEmptyText, 'Authored Text must remain after deselection')

const mobile = await browser.newPage({ viewport: { width: 375, height: 812 } })
mobile.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
mobile.on('pageerror', (error) => errors.push(error.message))
await mobile.goto(`${baseUrl}/?qa=text-properties-mobile`, { waitUntil: 'networkidle' })
const hidePanel = mobile.getByRole('button', { name: 'Hide operations panel' })
if (await hidePanel.count()) await hidePanel.click()
await mobile.getByRole('button', { name: 'Text and notes' }).click()
await mobile.getByRole('menu', { name: 'Text and notes menu' }).getByRole('menuitem', { name: 'Text', exact: true }).click()
await mobile.mouse.click(190, 360)
const mobileInlineEditor = mobile.getByRole('textbox', { name: 'Inline text editor' })
await mobileInlineEditor.waitFor()
await mobileInlineEditor.fill('Mobile note')
await mobileInlineEditor.press('Enter')
const mobileToolbar = mobile.getByRole('toolbar', { name: 'Selected Text drawing' })
await mobileToolbar.waitFor()
await mobileToolbar.getByRole('button', { name: 'Drawing properties' }).click()
const mobileDialog = mobile.getByRole('dialog', { name: 'Edit text-annotation drawing' })
await mobileDialog.waitFor()
const mobileBox = await mobileDialog.boundingBox()
assert(mobileBox)
assert(mobileBox.x >= 0 && mobileBox.x + mobileBox.width <= 375)
assert(mobileBox.y >= 0 && mobileBox.y + mobileBox.height <= 812)
assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true)
assert.deepEqual(errors, [])

console.log(JSON.stringify({ result: 'pass', inlineEditorFocused: true, placeholderSelected: true, emptyTextRemoved: true, authoredTextPreserved: true, anchorToggled: true, tabs: ['Text', 'Visibility'], fontSizes: 13, mobileBox, consoleErrors: 0 }, null, 2))
await browser.close()
