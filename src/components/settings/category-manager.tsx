import { useState } from 'react'
import { Plus, Edit, Trash2, Folder, Palette, Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { CategoryModal } from '../modals/category-modal'
import { usePromptStore } from '@/stores/usePromptStore'
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

// Same confirmation in the sidebar and in Settings > Categorias
export function confirmCategoryDeletion(category: Category): Promise<boolean> {
  const { prompts, templates } = usePromptStore.getState()
  const promptCount = prompts.filter(p => p.category_id === category.id).length
  const templateCount = templates.filter(t => t.category_id === category.id).length

  return confirmAction({
    title: 'Excluir categoria',
    description: `Tem certeza de que deseja excluir a categoria "${category.name}"? ${describeCategoryUsage(promptCount, templateCount)}`,
    confirmLabel: 'Excluir',
    destructive: true
  })
}

export function CategoryManager() {
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | undefined>(undefined)
  const [searchQuery, setSearchQuery] = useState('')

  const { categories, prompts, deleteCategory } = usePromptStore()

  const handleCreateCategory = () => {
    setEditingCategory(undefined)
    setCategoryModalOpen(true)
  }

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
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
    }
  }

  const getPromptCount = (categoryId: number) => {
    return prompts.filter(p => p.category_id === categoryId).length
  }

  const filteredCategories = categories.filter(category =>
    category.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    category.description?.toLowerCase().includes(searchQuery.toLowerCase())
  )

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
            {filteredCategories.length} {filteredCategories.length === 1 ? 'categoria' : 'categorias'}
            {searchQuery && ` (com filtro)`}
          </div>
          <Button onClick={handleCreateCategory}>
            <Plus className="h-4 w-4 mr-2" />
            Nova categoria
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 pb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredCategories.length === 0 ? (
            <Card className="col-span-full">
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
                  <Button onClick={handleCreateCategory}>
                    <Plus className="h-4 w-4 mr-2" />
                    Criar categoria
                  </Button>
                )}
              </CardContent>
            </Card>
          ) : (
            filteredCategories.map((category) => {
              const promptCount = getPromptCount(category.id)

              return (
                <Card key={category.id} className="group hover:shadow-md transition-shadow">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <div
                          className="h-4 w-4 rounded-full shrink-0"
                          style={{ backgroundColor: category.color }}
                        />
                        <CardTitle className="text-base truncate" title={category.name}>{category.name}</CardTitle>
                      </div>
                      <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
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
                    </div>
                  </CardHeader>
                  <CardContent>
                    {category.description && (
                      <CardDescription className="mb-3 line-clamp-2">
                        {category.description}
                      </CardDescription>
                    )}
                    <div className="flex items-center justify-between">
                      <Badge variant="secondary" className="text-xs">
                        {promptCount} {promptCount === 1 ? 'prompt' : 'prompts'}
                      </Badge>
                      <div className="flex items-center space-x-1 text-xs text-muted-foreground">
                        <Palette className="h-3 w-3" />
                        <span>{category.color}</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
          </div>
        </div>
      </ScrollArea>

      {/* Category Modal */}
      <CategoryModal
        open={categoryModalOpen}
        onOpenChange={handleModalClose}
        category={editingCategory}
      />
    </div>
  )
}
