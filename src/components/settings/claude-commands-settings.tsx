import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, FolderOpen, RefreshCw, TerminalSquare } from 'lucide-react'
import type { Category, ClaudeCommandsExportResult } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { usePromptStore } from '@/stores/usePromptStore'
import { countPromptsByCategory } from '@/components/organization/organization-utils'

// The main process also sends the files it kept (not created by the app), the failures and the command
// of each written file (electron/features/data-tools.ts)
type ExportOutcome = ClaudeCommandsExportResult & {
  readonly skipped?: readonly string[]
  readonly failed?: readonly { readonly path: string; readonly error: string }[]
  readonly commands?: Readonly<Record<string, string>>
}

type Scope = 'all' | 'categories'

// Prompts without category are selected with this id
const NO_CATEGORY = 0
const MAX_LISTED_FILES = 40

// ".claude/commands/plano/01-crie-um-plano.md" -> "/plano:01-crie-um-plano"
const commandFromPath = (relativePath: string): string =>
  `/${relativePath.replace(/^\.claude\/commands\//, '').replace(/\.md$/, '').split('/').join(':')}`

interface CategoryNode {
  readonly category: Category
  readonly depth: number
}

// Categories as a tree (parents first, children indented), protected against cycles
const flattenTree = (categories: readonly Category[]): CategoryNode[] => {
  const ids = new Set(categories.map((category) => category.id))
  const children = new Map<number | null, Category[]>()
  for (const category of categories) {
    const parent = category.parent_id !== null && ids.has(category.parent_id) && category.parent_id !== category.id ? category.parent_id : null
    children.set(parent, [...(children.get(parent) ?? []), category])
  }
  const result: CategoryNode[] = []
  const seen = new Set<number>()
  const visit = (parent: number | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
    for (const category of list) {
      if (seen.has(category.id)) continue
      seen.add(category.id)
      result.push({ category, depth })
      visit(category.id, depth + 1)
    }
  }
  visit(null, 0)
  // Categories caught in a parent cycle still show up, at the top level
  for (const category of categories) if (!seen.has(category.id)) result.push({ category, depth: 0 })
  return result
}

