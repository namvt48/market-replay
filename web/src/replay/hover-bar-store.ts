import { useSyncExternalStore } from 'react'

export interface HoverBarSnapshot {
  time: number
  open: number
  high: number
  low: number
  close: number
  hovered: boolean
}

export class HoverBarStore {
  private snapshot: HoverBarSnapshot | null = null
  private pending: HoverBarSnapshot | null = null
  private hasPending = false
  private frame = 0
  private listeners = new Set<() => void>()

  getSnapshot = (): HoverBarSnapshot | null => this.snapshot
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => this.listeners.delete(listener) }

  emit(value: HoverBarSnapshot | null): void {
    this.pending = value
    this.hasPending = true
    if (this.frame !== 0) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      if (!this.hasPending) return
      this.hasPending = false
      this.snapshot = this.pending
      this.listeners.forEach((listener) => listener())
    })
  }

  destroy(): void {
    if (this.frame !== 0) cancelAnimationFrame(this.frame)
    this.frame = 0
    this.hasPending = false
    this.listeners.clear()
  }
}

export function useHoverBar(store: HoverBarStore): HoverBarSnapshot | null {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}
