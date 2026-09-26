import { Database } from 'sqlite3'
import { writeFileSync, readFileSync } from 'fs'
import { extname, basename } from 'path'
import type {
  Prompt,
  Category,
  Template,
  PromptVersion,
  CreatePromptData,
  UpdatePromptData,
  CreateCategoryData,
  UpdateCategoryData,
  CreateTemplateData,
  UpdateTemplateData,
  ExportData,
  ImportResult,
  TagOperationResult,
} from '../../src/types'

// Utility function to promisify database operations with transaction support
export const runQuery = (db: Database, sql: string, params: any[] = []): Promise<{ id: number; changes: number }> => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run(sql, params, function(err) {
        if (err) {
          reject(err)
        } else {
          resolve({ id: this.lastID, changes: this.changes })
        }
      })
    })
  })
}

export const getQuery = <T = any>(db: Database, sql: string, params: any[] = []): Promise<T | undefined> => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        reject(err)
      } else {
        resolve(row as T | undefined)
      }
    })
  })
}

export const allQuery = <T = any>(db: Database, sql: string, params: any[] = []): Promise<T[]> => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err)
      } else {
        resolve(rows as T[])
      }
    })
  })
}

// TAGS / VARIABLES NORMALIZATION

// Same rule as the search (src/lib/search-parser.ts normalizeSearchText): case and accents are ignored,
// so names that the search would treat as one ("Análise" / "analise") can't coexist
export const nameKey = (value: string): string => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()

const sameName = (a: string, b: string): boolean => nameKey(a) === nameKey(b)

// Trimmed, non-empty strings without case-insensitive duplicates (the first spelling wins)
export const cleanTags = (values: readonly unknown[]): string[] => {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' && typeof value !== 'number') continue
    const tag = String(value).trim()
    const key = nameKey(tag)
    if (!tag || seen.has(key)) continue
    seen.add(key)
    result.push(tag)
  }
  return result
}

// Tags are stored as a JSON array, but a database written by an older import may hold any value
// (e.g. the plain text "a, b"): never let one bad row break the lists in the UI.
export const normalizeTags = (raw: unknown): string[] => {
  let value = raw
  if (typeof value === 'string') {
    const text = value.trim()
    if (!text) return []
    try {
      value = JSON.parse(text)
    } catch {
      value = text
    }
    if (typeof value === 'string') return cleanTags(value.split(','))
  }
  if (typeof value === 'number') return cleanTags([value])
  if (Array.isArray(value)) return cleanTags(value)
  return []
}

// Variable names detected in prompt/template contents: {{nome}}, also with spaces ({{ nome }})
const VARIABLE_PATTERN = /\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu

export const extractTemplateVariables = (content: string): string[] => {
  const names: string[] = []
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]
    if (name && !names.includes(name)) names.push(name)
  }
  return names
}

// Replaces {{name}} / {{ name }} with the given values in a single literal pass. No RegExp is built
// from the names (a crafted name used to freeze the main process) and inserted values are never
// scanned again, so "$&" or "{{other}}" inside a value stay exactly as sent.
export const applyTemplateVariables = (
  content: string,
  variables: Readonly<Record<string, unknown>>
): string => {
  let result = ''
  let cursor = 0
  let searchFrom = 0
  for (;;) {
    const open = content.indexOf('{{', searchFrom)
    if (open === -1) break
    const close = content.indexOf('}}', open + 2)
    if (close === -1) break
    const inner = content.slice(open + 2, close)
    const lastBrace = inner.lastIndexOf('{')
    if (lastBrace !== -1) {
      // "{{{x}}}": the placeholder starts at the last "{{" before the closing braces
      searchFrom = open + 1 + lastBrace
      continue
    }
    const name = inner.trim()
    if (name && Object.prototype.hasOwnProperty.call(variables, name)) {
      result += content.slice(cursor, open) + String(variables[name])
      cursor = close + 2
    }
    searchFrom = close + 2
  }
  return result + content.slice(cursor)
}

const toPrompt = (row: any): Prompt => ({
  ...row,
  tags: normalizeTags(row.tags),
  is_favorite: Boolean(row.is_favorite),
  is_pinned: Boolean(row.is_pinned),
  usage_count: Number(row.usage_count ?? 0),
  last_used_at: row.last_used_at ?? null,
  sort_order: row.sort_order ?? null,
})

const toCategory = (row: any): Category => ({
  ...row,
  parent_id: row.parent_id ?? null,
  is_sequence: Boolean(row.is_sequence),
})

const toTemplate = (row: any): Template => ({
  ...row,
  variables: normalizeTags(row.variables),
})

// SEQUENCES (categories whose prompts are ordered steps)

const titleCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

interface SequenceStepRow {
  id: number
  title: string
  sort_order: number | null
}

// Step order: manual position first; prompts without one (null) come after them, by title. The renderer
// uses the same rule (compareSequenceSteps in src/components/organization/organization-utils.ts).
export const compareSequenceSteps = (a: SequenceStepRow, b: SequenceStepRow): number => {
  const left = a.sort_order ?? null
  const right = b.sort_order ?? null
  if (left !== right) {
    if (left === null) return 1
    if (right === null) return -1
    return left - right
  }
  return titleCollator.compare(a.title, b.title) || a.id - b.id
}

export const isSequenceCategory = async (db: Database, categoryId: number | null | undefined): Promise<boolean> => {
  if (!categoryId) return false
  const row = await getQuery<{ is_sequence: number }>(db, 'SELECT is_sequence FROM categories WHERE id = ?', [categoryId])
  return Boolean(row?.is_sequence)
}

// Numbers the prompts of a category 1..n in their current step order, so the next prompt can go to the end
// (n + 1) even when some steps had no position yet. Returns n.
export const normalizeSequenceOrder = async (db: Database, categoryId: number): Promise<number> => {
  const rows = await allQuery<SequenceStepRow>(db, 'SELECT id, title, sort_order FROM prompts WHERE category_id = ?', [categoryId])
  rows.sort(compareSequenceSteps)
  for (const [index, row] of rows.entries()) {
    if (row.sort_order !== index + 1) {
      await runQuery(db, 'UPDATE prompts SET sort_order = ? WHERE id = ?', [index + 1, row.id])
    }
  }
  return rows.length
}

