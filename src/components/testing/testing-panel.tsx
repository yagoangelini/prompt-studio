import { useState } from 'react'
import { Play, Settings, Copy, Clock, Zap, Square, AlertTriangle, Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import {
  useTestingStore,
  getTestIssues,
  isInsecureEndpoint,
  parseEndpoint,
  parseMaxTokens,
  MAX_TOKENS_LIMIT,
  TEST_TIMEOUT_SECONDS,
  type TestingTab,
} from './testing-store'

// Suggestions only: any model accepted by the endpoint can be typed
const MODEL_SUGGESTIONS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-3.5-turbo']

const FINISH_REASON_HINTS: Record<string, string> = {
  length: 'A resposta foi cortada pelo limite de tokens. Aumente o máximo de tokens na aba Configuração.',
  content_filter: 'A resposta foi bloqueada pelo filtro de conteúdo da API.',
}

const endpointLabel = (endpoint: string) => parseEndpoint(endpoint)?.host ?? (endpoint.trim() || 'não definido')

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

export function TestingPanel() {
  const { prompts, addToast } = usePromptStore()
  const {
    apiEndpoint, apiKey, model, temperature, maxTokens,
    prompt: testPrompt, response, lastRun, isLoading, activeTab,
    setConfig, setApiKey, setPrompt, setActiveTab, runTest, cancelTest,
  } = useTestingStore()
  // Quick select is only an action: it goes back to its placeholder after each choice
  const [quickSelectValue, setQuickSelectValue] = useState('')

  const issues = getTestIssues({ prompt: testPrompt, apiKey, model, apiEndpoint, maxTokens })
  const insecureEndpoint = isInsecureEndpoint(apiEndpoint)
  const maxTokensInvalid = Number.isNaN(parseMaxTokens(maxTokens))
  const endpointInvalid = !parseEndpoint(apiEndpoint)

  const handleTest = async () => {
    if (isLoading) return
    if (issues.length > 0) {
      addToast({
        type: 'error',
        title: 'Não foi possível executar o teste',
        description: issues.map((issue) => issue.message).join(' ')
      })
      return
    }

    // The request lives in the store, so it finishes even if the user leaves this tab
    const result = await runTest()
    if (!result) return

    if (result.success) {
      if (!result.response) {
        addToast({ type: 'warning', title: 'A API respondeu sem conteúdo', description: 'Veja os detalhes na área de resposta.' })
      } else {
        addToast({ type: 'success', title: 'Teste concluído', description: `Resposta recebida em ${result.responseTime} ms` })
      }
    } else if (result.canceled) {
      addToast({ type: 'info', title: 'Teste cancelado' })
    } else {
      addToast({
        type: 'error',
        title: 'Falha no teste',
        description: result.errorDetail ? `${result.error}: ${result.errorDetail}` : result.error || 'Erro desconhecido'
      })
    }
  }

  const handleUsePrompt = async (value: string) => {
    setQuickSelectValue('')
    const selected = prompts.find(p => p.id === Number(value))
    if (!selected) return
    if (testPrompt.trim() && testPrompt !== selected.content) {
      const confirmed = await confirmAction({
        title: 'Substituir o texto digitado?',
        description: `O texto atual do teste será substituído pelo conteúdo de "${selected.title}".`,
        confirmLabel: 'Substituir',
      })
      if (!confirmed) return
    }
    setPrompt(selected.content)
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

  const formatTokens = (value: number | undefined) => (value === undefined ? '—' : value.toLocaleString('pt-BR'))

  return (
    // Scrolls as a whole in small windows, so the button and the metrics are always reachable
    <div className="h-full overflow-y-auto p-4">
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as TestingTab)} className="flex flex-col">
        <TabsList className="self-start">
          <TabsTrigger value="test">Testar prompt</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
        </TabsList>

        <TabsContent value="test" className="mt-4">
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
                    <Select value={quickSelectValue} onValueChange={handleUsePrompt}>
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

                  <div className="flex gap-2">
                    <Button onClick={handleTest} disabled={isLoading} className="flex-1">
                      <Play className="h-4 w-4 mr-2" />
                      {isLoading ? 'Testando...' : 'Executar teste'}
                    </Button>
                    {isLoading && (
                      <Button variant="outline" onClick={cancelTest}>
                        <Square className="h-4 w-4 mr-2" />
                        Cancelar
                      </Button>
                    )}
                  </div>

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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleCopyResponse}
                      >
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
                        <p className="text-xs text-muted-foreground mt-1">O teste é interrompido após {TEST_TIMEOUT_SECONDS} segundos sem resposta.</p>
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
                                {response.finishReason && (
                                  <>
                                    {' '}
                                    {FINISH_REASON_HINTS[response.finishReason] ?? `Motivo informado pela API: ${response.finishReason}.`}
                                  </>
                                )}
                              </AlertDescription>
                            </Alert>
                          )}

                          {response.response && response.finishReason === 'length' && (
                            <p className="text-xs text-muted-foreground">{FINISH_REASON_HINTS.length}</p>
                          )}

                          {/* Response Metrics */}
                          <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <div className="flex items-center space-x-2">
                                <Clock className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Tempo de resposta</span>
                              </div>
                              <Badge variant="outline">
                                {response.responseTime?.toLocaleString('pt-BR')} ms
                              </Badge>
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
                              Modelo: {lastRun.model} · Endpoint: {endpointLabel(lastRun.endpoint)}
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
        </TabsContent>

        <TabsContent value="config" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center space-x-2">
                <Settings className="h-4 w-4" />
                <span>Configuração da API</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                O teste usa o formato de chat da OpenAI (<code>/v1/chat/completions</code>). Funciona com a OpenAI e com serviços compatíveis; a API da Anthropic (Claude) usa outro formato e não é compatível.
              </p>
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
                    {endpointInvalid && (
                      <p className="text-xs text-destructive">Use um endereço completo que comece com http:// ou https://</p>
                    )}
                  </div>

                  {insecureEndpoint && <InsecureEndpointWarning />}

                  <div className="space-y-2">
                    <Label htmlFor="api-key">Chave de API</Label>
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
                      placeholder="Ex.: gpt-4o-mini"
                      spellCheck={false}
                    />
                    <datalist id="test-model-suggestions">
                      {MODEL_SUGGESTIONS.map((suggestion) => (
                        <option key={suggestion} value={suggestion} />
                      ))}
                    </datalist>
                    <p className="text-xs text-muted-foreground">Escolha uma sugestão ou digite o nome de qualquer modelo aceito pelo endpoint.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="temperature">Temperatura ({temperature.toLocaleString('pt-BR')})</Label>
                    <Input
                      id="temperature"
                      type="range"
                      min="0"
                      max="2"
                      step="0.1"
                      value={temperature}
                      onChange={(e) => setConfig({ temperature: parseFloat(e.target.value) })}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>Focado</span>
                      <span>Criativo</span>
                    </div>
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
                      placeholder="Padrão da API"
                    />
                    {maxTokensInvalid ? (
                      <p className="text-xs text-destructive">Use um número inteiro entre 1 e {MAX_TOKENS_LIMIT.toLocaleString('pt-BR')}.</p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Deixe vazio para usar o padrão da API.</p>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
