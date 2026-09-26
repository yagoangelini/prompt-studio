import type { Category, Prompt } from '@/types'

// Pure helpers for subcategories, sequences and selection (used by the store and the components)

const nameCollator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

// ---- Category tree ----

export interface CategoryNode {
  readonly category: Category
  readonly depth: number
  readonly children: readonly CategoryNode[]
}

export interface FlatCategory {
  readonly category: Category
  readonly depth: number
  readonly hasChildren: boolean
}

// Parent of each category as used by the tree. A missing parent, a self reference or a cycle in the data
// makes the category a root, so every category is always shown exactly once.
function effectiveParents(categories: readonly Category[]): Map<number, number | null> {
  const declared = new Map(categories.map((c) => [c.id, c.parent_id ?? null]))
  const result = new Map<number, number | null>()
  for (const category of categories) {
    let parent = declared.get(category.id) ?? null
    if (parent !== null && (parent === category.id || !declared.has(parent))) parent = null
    // Coming back to this category while walking up means it is part of a cycle
    const visited = new Set<number>()
    for (let current = parent; current !== null; current = declared.get(current) ?? null) {
      if (current === category.id) {
        parent = null
        break
      }
      // A cycle above this category: its members become roots, this category stays under its parent
      if (visited.has(current)) break
      visited.add(current)
    }
    result.set(category.id, parent)
  }
  return result
}

function childrenMap(categories: readonly Category[]): Map<number | null, Category[]> {
  const parents = effectiveParents(categories)
  const children = new Map<number | null, Category[]>()
  for (const category of categories) {
    const parent = parents.get(category.id) ?? null
    const list = children.get(parent)
    if (list) list.push(category)
    else children.set(parent, [category])
  }
  for (const list of children.values()) list.sort((a, b) => nameCollator.compare(a.name, b.name))
  return children
}

/** Categories as a tree: roots and children in pt-BR alphabetical order. */
export function buildCategoryTree(categories: readonly Category[]): CategoryNode[] {
  const children = childrenMap(categories)
  const build = (parent: number | null, depth: number, seen: Set<number>): CategoryNode[] =>
    (children.get(parent) ?? [])
      .filter((category) => !seen.has(category.id))
      .map((category) => {
        seen.add(category.id)
        return { category, depth, children: build(category.id, depth + 1, seen) }
      })
  return build(null, 0, new Set())
}

/** The tree in display order, without the subcategories of collapsed categories. */
export function flattenCategoryTree(
  nodes: readonly CategoryNode[],
  collapsedIds: ReadonlySet<number> = new Set()
): FlatCategory[] {
  const result: FlatCategory[] = []
  const visit = (list: readonly CategoryNode[]) => {
    for (const node of list) {
      result.push({ category: node.category, depth: node.depth, hasChildren: node.children.length > 0 })
      if (!collapsedIds.has(node.category.id)) visit(node.children)
    }
  }
  visit(nodes)
  return result
}

/** Ids of every subcategory (at any depth) of the category, without the category itself. */
export function getDescendantIds(categoryId: number, categories: readonly Category[]): Set<number> {
  return descendantsIn(childrenMap(categories), categoryId)
}

function descendantsIn(children: ReadonlyMap<number | null, readonly Category[]>, categoryId: number): Set<number> {
  const result = new Set<number>()
  const pending = [categoryId]
  while (pending.length > 0) {
    const current = pending.pop() as number
    for (const child of children.get(current) ?? []) {
      if (child.id === categoryId || result.has(child.id)) continue
      result.add(child.id)
      pending.push(child.id)
    }
  }
  return result
}

/** The given categories plus all their subcategories. */
export function withDescendants(ids: Iterable<number>, categories: readonly Category[]): Set<number> {
  const children = childrenMap(categories)
  const result = new Set<number>()
  for (const id of ids) {
    result.add(id)
    for (const descendant of descendantsIn(children, id)) result.add(descendant)
  }
  return result
}

