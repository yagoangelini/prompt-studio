import { fillVariables } from '@/components/prompts/fill-variables-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import type { Prompt } from '@/types'

type PromptToUse = Pick<Prompt, 'id' | 'title' | 'content'>

export interface ResolvePromptOptions {
  // Text of the confirm button of the variables dialog (default "Copiar"), e.g. "Colar" or "Testar"
  confirmLabel?: string
}

export interface CopyPromptOptions extends ResolvePromptOptions {
  // Success toast (default true); callers with their own feedback can turn it off. Errors always show one.
  toast?: boolean
}

// Text of a prompt ready to be used. When it has {{variables}}, the user fills them in first
// (FillVariablesDialogHost); without variables the content is returned at once, without any dialog.
// Returns null when the user cancels.
export async function resolvePromptText(
  prompt: PromptToUse,
  options: ResolvePromptOptions = {}
): Promise<string | null> {
  return fillVariables({
    promptId: prompt.id > 0 ? prompt.id : null,
    title: prompt.title,
    content: prompt.content,
    confirmLabel: options.confirmLabel
  })
}

// Counts the usage in the background; the list gets the new counters without a full reload
async function recordUsage(promptId: number) {
  try {
    const updated = await window.electronAPI.recordPromptUsage(promptId)
    if (!updated || updated.id !== promptId) return
    usePromptStore.setState((state) => ({
      prompts: state.prompts.map((prompt) =>
        prompt.id === promptId
          ? { ...prompt, usage_count: updated.usage_count, last_used_at: updated.last_used_at }
          : prompt
      )
    }))
  } catch (error) {
    // Counting the usage must never get in the way of the copy
    console.warn('Failed to record prompt usage:', error)
  }
}

// Copies a prompt (after filling its variables) and counts the usage.
// Returns false when the user canceled or the copy failed (a toast explains the failure).
export async function copyPrompt(prompt: PromptToUse, options: CopyPromptOptions = {}): Promise<boolean> {
  const text = await resolvePromptText(prompt, options)
  if (text === null) return false

  const { addToast } = usePromptStore.getState()
  try {
    const result = await window.electronAPI.copyToClipboard(text)
    if (result && result.success === false) throw new Error('Clipboard write failed')
  } catch (error) {
    console.error('Failed to copy prompt:', error)
    addToast({
      type: 'error',
      title: 'Não foi possível copiar',
      description: 'Não foi possível copiar o prompt para a área de transferência. Tente novamente.'
    })
    return false
  }

  if (prompt.id > 0) void recordUsage(prompt.id)
  // Copying a step of a sequence from anywhere (panel, Ctrl+K, menu bar) moves "Copiar próximo passo" on.
  // The store takes the category from its own list, so callers don't need to pass it.
  const stored = usePromptStore.getState().prompts.find((p) => p.id === prompt.id)
  if (stored) usePromptStore.getState().markSequenceStepCopied(stored)
  if (options.toast !== false) {
    addToast({
      type: 'success',
      title: 'Copiado para a área de transferência',
      description: prompt.title ? `"${prompt.title}"` : undefined,
      duration: 2500
    })
  }
  return true
}
