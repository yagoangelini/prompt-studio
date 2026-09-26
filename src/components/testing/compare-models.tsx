import { useEffect, useRef } from 'react'
import { GitCompare, Square } from 'lucide-react'
import type { ApiProvider } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { usePromptStore } from '@/stores/usePromptStore'
import {
  API_PROVIDERS,
  PROVIDERS,
  getCompareIssues,
  parseEndpoint,
  parseMaxTokens,
  parseTemperature,
  useTestingStore,
  type CompareResult,
  type CompareSlot,
} from './testing-store'
import { formatMs } from './testing-format'
import { RunColumn } from './run-column'

function SlotConfig({ slot }: { slot: CompareSlot }) {
  const { compare, setCompareSlot, compareLoading } = useTestingStore()
  const config = compare[slot]
  const info = PROVIDERS[config.provider]
  const id = (field: string) => `compare-${slot}-${field}`
  const label = slot.toUpperCase()

  return (
    <fieldset className="space-y-3 rounded-lg border p-3 min-w-0" disabled={compareLoading}>
      <legend className="px-1 text-sm font-medium">Configuração {label}</legend>
      <div className="space-y-1.5">
        <Label htmlFor={id('provider')}>Provedor</Label>
        <Select value={config.provider} onValueChange={(value) => setCompareSlot(slot, { provider: value as ApiProvider })}>
          <SelectTrigger id={id('provider')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {API_PROVIDERS.map((option) => (
              <SelectItem key={option} value={option}>{PROVIDERS[option].label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('model')}>Modelo</Label>
        <Input
          id={id('model')}
          list={id('models')}
          value={config.model}
          onChange={(e) => setCompareSlot(slot, { model: e.target.value })}
          placeholder={`Ex.: ${info.defaultModel}`}
          spellCheck={false}
        />
        <datalist id={id('models')}>
          {info.models.map((model) => <option key={model} value={model} />)}
        </datalist>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id('endpoint')}>Endpoint</Label>
        <Input
          id={id('endpoint')}
          value={config.apiEndpoint}
          onChange={(e) => setCompareSlot(slot, { apiEndpoint: e.target.value })}
          aria-invalid={!parseEndpoint(config.apiEndpoint)}
          spellCheck={false}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor={id('max-tokens')}>Máx. de tokens</Label>
          <Input
            id={id('max-tokens')}
            type="number"
            inputMode="numeric"
            min="1"
            value={config.maxTokens}
            onChange={(e) => setCompareSlot(slot, { maxTokens: e.target.value })}
            aria-invalid={Number.isNaN(parseMaxTokens(config.maxTokens))}
            placeholder={info.defaultMaxTokens ? info.defaultMaxTokens.toLocaleString('pt-BR') : 'Padrão'}
          />
        </div>
        <div className="space-y-1.5 min-w-0">
          <Label htmlFor={id('temperature')}>Temperatura</Label>
          <Input
            id={id('temperature')}
            inputMode="decimal"
            value={config.temperature}
            onChange={(e) => setCompareSlot(slot, { temperature: e.target.value })}
            aria-invalid={Number.isNaN(parseTemperature(config.temperature, config.provider))}
            placeholder={config.provider === 'anthropic' ? 'Não enviar' : 'Padrão (0,7)'}
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        A chave de API é a de {info.label}, informada na aba Configuração.
      </p>
    </fieldset>
  )
}

const columnProps = (label: string, result: CompareResult | null, loading: boolean, fallback: { provider: ApiProvider; model: string; apiEndpoint: string }) => {
  if (!result) {
    return { title: label, provider: fallback.provider, model: fallback.model, endpoint: fallback.apiEndpoint, text: null, loading }
  }
  const { response } = result
  return {
    title: label,
    provider: result.provider,
    model: result.model,
    endpoint: result.endpoint,
    responseTimeMs: response.responseTime,
    inputTokens: response.usage?.prompt_tokens,
    outputTokens: response.usage?.completion_tokens,
    text: response.success ? response.response ?? '' : null,
    error: response.success || response.canceled ? null : [response.error, response.errorDetail].filter(Boolean).join(': '),
    canceled: response.canceled === true,
    finishReason: response.finishReason,
  }
}

// "Comparar modelos": the same prompt sent to two configurations at the same time
export function CompareModels() {
  const { addToast } = usePromptStore()
  const { prompt, setPrompt, compare, compareResults, compareLoading, apiKeys, runCompare, cancelCompare } = useTestingStore()
  const issues = getCompareIssues(prompt, compare, apiKeys)
  const hasResults = compareResults.a !== null || compareResults.b !== null
  const resultsRef = useRef<HTMLDivElement>(null)

  // The answers appear below the form: bring them into view when a comparison starts
  useEffect(() => {
    if (compareLoading) resultsRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }, [compareLoading])

  const handleCompare = async () => {
    if (issues.length > 0) {
      await runCompare()
      addToast({ type: 'error', title: 'Não foi possível comparar', description: issues.join(' ') })
      return
    }
    const results = await runCompare()
    if (!results) return
    const { a, b } = results
    if (a.response.canceled && b.response.canceled) {
      addToast({ type: 'info', title: 'Comparação cancelada' })
    } else if (a.response.canceled || b.response.canceled) {
      addToast({ type: 'info', title: `Lado ${a.response.canceled ? 'A' : 'B'} cancelado`, description: 'O outro lado continua na tela.' })
    } else if (a.response.success && b.response.success) {
      addToast({
        type: 'success',
        title: 'Comparação concluída',
        description: `A: ${formatMs(a.response.responseTime)} · B: ${formatMs(b.response.responseTime)}`,
      })
    } else {
      addToast({ type: 'warning', title: 'Comparação concluída com erro', description: 'Veja os detalhes em cada lado.' })
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitCompare className="h-4 w-4" aria-hidden="true" />
            Comparar modelos
          </CardTitle>
          <CardDescription>
            Envia o mesmo prompt para duas configurações ao mesmo tempo e mostra as respostas lado a lado, com tempo e tokens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="compare-prompt">Prompt (o mesmo da aba Testar prompt)</Label>
            <Textarea
              id="compare-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Digite o prompt que deseja comparar..."
              className="min-h-[120px] resize-y"
              disabled={compareLoading}
            />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <SlotConfig slot="a" />
            <SlotConfig slot="b" />
          </div>

          {!compareLoading && issues.length > 0 && (
            <div className="text-sm text-muted-foreground" role="status">
              <p className="font-medium">Para comparar:</p>
              <ul className="list-disc list-inside">
                {issues.map((issue) => <li key={issue}>{issue}</li>)}
              </ul>
            </div>
          )}

          <div className="flex gap-2">
            <Button onClick={() => void handleCompare()} disabled={compareLoading} className="flex-1">
              <GitCompare className="h-4 w-4 mr-2" />
              {compareLoading ? 'Comparando...' : 'Comparar'}
            </Button>
            {compareLoading && (
              <Button variant="outline" onClick={() => void cancelCompare()}>
                <Square className="h-4 w-4 mr-2" />
                Cancelar os dois
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {(compareLoading || hasResults) && (
        <div ref={resultsRef} className="grid grid-cols-1 md:grid-cols-2 gap-4 scroll-mt-4" aria-live="polite">
          <RunColumn
            {...columnProps('A', compareResults.a, compareLoading && !compareResults.a, compare.a)}
            onCancel={() => void cancelCompare('a')}
          />
          <RunColumn
            {...columnProps('B', compareResults.b, compareLoading && !compareResults.b, compare.b)}
            onCancel={() => void cancelCompare('b')}
          />
        </div>
      )}
    </div>
  )
}
