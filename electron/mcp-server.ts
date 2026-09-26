import { createServer, IncomingMessage, Server, ServerResponse } from 'http'
import type { Socket } from 'net'
import { createHash, timingSafeEqual } from 'crypto'
import type { Database } from 'sqlite3'
import { getAllPrompts, applyTemplateVariables, extractTemplateVariables } from './database/queries'
import type {
  Prompt,
  McpLogLevel,
  McpServerLogEntry,
  McpServerSettings,
  McpServerStatus,
} from '../src/types'

// The server is only reachable from this computer, whatever the saved config says
export const MCP_LISTEN_HOST = '127.0.0.1'
const MAX_BODY_BYTES = 1024 * 1024
const RATE_LIMIT_WINDOW_MS = 60_000
const STOP_TIMEOUT_MS = 3_000
const MAX_LOGS = 50
const LOG_LEVELS: readonly McpLogLevel[] = ['debug', 'info', 'warn', 'error']
const SERVER_VERSION = '1.0.0'

// MCP over Streamable HTTP, stateless, JSON responses (spec 2025-06-18; older clients negotiate down)
export const MCP_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'] as const
const LATEST_PROTOCOL_VERSION = MCP_PROTOCOL_VERSIONS[0]
export const MCP_TOOL_NAME = 'obter_prompt'

interface ServerConfig {
  port: number
  enableAuth: boolean
  apiKey: string
  maxConnections: number
  rateLimit: number
  enableCors: boolean
  enableLogging: boolean
  logLevel: McpLogLevel
  name: string
}

interface ExposedEntry {
  hash: string
  name: string
  prompt: Prompt
  variables: string[]
}

type JsonRpcId = string | number

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: JsonRpcId | null
  result?: unknown
  error?: { code: number; message: string }
}

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message)
  }
}

const RPC_PARSE_ERROR = -32700
const RPC_INVALID_REQUEST = -32600
const RPC_METHOD_NOT_FOUND = -32601
const RPC_INVALID_PARAMS = -32602
const RPC_INTERNAL_ERROR = -32603

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toInteger = (value: unknown, fallback: number, min: number, max: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback
}

const sha256 = (value: string) => createHash('sha256').update(value, 'utf8').digest()

// Constant-time comparison (hashing first gives both sides the same length)
const safeEqual = (a: string, b: string) => timingSafeEqual(sha256(a), sha256(b))

const describeDetail = (detail: unknown): string => {
  if (detail instanceof Error) {
    const code = (detail as NodeJS.ErrnoException).code
    return code ? `${detail.message} (${code})` : detail.message
  }
  if (typeof detail === 'string') return detail
  try {
    return JSON.stringify(detail).slice(0, 500)
  } catch {
    return String(detail)
  }
}

// "Plano de aula: Ciências" -> "plano-de-aula-ciencias" (MCP prompt names are identifiers)
const slugify = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')

// A variable name is any text without braces (substitution is literal, so no escaping is needed)
const isValidVariableName = (name: string) => name.trim().length > 0 && name.length <= 100 && !/[{}]/.test(name)

// Variables sent by a client: { "nome": "valor" }. Returns the map or a pt-BR error message.
export const parseVariables = (value: unknown): Record<string, string> | string => {
  if (value === undefined || value === null) return {}
  if (!isPlainObject(value)) return 'As variáveis devem ser um objeto no formato { "nome": "valor" }'
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!isValidVariableName(key)) return `Nome de variável inválido: "${key.slice(0, 50)}"`
    if (raw === null || typeof raw === 'object' || typeof raw === 'function') {
      return `O valor da variável "${key.slice(0, 50)}" deve ser um texto`
    }
    result[key.trim()] = String(raw)
  }
  return result
}

const isLocalHostname = (hostname: string) =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'

class McpServer {
  private server: Server | null = null
  private listening = false
  private listeningPort = 0
  private startPromise: Promise<{ success: boolean; message: string; port?: number }> | null = null
  private stopPromise: Promise<{ success: boolean; message: string }> | null = null
  private config: ServerConfig
  private db: Database
  // secureHash -> prompt id
  private exposedPrompts: Map<string, number> = new Map()
  private requestCounts: Map<string, { count: number; resetTime: number }> = new Map()
  private rateLimitCleanup: ReturnType<typeof setInterval> | null = null
  private sockets: Set<Socket> = new Set()

