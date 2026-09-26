import { useState, useEffect, useCallback, useMemo } from 'react'
import { Server, Play, Square, Settings, Copy, Download, Users, Shield, Globe, AlertTriangle, CheckCircle, XCircle, Search, X, Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Separator } from '@/components/ui/separator'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore, getMcpPortError, isValidMcpPort } from '@/stores/usePromptStore'
import type { McpExposedPromptRef, McpServerLogEntry, Prompt } from '@/types'

// The server only listens on this address (see electron/mcp-server.ts)
const MCP_HOST = '127.0.0.1'

interface ServerStatus {
  running: boolean
  port: number
  connections: number
  uptime: number
  requests: number
  errors: number
}

const STOPPED: ServerStatus = { running: false, port: 0, connections: 0, uptime: 0, requests: 0, errors: 0 }

const LOG_LEVEL_LABELS: Record<McpServerLogEntry['level'], string> = {
  DEBUG: 'Depuração',
  INFO: 'Info',
  WARN: 'Aviso',
  ERROR: 'Erro',
}

// Exposures the server can use: exposed, with a secure hash and pointing to an existing prompt
const getValidExposures = (
  exposures: readonly McpExposedPromptRef[],
  prompts: readonly Prompt[]
): McpExposedPromptRef[] =>
  exposures.filter((e) => e.exposed && Boolean(e.secureHash) && prompts.some((p) => p.id === e.id))

