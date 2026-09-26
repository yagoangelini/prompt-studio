import { useState, useEffect, useMemo, useRef } from 'react'
import { X, Save, Plus, Sparkles, AlertCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge, badgeVariants } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Label } from '@/components/ui/label'
import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import { cn } from '@/lib/utils'
import { useEditorDirtySync } from '../prompts/use-editor-dirty-sync'
import {
  extractVariables,
  insertText,
  parseVariableName,
  variableToken,
  type TextSelection
} from './template-variables'
import type { CreateTemplateData, Template, UpdateTemplateData } from '@/types'

interface TemplateEditorProps {
  compact?: boolean
  onClose?: () => void
}

type EditorTab = 'content' | 'variables' | 'metadata'

interface TemplateFormState {
  name: string
  description: string
  content: string
  category_id: number | null
}

// Clearing the description must reach the database as NULL
type TemplateUpdatePayload = Omit<UpdateTemplateData, 'description'> & { description: string | null }

const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: '',
  description: '',
  content: '',
  category_id: null
}

const formFromTemplate = (template: Template): TemplateFormState => ({
  name: template.name,
  description: template.description || '',
  content: template.content,
  category_id: template.category_id
})

const sameTemplateForm = (a: TemplateFormState, b: TemplateFormState) =>
  a.name === b.name && a.description === b.description && a.content === b.content && a.category_id === b.category_id

const nameKey = (name: string) => name.normalize('NFC').trim().toLocaleLowerCase('pt-BR')

