import { Fragment, type ReactElement, type ReactNode } from 'react'

function inlineMarkdown(value: string): ReactNode[] {
  const expression = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
  const nodes: ReactNode[] = []
  let cursor = 0
  for (const match of value.matchAll(expression)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push(value.slice(cursor, index))
    const token = match[0]
    if (token.startsWith('**')) nodes.push(<strong key={`${index}-strong`} className="font-semibold text-ink">{token.slice(2, -2)}</strong>)
    else if (token.startsWith('`')) nodes.push(<code key={`${index}-code`} className="rounded bg-surface-3 px-1 font-mono text-ui-meta text-active-bright">{token.slice(1, -1)}</code>)
    else if (token.startsWith('*')) nodes.push(<em key={`${index}-em`}>{token.slice(1, -1)}</em>)
    else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      const href = link?.[2] && /^(https?:\/\/|mailto:)/.test(link[2]) ? link[2] : '#'
      nodes.push(<a key={`${index}-link`} href={href} target="_blank" rel="noreferrer" className="text-active-bright underline decoration-active/60 underline-offset-2">{link?.[1] ?? token}</a>)
    }
    cursor = index + token.length
  }
  if (cursor < value.length) nodes.push(value.slice(cursor))
  return nodes
}

export function MarkdownPreview({ markdown }: { markdown: string }): ReactElement {
  const lines = markdown.split('\n')
  return (
    <div className="space-y-2 text-ui-control leading-6 text-muted">
      {lines.map((line, index) => {
        if (!line.trim()) return <div key={`blank-${index}`} className="h-2" />
        if (line.startsWith('### ')) return <h3 key={index} className="pt-1 text-ui-title font-semibold text-ink">{inlineMarkdown(line.slice(4))}</h3>
        if (line.startsWith('## ')) return <h2 key={index} className="pt-2 text-base font-semibold text-ink">{inlineMarkdown(line.slice(3))}</h2>
        if (line.startsWith('# ')) return <h1 key={index} className="pt-2 text-lg font-semibold text-ink">{inlineMarkdown(line.slice(2))}</h1>
        if (line.startsWith('> ')) return <blockquote key={index} className="border-l-2 border-active pl-3 text-dim">{inlineMarkdown(line.slice(2))}</blockquote>
        if (/^[-*] /.test(line)) return <div key={index} className="flex gap-2 pl-1"><span aria-hidden="true" className="text-active-bright">•</span><span>{inlineMarkdown(line.slice(2))}</span></div>
        if (/^\d+\. /.test(line)) {
          const match = /^(\d+)\. (.*)$/.exec(line)
          return <div key={index} className="flex gap-2 pl-1"><span className="min-w-5 font-mono text-dim">{match?.[1]}.</span><span>{inlineMarkdown(match?.[2] ?? '')}</span></div>
        }
        if (line.startsWith('```')) return <Fragment key={index} />
        return <p key={index}>{inlineMarkdown(line)}</p>
      })}
    </div>
  )
}
