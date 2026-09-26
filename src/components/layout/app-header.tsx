import { cn } from '@/lib/utils'
import { CSSProperties, useState, useEffect } from 'react'
import { MoreHorizontal, Keyboard, Settings, Play, Square, Wifi, WifiOff, PanelTop } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { KeyboardShortcutsHelp } from '@/components/keyboard-shortcuts-help'
import { usePromptStore, getMcpPortError } from '@/stores/usePromptStore'
import { Badge } from '@/components/ui/badge'

interface AppHeaderProps {
  className?: string
}

// -webkit-app-region is not in React's CSSProperties
type AppRegionStyle = CSSProperties & { WebkitAppRegion?: 'drag' | 'no-drag' }

const NO_DRAG: AppRegionStyle = { WebkitAppRegion: 'no-drag' }

// Exposed prompts the server can actually serve: still exist and have a secure hash
function getValidExposedPrompts() {
  usePromptStore.getState().migrateLegacyEndpoints()
  const { prompts, getExposedPrompts } = usePromptStore.getState()
  const existingIds = new Set(prompts.map((prompt) => prompt.id))
  return getExposedPrompts().filter(
    (exposed) => exposed.exposed && Boolean(exposed.secureHash) && existingIds.has(exposed.id)
  )
}

export function AppHeader({ className }: AppHeaderProps) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [mcpServerStatus, setMcpServerStatus] = useState({ running: false, port: 0 })
  const [isLoading, setIsLoading] = useState(false)
  const openSettings = usePromptStore((state) => state.openSettings)
  const addToast = usePromptStore((state) => state.addToast)
  const isMac = typeof navigator !== 'undefined' && navigator.platform.includes('Mac')

  const headerStyle: AppRegionStyle = {
    WebkitAppRegion: isMac ? 'drag' : 'no-drag',
  }

  // MCP server status: the main process notifies every window on start/stop; the initial query and
  // a slow poll cover the time before the first event and any missed one
  useEffect(() => {
    let active = true
    const checkServerStatus = async () => {
      try {
        const status = await window.electronAPI.getMcpServerStatus()
        if (active) setMcpServerStatus({ running: status.running, port: status.port || 0 })
      } catch (error) {
        console.error('Failed to check MCP server status:', error)
      }
    }

    checkServerStatus()
    const removeStatusListener = window.electronAPI.onMcpServerStatusChanged((status) => {
      setMcpServerStatus({ running: status.running, port: status.port || 0 })
    })
    const interval = setInterval(checkServerStatus, 15000)

    return () => {
      active = false
      removeStatusListener()
      clearInterval(interval)
    }
  }, [])

  const handleStartMcpServer = async () => {
    const exposedPrompts = getValidExposedPrompts()
    if (exposedPrompts.length === 0) {
      addToast({
        type: 'error',
        title: 'Não foi possível iniciar o servidor',
        description: 'Primeiro, exponha pelo menos um prompt na aba Servidor MCP'
      })
      return
    }
    // An invalid value in the port field must not start the server on the last valid port
    const invalidPort = getMcpPortError(usePromptStore.getState())
    if (invalidPort) {
      addToast({ type: 'error', title: 'Porta inválida', description: invalidPort })
      return
    }

    setIsLoading(true)
    try {
      const { mcpConfig } = usePromptStore.getState()
      const result = await window.electronAPI.startMcpServer(mcpConfig, [...exposedPrompts])

      if (result.success) {
        const port = result.port || mcpConfig.port
        setMcpServerStatus({ running: true, port })
        addToast({
          type: 'success',
          title: 'Servidor MCP iniciado',
          description: `Servidor em execução na porta ${port}`
        })
      } else {
        throw new Error(result.message || 'Não foi possível iniciar o servidor')
      }
    } catch (error) {
      console.error('Failed to start MCP server:', error)
      addToast({
        type: 'error',
        title: 'Falha ao iniciar o servidor',
        description: error instanceof Error ? error.message : 'Não foi possível iniciar o servidor MCP'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleStopMcpServer = async () => {
    setIsLoading(true)
    try {
      const result = await window.electronAPI.stopMcpServer()

      if (result.success) {
        setMcpServerStatus({ running: false, port: 0 })
        addToast({
          type: 'info',
          title: 'Servidor MCP parado',
          description: 'O servidor foi encerrado com sucesso'
        })
      } else {
        throw new Error(result.message || 'Não foi possível parar o servidor')
      }
    } catch (error) {
      console.error('Failed to stop MCP server:', error)
      addToast({
        type: 'error',
        title: 'Falha ao parar o servidor',
        description: error instanceof Error ? error.message : 'Não foi possível parar o servidor MCP'
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleSwitchToMenuBar = async () => {
    try {
      await window.electronAPI.switchMode('menubar')
    } catch (error) {
      console.error('Failed to switch to menu bar mode:', error)
      addToast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível mudar para o modo barra de menus'
      })
    }
  }

  const mcpStatusLabel = mcpServerStatus.running ? `MCP :${mcpServerStatus.port}` : 'MCP parado'

  return (
    <div
      className={cn(
        "flex items-center bg-background border-b relative h-12",
        className
      )}
      style={headerStyle}
    >
      {/* Left spacing for macOS window controls */}
      <div className={cn("flex-shrink-0", isMac ? "w-20" : "w-4")} />

      {/* Centered title */}
      <div className="flex-1 flex items-center justify-center">
        <h1 className="text-lg font-semibold text-foreground select-none">
          Prompt Studio
        </h1>
      </div>

      {/* MCP Server Controls */}
      <div className="flex-shrink-0 flex items-center mr-4" style={NO_DRAG}>
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-md px-2 py-1" role="group" aria-label="Servidor MCP">
          {/* Status indicator */}
          {mcpServerStatus.running ? (
            <Wifi className="h-3 w-3 text-green-500 animate-pulse" aria-hidden="true" />
          ) : (
            <WifiOff className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          )}
          <Badge
            variant={mcpServerStatus.running ? "default" : "secondary"}
            className={cn(
              "text-xs h-4 px-1 ml-1",
              // green-700 keeps the white text readable (WCAG AA) in every theme
              mcpServerStatus.running && "bg-green-700 text-white hover:bg-green-700"
            )}
            title={mcpServerStatus.running ? `Servidor MCP em execução na porta ${mcpServerStatus.port}` : 'Servidor MCP parado'}
          >
            {mcpStatusLabel}
          </Badge>

          {/* Start/Stop button */}
          {!mcpServerStatus.running ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStartMcpServer}
              disabled={isLoading}
              className="h-6 w-6 p-0 ml-1 hover:bg-muted"
              title="Iniciar servidor MCP"
              aria-label="Iniciar servidor MCP"
            >
              <Play className="h-3 w-3" aria-hidden="true" />
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleStopMcpServer}
              disabled={isLoading}
              className="h-6 w-6 p-0 ml-1 hover:bg-muted"
              title="Parar servidor MCP"
              aria-label="Parar servidor MCP"
            >
              <Square className="h-3 w-3" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>

      {/* Right side menu */}
      <div className="flex-shrink-0 flex items-center pr-4" style={NO_DRAG}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Mais opções"
              aria-label="Mais opções"
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => setShortcutsOpen(true)}>
              <Keyboard className="h-4 w-4 mr-2" aria-hidden="true" />
              Atalhos de teclado
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => { void openSettings() }}>
              <Settings className="h-4 w-4 mr-2" aria-hidden="true" />
              Configurações
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => { void handleSwitchToMenuBar() }}>
              <PanelTop className="h-4 w-4 mr-2" aria-hidden="true" />
              Modo barra de menus
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <KeyboardShortcutsHelp
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
  )
}
