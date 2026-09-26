import type { Database } from 'sqlite3'
import type { QuickPasteSettings } from '../../src/types'
import { getSetting, setSetting } from '../database/queries'
import {
  DEFAULT_QUICK_PASTE_SHORTCUT,
  validateAccelerator,
  type ShortcutPlatform,
} from '../../src/components/quick-paste/accelerator'

// Row of the settings table (JSON)
export const QUICK_PASTE_SETTINGS_KEY = 'quickPaste'

export const DEFAULT_QUICK_PASTE_SETTINGS: QuickPasteSettings = {
  enabled: true,
  shortcut: DEFAULT_QUICK_PASTE_SHORTCUT,
  autoPaste: true,
}

export const currentShortcutPlatform = (): ShortcutPlatform =>
  process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'

// Saved value -> settings. Missing, corrupted or invalid fields fall back to the defaults.
export function parseStoredSettings(raw: string | null, platform: ShortcutPlatform): QuickPasteSettings {
  let stored: Record<string, unknown> = {}
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>
  } catch {
    // Corrupted value: defaults
  }
  const shortcut = validateAccelerator(stored.shortcut, platform)
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_QUICK_PASTE_SETTINGS.enabled,
    shortcut: shortcut.ok ? shortcut.accelerator : DEFAULT_QUICK_PASTE_SETTINGS.shortcut,
    autoPaste: typeof stored.autoPaste === 'boolean' ? stored.autoPaste : DEFAULT_QUICK_PASTE_SETTINGS.autoPaste,
  }
}

export type SettingsInputResult =
  | { readonly ok: true; readonly settings: QuickPasteSettings }
  | { readonly ok: false; readonly error: string }

// Validates settings sent by the renderer (never trusted as typed)
export function parseSettingsInput(input: unknown, platform: ShortcutPlatform): SettingsInputResult {
  if (!input || typeof input !== 'object') return { ok: false, error: 'Configurações inválidas.' }
  const { enabled, shortcut, autoPaste } = input as Record<string, unknown>
  if (typeof enabled !== 'boolean' || typeof autoPaste !== 'boolean') {
    return { ok: false, error: 'Configurações inválidas.' }
  }
  const accelerator = validateAccelerator(shortcut, platform)
  if (!accelerator.ok) return { ok: false, error: accelerator.error }
  return { ok: true, settings: { enabled, shortcut: accelerator.accelerator, autoPaste } }
}

export async function loadQuickPasteSettings(db: Database): Promise<QuickPasteSettings> {
  return parseStoredSettings(await getSetting(db, QUICK_PASTE_SETTINGS_KEY), currentShortcutPlatform())
}

export async function saveQuickPasteSettings(db: Database, settings: QuickPasteSettings): Promise<void> {
  await setSetting(db, QUICK_PASTE_SETTINGS_KEY, JSON.stringify(settings))
}
