import { useState } from 'react'
import { Play, Settings, Copy, Clock, Zap, Square, AlertTriangle, Info } from 'lucide-react'
import type { ApiProvider } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { resolvePromptText } from '@/lib/copy-prompt'
import {
  useTestingStore,
  getTestIssues,
  isInsecureEndpoint,
  parseEndpoint,
  parseMaxTokens,
  API_PROVIDERS,
  PROVIDERS,
  MAX_TOKENS_LIMIT,
  type TestingTab,
} from './testing-store'
import { endpointLabel, finishReasonHint, finishReasonText, formatMs, formatTokens, isTruncated, providerLabel } from './testing-format'
import { useRunTest } from './use-run-test'
import { TestHistory } from './test-history'
import { CompareModels } from './compare-models'

function InsecureEndpointWarning() {
  return (
    <Alert>
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        O endpoint usa <code>http://</code> em outro computador: a chave de API e o prompt são enviados sem criptografia. Prefira <code>https://</code>.
      </AlertDescription>
    </Alert>
  )
}

function TestTab() {
  const { prompts, addToast } = usePromptStore()
  const {
    provider, apiEndpoint, apiKey, model, maxTokens,
    prompt: testPrompt, response, lastRun, isLoading,
    setPrompt, setActiveTab, cancelTest,
  } = useTestingStore()
  const runTest = useRunTest()
  // Quick select is only an action: it goes back to its placeholder after each choice
  const [quickSelectValue, setQuickSelectValue] = useState('')

  const issues = getTestIssues({ prompt: testPrompt, apiKey, model, apiEndpoint, maxTokens })
  const insecureEndpoint = isInsecureEndpoint(apiEndpoint)
  const hint = finishReasonHint(response?.finishReason)

  const handleUsePrompt = async (value: string) => {
    setQuickSelectValue('')
    const selected = prompts.find((p) => p.id === Number(value))
    if (!selected) return
    if (testPrompt.trim() && testPrompt !== selected.content) {
      const confirmed = await confirmAction({
        title: 'Substituir o texto digitado?',
        description: `O texto atual do teste será substituído pelo conteúdo de "${selected.title}".`,
        confirmLabel: 'Substituir',
      })
      if (!confirmed) return
    }
    // Prompts with {{variables}} are filled in first; canceling keeps the current text
    const text = await resolvePromptText(selected, { confirmLabel: 'Usar no teste' })
    if (text === null) return
    setPrompt(text, selected.id)
  }

  const handleCopyResponse = async () => {
    if (!response?.response) return
    try {
      await window.electronAPI.copyToClipboard(response.response)
      addToast({ type: 'success', title: 'Copiado!', description: 'Resposta copiada para a área de transferência' })
    } catch (error) {
      console.error('Failed to copy:', error)
      addToast({ type: 'error', title: 'Não foi possível copiar', description: 'Tente novamente.' })
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Input Panel */}
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Entrada do teste</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Current configuration */}
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
              <span>Provedor: <span className="font-medium text-foreground">{providerLabel(provider)}</span></span>
              <span aria-hidden="true">·</span>
              <span>Modelo: <span className="font-medium text-foreground">{model.trim() || 'não definido'}</span></span>
              <span aria-hidden="true">·</span>
              <span className="min-w-0 break-all">Endpoint: <span className="font-medium text-foreground">{endpointLabel(apiEndpoint)}</span></span>
              <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setActiveTab('config')}>
                Alterar
              </Button>
            </div>

            {insecureEndpoint && <InsecureEndpointWarning />}

            {/* Quick Select */}
            <div className="space-y-2">
              <Label htmlFor="quick-select">Seleção rápida de prompts</Label>
              <Select value={quickSelectValue} onValueChange={(value) => void handleUsePrompt(value)}>
                <SelectTrigger id="quick-select">
                  <SelectValue placeholder="Escolha um prompt para testar..." />
                </SelectTrigger>
                <SelectContent>
                  {prompts.map((prompt) => (
                    <SelectItem key={prompt.id} value={prompt.id.toString()}>
                      {prompt.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Prompt Input */}
            <div className="space-y-2">
              <Label htmlFor="test-prompt">Prompt a ser testado</Label>
              <Textarea
                id="test-prompt"
                placeholder="Digite o prompt que deseja testar..."
                value={testPrompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="min-h-[200px] resize-y"
              />
              <div className="text-xs text-muted-foreground">
                {testPrompt.length.toLocaleString('pt-BR')} {testPrompt.length === 1 ? 'caractere' : 'caracteres'}
              </div>
            </div>

            {/* What is missing, right above the button (visible without scrolling) */}
            {!isLoading && issues.length > 0 && (
              <div className="text-sm text-muted-foreground" role="status">
                <p className="font-medium">Para executar o teste:</p>
                <ul className="list-disc list-inside">
                  {issues.map((issue) => (
                    <li key={issue.field}>{issue.message}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={() => void runTest()} disabled={isLoading} className="flex-1">
                <Play className="h-4 w-4 mr-2" />
                {isLoading ? 'Testando...' : 'Executar teste'}
              </Button>
              {isLoading && (
                <Button variant="outline" onClick={() => void cancelTest()}>
                  <Square className="h-4 w-4 mr-2" />
                  Cancelar
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Output Panel */}
      <div className="space-y-4 min-w-0">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Resposta</CardTitle>
              {response?.response && (
                <Button variant="outline" size="sm" onClick={() => void handleCopyResponse()}>
                  <Copy className="h-4 w-4 mr-2" />
                  Copiar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
                  <p className="text-sm text-muted-foreground">Executando teste...</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    O teste é interrompido após {PROVIDERS[provider].timeoutSeconds} segundos sem resposta.
                  </p>
                </div>
              </div>
            ) : response ? (
              <div className="space-y-4">
                {response.success ? (
                  <>
                    {response.response ? (
                      <ScrollArea className="h-64 border rounded-lg p-3">
                        <pre className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {response.response}
                        </pre>
                      </ScrollArea>
                    ) : (
                      <Alert>
                        <Info className="h-4 w-4" />
                        <AlertDescription>
                          A API respondeu, mas sem conteúdo.
                          {response.finishReason && <> {finishReasonText(response.finishReason)}</>}
                        </AlertDescription>
                      </Alert>
                    )}

                    {response.response && hint && (
                      <p className={`text-xs ${isTruncated(response.finishReason) ? 'text-muted-foreground' : 'text-destructive'}`}>{hint}</p>
                    )}

                    {/* Response Metrics */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <div className="flex items-center space-x-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          <span className="text-sm font-medium">Tempo de resposta</span>
                        </div>
                        <Badge variant="outline">{formatMs(response.responseTime)}</Badge>
                      </div>

                      {response.usage && (
                        <div className="space-y-2">
                          <div className="flex items-center space-x-2">
                            <Zap className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm font-medium">Uso de tokens</span>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            <div>Prompt: {formatTokens(response.usage.prompt_tokens)}</div>
                            <div>Resposta: {formatTokens(response.usage.completion_tokens)}</div>
                            <div>Total: {formatTokens(response.usage.total_tokens)}</div>
                          </div>
                        </div>
                      )}
                    </div>
                    {lastRun && (
                      <p className="text-xs text-muted-foreground break-all">
                        {providerLabel(lastRun.provider)} · Modelo: {lastRun.model} · Endpoint: {endpointLabel(lastRun.endpoint)}
                      </p>
                    )}
                  </>
                ) : response.canceled ? (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    Teste cancelado
                  </div>
                ) : (
                  <div className="text-center py-8 space-y-2">
                    <div className="text-destructive font-medium">
                      {response.error || 'Falha no teste'}
                    </div>
                    {response.errorDetail && (
                      <p className="text-sm text-muted-foreground break-words [overflow-wrap:anywhere]">
                        {response.errorDetail}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-sm">A resposta aparecerá aqui depois que você executar um teste</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function ConfigTab() {
  const {
    provider, apiEndpoint, apiKey, model, temperature, sendTemperature, maxTokens,
    setConfig, setProvider, setApiKey,
  } = useTestingStore()
  const info = PROVIDERS[provider]
  const isAnthropic = provider === 'anthropic'
  const insecureEndpoint = isInsecureEndpoint(apiEndpoint)
  const maxTokensInvalid = Number.isNaN(parseMaxTokens(maxTokens))
  const endpointInvalid = !parseEndpoint(apiEndpoint)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center space-x-2">
          <Settings className="h-4 w-4" />
          <span>Configuração da API</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 max-w-md">
          <Label htmlFor="api-provider">Provedor</Label>
          <Select value={provider} onValueChange={(value) => setProvider(value as ApiProvider)}>
            <SelectTrigger id="api-provider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {API_PROVIDERS.map((option) => (
                <SelectItem key={option} value={option}>{PROVIDERS[option].label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-sm text-muted-foreground">
            {isAnthropic ? (
              <>Usa a API Messages da Anthropic (<code>/v1/messages</code>) para testar com os modelos Claude.</>
            ) : (
              <>Usa o formato de chat da OpenAI (<code>/v1/chat/completions</code>). Funciona com a OpenAI e com serviços compatíveis.</>
            )}
            {' '}Cada provedor guarda o próprio endpoint, modelo e chave.
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="api-endpoint">Endpoint da API</Label>
              <Input
                id="api-endpoint"
                value={apiEndpoint}
                onChange={(e) => setConfig({ apiEndpoint: e.target.value })}
                aria-invalid={endpointInvalid}
                spellCheck={false}
              />
              {endpointInvalid ? (
                <p className="text-xs text-destructive">Use um endereço completo que comece com http:// ou https://</p>
              ) : apiEndpoint.trim() !== info.defaultEndpoint && (
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setConfig({ apiEndpoint: info.defaultEndpoint })}>
                  Usar o endpoint padrão ({endpointLabel(info.defaultEndpoint)})
                </Button>
              )}
            </div>

            {insecureEndpoint && <InsecureEndpointWarning />}

            <div className="space-y-2">
              <Label htmlFor="api-key">{isAnthropic ? 'Chave de API da Anthropic' : 'Chave de API'}</Label>
              <Input
                id="api-key"
                type="password"
                placeholder="Digite sua chave de API..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                A chave fica só na memória enquanto o app estiver aberto; ela não é salva no disco.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="model">Modelo</Label>
              <Input
                id="model"
                list="test-model-suggestions"
                value={model}
                onChange={(e) => setConfig({ model: e.target.value })}
                placeholder={`Ex.: ${info.defaultModel}`}
                spellCheck={false}
              />
              <datalist id="test-model-suggestions">
                {info.models.map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
              <p className="text-xs text-muted-foreground">Escolha uma sugestão ou digite o nome de qualquer modelo aceito pelo endpoint.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              {isAnthropic && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="send-temperature"
                    checked={sendTemperature}
                    onCheckedChange={(checked) => setConfig({ sendTemperature: checked })}
                  />
                  <Label htmlFor="send-temperature">Enviar temperatura</Label>
                </div>
              )}
              <Label htmlFor="temperature" className={isAnthropic && !sendTemperature ? 'text-muted-foreground' : undefined}>
                Temperatura ({temperature.toLocaleString('pt-BR')})
              </Label>
              <Input
                id="temperature"
                type="range"
                min="0"
                max={info.temperatureMax}
                step="0.1"
                value={temperature}
                disabled={isAnthropic && !sendTemperature}
                onChange={(e) => setConfig({ temperature: parseFloat(e.target.value) })}
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Focado</span>
                <span>Criativo</span>
              </div>
              {isAnthropic && (
                <p className="text-xs text-muted-foreground">
                  Os modelos Claude mais novos (Opus 5, Sonnet 5, Fable e Opus 4.7 em diante) não aceitam temperatura: deixe desligado para eles.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="max-tokens">Máximo de tokens</Label>
              <Input
                id="max-tokens"
                type="number"
                inputMode="numeric"
                min="1"
                max={MAX_TOKENS_LIMIT}
                value={maxTokens}
                onChange={(e) => setConfig({ maxTokens: e.target.value })}
                aria-invalid={maxTokensInvalid}
                placeholder={info.defaultMaxTokens ? `${info.defaultMaxTokens.toLocaleString('pt-BR')} (padrão)` : 'Padrão da API'}
              />
              {maxTokensInvalid ? (
                <p className="text-xs text-destructive">Use um número inteiro entre 1 e {MAX_TOKENS_LIMIT.toLocaleString('pt-BR')}.</p>
              ) : info.defaultMaxTokens ? (
                <p className="text-xs text-muted-foreground">
                  A API da Anthropic exige esse valor. Vazio envia {info.defaultMaxTokens.toLocaleString('pt-BR')}, que inclui o raciocínio do modelo e a resposta.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">Deixe vazio para usar o padrão da API.</p>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function TestingPanel() {
  const { activeTab, setActiveTab } = useTestingStore()

  return (
    // Scrolls as a whole in small windows, so the button and the metrics are always reachable
    <div className="h-full overflow-y-auto p-4">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TestingTab)} className="flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="test">Testar prompt</TabsTrigger>
          <TabsTrigger value="compare">Comparar modelos</TabsTrigger>
          <TabsTrigger value="history">Histórico</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="test" className="mt-4">
          <TestTab />
        </TabsContent>

        <TabsContent value="compare" className="mt-4">
          <CompareModels />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <TestHistory />
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <ConfigTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
