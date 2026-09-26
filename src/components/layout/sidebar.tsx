import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, ListOrdered, Plus, Tag, Heart, Clock, Settings, MoreVertical, Edit, Trash2, Info, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Badge } from '@/components/ui/badge'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePromptStore } from '@/stores/usePromptStore'
import { cn } from '@/lib/utils'
import AppIcon from '/assets/icon.png'
import { CategoryModal } from '../modals/category-modal'
import { ThemeSwitcher } from '../ui/theme-switcher'
import { KeyboardShortcutsHelp } from '../keyboard-shortcuts-help'
import { confirmCategoryDeletion } from '../settings/category-manager'
import { parseSearchQuery, normalizeSearchText } from '@/lib/search-parser'
import { buildCategoryTree, countPromptsByCategory, flattenCategoryTree } from '../organization/organization-utils'
import type { Category } from '@/types'

interface SidebarProps {
  collapsed?: boolean
}

const SIDEBAR_TAG_LIMIT = 12

const countBadgeClass =
  "bg-secondary text-secondary-foreground rounded-full px-1.5 py-0.5 text-[10px] leading-none min-w-[18px] text-center flex-shrink-0"

export function Sidebar({ collapsed = false }: SidebarProps) {
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | undefined>(undefined)
  // Parent of the category being created ("Nova subcategoria")
  const [newCategoryParentId, setNewCategoryParentId] = useState<number | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [sectionsOpen, setSectionsOpen] = useState({
    categories: true,
    tags: true,
    recent: true
  })

  const {
    categories,
    tags,
    prompts,
    searchFilters,
    setCategoryFilter,
    toggleTagFilter,
    toggleFavoriteFilter,
    deleteCategory,
    openSettings,
    isSettingsOpen,
    openPromptEditor,
    getRecentlyInteractedPrompts,
    openPromptViewer,
    collapsedCategoryIds,
    toggleCategoryCollapsed
  } = usePromptStore()

  const recentPrompts = getRecentlyInteractedPrompts().slice(0, 5)
  const favoriteCount = prompts.filter(p => p.is_favorite).length

  // Prompt counts per category (including its subcategories, like the filter) and per tag (tags match like
  // the "tag:" filter: ignoring case and accents)
  const categoryCounts = useMemo(() => countPromptsByCategory(categories, prompts), [categories, prompts])
  const tagCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const prompt of prompts) {
      for (const tag of new Set(prompt.tags.map(normalizeSearchText))) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1)
      }
    }
    return counts
  }, [prompts])

  // Categories as a tree: the sidebar hides the subcategories of collapsed ones; the compact menu shows all
  const categoryTree = useMemo(() => buildCategoryTree(categories), [categories])
  const collapsedCategories = useMemo(() => new Set(collapsedCategoryIds), [collapsedCategoryIds])
  const categoryRows = useMemo(
    () => flattenCategoryTree(categoryTree, collapsedCategories),
    [categoryTree, collapsedCategories]
  )
  const allCategoryRows = useMemo(() => flattenCategoryTree(categoryTree), [categoryTree])

  const getCategoryPromptCount = (categoryId: number) => categoryCounts.get(categoryId) ?? 0
  const getTagPromptCount = (tag: string) => tagCounts.get(normalizeSearchText(tag)) ?? 0

  // The active filters come from the search query (the single source of truth)
  const currentParsedQuery = parseSearchQuery(searchFilters.query || '')
  const activeCategory = normalizeSearchText(currentParsedQuery.category)
  const activeTags = new Set(currentParsedQuery.tags.map(normalizeSearchText))
  const isFavoriteActive = currentParsedQuery.isFavorite === true
  const isCategoryActive = (category: Category) =>
    activeCategory !== '' && normalizeSearchText(category.name) === activeCategory
  const isTagActive = (tag: string) => activeTags.has(normalizeSearchText(tag))

  // Most-used tags first; the long tail stays behind "Mostrar todas" (active tags are always shown)
  const [showAllTags, setShowAllTags] = useState(false)
  const tagsByUsage = useMemo(
    () =>
      [...tags].sort(
        (a, b) =>
          (tagCounts.get(normalizeSearchText(b)) ?? 0) - (tagCounts.get(normalizeSearchText(a)) ?? 0) ||
          a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })
      ),
    [tags, tagCounts]
  )
  const visibleTags = showAllTags
    ? tagsByUsage
    : tagsByUsage.filter((tag, index) => index < SIDEBAR_TAG_LIMIT || isTagActive(tag))

  const toggleSection = (section: keyof typeof sectionsOpen) => {
    setSectionsOpen(prev => ({ ...prev, [section]: !prev[section] }))
  }

  const handleCreateCategory = (parentId: number | null = null) => {
    setEditingCategory(undefined)
    setNewCategoryParentId(parentId)
    setCategoryModalOpen(true)
  }

  const handleEditCategory = (category: Category) => {
    setEditingCategory(category)
    setNewCategoryParentId(null)
    setCategoryModalOpen(true)
  }

  const handleDeleteCategory = async (category: Category) => {
    if (await confirmCategoryDeletion(category)) {
      // The store shows the success or error toast itself
      await deleteCategory(category.id)
    }
  }

  const handleCategoryModalClose = (open: boolean) => {
    setCategoryModalOpen(open)
    if (!open) {
      setEditingCategory(undefined)
      setNewCategoryParentId(null)
    }
  }

  if (collapsed) {
    return (
      <TooltipProvider>
        <div className="w-12 h-full bg-muted/30 border-r flex flex-col items-center py-4 space-y-2">
          {/* Add New Prompt */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openPromptEditor()}
                aria-label="Novo prompt"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Novo prompt</p>
            </TooltipContent>
          </Tooltip>

          {/* Favorites Filter */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant={isFavoriteActive ? "secondary" : "ghost"}
                size="icon"
                className="h-8 w-8 relative"
                onClick={toggleFavoriteFilter}
                aria-label={`Favoritos (${favoriteCount})`}
                aria-pressed={isFavoriteActive}
              >
                <Heart className={cn(
                  "h-4 w-4",
                  isFavoriteActive && "fill-current text-red-500"
                )} />
                {favoriteCount > 0 && (
                  <Badge
                    variant="secondary"
                    className="absolute -top-1 -right-1 h-4 w-4 p-0 text-[10px] flex items-center justify-center"
                  >
                    {favoriteCount > 9 ? '9+' : favoriteCount}
                  </Badge>
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Favoritos ({favoriteCount})</p>
            </TooltipContent>
          </Tooltip>

          {/* Categories Dropdown */}
          <DropdownMenu>
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={activeCategory ? "secondary" : "ghost"}
                    size="icon"
                    className="h-8 w-8 relative"
                    aria-label="Categorias"
                  >
                    <Folder className="h-4 w-4" />
                    {activeCategory && (
                      <div className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-primary" />
                    )}
                  </Button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent side="right">
                <p>Categorias</p>
              </TooltipContent>
            </Tooltip>
            <DropdownMenuContent side="right" align="start" className="max-w-[16rem] max-h-80 overflow-y-auto">
              <DropdownMenuItem onClick={() => setCategoryFilter(null)} className="gap-2">
                <Folder className="h-4 w-4 shrink-0" />
                <span className="flex-1 min-w-0 truncate">Todas as categorias</span>
                <span className={countBadgeClass}>{prompts.length}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {allCategoryRows.map(({ category, depth }) => (
                <DropdownMenuItem
                  key={category.id}
                  onClick={() => setCategoryFilter(category.id)}
                  className={cn("gap-2", isCategoryActive(category) && "bg-secondary")}
                  style={depth > 0 ? { paddingLeft: `${0.5 + depth * 0.75}rem` } : undefined}
                >
                  <div
                    className="h-2 w-2 rounded-full shrink-0"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="flex-1 min-w-0 truncate" title={category.name}>{category.name}</span>
                  {category.is_sequence && (
                    <ListOrdered className="h-3 w-3 shrink-0 text-muted-foreground" aria-label="Sequência" />
                  )}
                  <span className={countBadgeClass}>{getCategoryPromptCount(category.id)}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleCreateCategory()}>
                <Plus className="h-4 w-4 mr-2" />
                Nova categoria
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Tags Dropdown */}
          {tags.length > 0 && (
            <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant={activeTags.size > 0 ? "secondary" : "ghost"}
                      size="icon"
                      className="h-8 w-8 relative"
                      aria-label="Tags"
                    >
                      <Tag className="h-4 w-4" />
                      {activeTags.size > 0 && (
                        <Badge
                          variant="secondary"
                          className="absolute -top-1 -right-1 h-4 w-4 p-0 text-[10px] flex items-center justify-center"
                        >
                          {activeTags.size > 9 ? '9+' : activeTags.size}
                        </Badge>
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Tags ({activeTags.size} {activeTags.size !== 1 ? 'selecionadas' : 'selecionada'})</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" className="max-w-[16rem] max-h-64 overflow-y-auto">
                {tags.map((tag) => (
                  <DropdownMenuItem
                    key={tag}
                    onClick={() => toggleTagFilter(tag)}
                    className={cn("gap-2", isTagActive(tag) && "bg-secondary")}
                  >
                    <Tag className="h-3 w-3 shrink-0" />
                    <span className="flex-1 min-w-0 truncate" title={tag}>{tag}</span>
                    {isTagActive(tag) && (
                      <div className="h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                    <span className={countBadgeClass}>{getTagPromptCount(tag)}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Recent Prompts */}
          <DropdownMenu>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Prompts recentes">
                      <Clock className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                </TooltipTrigger>
                <TooltipContent side="right">
                  <p>Prompts recentes</p>
                </TooltipContent>
              </Tooltip>
              <DropdownMenuContent side="right" align="start" className="w-56">
                {recentPrompts.length > 0 ? (
                  recentPrompts.map((prompt) => (
                    <DropdownMenuItem
                      key={prompt.id}
                      onClick={() => openPromptViewer(prompt)}
                      className="flex flex-col items-start p-2"
                    >
                      <div className="font-medium text-sm truncate w-full">{prompt.title}</div>
                      {prompt.description && (
                        <div className="text-xs text-muted-foreground truncate w-full mt-1">
                          {prompt.description}
                        </div>
                      )}
                    </DropdownMenuItem>
                  ))
                ) : (
                  <div className="p-4 text-center text-sm text-muted-foreground">
                    Nenhuma interação recente
                  </div>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

          <div className="flex-1" />

          {/* Theme Switcher */}
          <ThemeSwitcher collapsed={true} />

          {/* Keyboard Shortcuts */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => setShortcutsOpen(true)}
                aria-label="Atalhos de teclado"
              >
                <Keyboard className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Atalhos de teclado</p>
            </TooltipContent>
          </Tooltip>

          {/* Settings */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => openSettings()}
                aria-label="Configurações"
              >
                <Settings className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">
              <p>Configurações</p>
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Category Modal */}
        <CategoryModal
          open={categoryModalOpen}
          onOpenChange={handleCategoryModalClose}
          category={editingCategory}
          defaultParentId={newCategoryParentId}
        />

        {/* Keyboard Shortcuts Help */}
        <KeyboardShortcutsHelp
          open={shortcutsOpen}
          onOpenChange={setShortcutsOpen}
        />
      </TooltipProvider>
    )
  }

  return (
    <TooltipProvider>
    <div className="h-full min-w-0 bg-muted/30 border-r flex flex-col">
      {/* Header */}
      <div className="p-4 border-b">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={AppIcon}
              alt=""
              className="h-5 w-5 object-contain rounded shrink-0"
            />
            <h2 className="text-sm font-semibold truncate">Prompt Studio</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={() => openPromptEditor()}
            aria-label="Novo prompt"
            title="Novo prompt"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1 min-w-0">
          {/* Quick Filters */}
          <div className="space-y-1">
            <Button
              variant={isFavoriteActive ? "secondary" : "ghost"}
              size="sm"
              onClick={toggleFavoriteFilter}
              className="w-full min-w-0 justify-start h-8 text-xs px-2"
              aria-pressed={isFavoriteActive}
            >
              <Heart className={cn(
                "h-4 w-4 mr-2 flex-shrink-0",
                isFavoriteActive && "fill-current"
              )} />
              <span className="flex-1 min-w-0 truncate text-left">Favoritos</span>
              {favoriteCount > 0 && (
                <span className={cn(countBadgeClass, "ml-2")}>
                  {favoriteCount > 99 ? '99+' : favoriteCount}
                </span>
              )}
            </Button>
          </div>

          {/* Categories */}
          <Collapsible
            open={sectionsOpen.categories}
            onOpenChange={() => toggleSection('categories')}
          >
            <div className="flex items-center gap-1 min-w-0">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-1 min-w-0 justify-start h-8 text-xs font-medium px-2"
                >
                  {sectionsOpen.categories ? (
                    <ChevronDown className="h-4 w-4 mr-2 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 mr-2 flex-shrink-0" />
                  )}
                  <span className="truncate">Categorias</span>
                </Button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 flex-shrink-0"
                onClick={() => handleCreateCategory()}
                aria-label="Nova categoria"
                title="Nova categoria"
              >
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <CollapsibleContent className="space-y-1 ml-1 min-w-0">
              <div className="pl-5 min-w-0">
                <Button
                  variant={!activeCategory ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setCategoryFilter(null)}
                  className="w-full min-w-0 justify-start h-7 text-xs px-2"
                >
                  <span className="flex-1 min-w-0 truncate text-left">Todas as categorias</span>
                  <span className={cn(countBadgeClass, "ml-2")}>
                    {prompts.length}
                  </span>
                </Button>
              </div>
              {categoryRows.map(({ category, depth, hasChildren }) => (
                // The ⋮ button overlays the count (shown on hover/focus) instead of taking width from the name.
                // Subcategories are indented under their parent, which can collapse them.
                <div
                  key={category.id}
                  className="group relative flex items-center min-w-0"
                  style={depth > 0 ? { paddingLeft: `${depth * 0.75}rem` } : undefined}
                >
                  {hasChildren ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 shrink-0"
                      onClick={() => toggleCategoryCollapsed(category.id)}
                      aria-expanded={!collapsedCategories.has(category.id)}
                      aria-label={`${collapsedCategories.has(category.id) ? 'Expandir' : 'Recolher'} subcategorias de ${category.name}`}
                      title={collapsedCategories.has(category.id) ? 'Expandir subcategorias' : 'Recolher subcategorias'}
                    >
                      {collapsedCategories.has(category.id)
                        ? <ChevronRight className="h-3 w-3" />
                        : <ChevronDown className="h-3 w-3" />}
                    </Button>
                  ) : (
                    <span className="w-5 shrink-0" aria-hidden="true" />
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant={isCategoryActive(category) ? "secondary" : "ghost"}
                        size="sm"
                        onClick={() => setCategoryFilter(category.id)}
                        className="flex-1 min-w-0 justify-start h-7 text-xs px-2"
                      >
                        <div
                          className="h-2 w-2 rounded-full mr-2 shrink-0"
                          style={{ backgroundColor: category.color }}
                        />
                        <span className="flex-1 min-w-0 truncate text-left">{category.name}</span>
                        {category.is_sequence && (
                          <ListOrdered className="h-3 w-3 ml-1 shrink-0 text-muted-foreground" aria-label="Sequência" />
                        )}
                        <span
                          className={cn(
                            countBadgeClass,
                            "ml-2 group-hover:invisible group-focus-within:invisible group-has-[[data-state=open]]:invisible"
                          )}
                        >
                          {getCategoryPromptCount(category.id)}
                        </span>
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      <p className="max-w-xs break-words">{category.name}</p>
                      {category.description && (
                        <p className="max-w-xs break-words text-muted-foreground">{category.description}</p>
                      )}
                      {category.is_sequence && (
                        <p className="max-w-xs text-muted-foreground">Sequência: os prompts aparecem como passos em ordem</p>
                      )}
                      {hasChildren && (
                        <p className="max-w-xs text-muted-foreground">O total inclui os prompts das subcategorias</p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto data-[state=open]:opacity-100 data-[state=open]:pointer-events-auto transition-opacity"
                        aria-label={`Mais ações da categoria ${category.name}`}
                      >
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {category.description && (
                        <>
                          <DropdownMenuItem className="text-xs" disabled>
                            <Info className="h-3 w-3 mr-2 shrink-0" />
                            <span className="max-w-[200px] truncate">{category.description}</span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                        </>
                      )}
                      <DropdownMenuItem onClick={() => handleEditCategory(category)}>
                        <Edit className="h-3 w-3 mr-2" />
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleCreateCategory(category.id)}>
                        <FolderPlus className="h-3 w-3 mr-2" />
                        Nova subcategoria
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeleteCategory(category)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-3 w-3 mr-2" />
                        Excluir
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>

          {/* Tags */}
          {tags.length > 0 && (
            <Collapsible
              open={sectionsOpen.tags}
              onOpenChange={() => toggleSection('tags')}
            >
              <div className="flex items-center gap-1 min-w-0">
                <CollapsibleTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="flex-1 min-w-0 justify-start h-8 text-xs font-medium px-2"
                  >
                    {sectionsOpen.tags ? (
                      <ChevronDown className="h-4 w-4 mr-2 flex-shrink-0" />
                    ) : (
                      <ChevronRight className="h-4 w-4 mr-2 flex-shrink-0" />
                    )}
                    <span className="truncate">Tags</span>
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 flex-shrink-0"
                  onClick={() => openSettings('tags')}
                  aria-label="Gerenciar tags"
                  title="Gerenciar tags"
                >
                  <Settings className="h-3 w-3" />
                </Button>
              </div>
              <CollapsibleContent className="space-y-1 ml-6 min-w-0">
                {visibleTags.map((tag) => (
                  <Button
                    key={tag}
                    variant={isTagActive(tag) ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => toggleTagFilter(tag)}
                    className="w-full min-w-0 justify-start h-7 text-xs px-2"
                    aria-pressed={isTagActive(tag)}
                    title={tag}
                  >
                    <Tag className="h-3 w-3 mr-2 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-left">{tag}</span>
                    <span className={cn(countBadgeClass, "ml-2")}>
                      {getTagPromptCount(tag)}
                    </span>
                  </Button>
                ))}
                {tagsByUsage.length > SIDEBAR_TAG_LIMIT && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowAllTags((showAll) => !showAll)}
                    className="w-full min-w-0 justify-start h-7 text-xs px-2 text-muted-foreground"
                    aria-expanded={showAllTags}
                  >
                    {showAllTags ? 'Mostrar menos' : `Mostrar todas (${tagsByUsage.length})`}
                  </Button>
                )}
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Recent */}
          <Collapsible
              open={sectionsOpen.recent}
              onOpenChange={() => toggleSection('recent')}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full min-w-0 justify-start h-8 text-xs font-medium px-2"
                >
                  {sectionsOpen.recent ? (
                    <ChevronDown className="h-4 w-4 mr-2 flex-shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 mr-2 flex-shrink-0" />
                  )}
                  <span className="truncate">Recentes</span>
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 ml-6 min-w-0">
                {recentPrompts.length > 0 ? (
                  recentPrompts.map((prompt) => (
                    <Button
                      key={prompt.id}
                      variant="ghost"
                      size="sm"
                      onClick={() => openPromptViewer(prompt)}
                      className="w-full min-w-0 justify-start h-7 text-xs px-2 text-muted-foreground hover:text-foreground"
                      title={prompt.title}
                    >
                      <span className="flex-1 min-w-0 truncate text-left">{prompt.title}</span>
                    </Button>
                  ))
                ) : (
                  <div className="text-xs text-muted-foreground px-2">
                    Nenhum prompt recente
                  </div>
                )}
              </CollapsibleContent>
            </Collapsible>
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="p-2 border-t space-y-1">
        {/* Theme Switcher */}
        <ThemeSwitcher />

        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start h-8 text-xs"
          onClick={() => setShortcutsOpen(true)}
        >
          <Keyboard className="h-4 w-4 mr-2" />
          Atalhos de teclado
        </Button>

        <Button
          variant={isSettingsOpen ? 'secondary' : 'ghost'}
          size="sm"
          className="w-full justify-start h-8 text-xs"
          onClick={() => openSettings()}
          aria-current={isSettingsOpen ? 'page' : undefined}
        >
          <Settings className="h-4 w-4 mr-2" />
          Configurações
        </Button>
      </div>

      {/* Category Modal */}
      <CategoryModal
        open={categoryModalOpen}
        onOpenChange={handleCategoryModalClose}
        category={editingCategory}
        defaultParentId={newCategoryParentId}
      />

      {/* Keyboard Shortcuts Help */}
      <KeyboardShortcutsHelp
        open={shortcutsOpen}
        onOpenChange={setShortcutsOpen}
      />
    </div>
    </TooltipProvider>
  )
}
