#!/usr/bin/env node

const baseUrl = (process.env.MARKET_REPLAY_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const reviewPreferenceKey = 'market-replay:trade-review:v1'

const tagGroups = [
  {
    id: 'demo-setup', name: 'Setup', tags: [
      { id: 'demo-setup-breakout', name: 'Breakout', color: 'blue' },
      { id: 'demo-setup-trend', name: 'Trend continuation', color: 'green' },
      { id: 'demo-setup-reversal', name: 'Reversal', color: 'purple' },
      { id: 'demo-setup-range', name: 'Range', color: 'orange' },
      { id: 'demo-setup-pullback', name: 'Pullback', color: 'cyan' },
    ],
  },
  {
    id: 'demo-execution', name: 'Execution', tags: [
      { id: 'demo-execution-clean', name: 'Clean entry', color: 'green' },
      { id: 'demo-execution-chased', name: 'Chased', color: 'orange' },
      { id: 'demo-execution-early', name: 'Early entry', color: 'red' },
      { id: 'demo-execution-late', name: 'Late entry', color: 'purple' },
    ],
  },
  {
    id: 'demo-outcome', name: 'Outcome', tags: [
      { id: 'demo-outcome-a-plus', name: 'A+ winner', color: 'green' },
      { id: 'demo-outcome-managed', name: 'Managed loss', color: 'blue' },
      { id: 'demo-outcome-stop', name: 'Stop-out', color: 'red' },
      { id: 'demo-outcome-breakeven', name: 'Breakeven', color: 'grey' },
    ],
  },
  {
    id: 'demo-context', name: 'Context', tags: [
      { id: 'demo-context-open', name: 'Opening drive', color: 'cyan' },
      { id: 'demo-context-news', name: 'News window', color: 'orange' },
      { id: 'demo-context-low-volume', name: 'Low volume', color: 'grey' },
      { id: 'demo-context-high-conviction', name: 'High conviction', color: 'blue' },
    ],
  },
  {
    id: 'demo-risk', name: 'Risk', tags: [
      { id: 'demo-risk-oversized', name: 'Oversized', color: 'red' },
      { id: 'demo-risk-correct-size', name: 'Correct size', color: 'cyan' },
    ],
  },
]

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init)
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`)
  if (response.status === 204) return null
  return response.json()
}

function reviewTrade(source, trade, index) {
  return {
    id: trade.id ?? `${source.id}-${trade.exitTs}-${index}`,
    sourceId: source.id,
    sourceType: source.type,
    symbol: trade.symbol ?? 'NQ',
    side: trade.side ?? 'long',
    exitTs: trade.exitTs ?? trade.exitTime,
    realizedCents: trade.realizedCents ?? 0,
    rMultiple: trade.rMultiple ?? null,
  }
}

function documentFor(source, trade, index) {
  const snapshot = reviewTrade(source, trade, index)
  const positive = snapshot.realizedCents > 0
  const groupIndexes = [
    (index + (snapshot.side === 'short' ? 1 : 0)) % tagGroups[0].tags.length,
    (index + (positive ? 0 : 2)) % tagGroups[1].tags.length,
    positive ? (index % 3 === 0 ? 0 : 3) : (index % 2 === 0 ? 1 : 2),
    (index + (snapshot.symbol === 'ES' ? 1 : 0)) % tagGroups[3].tags.length,
    Number(trade.qty ?? 1) > 1 ? 0 : 1,
  ]
  const tagAssignments = Object.fromEntries(tagGroups.map((group, groupIndex) => [group.id, group.tags[groupIndexes[groupIndex]].id]))
  const note = index % 5 === 0
    ? `Demo review: ${positive ? 'protect the edge and document the winner.' : 'review the invalidation and execution discipline.'}`
    : ''
  return [
    `${source.type}:${source.id}:${snapshot.id}`,
    { note, screenshots: [], tagAssignments, trade: snapshot, updatedAt: Date.now() },
  ]
}

async function main() {
  const [sessions, preferences] = await Promise.all([
    request('/api/v1/sessions'),
    request('/api/v1/preferences'),
  ])
  const documents = {}
  let tradeCount = 0
  const sourceCounts = []

  for (const session of sessions.filter((item) => item.kind !== 'eval')) {
    const trades = await request(`/api/v1/sessions/${encodeURIComponent(session.id)}/trades`)
    const source = { id: session.id, type: 'session' }
    trades.forEach((trade, index) => { const [key, value] = documentFor(source, trade, index); documents[key] = value })
    tradeCount += trades.length
    sourceCounts.push({ type: source.type, id: source.id, name: session.name, trades: trades.length })
  }

  const accounts = Array.isArray(preferences['replay:eval:accounts']) ? preferences['replay:eval:accounts'] : []
  for (const account of accounts) {
    const trades = Array.isArray(account.trades) ? account.trades : []
    const source = { id: account.sessionId ?? account.accountId, type: 'evaluation' }
    trades.forEach((trade, index) => { const [key, value] = documentFor(source, trade, index); documents[key] = value })
    tradeCount += trades.length
    sourceCounts.push({ type: source.type, id: source.id, name: account.name ?? account.accountId, trades: trades.length })
  }

  const payload = JSON.stringify({ state: { documents, tagGroups }, version: 0 })
  await request(`/api/v1/preferences/${encodeURIComponent(reviewPreferenceKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
  })
  process.stdout.write(`${JSON.stringify({ sources: sourceCounts, tradeDocuments: tradeCount, tagGroups: tagGroups.length, tags: tagGroups.reduce((sum, group) => sum + group.tags.length, 0) }, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
