import { chromium } from 'playwright'

const baseUrl = 'http://127.0.0.1:8080'
const evalSourceId = 'a16ece49-974e-4c23-a6c9-0b5b87bb8636'
const replaySourceId = '8c21bef8-ce84-4e0f-88f9-c51f71679804'
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
  const simulationResponses = []
  page.on('response', (response) => {
    if (response.url().includes('/analytics/simulations/')) simulationResponses.push({ url: response.url(), status: response.status() })
  })

  await page.goto(`${baseUrl}/?analytics=${evalSourceId}&sourceType=evaluation`, { waitUntil: 'networkidle' })
  const sourceSelect = page.getByRole('combobox', { name: 'Analytics source' })
  await sourceSelect.waitFor()
  const sourceSnapshot = await sourceSelect.locator('option').evaluateAll((options) => options.map((option) => ({ label: option.textContent?.trim(), value: option.value })))
  const sourceGroups = await sourceSelect.locator('optgroup').evaluateAll((groups) => groups.map((group) => group.label))

  await page.getByRole('tab', { name: 'Simulation' }).click()
  await page.getByRole('table', { name: 'Stop loss simulation results' }).waitFor()
  await page.getByRole('table', { name: 'Risk-reward simulation results' }).waitFor()
  const simulationErrorCount = await page.getByText(/422 Unprocessable Entity|no eligible trades/i).count()

  await page.getByRole('tab', { name: 'Drawdown' }).click()
  const drawdown = page.getByRole('img', { name: /Drawdown on equity in dollars/ })
  await drawdown.waitFor()
  const chartBox = await drawdown.boundingBox()
  if (!chartBox) throw new Error('Drawdown chart has no bounding box')
  await page.mouse.move(chartBox.x + chartBox.width * 0.55, chartBox.y + chartBox.height * 0.45)
  const floatingTooltip = page.locator('body > [role="tooltip"]').first()
  await floatingTooltip.waitFor()
  const tooltipSnapshot = {
    className: await floatingTooltip.getAttribute('class'),
    parentTag: await floatingTooltip.evaluate((element) => element.parentElement?.tagName),
    nativeSvgTitles: await drawdown.locator('title').count(),
    box: await floatingTooltip.boundingBox(),
  }
  await page.screenshot({ path: '/tmp/final-analytics-drawdown.png', fullPage: false })

  await sourceSelect.selectOption(`session:${replaySourceId}`)
  await page.waitForURL((url) => url.searchParams.get('sourceType') === 'session' && url.searchParams.get('analytics') === replaySourceId)
  const switchedValue = await page.getByRole('combobox', { name: 'Analytics source' }).inputValue()

  const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
  await mobile.goto(`${baseUrl}/start/eval`, { waitUntil: 'networkidle' })
  await mobile.getByRole('heading', { name: 'Evaluation Simulator' }).waitFor()
  const bodyText = await mobile.locator('body').innerText()
  const mobileSnapshot = {
    horizontalOverflow: await mobile.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth),
    spinbuttons: await mobile.getByRole('spinbutton').count(),
    hasPayoutFlow: /payout|funded|verification/i.test(bodyText),
    presetButtons: await mobile.locator('[aria-pressed]').count(),
  }
  await mobile.screenshot({ path: '/tmp/final-eval-setup-mobile.png', fullPage: true })

  console.log(JSON.stringify({ sourceGroups, sourceSnapshot, simulationResponses, simulationErrorCount, tooltipSnapshot, switchedValue, mobileSnapshot }, null, 2))
} finally {
  await browser.close()
}
