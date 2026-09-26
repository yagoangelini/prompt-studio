import {
  Download,
  FileText,
  FlaskConical,
  Keyboard,
  PanelTop,
  Palette,
  Play,
  Plus,
  Server,
  Settings,
  Sparkles,
  Square,
  Upload,
  type LucideIcon
} from 'lucide-react'
import type { Theme } from '@/contexts/theme-context'
import { normalizeSearchText } from '@/lib/search-parser'
import { usePromptStore, getMcpPortError, type MainTab, type SettingsTab } from '@/stores/usePromptStore'
import type { SearchEntry } from './palette-search'

export interface PaletteAction {
  readonly id: string
  readonly label: string
  readonly icon: LucideIcon
  readonly entry: SearchEntry
  // Shortcut shown next to the action (display only)
  readonly shortcut?: string
  // Listed only once something is typed (e.g. the 12 themes)
  readonly onlyWhenSearching?: boolean
  // Marks the current choice (e.g. the theme in use)
  readonly current?: boolean
  // Instead of running something, replaces the palette query (e.g. "Trocar tema" lists the themes)
  readonly nextQuery?: string
  readonly run?: () => void | Promise<void>
}

export interface PaletteActionContext {
  readonly theme: Theme
  readonly setTheme: (theme: Theme) => void
  // null when the status is unknown
  readonly mcpRunning: boolean | null
  readonly openShortcutsHelp: () => void
  readonly modKey: string
}

// Same order and names as Ctrl+T (App.tsx)
export const PALETTE_THEMES: readonly { readonly theme: Theme; readonly name: string }[] = [
  { theme: 'system', name: 'Sistema' },
  { theme: 'light', name: 'Claro' },
  { theme: 'dark', name: 'Escuro' },
  { theme: 'matte', name: 'Preto fosco' },
  { theme: 'midnight', name: 'Meia-noite' },
  { theme: 'ocean', name: 'Oceano' },
  { theme: 'forest', name: 'Floresta' },
  { theme: 'cosmic', name: 'Roxo cósmico' },
  { theme: 'sunset', name: 'Pôr do sol' },
  { theme: 'arctic', name: 'Ártico' },
  { theme: 'rose', name: 'Rosa' },
  { theme: 'macos', name: 'macOS' }
]

const store = () => usePromptStore.getState()

