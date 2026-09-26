// Database entity types with strict typing
export interface Category {
  readonly id: number
  name: string
  description: string | null
  color: string
  // Subcategory: id of the parent category (null = top level)
  parent_id: number | null
  // Sequence category: its prompts are ordered steps (see Prompt.sort_order)
  is_sequence: boolean
  readonly created_at: string
  readonly updated_at: string
}

export interface Template {
  readonly id: number
  name: string
  description: string | null
  content: string
  variables: readonly string[]
  category_id: number | null
  readonly created_at: string
  readonly updated_at: string
  // Joined fields
  category_name?: string
  category_color?: string
}

export interface Prompt {
  readonly id: number
  title: string
  content: string
  description: string | null
  category_id: number | null
  template_id: number | null
  tags: readonly string[]
  is_favorite: boolean
  // Pinned prompts are listed first
  is_pinned: boolean
  // How many times the prompt was copied or pasted, and when it was last used (SQLite UTC)
  usage_count: number
  last_used_at: string | null
  // Position inside a sequence category (null = not ordered yet)
  sort_order: number | null
  readonly created_at: string
  readonly updated_at: string
  // Joined fields
  category_name?: string
  category_color?: string
  template_name?: string
}

export interface PromptVersion {
  readonly id: number
  readonly prompt_id: number
  content: string
  readonly version_number: number
  readonly created_at: string
}

export interface TestResult {
  readonly id: number
  readonly prompt_id: number
  input_prompt: string
  response: string
  model: string | null
  api_endpoint: string | null
  response_time: number | null
  token_usage: TokenUsage | null
  readonly created_at: string
}

export interface TokenUsage {
  readonly prompt_tokens?: number
  readonly completion_tokens?: number
  readonly total_tokens?: number
}

// Form types for creating/updating entities
export interface CreateCategoryData {
  name: string
  description?: string | undefined
  color?: string | undefined
  parent_id?: number | null | undefined
  is_sequence?: boolean | undefined
}

export interface UpdateCategoryData {
  name?: string | undefined
  description?: string | undefined
  color?: string | undefined
  parent_id?: number | null | undefined
  is_sequence?: boolean | undefined
}

export interface CreateTemplateData {
  name: string
  description?: string | undefined
  content: string
  variables: readonly string[]
  category_id?: number | null | undefined
}

export interface UpdateTemplateData {
  name?: string | undefined
  description?: string | undefined
  content?: string | undefined
  variables?: readonly string[] | undefined
  category_id?: number | null | undefined
}

export interface CreatePromptData {
  title: string
  content: string
  description?: string | null | undefined
  category_id?: number | null | undefined
  template_id?: number | null | undefined
  tags?: readonly string[] | undefined
  is_favorite?: boolean | undefined
}

// undefined = keep the current value; null = clear it (description, category_id, template_id)
export interface UpdatePromptData {
  title?: string | undefined
  content?: string | undefined
  description?: string | null | undefined
  category_id?: number | null | undefined
  template_id?: number | null | undefined
  tags?: readonly string[] | undefined
  is_favorite?: boolean | undefined
  is_pinned?: boolean | undefined
}

// API types for testing prompts
// 'openai' = OpenAI-compatible chat completions; 'anthropic' = Anthropic Messages API (Claude)
export type ApiProvider = 'openai' | 'anthropic'

export interface ApiTestConfig {
  // Omitted = 'openai' (older saved configs)
  readonly provider?: ApiProvider
  readonly apiKey: string
  readonly model: string
  readonly apiEndpoint?: string
  readonly temperature?: number
  // Omitted (undefined) = the API default; otherwise an integer from 1 to 128000
  readonly maxTokens?: number | undefined
}

export interface ApiTestRequest {
  readonly prompt: string
  readonly config: ApiTestConfig
}

export interface ApiTestResponse {
  readonly success: boolean
  readonly response?: string
  readonly usage?: TokenUsage
  // Short pt-BR message (e.g. "Chave de API inválida (401)") plus optional details from the API
  readonly error?: string
  readonly errorDetail?: string
  // True when the user canceled the test
  readonly canceled?: boolean
  // finish_reason of the first choice ("stop", "length", ...)
  readonly finishReason?: string
  // Milliseconds until the whole response body was read
  readonly responseTime?: number
}

// App state types
export type AppMode = 'desktop' | 'menubar'

export interface AppSettings {
  readonly theme: 'light' | 'dark'
  readonly appMode: AppMode
  readonly apiKey?: string
  readonly defaultModel?: string
  readonly defaultEndpoint?: string
}

