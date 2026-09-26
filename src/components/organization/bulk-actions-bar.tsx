import { useMemo, useState } from 'react'
import {
  ChevronDown, FolderInput, Heart, HeartOff, Pin, PinOff, Server, ServerOff, Tag, Tags, Terminal, Trash2, X, CheckSquare
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import type { Prompt } from '@/types'
import { buildCategoryTree, flattenCategoryTree } from './organization-utils'

interface BulkActionsBarProps {
  // The filtered list: actions apply to the selected prompts that are in it
  visiblePrompts: readonly Prompt[]
}

const nameCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

const promptsLabel = (count: number) => `${count} ${count === 1 ? 'prompt' : 'prompts'}`

/** Bar of the selection mode: count, select all, and the actions applied to every selected prompt. */
export function BulkActionsBar({ visiblePrompts }: BulkActionsBarProps) {
  const selectedPromptIds = usePromptStore((state) => state.selectedPromptIds)
  const categories = usePromptStore((state) => state.categories)
  const allTags = usePromptStore((state) => state.tags)
  const setSelectionMode = usePromptStore((state) => state.setSelectionMode)
  const setSelectedPromptIds = usePromptStore((state) => state.setSelectedPromptIds)
  const clearSelection = usePromptStore((state) => state.clearSelection)
  const bulkUpdatePrompts = usePromptStore((state) => state.bulkUpdatePrompts)
  const bulkDeletePrompts = usePromptStore((state) => state.bulkDeletePrompts)
  const setPromptsExposure = usePromptStore((state) => state.setPromptsExposure)
  const addToast = usePromptStore((state) => state.addToast)

  const [busy, setBusy] = useState(false)
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false)
  const [newTag, setNewTag] = useState('')

  const selectedSet = new Set(selectedPromptIds)
  const targets = visiblePrompts.filter((prompt) => selectedSet.has(prompt.id))
  const ids = targets.map((prompt) => prompt.id)
  const count = ids.length
  const allVisibleSelected = visiblePrompts.length > 0 && count === visiblePrompts.length
  const categoryOptions = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories])
  const tagsInSelection = [...new Set(targets.flatMap((prompt) => prompt.tags))].sort((a, b) => nameCollator.compare(a, b))

  const run = async (action: () => Promise<unknown>) => {
    if (busy || count === 0) return
    setBusy(true)
    try {
      await action()
    } finally {
      setBusy(false)
    }
  }

  const handleMove = (categoryId: number | null) => run(() => bulkUpdatePrompts(ids, { category_id: categoryId }))

  const handleAddTag = (event: React.FormEvent) => {
    event.preventDefault()
    const tag = newTag.trim()
    if (!tag) return
    setTagPopoverOpen(false)
    setNewTag('')
    void run(() => bulkUpdatePrompts(ids, { addTags: [tag] }))
  }

  const handleDelete = () => run(async () => {
    const confirmed = await confirmAction({
      title: count === 1 ? 'Excluir 1 prompt?' : `Excluir ${count} prompts?`,
      description: count === 1
        ? `O prompt "${targets[0]?.title ?? ''}" será excluído, com o histórico de versões dele. Esta ação não pode ser desfeita.`
        : `Os ${count} prompts selecionados serão excluídos, com o histórico de versões deles. Esta ação não pode ser desfeita.`,
      confirmLabel: count === 1 ? 'Excluir' : `Excluir ${count} prompts`,
      destructive: true
    })
    if (confirmed) await bulkDeletePrompts(ids)
  })

  const handleExportCommands = () => run(async () => {
    try {
      const result = await window.electronAPI.exportClaudeCommands(ids)
      if (result.canceled) return
      if (!result.success) {
        addToast({ type: 'error', title: 'Não foi possível exportar os comandos', description: result.error ?? 'Tente novamente.' })
        return
      }
      const files = result.files?.length ?? 0
      addToast({
        type: 'success',
        title: 'Comandos do Claude Code exportados',
        description: `${files} ${files === 1 ? 'arquivo gravado' : 'arquivos gravados'}${result.directory ? ` em ${result.directory}` : ''}.`
      })
      // Partial export: files the app did not create are kept and reported
      if (result.error) addToast({ type: 'warning', title: 'Atenção', description: result.error })
    } catch (error) {
      console.error('Failed to export Claude Code commands:', error)
      addToast({
        type: 'error',
        title: 'Não foi possível exportar os comandos',
        description: error instanceof Error ? error.message : 'Tente novamente.'
      })
    }
  })

  const disabled = busy || count === 0

  return (
    <div
      role="region"
      aria-label="Ações para os prompts selecionados"
      className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border bg-muted/40 px-2 py-1.5"
    >
      {/* First, so it never ends up alone on a line of its own */}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        onClick={() => setSelectionMode(false)}
        aria-label="Sair do modo de seleção (Esc)"
        title="Sair do modo de seleção (Esc)"
      >
        <X className="h-4 w-4" />
      </Button>

      <span className="text-sm font-medium" aria-live="polite">
        {count === 0 ? 'Nenhum prompt selecionado' : `${promptsLabel(count)} ${count === 1 ? 'selecionado' : 'selecionados'}`}
      </span>

      <Button
        variant="ghost"
        size="sm"
        className="h-8"
        disabled={visiblePrompts.length === 0 || allVisibleSelected}
        onClick={() => setSelectedPromptIds(visiblePrompts.map((prompt) => prompt.id))}
        title="Selecionar todos os filtrados (Ctrl+A)"
        aria-label={`Selecionar todos os filtrados (${visiblePrompts.length})`}
      >
        <CheckSquare className="h-4 w-4 mr-2" />
        <span className="hidden xl:inline">Selecionar todos os filtrados&nbsp;</span>
        <span className="xl:hidden">Todos&nbsp;</span>
        ({visiblePrompts.length})
      </Button>
      {count > 0 && (
        <Button variant="ghost" size="sm" className="h-8" onClick={clearSelection}>
          Limpar seleção
        </Button>
      )}

      <div className="flex flex-wrap items-center gap-2 ml-auto">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={disabled}>
              <FolderInput className="h-4 w-4 mr-2" />
              Mover para
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 max-w-[18rem] overflow-y-auto">
            <DropdownMenuLabel>Mover para a categoria</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => handleMove(null)}>Sem categoria</DropdownMenuItem>
            {categoryOptions.length > 0 && <DropdownMenuSeparator />}
            {categoryOptions.map(({ category, depth }) => (
              <DropdownMenuItem
                key={category.id}
                onClick={() => handleMove(category.id)}
                className="gap-2"
                style={{ paddingLeft: `${0.5 + depth * 0.875}rem` }}
              >
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: category.color }} aria-hidden="true" />
                <span className="truncate" title={category.name}>{category.name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={disabled} aria-label="Adicionar tag" title="Adicionar tag">
              <Tag className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Adicionar tag</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-64">
            <form onSubmit={handleAddTag} className="space-y-2">
              <label htmlFor="bulk-add-tag" className="text-sm font-medium">
                Tag para {promptsLabel(count)}
              </label>
              <Input
                id="bulk-add-tag"
                value={newTag}
                onChange={(event) => setNewTag(event.target.value)}
                list="bulk-add-tag-options"
                placeholder="Nome da tag"
                autoFocus
              />
              <datalist id="bulk-add-tag-options">
                {allTags.map((tag) => <option key={tag} value={tag} />)}
              </datalist>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setTagPopoverOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" size="sm" disabled={!newTag.trim()}>
                  Adicionar
                </Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              disabled={disabled || tagsInSelection.length === 0}
              aria-label="Remover tag"
              title="Remover tag"
            >
              <Tags className="h-4 w-4 lg:mr-2" />
              <span className="hidden lg:inline">Remover tag</span>
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 max-w-[18rem] overflow-y-auto">
            <DropdownMenuLabel>Remover dos selecionados</DropdownMenuLabel>
            {tagsInSelection.map((tag) => (
              <DropdownMenuItem key={tag} onClick={() => run(() => bulkUpdatePrompts(ids, { removeTags: [tag] }))}>
                <span className="truncate" title={tag}>{tag}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" className="h-8" disabled={disabled}>
              Marcar
              <ChevronDown className="h-3.5 w-3.5 ml-1" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => run(() => bulkUpdatePrompts(ids, { is_favorite: true }))}>
              <Heart className="h-4 w-4 mr-2" />
              Favoritar
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => bulkUpdatePrompts(ids, { is_favorite: false }))}>
              <HeartOff className="h-4 w-4 mr-2" />
              Desfavoritar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => run(() => bulkUpdatePrompts(ids, { is_pinned: true }))}>
              <Pin className="h-4 w-4 mr-2" />
              Fixar no topo
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => bulkUpdatePrompts(ids, { is_pinned: false }))}>
              <PinOff className="h-4 w-4 mr-2" />
              Desafixar
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => run(() => setPromptsExposure(ids, true))}>
              <Server className="h-4 w-4 mr-2" />
              Expor no servidor MCP
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => run(() => setPromptsExposure(ids, false))}>
              <ServerOff className="h-4 w-4 mr-2" />
              Ocultar do servidor MCP
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="sm"
          className="h-8"
          disabled={disabled}
          onClick={handleExportCommands}
          aria-label="Exportar para o Claude Code"
          title="Exportar para o Claude Code"
        >
          <Terminal className="h-4 w-4 mr-2" />
          <span className="hidden xl:inline">Exportar para o&nbsp;</span>Claude Code
        </Button>

        <Button
          variant="destructive"
          size="sm"
          className="h-8"
          disabled={disabled}
          onClick={handleDelete}
          aria-label="Excluir"
          title="Excluir"
        >
          <Trash2 className="h-4 w-4 lg:mr-2" />
          <span className="hidden lg:inline">Excluir</span>
        </Button>
      </div>
    </div>
  )
}
