// Replay performance harness: drives a real browser against a running
// server, plays a replay session at maximum speed, and reports frame
// pacing — or, with --profile, a CPU profile attributed to the call sites
// in our own code rather than to Lightweight Charts internals.
//
// The frame-pacing numbers are what matter: a replay that keeps a 60 fps
// cadence with no long tasks stays scrubbable and clickable, while one that
// stalls for hundreds of milliseconds does not, even at the same nominal
// speed.
//
//   node artifacts/perf/replay-perf.mjs --port 8080 [--panes 4] [--profile]
//   node artifacts/perf/replay-perf.mjs --port 8080 --panes 4 --screenshot out.png
//
// Requires the Go server running with real data, and `pnpm install` (the
// playwright dev dependency provides the browser).

import { chromium } from 'playwright'

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`)
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith('--') ? args[index + 1] : fallback
}
const has = (name) => args.includes(`--${name}`)

const PORT = flag('port', '8080')
const PANES = Number(flag('panes', '1'))
const SPEED = flag('speed', '500')
const SECONDS = Number(flag('seconds', '5'))
const SCREENSHOT = flag('screenshot', null)

const out = (label, value) => console.log(`${label.padEnd(34)} ${value}`)

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(String(error)))

// Long tasks and frame deltas, observed from before any app code runs.
await page.addInitScript(() => {
  window.__perf = { longTasks: [], frames: [] }
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.__perf.longTasks.push(Math.round(entry.duration))
  }).observe({ entryTypes: ['longtask'] })
  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    window.__perf.frames.push(now - last)
    last = now
    requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
})

const startedAt = Date.now()
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => !document.body.textContent?.includes('Loading market data'), null, { timeout: 30_000 })
out('time to chart ready (ms)', Date.now() - startedAt)

const apiCalls = await page.evaluate(() => performance.getEntriesByType('resource')
  .filter((entry) => entry.name.includes('/api/v1/'))
  .map((entry) => `${entry.name.replace(location.origin, '').split('?')[0]} ${Math.round(entry.duration)}ms ${Math.round(entry.encodedBodySize / 1024)}KB`))
out('api calls during load', `\n  ${apiCalls.join('\n  ')}`)

if (PANES > 1) {
  // Through the UI, so the layout is the one the app actually builds.
  const preset = PANES === 2 ? '2 charts vertical' : PANES === 3 ? '3 charts' : '4 charts'
  await page.getByRole('button', { name: 'Chart layouts' }).click()
  await page.getByRole('button', { name: preset }).click()
  await page.waitForFunction((count) => document.querySelectorAll('[data-chart-host]').length === count, PANES, { timeout: 20_000 })
  await page.waitForTimeout(2_000)
}
out('chart panes mounted', await page.locator('[data-chart-host]').count())

await page.getByRole('button', { name: /Start bar replay|select start bar/i }).click()
await page.waitForTimeout(500)
const box = await page.locator('[data-chart-host]').first().boundingBox()
await page.mouse.click(box.x + box.width * 0.55, box.y + box.height * 0.5)
await page.waitForSelector('#replay-controls', { timeout: 15_000 })
await page.selectOption('#replay-controls select', SPEED)

let cdp = null
if (has('profile')) {
  cdp = await page.context().newCDPSession(page)
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 })
  await cdp.send('Profiler.start')
}

await page.evaluate(() => { window.__perf.frames.length = 0; window.__perf.longTasks.length = 0 })
await page.getByRole('button', { name: /Play replay/i }).click()
await page.waitForTimeout(SECONDS * 1_000)

const perf = await page.evaluate(() => {
  const frames = window.__perf.frames.slice().sort((a, b) => a - b)
  const at = (ratio) => Math.round((frames[Math.floor(frames.length * ratio)] ?? 0) * 10) / 10
  return {
    frameCount: frames.length,
    p50: at(0.5), p95: at(0.95), p99: at(0.99),
    worst: Math.round((frames.at(-1) ?? 0) * 10) / 10,
    longTasks: window.__perf.longTasks.length,
    worstLongTask: Math.max(0, ...window.__perf.longTasks),
  }
})
out(`frames rendered in ${SECONDS}s`, perf.frameCount)
out('frame interval p50/p95/p99/max (ms)', `${perf.p50} / ${perf.p95} / ${perf.p99} / ${perf.worst}`)
out('long tasks >50ms', `${perf.longTasks} (worst ${perf.worstLongTask}ms)`)
out('console/page errors', errors.length ? errors.join(' | ') : 'none')

if (cdp) {
  const { profile } = await cdp.send('Profiler.stop')
  // Roll library self-time up to the nearest ancestor frame in our own
  // bundle: knowing that 60% of frame time sits inside the chart library is
  // useless until you know which of our calls put it there.
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const parent = new Map()
  for (const node of profile.nodes) for (const child of node.children ?? []) parent.set(child, node.id)
  const label = (frame) => `${frame.functionName || '(anonymous)'} @ ${(frame.url || '').split('/').pop() || 'native'}`
  const isOurs = (frame) => /lwc-adapter|assets\/index-/.test(frame.url || '')

  const attributed = new Map()
  for (const id of profile.samples ?? []) {
    let cursor = id
    let key = null
    while (cursor !== undefined) {
      const node = byId.get(cursor)
      if (!node) break
      if (isOurs(node.callFrame)) { key = label(node.callFrame); break }
      cursor = parent.get(cursor)
    }
    key = key ?? `(library/native) ${label(byId.get(id)?.callFrame ?? { functionName: '?', url: '' })}`
    attributed.set(key, (attributed.get(key) ?? 0) + 1)
  }
  const total = (profile.samples ?? []).length
  console.log(`\nCPU profile — ${total} samples, attributed to our call sites:`)
  ;[...attributed.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)
    .forEach(([key, count]) => console.log(`  ${(count / total * 100).toFixed(1).padStart(5)}%  ${key}`))
}

if (SCREENSHOT) await page.screenshot({ path: SCREENSHOT })
await browser.close()
