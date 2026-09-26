import { PromptCollection } from './prompt-collection'
import type { Prompt } from '@/types'

interface PromptListProps {
  prompts: readonly Prompt[]
}

export function PromptList({ prompts }: PromptListProps) {
  return <PromptCollection prompts={prompts} layout="list" />
}
