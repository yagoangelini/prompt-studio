import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Braces, CheckCircle2, ClipboardPaste, Pin, Search } from 'lucide-react'
import { usePromptStore } from '@/stores/usePromptStore'
import { resolvePromptText } from '@/lib/copy-prompt'
import { cn } from '@/lib/utils'
import type { Prompt, QuickPasteSettings } from '@/types'
import { QUICK_PASTE_CHANNELS } from './quick-paste-types'
import { detectShortcutPlatform } from './accelerator'
import {
  QUICK_PASTE_MAX_ITEMS,
  getPromptPreview,
  promptHasVariables,
  searchQuickPastePrompts,
} from './quick-paste-list'

const LIST_ID = 'quick-paste-list'
const optionId = (promptId: number) => `quick-paste-option-${promptId}`
const PAGE_STEP = 5

const platform = detectShortcutPlatform()
const PASTE_KEYS = platform === 'mac' ? 'Cmd+V' : 'Ctrl+V'
const MOD_KEY = platform === 'mac' ? '⌘' : 'Ctrl'
// Transparent window (see electron/features/quick-paste.ts): the page draws the rounded panel and its
// shadow inside a small margin. Linux gets a plain window, without the margin.
const TRANSPARENT_WINDOW = platform !== 'linux'

type Notice = { readonly kind: 'success' | 'error'; readonly text: string }

function Kbd({ children }: { children: string }) {
  return (
    <kbd className="rounded border bg-muted px-1 py-px font-mono text-[10px] leading-none text-foreground">
      {children}
    </kbd>
  )
}

