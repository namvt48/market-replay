#!/usr/bin/env node

const baseUrl = (process.env.MARKET_REPLAY_URL ?? 'http://127.0.0.1:8080').replace(/\/$/, '')
const evalPreferenceKey = 'replay:eval:accounts'
const demoAccountPrefix = 'demo-eval-'

const evalConfig = {
  firm: 'FTMO 100K (static)',
  phase: 'eval',
  accountSize: 100000,
  profitTarget: 10000,
  verificationProfitTarget: 0,
  maxDailyLoss: 5000,
  maxTotalLoss: 10000,
  drawdownType: 'static',
  trailingLocksAtStart: false,
  trailingLockAtTarget: false,
  lockMargin: 0,
  trailingEod: false,
  maxPositionSize: 0,
  minTradingDays: 4,
  consistencyRulePct: 0,
  consistencyMode: 'net-profit',
  dailyLossBase: 'midnight-balance',
  dayResetHour: 0,
}

function random(seed) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function shortEvalAccountHash(accountId) {
  let hash = 0x811c9dc5
  for (let index = 0; index < accountId.length; index += 1) {
    hash ^= accountId.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6)
}

function makeTrades({ count, seed, startTs, targetNetCents, symbol = 'NQ' }) {
  const next = random(seed)
  const trades = []
  let net = 0
  for (let index = 0; index < count; index += 1) {
    const day = Math.floor(index / 4)
    const slot = index % 4
    const entryTs = startTs + day * 86400 + (9 * 3600) + slot * 5400 + Math.floor(next() * 900)
    const duration = 300 + Math.floor(next() * 4200)
    const side = next() > 0.47 ? 'long' : 'short'
    const qty = next() > 0.82 ? 2 : 1
    const win = next() > 0.46
    const realizedCents = win
      ? 18000 + Math.floor(next() * 82000)
      : -(12000 + Math.floor(next() * 68000))
    const riskCents = 40000
    const entryPriceTicks = 80000 + Math.floor(next() * 6000)
    const tickMove = Math.max(1, Math.round(Math.abs(realizedCents) / (qty * 500)))
    const direction = (side === 'long' ? 1 : -1) * (realizedCents >= 0 ? 1 : -1)
    const stopDistance = 80
    const initialStopTicks = entryPriceTicks + (side === 'long' ? -stopDistance : stopDistance)
    const initialTakeProfitTicks = entryPriceTicks + (side === 'long' ? 160 : -160)
    const exitTs = entryTs + duration
    trades.push({
      id: `demo-${seed}-${index + 1}`,
      sessionId: '',
      symbol,
      side,
      qty,
      entryTs,
      entryPriceTicks,
      exitTs,
      exitPriceTicks: entryPriceTicks + direction * tickMove,
      realizedCents,
      feesCents: qty * 450,
      mfeTicks: win ? tickMove + Math.floor(next() * 35) : Math.floor(next() * 24),
      maeTicks: win ? Math.floor(next() * 28) : tickMove + Math.floor(next() * 30),
      rMultiple: Number((realizedCents / riskCents).toFixed(2)),
      initialStopTicks,
      initialTakeProfitTicks,
      protectionAdjustments: index % 7 === 0 ? [{ role: 'stopLoss', ts: entryTs + Math.floor(duration / 2), priceTicks: entryPriceTicks }] : [],
      exitReason: win && index % 3 === 0 ? 'takeProfit' : !win && index % 4 === 0 ? 'stopLoss' : 'manual',
      createdAt: exitTs,
    })
    net += realizedCents
  }
  const correction = targetNetCents - net
  const last = trades.at(-1)
  if (last) {
    last.realizedCents += correction
    last.rMultiple = Number((last.realizedCents / 40000).toFixed(2))
    const correctedMove = Math.max(1, Math.round(Math.abs(last.realizedCents) / (last.qty * 500)))
    const correctedDirection = (last.side === 'long' ? 1 : -1) * (last.realizedCents >= 0 ? 1 : -1)
    last.exitPriceTicks = last.entryPriceTicks + correctedDirection * correctedMove
    last.mfeTicks = last.realizedCents >= 0 ? correctedMove + 12 : 10
    last.maeTicks = last.realizedCents >= 0 ? 8 : correctedMove + 12
  }
  return trades
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init)
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`)
  if (response.status === 204) return null
  return response.json()
}

async function ensureSession(sessions, definition) {
  let session = sessions.find((item) => (item.name === definition.name || item.name === definition.legacyName) && item.kind === definition.kind)
  if (!session) {
    const created = await request('/api/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: definition.name,
        symbol: definition.symbol,
        tf: definition.tf,
        startTs: definition.startTs,
        kind: definition.kind,
        initialBalanceCents: definition.initialBalanceCents,
        config: {},
      }),
    })
    session = { id: created.id }
  }
  const cursorTs = definition.trades.at(-1).exitTs
  await request(`/api/v1/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: definition.name,
      cursorTs,
      equityCents: definition.initialBalanceCents + definition.targetNetCents,
      status: definition.status,
    }),
  })
  const journal = definition.trades.map((trade) => ({ ...trade, sessionId: session.id }))
  await request(`/api/v1/sessions/${encodeURIComponent(session.id)}/trades`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(journal),
  })
  return { id: session.id, cursorTs, journal }
}

