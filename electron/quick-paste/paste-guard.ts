// Windows only. Decides whether Ctrl+V may be sent to the window that will receive it. System and
// credential dialogs never get a simulated paste: a prompt typed into a password field, a UAC prompt or
// the lock screen could submit or leak it. Pure code (no electron import), so it can be tested alone.

export interface TargetWindow {
  // Native handle, decimal
  readonly hwnd: string
  // Process image name without ".exe" ('' when it could not be read)
  readonly processName: string
  // Window class name ('' when it could not be read)
  readonly className: string
}

// Window classes of system and credential dialogs, whatever process hosts them
export const PROTECTED_WINDOW_CLASSES: readonly string[] = [
  // "Windows Security" / shell system dialogs (e.g. the credential prompt of network shares and RDP)
  'Shell_SystemDialog',
  // Modern credential prompt (credui), hosted inside the app that asked for the password
  'Credential Dialog Xaml Host',
]

// Processes that only show system, sign-in or credential UI
export const PROTECTED_PROCESSES: readonly string[] = [
  // User Account Control prompt
  'consent',
  // Credential prompts brokered for apps (Windows Hello, WebAuthn/passkeys, store apps)
  'CredentialUIBroker',
  // Windows Hello PIN / fingerprint setup
  'CredentialEnrollmentManager',
  // Lock screen and sign-in screen
  'LockApp',
  'LogonUI',
]

const normalize = (value: string) => value.trim().toLowerCase().replace(/\.exe$/, '')
const PROTECTED_CLASS_SET = new Set(PROTECTED_WINDOW_CLASSES.map(normalize))
const PROTECTED_PROCESS_SET = new Set(PROTECTED_PROCESSES.map(normalize))

export const BLOCKED_TARGET_ERROR =
  'O prompt não foi colado: a janela ativa é um diálogo do sistema ou de senha (como Segurança do Windows, ' +
  'Controle de Conta de Usuário ou a tela de bloqueio), e o Prompt Studio não cola nesse tipo de janela. ' +
  'O prompt foi copiado: cole com Ctrl+V, se quiser.'

export function isProtectedWindow(target: Pick<TargetWindow, 'processName' | 'className'>): boolean {
  return PROTECTED_CLASS_SET.has(normalize(target.className)) || PROTECTED_PROCESS_SET.has(normalize(target.processName))
}

// Reply of the helper's "wait" command: "ready <hwnd> <process>\t<class>" | "nofocus" | anything else
export type WaitReply =
  | { readonly kind: 'ready'; readonly target: TargetWindow }
  | { readonly kind: 'nofocus' }
  | { readonly kind: 'error' }

export function parseWaitReply(reply: string | null): WaitReply {
  if (reply === 'nofocus') return { kind: 'nofocus' }
  const match = reply ? /^ready (\d+)(?: ([^\t]*))?(?:\t(.*))?$/.exec(reply) : null
  if (!match || match[1] === '0') return { kind: 'error' }
  return {
    kind: 'ready',
    target: { hwnd: match[1] ?? '0', processName: (match[2] ?? '').trim(), className: (match[3] ?? '').trim() },
  }
}
