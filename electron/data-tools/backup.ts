// Automatic backup of the SQLite database: VACUUM INTO snapshots, pruning, validation and restore.
// Safety rules: only files named by this module are ever removed; a restore validates the chosen file
// and makes a safety backup of the current database before replacing anything.
import sqlite3, { type Database } from 'sqlite3'
import { promises as fs } from 'fs'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { randomBytes } from 'crypto'
import type { BackupFile, BackupSettings } from '../../src/types'

export const BACKUP_SETTINGS_KEY = 'backup'
export const DEFAULT_BACKUP_KEEP = 10
export const MAX_BACKUP_KEEP = 100
// A new automatic backup is made when the last one is older than this
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000

const AUTO_PREFIX = 'prompt-studio'
const SAFETY_PREFIX = 'prompt-studio-antes-da-restauracao'
// prompt-studio-AAAAMMDD-HHMMSS.db (local time), "-2", "-3"... when two backups share the same second
export const BACKUP_FILE_PATTERN = /^prompt-studio-(\d{8})-(\d{6})(?:-(\d{1,3}))?\.db$/
// Made right before a restore. Never removed automatically.
export const SAFETY_BACKUP_FILE_PATTERN = /^prompt-studio-antes-da-restauracao-(\d{8})-(\d{6})(?:-(\d{1,3}))?\.db$/

// Tables every Prompt Studio database has had since the first release (newer ones are created on startup)
const REQUIRED_TABLES = ['settings', 'categories', 'templates', 'prompts', 'prompt_versions'] as const
const SQLITE_HEADER = 'SQLite format 3\u0000'

export type BackupKind = 'auto' | 'safety'

// What is saved in settings (key "backup"): the public settings plus the last automatic failure
export interface StoredBackupSettings extends BackupSettings {
  readonly lastError: string | null
}

export const DEFAULT_BACKUP_SETTINGS: StoredBackupSettings = {
  enabled: false,
  directory: null,
  keep: DEFAULT_BACKUP_KEEP,
  lastBackupAt: null,
  lastError: null,
}

const isValidKeep = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_BACKUP_KEEP

export const parseBackupSettings = (raw: string | null | undefined): StoredBackupSettings => {
  let stored: unknown = null
  try {
    stored = raw ? JSON.parse(raw) : null
  } catch {
    stored = null
  }
  if (!stored || typeof stored !== 'object') return DEFAULT_BACKUP_SETTINGS
  const record = stored as Record<string, unknown>
  const directory = typeof record.directory === 'string' && isAbsolute(record.directory) ? record.directory : null
  return {
    enabled: record.enabled === true && directory !== null,
    directory,
    keep: isValidKeep(record.keep) ? record.keep : DEFAULT_BACKUP_KEEP,
    lastBackupAt: typeof record.lastBackupAt === 'string' ? record.lastBackupAt : null,
    lastError: typeof record.lastError === 'string' ? record.lastError : null,
  }
}

