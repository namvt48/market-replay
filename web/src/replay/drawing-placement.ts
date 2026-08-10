export interface PlacementAnchor {
  time: number
  price: number
}

export type DrawingPlacementState =
  | { status: 'idle' }
  | { status: 'anchored'; tool: string; requiredAnchors: number; anchors: PlacementAnchor[] }
  | { status: 'previewing'; tool: string; requiredAnchors: number; anchors: PlacementAnchor[]; cursor: PlacementAnchor }
  | { status: 'complete'; tool: string; anchors: PlacementAnchor[] }
  | { status: 'cancelled'; tool: string | null }

export const IDLE_DRAWING_PLACEMENT: DrawingPlacementState = { status: 'idle' }

export function isValidPlacementAnchor(anchor: PlacementAnchor): boolean {
  return Number.isFinite(anchor.time) && Number.isFinite(anchor.price)
}

export function startDrawingPlacement(tool: string, requiredAnchors: number): DrawingPlacementState {
  if (tool.trim() === '' || !Number.isInteger(requiredAnchors) || requiredAnchors < 1) {
    return IDLE_DRAWING_PLACEMENT
  }
  return { status: 'anchored', tool, requiredAnchors, anchors: [] }
}

export function moveDrawingPlacement(state: DrawingPlacementState, cursor: PlacementAnchor): DrawingPlacementState {
  if (!isValidPlacementAnchor(cursor)) return state
  if (state.status !== 'anchored' && state.status !== 'previewing') return state
  if (state.anchors.length === 0 || state.anchors.length >= state.requiredAnchors) return state
  return { ...state, status: 'previewing', cursor }
}

export function commitDrawingAnchor(state: DrawingPlacementState, anchor: PlacementAnchor): DrawingPlacementState {
  if (!isValidPlacementAnchor(anchor)) return state
  if (state.status !== 'anchored' && state.status !== 'previewing') return state
  const anchors = [...state.anchors, anchor]
  if (anchors.length >= state.requiredAnchors) {
    return { status: 'complete', tool: state.tool, anchors: anchors.slice(0, state.requiredAnchors) }
  }
  return { status: 'anchored', tool: state.tool, requiredAnchors: state.requiredAnchors, anchors }
}

export function cancelDrawingPlacement(state: DrawingPlacementState): DrawingPlacementState {
  if (state.status === 'idle' || state.status === 'cancelled') return state
  return { status: 'cancelled', tool: state.tool }
}

export function drawingPreviewAnchors(state: DrawingPlacementState): PlacementAnchor[] | null {
  if (state.status !== 'previewing') return null
  const missing = state.requiredAnchors - state.anchors.length
  if (missing <= 0) return null
  return [...state.anchors, ...Array.from({ length: missing }, () => ({ ...state.cursor }))]
}
