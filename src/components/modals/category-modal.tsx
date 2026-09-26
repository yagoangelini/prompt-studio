import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { CategoryForm } from '../forms/category-form'
import type { Category } from '@/types'

interface CategoryModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category?: Category
  // Parent preselected when creating a subcategory
  defaultParentId?: number | null
}

export function CategoryModal({ open, onOpenChange, category, defaultParentId = null }: CategoryModalProps) {
  const handleSuccess = () => {
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  const creatingSubcategory = !category && defaultParentId !== null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {category ? 'Editar categoria' : creatingSubcategory ? 'Criar subcategoria' : 'Criar categoria'}
          </DialogTitle>
          <DialogDescription>
            {category
              ? 'Atualize os detalhes da categoria abaixo.'
              : 'Crie uma nova categoria para organizar seus prompts.'}
          </DialogDescription>
        </DialogHeader>
        <CategoryForm
          category={category}
          defaultParentId={defaultParentId}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  )
}
