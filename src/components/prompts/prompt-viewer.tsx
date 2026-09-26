import { useMemo, useState } from 'react'
import { X, Copy, Edit, Heart, Pin, Calendar, Tag, Folder, FileText, Check, Files, Trash2, Braces, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn, parseDbDate } from '@/lib/utils'
import { copyPrompt } from '@/lib/copy-prompt'
import { extractVariables, splitVariableSegments } from '../templates/template-variables'
import { canHighlightVariables } from './variable-textarea'
import type { Prompt } from '@/types'

interface PromptViewerProps {
  prompt: Prompt
  onClose: () => void
}

export function PromptViewer({ prompt: initialPrompt, onClose }: PromptViewerProps) {
  const [justCopied, setJustCopied] = useState(false)
  const [busyAction, setBusyAction] = useState<'duplicate' | 'delete' | null>(null)

  const {
    prompts,
    updatePrompt,
    deletePrompt,
    duplicatePrompt,
    openPromptEditor,
    setPromptPinned
  } = usePromptStore()

  // Get the current prompt from the store to ensure we have the latest data
  const prompt = prompts.find(p => p.id === initialPrompt.id) || initialPrompt

  const handleFavoriteToggle = async () => {
    // The store shows the success or error toast itself
    await updatePrompt(prompt.id, { is_favorite: !prompt.is_favorite })
  }

  const variables = useMemo(() => extractVariables(prompt.content), [prompt.content])
  // Variables highlighted in the content (skipped for huge texts, like in the editor)
  const contentSegments = useMemo(
    () => (variables.length > 0 && canHighlightVariables(prompt.content) ? splitVariableSegments(prompt.content) : null),
    [prompt.content, variables.length]
  )

  // Asks for the {{variables}} (if any), copies, counts the usage and shows the toast (or the error)
  const handleCopy = async () => {
    if (await copyPrompt(prompt)) {
      setJustCopied(true)
      setTimeout(() => setJustCopied(false), 2000)
    }
  }

  const handleEdit = () => {
    openPromptEditor(prompt)
  }

  const handleDuplicate = async () => {
    setBusyAction('duplicate')
    try {
      await duplicatePrompt(prompt.id)
    } finally {
      setBusyAction(null)
    }
  }

  const handleDelete = async () => {
    const confirmed = await confirmAction({
      title: 'Excluir prompt?',
      description: `Tem certeza de que deseja excluir "${prompt.title}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      destructive: true
    })
    if (!confirmed) return
    setBusyAction('delete')
    try {
      if (await deletePrompt(prompt.id)) {
        onClose()
      }
    } finally {
      setBusyAction(null)
    }
  }

  const formatDate = (dateString: string) => {
    try {
      return formatDistanceToNow(parseDbDate(dateString), { addSuffix: true, locale: ptBR })
    } catch {
      return 'Data desconhecida'
    }
  }

  return (
    <div className="h-full flex flex-col bg-background border-l min-w-0">
      {/* Header */}
      <div className="flex-shrink-0 p-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold min-w-0 truncate">Detalhes do prompt</h2>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-6 w-6 flex-shrink-0"
            aria-label="Fechar detalhes"
            title="Fechar"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 min-h-0">
        <ScrollArea className="h-full">
          <div className="p-4 space-y-6 min-w-0">
            {/* Title and Actions */}
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <h1 className="min-w-0 text-xl font-bold leading-tight break-words [overflow-wrap:anywhere]">
                  {prompt.title}
                </h1>
                <div className="flex flex-shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setPromptPinned(prompt.id, !prompt.is_pinned)}
                  className="h-8 w-8 flex-shrink-0"
                  aria-label={prompt.is_pinned ? 'Desafixar' : 'Fixar no topo'}
                  aria-pressed={prompt.is_pinned}
                  title={prompt.is_pinned ? 'Desafixar' : 'Fixar no topo'}
                >
                  <Pin className={cn("h-4 w-4", prompt.is_pinned && "fill-current")} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleFavoriteToggle}
                  className="h-8 w-8 flex-shrink-0"
                  aria-label={prompt.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                  aria-pressed={prompt.is_favorite}
                  title={prompt.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                >
                  <Heart className={cn(
                    "h-4 w-4",
                    prompt.is_favorite && "fill-current text-red-500"
                  )} />
                </Button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={handleEdit}
                  className="h-8"
                >
                  <Edit className="h-3 w-3 mr-2" />
                  Editar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopy}
                  className="h-8"
                >
                  {justCopied ? (
                    <Check className="h-3 w-3 mr-2 text-green-600" />
                  ) : (
                    <Copy className="h-3 w-3 mr-2" />
                  )}
                  {justCopied ? 'Copiado!' : 'Copiar'}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDuplicate}
                  disabled={busyAction !== null}
                  className="h-8"
                >
                  <Files className="h-3 w-3 mr-2" />
                  Duplicar
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDelete}
                  disabled={busyAction !== null}
                  className="h-8 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3 w-3 mr-2" />
                  Excluir
                </Button>
              </div>
            </div>

            <Separator />

            {/* Metadata */}
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 text-sm">
                {prompt.category_name && (
                  <div className="flex items-center gap-2 min-w-0">
                    <Folder className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <span className="text-muted-foreground flex-shrink-0">Categoria:</span>
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className="h-2 w-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: prompt.category_color }}
                      />
                      <span className="font-medium truncate">{prompt.category_name}</span>
                    </div>
                  </div>
                )}

                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Última atualização:</span>
                  <span className="font-medium">{formatDate(prompt.updated_at)}</span>
                </div>

                <div className="flex items-center space-x-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Criado:</span>
                  <span className="font-medium">{formatDate(prompt.created_at)}</span>
                </div>

                {(prompt.usage_count ?? 0) > 0 && (
                  <div className="flex items-center space-x-2">
                    <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-muted-foreground">
                      Usado {prompt.usage_count.toLocaleString('pt-BR')} {prompt.usage_count === 1 ? 'vez' : 'vezes'}
                      {prompt.last_used_at ? `, a última ${formatDate(prompt.last_used_at)}` : ''}
                    </span>
                  </div>
                )}
              </div>

              {/* Tags */}
              {prompt.tags.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center space-x-2">
                    <Tag className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">Tags:</span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {prompt.tags.map((tag, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="text-xs max-w-full break-all"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Description */}
            {prompt.description && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Descrição</h3>
                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                  {prompt.description}
                </p>
              </div>
            )}

            {prompt.description && <Separator />}

            {/* Content */}
            <div className="space-y-2 min-w-0">
              <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <h3 className="text-sm font-medium text-muted-foreground">Conteúdo do prompt</h3>
              </div>
              {variables.length > 0 && (
                <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <Braces className="h-3.5 w-3.5 mt-px flex-shrink-0" aria-hidden="true" />
                  <span>
                    {variables.length === 1 ? 'Este prompt tem 1 variável' : `Este prompt tem ${variables.length} variáveis`}
                    {': ao copiar, você preenche os valores.'}
                  </span>
                </p>
              )}
              <div className="bg-muted/30 rounded-lg p-3 min-w-0">
                <pre className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono leading-relaxed">
                  {contentSegments
                    ? contentSegments.map((segment, index) =>
                        segment.kind === 'variable' ? (
                          <span key={index} className="rounded-sm bg-primary/15 text-foreground">{segment.text}</span>
                        ) : (
                          segment.text
                        )
                      )
                    : prompt.content}
                </pre>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
