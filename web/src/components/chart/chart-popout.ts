export interface ChartPopoutTarget {
  window: Window
  root: HTMLElement
}

function copyWorkspaceHead(targetDocument: Document): void {
  const viewport = targetDocument.createElement('meta')
  viewport.name = 'viewport'
  viewport.content = 'width=device-width, initial-scale=1'
  targetDocument.head.append(viewport)

  document.head.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    if (node instanceof HTMLLinkElement) {
      const link = targetDocument.createElement('link')
      link.rel = 'stylesheet'
      link.href = node.href
      if (node.media) link.media = node.media
      targetDocument.head.append(link)
      return
    }
    targetDocument.head.append(node.cloneNode(true))
  })
}

interface WorkspacePopoutOptions {
  width: number
  height: number
}

export function openWorkspacePopout(viewId: string, title: string, options: WorkspacePopoutOptions): ChartPopoutTarget | null {
  const left = Math.max(0, window.screenX + 72)
  const top = Math.max(0, window.screenY + 56)
  const popup = window.open('', `market-replay-${viewId}`, `popup=yes,width=${options.width},height=${options.height},left=${left},top=${top}`)
  if (!popup) return null

  const popupDocument = popup.document
  popupDocument.head.replaceChildren()
  popupDocument.body.replaceChildren()
  popupDocument.title = `${title} — Market Replay`
  popupDocument.documentElement.className = document.documentElement.className
  popupDocument.body.className = 'overflow-hidden bg-chart text-ink'
  copyWorkspaceHead(popupDocument)

  const root = popupDocument.createElement('div')
  root.id = 'market-replay-popout-root'
  root.className = 'h-full min-h-0'
  popupDocument.body.append(root)
  popup.focus()
  return { window: popup, root }
}

export function openChartPopout(paneId: string, title: string): ChartPopoutTarget | null {
  return openWorkspacePopout(paneId, title, { width: 1280, height: 800 })
}
