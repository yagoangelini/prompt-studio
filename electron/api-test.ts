// "Testes" panel: sends a prompt to an AI API and describes the result (runs in the main process)
import type { ApiTestRequest, ApiTestResponse, TokenUsage } from '../src/types'

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