/** Names from the top-level category down to the given one ("Plano › Revisão"). */
export function getCategoryPath(categoryId: number, categories: readonly Category[]): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const parents = effectiveParents(categories)
  const names: string[] = []
  const visited = new Set<number>()
  for (let current: number | null = categoryId; current !== null && !visited.has(current); current = parents.get(current) ?? null) {
    visited.add(current)
    const category = byId.get(current)
    if (!category) break
    names.unshift(category.name)
  }
  return names
}

/** Categories that can be the parent of `category` (all of them for a new one): never itself or a subcategory of it. */
export function getParentOptions(category: Pick<Category, 'id'> | undefined, categories: readonly Category[]): FlatCategory[] {
  const excluded = category ? withDescendants([category.id], categories) : new Set<number>()
  return flattenCategoryTree(buildCategoryTree(categories)).filter((item) => !excluded.has(item.category.id))
}

/** Number of prompts of each category, counting the prompts of its subcategories too. */
export function countPromptsByCategory(categories: readonly Category[], prompts: readonly Pick<Prompt, 'category_id'>[]): Map<number, number> {
  const direct = new Map<number, number>()
  for (const prompt of prompts) {
    if (prompt.category_id !== null && prompt.category_id !== undefined) {
      direct.set(prompt.category_id, (direct.get(prompt.category_id) ?? 0) + 1)
    }
  }
  const children = childrenMap(categories)
  const totals = new Map<number, number>()
  for (const category of categories) {
    let total = direct.get(category.id) ?? 0
    for (const descendant of descendantsIn(children, category.id)) total += direct.get(descendant) ?? 0
    totals.set(category.id, total)
  }
  return totals
}

// ---- Sequences ----

type SequenceStep = Pick<Prompt, 'id' | 'title' | 'sort_order'>

/**
 * Step order of a sequence: manual position first; prompts without one (null) come after them, by title.
 * Same rule as the backend (compareSequenceSteps in electron/database/queries.ts).
 */
export function compareSequenceSteps(a: SequenceStep, b: SequenceStep): number {
  const left = a.sort_order ?? null
  const right = b.sort_order ?? null
  if (left !== right) {
    if (left === null) return 1
    if (right === null) return -1
    return left - right
  }
  return nameCollator.compare(a.title, b.title) || a.id - b.id
}

/** The prompts of a category in step order. */
export function getSequenceSteps<T extends SequenceStep & Pick<Prompt, 'category_id'>>(categoryId: number, prompts: readonly T[]): T[] {
  return prompts.filter((prompt) => prompt.category_id === categoryId).sort(compareSequenceSteps)
}

/** Moves `movingId` right before or after `targetId`. Returns the same order when nothing changes. */
export function moveRelativeTo(order: readonly number[], movingId: number, targetId: number, position: 'before' | 'after'): number[] {
  if (movingId === targetId || !order.includes(movingId) || !order.includes(targetId)) return [...order]
  const without = order.filter((id) => id !== movingId)
  const targetIndex = without.indexOf(targetId)
  without.splice(position === 'before' ? targetIndex : targetIndex + 1, 0, movingId)
  return without
}

/**
 * Moves a step one place up (-1) or down (+1) among the visible steps (a search may hide some). Returns
 * null when it is already the first/last visible one.
 */
export function moveAmongVisible(order: readonly number[], visibleIds: readonly number[], movingId: number, direction: -1 | 1): number[] | null {
  const visible = order.filter((id) => visibleIds.includes(id))
  const index = visible.indexOf(movingId)
  const neighbor = index === -1 ? undefined : visible[index + direction]
  if (neighbor === undefined) return null
  return moveRelativeTo(order, movingId, neighbor, direction === -1 ? 'before' : 'after')
}

// ---- Selection ----

/** Ids between `anchorId` and `targetId` (both included) in the displayed order; just the target without an anchor. */
export function rangeBetween(orderedIds: readonly number[], anchorId: number | null, targetId: number): number[] {
  const end = orderedIds.indexOf(targetId)
  const start = anchorId === null ? -1 : orderedIds.indexOf(anchorId)
  if (end === -1) return []
  if (start === -1) return [targetId]
  return orderedIds.slice(Math.min(start, end), Math.max(start, end) + 1)
}
