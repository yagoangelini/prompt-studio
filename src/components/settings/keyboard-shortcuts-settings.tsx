import React from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Keyboard } from 'lucide-react'
import { KEYBOARD_SHORTCUTS, ShortcutsTypingNote } from '@/components/keyboard-shortcuts-help'
import { isMacPlatform } from '@/hooks/use-keyboard-shortcuts'

export function KeyboardShortcutsSettings() {
  const isMac = isMacPlatform()

  return (
    <div className="flex-1 overflow-auto">
      <div className="p-6 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Keyboard className="h-5 w-5" aria-hidden="true" />
              <CardTitle>Atalhos de teclado</CardTitle>
            </div>
            <CardDescription>
              Use estes atalhos de teclado para trabalhar com mais agilidade no Prompt Studio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {KEYBOARD_SHORTCUTS.map((shortcut, index) => {
              const keys = isMac ? shortcut.key : shortcut.pcKey

              return (
                <div key={index} className="flex items-start justify-between p-4 rounded-lg border bg-card/50">
                  <div className="flex-1">
                    <div className="font-medium text-sm mb-1">{shortcut.action}</div>
                    <div className="text-xs text-muted-foreground">
                      {shortcut.description}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-4">
                    {keys.map((key, keyIndex) => (
                      <React.Fragment key={keyIndex}>
                        <Badge variant="outline" className="font-mono text-xs px-2 py-1 bg-background">
                          {key}
                        </Badge>
                        {keyIndex < keys.length - 1 && (
                          <span className="text-muted-foreground mx-1">+</span>
                        )}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )
            })}

            <div className="pt-4 border-t">
              <div className="text-xs text-muted-foreground space-y-2">
                <p><strong>Dicas:</strong></p>
                <ul className="list-disc list-inside space-y-1 ml-2">
                  <li><ShortcutsTypingNote /></li>
                  <li>{isMac ? '⌘' : 'Ctrl'}+S só salva quando o editor de prompt está aberto e os campos obrigatórios (título e conteúdo) estão preenchidos</li>
                  <li>A alternância de temas percorre os 12 temas: Sistema → Claro → Escuro → Preto fosco → Meia-noite → Oceano → Floresta → Roxo cósmico → Pôr do sol → Ártico → Rosa → macOS</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Future shortcuts configuration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Atalhos personalizados</CardTitle>
            <CardDescription>
              Personalize os atalhos de teclado de acordo com o seu fluxo de trabalho.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="text-sm text-muted-foreground py-8 text-center border-2 border-dashed rounded-lg">
              Em breve você poderá configurar atalhos personalizados.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
