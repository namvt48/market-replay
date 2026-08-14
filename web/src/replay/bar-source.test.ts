import { describe, expect, it } from 'vitest'
import type { BarFrame } from '../api/binary-frame'
import { BarSource } from './bar-source'

function frame(timestamps: number[], closeOffset = 0): BarFrame {
  const count = timestamps.length
  return {
    count,
    tickNum: 1,
    tickDen: 4,
    ts: Uint32Array.from(timestamps),
    open: Int32Array.from(timestamps, (timestamp) => timestamp + closeOffset),
    high: Int32Array.from(timestamps, (timestamp) => timestamp + closeOffset + 2),
    low: Int32Array.from(timestamps, (timestamp) => timestamp + closeOffset - 1),
    close: Int32Array.from(timestamps, (timestamp) => timestamp + closeOffset + 1),
    volume: Uint32Array.from(timestamps, () => 10),
  }
}

describe('BarSource', () => {
  it('appends a fetched page without duplicating the boundary bar', () => {
    const source = new BarSource(frame([60, 120, 180]))

    const merged = source.append(frame([180, 240, 300], 1000))

    expect(merged.count).toBe(5)
    expect(Array.from(merged.frame.ts)).toEqual([60, 120, 180, 240, 300])
    expect(merged.at(2)?.closeTicks).toBe(181)
    expect(merged.at(4)?.closeTicks).toBe(1301)
  })
})
