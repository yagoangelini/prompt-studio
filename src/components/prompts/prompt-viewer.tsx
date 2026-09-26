import { useState } from 'react'
import { X, Copy, Edit, Heart, Calendar, Tag, Folder, FileText, Check, Files, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn, parseDbDate } from '@/lib/utils'
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
    addToast
  } = usePromptStore()

  // Get the current prompt from the store to ensure we have the latest data
  const prompt = prompts.find(p => p.id === initialPrompt.id) || initialPrompt

  const handleFavoriteToggle = async () => {
    // The store shows the success or error toast itself
    await updatePrompt(prompt.id, { is_favorite: !prompt.is_favorite })
  }

  const handleCopy = async () => {
    try {
      await window.electronAPI.copyToClipboard(prompt.content)

      // Show visual feedback
      setJustCopied(true)
      setTimeout(() => setJustCopied(false), 2000) // Reset after 2 seconds

      addToast({
        type: 'success',
        title: 'Copiado para a área de transferência',
        description: 'Conteúdo do prompt copiado com sucesso'
      })
    } catch (error) {
      console.error('Failed to copy:', error)
      addToast({
        type: 'error',
        title: 'Não foi possível copiar',
        description: `Não foi possível copiar o conteúdo do prompt: ${error instanceof Error ? error.message : 'erro desconhecido'}`
      })
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
              <div className="bg-muted/30 rounded-lg p-3 min-w-0">
                <pre className="text-sm whitespace-pre-wrap break-words [overflow-wrap:anywhere] font-mono leading-relaxed">
                  {prompt.content}
                </pre>
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
