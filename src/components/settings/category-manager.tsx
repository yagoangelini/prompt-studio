import { useMemo, useState } from 'react'
import { Plus, Edit, Trash2, Folder, Search, X, ChevronDown, ChevronRight, FolderPlus, ListOrdered } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { CategoryModal } from '../modals/category-modal'
import { usePromptStore } from '@/stores/usePromptStore'
import { normalizeSearchText } from '@/lib/search-parser'
import {
  buildCategoryTree,
  countPromptsByCategory,
  flattenCategoryTree,
  getCategoryPath
} from '@/components/organization/organization-utils'
import type { Category } from '@/types'

function describeCategoryUsage(promptCount: number, templateCount: number): string {
  const parts = [
    promptCount > 0 ? `${promptCount} ${promptCount === 1 ? 'prompt' : 'prompts'}` : '',
    templateCount > 0 ? `${templateCount} ${templateCount === 1 ? 'template' : 'templates'}` : ''
  ].filter(Boolean)

  if (parts.length === 0) {
    return 'Nenhum prompt ou template usa esta categoria.'
  }
  return promptCount + templateCount === 1
    ? `Ela é usada por ${parts.join(' e ')}. Ele não será excluído, mas ficará sem categoria.`
    : `Ela é usada por ${parts.join(' e ')}. Eles não serão excluídos, mas ficarão sem categoria.`
}

// Subcategories are not deleted: they move up one level (to the parent of the deleted category)
function describeSubcategories(children: readonly Category[], parent: Category | undefined): string {
  if (children.length === 0) return ''
  const destination = parent ? `para "${parent.name}"` : null
  if (children.length === 1) {
    const child = children[0] as Category
    return destination
      ? `A subcategoria "${child.name}" não será excluída: ela passará ${destination}.`
      : `A subcategoria "${child.name}" não será excluída: ela passará a ser uma categoria principal.`
  }
  return destination
    ? `As ${children.length} subcategorias dela não serão excluídas: passarão ${destination}.`
    : `As ${children.length} subcategorias dela não serão excluídas: passarão a ser categorias principais.`
}

// Same confirmation in the sidebar and in Settings > Categorias
export function confirmCategoryDeletion(category: Category): Promise<boolean> {
  const { prompts, templates, categories } = usePromptStore.getState()
  const promptCount = prompts.filter(p => p.category_id === category.id).length
  const templateCount = templates.filter(t => t.category_id === category.id).length
  const children = categories.filter(c => c.id !== category.id && c.parent_id === category.id)
  const parent = categories.find(c => c.id !== category.id && c.id === category.parent_id)
  const subcategories = describeSubcategories(children, parent)

  return confirmAction({
    title: 'Excluir categoria',
    description: `Tem certeza de que deseja excluir a categoria "${category.name}"? ${describeCategoryUsage(promptCount, templateCount)}${subcategories ? ` ${subcategories}` : ''}`,
    confirmLabel: 'Excluir',
    destructive: true
  })
}

