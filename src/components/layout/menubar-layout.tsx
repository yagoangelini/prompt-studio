import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, X, Heart, Filter, Palette, Wifi, WifiOff, Play, Square, AppWindow } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { MenubarPromptCard } from '../prompts/prompt-card-menubar'
import { PromptEditor } from '../prompts/prompt-editor'
import { usePromptStore } from '@/stores/usePromptStore'
import { useTheme, type Theme } from '@/contexts/theme-context'
import { cn } from '@/lib/utils'
import AppIcon from '/assets/icon.png'

// localStorage keys where the store persists the MCP settings (shared by both windows)
const MCP_CONFIG_KEY = 'promptStudio_mcpConfig'
const MCP_EXPOSED_PROMPTS_KEY = 'promptStudio_mcpExposedPrompts'

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

const allThemes: { value: Theme; label: string; emoji: string }[] = [
  { value: 'system', label: 'Sistema', emoji: '🖥️' },
  { value: 'light', label: 'Claro', emoji: '☀️' },
  { value: 'dark', label: 'Escuro', emoji: '🌙' },
  { value: 'matte', label: 'Preto fosco', emoji: '⚫' },
  { value: 'midnight', label: 'Meia-noite', emoji: '🌌' },
  { value: 'ocean', label: 'Oceano', emoji: '🌊' },
  { value: 'forest', label: 'Floresta', emoji: '🌲' },
  { value: 'cosmic', label: 'Roxo cósmico', emoji: '🔮' },
  { value: 'sunset', label: 'Pôr do sol', emoji: '🌅' },
  { value: 'arctic', label: 'Ártico', emoji: '❄️' },
  { value: 'rose', label: 'Rosa', emoji: '🌹' },
  { value: 'macos', label: 'macOS', emoji: '🍎' },
]

// Exposed prompts the server can actually serve: still exist and have a secure hash
function getValidExposedPrompts() {
  usePromptStore.getState().migrateLegacyEndpoints()
  const { prompts, getExposedPrompts } = usePromptStore.getState()
  const existingIds = new Set(prompts.map((prompt) => prompt.id))
  return getExposedPrompts().filter(
    (exposed) => exposed.exposed && Boolean(exposed.secureHash) && existingIds.has(exposed.id)
  )
}

// The store reads the MCP settings from localStorage only when the page loads, and this popup is no
// longer reloaded: pick up the changes made in the desktop window (MCP panel)
function syncMcpSettingsFromStorage() {
  try {
    const config = localStorage.getItem(MCP_CONFIG_KEY)
    const exposed = localStorage.getItem(MCP_EXPOSED_PROMPTS_KEY)
    const parsedExposed = exposed ? JSON.parse(exposed) : []
    usePromptStore.setState({
      ...(config ? { mcpConfig: JSON.parse(config) } : {}),
      exposedPrompts: Array.isArray(parsedExposed) ? parsedExposed : [],
    })
  } catch (error) {
    console.error('Failed to read MCP settings from storage:', error)
  }
}