export interface SearchFilters {
  readonly query: string
  readonly categoryId?: number | null
  readonly tags?: readonly string[]
  readonly isFavorite?: boolean | undefined
}

export interface SortOptions {
  readonly field: 'updated_at' | 'created_at' | 'title' | 'usage_count' | 'last_used_at'
  readonly direction: 'asc' | 'desc'
}

// Import/Export types
// Shape of the JSON file written by "Exportar prompts (JSON)". Categories and templates are referenced
// by name (ids are local to each installation).
export interface ExportData {
  readonly app: 'Prompt Studio'
  readonly version: string
  readonly exported_at: string
  readonly categories: readonly { name: string; description: string | null; color: string }[]
  readonly templates: readonly {
    name: string
    description: string | null
    content: string
    variables: readonly string[]
    category_name: string | null
  }[]
  readonly prompts: readonly {
    title: string
    content: string
    description: string | null
    category_name: string | null
    template_name: string | null
    tags: readonly string[]
    is_favorite: boolean
    created_at: string
    updated_at: string
  }[]
}

export interface ExportResult {
  readonly success: boolean
  // The user closed the save dialog (not an error)
  readonly canceled?: boolean
  readonly filePath?: string
  // Number of exported prompts
  readonly count?: number
  // pt-BR message, only when success is false and not canceled
  readonly error?: string
}

export interface ImportResult {
  readonly success: boolean
  // The user closed the open dialog (not an error)
  readonly canceled?: boolean
  // Prompts created / prompts ignored (invalid or already in the library) / prompts found in the file
  readonly imported: number
  readonly skipped: number
  readonly total: number
  // Prompts ignored because an identical one is already in the library
  readonly duplicates?: number
  // pt-BR reasons for each ignored prompt (capped)
  readonly errors?: readonly string[]
  // pt-BR message when nothing could be imported (invalid, empty or binary file...)
  readonly error?: string
  // Extra items found in a JSON export
  readonly categoriesCreated?: number
  readonly templatesImported?: number
}

export interface TagOperationResult {
  readonly success: boolean
  // Number of prompts changed
  readonly updated: number
}

// MCP server
export type McpLogLevel = 'debug' | 'info' | 'warn' | 'error'

// Settings sent by the renderer when starting/updating the server. The server always listens on
// 127.0.0.1, so a "host" value is ignored.
export interface McpServerSettings {
  port: number
  host?: string
  enableAuth: boolean
  apiKey: string
  maxConnections: number
  rateLimit: number
  enableCors: boolean
  enableLogging: boolean
  logLevel: string
  name?: string
  description?: string
}

export interface McpExposedPromptRef {
  id: number
  exposed: boolean
  secureHash?: string
  endpoint?: string
}

export interface McpServerLogEntry {
  readonly timestamp: string
  readonly level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'
  readonly message: string
  // Error message or extra data, as text
  readonly detail?: string
}

export interface McpServerStatus {
  readonly running: boolean
  // 0 when stopped
  readonly port: number
  readonly host: string
  readonly exposedPrompts: number
  // Open TCP connections
  readonly connections: number
  // Seconds since the server started (computed by the server)
  readonly uptime: number
  readonly requests: number
  // Server errors (HTTP 5xx / internal errors) since the server started
  readonly errors: number
  // Newest first
  readonly logs: readonly McpServerLogEntry[]
  readonly message?: string
}

export interface McpServerStatusEvent {
  readonly running: boolean
  readonly port: number | null
  readonly exposedPrompts: number
}

// UI state types
export interface ModalState {
  readonly isOpen: boolean
  readonly type: 'category' | 'template' | 'prompt' | null
  readonly editingItem?: Category | Template | Prompt | null
}

export interface ToastMessage {
  readonly id: string
  readonly type: 'success' | 'error' | 'warning' | 'info'
  readonly title: string
  readonly description?: string
  readonly duration?: number
}

// Electron IPC types
// ---- Organization (pin, usage, sequences, bulk actions) ----
export interface BulkPromptChanges {
  // Moves every prompt to this category (null = no category)
  readonly category_id?: number | null
  readonly addTags?: readonly string[]
  readonly removeTags?: readonly string[]
  readonly is_favorite?: boolean
  readonly is_pinned?: boolean
}

export interface BulkOperationResult {
  readonly success: boolean
  // Prompts actually changed or deleted
  readonly affected: number
  readonly error?: string
}

