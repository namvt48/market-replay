// Zero-copy decoder for the RBR1 binary frame format served by
// GET /api/v1/bars and /bars/at (docs §6.2). Mirrors the server's
// internal/bars/frame.go byte-for-byte: 24-byte header, then six
// little-endian column arrays (ts, open, high, low, close, volume).
// Prices are int32 ticks — multiply by tickNum/tickDen to get a real
// price (docs N4: never float on the data path).

const HEADER_SIZE = 24
const MAGIC = 'RBR1'

export interface BarFrame {
  count: number
  tickNum: number
  tickDen: number
  ts: Uint32Array
  open: Int32Array
  high: Int32Array
  low: Int32Array
  close: Int32Array
  volume: Uint32Array
}

export function decodeBarFrame(buf: ArrayBuffer): BarFrame {
  if (buf.byteLength < HEADER_SIZE) {
    throw new Error(`decodeBarFrame: frame is ${buf.byteLength} bytes; expected at least ${HEADER_SIZE}`)
  }
  const dv = new DataView(buf)
  const magic = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3),
  )
  if (magic !== MAGIC) {
    throw new Error(`decodeBarFrame: bad magic ${JSON.stringify(magic)}`)
  }

  const version = dv.getUint16(4, true)
  if (version !== 1) {
    throw new Error(`decodeBarFrame: unsupported version ${version}`)
  }

  const count = dv.getUint32(8, true)
  const tickNum = dv.getInt32(12, true)
  const tickDen = dv.getInt32(16, true)
  if (tickDen === 0) {
    throw new Error('decodeBarFrame: tick denominator cannot be zero')
  }
  const expectedBytes = HEADER_SIZE + count * 24
  if (buf.byteLength !== expectedBytes) {
    throw new Error(`decodeBarFrame: size ${buf.byteLength} does not match count ${count} (${expectedBytes})`)
  }

  let offset = HEADER_SIZE
  const ts = new Uint32Array(buf, offset, count)
  offset += 4 * count
  const open = new Int32Array(buf, offset, count)
  offset += 4 * count
  const high = new Int32Array(buf, offset, count)
  offset += 4 * count
  const low = new Int32Array(buf, offset, count)
  offset += 4 * count
  const close = new Int32Array(buf, offset, count)
  offset += 4 * count
  const volume = new Uint32Array(buf, offset, count)

  return { count, tickNum, tickDen, ts, open, high, low, close, volume }
}

// ticksToPrice converts a raw int32 tick value from a BarFrame column to
// a real price, using that frame's own tickNum/tickDen (never a
// hardcoded tick size — docs N5).
export function ticksToPrice(ticks: number, frame: Pick<BarFrame, 'tickNum' | 'tickDen'>): number {
  return (ticks * frame.tickNum) / frame.tickDen
}

export function priceToTicks(price: number, frame: Pick<BarFrame, 'tickNum' | 'tickDen'>): number {
  return Math.round((price * frame.tickDen) / frame.tickNum)
}
