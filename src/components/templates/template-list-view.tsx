import { Edit, Trash2, Sparkles, Calendar, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { parseDbDate } from '@/lib/utils'
import { useTemplateActions } from './use-template-actions'
import type { Template } from '@/types'

interface TemplateListViewProps {
  templates: readonly Template[]
}

export function TemplateListView({ templates }: TemplateListViewProps) {
  const { editTemplate, startPromptFromTemplate, removeTemplate } = useTemplateActions()

  const formatDate = (dateString: string) => {
    try {
      return formatDistanceToNow(parseDbDate(dateString), { addSuffix: true, locale: ptBR })
    } catch {
      return 'Data desconhecida'
    }
  }

  const truncateContent = (content: string, maxLength: number = 120) => {
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength) + '...'
  }

  return (
    <div className="space-y-3">
      {templates.map((template) => (
        <div
          key={template.id}
          className="group border rounded-lg p-4 hover:shadow-sm hover:border-accent transition-all cursor-pointer min-w-0"
          onClick={() => editTemplate(template)}
        >
          {/* Header section with title and actions */}
          <div className="flex items-start justify-between gap-3 min-w-0">
            <div className="flex-1 min-w-0">
              <div className="flex items-start gap-2 mb-1 min-w-0">
                <Sparkles className="h-4 w-4 mt-1 text-muted-foreground flex-shrink-0" />
                <h3 className="min-w-0 font-medium text-base line-clamp-2 break-words [overflow-wrap:anywhere]">
                  {template.name}
                </h3>
              </div>

              {template.description && (
                <p className="text-sm text-muted-foreground mb-2 line-clamp-2 break-words [overflow-wrap:anywhere]">
                  {template.description}
                </p>
              )}

              <p className="text-sm text-muted-foreground line-clamp-2 mb-3 break-words [overflow-wrap:anywhere]">
                {truncateContent(template.content)}
              </p>
            </div>

            {/* Shown on hover and whenever one of the buttons has keyboard focus */}
            <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  startPromptFromTemplate(template)
                }}
                className="h-8 w-8 p-0"
                aria-label={`Usar o template ${template.name} em um novo prompt`}
                title="Usar template"
              >
                <FilePlus2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  editTemplate(template)
                }}
                className="h-8 w-8 p-0"
                aria-label={`Editar o template ${template.name}`}
                title="Editar template"
              >
                <Edit className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={(e) => {
                  e.stopPropagation()
                  removeTemplate(template)
                }}
                className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                aria-label={`Excluir o template ${template.name}`}
                title="Excluir template"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Footer section with metadata and variables */}
          <div className="space-y-2 border-t pt-3 mt-3">
            {/* Metadata row */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
              {template.category_name && (
                <div className="flex items-center gap-1 min-w-0">
                  <div
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: template.category_color }}
                  />
                  <span className="truncate">{template.category_name}</span>
                </div>
              )}

              <div className="flex items-center gap-1 flex-shrink-0">
                <Calendar className="h-3 w-3" />
                <span>{formatDate(template.updated_at)}</span>
              </div>
            </div>

            {/* Variables row */}
            {template.variables.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {template.variables.slice(0, 6).map((variable, index) => (
                  <Badge
                    key={index}
                    variant="outline"
                    className="text-xs h-5 px-2 max-w-full"
                  >
                    <span className="truncate">{`{{${variable}}}`}</span>
                  </Badge>
                ))}
                {template.variables.length > 6 && (
                  <Badge
                    variant="outline"
                    className="text-xs h-5 px-2"
                  >
                    +{template.variables.length - 6} mais
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
