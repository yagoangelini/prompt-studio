import type { ApiProvider, ApiTestResponse, ToastMessage } from '@/types'
import { PROVIDERS, parseEndpoint } from './testing-store'

// "3.044 ms" everywhere (panel, toasts, history)
export const formatMs = (ms: number | null | undefined): string =>
  typeof ms === 'number' && Number.isFinite(ms) ? `${Math.round(ms).toLocaleString('pt-BR')} ms` : '—'

export const formatTokens = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('pt-BR') : '—'

export const endpointLabel = (endpoint: string): string => parseEndpoint(endpoint)?.host ?? (endpoint.trim() || 'não definido')

export const providerLabel = (provider: ApiProvider): string => PROVIDERS[provider]?.label ?? provider

// Why the answer stopped (OpenAI finish_reason / Anthropic stop_reason), when the user should know
const FINISH_REASON_HINTS: Record<string, string> = {
  length: 'A resposta foi cortada pelo limite de tokens. Aumente o máximo de tokens na aba Configuração.',
  max_tokens: 'A resposta foi cortada pelo limite de tokens. Aumente o máximo de tokens na aba Configuração.',
  content_filter: 'A resposta foi bloqueada pelo filtro de conteúdo da API.',
  refusal: 'O Claude recusou o pedido por motivos de segurança.',
}

// Reasons that need no warning, in words instead of the API code
const FINISH_REASON_LABELS: Record<string, string> = {
  stop: 'o modelo encerrou a resposta normalmente',
  end_turn: 'o modelo encerrou a resposta normalmente',
  stop_sequence: 'a resposta parou numa sequência de parada',
  tool_use: 'o modelo pediu para usar uma ferramenta',
  tool_calls: 'o modelo pediu para usar uma ferramenta',
  pause_turn: 'o modelo pausou a resposta',
}

export const finishReasonHint = (reason: string | undefined): string | null =>
  reason ? FINISH_REASON_HINTS[reason] ?? null : null

// Sentence for any reason: the hint when there is one, otherwise a description in pt-BR
export const finishReasonText = (reason: string | undefined): string | null => {
  if (!reason) return null
  const hint = finishReasonHint(reason)
  if (hint) return hint
  const label = FINISH_REASON_LABELS[reason]
  return label ? `Motivo: ${label}.` : `Motivo informado pela API: "${reason}".`
}

export const isTruncated = (reason: string | undefined): boolean => reason === 'length' || reason === 'max_tokens'

// The answer came back, but blocked or refused
const isBlocked = (reason: string | undefined): boolean => reason === 'refusal' || reason === 'content_filter'

// Toast shown after a test (single run or re-run from the history)
export const testResultToast = (result: ApiTestResponse): Omit<ToastMessage, 'id'> => {
  if (result.success) {
    if (isBlocked(result.finishReason)) {
      return {
        type: 'warning',
        title: result.finishReason === 'refusal' ? 'O Claude recusou o pedido' : 'Resposta bloqueada',
        description: finishReasonHint(result.finishReason) ?? undefined,
      }
    }
    if (!result.response) {
      return { type: 'warning', title: 'A API respondeu sem conteúdo', description: 'Veja os detalhes na área de resposta.' }
    }
    return { type: 'success', title: 'Teste concluído', description: `Resposta recebida em ${formatMs(result.responseTime)}` }
  }
  if (result.canceled) return { type: 'info', title: 'Teste cancelado' }
  return {
    type: 'error',
    title: 'Falha no teste',
    description: result.errorDetail ? `${result.error}: ${result.errorDetail}` : result.error || 'Erro desconhecido',
  }
}

// One line of text for lists
export const excerpt = (text: string | null | undefined, max = 140): string => {
  const line = (text ?? '').replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}