// Validates the settings sent by the renderer. Throws a pt-BR message.
export const sanitizeBackupSettingsInput = (input: unknown): Omit<BackupSettings, 'lastBackupAt'> => {
  if (!input || typeof input !== 'object') throw new Error('Configuração de backup inválida')
  const record = input as Record<string, unknown>
  if (typeof record.enabled !== 'boolean') throw new Error('Configuração de backup inválida')
  let directory: string | null = null
  if (record.directory !== null && record.directory !== undefined) {
    if (typeof record.directory !== 'string' || !record.directory.trim() || !isAbsolute(record.directory.trim())) {
      throw new Error('A pasta dos backups é inválida. Escolha a pasta novamente.')
    }
    directory = resolve(record.directory.trim())
  }
  if (!isValidKeep(record.keep)) {
    throw new Error(`Informe quantos backups manter: um número inteiro entre 1 e ${MAX_BACKUP_KEEP}.`)
  }
  if (record.enabled && directory === null) throw new Error('Escolha a pasta onde os backups serão salvos.')
  return { enabled: record.enabled, directory, keep: record.keep }
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code

// pt-BR explanation for a file system error
export const describeBackupError = (error: unknown): string => {
  switch (errorCode(error)) {
    case 'ENOENT': return 'a pasta ou o arquivo não existe'
    case 'EACCES':
    case 'EPERM': return 'sem permissão para gravar'
    case 'EROFS': return 'a pasta é somente leitura'
    case 'ENOSPC': return 'não há espaço livre no disco'
    case 'EBUSY': return 'o arquivo está em uso por outro programa'
    case 'ENOTDIR':
    case 'EEXIST': return 'o caminho não é uma pasta'
    default: {
      const message = error instanceof Error ? error.message : String(error)
      if (/SQLITE_FULL/.test(message)) return 'não há espaço livre no disco'
      if (/SQLITE_(CANTOPEN|READONLY|PERM)/.test(message)) return 'não foi possível gravar o arquivo'
      return message || 'erro desconhecido'
    }
  }
}

// SQLite (Win32 API) refuses paths from 260 characters; the temporary file plus "-journal" must fit
const WINDOWS_SQLITE_PATH_LIMIT = 240
const MAX_WINDOWS_DIRECTORY_LENGTH = 200
const LONG_PATH_MESSAGE = 'o caminho da pasta é longo demais; escolha uma pasta com um caminho mais curto'

// Creates the folder when needed and checks that files can be written in it. Throws a pt-BR message.
export const ensureWritableDirectory = async (directory: string): Promise<void> => {
  if (process.platform === 'win32' && resolve(directory).length > MAX_WINDOWS_DIRECTORY_LENGTH) {
    throw new Error(`Não é possível usar a pasta escolhida (${LONG_PATH_MESSAGE}).`)
  }
  try {
    await fs.mkdir(directory, { recursive: true })
    const stats = await fs.stat(directory)
    if (!stats.isDirectory()) throw Object.assign(new Error('not a directory'), { code: 'ENOTDIR' })
    const probe = join(directory, `.prompt-studio-teste-${randomBytes(6).toString('hex')}.tmp`)
    await fs.writeFile(probe, '', { flag: 'wx' })
    await fs.rm(probe, { force: true })
  } catch (error) {
    throw new Error(`Não é possível gravar na pasta escolhida (${describeBackupError(error)}).`)
  }
}

const pad = (value: number, size = 2) => String(value).padStart(size, '0')

// Local time, as in the file names: AAAAMMDD-HHMMSS
export const backupTimestamp = (date: Date): string =>
  `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`

// SQLite UTC timestamp ("2026-09-25 19:21:11"), the format of every date in the database
export const sqliteUtcTimestamp = (date: Date): string => date.toISOString().replace('T', ' ').slice(0, 19)

const parseSqliteUtc = (value: string): number => {
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
  return new Date(normalized).getTime()
}

export const isBackupDue = (settings: BackupSettings, now: Date = new Date()): boolean => {
  if (!settings.enabled || !settings.directory) return false
  if (!settings.lastBackupAt) return true
  const last = parseSqliteUtc(settings.lastBackupAt)
  if (!Number.isFinite(last)) return true
  // A last backup "in the future" means the clock changed: back up again
  if (last > now.getTime() + 60 * 60 * 1000) return true
  return now.getTime() - last >= BACKUP_INTERVAL_MS
}

const openDatabase = (filePath: string, mode: number): Promise<Database> =>
  new Promise((resolvePromise, reject) => {
    const db: Database = new sqlite3.Database(filePath, mode, (err) => (err ? reject(err) : resolvePromise(db)))
  })

const closeQuietly = (db: Database): Promise<void> =>
  new Promise((resolvePromise) => db.close(() => resolvePromise()))

const allRows = <T>(db: Database, sql: string, params: unknown[] = []): Promise<T[]> =>
  new Promise((resolvePromise, reject) => db.all(sql, params, (err, rows) => (err ? reject(err) : resolvePromise(rows as T[]))))

const runSql = (db: Database, sql: string, params: unknown[] = []): Promise<void> =>
  new Promise((resolvePromise, reject) => db.run(sql, params, (err) => (err ? reject(err) : resolvePromise())))

const exists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.lstat(filePath)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

export type DatabaseCheck =
  | { readonly ok: true; readonly prompts: number }
  | { readonly ok: false; readonly error: string }

// Checks that a file is a readable, intact Prompt Studio database. Opened read-only unless `writable`
// (only for our own temporary copies).
export const validateDatabaseFile = async (filePath: string, options: { writable?: boolean } = {}): Promise<DatabaseCheck> => {
  let stats
  try {
    stats = await fs.stat(filePath)
  } catch {
    return { ok: false, error: 'O arquivo de backup não foi encontrado.' }
  }
  if (!stats.isFile()) return { ok: false, error: 'O item escolhido não é um arquivo.' }
  if (stats.size < 100) return { ok: false, error: 'O arquivo está vazio ou incompleto.' }

  try {
    const handle = await fs.open(filePath, 'r')
    try {
      const header = Buffer.alloc(16)
      await handle.read(header, 0, 16, 0)
      if (header.toString('latin1') !== SQLITE_HEADER) {
        return { ok: false, error: 'O arquivo não é um banco de dados SQLite.' }
      }
    } finally {
      await handle.close()
    }
  } catch {
    return { ok: false, error: 'Não foi possível ler o arquivo.' }
  }

  let db: Database
  try {
    db = await openDatabase(filePath, options.writable ? sqlite3.OPEN_READWRITE : sqlite3.OPEN_READONLY)
  } catch {
    return { ok: false, error: 'Não foi possível abrir o arquivo como banco de dados.' }
  }
  try {
    let check: { quick_check?: unknown }[]
    try {
      check = await allRows<{ quick_check?: unknown }>(db, 'PRAGMA quick_check')
    } catch {
      return { ok: false, error: 'O banco de dados do arquivo está corrompido.' }
    }
    if (check.length !== 1 || check[0]?.quick_check !== 'ok') {
      return { ok: false, error: 'O banco de dados do arquivo está corrompido.' }
    }
    const tables = new Set(
      (await allRows<{ name: string }>(db, "SELECT name FROM sqlite_master WHERE type = 'table'")).map((row) => row.name)
    )
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table))
    if (missing.length === REQUIRED_TABLES.length) {
      return { ok: false, error: 'O arquivo é um banco de dados SQLite, mas não é um backup do Prompt Studio.' }
    }
    if (missing.length > 0) {
      return { ok: false, error: `O arquivo não é um backup completo do Prompt Studio (faltam as tabelas: ${missing.join(', ')}).` }
    }
    const columns = new Set((await allRows<{ name: string }>(db, 'PRAGMA table_info(prompts)')).map((row) => row.name))
    if (!columns.has('title') || !columns.has('content')) {
      return { ok: false, error: 'O arquivo é um banco de dados SQLite, mas não é um backup do Prompt Studio.' }
    }
    const [count] = await allRows<{ total: number }>(db, 'SELECT COUNT(*) AS total FROM prompts')
    return { ok: true, prompts: Number(count?.total ?? 0) }
  } catch {
    return { ok: false, error: 'Não foi possível ler o conteúdo do banco de dados do arquivo.' }
  } finally {
    await closeQuietly(db)
  }
}