// ---- Quick paste (global shortcut that pastes a prompt into the active app) ----
export interface QuickPasteSettings {
  readonly enabled: boolean
  // Electron accelerator, e.g. "CommandOrControl+Shift+Space"
  readonly shortcut: string
  // true = paste into the app that was active; false = only copy to the clipboard
  readonly autoPaste: boolean
}

export interface QuickPasteSettingsResult {
  readonly success: boolean
  readonly settings: QuickPasteSettings
  // pt-BR message, e.g. when the shortcut is already used by another app
  readonly error?: string
}

export interface PasteResult {
  readonly success: boolean
  // false when the text was only copied (autoPaste off, or pasting is not possible)
  readonly pasted: boolean
  readonly error?: string
}

// ---- Claude Code commands export (.claude/commands/*.md in a project folder) ----
export interface ClaudeCommandsExportResult {
  readonly success: boolean
  readonly canceled?: boolean
  // The project folder chosen by the user
  readonly directory?: string
  // Files written, relative to the project folder
  readonly files?: readonly string[]
  readonly error?: string
}

// ---- Automatic backup ----
export interface BackupSettings {
  readonly enabled: boolean
  // Folder where backups are written (null = not chosen yet)
  readonly directory: string | null
  // How many backup files to keep (oldest are removed)
  readonly keep: number
  // SQLite UTC timestamp of the last successful backup
  readonly lastBackupAt: string | null
}

export interface BackupFile {
  readonly fileName: string
  readonly filePath: string
  readonly sizeBytes: number
  // ISO timestamp
  readonly createdAt: string
}

export interface BackupRunResult {
  readonly success: boolean
  readonly filePath?: string
  readonly error?: string
}

export interface BackupRestoreResult {
  readonly success: boolean
  readonly canceled?: boolean
  readonly error?: string
}

// ---- "Testes" panel history ----
// Where a test run was executed: "Testar prompt" (and re-runs) or "Comparar modelos"
export type TestRunSource = 'test' | 'compare'

export interface TestRun {
  readonly id: number
  readonly prompt_id: number | null
  readonly prompt_text: string
  readonly provider: ApiProvider
  readonly model: string
  readonly endpoint: string
  readonly temperature: number | null
  readonly max_tokens: number | null
  readonly response: string | null
  readonly error: string | null
  readonly response_time_ms: number | null
  readonly input_tokens: number | null
  readonly output_tokens: number | null
  readonly source: TestRunSource
  readonly created_at: string
}

export interface ElectronAPI {
  // Prompts
  getAllPrompts(): Promise<readonly Prompt[]>
  getPrompt(id: number): Promise<Prompt | null>
  createPrompt(data: CreatePromptData): Promise<Prompt>
  updatePrompt(id: number, data: UpdatePromptData): Promise<Prompt>
  deletePrompt(id: number): Promise<{ success: boolean }>
  searchPrompts(query: string): Promise<readonly Prompt[]>
  getPromptsByTag(tag: string): Promise<readonly Prompt[]>
  
  // Categories
  getAllCategories(): Promise<readonly Category[]>
  createCategory(data: CreateCategoryData): Promise<Category>
  updateCategory(id: number, data: UpdateCategoryData): Promise<Category>
  deleteCategory(id: number): Promise<{ success: boolean }>
  
  // Templates
  getAllTemplates(): Promise<readonly Template[]>
  createTemplate(data: CreateTemplateData): Promise<Template>
  updateTemplate(id: number, data: UpdateTemplateData): Promise<Template>
  deleteTemplate(id: number): Promise<{ success: boolean }>
  generateFromTemplate(templateId: number, variables: Record<string, string>): Promise<CreatePromptData>
  
  // Tags
  getAllTags(): Promise<readonly string[]>
  // Bulk operations on every prompt that has the tag (exact name). Throw with a pt-BR message on error.
  renameTag(oldName: string, newName: string): Promise<TagOperationResult>
  deleteTag(name: string): Promise<TagOperationResult>

  // Versions
  getPromptVersions(promptId: number): Promise<readonly PromptVersion[]>
  createPromptVersion(promptId: number, content: string): Promise<PromptVersion>
  
  // Settings
  getSetting(key: keyof AppSettings): Promise<string | null>
  setSetting(key: keyof AppSettings, value: string): Promise<{ key: string; value: string }>
  
  // Import/Export (both open a native file dialog; they never throw)
  exportPrompts(format: 'json' | 'txt'): Promise<ExportResult>
  importPrompts(): Promise<ImportResult>

