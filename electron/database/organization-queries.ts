import type { Database } from 'sqlite3'
import type { BulkOperationResult, BulkPromptChanges, Prompt } from '../../src/types'
import {
  allQuery,
  cleanTags,
  compareSequenceSteps,
  getPrompt,
  getQuery,
  isSequenceCategory,
  nameKey,
  normalizeSequenceOrder,
  normalizeTags,
  runQuery,
} from './queries'

// Bulk actions receive at most this many prompts at once
const MAX_BULK_IDS = 10000
// SQLite limits the number of "?" in one statement: long id lists are sent in chunks
const ID_CHUNK = 500

const requireId = (value: unknown, message = 'Prompt inválido'): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(message)
  return value
}

// Positive integer ids, without duplicates, in the order received
const requireIds = (value: unknown): number[] => {
  if (!Array.isArray(value)) throw new Error('Lista de prompts inválida')
  if (value.length > MAX_BULK_IDS) throw new Error(`Selecione no máximo ${MAX_BULK_IDS.toLocaleString('pt-BR')} prompts por vez`)
  return [...new Set(value.map((id) => requireId(id, 'Lista de prompts inválida')))]
}

const chunks = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

const placeholders = (count: number) => new Array(count).fill('?').join(', ')

// Runs `work` inside one transaction (all or nothing)
const inTransaction = async <T>(db: Database, work: () => Promise<T>): Promise<T> => {
  await runQuery(db, 'BEGIN IMMEDIATE')
  try {
    const result = await work()
    await runQuery(db, 'COMMIT')
    return result
  } catch (error) {
    await runQuery(db, 'ROLLBACK').catch(() => {})
    throw error
  }
}

// Counts a copy or paste of the prompt. updated_at is not touched: using a prompt is not editing it.
export const recordPromptUsage = async (db: Database, id: number): Promise<Prompt> => {
  await new Promise<void>((resolve, reject) => {
    db.run(
      'UPDATE prompts SET usage_count = usage_count + 1, last_used_at = CURRENT_TIMESTAMP WHERE id = ?',
      [id],
      function (err) {
        if (err) return reject(err)
        if (this.changes === 0) return reject(new Error('Prompt não encontrado'))
        resolve()
      }
    )
  })
  const prompt = await getPrompt(db, id)
  if (!prompt) throw new Error('Prompt não encontrado')
  return prompt
}

// Pinned prompts are listed first. Like favorites, pinning is not an edit (updated_at is kept).
export const setPromptPinned = async (db: Database, id: unknown, pinned: unknown): Promise<Prompt> => {
  const promptId = requireId(id)
  const result = await runQuery(db, 'UPDATE prompts SET is_pinned = ? WHERE id = ?', [pinned ? 1 : 0, promptId])
  if (result.changes === 0) throw new Error('Prompt não encontrado')
  const prompt = await getPrompt(db, promptId)
  if (!prompt) throw new Error('Prompt não encontrado')
  return prompt
}

// Saves the step order of a category: `orderedIds` first, in that order; prompts of the category missing
// from the list keep their relative order after them. Ids of other categories are ignored (the prompt may
// have been moved in the meantime).
export const reorderPrompts = async (db: Database, categoryId: unknown, orderedIds: unknown): Promise<{ success: boolean }> => {
  const id = requireId(categoryId, 'Categoria inválida')
  const ids = requireIds(orderedIds)
  const category = await getQuery<{ id: number }>(db, 'SELECT id FROM categories WHERE id = ?', [id])
  if (!category) throw new Error('Categoria não encontrada')

  await inTransaction(db, async () => {
    const rows = await allQuery<{ id: number; title: string; sort_order: number | null }>(
      db, 'SELECT id, title, sort_order FROM prompts WHERE category_id = ?', [id]
    )
    const byId = new Map(rows.map((row) => [row.id, row]))
    const listed = ids.filter((promptId) => byId.has(promptId))
    const listedSet = new Set(listed)
    const rest = rows.filter((row) => !listedSet.has(row.id)).sort(compareSequenceSteps).map((row) => row.id)
    for (const [index, promptId] of [...listed, ...rest].entries()) {
      if (byId.get(promptId)?.sort_order !== index + 1) {
        await runQuery(db, 'UPDATE prompts SET sort_order = ? WHERE id = ?', [index + 1, promptId])
      }
    }
  })
  return { success: true }
}

const readBulkChanges = (value: unknown): BulkPromptChanges => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Alterações inválidas')
  return value as BulkPromptChanges
}