function evalAccount({ id, session, outcome, netCents, failReason = null }) {
  const balance = evalConfig.accountSize + netCents / 100
  const phase = outcome === 'in_progress' ? 'paused' : outcome
  return {
    version: 2,
    phase,
    accountId: id,
    name: null,
    sessionId: session.id,
    config: evalConfig,
    instrument: null,
    sessionTimezone: 'America/New_York',
    startDate: '2025-01-06',
    startTs: session.journal[0].entryTs,
    attemptStartedAt: session.journal[0].entryTs,
    lastCursorTs: session.cursorTs,
    runtime: {
      startBalance: evalConfig.accountSize,
      peakEquity: Math.max(evalConfig.accountSize, balance),
      eodPeak: Math.max(evalConfig.accountSize, balance),
      lastEquity: balance,
      dayKey: Math.floor(session.cursorTs / 86400),
      dayStartEquity: balance,
      dayStartBalance: balance,
      outcome,
      failReason,
      failedAt: outcome === 'failed' ? session.cursorTs : null,
      passedAt: outcome === 'passed' ? session.cursorTs : null,
    },
    baselineRealizedCents: 0,
    baselineEquityCents: 10000000,
    lastEvalBalance: balance,
    lastEvalEquity: balance,
    lastTradeIds: session.journal.map((trade) => trade.id),
    trades: session.journal.map((trade) => ({
      id: trade.id,
      symbol: trade.symbol,
      side: trade.side,
      qty: trade.qty,
      entryTime: trade.entryTs,
      exitTime: trade.exitTs,
      entryPriceTicks: trade.entryPriceTicks,
      exitPriceTicks: trade.exitPriceTicks,
      realizedCents: trade.realizedCents,
      feesCents: trade.feesCents,
      mfeTicks: trade.mfeTicks,
      maeTicks: trade.maeTicks,
      rMultiple: trade.rMultiple,
      initialStopTicks: trade.initialStopTicks,
      initialTakeProfitTicks: trade.initialTakeProfitTicks,
      protectionAdjustments: trade.protectionAdjustments,
      exitReason: trade.exitReason,
    })),
  }
}

async function main() {
  const startTs = Math.floor(Date.parse('2025-01-06T00:00:00Z') / 1000)
  const definitions = [
    { key: 'progress', legacyName: 'Eval - In Progress', kind: 'eval', status: 'paused', symbol: 'NQ', tf: '5m', count: 64, seed: 101, targetNetCents: 245000, initialBalanceCents: 10000000, outcome: 'in_progress' },
    { key: 'failed', legacyName: 'Eval - Failed', kind: 'eval', status: 'stopped', symbol: 'NQ', tf: '5m', count: 66, seed: 202, targetNetCents: -1055000, initialBalanceCents: 10000000, outcome: 'failed', failReason: 'total' },
    { key: 'passed', legacyName: 'Eval - Passed', kind: 'eval', status: 'stopped', symbol: 'NQ', tf: '5m', count: 68, seed: 303, targetNetCents: 1105000, initialBalanceCents: 10000000, outcome: 'passed' },
    { key: 'replay', name: 'Replay - Opening Range', kind: 'replay', status: 'paused', symbol: 'ES', tf: '5m', count: 44, seed: 404, targetNetCents: 186500, initialBalanceCents: 1000000 },
  ].map((definition, index) => {
    const accountId = definition.kind === 'eval' ? `${demoAccountPrefix}${definition.key}` : null
    return {
      ...definition,
      accountId,
      name: accountId ? `#${shortEvalAccountHash(accountId)}` : definition.name,
      startTs: startTs + index * 35 * 86400,
      trades: makeTrades({ count: definition.count, seed: definition.seed, startTs: startTs + index * 35 * 86400, targetNetCents: definition.targetNetCents, symbol: definition.symbol }),
    }
  })

  const sessions = await request('/api/v1/sessions')
  const seeded = new Map()
  for (const definition of definitions) seeded.set(definition.key, await ensureSession(sessions, definition))

  const preferences = await request('/api/v1/preferences')
  const existing = Array.isArray(preferences[evalPreferenceKey]) ? preferences[evalPreferenceKey] : []
  const demoAccounts = definitions.filter((definition) => definition.kind === 'eval').map((definition) => evalAccount({
    id: definition.accountId,
    session: seeded.get(definition.key),
    outcome: definition.outcome,
    netCents: definition.targetNetCents,
    failReason: definition.failReason,
  }))
  const accounts = [...demoAccounts, ...existing.filter((account) => !String(account?.accountId ?? '').startsWith(demoAccountPrefix))].slice(0, 50)
  await request(`/api/v1/preferences/${encodeURIComponent(evalPreferenceKey)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(accounts),
  })

  const summary = definitions.map((definition) => ({
    name: definition.name,
    type: definition.kind,
    outcome: definition.outcome ?? definition.status,
    trades: definition.count,
    sessionId: seeded.get(definition.key).id,
  }))
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
