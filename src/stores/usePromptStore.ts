import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import {
  parseSearchQuery,
  formatSearchQuery,
  getFreeTextTerms,
  normalizeSearchText,
  type SearchQuery
} from '@/lib/search-parser'
import { generateSecureHash } from '@/lib/secure-hash'
import { parseDbDate } from '@/lib/utils'
import { confirmAction } from '@/components/ui/confirm-dialog'
import {
  compareSequenceSteps,
  getSequenceSteps,
  rangeBetween,
  withDescendants
} from '@/components/organization/organization-utils'
import type {
  Prompt,
  Category,
  Template,
  CreatePromptData,
  UpdatePromptData,
  CreateCategoryData,
  UpdateCategoryData,
  CreateTemplateData,
  UpdateTemplateData,
  SearchFilters,
  SortOptions,
  ToastMessage,
  BulkPromptChanges
} from '@/types'

// MCP Types. The server always listens on 127.0.0.1: older versions also kept "host" and
// "allowedOrigins" here, which were never used (see getStoredMcpConfig)
interface McpServerConfig {
  name: string
  description: string
  port: number
  enableAuth: boolean
  apiKey: string
  maxConnections: number
  rateLimit: number
  enableCors: boolean
  enableLogging: boolean
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

interface ExposedPrompt {
  id: number
  exposed: boolean
  endpoint: string
  secureHash: string
}

interface PromptStore {
  // State
  prompts: readonly Prompt[]
  categories: readonly Category[]
  templates: readonly Template[]
  tags: readonly string[]
  loading: boolean
  error: string | null

  // Filters and search. The query is the single source of truth for filtering; categoryId, tags
  // and isFavorite only mirror it (setSearchFilters ignores them).
  searchFilters: SearchFilters
  sortOptions: SortOptions

  // Template filters
  templateSearchQuery: string

  // View modes
  promptViewMode: 'list' | 'grid'
  templateViewMode: 'list' | 'grid'

  // UI state
  selectedPrompt: Prompt | null
  isPromptEditorOpen: boolean
  isPromptViewerOpen: boolean
  isSettingsOpen: boolean
  settingsTab: SettingsTab
  // Main tab of the desktop window, kept in the store so it survives layout remounts
  activeMainTab: MainTab
  // True while the prompt or template editor has unsaved changes
  isEditorDirty: boolean

  // Template editor state
  selectedTemplate: Template | null
  isTemplateEditorOpen: boolean

  // Toast notifications
  toasts: readonly ToastMessage[]

  // Draft persistence
  draftFormData: any

  // Recently interacted prompts (IDs in order of interaction)
  recentlyInteractedIds: number[]

  // MCP Server
  mcpConfig: McpServerConfig
  exposedPrompts: readonly ExposedPrompt[]
  // Text of the MCP port field while it is not a valid port (null when the field shows mcpConfig.port).
  // Not saved. While it is set, the server is not started (see getMcpPortError)
  mcpPortDraft: string | null

  // Selection mode of the prompt list (bulk actions)
  isSelectionMode: boolean
  selectedPromptIds: readonly number[]
  // Last prompt clicked without Shift: start of a Shift+click range
  selectionAnchorId: number | null

  // Sequences: id of the last step copied, per category id (kept in localStorage)
  sequenceProgress: Readonly<Record<string, number>>

  // Categories whose subcategories are hidden in the sidebar (kept in localStorage)
  collapsedCategoryIds: readonly number[]

  // Actions
  // Data fetching
  fetchPrompts: () => Promise<void>
  fetchCategories: () => Promise<void>
  fetchTemplates: () => Promise<void>
  fetchTags: () => Promise<void>
  fetchAllData: () => Promise<void>

  // Prompt operations
  createPrompt: (data: CreatePromptData) => Promise<boolean>
  updatePrompt: (id: number, data: UpdatePromptData) => Promise<boolean>
  deletePrompt: (id: number) => Promise<boolean>
  duplicatePrompt: (id: number) => Promise<boolean>
  selectPrompt: (prompt: Prompt | null) => Promise<boolean>

  // Category operations
  createCategory: (data: CreateCategoryData) => Promise<boolean>
  updateCategory: (id: number, data: UpdateCategoryData) => Promise<boolean>
  deleteCategory: (id: number) => Promise<boolean>

  // Template operations
  createTemplate: (data: CreateTemplateData) => Promise<boolean>
  updateTemplate: (id: number, data: UpdateTemplateData) => Promise<boolean>
  deleteTemplate: (id: number) => Promise<boolean>
  selectTemplate: (template: Template | null) => void

  // Search and filtering
  setSearchFilters: (filters: Partial<SearchFilters>) => void
  // Filter shortcuts (sidebar, menu bar): they rewrite the query and close Settings
  setCategoryFilter: (categoryId: number | null) => void
  toggleTagFilter: (tag: string) => void
  toggleFavoriteFilter: () => void
  clearSearchFilters: () => void
  setSortOptions: (options: Partial<SortOptions>) => void
  getFilteredPrompts: () => readonly Prompt[]
  getRecentlyInteractedPrompts: () => readonly Prompt[]
  searchPrompts: (query: string) => Promise<void>

  // Template search
  setTemplateSearchQuery: (query: string) => void
  getFilteredTemplates: () => readonly Template[]

  // View modes
  setPromptViewMode: (mode: 'list' | 'grid') => void
  setTemplateViewMode: (mode: 'list' | 'grid') => void

  // MCP Server actions
  updateMcpConfig: (config: Partial<McpServerConfig>) => void
  setMcpPortDraft: (draft: string | null) => void
  togglePromptExposure: (promptId: number) => void
  setPromptExposure: (promptId: number, exposed: boolean) => void
  getExposedPrompts: () => readonly ExposedPrompt[]
  migrateLegacyEndpoints: () => void

  // UI actions. The ones that replace an open editor ask before discarding unsaved changes and
  // resolve false when the user keeps editing.
  openPromptEditor: (prompt?: Prompt) => Promise<boolean>
  closePromptEditor: () => void
  openPromptViewer: (prompt: Prompt) => Promise<boolean>
  closePromptViewer: () => void
  openSettings: (tab?: SettingsTab) => Promise<boolean>
  setSettingsTab: (tab: SettingsTab) => void
  setActiveMainTab: (tab: MainTab) => void
  setEditorDirty: (dirty: boolean) => void
  // Resolves true when there are no unsaved changes or the user chose to discard them
  confirmDiscardChanges: () => Promise<boolean>
  closeSettings: () => void

  // Template editor actions
  openTemplateEditor: (template?: Template) => Promise<boolean>
  closeTemplateEditor: () => void

  // Draft persistence
  saveDraftFormData: (formData: any) => void
  clearDraftFormData: () => void
  getDraftFormData: () => any

  // Toast management
  addToast: (toast: Omit<ToastMessage, 'id'>) => void
  removeToast: (id: string) => void
  clearToasts: () => void

  // Factory reset: clears the preferences kept in this browser (localStorage/sessionStorage)
  // and the matching in-memory state
  resetLocalState: () => void

  // Error handling
  setError: (error: string | null) => void
  clearError: () => void

  // Organization: pin, sequences, bulk actions
  setPromptPinned: (id: number, pinned: boolean) => Promise<boolean>
  // Sequence category shown by the current filter (categoria:<a sequence>), or null
  getActiveSequenceCategory: () => Category | null
  // Every prompt of the category, in step order
  getSequenceSteps: (categoryId: number) => readonly Prompt[]
  // Saves a new step order (optimistic: the list changes at once and returns on failure)
  reorderSequence: (categoryId: number, orderedIds: readonly number[]) => Promise<boolean>
  // The step after the last one copied (the first when none was copied); null when all were copied
  getNextSequenceStep: (categoryId: number) => Prompt | null
  markSequenceStepCopied: (prompt: Pick<Prompt, 'id' | 'category_id'>) => void
  resetSequenceProgress: (categoryId: number) => void
  bulkUpdatePrompts: (ids: readonly number[], changes: BulkPromptChanges) => Promise<boolean>
  bulkDeletePrompts: (ids: readonly number[]) => Promise<boolean>
  setPromptsExposure: (ids: readonly number[], exposed: boolean) => Promise<void>