  // Metrics tracking
  private startTime: number = 0
  private totalRequests: number = 0
  private totalErrors: number = 0
  private recentLogs: McpServerLogEntry[] = []

  constructor(db: Database) {
    this.db = db
    this.config = {
      port: 3000,
      enableAuth: true,
      apiKey: '',
      maxConnections: 100,
      rateLimit: 60,
      enableCors: false,
      enableLogging: true,
      logLevel: 'info',
      name: 'Prompt Studio',
    }
  }

  // Values come from the renderer: every field is checked, invalid numbers keep the previous value
  updateConfig(input: unknown) {
    if (!isPlainObject(input)) return
    const config = input as Partial<McpServerSettings>
    const next = { ...this.config }
    // "host" is ignored on purpose: the server always listens on 127.0.0.1
    if (config.port !== undefined) next.port = Number(config.port)
    if (config.enableAuth !== undefined) next.enableAuth = Boolean(config.enableAuth)
    if (typeof config.apiKey === 'string') next.apiKey = config.apiKey.trim()
    if (config.maxConnections !== undefined) next.maxConnections = toInteger(config.maxConnections, next.maxConnections, 1, 10_000)
    if (config.rateLimit !== undefined) next.rateLimit = toInteger(config.rateLimit, next.rateLimit, 1, 100_000)
    if (config.enableCors !== undefined) next.enableCors = Boolean(config.enableCors)
    if (config.enableLogging !== undefined) next.enableLogging = Boolean(config.enableLogging)
    if (typeof config.logLevel === 'string' && (LOG_LEVELS as readonly string[]).includes(config.logLevel)) {
      next.logLevel = config.logLevel as McpLogLevel
    }
    if (typeof config.name === 'string' && config.name.trim()) next.name = config.name.trim()
    this.config = next
    if (this.server) this.server.maxConnections = next.maxConnections
  }

  // Returns how many prompts are exposed. Entries without a valid secure hash are ignored.
  updateExposedPrompts(prompts: unknown): number {
    this.exposedPrompts.clear()
    const ids = new Set<number>()
    if (Array.isArray(prompts)) {
      for (const entry of prompts) {
        if (!isPlainObject(entry)) continue
        const { id, secureHash, exposed } = entry
        if (exposed !== true || typeof id !== 'number' || !Number.isInteger(id) || ids.has(id)) continue
        if (typeof secureHash !== 'string' || !/^[A-Za-z0-9]{1,128}$/.test(secureHash)) continue
        ids.add(id)
        this.exposedPrompts.set(secureHash, id)
      }
    }
    this.log('info', `Prompts expostos atualizados: ${this.exposedPrompts.size}`)
    return this.exposedPrompts.size
  }

