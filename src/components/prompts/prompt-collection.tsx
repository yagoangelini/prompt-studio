import type { ReactNode } from 'react'
import { FolderTree, Pin } from 'lucide-react'
import { PromptCard } from './prompt-card'
import { SequenceHeader } from '../organization/sequence-header'
import { SequenceSteps } from '../organization/sequence-steps'
import { getSequenceCategoryForQuery, usePromptStore } from '@/stores/usePromptStore'
import type { Prompt } from '@/types'

interface PromptCollectionProps {
  // Already filtered and sorted by the store (getFilteredPrompts)
  prompts: readonly Prompt[]
  layout: 'list' | 'grid'
  // Fewer grid columns while the editor or the details panel is open
  compactMode?: boolean
}

function SectionHeading({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <h3 className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
      {icon}
      {children}
    </h3>
  )
}

/**
 * The prompt list or grid: pinned prompts under "Fixados", the steps of a sequence category in order
 * (with reordering), and the selection mode used by the bulk actions.
 */
export function PromptCollection({ prompts, layout, compactMode = false }: PromptCollectionProps) {
  const openPromptViewer = usePromptStore((state) => state.openPromptViewer)
  const isSelectionMode = usePromptStore((state) => state.isSelectionMode)
  const selectedPromptIds = usePromptStore((state) => state.selectedPromptIds)
  const togglePromptSelection = usePromptStore((state) => state.togglePromptSelection)
  const query = usePromptStore((state) => state.searchFilters.query)
  const categories = usePromptStore((state) => state.categories)
  const sequence = getSequenceCategoryForQuery(query, categories)

  const containerClass = layout === 'list'
    ? 'space-y-3'
    : compactMode
      ? 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4'
      : 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 sm:gap-4'

  const selected = new Set(selectedPromptIds)
  const orderedIds = prompts.map((p) => p.id)

  const renderCard = (prompt: Prompt, step?: { stepNumber: number; stepCount: number }) => (
    <PromptCard
      key={prompt.id}
      prompt={prompt}
      variant={layout === 'grid' ? 'card' : 'list'}
      onClick={() => openPromptViewer(prompt)}
      selectable={isSelectionMode}
      selected={selected.has(prompt.id)}
      onToggleSelect={(range) => togglePromptSelection(prompt.id, { range, orderedIds })}
      stepNumber={step?.stepNumber}
      stepCount={step?.stepCount}
    />
  )

  if (sequence) {
    const steps = prompts.filter((p) => p.category_id === sequence.id)
    const others = prompts.filter((p) => p.category_id !== sequence.id)
    return (
      <div className="space-y-6">
        <div>
          <SequenceHeader category={sequence} />
          {steps.length > 0 && (
            <SequenceSteps
              category={sequence}
              steps={steps}
              layout={layout}
              className={containerClass}
              reorderable={!isSelectionMode}
              renderCard={renderCard}
            />
          )}
        </div>
        {others.length > 0 && (
          <section aria-label="Prompts das subcategorias">
            <SectionHeading icon={<FolderTree className="h-3.5 w-3.5" aria-hidden="true" />}>
              Das subcategorias
            </SectionHeading>
            <div className={containerClass}>{others.map((prompt) => renderCard(prompt))}</div>
          </section>
        )}
      </div>
    )
  }

  const pinned = prompts.filter((p) => p.is_pinned)
  if (pinned.length === 0) {
    return <div className={containerClass}>{prompts.map((prompt) => renderCard(prompt))}</div>
  }

  const rest = prompts.filter((p) => !p.is_pinned)
  return (
    <div className="space-y-6">
      <section aria-label="Fixados">
        <SectionHeading icon={<Pin className="h-3.5 w-3.5" aria-hidden="true" />}>Fixados</SectionHeading>
        <div className={containerClass}>{pinned.map((prompt) => renderCard(prompt))}</div>
      </section>
      {rest.length > 0 && (
        <section aria-label="Outros prompts">
          <SectionHeading>Outros prompts</SectionHeading>
          <div className={containerClass}>{rest.map((prompt) => renderCard(prompt))}</div>
        </section>
      )}
    </div>
  )
}