export function CategoryManager() {
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | undefined>(undefined)
  const [newParentId, setNewParentId] = useState<number | null>(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Same collapsed state as the sidebar (saved between sessions)
  const { categories, prompts, deleteCategory, collapsedCategoryIds, toggleCategoryCollapsed: toggleCollapsed } = usePromptStore()
  const collapsed = useMemo(() => new Set(collapsedCategoryIds), [collapsedCategoryIds])

  const handleCreateCategory = (parentId: number | null = null) => {
    setEditingCategory(undefined)
    setNewParentId(parentId)
    setCategoryModalOpen(true)
  }

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
    setNewParentId(null)
    setCategoryModalOpen(true)
  }

  const handleDeleteCategory = async (category: Category) => {
    if (await confirmCategoryDeletion(category)) {
      // The store shows the success or error toast itself
      await deleteCategory(category.id)
    }
  }

  const handleModalClose = (open: boolean) => {
    setCategoryModalOpen(open)
    if (!open) {
      setEditingCategory(undefined)
      setNewParentId(null)
    }
  }

  // Counts include the prompts of the subcategories
  const promptCounts = useMemo(() => countPromptsByCategory(categories, prompts), [categories, prompts])
  const tree = useMemo(() => buildCategoryTree(categories), [categories])

  // Searching shows the matching categories (ignoring case and accents) with their path; otherwise the tree
  const query = normalizeSearchText(searchQuery)
  const rows = query
    ? flattenCategoryTree(tree).filter(({ category }) =>
        normalizeSearchText(category.name).includes(query) ||
        normalizeSearchText(category.description ?? '').includes(query))
    : flattenCategoryTree(tree, collapsed)

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="space-y-4 flex-shrink-0">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar categorias..."
            aria-label="Buscar categorias"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
              aria-label="Limpar busca"
              title="Limpar busca"
            >
              <X className="h-3 w-3" />
            </Button>
          )}
        </div>

        <div className="flex justify-between items-center">
          <div className="text-sm text-muted-foreground">
            {query
              ? `${rows.length} ${rows.length === 1 ? 'categoria' : 'categorias'} (com filtro)`
              : `${categories.length} ${categories.length === 1 ? 'categoria' : 'categorias'}`}
          </div>
          <Button onClick={() => handleCreateCategory()}>
            <Plus className="h-4 w-4 mr-2" />
            Nova categoria
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="pb-4">
          {rows.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Folder className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  {searchQuery ? 'Nenhuma categoria encontrada' : 'Nenhuma categoria ainda'}
                </h3>
                <p className="text-sm text-muted-foreground mb-4">
                  {searchQuery
                    ? 'Tente ajustar os critérios de busca.'
                    : 'Crie sua primeira categoria para organizar seus prompts'
                  }
                </p>
                {!searchQuery && (
                  <Button onClick={() => handleCreateCategory()}>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar categoria
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            <ul className="divide-y rounded-lg border" aria-label="Categorias">
              {rows.map(({ category, depth, hasChildren }) => {
                const promptCount = promptCounts.get(category.id) ?? 0
                const isCollapsed = collapsed.has(category.id)
                const path = query ? getCategoryPath(category.id, categories) : []
                return (
                  <li
                    key={category.id}
                    className="group flex items-start gap-2 px-3 py-2.5 hover:bg-muted/40 focus-within:bg-muted/40"
                    style={{ paddingLeft: `${0.75 + (query ? 0 : depth) * 1.25}rem` }}
                  >
                    {!query && hasChildren ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 shrink-0"
                        onClick={() => toggleCollapsed(category.id)}
                        aria-expanded={!isCollapsed}
                        aria-label={`${isCollapsed ? 'Expandir' : 'Recolher'} subcategorias de ${category.name}`}
                        title={isCollapsed ? 'Expandir' : 'Recolher'}
                      >
                        {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </Button>
                    ) : (
                      <span className="h-6 w-6 shrink-0" aria-hidden="true" />
                    )}

                    <div className="h-4 w-4 mt-1 rounded-full shrink-0" style={{ backgroundColor: category.color }} />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2 min-w-0">
                        <span className="font-medium truncate" title={category.name}>{category.name}</span>
                        {category.is_sequence && (
                          <Badge variant="outline" className="text-[10px] h-5 gap-1">
                            <ListOrdered className="h-3 w-3" aria-hidden="true" />
                            Sequência
                          </Badge>
                        )}
                      </div>
                      {path.length > 1 && (
                        <p className="text-xs text-muted-foreground truncate" title={path.join(' › ')}>
                          {path.slice(0, -1).join(' › ')}
                        </p>
                      )}
                      {category.description && (
                        <p className="text-xs text-muted-foreground line-clamp-2 break-words">{category.description}</p>
                      )}
                    </div>

                    <Badge variant="secondary" className="text-xs shrink-0 mt-0.5" title="Inclui os prompts das subcategorias">
                      {promptCount} {promptCount === 1 ? 'prompt' : 'prompts'}
                    </Badge>

                    <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleCreateCategory(category.id)}
                        className="h-8 w-8 p-0"
                        aria-label={`Nova subcategoria em ${category.name}`}
                        title="Nova subcategoria"
                      >
                        <FolderPlus className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleEditCategory(category)}
                        className="h-8 w-8 p-0"
                        aria-label={`Editar categoria ${category.name}`}
                        title="Editar"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteCategory(category)}
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        aria-label={`Excluir categoria ${category.name}`}
                        title="Excluir"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </ScrollArea>

      {/* Category Modal */}
      <CategoryModal
        open={categoryModalOpen}
        onOpenChange={handleModalClose}
        category={editingCategory}
        defaultParentId={newParentId}
      />
    </div>
  )
}
