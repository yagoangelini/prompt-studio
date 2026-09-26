import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { join } from 'path'
import type { Database } from 'sqlite3'
import type { FeatureContext, FeatureModule } from './context'
import type {
  ApiTestRequest,
  ApiTestResponse,
  BackupFile,
  BackupRestoreResult,
  BackupRunResult,
  ClaudeCommandsExportResult,
} from '../../src/types'
import { prepareApiTest, runPreparedApiTest } from '../api-test'
import { closeDatabase, getDatabasePath } from '../database/init'
import { getAllCategories, getAllPrompts, getSetting, setSetting } from '../database/queries'
import { buildTestRun, clearTestRuns, deleteTestRun, insertTestRun, listTestRuns } from '../data-tools/test-runs'
import { describeWriteError, planCommandFiles, resolveProjectDir, writeCommandFiles } from '../data-tools/claude-commands'
import {
  BACKUP_SETTINGS_KEY,
  createBackupFile,
  describeBackupError,
  ensureWritableDirectory,
  isBackupDue,
  isKnownBackupPath,
  listBackupFiles,
  parseBackupSettings,
  pruneBackups,
  restoreDatabaseFile,
  sanitizeBackupSettingsInput,
  sqliteUtcTimestamp,
  type StoredBackupSettings,
} from '../data-tools/backup'

// ---- "Testes" requests ----

// Extra fields the "Testes" panel sends with ApiTestRequest: the prompt the text came from (saved in the
// history) and a key that identifies the request, so a comparison can run two requests at once
type TestPromptRequest = ApiTestRequest & { readonly promptId?: unknown; readonly runKey?: unknown }

interface RunningTest {
  readonly key: string
  readonly controller: AbortController
}

// Running requests per window (webContents id), so they can be canceled
const apiTests = new Map<number, Set<RunningTest>>()

const runKeyOf = (value: unknown): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 40) : 'test'

// ---- Claude Code commands ----

const LAST_COMMANDS_DIR_KEY = 'claudeCommandsLastDir'

const plural = (count: number, singular: string, pluralForm: string) => (count === 1 ? singular : pluralForm)

const listNames = (paths: readonly string[]) => {
  const shown = paths.slice(0, 5).join(', ')
  return paths.length > 5 ? `${shown} e mais ${paths.length - 5}` : shown
}

// ---- Automatic backup ----

const BACKUP_FIRST_CHECK_MS = 15_000
const BACKUP_CHECK_INTERVAL_MS = 60 * 60 * 1000

let featureContext: FeatureContext | null = null
let firstCheckTimer: NodeJS.Timeout | null = null
let checkInterval: NodeJS.Timeout | null = null
let restoring = false
// Backups, settings changes and restores run one at a time
let backupQueue: Promise<unknown> = Promise.resolve()

const exclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const next = backupQueue.then(task, task)
  backupQueue = next.catch(() => undefined)
  return next
}

const readBackupSettings = async (db: Database): Promise<StoredBackupSettings> =>
  parseBackupSettings(await getSetting(db, BACKUP_SETTINGS_KEY))

const writeBackupSettings = async (db: Database, settings: StoredBackupSettings): Promise<void> => {
  await setSetting(db, BACKUP_SETTINGS_KEY, JSON.stringify(settings))
}

// Safety backups go to the backup folder, or to <userData>/backups when none was chosen
const safetyDirectoryOf = (settings: StoredBackupSettings): string =>
  settings.directory ?? join(app.getPath('userData'), 'backups')