// Consistent snapshot through a separate read-only connection: it never waits for (or breaks) a
// transaction of the app's own connection. The output file uses the rollback journal (no -wal).
const vacuumInto = async (dbPath: string, target: string): Promise<void> => {
  const db = await openDatabase(dbPath, sqlite3.OPEN_READONLY)
  try {
    db.configure('busyTimeout', 5000)
    await runSql(db, 'VACUUM INTO ?', [target])
  } finally {
    await closeQuietly(db)
  }
}

// Writes a new backup of the database into `directory` and returns its path. The snapshot goes to a
// temporary name first, is validated, and only then gets its final name.
export const createBackupFile = async (
  dbPath: string,
  directory: string,
  kind: BackupKind,
  now: Date = new Date()
): Promise<string> => {
  await fs.mkdir(directory, { recursive: true })
  const base = `${kind === 'safety' ? SAFETY_PREFIX : AUTO_PREFIX}-${backupTimestamp(now)}`
  let fileName: string | null = null
  for (let n = 1; n < 1000 && fileName === null; n++) {
    const candidate = n === 1 ? `${base}.db` : `${base}-${n}.db`
    if (!(await exists(join(directory, candidate)))) fileName = candidate
  }
  if (fileName === null) throw new Error('Não foi possível escolher um nome para o arquivo de backup.')
  const finalPath = join(directory, fileName)
  // Short temporary name: SQLite on Windows cannot open paths longer than 260 characters
  const tempPath = join(directory, `.ps-${randomBytes(4).toString('hex')}.tmp`)
  try {
    try {
      await vacuumInto(dbPath, tempPath)
    } catch (error) {
      if (process.platform === 'win32' && tempPath.length > WINDOWS_SQLITE_PATH_LIMIT && /SQLITE_CANTOPEN/.test(String(error))) {
        throw new Error(LONG_PATH_MESSAGE)
      }
      throw error
    }
    const check = await validateDatabaseFile(tempPath)
    if (!check.ok) throw new Error(`o backup gerado não passou na verificação: ${check.error}`)
    if (await exists(finalPath)) throw new Error('já existe um arquivo com o mesmo nome')
    await fs.rename(tempPath, finalPath)
    return finalPath
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => undefined)
    throw error
  }
}

