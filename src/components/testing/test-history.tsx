import { useEffect, useMemo } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ChevronDown, ChevronUp, GitCompare, History, RefreshCw, RotateCcw, Trash2, X } from 'lucide-react'
import type { TestRun } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { parseDbDate } from '@/lib/utils'
import { CANCELED_RUN_ERROR, useTestingStore } from './testing-store'
import { endpointLabel, excerpt, formatMs, formatTokens, providerLabel } from './testing-format'
import { useRunTest } from './use-run-test'
import { RunColumn } from './run-column'

type RunStatus = 'success' | 'error' | 'canceled'

const statusOf = (run: TestRun): RunStatus =>
  run.error === null ? 'success' : run.error === CANCELED_RUN_ERROR ? 'canceled' : 'error'

const STATUS_LABELS: Record<RunStatus, string> = { success: 'Sucesso', error: 'Erro', canceled: 'Cancelado' }

const relativeDate = (value: string): string => {
  const date = parseDbDate(value)
  return Number.isNaN(date.getTime()) ? value : formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
}

const absoluteDate = (value: string): string => {
  const date = parseDbDate(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

function StatusBadge({ run }: { run: TestRun }) {
  const status = statusOf(run)
  return (
    <Badge variant={status === 'error' ? 'destructive' : status === 'success' ? 'secondary' : 'outline'}>
      {STATUS_LABELS[status]}
    </Badge>
  )
}

function RunDetails({ run }: { run: TestRun }) {
  return (
    <div className="mt-3 space-y-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Data</dt>
        <dd>{absoluteDate(run.created_at)}</dd>
        <dt>Endpoint</dt>
        <dd className="break-all">{run.endpoint}</dd>
        <dt>Temperatura</dt>
        <dd>{run.temperature === null ? 'Não enviada' : run.temperature.toLocaleString('pt-BR')}</dd>
        <dt>Máx. de tokens</dt>
        <dd>{run.max_tokens === null ? 'Padrão da API' : formatTokens(run.max_tokens)}</dd>
      </dl>
      <div className="space-y-1">
        <p className="text-xs font-medium">Prompt</p>
        <div className="max-h-48 overflow-auto border rounded-md p-2">
          <pre className="text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{run.prompt_text}</pre>
        </div>
      </div>
      <div className="space-y-1">
        <p className="text-xs font-medium">{run.error === null ? 'Resposta' : 'Resultado'}</p>
        {run.error !== null ? (
          <p className="text-xs text-destructive break-words [overflow-wrap:anywhere]">{run.error}</p>
        ) : run.response ? (
          <div className="max-h-72 overflow-auto border rounded-md p-2">
            <pre className="text-xs whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{run.response}</pre>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">A API respondeu, mas sem conteúdo.</p>
        )}
      </div>
    </div>
  )
}

const runColumn = (run: TestRun, title: string) => ({
  title,
  provider: run.provider,
  model: run.model,
  endpoint: run.endpoint,
  subtitle: relativeDate(run.created_at),
  responseTimeMs: run.response_time_ms,
  inputTokens: run.input_tokens,
  outputTokens: run.output_tokens,
  text: run.error === null ? run.response ?? '' : null,
  error: statusOf(run) === 'error' ? run.error : null,
  canceled: statusOf(run) === 'canceled',
})

// "Histórico" tab: every executed test (single runs and comparisons), newest first
export function TestHistory() {
  const { addToast } = usePromptStore()
  const {
    history, historyLoaded, historyLoading, historyError, isLoading, loadHistory, deleteRun, clearHistory, loadRun,
    historyExpanded, historySelected: selected, historyComparing: comparing,
    toggleHistoryExpanded: toggleExpanded, toggleHistorySelected: toggleSelected, setHistoryComparing: setComparing,
  } = useTestingStore()
  const runTest = useRunTest()

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const compared = useMemo(
    () => selected.map((id) => history.find((run) => run.id === id)).filter((run): run is TestRun => Boolean(run)),
    [selected, history]
  )
  const [firstCompared, secondCompared] = compared

  const handleRerun = async (run: TestRun) => {
    if (isLoading) {
      addToast({ type: 'info', title: 'Já há um teste em andamento', description: 'Aguarde ou cancele o teste atual na aba Testar prompt.' })
      return
    }
    // Same provider, model, endpoint, options and text, shown in the "Testar prompt" tab
    loadRun(run)
    await runTest()
  }

  const handleDelete = async (run: TestRun) => {
    try {
      const deleted = await deleteRun(run.id)
      if (!deleted) addToast({ type: 'warning', title: 'Esta execução já não estava no histórico' })
    } catch (error) {
      addToast({ type: 'error', title: 'Não foi possível excluir a execução', description: error instanceof Error ? error.message : undefined })
    }
  }

  const handleClear = async () => {
    const confirmed = await confirmAction({
      title: 'Limpar o histórico de testes?',
      description: `${history.length === 1 ? 'A execução salva será excluída' : `As ${history.length.toLocaleString('pt-BR')} execuções salvas serão excluídas`} permanentemente. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Limpar histórico',
      destructive: true,
    })
    if (!confirmed) return
    try {
      const deleted = await clearHistory()
      setComparing(false)
      addToast({ type: 'success', title: 'Histórico limpo', description: `${deleted.toLocaleString('pt-BR')} ${deleted === 1 ? 'execução excluída' : 'execuções excluídas'}.` })
    } catch (error) {
      addToast({ type: 'error', title: 'Não foi possível limpar o histórico', description: error instanceof Error ? error.message : undefined })
    }
  }

  return (
    <div className="space-y-4">
      {comparing && firstCompared && secondCompared && (
        <section aria-label="Comparação de execuções" className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-medium">Comparação lado a lado</h3>
            <Button variant="ghost" size="sm" onClick={() => setComparing(false)}>
              <X className="h-4 w-4 mr-1" />
              Fechar comparação
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <RunColumn {...runColumn(firstCompared, 'Execução 1')} />
            <RunColumn {...runColumn(secondCompared, 'Execução 2')} />
          </div>
        </section>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="space-y-1">
              <CardTitle className="text-base flex items-center gap-2">
                <History className="h-4 w-4" aria-hidden="true" />
                Histórico de testes
              </CardTitle>
              <CardDescription>
                Cada teste executado fica salvo aqui (as 500 execuções mais recentes). Marque duas execuções para compará-las lado a lado.
              </CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={selected.length !== 2}
                onClick={() => setComparing(true)}
              >
                <GitCompare className="h-4 w-4 mr-2" />
                Comparar selecionadas ({selected.length}/2)
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadHistory()} disabled={historyLoading} aria-label="Atualizar o histórico">
                <RefreshCw className={`h-4 w-4 ${historyLoading ? 'animate-spin' : ''}`} />
              </Button>
              <Button variant="outline" size="sm" onClick={() => void handleClear()} disabled={history.length === 0}>
                <Trash2 className="h-4 w-4 mr-2" />
                Limpar histórico
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {historyError ? (
            <p className="text-sm text-destructive" role="alert">Não foi possível carregar o histórico: {historyError}</p>
          ) : !historyLoaded && historyLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Nenhum teste no histórico ainda. Os testes executados nas abas Testar prompt e Comparar modelos aparecem aqui.
            </p>
          ) : (
            <ul className="divide-y">
              {history.map((run) => {
                const isExpanded = historyExpanded.includes(run.id)
                const isSelected = selected.includes(run.id)
                const status = statusOf(run)
                const summary = status === 'success' ? run.response || 'Resposta sem conteúdo' : run.error
                return (
                  <li key={run.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className="mt-1 h-4 w-4 flex-shrink-0 accent-primary"
                        checked={isSelected}
                        onChange={() => toggleSelected(run.id)}
                        aria-label={`Marcar para comparar: ${run.model}, ${absoluteDate(run.created_at)}`}
                      />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                          <StatusBadge run={run} />
                          {run.source === 'compare' && (
                            <Badge variant="outline" className="gap-1" title="Executado na aba Comparar modelos">
                              <GitCompare className="h-3 w-3" aria-hidden="true" />
                              Comparação
                            </Badge>
                          )}
                          <span className="font-medium break-all">{run.model}</span>
                          <span className="text-xs text-muted-foreground">{providerLabel(run.provider)} · {endpointLabel(run.endpoint)}</span>
                        </div>
                        <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                          <span title={absoluteDate(run.created_at)}>{relativeDate(run.created_at)}</span>
                          <span>{formatMs(run.response_time_ms)}</span>
                          <span>Tokens: {formatTokens(run.input_tokens)} / {formatTokens(run.output_tokens)}</span>
                        </div>
                        <p className="text-sm break-words [overflow-wrap:anywhere]">{excerpt(run.prompt_text)}</p>
                        <p className={`text-xs break-words [overflow-wrap:anywhere] ${status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {excerpt(summary)}
                        </p>
                        <div className="flex flex-wrap gap-1 pt-1">
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => toggleExpanded(run.id)} aria-expanded={isExpanded}>
                            {isExpanded ? <ChevronUp className="h-4 w-4 mr-1" /> : <ChevronDown className="h-4 w-4 mr-1" />}
                            {isExpanded ? 'Ocultar detalhes' : 'Ver detalhes'}
                          </Button>
                          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void handleRerun(run)} disabled={isLoading}>
                            <RotateCcw className="h-4 w-4 mr-1" />
                            Reexecutar
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-destructive hover:text-destructive"
                            onClick={() => void handleDelete(run)}
                            aria-label={`Excluir a execução de ${relativeDate(run.created_at)} (${run.model})`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {isExpanded && <RunDetails run={run} />}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
