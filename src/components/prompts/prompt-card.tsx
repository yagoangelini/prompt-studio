import { useState } from 'react'
import { Heart, Copy, Edit, Trash2, Calendar, MoreVertical, Check, Files, Pin, PinOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { copyPrompt } from '@/lib/copy-prompt'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn, parseDbDate } from '@/lib/utils'
import type { Prompt } from '@/types'

interface PromptCardProps {
  prompt: Prompt
  variant?: 'list' | 'card'
  compact?: boolean
  onClick?: (event: React.MouseEvent | React.KeyboardEvent) => void
  // Selection mode: the card shows a checkbox; `range` is true for Shift+click
  selectable?: boolean
  selected?: boolean
  onToggleSelect?: (range: boolean) => void
  // Position of the prompt in its sequence (1 = first step) and the number of steps
  stepNumber?: number
  stepCount?: number
}

// "Usado 1 vez" / "Usado 3 vezes"
export function formatUsageCount(count: number): string {
  return `Usado ${count.toLocaleString('pt-BR')} ${count === 1 ? 'vez' : 'vezes'}`
}

const formatRelativeDate = (dateString: string) => {
  try {
    return formatDistanceToNow(parseDbDate(dateString), { addSuffix: true, locale: ptBR })
  } catch {
    return 'Data desconhecida'
  }
}

