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
}

export function CategoryModal({ open, onOpenChange, category }: CategoryModalProps) {
  const handleSuccess = () => {
    onOpenChange(false)
  }

  const handleCancel = () => {
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>
            {category ? 'Editar categoria' : 'Criar categoria'}
          </DialogTitle>
          <DialogDescription>
            {category
              ? 'Atualize os detalhes da categoria abaixo.'
              : 'Crie uma nova categoria para organizar seus prompts.'}
          </DialogDescription>
        </DialogHeader>
        <CategoryForm 
          category={category}
          onSuccess={handleSuccess}
          onCancel={handleCancel}
        />
      </DialogContent>
    </Dialog>
  )
}