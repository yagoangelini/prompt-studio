import { useEffect, useState } from 'react'
import { ThemeProvider, useTheme, type Theme } from './contexts/theme-context'
import { Toaster } from './components/ui/toaster'
import { ConfirmDialogHost } from './components/ui/confirm-dialog'
import { DesktopLayout } from './components/layout/desktop-layout'
import { MenuBarLayout } from './components/layout/menubar-layout'
import { QuickPasteLayout } from './components/quick-paste/quick-paste-layout'
import { FillVariablesDialogHost } from './components/prompts/fill-variables-dialog'
import { CommandPalette } from './components/command-palette/command-palette'
import { usePromptStore } from './stores/usePromptStore'
import { CrashHandler, setupGlobalErrorHandlers } from './components/crash-handler'
import { SEARCH_FIELD_SELECTOR, useKeyboardShortcuts } from './hooks/use-keyboard-shortcuts'

// The menu bar popup (menubar.html) is loaded once and then only hidden and shown, so the layout
// follows the window itself, not the app mode read when the page was loaded
const IS_MENU_BAR_WINDOW = /\/menubar(\.html)?$/i.test(window.location.pathname)
// The quick paste window (quickpaste.html), opened by the global shortcut
const IS_QUICK_PASTE_WINDOW = /\/quickpaste(\.html)?$/i.test(window.location.pathname)

// Order used by Ctrl+T
const THEME_CYCLE: readonly Theme[] = [
  'system', 'light', 'dark', 'matte', 'midnight', 'ocean',
  'forest', 'cosmic', 'sunset', 'arctic', 'rose', 'macos'
]

const THEME_NAMES: Record<Theme, string> = {
  system: 'Sistema',
  light: 'Claro',
  dark: 'Escuro',
  matte: 'Preto fosco',
  midnight: 'Meia-noite',
  ocean: 'Oceano',
  forest: 'Floresta',
  cosmic: 'Roxo cósmico',
  sunset: 'Pôr do sol',
  arctic: 'Ártico',
  rose: 'Rosa',
  macos: 'macOS'
}

// Focuses the search field that is on screen (a field inside an open dialog wins) and selects its text
function focusSearchField() {
  const fields = Array.from(document.querySelectorAll<HTMLElement>(SEARCH_FIELD_SELECTOR)).filter(
    (field) => field.getClientRects().length > 0 && !(field as HTMLInputElement).disabled
  )
  const field = fields.find((candidate) => candidate.closest('[role="dialog"]')) ?? fields[0]
  if (!field) return
  field.focus()
  if (field instanceof HTMLInputElement) field.select()
}

function AppInner() {
  const [loading, setLoading] = useState(true)
  const fetchAllData = usePromptStore((state) => state.fetchAllData)
  const addToast = usePromptStore((state) => state.addToast)
  const { theme, setTheme } = useTheme()

  // Ctrl+S, Ctrl+F and Ctrl+O also work while typing in any field. Ctrl+N and Ctrl+T work in search
  // fields, but not while editing other fields (title, content...), so they never interrupt writing.
  useKeyboardShortcuts([
    {
      key: 'n',
      ctrl: true,
      inTextFields: 'search',
      description: 'Criar novo prompt',
      action: async () => {
        const store = usePromptStore.getState()
        if (store.isPromptEditorOpen) return
        // May ask to discard unsaved changes of another editor first
        await store.openPromptEditor()
        if (!IS_MENU_BAR_WINDOW && usePromptStore.getState().isPromptEditorOpen) {
          usePromptStore.getState().setActiveMainTab('prompts')
        }
      }
    },
    {
      key: 'f',
      ctrl: true,
      inTextFields: 'always',
      description: 'Ir para a busca',
      action: focusSearchField
    },
    {
      key: 's',
      ctrl: true,
      inTextFields: 'always',
      description: 'Salvar o prompt atual',
      action: () => {
        if (!usePromptStore.getState().isPromptEditorOpen) return
        const saveButton = document.querySelector<HTMLButtonElement>('[data-save-button]')
        if (saveButton && !saveButton.disabled) {
          saveButton.click()
          return
        }
        addToast({
          type: 'warning',
          title: 'Não é possível salvar agora',
          description: 'Preencha os campos obrigatórios (título e conteúdo) para salvar o prompt.'
        })
      }
    },
    {
      key: 't',
      ctrl: true,
      inTextFields: 'search',
      description: 'Alternar entre os temas',
      action: () => {
        const currentIndex = THEME_CYCLE.indexOf(theme)
        const nextTheme = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length] ?? 'system'
        setTheme(nextTheme)
        addToast({
          type: 'success',
          title: 'Tema alterado',
          description: `Tema ${THEME_NAMES[nextTheme]} aplicado`,
          duration: 2000
        })
      }
    },
    {
      key: 'o',
      ctrl: true,
      inTextFields: 'always',
      description: 'Abrir no modo desktop',
      action: async () => {
        if (!IS_MENU_BAR_WINDOW) return
        try {
          await window.electronAPI.switchMode('desktop')
        } catch (error) {
          console.error('Failed to switch to desktop mode:', error)
          addToast({
            type: 'error',
            title: 'Erro',
            description: 'Não foi possível mudar para o modo desktop'
          })
        }
      }
    }
  ])

  useEffect(() => {
    // Setup global error handlers on app initialization
    setupGlobalErrorHandlers()

    const initializeApp = async () => {
      try {
        // Load all application data
        await fetchAllData()
      } catch (error) {
        console.error('Failed to initialize app:', error)
      } finally {
        setLoading(false)
      }
    }

    initializeApp()
  }, [fetchAllData])

  // The desktop window may be hidden while prompts change in the menu bar popup: reload the data
  // when it is shown again (the popup does the same in MenuBarLayout)
  useEffect(() => {
    if (IS_MENU_BAR_WINDOW) return
    return window.electronAPI.onWindowShown(() => {
      void fetchAllData()
    })
  }, [fetchAllData])

  // Data changed outside this window (quick paste counted a usage, another window edited prompts...)
  useEffect(() => {
    return window.electronAPI.onDataChanged(() => {
      void fetchAllData()
    })
  }, [fetchAllData])

  useEffect(() => {
    // Listen for preferences dialog
    const handlePreferences = () => {
      // This will be handled by the layout components
      console.log('Open preferences requested')
    }

    window.electronAPI.onOpenPreferences(handlePreferences)

    return () => {
      window.electronAPI.removeAllListeners('open-preferences')
    }
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando o Prompt Studio...</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <CrashHandler>
        <div className="app">
          {IS_QUICK_PASTE_WINDOW ? <QuickPasteLayout /> : IS_MENU_BAR_WINDOW ? <MenuBarLayout /> : <DesktopLayout />}
          {!IS_QUICK_PASTE_WINDOW && !IS_MENU_BAR_WINDOW && <CommandPalette />}
          <Toaster />
        </div>
      </CrashHandler>
      {/* Outside the crash boundary: the crash dialog uses it to confirm the factory reset */}
      <ConfirmDialogHost />
      <FillVariablesDialogHost />
    </>
  )
}

function App() {
  return (
    <ThemeProvider>
      <AppInner />
    </ThemeProvider>
  )
}

export default App