export function PromptCard({
  prompt,
  variant = 'list',
  compact = false,
  onClick,
  selectable = false,
  selected = false,
  onToggleSelect,
  stepNumber,
  stepCount
}: PromptCardProps) {
  const [justCopied, setJustCopied] = useState(false)

  const {
    updatePrompt,
    deletePrompt,
    duplicatePrompt,
    openPromptEditor,
    setPromptPinned,
    markSequenceStepCopied,
    addToast
  } = usePromptStore()

  const handleFavoriteToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // The store shows the success or error toast itself
    await updatePrompt(prompt.id, {
      is_favorite: !prompt.is_favorite
    })
  }

  const handlePinToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // The store shows the success or error toast itself
    await setPromptPinned(prompt.id, !prompt.is_pinned)
  }

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      // Fills the {{variables}} first, counts the usage and shows the "copied" toast
      const copied = await copyPrompt(prompt)
      if (!copied) return
      // Copying a step of a sequence moves its "next step" forward
      markSequenceStepCopied(prompt)

      // Show visual feedback
      setJustCopied(true)
      setTimeout(() => setJustCopied(false), 2000) // Reset after 2 seconds
    } catch (error) {
      console.error('Failed to copy:', error)
      addToast({
        type: 'error',
        title: 'Não foi possível copiar',
        description: 'Não foi possível copiar o conteúdo do prompt'
      })
    }
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    openPromptEditor(prompt)
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const confirmed = await confirmAction({
      title: 'Excluir prompt?',
      description: `Tem certeza de que deseja excluir "${prompt.title}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      destructive: true
    })
    if (!confirmed) return
    // The store shows the success or error toast itself
    await deletePrompt(prompt.id)
  }

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await duplicatePrompt(prompt.id)
  }

  // In selection mode a click on the card selects it (Shift+click: a range) instead of opening it
  const handleCardClick = (e: React.MouseEvent) => {
    if (selectable) {
      onToggleSelect?.(e.shiftKey)
      return
    }
    onClick?.(e)
  }

  // Keyboard: Tab reaches the card, Enter or Space opens it (or selects it in selection mode).
  // Keys pressed on the buttons inside the card are theirs.
  const handleCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
    e.preventDefault()
    if (selectable) {
      onToggleSelect?.(e.shiftKey)
      return
    }
    onClick?.(e)
  }

  // Shift+click would also select the page text between the two cards
  const handleCardMouseDown = (e: React.MouseEvent) => {
    if (selectable && e.shiftKey) e.preventDefault()
  }

  const truncateContent = (content: string, maxLength: number = 120) => {
    if (content.length <= maxLength) return content
    return content.slice(0, maxLength) + '...'
  }

  const isCardVariant = variant === 'card'
  const shouldCompact = compact
  const usageCount = prompt.usage_count ?? 0
  const pinLabel = prompt.is_pinned ? 'Desafixar' : 'Fixar no topo'

  // Hidden actions (list) show up on hover and also when a button inside the card has keyboard focus
  const actionVisibility = isCardVariant
    ? "opacity-60 hover:opacity-100 focus-visible:opacity-100"
    : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"

  const cardContent = (
    <>
      {/* Header section with title and actions */}
      <div className="flex items-start justify-between gap-2 sm:gap-3 min-w-0">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            readOnly
            onClick={(e) => {
              e.stopPropagation()
              onToggleSelect?.(e.shiftKey)
            }}
            className="mt-1 h-4 w-4 shrink-0 cursor-pointer accent-primary"
            aria-label={`Selecionar "${prompt.title}"`}
          />
        )}

        {stepNumber !== undefined && (
          <span
            className="mt-0.5 inline-flex h-6 min-w-[1.5rem] shrink-0 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-semibold text-primary"
            title={stepCount ? `Passo ${stepNumber} de ${stepCount}` : `Passo ${stepNumber}`}
          >
            <span aria-hidden="true">{stepNumber}</span>
            <span className="sr-only">{stepCount ? `Passo ${stepNumber} de ${stepCount}:` : `Passo ${stepNumber}:`}</span>
          </span>
        )}

        <div className="flex-1 min-w-0">
          <h3 className={cn(
            "font-medium line-clamp-2 break-words [overflow-wrap:anywhere]",
            shouldCompact ? "text-sm leading-5" : "text-base",
            isCardVariant ? "mb-2" : ""
          )}>
            {prompt.title}
          </h3>

          {prompt.description && !shouldCompact && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-2 break-words [overflow-wrap:anywhere]">
              {prompt.description}
            </p>
          )}

          {/* The card variant shows its own, longer content preview below */}
          {!shouldCompact && !isCardVariant && (
            <p className="text-sm text-muted-foreground mt-2 line-clamp-2 break-words [overflow-wrap:anywhere]">
              {truncateContent(prompt.content)}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleCopy}
            className={cn(
              "h-6 w-6 p-0 flex items-center justify-center transition-opacity",
              actionVisibility
            )}
            aria-label={justCopied ? 'Copiado!' : 'Copiar conteúdo'}
            title={justCopied ? 'Copiado!' : 'Copiar conteúdo'}
          >
            {justCopied ? (
              <Check className="h-3.5 w-3.5 text-green-600" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* A pinned prompt always shows its pin, so it is clear why it is at the top */}
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePinToggle}
            className={cn(
              "h-6 w-6 p-0 flex items-center justify-center transition-opacity",
              prompt.is_pinned ? "text-primary opacity-100" : actionVisibility
            )}
            aria-label={pinLabel}
            aria-pressed={prompt.is_pinned}
            title={pinLabel}
          >
            <Pin className={cn("h-3.5 w-3.5", prompt.is_pinned && "fill-current")} />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={handleFavoriteToggle}
            className={cn(
              "h-6 w-6 p-0 flex items-center justify-center transition-opacity",
              actionVisibility
            )}
            aria-label={prompt.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
            aria-pressed={prompt.is_favorite}
            title={prompt.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
          >
            <Heart className={cn(
              "h-3.5 w-3.5",
              prompt.is_favorite && "fill-current text-red-500"
            )} />
          </Button>

          {!shouldCompact && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={(e) => e.stopPropagation()}
                  className={cn(
                    "h-6 w-6 p-0 flex items-center justify-center transition-opacity",
                    actionVisibility
                  )}
                  aria-label="Mais ações"
                  title="Mais ações"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem onClick={handleEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Editar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleDuplicate}>
                  <Files className="h-4 w-4 mr-2" />
                  Duplicar
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handlePinToggle}>
                  {prompt.is_pinned ? <PinOff className="h-4 w-4 mr-2" /> : <Pin className="h-4 w-4 mr-2" />}
                  {pinLabel}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={handleDelete}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Excluir
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>

      {/* Content preview for card variant */}
      {isCardVariant && (
        <div className="flex-1 min-h-0 mt-2">
          <p className="text-xs text-muted-foreground line-clamp-4 leading-relaxed break-words [overflow-wrap:anywhere]">
            {truncateContent(prompt.content, 180)}
          </p>
        </div>
      )}

      {/* Footer section with metadata and tags */}
      <div className={cn(
        "space-y-2 border-t pt-2 mt-auto",
        isCardVariant ? "mt-3" : "mt-3 pt-3"
      )}>
        {/* Metadata row */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground min-w-0">
          {prompt.category_name && (
            <div className="flex items-center gap-1 min-w-0">
              <div
                className="h-2 w-2 rounded-full flex-shrink-0"
                style={{ backgroundColor: prompt.category_color }}
              />
              <span className="truncate">{prompt.category_name}</span>
            </div>
          )}

          <div className="flex items-center gap-1 flex-shrink-0">
            <Calendar className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="hidden sm:inline text-[11px]">{formatRelativeDate(prompt.updated_at)}</span>
            <span className="sm:hidden text-[11px]">{formatRelativeDate(prompt.updated_at).replace('há ', '')}</span>
          </div>

          {usageCount > 0 && (
            <span
              className="text-[11px] truncate"
              title={prompt.last_used_at ? `Usado por último ${formatRelativeDate(prompt.last_used_at)}` : undefined}
            >
              {formatUsageCount(usageCount)}
            </span>
          )}
        </div>

        {/* Tags row */}
        {prompt.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 min-w-0">
            {prompt.tags.map((tag, index) => (
              <Badge
                key={index}
                variant="secondary"
                className={cn(
                  "text-xs leading-tight max-w-full",
                  isCardVariant ? "h-4 px-2 text-[10px]" : shouldCompact ? "h-4 px-1.5" : "h-5 px-2"
                )}
              >
                <span className="truncate">{tag}</span>
              </Badge>
            ))}
          </div>
        )}
      </div>
    </>
  )

  const selectedClasses = selected ? "ring-2 ring-primary border-primary" : ""
  const focusClasses = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
  const keyboardProps = {
    tabIndex: 0,
    role: 'group' as const,
    'aria-label': selectable
      ? `${prompt.title}${selected ? ' (selecionado)' : ''}. Enter para ${selected ? 'desmarcar' : 'selecionar'}`
      : `${prompt.title}. Enter para abrir os detalhes`,
    onKeyDown: handleCardKeyDown,
  }

  if (variant === 'card') {
    return (
      <Card
        className={cn(
          "group cursor-pointer hover:shadow-md transition-all duration-200 h-full flex flex-col min-w-0",
          focusClasses,
          selectedClasses
        )}
        onClick={handleCardClick}
        onMouseDown={handleCardMouseDown}
        {...keyboardProps}
      >
        <CardContent className="p-3 sm:p-4 flex-1 flex flex-col min-w-0">
          {cardContent}
        </CardContent>
      </Card>
    )
  }

  return (
    <div
      className={cn(
        "group p-4 border rounded-lg cursor-pointer hover:shadow-sm hover:border-accent transition-all min-w-0",
        focusClasses,
        selectedClasses
      )}
      onClick={handleCardClick}
      onMouseDown={handleCardMouseDown}
      {...keyboardProps}
    >
      {cardContent}
    </div>
  )
}
