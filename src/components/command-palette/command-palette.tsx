import { useEffect, useMemo, useRef, useState } from 'react'
import { Braces, Check, FileText, Pin, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help'
import { useTheme } from '@/contexts/theme-context'
import { isMacPlatform } from '@/hooks/use-keyboard-shortcuts'
import { copyPrompt } from '@/lib/copy-prompt'
import { cn } from '@/lib/utils'
import { usePromptStore } from '@/stores/usePromptStore'
import { extractVariables } from '../templates/template-variables'
import { buildPaletteActions, type PaletteAction } from './palette-actions'
import {
  comparePrompts,
  promptSearchEntry,
  queryTerms,
  rankItems,
  suggestedPrompts,
  type RankedItem
} from './palette-search'
import type { Prompt } from '@/types'

type PaletteItem =
  | { readonly kind: 'prompt'; readonly key: string; readonly prompt: Prompt }
  | { readonly kind: 'action'; readonly key: string; readonly action: PaletteAction }

interface PaletteGroup {
  readonly id: 'prompts' | 'actions'
  readonly label: string
  readonly items: readonly PaletteItem[]
}

const MAX_PROMPT_RESULTS = 50
const PAGE_STEP = 8
const LIST_ID = 'command-palette-list'
const optionId = (index: number) => `command-palette-option-${index}`

// Number of variables of a prompt, cached per object (prompts are replaced, never mutated)
const variableCounts = new WeakMap<Prompt, number>()
const countVariables = (prompt: Prompt) => {
  let count = variableCounts.get(prompt)
  if (count === undefined) {
    count = extractVariables(prompt.content).length
    variableCounts.set(prompt, count)
  }
  return count
}

const bestScore = (items: readonly RankedItem<unknown>[]) => items[0]?.score ?? Number.POSITIVE_INFINITY

// Another dialog (confirmation, variables, shortcuts...) is open: Ctrl+K leaves it alone.
// Dialogs still playing their closing animation (the palette itself, right after Esc) don't count.
const otherDialogOpen = () =>
  document.querySelector('[role="dialog"]:not([data-state="closed"]), [role="alertdialog"]:not([data-state="closed"])') !== null

// Ctrl+K (Cmd+K on macOS) palette of the desktop window: search prompts and run app actions from the
// keyboard. Enter opens a prompt in the side panel; Ctrl+Enter copies it (asking for its variables).
export function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [mcpRunning, setMcpRunning] = useState<boolean | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const openRef = useRef(open)
  openRef.current = open

  const { theme, setTheme } = useTheme()
  const prompts = usePromptStore((state) => state.prompts)
  const recentIds = usePromptStore((state) => state.recentlyInteractedIds)
  const isMac = isMacPlatform()
  const modKey = isMac ? '⌘' : 'Ctrl'

  const openPalette = () => {
    setQuery('')
    setActiveIndex(0)
    setOpen(true)
  }

  // Registered here (not in App.tsx) and in the capture phase, so it also works while typing in any field
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.key.toLowerCase() !== 'k') return
      const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey
      if (!modifier || event.altKey || event.shiftKey) return
      if (!openRef.current && otherDialogOpen()) return
      event.preventDefault()
      event.stopPropagation()
      if (openRef.current) setOpen(false)
      else openPalette()
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // MCP server status, to offer "Iniciar" or "Parar"
  useEffect(() => {
    if (!open) return
    let active = true
    window.electronAPI
      .getMcpServerStatus()
      .then((status) => {
        if (active) setMcpRunning(Boolean(status?.running))
      })
      .catch(() => {
        if (active) setMcpRunning(null)
      })
    const unsubscribe = window.electronAPI.onMcpServerStatusChanged((status) => {
      setMcpRunning(Boolean(status?.running))
    })
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [open])

  const actions = useMemo(
    () => buildPaletteActions({ theme, setTheme, mcpRunning, openShortcutsHelp: () => setShortcutsOpen(true), modKey }),
    [theme, setTheme, mcpRunning, modKey]
  )

  const terms = useMemo(() => queryTerms(query), [query])

  const { groups, hiddenPrompts } = useMemo(() => {
    const searching = terms.length > 0
    const rankedPrompts: RankedItem<Prompt>[] = searching
      ? rankItems(prompts, promptSearchEntry, terms, comparePrompts)
      : suggestedPrompts(prompts, recentIds).map((prompt) => ({ item: prompt, score: 0 }))
    const shownPrompts = rankedPrompts.slice(0, MAX_PROMPT_RESULTS)
    const rankedActions = rankItems(
      searching ? actions : actions.filter((action) => !action.onlyWhenSearching),
      (action) => action.entry,
      terms,
      () => 0
    )

    const promptGroup: PaletteGroup = {
      id: 'prompts',
      label: searching ? 'Prompts' : 'Fixados e recentes',
      items: shownPrompts.map(({ item }) => ({ kind: 'prompt', key: `prompt-${item.id}`, prompt: item }))
    }
    const actionGroup: PaletteGroup = {
      id: 'actions',
      label: 'Ações',
      items: rankedActions.map(({ item }) => ({ kind: 'action', key: `action-${item.id}`, action: item }))
    }
    // The group with the best match comes first (prompts win a tie)
    const ordered = searching && bestScore(rankedActions) < bestScore(shownPrompts)
      ? [actionGroup, promptGroup]
      : [promptGroup, actionGroup]
    return {
      groups: ordered.filter((group) => group.items.length > 0),
      hiddenPrompts: rankedPrompts.length - shownPrompts.length
    }
  }, [terms, prompts, recentIds, actions])

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups])
  const active = items.length === 0 ? -1 : Math.min(activeIndex, items.length - 1)

  useEffect(() => {
    if (!open || active < 0) return
    document.getElementById(optionId(active))?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  const openPrompt = async (prompt: Prompt) => {
    // May ask to discard unsaved changes of an open editor first
    if (await usePromptStore.getState().openPromptViewer(prompt)) {
      usePromptStore.getState().setActiveMainTab('prompts')
    }
  }

  const runItem = (item: PaletteItem | undefined, copy: boolean) => {
    if (!item) return
    if (item.kind === 'action' && item.action.nextQuery !== undefined) {
      setQuery(item.action.nextQuery)
      setActiveIndex(0)
      return
    }
    // The palette closes first: the action may open another dialog (confirmation, variables...)
    setOpen(false)
    if (item.kind === 'prompt') {
      void (copy ? copyPrompt(item.prompt) : openPrompt(item.prompt))
    } else {
      Promise.resolve(item.action.run?.()).catch((error) => {
        console.error('Command palette action failed:', error)
      })
    }
  }

  const move = (delta: number, wrap = true) => {
    if (items.length === 0) return
    const next = active + delta
    if (wrap) setActiveIndex((next + items.length) % items.length)
    else setActiveIndex(Math.max(0, Math.min(items.length - 1, next)))
  }

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        move(-1)
        break
      case 'PageDown':
        event.preventDefault()
        move(PAGE_STEP, false)
        break
      case 'PageUp':
        event.preventDefault()
        move(-PAGE_STEP, false)
        break
      case 'Enter':
        event.preventDefault()
        runItem(items[active], event.ctrlKey || event.metaKey)
        break
    }
  }

  let index = -1

  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="top-[12vh] flex max-h-[76vh] w-[calc(100vw-2rem)] max-w-xl translate-y-0 flex-col gap-0 overflow-hidden p-0"
          onCloseAutoFocus={(event) => {
            // An action opened another dialog: the focus belongs to it
            if (otherDialogOpen()) event.preventDefault()
          }}
        >
          <DialogTitle className="sr-only">Paleta de comandos</DialogTitle>
          <DialogDescription className="sr-only">
            Busque prompts e ações. Use as setas para escolher, Enter para abrir e {modKey}+Enter para copiar um prompt.
          </DialogDescription>

          <div className="flex items-center gap-2 border-b px-3">
            <Search className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value)
                setActiveIndex(0)
              }}
              onKeyDown={handleInputKeyDown}
              placeholder="Buscar prompts e ações..."
              aria-label="Buscar prompts e ações"
              role="combobox"
              aria-expanded="true"
              aria-controls={LIST_ID}
              aria-autocomplete="list"
              aria-activedescendant={active >= 0 ? optionId(active) : undefined}
              autoComplete="off"
              spellCheck={false}
              className="h-12 min-w-0 flex-1 bg-transparent pr-8 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground break-words [overflow-wrap:anywhere]" role="status">
              {query.trim() ? `Nenhum resultado para “${query.trim()}”.` : 'Nenhum prompt ou ação disponível.'}
            </p>
          )}
          <div
            id={LIST_ID}
            role="listbox"
            aria-label="Resultados"
            className={cn('min-h-0 flex-1 overflow-y-auto p-1', items.length === 0 && 'hidden')}
          >
            {groups.map((group) => (
              <div key={group.id} role="group" aria-labelledby={`command-palette-group-${group.id}`}>
                <div
                  id={`command-palette-group-${group.id}`}
                  className="px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </div>
                {group.items.map((item) => {
                  index++
                  const itemIndex = index
                  const isActive = itemIndex === active
                  return (
                    <div
                      key={item.key}
                      id={optionId(itemIndex)}
                      role="option"
                      aria-selected={isActive}
                      className={cn(
                        'flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                        isActive ? 'bg-accent text-accent-foreground' : 'text-foreground'
                      )}
                      // Keeps the focus in the search field
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseMove={() => {
                        if (!isActive) setActiveIndex(itemIndex)
                      }}
                      onClick={(event) => runItem(item, event.ctrlKey || event.metaKey)}
                    >
                      {item.kind === 'prompt' ? (
                        <PromptOption prompt={item.prompt} />
                      ) : (
                        <ActionOption action={item.action} />
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {hiddenPrompts > 0 && (
            <p className="border-t px-3 py-1.5 text-xs text-muted-foreground">
              Mais {hiddenPrompts.toLocaleString('pt-BR')} {hiddenPrompts === 1 ? 'prompt encontrado' : 'prompts encontrados'}. Continue digitando para refinar a busca.
            </p>
          )}

          <div className="flex flex-wrap gap-x-3 gap-y-1 border-t px-3 py-2 text-[11px] text-muted-foreground">
            <span>↑↓ navegar</span>
            <span>Enter abrir</span>
            <span>{modKey}+Enter copiar prompt</span>
            <span>Esc fechar</span>
          </div>
        </DialogContent>
      </Dialog>
      <KeyboardShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  )
}

function PromptOption({ prompt }: { prompt: Prompt }) {
  const variables = countVariables(prompt)
  return (
    <>
      {prompt.is_pinned ? (
        <Pin className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      ) : (
        <FileText className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate">
        {prompt.is_pinned && <span className="sr-only">Fixado: </span>}
        {prompt.title}
      </span>
      {variables > 0 && (
        <span className="flex flex-shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground" title="Tem variáveis: ao copiar, você preenche os valores">
          <Braces className="h-3 w-3" aria-hidden="true" />
          <span className="sr-only">, com</span> {variables} <span className="sr-only">{variables === 1 ? 'variável' : 'variáveis'}</span>
        </span>
      )}
      {prompt.category_name && (
        <span className="flex max-w-[40%] flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <span
            className="h-2 w-2 flex-shrink-0 rounded-full"
            style={{ backgroundColor: prompt.category_color }}
            aria-hidden="true"
          />
          <span className="truncate">{prompt.category_name}</span>
        </span>
      )}
    </>
  )
}

function ActionOption({ action }: { action: PaletteAction }) {
  const Icon = action.icon
  return (
    <>
      <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{action.label}</span>
      {action.current && (
        <span className="flex flex-shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          atual
        </span>
      )}
      {action.shortcut && (
        <kbd className="flex-shrink-0 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {action.shortcut}
        </kbd>
      )}
    </>
  )
}
