import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, dialog, shell, screen } from 'electron'
import type { OpenDialogOptions, SaveDialogOptions } from 'electron'
import { join, extname } from 'path'
import { existsSync } from 'fs'
import { initDatabase, factoryReset, closeDatabase } from './database/init'
import McpServer from './mcp-server'
import { getMenuBarWindowBounds } from './window-position'
import {
  getAllPrompts,
  getPrompt,
  createPrompt,
  updatePrompt,
  deletePrompt,
  searchPrompts,
  getPromptsByTag,
  getAllTags,
  renameTag,
  deleteTag,
  getPromptVersions,
  createPromptVersion,
  getSetting,
  setSetting,
  exportPrompts,
  importPrompts,
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  getAllTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  generateFromTemplate,
} from './database/queries'
import type { Database } from 'sqlite3'
import type {
  CreatePromptData,
  UpdatePromptData,
  CreateCategoryData,
  UpdateCategoryData,
  CreateTemplateData,
  UpdateTemplateData,
  ApiTestRequest,
  ApiTestResponse,
  ExportResult,
  ImportResult,
  McpServerStatus,
  McpServerStatusEvent,
  TokenUsage,
} from '../src/types'

// Use pt-BR as the Chromium locale (native context menus, spellchecker, navigator.language,
// form validation messages). Must be set before the app is ready.
app.commandLine.appendSwitch('lang', 'pt-BR')

// ---- "Testes" panel: OpenAI-compatible chat completions request ----

export const API_TEST_TIMEOUT_MS = 60_000
export const API_TEST_MAX_TOKENS = 128_000
const DEFAULT_API_ENDPOINT = 'https://api.openai.com/v1/chat/completions'

// pt-BR message for an HTTP error status of the tested API
export const describeApiStatus = (status: number): string => {
  switch (status) {
    case 400: return 'Requisição recusada pela API (400)'
    case 401: return 'Chave de API inválida (401)'
    case 403: return 'Acesso negado pela API (403)'
    case 404: return 'Endpoint ou modelo não encontrado (404)'
    case 408: return 'Tempo esgotado no servidor da API (408)'
    case 413: return 'Prompt grande demais para a API (413)'
    case 422: return 'Requisição recusada pela API (422)'
    case 429: return 'Limite de requisições atingido (429)'
    default:
      return status >= 500 ? `Erro no servidor da API (${status})` : `A API retornou um erro (${status})`
  }
}

// Error message sent by the API itself (OpenAI: { error: { message } }), shown as a detail
const extractApiErrorDetail = (data: unknown, text: string): string | undefined => {
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    const error = record.error
    if (error && typeof error === 'object' && typeof (error as Record<string, unknown>).message === 'string') {
      return ((error as Record<string, unknown>).message as string).slice(0, 500)
    }
    if (typeof error === 'string') return error.slice(0, 500)
    if (typeof record.message === 'string') return record.message.slice(0, 500)
    return undefined
  }
  const trimmed = text.trim()
  // An HTML error page says nothing useful
  return trimmed && !trimmed.startsWith('<') ? trimmed.slice(0, 300) : undefined
}

// pt-BR explanation for a network failure (fetch rejects with "fetch failed" + an error code in `cause`)
export const describeNetworkError = (error: unknown): string => {
  const cause = error instanceof Error ? (error as Error & { cause?: unknown }).cause : undefined
  const code = String((cause as { code?: unknown } | undefined)?.code ?? (error as { code?: unknown } | undefined)?.code ?? '')
  if (code === 'ECONNREFUSED') return 'A conexão foi recusada. Verifique o endereço e a porta do endpoint.'
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'Endereço não encontrado. Verifique a URL e a sua conexão com a internet.'
  if (code === 'ETIMEDOUT' || code === 'UND_ERR_CONNECT_TIMEOUT') return 'A conexão demorou demais para ser estabelecida.'
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET' || code === 'EPIPE') return 'A conexão foi encerrada pelo servidor.'
  if (code.includes('CERT') || code.includes('SSL') || code.includes('TLS')) return 'Falha na verificação do certificado HTTPS do servidor.'
  const message = cause instanceof Error ? cause.message : error instanceof Error ? error.message : ''
  // fetch refuses some ports on purpose (1, 25, 6000...), as browsers do
  if (message === 'bad port') return 'Esta porta é bloqueada por segurança. Use outra porta no endpoint.'
  return message || 'Erro de rede desconhecido.'
}

