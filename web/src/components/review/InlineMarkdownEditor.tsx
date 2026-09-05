import { useEffect, useRef, type ClipboardEvent, type MouseEvent, type ReactElement } from 'react'
import { clipboardImageFiles, imageFileDataUrl } from '../../lib/clipboard-images'

const imageToken = /!\[([^\]]*)\]\((data:image\/(?:png|jpeg|gif|webp);base64,[^)]+)\)/g

interface Props {
  value: string
  onChange: (value: string) => void
  onImageOpen: (image: { src: string; alt: string }) => void
}

function inlineImage(src: string, alt: string): HTMLImageElement {
  const image = document.createElement('img')
  image.src = src
  image.alt = alt || 'Pasted image'
  image.dataset.inlineMarkdownImage = 'true'
  image.contentEditable = 'false'
  image.draggable = false
  image.className = 'mx-1 inline-block max-h-64 max-w-full cursor-zoom-in rounded-control border border-line align-middle'
  return image
}

function writeMarkdown(root: HTMLDivElement, markdown: string): void {
  const fragment = document.createDocumentFragment()
  let cursor = 0
  for (const match of markdown.matchAll(imageToken)) {
    const index = match.index ?? 0
    if (index > cursor) fragment.append(document.createTextNode(markdown.slice(cursor, index)))
    fragment.append(inlineImage(match[2], match[1]))
    cursor = index + match[0].length
  }
  if (cursor < markdown.length) fragment.append(document.createTextNode(markdown.slice(cursor)))
  root.replaceChildren(fragment)
}

function readMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof HTMLElement)) return ''
  if (node instanceof HTMLImageElement && node.dataset.inlineMarkdownImage === 'true') return `![${node.alt}](${node.src})`
  if (node.tagName === 'BR') return '\n'
  const inner = [...node.childNodes].map(readMarkdown).join('')
  return node.tagName === 'DIV' || node.tagName === 'P' ? `${inner}\n` : inner
}

function placeCursorAfter(node: Node): void {
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

export function InlineMarkdownEditor({ value, onChange, onImageOpen }: Props): ReactElement {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastValue = useRef('')

  useEffect(() => {
    const editor = editorRef.current
    if (!editor || lastValue.current === value) return
    writeMarkdown(editor, value)
    lastValue.current = value
  }, [value])

  const sync = (): void => {
    const editor = editorRef.current
    if (!editor) return
    const next = [...editor.childNodes].map(readMarkdown).join('').replace(/\n$/, '')
    lastValue.current = next
    onChange(next)
  }

  const paste = (event: ClipboardEvent<HTMLDivElement>): void => {
    const files = clipboardImageFiles(event.clipboardData)
    if (files.length === 0) return
    event.preventDefault()
    const editor = editorRef.current
    if (!editor) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const marker = document.createElement('span')
    marker.dataset.imagePasteMarker = 'true'
    marker.textContent = '\u200b'
    if (range && editor.contains(range.commonAncestorContainer)) {
      range.deleteContents()
      range.insertNode(marker)
    } else editor.append(marker)
    placeCursorAfter(marker)
    void Promise.all(files.map(imageFileDataUrl)).then((sources) => {
      if (!marker.isConnected) return
      const images = sources.map((source, index) => inlineImage(source, `Pasted image ${index + 1}`))
      marker.replaceWith(...images)
      const last = images.at(-1)
      if (last) placeCursorAfter(last)
      sync()
    })
  }

  const doubleClick = (event: MouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof HTMLImageElement) || target.dataset.inlineMarkdownImage !== 'true') return
    event.preventDefault()
    onImageOpen({ src: target.src, alt: target.alt })
  }

  return (
    <div className="relative h-full min-h-0">
      {!value ? <span className="pointer-events-none absolute left-0 top-0 italic text-dim">Enter your review in Markdown. Type / for commands…</span> : null}
      <div ref={editorRef} role="textbox" aria-label="Trade review Markdown" aria-multiline="true" contentEditable suppressContentEditableWarning autoFocus onInput={sync} onBlur={sync} onPaste={paste} onDoubleClick={doubleClick} className="relative h-full min-h-0 overflow-y-auto whitespace-pre-wrap break-words bg-transparent text-ui-control leading-6 text-ink outline-none" />
    </div>
  )
}
