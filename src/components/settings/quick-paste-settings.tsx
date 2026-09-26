import { Fragment, useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, ClipboardPaste, Keyboard, RotateCcw } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { usePromptStore } from '@/stores/usePromptStore'
import { cn } from '@/lib/utils'
import type { QuickPasteSettings } from '@/types'
import {
  DEFAULT_QUICK_PASTE_SHORTCUT,
  captureShortcut,
  detectShortcutPlatform,
  formatAccelerator,
  getAcceleratorLabels,
  shortcutRuleHint,
  validateAccelerator,
} from '@/components/quick-paste/accelerator'
import {
  QUICK_PASTE_CHANNELS,
  QUICK_PASTE_SETTINGS_CHANGED_EVENT,
  type QuickPasteStatus,
} from '@/components/quick-paste/quick-paste-types'

const platform = detectShortcutPlatform()
const PASTE_KEYS = platform === 'mac' ? 'Cmd+V' : 'Ctrl+V'
const COPY_ONLY_KEYS = platform === 'mac' ? '⌘+Enter' : 'Ctrl+Enter'
const MODIFIER_HINT = shortcutRuleHint(platform)

function ShortcutBadges({ accelerator }: { accelerator: string }) {
  const labels = getAcceleratorLabels(accelerator, platform)
  return (
    <span className="flex items-center gap-1" aria-label={formatAccelerator(accelerator, platform)}>
      {labels.map((label, index) => (
        <Fragment key={index}>
          <Badge variant="outline" className="bg-background px-2 py-1 font-mono text-xs" aria-hidden="true">
            {label}
          </Badge>
          {platform !== 'mac' && index < labels.length - 1 && (
            <span className="text-muted-foreground" aria-hidden="true">+</span>
          )}
        </Fragment>
      ))}
    </span>
  )
}

const suspendShortcut = async (suspended: boolean) => {
  try {
    await window.electronAPI.invoke(QUICK_PASTE_CHANNELS.suspendShortcut, suspended)
  } catch (error) {
    console.error('Failed to suspend the quick paste shortcut:', error)
  }
}

