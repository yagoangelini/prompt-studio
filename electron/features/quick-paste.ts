import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, screen } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import type { FeatureContext, FeatureModule } from './context'
import type { PasteResult, QuickPasteSettings, QuickPasteSettingsResult } from '../../src/types'
import { recordPromptUsage } from '../database/organization-queries'
import {
  DEFAULT_QUICK_PASTE_SETTINGS,
  currentShortcutPlatform,
  loadQuickPasteSettings,
  parseSettingsInput,
  saveQuickPasteSettings,
} from '../quick-paste/settings'
import { PasteKeystroke } from '../quick-paste/paste-keystroke'
import { getQuickPasteWindowBounds } from '../quick-paste/window-bounds'
import { formatAccelerator } from '../../src/components/quick-paste/accelerator'
import { QUICK_PASTE_CHANNELS, type QuickPasteStatus } from '../../src/components/quick-paste/quick-paste-types'

const WINDOW_SIZE = { width: 560, height: 440 } as const
// A suspended shortcut (settings screen recording a new one) comes back by itself after this
const SUSPEND_TIMEOUT_MS = 60_000
// A notice shown after a failed paste (window shown without focus) never stays on screen longer
const NOTICE_TIMEOUT_MS = 5_000

// Where the prompt goes back to: the window that had the focus when the shortcut was pressed
interface PasteTarget {
  // Windows: native handle captured by the helper
  readonly hwnd: string | null
  // One of our own windows (main window, menu bar popup), when it had the focus
  readonly ownWindow: BrowserWindow | null
}

const nativeHandle = (window: BrowserWindow): string => {
  const buffer = window.getNativeWindowHandle()
  return buffer.length >= 8 ? buffer.readBigUInt64LE(0).toString() : buffer.readUInt32LE(0).toString()
}

class QuickPasteController {
  private ctx: FeatureContext | null = null
  private window: BrowserWindow | null = null
  private pageReady: Promise<void> | null = null
  private settings: QuickPasteSettings = DEFAULT_QUICK_PASTE_SETTINGS
  private settingsLoaded: Promise<void> | null = null
  // Accelerator currently registered by this module (null = none)
  private registered: string | null = null
  private shortcutError: string | null = null
  private suspended = false
  private suspendTimer: NodeJS.Timeout | null = null
  private noticeTimer: NodeJS.Timeout | null = null
  private opening = false
  private quitting = false
  private target: PasteTarget = { hwnd: null, ownWindow: null }
  private readonly keystroke = new PasteKeystroke()

  registerIpc(ctx: FeatureContext): void {
    this.ctx = ctx

    ipcMain.handle('quick-paste:get-settings', async (): Promise<QuickPasteSettings> => {
      await this.loadSettings()
      return this.settings
    })

    ipcMain.handle('quick-paste:set-settings', (_event, input: unknown) => this.updateSettings(input))

    ipcMain.handle('quick-paste:paste', (event, text: unknown, promptId: unknown) => this.paste(event, text, promptId))

    ipcMain.handle('quick-paste:hide', () => {
      this.hide(true)
    })

    ipcMain.handle(QUICK_PASTE_CHANNELS.getStatus, async (): Promise<QuickPasteStatus> => {
      await this.loadSettings()
      return this.getStatus()
    })

    ipcMain.handle(QUICK_PASTE_CHANNELS.copy, async (event, text: unknown, promptId: unknown) => {
      if (typeof text !== 'string') return { success: false, error: 'Texto inválido.' }
      try {
        clipboard.writeText(text)
      } catch (error) {
        console.error('Quick paste copy failed:', error)
        return { success: false, error: 'Não foi possível copiar para a área de transferência.' }
      }
      this.recordUsage(promptId)
      // Copied from the quick paste window: back to the app where it will be pasted
      if (this.isQuickPasteSender(event)) await this.hideAndReturnFocus()
      return { success: true }
    })

    ipcMain.handle(QUICK_PASTE_CHANNELS.suspendShortcut, async (_event, suspended: unknown): Promise<QuickPasteStatus> => {
      await this.loadSettings()
      this.setSuspended(suspended === true)
      return this.getStatus()
    })

    ipcMain.handle(QUICK_PASTE_CHANNELS.hideMenuBar, () => {
      const menuBar = this.ctx?.getMenuBarWindow()
      if (menuBar && !menuBar.isDestroyed() && menuBar.isVisible()) menuBar.hide()
    })
  }

