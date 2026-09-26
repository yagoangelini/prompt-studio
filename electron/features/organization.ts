import { BrowserWindow, ipcMain } from 'electron'
import type { Database } from 'sqlite3'
import type { FeatureContext, FeatureModule } from './context'
import {
  bulkDeletePrompts,
  bulkUpdatePrompts,
  recordPromptUsage,
  reorderPrompts,
  setPromptPinned,
} from '../database/organization-queries'

const requireDb = (ctx: FeatureContext): Database => {
  const db = ctx.getDb()
  if (!db) throw new Error('O banco de dados não está disponível')
  return db
}

// Organization: pinned prompts, usage count, ordered sequences, bulk actions, subcategories.
// Handlers throw pt-BR messages; the preload strips Electron's prefix before the UI shows them.
export const organizationFeature: FeatureModule = {
  name: 'organization',
  registerIpc(ctx) {
    ipcMain.handle('prompts:set-pinned', async (_event, id: unknown, pinned: unknown) =>
      setPromptPinned(requireDb(ctx), id, pinned)
    )

    ipcMain.handle('prompts:record-usage', async (event, id: unknown) => {
      if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) throw new Error('Prompt inválido')
      const prompt = await recordPromptUsage(requireDb(ctx), id)
      // The calling window updates its own list with the returned prompt (copyPrompt); the other windows
      // reload, so counts and the "Mais usados" order stay current everywhere
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && window.webContents.id !== event.sender.id) {
          window.webContents.send('app:data-changed')
        }
      }
      return prompt
    })

    ipcMain.handle('prompts:reorder', async (_event, categoryId: unknown, orderedIds: unknown) =>
      reorderPrompts(requireDb(ctx), categoryId, orderedIds)
    )

    ipcMain.handle('prompts:bulk-update', async (_event, ids: unknown, changes: unknown) =>
      bulkUpdatePrompts(requireDb(ctx), ids, changes)
    )

    ipcMain.handle('prompts:bulk-delete', async (_event, ids: unknown) =>
      bulkDeletePrompts(requireDb(ctx), ids)
    )
  },
}
