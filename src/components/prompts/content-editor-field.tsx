import { useMemo, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { findInvalidVariableTokens } from '../templates/template-variables'
import { MarkdownPreview } from './markdown-preview'
import { CHARS_PER_TOKEN, formatTextStats } from './prompt-editor-utils'
import { HIGHLIGHT_MAX_LENGTH, VariableTextarea, canHighlightVariables } from './variable-textarea'

type ContentMode = 'edit' | 'preview'

interface ContentEditorFieldProps {
  id: string
  label: React.ReactNode
  value: string
  onChange: (value: string, element: HTMLTextAreaElement) => void
  placeholder?: string
  required?: boolean
  monospace?: boolean
  textareaRef?: React.Ref<HTMLTextAreaElement>
  onSelect?: React.ReactEventHandler<HTMLTextAreaElement>
  onBlur?: React.FocusEventHandler<HTMLTextAreaElement>
  // Extra text after the counters (e.g. the variable syntax)
  hint?: React.ReactNode
  // Shown above the text, before the Editar / Pré-visualizar switch
  toolbar?: React.ReactNode
}

const MAX_LISTED_TOKENS = 3

// "{{a-b}}", "{{a-b}} e {{c.d}}", "{{a}}, {{b}}, {{c}} e mais 2"
export function describeInvalidTokens(tokens: readonly string[]): string {
  const listed = tokens.slice(0, MAX_LISTED_TOKENS)
  const rest = tokens.length - listed.length
  const names = rest > 0
    ? `${listed.join(', ')} e mais ${rest}`
    : listed.length > 1
      ? `${listed.slice(0, -1).join(', ')} e ${listed[listed.length - 1]}`
      : listed[0] ?? ''
  const verb = tokens.length === 1 ? 'não é uma variável' : 'não são variáveis'
  return `${names} ${verb}: o nome de uma variável usa apenas letras, números e _ (sem espaços, hífens ou pontos). Esse texto não será preenchido e ficará como está.`
}

const modeButtonClass = (active: boolean) =>
  cn(
    'rounded px-2 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active ? 'bg-secondary text-secondary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
  )

// Content field shared by the prompt and template editors: {{variables}} highlighted in the text,
// Editar / Pré-visualizar (Markdown), character and token counters, and a warning about {{...}}
// tokens that are not valid variables
export function ContentEditorField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  monospace,
  textareaRef,
  onSelect,
  onBlur,
  hint,
  toolbar
}: ContentEditorFieldProps) {
  const [mode, setMode] = useState<ContentMode>('edit')
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  const stats = formatTextStats(value)
  const invalidTokens = useMemo(() => findInvalidVariableTokens(value), [value])
  const highlightOff = value.includes('{{') && !canHighlightVariables(value)
  const invalidId = `${id}-invalid-variables`

  const setRefs = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node
    if (typeof textareaRef === 'function') textareaRef(node)
    else if (textareaRef) (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node
  }

  const switchTo = (next: ContentMode) => {
    setMode(next)
    // Back to editing: the cursor returns to the text (the textarea kept its selection and undo history)
    if (next === 'edit') requestAnimationFrame(() => innerRef.current?.focus())
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          {toolbar}
          <div role="group" aria-label="Modo do conteúdo" className="inline-flex rounded-md border p-0.5">
            <button type="button" aria-pressed={mode === 'edit'} className={modeButtonClass(mode === 'edit')} onClick={() => switchTo('edit')}>
              Editar
            </button>
            <button type="button" aria-pressed={mode === 'preview'} className={modeButtonClass(mode === 'preview')} onClick={() => switchTo('preview')}>
              Pré-visualizar
            </button>
          </div>
        </div>
      </div>

      {/* Hidden, not unmounted, while previewing: the textarea keeps its undo history and selection */}
      <div hidden={mode !== 'edit'}>
        <VariableTextarea
          ref={setRefs}
          id={id}
          value={value}
          placeholder={placeholder}
          aria-required={required ? 'true' : undefined}
          aria-describedby={invalidTokens.length > 0 ? invalidId : undefined}
          onChange={(event) => onChange(event.target.value, event.currentTarget)}
          onSelect={onSelect}
          onBlur={onBlur}
          className={cn(monospace && 'font-mono')}
          textareaClassName="min-h-[300px] resize-y"
        />
      </div>

      {mode === 'preview' && (
        <div
          role="region"
          aria-label="Pré-visualização do conteúdo"
          tabIndex={0}
          className="min-h-[300px] max-h-[70vh] overflow-auto rounded-md border bg-background px-4 py-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {value.trim() ? (
            <MarkdownPreview content={value} />
          ) : (
            <p className="text-sm text-muted-foreground">Nada para pré-visualizar ainda.</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground break-words">
        <span>{stats.characters}</span>
        <span aria-hidden="true">•</span>
        <span title={`Estimativa de cerca de ${CHARS_PER_TOKEN} caracteres por token. O número real depende do modelo.`}>
          {stats.tokens}
        </span>
        {hint && (
          <>
            <span aria-hidden="true">•</span>
            <span>{hint}</span>
          </>
        )}
      </div>

      {invalidTokens.length > 0 && (
        <p id={invalidId} className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-500 break-words [overflow-wrap:anywhere]" aria-live="polite">
          <AlertTriangle className="mt-px h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          <span>{describeInvalidTokens(invalidTokens)}</span>
        </p>
      )}

      {highlightOff && (
        <p className="text-xs text-muted-foreground">
          Destaque das variáveis desativado: o texto passa de {HIGHLIGHT_MAX_LENGTH.toLocaleString('pt-BR')} caracteres.
        </p>
      )}
    </div>
  )
}