// Position of a prompt that enters the category: the end of the sequence, or null for other categories
const positionInCategory = async (db: Database, categoryId: number | null): Promise<number | null> =>
  categoryId && (await isSequenceCategory(db, categoryId)) ? (await normalizeSequenceOrder(db, categoryId)) + 1 : null

// PROMPTS OPERATIONS
const PROMPT_SELECT = `
  SELECT p.*, c.name as category_name, c.color as category_color,
         t.name as template_name
  FROM prompts p
  LEFT JOIN categories c ON p.category_id = c.id
  LEFT JOIN templates t ON p.template_id = t.id
`

export const getAllPrompts = async (db: Database): Promise<readonly Prompt[]> => {
  const rows = await allQuery<any>(db, `${PROMPT_SELECT} ORDER BY p.updated_at DESC`)
  return rows.map(toPrompt)
}

export const getPrompt = async (db: Database, id: number): Promise<Prompt | null> => {
  const row = await getQuery<any>(db, `${PROMPT_SELECT} WHERE p.id = ?`, [id])
  return row ? toPrompt(row) : null
}

const requireText = (value: unknown, message: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value
}

const optionalText = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null

export const createPrompt = async (db: Database, prompt: CreatePromptData): Promise<Prompt> => {
  const { description, category_id, template_id, tags, is_favorite } = prompt
  const title = requireText(prompt.title, 'O título do prompt é obrigatório').trim()
  const content = requireText(prompt.content, 'O conteúdo do prompt é obrigatório')
  const categoryId = category_id || null
  // A new prompt in a sequence category becomes its last step
  const sortOrder = await positionInCategory(db, categoryId)
  const sql = `
    INSERT INTO prompts (title, content, description, category_id, template_id, tags, is_favorite, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `
  const result = await runQuery(db, sql, [
    title,
    content,
    optionalText(description),
    categoryId,
    template_id || null,
    JSON.stringify(cleanTags(tags || [])),
    is_favorite ? 1 : 0,
    sortOrder
  ])

  // Create initial version
  await createPromptVersion(db, result.id, content)

  const created = await getPrompt(db, result.id)
  if (!created) throw new Error('Não foi possível criar o prompt')
  return created
}

export const updatePrompt = async (db: Database, id: number, prompt: UpdatePromptData): Promise<Prompt> => {
  const { title, content, description, category_id, template_id, tags, is_favorite, is_pinned } = prompt

  const currentPrompt = await getPrompt(db, id)
  if (!currentPrompt) throw new Error('Prompt não encontrado')

  // Only columns whose value really changes are written. updated_at ("Editados recentemente")
  // moves only when the prompt itself changes: marking it as favorite is not an edit.
  const updates: string[] = []
  const values: any[] = []
  let edited = false
  const change = (column: string, value: unknown, isEdit = true) => {
    updates.push(`${column} = ?`)
    values.push(value)
    if (isEdit) edited = true
  }

  if (title !== undefined) {
    const newTitle = requireText(title, 'O título do prompt é obrigatório').trim()
    if (newTitle !== currentPrompt.title) change('title', newTitle)
  }

  let contentChanged = false
  if (content !== undefined) {
    const newContent = requireText(content, 'O conteúdo do prompt é obrigatório')
    if (newContent !== currentPrompt.content) {
      change('content', newContent)
      contentChanged = true
    }
  }

  // null (or an empty text) clears the field
  if (description !== undefined) {
    const newDescription = optionalText(description)
    if (newDescription !== (currentPrompt.description ?? null)) change('description', newDescription)
  }

  if (category_id !== undefined) {
    const newCategoryId = category_id || null
    if (newCategoryId !== (currentPrompt.category_id ?? null)) {
      change('category_id', newCategoryId)
      // Entering a sequence makes the prompt its last step; any other category has no step order
      change('sort_order', await positionInCategory(db, newCategoryId), false)
    }
  }

  if (template_id !== undefined) {
    const newTemplateId = template_id || null
    if (newTemplateId !== (currentPrompt.template_id ?? null)) change('template_id', newTemplateId)
  }

  if (tags !== undefined) {
    const newTags = cleanTags(tags || [])
    if (JSON.stringify(newTags) !== JSON.stringify(currentPrompt.tags)) change('tags', JSON.stringify(newTags))
  }

  if (is_favorite !== undefined) {
    const newFavorite = Boolean(is_favorite)
    if (newFavorite !== currentPrompt.is_favorite) change('is_favorite', newFavorite ? 1 : 0, false)
  }

  // Pinning is not an edit either
  if (is_pinned !== undefined) {
    const newPinned = Boolean(is_pinned)
    if (newPinned !== currentPrompt.is_pinned) change('is_pinned', newPinned ? 1 : 0, false)
  }

  if (updates.length === 0) {
    return currentPrompt
  }

  if (edited) updates.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id) // Add id for WHERE clause

  const sql = `UPDATE prompts SET ${updates.join(', ')} WHERE id = ?`
  await runQuery(db, sql, values)

  if (contentChanged) {
    const versions = await getPromptVersions(db, id)
    await createPromptVersion(db, id, content as string, (versions[0]?.version_number ?? 0) + 1)
  }

  const updated = await getPrompt(db, id)
  if (!updated) throw new Error('Não foi possível atualizar o prompt')
  return updated
}

export const deletePrompt = async (db: Database, id: number): Promise<{ success: boolean }> => {
  const sql = 'DELETE FROM prompts WHERE id = ?'
  await runQuery(db, sql, [id])
  return { success: true }
}

