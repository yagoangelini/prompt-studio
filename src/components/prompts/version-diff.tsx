import { useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { diffLines, foldUnchangedLines, type DiffLine } from '@/lib/text-diff'

interface VersionDiffProps {
  oldText: string
  newText: string
  oldLabel: string
  newLabel: string
}

// Rows rendered at once; very large diffs get a "Mostrar mais" button instead of thousands of rows
const RENDER_STEP = 800

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count.toLocaleString('pt-BR')} ${count === 1 ? singular : pluralForm}`

function DiffRow({ line }: { line: DiffLine }) {
  const marker = line.type === 'added' ? '+' : line.type === 'removed' ? '−' : ' '
  return (
    <li
      className={cn(
        'flex min-w-0',
        line.type === 'added' && 'bg-green-500/15',
        line.type === 'removed' && 'bg-red-500/15'
      )}
    >
      <span aria-hidden="true" className="w-10 flex-shrink-0 select-none pr-2 text-right text-muted-foreground/70">
        {line.oldNumber ?? ''}
      </span>
      <span aria-hidden="true" className="w-10 flex-shrink-0 select-none pr-2 text-right text-muted-foreground/70">
        {line.newNumber ?? ''}
      </span>
      <span
        aria-hidden="true"
        className={cn(
          'w-4 flex-shrink-0 select-none text-center font-bold',
          line.type === 'added' && 'text-green-700 dark:text-green-400',
          line.type === 'removed' && 'text-red-700 dark:text-red-400'
        )}
      >
        {marker}
      </span>
      <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-2 [overflow-wrap:anywhere]">
        {line.type === 'added' && <span className="sr-only">Adicionada: </span>}
        {line.type === 'removed' && <span className="sr-only">Removida: </span>}
        {line.text === '' ? ' ' : line.text}
      </span>
    </li>
  )
}

// Line by line differences between two texts: added lines in green ("+"), removed lines in red ("−"),
// long unchanged stretches folded. Screen readers hear "Adicionada:"/"Removida:" before each changed line.
export function VersionDiff({ oldText, newText, oldLabel, newLabel }: VersionDiffProps) {
  const diff = useMemo(() => diffLines(oldText, newText), [oldText, newText])
  const items = useMemo(() => foldUnchangedLines(diff.lines), [diff])
  const [expanded, setExpanded] = useState<ReadonlySet<number>>(() => new Set())
  const [limit, setLimit] = useState(RENDER_STEP)

  useEffect(() => {
    setExpanded(new Set())
    setLimit(RENDER_STEP)
  }, [diff])

  if (diff.added === 0 && diff.removed === 0) {
    return (
      <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">
        Sem diferenças: “{oldLabel}” e “{newLabel}” têm o mesmo conteúdo.
      </p>
    )
  }

  const rows: React.ReactNode[] = []
  let rendered = 0
  let remaining = 0
  for (const item of items) {
    const size = item.kind === 'line' ? 1 : expanded.has(item.id) ? item.lines.length : 1
    if (rendered >= limit) {
      remaining += size
      continue
    }
    if (item.kind === 'line') {
      rows.push(<DiffRow key={`l-${item.line.oldNumber}-${item.line.newNumber}`} line={item.line} />)
    } else if (expanded.has(item.id)) {
      item.lines.forEach((line) => rows.push(<DiffRow key={`l-${line.oldNumber}-${line.newNumber}`} line={line} />))
    } else {
      rows.push(
        <li key={`h-${item.id}`} className="border-y border-dashed bg-muted/40">
          <button
            type="button"
            className="w-full px-2 py-1 text-left text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setExpanded((previous) => new Set(previous).add(item.id))}
          >
            Mostrar {plural(item.lines.length, 'linha sem alteração', 'linhas sem alteração')}
          </button>
        </li>
      )
    }
    rendered += size
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-green-700 dark:text-green-400">+{plural(diff.added, 'linha adicionada', 'linhas adicionadas')}</span>
        {' · '}
        <span className="font-medium text-red-700 dark:text-red-400">−{plural(diff.removed, 'linha removida', 'linhas removidas')}</span>
        {' '}(de “{oldLabel}” para “{newLabel}”)
      </p>
      {diff.approximate && (
        <p className="text-xs text-amber-700 dark:text-amber-500">
          Os textos são muito diferentes: parte da comparação foi simplificada e aparece como removida e adicionada.
        </p>
      )}
      <ul
        aria-label={`Diferenças entre “${oldLabel}” e “${newLabel}”`}
        className="max-h-[60vh] overflow-auto rounded-md border py-1 font-mono text-xs leading-5"
      >
        {rows}
      </ul>
      {remaining > 0 && (
        <button
          type="button"
          className="text-xs text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => setLimit((current) => current + RENDER_STEP)}
        >
          Mostrar mais ({plural(remaining, 'linha restante', 'linhas restantes')})
        </button>
      )}
    </div>
  )
}
