import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { parseWaitReply, type WaitReply } from './paste-guard'

// Windows only. A PowerShell process kept alive while the app runs: starting PowerShell costs
// ~200-300 ms (more on a cold or busy machine), so each paste would pay that price. The helper also
// reads the foreground window (to know where to paste) and checks that the focus is back there before
// sending Ctrl+V, so the keystroke never lands in an unrelated window.
//
// Protocol (one line each way): "<id> fg" -> "<id> <hwnd>"; "<id> activate <hwnd>" ->
// "<id> already|forced|failed|nowindow"; "<id> wait <target> <popup> <timeoutMs>" ->
// "<id> ready <hwnd> <process><TAB><class>" | "<id> nofocus"; "<id> keys <hwnd>" -> "<id> ok" | "<id> nofocus";
// errors: "<id> error <message>". At startup: "ready <win32>".
//
// A paste takes two steps, so the app sees the window before any key is sent (see paste-guard.ts).

export type HelperPasteOutcome = 'ok' | 'nofocus' | 'error'
export type HelperActivateOutcome = 'already' | 'forced' | 'failed'

// The script goes on the command line, so it has no double quotes (the Windows command line would
// mangle them): C# string literals are written QtextQ and get their quotes from [char]34.
//
// Windows only lets the process that received the last input event move the focus to another window
// (the "foreground lock"). Force() first injects an input that does nothing (a mouse move of 0 pixels),
// which makes the helper that process, and then calls SetForegroundWindow.
const CSHARP = [
  'using System; using System.Diagnostics; using System.Text; using System.Threading; using System.Runtime.InteropServices;',
  'public static class PromptStudioPaste {',
  '[StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }',
  '[StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }',
  '[DllImport(Quser32.dllQ)] static extern IntPtr GetForegroundWindow();',
  '[DllImport(Quser32.dllQ)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool SetForegroundWindow(IntPtr h);',
  '[DllImport(Quser32.dllQ)] [return: MarshalAs(UnmanagedType.Bool)] static extern bool IsWindow(IntPtr h);',
  '[DllImport(Quser32.dllQ)] static extern short GetAsyncKeyState(int vk);',
  '[DllImport(Quser32.dllQ)] static extern uint SendInput(uint count, INPUT[] inputs, int size);',
  '[DllImport(Quser32.dllQ)] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);',
  '[DllImport(Quser32.dllQ, CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr h, StringBuilder name, int size);',
  '[DllImport(Quser32.dllQ)] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
  'public static long Foreground() { return GetForegroundWindow().ToInt64(); }',
  'static bool Down(int vk) { return (GetAsyncKeyState(vk) & 0x8000) != 0; }',
  'static void Force(IntPtr h) {',
  '  INPUT[] input = new INPUT[1]; input[0].type = 0; input[0].mi.dwFlags = 1;',
  '  SendInput(1, input, Marshal.SizeOf(typeof(INPUT))); SetForegroundWindow(h);',
  '}',
  'public static string Activate(long hwnd) {',
  '  IntPtr h = new IntPtr(hwnd);',
  '  if (!IsWindow(h)) return QnowindowQ;',
  '  if (GetForegroundWindow() == h) return QalreadyQ;',
  '  Force(h); Stopwatch sw = Stopwatch.StartNew();',
  '  while (GetForegroundWindow() != h && sw.ElapsedMilliseconds < 150) Thread.Sleep(5);',
  '  return GetForegroundWindow() == h ? QforcedQ : QfailedQ;',
  '}',
  // Class and process of a window, so the app can refuse to paste into system and credential dialogs
  'static string Describe(IntPtr h) {',
  '  StringBuilder cls = new StringBuilder(256); GetClassNameW(h, cls, 256);',
  '  uint pid = 0; GetWindowThreadProcessId(h, out pid); string proc = string.Empty;',
  '  try { if (pid != 0) proc = Process.GetProcessById((int)pid).ProcessName; } catch { proc = string.Empty; }',
  '  return h.ToInt64().ToString() + (char)32 + proc + (char)9 + cls.ToString();',
  '}',
  // Step 1 of a paste: waits until the focus is back on the target (or, without one, away from the
  // popup) and the keys are released, then describes the window that will receive Ctrl+V. Sends nothing.
  'public static string WaitTarget(long target, long popup, int timeoutMs) {',
  '  Stopwatch sw = Stopwatch.StartNew(); IntPtr t = new IntPtr(target); IntPtr p = new IntPtr(popup);',
  '  bool hasTarget = target != 0 && IsWindow(t); bool retried = false;',
  '  while (true) {',
  '    IntPtr fg = GetForegroundWindow();',
  '    if (hasTarget ? fg == t : (fg != IntPtr.Zero && fg != p)) break;',
  // Hiding the popup normally gives the focus back to the previous window; if Windows picked another
  // window (or none), move it there ourselves
  '    if (hasTarget && !retried && sw.ElapsedMilliseconds >= 120) { retried = true; Force(t); }',
  '    if (sw.ElapsedMilliseconds >= timeoutMs) return QnofocusQ;',
  '    Thread.Sleep(10);',
  '  }',
  // Let the app finish activating, and wait until the user releases Enter and the modifiers
  // (a held Shift or Alt would turn Ctrl+V into another shortcut)
  '  Thread.Sleep(40);',
  '  Stopwatch keys = Stopwatch.StartNew();',
  '  while ((Down(0x10) || Down(0x11) || Down(0x12) || Down(0x5B) || Down(0x5C) || Down(0x0D)) && keys.ElapsedMilliseconds < 1000) Thread.Sleep(10);',
  '  IntPtr now = GetForegroundWindow();',
  '  if (now == IntPtr.Zero || (hasTarget ? now != t : now == p)) return QnofocusQ;',
  '  return QreadyQ + (char)32 + Describe(now);',
  '}',
  // Step 2, only after the app approved the window: Ctrl+V, if that window still has the focus
  'public static string SendPaste(long hwnd) {',
  '  IntPtr h = new IntPtr(hwnd);',
  '  if (hwnd == 0 || GetForegroundWindow() != h) return QnofocusQ;',
  '  keybd_event(0x11, 0x1D, 0, UIntPtr.Zero); keybd_event(0x56, 0x2F, 0, UIntPtr.Zero);',
  '  keybd_event(0x56, 0x2F, 2, UIntPtr.Zero); keybd_event(0x11, 0x1D, 2, UIntPtr.Zero);',
  '  return QokQ;',
  '}',
  '}',
].join(' ')

