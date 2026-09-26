import React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog'
import { Badge } from './ui/badge'
import { isMacPlatform } from '@/hooks/use-keyboard-shortcuts'

interface KeyboardShortcutsHelpProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Must match the shortcuts registered in App.tsx (and where each one works, see inTextFields there)
export const KEYBOARD_SHORTCUTS = [
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
  }
] as const

// Where the shortcuts work while typing (same rules as the useKeyboardShortcuts calls in App.tsx)
export function ShortcutsTypingNote() {
  const mod = isMacPlatform() ? '⌘' : 'Ctrl'
  return (
    <>
      <strong>Enquanto você digita:</strong> {mod}+S, {mod}+F e {mod}+O funcionam em qualquer campo.
      {' '}{mod}+N e {mod}+T funcionam nos campos de busca, mas ficam desativados nos outros campos
      (como o título e o conteúdo de um prompt), para não interromper a edição. Em um campo de busca,
      pressione <Badge variant="outline" className="font-mono text-xs px-1">Esc</Badge> para tirar o foco do campo.
    </>
  )
}

export function KeyboardShortcutsHelp({ open, onOpenChange }: KeyboardShortcutsHelpProps) {
  const isMac = isMacPlatform()

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
            {KEYBOARD_SHORTCUTS.map((shortcut, index) => {
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