// Layout of the quick paste window (quickpaste.html), opened by the global shortcut: search, pick a
// prompt with the arrows or the mouse, and it is pasted into the app that was active
export function QuickPasteLayout() {
  const prompts = usePromptStore((state) => state.prompts)
  const fetchAllData = usePromptStore((state) => state.fetchAllData)

  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [settings, setSettings] = useState<QuickPasteSettings | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [busy, setBusy] = useState(false)

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const busyRef = useRef(false)
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const results = useMemo(() => searchQuickPastePrompts(prompts, query), [prompts, query])
  const visible = results.length > QUICK_PASTE_MAX_ITEMS ? results.slice(0, QUICK_PASTE_MAX_ITEMS) : results
  const safeIndex = visible.length === 0 ? -1 : Math.min(activeIndex, visible.length - 1)
  const activePrompt = safeIndex >= 0 ? visible[safeIndex] : undefined
  const autoPaste = settings?.autoPaste ?? true

  const clearNoticeTimer = () => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current)
    noticeTimerRef.current = null
  }

  // Clean state for the next opening: empty search, first item, list at the top
  const resetView = useCallback(() => {
    setQuery('')
    setActiveIndex(0)
    if (listRef.current) listRef.current.scrollTop = 0
  }, [])

  const focusSearch = () => {
    inputRef.current?.focus()
  }

  // The window is transparent around the panel
  useEffect(() => {
    if (!TRANSPARENT_WINDOW) return
    document.documentElement.style.background = 'transparent'
    document.body.style.background = 'transparent'
  }, [])

  const refreshSettings = useCallback(async () => {
    try {
      setSettings(await window.electronAPI.getQuickPasteSettings())
    } catch (error) {
      console.error('Failed to read the quick paste settings:', error)
    }
  }, [])

  // Each opening (the page is kept loaded while hidden): fresh data, empty search, focus on the search
  useEffect(() => {
    void refreshSettings()
    return window.electronAPI.onWindowShown(() => {
      clearNoticeTimer()
      setNotice(null)
      resetView()
      focusSearch()
      void fetchAllData()
      void refreshSettings()
    })
  }, [fetchAllData, refreshSettings, resetView])

  // The window hides itself when it loses the focus (also right before pasting): resetting the view then
  // means the next opening never shows the previous search, not even for a frame
  useEffect(() => {
    window.addEventListener('blur', resetView)
    return () => window.removeEventListener('blur', resetView)
  }, [resetView])

  useEffect(() => () => clearNoticeTimer(), [])

  // Keep the active item visible
  useEffect(() => {
    if (!activePrompt) return
    document.getElementById(optionId(activePrompt.id))?.scrollIntoView({ block: 'nearest' })
  }, [activePrompt])

  const hideWindow = () => {
    void window.electronAPI.hideQuickPaste()
  }

  const showNoticeThenHide = (next: Notice, ms: number) => {
    clearNoticeTimer()
    setNotice(next)
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null
      setNotice(null)
      hideWindow()
    }, ms)
  }

  const activate = async (prompt: Prompt, mode: 'paste' | 'copy') => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    try {
      // Prompts with {{variables}} open the fill-in dialog first; canceling it returns to the list
      const text = await resolvePromptText(prompt, {
        confirmLabel: mode === 'paste' && (settings?.autoPaste ?? true) ? 'Colar' : 'Copiar',
      })
      if (text === null) {
        // After the dialog is gone: while it is mounted, its focus trap would take the focus back
        setTimeout(focusSearch, 50)
        return
      }
      if (mode === 'copy') {
        const result = await window.electronAPI.invoke(QUICK_PASTE_CHANNELS.copy, text, prompt.id) as { success: boolean; error?: string }
        if (!result?.success) {
          setNotice({ kind: 'error', text: result?.error ?? 'Não foi possível copiar o prompt.' })
          return
        }
        showNoticeThenHide({ kind: 'success', text: 'Copiado para a área de transferência.' }, 700)
        return
      }
      const result = await window.electronAPI.pasteText(text, prompt.id)
      if (!result.success) {
        setNotice({ kind: 'error', text: result.error ?? 'Não foi possível copiar o prompt.' })
        return
      }
      if (!result.pasted) {
        // Only copied: automatic paste is off, or it was not possible (the reason comes in `error`)
        showNoticeThenHide(
          result.error ? { kind: 'error', text: result.error } : { kind: 'success', text: `Copiado. Cole com ${PASTE_KEYS}.` },
          result.error ? 3000 : 1200
        )
      }
    } catch (error) {
      console.error('Quick paste failed:', error)
      setNotice({ kind: 'error', text: 'Não foi possível usar o prompt. Tente novamente.' })
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }

  const moveTo = (index: number) => {
    if (visible.length === 0) return
    setActiveIndex(Math.max(0, Math.min(visible.length - 1, index)))
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    const mod = platform === 'mac' ? event.metaKey : event.ctrlKey
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        moveTo(safeIndex + 1)
        return
      case 'ArrowUp':
        event.preventDefault()
        moveTo(safeIndex - 1)
        return
      case 'PageDown':
        event.preventDefault()
        moveTo(safeIndex + PAGE_STEP)
        return
      case 'PageUp':
        event.preventDefault()
        moveTo(safeIndex - PAGE_STEP)
        return
      case 'Tab':
        // The focus stays in the search: Tab / Shift+Tab walk the list
        event.preventDefault()
        moveTo(safeIndex + (event.shiftKey ? -1 : 1))
        return
      case 'Enter':
        event.preventDefault()
        if (activePrompt) void activate(activePrompt, mod ? 'copy' : 'paste')
        return
      case 'Escape':
        // Handled here, so the app-wide handler does not just leave the search field
        event.preventDefault()
        hideWindow()
        return
    }
    // App shortcuts that make no sense in this window (new prompt, open desktop mode)
    if (mod && ['n', 'o'].includes(event.key.toLowerCase())) {
      event.preventDefault()
      event.stopPropagation()
    }
  }

  const panelShadow = TRANSPARENT_WINDOW ? 'rounded-xl border shadow-[0_8px_28px_rgba(0,0,0,0.35)]' : ''
  const enterAction = autoPaste ? 'colar' : 'copiar'
  const hasPrompts = prompts.length > 0

  return (
    <div className={cn('h-screen', TRANSPARENT_WINDOW ? 'p-2.5' : 'bg-background')}>
      <div className={cn('relative flex h-full flex-col overflow-hidden bg-background text-foreground', panelShadow)}>
        {/* Search */}
        <div className="flex items-center gap-2 border-b px-3 py-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <input
            ref={inputRef}
            autoFocus
            type="text"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
              if (listRef.current) listRef.current.scrollTop = 0
            }}
            onKeyDown={handleKeyDown}
            placeholder={autoPaste ? 'Buscar prompts para colar...' : 'Buscar prompts para copiar...'}
            aria-label="Buscar prompts"
            role="combobox"
            aria-expanded="true"
            aria-controls={LIST_ID}
            aria-autocomplete="list"
            aria-activedescendant={activePrompt ? optionId(activePrompt.id) : undefined}
            spellCheck={false}
            autoComplete="off"
            className="h-7 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <ClipboardPaste className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        </div>

        {/* Results */}
        <ul
          ref={listRef}
          id={LIST_ID}
          role="listbox"
          aria-label="Prompts"
          className="flex-1 overflow-y-auto p-1.5"
        >
          {visible.map((prompt, index) => {
            const active = index === safeIndex
            return (
              <li
                key={prompt.id}
                id={optionId(prompt.id)}
                role="option"
                aria-selected={active}
                // Keep the focus in the search field
                onMouseDown={(event) => event.preventDefault()}
                // onMouseMove (not onMouseEnter): the list scrolling under a still mouse must not move the selection
                onMouseMove={() => {
                  if (!active) setActiveIndex(index)
                }}
                onClick={() => void activate(prompt, 'paste')}
                title={autoPaste ? 'Clique para colar' : 'Clique para copiar'}
                className={cn(
                  'cursor-pointer rounded-md px-2.5 py-2 select-none',
                  active ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
                )}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  {prompt.is_pinned && (
                    <Pin className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Fixado" />
                  )}
                  <span className="truncate text-sm font-medium">{prompt.title}</span>
                  {promptHasVariables(prompt) && (
                    <Braces className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Tem variáveis para preencher" />
                  )}
                  {prompt.category_name && (
                    <span className="ml-auto flex max-w-[40%] shrink-0 items-center gap-1 pl-2 text-[11px] text-muted-foreground">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: prompt.category_color }}
                        aria-hidden="true"
                      />
                      <span className="truncate">{prompt.category_name}</span>
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {getPromptPreview(prompt.content) || 'Sem conteúdo'}
                </p>
              </li>
            )
          })}

          {visible.length === 0 && (
            <li role="presentation" className="px-4 py-10 text-center text-sm text-muted-foreground">
              {!hasPrompts
                ? 'Nenhum prompt ainda. Crie prompts no Prompt Studio para colá-los daqui.'
                : `Nenhum prompt encontrado para "${query.trim()}".`}
            </li>
          )}
          {results.length > visible.length && (
            <li role="presentation" className="px-2.5 py-2 text-center text-[11px] text-muted-foreground">
              Mostrando {visible.length} de {results.length} prompts. Digite para refinar a busca.
            </li>
          )}
        </ul>

        {/* Shortcut hints */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-3 py-1.5 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1"><Kbd>↑</Kbd><Kbd>↓</Kbd> navegar</span>
          <span className="flex items-center gap-1"><Kbd>Enter</Kbd> ou clique: {enterAction}</span>
          {autoPaste && <span className="flex items-center gap-1"><Kbd>{`${MOD_KEY}+Enter`}</Kbd> só copiar</span>}
          <span className="flex items-center gap-1"><Kbd>Esc</Kbd> fechar</span>
        </div>

        <p className="sr-only" aria-live="polite">
          {query.trim() ? `${results.length} ${results.length === 1 ? 'prompt encontrado' : 'prompts encontrados'}` : ''}
        </p>

        {/* Result of the last action */}
        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className="absolute inset-x-3 bottom-10 flex items-start gap-2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg"
          >
            {notice.kind === 'error' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-600" aria-hidden="true" />
            )}
            <span>{notice.text}</span>
          </div>
        )}
        {busy && <span className="sr-only" role="status">Colando...</span>}
      </div>
    </div>
  )
}
