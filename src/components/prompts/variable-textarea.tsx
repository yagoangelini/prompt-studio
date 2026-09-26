import { forwardRef, useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import { cn } from '@/lib/utils'
import { splitVariableSegments } from '../templates/template-variables'

// Above this size the highlight is turned off: laying out a second copy of a huge text on every
// keystroke would make typing slow (measured in Chromium with one variable per line: +7 ms per
// keystroke at 20k characters, +20 ms at 50k). The editor tells the user (see ContentEditorField).
export const HIGHLIGHT_MAX_LENGTH = 30_000

export function canHighlightVariables(text: string): boolean {
  return text.length <= HIGHLIGHT_MAX_LENGTH
}

export interface VariableTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value'> {
  value: string
  // Classes of the outer box (font, width). Font classes go here: both layers inherit them.
  className?: string
  // Classes of the textarea itself (height, resize)
  textareaClassName?: string
}

/**
 * Textarea that highlights {{variables}} (and invalid {{...}} tokens) with a "backdrop": a layer behind
 * a transparent textarea, with the same text laid out the same way, where only the highlight marks are
 * visible. The textarea stays a native one (selection, IME, undo, spell check and resize keep working);
 * the backdrop follows its scroll position. Both layers inherit font and line height from the box and
 * reserve the scrollbar gutter, so the text wraps at the same width in both.
 */
export const VariableTextarea = forwardRef<HTMLTextAreaElement, VariableTextareaProps>(
  ({ value, className, textareaClassName, onScroll, ...props }, forwardedRef) => {
    const textareaRef = useRef<HTMLTextAreaElement | null>(null)
    const backdropRef = useRef<HTMLDivElement>(null)

    const setTextareaRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        textareaRef.current = node
        if (typeof forwardedRef === 'function') forwardedRef(node)
        else if (forwardedRef) forwardedRef.current = node
      },
      [forwardedRef]
    )

    // No backdrop at all when there is nothing to highlight
    const segments = useMemo(
      () => (value.includes('{{') && canHighlightVariables(value) ? splitVariableSegments(value) : null),
      [value]
    )

    const syncScroll = useCallback(() => {
      const textarea = textareaRef.current
      const backdrop = backdropRef.current
      if (!textarea || !backdrop) return
      backdrop.scrollTop = textarea.scrollTop
      backdrop.scrollLeft = textarea.scrollLeft
    }, [])

    // A new text may have changed the textarea's scroll position without a scroll event
    useLayoutEffect(syncScroll)

    return (
      <div
        className={cn(
          'relative w-full rounded-md border border-input bg-background text-sm ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          className
        )}
      >
        {segments && (
          <div
            ref={backdropRef}
            aria-hidden="true"
            data-variable-backdrop=""
            className="pointer-events-none absolute inset-0 select-none overflow-hidden whitespace-pre-wrap break-words rounded-md px-3 py-2 text-transparent [scrollbar-gutter:stable]"
          >
            {segments.map((segment, index) =>
              segment.kind === 'text' ? (
                segment.text
              ) : segment.kind === 'variable' ? (
                // Only colors: padding, borders or weight would shift the text under the textarea
                <span key={index} data-variable="" className="rounded-sm bg-primary/20">
                  {segment.text}
                </span>
              ) : (
                <span
                  key={index}
                  data-invalid-variable=""
                  className="rounded-sm bg-amber-500/20 underline decoration-amber-600 decoration-wavy"
                >
                  {segment.text}
                </span>
              )
            )}
            {/* A final line break only takes up a line in the textarea when something follows it */}
            {value.endsWith('\n') ? ' ' : null}
          </div>
        )}
        <textarea
          ref={setTextareaRef}
          value={value}
          onScroll={(event) => {
            syncScroll()
            onScroll?.(event)
          }}
          className={cn(
            'relative block w-full rounded-md border-0 bg-transparent px-3 py-2 placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [scrollbar-gutter:stable]',
            textareaClassName
          )}
          {...props}
        />
      </div>
    )
  }
)
VariableTextarea.displayName = 'VariableTextarea'