export function MenuBarLayout() {
  const [searchQuery, setSearchQuery] = useState('')
  // Local filter: the store derives its filters from the search query only
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [mcpServerStatus, setMcpServerStatus] = useState({ running: false, port: 0 })
  const [isLoading, setIsLoading] = useState(false)

  const { theme, setTheme } = useTheme()

  const {
    prompts,
    setSearchFilters,
    getFilteredPrompts,
    openPromptEditor,
    closePromptEditor,
    isPromptEditorOpen,
    fetchAllData,
    addToast
  } = usePromptStore()

  const filteredPrompts = favoritesOnly
    ? getFilteredPrompts().filter((prompt) => prompt.is_favorite)
    : getFilteredPrompts()

  const handleSearch = (query: string) => {
    setSearchQuery(query)
    setSearchFilters({ query })
  }

  const toggleFavoriteFilter = () => {
    setFavoritesOnly((current) => !current)
  }

  const clearFilters = () => {
    setFavoritesOnly(false)
    handleSearch('')
  }

  const hasActiveFilters = Boolean(searchQuery.trim()) || favoritesOnly

  const handleCreatePrompt = () => {
    void openPromptEditor()
  }

  const currentThemeLabel = allThemes.find((t) => t.value === theme)?.label ?? theme

  const handleEditPrompt = (promptId: number) => {
    const prompt = prompts.find(p => p.id === promptId)
    if (prompt) {
      void openPromptEditor(prompt)
    }
  }

  const handleCloseEditor = () => {
    closePromptEditor()
  }

  const handleOpenDesktop = async () => {
    try {
      await window.electronAPI.switchMode('desktop')
    } catch (error) {
      console.error('Failed to switch to desktop mode:', error)
      addToast({
        type: 'error',
        title: 'Erro',
        description: 'Não foi possível mudar para o modo desktop'
      })
    }
  }

  const refreshMcpStatus = useCallback(async () => {
    try {
      const status = await window.electronAPI.getMcpServerStatus()
      setMcpServerStatus({ running: status.running, port: status.port || 0 })
    } catch (error) {
      console.error('Failed to check MCP server status:', error)
    }
  }, [])

  // MCP server status: the main process notifies every window on start/stop; the initial query and
  // a slow poll cover the time before the first event and any missed one
  useEffect(() => {
    refreshMcpStatus()
    const removeStatusListener = window.electronAPI.onMcpServerStatusChanged((status) => {
      setMcpServerStatus({ running: status.running, port: status.port || 0 })
    })
    const interval = setInterval(refreshMcpStatus, 15000)
    return () => {
      removeStatusListener()
      clearInterval(interval)
    }
  }, [refreshMcpStatus])

  // The popup is hidden and shown again instead of reloaded: refresh the data each time it is shown,
  // keeping the search, the scroll position and an open editor
  useEffect(() => {
    return window.electronAPI.onWindowShown(() => {
      syncMcpSettingsFromStorage()
      void fetchAllData()
      void refreshMcpStatus()
    })
  }, [fetchAllData, refreshMcpStatus])

  // MCP settings changed in the desktop window while this popup is loaded
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === MCP_CONFIG_KEY || event.key === MCP_EXPOSED_PROMPTS_KEY) {
        syncMcpSettingsFromStorage()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => window.removeEventListener('storage', handleStorage)
  }, [])

  const handleStartMcpServer = async () => {
    const validExposedPrompts = getValidExposedPrompts()
    if (validExposedPrompts.length === 0) {
      addToast({
        type: 'error',
        title: 'Não foi possível iniciar o servidor',
        description: 'Primeiro, exponha pelo menos um prompt na aba Servidor MCP (modo desktop)'
      })
      return
    }

    setIsLoading(true)
    try {
      const { mcpConfig } = usePromptStore.getState()
      const result = await window.electronAPI.startMcpServer(mcpConfig, [...validExposedPrompts])

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

  if (isPromptEditorOpen) {
    return (
      <div className="h-screen bg-background overflow-hidden">
        <PromptEditor compact onClose={handleCloseEditor} />
      </div>
    )
  }

  return (
    <div className="h-screen bg-background overflow-hidden flex flex-col">
      {/* Header */}
      <div className="p-3 border-b space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={AppIcon}
              alt=""
              className="h-5 w-5 object-contain rounded"
            />
            <h1 className="text-sm font-semibold truncate">Prompt Studio</h1>
          </div>

          {/* MCP Server Controls - Grouped */}
          <div className="flex items-center gap-0.5 bg-muted/50 rounded-md px-1.5 py-0.5" role="group" aria-label="Servidor MCP">
            {mcpServerStatus.running ? (
              <Wifi className="h-3 w-3 text-green-500 animate-pulse" aria-hidden="true" />
            ) : (
              <WifiOff className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
            )}
            <Badge
              variant={mcpServerStatus.running ? "default" : "secondary"}
              className={cn(
                "text-xs h-4 px-1 ml-0.5 whitespace-nowrap",
                // green-700 keeps the white text readable (WCAG AA) in every theme
                mcpServerStatus.running && "bg-green-700 text-white hover:bg-green-700"
              )}
              title={mcpServerStatus.running ? `Servidor MCP em execução na porta ${mcpServerStatus.port}` : 'Servidor MCP parado'}
            >
              {mcpServerStatus.running ? `MCP :${mcpServerStatus.port}` : 'MCP parado'}
            </Badge>

            {!mcpServerStatus.running ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleStartMcpServer}
                disabled={isLoading}
                className="h-6 w-6 p-0 ml-0.5 hover:bg-muted"
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
                className="h-6 w-6 p-0 ml-0.5 hover:bg-muted"
                title="Parar servidor MCP"
                aria-label="Parar servidor MCP"
              >
                <Square className="h-3 w-3" aria-hidden="true" />
              </Button>
            )}
          </div>

          <div className="flex items-center space-x-1 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCreatePrompt}
              className="h-7 w-7 p-0"
              title="Novo prompt"
              aria-label="Novo prompt"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  title={`Tema: ${currentThemeLabel} (clique para ver mais)`}
                  aria-label={`Alterar tema (atual: ${currentThemeLabel})`}
                >
                  <Palette className="h-4 w-4" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" collisionPadding={8} className="w-44 max-h-80 overflow-y-auto">
                <div className="px-2 py-1 text-xs font-semibold text-muted-foreground">
                  Temas
                </div>
                {allThemes.map((t) => (
                  <DropdownMenuItem
                    key={t.value}
                    onClick={() => setTheme(t.value)}
                    className={cn(
                      "flex items-center gap-2 text-xs",
                      theme === t.value && "bg-accent"
                    )}
                  >
                    <span className="text-sm" aria-hidden="true">{t.emoji}</span>
                    <span className="flex-1">{t.label}</span>
                    {theme === t.value && (
                      <>
                        <span className="sr-only">(tema atual)</span>
                        <div className="h-1.5 w-1.5 rounded-full bg-primary flex-shrink-0" aria-hidden="true" />
                      </>
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Search and Filter Controls */}
        <div className="space-y-2">
          {/* Search Bar with Quick Actions */}
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                placeholder="Buscar prompts..."
                aria-label="Buscar prompts"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="pl-9 pr-9 h-8 text-sm"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleSearch('')}
                  className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                  title="Limpar busca"
                  aria-label="Limpar busca"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              )}
            </div>

            {/* Favorite Filter Toggle */}
            <Button
              variant={favoritesOnly ? "secondary" : "ghost"}
              size="sm"
              onClick={toggleFavoriteFilter}
              className={cn(
                "h-8 w-8 p-0",
                favoritesOnly && "text-red-500"
              )}
              title={favoritesOnly ? 'Mostrar todos os prompts' : 'Mostrar só os favoritos'}
              aria-label="Mostrar só os favoritos"
              aria-pressed={favoritesOnly}
            >
              <Heart className={cn(
                "h-4 w-4",
                favoritesOnly && "fill-current"
              )} aria-hidden="true" />
            </Button>

            {/* Clear All Filters */}
            {hasActiveFilters && (
              <Button
                variant="outline"
                size="sm"
                onClick={clearFilters}
                className="h-8 px-2"
              >
                <Filter className="h-3 w-3 mr-1" aria-hidden="true" />
                <span className="text-xs">Limpar</span>
              </Button>
            )}
          </div>

          {/* Active Filter Chips */}
          {favoritesOnly && (
            <div className="flex flex-wrap gap-1">
              <Badge
                variant="secondary"
                className="text-xs h-6 pl-1 pr-0.5 gap-1"
              >
                <Heart className="h-3 w-3 fill-current text-red-500" aria-hidden="true" />
                <span>Favoritos</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={toggleFavoriteFilter}
                  className="h-5 w-5 p-0 hover:bg-transparent ml-0.5"
                  title="Remover filtro de favoritos"
                  aria-label="Remover filtro de favoritos"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              </Badge>
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-3 space-y-2">
          {/* Results Count */}
          {filteredPrompts.length > 0 && (
            <p className="text-xs text-muted-foreground px-1 mb-2">
              {filteredPrompts.length} prompt{filteredPrompts.length !== 1 ? 's' : ''}
              {hasActiveFilters && (filteredPrompts.length !== 1 ? ' (filtrados)' : ' (filtrado)')}
            </p>
          )}

          {filteredPrompts.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-muted-foreground mb-2">
                {hasActiveFilters
                  ? "Nenhum prompt corresponde aos filtros"
                  : "Nenhum prompt encontrado"
                }
              </p>
              <div className="space-y-2">
                {hasActiveFilters && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={clearFilters}
                    className="w-full"
                  >
                    <Filter className="h-3 w-3 mr-2" aria-hidden="true" />
                    Limpar filtros
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCreatePrompt}
                  className="w-full"
                >
                  <Plus className="h-4 w-4 mr-2" aria-hidden="true" />
                  Criar prompt
                </Button>
              </div>
            </div>
          ) : (
            filteredPrompts.map((prompt) => (
              <MenubarPromptCard
                key={prompt.id}
                prompt={prompt}
                onClick={() => handleEditPrompt(prompt.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => { void handleOpenDesktop() }}
          className="w-full h-8 text-xs"
          title={`Abrir no modo desktop (${isMac ? '⌘O' : 'Ctrl+O'})`}
        >
          <AppWindow className="h-4 w-4 mr-2" aria-hidden="true" />
          Abrir no modo desktop
        </Button>
      </div>
    </div>
  )
}