  async start(ctx: FeatureContext): Promise<void> {
    this.ctx = ctx
    // Our window may only close for real while the app quits
    app.on('before-quit', () => {
      this.quitting = true
    })
    // Backup of stop(): a global shortcut must never outlive the app
    app.on('will-quit', () => this.unregisterShortcut())

    await this.loadSettings()
    this.keystroke.start()
    try {
      this.ensureWindow()
    } catch (error) {
      console.error('Could not create the quick paste window:', error)
    }
    if (this.settings.enabled) this.registerShortcut(this.settings.shortcut)
  }

  stop(): void {
    this.quitting = true
    this.clearTimers()
    this.unregisterShortcut()
    this.keystroke.stop()
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }

  private loadSettings(): Promise<void> {
    if (!this.settingsLoaded) {
      this.settingsLoaded = (async () => {
        const db = this.ctx?.getDb()
        if (db) this.settings = await loadQuickPasteSettings(db)
      })().catch((error) => {
        console.error('Could not load the quick paste settings:', error)
      })
    }
    return this.settingsLoaded
  }

  private getStatus(): QuickPasteStatus {
    const support = this.keystroke.support()
    return {
      registered: this.registered !== null && this.registered === this.settings.shortcut,
      shortcutError: this.settings.enabled ? this.shortcutError : null,
      autoPasteAvailable: support.available,
      autoPasteNote: support.note,
    }
  }

  // ---- Global shortcut ----

  // Registers the accelerator in place of the current one. On failure the current one stays.
  private registerShortcut(accelerator: string): { ok: true } | { ok: false; error: string } {
    if (this.registered === accelerator) {
      this.shortcutError = null
      return { ok: true }
    }
    let ok = false
    try {
      ok = globalShortcut.register(accelerator, () => {
        void this.toggle()
      })
    } catch (error) {
      console.error('Invalid quick paste accelerator:', accelerator, error)
      ok = false
    }
    if (!ok) {
      const label = formatAccelerator(accelerator, currentShortcutPlatform())
      const error = `Não foi possível usar o atalho ${label}: essa combinação já é usada por outro programa, pelo sistema ou por outra cópia do Prompt Studio aberta. Feche a outra cópia ou escolha outra combinação.`
      this.shortcutError = error
      return { ok: false, error }
    }
    if (this.registered) globalShortcut.unregister(this.registered)
    this.registered = accelerator
    this.shortcutError = null
    return { ok: true }
  }

  private unregisterShortcut(): void {
    if (!this.registered) return
    try {
      globalShortcut.unregister(this.registered)
    } catch (error) {
      console.error('Could not unregister the quick paste shortcut:', error)
    }
    this.registered = null
  }

  private setSuspended(suspended: boolean): void {
    if (this.suspendTimer) clearTimeout(this.suspendTimer)
    this.suspendTimer = null
    this.suspended = suspended
    if (suspended) {
      this.unregisterShortcut()
      this.suspendTimer = setTimeout(() => this.setSuspended(false), SUSPEND_TIMEOUT_MS)
    } else if (this.settings.enabled && !this.quitting) {
      this.registerShortcut(this.settings.shortcut)
    }
  }

  private async updateSettings(input: unknown): Promise<QuickPasteSettingsResult> {
    await this.loadSettings()
    const parsed = parseSettingsInput(input, currentShortcutPlatform())
    if (!parsed.ok) return { success: false, settings: this.settings, error: parsed.error }
    const next = parsed.settings

    // Saving ends a suspension (the settings screen was recording the new shortcut)
    if (this.suspended) this.setSuspended(false)

    const { settings: applied, shortcutError, shortcutChanged } = this.applyShortcut(next)

    // The other options (autoPaste, enabled) are saved even when the shortcut could not be registered:
    // turning automatic paste off must never depend on the shortcut
    this.settings = applied
    const db = this.ctx?.getDb()
    if (db) {
      try {
        await saveQuickPasteSettings(db, applied)
      } catch (error) {
        console.error('Could not save the quick paste settings:', error)
        return {
          success: false,
          settings: applied,
          error: 'As configurações foram aplicadas, mas não puderam ser salvas. Elas voltarão ao valor anterior quando o app for reiniciado.',
        }
      }
    }
    // success = what was asked for is saved. A new shortcut that could not be registered was not
    // (the previous one stays); an unchanged shortcut that is still taken only comes back as `error`.
    if (shortcutError && shortcutChanged) return { success: false, settings: applied, error: shortcutError }
    return { success: true, settings: applied, ...(shortcutError ? { error: shortcutError } : {}) }
  }

