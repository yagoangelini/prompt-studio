import { useMemo, useRef, useState } from 'react'
import { create } from 'zustand'
import { Braces } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { isMacPlatform } from '@/hooks/use-keyboard-shortcuts'
import {
  extractVariables,
  splitVariableSegments,
  substituteVariables,
  variableToken
} from '../templates/template-variables'

export interface FillVariablesRequest {
  // Remembered values belong to a prompt (null for a prompt that is not saved yet)
  readonly promptId: number | null
  readonly title: string
  readonly content: string
  // Text of the confirm button (default "Copiar"), e.g. "Colar" in the quick paste window
  readonly confirmLabel?: string
}

interface ActiveRequest extends FillVariablesRequest {
  readonly id: number
  readonly variables: readonly string[]
  readonly resolve: (text: string | null) => void
}

const useFillVariablesStore = create<{ request: ActiveRequest | null }>(() => ({ request: null }))

let nextRequestId = 1

// Last values used in this window, by prompt and variable, so the next use of the same prompt starts
// with them. Memory only (never persisted): values may contain private text.
const rememberedValues = new Map<string, string>()
const memoryKey = (promptId: number | null, name: string) => `${promptId ?? 'novo'}\u0000${name}`

export function getRememberedValue(promptId: number | null, name: string): string {
  return rememberedValues.get(memoryKey(promptId, name)) ?? ''
}

export function clearRememberedValues() {
  rememberedValues.clear()
}

function rememberValues(request: ActiveRequest, values: readonly string[]) {
  request.variables.forEach((name, index) => {
    const value = values[index] ?? ''
    const key = memoryKey(request.promptId, name)
    if (value) rememberedValues.set(key, value)
    else rememberedValues.delete(key)
  })
}

/**
 * Asks for the values of the {{variables}} of a text and resolves with the text filled in, or null
 * when the user cancels. A text without variables resolves at once with the text itself.
 * Variables left empty stay in the text as {{name}}.
 */
export function fillVariables(request: FillVariablesRequest): Promise<string | null> {
  const variables = extractVariables(request.content)
  if (variables.length === 0) return Promise.resolve(request.content)
  return new Promise((resolve) => {
    // A pending request (e.g. two copies started at once) is answered as "canceled" before being replaced
    useFillVariablesStore.getState().request?.resolve(null)
    useFillVariablesStore.setState({ request: { ...request, id: nextRequestId++, variables, resolve } })
  })
}

const settle = (request: ActiveRequest, text: string | null) => {
  if (useFillVariablesStore.getState().request?.id !== request.id) return
  useFillVariablesStore.setState({ request: null })
  request.resolve(text)
}

// Long prompts: the preview shows the beginning only (the copied text is always complete)
const PREVIEW_LIMIT = 4000
const FIELD_MAX_HEIGHT = 160

const fieldClassName =
  'block w-full resize-none overflow-y-auto rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'

// One-line fields that grow with multi-line values (Shift+Enter or pasted text), up to a limit
const fitHeight = (field: HTMLTextAreaElement | null) => {
  if (!field) return
  field.style.height = 'auto'
  if (field.scrollHeight > 0) field.style.height = `${Math.min(field.scrollHeight + 2, FIELD_MAX_HEIGHT)}px`
}

