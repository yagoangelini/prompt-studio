// Electron accelerators (e.g. "CommandOrControl+Shift+Space") for the quick paste global shortcut:
// validation, display and capture from a keydown event. Pure code, also used by the main process
// (electron/features/quick-paste.ts): no imports.

export const DEFAULT_QUICK_PASTE_SHORTCUT = 'CommandOrControl+Shift+Space'

export type ShortcutPlatform = 'mac' | 'windows' | 'linux'

type Modifier = 'CommandOrControl' | 'Control' | 'Command' | 'Alt' | 'AltGr' | 'Shift' | 'Super'

// Canonical order of the modifiers in a saved accelerator
const MODIFIER_ORDER: readonly Modifier[] = ['CommandOrControl', 'Control', 'Command', 'Alt', 'AltGr', 'Shift', 'Super']

const MODIFIER_ALIASES: Readonly<Record<string, Modifier>> = {
  commandorcontrol: 'CommandOrControl',
  cmdorctrl: 'CommandOrControl',
  control: 'Control',
  ctrl: 'Control',
  command: 'Command',
  cmd: 'Command',
  alt: 'Alt',
  option: 'Alt',
  altgr: 'AltGr',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
}

// Named keys accepted by Electron, keyed by their lowercase spelling
const NAMED_KEYS: Readonly<Record<string, string>> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  esc: 'Esc',
  escape: 'Esc',
  plus: 'Plus',
  printscreen: 'PrintScreen',
  numdec: 'numdec',
  numadd: 'numadd',
  numsub: 'numsub',
  nummult: 'nummult',
  numdiv: 'numdiv',
}

const PUNCTUATION_KEYS = new Set(['-', '=', '[', ']', '\\', ';', "'", ',', '.', '/', '`'])

// The key of an accelerator in its canonical spelling, or null when Electron does not accept it
function canonicalKey(part: string): string | null {
  if (/^[a-z0-9]$/i.test(part)) return part.toUpperCase()
  const fKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(part)
  if (fKey) return `F${fKey[1]}`
  const numpad = /^num([0-9])$/i.exec(part)
  if (numpad) return `num${numpad[1]}`
  if (PUNCTUATION_KEYS.has(part)) return part
  return NAMED_KEYS[part.toLowerCase()] ?? null
}

export type AcceleratorResult =
  | { readonly ok: true; readonly accelerator: string }
  | { readonly ok: false; readonly error: string }

// Combinations that would break copy/paste or are reserved by the system
const RESERVED: readonly { readonly modifiers: readonly Modifier[]; readonly keys: readonly string[]; readonly reason: string }[] = [
  {
    modifiers: ['CommandOrControl'],
    keys: ['C', 'V', 'X', 'Z', 'Y', 'A'],
    reason: 'Essa combinação é usada para copiar, colar, recortar, desfazer ou selecionar tudo. Escolha outra.',
  },
  {
    modifiers: ['Control'],
    keys: ['C', 'V', 'X', 'Z', 'Y', 'A'],
    reason: 'Essa combinação é usada para copiar, colar, recortar, desfazer ou selecionar tudo. Escolha outra.',
  },
  {
    modifiers: ['CommandOrControl', 'Shift'],
    keys: ['C', 'V'],
    reason: 'Essa combinação é usada para copiar e colar nos terminais. Escolha outra.',
  },
  { modifiers: ['Alt'], keys: ['Tab', 'F4', 'Esc'], reason: 'Essa combinação é reservada pelo sistema. Escolha outra.' },
  { modifiers: ['CommandOrControl'], keys: ['Esc'], reason: 'Essa combinação é reservada pelo sistema. Escolha outra.' },
  { modifiers: ['CommandOrControl', 'Shift'], keys: ['Esc'], reason: 'Essa combinação é reservada pelo sistema. Escolha outra.' },
  { modifiers: ['CommandOrControl', 'Alt'], keys: ['Delete'], reason: 'Essa combinação é reservada pelo sistema. Escolha outra.' },
]

const sameModifiers = (a: readonly Modifier[], b: readonly Modifier[]) =>
  a.length === b.length && a.every((modifier) => b.includes(modifier))

/**
 * Validates an accelerator for the global shortcut and returns it in canonical form
 * ("ctrl+shift+space" -> "Control+Shift+Space"). Errors are pt-BR messages for the settings screen.
 */
