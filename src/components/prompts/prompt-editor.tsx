import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Save, Copy, Check, Heart, Tag, Sparkles, Braces, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { cn } from '@/lib/utils'
import { extractVariables, substituteVariables, variableToken } from '../templates/template-variables'
import {
  EMPTY_PROMPT_FORM,
  PROMPT_TITLE_MAX_LENGTH,
  addTag,
  checkTitle,
  formFromPrompt,
  draftOwnerId,
  normalizeDraft,
  normalizeTag,
  sameForm,
  tagsWithPending,
  type PromptFormState
} from './prompt-editor-utils'
import { useEditorDirtySync } from './use-editor-dirty-sync'
import { ContentEditorField } from './content-editor-field'
import { PromptVersionHistory } from './prompt-version-history'
import type { CreatePromptData, PromptVersion, UpdatePromptData } from '@/types'

interface PromptEditorProps {
  compact?: boolean
  onClose?: () => void
}

type EditorTab = 'content' | 'metadata' | 'history'

// Clearing a field must reach the database as NULL (undefined would mean "leave it unchanged")
type PromptUpdatePayload = Omit<UpdatePromptData, 'description'> & { description: string | null }

// A new prompt starts in the category being filtered (e.g. an open sequence), so it doesn't leave the list
const newPromptForm = (): PromptFormState => {
  const { searchFilters, categories } = usePromptStore.getState()
  const categoryId = searchFilters.categoryId ?? null
  return categoryId !== null && categories.some((category) => category.id === categoryId)
    ? { ...EMPTY_PROMPT_FORM, category_id: categoryId }
    : EMPTY_PROMPT_FORM
}

// When the check itself fails, the normal save runs and reports its own error
const promptStillExists = async (id: number): Promise<boolean> => {
  try {
    return (await window.electronAPI.getPrompt(id)) !== null
  } catch {
    return true
  }
}

