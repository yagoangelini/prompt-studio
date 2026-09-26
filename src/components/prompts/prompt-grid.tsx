import { PromptCollection } from './prompt-collection'
import type { Prompt } from '@/types'

interface PromptGridProps {
  prompts: readonly Prompt[]
  compactMode?: boolean
}

// Fewer columns in compact mode (when the editor or details panel is open on the right)
export function PromptGrid({ prompts, compactMode = false }: PromptGridProps) {
  return <PromptCollection prompts={prompts} layout="grid" compactMode={compactMode} />
}
