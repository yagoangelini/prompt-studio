// Extra quick paste IPC channels (handlers in electron/features/quick-paste.ts). They are called through
// window.electronAPI.invoke, so the preload and the ElectronAPI contract stay unchanged.
export const QUICK_PASTE_CHANNELS = {
  // () => QuickPasteStatus
  getStatus: 'quick-paste:get-status',
  // (text: string, promptId?: number) => { success: boolean; error?: string }: copies without pasting
  copy: 'quick-paste:copy',
  // (suspended: boolean) => QuickPasteStatus: frees the shortcut while the settings screen records a new one
  suspendShortcut: 'quick-paste:suspend-shortcut',
  // () => void: hides the menu bar popup (Esc in the menu bar window)
  hideMenuBar: 'quick-paste:hide-menu-bar',
} as const

// DOM event sent in a window after its settings card saved the quick paste settings, so the shortcut
// lists on screen show the new values
export const QUICK_PASTE_SETTINGS_CHANGED_EVENT = 'prompt-studio:quick-paste-settings-changed'

export interface QuickPasteStatus {
  // The configured shortcut is registered and working now
  readonly registered: boolean
  // pt-BR reason when the enabled shortcut could not be registered (e.g. used by another program)
  readonly shortcutError: string | null
  // Automatic paste works on this system (otherwise the prompt is only copied)
  readonly autoPasteAvailable: boolean
  // pt-BR note about automatic paste on this system (permission, missing tool...)
  readonly autoPasteNote: string | null
}
