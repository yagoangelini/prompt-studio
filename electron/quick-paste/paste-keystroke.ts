import { execFile } from 'child_process'
import { systemPreferences } from 'electron'
import { WindowsPasteHelper } from './windows-paste-helper'
import { BLOCKED_TARGET_ERROR, isProtectedWindow } from './paste-guard'

// Simulates the paste shortcut (Ctrl+V / Cmd+V) in the app that had the focus before the quick paste
// window opened. Windows: PowerShell helper kept alive (see windows-paste-helper.ts); macOS: osascript
// (needs the Accessibility permission); Linux: xdotool, when installed.

export interface PasteSupport {
  readonly available: boolean
  // pt-BR note for the settings screen (permission, missing tool...)
  readonly note: string | null
}

export interface PasteOutcome {
  readonly pasted: boolean
  // pt-BR message shown in the quick paste window when pasted is false
  readonly error?: string
}

const isMac = process.platform === 'darwin'
const PASTE_KEYS = isMac ? 'Cmd+V' : 'Ctrl+V'
const COPIED_SUFFIX = ` O prompt foi copiado: cole com ${PASTE_KEYS}.`

const MAC_PERMISSION_NOTE =
  'Para colar automaticamente, permita o Prompt Studio em Ajustes do Sistema > Privacidade e Segurança > Acessibilidade.'
const LINUX_XDOTOOL_NOTE =
  'Para colar automaticamente, instale o xdotool (por exemplo: sudo apt install xdotool).'
const LINUX_WAYLAND_NOTE =
  'Em sessões Wayland, a colagem automática pode não funcionar em alguns aplicativos.'
const NO_FOCUS_ERROR = `Não foi possível voltar ao aplicativo anterior para colar.${COPIED_SUFFIX}`
const GENERIC_ERROR = `Não foi possível colar automaticamente.${COPIED_SUFFIX}`
const UNCHECKED_ERROR = `Não foi possível conferir o programa de destino para colar com segurança.${COPIED_SUFFIX}`

// When the focus cannot be checked: time for the previous app to get the focus back
const FOCUS_RETURN_DELAY_MS = 200
// Windows helper: how long to wait for the focus to be back on the previous window
const FOCUS_TIMEOUT_MS = 800
// Windows helper still starting when a paste is asked for: how long the paste may wait for it
const HELPER_START_WAIT_MS = 1500

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const run = (command: string, args: readonly string[]): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      execFile(command, [...args], { timeout: 5000, windowsHide: true }, (error) => resolve(!error))
    } catch {
      resolve(false)
    }
  })

export class PasteKeystroke {
  private readonly helper = process.platform === 'win32' ? new WindowsPasteHelper() : null
  // Linux: null until the check finishes
  private xdotool: boolean | null = null
  private accessibilityRequested = false

  start(): void {
    if (this.helper) void this.helper.start()
    if (process.platform === 'linux') {
      void run('xdotool', ['version']).then((available) => {
        this.xdotool = available
      })
    }
  }

  stop(): void {
    this.helper?.stop()
  }

  support(): PasteSupport {
    if (process.platform === 'win32') return { available: true, note: null }
    if (isMac) {
      return systemPreferences.isTrustedAccessibilityClient(false)
        ? { available: true, note: null }
        : { available: false, note: MAC_PERMISSION_NOTE }
    }
    if (this.xdotool === false) return { available: false, note: LINUX_XDOTOOL_NOTE }
    return { available: true, note: process.env.XDG_SESSION_TYPE === 'wayland' ? LINUX_WAYLAND_NOTE : null }
  }

  // Message for the quick paste window when automatic paste is not available
  unavailableMessage(): string {
    const { note } = this.support()
    return note ? `${note}${COPIED_SUFFIX}` : GENERIC_ERROR
  }

  // macOS: shows the system prompt that leads to the Accessibility settings (once per session)
  requestPermission(): void {
    if (!isMac || this.accessibilityRequested) return
    this.accessibilityRequested = true
    systemPreferences.isTrustedAccessibilityClient(true)
  }

  // Windows: handle of the window that has the focus (where the prompt will be pasted); null elsewhere
  // or when the helper is not ready
  async captureForegroundWindow(): Promise<string | null> {
    return this.helper ? await this.helper.foregroundWindow(80) : null
  }

  // Windows: gives the focus to the quick paste window when the system did not (foreground lock)
  async ensureForeground(hwnd: string): Promise<void> {
    if (!this.helper) return
    const outcome = await this.helper.activate(hwnd, 500)
    if (outcome === 'failed') console.warn('Quick paste window could not take the focus')
  }

  // Called right after the quick paste window was hidden. targetHwnd: window captured when it opened
  // (Windows); popupHwnd: the quick paste window itself.
  async paste(targetHwnd: string | null, popupHwnd: string | null): Promise<PasteOutcome> {
    if (process.platform === 'win32') return this.pasteOnWindows(targetHwnd, popupHwnd)
    await delay(FOCUS_RETURN_DELAY_MS)
    if (isMac) {
      const ok = await run('osascript', ['-e', 'tell application "System Events" to keystroke "v" using command down'])
      return ok ? { pasted: true } : { pasted: false, error: `${MAC_PERMISSION_NOTE}${COPIED_SUFFIX}` }
    }
    const ok = await run('xdotool', ['key', '--clearmodifiers', 'ctrl+v'])
    if (!ok && this.xdotool === null) this.xdotool = false
    return ok ? { pasted: true } : { pasted: false, error: this.xdotool === false ? `${LINUX_XDOTOOL_NOTE}${COPIED_SUFFIX}` : GENERIC_ERROR }
  }

  // Ctrl+V is only sent after the window that will receive it was seen and approved: never blindly,
  // and never into a system or credential dialog (paste-guard.ts)
  private async pasteOnWindows(targetHwnd: string | null, popupHwnd: string | null): Promise<PasteOutcome> {
    const helper = this.helper
    if (!helper) return { pasted: false, error: GENERIC_ERROR }
    if (!helper.canPaste) await Promise.race([helper.start(), delay(HELPER_START_WAIT_MS)])
    if (!helper.canPaste) return { pasted: false, error: UNCHECKED_ERROR }
    const waited = await helper.waitForTarget(targetHwnd, popupHwnd ?? '0', FOCUS_TIMEOUT_MS)
    if (waited.kind === 'nofocus') return { pasted: false, error: NO_FOCUS_ERROR }
    if (waited.kind === 'error') return { pasted: false, error: GENERIC_ERROR }
    if (isProtectedWindow(waited.target)) {
      console.warn('Quick paste refused a protected window:', waited.target.processName, waited.target.className)
      return { pasted: false, error: BLOCKED_TARGET_ERROR }
    }
    const outcome = await helper.sendPaste(waited.target.hwnd)
    if (outcome === 'ok') return { pasted: true }
    return { pasted: false, error: outcome === 'nofocus' ? NO_FOCUS_ERROR : GENERIC_ERROR }
  }
}