export function PromptEditor({ compact = false, onClose }: PromptEditorProps) {
  const {
    selectedPrompt,
    categories,
    templates,
    createPrompt,
    updatePrompt,
    closePromptEditor,
    addToast,
    draftFormData,
    saveDraftFormData,
    clearDraftFormData,
    getDraftFormData,
    setEditorDirty
  } = usePromptStore()

  // A stored draft is restored only for the prompt it belongs to (or for a new prompt), so unsaved
  // edits survive closing the app
  const baselineFor = (prompt: typeof selectedPrompt): PromptFormState =>
    prompt ? formFromPrompt(prompt) : newPromptForm()

  const formForOpening = (prompt: typeof selectedPrompt, base: PromptFormState): PromptFormState => {
    const stored = getDraftFormData()
    const draft = normalizeDraft(stored)
    const owner = draftOwnerId(stored)
    if (prompt) return draft && owner === prompt.id ? draft : base
    return draft && owner === null ? draft : base
  }

  // What the form is compared against to know whether there are unsaved changes
  const [baseline, setBaseline] = useState<PromptFormState>(() => baselineFor(selectedPrompt))
  const [formData, setFormData] = useState<PromptFormState>(() => formForOpening(selectedPrompt, baseline))
  const [activeTab, setActiveTab] = useState<EditorTab>('content')
  const [newTag, setNewTag] = useState('')
  const [tagMessage, setTagMessage] = useState<string | null>(null)
  const [variableValues, setVariableValues] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [versions, setVersions] = useState<readonly PromptVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [justCopied, setJustCopied] = useState(false)

  const formRef = useRef(formData)
  formRef.current = formData
  const savingRef = useRef(false)
  const variablesSectionRef = useRef<HTMLElement>(null)

  const promptId = selectedPrompt?.id ?? null
  const isNew = selectedPrompt === null

  const resetAuxiliaryState = () => {
    setNewTag('')
    setTagMessage(null)
    setVariableValues(new Map())
  }

  // Re-initialize only when another prompt (or a new one) is opened. Updates to the same prompt made
  // elsewhere (favorite toggled on a card, category renamed or deleted) must not wipe what is being typed.
  useEffect(() => {
    const base = baselineFor(selectedPrompt)
    const next = formForOpening(selectedPrompt, base)
    formRef.current = next
    setFormData(next)
    setBaseline(base)
    setActiveTab('content')
    setVersions(null)
    setVersionsError(null)
    resetAuxiliaryState()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promptId])

  // A draft written by someone else while a new prompt is open (e.g. "Usar template") replaces the form.
  // The editor's own autosave writes the same values it holds, so those are ignored.
  useEffect(() => {
    if (selectedPrompt || draftOwnerId(draftFormData) !== null) return
    const draft = normalizeDraft(draftFormData)
    if (draft && !sameForm(draft, formRef.current)) {
      formRef.current = draft
      setFormData(draft)
      resetAuxiliaryState()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftFormData])

  const isDirty = !sameForm(formData, baseline) || normalizeTag(newTag) !== ''

  useEditorDirtySync(isDirty, () => {
    // The user confirmed "Descartar" somewhere else and this editor stayed open
    if (selectedPrompt) {
      clearDraftFormData()
      const original = formFromPrompt(selectedPrompt)
      formRef.current = original
      setFormData(original)
      setBaseline(original)
    } else {
      const draft = normalizeDraft(getDraftFormData())
      // A different draft was just provided (e.g. "Usar template"); otherwise the draft is the discarded text.
      // Compare with this render's form: the draft effect above may already have replaced formRef.current.
      const next = draft && !sameForm(draft, formData) ? draft : baseline
      if (next === baseline) clearDraftFormData()
      formRef.current = next
      setFormData(next)
    }
    resetAuxiliaryState()
  })

  const updateForm = (patch: Partial<PromptFormState>) => {
    const next = { ...formRef.current, ...patch }
    formRef.current = next
    setFormData(next)
    saveDraftFormData({ ...next, prompt_id: selectedPrompt?.id ?? null })
  }

  // Version history, loaded when its tab is opened
  useEffect(() => {
    if (activeTab !== 'history' || promptId === null) return
    let cancelled = false
    setVersionsError(null)
    window.electronAPI
      .getPromptVersions(promptId)
      .then((list) => {
        if (!cancelled) setVersions([...list].sort((a, b) => b.version_number - a.version_number))
      })
      .catch((error) => {
        console.error('Failed to load prompt versions:', error)
        if (!cancelled) {
          setVersions([])
          setVersionsError('Não foi possível carregar o histórico de versões.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [activeTab, promptId, selectedPrompt?.updated_at])

  // A category or template deleted while the editor is open is treated as "none"
  const effectiveCategoryId =
    formData.category_id !== null && categories.some((c) => c.id === formData.category_id) ? formData.category_id : null
  const effectiveTemplateId =
    formData.template_id !== null && templates.some((t) => t.id === formData.template_id) ? formData.template_id : null

  const titleCheck = checkTitle(formData.title)
  const trimmedTitleLength = formData.title.trim().length
  const missingFields = [
    titleCheck.title ? null : 'Título',
    formData.content.trim() ? null : 'Conteúdo'
  ].filter((field): field is string => field !== null)
  const saveBlockedReason = missingFields.length > 0
    ? `Preencha ${missingFields.length > 1 ? 'os campos obrigatórios' : 'o campo obrigatório'}: ${missingFields.join(' e ')}.`
    : titleCheck.error

  const contentVariables = useMemo(() => extractVariables(formData.content), [formData.content])
  const hasVariableValues = contentVariables.some((name) => (variableValues.get(name) ?? '') !== '')

  const closeEditor = () => {
    clearDraftFormData()
    setEditorDirty(false)
    closePromptEditor()
    onClose?.()
  }

  const handleClose = async () => {
    if (isDirty) {
      const confirmed = await confirmAction({
        title: 'Descartar alterações?',
        description: 'Você tem alterações não salvas. Deseja descartá-las?',
        confirmLabel: 'Descartar',
        destructive: true
      })
      if (!confirmed) return
    }
    closeEditor()
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // Open selects, menus and dialogs handle Escape themselves and mark it as handled
    if (event.key !== 'Escape' || event.defaultPrevented || event.nativeEvent.defaultPrevented) return
    event.preventDefault()
    void handleClose()
  }

  const handleSave = async () => {
    if (savingRef.current) return
    if (saveBlockedReason) {
      addToast({ type: 'error', title: 'Não foi possível salvar', description: saveBlockedReason })
      return
    }

    savingRef.current = true
    setIsSaving(true)
    try {
      const tags = tagsWithPending(formData.tags, newTag)
      const description = formData.description.trim() ? formData.description : null
      const createData: CreatePromptData = {
        title: titleCheck.title,
        content: formData.content,
        description: description ?? undefined,
        category_id: effectiveCategoryId,
        template_id: effectiveTemplateId,
        tags,
        is_favorite: formData.is_favorite
      }
      // The prompt may have been deleted meanwhile (another window, bulk actions): keep the text as a new prompt
      const deletedMeanwhile = selectedPrompt !== null && !(await promptStillExists(selectedPrompt.id))
      let saved: boolean
      if (deletedMeanwhile) {
        const confirmed = await confirmAction({
          title: 'Este prompt foi excluído',
          description: 'O prompt que você está editando não existe mais. Deseja salvar o texto como um novo prompt?',
          confirmLabel: 'Salvar como novo prompt'
        })
        if (!confirmed) return
        saved = await createPrompt(createData)
      } else if (selectedPrompt) {
        const updateData: PromptUpdatePayload = {
          title: titleCheck.title,
          content: formData.content,
          description,
          category_id: effectiveCategoryId,
          template_id: effectiveTemplateId,
          tags,
          is_favorite: formData.is_favorite
        }
        saved = await updatePrompt(selectedPrompt.id, updateData as UpdatePromptData)
      } else {
        saved = await createPrompt(createData)
      }
      // On failure the store already showed the error; the editor stays open with everything typed
      if (saved) {
        closeEditor()
      }
    } catch (error) {
      console.error('Failed to save prompt:', error)
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  const handleCopyContent = async () => {
    try {
      await window.electronAPI.copyToClipboard(formData.content)
      setJustCopied(true)
      setTimeout(() => setJustCopied(false), 2000)
      addToast({
        type: 'success',
        title: 'Copiado',
        description: 'Conteúdo copiado para a área de transferência'
      })
    } catch (error) {
      console.error('Failed to copy:', error)
      addToast({
        type: 'error',
        title: 'Não foi possível copiar',
        description: 'Não foi possível copiar o conteúdo para a área de transferência'
      })
    }
  }

  const handleAddTag = () => {
    const result = addTag(formData.tags, newTag)
    if (result.status === 'empty') {
      setNewTag('')
      setTagMessage(null)
      return
    }
    if (result.status === 'duplicate') {
      setTagMessage(`A tag "${result.existing}" já foi adicionada.`)
      return
    }
    updateForm({ tags: result.tags })
    setNewTag('')
    setTagMessage(null)
  }

  const handleRemoveTag = (tagToRemove: string) => {
    updateForm({ tags: formRef.current.tags.filter((tag) => tag !== tagToRemove) })
  }

  const handleTemplateChange = async (value: string) => {
    if (value === 'none') {
      updateForm({ template_id: null })
      return
    }

    const template = templates.find((t) => t.id === Number(value))
    if (!template) return

    const current = formRef.current
    if (current.content.trim() && current.content !== template.content) {
      const confirmed = await confirmAction({
        title: 'Substituir o conteúdo?',
        description: `O conteúdo atual do prompt será substituído pelo conteúdo do template "${template.name}".`,
        confirmLabel: 'Substituir'
      })
      if (!confirmed) return
    }

    // Keep the category the user already chose; the template's category is only a default
    updateForm({
      template_id: template.id,
      content: template.content,
      category_id: formRef.current.category_id ?? template.category_id
    })
    setVariableValues(new Map())
  }

  const showVariablesSection = () => {
    const section = variablesSectionRef.current
    if (!section) return
    section.scrollIntoView({ behavior: 'smooth', block: 'start' })
    section.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true })
  }

  const handleVariableValueChange = (name: string, value: string) => {
    setVariableValues((previous) => new Map(previous).set(name, value))
  }

  const handleApplyVariables = () => {
    const values = new Map<string, string>()
    for (const name of contentVariables) {
      const value = variableValues.get(name)
      if (value) values.set(name, value)
    }
    if (values.size === 0) return
    updateForm({ content: substituteVariables(formRef.current.content, values) })
    setVariableValues(new Map())
  }

  const handleRestoreVersion = (version: PromptVersion) => {
    updateForm({ content: version.content })
    setActiveTab('content')
    addToast({
      type: 'info',
      title: 'Versão restaurada',
      description: `O conteúdo da versão ${version.version_number} foi colocado no formulário. Salve para criar uma nova versão.`
    })
  }

  return (
    <div
      className={cn(
        "h-full bg-background flex flex-col min-w-0",
        compact ? "border-l" : "border"
      )}
      onKeyDown={handleKeyDown}
    >
      {/* Header */}
      <div className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="text-lg font-semibold min-w-0 truncate">
            {selectedPrompt ? 'Editar prompt' : 'Novo prompt'}
          </h2>
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            {formData.content && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleCopyContent}
                disabled={justCopied}
              >
                {justCopied ? (
                  <>
                    <Check className="h-4 w-4 mr-2 text-green-600" />
                    <span className="text-green-600">Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-2" />
                    Copiar
                  </>
                )}
              </Button>
            )}
            <Button
              onClick={handleSave}
              disabled={Boolean(saveBlockedReason) || isSaving}
              size="sm"
              data-save-button
              title={saveBlockedReason ?? undefined}
              aria-describedby={saveBlockedReason ? 'prompt-save-hint' : undefined}
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Salvando...' : 'Salvar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              aria-label="Fechar editor"
              title="Fechar (Esc)"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {saveBlockedReason && (
          <p id="prompt-save-hint" className="flex items-start gap-1.5 px-4 pb-3 -mt-1 text-xs text-muted-foreground">
            <AlertCircle className="h-3.5 w-3.5 mt-px flex-shrink-0" aria-hidden="true" />
            <span>{saveBlockedReason}</span>
          </p>
        )}
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        <div className="p-4 space-y-6 min-w-0">
          <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EditorTab)} className="space-y-4">
            <TabsList className="h-auto max-w-full flex-wrap">
              <TabsTrigger value="content">Conteúdo</TabsTrigger>
              <TabsTrigger value="metadata">Metadados</TabsTrigger>
              {selectedPrompt && <TabsTrigger value="history">Histórico</TabsTrigger>}
            </TabsList>

            <TabsContent value="content" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                <span className="text-destructive" aria-hidden="true">*</span> Campo obrigatório
              </p>

              {/* Title */}
              <div className="space-y-2">
                <Label htmlFor="title">
                  Título <span className="text-destructive" aria-hidden="true">*</span>
                </Label>
                <Input
                  id="title"
                  placeholder="Digite o título do prompt..."
                  value={formData.title}
                  aria-required="true"
                  aria-invalid={trimmedTitleLength > PROMPT_TITLE_MAX_LENGTH}
                  aria-describedby={trimmedTitleLength > PROMPT_TITLE_MAX_LENGTH ? 'title-error' : undefined}
                  onChange={(e) => updateForm({ title: e.target.value })}
                />
                {trimmedTitleLength > PROMPT_TITLE_MAX_LENGTH ? (
                  <p id="title-error" className="text-xs text-destructive">
                    {titleCheck.error}
                  </p>
                ) : trimmedTitleLength > PROMPT_TITLE_MAX_LENGTH - 20 ? (
                  <p className="text-xs text-muted-foreground">
                    {trimmedTitleLength}/{PROMPT_TITLE_MAX_LENGTH} caracteres
                  </p>
                ) : null}
              </div>

              {/* Template Selection */}
              {templates.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="template">Template (opcional)</Label>
                  <Select
                    value={effectiveTemplateId !== null ? effectiveTemplateId.toString() : 'none'}
                    onValueChange={handleTemplateChange}
                  >
                    <SelectTrigger id="template">
                      <SelectValue placeholder="Selecione um template..." />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sem template</SelectItem>
                      {templates.map((template) => (
                        <SelectItem key={template.id} value={template.id.toString()}>
                          <div className="flex items-center space-x-2">
                            <Sparkles className="h-4 w-4" />
                            <span>{template.name}</span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Content */}
              <ContentEditorField
                key={promptId ?? 'new'}
                id="content"
                label={<>Conteúdo <span className="text-destructive" aria-hidden="true">*</span></>}
                placeholder="Digite o conteúdo do prompt... Use {{nomeDaVariavel}} para variáveis."
                value={formData.content}
                required
                onChange={(content) => updateForm({ content })}
                toolbar={
                  contentVariables.length > 0 ? (
                    // The fill-in section sits below the (tall) text: this link brings it into view
                    <button
                      type="button"
                      onClick={showVariablesSection}
                      className="inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Braces className="h-3.5 w-3.5" aria-hidden="true" />
                      Preencher {contentVariables.length} {contentVariables.length === 1 ? 'variável' : 'variáveis'}
                    </button>
                  ) : null
                }
              />

              {/* Fill in the {{variables}} of the content */}
              {contentVariables.length > 0 && (
                <section
                  ref={variablesSectionRef}
                  aria-labelledby="fill-variables-title"
                  className="space-y-3 rounded-lg border p-3 scroll-mt-4"
                >
                  <div className="flex items-center gap-2">
                    <Braces className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <h3 id="fill-variables-title" className="text-sm font-medium">Preencher variáveis</h3>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Preencha os valores e clique em "Aplicar valores" para substituí-los no conteúdo. Variáveis sem valor continuam no texto.
                    Se preferir, deixe as variáveis no prompt: ao copiá-lo, o Prompt Studio pede os valores a cada uso.
                  </p>
                  <div className="space-y-2">
                    {contentVariables.map((name, index) => (
                      <div key={name} className="space-y-1">
                        <Label htmlFor={`prompt-variable-${index}`} className="text-xs font-mono break-all">
                          {variableToken(name)}
                        </Label>
                        <Input
                          id={`prompt-variable-${index}`}
                          placeholder={`Valor de ${name}`}
                          value={variableValues.get(name) ?? ''}
                          onChange={(e) => handleVariableValueChange(name, e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault()
                              handleApplyVariables()
                            }
                          }}
                        />
                      </div>
                    ))}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    onClick={handleApplyVariables}
                    disabled={!hasVariableValues}
                  >
                    Aplicar valores
                  </Button>
                </section>
              )}

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="description">Descrição (opcional)</Label>
                <Textarea
                  id="description"
                  placeholder="Adicione uma descrição para este prompt..."
                  value={formData.description}
                  onChange={(e) => updateForm({ description: e.target.value })}
                  className="min-h-[80px] resize-none"
                />
              </div>
            </TabsContent>

            <TabsContent value="metadata" className="space-y-4">
              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor="category">Categoria</Label>
                <Select
                  value={effectiveCategoryId !== null ? effectiveCategoryId.toString() : 'none'}
                  onValueChange={(value) => updateForm({ category_id: value === 'none' ? null : Number(value) })}
                >
                  <SelectTrigger id="category">
                    <SelectValue placeholder="Selecione uma categoria..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Sem categoria</SelectItem>
                    {categories.map((category) => (
                      <SelectItem key={category.id} value={category.id.toString()}>
                        <div className="flex items-center space-x-2">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                          <span>{category.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Tags */}
              <div className="space-y-2">
                <Label htmlFor="new-tag">Tags</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    id="new-tag"
                    placeholder="Adicione uma tag..."
                    value={newTag}
                    aria-describedby="tag-hint"
                    onChange={(e) => {
                      setNewTag(e.target.value)
                      setTagMessage(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddTag()
                      }
                    }}
                  />
                  <Button onClick={handleAddTag} size="sm" aria-label="Adicionar tag" title="Adicionar tag">
                    <Tag className="h-4 w-4" />
                  </Button>
                </div>
                <p id="tag-hint" className={cn('text-xs', tagMessage ? 'text-amber-600 dark:text-amber-500' : 'text-muted-foreground')} aria-live="polite">
                  {tagMessage ?? 'Pressione Enter para adicionar. Uma tag digitada e não adicionada também é salva.'}
                </p>
                {formData.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {formData.tags.map((tag, index) => (
                      <Badge
                        key={`${index}-${tag}`}
                        variant="secondary"
                        className="max-w-full gap-1 pr-1"
                      >
                        <span className="min-w-0 truncate">{tag}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveTag(tag)}
                          className="rounded-sm p-0.5 hover:bg-muted-foreground/20 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                          aria-label={`Remover a tag ${tag}`}
                          title="Remover tag"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* Favorite Toggle */}
              <div className="flex items-center space-x-2">
                <Switch
                  id="favorite"
                  checked={formData.is_favorite}
                  onCheckedChange={(checked) => updateForm({ is_favorite: checked })}
                />
                <Label htmlFor="favorite" className="flex items-center space-x-2 cursor-pointer">
                  <Heart className={cn(
                    "h-4 w-4",
                    formData.is_favorite && "fill-current text-red-500"
                  )} />
                  <span>Marcar como favorito</span>
                </Label>
              </div>
            </TabsContent>

            {selectedPrompt && (
              <TabsContent value="history" className="space-y-4">
                <PromptVersionHistory
                  key={selectedPrompt.id}
                  prompt={selectedPrompt}
                  versions={versions}
                  error={versionsError}
                  currentContent={formData.content}
                  onRestore={handleRestoreVersion}
                />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}