  // Testing (60 s timeout; cancelTestPrompt aborts the test running in this window)
  testPrompt(request: ApiTestRequest): Promise<ApiTestResponse>
  cancelTestPrompt(): Promise<{ success: boolean }>

  // System
  copyToClipboard(text: string): Promise<{ success: boolean }>
  switchMode(mode: 'desktop' | 'menubar'): Promise<void>
  getCurrentMode(): Promise<'desktop' | 'menubar'>
  factoryReset(): Promise<{ success: boolean; error?: string }>
  
  // MCP Server (start/stop/update broadcast 'mcp-server:status-changed' to every window)
  startMcpServer(config: McpServerSettings, exposedPrompts: readonly McpExposedPromptRef[]): Promise<{ success: boolean; message: string; port?: number }>
  stopMcpServer(): Promise<{ success: boolean; message: string }>
  getMcpServerStatus(): Promise<McpServerStatus>
  updateMcpServerConfig(config: Partial<McpServerSettings>): Promise<{ success: boolean; message?: string }>
  updateMcpServerExposedPrompts(exposedPrompts: readonly McpExposedPromptRef[]): Promise<{ success: boolean; message?: string; exposedPrompts?: number }>
  clearMcpServerLogs(): Promise<{ success: boolean; message?: string }>

  // Organization. Every call throws a pt-BR message on error.
  setPromptPinned(id: number, pinned: boolean): Promise<Prompt>
  // Called whenever a prompt is copied or pasted: increments usage_count and sets last_used_at
  recordPromptUsage(id: number): Promise<Prompt>
  // Saves the order of the prompts of a sequence category (ids in the new order)
  reorderPrompts(categoryId: number, orderedIds: readonly number[]): Promise<{ success: boolean }>
  bulkUpdatePrompts(ids: readonly number[], changes: BulkPromptChanges): Promise<BulkOperationResult>
  bulkDeletePrompts(ids: readonly number[]): Promise<BulkOperationResult>

  // Quick paste
  getQuickPasteSettings(): Promise<QuickPasteSettings>
  setQuickPasteSettings(settings: QuickPasteSettings): Promise<QuickPasteSettingsResult>
  // From the quick paste window: puts the text on the clipboard, hides the window and pastes into the
  // app that was active (when autoPaste is on). promptId, when given, is counted as a usage.
  pasteText(text: string, promptId?: number): Promise<PasteResult>
  hideQuickPaste(): Promise<void>

  // Claude Code commands export: asks for the project folder, writes .claude/commands/*.md
  exportClaudeCommands(promptIds: readonly number[]): Promise<ClaudeCommandsExportResult>

  // Automatic backup
  getBackupSettings(): Promise<BackupSettings>
  setBackupSettings(settings: Omit<BackupSettings, 'lastBackupAt'>): Promise<BackupSettings>
  chooseBackupDirectory(): Promise<{ canceled: boolean; directory?: string }>
  runBackupNow(): Promise<BackupRunResult>
  listBackups(): Promise<readonly BackupFile[]>
  // Replaces the current database with a backup (the UI confirms first) and restarts the app
  restoreBackup(filePath: string): Promise<BackupRestoreResult>

  // "Testes" history. testPrompt saves each run automatically.
  listTestRuns(options?: { limit?: number; promptId?: number }): Promise<readonly TestRun[]>
  deleteTestRun(id: number): Promise<{ success: boolean }>
  clearTestRuns(): Promise<{ success: boolean; deleted: number }>

  // Generic IPC invoke method
  invoke(channel: string, ...args: any[]): Promise<any>
  
  // Events
  onOpenPreferences(callback: () => void): void
  // Broadcast by the main process to every window whenever the MCP server starts, stops or changes
  // its exposed prompts. Returns a function that removes the listener.
  onMcpServerStatusChanged(callback: (status: McpServerStatusEvent) => void): () => void
  // Sent to a window each time it is shown (the menu bar popup is hidden and shown instead of reloaded).
  // Returns a function that removes the listener.
  onWindowShown(callback: () => void): () => void
  // Sent to every window after data changed outside it (e.g. quick paste recorded a usage, another
  // window edited prompts). Windows reload their data. Returns a function that removes the listener.
  onDataChanged(callback: () => void): () => void
  removeAllListeners(channel: string): void
}

// Global window interface extension
declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}

// Utility types for better type safety
export type NonEmptyArray<T> = readonly [T, ...T[]]

export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>

export type PartialExcept<T, K extends keyof T> = Partial<T> & Pick<T, K>