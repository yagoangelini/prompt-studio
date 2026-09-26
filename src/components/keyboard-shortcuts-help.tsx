import React, { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Badge } from './ui/badge'
import { isMacPlatform } from '@/hooks/use-keyboard-shortcuts'
import type { QuickPasteSettings } from '@/types'
import { DEFAULT_QUICK_PASTE_SHORTCUT, detectShortcutPlatform, getAcceleratorLabels } from './quick-paste/accelerator'
import {
  QUICK_PASTE_CHANNELS,
  QUICK_PASTE_SETTINGS_CHANGED_EVENT,
  type QuickPasteStatus,
} from './quick-paste/quick-paste-types'

interface KeyboardShortcutsHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface ShortcutEntry {
  readonly key: readonly string[]
  readonly pcKey: readonly string[]
  readonly action: string
  readonly description: string
}

// Must match the shortcuts registered in App.tsx (and where each one works, see inTextFields there);
// Ctrl+K is registered by the command palette itself. The quick paste entry is dynamic (useShortcutList).
export const KEYBOARD_SHORTCUTS: readonly ShortcutEntry[] = [
  {
    key: ['⌘', 'K'],
    pcKey: ['Ctrl', 'K'],
    action: 'Abrir a paleta de comandos',
    description: 'Busca prompts e ações. Enter abre o prompt no painel e Ctrl+Enter o copia (pedindo as variáveis, se houver)'
  },
  {
    key: ['⌘', 'N'],
    pcKey: ['Ctrl', 'N'],
    action: 'Criar novo prompt',
    description: 'Abre o editor para criar um novo prompt'
  },
  {
    key: ['⌘', 'F'],
    pcKey: ['Ctrl', 'F'],
    action: 'Ir para a busca',
    description: 'Coloca o foco no campo de busca da tela atual e seleciona o texto digitado'
  },
  {
    key: ['⌘', 'S'],
    pcKey: ['Ctrl', 'S'],
    action: 'Salvar o prompt',
    description: 'Salva o prompt aberto no editor, mesmo com o cursor em um campo'
  },
  {
    key: ['⌘', 'T'],
    pcKey: ['Ctrl', 'T'],
    action: 'Alternar entre os temas',
    description: 'Alterna entre os 12 temas disponíveis (Sistema, Claro, Escuro, Preto fosco, Meia-noite, Oceano, Floresta, Roxo cósmico, Pôr do sol, Ártico, Rosa e macOS)'
  },
  {
    key: ['⌘', 'O'],
    pcKey: ['Ctrl', 'O'],
    action: 'Abrir no modo desktop',
    description: 'No modo barra de menus, abre o Prompt Studio no modo desktop'
  },
  {
    key: ['⌘', 'A'],
    pcKey: ['Ctrl', 'A'],
    action: 'Selecionar os prompts filtrados',
    description: 'Fora de campos de texto, seleciona todos os prompts visíveis para as ações em massa; Esc sai do modo de seleção'
  },
  {
    key: ['⌥', '↑ / ↓'],
    pcKey: ['Alt', '↑ / ↓'],
    action: 'Mover um passo da sequência',
    description: 'Em uma categoria-sequência, move o passo com foco para cima ou para baixo'
  }
]

// Position of the quick paste entry in the list (after "Abrir no modo desktop")
const QUICK_PASTE_POSITION = 6
const QUICK_PASTE_ACTION = 'Colar rápido (em qualquer programa)'
const QUICK_PASTE_HOW = 'Abre a lista de prompts por cima do programa em uso; Enter ou clique cola o prompt onde está o cursor.'

interface QuickPasteState {
  readonly settings: QuickPasteSettings
  readonly status: QuickPasteStatus | null
}