// Settings > Geral: quick paste shortcut and behavior
export function QuickPasteSettingsCard() {
  const addToast = usePromptStore((state) => state.addToast)
  const [settings, setSettings] = useState<QuickPasteSettings | null>(null)
  const [status, setStatus] = useState<QuickPasteStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [recording, setRecording] = useState(false)
  const [heldKeys, setHeldKeys] = useState<readonly string[]>([])
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<HTMLButtonElement>(null)
  const recordingRef = useRef(false)

  const refreshStatus = useCallback(async () => {
    try {
      setStatus(await window.electronAPI.invoke(QUICK_PASTE_CHANNELS.getStatus) as QuickPasteStatus)
    } catch (statusError) {
      console.error('Failed to read the quick paste status:', statusError)
    }
  }, [])

  useEffect(() => {
    let active = true
    window.electronAPI.getQuickPasteSettings()
      .then((loaded) => {
        if (active) setSettings(loaded)
      })
      .catch((loadError) => {
        console.error('Failed to load the quick paste settings:', loadError)
        if (active) setError('Não foi possível carregar as configurações do colar rápido.')
      })
    void refreshStatus()
    return () => {
      active = false
    }
  }, [refreshStatus])

  // Leaving the screen while recording gives the shortcut back
  useEffect(() => () => {
    if (recordingRef.current) void suspendShortcut(false)
  }, [])

  const save = async (next: QuickPasteSettings, successMessage: string) => {
    setSaving(true)
    setError(null)
    try {
      const result = await window.electronAPI.setQuickPasteSettings(next)
      setSettings(result.settings)
      if (result.success) {
        // Saved; a shortcut that is still taken comes back in `error` and shows up through the status
        addToast({ type: 'success', title: 'Colar rápido', description: successMessage, duration: 2500 })
      } else {
        setError(result.error ?? 'Não foi possível salvar as configurações do colar rápido.')
      }
    } catch (saveError) {
      console.error('Failed to save the quick paste settings:', saveError)
      setError('Não foi possível salvar as configurações do colar rápido.')
    } finally {
      setSaving(false)
      void refreshStatus()
      window.dispatchEvent(new Event(QUICK_PASTE_SETTINGS_CHANGED_EVENT))
    }
  }

  const startRecording = () => {
    setError(null)
    setHeldKeys([])
    recordingRef.current = true
    setRecording(true)
    // While recording, the current shortcut must reach this screen instead of opening the quick paste
    void suspendShortcut(true)
    requestAnimationFrame(() => recorderRef.current?.focus())
  }

  const stopRecording = (resume: boolean) => {
    if (!recordingRef.current) return
    recordingRef.current = false
    setRecording(false)
    setHeldKeys([])
    if (resume) void suspendShortcut(false)
  }

  const handleRecorderKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording || !settings) return
    const plainKey = !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey
    // Tab leaves the field (and cancels), like in any other field
    if (event.key === 'Tab' && plainKey) return
    event.preventDefault()
    // The app shortcuts (Ctrl+S, Ctrl+F, ...) must not run while a combination is being recorded
    event.stopPropagation()
    if (event.repeat) return
    if (event.key === 'Escape' && plainKey) {
      stopRecording(true)
      return
    }
    const captured = captureShortcut(event, platform)
    if (captured.kind === 'modifiers') {
      setHeldKeys(captured.labels)
      return
    }
    if (captured.kind === 'unsupported') {
      setError('Tecla não suportada. Use uma letra, um número, uma tecla de função (F1 a F24), Espaço ou outra tecla comum.')
      return
    }
    const validation = validateAccelerator(captured.accelerator, platform)
    if (!validation.ok) {
      setError(validation.error)
      return
    }
    // Saving also gives the shortcut back (it ends the suspension)
    stopRecording(false)
    void save(
      { ...settings, shortcut: validation.accelerator },
      `Novo atalho: ${formatAccelerator(validation.accelerator, platform)}.`
    )
  }

  const handleRecorderKeyUp = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!recording) return
    const captured = captureShortcut(event, platform)
    if (captured.kind === 'modifiers') setHeldKeys(captured.labels)
  }

  if (!settings) {
    return (
      <div className="px-6 pt-6 -mb-6">
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            {error ?? 'Carregando as configurações do colar rápido...'}
          </CardContent>
        </Card>
      </div>
    )
  }

  const shortcutText = formatAccelerator(settings.shortcut, platform)
  const shortcutError = error ?? (settings.enabled ? status?.shortcutError ?? null : null)
  const isDefault = settings.shortcut === DEFAULT_QUICK_PASTE_SHORTCUT

  return (
    // Same inset as the "Atalhos de teclado" card below it
    <div className="px-6 pt-6 -mb-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <ClipboardPaste className="h-5 w-5" aria-hidden="true" />
            <CardTitle>Colar rápido</CardTitle>
          </div>
          <CardDescription>
            Em qualquer programa (por exemplo, o terminal com o Claude Code), pressione o atalho, digite para
            buscar, escolha o prompt com as setas e Enter ou com um clique, e ele é colado onde o cursor estava,
            como no Windows+V.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* On / off */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="quick-paste-enabled">Ativar o atalho global</Label>
              <p className="text-xs text-muted-foreground">
                {settings.enabled
                  ? status === null || status.registered
                    ? `Pressione ${shortcutText} em qualquer programa para abrir a lista de prompts.`
                    : 'O atalho está ativado, mas ainda não está funcionando (veja o aviso abaixo).'
                  : 'O atalho está desativado.'}
              </p>
            </div>
            <Switch
              id="quick-paste-enabled"
              checked={settings.enabled}
              disabled={saving || recording}
              onCheckedChange={(enabled) => {
                void save({ ...settings, enabled }, enabled ? `Atalho ${shortcutText} ativado.` : 'Atalho desativado.')
              }}
            />
          </div>

          {/* Shortcut */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="space-y-1">
                <span id="quick-paste-shortcut-label" className="text-sm font-medium leading-none">Atalho</span>
                <p className="text-xs text-muted-foreground">
                  {MODIFIER_HINT}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  ref={recorderRef}
                  type="button"
                  aria-label={recording ? 'Gravando o novo atalho' : `Atalho: ${shortcutText}. Pressione Enter para alterar`}
                  aria-describedby="quick-paste-shortcut-hint"
                  disabled={saving}
                  onClick={() => {
                    if (!recording) startRecording()
                  }}
                  onKeyDown={handleRecorderKeyDown}
                  onKeyUp={handleRecorderKeyUp}
                  onBlur={() => stopRecording(true)}
                  className={cn(
                    'flex min-h-9 min-w-[12rem] items-center justify-center rounded-md border px-3 py-1.5 text-sm transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    recording ? 'border-primary bg-primary/5' : 'bg-card hover:bg-accent/50'
                  )}
                >
                  {recording ? (
                    <span className="text-muted-foreground">
                      {heldKeys.length > 0 ? `${heldKeys.join(platform === 'mac' ? '' : ' + ')} + …` : 'Pressione a nova combinação...'}
                    </span>
                  ) : (
                    <ShortcutBadges accelerator={settings.shortcut} />
                  )}
                </button>
                {recording ? (
                  <Button variant="outline" size="sm" onMouseDown={(event) => event.preventDefault()} onClick={() => stopRecording(true)}>
                    Cancelar
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" onClick={startRecording} disabled={saving}>
                    <Keyboard className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                    Alterar
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={saving || recording || isDefault}
                  onClick={() => {
                    void save(
                      { ...settings, shortcut: DEFAULT_QUICK_PASTE_SHORTCUT },
                      `Atalho padrão restaurado: ${formatAccelerator(DEFAULT_QUICK_PASTE_SHORTCUT, platform)}.`
                    )
                  }}
                >
                  <RotateCcw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                  Restaurar padrão
                </Button>
              </div>
            </div>
            <p id="quick-paste-shortcut-hint" className="text-xs text-muted-foreground">
              {recording
                ? 'Pressione a combinação desejada. Esc cancela.'
                : 'Clique no atalho ou em "Alterar" e pressione a nova combinação.'}
              {isDefault && platform !== 'mac' && !recording &&
                ' Ctrl+Shift+Espaço também é usado no VS Code (dicas de parâmetros) e no Word (espaço sem quebra): enquanto o atalho estiver ativo, ele abre o colar rápido nesses programas.'}
            </p>
            {shortcutError && (
              <p role="alert" className="flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{shortcutError}</span>
              </p>
            )}
          </div>

          {/* Paste or copy */}
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="quick-paste-auto">Colar automaticamente no app ativo</Label>
              <p className="text-xs text-muted-foreground">
                {settings.autoPaste
                  ? `O prompt escolhido é colado onde o cursor estava (o app recebe ${PASTE_KEYS}). ${COPY_ONLY_KEYS} na lista só copia.`
                  : `Desligado: o prompt escolhido só é copiado para a área de transferência; cole com ${PASTE_KEYS}.`}
              </p>
              {settings.autoPaste && status?.autoPasteNote && (
                <p className={cn('text-xs', status.autoPasteAvailable ? 'text-muted-foreground' : 'text-amber-800 dark:text-amber-300')}>
                  {status.autoPasteNote}
                </p>
              )}
            </div>
            <Switch
              id="quick-paste-auto"
              checked={settings.autoPaste}
              disabled={saving || recording}
              onCheckedChange={(autoPaste) => {
                void save(
                  { ...settings, autoPaste },
                  autoPaste ? 'O prompt escolhido será colado no app ativo.' : 'O prompt escolhido será apenas copiado.'
                )
              }}
            />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
