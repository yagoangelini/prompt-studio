import type { BrowserWindow } from 'electron'
import type { Database } from 'sqlite3'

// Renderer pages built by Vite (index.html, menubar.html, quickpaste.html)
export type RendererPage = 'index' | 'menubar' | 'quickpaste'

// What the main process offers to feature modules (electron/features/*)
export interface FeatureContext {
  readonly isDev: boolean
  // Absolute path of the preload script, for new BrowserWindows
  readonly preloadPath: string
  getDb(): Database | null
  getMainWindow(): BrowserWindow | null
  getMenuBarWindow(): BrowserWindow | null
  // Sends an event to every open window
  broadcast(channel: string, payload?: unknown): void
  // Loads one of the renderer pages into a window (Vite dev server or dist/ files)
  loadPage(window: BrowserWindow, page: RendererPage): Promise<void>
  // Shows the main desktop window (switching from menu bar mode when needed)
  showMainWindow(): Promise<void>
}

// A feature plugs into the main process through these hooks, so features don't edit main.ts
export interface FeatureModule {
  readonly name: string
  // Registers IPC handlers. Called once, after the database is ready and before windows are created.
  registerIpc(ctx: FeatureContext): void
  // Called once the windows exist (global shortcuts, schedulers, extra windows)
  start?(ctx: FeatureContext): void | Promise<void>
  // Called while the app quits, before the database is closed
  stop?(): void | Promise<void>
}
