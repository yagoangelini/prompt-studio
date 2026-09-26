import { Search, Filter, SortAsc, SortDesc, Grid, List, Plus, X, CheckSquare, ListOrdered } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { InfoIcon } from '@/components/ui/info-icon'
import { AdvancedSearchInput } from '../search/advanced-search-input'
import { PromptList } from '../prompts/prompt-list'
import { PromptGrid } from '../prompts/prompt-grid'
import { TestingPanel } from '../testing/testing-panel'
import { McpServerPanel } from '../mcp/mcp-server-panel'
import { TemplateList } from '../templates/template-list-simple'
import { BulkActionsBar } from '../organization/bulk-actions-bar'
import { PROMPT_LIST_AREA_ATTRIBUTE, useSelectionShortcuts } from '../organization/use-selection-shortcuts'
import { getSequenceCategoryForQuery, usePromptStore, type MainTab } from '@/stores/usePromptStore'
import type { SortOptions } from '@/types'

const SORT_OPTIONS: readonly { value: `${SortOptions['field']}:${SortOptions['direction']}`; label: string; descending: boolean }[] = [
  { value: 'updated_at:desc', label: 'Editados recentemente', descending: true },
  { value: 'updated_at:asc', label: 'Editados há mais tempo', descending: false },
  { value: 'title:asc', label: 'Título (A–Z)', descending: false },
  { value: 'title:desc', label: 'Título (Z–A)', descending: true },
  { value: 'created_at:desc', label: 'Criados recentemente', descending: true },
  { value: 'created_at:asc', label: 'Criados há mais tempo', descending: false },
  { value: 'usage_count:desc', label: 'Mais usados', descending: true },
  { value: 'last_used_at:desc', label: 'Usados recentemente', descending: true },
]

const SEQUENCE_SORT_HINT =
  'Os passos desta sequência aparecem na ordem definida por você. Arraste os prompts ou use Alt+↑ e Alt+↓ para mudar a ordem; a ordenação volta a valer fora da sequência.'

const MAIN_TABS: readonly MainTab[] = ['prompts', 'templates', 'testing', 'mcp']

