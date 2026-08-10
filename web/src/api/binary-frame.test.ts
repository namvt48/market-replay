import { describe, expect, it } from 'vitest'
import { decodeBarFrame, ticksToPrice } from './binary-frame'

function frameBuffer(): ArrayBuffer {
  const buffer = new ArrayBuffer(24 + 24)
  const view = new DataView(buffer)
  for (const [index, value] of [...'RBR1'].entries()) view.setUint8(index, value.charCodeAt(0))
  view.setUint16(4, 1, true)
  view.setUint32(8, 1, true)
  view.setInt32(12, 1, true)
  view.setInt32(16, 4, true)
  view.setUint32(24, 1_700_000_000, true)
  view.setInt32(28, 400, true)
  view.setInt32(32, 420, true)
  view.setInt32(36, 390, true)
  view.setInt32(40, 410, true)
  view.setUint32(44, 1200, true)
  return buffer
}

describe('decodeBarFrame', () => {
  it('decodes RBR1 columns without translating integer ticks', () => {
    const frame = decodeBarFrame(frameBuffer())
    expect(frame.count).toBe(1)
    expect(frame.close[0]).toBe(410)
    expect(ticksToPrice(frame.close[0], frame)).toBe(102.5)
  })

  it('fails loudly when the frame size does not match the declared count', () => {
    const buffer = frameBuffer()
    new DataView(buffer).setUint32(8, 2, true)
    expect(() => decodeBarFrame(buffer)).toThrow(/does not match count/)
  })
})
