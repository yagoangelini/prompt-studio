import { useEffect, useRef } from 'react'
import { isMacPlatform, isTextField } from '@/hooks/use-keyboard-shortcuts'
import { usePromptStore } from '@/stores/usePromptStore'
import type { Prompt } from '@/types'

// Marks the area of the prompt list: Ctrl/Cmd+A selects prompts only while the focus is there (or nowhere)
export const PROMPT_LIST_AREA_ATTRIBUTE = 'data-prompt-list-area'

const hasOpenOverlay = () =>
  document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]') !== null

/**
 * Keyboard of the selection mode: Ctrl/Cmd+A selects every prompt of the filtered list (entering the
 * selection mode) and Esc leaves it. Text fields, dialogs and menus keep these keys for themselves.
 */
export function useSelectionShortcuts(visiblePrompts: readonly Prompt[], enabled: boolean) {
  const visibleRef = useRef(visiblePrompts)
  visibleRef.current = visiblePrompts

  useEffect(() => {
    if (!enabled) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      const active = document.activeElement
      if (isTextField(active) || hasOpenOverlay()) return
      const modifier = isMacPlatform() ? event.metaKey : event.ctrlKey

      if (modifier && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'a') {
        const inListArea = !active || active === document.body || active.closest(`[${PROMPT_LIST_AREA_ATTRIBUTE}]`) !== null
        if (!inListArea || visibleRef.current.length === 0) return
        event.preventDefault()
        usePromptStore.getState().setSelectedPromptIds(visibleRef.current.map((prompt) => prompt.id))
        return
      }

      if (event.key === 'Escape' && !modifier && !event.altKey && usePromptStore.getState().isSelectionMode) {
        event.preventDefault()
        usePromptStore.getState().setSelectionMode(false)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}