export function MainContent() {
  const {
    getFilteredPrompts,
    searchFilters,
    sortOptions,
    setSearchFilters,
    clearSearchFilters,
    setSortOptions,
    openPromptEditor,
    openTemplateEditor,
    templateSearchQuery,
    setTemplateSearchQuery,
    getFilteredTemplates,
    promptViewMode,
    templateViewMode,
    setPromptViewMode,
    setTemplateViewMode,
    isPromptEditorOpen,
    isPromptViewerOpen,
    activeMainTab: activeTab,
    setActiveMainTab,
    categories,
    isSelectionMode,
    setSelectionMode
  } = usePromptStore()

  const filteredTemplates = getFilteredTemplates()

  const filteredPrompts = getFilteredPrompts()

  // A sequence category is listed in step order: the sort option does not apply while it is shown
  const sequenceCategory = getSequenceCategoryForQuery(searchFilters.query, categories)

  // Ctrl/Cmd+A selects the filtered prompts, Esc leaves the selection mode
  useSelectionShortcuts(filteredPrompts, activeTab === 'prompts')

  const handleSearch = (query: string) => {
    setSearchFilters({ query })
  }

  const handleSortChange = (value: string) => {
    const [field, direction] = value.split(':') as [SortOptions['field'], SortOptions['direction']]
    setSortOptions({ field, direction })
  }

  const handleTabChange = (value: string) => {
    if (MAIN_TABS.includes(value as MainTab)) {
      setActiveMainTab(value as MainTab)
    }
  }

  // All filters live in the search query
  const hasActiveFilters = searchFilters.query.trim() !== ''

  const currentViewMode = activeTab === 'prompts' ? promptViewMode : templateViewMode
  const viewModeLabel = currentViewMode === 'list' ? 'Mostrar em grade' : 'Mostrar em lista'

  return (
    <div className="h-full flex flex-col bg-background">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
        {/* Header */}
        <div className="flex-shrink-0 p-4 border-b space-y-4">
          {/* Wraps instead of hiding the buttons when the editor or viewer panel makes this area narrow */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0 max-w-full">
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                <TabsTrigger value="prompts">Prompts</TabsTrigger>
                <TabsTrigger value="templates">Templates</TabsTrigger>
                <TabsTrigger value="testing">Testes</TabsTrigger>
                <TabsTrigger value="mcp">Servidor MCP</TabsTrigger>
              </TabsList>

              {/* Info icons for each tab */}
              {activeTab === 'prompts' && (
                <InfoIcon
                  title="Prompts"
                  description={
                    <div className="space-y-2">
                      <p>Crie, organize e gerencie seus prompts de IA.</p>
                      <p><strong>Categorias:</strong> organize os prompts em categorias identificadas por cores para encontrá-los com facilidade.</p>
                      <p><strong>Tags:</strong> adicione várias tags aos prompts para organizá-los e filtrá-los com flexibilidade.</p>
                      <p><strong>Busca avançada:</strong> use 'tag:IA,Escrita', 'categoria:Nome', 'titulo:texto', 'conteudo:texto' ou 'favorito:sim'. A busca ignora maiúsculas e acentos; com várias palavras, mostra os prompts que contêm todas.</p>
                      <p><strong>Favoritos:</strong> marque os prompts importantes como favoritos para acessá-los rapidamente.</p>
                      <p><strong>Fixados e mais usados:</strong> fixe prompts no topo de qualquer lista e ordene por "Mais usados" ou "Usados recentemente".</p>
                      <p><strong>Sequências:</strong> numa categoria marcada como sequência, os prompts viram passos numerados; arraste para reordenar e use "Copiar próximo passo".</p>
                      <p><strong>Seleção:</strong> use "Selecionar" (ou Ctrl+A) para mover, marcar, exportar ou excluir vários prompts de uma vez.</p>
                      <p><strong>Templates:</strong> aplique templates prontos para agilizar a criação de prompts.</p>
                    </div>
                  }
                />
              )}

              {activeTab === 'templates' && (
                <InfoIcon
                  title="Templates"
                  description={
                    <div className="space-y-2">
                      <p>Crie templates reutilizáveis com variáveis para gerar prompts rapidamente.</p>
                      <p><strong>Variáveis:</strong> use a sintaxe {`{{nomeDaVariavel}}`} no conteúdo para criar campos que serão preenchidos quando o template for usado.</p>
                      <p><strong>Categorias:</strong> organize os templates atribuindo-os a categorias com rótulos coloridos.</p>
                      <p><strong>Busca:</strong> encontre templates por nome, conteúdo, descrição ou nomes de variáveis.</p>
                    </div>
                  }
                />
              )}

              {activeTab === 'testing' && (
                <InfoIcon
                  title="Testes"
                  description={
                    <div className="space-y-2">
                      <p>Envie um prompt para um modelo de IA (OpenAI e APIs compatíveis ou Anthropic Claude) e veja a resposta.</p>
                      <p><strong>Configuração:</strong> escolha o provedor e informe o endpoint, a chave de API e o modelo.</p>
                      <p><strong>Parâmetros:</strong> ajuste a temperatura e o máximo de tokens.</p>
                      <p><strong>Resultado:</strong> veja a resposta, o tempo de resposta e o uso de tokens.</p>
                      <p><strong>Histórico:</strong> cada teste fica salvo; reexecute ou compare duas execuções lado a lado.</p>
                      <p><strong>Comparar modelos:</strong> envie o mesmo prompt para duas configurações ao mesmo tempo.</p>
                    </div>
                  }
                />
              )}

              {activeTab === 'mcp' && (
                <InfoIcon
                  title="Servidor MCP"
                  description={
                    <div className="space-y-2">
                      <p>Exponha sua biblioteca de prompts como um servidor MCP (Model Context Protocol) para integrá-la a ferramentas de IA.</p>
                      <p><strong>Gerenciamento do servidor:</strong> inicie e pare o servidor MCP e acompanhe o status.</p>
                      <p><strong>Exposição de prompts:</strong> escolha quais prompts ficarão disponíveis para os clientes MCP.</p>
                      <p><strong>Segurança e autenticação:</strong> configure a chave de API, o limite de requisições e os controles de acesso.</p>
                      <p><strong>Integração com clientes:</strong> conecte-se ao Claude Desktop, ao Claude Code e a outros aplicativos compatíveis com MCP.</p>
                    </div>
                  }
                />
              )}
            </div>

            {(activeTab === 'prompts' || activeTab === 'templates') && (
              <div className="flex items-center gap-2 flex-shrink-0 ml-auto">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    if (activeTab === 'prompts') {
                      setPromptViewMode(promptViewMode === 'list' ? 'grid' : 'list')
                    } else {
                      setTemplateViewMode(templateViewMode === 'list' ? 'grid' : 'list')
                    }
                  }}
                  aria-label={viewModeLabel}
                  title={viewModeLabel}
                >
                  {currentViewMode === 'list' ? (
                    <Grid className="h-4 w-4" />
                  ) : (
                    <List className="h-4 w-4" />
                  )}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (activeTab === 'prompts') {
                      openPromptEditor()
                    } else {
                      openTemplateEditor()
                    }
                  }}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  {activeTab === 'prompts' ? 'Novo prompt' : 'Novo template'}
                </Button>
              </div>
            )}
          </div>

          {activeTab === 'prompts' && (
            <div className="space-y-3">
              {/* Search and Controls Row: the controls move below the search when there is no room */}
              <div className="flex flex-wrap items-start gap-3">
                {/* Advanced Search */}
                <div className="flex-1 min-w-[12rem]">
                  <AdvancedSearchInput
                    value={searchFilters.query}
                    onChange={handleSearch}
                    placeholder="Buscar prompts (ex.: tag:IA)"
                  />
                </div>

                {/* Sort and Filter Controls */}
                <div className="flex items-center gap-3 flex-shrink-0">
                  {/* Sort (disabled while a sequence is shown: its steps have their own order) */}
                  <Select
                    value={`${sortOptions.field}:${sortOptions.direction}`}
                    onValueChange={handleSortChange}
                    disabled={sequenceCategory !== null}
                  >
                    <SelectTrigger
                      className="w-60 h-10"
                      aria-label="Ordenar por"
                      aria-describedby={sequenceCategory ? 'sequence-sort-hint' : undefined}
                      title={sequenceCategory ? SEQUENCE_SORT_HINT : undefined}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SORT_OPTIONS.map(option => (
                        <SelectItem key={option.value} value={option.value}>
                          <div className="flex items-center">
                            {option.descending ? (
                              <SortDesc className="h-4 w-4 mr-2 shrink-0" />
                            ) : (
                              <SortAsc className="h-4 w-4 mr-2 shrink-0" />
                            )}
                            {option.label}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Filter indicator */}
                  {hasActiveFilters && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={clearSearchFilters}
                      className="h-10 px-3"
                    >
                      <Filter className="h-4 w-4 mr-2" />
                      <span className="text-xs">Limpar</span>
                    </Button>
                  )}
                </div>
              </div>

              {sequenceCategory && (
                <p id="sequence-sort-hint" className="flex items-start gap-1.5 text-xs text-muted-foreground">
                  <ListOrdered className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>
                    Ordem da sequência “{sequenceCategory.name}”: o seletor de ordenação fica desativado enquanto ela é exibida.
                  </span>
                </p>
              )}

              {isSelectionMode && <BulkActionsBar visiblePrompts={filteredPrompts} />}
            </div>
          )}

          {activeTab === 'templates' && (
            <div className="space-y-3">
              {/* Template Search */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[12rem]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      placeholder="Buscar templates..."
                      aria-label="Buscar templates"
                      value={templateSearchQuery}
                      onChange={(e) => setTemplateSearchQuery(e.target.value)}
                      className="pl-9 pr-9 h-10"
                    />
                    {templateSearchQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTemplateSearchQuery('')}
                        className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                        aria-label="Limpar busca"
                        title="Limpar busca"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>

                {filteredTemplates.length > 0 && (
                  <div className="flex items-center text-sm text-muted-foreground">
                    {filteredTemplates.length} template{filteredTemplates.length !== 1 ? 's' : ''}
                    {templateSearchQuery && (filteredTemplates.length !== 1 ? ` (filtrados)` : ` (filtrado)`)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0">
          <TabsContent value="prompts" className="h-full m-0 data-[state=active]:flex data-[state=active]:flex-col">
            <div className="flex-1 min-h-0 overflow-hidden" {...{ [PROMPT_LIST_AREA_ATTRIBUTE]: '' }}>
              <ScrollArea className="h-full">
                <div className="p-4">
                  {filteredPrompts.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="mb-4">
                        <div className="w-16 h-16 mx-auto bg-muted rounded-full flex items-center justify-center">
                          <Search className="h-8 w-8 text-muted-foreground" />
                        </div>
                      </div>
                      <h3 className="text-lg font-medium mb-2">Nenhum prompt encontrado</h3>
                      <p className="text-muted-foreground mb-6 max-w-md mx-auto">
                        {hasActiveFilters
                          ? "Nenhum prompt corresponde aos filtros atuais. Tente ajustar os critérios de busca."
                          : "Comece criando seu primeiro prompt."
                        }
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-4">
                        <Button onClick={() => openPromptEditor()}>
                          <Plus className="h-4 w-4 mr-2" />
                          Criar prompt
                        </Button>
                        {hasActiveFilters && (
                          <Button variant="outline" onClick={clearSearchFilters}>
                            Limpar filtros
                          </Button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center justify-between gap-2 mb-4">
                        <p className="text-sm text-muted-foreground">
                          {filteredPrompts.length} prompt{filteredPrompts.length !== 1 ? 's' : ''}
                          {hasActiveFilters && (filteredPrompts.length !== 1 ? ' (filtrados)' : ' (filtrado)')}
                        </p>
                        {!isSelectionMode && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8"
                            onClick={() => setSelectionMode(true)}
                            title="Selecionar vários prompts para mover, marcar, exportar ou excluir (Ctrl+A seleciona todos)"
                          >
                            <CheckSquare className="h-4 w-4 mr-2" />
                            Selecionar
                          </Button>
                        )}
                      </div>

                      {promptViewMode === 'list' ? (
                        <PromptList prompts={filteredPrompts} />
                      ) : (
                        <PromptGrid
                          prompts={filteredPrompts}
                          compactMode={isPromptEditorOpen || isPromptViewerOpen}
                        />
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </div>
          </TabsContent>

          <TabsContent value="templates" className="h-full m-0">
            <TemplateList
              viewMode={templateViewMode}
              filteredTemplates={filteredTemplates}
            />
          </TabsContent>

          <TabsContent value="testing" className="h-full m-0">
            <TestingPanel />
          </TabsContent>

          <TabsContent value="mcp" className="h-full m-0">
            <McpServerPanel />
          </TabsContent>

        </div>
      </Tabs>
    </div>
  )
}