// 256 random bits from the OS generator (Math.random is not suitable for secrets)
const generateApiKey = (): string => {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return `mcp_${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

const formatUptime = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  return `${hours}h ${minutes}m`
}

interface NumberSettingProps {
  id: string
  label: string
  value: number
  min: number
  max: number
  disabled?: boolean
  hint?: string
  onCommit: (value: number) => void
  // With these, an invalid value stays in the field as a draft kept outside it (it survives tab changes
  // and is not reverted on blur), so actions that depend on the value can refuse to run
  draft?: string | null
  onDraftChange?: (draft: string | null) => void
}

// Numeric field that only saves valid integers: an empty or out-of-range value shows an error
// instead of being stored as NaN (and is reverted when the field loses focus, unless kept as a draft)
function NumberSetting({ id, label, value, min, max, disabled, hint, onCommit, draft, onDraftChange }: NumberSettingProps) {
  const valueText = Number.isFinite(value) ? String(value) : ''
  const [localText, setLocalText] = useState(valueText)

  useEffect(() => {
    setLocalText(valueText)
  }, [valueText])

  const isValidText = (candidate: string) => {
    const parsed = Number(candidate)
    return candidate.trim() !== '' && Number.isInteger(parsed) && parsed >= min && parsed <= max
  }
  const text = onDraftChange ? draft ?? valueText : localText
  const valid = isValidText(text)
  const errorId = `${id}-erro`

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={text}
        disabled={disabled}
        aria-invalid={!valid}
        aria-describedby={!valid ? errorId : undefined}
        onChange={(e) => {
          const next = e.target.value
          const nextValid = isValidText(next)
          if (onDraftChange) onDraftChange(nextValid ? null : next)
          else setLocalText(next)
          if (nextValid) onCommit(Number(next))
        }}
        onBlur={() => {
          if (!onDraftChange && !valid) setLocalText(valueText)
        }}
      />
      {!valid ? (
        <p id={errorId} className="text-xs text-destructive">
          Use um número inteiro entre {min.toLocaleString('pt-BR')} e {max.toLocaleString('pt-BR')}.
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

interface CodeBlockProps {
  code: string
  copyValue?: string
  copyLabel: string
  onCopy: (value: string) => void
}

function CodeBlock({ code, copyValue, copyLabel, onCopy }: CodeBlockProps) {
  return (
    <div className="relative bg-muted rounded-lg">
      <pre className="p-4 pr-12 font-mono text-xs whitespace-pre-wrap break-all">{code}</pre>
      <Button
        variant="ghost"
        size="sm"
        className="absolute right-2 top-2 h-7 w-7 p-0"
        onClick={() => onCopy(copyValue ?? code)}
        aria-label={copyLabel}
        title={copyLabel}
      >
        <Copy className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function McpServerPanel() {
  const {
    prompts,
    categories,
    addToast,
    mcpConfig,
    exposedPrompts,
    mcpPortDraft,
    updateMcpConfig,
    setMcpPortDraft,
    togglePromptExposure,
    migrateLegacyEndpoints
  } = usePromptStore()

  const [activeTab, setActiveTab] = useState('overview')
  const [serverStatus, setServerStatus] = useState<ServerStatus>(STOPPED)
  // When the last status arrived, to keep the uptime ticking between polls
  const [statusReceivedAt, setStatusReceivedAt] = useState(() => Date.now())
  const [now, setNow] = useState(() => Date.now())
  const [serverLogs, setServerLogs] = useState<readonly McpServerLogEntry[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)
  const [apiKeyCopied, setApiKeyCopied] = useState(false)

  const validExposures = useMemo(() => getValidExposures(exposedPrompts, prompts), [exposedPrompts, prompts])
  const exposedCount = validExposures.length
  const legacyCount = exposedPrompts.filter(
    (e) => e.exposed && (!e.secureHash || /\/prompts\/\d+$/.test(e.endpoint))
  ).length
  const portError = getMcpPortError({ mcpConfig, mcpPortDraft })
  // While the port field holds an invalid value, the examples show a placeholder instead of the old port
  const displayPort = serverStatus.running ? serverStatus.port : portError ? null : mcpConfig.port
  const baseUrl = `http://${MCP_HOST}:${isValidMcpPort(displayPort) ? displayPort : 'PORTA'}`
  const mcpUrl = `${baseUrl}/mcp`

  const refreshStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getMcpServerStatus()
      setServerStatus({
        running: status.running,
        port: status.port || 0,
        connections: status.connections || 0,
        uptime: status.uptime || 0,
        requests: status.requests || 0,
        errors: status.errors || 0,
      })
      setServerLogs(status.logs ?? [])
      setStatusReceivedAt(Date.now())
      return status.running
    } catch (error) {
      console.error('Failed to check server status:', error)
      return false
    }
  }, [])

  // Sends the current exposure list to the server if it is running (asks the server, not local state)
  const syncExposuresWithServer = useCallback(async () => {
    try {
      const status = await window.electronAPI.getMcpServerStatus()
      if (!status.running) return
      const state = usePromptStore.getState()
      await window.electronAPI.updateMcpServerExposedPrompts(getValidExposures(state.exposedPrompts, state.prompts))
    } catch (error) {
      console.error('Failed to update server exposed prompts:', error)
    }
  }, [])

  // Status: the main process broadcasts every change; polling stays as a fallback and refreshes counters
  useEffect(() => {
    refreshStatus()
    const unsubscribe = window.electronAPI.onMcpServerStatusChanged(() => {
      refreshStatus()
    })
    const interval = setInterval(refreshStatus, 5000)
    return () => {
      unsubscribe()
      clearInterval(interval)
    }
  }, [refreshStatus])

  // Uptime ticks every second, starting from the value computed by the server
  useEffect(() => {
    if (!serverStatus.running) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [serverStatus.running])
  const uptime = serverStatus.running
    ? serverStatus.uptime + Math.max(0, Math.floor((now - statusReceivedAt) / 1000))
    : 0

  // Old exposures (numeric endpoints, no hash) get a secure hash automatically
  useEffect(() => {
    if (legacyCount === 0) return
    migrateLegacyEndpoints()
    syncExposuresWithServer()
  }, [legacyCount, migrateLegacyEndpoints, syncExposuresWithServer])

  // A server started elsewhere (header, menu bar) uses the saved port: the locked field shows it again
  useEffect(() => {
    if (serverStatus.running) setMcpPortDraft(null)
  }, [serverStatus.running, setMcpPortDraft])

  // Settings changed while the server runs apply immediately (the port is locked while running)
  useEffect(() => {
    if (!serverStatus.running) return
    window.electronAPI.updateMcpServerConfig(mcpConfig).catch((error) => {
      console.error('Failed to update server config:', error)
    })
  }, [mcpConfig, serverStatus.running])

  const copyText = async (text: string, title: string, description: string) => {
    try {
      await window.electronAPI.copyToClipboard(text)
      addToast({ type: 'success', title, description })
    } catch (error) {
      console.error('Failed to copy:', error)
      addToast({ type: 'error', title: 'Não foi possível copiar', description: 'Tente novamente.' })
    }
  }

  const handleStartServer = async () => {
    // Checked on the latest state: the port field may hold an invalid value (never start on the old port)
    const invalidPort = getMcpPortError(usePromptStore.getState())
    if (invalidPort) {
      setActiveTab('config')
      addToast({ type: 'error', title: 'Porta inválida', description: invalidPort })
      return
    }
    if (mcpConfig.enableAuth && !mcpConfig.apiKey.trim()) {
      setActiveTab('config')
      addToast({
        type: 'error',
        title: 'Defina uma chave de API',
        description: 'A autenticação está ativada. Gere ou digite uma chave de API na aba Configuração antes de iniciar o servidor.'
      })
      return
    }

    setIsLoading(true)
    try {
      const result = await window.electronAPI.startMcpServer(mcpConfig, validExposures)
      if (!result.success) throw new Error(result.message || 'Não foi possível iniciar o servidor')
      addToast({
        type: 'success',
        title: 'Servidor MCP iniciado',
        description: `Endereço MCP: http://${MCP_HOST}:${result.port ?? mcpConfig.port}/mcp`
      })
    } catch (error) {
      console.error('Failed to start MCP server:', error)
      addToast({
        type: 'error',
        title: 'Não foi possível iniciar o servidor',
        description: error instanceof Error ? error.message : 'Erro desconhecido'
      })
    } finally {
      await refreshStatus()
      setIsLoading(false)
    }
  }

  const handleStopServer = async () => {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.stopMcpServer()
      if (!result.success) throw new Error(result.message || 'Não foi possível parar o servidor')
      addToast({ type: 'info', title: 'Servidor MCP parado', description: 'O servidor foi encerrado.' })
    } catch (error) {
      console.error('Failed to stop MCP server:', error)
      addToast({
        type: 'error',
        title: 'Não foi possível parar o servidor',
        description: error instanceof Error ? error.message : 'Erro desconhecido'
      })
    } finally {
      await refreshStatus()
      setIsLoading(false)
    }
  }

  const handleTogglePromptExposure = async (promptId: number) => {
    togglePromptExposure(promptId)
    // The store is already updated: the server receives the current list, not the one before the toggle
    await syncExposuresWithServer()
  }

  const handleExportConfig = () => {
    // Only the user's settings, listed field by field: never the API key (a secret) nor internal fields
    // such as "host" or "allowedOrigins" that older versions kept
    const { name, description, port, enableAuth, maxConnections, rateLimit, enableCors, enableLogging, logLevel } = mcpConfig
    const config = {
      server: { name, description, port, enableAuth, maxConnections, rateLimit, enableCors, enableLogging, logLevel },
      exposedPrompts: validExposures,
    }

    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'mcp-server-config.json'
    a.click()
    URL.revokeObjectURL(url)

    addToast({
      type: 'success',
      title: 'Configuração exportada',
      description: 'O arquivo não inclui a chave de API.'
    })
  }

  const handleGenerateApiKey = async () => {
    if (mcpConfig.apiKey) {
      const confirmed = await confirmAction({
        title: 'Gerar uma nova chave de API?',
        description: 'A chave atual deixará de funcionar. Os clientes MCP que usam essa chave precisarão ser configurados com a nova.',
        confirmLabel: 'Gerar nova chave',
        destructive: true,
      })
      if (!confirmed) return
    }
    updateMcpConfig({ apiKey: generateApiKey() })
    addToast({ type: 'success', title: 'Nova chave de API gerada', description: 'Copie a chave para configurar seus clientes MCP.' })
  }

  const handleClearLogs = async () => {
    try {
      await window.electronAPI.clearMcpServerLogs()
      setServerLogs([])
      addToast({ type: 'success', title: 'Logs limpos', description: 'Os logs do servidor foram limpos.' })
    } catch (error) {
      console.error('Failed to clear logs:', error)
      addToast({ type: 'error', title: 'Não foi possível limpar os logs', description: 'Tente novamente.' })
    }
  }

  const handleCopyApiKey = async () => {
    if (!mcpConfig.apiKey) return
    await copyText(mcpConfig.apiKey, 'Chave de API copiada', 'A chave de API foi copiada para a área de transferência.')
    setApiKeyCopied(true)
    setTimeout(() => setApiKeyCopied(false), 2000)
  }

  const exposedPromptsList = prompts.map((prompt) => {
    const exposure = exposedPrompts.find((ep) => ep.id === prompt.id)
    const exposed = Boolean(exposure?.exposed)
    return {
      prompt,
      exposed,
      // Endpoints only exist for exposed prompts with a secure hash
      endpoint: exposed && exposure?.secureHash ? `/prompts/${exposure.secureHash}` : null,
    }
  })

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const filteredPrompts = exposedPromptsList.filter(({ prompt }) => {
    const categoryMatch = selectedCategory === 'all' || prompt.category_id?.toString() === selectedCategory
    const searchMatch = !normalizedQuery ||
      prompt.title.toLowerCase().includes(normalizedQuery) ||
      prompt.description?.toLowerCase().includes(normalizedQuery) ||
      prompt.content.toLowerCase().includes(normalizedQuery)
    return categoryMatch && searchMatch
  })

  const keyForExamples = mcpConfig.apiKey || 'SUA_CHAVE_DE_API'
  const claudeCodeCommand = (key: string) =>
    `claude mcp add --transport http prompt-studio ${mcpUrl} --header "Authorization: Bearer ${key}"`
  const claudeDesktopConfig = (key: string) => JSON.stringify({
    mcpServers: {
      'prompt-studio': {
        command: 'npx',
        args: ['-y', 'mcp-remote', mcpUrl, '--allow-http', '--header', 'Authorization:${AUTH_HEADER}'],
        env: { AUTH_HEADER: `Bearer ${key}` },
      },
    },
  }, null, 2)

  return (
    <div className="h-full p-4">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Visão geral</TabsTrigger>
          <TabsTrigger value="prompts">Prompts expostos</TabsTrigger>
          <TabsTrigger value="config">Configuração</TabsTrigger>
          <TabsTrigger value="docs">Documentação</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="flex-1 mt-4">
          <ScrollArea className="h-[calc(100vh-200px)]">
            <div className="space-y-4">
            {/* Server Status Card */}
            <Card>
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center space-x-2">
                    <Server className="h-5 w-5" />
                    <span>Status do servidor MCP</span>
                  </CardTitle>
                  <div className="flex items-center space-x-2" role="status" aria-live="polite">
                    {serverStatus.running ? (
                      <Badge variant="default" className="bg-green-600">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Em execução
                      </Badge>
                    ) : (
                      <Badge variant="secondary">
                        <XCircle className="h-3 w-3 mr-1" />
                        Parado
                      </Badge>
                    )}
                  </div>
                </div>
              </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold">{serverStatus.running ? serverStatus.port : '--'}</div>
                  <div className="text-sm text-muted-foreground">Porta</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{serverStatus.connections}</div>
                  <div className="text-sm text-muted-foreground">Conexões ativas</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{serverStatus.requests}</div>
                  <div className="text-sm text-muted-foreground">Total de requisições</div>
                </div>
                <div className="text-center" title="Falhas internas do servidor (HTTP 5xx). Requisições recusadas, como chave inválida, não contam.">
                  <div className={`text-2xl font-bold ${serverStatus.errors > 0 ? 'text-destructive' : ''}`}>{serverStatus.errors}</div>
                  <div className="text-sm text-muted-foreground">Erros</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold">{exposedCount}</div>
                  <div className="text-sm text-muted-foreground">Prompts expostos</div>
                </div>
              </div>

              {serverStatus.running && (
                <div className="text-center pt-2">
                  <div className="text-sm text-muted-foreground">
                    Tempo ativo: <span className="font-medium">{formatUptime(uptime)}</span>
                  </div>
                </div>
              )}

              <Separator />

              <div className="flex flex-wrap items-center justify-center gap-4">
                {!serverStatus.running ? (
                  <Button
                    onClick={handleStartServer}
                    disabled={isLoading || exposedCount === 0}
                    className="min-w-[120px]"
                  >
                    <Play className="h-4 w-4 mr-2" />
                    {isLoading ? 'Iniciando...' : 'Iniciar servidor'}
                  </Button>
                ) : (
                  <Button
                    onClick={handleStopServer}
                    disabled={isLoading}
                    variant="destructive"
                    className="min-w-[120px]"
                  >
                    <Square className="h-4 w-4 mr-2" />
                    {isLoading ? 'Parando...' : 'Parar servidor'}
                  </Button>
                )}

                <Button variant="outline" onClick={handleExportConfig}>
                  <Download className="h-4 w-4 mr-2" />
                  Exportar configuração
                </Button>
              </div>

              {exposedCount === 0 && !serverStatus.running && (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    Você precisa expor pelo menos um prompt antes de iniciar o servidor. Acesse a aba "Prompts expostos" para escolher quais prompts disponibilizar.
                  </AlertDescription>
                </Alert>
              )}

              {portError && !serverStatus.running && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    A porta digitada na aba "Configuração" é inválida. Use um número inteiro entre 1 e 65535 para poder iniciar o servidor.
                  </AlertDescription>
                </Alert>
              )}

              {serverStatus.running && (
                <Alert>
                  <CheckCircle className="h-4 w-4" />
                  <AlertDescription>
                    Endereço MCP (Streamable HTTP): <code className="bg-muted px-1 rounded break-all">{mcpUrl}</code>
                    <br />
                    API REST: <code className="bg-muted px-1 rounded break-all">{baseUrl}/prompts</code>
                    <br />
                    Veja como conectar o Claude Code e o Claude Desktop na aba "Documentação".
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center space-x-2">
                  <Users className="h-4 w-4" />
                  <span>Controle de acesso</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Autenticação:</span>
                    <Badge variant={mcpConfig.enableAuth ? "default" : "secondary"}>
                      {mcpConfig.enableAuth ? "Ativada" : "Desativada"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Limite de requisições:</span>
                    <span className="font-mono">{mcpConfig.rateLimit}/min</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center space-x-2">
                  <Globe className="h-4 w-4" />
                  <span>Rede</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Endereço:</span>
                    <span className="font-mono">{MCP_HOST}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>CORS:</span>
                    <Badge variant={mcpConfig.enableCors && mcpConfig.enableAuth ? "default" : "secondary"}>
                      {mcpConfig.enableCors && mcpConfig.enableAuth ? "Ativado" : "Desativado"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Máximo de conexões:</span>
                    <span className="font-mono">{mcpConfig.maxConnections}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center space-x-2">
                  <Shield className="h-4 w-4" />
                  <span>Segurança</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Chave de API:</span>
                    <Badge variant={mcpConfig.apiKey ? "default" : "destructive"}>
                      {mcpConfig.apiKey ? "Definida" : "Ausente"}
                    </Badge>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Nível de log:</span>
                    <span className="font-mono">{({ debug: 'Depuração', info: 'Informação', warn: 'Aviso', error: 'Erro' } as Record<string, string>)[mcpConfig.logLevel] ?? mcpConfig.logLevel}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Server Logs */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Logs do servidor</CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleClearLogs}
                  className="h-7 px-2 text-xs"
                >
                  Limpar logs
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-[300px] px-6 pb-4">
                <div className="space-y-1">
                  {serverLogs.length === 0 ? (
                    <div className="text-center text-muted-foreground py-8">
                      Nenhum log disponível
                    </div>
                  ) : (
                    serverLogs.map((log, index) => (
                      <div
                        key={`${log.timestamp}-${index}`}
                        className="flex items-start gap-2 text-xs font-mono border-b border-border/20 pb-1"
                      >
                        <span className="text-muted-foreground whitespace-nowrap">
                          {new Date(log.timestamp).toLocaleTimeString('pt-BR')}
                        </span>
                        <Badge
                          variant={
                            log.level === 'ERROR' ? 'destructive' :
                            log.level === 'WARN' ? 'secondary' :
                            'outline'
                          }
                          className="text-xs h-4 px-1 shrink-0"
                        >
                          {LOG_LEVEL_LABELS[log.level] ?? log.level}
                        </Badge>
                        <div className="flex-1 min-w-0">
                          <div className="break-words">{log.message}</div>
                          {log.detail && (
                            <div className="text-muted-foreground break-words">{log.detail}</div>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
            </div>
          </ScrollArea>
        </TabsContent>

        <TabsContent value="prompts" className="flex-1 mt-4">
          <Card className="h-full">
            <CardHeader className="pb-4">
              <div className="flex items-center justify-between mb-4">
                <CardTitle>Gerenciar prompts expostos</CardTitle>
                <Badge variant="outline">
                  {filteredPrompts.length} prompt{filteredPrompts.length !== 1 ? 's' : ''}
                </Badge>
              </div>

              {/* Search and Filter Row */}
              <div className="flex items-center gap-3">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Buscar prompts..."
                    aria-label="Buscar prompts"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 pr-9 h-9"
                  />
                  {searchQuery && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                      aria-label="Limpar busca"
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>

                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="w-48 h-9" aria-label="Filtrar por categoria">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todas as categorias</SelectItem>
                    {categories.map(category => (
                      <SelectItem key={category.id} value={category.id.toString()}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardHeader>
            <CardContent className="pb-2">
              <ScrollArea className="h-[calc(100vh-350px)]">
                <div className="space-y-2">
                  {filteredPrompts.map(({ prompt, exposed, endpoint }) => (
                    <div
                      key={prompt.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-accent/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <h4 className="font-medium truncate">{prompt.title}</h4>
                          {prompt.category_name && (
                            <Badge
                              variant="secondary"
                              className="text-xs shrink-0"
                              style={{ backgroundColor: `${prompt.category_color}20`, color: prompt.category_color }}
                            >
                              {prompt.category_name}
                            </Badge>
                          )}
                        </div>
                        {prompt.description && (
                          <p className="text-sm text-muted-foreground truncate mt-1">
                            {prompt.description}
                          </p>
                        )}
                        {endpoint && (
                          <div className="flex items-center gap-1 mt-1 min-w-0">
                            <code className="text-xs text-muted-foreground truncate">
                              {baseUrl}{endpoint}
                            </code>
                            <Shield className="h-3 w-3 text-green-600 shrink-0" aria-label="Endpoint seguro" />
                          </div>
                        )}
                      </div>

                      <div className="flex items-center space-x-2 shrink-0">
                        <Switch
                          checked={exposed}
                          onCheckedChange={() => handleTogglePromptExposure(prompt.id)}
                          aria-label={`Expor "${prompt.title}" no servidor MCP`}
                        />
                        {endpoint && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label={`Copiar URL do endpoint de "${prompt.title}"`}
                            title="Copiar URL do endpoint"
                            onClick={() => copyText(`${baseUrl}${endpoint}`, 'Copiado!', 'URL do endpoint copiada para a área de transferência.')}
                          >
                            <Copy className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                  {filteredPrompts.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-8">
                      Nenhum prompt encontrado
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="config" className="flex-1 mt-4">
          <Card className="h-full">
            <CardHeader className="flex-shrink-0 pb-4">
              <CardTitle className="flex items-center space-x-2">
                <Settings className="h-4 w-4" />
                <span>Configuração do servidor</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="space-y-6 p-6 pt-0">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Basic Settings */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Configurações básicas</h3>

                  <div className="space-y-2">
                    <Label htmlFor="server-name">Nome do servidor</Label>
                    <Input
                      id="server-name"
                      value={mcpConfig.name}
                      onChange={(e) => updateMcpConfig({ name: e.target.value })}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="server-desc">Descrição</Label>
                    <Textarea
                      id="server-desc"
                      value={mcpConfig.description}
                      onChange={(e) => updateMcpConfig({ description: e.target.value })}
                      rows={3}
                    />
                  </div>

                  <NumberSetting
                    id="port"
                    label="Porta"
                    value={mcpConfig.port}
                    min={1}
                    max={65535}
                    disabled={serverStatus.running}
                    hint={serverStatus.running
                      ? 'Pare o servidor para alterar a porta.'
                      : `O servidor aceita conexões apenas deste computador (${MCP_HOST}).`}
                    onCommit={(port) => updateMcpConfig({ port })}
                    draft={mcpPortDraft}
                    onDraftChange={setMcpPortDraft}
                  />
                </div>

                {/* Security Settings */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Segurança e acesso</h3>

                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="enable-auth">Ativar autenticação</Label>
                      <div className="text-sm text-muted-foreground">Exigir chave de API para acessar</div>
                    </div>
                    <Switch
                      id="enable-auth"
                      checked={mcpConfig.enableAuth}
                      onCheckedChange={(checked) => updateMcpConfig({ enableAuth: checked })}
                    />
                  </div>

                  {!mcpConfig.enableAuth && (
                    <Alert>
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription>
                        Sem autenticação, qualquer programa deste computador pode ler os prompts expostos.
                      </AlertDescription>
                    </Alert>
                  )}

                  {mcpConfig.enableAuth && (
                    <div className="space-y-2">
                      <Label htmlFor="api-key">Chave de API</Label>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <Input
                            id="api-key"
                            type={showApiKey ? "text" : "password"}
                            value={mcpConfig.apiKey}
                            onChange={(e) => updateMcpConfig({ apiKey: e.target.value })}
                            className="pr-20"
                            placeholder="Digite ou gere uma chave de API"
                            autoComplete="off"
                            spellCheck={false}
                          />
                          <div className="absolute right-1 top-1/2 transform -translate-y-1/2 flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              type="button"
                              onClick={() => setShowApiKey(!showApiKey)}
                              className="h-7 w-7 p-0"
                              title={showApiKey ? "Ocultar chave de API" : "Mostrar chave de API"}
                              aria-label={showApiKey ? "Ocultar chave de API" : "Mostrar chave de API"}
                            >
                              {showApiKey ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </Button>
                            {mcpConfig.apiKey && (
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={handleCopyApiKey}
                                className="h-7 w-7 p-0"
                                title="Copiar chave de API"
                                aria-label="Copiar chave de API"
                              >
                                {apiKeyCopied ? (
                                  <CheckCircle className="h-3.5 w-3.5 text-green-600" />
                                ) : (
                                  <Copy className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="outline"
                          onClick={handleGenerateApiKey}
                          type="button"
                        >
                          Gerar
                        </Button>
                      </div>
                      {!mcpConfig.apiKey.trim() && (
                        <p className="text-xs text-destructive">
                          Defina uma chave para poder iniciar o servidor com a autenticação ativada.
                        </p>
                      )}
                    </div>
                  )}

                  <NumberSetting
                    id="rate-limit"
                    label="Limite de requisições (por minuto)"
                    value={mcpConfig.rateLimit}
                    min={1}
                    max={1000}
                    onCommit={(rateLimit) => updateMcpConfig({ rateLimit })}
                  />

                  <NumberSetting
                    id="max-connections"
                    label="Máximo de conexões simultâneas"
                    value={mcpConfig.maxConnections}
                    min={1}
                    max={1000}
                    onCommit={(maxConnections) => updateMcpConfig({ maxConnections })}
                  />
                </div>
              </div>

              <Separator />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* CORS Settings */}
                <div className="space-y-4">
                  <h3 className="font-semibold">CORS e rede</h3>

                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="enable-cors">Ativar CORS</Label>
                      <div className="text-sm text-muted-foreground">
                        Permitir que páginas web de outras origens acessem o servidor. Só funciona com a autenticação ativada.
                      </div>
                    </div>
                    <Switch
                      id="enable-cors"
                      checked={mcpConfig.enableCors && mcpConfig.enableAuth}
                      disabled={!mcpConfig.enableAuth}
                      onCheckedChange={(checked) => updateMcpConfig({ enableCors: checked })}
                    />
                  </div>
                </div>

                {/* Logging Settings */}
                <div className="space-y-4">
                  <h3 className="font-semibold">Logs</h3>

                  <div className="flex items-center justify-between gap-4">
                    <div className="space-y-0.5">
                      <Label htmlFor="enable-logging">Ativar logs</Label>
                      <div className="text-sm text-muted-foreground">Registrar a atividade do servidor (erros são sempre registrados)</div>
                    </div>
                    <Switch
                      id="enable-logging"
                      checked={mcpConfig.enableLogging}
                      onCheckedChange={(checked) => updateMcpConfig({ enableLogging: checked })}
                    />
                  </div>

                  {mcpConfig.enableLogging && (
                    <div className="space-y-2">
                      <Label htmlFor="log-level">Nível de log</Label>
                      <Select
                        value={mcpConfig.logLevel}
                        onValueChange={(value) => updateMcpConfig({ logLevel: value as typeof mcpConfig.logLevel })}
                      >
                        <SelectTrigger id="log-level">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="debug">Depuração</SelectItem>
                          <SelectItem value="info">Informação</SelectItem>
                          <SelectItem value="warn">Aviso</SelectItem>
                          <SelectItem value="error">Erro</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="docs" className="flex-1 mt-4">
          <Card className="h-full">
            <CardHeader className="flex-shrink-0 pb-4">
              <CardTitle>Documentação do servidor MCP</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto p-0">
              <ScrollArea className="h-[calc(100vh-280px)]">
                <div className="space-y-4 p-6 pt-0">
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  O servidor disponibiliza os prompts escolhidos para clientes MCP, como o Claude Code e o Claude Desktop, e também por uma API REST simples. Ele aceita conexões apenas deste computador ({MCP_HOST}).
                </AlertDescription>
              </Alert>

              <div className="space-y-6">
                <div>
                  <h3 className="font-semibold mb-2">Primeiros passos</h3>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    <li>Escolha quais prompts expor na aba "Prompts expostos"</li>
                    <li>Gere uma chave de API na aba "Configuração"</li>
                    <li>Inicie o servidor na aba "Visão geral"</li>
                    <li>Configure seu cliente MCP com o endereço e a chave abaixo</li>
                  </ol>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Endereço MCP</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Transporte Streamable HTTP (MCP 2025-06-18), sem sessão. Os exemplos usam a porta configurada; a chave aparece como <code>SUA_CHAVE_DE_API</code>, mas o botão de copiar já inclui a sua chave.
                  </p>
                  <CodeBlock code={mcpUrl} copyLabel="Copiar endereço MCP" onCopy={(v) => copyText(v, 'Copiado!', 'Endereço MCP copiado.')} />
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Claude Code</h3>
                  <p className="text-sm text-muted-foreground mb-2">Execute no terminal:</p>
                  <CodeBlock
                    code={claudeCodeCommand('SUA_CHAVE_DE_API')}
                    copyValue={claudeCodeCommand(keyForExamples)}
                    copyLabel="Copiar comando do Claude Code"
                    onCopy={(v) => copyText(v, 'Copiado!', 'Comando copiado com a sua chave de API.')}
                  />
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Claude Desktop</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Adicione ao arquivo <code>claude_desktop_config.json</code> (requer Node.js; o <code>mcp-remote</code> faz a ponte até o servidor) e reinicie o Claude Desktop:
                  </p>
                  <CodeBlock
                    code={claudeDesktopConfig('SUA_CHAVE_DE_API')}
                    copyValue={claudeDesktopConfig(keyForExamples)}
                    copyLabel="Copiar configuração do Claude Desktop"
                    onCopy={(v) => copyText(v, 'Copiado!', 'Configuração copiada com a sua chave de API.')}
                  />
                </div>

                <div>
                  <h3 className="font-semibold mb-2">O que o cliente MCP recebe</h3>
                  <ul className="list-disc list-inside space-y-1 text-sm">
                    <li><strong>Prompts</strong>: cada prompt exposto, com as variáveis <code>{'{{...}}'}</code> do conteúdo como argumentos. No Claude Code, aparecem como <code>/mcp__prompt-studio__nome-do-prompt</code>. O nome vem do título; se outro prompt tiver o mesmo título, o nome recebe também o número do prompt (por exemplo, <code>resumo_12</code>).</li>
                    <li><strong>Ferramenta <code>obter_prompt</code></strong>: recebe <code>nome</code> (ou <code>hash</code>) e <code>variaveis</code>, e devolve o texto do prompt preenchido.</li>
                  </ul>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">API REST</h3>
                  <div className="space-y-2">
                    <div className="bg-muted p-3 rounded">
                      <code className="text-sm">GET /health</code>
                      <p className="text-sm text-muted-foreground mt-1">Verifica se o servidor está no ar (sem autenticação). Resposta: <code>{'{"status":"ok"}'}</code></p>
                    </div>
                    <div className="bg-muted p-3 rounded">
                      <code className="text-sm">GET /prompts</code>
                      <p className="text-sm text-muted-foreground mt-1">Lista os prompts expostos, com o hash, as variáveis e o endpoint de cada um</p>
                    </div>
                    <div className="bg-muted p-3 rounded">
                      <code className="text-sm">GET /prompts/:hash</code>
                      <p className="text-sm text-muted-foreground mt-1">Obtém um prompt exposto pelo hash do endpoint (veja a aba "Prompts expostos")</p>
                    </div>
                    <div className="bg-muted p-3 rounded">
                      <code className="text-sm">POST /prompts/:hash/execute</code>
                      <p className="text-sm text-muted-foreground mt-1">
                        Devolve o prompt com as variáveis substituídas. Corpo: <code>{'{"variables": {"nome": "valor"}}'}</code> (máximo de 1 MB)
                      </p>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="font-semibold mb-2">Autenticação</h3>
                  <p className="text-sm text-muted-foreground mb-2">
                    Com a autenticação ativada, envie a chave de API em todas as requisições (exceto <code>/health</code>):
                  </p>
                  <div className="bg-muted p-3 rounded font-mono text-sm">
                    Authorization: Bearer SUA_CHAVE_DE_API
                  </div>
                </div>
              </div>
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