export const searchPrompts = async (db: Database, query: string): Promise<readonly Prompt[]> => {
  const sql = `${PROMPT_SELECT}
    WHERE p.title LIKE ? OR p.content LIKE ? OR p.description LIKE ?
    ORDER BY p.updated_at DESC
  `
  const searchTerm = `%${query}%`
  const rows = await allQuery<any>(db, sql, [searchTerm, searchTerm, searchTerm])
  return rows.map(toPrompt)
}

export const getPromptsByTag = async (db: Database, tag: string): Promise<readonly Prompt[]> => {
  // Filtered after normalization: a LIKE on the raw JSON missed tags with quotes and malformed rows
  const prompts = await getAllPrompts(db)
  return prompts.filter((prompt) => prompt.tags.includes(tag))
}

export const getAllTags = async (db: Database): Promise<readonly string[]> => {
  const rows = await allQuery<{ tags: unknown }>(db, 'SELECT tags FROM prompts WHERE tags IS NOT NULL')
  const allTags = new Set<string>()
  rows.forEach((row) => normalizeTags(row.tags).forEach((tag) => allTags.add(tag)))
  return Array.from(allTags).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }))
}

// Rewrites the tags of every prompt for which `transform` returns a new list (null = unchanged).
// Like renaming a category, this does not count as editing the prompts (updated_at is kept).
const rewriteTags = async (
  db: Database,
  transform: (tags: string[]) => string[] | null
): Promise<TagOperationResult> => {
  const rows = await allQuery<{ id: number; tags: unknown }>(db, 'SELECT id, tags FROM prompts')
  let updated = 0
  await runQuery(db, 'BEGIN IMMEDIATE')
  try {
    for (const row of rows) {
      const next = transform(normalizeTags(row.tags))
      if (!next) continue
      await runQuery(db, 'UPDATE prompts SET tags = ? WHERE id = ?', [JSON.stringify(next), row.id])
      updated++
    }
    await runQuery(db, 'COMMIT')
  } catch (error) {
    await runQuery(db, 'ROLLBACK').catch(() => {})
    throw error
  }
  return { success: true, updated }
}

export const renameTag = async (db: Database, oldName: string, newName: string): Promise<TagOperationResult> => {
  if (typeof oldName !== 'string' || !oldName) throw new Error('Tag inválida')
  const target = typeof newName === 'string' ? newName.trim() : ''
  if (!target) throw new Error('Informe o novo nome da tag')
  if (target === oldName) return { success: true, updated: 0 }
  // Renaming onto a tag that already exists merges the two and keeps the existing spelling
  // ("Escrita" onto "escrita"), so the library never ends up with tags that differ only in case or accents
  const existing = (await getAllTags(db)).find((tag) => tag !== oldName && sameName(tag, target))
  const finalName = existing ?? target
  // cleanTags removes the duplicate in prompts that already had both tags
  return rewriteTags(db, (tags) =>
    tags.includes(oldName) ? cleanTags(tags.map((tag) => (tag === oldName ? finalName : tag))) : null
  )
}

export const deleteTag = async (db: Database, name: string): Promise<TagOperationResult> => {
  if (typeof name !== 'string' || !name) throw new Error('Tag inválida')
  return rewriteTags(db, (tags) => (tags.includes(name) ? tags.filter((tag) => tag !== name) : null))
}

// PROMPT VERSIONS
export const getPromptVersions = async (db: Database, promptId: number): Promise<readonly PromptVersion[]> => {
  const sql = `
    SELECT * FROM prompt_versions
    WHERE prompt_id = ?
    ORDER BY version_number DESC
  `
  return await allQuery<PromptVersion>(db, sql, [promptId]) as readonly PromptVersion[]
}

export const createPromptVersion = async (db: Database, promptId: number, content: string, versionNumber?: number): Promise<PromptVersion> => {
  if (!versionNumber) {
    const versions = await getPromptVersions(db, promptId)
    versionNumber = (versions[0]?.version_number ?? 0) + 1
  }

  const sql = `
    INSERT INTO prompt_versions (prompt_id, content, version_number)
    VALUES (?, ?, ?)
  `
  const result = await runQuery(db, sql, [promptId, content, versionNumber])

  return {
    id: result.id,
    prompt_id: promptId,
    content,
    version_number: versionNumber,
    created_at: new Date().toISOString()
  }
}

// CATEGORIES
export const getAllCategories = async (db: Database): Promise<readonly Category[]> => {
  const sql = 'SELECT * FROM categories ORDER BY name'
  return (await allQuery<any>(db, sql)).map(toCategory)
}

const duplicateCategoryMessage = (name: string) => `Já existe uma categoria chamada "${name}"`

// categories.name is UNIQUE: turn SQLite's raw constraint error into a message the user can act on
const rethrowCategoryError = (error: unknown, name: string | undefined): never => {
  if (error instanceof Error && error.message.includes('UNIQUE constraint failed: categories.name')) {
    throw new Error(duplicateCategoryMessage(name ?? ''))
  }
  throw error
}

// Case-insensitive lookup done in JS: SQLite's lower() only folds ASCII letters ("Ç", "É"...)
const findCategoryByName = async (db: Database, name: string, exceptId?: number): Promise<Category | undefined> => {
  const categories = await allQuery<Category>(db, 'SELECT * FROM categories')
  return categories.find((category) => category.id !== exceptId && sameName(category.name, name))
}

const requireCategoryName = (name: unknown): string => {
  const trimmed = typeof name === 'string' ? name.trim() : ''
  if (!trimmed) throw new Error('Informe o nome da categoria')
  return trimmed
}