  // Registers the shortcut of `next`. When a new shortcut cannot be registered, the previous one is kept
  // (and stays saved); the other fields of `next` apply anyway.
  private applyShortcut(next: QuickPasteSettings): {
    settings: QuickPasteSettings
    shortcutError: string | null
    shortcutChanged: boolean
  } {
    const shortcutChanged = next.shortcut !== this.settings.shortcut
    if (!next.enabled) {
      this.unregisterShortcut()
      this.shortcutError = null
      return { settings: next, shortcutError: null, shortcutChanged }
    }
    const result = this.registerShortcut(next.shortcut)
    if (result.ok) return { settings: next, shortcutError: null, shortcutChanged }
    if (!shortcutChanged) return { settings: next, shortcutError: result.error, shortcutChanged }
    // Keep the previous shortcut working (status then describes it)
    const kept = { ...next, shortcut: this.settings.shortcut }
    this.registerShortcut(kept.shortcut)
    return { settings: kept, shortcutError: result.error, shortcutChanged }
  }

  // ---- Window ----

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) return this.window
    const ctx = this.ctx
    if (!ctx) throw new Error('Quick paste is not initialized')

    // Transparent window: the page draws the rounded corners and the shadow. Linux needs a compositor
    // for transparency, so it gets a plain window there.
    const transparent = process.platform !== 'linux'
    const window = new BrowserWindow({
      ...WINDOW_SIZE,
      show: false,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      transparent,
      ...(transparent ? { backgroundColor: '#00000000', hasShadow: false } : {}),
      webPreferences: {
        preload: ctx.preloadPath,
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false,
      },
    })
    // Without a menu, the application menu accelerators (Ctrl+W closes, Ctrl+R reloads) don't apply here
    window.setMenu(null)
    if (process.platform === 'darwin') {
      window.setAlwaysOnTop(true, 'pop-up-menu')
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
    }

    window.on('blur', () => {
      // Hidden when the user clicks elsewhere. A notice shown without focus (failed paste) is not focused,
      // so it never blurs.
      if (window.isVisible()) window.hide()
    })
    window.on('close', (event) => {
      if (!this.quitting) {
        event.preventDefault()
        window.hide()
      }
    })
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.pageReady = null
      }
    })
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('Quick paste window renderer gone:', details.reason)
      // Created again on the next shortcut press
      if (!window.isDestroyed()) window.destroy()
    })

    this.window = window
    // Loaded in the background: the window is kept (hidden) between openings, so it opens instantly
    this.pageReady = ctx.loadPage(window, 'quickpaste').catch((error) => {
      console.error('Could not load the quick paste page:', error)
    })
    return window
  }

  private async toggle(): Promise<void> {
    if (this.opening) return
    const current = this.window
    if (current && !current.isDestroyed() && current.isVisible() && current.isFocused()) {
      this.hide(true)
      return
    }
    this.opening = true
    try {
      await this.open()
    } catch (error) {
      console.error('Could not open quick paste:', error)
    } finally {
      this.opening = false
    }
  }

  private async open(): Promise<void> {
    const window = this.ensureWindow()
    this.clearTimers()
    // Remember where to paste: read before our window takes the focus
    const focusedOwn = BrowserWindow.getFocusedWindow()
    this.target = {
      ownWindow: focusedOwn && focusedOwn !== window ? focusedOwn : null,
      hwnd: await this.keystroke.captureForegroundWindow(),
    }
    await this.pageReady
    if (window.isDestroyed()) return

    // Centered on the display where the mouse is
    const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    const bounds = getQuickPasteWindowBounds(workArea, WINDOW_SIZE)
    window.setBounds(bounds)
    // Moving to a monitor with another scale factor may resize the window (Windows): apply it again
    const [width, height] = window.getSize()
    if (width !== bounds.width || height !== bounds.height) window.setBounds(bounds)

    window.show()
    window.focus()
    window.webContents.focus()
    // The page resets the search and reloads the data (same event as the other windows)
    window.webContents.send('app:window-shown')

    if (process.platform === 'win32') {
      // Windows may refuse to move the focus (foreground lock): take it through the helper
      setTimeout(() => {
        if (!window.isDestroyed() && window.isVisible()) void this.keystroke.ensureForeground(nativeHandle(window))
      }, 50)
    }
  }

  // Hides the window. giveFocusBack: on macOS, the app that was active before gets the focus back.
  private hide(giveFocusBack: boolean): void {
    this.clearTimers()
    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return
    const wasFocused = window.isFocused()
    window.hide()
    if (giveFocusBack && wasFocused) void this.returnFocus()
  }

  private returnFocus(): Promise<void> {
    const own = this.target.ownWindow
    if (own && !own.isDestroyed() && own.isVisible()) {
      own.focus()
    } else if (process.platform === 'darwin') {
      // Hiding a window does not deactivate the app on macOS
      app.hide()
    } else if (process.platform === 'win32' && this.target.hwnd) {
      // Windows keeps the hidden popup as the foreground window (the focus goes nowhere), so the
      // field the user was typing in must get the focus back explicitly
      return this.keystroke.ensureForeground(this.target.hwnd)
    }
    // Linux gives the focus back to the previous window by itself
    return Promise.resolve()
  }

  private isQuickPasteSender(event: IpcMainInvokeEvent): boolean {
    const window = this.window
    return window !== null && !window.isDestroyed() && event.sender === window.webContents
  }

  // Only copied (Ctrl+Enter, or automatic paste off): close right away so Ctrl+V works at once
  private async hideAndReturnFocus(): Promise<void> {
    this.clearTimers()
    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return
    window.hide()
    await this.returnFocus()
  }

  private clearTimers(): void {
    if (this.noticeTimer) clearTimeout(this.noticeTimer)
    this.noticeTimer = null
  }

  // ---- Paste ----

  private recordUsage(promptId: unknown): void {
    const db = this.ctx?.getDb()
    if (!db || typeof promptId !== 'number' || !Number.isInteger(promptId) || promptId <= 0) return
    recordPromptUsage(db, promptId)
      .then(() => this.ctx?.broadcast('app:data-changed'))
      .catch((error) => console.error('Could not record the prompt usage:', error))
  }

  private async paste(event: IpcMainInvokeEvent, text: unknown, promptId: unknown): Promise<PasteResult> {
    try {
      if (typeof text !== 'string') return { success: false, pasted: false, error: 'Texto inválido.' }
      clipboard.writeText(text)
      this.recordUsage(promptId)

      const window = this.window
      const fromQuickPaste = window !== null && !window.isDestroyed() && event.sender === window.webContents
      if (!fromQuickPaste) return { success: true, pasted: false }
      if (!this.settings.autoPaste) {
        await this.hideAndReturnFocus()
        return { success: true, pasted: false }
      }

      if (!this.keystroke.support().available) {
        this.keystroke.requestPermission()
        return { success: true, pasted: false, error: this.keystroke.unavailableMessage() }
      }

      const popupHwnd = process.platform === 'win32' ? nativeHandle(window) : null
      const { hwnd } = this.target
      window.hide()
      // Windows: the helper waits for (and if needed restores) the focus on the captured window
      if (process.platform !== 'win32' || !hwnd) await this.returnFocus()
      const outcome = await this.keystroke.paste(hwnd, popupHwnd)
      if (!outcome.pasted && !window.isDestroyed()) {
        // Show the notice without taking the focus away from the app the user is in
        window.showInactive()
        this.noticeTimer = setTimeout(() => {
          if (!window.isDestroyed() && window.isVisible() && !window.isFocused()) window.hide()
        }, NOTICE_TIMEOUT_MS)
      }
      return { success: true, pasted: outcome.pasted, ...(outcome.error ? { error: outcome.error } : {}) }
    } catch (error) {
      console.error('Quick paste failed:', error)
      return { success: false, pasted: false, error: 'Não foi possível colar o prompt.' }
    }
  }
}

const controller = new QuickPasteController()

// Quick paste: global shortcut that opens a prompt picker and pastes into the active app
export const quickPasteFeature: FeatureModule = {
  name: 'quick-paste',
  registerIpc: (ctx) => controller.registerIpc(ctx),
  start: (ctx) => controller.start(ctx),
  stop: () => controller.stop(),
}
