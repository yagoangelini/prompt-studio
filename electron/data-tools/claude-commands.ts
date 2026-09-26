// Exports prompts as Claude Code custom commands: <project>/.claude/commands/<category>/<title>.md
// A file in commands/plano/01-crie-um-plano.md becomes the command /plano:01-crie-um-plano.
import { promises as fs } from 'fs'
import { basename, dirname, resolve, sep } from 'path'
import type { Category, Prompt } from '../../src/types'

// Marker written inside the frontmatter (as a YAML comment, ignored by Claude Code). Only files that carry
// it are overwritten by a new export; any other existing file is left untouched and reported.
export const CLAUDE_COMMANDS_MARKER = 'prompt-studio-export'
const MARKER_LINE = `# ${CLAUDE_COMMANDS_MARKER}: gerado pelo Prompt Studio. Uma nova exportação substitui este arquivo.`
const MARKER_PATTERN = new RegExp(`^#\\s*${CLAUDE_COMMANDS_MARKER}\\b`, 'm')
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff)

export const COMMANDS_DIR = '.claude/commands'
const MAX_SLUG_LENGTH = 60
const MAX_DESCRIPTION_LENGTH = 250
const MAX_CATEGORY_DEPTH = 10
// An existing file bigger than this is certainly not one of ours
const MAX_EXISTING_FILE_BYTES = 2 * 1024 * 1024

// Same variable syntax as the rest of the app: {{name}}, letters of any script, digits and "_"
const VARIABLE_PATTERN = /\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu

// Built-in Claude Code commands: a root-level custom command with one of these names would be hidden
const BUILT_IN_COMMANDS = new Set([
  'add-dir', 'agents', 'bashes', 'branch', 'bug', 'clear', 'compact', 'config', 'context', 'copy', 'cost',
  'diff', 'doctor', 'effort', 'exit', 'export', 'fast', 'feedback', 'help', 'hooks', 'ide', 'init',
  'install-github-app', 'login', 'logout', 'mcp', 'memory', 'model', 'output-style', 'permissions', 'plan',
  'plugin', 'plugins', 'pr-comments', 'privacy-settings', 'release-notes', 'rename', 'resume', 'review',
  'rewind', 'sandbox', 'security-review', 'skills', 'stats', 'status', 'statusline', 'tasks',
  'terminal-setup', 'theme', 'todos', 'upgrade', 'usage', 'vim',
])
// Names Windows refuses as file names
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/

// "01. Crie um plano" -> "01-crie-um-plano"; accents removed, lowercase, only a-z, 0-9 and "-"
export const slugify = (text: string, maxLength: number = MAX_SLUG_LENGTH): string => {
  const slug = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '')
  return WINDOWS_RESERVED.test(slug) ? `${slug}-prompt` : slug
}

export interface ConvertedContent {
  readonly body: string
  // Variable names in order of first appearance
  readonly variables: readonly string[]
}

// {{x}} -> $ARGUMENTS when the prompt has a single variable (the whole text typed after the command);
// with several, each one becomes $ARGUMENTS[N], 0-based in order of first appearance (Claude Code's
// indexed arguments are 0-based: $ARGUMENTS[0] is the first one).
export const convertVariables = (content: string): ConvertedContent => {
  const variables: string[] = []
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]
    if (name !== undefined && !variables.includes(name)) variables.push(name)
  }
  if (variables.length === 0) return { body: content, variables }
  const body = content.replace(VARIABLE_PATTERN, (_match: string, name: string) =>
    variables.length === 1 ? '$ARGUMENTS' : `$ARGUMENTS[${variables.indexOf(name)}]`
  )
  return { body, variables }
}

// YAML double-quoted scalar (JSON strings are valid YAML); line breaks become spaces
const yamlString = (value: string): string => JSON.stringify(value.replace(/\s+/g, ' ').trim())

export const buildCommandFile = (prompt: Pick<Prompt, 'title' | 'content' | 'description'>): string => {
  const { body, variables } = convertVariables(prompt.content)
  const description = ((prompt.description ?? '').trim() || prompt.title.trim()).replace(/\s+/g, ' ')
  const lines = ['---', `description: ${yamlString(description.slice(0, MAX_DESCRIPTION_LENGTH))}`]
  if (variables.length > 0) {
    lines.push(`argument-hint: ${yamlString(variables.map((name) => `[${name}]`).join(' '))}`)
  }
  lines.push(MARKER_LINE, '---', '')
  return `${lines.join('\n')}\n${body.endsWith('\n') ? body : `${body}\n`}`
}

// True when the text starts with a frontmatter block that carries our marker
export const isAppGeneratedCommand = (text: string): boolean => {
  // Editors may save the file with a byte order mark
  const normalized = text.startsWith(BYTE_ORDER_MARK) ? text.slice(1) : text
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(normalized)
  return match !== null && MARKER_PATTERN.test(match[1] ?? '')
}

export interface PlannedCommandFile {
  readonly promptId: number
  // Relative to the project folder, with "/" (e.g. ".claude/commands/plano/01-crie-um-plano.md")
  readonly relativePath: string
  // Claude Code command, e.g. "/plano:01-crie-um-plano"
  readonly command: string
  readonly content: string
}

