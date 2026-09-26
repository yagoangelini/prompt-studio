import { create } from 'zustand'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface ConfirmOptions {
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (confirmed: boolean) => void }) | null
}

const useConfirmStore = create<ConfirmState>(() => ({ request: null }))

// In-app replacement for window.confirm, whose native dialog shows English buttons ("OK"/"Cancel")
// and the app id as title. Resolves true when the user confirms, false otherwise.
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    // A pending request (should not happen) is answered as "cancel" before being replaced
    useConfirmStore.getState().request?.resolve(false)
    useConfirmStore.setState({ request: { ...options, resolve } })
  })
}

const settle = (confirmed: boolean) => {
  const { request } = useConfirmStore.getState()
  if (!request) return
  useConfirmStore.setState({ request: null })
  request.resolve(confirmed)
}

// Mounted once at the app root (desktop and menu bar windows)
export function ConfirmDialogHost() {
  const request = useConfirmStore((state) => state.request)

  return (
    <Dialog open={request !== null} onOpenChange={(open) => { if (!open) settle(false) }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{request?.title}</DialogTitle>
          {request?.description && <DialogDescription>{request.description}</DialogDescription>}
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-0">
          {/* Cancel gets the initial focus, so Enter never confirms a destructive action by accident */}
          <Button variant="outline" autoFocus onClick={() => settle(false)}>
            {request?.cancelLabel ?? 'Cancelar'}
          </Button>
          <Button variant={request?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>
            {request?.confirmLabel ?? 'Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