// onlyIfDue: the scheduler's call, decided inside the queue so two checks never make two backups
const runBackup = (options: { onlyIfDue?: boolean } = {}): Promise<BackupRunResult> =>
  exclusive(async (): Promise<BackupRunResult> => {
    if (restoring) return { success: false, error: 'Uma restauração está em andamento.' }
    const db = featureContext?.getDb()
    if (!db) return { success: false, error: 'O banco de dados não está disponível.' }
    const settings = await readBackupSettings(db)
    if (options.onlyIfDue && !isBackupDue(settings)) return { success: true }
    if (!settings.directory) return { success: false, error: 'Escolha a pasta onde os backups serão salvos.' }
    try {
      const filePath = await createBackupFile(getDatabasePath(), settings.directory, 'auto')
      await pruneBackups(settings.directory, settings.keep)
      await writeBackupSettings(db, { ...(await readBackupSettings(db)), lastBackupAt: sqliteUtcTimestamp(new Date()), lastError: null })
      return { success: true, filePath }
    } catch (error) {
      const message = `Não foi possível fazer o backup (${describeBackupError(error)}).`
      try {
        await writeBackupSettings(db, { ...(await readBackupSettings(db)), lastError: message })
      } catch (saveError) {
        console.error('Could not save the backup error:', saveError)
      }
      return { success: false, error: message }
    }
  })

// Called at startup and every hour: backs up when the last backup is older than 24 hours.
// force: back up now anyway (the backup folder has just changed).
const checkScheduledBackup = async (force = false): Promise<void> => {
  if (restoring) return
  const db = featureContext?.getDb()
  if (!db) return
  try {
    if (!(await readBackupSettings(db)).enabled) return
    const result = await runBackup({ onlyIfDue: !force })
    if (!result.success) console.error('Automatic backup failed:', result.error)
  } catch (error) {
    console.error('Automatic backup check failed:', error)
  }
}

const stopScheduler = () => {
  if (firstCheckTimer) clearTimeout(firstCheckTimer)
  if (checkInterval) clearInterval(checkInterval)
  firstCheckTimer = null
  checkInterval = null
}

const startScheduler = (firstCheckMs: number = BACKUP_FIRST_CHECK_MS, forceFirst = false) => {
  stopScheduler()
  firstCheckTimer = setTimeout(() => void checkScheduledBackup(forceFirst), firstCheckMs)
  checkInterval = setInterval(() => void checkScheduledBackup(), BACKUP_CHECK_INTERVAL_MS)
  // Timers must not keep the process alive on their own
  firstCheckTimer.unref?.()
  checkInterval.unref?.()
}

// Restarts the app after the renderer had a moment to show the result
const scheduleRelaunch = (delayMs: number) => {
  setTimeout(() => {
    app.relaunch()
    app.exit(0)
  }, delayMs)
}

