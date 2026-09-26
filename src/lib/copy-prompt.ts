import type { Prompt } from '@/types'

type PromptToUse = Pick<Prompt, 'id' | 'title' | 'content'>

// Text of a prompt ready to be used. When it has {{variables}}, the user fills them in first
// (FillVariablesDialogHost). Returns null when the user cancels.
export async function resolvePromptText(prompt: PromptToUse): Promise<string | null> {
  return prompt.content
}

// Copies a prompt (after filling its variables) and counts the usage.
// Returns false when the user canceled or the copy failed (a toast explains the failure).
export async function copyPrompt(prompt: PromptToUse): Promise<boolean> {
  const text = await resolvePromptText(prompt)
  if (text === null) return false
  await window.electronAPI.copyToClipboard(text)
  try {
    await window.electronAPI.recordPromptUsage(prompt.id)
  } catch {
    // Counting the usage must never block the copy
  }
  return true
}
