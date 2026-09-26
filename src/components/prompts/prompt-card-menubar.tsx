import { useState } from 'react'
import { Heart, Copy, ChevronDown, ChevronUp, Check, Edit, Calendar, Files, GripHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePromptStore } from '@/stores/usePromptStore'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { cn, parseDbDate } from '@/lib/utils'
import { copyPrompt } from '@/lib/copy-prompt'
import type { Prompt } from '@/types'

interface MenubarPromptCardProps {
  prompt: Prompt
  onClick?: () => void
}

export function MenubarPromptCard({ prompt, onClick }: MenubarPromptCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [justCopied, setJustCopied] = useState(false)
  const [contentHeight, setContentHeight] = useState(192) // Default 192px (h-48)
  const [isDragging, setIsDragging] = useState(false)
  
  const { updatePrompt, duplicatePrompt } = usePromptStore()

  const handleFavoriteToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await updatePrompt(prompt.id, { 
        is_favorite: !prompt.is_favorite 
      })
    } catch (error) {
      console.error('Failed to toggle favorite:', error)
    }
  }

  // Fills the {{variables}} first (if any), copies, counts the usage and shows the toast. `origin`
  // gets the focus back when the variables dialog closes (it has no trigger, so the focus would land on
  // <body> and the arrows would start over from the first card).
  const copy = async (origin: HTMLElement | null) => {
    try {
      if (await copyPrompt(prompt)) {
        setJustCopied(true)
        setTimeout(() => setJustCopied(false), 2000)
      }
    } catch (error) {
      console.error('Failed to copy:', error)
    } finally {
      // After the dialog is gone: its focus scope gives the focus away right after unmounting
      setTimeout(() => {
        const active = document.activeElement
        const lost = !active || active === document.body
        if (origin?.isConnected && lost) origin.focus()
      }, 50)
    }
  }

  const handleCopy = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    void copy(e.currentTarget.closest<HTMLElement>('[data-menubar-card]'))
  }

  // Enter on the card itself (not on one of its buttons) copies it; the menu bar layout moves the
  // focus between cards with the arrows
  const handleCardKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget || e.nativeEvent.isComposing) return
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    e.preventDefault()
    void copy(e.currentTarget)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (onClick) onClick()
  }

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsExpanded(!isExpanded)
  }

  const handleDuplicate = async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await duplicatePrompt(prompt.id)
    } catch (error) {
      console.error('Failed to duplicate:', error)
    }
  }

  const formatDate = (dateString: string) => {
    try {
      const date = parseDbDate(dateString)
      const distance = formatDistanceToNow(date, { addSuffix: true, locale: ptBR })
      // Shorten the output for menubar
      return distance.replace('cerca de ', '').replace('há menos de um minuto', 'agora')
    } catch {
      return 'Desconhecida'
    }
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    setIsDragging(true)
    
    const startY = e.clientY
    const startHeight = contentHeight

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = e.clientY - startY
      const newHeight = Math.max(80, Math.min(400, startHeight + deltaY)) // Min 80px, Max 400px
      setContentHeight(newHeight)
    }

    const handleMouseUp = () => {
      setIsDragging(false)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
  }

  return (
    <TooltipProvider>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <div
          tabIndex={0}
          role="group"
          aria-label={`${prompt.title} (Enter copia)`}
          aria-keyshortcuts="Enter"
          data-menubar-card=""
          onKeyDown={handleCardKeyDown}
          className={cn(
            "group border rounded-lg transition-all duration-200",
            isExpanded ? "bg-accent/50 border-accent" : "hover:border-accent hover:bg-accent/20",
            "relative outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:border-accent"
          )}
        >
          {/* Main Card Content */}
          <div className="p-2.5">
            {/* Header Row */}
            <div className="flex items-start gap-2">
              <div className="flex-1 min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <h4 className="text-sm font-medium line-clamp-1 cursor-help">
                      {prompt.title}
                    </h4>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start">
                    <p className="text-xs max-w-xs break-words">{prompt.title}</p>
                  </TooltipContent>
                </Tooltip>
                
                {/* Quick metadata */}
                <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                  {prompt.category_name && (
                    <div className="flex items-center gap-1 min-w-0">
                      <div 
                        className="h-1.5 w-1.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: prompt.category_color }}
                      />
                      <span className="truncate">
                        {prompt.category_name}
                      </span>
                    </div>
                  )}
                  <span className="flex-shrink-0">
                    {formatDate(prompt.updated_at)}
                  </span>
                </div>

                {/* Tags */}
                {prompt.tags.length > 0 && !isExpanded && (
                  <div className="flex items-center gap-0.5 mt-1 overflow-hidden">
                    {prompt.tags.slice(0, 3).map((tag, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="h-3.5 px-1 text-[10px] flex-shrink-0"
                      >
                        {tag}
                      </Badge>
                    ))}
                    {prompt.tags.length > 3 && (
                      <Badge
                        variant="secondary"
                        className="h-3.5 px-1 text-[10px] flex-shrink-0"
                      >
                        +{prompt.tags.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </div>

              {/* Action buttons: always in the DOM so they can be reached with Tab; shown on hover or
                  when one of them has the keyboard focus. 24 px targets. */}
              <div className="absolute right-1.5 top-1.5 flex items-center gap-1 shrink-0 rounded-md bg-background/95 p-0.5 shadow-sm opacity-0 pointer-events-none transition-opacity duration-200 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
                {/* Expand/Collapse */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <CollapsibleTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={toggleExpanded}
                        aria-label={isExpanded ? 'Recolher conteúdo' : 'Ver conteúdo'}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                      </Button>
                    </CollapsibleTrigger>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">{isExpanded ? 'Recolher' : 'Ver conteúdo'}</p>
                  </TooltipContent>
                </Tooltip>

                {/* Copy */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleCopy}
                      className="h-6 w-6 p-0"
                      aria-label="Copiar conteúdo"
                    >
                      {justCopied ? (
                        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden="true" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Copiar</p>
                  </TooltipContent>
                </Tooltip>

                {/* Favorite */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleFavoriteToggle}
                      className="h-6 w-6 p-0"
                      aria-label={prompt.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
                      aria-pressed={prompt.is_favorite}
                    >
                      <Heart className={cn(
                        "h-3.5 w-3.5",
                        prompt.is_favorite && "fill-current text-red-500"
                      )} aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">{prompt.is_favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}</p>
                  </TooltipContent>
                </Tooltip>

                {/* Duplicate */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDuplicate}
                      className="h-6 w-6 p-0"
                      aria-label="Duplicar"
                    >
                      <Files className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Duplicar</p>
                  </TooltipContent>
                </Tooltip>

                {/* Edit */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleEdit}
                      className="h-6 w-6 p-0"
                      aria-label="Editar"
                    >
                      <Edit className="h-3.5 w-3.5" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p className="text-xs">Editar</p>
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>

          {/* Expandable Content */}
          <CollapsibleContent>
            <div className="px-2.5 pb-2.5 pt-0">
              <div className="border-t pt-2">
                {/* Description */}
                {prompt.description && (
                  <p className="text-xs text-muted-foreground mb-2">
                    {prompt.description}
                  </p>
                )}
                
                {/* Full Content */}
                <div className="relative">
                  <div 
                    className="bg-background/50 rounded-t p-2 overflow-y-auto border-b-0"
                    style={{ height: `${contentHeight}px` }}
                  >
                    <p className="text-xs font-mono whitespace-pre-wrap break-words">
                      {prompt.content}
                    </p>
                  </div>
                  {/* Resize Handle */}
                  <div
                    className={cn(
                      "flex items-center justify-center h-3 bg-background/50 rounded-b border-t cursor-ns-resize hover:bg-accent/50 transition-colors",
                      isDragging && "bg-accent/70"
                    )}
                    onMouseDown={handleMouseDown}
                    title="Arraste para redimensionar"
                  >
                    <GripHorizontal className="h-3 w-3 text-muted-foreground" />
                  </div>
                </div>

                {/* All Tags */}
                {prompt.tags.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-2">
                    {prompt.tags.map((tag, index) => (
                      <Badge
                        key={index}
                        variant="secondary"
                        className="h-3.5 px-1 text-[10px] inline-flex"
                      >
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </TooltipProvider>
  )
}