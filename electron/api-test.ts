// "Testes" panel: sends a prompt to an AI API and describes the result (runs in the main process).
// Providers: OpenAI-compatible chat completions and the Anthropic Messages API (Claude).
import type { ApiProvider, ApiTestRequest, ApiTestResponse, TokenUsage } from '../src/types'

export const API_TEST_TIMEOUT_MS = 60_000
// Current Claude models think before answering (adaptive thinking is on by default), so a complete
// non-streaming answer often takes longer than a minute
export const ANTHROPIC_TEST_TIMEOUT_MS = 120_000
export const API_TEST_MAX_TOKENS = 128_000
export const DEFAULT_OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions'
export const DEFAULT_ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages'
export const ANTHROPIC_VERSION = '2023-06-01'
// max_tokens is required by the Messages API. When the field is empty we send 16000, the recommended
// value for non-streaming requests: room for the model's thinking plus a long answer.
export const ANTHROPIC_DEFAULT_MAX_TOKENS = 16_000

export const apiTestTimeoutMs = (provider: ApiProvider): number =>
  provider === 'anthropic' ? ANTHROPIC_TEST_TIMEOUT_MS : API_TEST_TIMEOUT_MS

// pt-BR message for an HTTP error status of the tested API
export const describeApiStatus = (status: number): string => {
  switch (status) {
    case 400: return 'Requisição recusada pela API (400)'
    case 401: return 'Chave de API inválida (401)'
    case 402: return 'Problema de cobrança na conta da API (402)'
    case 403: return 'Acesso negado pela API (403)'
    case 404: return 'Endpoint ou modelo não encontrado (404)'
    case 408: return 'Tempo esgotado no servidor da API (408)'
    case 413: return 'Prompt grande demais para a API (413)'
    case 422: return 'Requisição recusada pela API (422)'
    case 429: return 'Limite de requisições atingido (429)'
    case 529: return 'A API está sobrecarregada no momento (529)'
    default:
      return status >= 500 ? `Erro no servidor da API (${status})` : `A API retornou um erro (${status})`
  }
}

// Error message sent by the API itself, shown as a detail. OpenAI: { error: { message } };
// Anthropic: { type: "error", error: { type, message } }
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

const pickNumber = (record: Record<string, unknown>, key: string): number | undefined => {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

const sanitizeOpenAIUsage = (usage: unknown): TokenUsage | undefined => {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const result = {
    prompt_tokens: pickNumber(record, 'prompt_tokens'),
    completion_tokens: pickNumber(record, 'completion_tokens'),
    total_tokens: pickNumber(record, 'total_tokens'),
  }
  return Object.values(result).some((value) => value !== undefined) ? result : undefined
}

// Anthropic reports input_tokens/output_tokens; the panel shows them as prompt/completion/total
const sanitizeAnthropicUsage = (usage: unknown): TokenUsage | undefined => {
  if (!usage || typeof usage !== 'object') return undefined
  const record = usage as Record<string, unknown>
  const input = pickNumber(record, 'input_tokens')
  const output = pickNumber(record, 'output_tokens')
  if (input === undefined && output === undefined) return undefined
  return {
    prompt_tokens: input,
    completion_tokens: output,
    total_tokens: input !== undefined && output !== undefined ? input + output : undefined,
  }
}

const openAIResponseText = (content: unknown): string => {
  if (typeof content === 'string') return content
  // Some compatible APIs return content parts: [{ type: 'text', text: '...' }]
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
      .join('')
  }
  return ''
}

// Only "text" blocks are the answer; "thinking" blocks (empty by default) and others are skipped
const anthropicResponseText = (content: readonly unknown[]): string =>
  content
    .map((block) => {
      if (!block || typeof block !== 'object') return ''
      const record = block as Record<string, unknown>
      return record.type === 'text' && typeof record.text === 'string' ? record.text : ''
    })
    .join('')

// A request that passed validation, with the values actually sent to the API
export interface PreparedApiTest {
  readonly provider: ApiProvider
  readonly prompt: string
  readonly apiKey: string
  readonly model: string
  readonly endpoint: URL
  // null = not sent (the model default)
  readonly temperature: number | null
  readonly maxTokens: number | null
}

export type PrepareApiTestResult =
  | { readonly ok: true; readonly test: PreparedApiTest }
  | { readonly ok: false; readonly response: ApiTestResponse }

const fail = (error: string, errorDetail?: string): ApiTestResponse =>
  errorDetail ? { success: false, error, errorDetail } : { success: false, error }