// Entry of the global quick paste shortcut: the saved shortcut, and whether it is on and working
export function getQuickPasteEntry(state: QuickPasteState | null, platform = detectShortcutPlatform()): ShortcutEntry {
  const labels = getAcceleratorLabels(state?.settings.shortcut ?? DEFAULT_QUICK_PASTE_SHORTCUT, platform)
  const base = { key: labels, pcKey: labels }
  if (state && !state.settings.enabled) {
    return {
      ...base,
      action: `${QUICK_PASTE_ACTION}: desativado`,
      description: 'O atalho global está desligado. Ative-o, ou troque a combinação, em Configurações > Geral > Colar rápido',
    }
  }
  const notWorking = state?.status && !state.status.registered
  return {
    ...base,
    action: QUICK_PASTE_ACTION,
    description: notWorking
      ? `${QUICK_PASTE_HOW} No momento o atalho não está funcionando: outro programa, o sistema ou outra cópia do Prompt Studio já usa essa combinação. Troque-a em Configurações > Geral > Colar rápido`
      : `${QUICK_PASTE_HOW} O atalho pode ser trocado em Configurações > Geral > Colar rápido`,
  }
}

// The shortcut list with the quick paste entry read from the saved settings (refreshed while mounted
// when the settings card saves, or when the window gets the focus back)
export function useShortcutList(enabled = true): readonly ShortcutEntry[] {
  const [state, setState] = useState<QuickPasteState | null>(null)

  useEffect(() => {
    if (!enabled) return
    let active = true
    const load = async () => {
      try {
        const [settings, status] = await Promise.all([
          window.electronAPI.getQuickPasteSettings(),
          (window.electronAPI.invoke(QUICK_PASTE_CHANNELS.getStatus) as Promise<QuickPasteStatus | undefined>)
            .catch(() => undefined),
        ])
        if (active && settings) setState({ settings, status: status ?? null })
      } catch (error) {
        console.error('Failed to read the quick paste settings:', error)
      }
    }
    void load()
    const reload = () => void load()
    window.addEventListener(QUICK_PASTE_SETTINGS_CHANGED_EVENT, reload)
    window.addEventListener('focus', reload)
    return () => {
      active = false
      window.removeEventListener(QUICK_PASTE_SETTINGS_CHANGED_EVENT, reload)
      window.removeEventListener('focus', reload)
    }
  }, [enabled])

  const list = [...KEYBOARD_SHORTCUTS]
  list.splice(QUICK_PASTE_POSITION, 0, getQuickPasteEntry(state))
  return list
}

// Where the shortcuts work while typing (same rules as the useKeyboardShortcuts calls in App.tsx)
export function ShortcutsTypingNote() {
  const mod = isMacPlatform() ? '⌘' : 'Ctrl'
  return (
    <>
      <strong>Enquanto você digita:</strong> {mod}+K, {mod}+S, {mod}+F e {mod}+O funcionam em qualquer campo.
      {' '}{mod}+N e {mod}+T funcionam nos campos de busca, mas ficam desativados nos outros campos
      (como o título e o conteúdo de um prompt), para não interromper a edição. Em um campo de busca,
      pressione <Badge variant="outline" className="font-mono text-xs px-1">Esc</Badge> para tirar o foco do campo.
    </>
  )
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  const isMac = isMacPlatform()
  const shortcuts = useShortcutList(open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Atalhos de teclado</DialogTitle>
          <DialogDescription>
            Use estes atalhos de teclado para trabalhar com mais agilidade no Prompt Studio.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            {shortcuts.map((shortcut, index) => {
              const keys = isMac ? shortcut.key : shortcut.pcKey

              return (
                <div key={index} className="flex items-start justify-between p-3 rounded-lg border bg-card">
                  <div className="flex-1">
                    <div className="font-medium text-sm">{shortcut.action}</div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {shortcut.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    {keys.map((key, keyIndex) => (
                      <React.Fragment key={keyIndex}>
                        <Badge variant="outline" className="font-mono text-xs px-2">
                          {key}
                        </Badge>
                        {keyIndex < keys.length - 1 && <span className="text-muted-foreground">+</span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="pt-4 border-t text-xs text-muted-foreground">
            <ShortcutsTypingNote />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
