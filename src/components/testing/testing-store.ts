import { create } from 'zustand'
import type { ApiProvider, ApiTestConfig, ApiTestRequest, ApiTestResponse, TestRun } from '@/types'

// State of the "Testes" tab. It lives outside the component, so switching tabs keeps the endpoint,
// model, typed prompt, last response and even a request in progress. Provider, endpoint, model,
// temperature and max tokens are saved in localStorage per provider; API keys stay in memory only
// (never on disk), one per provider.

const STORAGE_KEY = 'promptStudio_testConfig'
const COMPARE_STORAGE_KEY = 'promptStudio_testCompare'
export const DEFAULT_TEST_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
export const DEFAULT_TEST_MODEL = 'gpt-4o-mini'
export const MAX_TOKENS_LIMIT = 128_000
export const TEST_TIMEOUT_SECONDS = 60
// Keys that identify requests in the main process (see electron/features/data-tools.ts)
export const TEST_RUN_KEY = 'test'
export const COMPARE_RUN_KEYS = { a: 'compare-a', b: 'compare-b' } as const
// Text saved in test_runs.error for canceled runs (electron/data-tools/test-runs.ts)
export const CANCELED_RUN_ERROR = 'Teste cancelado'

export interface ProviderInfo {
  readonly label: string
  readonly defaultEndpoint: string
  readonly defaultModel: string
  // Suggestions only: any model accepted by the endpoint can be typed
  readonly models: readonly string[]
  readonly temperatureMax: number
  readonly timeoutSeconds: number
  // max_tokens sent when the field is empty (null = not sent, the API default)
  readonly defaultMaxTokens: number | null
}

export const PROVIDERS: Readonly<Record<ApiProvider, ProviderInfo>> = {
  openai: {
    label: 'OpenAI e compatíveis',
    defaultEndpoint: DEFAULT_TEST_ENDPOINT,
    defaultModel: DEFAULT_TEST_MODEL,
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1', 'gpt-3.5-turbo'],
    temperatureMax: 2,
    timeoutSeconds: TEST_TIMEOUT_SECONDS,
    defaultMaxTokens: null,
  },
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultEndpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-opus-5',
    models: ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'claude-fable-5-1', 'claude-opus-4-8', 'claude-sonnet-4-6'],
    temperatureMax: 1,
    // Claude thinks before answering: the main process waits up to 2 minutes
    timeoutSeconds: 120,
    // Required by the Messages API; sent by the main process when the field is empty
    defaultMaxTokens: 16_000,
  },
}

export const API_PROVIDERS: readonly ApiProvider[] = ['openai', 'anthropic']

export const isApiProvider = (value: unknown): value is ApiProvider => value === 'openai' || value === 'anthropic'

export type TestingTab = 'test' | 'history' | 'compare' | 'config'

export interface ProviderConfig {
  apiEndpoint: string
  model: string
  temperature: number
  // Anthropic only: the newest Claude models reject the temperature, so it is off by default
  sendTemperature: boolean
  // Text of the field: '' = the default (not sent for OpenAI, 16000 for Anthropic)
  maxTokens: string
}

export const DEFAULT_PROVIDER_CONFIGS: Readonly<Record<ApiProvider, ProviderConfig>> = {
  openai: { apiEndpoint: DEFAULT_TEST_ENDPOINT, model: DEFAULT_TEST_MODEL, temperature: 0.7, sendTemperature: true, maxTokens: '1000' },
  anthropic: { apiEndpoint: PROVIDERS.anthropic.defaultEndpoint, model: PROVIDERS.anthropic.defaultModel, temperature: 1, sendTemperature: false, maxTokens: '' },
}

export interface TestIssue {
  field: 'prompt' | 'apiKey' | 'model' | 'apiEndpoint' | 'maxTokens' | 'temperature'
  message: string
}

// One side of "Comparar modelos". Temperature is text: '' = the default.
export interface CompareSlotConfig {
  provider: ApiProvider
  model: string
  apiEndpoint: string
  maxTokens: string
  temperature: string
}

export type CompareSlot = 'a' | 'b'

