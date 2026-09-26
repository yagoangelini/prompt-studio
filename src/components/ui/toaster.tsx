import { useCallback, useEffect, useState } from "react"
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react"
import { usePromptStore } from "@/stores/usePromptStore"
import type { ToastMessage } from "@/types"
import { cn } from "@/lib/utils"
import {
  Toast,
  ToastClose,
  ToastDescription,
  ToastProvider,
  ToastTitle,
  ToastViewport,
} from "@/components/ui/toast"

const MAX_VISIBLE_TOASTS = 3
// Display time when a toast sets no duration (the timer pauses while hovered or focused)
const DEFAULT_DURATION = 5000
// A closed toast stays mounted this long so its exit animation can finish
const EXIT_ANIMATION_MS = 300

interface RenderedToast {
  toast: ToastMessage
  open: boolean
}

const TOAST_ICONS: Record<ToastMessage["type"], { icon: typeof Info; className: string }> = {
  success: { icon: CheckCircle2, className: "text-green-600 dark:text-green-400" },
  info: { icon: Info, className: "text-muted-foreground" },
  warning: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400" },
  error: { icon: XCircle, className: "" },
}

const toVariant = (type: ToastMessage["type"]) =>
  type === "error" ? "destructive" : type === "warning" ? "warning" : "default"

// Renders the toasts of the app store (addToast/removeToast)
export function Toaster() {
  const toasts = usePromptStore((state) => state.toasts)
  const removeToast = usePromptStore((state) => state.removeToast)
  const [rendered, setRendered] = useState<readonly RenderedToast[]>([])

  // Only the newest toasts are kept; older ones are dropped from the store
  useEffect(() => {
    toasts.slice(0, -MAX_VISIBLE_TOASTS).forEach((toast) => removeToast(toast.id))
  }, [toasts, removeToast])

  // Mirror the store: new toasts open; toasts that left the store (timer, overflow) close with animation
  useEffect(() => {
    const visible = toasts.slice(-MAX_VISIBLE_TOASTS)
    const visibleIds = new Set(visible.map((toast) => toast.id))
    setRendered((previous) => {
      const known = new Set(previous.map((item) => item.toast.id))
      const next = previous.map((item) =>
        item.open && !visibleIds.has(item.toast.id) ? { ...item, open: false } : item
      )
      visible.forEach((toast) => {
        if (!known.has(toast.id)) next.push({ toast, open: true })
      })
      return next
    })
  }, [toasts])

  // Unmount closed toasts once their exit animation is over
  useEffect(() => {
    if (!rendered.some((item) => !item.open)) return
    const timer = window.setTimeout(() => {
      setRendered((previous) => previous.filter((item) => item.open))
    }, EXIT_ANIMATION_MS)
    return () => window.clearTimeout(timer)
  }, [rendered])

  const dismiss = useCallback(
    (id: string) => {
      setRendered((previous) =>
        previous.map((item) => (item.toast.id === id ? { ...item, open: false } : item))
      )
      removeToast(id)
    },
    [removeToast]
  )

  return (
    <ToastProvider label="Notificação" duration={DEFAULT_DURATION}>
      {rendered.map(({ toast, open }) => {
        const { icon: Icon, className: iconClassName } = TOAST_ICONS[toast.type] ?? TOAST_ICONS.info
        return (
          <Toast
            key={toast.id}
            open={open}
            onOpenChange={(isOpen) => {
              if (!isOpen) dismiss(toast.id)
            }}
            duration={toast.duration || DEFAULT_DURATION}
            // Errors and warnings are announced immediately; the others politely
            type={toast.type === "error" || toast.type === "warning" ? "foreground" : "background"}
            variant={toVariant(toast.type)}
          >
            <div className="flex min-w-0 items-start gap-3">
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", iconClassName)} aria-hidden="true" />
              <div className="grid min-w-0 gap-1">
                <ToastTitle className="break-words">{toast.title}</ToastTitle>
                {toast.description && (
                  <ToastDescription className="break-words">{toast.description}</ToastDescription>
                )}
              </div>
            </div>
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport label="Notificações ({hotkey})" />
    </ToastProvider>
  )
}
