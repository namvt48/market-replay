import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } })
await page.goto(process.env.QA_BASE_URL ?? 'http://127.0.0.1:8080/?qa=range-click-repro', { waitUntil: 'networkidle' })
await page.getByRole('button', { name: 'Range tools' }).click()
await page.getByRole('menu', { name: 'Range tools menu' }).getByRole('menuitem', { name: 'Price Range', exact: true }).click()
await page.mouse.click(320, 280)
await page.mouse.click(650, 520)
const selected = page.getByRole('toolbar', { name: 'Selected Price Range drawing' })
await page.waitForTimeout(100)
assert.equal(await selected.count(), 1, 'Price Range must complete after two chart clicks')
await browser.close()
