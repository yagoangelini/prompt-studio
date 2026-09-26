// Variable syntax shared by templates and prompts: {{name}}, where the name uses letters of any script
// (accents included), digits and "_", optionally padded with spaces inside the braces.
// The pattern is a constant: variable names typed by the user never become part of a RegExp.
const VARIABLE_PATTERN = /\{\{\s*([\p{L}\p{N}_]+)\s*\}\}/gu
const VARIABLE_NAME = /^[\p{L}\p{N}_]+$/u

export interface TextSelection {
  start: number
  end: number
}

// Unique variable names in order of first appearance
export function extractVariables(content: string): string[] {
  const names: string[] = []
  const seen = new Set<string>()
  for (const match of content.matchAll(VARIABLE_PATTERN)) {
    const name = match[1]
    if (name !== undefined && !seen.has(name)) {
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

export type VariableValues = ReadonlyMap<string, string> | Readonly<Record<string, string>>

const lookupValue = (values: VariableValues, name: string): string | undefined => {
  if (values instanceof Map) return values.get(name)
  // Own properties only: names such as "constructor" or "__proto__" are valid variables
  const record = values as Readonly<Record<string, string>>
  return Object.prototype.hasOwnProperty.call(record, name) ? record[name] : undefined
}

// Replaces each {{name}} (with or without inner spaces) by its value. Literal replacement: the value is
// inserted as is ("$&", "$1"... keep their meaning as plain text). Variables without a non-empty value stay.
export function substituteVariables(content: string, values: VariableValues): string {
  return content.replace(VARIABLE_PATTERN, (match: string, name: string) => {
    const value = lookupValue(values, name)
    return value === undefined || value === '' ? match : value
  })
}

export type VariableNameResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly error: string }

// Validates a variable name typed by the user; braces typed around it ("{{nome}}") are removed
export function parseVariableName(raw: string): VariableNameResult {
  const name = raw
    .normalize('NFC')
    .trim()
    .replace(/^\{+\s*/, '')
    .replace(/\s*\}+$/, '')
    .trim()
  if (!name) {
    return { ok: false, error: 'Digite o nome da variável.' }
  }
  if (!VARIABLE_NAME.test(name)) {
    return { ok: false, error: 'Use apenas letras, números e _ no nome da variável (sem espaços, hífens ou pontos).' }
  }
  return { ok: true, name }
}

// Inserts text at the selection (replacing it) or, without a known selection, at the end of the content
export function insertText(
  content: string,
  text: string,
  selection: TextSelection | null
): { content: string; caret: number } {
  if (!selection) {
    const separator = content.length > 0 && !/\s$/.test(content) ? ' ' : ''
    const next = content + separator + text
    return { content: next, caret: next.length }
  }
  const start = Math.max(0, Math.min(selection.start, content.length))
  const end = Math.max(start, Math.min(selection.end, content.length))
  return {
    content: content.slice(0, start) + text + content.slice(end),
    caret: start + text.length
  }
}

export function variableToken(name: string): string {
  return `{{${name}}}`
}