// Validates the parent of a category (null = top level). For an existing category, the parent can be neither
// the category itself nor one of its subcategories: that would create a cycle.
const resolveParentId = async (db: Database, value: unknown, categoryId?: number): Promise<number | null> => {
  if (value === null || value === undefined || value === '' || value === 0) return null
  const parentId = Number(value)
  if (!Number.isInteger(parentId) || parentId <= 0) throw new Error('Categoria pai inválida')
  if (parentId === categoryId) throw new Error('Uma categoria não pode ser subcategoria dela mesma')
  const rows = await allQuery<{ id: number; parent_id: number | null }>(db, 'SELECT id, parent_id FROM categories')
  const parents = new Map(rows.map((row) => [row.id, row.parent_id ?? null]))
  if (!parents.has(parentId)) throw new Error('A categoria pai escolhida não existe mais')
  if (categoryId !== undefined) {
    const visited = new Set<number>()
    for (let current: number | null = parentId; current !== null && !visited.has(current); current = parents.get(current) ?? null) {
      if (current === categoryId) {
        throw new Error('Não é possível colocar uma categoria dentro de uma das suas subcategorias')
      }
      visited.add(current)
    }
  }
  return parentId
}

export const createCategory = async (db: Database, category: CreateCategoryData): Promise<Category> => {
  const name = requireCategoryName(category.name)
  const { description, color } = category
  const existing = await findCategoryByName(db, name)
  if (existing) throw new Error(duplicateCategoryMessage(existing.name))
  const parentId = await resolveParentId(db, category.parent_id)

  const sql = 'INSERT INTO categories (name, description, color, parent_id, is_sequence) VALUES (?, ?, ?, ?, ?)'
  const result = await runQuery(db, sql, [name, description || null, color || '#007acc', parentId, category.is_sequence ? 1 : 0])
    .catch((error) => rethrowCategoryError(error, name))

  const createdRow = await getQuery<any>(db, 'SELECT * FROM categories WHERE id = ?', [result.id])
  const created = createdRow ? toCategory(createdRow) : undefined
  if (!created) throw new Error('Não foi possível criar a categoria')
  return created
}

