import type { BarFrame } from '../api/binary-frame'
import type { Bar1m } from '../fill-engine/types'

export class BarSource {
  readonly frame: BarFrame

  constructor(frame: BarFrame) { this.frame = frame }

  append(page: BarFrame): BarSource {
    if (page.count === 0) return this
    if (page.tickNum !== this.frame.tickNum || page.tickDen !== this.frame.tickDen) {
      throw new Error('Cannot append bars with a different tick size')
    }
    let pageFrom = 0
    while (pageFrom < page.count && page.ts[pageFrom] <= this.lastTs) pageFrom += 1
    if (pageFrom === page.count) return this
    const appended = page.count - pageFrom
    const count = this.frame.count + appended
    const ts = new Uint32Array(count)
    const open = new Int32Array(count)
    const high = new Int32Array(count)
    const low = new Int32Array(count)
    const close = new Int32Array(count)
    const volume = new Uint32Array(count)
    ts.set(this.frame.ts)
    open.set(this.frame.open)
    high.set(this.frame.high)
    low.set(this.frame.low)
    close.set(this.frame.close)
    volume.set(this.frame.volume)
    ts.set(page.ts.subarray(pageFrom), this.frame.count)
    open.set(page.open.subarray(pageFrom), this.frame.count)
    high.set(page.high.subarray(pageFrom), this.frame.count)
    low.set(page.low.subarray(pageFrom), this.frame.count)
    close.set(page.close.subarray(pageFrom), this.frame.count)
    volume.set(page.volume.subarray(pageFrom), this.frame.count)
    return new BarSource({
      count,
      tickNum: this.frame.tickNum,
      tickDen: this.frame.tickDen,
      ts,
      open,
      high,
      low,
      close,
      volume,
    })
  }

  get count(): number { return this.frame.count }
  get firstTs(): number { return this.frame.count > 0 ? this.frame.ts[0] : 0 }
  get lastTs(): number { return this.frame.count > 0 ? this.frame.ts[this.frame.count - 1] : 0 }

  at(index: number): Bar1m | null {
    if (index < 0 || index >= this.frame.count) return null
    return {
      ts: this.frame.ts[index], openTicks: this.frame.open[index], highTicks: this.frame.high[index],
      lowTicks: this.frame.low[index], closeTicks: this.frame.close[index], volume: this.frame.volume[index],
    }
  }

  findIndex(timestamp: number): number {
    let low = 0
    let high = this.frame.count
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.frame.ts[middle] <= timestamp) low = middle + 1
      else high = middle
    }
    return Math.max(0, low - 1)
  }

  findIndexAtOrAfter(timestamp: number): number {
    let low = 0
    let high = this.frame.count
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2)
      if (this.frame.ts[middle] < timestamp) low = middle + 1
      else high = middle
    }
    return Math.min(Math.max(0, this.frame.count - 1), low)
  }
}