export function validateAccelerator(raw: unknown, platform: ShortcutPlatform): AcceleratorResult {
  if (typeof raw !== 'string' || !raw.trim()) {
    return { ok: false, error: 'Escolha uma combinação de teclas para o atalho.' }
  }
  const parts = raw.trim().split('+').map((part) => part.trim())
  if (parts.some((part) => !part)) {
    return { ok: false, error: 'Combinação de teclas inválida.' }
  }
  const keyPart = parts[parts.length - 1] ?? ''
  const modifiers: Modifier[] = []
  for (const part of parts.slice(0, -1)) {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (!modifier) return { ok: false, error: `"${part}" não é uma tecla modificadora válida.` }
    if (modifiers.includes(modifier)) return { ok: false, error: 'A combinação repete uma tecla modificadora.' }
    modifiers.push(modifier)
  }
  if (modifiers.includes('CommandOrControl') && (modifiers.includes('Control') || modifiers.includes('Command'))) {
    return { ok: false, error: 'A combinação repete uma tecla modificadora.' }
  }
  if (MODIFIER_ALIASES[keyPart.toLowerCase()]) {
    return { ok: false, error: 'Adicione uma tecla além dos modificadores (por exemplo, Ctrl+Shift+Espaço).' }
  }
  const key = canonicalKey(keyPart)
  if (!key) {
    return {
      ok: false,
      error: 'Tecla não suportada. Use uma letra, um número, uma tecla de função (F1 a F24), Espaço ou outra tecla comum.',
    }
  }
  for (const reserved of RESERVED) {
    if (reserved.keys.includes(key) && sameModifiers(reserved.modifiers, modifiers)) {
      return { ok: false, error: reserved.reason }
    }
  }
  const ordered = MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
  const accelerator = [...ordered, key].join('+')
  // A global shortcut takes the combination away from every other program. F13 to F24 exist only on
  // extra/macro keys and no program uses them, so they are free; anything else needs two modifiers,
  // one of them not Shift (Ctrl+S, Alt+F, Win+E, Ctrl+Space, Alt+Enter, F5... all belong to someone)
  if (SPARE_KEY.test(key)) return { ok: true, accelerator }
  const hasRealModifier = modifiers.some((modifier) => modifier !== 'Shift')
  if (!hasRealModifier) return { ok: false, error: twoModifiersMessage(platform) }
  if (modifiers.length < 2) return { ok: false, error: singleModifierMessage(accelerator, key, platform) }
  return { ok: true, accelerator }
}

// Keys free to use alone: F13 to F24
const SPARE_KEY = /^F(1[3-9]|2[0-4])$/

const realModifierNames = (platform: ShortcutPlatform) =>
  platform === 'mac' ? 'Cmd, Ctrl ou Option' : `Ctrl, Alt ou ${platform === 'windows' ? 'Win' : 'Super'}`

// pt-BR hint shown next to the shortcut recorder (settings screen)
export function shortcutRuleHint(platform: ShortcutPlatform): string {
  const example = formatAccelerator('CommandOrControl+Shift+P', platform)
  return `Use pelo menos dois modificadores, sendo um deles ${realModifierNames(platform)} (por exemplo, ${example}). As teclas F13 a F24 podem ser usadas sozinhas.`
}

function twoModifiersMessage(platform: ShortcutPlatform): string {
  const example = formatAccelerator('CommandOrControl+Shift+P', platform)
  return `Use pelo menos dois modificadores, sendo um deles ${realModifierNames(platform)} (por exemplo, ${example}): um atalho só com Shift, ou sem modificadores, atrapalharia a digitação e os atalhos dos outros programas.`
}

function singleModifierMessage(accelerator: string, key: string, platform: ShortcutPlatform): string {
  const label = formatAccelerator(accelerator, platform)
  const [modifier] = accelerator.split('+')
  // Suggest the same key with one more modifier (Ctrl+Shift+V is reserved for the terminals)
  const suggestions = modifier === 'CommandOrControl' || modifier === 'Control'
    ? [`${modifier}+Shift+${key}`, `${modifier}+Alt+${key}`]
    : [`CommandOrControl+${modifier}+${key}`, `${modifier}+Shift+${key}`]
  const suggestion = suggestions.find((candidate) => validateAccelerator(candidate, platform).ok) ?? 'CommandOrControl+Shift+P'
  const why = key === 'Space'
    ? 'é usado pelo sistema e por outros programas (trocar o idioma do teclado, abrir o menu da janela, autocompletar)'
    : 'é um atalho comum em outros programas (como salvar, abrir uma guia ou mudar de janela)'
  return `${label} ${why} e deixaria de funcionar em todos eles enquanto o colar rápido estiver ativo. Use pelo menos dois modificadores, por exemplo ${formatAccelerator(suggestion, platform)}.`
}

