import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, GripVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePromptStore } from '@/stores/usePromptStore'
import { cn } from '@/lib/utils'
import type { Category, Prompt } from '@/types'
import { getSequenceSteps, moveAmongVisible, moveRelativeTo } from './organization-utils'

// Own drag type: a text/plain payload would be inserted into a text field if dropped there
const DRAG_TYPE = 'application/x-prompt-studio-step'

type DropPosition = 'before' | 'after'

interface SequenceStepsProps {
  category: Category
  // Visible steps (a search may hide some), in step order
  steps: readonly Prompt[]
  layout: 'list' | 'grid'
  className: string
  // False in selection mode: clicks select the prompts instead
  reorderable: boolean
  renderCard: (prompt: Prompt, step: { stepNumber: number; stepCount: number }) => ReactNode
}

const focusStepControl = (promptId: number, preferred: 'up' | 'down') => {
  const other = preferred === 'up' ? 'down' : 'up'
  // Wait for React to move the card: the moved prompt keeps the keyboard focus
  requestAnimationFrame(() => {
    for (const control of [preferred, other]) {
      const button = document.querySelector<HTMLButtonElement>(`[data-step-control="${promptId}:${control}"]`)
      if (button && !button.disabled) {
        button.focus()
        return
      }
    }
  })
}

/**
 * Steps of a sequence category: step number, reordering by drag and drop (HTML5, no library) and by
 * keyboard (buttons, or Alt+↑ / Alt+↓ inside the step). Changes are saved at once.
 */
export function SequenceSteps({ category, steps, layout, className, reorderable, renderCard }: SequenceStepsProps) {
  const prompts = usePromptStore((state) => state.prompts)
  const reorderSequence = usePromptStore((state) => state.reorderSequence)
  const [draggingId, setDraggingId] = useState<number | null>(null)
  const [dropTarget, setDropTarget] = useState<{ id: number; position: DropPosition } | null>(null)
  const [announcement, setAnnouncement] = useState('')

  // Full step order of the category (numbers do not change when a search hides some steps)
  const order = useMemo(() => getSequenceSteps(category.id, prompts).map((p) => p.id), [category.id, prompts])
  const stepNumbers = useMemo(() => new Map(order.map((id, index) => [id, index + 1])), [order])
  const visibleIds = steps.map((p) => p.id)

  const commit = async (next: number[], movedId: number) => {
    if (next.length === order.length && next.every((id, index) => id === order[index])) return false
    const saved = await reorderSequence(category.id, next)
    if (saved) {
      const title = prompts.find((p) => p.id === movedId)?.title ?? 'O prompt'
      setAnnouncement(`"${title}" agora é o passo ${next.indexOf(movedId) + 1} de ${next.length}.`)
    }
    return saved
  }

  const move = async (promptId: number, direction: -1 | 1) => {
    const next = moveAmongVisible(order, visibleIds, promptId, direction)
    if (!next) return
    await commit(next, promptId)
    focusStepControl(promptId, direction === -1 ? 'up' : 'down')
  }

  const resetDrag = () => {
    setDraggingId(null)
    setDropTarget(null)
  }

  const dropPositionFor = (event: React.DragEvent<HTMLElement>): DropPosition => {
    const rect = event.currentTarget.getBoundingClientRect()
    return layout === 'grid'
      ? (event.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
      : (event.clientY < rect.top + rect.height / 2 ? 'before' : 'after')
  }

  return (
    <>
      <div className={className}>
        {steps.map((prompt, visibleIndex) => {
          const stepNumber = stepNumbers.get(prompt.id) ?? visibleIndex + 1
          const isFirst = visibleIndex === 0
          const isLast = visibleIndex === steps.length - 1
          const showDrop = dropTarget?.id === prompt.id && draggingId !== null && draggingId !== prompt.id
          return (
            <div
              key={prompt.id}
              className={cn(
                'relative flex min-w-0 gap-1',
                layout === 'grid' && 'h-full',
                draggingId === prompt.id && 'opacity-50'
              )}
              draggable={reorderable}
              onDragStart={(event) => {
                if (!reorderable) return
                event.dataTransfer.effectAllowed = 'move'
                event.dataTransfer.setData(DRAG_TYPE, String(prompt.id))
                setDraggingId(prompt.id)
              }}
              onDragOver={(event) => {
                if (draggingId === null || !event.dataTransfer.types.includes(DRAG_TYPE)) return
                event.preventDefault()
                event.dataTransfer.dropEffect = 'move'
                const position = dropPositionFor(event)
                if (dropTarget?.id !== prompt.id || dropTarget.position !== position) {
                  setDropTarget({ id: prompt.id, position })
                }
              }}
              onDrop={(event) => {
                if (draggingId === null || !event.dataTransfer.types.includes(DRAG_TYPE)) return
                event.preventDefault()
                const movedId = draggingId
                const position = dropPositionFor(event)
                resetDrag()
                void commit(moveRelativeTo(order, movedId, prompt.id, position), movedId)
              }}
              onDragEnd={resetDrag}
              onKeyDown={(event) => {
                if (!reorderable || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                event.preventDefault()
                void move(prompt.id, event.key === 'ArrowUp' ? -1 : 1)
              }}
            >
              {showDrop && (
                <div
                  aria-hidden="true"
                  className={cn(
                    'pointer-events-none absolute z-10 rounded-full bg-primary',
                    layout === 'grid'
                      ? cn('top-0 bottom-0 w-1', dropTarget?.position === 'before' ? '-left-2' : '-right-2')
                      : cn('left-0 right-0 h-1', dropTarget?.position === 'before' ? '-top-2' : '-bottom-2')
                  )}
                />
              )}

              {reorderable && (
                <div className="flex shrink-0 flex-col items-center gap-0.5 pt-2">
                  <GripVertical
                    className="h-4 w-4 cursor-grab text-muted-foreground active:cursor-grabbing"
                    aria-hidden="true"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    data-step-control={`${prompt.id}:up`}
                    disabled={isFirst}
                    onClick={() => void move(prompt.id, -1)}
                    aria-label={`Mover "${prompt.title}" para cima (Alt+↑)`}
                    title="Mover para cima (Alt+↑)"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    data-step-control={`${prompt.id}:down`}
                    disabled={isLast}
                    onClick={() => void move(prompt.id, 1)}
                    aria-label={`Mover "${prompt.title}" para baixo (Alt+↓)`}
                    title="Mover para baixo (Alt+↓)"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </Button>
                </div>
              )}

              <div className="min-w-0 flex-1">
                {renderCard(prompt, { stepNumber, stepCount: order.length })}
              </div>
            </div>
          )
        })}
      </div>
      <div aria-live="polite" className="sr-only">{announcement}</div>
    </>
  )
}