// Applies the same changes to many prompts in one transaction. Only prompts that really change are written;
// moving and tagging count as edits (updated_at), favoriting and pinning do not (same rule as updatePrompt).
export const bulkUpdatePrompts = async (db: Database, idsValue: unknown, changesValue: unknown): Promise<BulkOperationResult> => {
  const ids = requireIds(idsValue)
  const changes = readBulkChanges(changesValue)
  const addTags = Array.isArray(changes.addTags) ? cleanTags(changes.addTags) : []
  const removeKeys = new Set((Array.isArray(changes.removeTags) ? cleanTags(changes.removeTags) : []).map(nameKey))

  const movesCategory = changes.category_id !== undefined
  let targetCategory: number | null = null
  if (movesCategory && changes.category_id !== null) {
    targetCategory = requireId(changes.category_id, 'Categoria inválida')
    const exists = await getQuery<{ id: number }>(db, 'SELECT id FROM categories WHERE id = ?', [targetCategory])
    if (!exists) throw new Error('A categoria escolhida não existe mais')
  }
  if (ids.length === 0) return { success: true, affected: 0 }

  const affected = await inTransaction(db, async () => {
    const rows = new Map<number, { id: number; category_id: number | null; tags: unknown; is_favorite: number; is_pinned: number }>()
    for (const chunk of chunks(ids, ID_CHUNK)) {
      const found = await allQuery<{ id: number; category_id: number | null; tags: unknown; is_favorite: number; is_pinned: number }>(
        db, `SELECT id, category_id, tags, is_favorite, is_pinned FROM prompts WHERE id IN (${placeholders(chunk.length)})`, chunk
      )
      found.forEach((row) => rows.set(row.id, row))
    }

    // Prompts entering a sequence become its last steps, in the order received
    let nextPosition: number | null = null
    if (movesCategory && targetCategory !== null && (await isSequenceCategory(db, targetCategory))) {
      nextPosition = (await normalizeSequenceOrder(db, targetCategory)) + 1
    }

    let count = 0
    for (const id of ids) {
      const row = rows.get(id)
      if (!row) continue
      const updates: string[] = []
      const values: unknown[] = []
      let edited = false

      if (movesCategory && (row.category_id ?? null) !== targetCategory) {
        updates.push('category_id = ?', 'sort_order = ?')
        values.push(targetCategory, nextPosition)
        if (nextPosition !== null) nextPosition++
        edited = true
      }

      if (addTags.length > 0 || removeKeys.size > 0) {
        const current = normalizeTags(row.tags)
        const next = cleanTags([...current.filter((tag) => !removeKeys.has(nameKey(tag))), ...addTags])
        if (JSON.stringify(next) !== JSON.stringify(current)) {
          updates.push('tags = ?')
          values.push(JSON.stringify(next))
          edited = true
        }
      }

      if (changes.is_favorite !== undefined && Boolean(changes.is_favorite) !== Boolean(row.is_favorite)) {
        updates.push('is_favorite = ?')
        values.push(changes.is_favorite ? 1 : 0)
      }

      if (changes.is_pinned !== undefined && Boolean(changes.is_pinned) !== Boolean(row.is_pinned)) {
        updates.push('is_pinned = ?')
        values.push(changes.is_pinned ? 1 : 0)
      }

      if (updates.length === 0) continue
      if (edited) updates.push('updated_at = CURRENT_TIMESTAMP')
      await runQuery(db, `UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`, [...values, id])
      count++
    }
    return count
  })
  return { success: true, affected }
}

// Deletes many prompts in one transaction, with their versions and test results; runs of the "Testes"
// history keep the tested text but lose the link (same result as the FOREIGN KEY actions).
export const bulkDeletePrompts = async (db: Database, idsValue: unknown): Promise<BulkOperationResult> => {
  const ids = requireIds(idsValue)
  if (ids.length === 0) return { success: true, affected: 0 }
  const affected = await inTransaction(db, async () => {
    let count = 0
    for (const chunk of chunks(ids, ID_CHUNK)) {
      const list = placeholders(chunk.length)
      await runQuery(db, `DELETE FROM prompt_versions WHERE prompt_id IN (${list})`, chunk)
      await runQuery(db, `DELETE FROM test_results WHERE prompt_id IN (${list})`, chunk)
      await runQuery(db, `UPDATE test_runs SET prompt_id = NULL WHERE prompt_id IN (${list})`, chunk)
      count += (await runQuery(db, `DELETE FROM prompts WHERE id IN (${list})`, chunk)).changes
    }
    return count
  })
  return { success: true, affected }
}