const nameInfo = (fileName: string): { kind: BackupKind; stamp: string; index: number } | null => {
  const auto = BACKUP_FILE_PATTERN.exec(fileName)
  const safety = auto ? null : SAFETY_BACKUP_FILE_PATTERN.exec(fileName)
  const match = auto ?? safety
  if (!match) return null
  return { kind: auto ? 'auto' : 'safety', stamp: `${match[1]}-${match[2]}`, index: Number(match[3] ?? 1) }
}

const stampToDate = (stamp: string): Date | null => {
  const match = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/.exec(stamp)
  if (!match) return null
  const [, y, mo, d, h, mi, s] = match.map(Number) as [number, number, number, number, number, number, number]
  const date = new Date(y, mo - 1, d, h, mi, s)
  return Number.isNaN(date.getTime()) ? null : date
}

const sortKey = (info: { stamp: string; index: number }) => `${info.stamp}-${pad(info.index, 3)}`

// Backups (automatic and safety) found in the folder, newest first. Other files are ignored.
export const listBackupFiles = async (directory: string | null): Promise<BackupFile[]> => {
  if (!directory) return []
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const files: (BackupFile & { key: string })[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const info = nameInfo(entry.name)
    if (!info) continue
    const filePath = join(directory, entry.name)
    try {
      const stats = await fs.stat(filePath)
      const created = stampToDate(info.stamp) ?? stats.mtime
      files.push({ fileName: entry.name, filePath, sizeBytes: stats.size, createdAt: created.toISOString(), key: sortKey(info) })
    } catch {
      // Removed in the meantime
    }
  }
  files.sort((a, b) => (a.key === b.key ? b.fileName.localeCompare(a.fileName) : b.key.localeCompare(a.key)))
  return files.map((file) => ({ fileName: file.fileName, filePath: file.filePath, sizeBytes: file.sizeBytes, createdAt: file.createdAt }))
}

// Removes the oldest automatic backups beyond `keep`. Only regular files named prompt-studio-AAAAMMDD-HHMMSS.db
// are considered: safety backups and any other file are never touched. Returns the removed names.
export const pruneBackups = async (directory: string, keep: number): Promise<string[]> => {
  const limit = isValidKeep(keep) ? keep : DEFAULT_BACKUP_KEEP
  let entries
  try {
    entries = await fs.readdir(directory, { withFileTypes: true })
  } catch {
    return []
  }
  const autos: { name: string; key: string }[] = []
  for (const entry of entries) {
    const info = entry.isFile() ? nameInfo(entry.name) : null
    if (info?.kind === 'auto') autos.push({ name: entry.name, key: sortKey(info) })
  }
  autos.sort((a, b) => b.key.localeCompare(a.key))
  const removed: string[] = []
  for (const file of autos.slice(limit)) {
    try {
      await fs.rm(join(directory, file.name))
      removed.push(file.name)
    } catch (error) {
      console.error(`Could not remove old backup ${file.name}:`, error)
    }
  }
  return removed
}

// True when `filePath` is a backup made by this module inside one of the given folders
export const isKnownBackupPath = (filePath: unknown, directories: readonly (string | null)[]): filePath is string => {
  if (typeof filePath !== 'string' || !isAbsolute(filePath)) return false
  const full = resolve(filePath)
  if (!nameInfo(basename(full))) return false
  const folder = process.platform === 'win32' ? dirname(full).toLowerCase() : dirname(full)
  return directories.some((directory) => {
    if (!directory) return false
    const candidate = resolve(directory)
    return (process.platform === 'win32' ? candidate.toLowerCase() : candidate) === folder
  })
}

const sleep = (ms: number) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))