export function TemplateEditor({ compact = false, onClose }: TemplateEditorProps) {
  const {
    selectedTemplate,
    categories,
    templates,
    createTemplate,
    updateTemplate,
    closeTemplateEditor,
    addToast,
    setEditorDirty
  } = usePromptStore()

  const [formData, setFormData] = useState<TemplateFormState>(() =>
    selectedTemplate ? formFromTemplate(selectedTemplate) : EMPTY_TEMPLATE_FORM
  )
  const [baseline, setBaseline] = useState<TemplateFormState>(() =>
    selectedTemplate ? formFromTemplate(selectedTemplate) : EMPTY_TEMPLATE_FORM
  )
  const [activeTab, setActiveTab] = useState<EditorTab>('content')
  const [newVariable, setNewVariable] = useState('')
  const [variableMessage, setVariableMessage] = useState<{ tone: 'error' | 'warning' | 'success'; text: string } | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const formRef = useRef(formData)
  formRef.current = formData
  const savingRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Last cursor position in the content; survives the Content tab being unmounted
  const selectionRef = useRef<TextSelection | null>(null)

  const templateId = selectedTemplate?.id ?? null

  const loadForm = (next: TemplateFormState) => {
    formRef.current = next
    setFormData(next)
    setBaseline(next)
    selectionRef.current = null
    setNewVariable('')
    setVariableMessage(null)
  }

  // Re-initialize only when another template (or a new one) is opened
  useEffect(() => {
    loadForm(selectedTemplate ? formFromTemplate(selectedTemplate) : EMPTY_TEMPLATE_FORM)
    setActiveTab('content')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templateId])

  const isDirty = !sameTemplateForm(formData, baseline)

  // The user confirmed "Descartar" elsewhere (e.g. "Novo template") and this editor stayed open
  useEditorDirtySync(isDirty, () => {
    loadForm(selectedTemplate ? formFromTemplate(selectedTemplate) : EMPTY_TEMPLATE_FORM)
  })

  const updateForm = (patch: Partial<TemplateFormState>) => {
    const next = { ...formRef.current, ...patch }
    formRef.current = next
    setFormData(next)
  }

  const rememberSelection = (element: HTMLTextAreaElement) => {
    selectionRef.current = { start: element.selectionStart, end: element.selectionEnd }
  }

  const contentVariables = useMemo(() => extractVariables(formData.content), [formData.content])

  const trimmedName = formData.name.trim()
  const duplicateTemplate = trimmedName
    ? templates.find((t) => t.id !== templateId && nameKey(t.name) === nameKey(trimmedName))
    : undefined

  // A category deleted while the editor is open is treated as "none"
  const effectiveCategoryId =
    formData.category_id !== null && categories.some((c) => c.id === formData.category_id) ? formData.category_id : null

  const missingFields = [
    trimmedName ? null : 'Nome',
    formData.content.trim() ? null : 'Conteúdo'
  ].filter((field): field is string => field !== null)
  const saveBlockedReason = missingFields.length > 0
    ? `Preencha ${missingFields.length > 1 ? 'os campos obrigatórios' : 'o campo obrigatório'}: ${missingFields.join(' e ')}.`
    : duplicateTemplate
      ? `Já existe um template chamado "${duplicateTemplate.name}".`
      : null

  const closeEditor = () => {
    setEditorDirty(false)
    closeTemplateEditor()
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

  const handleSave = async () => {
    if (savingRef.current) return
    if (saveBlockedReason) {
      addToast({ type: 'error', title: 'Não foi possível salvar', description: saveBlockedReason })
      return
    }

    savingRef.current = true
    setIsSaving(true)
    try {
      // The template's variables are exactly the ones used in its content
      const variables = extractVariables(formData.content)
      const description = formData.description.trim() ? formData.description.trim() : null
      let saved: boolean
      if (selectedTemplate) {
        const updateData: TemplateUpdatePayload = {
          name: trimmedName,
          description,
          content: formData.content,
          variables,
          category_id: effectiveCategoryId
        }
        saved = await updateTemplate(selectedTemplate.id, updateData as UpdateTemplateData)
      } else {
        const createData: CreateTemplateData = {
          name: trimmedName,
          description: description ?? undefined,
          content: formData.content,
          variables,
          category_id: effectiveCategoryId
        }
        saved = await createTemplate(createData)
      }
      // On failure the store already showed the error; the editor stays open with everything typed
      if (saved) {
        closeEditor()
      }
    } catch (error) {
      console.error('Failed to save template:', error)
    } finally {
      savingRef.current = false
      setIsSaving(false)
    }
  }

  // Inserts {{name}} at the last cursor position of the content (or at the end), even when the
  // Content tab is not mounted
  const insertVariable = (name: string) => {
    const { content, caret } = insertText(formRef.current.content, variableToken(name), selectionRef.current)
    selectionRef.current = { start: caret, end: caret }
    updateForm({ content })
    const textarea = textareaRef.current
    if (textarea) {
      requestAnimationFrame(() => {
        textarea.focus()
        textarea.setSelectionRange(caret, caret)
      })
    }
  }

  const handleAddVariable = () => {
    const parsed = parseVariableName(newVariable)
    if (!parsed.ok) {
      setVariableMessage({ tone: 'error', text: parsed.error })
      return
    }
    if (contentVariables.includes(parsed.name)) {
      setVariableMessage({ tone: 'warning', text: `A variável ${variableToken(parsed.name)} já existe no conteúdo.` })
      return
    }
    insertVariable(parsed.name)
    setNewVariable('')
    setVariableMessage({ tone: 'success', text: `Variável ${variableToken(parsed.name)} inserida no conteúdo.` })
  }

  const handleInsertExisting = (name: string) => {
    insertVariable(name)
    setVariableMessage({ tone: 'success', text: `Variável ${variableToken(name)} inserida no conteúdo.` })
  }

  return (
    <div className={cn(
      "h-full bg-background flex flex-col min-w-0",
      compact ? "border-l" : "border"
    )}>
      {/* Header */}
      <div className="border-b">
        <div className="flex flex-wrap items-center justify-between gap-2 p-4">
          <h2 className="text-lg font-semibold min-w-0 truncate">
            {selectedTemplate ? 'Editar template' : 'Novo template'}
          </h2>
          <div className="flex items-center gap-2 ml-auto flex-shrink-0">
            <Button
              onClick={handleSave}
              disabled={Boolean(saveBlockedReason) || isSaving}
              size="sm"
              title={saveBlockedReason ?? undefined}
              aria-describedby={saveBlockedReason ? 'template-save-hint' : undefined}
            >
              <Save className="h-4 w-4 mr-2" />
              {isSaving ? 'Salvando...' : 'Salvar'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClose}
              aria-label="Fechar editor"
              title="Fechar"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {saveBlockedReason && (
          <p id="template-save-hint" className="flex items-start gap-1.5 px-4 pb-3 -mt-1 text-xs text-muted-foreground">
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
              <TabsTrigger value="variables">Variáveis</TabsTrigger>
              <TabsTrigger value="metadata">Metadados</TabsTrigger>
            </TabsList>

            <TabsContent value="content" className="space-y-4">
              <p className="text-xs text-muted-foreground">
                <span className="text-destructive" aria-hidden="true">*</span> Campo obrigatório
              </p>

              {/* Name */}
              <div className="space-y-2">
                <Label htmlFor="template-name">
                  Nome <span className="text-destructive" aria-hidden="true">*</span>
                </Label>
                <Input
                  id="template-name"
                  placeholder="Digite o nome do template..."
                  value={formData.name}
                  aria-required="true"
                  aria-invalid={Boolean(duplicateTemplate)}
                  aria-describedby={duplicateTemplate ? 'template-name-error' : undefined}
                  onChange={(e) => updateForm({ name: e.target.value })}
                />
                {duplicateTemplate && (
                  <p id="template-name-error" className="text-xs text-destructive">
                    Já existe um template chamado "{duplicateTemplate.name}". Escolha outro nome.
                  </p>
                )}
              </div>

              {/* Description */}
              <div className="space-y-2">
                <Label htmlFor="template-description">Descrição (opcional)</Label>
                <Input
                  id="template-description"
                  placeholder="Adicione uma descrição para este template..."
                  value={formData.description}
                  onChange={(e) => updateForm({ description: e.target.value })}
                />
              </div>

              {/* Content */}
              <div className="space-y-2">
                <Label htmlFor="template-content">
                  Conteúdo <span className="text-destructive" aria-hidden="true">*</span>
                </Label>
                <Textarea
                  ref={textareaRef}
                  id="template-content"
                  placeholder="Digite o conteúdo do template... Use {{nomeDaVariavel}} para variáveis."
                  value={formData.content}
                  aria-required="true"
                  onChange={(e) => {
                    updateForm({ content: e.target.value })
                    rememberSelection(e.currentTarget)
                  }}
                  onSelect={(e) => rememberSelection(e.currentTarget)}
                  onBlur={(e) => rememberSelection(e.currentTarget)}
                  className="min-h-[300px] resize-y font-mono"
                />
                <div className="text-xs text-muted-foreground break-words">
                  {formData.content.length} {formData.content.length === 1 ? 'caractere' : 'caracteres'} • Use a sintaxe {`{{nomeDaVariavel}}`} para variáveis
                </div>
              </div>
            </TabsContent>

            <TabsContent value="variables" className="space-y-4">
              {/* Add Variable */}
              <div className="space-y-2">
                <Label htmlFor="new-variable">Adicionar variável</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    id="new-variable"
                    placeholder="Nome da variável..."
                    value={newVariable}
                    aria-describedby="new-variable-hint"
                    aria-invalid={variableMessage?.tone === 'error'}
                    onChange={(e) => {
                      setNewVariable(e.target.value)
                      setVariableMessage(null)
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        handleAddVariable()
                      }
                    }}
                  />
                  <Button onClick={handleAddVariable} size="sm" aria-label="Adicionar variável" title="Adicionar variável">
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
                <p
                  id="new-variable-hint"
                  aria-live="polite"
                  className={cn(
                    'text-xs break-words',
                    variableMessage?.tone === 'error'
                      ? 'text-destructive'
                      : variableMessage?.tone === 'warning'
                        ? 'text-amber-600 dark:text-amber-500'
                        : 'text-muted-foreground'
                  )}
                >
                  {variableMessage?.text ?? 'A variável é inserida no conteúdo, na posição do cursor (ou no fim do texto).'}
                </p>
              </div>

              {/* Variables used in the content */}
              <div className="space-y-2">
                <p className="text-sm font-medium leading-none">Variáveis do template</p>
                {contentVariables.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma variável no conteúdo ainda.</p>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Clique para inserir no conteúdo:
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {contentVariables.map((variable) => (
                        <button
                          key={variable}
                          type="button"
                          onClick={() => handleInsertExisting(variable)}
                          className={cn(badgeVariants({ variant: 'secondary' }), 'cursor-pointer text-sm max-w-full')}
                          aria-label={`Inserir ${variableToken(variable)} no conteúdo`}
                        >
                          <Sparkles className="h-3 w-3 mr-1 flex-shrink-0" />
                          <span className="min-w-0 truncate">{variable}</span>
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* Variables Help */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Como as variáveis funcionam</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground space-y-2">
                  <p>As variáveis permitem criar templates reutilizáveis com campos a preencher.</p>
                  <p>
                    Use a sintaxe <code className="bg-muted px-1 rounded">{`{{nomeDaVariavel}}`}</code> no conteúdo. O nome aceita letras (inclusive acentuadas), números e _.
                  </p>
                  <p>Ao usar o template em um prompt, preencha os valores na seção "Preencher variáveis" do editor de prompt.</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="metadata" className="space-y-4">
              {/* Category */}
              <div className="space-y-2">
                <Label htmlFor="template-category">Categoria</Label>
                <Select
                  value={effectiveCategoryId !== null ? effectiveCategoryId.toString() : 'none'}
                  onValueChange={(value) => updateForm({ category_id: value === 'none' ? null : Number(value) })}
                >
                  <SelectTrigger id="template-category">
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

              {/* Template Preview */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm flex items-center">
                    <Sparkles className="h-4 w-4 mr-2" />
                    Pré-visualização do template
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-muted p-3 rounded-md">
                    <div className="text-xs text-muted-foreground mb-2">Conteúdo:</div>
                    <div className="text-sm font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                      {formData.content || 'Ainda sem conteúdo...'}
                    </div>
                  </div>
                  {contentVariables.length > 0 && (
                    <div className="mt-3">
                      <div className="text-xs text-muted-foreground mb-2">Variáveis:</div>
                      <div className="flex flex-wrap gap-1">
                        {contentVariables.map((variable) => (
                          <Badge key={variable} variant="outline" className="text-xs max-w-full break-all">
                            {variableToken(variable)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}
