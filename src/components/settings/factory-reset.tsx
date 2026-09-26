import { useState } from 'react'
import { RefreshCw, AlertTriangle, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePromptStore } from '@/stores/usePromptStore'
import { useTheme } from '@/contexts/theme-context'

const CONFIRMATION_TEXT = 'REDEFINIR MEUS DADOS'

export function FactoryReset() {
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [confirmText, setConfirmText] = useState('')
  const [isResetting, setIsResetting] = useState(false)
  const { addToast, fetchAllData, resetLocalState } = usePromptStore()
  const { setTheme } = useTheme()

  const handleFactoryReset = () => {
    setConfirmText('')
    setShowConfirmDialog(true)
  }

  // The typed confirmation never survives closing the dialog
  const handleDialogOpenChange = (open: boolean) => {
    if (isResetting) return
    setShowConfirmDialog(open)
    if (!open) {
      setConfirmText('')
    }
  }

  // A running MCP server would keep serving the old exposure list and API key
  const stopMcpServer = async () => {
    try {
      const status = await window.electronAPI.getMcpServerStatus()
      if (status.running) {
        await window.electronAPI.stopMcpServer()
      }
    } catch (error) {
      console.error('Failed to stop the MCP server after the factory reset:', error)
    }
  }

  const confirmFactoryReset = async () => {
    if (confirmText !== CONFIRMATION_TEXT) {
      addToast({
        type: 'error',
        title: 'Confirmação inválida',
        description: `Digite "${CONFIRMATION_TEXT}" exatamente como mostrado para confirmar.`
      })
      return
    }

    setIsResetting(true)
    try {
      const result = await window.electronAPI.factoryReset()

      if (result.success) {
        await stopMcpServer()
        // Local preferences (view modes, sorting, MCP settings, recent prompts, drafts), search and selection
        resetLocalState()
        setTheme('system')

        // Refresh the store data to show the new sample data
        await fetchAllData()

        addToast({
          type: 'success',
          title: 'Configurações de fábrica restauradas',
          description: 'Todos os dados e preferências foram redefinidos e os dados de exemplo foram carregados.'
        })
      } else {
        throw new Error(result.error || 'Não foi possível restaurar as configurações de fábrica')
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Falha ao restaurar configurações de fábrica',
        description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado'
      })
    } finally {
      setIsResetting(false)
      setShowConfirmDialog(false)
      setConfirmText('')
    }
  }

  return (
    <>
      <Card>
        <CardContent className="space-y-4 pt-6">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4">
            <div className="flex items-start space-x-3">
              <AlertTriangle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div>
                <h4 className="font-medium text-destructive mb-2">Aviso: esta ação não pode ser desfeita</h4>
                <p className="text-sm text-muted-foreground">
                  Restaurar as configurações de fábrica excluirá permanentemente:
                </p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc list-inside">
                  <li>Seus prompts e as versões deles</li>
                  <li>As categorias e os templates</li>
                  <li>Os resultados de testes</li>
                  <li>As preferências deste computador: tema, modos de visualização, ordenação, configurações dos testes, busca, prompts recentes e rascunhos</li>
                  <li>A configuração do servidor MCP e a lista de prompts expostos (o servidor é parado)</li>
                </ul>
                <p className="text-sm text-muted-foreground mt-3">
                  Depois disso, o aplicativo será restaurado com prompts, templates e categorias de exemplo para ajudar você a recomeçar, e o tema volta para "Sistema".
                </p>
              </div>
            </div>
          </div>

          <div className="pt-2">
            <Button
              variant="destructive"
              onClick={handleFactoryReset}
              className="w-full sm:w-auto"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Restaurar configurações de fábrica
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={showConfirmDialog} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0" />
              <span>Confirmar restauração das configurações de fábrica</span>
            </DialogTitle>
            <DialogDescription>
              Isso excluirá permanentemente todos os seus dados e preferências e não poderá ser desfeito.
              Os dados de exemplo serão restaurados para ajudar você a recomeçar.
            </DialogDescription>
          </DialogHeader>

          <div className="py-4 space-y-4">
            <div className="bg-muted p-3 rounded-lg">
              <p className="text-sm font-medium mb-2">Para confirmar, digite:</p>
              <code className="text-sm bg-background px-2 py-1 rounded border">
                {CONFIRMATION_TEXT}
              </code>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm-text">Confirmação</Label>
              <Input
                id="confirm-text"
                placeholder="Digite o texto de confirmação aqui..."
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={isResetting}
                autoComplete="off"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleDialogOpenChange(false)}
              disabled={isResetting}
            >
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={confirmFactoryReset}
              disabled={confirmText !== CONFIRMATION_TEXT || isResetting}
            >
              {isResetting ? (
                <>
                  <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  Redefinindo...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-2" />
                  Redefinir todos os dados
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
