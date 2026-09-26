import { Edit, Trash2, Sparkles, FilePlus2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useTemplateActions } from './use-template-actions'
import type { Template } from '@/types'

interface TemplateGridProps {
  templates: readonly Template[]
}

export function TemplateGrid({ templates }: TemplateGridProps) {
  const { editTemplate, startPromptFromTemplate, removeTemplate } = useTemplateActions()

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {templates.map((template) => (
        <Card key={template.id} className="group flex flex-col min-w-0 transition-all hover:shadow-md">
          <CardHeader className="pb-3">
            <div className="flex items-start gap-2 min-w-0">
              <Sparkles className="h-4 w-4 mt-0.5 text-muted-foreground flex-shrink-0" />
              <CardTitle className="min-w-0 text-base leading-snug line-clamp-2 break-words [overflow-wrap:anywhere]">
                {template.name}
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col min-w-0">
            {template.description && (
              <CardDescription className="mb-3 line-clamp-2 break-words [overflow-wrap:anywhere]">
                {template.description}
              </CardDescription>
            )}

            <div className="space-y-2">
              {template.variables.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {template.variables.slice(0, 4).map((variable, index) => (
                    <Badge key={index} variant="outline" className="text-xs max-w-full break-all">
                      {`{{${variable}}}`}
                    </Badge>
                  ))}
                  {template.variables.length > 4 && (
                    <Badge variant="outline" className="text-xs">
                      +{template.variables.length - 4} mais
                    </Badge>
                  )}
                </div>
              )}

              {template.category_name && (
                <div className="flex items-center gap-2 min-w-0">
                  <div
                    className="h-2 w-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: template.category_color }}
                  />
                  <span className="text-xs text-muted-foreground truncate">
                    {template.category_name}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-3 p-2 bg-muted rounded text-xs font-mono line-clamp-4 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {template.content}
            </div>

            {/* Actions stay visible, so they are reachable by keyboard and never cover the title */}
            <div className="mt-auto pt-3">
              <div className="flex items-center gap-1 border-t pt-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => startPromptFromTemplate(template)}
                  className="h-8"
                  title="Criar um prompt a partir deste template"
                >
                  <FilePlus2 className="h-4 w-4" />
                  Usar template
                </Button>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => editTemplate(template)}
                    className="h-8 w-8 p-0"
                    aria-label={`Editar o template ${template.name}`}
                    title="Editar template"
                  >
                    <Edit className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeTemplate(template)}
                    className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                    aria-label={`Excluir o template ${template.name}`}
                    title="Excluir template"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