// Checks the request before anything is sent. Invalid input never reaches the network.
export function prepareApiTest(request: ApiTestRequest): PrepareApiTestResult {
  const invalid = (error: string, errorDetail?: string): PrepareApiTestResult => ({ ok: false, response: fail(error, errorDetail) })

  const prompt = request?.prompt
  const config = request?.config
  if (typeof prompt !== 'string' || !prompt.trim()) return invalid('Digite um prompt para testar')
  if (!config || typeof config !== 'object') return invalid('Informe a chave de API')
  const rawProvider: unknown = config.provider
  if (rawProvider !== undefined && rawProvider !== 'openai' && rawProvider !== 'anthropic') {
    return invalid('Provedor de API inválido', 'Escolha "OpenAI e compatíveis" ou "Anthropic (Claude)".')
  }
  const provider: ApiProvider = rawProvider ?? 'openai'
  const isAnthropic = provider === 'anthropic'
  if (typeof config.apiKey !== 'string' || !config.apiKey.trim()) return invalid('Informe a chave de API')
  const model = typeof config.model === 'string' ? config.model.trim() : ''
  if (!model) return invalid('Informe o modelo')

  const defaultEndpoint = isAnthropic ? DEFAULT_ANTHROPIC_ENDPOINT : DEFAULT_OPENAI_ENDPOINT
  const endpointText = (typeof config.apiEndpoint === 'string' && config.apiEndpoint.trim()) || defaultEndpoint
  let endpoint: URL
  try {
    endpoint = new URL(endpointText.trim())
  } catch {
    return invalid('URL do endpoint inválida', `Use um endereço completo, como ${defaultEndpoint}`)
  }
  if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
    return invalid('URL do endpoint inválida', 'O endereço deve começar com http:// ou https://')
  }

  // OpenAI: 0 to 2, 0.7 when omitted. Anthropic: 0 to 1, and only sent when given (the newest Claude
  // models reject the parameter).
  let temperature: number | null
  const rawTemperature: unknown = config.temperature
  if (isAnthropic) {
    if (rawTemperature === undefined || rawTemperature === null) {
      temperature = null
    } else if (typeof rawTemperature !== 'number' || !Number.isFinite(rawTemperature) || rawTemperature < 0 || rawTemperature > 1) {
      return invalid('Temperatura inválida', 'Para a Anthropic, use um valor entre 0 e 1')
    } else {
      temperature = rawTemperature
    }
  } else {
    const value = rawTemperature ?? 0.7
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) {
      return invalid('Temperatura inválida', 'Use um valor entre 0 e 2')
    }
    temperature = value
  }

  const rawMaxTokens: unknown = config.maxTokens
  if (rawMaxTokens !== undefined && rawMaxTokens !== null &&
      (typeof rawMaxTokens !== 'number' || !Number.isInteger(rawMaxTokens) || rawMaxTokens < 1 || rawMaxTokens > API_TEST_MAX_TOKENS)) {
    return invalid('Máximo de tokens inválido', 'Use um número inteiro entre 1 e 128.000, ou deixe o campo vazio')
  }
  const maxTokens = typeof rawMaxTokens === 'number' ? rawMaxTokens : isAnthropic ? ANTHROPIC_DEFAULT_MAX_TOKENS : null

  return {
    ok: true,
    test: { provider, prompt, apiKey: config.apiKey.trim(), model, endpoint, temperature, maxTokens },
  }
}

const buildRequestInit = (test: PreparedApiTest, signal: AbortSignal): RequestInit => {
  const messages = [{ role: 'user', content: test.prompt }]
  if (test.provider === 'anthropic') {
    return {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': test.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: test.model,
        max_tokens: test.maxTokens ?? ANTHROPIC_DEFAULT_MAX_TOKENS,
        messages,
        ...(test.temperature !== null ? { temperature: test.temperature } : {}),
      }),
      signal,
    }
  }
  return {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${test.apiKey}`,
    },
    body: JSON.stringify({
      model: test.model,
      messages,
      temperature: test.temperature ?? 0.7,
      ...(test.maxTokens !== null ? { max_tokens: test.maxTokens } : {}),
    }),
    signal,
  }
}

const unexpectedFormat = (errorDetail: string, responseTime: number): ApiTestResponse =>
  ({ success: false, error: 'Resposta em formato inesperado', errorDetail, responseTime })

// Reads a successful (2xx) body of either provider
const describeSuccessBody = (provider: ApiProvider, data: unknown, responseTime: number): ApiTestResponse => {
  const record = data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : null
  if (!record) return unexpectedFormat('A API não retornou um JSON válido.', responseTime)

  if (provider === 'anthropic') {
    if (!Array.isArray(record.content)) {
      return unexpectedFormat(
        'A resposta não tem o campo "content". Confirme que o endpoint é compatível com a API Messages da Anthropic (/v1/messages).',
        responseTime
      )
    }
    const usage = sanitizeAnthropicUsage(record.usage)
    return {
      success: true,
      response: anthropicResponseText(record.content),
      ...(usage ? { usage } : {}),
      ...(typeof record.stop_reason === 'string' ? { finishReason: record.stop_reason } : {}),
      responseTime,
    }
  }

  const choice = Array.isArray(record.choices) ? (record.choices[0] as Record<string, unknown> | undefined) : undefined
  if (!choice || typeof choice !== 'object') {
    return unexpectedFormat(
      'A resposta não tem o campo "choices". Confirme que o endpoint é compatível com a API de chat da OpenAI.',
      responseTime
    )
  }
  const message = choice.message && typeof choice.message === 'object' ? (choice.message as Record<string, unknown>) : {}
  const usage = sanitizeOpenAIUsage(record.usage)
  return {
    success: true,
    response: openAIResponseText(message.content),
    ...(usage ? { usage } : {}),
    ...(typeof choice.finish_reason === 'string' ? { finishReason: choice.finish_reason } : {}),
    responseTime,
  }
}

// Sends a validated test. Never throws: every failure becomes { success: false, error, errorDetail? }
// with a pt-BR message.
export async function runPreparedApiTest(
  test: PreparedApiTest,
  signal?: AbortSignal,
  timeoutMs: number = apiTestTimeoutMs(test.provider)
): Promise<ApiTestResponse> {
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
    return fail(`Não foi possível conectar a ${test.endpoint.host}`, describeNetworkError(error))
  }

  const startTime = Date.now()
  try {
    let response: Response
    let text: string
    try {
      response = await fetch(test.endpoint, buildRequestInit(test, controller.signal))
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
    return describeSuccessBody(test.provider, data, responseTime)
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}

// Validates and runs one test. timeoutMs defaults to the provider's timeout.
export async function executeApiTest(
  request: ApiTestRequest,
  signal?: AbortSignal,
  timeoutMs?: number
): Promise<ApiTestResponse> {
  const prepared = prepareApiTest(request)
  if (!prepared.ok) return prepared.response
  return runPreparedApiTest(prepared.test, signal, timeoutMs ?? apiTestTimeoutMs(prepared.test.provider))
}
