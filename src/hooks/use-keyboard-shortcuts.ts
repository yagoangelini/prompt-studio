import { useEffect, useRef } from 'react'

/**
 * Where a shortcut still fires while the focus is in a text field:
 * - 'always': in any field (Ctrl+S, Ctrl+F, Ctrl+O)
 * - 'search': only in search fields, never while editing other fields (Ctrl+N, Ctrl+T)
 * - 'never': only when the focus is outside text fields
 */
export type ShortcutFieldScope = 'always' | 'search' | 'never'

export interface KeyboardShortcut {
  key: string
  // Ctrl on Windows/Linux, Cmd on macOS (both flags mean the same modifier)
  ctrl?: boolean
  cmd?: boolean
  alt?: boolean
  shift?: boolean
  // Default: 'never' for shortcuts without Ctrl/Cmd, 'always' for Ctrl/Cmd shortcuts
  inTextFields?: ShortcutFieldScope
  action: () => void
  description: string
}

interface UseKeyboardShortcutsOptions {
  enabled?: boolean
}

export const isMacPlatform = () =>
  typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')

// Search fields of the app: the advanced search (data-search-input) and the "Buscar ..." inputs
export const SEARCH_FIELD_SELECTOR =
  '[data-search-input], input[type="search"], [role="searchbox"], input[placeholder^="Buscar" i]'

export function isTextField(element: Element | null): element is HTMLElement {
  if (!(element instanceof HTMLElement)) return false
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') return true
  if (element.isContentEditable || element.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]')) return true
  if (element.tagName !== 'INPUT') return false
  const type = (element as HTMLInputElement).type
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes(type)
}

export function isSearchField(element: Element | null): boolean {
  return element instanceof HTMLElement && element.matches(SEARCH_FIELD_SELECTOR)
}

function isAllowedInField(shortcut: KeyboardShortcut, target: Element | null): boolean {
  if (!isTextField(target)) return true
  const scope = shortcut.inTextFields ?? (shortcut.ctrl || shortcut.cmd ? 'always' : 'never')
  if (scope === 'always') return true
  if (scope === 'search') return isSearchField(target)
  return false
}

export function matchesShortcut(shortcut: KeyboardShortcut, event: KeyboardEvent, isMac = isMacPlatform()): boolean {
  if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) return false
  const ctrlOrCmd = isMac ? event.metaKey : event.ctrlKey
  const wantsCtrlOrCmd = Boolean(shortcut.ctrl || shortcut.cmd)
  return (
    ctrlOrCmd === wantsCtrlOrCmd &&
    event.altKey === Boolean(shortcut.alt) &&
    event.shiftKey === Boolean(shortcut.shift)
  )
}

export function useKeyboardShortcuts(
  shortcuts: KeyboardShortcut[],
  options: UseKeyboardShortcutsOptions = {}
) {
  const { enabled = true } = options
  // Latest shortcuts without re-registering the listener on every render
  const shortcutsRef = useRef(shortcuts)
  shortcutsRef.current = shortcuts

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Ignore auto-repeat (holding Ctrl+T would cycle the themes) and IME composition
      if (event.repeat || event.isComposing) return

      const target = event.target instanceof Element ? event.target : document.activeElement

      // Esc leaves a search field, so the shortcuts that don't work while typing become available
      if (event.key === 'Escape' && !event.defaultPrevented && isSearchField(target)) {
        (target as HTMLElement).blur()
        return
      }

      const isMac = isMacPlatform()
      for (const shortcut of shortcutsRef.current) {
        if (!matchesShortcut(shortcut, event, isMac)) continue
        if (!isAllowedInField(shortcut, target)) return
        event.preventDefault()
        event.stopPropagation()
        shortcut.action()
        return
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [enabled])
}

// Utility function to get the display string for a shortcut
export function getShortcutDisplay(shortcut: Omit<KeyboardShortcut, 'action'>): string {
  const isMac = isMacPlatform()
  const parts: string[] = []

  if (shortcut.ctrl || shortcut.cmd) {
    parts.push(isMac ? '⌘' : 'Ctrl')
  }

  if (shortcut.alt) {
    parts.push(isMac ? '⌥' : 'Alt')
  }

  if (shortcut.shift) {
    parts.push(isMac ? '⇧' : 'Shift')
  }

  parts.push(shortcut.key.toUpperCase())

  return parts.join(isMac ? '' : ' + ')
}
