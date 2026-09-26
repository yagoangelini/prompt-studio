import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/utils'

// Markdown rendering for the "Pré-visualizar" mode of the editors. Raw HTML is never rendered: without
// rehype-raw, react-markdown shows HTML (and XML tags such as <instructions>) as plain text.
// Links and images do not load or navigate anything: links become underlined text (the address shows
// on hover) and images become a text placeholder.

// react-markdown passes its syntax tree node as a prop; it must not reach the DOM
function withoutNode<P extends { node?: unknown }>(props: P): Omit<P, 'node'> {
  const rest: P = { ...props }
  delete rest.node
  return rest
}

const components: Components = {
  h1: (props) => <h1 className="mb-3 mt-5 text-xl font-bold first:mt-0" {...withoutNode(props)} />,
  h2: (props) => <h2 className="mb-2 mt-5 text-lg font-semibold first:mt-0" {...withoutNode(props)} />,
  h3: (props) => <h3 className="mb-2 mt-4 text-base font-semibold first:mt-0" {...withoutNode(props)} />,
  h4: (props) => <h4 className="mb-2 mt-4 font-semibold first:mt-0" {...withoutNode(props)} />,
  h5: (props) => <h5 className="mb-2 mt-3 font-semibold first:mt-0" {...withoutNode(props)} />,
  h6: (props) => <h6 className="mb-2 mt-3 font-semibold text-muted-foreground first:mt-0" {...withoutNode(props)} />,
  p: (props) => <p className="my-2 first:mt-0 last:mb-0" {...withoutNode(props)} />,
  ul: ({ className, ...props }) => (
    <ul {...withoutNode(props)} className={cn('my-2 list-disc space-y-1 pl-6', className?.includes('contains-task-list') && 'list-none pl-1', className)} />
  ),
  ol: (props) => <ol className="my-2 list-decimal space-y-1 pl-6" {...withoutNode(props)} />,
  li: ({ className, ...props }) => <li {...withoutNode(props)} className={cn('[&>input]:mr-2', className)} />,
  blockquote: (props) => (
    <blockquote className="my-3 border-l-4 border-muted-foreground/30 pl-3 text-muted-foreground" {...withoutNode(props)} />
  ),
  hr: (props) => <hr className="my-4 border-border" {...withoutNode(props)} />,
  pre: (props) => (
    <pre className="my-3 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs leading-relaxed [&>code]:bg-transparent [&>code]:p-0" {...withoutNode(props)} />
  ),
  // Code blocks come with a "language-x" class: it is kept next to the app's own classes
  code: ({ className, ...props }) => (
    <code {...withoutNode(props)} className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]', className)} />
  ),
  a: ({ href, children }) => (
    <span className="text-primary underline underline-offset-2" title={typeof href === 'string' ? href : undefined}>
      {children}
    </span>
  ),
  img: ({ alt }) => (
    <span className="rounded bg-muted px-1 text-xs text-muted-foreground">[imagem{alt ? `: ${alt}` : ''}]</span>
  ),
  table: (props) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-left text-xs" {...withoutNode(props)} />
    </div>
  ),
  th: (props) => <th className="border px-2 py-1 font-semibold" {...withoutNode(props)} />,
  td: (props) => <td className="border px-2 py-1 align-top" {...withoutNode(props)} />
}

const REMARK_PLUGINS = [remarkGfm]

export function MarkdownPreview({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn('text-sm leading-relaxed break-words [overflow-wrap:anywhere]', className)}>
      <Markdown remarkPlugins={REMARK_PLUGINS} components={components}>
        {content}
      </Markdown>
    </div>
  )
}