  private log(level: McpLogLevel, message: string, detail?: unknown) {
    // Errors are always kept, so a failure is never invisible; the rest follows the log settings
    if (level !== 'error') {
      if (!this.config.enableLogging) return
      if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(this.config.logLevel)) return
    }
    const entry: McpServerLogEntry = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase() as McpServerLogEntry['level'],
      message,
      ...(detail !== undefined ? { detail: describeDetail(detail) } : {}),
    }
    this.recentLogs.push(entry)
    if (this.recentLogs.length > MAX_LOGS) {
      this.recentLogs = this.recentLogs.slice(-MAX_LOGS)
    }
    console.log(`[MCP Server ${entry.timestamp}] [${entry.level}] ${message}${entry.detail ? ` - ${entry.detail}` : ''}`)
  }

  private checkRateLimit(ip: string): { allowed: boolean; retryAfter: number } {
    const now = Date.now()
    const limit = this.requestCounts.get(ip)

    if (!limit || limit.resetTime <= now) {
      this.requestCounts.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS })
      return { allowed: true, retryAfter: 0 }
    }
    if (limit.count >= this.config.rateLimit) {
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((limit.resetTime - now) / 1000)) }
    }
    limit.count++
    return { allowed: true, retryAfter: 0 }
  }

  private pruneRateLimits() {
    const now = Date.now()
    for (const [ip, limit] of this.requestCounts) {
      if (limit.resetTime <= now) this.requestCounts.delete(ip)
    }
  }

  // Cross-origin browser access only makes sense with a key: without authentication, any web page
  // open in the browser could read the exposed prompts
  private get corsEnabled() {
    return this.config.enableCors && this.config.enableAuth && this.config.apiKey.length > 0
  }

  private applyCorsHeaders(res: ServerResponse) {
    if (!this.corsEnabled) return
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, Mcp-Protocol-Version, Mcp-Session-Id')
    res.setHeader('Access-Control-Expose-Headers', 'Retry-After')
    res.setHeader('Access-Control-Max-Age', '600')
  }

  private sendJson(res: ServerResponse, statusCode: number, data: unknown, headers: Record<string, string> = {}) {
    if (res.headersSent || res.writableEnded) return
    if (statusCode >= 500) this.totalErrors++
    this.applyCorsHeaders(res)
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...headers })
    res.end(JSON.stringify(data))
  }

  private sendError(res: ServerResponse, statusCode: number, error: string, message: string, headers?: Record<string, string>) {
    this.sendJson(res, statusCode, { error, message }, headers)
  }

  // DNS rebinding protection: a page on evil.example resolved to 127.0.0.1 still sends its own Host
  private isAllowedHost(host: string | undefined): boolean {
    if (!host) return true
    try {
      const url = new URL(`http://${host}`)
      return isLocalHostname(url.hostname) && (url.port === '' || Number(url.port) === this.listeningPort)
    } catch {
      return false
    }
  }

  private isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin || this.corsEnabled) return true
    try {
      return isLocalHostname(new URL(origin).hostname)
    } catch {
      return false
    }
  }

  private isAuthorized(req: IncomingMessage): boolean {
    if (!this.config.enableAuth) return true
    const expected = this.config.apiKey
    // Never accept an empty key (start() also refuses to run with auth enabled and no key)
    if (!expected) return false
    const header = req.headers['authorization']
    if (typeof header !== 'string') return false
    const match = /^Bearer (.+)$/i.exec(header)
    if (!match || !match[1]) return false
    return safeEqual(match[1], expected)
  }

  // Resolves with the body, or null when the request was aborted or too large (already answered)
  private readBody(req: IncomingMessage, res: ServerResponse): Promise<string | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = []
      let size = 0
      let tooLarge = false
      let settled = false
      const reject413 = () => {
        settled = true
        this.sendError(res, 413, 'Corpo grande demais', 'O corpo da requisição deve ter no máximo 1 MB')
        resolve(null)
      }
      // Node closes the connection when the response ends before the request body arrives, so the
      // 413 is sent after the body was read and discarded, up to a cap (then the client is cut off)
      const discardCap = MAX_BODY_BYTES * 8
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > discardCap) {
        reject413()
        return
      }
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) tooLarge = true

      req.on('data', (chunk: Buffer) => {
        if (settled) return
        size += chunk.length
        if (tooLarge || size > MAX_BODY_BYTES) {
          tooLarge = true
          chunks.length = 0
          if (size > discardCap) reject413()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        if (settled) return
        if (tooLarge) {
          reject413()
          return
        }
        settled = true
        resolve(Buffer.concat(chunks).toString('utf8'))
      })
      req.on('close', () => {
        if (settled) return
        settled = true
        resolve(null)
      })
    })
  }

  private async loadExposedEntries(): Promise<ExposedEntry[]> {
    if (this.exposedPrompts.size === 0) return []
    const prompts = await getAllPrompts(this.db)
    const byId = new Map(prompts.map((prompt) => [prompt.id, prompt]))
    const exposed = [...this.exposedPrompts.entries()]
      .map(([hash, id]) => ({ hash, prompt: byId.get(id) }))
      .filter((entry): entry is { hash: string; prompt: Prompt } => entry.prompt !== undefined)
      .sort((a, b) => a.prompt.id - b.prompt.id)

    const usedNames = new Set<string>()
    return exposed.map(({ hash, prompt }) => {
      const base = slugify(prompt.title) || 'prompt'
      let name = base
      for (let n = 2; usedNames.has(name); n++) name = `${base}-${n}`
      usedNames.add(name)
      return { hash, name, prompt, variables: extractTemplateVariables(prompt.content) }
    })
  }

  private async findEntry(nameOrHash: string): Promise<ExposedEntry | undefined> {
    const entries = await this.loadExposedEntries()
    return entries.find((entry) => entry.name === nameOrHash) ?? entries.find((entry) => entry.hash === nameOrHash)
  }

  private restSummary(entry: ExposedEntry) {
    return {
      id: entry.hash,
      name: entry.name,
      title: entry.prompt.title,
      description: entry.prompt.description,
      category: entry.prompt.category_name ?? null,
      tags: entry.prompt.tags,
      variables: entry.variables,
      endpoint: `/prompts/${entry.hash}`,
    }
  }

  private handleRequest(req: IncomingMessage, res: ServerResponse) {
    this.totalRequests++
    const method = req.method || 'GET'
    let pathname = '/'
    try {
      pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname
    } catch {
      // Keep "/" for a malformed URL: it ends in 404
    }
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1)
    this.log('info', `${method} ${pathname}`)

    if (!this.isAllowedHost(req.headers.host)) {
      this.sendError(res, 403, 'Acesso negado', 'Host não permitido. Use http://127.0.0.1')
      return
    }
    if (!this.isAllowedOrigin(req.headers.origin)) {
      this.sendError(res, 403, 'Acesso negado', 'Origem não permitida. Para aceitar requisições de navegadores, ative o CORS e a autenticação')
      return
    }

    if (method === 'OPTIONS') {
      this.applyCorsHeaders(res)
      res.writeHead(204)
      res.end()
      return
    }

    const ip = req.socket.remoteAddress || 'unknown'
    const limit = this.checkRateLimit(ip)
    if (!limit.allowed) {
      this.log('warn', `Limite de ${this.config.rateLimit} requisições por minuto atingido`)
      this.sendError(res, 429, 'Limite de requisições excedido',
        `Máximo de ${this.config.rateLimit} requisições por minuto. Tente novamente em ${limit.retryAfter} s.`,
        { 'Retry-After': String(limit.retryAfter) })
      return
    }

    // Health check without authentication, and without any detail about the server
    if (pathname === '/health') {
      if (method !== 'GET') {
        this.sendError(res, 405, 'Método não permitido', 'Use GET', { Allow: 'GET' })
        return
      }
      this.sendJson(res, 200, { status: 'ok' })
      return
    }

    if (!this.isAuthorized(req)) {
      this.log('warn', `Requisição recusada: chave de API inválida ou ausente (${method} ${pathname})`)
      this.sendError(res, 401, 'Não autorizado', 'Chave de API inválida ou ausente. Envie o cabeçalho "Authorization: Bearer SUA_CHAVE".',
        { 'WWW-Authenticate': 'Bearer realm="prompt-studio"' })
      return
    }

    const handle = async () => {
      if (pathname === '/mcp') return this.handleMcp(req, res, method)

      if (pathname === '/prompts') {
        if (method !== 'GET') return this.sendError(res, 405, 'Método não permitido', 'Use GET', { Allow: 'GET' })
        const entries = await this.loadExposedEntries()
        return this.sendJson(res, 200, { prompts: entries.map((entry) => this.restSummary(entry)), count: entries.length })
      }

      const promptMatch = /^\/prompts\/([A-Za-z0-9]{1,128})(\/execute)?$/.exec(pathname)
      if (promptMatch) {
        const hash = promptMatch[1] ?? ''
        const isExecute = Boolean(promptMatch[2])
        const expectedMethod = isExecute ? 'POST' : 'GET'
        if (method !== expectedMethod) {
          return this.sendError(res, 405, 'Método não permitido', `Use ${expectedMethod}`, { Allow: expectedMethod })
        }
        const entry = this.exposedPrompts.has(hash)
          ? (await this.loadExposedEntries()).find((item) => item.hash === hash)
          : undefined

        if (!isExecute) {
          if (!entry) return this.sendError(res, 404, 'Não encontrado', 'Prompt não encontrado ou não exposto')
          const { prompt } = entry
          return this.sendJson(res, 200, {
            ...this.restSummary(entry),
            content: prompt.content,
            metadata: { created_at: prompt.created_at, updated_at: prompt.updated_at, is_favorite: prompt.is_favorite },
          })
        }

        const body = await this.readBody(req, res)
        if (body === null) return
        if (!entry) return this.sendError(res, 404, 'Não encontrado', 'Prompt não encontrado ou não exposto')
        let params: unknown = {}
        try {
          params = body.trim() ? JSON.parse(body) : {}
        } catch {
          return this.sendError(res, 400, 'Requisição inválida', 'JSON inválido no corpo da requisição')
        }
        const variables = parseVariables(isPlainObject(params) ? params.variables : undefined)
        if (typeof variables === 'string') return this.sendError(res, 400, 'Requisição inválida', variables)
        return this.sendJson(res, 200, {
          prompt: applyTemplateVariables(entry.prompt.content, variables),
          metadata: {
            title: entry.prompt.title,
            description: entry.prompt.description,
            parameters_applied: variables,
          },
        })
      }

      return this.sendError(res, 404, 'Não encontrado', 'Endpoint não encontrado')
    }

    handle().catch((error) => {
      this.log('error', `Erro ao processar ${method} ${pathname}`, error)
      this.sendError(res, 500, 'Erro interno do servidor', 'Não foi possível processar a requisição')
    })
  }

  // ---- MCP (JSON-RPC 2.0 over Streamable HTTP, stateless) ----

  private async handleMcp(req: IncomingMessage, res: ServerResponse, method: string) {
    if (method !== 'POST') {
      // Stateless server: no SSE stream (GET) and no session to delete (DELETE)
      this.sendJson(res, 405, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: 'Método não permitido: este servidor MCP aceita apenas POST' },
      }, { Allow: 'POST' })
      return
    }

    const protocolHeader = req.headers['mcp-protocol-version']
    if (typeof protocolHeader === 'string' && !(MCP_PROTOCOL_VERSIONS as readonly string[]).includes(protocolHeader)) {
      this.sendJson(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32000, message: `Versão do protocolo MCP não suportada: ${protocolHeader.slice(0, 40)}` },
      })
      return
    }

    const body = await this.readBody(req, res)
    if (body === null) return

    let payload: unknown
    try {
      payload = JSON.parse(body)
    } catch {
      this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: RPC_PARSE_ERROR, message: 'JSON inválido' } })
      return
    }

    const isBatch = Array.isArray(payload)
    const messages: unknown[] = isBatch ? (payload as unknown[]) : [payload]
    if (messages.length === 0) {
      this.sendJson(res, 400, { jsonrpc: '2.0', id: null, error: { code: RPC_INVALID_REQUEST, message: 'Requisição inválida' } })
      return
    }

    const responses: JsonRpcResponse[] = []
    for (const message of messages) {
      const response = await this.handleRpcMessage(message)
      if (response) responses.push(response)
    }

    // Only notifications or responses: accepted, no body
    if (responses.length === 0) {
      if (res.headersSent) return
      this.applyCorsHeaders(res)
      res.writeHead(202)
      res.end()
      return
    }
    this.sendJson(res, 200, isBatch ? responses : responses[0])
  }

  private async handleRpcMessage(message: unknown): Promise<JsonRpcResponse | null> {
    if (!isPlainObject(message) || message.jsonrpc !== '2.0') {
      return { jsonrpc: '2.0', id: null, error: { code: RPC_INVALID_REQUEST, message: 'Requisição inválida' } }
    }
    if (typeof message.method !== 'string') {
      // A response from the client (this server never sends requests to clients)
      if ('result' in message || 'error' in message) return null
      return { jsonrpc: '2.0', id: null, error: { code: RPC_INVALID_REQUEST, message: 'Requisição inválida' } }
    }
    // Notifications (notifications/initialized, notifications/cancelled...) need no answer
    if (!('id' in message)) return null

    const id = message.id
    if (typeof id !== 'string' && typeof id !== 'number') {
      return { jsonrpc: '2.0', id: null, error: { code: RPC_INVALID_REQUEST, message: 'O campo "id" deve ser texto ou número' } }
    }

    try {
      const result = await this.dispatchRpc(message.method, message.params)
      return { jsonrpc: '2.0', id, result }
    } catch (error) {
      if (error instanceof RpcError) {
        return { jsonrpc: '2.0', id, error: { code: error.code, message: error.message } }
      }
      this.totalErrors++
      this.log('error', `Erro ao processar o método MCP ${message.method}`, error)
      return { jsonrpc: '2.0', id, error: { code: RPC_INTERNAL_ERROR, message: 'Erro interno do servidor' } }
    }
  }

  private async dispatchRpc(method: string, params: unknown): Promise<unknown> {
    const args = isPlainObject(params) ? params : {}

    switch (method) {
      case 'initialize': {
        const requested = typeof args.protocolVersion === 'string' ? args.protocolVersion : ''
        const protocolVersion = (MCP_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
          ? requested
          : LATEST_PROTOCOL_VERSION
        const clientInfo = isPlainObject(args.clientInfo) ? args.clientInfo : {}
        const clientName = typeof clientInfo.name === 'string' ? clientInfo.name.slice(0, 80) : 'desconhecido'
        this.log('info', `Cliente MCP conectado: ${clientName} (protocolo ${protocolVersion})`)
        return {
          protocolVersion,
          capabilities: {
            prompts: { listChanged: false },
            tools: { listChanged: false },
          },
          serverInfo: { name: 'prompt-studio', title: this.config.name, version: SERVER_VERSION },
          instructions:
            'Biblioteca de prompts do Prompt Studio. Liste os prompts com prompts/list e obtenha um deles com ' +
            `prompts/get (ou com a ferramenta ${MCP_TOOL_NAME}), informando os valores das variáveis {{...}}.`,
        }
      }

      case 'ping':
        return {}

      case 'prompts/list': {
        const entries = await this.loadExposedEntries()
        return {
          prompts: entries.map((entry) => ({
            name: entry.name,
            title: entry.prompt.title,
            ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
            arguments: entry.variables.map((variable) => ({
              name: variable,
              description: `Valor para {{${variable}}}`,
              required: false,
            })),
          })),
        }
      }

      case 'prompts/get': {
        if (typeof args.name !== 'string' || !args.name) {
          throw new RpcError(RPC_INVALID_PARAMS, 'Informe o nome do prompt ("name")')
        }
        const entry = await this.findEntry(args.name)
        if (!entry) throw new RpcError(RPC_INVALID_PARAMS, `Prompt não encontrado: ${args.name.slice(0, 80)}`)
        const variables = parseVariables(args.arguments)
        if (typeof variables === 'string') throw new RpcError(RPC_INVALID_PARAMS, variables)
        this.log('info', `Prompt obtido via MCP: ${entry.name}`)
        return {
          ...(entry.prompt.description ? { description: entry.prompt.description } : {}),
          messages: [
            { role: 'user', content: { type: 'text', text: applyTemplateVariables(entry.prompt.content, variables) } },
          ],
        }
      }

      case 'tools/list': {
        const entries = await this.loadExposedEntries()
        const available = entries.slice(0, 50).map((entry) => `"${entry.name}" (${entry.prompt.title})`).join(', ')
        return {
          tools: [
            {
              name: MCP_TOOL_NAME,
              title: 'Obter prompt',
              description:
                'Obtém o texto de um prompt da biblioteca do Prompt Studio, com as variáveis {{...}} substituídas ' +
                'pelos valores informados. Informe "nome" ou "hash". ' +
                (available ? `Prompts disponíveis: ${available}.` : 'Nenhum prompt está exposto no momento.'),
              inputSchema: {
                type: 'object',
                properties: {
                  nome: { type: 'string', description: 'Nome do prompt (como em prompts/list)' },
                  hash: { type: 'string', description: 'Hash do endpoint do prompt (alternativa ao nome)' },
                  variaveis: {
                    type: 'object',
                    description: 'Valores das variáveis, por exemplo { "tema": "vendas" }',
                    additionalProperties: { type: 'string' },
                  },
                },
              },
            },
          ],
        }
      }

      case 'tools/call': {
        if (args.name !== MCP_TOOL_NAME) {
          throw new RpcError(RPC_INVALID_PARAMS, `Ferramenta desconhecida: ${String(args.name).slice(0, 80)}`)
        }
        const input = isPlainObject(args.arguments) ? args.arguments : {}
        const toolError = (text: string) => ({ content: [{ type: 'text', text }], isError: true })
        const key = typeof input.nome === 'string' && input.nome.trim()
          ? input.nome.trim()
          : typeof input.hash === 'string' && input.hash.trim() ? input.hash.trim() : ''
        if (!key) return toolError('Informe "nome" ou "hash" do prompt.')
        const entry = await this.findEntry(key)
        if (!entry) return toolError(`Prompt não encontrado ou não exposto: ${key.slice(0, 80)}`)
        const variables = parseVariables(input.variaveis)
        if (typeof variables === 'string') return toolError(variables)
        this.log('info', `Ferramenta ${MCP_TOOL_NAME} usada: ${entry.name}`)
        return { content: [{ type: 'text', text: applyTemplateVariables(entry.prompt.content, variables) }] }
      }

      default:
        throw new RpcError(RPC_METHOD_NOT_FOUND, `Método não encontrado: ${method.slice(0, 80)}`)
    }
  }

  // ---- Lifecycle ----

  start(): Promise<{ success: boolean; message: string; port?: number }> {
    if (this.startPromise) return this.startPromise
    if (this.server) {
      return Promise.resolve({ success: false, message: 'O servidor já está em execução' })
    }

    const port = Number(this.config.port)
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      const message = 'Porta inválida. Use um número inteiro entre 1 e 65535.'
      this.log('error', message)
      return Promise.resolve({ success: false, message })
    }
    if (this.config.enableAuth && !this.config.apiKey) {
      const message = 'A autenticação está ativada, mas nenhuma chave de API foi definida. Gere ou digite uma chave na aba Configuração do servidor MCP.'
      this.log('error', message)
      return Promise.resolve({ success: false, message })
    }

    this.startPromise = new Promise((resolve) => {
      const server = createServer((req, res) => this.handleRequest(req, res))
      server.maxConnections = this.config.maxConnections
      server.requestTimeout = 30_000
      server.headersTimeout = 15_000
      server.on('connection', (socket: Socket) => {
        this.sockets.add(socket)
        socket.once('close', () => this.sockets.delete(socket))
      })
      server.on('drop', () => {
        this.log('warn', `Conexão recusada: limite de ${this.config.maxConnections} conexões simultâneas atingido`)
      })

      const onListenError = (error: NodeJS.ErrnoException) => {
        server.removeListener('listening', onListening)
        this.server = null
        this.listening = false
        this.listeningPort = 0
        this.startPromise = null
        const message = error.code === 'EADDRINUSE'
          ? `A porta ${port} já está em uso por outro programa. Escolha outra porta.`
          : error.code === 'EACCES'
            ? `Sem permissão para usar a porta ${port}. Escolha uma porta acima de 1024.`
            : `Não foi possível iniciar o servidor: ${error.message}`
        this.log('error', message, error)
        resolve({ success: false, message })
      }
      const onListening = () => {
        server.removeListener('error', onListenError)
        server.on('error', (error) => this.log('error', 'Erro no servidor', error))
        this.listening = true
        this.listeningPort = port
        this.startTime = Date.now()
        this.totalRequests = 0
        this.totalErrors = 0
        this.requestCounts.clear()
        this.rateLimitCleanup = setInterval(() => this.pruneRateLimits(), RATE_LIMIT_WINDOW_MS)
        ;(this.rateLimitCleanup as { unref?: () => void }).unref?.()
        this.startPromise = null
        this.log('info', `Servidor MCP iniciado em http://${MCP_LISTEN_HOST}:${port}`)
        resolve({ success: true, message: 'Servidor iniciado com sucesso', port })
      }

      server.once('error', onListenError)
      server.once('listening', onListening)
      this.server = server
      server.listen(port, MCP_LISTEN_HOST)
    })
    return this.startPromise
  }

  async stop(): Promise<{ success: boolean; message: string }> {
    if (this.stopPromise) return this.stopPromise
    if (this.startPromise) await this.startPromise
    const server = this.server
    if (!server) {
      return { success: false, message: 'O servidor não está em execução' }
    }

    this.stopPromise = new Promise((resolve) => {
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(forceTimer)
        for (const socket of this.sockets) socket.destroy()
        this.sockets.clear()
        if (this.rateLimitCleanup) clearInterval(this.rateLimitCleanup)
        this.rateLimitCleanup = null
        this.requestCounts.clear()
        this.server = null
        this.listening = false
        this.listeningPort = 0
        this.stopPromise = null
        this.log('info', 'Servidor MCP parado')
        resolve({ success: true, message: 'Servidor parado com sucesso' })
      }
      // A client that keeps a request open must not block "Parar servidor"
      const forceTimer = setTimeout(finish, STOP_TIMEOUT_MS)
      server.close(() => finish())
      server.closeAllConnections()
    })
    return this.stopPromise
  }

  isRunning(): boolean {
    return this.server !== null && this.listening
  }

  getStatus(): McpServerStatus {
    const running = this.isRunning()
    return {
      running,
      port: running ? this.listeningPort : 0,
      host: MCP_LISTEN_HOST,
      exposedPrompts: this.exposedPrompts.size,
      connections: running ? this.sockets.size : 0,
      uptime: running ? Math.floor((Date.now() - this.startTime) / 1000) : 0,
      requests: this.totalRequests,
      errors: this.totalErrors,
      logs: this.recentLogs.slice().reverse(),
    }
  }

  clearLogs() {
    this.recentLogs = []
  }
}

export default McpServer
