const MAX_CAPTURE_WIDTH = 1280
const MAX_CAPTURE_HEIGHT = 720

export async function captureActiveChart(): Promise<string> {
  const workspace = document.querySelector<HTMLElement>('#chart-workspace')
  const root = workspace?.querySelector<HTMLElement>('[data-chart-capture-root][data-active-chart="true"]')
    ?? workspace?.querySelector<HTMLElement>('[data-chart-capture-root]')
  if (!root) throw new Error('No chart is available to capture.')

  const canvases = [...root.querySelectorAll<HTMLCanvasElement>('canvas')]
  if (canvases.length === 0) throw new Error('The chart is still loading. Try the screenshot again in a moment.')

  const bounds = root.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) throw new Error('The chart is not visible.')
  const scale = Math.min(1, MAX_CAPTURE_WIDTH / bounds.width, MAX_CAPTURE_HEIGHT / bounds.height)
  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(bounds.width * scale))
  output.height = Math.max(1, Math.round(bounds.height * scale))
  const context = output.getContext('2d')
  if (!context) throw new Error('Chart capture is not supported by this browser.')

  context.fillStyle = '#131722'
  context.fillRect(0, 0, output.width, output.height)
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect()
    context.drawImage(canvas, (rect.left - bounds.left) * scale, (rect.top - bounds.top) * scale, rect.width * scale, rect.height * scale)
  }
  return output.toDataURL('image/jpeg', 0.88)
}
