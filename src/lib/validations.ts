import { z } from 'zod'

// Prompt validation schemas
export const createPromptSchema = z.object({
  title: z.string().min(1, 'O título é obrigatório').max(200, 'O título deve ter no máximo 200 caracteres'),
  content: z.string().min(1, 'O conteúdo é obrigatório'),
  description: z.string().max(500, 'A descrição deve ter no máximo 500 caracteres').optional(),
  category_id: z.number().optional(),
  template_id: z.number().optional(),
  tags: z.array(z.string()).default([]),
  is_favorite: z.boolean().default(false),
})

export const updatePromptSchema = createPromptSchema.partial().extend({
  title: z.string().min(1, 'O título é obrigatório').max(200, 'O título deve ter no máximo 200 caracteres').optional(),
  content: z.string().min(1, 'O conteúdo é obrigatório').optional(),
})

// Category validation schemas (the name is trimmed, so a name made only of spaces is rejected)
export const createCategorySchema = z.object({
  name: z.string().trim().min(1, 'O nome é obrigatório').max(100, 'O nome deve ter no máximo 100 caracteres'),
  description: z.string().max(300, 'A descrição deve ter no máximo 300 caracteres').optional(),
  color: z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'Formato de cor inválido').default('#007acc'),
})

export const updateCategorySchema = createCategorySchema.partial().extend({
  name: z.string().trim().min(1, 'O nome é obrigatório').max(100, 'O nome deve ter no máximo 100 caracteres').optional(),
})

// Template validation schemas
export const createTemplateSchema = z.object({
  name: z.string().min(1, 'O nome é obrigatório').max(100, 'O nome deve ter no máximo 100 caracteres'),
  description: z.string().max(300, 'A descrição deve ter no máximo 300 caracteres').optional(),
  content: z.string().min(1, 'O conteúdo é obrigatório'),
  variables: z.array(z.string()).default([]),
  category_id: z.number().optional(),
})

export const updateTemplateSchema = createTemplateSchema.partial().extend({
  name: z.string().min(1, 'O nome é obrigatório').max(100, 'O nome deve ter no máximo 100 caracteres').optional(),
  content: z.string().min(1, 'O conteúdo é obrigatório').optional(),
})

// API test validation schema
export const apiTestSchema = z.object({
  prompt: z.string().min(1, 'O prompt é obrigatório'),
  config: z.object({
    apiEndpoint: z.string().url('URL do endpoint da API inválida'),
    apiKey: z.string().min(1, 'A chave de API é obrigatória'),
    model: z.string().min(1, 'O modelo é obrigatório'),
    temperature: z.number().min(0, 'A temperatura deve ser no mínimo 0').max(2, 'A temperatura deve ser no máximo 2'),
    maxTokens: z.number().min(1, 'O máximo de tokens deve ser no mínimo 1').max(4000, 'O máximo de tokens deve ser no máximo 4000'),
  }),
})

// Export types
export type CreatePromptFormData = z.infer<typeof createPromptSchema>
export type UpdatePromptFormData = z.infer<typeof updatePromptSchema>
export type CreateCategoryFormData = z.infer<typeof createCategorySchema>
export type UpdateCategoryFormData = z.infer<typeof updateCategorySchema>
export type CreateTemplateFormData = z.infer<typeof createTemplateSchema>
export type UpdateTemplateFormData = z.infer<typeof updateTemplateSchema>
export type ApiTestFormData = z.infer<typeof apiTestSchema>