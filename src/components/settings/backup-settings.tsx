import { useCallback, useEffect, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AlertTriangle, ArchiveRestore, DatabaseBackup, FolderOpen, RefreshCw } from 'lucide-react'
import type { BackupFile, BackupSettings } from '@/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { parseDbDate } from '@/lib/utils'

// The main process also reports the last automatic failure (electron/data-tools/backup.ts)
type LoadedBackupSettings = BackupSettings & { readonly lastError?: string | null }

const MAX_KEEP = 100
// Safety backups are made right before a restore (prompt-studio-antes-da-restauracao-*.db)
const isSafetyBackup = (file: BackupFile) => file.fileName.startsWith('prompt-studio-antes-da-restauracao-')

const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes.toLocaleString('pt-BR')} bytes`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} KB`
  return `${(bytes / (1024 * 1024)).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`
}

const formatFileDate = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString('pt-BR')
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : 'Ocorreu um erro inesperado.')

// Settings > Dados: automatic backup (folder, how many to keep, back up now, restore)
export function BackupSettingsCard() {
  const { addToast } = usePromptStore()
  const [settings, setSettings] = useState<LoadedBackupSettings | null>(null)
  const [backups, setBackups] = useState<readonly BackupFile[]>([])
  const [keepText, setKeepText] = useState('10')
  const [busy, setBusy] = useState<'saving' | 'running' | 'restoring' | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const [loaded, files] = await Promise.all([window.electronAPI.getBackupSettings(), window.electronAPI.listBackups()])
      setSettings(loaded)
      setKeepText(String(loaded.keep))
      setBackups(files)
      setLoadError(null)
    } catch (error) {
      setLoadError(errorMessage(error))
    }
  }, [])

  useEffect(() => {
    void refresh()
    // Automatic backups happen in the background: refresh when the window comes back
    const unsubscribe = window.electronAPI.onWindowShown?.(() => void refresh())
    return () => unsubscribe?.()
  }, [refresh])

  const save = async (changes: Partial<Omit<BackupSettings, 'lastBackupAt'>>): Promise<boolean> => {
    if (!settings) return false
    setBusy('saving')
    try {
      const saved = await window.electronAPI.setBackupSettings({
        enabled: changes.enabled ?? settings.enabled,
        directory: changes.directory !== undefined ? changes.directory : settings.directory,
        keep: changes.keep ?? settings.keep,
      })
      setSettings(saved)
      setKeepText(String(saved.keep))
      setBackups(await window.electronAPI.listBackups())
      // Turning it on (or a new folder) makes the first backup a couple of seconds later
      if (saved.enabled) window.setTimeout(() => void refresh(), 4000)
      return true
    } catch (error) {
      addToast({ type: 'error', title: 'Não foi possível salvar o backup automático', description: errorMessage(error) })
      setKeepText(String(settings.keep))
      return false
    } finally {
      setBusy(null)
    }
  }

  const chooseDirectory = async (): Promise<string | null> => {
    try {
      const choice = await window.electronAPI.chooseBackupDirectory()
      return choice.canceled || !choice.directory ? null : choice.directory
    } catch (error) {
      addToast({ type: 'error', title: 'Não foi possível abrir a escolha de pasta', description: errorMessage(error) })
      return null
    }
  }

  const handleToggle = async (enabled: boolean) => {
    if (!settings) return
    if (enabled && !settings.directory) {
      const directory = await chooseDirectory()
      if (!directory) return
      if (await save({ enabled: true, directory })) {
        addToast({ type: 'success', title: 'Backup automático ativado', description: `Os backups serão salvos em ${directory}.` })
      }
      return
    }
    await save({ enabled })
  }

  const handleChooseDirectory = async () => {
    const directory = await chooseDirectory()
    if (!directory) return
    if (await save({ directory })) {
      addToast({ type: 'success', title: 'Pasta dos backups alterada', description: directory })
    }
  }

  const handleKeepCommit = async () => {
    if (!settings) return
    const value = Number(keepText.trim())
    if (!Number.isInteger(value) || value < 1 || value > MAX_KEEP) {
      addToast({ type: 'error', title: 'Quantidade inválida', description: `Informe um número inteiro entre 1 e ${MAX_KEEP}.` })
      setKeepText(String(settings.keep))
      return
    }
    if (value !== settings.keep) await save({ keep: value })
  }

  const handleRunNow = async () => {
    setBusy('running')
    try {
      const result = await window.electronAPI.runBackupNow()
      if (result.success) {
        addToast({ type: 'success', title: 'Backup concluído', description: result.filePath })
      } else {
        addToast({ type: 'error', title: 'Não foi possível fazer o backup', description: result.error })
      }
    } catch (error) {
      addToast({ type: 'error', title: 'Não foi possível fazer o backup', description: errorMessage(error) })
    } finally {
      setBusy(null)
      await refresh()
    }
  }

  const handleRestore = async (file: BackupFile) => {
    const confirmed = await confirmAction({
      title: 'Restaurar este backup?',
      description:
        `Todos os dados atuais do Prompt Studio (prompts, categorias, templates, histórico de testes e configurações) ` +
        `serão substituídos pelo backup de ${formatFileDate(file.createdAt)}. Antes disso, o app faz um backup de ` +
        `segurança do estado atual, que aparece nesta lista e permite voltar atrás. Depois da restauração, o Prompt Studio é reiniciado.`,
      confirmLabel: 'Restaurar e reiniciar',
      destructive: true,
    })
    if (!confirmed) return
    setBusy('restoring')
    try {
      const result = await window.electronAPI.restoreBackup(file.filePath)
      if (result.success) {
        addToast({ type: 'success', title: 'Backup restaurado', description: 'O Prompt Studio será reiniciado agora.' })
        // The app restarts in a moment; keep the controls disabled
        return
      }
      addToast({ type: 'error', title: 'Não foi possível restaurar o backup', description: result.error, duration: 10000 })
      if ((result as { restarting?: boolean }).restarting) return
      setBusy(null)
      await refresh()
    } catch (error) {
      addToast({ type: 'error', title: 'Não foi possível restaurar o backup', description: errorMessage(error) })
      setBusy(null)
    }
  }

  const disabled = busy !== null || settings === null
  const lastBackup = settings?.lastBackupAt ? parseDbDate(settings.lastBackupAt) : null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <DatabaseBackup className="h-4 w-4" aria-hidden="true" />
          Backup automático
        </CardTitle>
        <CardDescription>
          Guarda uma cópia completa do banco de dados (prompts, categorias, templates e configurações) uma vez por dia,
          numa pasta que você escolhe. Só os backups antigos criados pelo app são apagados quando passam do limite.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loadError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>Não foi possível carregar o backup automático: {loadError}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Switch
            id="backup-enabled"
            checked={settings?.enabled ?? false}
            onCheckedChange={(checked) => void handleToggle(checked)}
            disabled={disabled}
          />
          <Label htmlFor="backup-enabled">Fazer backup automático todos os dias</Label>
        </div>

        <div className="space-y-2">
          <Label>Pasta dos backups</Label>
          <div className="flex flex-wrap items-center gap-2">
            <code className="text-xs bg-muted rounded px-2 py-1 break-all min-w-0">
              {settings?.directory ?? 'Nenhuma pasta escolhida'}
            </code>
            <Button variant="outline" size="sm" onClick={() => void handleChooseDirectory()} disabled={disabled}>
              <FolderOpen className="h-4 w-4 mr-2" />
              {settings?.directory ? 'Trocar pasta' : 'Escolher pasta'}
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor="backup-keep">Manter os</Label>
          <Input
            id="backup-keep"
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_KEEP}
            className="w-20"
            value={keepText}
            onChange={(e) => setKeepText(e.target.value)}
            onBlur={() => void handleKeepCommit()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleKeepCommit()
            }}
            disabled={disabled}
          />
          <span className="text-sm">backups mais recentes</span>
        </div>

        <p className="text-sm text-muted-foreground">
          {lastBackup && !Number.isNaN(lastBackup.getTime())
            ? <>Último backup: {formatDistanceToNow(lastBackup, { addSuffix: true, locale: ptBR })} ({lastBackup.toLocaleString('pt-BR')}).</>
            : 'Nenhum backup feito ainda.'}
        </p>

        {settings?.lastError && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>O último backup falhou: {settings.lastError}</AlertDescription>
          </Alert>
        )}

        <Button onClick={() => void handleRunNow()} disabled={disabled || !settings?.directory}>
          {busy === 'running' ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <DatabaseBackup className="h-4 w-4 mr-2" />}
          {busy === 'running' ? 'Fazendo backup...' : 'Fazer backup agora'}
        </Button>

        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium">Backups salvos</h4>
            <Button variant="ghost" size="sm" onClick={() => void refresh()} disabled={busy !== null} aria-label="Atualizar a lista de backups">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          {busy === 'restoring' && (
            <p className="text-sm text-muted-foreground" role="status">Restaurando o backup... O Prompt Studio será reiniciado.</p>
          )}
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {settings?.directory ? 'Nenhum backup nesta pasta ainda.' : 'Escolha uma pasta para ver os backups.'}
            </p>
          ) : (
            <ul className="divide-y border rounded-md">
              {backups.map((file) => (
                <li key={file.filePath} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {formatFileDate(file.createdAt)}
                      {isSafetyBackup(file) && <span className="ml-2 text-xs font-normal text-muted-foreground">Backup de segurança (antes de uma restauração)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground break-all">{file.fileName} · {formatSize(file.sizeBytes)}</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleRestore(file)}
                    disabled={busy !== null}
                    aria-label={`Restaurar o backup de ${formatFileDate(file.createdAt)}`}
                  >
                    <ArchiveRestore className="h-4 w-4 mr-2" />
                    Restaurar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