export const updateCategory = async (db: Database, id: number, category: UpdateCategoryData): Promise<Category> => {
  const currentRow = await getQuery<any>(db, 'SELECT * FROM categories WHERE id = ?', [id])
  if (!currentRow) throw new Error('Categoria não encontrada')
  const current = toCategory(currentRow)

  // Fields left undefined keep their current value
  const name = category.name !== undefined ? requireCategoryName(category.name) : current.name
  const description = category.description !== undefined ? category.description || null : current.description
  const color = category.color || current.color || '#007acc'
  const parentId = category.parent_id !== undefined ? await resolveParentId(db, category.parent_id, id) : current.parent_id
  const isSequence = category.is_sequence !== undefined ? Boolean(category.is_sequence) : current.is_sequence

  const existing = await findCategoryByName(db, name, id)
  if (existing) throw new Error(duplicateCategoryMessage(existing.name))

  const sql = `
    UPDATE categories
    SET name = ?, description = ?, color = ?, parent_id = ?, is_sequence = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  await runQuery(db, sql, [name, description, color, parentId, isSequence ? 1 : 0, id])
    .catch((error) => rethrowCategoryError(error, name))

  // A category that becomes a sequence numbers its prompts in the current order (title for the unordered
  // ones), so new prompts go to the end. Turning it off keeps the positions for later.
  if (isSequence && !current.is_sequence) await normalizeSequenceOrder(db, id)

  const updatedRow = await getQuery<any>(db, 'SELECT * FROM categories WHERE id = ?', [id])
  const updated = updatedRow ? toCategory(updatedRow) : undefined
  if (!updated) throw new Error('Não foi possível atualizar a categoria')
  return updated
}

export const deleteCategory = async (db: Database, id: number): Promise<{ success: boolean }> => {
  // Prompts, templates and subcategories reference categories (FOREIGN KEY), so all of them must be
  // detached before the delete. One transaction, so a failure never leaves prompts without their category.
  await runQuery(db, 'BEGIN IMMEDIATE')
  try {
    const category = await getQuery<{ parent_id: number | null }>(db, 'SELECT parent_id FROM categories WHERE id = ?', [id])
    // Subcategories move up one level (to the parent of the deleted category, or to the top level)
    const newParentId = category?.parent_id && category.parent_id !== id ? category.parent_id : null
    await runQuery(db, 'UPDATE categories SET parent_id = ?, updated_at = CURRENT_TIMESTAMP WHERE parent_id = ?', [newParentId, id])
    await runQuery(db, 'UPDATE prompts SET category_id = NULL, sort_order = NULL WHERE category_id = ?', [id])
    await runQuery(db, 'UPDATE templates SET category_id = NULL WHERE category_id = ?', [id])
    await runQuery(db, 'DELETE FROM categories WHERE id = ?', [id])
    await runQuery(db, 'COMMIT')
  } catch (error) {
    await runQuery(db, 'ROLLBACK').catch(() => {})
    throw error
  }
  return { success: true }
}

// TEMPLATES
const TEMPLATE_SELECT = `
  SELECT t.*, c.name as category_name, c.color as category_color
  FROM templates t
  LEFT JOIN categories c ON t.category_id = c.id
`

export const getAllTemplates = async (db: Database): Promise<readonly Template[]> => {
  const rows = await allQuery<any>(db, `${TEMPLATE_SELECT} ORDER BY t.name`)
  return rows.map(toTemplate)
}

export const createTemplate = async (db: Database, template: CreateTemplateData): Promise<Template> => {
  const { name, description, content, variables, category_id } = template
  const sql = `
    INSERT INTO templates (name, description, content, variables, category_id)
    VALUES (?, ?, ?, ?, ?)
  `
  const result = await runQuery(db, sql, [
    name,
    description || null,
    content,
    JSON.stringify(variables || []),
    category_id || null
  ])

  const created = await getQuery<any>(db, `${TEMPLATE_SELECT} WHERE t.id = ?`, [result.id])
  if (!created) throw new Error('Não foi possível criar o template')
  return toTemplate(created)
}

export const updateTemplate = async (db: Database, id: number, template: UpdateTemplateData): Promise<Template> => {
  const { name, description, content, variables, category_id } = template
  const sql = `
    UPDATE templates
    SET name = ?, description = ?, content = ?, variables = ?, category_id = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `
  await runQuery(db, sql, [
    name,
    description || null,
    content,
    JSON.stringify(variables || []),
    category_id || null,
    id
  ])

  const updated = await getQuery<any>(db, `${TEMPLATE_SELECT} WHERE t.id = ?`, [id])
  if (!updated) throw new Error('Não foi possível atualizar o template')
  return toTemplate(updated)
}

export const deleteTemplate = async (db: Database, id: number): Promise<{ success: boolean }> => {
  // First, update prompts to remove the template reference
  await runQuery(db, 'UPDATE prompts SET template_id = NULL WHERE template_id = ?', [id])
  // Then delete the template
  await runQuery(db, 'DELETE FROM templates WHERE id = ?', [id])
  return { success: true }
}

export const generateFromTemplate = async (db: Database, templateId: number, variables: Record<string, string>): Promise<CreatePromptData> => {
  const template = await getQuery<Template>(db, 'SELECT * FROM templates WHERE id = ?', [templateId])
  if (!template) {
    throw new Error('Template não encontrado')
  }

  const safeVariables = variables && typeof variables === 'object' ? variables : {}

  return {
    title: `Gerado a partir de ${template.name}`,
    content: applyTemplateVariables(template.content, safeVariables),
    template_id: templateId,
    category_id: template.category_id
  }
}

// SETTINGS
export const getSetting = async (db: Database, key: string): Promise<string | null> => {
  const row = await getQuery<{ value: string }>(db, 'SELECT value FROM settings WHERE key = ?', [key])
  return row ? row.value : null
}

export const setSetting = async (db: Database, key: string, value: string): Promise<{ key: string; value: string }> => {
  const sql = `
    INSERT OR REPLACE INTO settings (key, value, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `
  await runQuery(db, sql, [key, value])
  return { key, value }
}

// EXPORT/IMPORT

// 2.1: categories carry "parent" (name) and "is_sequence"; prompts carry is_pinned, sort_order, usage_count and
// last_used_at. Files without these fields (2.0 and older) still import.
const EXPORT_FORMAT_VERSION = '2.1'

type ExportedCategory = ExportData['categories'][number] & { parent: string | null; is_sequence: boolean }
type ExportedPrompt = ExportData['prompts'][number] & {
  is_pinned: boolean
  sort_order: number | null
  usage_count: number
  last_used_at: string | null
}
interface FullExportData extends Omit<ExportData, 'categories' | 'prompts'> {
  readonly categories: readonly ExportedCategory[]
  readonly prompts: readonly ExportedPrompt[]
}
const TXT_TITLE = 'Exportação do Prompt Studio'
const TXT_DESCRIPTION_MARKER = '----- Descrição -----'
const TXT_CONTENT_MARKER = '----- Conteúdo -----'
const MAX_IMPORT_BYTES = 20 * 1024 * 1024
const MAX_REPORTED_ERRORS = 20
const DEFAULT_CATEGORY_COLOR = '#007acc'

// pt-BR explanation for fs errors (the raw message is English and shows the full path)
export const describeFileError = (error: unknown): string => {
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  switch (code) {
    case 'ENOENT': return 'o arquivo ou a pasta não existe'
    case 'EACCES':
    case 'EPERM': return 'sem permissão para acessar o arquivo'
    case 'EISDIR': return 'o caminho escolhido é uma pasta'
    case 'EBUSY': return 'o arquivo está em uso por outro programa'
    case 'ENOSPC': return 'não há espaço livre no disco'
    case 'EROFS': return 'o local escolhido é somente leitura'
    default: return error instanceof Error ? error.message : 'erro desconhecido'
  }
}

// SQLite dates are UTC without a zone marker; show them in local time
const formatDbDate = (value: string | null | undefined): string => {
  if (!value) return ''
  const date = new Date(`${value.replace(' ', 'T')}Z`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('pt-BR')
}

const formatTxtExport = (prompts: readonly Prompt[]): string => {
  const lines: string[] = [
    TXT_TITLE,
    '='.repeat(TXT_TITLE.length),
    `Exportado em: ${new Date().toLocaleString('pt-BR')}`,
    `Total de prompts: ${prompts.length}`,
    '',
  ]
  prompts.forEach((prompt, index) => {
    const number = index + 1
    lines.push(`===== Prompt ${number} de ${prompts.length} =====`)
    lines.push(`Título: ${prompt.title}`)
    if (prompt.category_name) lines.push(`Categoria: ${prompt.category_name}`)
    if (prompt.tags.length > 0) lines.push(`Tags: ${prompt.tags.join(', ')}`)
    lines.push(`Favorito: ${prompt.is_favorite ? 'Sim' : 'Não'}`)
    lines.push(`Criado em: ${formatDbDate(prompt.created_at)}`)
    if (prompt.description) {
      lines.push(TXT_DESCRIPTION_MARKER, prompt.description)
    }
    lines.push(TXT_CONTENT_MARKER, prompt.content)
    lines.push(`===== Fim do prompt ${number} =====`, '')
  })
  return lines.join('\n')
}

export const exportPrompts = async (db: Database, filePath: string, format: 'json' | 'txt' = 'json'): Promise<{ count: number }> => {
  if (format !== 'json' && format !== 'txt') {
    throw new Error('Formato de exportação inválido. Use JSON ou TXT.')
  }
  const [prompts, categories, templates] = await Promise.all([
    getAllPrompts(db),
    getAllCategories(db),
    getAllTemplates(db),
  ])

  let data: string
  if (format === 'json') {
    const categoryNames = new Map(categories.map((c) => [c.id, c.name]))
    const exportData: FullExportData = {
      app: 'Prompt Studio',
      version: EXPORT_FORMAT_VERSION,
      exported_at: new Date().toISOString(),
      categories: categories.map((c) => ({
        name: c.name,
        description: c.description,
        color: c.color,
        parent: (c.parent_id !== null && categoryNames.get(c.parent_id)) || null,
        is_sequence: c.is_sequence,
      })),
      templates: templates.map((t) => ({
        name: t.name,
        description: t.description,
        content: t.content,
        variables: [...t.variables],
        category_name: t.category_name ?? null,
      })),
      prompts: prompts.map((p) => ({
        title: p.title,
        content: p.content,
        description: p.description,
        category_name: p.category_name ?? null,
        template_name: p.template_name ?? null,
        tags: [...p.tags],
        is_favorite: p.is_favorite,
        is_pinned: p.is_pinned,
        sort_order: p.sort_order,
        usage_count: p.usage_count,
        last_used_at: p.last_used_at,
        created_at: p.created_at,
        updated_at: p.updated_at,
      })),
    }
    data = JSON.stringify(exportData, null, 2)
  } else {
    data = formatTxtExport(prompts)
  }

  try {
    writeFileSync(filePath, data, 'utf8')
  } catch (error) {
    throw new Error(`Não foi possível salvar o arquivo: ${describeFileError(error)}.`)
  }
  return { count: prompts.length }
}

// Text of a file, or null when it looks binary (an image, a .db file...)
const decodeTextFile = (buffer: Buffer): string | null => {
  // UTF-16 with BOM (what Windows Notepad calls "Unicode")
  const utf16 = buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe ? 'utf-16le'
    : buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff ? 'utf-16be'
    : null
  if (utf16) {
    try {
      return new TextDecoder(utf16).decode(buffer)
    } catch {
      return null
    }
  }
  if (buffer.includes(0)) return null

  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    // Not UTF-8: probably a legacy Windows (ANSI) text file
    try {
      text = new TextDecoder('windows-1252').decode(buffer)
    } catch {
      text = buffer.toString('latin1')
    }
  }
  let controlChars = 0
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    if (code < 32 && code !== 9 && code !== 10 && code !== 13 && code !== 12) controlChars++
  }
  return controlChars > text.length * 0.02 ? null : text
}

interface RawImportItem {
  [key: string]: unknown
}

// TXT written by this app. Returns null when the text is not an export of the app.
export const parseTxtExport = (text: string): RawImportItem[] | null => {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized.trimStart().startsWith(TXT_TITLE)) return null
  const lines = normalized.split('\n')
  const items: RawImportItem[] = []

  for (let i = 0; i < lines.length; i++) {
    const start = /^===== Prompt (\d+) de \d+ =====$/.exec(lines[i] ?? '')
    if (!start) continue
    const endMarker = `===== Fim do prompt ${start[1]} =====`
    const end = lines.indexOf(endMarker, i + 1)
    if (end === -1) break // truncated file: keep the complete blocks
    const block = lines.slice(i + 1, end)

    const fields: Record<string, string> = {}
    let k = 0
    for (; k < block.length; k++) {
      const line = block[k] ?? ''
      if (line === TXT_DESCRIPTION_MARKER || line === TXT_CONTENT_MARKER) break
      const separator = line.indexOf(': ')
      if (separator > 0) fields[line.slice(0, separator)] = line.slice(separator + 2)
    }
    let description: string | null = null
    if (block[k] === TXT_DESCRIPTION_MARKER) {
      let contentStart = block.indexOf(TXT_CONTENT_MARKER, k + 1)
      if (contentStart === -1) contentStart = block.length
      description = block.slice(k + 1, contentStart).join('\n')
      k = contentStart
    }
    const content = block[k] === TXT_CONTENT_MARKER ? block.slice(k + 1).join('\n') : ''

    items.push({
      title: fields['Título'] ?? '',
      content,
      description,
      category_name: fields['Categoria'] ?? null,
      tags: fields['Tags'] ?? [],
      is_favorite: fields['Favorito'] === 'Sim',
    })
    i = end
  }

  return items.length > 0 ? items : parseLegacyTxtExport(normalized)
}

// Format written by previous versions of the app:
// "1. Título / Categoria: / Tags: / Criado em: / (blank) / conteúdo / (blank) / Descrição: ... / ---"
const parseLegacyTxtExport = (text: string): RawImportItem[] | null => {
  const body = text.slice(text.indexOf('\n\n') + 2)
  const chunks = body.split('\n---\n')
  const items: { title: string; header: Record<string, string>; content: string }[] = []

  for (const chunk of chunks) {
    const trimmedStart = chunk.replace(/^\n+/, '')
    const lines = trimmedStart.split('\n')
    const heading = /^\d+\. (.*)$/.exec(lines[0] ?? '')
    if (!heading) {
      // A "---" line inside a prompt's content split it: glue the piece back
      const previous = items[items.length - 1]
      if (previous && chunk.trim()) previous.content += `\n---\n${chunk}`
      continue
    }
    const header: Record<string, string> = {}
    let k = 1
    for (; k < lines.length && lines[k] !== ''; k++) {
      const line = lines[k] ?? ''
      const separator = line.indexOf(': ')
      if (separator > 0) header[line.slice(0, separator)] = line.slice(separator + 2)
    }
    items.push({ title: heading[1] ?? '', header, content: lines.slice(k + 1).join('\n') })
  }
  if (items.length === 0) return null

  return items.map(({ title, header, content }) => {
    let body = content.replace(/\n+$/, '')
    let description: string | null = null
    const lastLineStart = body.lastIndexOf('\n') + 1
    const lastLine = body.slice(lastLineStart)
    if (lastLine.startsWith('Descrição: ')) {
      description = lastLine.slice('Descrição: '.length)
      body = body.slice(0, lastLineStart).replace(/\n+$/, '')
    }
    const category = header['Categoria']
    return {
      title,
      content: body,
      description,
      category_name: category && category !== 'Sem categoria' ? category : null,
      tags: header['Tags'] ?? [],
    }
  })
}

interface ValidImportPrompt {
  title: string
  content: string
  description: string | null
  categoryName: string | null
  templateName: string | null
  tags: string[]
  isFavorite: boolean
  isPinned: boolean
  // Step position inside a sequence category (null = none)
  sortOrder: number | null
  usageCount: number
  lastUsedAt: string | null
  // Original dates in SQLite's UTC format, when the file has valid ones
  createdAt: string | null
  updatedAt: string | null
}

const importFlag = (value: unknown): boolean => value === true || value === 1 || value === 'true'

// Integer >= min from a number or numeric text; null otherwise
const importInteger = (value: unknown, min: number): number | null => {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value
  return typeof number === 'number' && Number.isSafeInteger(number) && number >= min ? number : null
}

// Accepts SQLite timestamps (UTC without zone, as exported by this app) and ISO dates; returns the
// SQLite UTC format used by CURRENT_TIMESTAMP, or null when the value is not a valid date
const importDate = (value: unknown): string | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const text = value.trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(text) ? `${text.replace(' ', 'T')}Z` : text)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

const importTags = (value: unknown): string[] => {
  if (Array.isArray(value)) return cleanTags(value)
  if (typeof value === 'string') return cleanTags(value.split(','))
  return []
}

const nameField = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

// Returns the prompt to create, or the pt-BR reason why the item is ignored
const validateImportItem = (item: unknown): ValidImportPrompt | string => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return 'formato inválido (esperado um objeto com título e conteúdo)'
  const raw = item as RawImportItem
  if (typeof raw.title !== 'string' || !raw.title.trim()) return 'título ausente ou inválido'
  if (typeof raw.content !== 'string' || !raw.content.trim()) return 'conteúdo ausente ou inválido'
  return {
    title: raw.title.trim(),
    content: raw.content,
    description: optionalText(raw.description),
    // category_id from another installation means nothing here: only the name is used
    categoryName: nameField(raw.category_name, raw.category),
    templateName: nameField(raw.template_name),
    tags: importTags(raw.tags),
    isFavorite: importFlag(raw.is_favorite),
    isPinned: importFlag(raw.is_pinned),
    sortOrder: importInteger(raw.sort_order, 1),
    usageCount: importInteger(raw.usage_count, 0) ?? 0,
    lastUsedAt: importDate(raw.last_used_at),
    createdAt: importDate(raw.created_at),
    updatedAt: importDate(raw.updated_at),
  }
}

const itemLabel = (item: unknown, index: number): string => {
  const title = item && typeof item === 'object' ? (item as RawImportItem).title : undefined
  if (typeof title === 'string' && title.trim()) {
    const short = title.trim().length > 60 ? `${title.trim().slice(0, 57)}...` : title.trim()
    return `Prompt ${index + 1} ("${short}")`
  }
  return `Prompt ${index + 1}`
}

const emptyImport = (error: string): ImportResult => ({ success: false, imported: 0, skipped: 0, total: 0, error })

export const importPrompts = async (db: Database, filePath: string): Promise<ImportResult> => {
  let buffer: Buffer
  try {
    buffer = readFileSync(filePath)
  } catch (error) {
    return emptyImport(`Não foi possível ler o arquivo: ${describeFileError(error)}.`)
  }
  if (buffer.length > MAX_IMPORT_BYTES) return emptyImport('O arquivo é grande demais para importar (máximo de 20 MB).')

  const text = decodeTextFile(buffer)
  if (text === null) {
    return emptyImport('O arquivo não é um texto válido. Escolha um arquivo .json ou .txt exportado pelo Prompt Studio.')
  }
  if (!text.trim()) return emptyImport('O arquivo está vazio.')

  const ext = extname(filePath).toLowerCase()
  const looksLikeJson = ext === '.json' || (ext !== '.txt' && /^[[{]/.test(text.trimStart()))

  let items: unknown[]
  let fileCategories: unknown[] = []
  let fileTemplates: unknown[] = []
  if (looksLikeJson) {
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      return emptyImport('O arquivo JSON está corrompido ou mal formatado.')
    }
    const record = data && typeof data === 'object' && !Array.isArray(data) ? (data as RawImportItem) : null
    if (Array.isArray(data)) {
      items = data
    } else if (record && Array.isArray(record.prompts)) {
      items = record.prompts
      fileCategories = Array.isArray(record.categories) ? record.categories : []
      fileTemplates = Array.isArray(record.templates) ? record.templates : []
    } else {
      return emptyImport('O arquivo JSON não contém uma lista de prompts.')
    }
  } else {
    const parsed = parseTxtExport(text)
    // Any other text file becomes one prompt named after the file (without the full path)
    items = parsed ?? [{
      title: basename(filePath, extname(filePath)).trim() || 'Prompt importado',
      content: text,
      tags: ['importado'],
    }]
  }

  if (items.length === 0) return emptyImport('O arquivo não contém nenhum prompt.')

  let imported = 0
  let skipped = 0
  let duplicates = 0
  let categoriesCreated = 0
  let templatesImported = 0
  const errors: string[] = []
  const reportSkip = (message: string) => {
    skipped++
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(message)
  }

  let inTransaction = false
  try {
    await runQuery(db, 'BEGIN IMMEDIATE')
    inTransaction = true
    const categories = await allQuery<{ id: number; name: string; is_sequence: number }>(db, 'SELECT id, name, is_sequence FROM categories')
    const categoryIds = new Map(categories.map((c) => [c.name.trim().toLocaleLowerCase('pt-BR'), c.id]))
    const sequenceIds = new Set(categories.filter((c) => c.is_sequence).map((c) => c.id))
    const fileCategoryInfo = new Map<string, { description: string | null; color: string; parent: string | null; isSequence: boolean }>()
    for (const entry of fileCategories) {
      if (!entry || typeof entry !== 'object') continue
      const raw = entry as RawImportItem
      const name = nameField(raw.name)
      if (!name) continue
      fileCategoryInfo.set(name.toLocaleLowerCase('pt-BR'), {
        description: optionalText(raw.description),
        color: typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) ? raw.color : DEFAULT_CATEGORY_COLOR,
        parent: nameField(raw.parent, raw.parent_name),
        isSequence: importFlag(raw.is_sequence),
      })
    }

    // Categories that already exist are kept as they are. A new one is created with its parent (created
    // first when needed); `chain` holds the categories being created, so a cycle in the file stops there.
    const resolveCategory = async (name: string | null, chain: ReadonlySet<string> = new Set()): Promise<number | null> => {
      if (!name) return null
      const key = name.toLocaleLowerCase('pt-BR')
      const existing = categoryIds.get(key)
      if (existing !== undefined) return existing
      const info = fileCategoryInfo.get(key)
      const parentName = info?.parent && !chain.has(info.parent.toLocaleLowerCase('pt-BR')) ? info.parent : null
      const parentId = parentName && parentName.toLocaleLowerCase('pt-BR') !== key
        ? await resolveCategory(parentName, new Set([...chain, key]))
        : null
      const result = await runQuery(db, 'INSERT INTO categories (name, description, color, parent_id, is_sequence) VALUES (?, ?, ?, ?, ?)', [
        name, info?.description ?? null, info?.color ?? DEFAULT_CATEGORY_COLOR, parentId, info?.isSequence ? 1 : 0,
      ])
      categoryIds.set(key, result.id)
      if (info?.isSequence) sequenceIds.add(result.id)
      categoriesCreated++
      return result.id
    }

    // Imported steps go after the steps a sequence already has, keeping their order from the file
    const sequenceBase = new Map<number, number>()
    const importedPosition = async (categoryId: number | null, sortOrder: number | null): Promise<number | null> => {
      if (categoryId === null || sortOrder === null || !sequenceIds.has(categoryId)) return sortOrder
      let base = sequenceBase.get(categoryId)
      if (base === undefined) {
        base = await normalizeSequenceOrder(db, categoryId)
        sequenceBase.set(categoryId, base)
      }
      return base + sortOrder
    }

    const templates = await allQuery<{ id: number; name: string }>(db, 'SELECT id, name FROM templates')
    const templateIds = new Map(templates.map((t) => [t.name.trim().toLocaleLowerCase('pt-BR'), t.id]))
    for (const entry of fileTemplates) {
      if (!entry || typeof entry !== 'object') continue
      const raw = entry as RawImportItem
      const name = nameField(raw.name)
      if (!name || typeof raw.content !== 'string' || !raw.content.trim()) continue
      const key = name.toLocaleLowerCase('pt-BR')
      if (templateIds.has(key)) continue
      const categoryId = await resolveCategory(nameField(raw.category_name))
      const variables = Array.isArray(raw.variables) ? cleanTags(raw.variables) : extractTemplateVariables(raw.content)
      const result = await runQuery(db,
        'INSERT INTO templates (name, description, content, variables, category_id) VALUES (?, ?, ?, ?, ?)',
        [name, optionalText(raw.description), raw.content, JSON.stringify(variables), categoryId])
      templateIds.set(key, result.id)
      templatesImported++
    }

    const existingPrompts = await allQuery<{ title: string; content: string }>(db, 'SELECT title, content FROM prompts')
    const promptKeys = new Set(existingPrompts.map((p) => `${p.title.trim()}\u0000${p.content}`))
    const touchedSequences = new Set<number>()

    for (const [index, item] of items.entries()) {
      const prompt = validateImportItem(item)
      if (typeof prompt === 'string') {
        reportSkip(`${itemLabel(item, index)}: ${prompt}`)
        continue
      }
      const key = `${prompt.title}\u0000${prompt.content}`
      if (promptKeys.has(key)) {
        duplicates++
        reportSkip(`${itemLabel(item, index)}: já existe na sua biblioteca`)
        continue
      }
      const categoryId = await resolveCategory(prompt.categoryName)
      const templateId = prompt.templateName ? templateIds.get(prompt.templateName.toLocaleLowerCase('pt-BR')) ?? null : null
      const sortOrder = await importedPosition(categoryId, prompt.sortOrder)
      const result = await runQuery(db,
        `INSERT INTO prompts (title, content, description, category_id, template_id, tags, is_favorite, is_pinned, sort_order,
           usage_count, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), COALESCE(?, ?, CURRENT_TIMESTAMP))`,
        [prompt.title, prompt.content, prompt.description, categoryId, templateId, JSON.stringify(prompt.tags), prompt.isFavorite ? 1 : 0,
          prompt.isPinned ? 1 : 0, sortOrder, prompt.usageCount, prompt.lastUsedAt,
          prompt.createdAt, prompt.updatedAt, prompt.createdAt])
      await runQuery(db, 'INSERT INTO prompt_versions (prompt_id, content, version_number) VALUES (?, ?, 1)', [result.id, prompt.content])
      promptKeys.add(key)
      if (categoryId !== null && sequenceIds.has(categoryId)) touchedSequences.add(categoryId)
      imported++
    }

    // Steps without a position (older files, other categories) go after the others, by title
    for (const categoryId of touchedSequences) {
      await normalizeSequenceOrder(db, categoryId)
    }

    await runQuery(db, 'COMMIT')
  } catch (error) {
    if (inTransaction) await runQuery(db, 'ROLLBACK').catch(() => {})
    return emptyImport(`Não foi possível importar os prompts: ${error instanceof Error ? error.message : 'erro desconhecido'}`)
  }

  if (skipped > errors.length) {
    errors.push(`... e mais ${skipped - errors.length} prompts ignorados`)
  }

  const result: ImportResult = {
    // A file whose prompts are all already in the library was read fine: nothing new, not an error
    success: imported > 0 || (items.length > 0 && duplicates === items.length),
    imported,
    skipped,
    total: items.length,
    ...(duplicates > 0 ? { duplicates } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(categoriesCreated > 0 ? { categoriesCreated } : {}),
    ...(templatesImported > 0 ? { templatesImported } : {}),
  }
  if (result.success) return result
  return { ...result, error: 'Nenhum prompt válido foi encontrado no arquivo.' }
}
