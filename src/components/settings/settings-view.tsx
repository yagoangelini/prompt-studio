import { useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { InfoIcon } from '@/components/ui/info-icon'
import { CategoryManager } from './category-manager'
import { TagManager } from './tag-manager'
import { FactoryReset } from './factory-reset'
import { KeyboardShortcutsSettings } from './keyboard-shortcuts-settings'
import { usePromptStore, SETTINGS_TABS, type SettingsTab } from '@/stores/usePromptStore'
import { Palette, Settings as SettingsIcon, Database, Hash, X, Download, Upload, RefreshCw } from 'lucide-react'

interface SettingsViewProps {
  onClose?: () => void
}

const plural = (count: number, singular: string, pluralForm: string) =>
  `${count} ${count === 1 ? singular : pluralForm}`

function DataTransfer() {
  const { addToast, fetchAllData } = usePromptStore()
  const [busy, setBusy] = useState<'json' | 'txt' | 'import' | null>(null)

  const handleExport = async (format: 'json' | 'txt') => {
    setBusy(format)
    try {
      const result = await window.electronAPI.exportPrompts(format)
      if (result.canceled) {
        addToast({ type: 'info', title: 'Exportação cancelada', description: 'Nenhum arquivo foi salvo.' })
      } else if (result.success) {
        const count = plural(result.count ?? 0, 'prompt exportado', 'prompts exportados')
        addToast({
          type: 'success',
          title: 'Prompts exportados',
          description: result.filePath ? `${count} para ${result.filePath}.` : `${count}.`
        })
      } else {
        addToast({
          type: 'error',
          title: 'Não foi possível exportar os prompts',
          description: result.error || 'Ocorreu um erro inesperado.'
        })
      }
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Não foi possível exportar os prompts',
        description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
      })
    } finally {
      setBusy(null)
    }
  }

  const handleImport = async () => {
    setBusy('import')
    try {
      const result = await window.electronAPI.importPrompts()
      if (result.canceled) {
        addToast({ type: 'info', title: 'Importação cancelada', description: 'Nenhum arquivo foi importado.' })
        return
      }
      if (!result.success) {
        addToast({
          type: 'error',
          title: 'Não foi possível importar os prompts',
          description: result.error || result.errors?.[0] || 'Ocorreu um erro inesperado.'
        })
        return
      }

      if (result.imported === 0 && result.duplicates === result.total) {
        addToast({
          type: 'info',
          title: 'Nenhum prompt novo',
          description: result.total === 1
            ? 'O prompt do arquivo já está na sua biblioteca.'
            : `Os ${result.total} prompts do arquivo já estão na sua biblioteca.`
        })
        return
      }

      if (result.imported > 0) {
        await fetchAllData()
      }

      const summary = [
        plural(result.imported, 'prompt importado', 'prompts importados'),
        result.skipped > 0 ? plural(result.skipped, 'ignorado', 'ignorados') : '',
        result.categoriesCreated ? plural(result.categoriesCreated, 'categoria criada', 'categorias criadas') : '',
        result.templatesImported ? plural(result.templatesImported, 'template importado', 'templates importados') : ''
      ].filter(Boolean).join(', ')
      // The first reasons for ignored prompts help the user fix the file
      const reasons = result.errors && result.errors.length > 0 ? ` ${result.errors.slice(0, 2).join(' ')}` : ''

      addToast({
        type: result.imported > 0 ? 'success' : 'warning',
        title: result.imported > 0 ? 'Prompts importados' : 'Nenhum prompt importado',
        description: `${summary}.${reasons}`,
        duration: reasons ? 10000 : undefined
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Não foi possível importar os prompts',
        description: error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Importar e exportar</CardTitle>
        <CardDescription>
          Exporte seus prompts para um arquivo (JSON inclui categorias e templates; TXT traz só o texto dos prompts)
          ou importe prompts de um arquivo JSON ou TXT.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => handleExport('json')} disabled={busy !== null}>
          {busy === 'json' ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Exportar prompts (JSON)
        </Button>
        <Button variant="outline" onClick={() => handleExport('txt')} disabled={busy !== null}>
          {busy === 'txt' ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
          Exportar prompts (TXT)
        </Button>
        <Button variant="outline" onClick={handleImport} disabled={busy !== null}>
          {busy === 'import' ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
          Importar prompts
        </Button>
      </CardContent>
    </Card>
  )
}

export function SettingsView({ onClose }: SettingsViewProps) {
  // The tab lives in the store, so other places can open Settings on a given tab (e.g. Tags)
  const { settingsTab: activeTab, setSettingsTab } = usePromptStore()

  const handleTabChange = (value: string) => {
    if (SETTINGS_TABS.includes(value as SettingsTab)) {
      setSettingsTab(value as SettingsTab)
    }
  }

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Content */}
      <div className="flex-1 min-h-0 p-6">
        <div className="max-w-6xl mx-auto h-full">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
            <div className="flex items-center justify-between gap-2 mb-6">
              <div className="flex items-center gap-4 min-w-0">
                <TabsList className="grid w-full grid-cols-4 max-w-2xl flex-shrink-0">
                  <TabsTrigger value="categories" className="flex items-center space-x-2">
                    <Palette className="h-4 w-4" />
                    <span>Categorias</span>
                  </TabsTrigger>
                  <TabsTrigger value="tags" className="flex items-center space-x-2">
                    <Hash className="h-4 w-4" />
                    <span>Tags</span>
                  </TabsTrigger>
                  <TabsTrigger value="general" className="flex items-center space-x-2">
                    <SettingsIcon className="h-4 w-4" />
                    <span>Geral</span>
                  </TabsTrigger>
                  <TabsTrigger value="data" className="flex items-center space-x-2">
                    <Database className="h-4 w-4" />
                    <span>Dados</span>
                  </TabsTrigger>
                </TabsList>

                {/* Info icons for each tab */}
                {activeTab === 'categories' && (
                  <InfoIcon
                    title="Categorias"
                    description={
                      <div className="space-y-2">
                        <p>Organize seus prompts em categorias com cores, para identificá-los e filtrá-los com facilidade.</p>
                        <p><strong>Criar:</strong> clique em "Nova categoria" para adicionar categorias personalizadas, com nome, descrição e cor.</p>
                        <p><strong>Gerenciar:</strong> edite ou exclua categorias pelos botões que aparecem ao passar o mouse sobre cada cartão de categoria.</p>
                        <p><strong>Uso:</strong> veja quantos prompts há em cada categoria para entender como sua biblioteca está organizada.</p>
                      </div>
                    }
                  />
                )}

                {activeTab === 'tags' && (
                  <InfoIcon
                    title="Tags"
                    description={
                      <div className="space-y-2">
                        <p>Gerencie as tags dos seus prompts para classificá-los com flexibilidade e aproveitar a busca avançada.</p>
                        <p><strong>Buscar:</strong> use a barra de busca para encontrar tags específicas ou use a sintaxe avançada, como 'tag:IA,Escrita', na busca principal de prompts.</p>
                        <p><strong>Estatísticas:</strong> veja a contagem de uso para descobrir quais tags são mais usadas na sua coleção de prompts.</p>
                        <p><strong>Renomear e excluir:</strong> altere ou remova uma tag em todos os prompts de uma vez.</p>
                      </div>
                    }
                  />
                )}

                {activeTab === 'general' && (
                  <InfoIcon
                    title="Configurações gerais"
                    description={
                      <div className="space-y-2">
                        <p>Veja os atalhos de teclado disponíveis para trabalhar com mais agilidade.</p>
                        <p><strong>Tema:</strong> para mudar a aparência, use o seletor de tema na barra lateral ou o atalho Ctrl+T.</p>
                      </div>
                    }
                  />
                )}

                {activeTab === 'data' && (
                  <InfoIcon
                    title="Gerenciamento de dados"
                    description={
                      <div className="space-y-2">
                        <p>Faça cópias dos seus prompts, importe prompts de arquivos ou recomece do zero.</p>
                        <p><strong>Exportar:</strong> salve seus prompts em JSON (com categorias e templates) ou em TXT.</p>
                        <p><strong>Importar:</strong> adicione prompts de um arquivo JSON ou TXT; os prompts atuais são mantidos.</p>
                        <p><strong>Restaurar configurações de fábrica:</strong> exclua permanentemente todos os dados e preferências e restaure o conteúdo de exemplo.</p>
                      </div>
                    }
                  />
                )}
              </div>

              {onClose && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  className="flex items-center space-x-2 flex-shrink-0"
                >
                  <X className="h-4 w-4" />
                  <span>Fechar</span>
                </Button>
              )}
            </div>

            <div className="flex-1 min-h-0">
              <TabsContent value="categories" className="h-full m-0 data-[state=active]:flex data-[state=active]:flex-col">
                <CategoryManager />
              </TabsContent>

              <TabsContent value="tags" className="h-full m-0 data-[state=active]:flex data-[state=active]:flex-col">
                <TagManager />
              </TabsContent>

              <TabsContent value="general" className="h-full m-0 data-[state=active]:flex data-[state=active]:flex-col">
                <KeyboardShortcutsSettings />
              </TabsContent>

              <TabsContent value="data" className="h-full m-0 data-[state=active]:flex data-[state=active]:flex-col">
                <div className="flex-1 min-h-0 overflow-y-auto space-y-6 pb-4">
                  <DataTransfer />
                  <FactoryReset />
                </div>
              </TabsContent>
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}
