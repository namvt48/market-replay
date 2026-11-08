/// <reference types="node" />

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { RustChartEngine } from './rust-chart-engine'
import type { DisplayBar } from './chart-adapter'

const makeBar = (time: number, close: number): DisplayBar => ({
  time,
  open: close - 1,
  high: close + 1,
  low: close - 2,
  close,
  volume: 10,
})

beforeAll(async () => {
  const artifact = await readFile(resolve(process.cwd(), 'src/replay/chart-engine.wasm'))
  const bytes = Uint8Array.from(artifact).buffer
  const response = {
    ok: true,
    status: 200,
    arrayBuffer: async () => bytes,
  } as Response
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))
})

afterAll(() => vi.unstubAllGlobals())

it('transfers history, spacers and geometry through the real Wasm ABI', async () => {
  const engine = await RustChartEngine.create()
  try {
    engine.resize(800, 600)
    engine.setHistory([makeBar(100, 11), makeBar(101, 12), makeBar(102, 13)])
    expect(engine.barCount()).toBe(3)
    expect(engine.setVisibleRange(0, 2)).toBe(true)

    engine.setSpacerTimes([103])
    expect(engine.timeToLogical(103)).toBe(3)
    expect(engine.logicalToTime(3)).toBe(103)
    expect(engine.focusTime(103)).toBe(true)

    engine.pushBars([makeBar(102, 15)])
    expect(engine.barCount()).toBe(3)
    const geometry = engine.renderGeometry()
    expect(geometry).toBeInstanceOf(Float64Array)
    expect(geometry.length).toBeGreaterThan(0)
    expect(engine.priceRange().max).toBeGreaterThan(engine.priceRange().min)

    expect(() => engine.setHistory([{ ...makeBar(104, 16), high: 1 }])).toThrow(RangeError)
    expect(engine.barCount()).toBe(3)
  } finally {
    engine.destroy()
  }
  expect(() => engine.barCount()).toThrow('Chart engine has been destroyed')
})

it('keeps inversion independent and exposes percentage axis values through Wasm', async () => {
  const engine = await RustChartEngine.create()
  try {
    engine.resize(800, 600)
    engine.setHistory([makeBar(100, 11), makeBar(101, 12), makeBar(102, 13)])
    expect(engine.setVisibleRange(0, 2)).toBe(true)
    engine.setPriceScaleMode('percentage')
    expect(engine.priceToScaleValue(12)).toBeCloseTo(100 / 11)

    const normalY = engine.priceToY(12)
    engine.setInvertedScale(true)
    expect(engine.priceScaleMode()).toBe('percentage')
    expect(engine.priceToScaleValue(12)).toBeCloseTo(100 / 11)
    expect(engine.priceToY(12)).not.toBe(normalY)
    expect(engine.yToPrice(engine.priceToY(12)!)).toBeCloseTo(12)

    engine.setPriceScaleMode('logarithmic')
    engine.setInvertedScale(false)
    expect(engine.priceScaleMode()).toBe('logarithmic')
    expect(engine.priceToScaleValue(12)).toBe(12)
  } finally {
    engine.destroy()
  }
})

it('round-trips normal, logarithmic, and positive-base percentage coordinates', async () => {
  const engine = await RustChartEngine.create()
  try {
    engine.setHistory([makeBar(100, 11), makeBar(101, 12), makeBar(102, 13)])
    expect(engine.setVisibleRange(0, 2)).toBe(true)
    for (const mode of ['normal', 'logarithmic', 'percentage'] as const) {
      engine.setPriceScaleMode(mode)
      const coordinate = engine.priceToScaleCoordinate(12)
      expect(coordinate).not.toBeNull()
      expect(engine.scaleCoordinateToPrice(coordinate!)).toBeCloseTo(12)
    }
  } finally {
    engine.destroy()
  }
})

it('round-trips negative-base percentage and falls back to linear at zero', async () => {
  const engine = await RustChartEngine.create()
  try {
    engine.setHistory([makeBar(100, -10), makeBar(101, -12)])
    expect(engine.setVisibleRange(0, 1)).toBe(true)
    engine.setPriceScaleMode('percentage')
    expect(engine.priceToScaleCoordinate(-12)).toBeCloseTo(-20)
    expect(engine.scaleCoordinateToPrice(-20)).toBeCloseTo(-12)

    engine.setHistory([makeBar(100, 0), makeBar(101, 2)])
    expect(engine.setVisibleRange(0, 1)).toBe(true)
    expect(engine.priceToScaleCoordinate(2)).toBe(2)
    expect(engine.scaleCoordinateToPrice(2)).toBe(2)
  } finally {
    engine.destroy()
  }
})
