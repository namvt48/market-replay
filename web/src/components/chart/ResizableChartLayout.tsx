import { useEffect, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { CHART_SPLIT_SEPARATOR_SIZE_PX, type LayoutNode } from '../../chart-workspace/types'

interface ResizableChartLayoutProps {
  node: LayoutNode
  renderPane: (paneId: string) => ReactNode
  onResize: (splitId: string, ratio: number, totalSize: number) => void
}

interface DragState {
  pointerId: number
  start: number
  ratio: number
  total: number
  previousCursor: string
  previousUserSelect: string
}

export function ResizableChartLayout({ node, renderPane, onResize }: ResizableChartLayoutProps) {
  if (node.kind === 'pane') return <>{renderPane(node.paneId)}</>
  return <SplitLayout node={node} renderPane={renderPane} onResize={onResize} />
}

function SplitLayout({ node, renderPane, onResize }: ResizableChartLayoutProps & { node: Extract<LayoutNode, { kind: 'split' }> }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const pendingRef = useRef<{ ratio: number; total: number } | null>(null)
  const rafRef = useRef<number | null>(null)
  const horizontal = node.orientation === 'horizontal'

  const restoreDragStyles = (): void => {
    const drag = dragRef.current
    if (!drag) return
    document.documentElement.style.cursor = drag.previousCursor
    document.documentElement.style.userSelect = drag.previousUserSelect
  }

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    restoreDragStyles()
  }, [])

  const flush = (): void => {
    rafRef.current = null
    const pending = pendingRef.current
    pendingRef.current = null
    if (!pending) return
    onResize(node.id, pending.ratio, pending.total)
  }

  const start = (event: PointerEvent<HTMLButtonElement>): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return
    const total = horizontal ? rect.width : rect.height
    dragRef.current = {
      pointerId: event.pointerId,
      start: horizontal ? event.clientX : event.clientY,
      ratio: node.ratio,
      total,
      previousCursor: document.documentElement.style.cursor,
      previousUserSelect: document.documentElement.style.userSelect,
    }
    document.documentElement.style.cursor = horizontal ? 'col-resize' : 'row-resize'
    document.documentElement.style.userSelect = 'none'
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }

  const move = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const current = horizontal ? event.clientX : event.clientY
    pendingRef.current = { ratio: drag.ratio + (current - drag.start) / drag.total, total: drag.total }
    if (rafRef.current === null) rafRef.current = window.requestAnimationFrame(flush)
  }

  const stop = (event: PointerEvent<HTMLButtonElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    restoreDragStyles()
    dragRef.current = null
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) onResize(node.id, pending.ratio, pending.total)
  }

  const keyboard = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const rect = containerRef.current?.getBoundingClientRect()
    const total = horizontal ? rect?.width ?? 1000 : rect?.height ?? 700
    const negative = horizontal ? event.key === 'ArrowLeft' : event.key === 'ArrowUp'
    const positive = horizontal ? event.key === 'ArrowRight' : event.key === 'ArrowDown'
    if (!negative && !positive && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    const ratio = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : node.ratio + (negative ? -0.02 : 0.02)
    onResize(node.id, ratio, total)
  }

  return (
    <div ref={containerRef} className={`flex h-full min-h-0 min-w-0 ${horizontal ? 'flex-row' : 'flex-col'}`}>
      <div className="min-h-0 min-w-0" style={{ flexBasis: `${node.ratio * 100}%`, flexGrow: 0, flexShrink: 0 }}><ResizableChartLayout node={node.first} renderPane={renderPane} onResize={onResize} /></div>
      <button type="button" role="separator" aria-label={`Resize ${node.orientation} chart split`} aria-orientation={horizontal ? 'vertical' : 'horizontal'} aria-valuemin={20} aria-valuemax={80} aria-valuenow={Math.round(node.ratio * 100)} onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} onKeyDown={keyboard} style={horizontal ? { width: CHART_SPLIT_SEPARATOR_SIZE_PX, cursor: 'col-resize' } : { height: CHART_SPLIT_SEPARATOR_SIZE_PX, cursor: 'row-resize' }} className="relative z-10 shrink-0 touch-none bg-line hover:bg-active focus-visible:bg-active" />
      <div className="min-h-0 min-w-0 flex-1"><ResizableChartLayout node={node.second} renderPane={renderPane} onResize={onResize} /></div>
    </div>
  )
}