export interface CompareResult {
  readonly response: ApiTestResponse
  readonly provider: ApiProvider
  readonly model: string
  readonly endpoint: string
}

// Extra fields understood by the main process's test-prompt handler
export type TestPromptRequest = ApiTestRequest & { readonly promptId?: number; readonly runKey?: string }

interface TestingState extends ProviderConfig {
  provider: ApiProvider
  // Saved configuration of every provider (the active one mirrors the flat fields)
  configs: Record<ApiProvider, ProviderConfig>
  apiKey: string
  apiKeys: Record<ApiProvider, string>
  prompt: string
  // Prompt the text came from (quick select), saved with each run
  promptSourceId: number | null
  response: ApiTestResponse | null
  // Provider, model and endpoint used by the last completed test
  lastRun: { provider: ApiProvider; model: string; endpoint: string } | null
  isLoading: boolean
  activeTab: TestingTab

  history: readonly TestRun[]
  historyLoaded: boolean
  historyLoading: boolean
  historyError: string | null
  // History tab state kept across tab switches: expanded runs, runs picked for comparison (in order), comparison open
  historyExpanded: readonly number[]
  historySelected: readonly number[]
  historyComparing: boolean

  compare: Record<CompareSlot, CompareSlotConfig>
  compareResults: Record<CompareSlot, CompareResult | null>
  compareLoading: boolean

  setConfig: (config: Partial<ProviderConfig>) => void
  setProvider: (provider: ApiProvider) => void
  setApiKey: (apiKey: string) => void
  // sourcePromptId: the prompt the text came from; omitted = keep the current one (cleared with the text)
  setPrompt: (prompt: string, sourcePromptId?: number | null) => void
  setActiveTab: (tab: TestingTab) => void
  // Returns the result, or null when nothing was sent (invalid input or a test already running)
  runTest: () => Promise<ApiTestResponse | null>
  cancelTest: () => Promise<void>
  // Loads a saved run into the "Testar prompt" tab (provider, model, endpoint, options and text)
  loadRun: (run: TestRun) => void

  loadHistory: () => Promise<void>
  deleteRun: (id: number) => Promise<boolean>
  clearHistory: () => Promise<number>
  toggleHistoryExpanded: (id: number) => void
  // Up to two runs; a third choice replaces the oldest one
  toggleHistorySelected: (id: number) => void
  setHistoryComparing: (comparing: boolean) => void

  setCompareSlot: (slot: CompareSlot, config: Partial<CompareSlotConfig>) => void
  runCompare: () => Promise<Record<CompareSlot, CompareResult> | null>
  // Without a slot cancels both sides
  cancelCompare: (slot?: CompareSlot) => Promise<void>
}

const readNumber = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback

const readProviderConfig = (stored: unknown, provider: ApiProvider): ProviderConfig => {
  const defaults = DEFAULT_PROVIDER_CONFIGS[provider]
  if (!stored || typeof stored !== 'object') return { ...defaults }
  const record = stored as Record<string, unknown>
  return {
    apiEndpoint: typeof record.apiEndpoint === 'string' ? record.apiEndpoint : defaults.apiEndpoint,
    model: typeof record.model === 'string' ? record.model : defaults.model,
    temperature: readNumber(record.temperature, 0, PROVIDERS[provider].temperatureMax, defaults.temperature),
    sendTemperature: provider === 'openai' ? true : typeof record.sendTemperature === 'boolean' ? record.sendTemperature : defaults.sendTemperature,
    maxTokens: typeof record.maxTokens === 'string' ? record.maxTokens : defaults.maxTokens,
  }
}

interface PersistedState {
  provider: ApiProvider
  configs: Record<ApiProvider, ProviderConfig>
}

// Reads the saved configuration. The first format (before providers) was a single OpenAI config.
const readJson = (key: string): Record<string, unknown> | null => {
  const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
}

