import { FileText, Plus, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { usePromptStore } from '@/stores/usePromptStore'
import { TemplateGrid } from './template-grid'
import { TemplateListView } from './template-list-view'
import type { Template } from '@/types'

interface TemplateListProps {
  viewMode: 'list' | 'grid'
  filteredTemplates: readonly Template[]
}

function TemplateEmptyState() {
  const { templateSearchQuery, setTemplateSearchQuery, openTemplateEditor } = usePromptStore()
  const query = templateSearchQuery.trim()

  if (query) {
    return (
      <div className="text-center py-12">
        <div className="mb-4">
          <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
            <Search className="h-8 w-8 text-muted-foreground" />
          </div>
        </div>
        <h3 className="text-lg font-medium mb-2">Nenhum template encontrado</h3>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto break-words [overflow-wrap:anywhere]">
          Nenhum template corresponde a "{query}". Tente buscar por outro nome, conteúdo ou variável.
        </p>
        <Button variant="outline" onClick={() => setTemplateSearchQuery('')}>
          Limpar busca
        </Button>
      </div>
    )
  }

  return (
    <div className="text-center py-12">
      <div className="mb-4">
        <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
          <FileText className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h3 className="text-lg font-medium mb-2">Ainda não há templates</h3>
      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
        Crie templates com variáveis para ter prompts reutilizáveis que podem ser personalizados a cada uso.
      </p>
      <Button onClick={() => openTemplateEditor()}>
        <Plus className="h-4 w-4 mr-2" />
        Criar template
      </Button>
    </div>
  )
}

export function TemplateList({ viewMode, filteredTemplates }: TemplateListProps) {
  return (
    <div className="h-full">
      <ScrollArea className="h-full">
        <div className="p-4">
          {filteredTemplates.length === 0 ? (
            <TemplateEmptyState />
          ) : viewMode === 'grid' ? (
            <TemplateGrid templates={filteredTemplates} />
          ) : (
            <TemplateListView templates={filteredTemplates} />
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
