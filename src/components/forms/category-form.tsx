import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Save, Loader2, Palette } from 'lucide-react'
import { usePromptStore } from '@/stores/usePromptStore'
import { normalizeSearchText } from '@/lib/search-parser'
import { createCategorySchema, updateCategorySchema, CreateCategoryFormData, UpdateCategoryFormData } from '@/lib/validations'
import { getParentOptions } from '@/components/organization/organization-utils'
import type { Category, CreateCategoryData, UpdateCategoryData } from '@/types'

interface CategoryFormProps {
  category?: Category
  // Parent preselected for a new category ("Nova subcategoria")
  defaultParentId?: number | null
  onSuccess?: () => void
  onCancel?: () => void
}

const NO_PARENT = 'none'

const COLOR_PRESETS = [
  '#007acc', '#ff6b6b', '#4ecdc4', '#45b7d1', '#96ceb4',
  '#feca57', '#ff9ff3', '#54a0ff', '#5f27cd', '#00d2d3',
  '#ff9f43', '#10ac84', '#ee5a24', '#0984e3', '#6c5ce7'
]

// Case and accents are ignored, like the backend check and the search
const categoryNameKey = (name: string) => normalizeSearchText(name)

export function CategoryForm({ category, defaultParentId = null, onSuccess, onCancel }: CategoryFormProps) {
  const { createCategory, updateCategory, categories } = usePromptStore()

  // Kept outside react-hook-form: the zod schemas (src/lib/validations.ts) only know name, description and color
  const [parentId, setParentId] = useState<number | null>(category ? category.parent_id ?? null : defaultParentId)
  const [isSequence, setIsSequence] = useState<boolean>(category?.is_sequence ?? false)
  // Never the category itself or one of its subcategories (that would create a cycle)
  const parentOptions = useMemo(() => getParentOptions(category, categories), [category, categories])
  const validParentId = parentId !== null && parentOptions.some((option) => option.category.id === parentId) ? parentId : null

  const isEditing = !!category
  const schema = isEditing ? updateCategorySchema : createCategorySchema
  
  const form = useForm<CreateCategoryFormData | UpdateCategoryFormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: category?.name || '',
      description: category?.description || '',
      color: category?.color || '#007acc',
    },
  })

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    setValue,
    setError,
    watch,
    reset,
  } = form

  const watchedColor = watch('color')

  const onSubmit = async (data: CreateCategoryFormData | UpdateCategoryFormData) => {
    const name = (data.name ?? '').trim()
    const duplicate = categories.find(
      (existing) => existing.id !== category?.id && categoryNameKey(existing.name) === categoryNameKey(name)
    )
    if (duplicate) {
      setError('name', { type: 'duplicate', message: `Já existe uma categoria chamada "${duplicate.name}".` }, { shouldFocus: true })
      return
    }

    try {
      const payload = { ...data, name, parent_id: validParentId, is_sequence: isSequence }
      const saved = isEditing && category
        ? await updateCategory(category.id, payload as UpdateCategoryData)
        : await createCategory(payload as CreateCategoryData)
      if (saved) {
        onSuccess?.()
        return
      }
      // The store already showed the error; a duplicate name reported by the database also goes to the field
      const message = usePromptStore.getState().error ?? ''
      const duplicateIndex = message.indexOf('Já existe uma categoria')
      if (duplicateIndex >= 0) {
        setError('name', { type: 'duplicate', message: message.slice(duplicateIndex) }, { shouldFocus: true })
      }
    } catch (error) {
      console.error('Failed to save category:', error)
    }
  }

  const handleCancel = () => {
    reset()
    onCancel?.()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Name */}
      <div className="space-y-2">
        <Label htmlFor="name">
          Nome <span className="text-destructive">*</span>
        </Label>
        <Input
          id="name"
          placeholder="Digite o nome da categoria..."
          aria-required="true"
          aria-invalid={Boolean(errors.name)}
          aria-describedby={errors.name ? 'category-name-error' : undefined}
          {...register('name')}
        />
        {errors.name && (
          <p id="category-name-error" className="text-sm text-destructive">{errors.name.message}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Descrição (opcional)</Label>
        <Textarea
          id="description"
          placeholder="Adicione uma descrição para esta categoria..."
          className="min-h-[80px]"
          {...register('description')}
        />
        {errors.description && (
          <p className="text-sm text-destructive">{errors.description.message}</p>
        )}
      </div>

      {/* Parent category (subcategories) */}
      <div className="space-y-2">
        <Label htmlFor="category-parent">Categoria pai</Label>
        <Select
          value={validParentId === null ? NO_PARENT : String(validParentId)}
          onValueChange={(value) => setParentId(value === NO_PARENT ? null : Number(value))}
        >
          <SelectTrigger id="category-parent" aria-describedby="category-parent-help">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            <SelectItem value={NO_PARENT}>Nenhuma (categoria principal)</SelectItem>
            {parentOptions.map(({ category: option, depth }) => (
              <SelectItem key={option.id} value={String(option.id)}>
                <span className="flex items-center gap-2" style={{ paddingLeft: `${depth * 0.875}rem` }}>
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} aria-hidden="true" />
                  <span className="truncate">{option.name}</span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p id="category-parent-help" className="text-xs text-muted-foreground">
          {isEditing
            ? 'Escolha outra categoria para transformar esta em subcategoria. As subcategorias dela não aparecem na lista.'
            : 'Escolha uma categoria para criar esta como subcategoria dela.'}
        </p>
      </div>

      {/* Sequence (ordered steps) */}
      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="space-y-1">
          <Label htmlFor="category-sequence">Esta categoria é uma sequência (passo a passo)</Label>
          <p id="category-sequence-help" className="text-xs text-muted-foreground">
            Os prompts dela viram passos numerados: você define a ordem arrastando e copia um passo de cada vez com "Copiar próximo passo".
          </p>
        </div>
        <Switch
          id="category-sequence"
          checked={isSequence}
          onCheckedChange={setIsSequence}
          aria-describedby="category-sequence-help"
        />
      </div>

      {/* Color */}
      <div className="space-y-4">
        <Label>Cor</Label>
        
        {/* Current Color Display */}
        <div className="flex items-center space-x-3">
          <div 
            className="w-8 h-8 rounded-full border-2 border-border"
            style={{ backgroundColor: watchedColor }}
          />
          <Input
            type="color"
            value={watchedColor}
            onChange={(e) => setValue('color', e.target.value)}
            className="w-20 h-8 border-0 p-0"
            aria-label="Selecionar cor"
          />
          {/* register() provides onChange, so the typed value goes straight to the form */}
          <Input
            type="text"
            value={watchedColor}
            placeholder="#007acc"
            className="flex-1"
            aria-label="Código da cor"
            {...register('color')}
          />
        </div>

        {errors.color && (
          <p className="text-sm text-destructive">{errors.color.message}</p>
        )}

        {/* Color Presets */}
        <div>
          <Label className="text-sm text-muted-foreground mb-2 block">
            <Palette className="h-4 w-4 inline mr-1" />
            Cores predefinidas
          </Label>
          <div className="grid grid-cols-8 gap-2">
            {COLOR_PRESETS.map((color) => (
              <button
                key={color}
                type="button"
                className="w-8 h-8 rounded-full border-2 border-border hover:scale-110 transition-transform focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                style={{ backgroundColor: color }}
                onClick={() => setValue('color', color)}
                title={color}
                aria-label={`Usar a cor ${color}`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-end space-x-3 pt-4 border-t">
        <Button
          type="button"
          variant="outline"
          onClick={handleCancel}
          disabled={isSubmitting}
        >
          Cancelar
        </Button>
        <Button
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          <Save className="h-4 w-4 mr-2" />
          {isEditing ? 'Atualizar' : 'Criar'} categoria
        </Button>
      </div>
    </form>
  )
}