function FillVariablesDialog({ request }: { request: ActiveRequest }) {
  const [values, setValues] = useState<string[]>(() =>
    request.variables.map((name) => getRememberedValue(request.promptId, name))
  )
  const fieldRefs = useRef<(HTMLTextAreaElement | null)[]>([])
  const valuesRef = useRef(values)
  valuesRef.current = values

  const confirmLabel = request.confirmLabel ?? 'Copiar'
  const mod = isMacPlatform() ? '⌘' : 'Ctrl'
  const idPrefix = `fill-variables-${request.id}`

  const valueMap = useMemo(
    () => new Map(request.variables.map((name, index) => [name, values[index] ?? ''])),
    [request.variables, values]
  )
  const missing = request.variables.filter((_, index) => !(values[index] ?? ''))

  const truncated = request.content.length > PREVIEW_LIMIT
  const previewSegments = useMemo(
    () => splitVariableSegments(truncated ? request.content.slice(0, PREVIEW_LIMIT) : request.content),
    [request.content, truncated]
  )

  // The fields mount after the dialog (Radix portal): a remembered multi-line value gets its height
  // when its field is attached
  const attachField = (index: number, element: HTMLTextAreaElement | null) => {
    if (element && fieldRefs.current[index] !== element) fitHeight(element)
    fieldRefs.current[index] = element
  }

  const focusField = (index: number) => {
    const field = fieldRefs.current[index]
    if (!field) return
    field.focus()
    // A remembered value is selected, so typing replaces it and Enter keeps it
    field.select()
  }

  const confirm = () => {
    rememberValues(request, valuesRef.current)
    settle(request, substituteVariables(request.content, valueMap))
  }

  // Typed values are kept even when canceling (an Esc pressed by mistake loses nothing)
  const cancel = () => {
    rememberValues(request, valuesRef.current)
    settle(request, null)
  }

  const handleFieldKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, index: number) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    // Shift+Enter writes a new line; Ctrl+Enter is handled by the dialog
    if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    if (index < request.variables.length - 1) focusField(index + 1)
    else confirm()
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) cancel() }}>
      <DialogContent
        className="flex max-h-[calc(100vh-1rem)] w-[calc(100vw-1rem)] max-w-lg flex-col gap-3 p-4 sm:p-5"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          focusField(0)
        }}
        onEscapeKeyDown={(event) => {
          // The Esc that cancels this dialog must not also close the window or panel behind it
          event.stopPropagation()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
            event.preventDefault()
            confirm()
          }
        }}
      >
        <DialogHeader className="space-y-1 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Braces className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            Preencher variáveis
          </DialogTitle>
          <DialogDescription className="truncate" title={request.title}>
            {request.title.trim() || 'Prompt sem título'}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1">
          {request.variables.map((name, index) => (
            <div key={name} className="space-y-1">
              <label htmlFor={`${idPrefix}-${index}`} className="block break-all font-mono text-xs font-medium">
                {variableToken(name)}
              </label>
              <textarea
                id={`${idPrefix}-${index}`}
                ref={(element) => attachField(index, element)}
                rows={1}
                value={values[index] ?? ''}
                placeholder={`Valor de ${name}`}
                aria-describedby={`${idPrefix}-hint`}
                className={fieldClassName}
                style={{ maxHeight: FIELD_MAX_HEIGHT }}
                onChange={(event) => {
                  const value = event.target.value
                  fitHeight(event.currentTarget)
                  setValues((previous) => previous.map((current, i) => (i === index ? value : current)))
                }}
                onKeyDown={(event) => handleFieldKeyDown(event, index)}
              />
            </div>
          ))}

          <div className="space-y-1">
            <p id={`${idPrefix}-preview-label`} className="text-xs font-medium text-muted-foreground">
              Pré-visualização
            </p>
            <div
              role="region"
              aria-labelledby={`${idPrefix}-preview-label`}
              tabIndex={0}
              className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-2 font-mono text-xs leading-relaxed [overflow-wrap:anywhere] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {previewSegments.map((segment, index) => {
                if (segment.kind !== 'variable') return segment.text
                const value = valueMap.get(segment.name)
                return value ? (
                  <span key={index} className="rounded-sm bg-primary/15">{value}</span>
                ) : (
                  <span key={index} className="rounded-sm bg-amber-500/25">{segment.text}</span>
                )
              })}
              {truncated && <span className="text-muted-foreground"> […]</span>}
            </div>
            {truncated && (
              <p className="text-[11px] text-muted-foreground">
                Mostrando o início do texto ({PREVIEW_LIMIT.toLocaleString('pt-BR')} de{' '}
                {request.content.length.toLocaleString('pt-BR')} caracteres). O texto completo será usado.
              </p>
            )}
          </div>

          <p className="text-[11px] text-muted-foreground" aria-live="polite">
            {missing.length === 0
              ? 'Todas as variáveis estão preenchidas.'
              : missing.length === 1
                ? `A variável ${variableToken(missing[0] ?? '')} está sem valor e continuará assim no texto.`
                : `${missing.length} variáveis estão sem valor e continuarão como {{nome}} no texto.`}
          </p>
        </div>

        <p id={`${idPrefix}-hint`} className="text-[11px] text-muted-foreground">
          Enter: próximo campo · Shift+Enter: nova linha · {mod}+Enter: {confirmLabel.toLocaleLowerCase('pt-BR')} · Esc: cancelar
        </p>

        <DialogFooter className="flex-row justify-end gap-2 space-x-0 sm:space-x-0">
          <Button type="button" variant="outline" onClick={cancel}>
            Cancelar
          </Button>
          <Button type="button" onClick={confirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Mounted once at the root of every window (desktop, menu bar and quick paste)
export function FillVariablesDialogHost() {
  const request = useFillVariablesStore((state) => state.request)
  return request ? <FillVariablesDialog key={request.id} request={request} /> : null
}