export const loadPersistedConfig = (): PersistedState => {
  try {
    const stored = readJson(STORAGE_KEY)
    if (!stored) {
      return { provider: 'openai', configs: { openai: { ...DEFAULT_PROVIDER_CONFIGS.openai }, anthropic: { ...DEFAULT_PROVIDER_CONFIGS.anthropic } } }
    }
    const configs = stored.configs && typeof stored.configs === 'object' ? (stored.configs as Record<string, unknown>) : null
    if (configs) {
      return {
        provider: isApiProvider(stored.provider) ? stored.provider : 'openai',
        configs: {
          openai: readProviderConfig(configs.openai, 'openai'),
          anthropic: readProviderConfig(configs.anthropic, 'anthropic'),
        },
      }
    }
    return { provider: 'openai', configs: { openai: readProviderConfig(stored, 'openai'), anthropic: { ...DEFAULT_PROVIDER_CONFIGS.anthropic } } }
  } catch {
    return { provider: 'openai', configs: { openai: { ...DEFAULT_PROVIDER_CONFIGS.openai }, anthropic: { ...DEFAULT_PROVIDER_CONFIGS.anthropic } } }
  }
}

const saveConfig = (state: PersistedState) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

const defaultCompareSlot = (provider: ApiProvider, config: ProviderConfig): CompareSlotConfig => ({
  provider,
  model: config.model,
  apiEndpoint: config.apiEndpoint,
  maxTokens: config.maxTokens,
  temperature: '',
})

const readCompareSlot = (stored: unknown, fallback: CompareSlotConfig): CompareSlotConfig => {
  if (!stored || typeof stored !== 'object') return fallback
  const record = stored as Record<string, unknown>
  return {
    provider: isApiProvider(record.provider) ? record.provider : fallback.provider,
    model: typeof record.model === 'string' ? record.model : fallback.model,
    apiEndpoint: typeof record.apiEndpoint === 'string' ? record.apiEndpoint : fallback.apiEndpoint,
    maxTokens: typeof record.maxTokens === 'string' ? record.maxTokens : fallback.maxTokens,
    temperature: typeof record.temperature === 'string' ? record.temperature : fallback.temperature,
  }
}

const loadCompare = (persisted: PersistedState): Record<CompareSlot, CompareSlotConfig> => {
  const other: ApiProvider = persisted.provider === 'openai' ? 'anthropic' : 'openai'
  const fallback = {
    a: defaultCompareSlot(persisted.provider, persisted.configs[persisted.provider]),
    b: defaultCompareSlot(other, persisted.configs[other]),
  }
  try {
    const stored = readJson(COMPARE_STORAGE_KEY)
    if (!stored) return fallback
    return { a: readCompareSlot(stored.a, fallback.a), b: readCompareSlot(stored.b, fallback.b) }
  } catch {
    return fallback
  }
}

const saveCompare = (compare: Record<CompareSlot, CompareSlotConfig>) => {
  try {
    localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(compare))
  } catch {
    // Ignore storage errors
  }
}

// undefined = empty field (the default); NaN = invalid
export const parseMaxTokens = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 && value <= MAX_TOKENS_LIMIT ? value : Number.NaN
}

// undefined = empty field (the default); NaN = invalid for the provider
export const parseTemperature = (text: string, provider: ApiProvider): number | undefined => {
  const trimmed = text.trim().replace(',', '.')
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) && value >= 0 && value <= PROVIDERS[provider].temperatureMax ? value : Number.NaN
}