type CategoryInfo = Pick<Category, 'id' | 'name' | 'parent_id'>
type PromptInfo = Pick<Prompt, 'id' | 'title' | 'content' | 'description' | 'category_id'>

// Folder of a category, following its parents (subcategories become nested folders)
const categoryFolders = (categoryId: number | null, categories: ReadonlyMap<number, CategoryInfo>): string[] => {
  const folders: string[] = []
  const seen = new Set<number>()
  let current = categoryId !== null ? categories.get(categoryId) : undefined
  while (current && !seen.has(current.id) && folders.length < MAX_CATEGORY_DEPTH) {
    seen.add(current.id)
    folders.unshift(slugify(current.name) || `categoria-${current.id}`)
    current = current.parent_id !== null && current.parent_id !== undefined ? categories.get(current.parent_id) : undefined
  }
  return folders
}

// Decides the file of each prompt. Same slug in the same folder -> "-2", "-3"...
export const planCommandFiles = (
  prompts: readonly PromptInfo[],
  categories: readonly CategoryInfo[]
): PlannedCommandFile[] => {
  const byId = new Map(categories.map((category) => [category.id, category]))
  const used = new Set<string>()
  const planned: PlannedCommandFile[] = []
  const ordered = [...prompts].sort((a, b) => a.id - b.id)
  for (const prompt of ordered) {
    const folders = categoryFolders(prompt.category_id, byId)
    let name = slugify(prompt.title) || `prompt-${prompt.id}`
    if (folders.length === 0 && BUILT_IN_COMMANDS.has(name)) name = `${name}-prompt`
    let candidate = name
    for (let n = 2; used.has([...folders, candidate].join('/')); n++) candidate = `${name}-${n}`
    const key = [...folders, candidate].join('/')
    used.add(key)
    planned.push({
      promptId: prompt.id,
      relativePath: `${COMMANDS_DIR}/${key}.md`,
      command: `/${[...folders, candidate].join(':')}`,
      content: buildCommandFile(prompt),
    })
  }
  return planned
}

// The user may pick the .claude or .claude/commands folder instead of the project itself
export const resolveProjectDir = (chosen: string): string => {
  const full = resolve(chosen)
  const name = basename(full).toLowerCase()
  if (name === '.claude') return dirname(full)
  if (name === 'commands' && basename(dirname(full)).toLowerCase() === '.claude') return dirname(dirname(full))
  return full
}

export interface WriteCommandsResult {
  readonly written: readonly string[]
  // Existing files not created by the app (never overwritten)
  readonly skipped: readonly string[]
  readonly failed: readonly { readonly path: string; readonly error: string }[]
}

const errorCode = (error: unknown): string | undefined => (error as NodeJS.ErrnoException | undefined)?.code

// pt-BR explanation for a file system error
export const describeWriteError = (error: unknown): string => {
  switch (errorCode(error)) {
    case 'EACCES':
    case 'EPERM': return 'sem permissão para gravar'
    case 'EROFS': return 'a pasta é somente leitura'
    case 'ENOSPC': return 'não há espaço livre no disco'
    case 'EBUSY': return 'o arquivo está em uso por outro programa'
    case 'ENAMETOOLONG': return 'o caminho é longo demais'
    case 'ENOTDIR': return 'um item do caminho não é uma pasta'
    default: return error instanceof Error ? error.message : 'erro desconhecido'
  }
}

type ExistingFile = 'none' | 'ours' | 'foreign'

const inspectExisting = async (filePath: string): Promise<ExistingFile> => {
  let stats
  try {
    stats = await fs.lstat(filePath)
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return 'none'
    throw error
  }
  if (!stats.isFile() || stats.size > MAX_EXISTING_FILE_BYTES) return 'foreign'
  const text = await fs.readFile(filePath, 'utf8')
  return isAppGeneratedCommand(text) ? 'ours' : 'foreign'
}

export const writeCommandFiles = async (
  projectDir: string,
  planned: readonly PlannedCommandFile[]
): Promise<WriteCommandsResult> => {
  const root = resolve(projectDir)
  const rootPrefix = root.endsWith(sep) ? root : root + sep
  const written: string[] = []
  const skipped: string[] = []
  const failed: { path: string; error: string }[] = []
  for (const file of planned) {
    const target = resolve(root, ...file.relativePath.split('/'))
    // Planned paths are slugs, but never write outside the project folder
    if (!target.startsWith(rootPrefix)) {
      failed.push({ path: file.relativePath, error: 'caminho inválido' })
      continue
    }
    try {
      await fs.mkdir(dirname(target), { recursive: true })
      let state = await inspectExisting(target)
      if (state === 'none') {
        try {
          // 'wx' fails if the file appeared in the meantime; it is then inspected like any existing file
          await fs.writeFile(target, file.content, { encoding: 'utf8', flag: 'wx' })
          written.push(file.relativePath)
          continue
        } catch (error) {
          if (errorCode(error) !== 'EEXIST') throw error
          state = await inspectExisting(target)
        }
      }
      if (state === 'ours') {
        await fs.writeFile(target, file.content, 'utf8')
        written.push(file.relativePath)
      } else {
        skipped.push(file.relativePath)
      }
    } catch (error) {
      failed.push({ path: file.relativePath, error: describeWriteError(error) })
    }
  }
  return { written, skipped, failed }
}