// Data tools: automatic backup, Claude Code commands export, "Testes" requests and their history
export const dataToolsFeature: FeatureModule = {
  name: 'data-tools',
  registerIpc(ctx) {
    featureContext = ctx

    // ---- "Testes" panel ----
    // Every executed request (success, error or canceled) is saved in test_runs. Invalid input is
    // answered right away and not saved.
    ipcMain.handle('test-prompt', async (event, request: TestPromptRequest): Promise<ApiTestResponse> => {
      const prepared = prepareApiTest(request)
      if (!prepared.ok) return prepared.response

      const windowId = event.sender.id
      const key = runKeyOf(request?.runKey)
      const running = apiTests.get(windowId) ?? new Set<RunningTest>()
      apiTests.set(windowId, running)
      // A new request replaces the previous one with the same key in this window
      for (const test of running) {
        if (test.key === key) test.controller.abort()
      }
      const entry: RunningTest = { key, controller: new AbortController() }
      running.add(entry)
      let response: ApiTestResponse
      try {
        response = await runPreparedApiTest(prepared.test, entry.controller.signal)
      } finally {
        running.delete(entry)
        if (running.size === 0 && apiTests.get(windowId) === running) apiTests.delete(windowId)
      }

      const db = ctx.getDb()
      if (db) {
        try {
          await insertTestRun(db, buildTestRun(prepared.test, response, request?.promptId, key.startsWith('compare') ? 'compare' : 'test'))
        } catch (error) {
          console.error('Could not save the test run:', error)
        }
      }
      return response
    })

    // Without arguments cancels every request of the window; with a key (or a list of keys), only those
    ipcMain.handle('test-prompt:cancel', (event, keys?: unknown) => {
      const running = apiTests.get(event.sender.id)
      if (!running) return { success: false }
      const wanted = keys === undefined || keys === null
        ? null
        : new Set((Array.isArray(keys) ? keys : [keys]).map(runKeyOf))
      let canceled = 0
      for (const test of running) {
        if (wanted === null || wanted.has(test.key)) {
          test.controller.abort()
          canceled++
        }
      }
      return { success: canceled > 0 }
    })

    ipcMain.handle('test-runs:list', async (_event, options?: unknown) => {
      const db = ctx.getDb()
      return db ? await listTestRuns(db, options) : []
    })

    ipcMain.handle('test-runs:delete', async (_event, id: unknown) => {
      const db = ctx.getDb()
      return db ? await deleteTestRun(db, id) : { success: false }
    })

    ipcMain.handle('test-runs:clear', async () => {
      const db = ctx.getDb()
      return db ? await clearTestRuns(db) : { success: false, deleted: 0 }
    })

    // ---- Claude Code commands ----
    ipcMain.handle('claude-commands:export', async (event, promptIds: unknown): Promise<ClaudeCommandsExportResult> => {
      try {
        const ids = new Set(
          (Array.isArray(promptIds) ? promptIds : []).filter((id): id is number => Number.isInteger(id) && id > 0)
        )
        if (ids.size === 0) return { success: false, error: 'Selecione ao menos um prompt para exportar.' }
        const db = ctx.getDb()
        if (!db) return { success: false, error: 'O banco de dados não está disponível.' }

        const lastDirectory = await getSetting(db, LAST_COMMANDS_DIR_KEY).catch(() => null)
        const options: OpenDialogOptions = {
          title: 'Escolha a pasta do projeto',
          buttonLabel: 'Exportar para esta pasta',
          properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
          ...(lastDirectory ? { defaultPath: lastDirectory } : {}),
        }
        const owner = BrowserWindow.fromWebContents(event.sender)
        const choice = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
        const chosen = choice.filePaths[0]
        if (choice.canceled || !chosen) return { success: false, canceled: true }

        const projectDir = resolveProjectDir(chosen)
        const prompts = (await getAllPrompts(db)).filter((prompt) => ids.has(prompt.id))
        if (prompts.length === 0) {
          return { success: false, directory: projectDir, error: 'Os prompts escolhidos não existem mais.' }
        }
        const planned = planCommandFiles(prompts, await getAllCategories(db))
        const outcome = await writeCommandFiles(projectDir, planned)
        await setSetting(db, LAST_COMMANDS_DIR_KEY, projectDir).catch(() => undefined)

        const notes: string[] = []
        if (outcome.skipped.length > 0) {
          const count = outcome.skipped.length
          notes.push(
            `${count} ${plural(count, 'arquivo já existia e não foi substituído', 'arquivos já existiam e não foram substituídos')} ` +
            `porque não ${plural(count, 'foi criado', 'foram criados')} pelo Prompt Studio: ${listNames(outcome.skipped)}.`
          )
        }
        if (outcome.failed.length > 0) {
          const count = outcome.failed.length
          notes.push(
            `${count} ${plural(count, 'arquivo não pôde ser gravado', 'arquivos não puderam ser gravados')}: ` +
            `${listNames(outcome.failed.map((failure) => `${failure.path} (${failure.error})`))}.`
          )
        }
        const commands = Object.fromEntries(planned.map((file) => [file.relativePath, file.command]))
        // `skipped`, `failed` and `commands` go beyond ClaudeCommandsExportResult; `error` carries the same
        // information in pt-BR for callers that only know the contract
        return {
          success: outcome.written.length > 0,
          directory: projectDir,
          files: outcome.written,
          ...(notes.length > 0 ? { error: notes.join(' ') } : {}),
          ...(outcome.written.length === 0 && notes.length === 0 ? { error: 'Nenhum arquivo foi gravado.' } : {}),
          skipped: outcome.skipped,
          failed: outcome.failed,
          commands,
        } as ClaudeCommandsExportResult
      } catch (error) {
        return { success: false, error: `Não foi possível exportar os comandos (${describeWriteError(error)}).` }
      }
    })

    // ---- Automatic backup ----
    ipcMain.handle('backup:get-settings', async (): Promise<StoredBackupSettings> => {
      const db = ctx.getDb()
      if (!db) throw new Error('O banco de dados não está disponível.')
      return await readBackupSettings(db)
    })

    ipcMain.handle('backup:set-settings', async (_event, settings: unknown): Promise<StoredBackupSettings> => {
      const input = sanitizeBackupSettingsInput(settings)
      const db = ctx.getDb()
      if (!db) throw new Error('O banco de dados não está disponível.')
      if (input.directory) await ensureWritableDirectory(input.directory)
      const { saved, directoryChanged } = await exclusive(async () => {
        const current = await readBackupSettings(db)
        const changed = input.directory !== current.directory
        const next: StoredBackupSettings = {
          ...current,
          ...input,
          lastError: changed || !input.enabled ? null : current.lastError,
        }
        await writeBackupSettings(db, next)
        return { saved: next, directoryChanged: changed }
      })
      // Turning it on checks soon, not an hour later; a new folder gets its first backup right away
      if (saved.enabled && !restoring) startScheduler(2_000, directoryChanged)
      return saved
    })

    ipcMain.handle('backup:choose-directory', async (event): Promise<{ canceled: boolean; directory?: string }> => {
      const db = ctx.getDb()
      const current = db ? (await readBackupSettings(db).catch(() => null))?.directory : null
      const options: OpenDialogOptions = {
        title: 'Escolha a pasta dos backups',
        buttonLabel: 'Usar esta pasta',
        properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'],
        defaultPath: current ?? app.getPath('documents'),
      }
      const owner = BrowserWindow.fromWebContents(event.sender)
      const choice = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options)
      const directory = choice.filePaths[0]
      return choice.canceled || !directory ? { canceled: true } : { canceled: false, directory }
    })

    ipcMain.handle('backup:run', (): Promise<BackupRunResult> => runBackup())

    ipcMain.handle('backup:list', async (): Promise<readonly BackupFile[]> => {
      const db = ctx.getDb()
      if (!db) return []
      const settings = await readBackupSettings(db)
      const folders = [...new Set([settings.directory, safetyDirectoryOf(settings)].filter((dir): dir is string => Boolean(dir)))]
      const lists = await Promise.all(folders.map((folder) => listBackupFiles(folder)))
      return lists.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    })

    // Replaces the database with a backup and restarts the app. Only backups listed by backup:list are
    // accepted; the file is validated and the current database is backed up first.
    ipcMain.handle('backup:restore', async (_event, filePath: unknown): Promise<BackupRestoreResult> => {
      if (restoring) return { success: false, error: 'Uma restauração já está em andamento.' }
      const db = ctx.getDb()
      if (!db) return { success: false, error: 'O banco de dados não está disponível.' }
      const settings = await readBackupSettings(db)
      const safetyDirectory = safetyDirectoryOf(settings)
      if (!isKnownBackupPath(filePath, [settings.directory, safetyDirectory])) {
        return { success: false, error: 'Escolha um dos backups da lista.' }
      }
      restoring = true
      stopScheduler()
      return exclusive(async (): Promise<BackupRestoreResult> => {
        try {
          const outcome = await restoreDatabaseFile({
            backupPath: filePath,
            dbPath: getDatabasePath(),
            safetyDirectory,
            closeDatabase,
            settingsToKeep: settings,
          })
          if (outcome.ok) {
            scheduleRelaunch(800)
            return { success: true }
          }
          if (outcome.databaseClosed) {
            // The connection is closed: the app only works again after a restart (with the current data)
            scheduleRelaunch(4000)
            return { success: false, error: `${outcome.error} O Prompt Studio será reiniciado.`, restarting: true } as BackupRestoreResult
          }
          restoring = false
          startScheduler()
          return { success: false, error: outcome.error }
        } catch (error) {
          restoring = false
          startScheduler()
          return { success: false, error: `Não foi possível restaurar o backup (${describeBackupError(error)}).` }
        }
      })
    })
  },

  start(ctx) {
    featureContext = ctx
    startScheduler()
  },

  async stop() {
    stopScheduler()
    for (const running of apiTests.values()) {
      for (const test of running) test.controller.abort()
    }
    // Let a backup in progress finish (the app waits up to 5 s for all features)
    await backupQueue
  },
}
