# Debug Report: trendline label box pinned to chart edge when drawing dragged off-pane

**Date:** 2026-08-18
**Commit:** 0f06874 (base)

## Symptom

Dragging a trendline (with a text label) so that the drawing moves to a spot where the
text can no longer be displayed correctly leaves the text box visually clamped at the
edge of the chart. The box does not follow the line out of the visible area.

**Expected:** the label box tracks the drawing — it stays on-pane only while the
drawing intersects the pane, and follows the line out (clipped by the canvas) once the
whole drawing is dragged off the visible chart.

**Actual:** the box is always clamped back inside the pane
(`boxY = max(4, min(height - boxHeight - 4, requestedY))`), so an off-pane drawing
leaves a text box stuck at the chart boundary.

## Root cause

`web/src/replay/drawing-labels-primitive.ts` — `DrawingLabelsRenderer.draw()`.

- `bounds()` maps drawing anchors to pane coordinates via
  `timeScale().timeToCoordinate()` / `series().priceToCoordinate()`. The lightweight-charts
  library does **not** clamp these to the visible bitmap: an anchor dragged above/below
  (or left/right of) the visible range yields a coordinate far outside the pane.
- The renderer then unconditionally clamped the requested box position back inside the
  bitmap with `Math.max(4*r, Math.min(bitmapWidth - boxWidth - 4*r, requestedX))`
  (same for Y). When the whole drawing is off-pane, this pins the box to the edge instead
  of letting it follow the line out.

## Fix

Only apply the on-pane clamp while the drawing's bounds still intersect the pane
(`drawingVisible` check against `paneWidth = bitmapSize.width / horizontalPixelRatio`,
`paneHeight = bitmapSize.height / verticalPixelRatio`). Once the drawing is entirely
outside the visible chart, requestedX/requestedY are used unclamped so the box follows
the line and is clipped by the canvas.

## Evidence

- Test `drawing-labels-primitive.test.ts` — "lets the label follow the drawing off-pane
  instead of pinning it to the chart edge": anchor `priceToCoordinate → 800` on a
  100px-tall pane; previously `boxY` clamped to `67.36`, after fix boxY sits off-pane
  (> 100) following the drawing.
- Control test "keeps the label fully visible while the drawing still intersects the
  pane": on-pane drawings still clamp correctly.
- `npx vitest run`: 94 files / 746 tests pass.
- `npm run typecheck`: clean.
- `npm run lint`: no new warnings (existing warnings are in vendored
  `lightweight-charts-drawing`).

## Files changed

- `web/src/replay/drawing-labels-primitive.ts` — conditional on-pane clamping.
- `web/src/replay/drawing-labels-primitive.test.ts` — 2 renderer tests (off-pane follow,
  on-pane clamp preserved) + renderer test harness.

## Systemic risk

None. The unconditional clamp pattern exists only in this renderer; `ReplaySelectionRenderer`
and other primitives position their own UI differently and are unaffected.