const toast: ReturnType<typeof store>['addToast'] = (message) => store().addToast(message)

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count.toLocaleString('pt-BR')} ${count === 1 ? singular : pluralForm}`

const goToTab = (tab: MainTab) => {
  store().closeSettings()
  store().setActiveMainTab(tab)
}

// Same messages as Configurações > Dados
async function exportPrompts(format: 'json' | 'txt') {
  try {
    const result = await window.electronAPI.exportPrompts(format)
    if (result.canceled) {
      toast({ type: 'info', title: 'Exportação cancelada', description: 'Nenhum arquivo foi salvo.' })
    } else if (result.success) {
      const count = plural(result.count ?? 0, 'prompt exportado', 'prompts exportados')
      toast({
        type: 'success',
        title: 'Prompts exportados',
        description: result.filePath ? `${count} para ${result.filePath}.` : `${count}.`
      })
    } else {
      toast({ type: 'error', title: 'Não foi possível exportar os prompts', description: result.error || 'Ocorreu um erro inesperado.' })
    }
  } catch (error) {
    toast({
      type: 'error',
      title: 'Não foi possível exportar os prompts',
      description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
    })
  }
}

async function importPrompts() {
  try {
    const result = await window.electronAPI.importPrompts()
    if (result.canceled) {
      toast({ type: 'info', title: 'Importação cancelada', description: 'Nenhum arquivo foi importado.' })
      return
    }
    if (!result.success) {
      toast({
        type: 'error',
        title: 'Não foi possível importar os prompts',
        description: result.error || result.errors?.[0] || 'Ocorreu um erro inesperado.'
      })
      return
    }
    if (result.imported === 0 && result.duplicates === result.total) {
      toast({
        type: 'info',
        title: 'Nenhum prompt novo',
        description: result.total === 1
          ? 'O prompt do arquivo já está na sua biblioteca.'
          : `Os ${result.total} prompts do arquivo já estão na sua biblioteca.`
      })
      return
    }
    if (result.imported > 0) await store().fetchAllData()
    const summary = [
      plural(result.imported, 'prompt importado', 'prompts importados'),
      result.skipped > 0 ? plural(result.skipped, 'ignorado', 'ignorados') : '',
      result.categoriesCreated ? plural(result.categoriesCreated, 'categoria criada', 'categorias criadas') : '',
      result.templatesImported ? plural(result.templatesImported, 'template importado', 'templates importados') : ''
    ].filter(Boolean).join(', ')
    const reasons = result.errors && result.errors.length > 0 ? ` ${result.errors.slice(0, 2).join(' ')}` : ''
    toast({
      type: result.imported > 0 ? 'success' : 'warning',
      title: result.imported > 0 ? 'Prompts importados' : 'Nenhum prompt importado',
      description: `${summary}.${reasons}`,
      duration: reasons ? 10000 : undefined
    })
  } catch (error) {
    toast({
      type: 'error',
      title: 'Não foi possível importar os prompts',
      description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
    })
  }
}

// Same checks as the Servidor MCP tab
async function startMcpServer() {
  store().migrateLegacyEndpoints()
  const { prompts, exposedPrompts, mcpConfig } = store()
  const existing = new Set(prompts.map((prompt) => prompt.id))
  const exposures = exposedPrompts.filter((e) => e.exposed && Boolean(e.secureHash) && existing.has(e.id))
  if (exposures.length === 0) {
    toast({
      type: 'error',
      title: 'Não foi possível iniciar o servidor',
      description: 'Primeiro, exponha pelo menos um prompt na aba Servidor MCP.'
    })
    return
  }
  // Includes an invalid value still in the port field (never start on the last valid port)
  const invalidPort = getMcpPortError(store())
  if (invalidPort) {
    toast({ type: 'error', title: 'Porta inválida', description: invalidPort })
    return
  }
  if (mcpConfig.enableAuth && !mcpConfig.apiKey.trim()) {
    toast({
      type: 'error',
      title: 'Defina uma chave de API',
      description: 'A autenticação está ativada. Gere ou digite uma chave de API na aba Servidor MCP > Configuração.'
    })
    return
  }
  try {
    const result = await window.electronAPI.startMcpServer(mcpConfig, [...exposures])
    if (!result.success) throw new Error(result.message || 'Não foi possível iniciar o servidor')
    toast({
      type: 'success',
      title: 'Servidor MCP iniciado',
      description: `Servidor em execução na porta ${result.port ?? mcpConfig.port}`
    })
  } catch (error) {
    console.error('Failed to start MCP server:', error)
    toast({
      type: 'error',
      title: 'Não foi possível iniciar o servidor',
      description: error instanceof Error ? error.message : 'Erro desconhecido'
    })
  }
}

async function stopMcpServer() {
  try {
    const result = await window.electronAPI.stopMcpServer()
    if (!result.success) throw new Error(result.message || 'Não foi possível parar o servidor')
    toast({ type: 'info', title: 'Servidor MCP parado', description: 'O servidor foi encerrado.' })
  } catch (error) {
    console.error('Failed to stop MCP server:', error)
    toast({
      type: 'error',
      title: 'Não foi possível parar o servidor',
      description: error instanceof Error ? error.message : 'Erro desconhecido'
    })
  }
}

async function switchToMenuBar() {
  try {
    await window.electronAPI.switchMode('menubar')
  } catch (error) {
    console.error('Failed to switch to menu bar mode:', error)
    toast({ type: 'error', title: 'Erro', description: 'Não foi possível mudar para o modo barra de menus' })
  }
}

const SETTINGS_TAB_NAMES: readonly { readonly tab: SettingsTab; readonly name: string; readonly keywords: string }[] = [
  { tab: 'categories', name: 'Categorias', keywords: 'cores organizar pastas' },
  { tab: 'tags', name: 'Tags', keywords: 'etiquetas renomear' },
  { tab: 'general', name: 'Geral', keywords: 'atalho colar rapido preferencias' },
  { tab: 'data', name: 'Dados', keywords: 'backup exportar importar restaurar fabrica claude code comandos' }
]

interface ActionSpec extends Omit<PaletteAction, 'entry'> {
  readonly keywords?: string
}

const toAction = ({ keywords, ...spec }: ActionSpec): PaletteAction => ({
  ...spec,
  entry: { primary: normalizeSearchText(spec.label), secondary: normalizeSearchText(keywords ?? '') }
})

// Actions of the palette, in the order they are listed before anything is typed
export function buildPaletteActions(context: PaletteActionContext): PaletteAction[] {
  const { theme, setTheme, mcpRunning, openShortcutsHelp, modKey } = context
  const specs: ActionSpec[] = [
    {
      id: 'new-prompt',
      label: 'Novo prompt',
      icon: Plus,
      shortcut: `${modKey}+N`,
      keywords: 'criar adicionar',
      run: async () => {
        if (await store().openPromptEditor()) store().setActiveMainTab('prompts')
      }
    },
    {
      id: 'new-template',
      label: 'Novo template',
      icon: Sparkles,
      keywords: 'criar adicionar variaveis',
      run: async () => {
        if (await store().openTemplateEditor()) store().setActiveMainTab('templates')
      }
    },
    { id: 'go-prompts', label: 'Ir para Prompts', icon: FileText, keywords: 'aba lista biblioteca', run: () => goToTab('prompts') },
    { id: 'go-templates', label: 'Ir para Templates', icon: Sparkles, keywords: 'aba', run: () => goToTab('templates') },
    { id: 'go-testing', label: 'Ir para Testes', icon: FlaskConical, keywords: 'aba testar api modelo ia', run: () => goToTab('testing') },
    { id: 'go-mcp', label: 'Ir para Servidor MCP', icon: Server, keywords: 'aba mcp', run: () => goToTab('mcp') },
    mcpRunning
      ? { id: 'mcp-stop', label: 'Parar servidor MCP', icon: Square, keywords: 'mcp desligar encerrar', run: stopMcpServer }
      : { id: 'mcp-start', label: 'Iniciar servidor MCP', icon: Play, keywords: 'mcp ligar executar', run: startMcpServer },
    { id: 'theme-picker', label: 'Trocar tema', icon: Palette, shortcut: `${modKey}+T`, keywords: 'aparencia cores visual escuro claro', nextQuery: 'Tema: ' },
    { id: 'settings', label: 'Abrir configurações', icon: Settings, keywords: 'preferencias opcoes ajustes', run: async () => { await store().openSettings() } },
    ...SETTINGS_TAB_NAMES.map(({ tab, name, keywords }): ActionSpec => ({
      id: `settings-${tab}`,
      label: `Configurações: ${name}`,
      icon: Settings,
      keywords,
      run: async () => {
        await store().openSettings(tab)
      }
    })),
    { id: 'export-json', label: 'Exportar prompts (JSON)', icon: Download, keywords: 'salvar arquivo backup copia', run: () => exportPrompts('json') },
    { id: 'export-txt', label: 'Exportar prompts (TXT)', icon: Download, keywords: 'salvar arquivo texto', run: () => exportPrompts('txt') },
    { id: 'import', label: 'Importar prompts', icon: Upload, keywords: 'abrir arquivo json txt', run: importPrompts },
    { id: 'menubar-mode', label: 'Modo barra de menus', icon: PanelTop, keywords: 'bandeja compacto janela pequena', run: switchToMenuBar },
    { id: 'shortcuts', label: 'Atalhos de teclado', icon: Keyboard, keywords: 'teclas ajuda comandos', run: openShortcutsHelp },
    ...PALETTE_THEMES.map(({ theme: option, name }): ActionSpec => ({
      id: `theme-${option}`,
      label: `Tema: ${name}`,
      icon: Palette,
      keywords: 'trocar aparencia cores visual',
      onlyWhenSearching: true,
      current: option === theme,
      run: () => {
        setTheme(option)
        toast({ type: 'success', title: 'Tema alterado', description: `Tema ${name} aplicado`, duration: 2000 })
      }
    }))
  ]
  return specs.map(toAction)
}
