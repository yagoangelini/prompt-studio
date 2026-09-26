import * as React from 'react'
import { Copy, AlertTriangle, RefreshCcw, RotateCcw } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './dialog'
import { Button } from './button'
import { ScrollArea } from './scroll-area'
import { confirmAction } from './confirm-dialog'
import { cn } from '@/lib/utils'

// Local state that could bring the crash back after a reload (editor state, drafts, recent prompts,
// view modes, MCP settings, theme). Crash reports are kept for diagnosis.
function clearLocalAppState() {
  try {
    sessionStorage.clear()
    const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    keys.forEach((key) => {
      if (key && (key.startsWith('promptStudio_') || key === 'recentlyInteractedPrompts' || key === 'prompt-studio-theme')) {
        localStorage.removeItem(key)
      }
    })
  } catch (error) {
    console.error('Failed to clear local app state:', error)
  }
}

interface CrashDialogProps {
  open: boolean
  onOpenChange?: (open: boolean) => void
  error: Error | null
  errorInfo?: {
    componentStack?: string
    errorBoundary?: string
  }
  onRestart?: () => void
}

export function CrashDialog({ open, onOpenChange, error, errorInfo, onRestart }: CrashDialogProps) {
  const [copied, setCopied] = React.useState(false)
  const [isResetting, setIsResetting] = React.useState(false)
  const [resetError, setResetError] = React.useState<string | null>(null)

  const fullStackTrace = React.useMemo(() => {
    if (!error) return ''
    
    let trace = `Erro: ${error.name}\n`
    trace += `Mensagem: ${error.message}\n\n`

    if (error.stack) {
      trace += `Rastreamento de pilha (stack trace):\n${error.stack}\n`
    }

    if (errorInfo?.componentStack) {
      trace += `\nPilha de componentes:\n${errorInfo.componentStack}\n`
    }

    if (errorInfo?.errorBoundary) {
      trace += `\nError Boundary: ${errorInfo.errorBoundary}\n`
    }

    trace += `\nData e hora: ${new Date().toISOString()}\n`
    trace += `User agent: ${navigator.userAgent}\n`
    
    return trace
  }, [error, errorInfo])

  const handleCopyStackTrace = async () => {
    try {
      // Try using Electron's clipboard API first
      if (typeof window !== 'undefined' && window.electronAPI) {
        await window.electronAPI.copyToClipboard(fullStackTrace)
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(fullStackTrace)
      } else {
        throw new Error('Clipboard API not available')
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      // Fallback for older browsers or environments without clipboard access
      try {
        const textArea = document.createElement('textarea')
        textArea.value = fullStackTrace
        textArea.style.position = 'fixed'
        textArea.style.left = '-999999px'
        textArea.style.top = '-999999px'
        document.body.appendChild(textArea)
        textArea.focus()
        textArea.select()
        document.execCommand('copy')
        document.body.removeChild(textArea)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch (fallbackErr) {
        console.error('Failed to copy to clipboard:', fallbackErr)
      }
    }
  }

  const handleRestart = () => {
    if (onRestart) {
      onRestart()
    } else {
      window.location.reload()
    }
  }

  // Recovery path when the crash comes back after restarting (e.g. an invalid record in the database)
  const handleFactoryReset = async () => {
    const confirmed = await confirmAction({
      title: 'Restaurar configurações de fábrica?',
      description:
        'Todos os seus prompts, categorias, templates e configurações serão excluídos permanentemente e os dados de exemplo serão restaurados. Esta ação não pode ser desfeita.',
      confirmLabel: 'Restaurar',
      destructive: true
    })
    if (!confirmed) return

    setIsResetting(true)
    setResetError(null)
    try {
      const result = await window.electronAPI.factoryReset()
      if (!result.success) {
        throw new Error(result.error || 'Não foi possível restaurar as configurações de fábrica')
      }
      clearLocalAppState()
      window.location.reload()
    } catch (err) {
      console.error('Factory reset from the crash dialog failed:', err)
      setResetError(err instanceof Error ? err.message : 'Não foi possível restaurar as configurações de fábrica')
      setIsResetting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-6 w-6 text-destructive" />
            <div>
              <DialogTitle>O aplicativo apresentou uma falha</DialogTitle>
              <DialogDescription className="mt-1">
                O aplicativo encontrou um erro inesperado e precisa ser reiniciado. Se o erro continuar
                depois de reiniciar, restaure as configurações de fábrica (seus dados serão excluídos).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 space-y-4">
          {error && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-destructive">Detalhes do erro:</h4>
              <div className="rounded-md bg-destructive/10 p-3">
                <p className="text-sm font-mono text-destructive">
                  <span className="font-semibold">{error.name}:</span> {error.message}
                </p>
              </div>
            </div>
          )}

          <div className="space-y-2 flex-1">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Rastreamento de pilha completo (stack trace):</h4>
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyStackTrace}
                className={cn(
                  "text-xs",
                  copied && "text-green-600 border-green-600"
                )}
              >
                <Copy className="h-3 w-3 mr-1" />
                {copied ? 'Copiado!' : 'Copiar'}
              </Button>
            </div>
            <ScrollArea className="h-64 w-full rounded-md border bg-muted p-4">
              <pre className="text-xs font-mono whitespace-pre-wrap break-words">
                {fullStackTrace}
              </pre>
            </ScrollArea>
          </div>
        </div>

        {resetError && (
          <p className="text-sm text-destructive" role="alert">
            Não foi possível restaurar as configurações de fábrica: {resetError}
          </p>
        )}

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange?.(false)}
            className="w-full sm:w-auto"
            disabled={isResetting}
          >
            Fechar
          </Button>
          <Button
            variant="outline"
            onClick={() => { void handleFactoryReset() }}
            className="w-full sm:w-auto text-destructive hover:text-destructive"
            disabled={isResetting}
          >
            <RotateCcw className={cn("h-4 w-4 mr-2", isResetting && "animate-spin")} aria-hidden="true" />
            {isResetting ? 'Restaurando...' : 'Restaurar configurações de fábrica'}
          </Button>
          <Button
            onClick={handleRestart}
            className="w-full sm:w-auto"
            disabled={isResetting}
          >
            <RefreshCcw className="h-4 w-4 mr-2" />
            Reiniciar aplicativo
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}