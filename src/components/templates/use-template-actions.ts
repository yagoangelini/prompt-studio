import { confirmAction } from '@/components/ui/confirm-dialog'
import { usePromptStore } from '@/stores/usePromptStore'
import type { Template } from '@/types'

// Actions shared by the grid and list views of the Templates tab
export function useTemplateActions() {
  const {
    deleteTemplate,
    openTemplateEditor,
    closeTemplateEditor,
    openPromptEditor,
    saveDraftFormData,
    setActiveMainTab,
    setEditorDirty
  } = usePromptStore()

  const editTemplate = (template: Template) => {
    openTemplateEditor(template)
  }

  // Opens a new prompt pre-filled with the template (the new prompt editor starts from the saved draft)
  const startPromptFromTemplate = async (template: Template) => {
    if (usePromptStore.getState().isEditorDirty) {
      const confirmed = await confirmAction({
        title: 'Descartar alterações?',
        description: 'Você tem alterações não salvas. Deseja descartá-las?',
        confirmLabel: 'Descartar',
        destructive: true
      })
      if (!confirmed) return
    }
    saveDraftFormData({
      title: template.name,
      content: template.content,
      template_id: template.id,
      category_id: template.category_id
    })
    // Already confirmed above: the store guard must not ask again
    setEditorDirty(false)
    setActiveMainTab('prompts')
    await openPromptEditor()
  }

  const removeTemplate = async (template: Template) => {
    const confirmed = await confirmAction({
      title: 'Excluir template?',
      description: `Tem certeza de que deseja excluir "${template.name}"? Os prompts criados a partir dele não são alterados. Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      destructive: true
    })
    if (!confirmed) return
    const { isTemplateEditorOpen, selectedTemplate } = usePromptStore.getState()
    const isBeingEdited = isTemplateEditorOpen && selectedTemplate?.id === template.id
    // The store shows the success or error toast itself
    const deleted = await deleteTemplate(template.id)
    if (deleted && isBeingEdited) {
      // Its editor could only fail to save from now on
      setEditorDirty(false)
      closeTemplateEditor()
    }
  }

  return { editTemplate, startPromptFromTemplate, removeTemplate }
}