// Single line: statements are joined with "; ", so each compound statement (if/elseif/else,
// try/catch) must be one entry. Pasting needs the Win32 functions: without them the target window
// cannot be checked, so nothing is sent.
const DISPATCH =
  "if ($p[1] -eq 'fg') { if ($win32 -eq 1) { $r = [string][PromptStudioPaste]::Foreground() } else { $r = '0' } } " +
  "elseif ($p[1] -eq 'wait') { if ($win32 -eq 1) { $r = [PromptStudioPaste]::WaitTarget([long]$p[2], [long]$p[3], [int]$p[4]) } else { $r = 'error unsupported' } } " +
  "elseif ($p[1] -eq 'keys') { if ($win32 -eq 1) { $r = [PromptStudioPaste]::SendPaste([long]$p[2]) } else { $r = 'error unsupported' } } " +
  "elseif ($p[1] -eq 'activate') { if ($win32 -eq 1) { $r = [PromptStudioPaste]::Activate([long]$p[2]) } else { $r = 'failed' } } " +
  "elseif ($p[1] -eq 'ping') { $r = 'pong' }"

const LOOP_BODY = [
  '$line = [Console]::In.ReadLine()',
  'if ($null -eq $line) { break }',
  "$p = $line.Split(' ')",
  "$r = 'error unknown'",
  `try { ${DISPATCH} } catch { $r = 'error ' + ($_.Exception.Message -replace '\\s+', ' ') }`,
  "[Console]::Out.WriteLine($p[0] + ' ' + $r)",
  '[Console]::Out.Flush()',
].join('; ')

const HELPER_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  '$q = [string][char]34',
  "$src = '" + CSHARP.replace(/'/g, "''") + "'",
  // QtextQ -> "text" ('$1' is the regex group, not a PowerShell variable: single quotes)
  "$src = $src -creplace 'Q([a-z0-9.]+)Q', ($q + '$1' + $q)",
  '$win32 = 0',
  'try { Add-Type -TypeDefinition $src -Language CSharp; $win32 = 1 } catch { $win32 = 0 }',
  "[Console]::Out.WriteLine('ready ' + $win32)",
  '[Console]::Out.Flush()',
  `while ($true) { ${LOOP_BODY} }`,
].join('; ')

// Exposed for tests
export const WINDOWS_HELPER_SCRIPT = HELPER_SCRIPT

export const powershellPath = (): string => {
  const candidate = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return existsSync(candidate) ? candidate : 'powershell.exe'
}

const POWERSHELL_ARGS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']

interface PendingCommand {
  resolve: (reply: string | null) => void
  timer: NodeJS.Timeout
}