  // Selection mode
  setSelectionMode: (active: boolean) => void
  // Click on a prompt in selection mode. With `range`, selects everything from the anchor to it in `orderedIds`.
  togglePromptSelection: (id: number, options?: { range?: boolean; orderedIds?: readonly number[] }) => void
  setSelectedPromptIds: (ids: readonly number[]) => void
  clearSelection: () => void

  // Sidebar tree
  toggleCategoryCollapsed: (categoryId: number) => void
}

export type MainTab = 'prompts' | 'templates' | 'testing' | 'mcp'
export type SettingsTab = 'categories' | 'tags' | 'general' | 'data'

export const SETTINGS_TABS: readonly SettingsTab[] = ['categories', 'tags', 'general', 'data']

export const isValidMcpPort = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 65535

// Why "Iniciar servidor" must not run, or null. Checked by every start button (MCP panel, header,
// command palette): with an invalid value in the port field the server must not start on the last
// valid port instead.
export const getMcpPortError = (state: Pick<PromptStore, 'mcpConfig' | 'mcpPortDraft'>): string | null =>
  state.mcpPortDraft !== null || !isValidMcpPort(state.mcpConfig.port)
    ? 'A porta do servidor MCP é inválida. Corrija-a na aba Servidor MCP > Configuração com um número inteiro entre 1 e 65535. O servidor não foi iniciado.'
    : null

// Raw SQLite errors ("SQLITE_BUSY: database is locked") become pt-BR messages; the backend's own
// pt-BR messages (e.g. "Já existe uma categoria chamada …") pass through unchanged
export const friendlyErrorMessage = (message: string): string => {
  if (!/^SQLITE_[A-Z]+/.test(message)) return message
  if (/^SQLITE_(BUSY|LOCKED)/.test(message)) return 'O banco de dados está ocupado. Aguarde um instante e tente novamente.'
  if (/^SQLITE_CONSTRAINT/.test(message)) return 'O banco de dados recusou a operação porque ela deixaria os dados inconsistentes.'
  if (/^SQLITE_(FULL|IOERR)/.test(message)) return 'Não foi possível gravar no disco. Verifique o espaço livre e tente novamente.'
  if (/^SQLITE_(READONLY|CANTOPEN|PERM)/.test(message)) return 'Não é possível gravar no banco de dados. Verifique as permissões da pasta de dados.'
  return 'Ocorreu um erro no banco de dados. Tente novamente.'
}

// "Editar" in the details panel opens the editor; closing it (after saving or canceling) returns to the
// panel instead of closing the right side entirely
let editorOpenedFromViewer = false

const generateToastId = (): string => {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}

// Persistence helpers
const STORAGE_KEYS = {
  EDITOR_STATE: 'promptStudio_editorState',
  SELECTED_PROMPT: 'promptStudio_selectedPrompt',
  DRAFT_FORM_DATA: 'promptStudio_draftFormData',
  PROMPT_VIEW_MODE: 'promptStudio_promptViewMode',
  TEMPLATE_VIEW_MODE: 'promptStudio_templateViewMode',
  SORT_OPTIONS: 'promptStudio_sortOptions',
  MCP_CONFIG: 'promptStudio_mcpConfig',
  MCP_EXPOSED_PROMPTS: 'promptStudio_mcpExposedPrompts',
  RECENT_PROMPTS: 'recentlyInteractedPrompts',
  SEQUENCE_PROGRESS: 'promptStudio_sequenceProgress',
  COLLAPSED_CATEGORIES: 'promptStudio_collapsedCategories'
}

type StorageKind = 'local' | 'session'

// The editor state and the draft belong to a single window: the desktop window and the menu bar window
// must not restore each other's editor, so each window has its own keys. They live in localStorage so an
// unsaved draft survives closing the app.
const WINDOW_SCOPE = (() => {
  try {
    return /menubar/.test(window.location.href) ? 'menubar' : 'desktop'
  } catch {
    return 'desktop'
  }
})()
const windowKey = (key: string) => `${key}_${WINDOW_SCOPE}`

const getStorage = (kind: StorageKind): Storage => (kind === 'local' ? localStorage : sessionStorage)

const readStored = <T>(kind: StorageKind, key: string, fallback: T): T => {
  try {
    const stored = getStorage(kind).getItem(key)
    return stored ? (JSON.parse(stored) as T) : fallback
  } catch {
    return fallback
  }
}

const writeStored = (kind: StorageKind, key: string, value: unknown) => {
  try {
    getStorage(kind).setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors
  }
}

const removeStored = (kind: StorageKind, key: string) => {
  try {
    getStorage(kind).removeItem(key)
  } catch {
    // Ignore storage errors
  }
}

// Older versions kept the editor state in localStorage, shared by every window
removeStored('local', STORAGE_KEYS.EDITOR_STATE)
removeStored('local', STORAGE_KEYS.SELECTED_PROMPT)
removeStored('local', STORAGE_KEYS.DRAFT_FORM_DATA)

const getStoredEditorState = (): { isOpen: boolean } =>
  readStored('local', windowKey(STORAGE_KEYS.EDITOR_STATE), { isOpen: false })

const getStoredSelectedPrompt = (): Prompt | null =>
  readStored<Prompt | null>('local', windowKey(STORAGE_KEYS.SELECTED_PROMPT), null)

const persistEditorState = (isOpen: boolean, selectedPrompt: Prompt | null) => {
  writeStored('local', windowKey(STORAGE_KEYS.EDITOR_STATE), { isOpen })
  writeStored('local', windowKey(STORAGE_KEYS.SELECTED_PROMPT), selectedPrompt)
}

const clearPersistedEditorState = () => {
  removeStored('local', windowKey(STORAGE_KEYS.EDITOR_STATE))
  removeStored('local', windowKey(STORAGE_KEYS.SELECTED_PROMPT))
  removeStored('local', windowKey(STORAGE_KEYS.DRAFT_FORM_DATA))
}

const persistDraftFormData = (formData: any) => {
  writeStored('local', windowKey(STORAGE_KEYS.DRAFT_FORM_DATA), formData)
}

const getStoredDraftFormData = () => readStored<any>('local', windowKey(STORAGE_KEYS.DRAFT_FORM_DATA), null)

const getStoredViewMode = (key: string, defaultMode: 'list' | 'grid' = 'list'): 'list' | 'grid' => {
  const stored = readStored<unknown>('local', key, defaultMode)
  return stored === 'list' || stored === 'grid' ? stored : defaultMode
}

const persistViewMode = (key: string, mode: 'list' | 'grid') => {
  writeStored('local', key, mode)
}

const DEFAULT_SORT_OPTIONS: SortOptions = { field: 'updated_at', direction: 'desc' }

const SORT_FIELDS: readonly SortOptions['field'][] = ['updated_at', 'created_at', 'title', 'usage_count', 'last_used_at']

const getStoredSortOptions = (): SortOptions => {
  const stored = readStored<Partial<SortOptions> | null>('local', STORAGE_KEYS.SORT_OPTIONS, null)
  const field = stored?.field
  const direction = stored?.direction
  if (field && SORT_FIELDS.includes(field) && (direction === 'asc' || direction === 'desc')) {
    return { field, direction }
  }
  return DEFAULT_SORT_OPTIONS
}

const getStoredSequenceProgress = (): Record<string, number> => {
  const stored = readStored<unknown>('local', STORAGE_KEYS.SEQUENCE_PROGRESS, {})
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
  return Object.fromEntries(
    Object.entries(stored).filter((entry): entry is [string, number] => typeof entry[1] === 'number')
  )
}

const getStoredCollapsedCategories = (): number[] => {
  const stored = readStored<unknown>('local', STORAGE_KEYS.COLLAPSED_CATEGORIES, [])
  return Array.isArray(stored) ? stored.filter((id): id is number => typeof id === 'number') : []
}

// MCP persistence helpers
const DEFAULT_MCP_CONFIG: McpServerConfig = {
  name: 'Servidor MCP do Prompt Studio',
  description: 'Expõe a biblioteca de prompts como ferramentas e recursos MCP',
  port: 3000,
  enableAuth: true,
  apiKey: '',
  maxConnections: 100,
  rateLimit: 60,
  enableCors: true,
  enableLogging: true,
  logLevel: 'info'
}

const MCP_LOG_LEVELS: readonly string[] = ['debug', 'info', 'warn', 'error']

// Settings saved by any version: known fields only (older versions also saved "host" and
// "allowedOrigins", which are dropped); a missing or malformed field takes the default
const getStoredMcpConfig = (): McpServerConfig => {
  const stored = readStored<unknown>('local', STORAGE_KEYS.MCP_CONFIG, null)
  const raw = stored !== null && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Record<string, unknown>
    : {}
  const text = (key: 'name' | 'description' | 'apiKey') => typeof raw[key] === 'string' ? raw[key] as string : DEFAULT_MCP_CONFIG[key]
  const number = (key: 'port' | 'maxConnections' | 'rateLimit') => typeof raw[key] === 'number' ? raw[key] as number : DEFAULT_MCP_CONFIG[key]
  const flag = (key: 'enableAuth' | 'enableCors' | 'enableLogging') => typeof raw[key] === 'boolean' ? raw[key] as boolean : DEFAULT_MCP_CONFIG[key]
  return {
    name: text('name'),
    description: text('description'),
    port: number('port'),
    enableAuth: flag('enableAuth'),
    apiKey: text('apiKey'),
    maxConnections: number('maxConnections'),
    rateLimit: number('rateLimit'),
    enableCors: flag('enableCors'),
    enableLogging: flag('enableLogging'),
    logLevel: typeof raw.logLevel === 'string' && MCP_LOG_LEVELS.includes(raw.logLevel)
      ? raw.logLevel as McpServerConfig['logLevel']
      : DEFAULT_MCP_CONFIG.logLevel
  }
}

const getStoredExposedPrompts = (): ExposedPrompt[] => {
  const stored = readStored<unknown>('local', STORAGE_KEYS.MCP_EXPOSED_PROMPTS, [])
  return Array.isArray(stored) ? stored : []
}

const persistMcpConfig = (config: McpServerConfig) => {
  writeStored('local', STORAGE_KEYS.MCP_CONFIG, config)
}

const persistExposedPrompts = (exposedPrompts: readonly ExposedPrompt[]) => {
  writeStored('local', STORAGE_KEYS.MCP_EXPOSED_PROMPTS, exposedPrompts)
}

// Track recently interacted prompts
const MAX_RECENT_ITEMS = 10

const getStoredRecentIds = (): number[] => {
  const stored = readStored<unknown>('local', STORAGE_KEYS.RECENT_PROMPTS, [])
  return Array.isArray(stored) ? stored.filter((id): id is number => typeof id === 'number') : []
}

const persistRecentIds = (ids: readonly number[]) => {
  writeStored('local', STORAGE_KEYS.RECENT_PROMPTS, ids)
}

const trackInteraction = (promptId: number, currentIds: readonly number[]): number[] => {
  // Move the ID to the beginning
  const updated = [promptId, ...currentIds.filter(id => id !== promptId)].slice(0, MAX_RECENT_ITEMS)
  persistRecentIds(updated)
  return updated
}

// Names are listed in pt-BR alphabetical order, ignoring case and accents
const nameCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

const sortByName = <T>(items: readonly T[], getName: (item: T) => string): T[] =>
  [...items].sort((a, b) => nameCollator.compare(getName(a), getName(b)))

const MAX_TITLE_LENGTH = 200
const COPY_SUFFIX_REGEX = / \(cópia(?: \d+)?\)$/

// "Título" -> "Título (cópia)", then "Título (cópia 2)", "Título (cópia 3)"... (never an existing title)
const buildCopyTitle = (title: string, existingTitles: readonly string[]): string => {
  const base = title.replace(COPY_SUFFIX_REGEX, '')
  const taken = new Set(existingTitles.map(t => t.trim().toLocaleLowerCase('pt-BR')))
  for (let n = 1; ; n++) {
    const suffix = n === 1 ? ' (cópia)' : ` (cópia ${n})`
    const candidate = `${base.slice(0, MAX_TITLE_LENGTH - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(candidate.toLocaleLowerCase('pt-BR'))) {
      return candidate
    }
  }
}

/**
 * Categories selected by a "categoria:" value: the ones named exactly like the value (ignoring case
 * and accents) or, when there is none, every category whose name contains the value.
 */
export function resolveCategoryIds(value: string, categories: readonly Category[]): Set<number> {
  const wanted = normalizeSearchText(value)
  if (!wanted) return new Set()
  const exact = categories.filter(c => normalizeSearchText(c.name) === wanted)
  const matches = exact.length > 0
    ? exact
    : categories.filter(c => normalizeSearchText(c.name).includes(wanted))
  return new Set(matches.map(c => c.id))
}

/**
 * The sequence category shown by a query: only when "categoria:" selects exactly one category and it is a
 * sequence. Its prompts are then listed in step order.
 */
export function getSequenceCategoryForQuery(query: string, categories: readonly Category[]): Category | null {
  const parsed = parseSearchQuery(query)
  if (!parsed.category) return null
  const ids = [...resolveCategoryIds(parsed.category, categories)]
  if (ids.length !== 1) return null
  const category = categories.find(c => c.id === ids[0])
  return category?.is_sequence ? category : null
}

// Builds the search filters from the query; the other fields only mirror it
const deriveSearchFilters = (query: string, categories: readonly Category[]): SearchFilters => {
  const parsed = parseSearchQuery(query)
  const categoryIds = parsed.category ? [...resolveCategoryIds(parsed.category, categories)] : []
  return {
    query,
    categoryId: categoryIds.length === 1 ? (categoryIds[0] ?? null) : null,
    tags: parsed.tags,
    isFavorite: parsed.isFavorite
  }
}

// Normalized texts of each prompt, cached per object (prompts are replaced, never mutated, on change)
interface SearchableText {
  title: string
  content: string
  all: string
}

const searchableTextCache = new WeakMap<Prompt, SearchableText>()

const getSearchableText = (prompt: Prompt): SearchableText => {
  let text = searchableTextCache.get(prompt)
  if (!text) {
    const title = normalizeSearchText(prompt.title)
    const content = normalizeSearchText(prompt.content)
    const description = normalizeSearchText(prompt.description ?? '')
    text = { title, content, all: `${title}\n${description}\n${content}` }
    searchableTextCache.set(prompt, text)
  }
  return text
}

const toTimestamp = (value: string): number => parseDbDate(value).getTime() || 0

// Sorts by the chosen option, then moves the pinned prompts to the top (both steps keep ties in order)
const sortWithPinnedFirst = (prompts: Prompt[], { field, direction }: SortOptions): Prompt[] => {
  const factor = direction === 'asc' ? 1 : -1
  prompts.sort((a, b) => {
    const result = field === 'title'
      ? nameCollator.compare(a.title, b.title)
      : field === 'usage_count'
        ? (a.usage_count ?? 0) - (b.usage_count ?? 0)
        : toTimestamp(a[field] ?? '') - toTimestamp(b[field] ?? '')
    return result * factor
  })
  return [...prompts.filter(p => p.is_pinned), ...prompts.filter(p => !p.is_pinned)]
}

export const usePromptStore = create<PromptStore>()(
  devtools(
    (set, get) => {
      const setQuery = (query: string, extra: Partial<PromptStore> = {}) => {
        set({ searchFilters: deriveSearchFilters(query, get().categories), ...extra })
      }

      // Rewrites the query through its parsed form (used by the filter shortcuts)
      const updateParsedQuery = (change: (parsed: SearchQuery) => void, extra: Partial<PromptStore> = {}) => {
        const parsed = parseSearchQuery(get().searchFilters.query)
        change(parsed)
        setQuery(formatSearchQuery(parsed), extra)
      }

      const clearDraft = () => {
        set({ draftFormData: null })
        removeStored('local', windowKey(STORAGE_KEYS.DRAFT_FORM_DATA))
      }

      const confirmDiscardChanges = async (): Promise<boolean> => {
        if (!get().isEditorDirty) return true
        const confirmed = await confirmAction({
          title: 'Descartar alterações?',
          description: 'Você tem alterações não salvas. Deseja descartá-las?',
          confirmLabel: 'Descartar',
          destructive: true
        })
        if (!confirmed) return false
        const { isPromptEditorOpen, selectedPrompt } = get()
        // Discarding a new prompt also discards its saved draft
        if (isPromptEditorOpen && !selectedPrompt) {
          clearDraft()
        }
        set({ isEditorDirty: false })
        return true
      }

      // Replaces the MCP exposure list and, if the server is running, sends it the exposed prompts that still exist
      const replaceExposures = async (updated: readonly ExposedPrompt[], notifyServer = true) => {
        set({ exposedPrompts: updated })
        persistExposedPrompts(updated)
        if (!notifyServer) return
        try {
          const status = await window.electronAPI.getMcpServerStatus()
          if (status.running) {
            const promptIds = new Set(get().prompts.map(p => p.id))
            await window.electronAPI.updateMcpServerExposedPrompts(
              updated.filter(p => p.exposed && Boolean(p.secureHash) && promptIds.has(p.id))
            )
          }
        } catch (error) {
          console.error('Failed to update the MCP server exposed prompts:', error)
        }
      }

      // Deleted prompts leave the MCP exposure list (the running server is updated if one of them was exposed)
      const removePromptExposures = async (ids: ReadonlySet<number>) => {
        const { exposedPrompts } = get()
        const removed = exposedPrompts.filter(p => ids.has(p.id))
        if (removed.length === 0) return
        await replaceExposures(exposedPrompts.filter(p => !ids.has(p.id)), removed.some(p => p.exposed))
      }

      const showError =(error: unknown, fallback: string) => {
        if (error instanceof Error && error.message.startsWith('SQLITE_')) console.error(error)
        const errorMessage = error instanceof Error ? friendlyErrorMessage(error.message) : fallback
        set({ error: errorMessage, loading: false })
        get().addToast({
          type: 'error',
          title: 'Erro',
          description: errorMessage
        })
      }

      return {
      // Initial state
      prompts: [],
      categories: [],
      templates: [],
      tags: [],
      loading: false,
      error: null,

      searchFilters: deriveSearchFilters('', []),

      sortOptions: getStoredSortOptions(),

      templateSearchQuery: '',

      promptViewMode: getStoredViewMode(STORAGE_KEYS.PROMPT_VIEW_MODE, 'list'),
      templateViewMode: getStoredViewMode(STORAGE_KEYS.TEMPLATE_VIEW_MODE, 'list'),

      selectedPrompt: getStoredSelectedPrompt(),
      isPromptEditorOpen: getStoredEditorState().isOpen === true,
      isPromptViewerOpen: false,
      isSettingsOpen: false,
      settingsTab: 'categories',
      activeMainTab: 'prompts',
      isEditorDirty: false,

      selectedTemplate: null,
      isTemplateEditorOpen: false,

      toasts: [],
      draftFormData: getStoredDraftFormData(),
      recentlyInteractedIds: getStoredRecentIds(),

      // MCP Server state
      mcpConfig: getStoredMcpConfig(),
      exposedPrompts: getStoredExposedPrompts(),
      mcpPortDraft: null,

      isSelectionMode: false,
      selectedPromptIds: [],
      selectionAnchorId: null,
      sequenceProgress: getStoredSequenceProgress(),
      collapsedCategoryIds: getStoredCollapsedCategories(),

      // Data fetching actions
      fetchPrompts: async () => {
        try {
          set({ loading: true, error: null })
          const prompts = await window.electronAPI.getAllPrompts()
          // The prompt open in the details panel shows the reloaded data too (usage count, pin...). The editor
          // only starts over when another prompt is opened, so what is being typed is kept.
          const { selectedPrompt } = get()
          const reloaded = selectedPrompt ? prompts.find(p => p.id === selectedPrompt.id) : undefined
          set({ prompts, loading: false, ...(reloaded ? { selectedPrompt: reloaded } : {}) })
          // Prompts deleted elsewhere (another window, a direct call) also leave the MCP exposure list
          const existing = new Set(prompts.map(p => p.id))
          const { exposedPrompts } = get()
          if (exposedPrompts.some(p => !existing.has(p.id))) {
            const kept = exposedPrompts.filter(p => existing.has(p.id))
            set({ exposedPrompts: kept })
            persistExposedPrompts(kept)
          }
        } catch (error) {
          showError(error, 'Não foi possível carregar os prompts')
        }
      },

      fetchCategories: async () => {
        try {
          const categories = sortByName(await window.electronAPI.getAllCategories(), c => c.name)
          set({ categories, searchFilters: deriveSearchFilters(get().searchFilters.query, categories) })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Não foi possível carregar as categorias'
          get().addToast({
            type: 'error',
            title: 'Erro',
            description: errorMessage
          })
        }
      },

      fetchTemplates: async () => {
        try {
          const templates = await window.electronAPI.getAllTemplates()
          set({ templates: sortByName(templates, t => t.name) })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Não foi possível carregar os templates'
          get().addToast({
            type: 'error',
            title: 'Erro',
            description: errorMessage
          })
        }
      },

      fetchTags: async () => {
        try {
          const tags = await window.electronAPI.getAllTags()
          set({ tags: sortByName(tags, tag => tag) })
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Não foi possível carregar as tags'
          get().addToast({
            type: 'error',
            title: 'Erro',
            description: errorMessage
          })
        }
      },

      fetchAllData: async () => {
        await Promise.all([
          get().fetchPrompts(),
          get().fetchCategories(),
          get().fetchTemplates(),
          get().fetchTags()
        ])
      },

      // Prompt operations
      createPrompt: async (data: CreatePromptData) => {
        try {
          set({ loading: true, error: null })
          const newPrompt = await window.electronAPI.createPrompt(data)
          const { prompts } = get()
          set({
            prompts: [newPrompt, ...prompts],
            draftFormData: null,
            loading: false
          })
          // Clear editor persistence after successful save
          clearPersistedEditorState()
          await get().fetchTags()
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Prompt criado com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível criar o prompt')
          return false
        }
      },

      updatePrompt: async (id: number, data: UpdatePromptData) => {
        try {
          set({ loading: true, error: null })
          const updatedPrompt = await window.electronAPI.updatePrompt(id, data)
          const { prompts, recentlyInteractedIds, selectedPrompt, isPromptEditorOpen } = get()
          const isSelected = selectedPrompt?.id === id

          set({
            prompts: prompts.map(p => p.id === id ? updatedPrompt : p),
            // Another prompt may be open in the viewer or editor: only replace the updated one
            selectedPrompt: isSelected ? updatedPrompt : selectedPrompt,
            loading: false,
            // Track interaction (edit or favorite)
            recentlyInteractedIds: trackInteraction(id, recentlyInteractedIds)
          })
          // The saved prompt no longer needs to be restored in the editor
          if (isSelected && isPromptEditorOpen) {
            clearPersistedEditorState()
          }
          await get().fetchTags()
          // Toggling the favorite says what happened instead of the generic message
          const onlyFavorite = Object.keys(data).length === 1 && data.is_favorite !== undefined
          get().addToast(onlyFavorite
            ? {
                type: 'success',
                title: data.is_favorite ? 'Adicionado aos favoritos' : 'Removido dos favoritos',
                description: `"${updatedPrompt.title}"`,
                duration: 2500
              }
            : {
                type: 'success',
                title: 'Sucesso',
                description: 'Prompt atualizado com sucesso'
              })
          return true
        } catch (error) {
          showError(error, 'Não foi possível atualizar o prompt')
          return false
        }
      },

      deletePrompt: async (id: number) => {
        try {
          set({ loading: true, error: null })
          await window.electronAPI.deletePrompt(id)
          const { prompts, selectedPrompt, recentlyInteractedIds, isPromptEditorOpen } = get()
          const wasSelected = selectedPrompt?.id === id
          const recentIds = recentlyInteractedIds.filter(recentId => recentId !== id)
          persistRecentIds(recentIds)
          set({
            prompts: prompts.filter(p => p.id !== id),
            recentlyInteractedIds: recentIds,
            loading: false,
            // The viewer or editor showing the deleted prompt is closed
            ...(wasSelected
              ? { selectedPrompt: null, isPromptViewerOpen: false, isPromptEditorOpen: false, isEditorDirty: false }
              : {})
          })
          if (wasSelected && isPromptEditorOpen) {
            clearPersistedEditorState()
          }
          await removePromptExposures(new Set([id]))
          await get().fetchTags()
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Prompt excluído com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível excluir o prompt')
          return false
        }
      },

      duplicatePrompt: async (id: number) => {
        try {
          set({ loading: true, error: null })
          const originalPrompt = get().prompts.find(p => p.id === id)

          if (!originalPrompt) {
            throw new Error('Prompt não encontrado')
          }

          const duplicateData: CreatePromptData = {
            title: buildCopyTitle(originalPrompt.title, get().prompts.map(p => p.title)),
            content: originalPrompt.content,
            description: originalPrompt.description || '',
            category_id: originalPrompt.category_id,
            template_id: originalPrompt.template_id,
            tags: [...originalPrompt.tags], // Copy tags array
            is_favorite: false // Don't duplicate favorite status
          }

          const newPrompt = await window.electronAPI.createPrompt(duplicateData)
          const { prompts, recentlyInteractedIds } = get()
          set({
            prompts: [newPrompt, ...prompts],
            recentlyInteractedIds: trackInteraction(newPrompt.id, recentlyInteractedIds),
            loading: false
          })
          await get().fetchTags()

          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Prompt duplicado com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível duplicar o prompt')
          return false
        }
      },

      selectPrompt: async (prompt: Prompt | null) => {
        const { selectedPrompt, isPromptEditorOpen } = get()
        const switching = isPromptEditorOpen && (selectedPrompt?.id ?? null) !== (prompt?.id ?? null)
        if (switching && !(await confirmDiscardChanges())) return false
        set({ selectedPrompt: prompt })
        return true
      },

      selectTemplate: (template: Template | null) => {
        set({ selectedTemplate: template })
      },

      // Category operations
      createCategory: async (data: CreateCategoryData) => {
        try {
          set({ loading: true, error: null })
          const newCategory = await window.electronAPI.createCategory(data)
          const categories = sortByName([...get().categories, newCategory], c => c.name)
          set({
            categories,
            searchFilters: deriveSearchFilters(get().searchFilters.query, categories),
            loading: false
          })
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Categoria criada com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível criar a categoria')
          return false
        }
      },

      updateCategory: async (id: number, data: UpdateCategoryData) => {
        try {
          set({ loading: true, error: null })
          const updatedCategory = await window.electronAPI.updateCategory(id, data)
          const { categories, prompts, templates, selectedPrompt, selectedTemplate, searchFilters } = get()
          const previous = categories.find(c => c.id === id)
          const updatedCategories = sortByName(categories.map(c => c.id === id ? updatedCategory : c), c => c.name)
          // Prompts and templates show the category name and color: keep them in sync
          const relabel = <T extends Prompt | Template>(item: T): T =>
            item.category_id === id
              ? { ...item, category_name: updatedCategory.name, category_color: updatedCategory.color }
              : item
          // A filter on the old name follows the renamed category
          let query = searchFilters.query
          if (previous && previous.name !== updatedCategory.name) {
            const parsed = parseSearchQuery(query)
            if (parsed.category && normalizeSearchText(parsed.category) === normalizeSearchText(previous.name)) {
              parsed.category = updatedCategory.name
              query = formatSearchQuery(parsed)
            }
          }
          set({
            categories: updatedCategories,
            prompts: prompts.map(relabel),
            templates: templates.map(relabel),
            selectedPrompt: selectedPrompt && relabel(selectedPrompt),
            selectedTemplate: selectedTemplate && relabel(selectedTemplate),
            searchFilters: deriveSearchFilters(query, updatedCategories),
            loading: false
          })
          // A category that became a sequence numbered its prompts in the database
          if (updatedCategory.is_sequence && previous && !previous.is_sequence) {
            await get().fetchPrompts()
          }
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Categoria atualizada com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível atualizar a categoria')
          return false
        }
      },

      deleteCategory: async (id: number) => {
        try {
          set({ loading: true, error: null })
          await window.electronAPI.deleteCategory(id)
          const { categories, prompts, templates, selectedPrompt, selectedTemplate, searchFilters } = get()
          const deletedCategory = categories.find(c => c.id === id)
          // Mirror the database: subcategories move up one level...
          const newParentId = deletedCategory?.parent_id != null && deletedCategory.parent_id !== id
            ? deletedCategory.parent_id
            : null
          const filteredCategories = categories
            .filter(c => c.id !== id)
            .map(c => (c.parent_id === id ? { ...c, parent_id: newParentId } : c))
          // ...and prompts and templates of the deleted category become uncategorized
          const uncategorize = <T extends Prompt | Template>(item: T): T =>
            item.category_id === id
              ? { ...item, category_id: null, category_name: undefined, category_color: undefined, ...('sort_order' in item ? { sort_order: null } : {}) }
              : item
          // A filter on the deleted category is removed from the query
          let query = searchFilters.query
          const parsed = parseSearchQuery(query)
          if (parsed.category && resolveCategoryIds(parsed.category, categories).has(id)) {
            const filteredByName = deletedCategory &&
              normalizeSearchText(parsed.category) === normalizeSearchText(deletedCategory.name)
            if (filteredByName || resolveCategoryIds(parsed.category, filteredCategories).size === 0) {
              parsed.category = ''
              query = formatSearchQuery(parsed)
            }
          }
          set({
            categories: filteredCategories,
            prompts: prompts.map(uncategorize),
            templates: templates.map(uncategorize),
            selectedPrompt: selectedPrompt && uncategorize(selectedPrompt),
            selectedTemplate: selectedTemplate && uncategorize(selectedTemplate),
            searchFilters: deriveSearchFilters(query, filteredCategories),
            loading: false
          })
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Categoria excluída com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível excluir a categoria')
          return false
        }
      },

      // Template operations
      createTemplate: async (data: CreateTemplateData) => {
        try {
          set({ loading: true, error: null })
          const newTemplate = await window.electronAPI.createTemplate(data)
          set({
            templates: sortByName([...get().templates, newTemplate], t => t.name),
            loading: false
          })
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Template criado com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível criar o template')
          return false
        }
      },

      updateTemplate: async (id: number, data: UpdateTemplateData) => {
        try {
          set({ loading: true, error: null })
          const updatedTemplate = await window.electronAPI.updateTemplate(id, data)
          const { templates, prompts, selectedPrompt, selectedTemplate } = get()
          // Prompts show the name of their template: keep it in sync
          const relabel = (prompt: Prompt): Prompt =>
            prompt.template_id === id ? { ...prompt, template_name: updatedTemplate.name } : prompt
          set({
            templates: sortByName(templates.map(t => t.id === id ? updatedTemplate : t), t => t.name),
            prompts: prompts.map(relabel),
            selectedPrompt: selectedPrompt && relabel(selectedPrompt),
            selectedTemplate: selectedTemplate?.id === id ? updatedTemplate : selectedTemplate,
            loading: false
          })
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Template atualizado com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível atualizar o template')
          return false
        }
      },

      deleteTemplate: async (id: number) => {
        try {
          set({ loading: true, error: null })
          await window.electronAPI.deleteTemplate(id)
          const { templates, prompts, selectedPrompt, selectedTemplate } = get()
          // Mirror the database: prompts created from the deleted template lose the link
          const detach = (prompt: Prompt): Prompt =>
            prompt.template_id === id ? { ...prompt, template_id: null, template_name: undefined } : prompt
          set({
            templates: templates.filter(t => t.id !== id),
            prompts: prompts.map(detach),
            selectedPrompt: selectedPrompt && detach(selectedPrompt),
            // The editor of the deleted template is closed
            ...(selectedTemplate?.id === id
              ? { selectedTemplate: null, isTemplateEditorOpen: false, isEditorDirty: false }
              : {}),
            loading: false
          })
          get().addToast({
            type: 'success',
            title: 'Sucesso',
            description: 'Template excluído com sucesso'
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível excluir o template')
          return false
        }
      },

      // Search and filtering
      setSearchFilters: (filters: Partial<SearchFilters>) => {
        // Only the query is taken: categoryId/tags/isFavorite are derived from it
        setQuery(filters.query ?? get().searchFilters.query)
      },

      setCategoryFilter: (categoryId: number | null) => {
        const categoryName = categoryId === null
          ? ''
          : get().categories.find(c => c.id === categoryId)?.name ?? ''
        updateParsedQuery(parsed => { parsed.category = categoryName }, { isSettingsOpen: false })
      },

      toggleTagFilter: (tag: string) => {
        const wanted = normalizeSearchText(tag)
        updateParsedQuery(parsed => {
          const active = parsed.tags.some(t => normalizeSearchText(t) === wanted)
          parsed.tags = active
            ? parsed.tags.filter(t => normalizeSearchText(t) !== wanted)
            : [...parsed.tags, tag]
        }, { isSettingsOpen: false })
      },

      toggleFavoriteFilter: () => {
        updateParsedQuery(parsed => {
          parsed.isFavorite = parsed.isFavorite === true ? undefined : true
        }, { isSettingsOpen: false })
      },

      clearSearchFilters: () => {
        setQuery('')
      },

      setSortOptions: (options: Partial<SortOptions>) => {
        const sortOptions = { ...get().sortOptions, ...options }
        set({ sortOptions })
        writeStored('local', STORAGE_KEYS.SORT_OPTIONS, sortOptions)
      },

      getFilteredPrompts: () => {
        const { prompts, categories, searchFilters, sortOptions } = get()
        const parsedQuery = parseSearchQuery(searchFilters.query)
        let filtered = [...prompts]

        // Free text: every word (or "quoted phrase") must appear in the title, description or content,
        // ignoring case and accents
        const terms = getFreeTextTerms(parsedQuery.generalQuery)
        if (terms.length > 0) {
          filtered = filtered.filter(prompt => {
            const { all } = getSearchableText(prompt)
            return terms.every(term => all.includes(term))
          })
        }

        const titleQuery = normalizeSearchText(parsedQuery.title)
        if (titleQuery) {
          filtered = filtered.filter(prompt => getSearchableText(prompt).title.includes(titleQuery))
        }

        const contentQuery = normalizeSearchText(parsedQuery.content)
        if (contentQuery) {
          filtered = filtered.filter(prompt => getSearchableText(prompt).content.includes(contentQuery))
        }

        // Category: exact name, or every category containing the value (none -> no results). The prompts of
        // their subcategories are included.
        if (parsedQuery.category) {
          const categoryIds = withDescendants(resolveCategoryIds(parsedQuery.category, categories), categories)
          filtered = filtered.filter(prompt => prompt.category_id !== null && categoryIds.has(prompt.category_id))
        }

        // Tags: a prompt matches when it has any of the tags (same name, ignoring case and accents)
        if (parsedQuery.tags.length > 0) {
          const wantedTags = new Set(parsedQuery.tags.map(normalizeSearchText))
          filtered = filtered.filter(prompt =>
            prompt.tags.some(tag => wantedTags.has(normalizeSearchText(tag)))
          )
        }

        if (parsedQuery.isFavorite !== undefined) {
          filtered = filtered.filter(prompt => prompt.is_favorite === parsedQuery.isFavorite)
        }

        // A sequence category lists its steps in order (the sort option does not apply to them); prompts of
        // its subcategories follow. Elsewhere pinned prompts come first, then the chosen order.
        const sequence = getSequenceCategoryForQuery(searchFilters.query, categories)
        if (sequence) {
          const steps = filtered.filter(prompt => prompt.category_id === sequence.id).sort(compareSequenceSteps)
          const others = filtered.filter(prompt => prompt.category_id !== sequence.id)
          return [...steps, ...sortWithPinnedFirst(others, sortOptions)] as readonly Prompt[]
        }

        return sortWithPinnedFirst(filtered, sortOptions) as readonly Prompt[]
      },

      getActiveSequenceCategory: () => {
        const { searchFilters, categories } = get()
        return getSequenceCategoryForQuery(searchFilters.query, categories)
      },

      getSequenceSteps: (categoryId: number) => getSequenceSteps(categoryId, get().prompts),

      reorderSequence: async (categoryId: number, orderedIds: readonly number[]) => {
        const previous = get().prompts
        const position = new Map(orderedIds.map((id, index) => [id, index + 1]))
        const reposition = (prompt: Prompt): Prompt => {
          const sortOrder = prompt.category_id === categoryId ? position.get(prompt.id) : undefined
          return sortOrder !== undefined && sortOrder !== prompt.sort_order ? { ...prompt, sort_order: sortOrder } : prompt
        }
        set({ prompts: previous.map(reposition) })
        try {
          await window.electronAPI.reorderPrompts(categoryId, [...orderedIds])
          const { selectedPrompt } = get()
          if (selectedPrompt) set({ selectedPrompt: reposition(selectedPrompt) })
          return true
        } catch (error) {
          // Back to the order before the move (other changes made meanwhile are kept)
          const before = new Map(previous.map(p => [p.id, p.sort_order]))
          set({
            prompts: get().prompts.map(p => before.has(p.id) && p.category_id === categoryId
              ? { ...p, sort_order: before.get(p.id) ?? null }
              : p)
          })
          showError(error, 'Não foi possível salvar a nova ordem')
          return false
        }
      },

      getNextSequenceStep: (categoryId: number) => {
        const steps = getSequenceSteps(categoryId, get().prompts)
        const lastId = get().sequenceProgress[String(categoryId)]
        const lastIndex = lastId === undefined ? -1 : steps.findIndex(p => p.id === lastId)
        return steps[lastIndex + 1] ?? null
      },

      markSequenceStepCopied: (prompt) => {
        const { categories, sequenceProgress } = get()
        if (prompt.category_id === null) return
        if (!categories.some(c => c.id === prompt.category_id && c.is_sequence)) return
        const updated = { ...sequenceProgress, [String(prompt.category_id)]: prompt.id }
        set({ sequenceProgress: updated })
        writeStored('local', STORAGE_KEYS.SEQUENCE_PROGRESS, updated)
      },

      resetSequenceProgress: (categoryId: number) => {
        const rest = { ...get().sequenceProgress }
        delete rest[String(categoryId)]
        set({ sequenceProgress: rest })
        writeStored('local', STORAGE_KEYS.SEQUENCE_PROGRESS, rest)
      },

      setPromptPinned: async (id: number, pinned: boolean) => {
        try {
          const updated = await window.electronAPI.setPromptPinned(id, pinned)
          const { prompts, selectedPrompt } = get()
          set({
            prompts: prompts.map(p => p.id === id ? updated : p),
            selectedPrompt: selectedPrompt?.id === id ? updated : selectedPrompt
          })
          get().addToast({
            type: 'success',
            title: pinned ? 'Fixado no topo' : 'Desafixado',
            description: `"${updated.title}"`,
            duration: 2500
          })
          return true
        } catch (error) {
          showError(error, pinned ? 'Não foi possível fixar o prompt' : 'Não foi possível desafixar o prompt')
          return false
        }
      },

      bulkUpdatePrompts: async (ids: readonly number[], changes: BulkPromptChanges) => {
        if (ids.length === 0) return false
        try {
          const result = await window.electronAPI.bulkUpdatePrompts([...ids], changes)
          if (!result.success) throw new Error(result.error || 'Não foi possível alterar os prompts')
          // Category names, tags and step positions change together: reload them from the database
          await Promise.all([get().fetchPrompts(), get().fetchTags()])
          const count = result.affected
          get().addToast({
            type: 'success',
            title: count === 0
              ? 'Nenhum prompt precisou ser alterado'
              : `${count} ${count === 1 ? 'prompt alterado' : 'prompts alterados'}`,
            duration: 3000
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível alterar os prompts')
          return false
        }
      },

      bulkDeletePrompts: async (ids: readonly number[]) => {
        if (ids.length === 0) return false
        try {
          const result = await window.electronAPI.bulkDeletePrompts([...ids])
          if (!result.success) throw new Error(result.error || 'Não foi possível excluir os prompts')
          const removed = new Set(ids)
          const { prompts, selectedPrompt, recentlyInteractedIds, isPromptEditorOpen, selectedPromptIds } = get()
          const wasSelected = selectedPrompt !== null && removed.has(selectedPrompt.id)
          const recentIds = recentlyInteractedIds.filter(id => !removed.has(id))
          persistRecentIds(recentIds)
          set({
            prompts: prompts.filter(p => !removed.has(p.id)),
            recentlyInteractedIds: recentIds,
            selectedPromptIds: selectedPromptIds.filter(id => !removed.has(id)),
            ...(wasSelected
              ? { selectedPrompt: null, isPromptViewerOpen: false, isPromptEditorOpen: false, isEditorDirty: false }
              : {})
          })
          if (wasSelected && isPromptEditorOpen) {
            clearPersistedEditorState()
          }
          await removePromptExposures(removed)
          await get().fetchTags()
          const count = result.affected
          get().addToast({
            type: 'success',
            title: `${count} ${count === 1 ? 'prompt excluído' : 'prompts excluídos'}`,
            duration: 3000
          })
          return true
        } catch (error) {
          showError(error, 'Não foi possível excluir os prompts')
          return false
        }
      },

      setPromptsExposure: async (ids: readonly number[], exposed: boolean) => {
        const { exposedPrompts, prompts } = get()
        const wanted = new Set(ids)
        const updated: ExposedPrompt[] = exposedPrompts.map(p => wanted.has(p.id) ? { ...p, exposed } : p)
        if (exposed) {
          for (const id of ids) {
            if (updated.some(p => p.id === id)) continue
            const prompt = prompts.find(p => p.id === id)
            if (!prompt) continue
            const secureHash = generateSecureHash(id, prompt.title || 'untitled')
            updated.push({ id, exposed: true, endpoint: `/prompts/${secureHash}`, secureHash })
          }
        }
        await replaceExposures(updated)
        const count = ids.length
        get().addToast({
          type: 'success',
          title: exposed
            ? `${count} ${count === 1 ? 'prompt exposto' : 'prompts expostos'} no servidor MCP`
            : `${count} ${count === 1 ? 'prompt ocultado' : 'prompts ocultados'} do servidor MCP`,
          duration: 3000
        })
      },

      setSelectionMode: (active: boolean) => {
        set({ isSelectionMode: active, selectedPromptIds: [], selectionAnchorId: null })
      },

      togglePromptSelection: (id, options = {}) => {
        const { selectedPromptIds, selectionAnchorId } = get()
        if (options.range && options.orderedIds) {
          const range = rangeBetween(options.orderedIds, selectionAnchorId, id)
          const merged = new Set([...selectedPromptIds, ...range])
          set({ selectedPromptIds: [...merged], selectionAnchorId: selectionAnchorId ?? id, isSelectionMode: true })
          return
        }
        const selected = selectedPromptIds.includes(id)
        set({
          selectedPromptIds: selected ? selectedPromptIds.filter(x => x !== id) : [...selectedPromptIds, id],
          selectionAnchorId: id,
          isSelectionMode: true
        })
      },

      setSelectedPromptIds: (ids: readonly number[]) => {
        set({ selectedPromptIds: [...new Set(ids)], isSelectionMode: true })
      },

      clearSelection: () => {
        set({ selectedPromptIds: [], selectionAnchorId: null })
      },

      toggleCategoryCollapsed: (categoryId: number) => {
        const { collapsedCategoryIds } = get()
        const updated = collapsedCategoryIds.includes(categoryId)
          ? collapsedCategoryIds.filter(id => id !== categoryId)
          : [...collapsedCategoryIds, categoryId]
        set({ collapsedCategoryIds: updated })
        writeStored('local', STORAGE_KEYS.COLLAPSED_CATEGORIES, updated)
      },

      getRecentlyInteractedPrompts: () => {
        const { prompts, recentlyInteractedIds } = get()
        const recentPrompts: Prompt[] = []

        // Get prompts in the order of recent interaction
        for (const id of recentlyInteractedIds) {
          const prompt = prompts.find(p => p.id === id)
          if (prompt) {
            recentPrompts.push(prompt)
          }
        }

        return recentPrompts as readonly Prompt[]
      },

      searchPrompts: async (query: string) => {
        try {
          set({ loading: true, error: null })
          const prompts = await window.electronAPI.searchPrompts(query)
          set({ prompts, loading: false })
        } catch (error) {
          showError(error, 'Não foi possível realizar a busca')
        }
      },

      // UI actions
      openPromptEditor: async (prompt?: Prompt) => {
        const target = prompt ?? null
        const { isPromptEditorOpen, selectedPrompt } = get()
        const alreadyOpen = isPromptEditorOpen && (selectedPrompt?.id ?? null) === (target?.id ?? null)
        if (!alreadyOpen && !(await confirmDiscardChanges())) return false

        const { recentlyInteractedIds, isPromptViewerOpen } = get()
        editorOpenedFromViewer = target !== null && isPromptViewerOpen && get().selectedPrompt?.id === target.id
        set({
          selectedPrompt: target,
          isPromptEditorOpen: true,
          isPromptViewerOpen: false, // Close viewer if open
          isTemplateEditorOpen: false, // Close template editor if open
          selectedTemplate: null,
          isSettingsOpen: false,
          // Track interaction if editing existing prompt
          recentlyInteractedIds: target ? trackInteraction(target.id, recentlyInteractedIds) : recentlyInteractedIds
        })
        persistEditorState(true, target)
        return true
      },

      closePromptEditor: () => {
        const { selectedPrompt, prompts } = get()
        // Latest version of the prompt (it may have just been saved)
        const returnTo = editorOpenedFromViewer && selectedPrompt
          ? prompts.find((p) => p.id === selectedPrompt.id) ?? null
          : null
        editorOpenedFromViewer = false
        set({
          selectedPrompt: returnTo,
          isPromptViewerOpen: returnTo !== null,
          isPromptEditorOpen: false,
          isEditorDirty: false,
          draftFormData: null
        })
        clearPersistedEditorState()
      },

      openPromptViewer: async (prompt: Prompt) => {
        if (!(await confirmDiscardChanges())) return false
        const { recentlyInteractedIds, isPromptEditorOpen } = get()

        set({
          selectedPrompt: prompt,
          isPromptViewerOpen: true,
          isPromptEditorOpen: false, // Close editor if open
          isTemplateEditorOpen: false, // Close template editor if open
          selectedTemplate: null,
          isSettingsOpen: false,
          // Track interaction (viewing)
          recentlyInteractedIds: trackInteraction(prompt.id, recentlyInteractedIds)
        })
        if (isPromptEditorOpen) {
          persistEditorState(false, null)
        }
        return true
      },

      closePromptViewer: () => {
        set({
          selectedPrompt: null,
          isPromptViewerOpen: false
        })
      },

      openSettings: async (tab?: SettingsTab) => {
        // Also used directly as an event handler: ignore anything that is not a tab name
        const settingsTab = SETTINGS_TABS.includes(tab as SettingsTab) ? tab : undefined
        const { isSettingsOpen, isPromptEditorOpen } = get()
        if (!isSettingsOpen && !(await confirmDiscardChanges())) return false
        set({
          isSettingsOpen: true,
          ...(settingsTab ? { settingsTab } : {}),
          isPromptEditorOpen: false,
          isPromptViewerOpen: false,
          isTemplateEditorOpen: false,
          selectedTemplate: null,
          selectedPrompt: null,
          isEditorDirty: false
        })
        if (isPromptEditorOpen) {
          persistEditorState(false, null)
        }
        return true
      },

      closeSettings: () => {
        set({ isSettingsOpen: false })
      },

      setSettingsTab: (tab: SettingsTab) => {
        set({ settingsTab: tab })
      },

      setActiveMainTab: (tab: MainTab) => {
        set({ activeMainTab: tab })
      },

      setEditorDirty: (dirty: boolean) => {
        set({ isEditorDirty: dirty })
      },

      confirmDiscardChanges,

      // Template editor actions
      openTemplateEditor: async (template?: Template) => {
        const target = template ?? null
        const { isTemplateEditorOpen, selectedTemplate } = get()
        const alreadyOpen = isTemplateEditorOpen && (selectedTemplate?.id ?? null) === (target?.id ?? null)
        if (!alreadyOpen && !(await confirmDiscardChanges())) return false
        const { isPromptEditorOpen } = get()
        set({
          selectedTemplate: target,
          isTemplateEditorOpen: true,
          // Close other editors
          isPromptEditorOpen: false,
          isPromptViewerOpen: false,
          isSettingsOpen: false
        })
        if (isPromptEditorOpen) {
          persistEditorState(false, null)
        }
        return true
      },

      closeTemplateEditor: () => {
        set({
          selectedTemplate: null,
          isTemplateEditorOpen: false,
          isEditorDirty: false
        })
      },

      // Toast management
      addToast: (toast: Omit<ToastMessage, 'id'>) => {
        const id = generateToastId()
        const newToast: ToastMessage = { ...toast, id }
        const { toasts } = get()
        // The Toaster (Radix) dismisses it after `duration`, pausing while hovered or focused,
        // and then calls removeToast
        set({ toasts: [...toasts, newToast] })
      },

      removeToast: (id: string) => {
        const { toasts } = get()
        set({ toasts: toasts.filter(toast => toast.id !== id) })
      },

      clearToasts: () => {
        set({ toasts: [] })
      },

      resetLocalState: () => {
        try {
          localStorage.clear()
        } catch {
          // Ignore storage errors
        }
        try {
          sessionStorage.clear()
        } catch {
          // Ignore storage errors
        }
        set({
          searchFilters: deriveSearchFilters('', get().categories),
          sortOptions: DEFAULT_SORT_OPTIONS,
          templateSearchQuery: '',
          promptViewMode: 'list',
          templateViewMode: 'list',
          selectedPrompt: null,
          isPromptEditorOpen: false,
          isPromptViewerOpen: false,
          selectedTemplate: null,
          isTemplateEditorOpen: false,
          isEditorDirty: false,
          draftFormData: null,
          recentlyInteractedIds: [],
          mcpConfig: { ...DEFAULT_MCP_CONFIG },
          exposedPrompts: [],
          mcpPortDraft: null,
          isSelectionMode: false,
          selectedPromptIds: [],
          selectionAnchorId: null,
          sequenceProgress: {},
          collapsedCategoryIds: []
        })
      },

      // Error handling
      setError: (error: string | null) => {
        set({ error })
      },

      clearError: () => {
        set({ error: null })
      },

      // Draft persistence actions
      saveDraftFormData: (formData: any) => {
        set({ draftFormData: formData })
        persistDraftFormData(formData)
      },

      clearDraftFormData: () => {
        clearDraft()
      },

      getDraftFormData: () => {
        return get().draftFormData
      },

      // Template search actions
      setTemplateSearchQuery: (query: string) => {
        set({ templateSearchQuery: query })
      },

      getFilteredTemplates: () => {
        const { templates, templateSearchQuery } = get()

        if (!templateSearchQuery.trim()) {
          return templates
        }

        const query = templateSearchQuery.toLowerCase()
        return templates.filter(template =>
          template.name.toLowerCase().includes(query) ||
          template.content.toLowerCase().includes(query) ||
          template.description?.toLowerCase().includes(query) ||
          template.variables.some(variable => variable.toLowerCase().includes(query))
        ) as readonly Template[]
      },

      // View mode actions
      setPromptViewMode: (mode: 'list' | 'grid') => {
        set({ promptViewMode: mode })
        persistViewMode(STORAGE_KEYS.PROMPT_VIEW_MODE, mode)
      },

      setTemplateViewMode: (mode: 'list' | 'grid') => {
        set({ templateViewMode: mode })
        persistViewMode(STORAGE_KEYS.TEMPLATE_VIEW_MODE, mode)
      },

      // MCP Server actions
      updateMcpConfig: (config: Partial<McpServerConfig>) => {
        const currentConfig = get().mcpConfig
        const newConfig = { ...currentConfig, ...config }
        set({ mcpConfig: newConfig })
        persistMcpConfig(newConfig)
      },

      setMcpPortDraft: (draft: string | null) => {
        set({ mcpPortDraft: draft })
      },

      togglePromptExposure: (promptId: number) => {
        const exposedPrompts = get().exposedPrompts
        const prompts = get().prompts
        const existing = exposedPrompts.find(p => p.id === promptId)

        if (existing) {
          // Toggle existing
          const updated = exposedPrompts.map(p =>
            p.id === promptId ? { ...p, exposed: !p.exposed } : p
          )
          set({ exposedPrompts: updated })
          persistExposedPrompts(updated)
        } else {
          // Add new with secure hash
          const prompt = prompts.find(p => p.id === promptId)
          const secureHash = generateSecureHash(promptId, prompt?.title || 'untitled')
          const newExposed: ExposedPrompt = {
            id: promptId,
            exposed: true,
            endpoint: `/prompts/${secureHash}`,
            secureHash
          }
          const updated = [...exposedPrompts, newExposed]
          set({ exposedPrompts: updated })
          persistExposedPrompts(updated)
        }
      },

      setPromptExposure: (promptId: number, exposed: boolean) => {
        const exposedPrompts = get().exposedPrompts
        const prompts = get().prompts
        const existing = exposedPrompts.find(p => p.id === promptId)

        if (existing) {
          // Update existing
          const updated = exposedPrompts.map(p =>
            p.id === promptId ? { ...p, exposed } : p
          )
          set({ exposedPrompts: updated })
          persistExposedPrompts(updated)
        } else if (exposed) {
          // Add new if exposing with secure hash
          const prompt = prompts.find(p => p.id === promptId)
          const secureHash = generateSecureHash(promptId, prompt?.title || 'untitled')
          const newExposed: ExposedPrompt = {
            id: promptId,
            exposed: true,
            endpoint: `/prompts/${secureHash}`,
            secureHash
          }
          const updated = [...exposedPrompts, newExposed]
          set({ exposedPrompts: updated })
          persistExposedPrompts(updated)
        }
      },

      getExposedPrompts: () => {
        return get().exposedPrompts
      },

      migrateLegacyEndpoints: () => {
        const exposedPrompts = get().exposedPrompts
        const prompts = get().prompts

        // Find all exposed prompts that don't have secure hashes
        const legacyPrompts = exposedPrompts.filter(ep =>
          ep.exposed && (!ep.secureHash || ep.endpoint.includes('/prompts/') && /\/prompts\/\d+$/.test(ep.endpoint))
        )

        if (legacyPrompts.length === 0) return

        // Generate secure hashes for legacy prompts
        const updated = exposedPrompts.map(ep => {
          if (legacyPrompts.some(lp => lp.id === ep.id)) {
            const prompt = prompts.find(p => p.id === ep.id)
            const secureHash = generateSecureHash(ep.id, prompt?.title || 'untitled')
            return {
              ...ep,
              secureHash,
              endpoint: `/prompts/${secureHash}`
            }
          }
          return ep
        })

        set({ exposedPrompts: updated })
        persistExposedPrompts(updated)
      }
      }
    },
    {
      name: 'prompt-store'
    }
  )
)
