import type { Prompt } from '@/types'

export const PROMPT_TITLE_MAX_LENGTH = 200

export interface PromptFormState {
  title: string
  content: string
  description: string
  category_id: number | null
  template_id: number | null
  tags: string[]
  is_favorite: boolean
}

export const EMPTY_PROMPT_FORM: PromptFormState = {
  title: '',
  content: '',
  description: '',
  category_id: null,
  template_id: null,
  tags: [],
  is_favorite: false
}

export function formFromPrompt(prompt: Prompt): PromptFormState {
  return {
    title: prompt.title,
    content: prompt.content,
    description: prompt.description || '',
    category_id: prompt.category_id,
    template_id: prompt.template_id,
    tags: [...prompt.tags],
    is_favorite: prompt.is_favorite
  }
}

const toId = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null

// Drafts come from storage or from "Usar template" and may be partial ({ title, content, template_id, category_id })
export function normalizeDraft(draft: unknown): PromptFormState | null {
  if (!draft || typeof draft !== 'object') return null
  const d = draft as Record<string, unknown>
  return {
    title: typeof d.title === 'string' ? d.title : '',
    content: typeof d.content === 'string' ? d.content : '',
    description: typeof d.description === 'string' ? d.description : '',
    category_id: toId(d.category_id),
    template_id: toId(d.template_id),
    tags: Array.isArray(d.tags) ? d.tags.filter((tag): tag is string => typeof tag === 'string') : [],
    is_favorite: d.is_favorite === true
  }
}

// Which prompt a stored draft belongs to: null for a new prompt
export function draftOwnerId(draft: unknown): number | null {
  if (!draft || typeof draft !== 'object') return null
  return toId((draft as Record<string, unknown>).prompt_id)
}

export function sameForm(a: PromptFormState, b: PromptFormState): boolean {
  return (
    a.title === b.title &&
    a.content === b.content &&
    a.description === b.description &&
    a.category_id === b.category_id &&
    a.template_id === b.template_id &&
    a.is_favorite === b.is_favorite &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, index) => tag === b.tags[index])
  )
}

export function normalizeTag(raw: string): string {
  return raw.normalize('NFC').trim().replace(/\s+/g, ' ')
}

// Tags are unique regardless of letter case ("IA" and "ia" are the same tag)
export function findTag(tags: readonly string[], tag: string): string | undefined {
  const key = normalizeTag(tag).toLocaleLowerCase('pt-BR')
  return tags.find((existing) => existing.toLocaleLowerCase('pt-BR') === key)
}

export type AddTagResult =
  | { readonly status: 'added'; readonly tags: string[] }
  | { readonly status: 'empty' }
  | { readonly status: 'duplicate'; readonly existing: string }

export function addTag(tags: readonly string[], raw: string): AddTagResult {
  const tag = normalizeTag(raw)
  if (!tag) return { status: 'empty' }
  const existing = findTag(tags, tag)
  if (existing !== undefined) return { status: 'duplicate', existing }
  return { status: 'added', tags: [...tags, tag] }
}

// Tags to save: the list plus a tag still typed in the field (not confirmed with Enter), when it is new
export function tagsWithPending(tags: readonly string[], pending: string): string[] {
  const result = addTag(tags, pending)
  return result.status === 'added' ? result.tags : [...tags]
}

// Rough token count shown next to the character count. Heuristic: about 4 characters per token, the
// usual average of GPT/Claude tokenizers for English text and code (Portuguese tends to need a few
// more tokens). It is only an estimate: the exact count depends on the model's tokenizer.
export const CHARS_PER_TOKEN = 4

export function estimateTokens(text: string): number {
  return text.length === 0 ? 0 : Math.ceil(text.length / CHARS_PER_TOKEN)
}

// "1 caractere • ≈ 1 token (estimativa)", with pt-BR thousands separators
export function formatTextStats(text: string): { characters: string; tokens: string } {
  const length = text.length
  const tokens = estimateTokens(text)
  return {
    characters: `${length.toLocaleString('pt-BR')} ${length === 1 ? 'caractere' : 'caracteres'}`,
    tokens: `≈ ${tokens.toLocaleString('pt-BR')} ${tokens === 1 ? 'token' : 'tokens'} (estimativa)`
  }
}

export interface TitleCheck {
  readonly title: string
  readonly error: string | null
}

export function checkTitle(raw: string): TitleCheck {
  const title = raw.trim()
  if (!title) return { title, error: 'O título é obrigatório.' }
  if (title.length > PROMPT_TITLE_MAX_LENGTH) {
    return {
      title,
      error: `O título deve ter no máximo ${PROMPT_TITLE_MAX_LENGTH} caracteres (atual: ${title.length}).`
    }
  }
  return { title, error: null }
}
