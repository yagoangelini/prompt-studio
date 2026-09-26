import { useMemo, useState } from 'react'
import { Check, Copy, ListOrdered, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePromptStore } from '@/stores/usePromptStore'
import { copyPrompt } from '@/lib/copy-prompt'
import type { Category } from '@/types'
import { getSequenceSteps } from './organization-utils'

interface SequenceHeaderProps {
  category: Category
}

/**
 * Header of a sequence category: how many steps it has and "Copiar próximo passo", which copies the step
 * after the last one copied (kept per category) and moves forward at each copy.
 */
export function SequenceHeader({ category }: SequenceHeaderProps) {
  const prompts = usePromptStore((state) => state.prompts)
  // The last step copied changes here and on the cards (markSequenceStepCopied)
  const lastCopiedId = usePromptStore((state) => state.sequenceProgress[String(category.id)])
  const markSequenceStepCopied = usePromptStore((state) => state.markSequenceStepCopied)
  const resetSequenceProgress = usePromptStore((state) => state.resetSequenceProgress)
  const addToast = usePromptStore((state) => state.addToast)
  const [copying, setCopying] = useState(false)

  // Same rule as getNextSequenceStep in the store: the step after the last one copied
  const steps = useMemo(() => getSequenceSteps(category.id, prompts), [category.id, prompts])
  const lastIndex = lastCopiedId === undefined ? -1 : steps.findIndex((p) => p.id === lastCopiedId)
  const next = steps[lastIndex + 1] ?? null
  const nextNumber = lastIndex + 2
  const started = lastIndex >= 0
  const stepCount = steps.length

  const handleCopyNext = async () => {
    if (!next || copying) return
    setCopying(true)
    try {
      // copyPrompt fills the {{variables}}, counts the usage and shows the "copied" toast
      if (await copyPrompt(next)) markSequenceStepCopied(next)
    } catch (error) {
      console.error('Failed to copy the next step:', error)
      addToast({ type: 'error', title: 'Não foi possível copiar', description: 'Não foi possível copiar o próximo passo.' })
    } finally {
      setCopying(false)
    }
  }

  return (
    <section
      aria-label={`Sequência ${category.name}`}
      className="mb-4 rounded-lg border bg-muted/30 p-3 space-y-2"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <ListOrdered className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <h3 className="truncate text-sm font-medium" title={category.name}>
            Sequência: {category.name}
          </h3>
          <span className="shrink-0 text-xs text-muted-foreground">
            {stepCount} {stepCount === 1 ? 'passo' : 'passos'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={handleCopyNext} disabled={!next || copying}>
            {next ? <Copy className="h-4 w-4 mr-2" /> : <Check className="h-4 w-4 mr-2" />}
            {next ? 'Copiar próximo passo' : 'Todos os passos copiados'}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => resetSequenceProgress(category.id)}
            disabled={!started}
            title="Volta para o primeiro passo"
          >
            <RotateCcw className="h-4 w-4 mr-2" />
            Recomeçar
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground" aria-live="polite">
        {next
          ? <>Próximo: <span className="font-medium text-foreground">passo {nextNumber}</span> — {next.title}</>
          : 'Você copiou o último passo. Use "Recomeçar" para voltar ao primeiro.'}
      </p>
      <p className="text-xs text-muted-foreground">
        Arraste os prompts ou use os botões ↑ ↓ (ou Alt+↑ e Alt+↓) para mudar a ordem dos passos.
      </p>
    </section>
  )
}
