import { getFreeTextTerms, normalizeSearchText } from '@/lib/search-parser'
import { extractVariables } from '@/components/templates/template-variables'
import { parseDbDate } from '@/lib/utils'
import type { Prompt } from '@/types'

// The list shows at most this many prompts; typing narrows it down
export const QUICK_PASTE_MAX_ITEMS = 200

const PREVIEW_LENGTH = 160

interface SearchableFields {
  readonly title: string
  // Category name and tags
  readonly labels: string
  // Description and content
  readonly body: string
}

// Normalized texts per prompt object (the store replaces prompts on change, never mutates them)
const searchableCache = new WeakMap<Prompt, SearchableFields>()

function getSearchable(prompt: Prompt): SearchableFields {
  let fields = searchableCache.get(prompt)
  if (!fields) {
    fields = {
      title: normalizeSearchText(prompt.title),
      labels: normalizeSearchText([prompt.category_name ?? '', ...prompt.tags].join('\n')),
      body: normalizeSearchText(`${prompt.description ?? ''}\n${prompt.content}`),
    }
    searchableCache.set(prompt, fields)
  }
  return fields
}

const timestamp = (value: string | null | undefined): number => {
  if (!value) return 0
  const time = parseDbDate(value).getTime()
  return Number.isFinite(time) ? time : 0
}

const titleCollator = new Intl.Collator('pt-BR', { sensitivity: 'base', numeric: true })

// Default order: pinned first, then the most used, then the most recently used or edited
export function compareForQuickPaste(a: Prompt, b: Prompt): number {
  if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
  const usage = (b.usage_count ?? 0) - (a.usage_count ?? 0)
  if (usage !== 0) return usage
  const lastUsed = timestamp(b.last_used_at) - timestamp(a.last_used_at)
  if (lastUsed !== 0) return lastUsed
  const updated = timestamp(b.updated_at) - timestamp(a.updated_at)
  if (updated !== 0) return updated
  return titleCollator.compare(a.title, b.title)
}

/**
 * Prompts for the quick paste list. Without a query: default order. With a query (title, content,
 * description, tags and category; ignoring case and accents), every word or "quoted phrase" must match;
 * prompts whose title has every word come first, then the ones matched by title, category or tags, then
 * the others (content), each group in the default order.
 */
export function searchQuickPastePrompts(prompts: readonly Prompt[], query: string): Prompt[] {
  const terms = getFreeTextTerms(query)
  if (terms.length === 0) return [...prompts].sort(compareForQuickPaste)

  const ranked: { prompt: Prompt; tier: number }[] = []
  for (const prompt of prompts) {
    const { title, labels, body } = getSearchable(prompt)
    let inTitle = 0
    let inLabels = 0
    let matchesAll = true
    for (const term of terms) {
      if (title.includes(term)) inTitle++
      else if (labels.includes(term)) inLabels++
      else if (!body.includes(term)) {
        matchesAll = false
        break
      }
    }
    if (!matchesAll) continue
    const tier = inTitle === terms.length ? 0 : inTitle + inLabels === terms.length ? 1 : 2
    ranked.push({ prompt, tier })
  }
  ranked.sort((a, b) => a.tier - b.tier || compareForQuickPaste(a.prompt, b.prompt))
  return ranked.map((entry) => entry.prompt)
}

// One line of the content for the list: whitespace collapsed, cut at PREVIEW_LENGTH characters
export function getPromptPreview(content: string): string {
  const line = content.replace(/\s+/g, ' ').trim()
  return line.length > PREVIEW_LENGTH ? `${line.slice(0, PREVIEW_LENGTH - 1).trimEnd()}…` : line
}

export function promptHasVariables(prompt: Pick<Prompt, 'content'>): boolean {
  return extractVariables(prompt.content).length > 0
}