// Windows keeps a file locked for a moment after it is closed (antivirus, indexer): retry briefly
const renameWithRetry = async (from: string, to: string): Promise<void> => {
  for (let attempt = 1; ; attempt++) {
    try {
      await fs.rename(from, to)
      return
    } catch (error) {
      const code = errorCode(error)
      if (attempt >= 6 || (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES')) throw error
      await sleep(200 * attempt)
    }
  }
}

export interface RestoreOptions {
  readonly backupPath: string
  // The database in use (electron/database/init.ts getDatabasePath)
  readonly dbPath: string
  // Where the safety backup of the current database is written
  readonly safetyDirectory: string
  // Closes the app's connection (electron/database/init.ts closeDatabase)
  readonly closeDatabase: () => Promise<void>
  // Backup settings copied into the restored database, so restoring an old file keeps the current setup
  readonly settingsToKeep?: StoredBackupSettings | null
  readonly now?: Date
}

export type RestoreOutcome =
  | { readonly ok: true; readonly safetyBackupPath: string }
  | { readonly ok: false; readonly error: string; readonly databaseClosed: boolean; readonly safetyBackupPath?: string }

const DB_SIDE_FILES = ['', '-wal', '-shm', '-journal'] as const

// Everything a restore does before the app restarts:
// 1. copy the backup next to the database and validate the copy (nothing else changes if it is invalid);
// 2. safety backup of the current database (stops here if it fails);
// 3. close the database, move the current files aside (kept as <db>.antes-da-restauracao-<data>),
//    put the copy in place. If a step fails, the moved files are put back.
export const restoreDatabaseFile = async (options: RestoreOptions): Promise<RestoreOutcome> => {
  const now = options.now ?? new Date()
  const backupPath = resolve(options.backupPath)
  const dbPath = resolve(options.dbPath)
  const samePath = process.platform === 'win32' ? backupPath.toLowerCase() === dbPath.toLowerCase() : backupPath === dbPath
  if (samePath) return { ok: false, databaseClosed: false, error: 'Este arquivo é o banco de dados em uso. Escolha um backup.' }

  const tempPath = `${dbPath}.restaurando`
  const removeTemp = async () => {
    for (const suffix of DB_SIDE_FILES) await fs.rm(tempPath + suffix, { force: true }).catch(() => undefined)
  }

  // 1. Copy + validation
  await removeTemp()
  try {
    await fs.copyFile(backupPath, tempPath)
  } catch (error) {
    await removeTemp()
    return { ok: false, databaseClosed: false, error: `Não foi possível ler o backup (${describeBackupError(error)}).` }
  }
  const check = await validateDatabaseFile(tempPath, { writable: true })
  if (!check.ok) {
    await removeTemp()
    return { ok: false, databaseClosed: false, error: check.error }
  }
  if (options.settingsToKeep) {
    try {
      const copy = await openDatabase(tempPath, sqlite3.OPEN_READWRITE)
      try {
        await runSql(copy, 'INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [
          BACKUP_SETTINGS_KEY,
          JSON.stringify(options.settingsToKeep),
        ])
      } finally {
        await closeQuietly(copy)
      }
    } catch (error) {
      // Not a reason to cancel the restore: the backup settings can be set again
      console.error('Could not keep the backup settings in the restored database:', error)
    }
  }

  // 2. Safety backup of the current state
  let safetyBackupPath: string
  try {
    safetyBackupPath = await createBackupFile(dbPath, options.safetyDirectory, 'safety', now)
  } catch (error) {
    await removeTemp()
    return {
      ok: false,
      databaseClosed: false,
      error: `Não foi possível fazer o backup de segurança do banco atual (${describeBackupError(error)}). Nada foi alterado.`,
    }
  }

  // 3. Swap the files
  await options.closeDatabase()
  const aside = `${dbPath}.antes-da-restauracao-${backupTimestamp(now)}-${randomBytes(3).toString('hex')}`
  const moved: [string, string][] = []
  try {
    for (const suffix of DB_SIDE_FILES) {
      if (await exists(dbPath + suffix)) {
        await renameWithRetry(dbPath + suffix, aside + suffix)
        moved.push([dbPath + suffix, aside + suffix])
      }
    }
    await renameWithRetry(tempPath, dbPath)
  } catch (error) {
    for (const [original, movedTo] of [...moved].reverse()) {
      try {
        await renameWithRetry(movedTo, original)
      } catch (restoreError) {
        console.error(`Could not put ${movedTo} back:`, restoreError)
      }
    }
    // Never restart without a database (the app would start empty): fall back to the safety backup
    if (!(await exists(dbPath).catch(() => true))) {
      await fs.copyFile(safetyBackupPath, dbPath).catch((copyError) => {
        console.error('Could not put the safety backup in place:', copyError)
      })
    }
    await removeTemp()
    return {
      ok: false,
      databaseClosed: true,
      safetyBackupPath,
      error: `Não foi possível substituir o banco de dados (${describeBackupError(error)}). Os dados atuais foram mantidos.`,
    }
  }
  return { ok: true, safetyBackupPath }
}
