import { contextBridge, ipcRenderer } from 'electron'
import type { ElectronAPI } from '../src/types'

// Electron wraps errors thrown by main-process handlers as
// "Error invoking remote method '<channel>': Error: <message>". Keep only <message>,
// which is what the UI shows in its error toasts.
const invoke = async (channel: string, ...args: any[]) => {
  try {
    return await ipcRenderer.invoke(channel, ...args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(message.replace(/^Error invoking remote method '[^']*': (?:[A-Za-z]*Error: )?/, ''))
  }
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
const electronAPI: ElectronAPI = {
  // Prompts
  getAllPrompts: () => invoke('get-all-prompts'),
  getPrompt: (id: number) => invoke('get-prompt', id),
  createPrompt: (data) => invoke('create-prompt', data),
  updatePrompt: (id, data) => invoke('update-prompt', id, data),
  deletePrompt: (id) => invoke('delete-prompt', id),
  searchPrompts: (query) => invoke('search-prompts', query),
  getPromptsByTag: (tag) => invoke('get-prompts-by-tag', tag),

  // Categories
  getAllCategories: () => invoke('get-all-categories'),
  createCategory: (data) => invoke('create-category', data),
  updateCategory: (id, data) => invoke('update-category', id, data),
  deleteCategory: (id) => invoke('delete-category', id),

  // Templates
  getAllTemplates: () => invoke('get-all-templates'),
  createTemplate: (data) => invoke('create-template', data),
  updateTemplate: (id, data) => invoke('update-template', id, data),
  deleteTemplate: (id) => invoke('delete-template', id),
  generateFromTemplate: (templateId, variables) =>
    invoke('generate-from-template', templateId, variables),

  // Tags
  getAllTags: () => invoke('get-all-tags'),
  renameTag: (oldName, newName) => invoke('rename-tag', oldName, newName),
  deleteTag: (name) => invoke('delete-tag', name),

  // Versions
  getPromptVersions: (promptId) => invoke('get-prompt-versions', promptId),
  createPromptVersion: (promptId, content) =>
    invoke('create-prompt-version', promptId, content),

  // Settings
  getSetting: (key) => invoke('get-setting', key),
  setSetting: (key, value) => invoke('set-setting', key, value),

  // Import/Export
  exportPrompts: (format) => invoke('export-prompts', format),
  importPrompts: () => invoke('import-prompts'),

  // Testing
  testPrompt: (request) => invoke('test-prompt', request),
  cancelTestPrompt: () => invoke('test-prompt:cancel'),

  // System
  copyToClipboard: (text) => invoke('copy-to-clipboard', text),
  switchMode: (mode) => invoke('switch-mode', mode),
  getCurrentMode: () => invoke('get-current-mode'),
  factoryReset: () => invoke('factory-reset'),

  // MCP Server
  startMcpServer: (config, exposedPrompts) => invoke('mcp-server:start', config, exposedPrompts),
  stopMcpServer: () => invoke('mcp-server:stop'),
  getMcpServerStatus: () => invoke('mcp-server:status'),
  updateMcpServerConfig: (config) => invoke('mcp-server:update-config', config),
  updateMcpServerExposedPrompts: (exposedPrompts) => invoke('mcp-server:update-exposed-prompts', exposedPrompts),
  clearMcpServerLogs: () => invoke('mcp-server:clear-logs'),

  // Organization (handlers in electron/features/organization.ts)
  setPromptPinned: (id, pinned) => invoke('prompts:set-pinned', id, pinned),
  recordPromptUsage: (id) => invoke('prompts:record-usage', id),
  reorderPrompts: (categoryId, orderedIds) => invoke('prompts:reorder', categoryId, orderedIds),
  bulkUpdatePrompts: (ids, changes) => invoke('prompts:bulk-update', ids, changes),
  bulkDeletePrompts: (ids) => invoke('prompts:bulk-delete', ids),

  // Quick paste (handlers in electron/features/quick-paste.ts)
  getQuickPasteSettings: () => invoke('quick-paste:get-settings'),
  setQuickPasteSettings: (settings) => invoke('quick-paste:set-settings', settings),
  pasteText: (text, promptId) => invoke('quick-paste:paste', text, promptId),
  hideQuickPaste: () => invoke('quick-paste:hide'),

  // Claude Code commands, backup and test history (handlers in electron/features/data-tools.ts)
  exportClaudeCommands: (promptIds) => invoke('claude-commands:export', promptIds),
  getBackupSettings: () => invoke('backup:get-settings'),
  setBackupSettings: (settings) => invoke('backup:set-settings', settings),
  chooseBackupDirectory: () => invoke('backup:choose-directory'),
  runBackupNow: () => invoke('backup:run'),
  listBackups: () => invoke('backup:list'),
  restoreBackup: (filePath) => invoke('backup:restore', filePath),
  listTestRuns: (options) => invoke('test-runs:list', options),
  deleteTestRun: (id) => invoke('test-runs:delete', id),
  clearTestRuns: () => invoke('test-runs:clear'),

  // Generic IPC invoke method for flexibility
  invoke: (channel: string, ...args: any[]) => invoke(channel, ...args),

  // Events
  onOpenPreferences: (callback) => ipcRenderer.on('open-preferences', callback),
  onMcpServerStatusChanged: (callback) => {
    const listener = (_event: unknown, status: Parameters<typeof callback>[0]) => callback(status)
    ipcRenderer.on('mcp-server:status-changed', listener)
    return () => { ipcRenderer.removeListener('mcp-server:status-changed', listener) }
  },
  onWindowShown: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:window-shown', listener)
    return () => { ipcRenderer.removeListener('app:window-shown', listener) }
  },
  onDataChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on('app:data-changed', listener)
    return () => { ipcRenderer.removeListener('app:data-changed', listener) }
  },
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
}

contextBridge.exposeInMainWorld('electronAPI', electronAPI)