import { Clock, Copy, Square, Zap } from 'lucide-react'
import type { ApiProvider } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { usePromptStore } from '@/stores/usePromptStore'
import { endpointLabel, finishReasonHint, formatMs, formatTokens, providerLabel } from './testing-format'

export interface RunColumnProps {
  // "A", "B", "Execução 1"...
  title: string
  provider: ApiProvider
  model: string
  endpoint?: string
  // Extra line under the title (e.g. the date of a saved run)
  subtitle?: string
  responseTimeMs?: number | null
  inputTokens?: number | null
  outputTokens?: number | null
  // Answer text (null when the run failed)
  text: string | null
  error?: string | null
  canceled?: boolean
  finishReason?: string
  loading?: boolean
  // Cancels only this side while it is loading
  onCancel?: () => void
}

// One side of a side-by-side comparison (comparison of models and of two saved runs)
export function RunColumn(props: RunColumnProps) {
  const { addToast } = usePromptStore()
  const { title, provider, model, endpoint, subtitle, responseTimeMs, inputTokens, outputTokens, text, error, canceled, finishReason, loading, onCancel } = props
  const hint = finishReasonHint(finishReason)

  const handleCopy = async () => {
    if (!text) return
    try {
      await window.electronAPI.copyToClipboard(text)
      addToast({ type: 'success', title: 'Copiado!', description: 'Resposta copiada para a área de transferência' })
    } catch {
      addToast({ type: 'error', title: 'Não foi possível copiar', description: 'Tente novamente.' })
    }
  }

  return (
    <Card className="min-w-0 flex flex-col">
      <CardHeader className="space-y-1 pb-3">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base min-w-0 break-all">
            {title} · {model || 'modelo não definido'}
          </CardTitle>
          {text && (
            <Button variant="outline" size="sm" onClick={() => void handleCopy()} aria-label={`Copiar a resposta de ${title}`}>
              <Copy className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="secondary">{providerLabel(provider)}</Badge>
          {endpoint && <span className="break-all">{endpointLabel(endpoint)}</span>}
          {subtitle && <span>{subtitle}</span>}
        </div>
      </CardHeader>
      <CardContent className="space-y-3 flex-1">
        {loading ? (
          <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-3" role="status">
              <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-hidden="true" />
              Aguardando resposta...
            </div>
            {onCancel && (
              <Button variant="outline" size="sm" onClick={onCancel} aria-label={`Cancelar ${title}`}>
                <Square className="h-4 w-4 mr-2" />
                Cancelar {title}
              </Button>
            )}
          </div>
        ) : canceled ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Teste cancelado</p>
        ) : error ? (
          <p className="py-4 text-sm text-destructive break-words [overflow-wrap:anywhere]">{error}</p>
        ) : text ? (
          <ScrollArea className="h-72 border rounded-lg p-3">
            <pre className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{text}</pre>
          </ScrollArea>
        ) : (
          <p className="py-4 text-sm text-muted-foreground">A API respondeu, mas sem conteúdo.</p>
        )}
        {!loading && hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        {!loading && !canceled && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {formatMs(responseTimeMs)}
            </span>
            <span className="flex items-center gap-1">
              <Zap className="h-3.5 w-3.5" aria-hidden="true" />
              Tokens: {formatTokens(inputTokens)} de entrada · {formatTokens(outputTokens)} de saída
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
