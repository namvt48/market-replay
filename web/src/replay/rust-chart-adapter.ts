import type { HoverBarStore } from './hover-bar-store'
import { LwcAdapter } from './lwc-adapter'
import { createRustChart } from './rust-chart-runtime'

/** Existing adapter behavior backed by the Rust/WASM chart runtime. */
export class RustChartAdapter extends LwcAdapter {
  constructor(hoverStore?: HoverBarStore) {
    super(hoverStore, createRustChart)
  }
}
