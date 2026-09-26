import { create } from 'zustand'
import type { ApiTestRequest, ApiTestResponse } from '@/types'

// State of the "Testes" tab. It lives outside the component, so switching tabs keeps the endpoint,
// model, typed prompt, last response and even a request in progress. Endpoint, model, temperature
// and max tokens are saved in localStorage; the API key stays in memory only (never on disk).

const STORAGE_KEY = 'promptStudio_testConfig'
export const DEFAULT_TEST_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
export const DEFAULT_TEST_MODEL = 'gpt-4o-mini'
export const MAX_TOKENS_LIMIT = 128_000
export const TEST_TIMEOUT_SECONDS = 60

export type TestingTab = 'test' | 'config'

interface PersistedTestConfig {
  apiEndpoint: string
  model: string
  temperature: number
  // Text of the field: '' = not sent (the API default)
  maxTokens: string
}

export interface TestIssue {
  field: 'prompt' | 'apiKey' | 'model' | 'apiEndpoint' | 'maxTokens'
  message: string
}

interface TestingState extends PersistedTestConfig {
  apiKey: string
  prompt: string
  response: ApiTestResponse | null
  // Model and endpoint used by the last completed test
  lastRun: { model: string; endpoint: string } | null
  isLoading: boolean
  activeTab: TestingTab
  setConfig: (config: Partial<PersistedTestConfig>) => void
  setApiKey: (apiKey: string) => void
  setPrompt: (prompt: string) => void
  setActiveTab: (tab: TestingTab) => void
  // Returns the result, or null when nothing was sent (invalid input or a test already running)
  runTest: () => Promise<ApiTestResponse | null>
  cancelTest: () => Promise<void>
}

const DEFAULT_CONFIG: PersistedTestConfig = {
  apiEndpoint: DEFAULT_TEST_ENDPOINT,
  model: DEFAULT_TEST_MODEL,
  temperature: 0.7,
  maxTokens: '1000',
}

const loadConfig = (): PersistedTestConfig => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (!stored || typeof stored !== 'object') return DEFAULT_CONFIG
    return {
      apiEndpoint: typeof stored.apiEndpoint === 'string' ? stored.apiEndpoint : DEFAULT_CONFIG.apiEndpoint,
      model: typeof stored.model === 'string' ? stored.model : DEFAULT_CONFIG.model,
      temperature: typeof stored.temperature === 'number' && stored.temperature >= 0 && stored.temperature <= 2
        ? stored.temperature
        : DEFAULT_CONFIG.temperature,
      maxTokens: typeof stored.maxTokens === 'string' ? stored.maxTokens : DEFAULT_CONFIG.maxTokens,
    }
  } catch {
    return DEFAULT_CONFIG
  }
}

const saveConfig = (config: PersistedTestConfig) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch {
    // Ignore storage errors
  }
}

// undefined = empty field (not sent); NaN = invalid
export const parseMaxTokens = (text: string): number | undefined => {
  const trimmed = text.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= 1 && value <= MAX_TOKENS_LIMIT ? value : Number.NaN
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

export const getTestIssues = (state: Pick<TestingState, 'prompt' | 'apiKey' | 'model' | 'apiEndpoint' | 'maxTokens'>): TestIssue[] => {
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

export const useTestingStore = create<TestingState>()((set, get) => ({
  ...loadConfig(),
  apiKey: '',
  prompt: '',
  response: null,
  lastRun: null,
  isLoading: false,
  activeTab: 'test',

  setConfig: (config) => {
    set(config)
    const { apiEndpoint, model, temperature, maxTokens } = get()
    saveConfig({ apiEndpoint, model, temperature, maxTokens })
  },
  setApiKey: (apiKey) => set({ apiKey }),
  setPrompt: (prompt) => set({ prompt }),
  setActiveTab: (activeTab) => set({ activeTab }),

  runTest: async () => {
    const state = get()
    // Set synchronously before any await: a double click sends a single request
    if (state.isLoading || getTestIssues(state).length > 0) return null
    set({ isLoading: true, response: null })

    const model = state.model.trim()
    const endpoint = state.apiEndpoint.trim()
    const request: ApiTestRequest = {
      prompt: state.prompt,
      config: {
        apiEndpoint: endpoint,
        apiKey: state.apiKey.trim(),
        model,
        temperature: state.temperature,
        maxTokens: parseMaxTokens(state.maxTokens),
      },
    }

    let result: ApiTestResponse
    try {
      result = await window.electronAPI.testPrompt(request)
    } catch (error) {
      result = {
        success: false,
        error: 'Não foi possível executar o teste',
        errorDetail: error instanceof Error ? error.message : undefined,
      }
    }
    set({ response: result, isLoading: false, lastRun: { model, endpoint } })
    return result
  },

  cancelTest: async () => {
    if (!get().isLoading) return
    try {
      await window.electronAPI.cancelTestPrompt()
    } catch (error) {
      console.error('Failed to cancel test:', error)
    }
  },
}))
