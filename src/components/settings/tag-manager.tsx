import { useState, useMemo } from 'react'
import { X, Hash, Search, Trash2, Edit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { normalizeSearchText } from '@/lib/search-parser'

interface TagStats {
  tag: string
  count: number
}

const countLabel = (count: number) => `${count} prompt${count !== 1 ? 's' : ''}`

export function TagManager() {
  const { prompts, fetchPrompts, fetchTags, addToast } = usePromptStore()
  const [searchQuery, setSearchQuery] = useState('')
  const [renamingTag, setRenamingTag] = useState<string | null>(null)
  const [editTagName, setEditTagName] = useState('')
  const [isSaving, setIsSaving] = useState(false)

  // Usage per tag (exact name, as stored in the prompts)
  const tagStats = useMemo<TagStats[]>(() => {
    const stats = new Map<string, number>()
    prompts.forEach((prompt) => {
      prompt.tags.forEach((tag) => stats.set(tag, (stats.get(tag) ?? 0) + 1))
    })
    return Array.from(stats, ([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, 'pt-BR', { sensitivity: 'base' }))
  }, [prompts])

  const filteredStats = tagStats.filter(({ tag }) =>
    tag.toLowerCase().includes(searchQuery.trim().toLowerCase())
  )

  const refresh = async () => {
    await Promise.all([fetchPrompts(), fetchTags()])
  }

  const handleDeleteTag = async ({ tag, count }: TagStats) => {
    const confirmed = await confirmAction({
      title: `Excluir a tag "${tag}"?`,
      description: `Ela será removida de ${countLabel(count)}. Os prompts não são excluídos. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      destructive: true,
    })
    if (!confirmed) return

    try {
      const result = await window.electronAPI.deleteTag(tag)
      await refresh()
      addToast({
        type: 'success',
        title: 'Tag excluída',
        description: `A tag "${tag}" foi removida de ${countLabel(result.updated)}.`
      })
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Não foi possível excluir a tag',
        description: error instanceof Error ? error.message : 'Tente novamente.'
      })
    }
  }

  const openRenameDialog = (tag: string) => {
    setRenamingTag(tag)
    setEditTagName(tag)
  }

  const closeRenameDialog = () => {
    setRenamingTag(null)
    setEditTagName('')
  }

  const newName = editTagName.trim()

  const confirmRenameTag = async () => {
    if (!renamingTag || !newName || isSaving) return
    if (newName === renamingTag) {
      closeRenameDialog()
      return
    }

    // Renaming to an existing tag (ignoring case and accents, like the search) merges both;
    // the backend keeps the existing spelling
    const existing = tagStats.find(
      ({ tag }) => tag !== renamingTag && normalizeSearchText(tag) === normalizeSearchText(newName)
    )
    const finalName = existing?.tag ?? newName
    if (existing) {
      const confirmed = await confirmAction({
        title: `Mesclar com a tag "${existing.tag}"?`,
        description: `A tag "${existing.tag}" já existe. Os prompts com "${renamingTag}" passarão a usar "${existing.tag}".`,
        confirmLabel: 'Mesclar',
      })
      if (!confirmed) return
    }

    setIsSaving(true)
    try {
      const result = await window.electronAPI.renameTag(renamingTag, newName)
      await refresh()
      addToast({
        type: 'success',
        title: existing ? 'Tags mescladas' : 'Tag renomeada',
        description: `"${renamingTag}" agora é "${finalName}" em ${countLabel(result.updated)}.`
      })
      closeRenameDialog()
    } catch (error) {
      addToast({
        type: 'error',
        title: 'Não foi possível renomear a tag',
        description: error instanceof Error ? error.message : 'Tente novamente.'
      })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="h-full flex flex-col space-y-6">
      <div className="space-y-4 flex-shrink-0">
        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar tags..."
            aria-label="Buscar tags"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 pr-9"
          />
          {searchQuery && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSearchQuery('')}
              className="absolute right-1 top-1/2 transform -translate-y-1/2 h-7 w-7 p-0"
              aria-label="Limpar busca"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>

        {/* Tag Statistics */}
        <div className="text-sm text-muted-foreground">
          {filteredStats.length} tag{filteredStats.length !== 1 ? 's' : ''}
          {searchQuery && ' (com filtro)'}
        </div>
      </div>

      {/* Tags List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="space-y-4 pb-4">
          {filteredStats.length === 0 ? (
            <div className="text-center py-8">
              <Hash className="h-8 w-8 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-medium mb-2">
                {searchQuery ? 'Nenhuma tag encontrada' : 'Nenhuma tag ainda'}
              </h3>
              <p className="text-muted-foreground mb-4">
                {searchQuery
                  ? 'Tente ajustar os critérios de busca.'
                  : 'As tags aparecerão aqui à medida que você as adicionar aos seus prompts.'
                }
              </p>
              {searchQuery && (
                <Button variant="outline" size="sm" onClick={() => setSearchQuery('')}>
                  Limpar busca
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredStats.map((stats) => (
                <div
                  key={stats.tag}
                  className="flex items-center justify-between gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Badge variant="secondary" className="font-mono max-w-full truncate">
                      {stats.tag}
                    </Badge>
                    <span className="text-sm text-muted-foreground shrink-0">
                      {countLabel(stats.count)}
                    </span>
                  </div>
                  <div className="flex items-center space-x-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openRenameDialog(stats.tag)}
                      className="h-8 w-8 p-0"
                      aria-label={`Renomear a tag "${stats.tag}"`}
                      title="Renomear"
                    >
                      <Edit2 className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDeleteTag(stats)}
                      className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                      aria-label={`Excluir a tag "${stats.tag}"`}
                      title="Excluir"
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Rename Tag Dialog */}
      <Dialog open={renamingTag !== null} onOpenChange={(open) => { if (!open) closeRenameDialog() }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renomear tag</DialogTitle>
            <DialogDescription>
              Renomeie a tag "{renamingTag}". Ela será atualizada em todos os prompts que a utilizam.
            </DialogDescription>
          </DialogHeader>
          <form
            className="py-4"
            onSubmit={(e) => {
              e.preventDefault()
              confirmRenameTag()
            }}
          >
            <Input
              placeholder="Novo nome da tag..."
              aria-label="Novo nome da tag"
              value={editTagName}
              onChange={(e) => setEditTagName(e.target.value)}
              autoFocus
            />
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={closeRenameDialog}>
              Cancelar
            </Button>
            <Button onClick={confirmRenameTag} disabled={!newName || isSaving}>
              {isSaving ? 'Renomeando...' : 'Renomear'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