const sanitizeUsage = (usage: unknown): TokenUsage | undefined => {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const pick = (key: string) => (typeof record[key] === 'number' ? (record[key] as number) : undefined)
  const result = {
    prompt_tokens: pick('prompt_tokens'),
    completion_tokens: pick('completion_tokens'),
    total_tokens: pick('total_tokens'),
  }
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}

const responseText = (content: unknown): string => {
  if (typeof content === 'string') return content
  // Some compatible APIs return content parts: [{ type: 'text', text: '...' }]
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  return ''
}

// Runs one test against an OpenAI-compatible chat completions endpoint. Never throws: every failure
// becomes { success: false, error, errorDetail? } with a pt-BR message.
export async function executeApiTest(
  request: ApiTestRequest,
  signal?: AbortSignal,
  timeoutMs: number = API_TEST_TIMEOUT_MS
): Promise<ApiTestResponse> {
  const fail = (error: string, errorDetail?: string): ApiTestResponse =>
    errorDetail ? { success: false, error, errorDetail } : { success: false, error }

  const prompt = request?.prompt
  const config = request?.config
  if (typeof prompt !== 'string' || !prompt.trim()) return fail('Digite um prompt para testar')
  if (!config || typeof config.apiKey !== 'string' || !config.apiKey.trim()) return fail('Informe a chave de API')
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  if (!model) return fail('Informe o modelo')

  const endpointText = (typeof config.apiEndpoint === 'string' && config.apiEndpoint.trim()) || DEFAULT_API_ENDPOINT
  let endpoint: URL
  try {
    endpoint = new URL(endpointText.trim())
  } catch {
    return fail('URL do endpoint inválida', 'Use um endereço completo, como https://api.openai.com/v1/chat/completions')
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    return fail('URL do endpoint inválida', 'O endereço deve começar com http:// ou https://')
  }

  const temperature = config.temperature ?? 0.7
  if (typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    return fail('Temperatura inválida', 'Use um valor entre 0 e 2')
  }
  const maxTokens = config.maxTokens
  if (maxTokens !== undefined && maxTokens !== null &&
      (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > API_TEST_MAX_TOKENS)) {
    return fail('Máximo de tokens inválido', 'Use um número inteiro entre 1 e 128.000, ou deixe o campo vazio')
  }

  const body = {
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature,
    ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  const onAbort = () => controller.abort()
  if (signal?.aborted) controller.abort()
  else signal?.addEventListener('abort', onAbort, { once: true })

  const describeFailure = (error: unknown): ApiTestResponse => {
    if (controller.signal.aborted) {
      return timedOut
        ? fail('Tempo esgotado', `A API não respondeu em ${Math.round(timeoutMs / 1000)} segundos.`)
        : { success: false, canceled: true, error: 'Teste cancelado' }
    }
    return fail(`Não foi possível conectar a ${endpoint.host}`, describeNetworkError(error))
  }

  const startTime = Date.now()
  try {
    let response: Response
    let text: string
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${config.apiKey.trim()}`
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      // The time includes reading the whole body (a slow body used to be reported as a fast answer)
      text = await response.text()
    } catch (error) {
      return describeFailure(error)
    }
    const responseTime = Date.now() - startTime

    let data: unknown = null
    try {
      data = text.trim() ? JSON.parse(text) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      const detail = extractApiErrorDetail(data, text)
      return { success: false, error: describeApiStatus(response.status), ...(detail ? { errorDetail: detail } : {}), responseTime }
    }

    const record = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    if (!record) {
      return { success: false, error: 'Resposta em formato inesperado', errorDetail: 'A API não retornou um JSON válido.', responseTime }
    }
    const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown> | undefined) : undefined
    if (!choice || typeof choice !== 'object') {
      return {
        success: false,
        error: 'Resposta em formato inesperado',
        errorDetail: 'A resposta não tem o campo "choices". Confirme que o endpoint é compatível com a API de chat da OpenAI.',
        responseTime,
      }
    }
    const message = choice.message && typeof choice.message === 'object' ? (choice.message as Record<string, unknown>) : {}
    const usage = sanitizeUsage(record.usage)
    return {
      success: true,
      response: responseText(message.content),
      ...(usage ? { usage } : {}),
      ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
      responseTime,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

class PromptStudioApp {
  private mainWindow: BrowserWindow | null = null
  private menuBarWindow: BrowserWindow | null = null
  private tray: Tray | null = null
  private db: Database | null = null
  private mcpServer: McpServer | null = null
  private currentMode: 'desktop' | 'menubar' = 'desktop'
  private readonly isDev: boolean = process.env.IS_DEV === 'true'
  private readonly enableDevTools: boolean = process.env.ENABLE_DEV_TOOLS === 'true'
  private isQuitting: boolean = false
  private quitCleanupStarted: boolean = false
  private quitCleanupDone: boolean = false
  // When the menu bar popup was last hidden because it lost focus (see toggleMenuBarWindow)
  private menuBarHiddenOnBlurAt: number = 0
  // Running "Testes" requests, per window (webContents id), so they can be canceled
  private apiTests: Map<number, AbortController> = new Map()

  constructor() {
    this.setupEventHandlers()
  }

  private setupEventHandlers(): void {
    app.whenReady().then(() => {
      this.initialize()
    })

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit()
      }
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createMainWindow()
      } else if (this.currentMode === 'desktop' && this.mainWindow) {
        this.revealWindow(this.mainWindow)
      }
    })

    // Electron does not wait for async 'before-quit' listeners: hold the quit once, stop the MCP
    // server and close the database, then quit for real
    app.on('before-quit', (event) => {
      this.isQuitting = true
      if (this.quitCleanupDone) return
      event.preventDefault()
      if (this.quitCleanupStarted) return
      this.quitCleanupStarted = true
      const cleanup = async () => {
        try {
          await this.mcpServer?.stop()
        } catch (error) {
          console.error('Error stopping MCP server:', error)
        }
        try {
          await closeDatabase()
          console.log('Database closed on app quit')
        } catch (error) {
          console.error('Error closing database:', error)
        }
      }
      const safetyTimeout = new Promise<void>((resolve) => setTimeout(resolve, 5000))
      void Promise.race([cleanup(), safetyTimeout]).finally(() => {
        this.quitCleanupDone = true
        app.quit()
      })
    })
  }

  // Shows a window and tells its page, so it can refresh its data (the page is not reloaded)
  private revealWindow(window: BrowserWindow): void {
    if (window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send('app:window-shown')
  }

  private broadcast(channel: string, payload?: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send(channel, payload)
    }
  }

  private getMcpStatus(): McpServerStatus {
    if (this.mcpServer) return this.mcpServer.getStatus()
    return {
      running: false, port: 0, host: '127.0.0.1', exposedPrompts: 0, connections: 0, uptime: 0,
      requests: 0, errors: 0, logs: [], message: 'O servidor MCP não foi inicializado',
    }
  }

  private broadcastMcpStatus(): void {
    const status = this.getMcpStatus()
    const payload: McpServerStatusEvent = {
      running: status.running,
      port: status.running ? status.port : null,
      exposedPrompts: status.exposedPrompts,
    }
    this.broadcast('mcp-server:status-changed', payload)
  }

  private async initialize(): Promise<void> {
    try {
      // Replace Electron's default (English) application menu with the pt-BR equivalent
      this.createApplicationMenu()

      // Initialize database
      this.db = await initDatabase()
      
      // Initialize MCP server with database
      this.mcpServer = new McpServer(this.db as any)
      console.log('MCP Server initialized successfully')

      // Load saved mode
      const savedMode = await getSetting(this.db, 'appMode')
      this.currentMode = (savedMode as 'desktop' | 'menubar') || 'desktop'

      // Setup IPC handlers BEFORE creating windows
      this.setupIpcHandlers()

      // Create windows
      await this.createMainWindow()
      await this.createMenuBarWindow()
      this.createTray()

      // Show appropriate window
      if (this.currentMode === 'desktop' && this.mainWindow) {
        this.mainWindow.show()
        this.mainWindow.focus()
      } else if (this.currentMode === 'menubar') {
        // Started in menu bar mode: open the popup once, so the user sees where the app is.
        // Small delay: the tray icon needs a moment to report its position.
        setTimeout(() => this.showMenuBarWindow(), 300)
      }
    } catch (error) {
      console.error('Failed to initialize app:', error)
      app.quit()
    }
  }

  private async createMainWindow(): Promise<void> {
    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'preload.js'),
      },
      icon: this.getAppIcon(),
      titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    })

    if (this.isDev) {
      await this.mainWindow.loadURL('http://localhost:5173')
      
      // Only open dev tools if explicitly enabled
      if (this.enableDevTools) {
        this.mainWindow.webContents.openDevTools()
      }
    } else {
      await this.mainWindow.loadFile(join(__dirname, '../dist/index.html'))
    }

    this.mainWindow.once('ready-to-show', () => {
      if (this.currentMode === 'desktop' && this.mainWindow) {
        this.mainWindow.show()
        this.mainWindow.focus()
      }
    })

    this.mainWindow.on('close', (event) => {
      if (!this.isQuitting) {
        event.preventDefault()
        if (this.mainWindow) {
          this.mainWindow.hide()
        }
      }
    })

    // Add keyboard shortcut to toggle dev tools
    if (this.isDev) {
      this.mainWindow.webContents.on('before-input-event', (_, input) => {
        if (input.control && input.shift && input.key === 'I') {
          this.mainWindow!.webContents.toggleDevTools()
        }
        if ((input.meta || input.control) && input.key === 'F12') {
          this.mainWindow!.webContents.toggleDevTools()
        }
      })
    }
  }

  private async createMenuBarWindow(): Promise<void> {
    // The window can be resized; the last size the user chose is remembered
    const savedSize = this.db ? await getSetting(this.db, 'menuBarWindowSize') : null
    let width = 400
    let height = 600
    try {
      const parsed = savedSize ? JSON.parse(savedSize) : null
      if (Number.isFinite(parsed?.width) && Number.isFinite(parsed?.height)) {
        ({ width, height } = parsed)
      }
    } catch {
      // A corrupted value falls back to the default size instead of breaking startup
    }

    this.menuBarWindow = new BrowserWindow({
      width,
      height,
      minWidth: 360,
      minHeight: 420,
      show: false,
      frame: false,
      resizable: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: join(__dirname, 'preload.js'),
      },
      skipTaskbar: true,
      alwaysOnTop: true,
    })

    if (this.isDev) {
      await this.menuBarWindow.loadURL('http://localhost:5173/menubar')
    } else {
      await this.menuBarWindow.loadFile(join(__dirname, '../dist/menubar.html'))
    }

    this.menuBarWindow.on('blur', () => {
      if (this.currentMode === 'menubar' && this.menuBarWindow?.isVisible()) {
        this.menuBarHiddenOnBlurAt = Date.now()
        this.menuBarWindow.hide()
      }
    })

    // 'resized' fires once the user finishes dragging an edge
    this.menuBarWindow.on('resized', async () => {
      if (!this.menuBarWindow || !this.db) return
      const [newWidth, newHeight] = this.menuBarWindow.getSize()
      await setSetting(this.db, 'menuBarWindowSize', JSON.stringify({ width: newWidth, height: newHeight }))
    })
  }

  // Same structure as Electron's default application menu, but with explicit pt-BR labels
  // (role-based menus such as 'editMenu' always show fixed English labels on their items)
  private createApplicationMenu(): void {
    const isMac = process.platform === 'darwin'

    const appMenu: Electron.MenuItemConstructorOptions[] = isMac
      ? [
          {
            role: 'appMenu',
            label: 'Prompt Studio',
            submenu: [
              { role: 'about', label: 'Sobre o Prompt Studio' },
              { type: 'separator' },
              { role: 'services', label: 'Serviços' },
              { type: 'separator' },
              { role: 'hide', label: 'Ocultar Prompt Studio' },
              { role: 'hideOthers', label: 'Ocultar outros' },
              { role: 'unhide', label: 'Mostrar tudo' },
              { type: 'separator' },
              { role: 'quit', label: 'Sair do Prompt Studio' },
            ],
          },
        ]
      : []

    const editPlatformItems: Electron.MenuItemConstructorOptions[] = isMac
      ? [
          { role: 'pasteAndMatchStyle', label: 'Colar e manter estilo' },
          { role: 'delete', label: 'Excluir' },
          { role: 'selectAll', label: 'Selecionar tudo' },
          { type: 'separator' },
          {
            label: 'Substituições',
            submenu: [
              { role: 'showSubstitutions', label: 'Mostrar substituições' },
              { type: 'separator' },
              { role: 'toggleSmartQuotes', label: 'Aspas inteligentes' },
              { role: 'toggleSmartDashes', label: 'Travessões inteligentes' },
              { role: 'toggleTextReplacement', label: 'Substituição de texto' },
            ],
          },
          {
            label: 'Fala',
            submenu: [
              { role: 'startSpeaking', label: 'Começar a falar' },
              { role: 'stopSpeaking', label: 'Parar de falar' },
            ],
          },
        ]
      : [
          { role: 'delete', label: 'Excluir' },
          { type: 'separator' },
          { role: 'selectAll', label: 'Selecionar tudo' },
        ]

    const windowPlatformItems: Electron.MenuItemConstructorOptions[] = isMac
      ? [
          { type: 'separator' },
          { role: 'front', label: 'Trazer tudo para a frente' },
        ]
      : [
          { role: 'close', label: 'Fechar' },
        ]

    const helpItems: Electron.MenuItemConstructorOptions[] = app.isPackaged
      ? []
      : [
          {
            label: 'Saiba mais',
            click: async () => {
              await shell.openExternal('https://electronjs.org')
            },
          },
          {
            label: 'Documentação',
            click: async () => {
              const version = process.versions.electron
              await shell.openExternal(`https://github.com/electron/electron/tree/v${version}/docs#readme`)
            },
          },
          {
            label: 'Discussões da comunidade',
            click: async () => {
              await shell.openExternal('https://discord.gg/electronjs')
            },
          },
          {
            label: 'Buscar issues',
            click: async () => {
              await shell.openExternal('https://github.com/electron/electron/issues')
            },
          },
        ]

    const template: Electron.MenuItemConstructorOptions[] = [
      ...appMenu,
      {
        role: 'fileMenu',
        label: 'Arquivo',
        submenu: [
          isMac ? { role: 'close', label: 'Fechar janela' } : { role: 'quit', label: 'Sair' },
        ],
      },
      {
        role: 'editMenu',
        label: 'Editar',
        submenu: [
          { role: 'undo', label: 'Desfazer' },
          { role: 'redo', label: 'Refazer' },
          { type: 'separator' },
          { role: 'cut', label: 'Recortar' },
          { role: 'copy', label: 'Copiar' },
          { role: 'paste', label: 'Colar' },
          ...editPlatformItems,
        ],
      },
      {
        role: 'viewMenu',
        label: 'Exibir',
        submenu: [
          { role: 'reload', label: 'Recarregar' },
          { role: 'forceReload', label: 'Forçar recarregamento' },
          { role: 'toggleDevTools', label: 'Ferramentas do desenvolvedor' },
          { type: 'separator' },
          { role: 'resetZoom', label: 'Tamanho real' },
          { role: 'zoomIn', label: 'Aumentar zoom' },
          { role: 'zoomOut', label: 'Diminuir zoom' },
          { type: 'separator' },
          { role: 'togglefullscreen', label: 'Tela cheia' },
        ],
      },
      {
        role: 'windowMenu',
        label: 'Janela',
        submenu: [
          { role: 'minimize', label: 'Minimizar' },
          { role: 'zoom', label: 'Zoom' },
          ...windowPlatformItems,
        ],
      },
      {
        role: 'help',
        label: 'Ajuda',
        submenu: helpItems,
      },
    ]

    Menu.setApplicationMenu(Menu.buildFromTemplate(template))
  }

  private createTray(): void {
    const icon = this.createTrayIcon()
    this.tray = new Tray(icon)

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar Prompt Studio',
        click: async () => await this.showApp(),
      },
      { type: 'separator' },
      {
        label: 'Modo desktop',
        type: 'radio',
        checked: this.currentMode === 'desktop',
        click: () => this.switchMode('desktop'),
      },
      {
        label: 'Modo barra de menus',
        type: 'radio',
        checked: this.currentMode === 'menubar',
        click: () => this.switchMode('menubar'),
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          this.isQuitting = true
          app.quit()
        },
      },
    ])

    this.tray.setToolTip('Prompt Studio')
    this.tray.setContextMenu(contextMenu)

    this.tray.on('click', async () => {
      if (process.platform !== 'darwin') {
        await this.toggleApp()
      }
    })

    if (process.platform === 'darwin') {
      this.tray.on('right-click', async () => {
        if (this.currentMode === 'menubar') {
          await this.toggleMenuBarWindow()
        }
      })
    }
  }

  private createTrayIcon(): Electron.NativeImage {
    const trayIconPath = join(__dirname, '../assets/tray-icon.png')
    if (existsSync(trayIconPath)) {
      const icon = nativeImage.createFromPath(trayIconPath)
      icon.setTemplateImage(true)
      return icon.resize({ width: 16, height: 16 })
    }

    // Fallback to regular icon
    const iconPath = join(__dirname, '../assets/icon.png')
    if (existsSync(iconPath)) {
      const icon = nativeImage.createFromPath(iconPath)
      icon.setTemplateImage(true)
      return icon.resize({ width: 16, height: 16 })
    }

    // Create a simple fallback icon
    const icon = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAABHNCSVQICAgIfAhkiAAAAAlwSFlzAAAAbwAAAG8B8aLcQwAAABl0RVh0U29mdHdhcmUAd3d3Lmlua3NjYXBlLm9yZ5vuPBoAAAI4SURBVDjLpZPLSyNBEMafJBpfGI0vfIKKD1YR30HFhQVZWFjwgSiIBy+CBx8H8eJBL4IX8eJBD4IXD3oRvHjQi+DFgx4ELx70InjxoAfBiwc9CF48eJEkZjKZt91O05lJJsaD/UF3VVd9X1V3dwvAuHEEeEnNK24HAEhpWjTqsEgUEUlHYgAAAAAAAAD4/nONAAAOFyLSdF3l0AvI7Gii0XDbfU7k9+g7mRn1AHhhNBCJRm+yYdoECUCcvAHxvuwT2g5bMJHsJR0UiSLSSRFJwC'
    )
    icon.setTemplateImage(true)
    return icon
  }

  private getAppIcon(): string {
    const iconPath = join(__dirname, '../assets/icon.png')
    return existsSync(iconPath) ? iconPath : ''
  }

  // "Mostrar Prompt Studio" always shows the app (it never hides it)
  private async showApp(): Promise<void> {
    if (this.currentMode === 'desktop' && this.mainWindow) {
      this.revealWindow(this.mainWindow)
    } else if (this.currentMode === 'menubar') {
      this.showMenuBarWindow()
    }
  }

  private async toggleApp(): Promise<void> {
    if (this.currentMode === 'desktop' && this.mainWindow) {
      if (this.mainWindow.isVisible()) {
        this.mainWindow.hide()
      } else {
        this.revealWindow(this.mainWindow)
      }
    } else {
      await this.toggleMenuBarWindow()
    }
  }

  private async toggleMenuBarWindow(): Promise<void> {
    if (!this.menuBarWindow || !this.tray) return

    if (this.menuBarWindow.isVisible()) {
      this.menuBarWindow.hide()
      return
    }
    // Clicking the tray icon while the popup is open first blurs it (which hides it) and then
    // toggles: without this guard that click would reopen the popup the user wanted to close
    if (Date.now() - this.menuBarHiddenOnBlurAt < 300) return
    this.showMenuBarWindow()
  }

  private showMenuBarWindow(): void {
    if (!this.menuBarWindow || this.menuBarWindow.isDestroyed() || !this.tray) return

    // The page is kept loaded between openings (it refreshes its data on 'app:window-shown'),
    // so the search, scroll position and an open editor survive
    if (!this.menuBarWindow.isVisible()) {
      // Open next to the tray icon and fully inside the screen: on Windows the tray sits in a
      // taskbar at the bottom, so placing the window below the icon put it off-screen
      const trayBounds = this.tray.getBounds()
      const { workArea } = screen.getDisplayMatching(trayBounds)
      const [width, height] = this.menuBarWindow.getSize()
      this.menuBarWindow.setBounds(getMenuBarWindowBounds(trayBounds, workArea, { width: width ?? 400, height: height ?? 600 }), false)
    }
    this.revealWindow(this.menuBarWindow)
  }

  private async switchMode(mode: 'desktop' | 'menubar'): Promise<void> {
    this.currentMode = mode

    if (this.db) {
      await setSetting(this.db, 'appMode', mode)
    }

    if (mode === 'desktop') {
      if (this.menuBarWindow) this.menuBarWindow.hide()
      if (this.mainWindow) {
        // Ensure the main window loads the correct URL for desktop mode
        if (this.isDev) {
          await this.mainWindow.loadURL('http://localhost:5173')
        } else {
          await this.mainWindow.loadFile(join(__dirname, '../dist/index.html'))
        }
        this.mainWindow.show()
        this.mainWindow.focus()
      }
    } else {
      if (this.mainWindow) this.mainWindow.hide()
      // Show the popup once, so the user sees where the app went
      setTimeout(() => this.showMenuBarWindow(), 300)
    }

    this.updateTrayMenu()
  }

  private updateTrayMenu(): void {
    if (!this.tray) return

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Mostrar Prompt Studio',
        click: async () => await this.showApp(),
      },
      { type: 'separator' },
      {
        label: 'Modo desktop',
        type: 'radio',
        checked: this.currentMode === 'desktop',
        click: () => this.switchMode('desktop'),
      },
      {
        label: 'Modo barra de menus',
        type: 'radio',
        checked: this.currentMode === 'menubar',
        click: () => this.switchMode('menubar'),
      },
      { type: 'separator' },
      {
        label: 'Sair',
        click: () => {
          this.isQuitting = true
          app.quit()
        },
      },
    ])

    this.tray.setContextMenu(contextMenu)
  }


  private setupIpcHandlers(): void {
    // System handlers (don't require database)
    ipcMain.handle('copy-to-clipboard', async (_event, text: string) => {
      const { clipboard } = require('electron')
      clipboard.writeText(text)
      return { success: true }
    })

    ipcMain.handle('switch-mode', async (_event, mode: 'desktop' | 'menubar') => {
      await this.switchMode(mode)
    })

    ipcMain.handle('get-current-mode', () => {
      return this.currentMode
    })

    // Factory reset handler
    ipcMain.handle('factory-reset', async () => {
      try {
        // The exposed prompt ids no longer exist after the reset
        if (this.mcpServer?.isRunning()) {
          await this.mcpServer.stop()
          this.broadcastMcpStatus()
        }
        await factoryReset()
        // Reinitialize database to load sample data
        this.db = await initDatabase()
        return { success: true }
      } catch (error) {
        console.error('Factory reset failed:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Erro desconhecido' }
      }
    })

    // Database-dependent handlers
    if (!this.db) return

    // Prompt handlers
    ipcMain.handle('get-all-prompts', async () => {
      return await getAllPrompts(this.db!)
    })

    ipcMain.handle('get-prompt', async (_event, id: number) => {
      return await getPrompt(this.db!, id)
    })

    ipcMain.handle('create-prompt', async (_event, data: CreatePromptData) => {
      return await createPrompt(this.db!, data)
    })

    ipcMain.handle('update-prompt', async (_event, id: number, data: UpdatePromptData) => {
      return await updatePrompt(this.db!, id, data)
    })

    ipcMain.handle('delete-prompt', async (_event, id: number) => {
      return await deletePrompt(this.db!, id)
    })

    ipcMain.handle('search-prompts', async (_event, query: string) => {
      return await searchPrompts(this.db!, query)
    })

    ipcMain.handle('get-prompts-by-tag', async (_event, tag: string) => {
      return await getPromptsByTag(this.db!, tag)
    })

    // Category handlers
    ipcMain.handle('get-all-categories', async () => {
      return await getAllCategories(this.db!)
    })

    ipcMain.handle('create-category', async (_event, data: CreateCategoryData) => {
      return await createCategory(this.db!, data)
    })

    ipcMain.handle('update-category', async (_event, id: number, data: UpdateCategoryData) => {
      return await updateCategory(this.db!, id, data)
    })

    ipcMain.handle('delete-category', async (_event, id: number) => {
      return await deleteCategory(this.db!, id)
    })

    // Template handlers
    ipcMain.handle('get-all-templates', async () => {
      return await getAllTemplates(this.db!)
    })

    ipcMain.handle('create-template', async (_event, data: CreateTemplateData) => {
      return await createTemplate(this.db!, data)
    })

    ipcMain.handle('update-template', async (_event, id: number, data: UpdateTemplateData) => {
      return await updateTemplate(this.db!, id, data)
    })

    ipcMain.handle('delete-template', async (_event, id: number) => {
      return await deleteTemplate(this.db!, id)
    })

    ipcMain.handle('generate-from-template', async (_event, templateId: number, variables: Record<string, string>) => {
      return await generateFromTemplate(this.db!, templateId, variables)
    })

    // Tag handlers
    ipcMain.handle('get-all-tags', async () => {
      return await getAllTags(this.db!)
    })

    ipcMain.handle('rename-tag', async (_event, oldName: string, newName: string) => {
      return await renameTag(this.db!, oldName, newName)
    })

    ipcMain.handle('delete-tag', async (_event, name: string) => {
      return await deleteTag(this.db!, name)
    })

    // Version handlers
    ipcMain.handle('get-prompt-versions', async (_event, promptId: number) => {
      return await getPromptVersions(this.db!, promptId)
    })

    ipcMain.handle('create-prompt-version', async (_event, promptId: number, content: string) => {
      return await createPromptVersion(this.db!, promptId, content)
    })

    // Settings handlers
    ipcMain.handle('get-setting', async (_event, key: string) => {
      return await getSetting(this.db!, key)
    })

    ipcMain.handle('set-setting', async (_event, key: string, value: string) => {
      return await setSetting(this.db!, key, value)
    })

    // Import/Export handlers (never throw: the UI shows `error` / `canceled`)
    ipcMain.handle('export-prompts', async (event, format: unknown): Promise<ExportResult> => {
      if (format !== 'json' && format !== 'txt') {
        return { success: false, error: 'Formato de exportação inválido. Use JSON ou TXT.' }
      }
      try {
        const owner = BrowserWindow.fromWebContents(event.sender)
        const options: SaveDialogOptions = {
          title: 'Exportar prompts',
          defaultPath: `prompt-studio-${new Date().toISOString().slice(0, 10)}.${format}`,
          filters: format === 'json'
            ? [{ name: 'Arquivos JSON', extensions: ['json'] }]
            : [{ name: 'Arquivos de texto', extensions: ['txt'] }],
          properties: ['createDirectory', 'showOverwriteConfirmation'],
        }
        const { canceled, filePath } = owner
          ? await dialog.showSaveDialog(owner, options)
          : await dialog.showSaveDialog(options)
        if (canceled || !filePath) return { success: false, canceled: true }

        const target = extname(filePath) ? filePath : `${filePath}.${format}`
        const { count } = await exportPrompts(this.db!, target, format)
        return { success: true, filePath: target, count }
      } catch (error) {
        console.error('Export failed:', error)
        return { success: false, error: error instanceof Error ? error.message : 'Não foi possível exportar os prompts.' }
      }
    })

    ipcMain.handle('import-prompts', async (event): Promise<ImportResult> => {
      try {
        const owner = BrowserWindow.fromWebContents(event.sender)
        const options: OpenDialogOptions = {
          title: 'Importar prompts',
          filters: [
            { name: 'Arquivos compatíveis', extensions: ['json', 'txt'] },
            { name: 'Arquivos JSON', extensions: ['json'] },
            { name: 'Arquivos de texto', extensions: ['txt'] }
          ],
          properties: ['openFile']
        }
        const { canceled, filePaths } = owner
          ? await dialog.showOpenDialog(owner, options)
          : await dialog.showOpenDialog(options)
        const filePath = filePaths?.[0]
        if (canceled || !filePath) {
          return { success: false, canceled: true, imported: 0, skipped: 0, total: 0 }
        }
        return await importPrompts(this.db!, filePath)
      } catch (error) {
        console.error('Import failed:', error)
        return {
          success: false, imported: 0, skipped: 0, total: 0,
          error: error instanceof Error ? error.message : 'Não foi possível importar os prompts.',
        }
      }
    })

    // Testing handlers: one request per window, 60 s timeout, can be canceled
    ipcMain.handle('test-prompt', async (event, request: ApiTestRequest): Promise<ApiTestResponse> => {
      const windowId = event.sender.id
      this.apiTests.get(windowId)?.abort()
      const controller = new AbortController()
      this.apiTests.set(windowId, controller)
      try {
        return await executeApiTest(request, controller.signal)
      } finally {
        if (this.apiTests.get(windowId) === controller) this.apiTests.delete(windowId)
      }
    })

    ipcMain.handle('test-prompt:cancel', (event) => {
      const controller = this.apiTests.get(event.sender.id)
      if (!controller) return { success: false }
      controller.abort()
      return { success: true }
    })

    // MCP Server handlers. Every change is broadcast to all windows ('mcp-server:status-changed').
    ipcMain.handle('mcp-server:start', async (_event, config: unknown, exposedPrompts: unknown) => {
      if (!this.mcpServer) {
        console.error('MCP server not initialized')
        return { success: false, message: 'O servidor MCP não foi inicializado' }
      }

      this.mcpServer.updateConfig(config)
      this.mcpServer.updateExposedPrompts(exposedPrompts)

      const result = await this.mcpServer.start()
      console.log('MCP Server start result:', result)
      this.broadcastMcpStatus()
      return result
    })

    ipcMain.handle('mcp-server:stop', async () => {
      if (!this.mcpServer) {
        return { success: false, message: 'O servidor MCP não foi inicializado' }
      }

      const result = await this.mcpServer.stop()
      this.broadcastMcpStatus()
      return result
    })

    ipcMain.handle('mcp-server:status', async (): Promise<McpServerStatus> => {
      return this.getMcpStatus()
    })

    ipcMain.handle('mcp-server:update-config', async (_event, config: unknown) => {
      if (!this.mcpServer) {
        return { success: false, message: 'O servidor MCP não foi inicializado' }
      }

      this.mcpServer.updateConfig(config)
      return { success: true }
    })

    ipcMain.handle('mcp-server:update-exposed-prompts', async (_event, exposedPrompts: unknown) => {
      if (!this.mcpServer) {
        return { success: false, message: 'O servidor MCP não foi inicializado' }
      }

      const count = this.mcpServer.updateExposedPrompts(exposedPrompts)
      this.broadcastMcpStatus()
      return { success: true, exposedPrompts: count }
    })

    ipcMain.handle('mcp-server:clear-logs', async () => {
      if (!this.mcpServer) {
        return { success: false, message: 'O servidor MCP não foi inicializado' }
      }
      
      this.mcpServer.clearLogs()
      return { success: true }
    })
  }
}

// Initialize the application
new PromptStudioApp()