export class WindowsPasteHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private starting: Promise<boolean> | null = null
  private ready = false
  private win32 = false
  private stopped = false
  private restarts = 0
  private output = ''
  private nextId = 1
  private readonly pending = new Map<number, PendingCommand>()

  // True when the helper answers commands
  get isReady(): boolean {
    return this.ready
  }

  // Can read the foreground window and check it before pasting (Add-Type worked)
  get canTrackFocus(): boolean {
    return this.ready && this.win32
  }

  // Can send Ctrl+V: only after checking the target window, so it needs the Win32 functions too
  get canPaste(): boolean {
    return this.canTrackFocus
  }

  // Resolves true once the helper is ready (it compiles a small C# class: ~1 s, in the background).
  // Never rejects.
  start(): Promise<boolean> {
    if (this.ready) return Promise.resolve(true)
    if (this.starting) return this.starting
    this.stopped = false
    this.starting = new Promise<boolean>((resolve) => {
      let settled = false
      const settle = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(startTimeout)
        this.starting = null
        resolve(ok)
      }
      // Add-Type can be slow on a busy machine; after this the paste falls back to a one-shot PowerShell
      const startTimeout = setTimeout(() => {
        console.error('Quick paste helper did not start in time')
        this.killChild()
        settle(false)
      }, 15000)

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(powershellPath(), [...POWERSHELL_ARGS, HELPER_SCRIPT], { windowsHide: true })
      } catch (error) {
        console.error('Could not start the quick paste helper:', error)
        settle(false)
        return
      }
      this.child = child
      this.output = ''
      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        this.output += chunk
        let newline: number
        while ((newline = this.output.indexOf('\n')) >= 0) {
          const line = this.output.slice(0, newline).trim()
          this.output = this.output.slice(newline + 1)
          if (line.startsWith('ready ')) {
            const [, win32] = line.split(' ')
            this.win32 = win32 === '1'
            this.ready = true
            settle(true)
          } else if (line) {
            this.handleReply(line)
          }
        }
      })
      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        console.error('Quick paste helper:', chunk.trim())
      })
      child.on('error', (error) => {
        console.error('Quick paste helper failed:', error)
        this.onExit(child)
        settle(false)
      })
      child.on('exit', () => {
        this.onExit(child)
        settle(false)
      })
      // The helper must never keep the app alive
      child.unref()
    })
    return this.starting
  }

  stop(): void {
    this.stopped = true
    this.killChild()
  }

  // Handle of the window that has the focus now, as a decimal string ('0' = none). null when the
  // helper is not ready or does not answer in time.
  async foregroundWindow(timeoutMs: number): Promise<string | null> {
    if (!this.canTrackFocus) return null
    const reply = await this.send('fg', timeoutMs)
    return reply && /^\d+$/.test(reply) ? reply : null
  }

  // Gives the focus to a window when Windows refused to (see Force() above). null = no answer.
  async activate(hwnd: string, timeoutMs: number): Promise<HelperActivateOutcome | null> {
    if (!this.canTrackFocus) return null
    const reply = await this.send(`activate ${hwnd}`, timeoutMs)
    return reply === 'already' || reply === 'forced' || reply === 'failed' ? reply : null
  }

  // Paste, step 1: waits until the focus is back on `target` (or, without a target, away from `popup`)
  // and describes the window that has it. Sends no key.
  async waitForTarget(target: string | null, popup: string, focusTimeoutMs: number): Promise<WaitReply> {
    if (!this.canPaste) return { kind: 'error' }
    const reply = await this.send(`wait ${target ?? '0'} ${popup} ${Math.round(focusTimeoutMs)}`, focusTimeoutMs + 3000)
    const parsed = parseWaitReply(reply)
    if (parsed.kind === 'error' && reply !== null) console.error('Quick paste helper error:', reply)
    return parsed
  }

  // Paste, step 2: Ctrl+V to `hwnd`, only if it still has the focus. 'nofocus' = nothing was sent.
  async sendPaste(hwnd: string): Promise<HelperPasteOutcome> {
    if (!this.canPaste || !/^\d+$/.test(hwnd)) return 'error'
    const reply = await this.send(`keys ${hwnd}`, 3000)
    if (reply === 'ok') return 'ok'
    if (reply === 'nofocus') return 'nofocus'
    if (reply !== null) console.error('Quick paste helper error:', reply)
    return 'error'
  }

  private send(command: string, timeoutMs: number): Promise<string | null> {
    const child = this.child
    if (!child || !this.ready || !child.stdin.writable) return Promise.resolve(null)
    const id = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        resolve(null)
      }, timeoutMs)
      this.pending.set(id, { resolve, timer })
      try {
        child.stdin.write(`${id} ${command}\n`)
      } catch {
        clearTimeout(timer)
        this.pending.delete(id)
        resolve(null)
      }
    })
  }

  private handleReply(line: string): void {
    const space = line.indexOf(' ')
    const id = Number(space > 0 ? line.slice(0, space) : line)
    const entry = this.pending.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    this.pending.delete(id)
    entry.resolve(space > 0 ? line.slice(space + 1) : '')
  }

  private onExit(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = null
    this.ready = false
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timer)
      entry.resolve(null)
      this.pending.delete(id)
    }
    // Restart in the background after an unexpected exit (a few times at most)
    if (!this.stopped && this.restarts < 3) {
      this.restarts++
      setTimeout(() => {
        if (!this.stopped) void this.start()
      }, 1000)
    }
  }

  private killChild(): void {
    const child = this.child
    this.child = null
    this.ready = false
    if (!child) return
    try {
      child.stdin.end()
    } catch {
      // Already closed
    }
    try {
      child.kill()
    } catch {
      // Already gone
    }
  }
}
