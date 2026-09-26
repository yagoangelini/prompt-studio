import { normalizeSearchText } from '@/lib/search-parser'
import type { Prompt } from '@/types'

// Search of the Ctrl+K palette: every typed word must appear (ignoring case and accents) in the
// item's main text (prompt title, action name) or in its secondary text (category and tags, or
// keywords). Items whose main text starts with the query come first.

export interface SearchEntry {
  // Normalized with normalizeSearchText
  readonly primary: string
  readonly secondary: string
}

export interface RankedItem<T> {
  readonly item: T
  readonly score: number
}

export function queryTerms(query: string): string[] {
  return normalizeSearchText(query).split(/\s+/).filter(Boolean)
}

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char)

// True when `term` appears at the start of a word of `text`
function startsWord(text: string, term: string): boolean {
  let index = text.indexOf(term)
  while (index !== -1) {
    if (index === 0 || !isWordChar(text[index - 1])) return true
    index = text.indexOf(term, index + 1)
  }
  return false
}

// Lower is better; null when the item does not match. An empty query matches everything with 0.
export function matchScore(entry: SearchEntry, terms: readonly string[]): number | null {
  if (terms.length === 0) return 0
  for (const term of terms) {
    if (!entry.primary.includes(term) && !entry.secondary.includes(term)) return null
  }
  if (entry.primary.startsWith(terms.join(' '))) return 0
  if (terms.every((term) => entry.primary.includes(term))) {
    return terms.every((term) => startsWord(entry.primary, term)) ? 1 : 2
  }
  return 3
}

export function rankItems<T>(
  items: readonly T[],
  getEntry: (item: T) => SearchEntry,
  terms: readonly string[],
  tieBreak: (a: T, b: T) => number
): RankedItem<T>[] {
  const ranked: RankedItem<T>[] = []
  for (const item of items) {
    const score = matchScore(getEntry(item), terms)
    if (score !== null) ranked.push({ item, score })
  }
  return ranked.sort((a, b) => a.score - b.score || tieBreak(a.item, b.item))
}

const promptEntries = new WeakMap<Prompt, SearchEntry>()

// Prompts are replaced (never mutated) when they change, so the cache follows the object
export function promptSearchEntry(prompt: Prompt): SearchEntry {
  let entry = promptEntries.get(prompt)
  if (!entry) {
    entry = {
      primary: normalizeSearchText(prompt.title),
      secondary: normalizeSearchText([prompt.category_name ?? '', ...prompt.tags].join(' '))
    }
    promptEntries.set(prompt, entry)
  }
  return entry
}

const titleCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

// Pinned first, then the most used, then by title
export function comparePrompts(a: Prompt, b: Prompt): number {
  return (
    Number(Boolean(b.is_pinned)) - Number(Boolean(a.is_pinned)) ||
    (b.usage_count ?? 0) - (a.usage_count ?? 0) ||
    titleCollator.compare(a.title, b.title)
  )
}

const lastUsed = (prompt: Prompt) => prompt.last_used_at ?? ''

// Shown before anything is typed: pinned prompts, then the recently used or opened ones
export function suggestedPrompts(
  prompts: readonly Prompt[],
  recentIds: readonly number[],
  limit = 8
): Prompt[] {
  const result: Prompt[] = []
  const seen = new Set<number>()
  const add = (prompt: Prompt | undefined) => {
    if (!prompt || seen.has(prompt.id) || result.length >= limit) return
    seen.add(prompt.id)
    result.push(prompt)
  }
  prompts.filter((p) => p.is_pinned).sort((a, b) => titleCollator.compare(a.title, b.title)).forEach(add)
  // SQLite UTC timestamps ("YYYY-MM-DD HH:MM:SS") sort correctly as strings
  prompts.filter((p) => p.last_used_at).sort((a, b) => lastUsed(b).localeCompare(lastUsed(a))).forEach(add)
  const byId = new Map(prompts.map((p) => [p.id, p]))
  recentIds.forEach((id) => add(byId.get(id)))
  return result
}