export const parseEndpoint = (text: string): URL | null => {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

// http:// to another computer sends the API key without encryption
export const isInsecureEndpoint = (text: string): boolean => {
  const url = parseEndpoint(text)
  return url !== null && url.protocol === 'http:' && !LOCAL_HOSTNAMES.has(url.hostname) && !url.hostname.endsWith('.localhost')
}

const maxTokensMessage = `o máximo de tokens deve ser um número inteiro entre 1 e ${MAX_TOKENS_LIMIT.toLocaleString('pt-BR')} (ou ficar vazio)`

export const getTestIssues = (
  state: Pick<TestingState, 'prompt' | 'apiKey' | 'model' | 'apiEndpoint' | 'maxTokens'> & Partial<Pick<TestingState, 'provider'>>
): TestIssue[] => {
  const issues: TestIssue[] = []
  if (!state.prompt.trim()) issues.push({ field: 'prompt', message: 'Digite um prompt para testar.' })
  if (!state.apiKey.trim()) issues.push({ field: 'apiKey', message: 'Informe a chave de API na aba Configuração.' })
  if (!state.model.trim()) issues.push({ field: 'model', message: 'Informe o modelo na aba Configuração.' })
  if (!parseEndpoint(state.apiEndpoint)) {
    issues.push({ field: 'apiEndpoint', message: 'Informe uma URL de endpoint válida (http:// ou https://) na aba Configuração.' })
  }
  if (Number.isNaN(parseMaxTokens(state.maxTokens))) {
    issues.push({ field: 'maxTokens', message: 'O máximo de tokens deve ser um número inteiro entre 1 e 128.000 (ou fique vazio).' })
  }
  return issues
}

// Problems of one comparison side, in pt-BR ("A: informe o modelo.")
export const getCompareIssues = (
  prompt: string,
  compare: Record<CompareSlot, CompareSlotConfig>,
  apiKeys: Record<ApiProvider, string>
): string[] => {
  const issues: string[] = []
  if (!prompt.trim()) issues.push('Digite um prompt para comparar.')
  for (const slot of ['a', 'b'] as const) {
    const config = compare[slot]
    const label = slot.toUpperCase()
    if (!apiKeys[config.provider].trim()) {
      issues.push(`${label}: informe a chave de API de ${PROVIDERS[config.provider].label} na aba Configuração.`)
    }
    if (!config.model.trim()) issues.push(`${label}: informe o modelo.`)
    if (!parseEndpoint(config.apiEndpoint)) issues.push(`${label}: informe uma URL de endpoint válida (http:// ou https://).`)
    if (Number.isNaN(parseMaxTokens(config.maxTokens))) issues.push(`${label}: ${maxTokensMessage}.`)
    if (Number.isNaN(parseTemperature(config.temperature, config.provider))) {
      issues.push(`${label}: a temperatura deve ficar entre 0 e ${PROVIDERS[config.provider].temperatureMax} (ou vazia).`)
    }
  }
  return issues
}

const buildConfig = (provider: ApiProvider, apiKey: string, config: ProviderConfig): ApiTestConfig => ({
  provider,
  apiEndpoint: config.apiEndpoint.trim(),
  apiKey: apiKey.trim(),
  model: config.model.trim(),
  ...(provider === 'openai' || config.sendTemperature ? { temperature: config.temperature } : {}),
  maxTokens: parseMaxTokens(config.maxTokens),
})

const callTest = async (request: TestPromptRequest): Promise<ApiTestResponse> => {
  try {
    return await window.electronAPI.testPrompt(request)
  } catch (error) {
    return {
      success: false,
      error: 'Não foi possível executar o teste',
      errorDetail: error instanceof Error ? error.message : undefined,
    }
  }
}

const cancelKeys = async (keys: string | readonly string[]) => {
  try {
    await window.electronAPI.invoke('test-prompt:cancel', keys)
  } catch (error) {
    console.error('Failed to cancel test:', error)
  }
}

const initial = loadPersistedConfig()

export const useTestingStore = create<TestingState>()((set, get) => {
  const persist = () => {
    const { provider, configs } = get()
    saveConfig({ provider, configs })
  }
  // Refreshes the history in the background after a run (it may not be on screen)
  const refreshHistory = () => {
    void get().loadHistory()
  }
  // Runs that left the list (deleted, cleared, beyond the limit) leave the expanded and selected lists
  const historyUiFor = (history: readonly TestRun[]) => {
    const ids = new Set(history.map((run) => run.id))
    const { historyExpanded, historySelected, historyComparing } = get()
    const selected = historySelected.filter((id) => ids.has(id))
    return {
      historyExpanded: historyExpanded.filter((id) => ids.has(id)),
      historySelected: selected,
      historyComparing: historyComparing && selected.length === 2,
    }
  }

  return {
    provider: initial.provider,
    configs: initial.configs,
    ...initial.configs[initial.provider],
    apiKey: '',
    apiKeys: { openai: '', anthropic: '' },
    prompt: '',
    promptSourceId: null,
    response: null,
    lastRun: null,
    isLoading: false,
    activeTab: 'test',

    history: [],
    historyLoaded: false,
    historyLoading: false,
    historyError: null,
    historyExpanded: [],
    historySelected: [],
    historyComparing: false,

    compare: loadCompare(initial),
    compareResults: { a: null, b: null },
    compareLoading: false,

    setConfig: (config) => {
      const state = get()
      const next: ProviderConfig = {
        apiEndpoint: config.apiEndpoint ?? state.apiEndpoint,
        model: config.model ?? state.model,
        temperature: config.temperature ?? state.temperature,
        sendTemperature: state.provider === 'openai' ? true : config.sendTemperature ?? state.sendTemperature,
        maxTokens: config.maxTokens ?? state.maxTokens,
      }
      // A result that no longer matches the endpoint or model on screen is cleared
      const targetChanged = next.apiEndpoint !== state.apiEndpoint || next.model !== state.model
      set({
        ...next,
        configs: { ...state.configs, [state.provider]: next },
        ...(targetChanged && !state.isLoading ? { response: null, lastRun: null } : {}),
      })
      persist()
    },

    setProvider: (provider) => {
      const state = get()
      if (provider === state.provider || !isApiProvider(provider)) return
      const current: ProviderConfig = {
        apiEndpoint: state.apiEndpoint,
        model: state.model,
        temperature: state.temperature,
        sendTemperature: state.sendTemperature,
        maxTokens: state.maxTokens,
      }
      const configs = { ...state.configs, [state.provider]: current }
      set({
        provider,
        configs,
        ...configs[provider],
        apiKey: state.apiKeys[provider],
        ...(!state.isLoading ? { response: null, lastRun: null } : {}),
      })
      persist()
    },

    setApiKey: (apiKey) => set((state) => ({ apiKey, apiKeys: { ...state.apiKeys, [state.provider]: apiKey } })),

    setPrompt: (prompt, sourcePromptId) =>
      set((state) => ({
        prompt,
        promptSourceId: sourcePromptId !== undefined ? sourcePromptId : prompt.trim() ? state.promptSourceId : null,
      })),

    setActiveTab: (activeTab) => set({ activeTab }),

    runTest: async () => {
      const state = get()
      // Checked synchronously before any await: a double click sends a single request
      if (state.isLoading) return null
      if (getTestIssues(state).length > 0) {
        // The result on screen would not match what the user is trying to send
        set({ response: null, lastRun: null })
        return null
      }
      set({ isLoading: true, response: null })

      const provider = state.provider
      const config = buildConfig(provider, state.apiKey, state)
      const request: TestPromptRequest = {
        prompt: state.prompt,
        config,
        runKey: TEST_RUN_KEY,
        ...(state.promptSourceId !== null ? { promptId: state.promptSourceId } : {}),
      }
      const result = await callTest(request)
      set({
        response: result,
        isLoading: false,
        lastRun: { provider, model: config.model, endpoint: config.apiEndpoint ?? '' },
      })
      refreshHistory()
      return result
    },

    cancelTest: async () => {
      if (!get().isLoading) return
      await cancelKeys(TEST_RUN_KEY)
    },

    loadRun: (run) => {
      const state = get()
      if (state.isLoading) return
      if (run.provider !== state.provider) get().setProvider(run.provider)
      const provider = get().provider
      get().setConfig({
        apiEndpoint: run.endpoint,
        model: run.model,
        ...(run.temperature !== null ? { temperature: run.temperature, sendTemperature: true } : provider === 'anthropic' ? { sendTemperature: false } : {}),
        // Anthropic always saves the max_tokens sent; the default (16000) goes back to an empty field
        maxTokens: run.max_tokens === null || (provider === 'anthropic' && run.max_tokens === PROVIDERS.anthropic.defaultMaxTokens)
          ? ''
          : String(run.max_tokens),
      })
      set({ prompt: run.prompt_text, promptSourceId: run.prompt_id, activeTab: 'test' })
    },

    loadHistory: async () => {
      if (get().historyLoading) return
      set({ historyLoading: true, historyError: null })
      try {
        const history = await window.electronAPI.listTestRuns({ limit: 200 })
        set({ history, historyLoaded: true, historyLoading: false, ...historyUiFor(history) })
      } catch (error) {
        set({
          historyLoading: false,
          historyError: error instanceof Error ? error.message : 'Não foi possível carregar o histórico.',
        })
      }
    },

    deleteRun: async (id) => {
      const result = await window.electronAPI.deleteTestRun(id)
      if (result.success) {
        const history = get().history.filter((run) => run.id !== id)
        set({ history, ...historyUiFor(history) })
      }
      return result.success
    },

    clearHistory: async () => {
      const result = await window.electronAPI.clearTestRuns()
      if (result.success) set({ history: [], historyExpanded: [], historySelected: [], historyComparing: false })
      return result.deleted
    },

    toggleHistoryExpanded: (id) =>
      set((state) => ({
        historyExpanded: state.historyExpanded.includes(id)
          ? state.historyExpanded.filter((value) => value !== id)
          : [...state.historyExpanded, id],
      })),

    toggleHistorySelected: (id) =>
      set((state) => {
        const selected = state.historySelected.includes(id)
          ? state.historySelected.filter((value) => value !== id)
          : [...state.historySelected, id].slice(-2)
        return { historySelected: selected, historyComparing: state.historyComparing && selected.length === 2 }
      }),

    setHistoryComparing: (historyComparing) =>
      set((state) => ({ historyComparing: historyComparing && state.historySelected.length === 2 })),

    setCompareSlot: (slot, config) => {
      const state = get()
      const current = state.compare[slot]
      let next: CompareSlotConfig = { ...current, ...config }
      // Switching the provider of a side brings that provider's endpoint and model
      if (config.provider && config.provider !== current.provider) {
        const saved = config.provider === state.provider ? state : state.configs[config.provider]
        next = {
          ...next,
          apiEndpoint: config.apiEndpoint ?? saved.apiEndpoint,
          model: config.model ?? saved.model,
          maxTokens: config.maxTokens ?? saved.maxTokens,
          temperature: config.temperature ?? '',
        }
      }
      const compare = { ...state.compare, [slot]: next }
      const changed = next.provider !== current.provider || next.model !== current.model || next.apiEndpoint !== current.apiEndpoint
      set({
        compare,
        ...(changed && !state.compareLoading ? { compareResults: { ...state.compareResults, [slot]: null } } : {}),
      })
      saveCompare(compare)
    },

    runCompare: async () => {
      const state = get()
      if (state.compareLoading) return null
      if (getCompareIssues(state.prompt, state.compare, state.apiKeys).length > 0) {
        set({ compareResults: { a: null, b: null } })
        return null
      }
      set({ compareLoading: true, compareResults: { a: null, b: null } })
      const runSlot = async (slot: CompareSlot): Promise<CompareResult> => {
        const config = state.compare[slot]
        const temperature = parseTemperature(config.temperature, config.provider)
        const request: TestPromptRequest = {
          prompt: state.prompt,
          config: {
            provider: config.provider,
            apiKey: state.apiKeys[config.provider].trim(),
            model: config.model.trim(),
            apiEndpoint: config.apiEndpoint.trim(),
            maxTokens: parseMaxTokens(config.maxTokens),
            ...(temperature !== undefined ? { temperature } : {}),
          },
          runKey: COMPARE_RUN_KEYS[slot],
          ...(state.promptSourceId !== null ? { promptId: state.promptSourceId } : {}),
        }
        const response = await callTest(request)
        const result: CompareResult = { response, provider: config.provider, model: config.model.trim(), endpoint: config.apiEndpoint.trim() }
        // Each side shows up as soon as it finishes
        set((current) => ({ compareResults: { ...current.compareResults, [slot]: result } }))
        return result
      }
      const [a, b] = await Promise.all([runSlot('a'), runSlot('b')])
      set({ compareLoading: false })
      refreshHistory()
      return { a, b }
    },

    cancelCompare: async (slot) => {
      if (!get().compareLoading) return
      await cancelKeys(slot ? COMPARE_RUN_KEYS[slot] : [COMPARE_RUN_KEYS.a, COMPARE_RUN_KEYS.b])
    },
  }
})