// Settings > Dados: export prompts as Claude Code commands (.claude/commands/*.md)
export function ClaudeCommandsSettingsCard() {
  const { prompts, categories, addToast } = usePromptStore()
  const [scope, setScope] = useState<Scope>('all')
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [outcome, setOutcome] = useState<ExportOutcome | null>(null)

  const tree = useMemo(() => flattenTree(categories), [categories])
  const parentOf = useMemo(() => new Map(categories.map((category) => [category.id, category.parent_id])), [categories])

  // A chosen category includes its subcategories
  const coveredByAncestor = (id: number): boolean => {
    const seen = new Set<number>()
    let parent = parentOf.get(id) ?? null
    while (parent !== null && !seen.has(parent)) {
      if (chosen.has(parent)) return true
      seen.add(parent)
      parent = parentOf.get(parent) ?? null
    }
    return false
  }
  const isIncluded = (categoryId: number | null) =>
    categoryId === null ? chosen.has(NO_CATEGORY) : chosen.has(categoryId) || coveredByAncestor(categoryId)

  const promptsToExport = scope === 'all' ? prompts : prompts.filter((prompt) => isIncluded(prompt.category_id))
  // Same totals as the sidebar: a category counts the prompts of its subcategories
  const countByCategory = useMemo(() => countPromptsByCategory(categories, prompts), [categories, prompts])
  const noCategoryCount = useMemo(() => prompts.filter((prompt) => (prompt.category_id ?? null) === null).length, [prompts])

  const toggleCategory = (id: number) => {
    setChosen((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleExport = async () => {
    if (promptsToExport.length === 0) return
    setExporting(true)
    try {
      const result = (await window.electronAPI.exportClaudeCommands(promptsToExport.map((prompt) => prompt.id))) as ExportOutcome
      if (result.canceled) {
        addToast({ type: 'info', title: 'Exportação cancelada', description: 'Nenhum arquivo foi gravado.' })
        return
      }
      setOutcome(result)
      const written = result.files?.length ?? 0
      if (result.success) {
        addToast({
          type: result.error ? 'warning' : 'success',
          title: `${written.toLocaleString('pt-BR')} ${written === 1 ? 'comando exportado' : 'comandos exportados'}`,
          description: result.error ?? `Arquivos gravados em ${result.directory}.`,
          duration: result.error ? 10000 : undefined,
        })
      } else {
        addToast({ type: 'error', title: 'Não foi possível exportar os comandos', description: result.error, duration: 10000 })
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Não foi possível exportar os comandos',
        description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.',
      })
    } finally {
      setExporting(false)
    }
  }

  const files = outcome?.files ?? []
  const skipped = outcome?.skipped ?? []
  const failed = outcome?.failed ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <TerminalSquare className="h-4 w-4" aria-hidden="true" />
          Exportar para o Claude Code
        </CardTitle>
        <CardDescription>
          Cada prompt vira um comando do Claude Code: um arquivo <code>.claude/commands/&lt;categoria&gt;/&lt;título&gt;.md</code> na
          pasta do projeto que você escolher, usado como <code>/plano:01-crie-um-plano</code>. Variáveis <code>{'{{assim}}'}</code> viram
          os argumentos do comando (<code>$ARGUMENTS</code>).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <fieldset className="space-y-2" disabled={exporting}>
          <legend className="text-sm font-medium mb-1">Quais prompts exportar</legend>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="claude-commands-scope" className="accent-primary" checked={scope === 'all'} onChange={() => setScope('all')} />
            Todos os prompts ({prompts.length.toLocaleString('pt-BR')})
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="radio" name="claude-commands-scope" className="accent-primary" checked={scope === 'categories'} onChange={() => setScope('categories')} />
            Prompts das categorias escolhidas
          </label>
          {scope === 'categories' && (
            <div className="ml-6 max-h-64 overflow-y-auto rounded-md border p-2 space-y-1">
              {tree.map(({ category, depth }) => {
                const inherited = coveredByAncestor(category.id)
                return (
                  <label
                    key={category.id}
                    className="flex items-center gap-2 text-sm"
                    style={{ paddingLeft: `${depth * 1.25}rem` }}
                  >
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={chosen.has(category.id) || inherited}
                      disabled={inherited}
                      onChange={() => toggleCategory(category.id)}
                    />
                    <span className="h-2.5 w-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: category.color }} aria-hidden="true" />
                    <span className="min-w-0 break-words">{category.name}</span>
                    <span className="text-xs text-muted-foreground">({(countByCategory.get(category.id) ?? 0).toLocaleString('pt-BR')})</span>
                  </label>
                )
              })}
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="accent-primary" checked={chosen.has(NO_CATEGORY)} onChange={() => toggleCategory(NO_CATEGORY)} />
                <span>Sem categoria</span>
                <span className="text-xs text-muted-foreground">({noCategoryCount.toLocaleString('pt-BR')})</span>
              </label>
              {tree.some(({ depth }) => depth > 0) && (
                <p className="text-xs text-muted-foreground pt-1">Escolher uma categoria inclui as subcategorias dela.</p>
              )}
            </div>
          )}
        </fieldset>

        <p className="text-sm text-muted-foreground" role="status">
          {promptsToExport.length === 0
            ? 'Nenhum prompt escolhido.'
            : `${promptsToExport.length.toLocaleString('pt-BR')} ${promptsToExport.length === 1 ? 'prompt será exportado' : 'prompts serão exportados'}.`}
        </p>

        <div className="space-y-2">
          <Button onClick={() => void handleExport()} disabled={exporting || promptsToExport.length === 0}>
            {exporting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <FolderOpen className="h-4 w-4 mr-2" />}
            {exporting ? 'Exportando...' : 'Escolher a pasta do projeto e exportar'}
          </Button>
          <p className="text-xs text-muted-foreground">
            Arquivos já existentes que não foram criados pelo Prompt Studio nunca são substituídos. Para usar os comandos em
            qualquer projeto, escolha a sua pasta de usuário (eles vão para <code>~/.claude/commands</code>).
          </p>
        </div>

        {outcome && !outcome.canceled && (
          <div className="space-y-3 rounded-md border p-3" aria-live="polite">
            {files.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
                  {files.length.toLocaleString('pt-BR')} {files.length === 1 ? 'comando exportado' : 'comandos exportados'} para{' '}
                  <span className="font-normal break-all">{outcome.directory}</span>
                </p>
                <ul className="max-h-60 overflow-y-auto text-xs space-y-0.5">
                  {files.slice(0, MAX_LISTED_FILES).map((file) => (
                    <li key={file} className="break-all">
                      <code className="font-medium">{outcome.commands?.[file] ?? commandFromPath(file)}</code>
                      <span className="text-muted-foreground"> · {file}</span>
                    </li>
                  ))}
                  {files.length > MAX_LISTED_FILES && (
                    <li className="text-muted-foreground">e mais {(files.length - MAX_LISTED_FILES).toLocaleString('pt-BR')}</li>
                  )}
                </ul>
              </div>
            )}
            {skipped.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                  Não substituídos (já existiam e não foram criados pelo Prompt Studio)
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {skipped.slice(0, MAX_LISTED_FILES).map((file) => <li key={file} className="break-all">{file}</li>)}
                </ul>
              </div>
            )}
            {failed.length > 0 && (
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Não foi possível gravar</p>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {failed.slice(0, MAX_LISTED_FILES).map((failure) => (
                    <li key={failure.path} className="break-all">{failure.path}: {failure.error}</li>
                  ))}
                </ul>
              </div>
            )}
            {files.length === 0 && skipped.length === 0 && failed.length === 0 && outcome.error && (
              <p className="text-sm text-destructive">{outcome.error}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