const MODIFIER_LABELS: Readonly<Record<ShortcutPlatform, Readonly<Record<Modifier, string>>>> = {
  mac: { CommandOrControl: '⌘', Command: '⌘', Control: '⌃', Alt: '⌥', AltGr: 'AltGr', Shift: '⇧', Super: '⌘' },
  windows: { CommandOrControl: 'Ctrl', Command: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', AltGr: 'AltGr', Shift: 'Shift', Super: 'Win' },
  linux: { CommandOrControl: 'Ctrl', Command: 'Ctrl', Control: 'Ctrl', Alt: 'Alt', AltGr: 'AltGr', Shift: 'Shift', Super: 'Super' },
}

const KEY_LABELS: Readonly<Record<string, string>> = {
  Space: 'Espaço',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  PageUp: 'Page Up',
  PageDown: 'Page Down',
  PrintScreen: 'Print Screen',
  Plus: '+',
  numdec: 'Num .',
  numadd: 'Num +',
  numsub: 'Num -',
  nummult: 'Num *',
  numdiv: 'Num /',
}

// Labels of each key of an accelerator, for badges: ["Ctrl", "Shift", "Espaço"]
export function getAcceleratorLabels(accelerator: string, platform: ShortcutPlatform): string[] {
  return accelerator.split('+').filter(Boolean).map((part) => {
    const modifier = MODIFIER_ALIASES[part.toLowerCase()]
    if (modifier) return MODIFIER_LABELS[platform][modifier]
    const key = canonicalKey(part) ?? part
    const numpad = /^num([0-9])$/.exec(key)
    if (numpad) return `Num ${numpad[1]}`
    return KEY_LABELS[key] ?? key
  })
}

// One-line text of an accelerator: "Ctrl+Shift+Espaço" (macOS: "⌘⇧Espaço")
export function formatAccelerator(accelerator: string, platform: ShortcutPlatform): string {
  return getAcceleratorLabels(accelerator, platform).join(platform === 'mac' ? '' : '+')
}

// Physical key (KeyboardEvent.code) -> accelerator key. Letters, digits and punctuation use the key
// position (US names), like Electron does, so the saved shortcut does not depend on the keyboard layout.
const CODE_KEYS: Readonly<Record<string, string>> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Escape: 'Esc',
  PrintScreen: 'PrintScreen',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
}

const MODIFIER_CODES = /^(Control|Shift|Alt|Meta|OS)(Left|Right)?$|^AltGraph$/

export interface KeyEventLike {
  readonly code: string
  readonly key: string
  readonly ctrlKey: boolean
  readonly metaKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
}

export type CapturedShortcut =
  // Only modifiers are held so far (shown as "Ctrl + Shift + …")
  | { readonly kind: 'modifiers'; readonly labels: readonly string[] }
  | { readonly kind: 'shortcut'; readonly accelerator: string }
  | { readonly kind: 'unsupported' }

function eventModifiers(event: KeyEventLike, platform: ShortcutPlatform): Modifier[] {
  const modifiers: Modifier[] = []
  if (platform === 'mac') {
    if (event.metaKey) modifiers.push('CommandOrControl')
    if (event.ctrlKey) modifiers.push('Control')
  } else {
    if (event.ctrlKey) modifiers.push('CommandOrControl')
    if (event.metaKey) modifiers.push('Super')
  }
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')
  return MODIFIER_ORDER.filter((modifier) => modifiers.includes(modifier))
}

/**
 * Turns a keydown event into an accelerator (not validated yet: see validateAccelerator).
 * Ctrl is saved as CommandOrControl, so the same setting means Cmd on macOS.
 */
export function captureShortcut(event: KeyEventLike, platform: ShortcutPlatform): CapturedShortcut {
  const modifiers = eventModifiers(event, platform)
  if (MODIFIER_CODES.test(event.code) || event.key === 'AltGraph' || !event.code) {
    return { kind: 'modifiers', labels: modifiers.map((modifier) => MODIFIER_LABELS[platform][modifier]) }
  }
  let key: string | undefined
  const letter = /^Key([A-Z])$/.exec(event.code)
  const digit = /^Digit([0-9])$/.exec(event.code)
  const numpad = /^Numpad([0-9])$/.exec(event.code)
  if (letter) key = letter[1]
  else if (digit) key = digit[1]
  else if (numpad) key = `num${numpad[1]}`
  else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(event.code)) key = event.code
  else key = CODE_KEYS[event.code]
  if (!key) return { kind: 'unsupported' }
  return { kind: 'shortcut', accelerator: [...modifiers, key].join('+') }
}

export function detectShortcutPlatform(): ShortcutPlatform {
  const platform = typeof navigator !== 'undefined' ? `${navigator.platform} ${navigator.userAgent}` : ''
  if (/mac/i.test(platform)) return 'mac'
  if (/win/i.test(platform)) return 'windows'
  return 'linux'
}
