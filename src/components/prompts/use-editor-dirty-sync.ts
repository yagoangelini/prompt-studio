import { useEffect, useRef, useState } from 'react'
import { usePromptStore } from '@/stores/usePromptStore'

// Mirrors an editor's local "has unsaved changes" state into the store (isEditorDirty), which guards
// navigation. When someone else clears the flag while the editor still has changes (the user confirmed
// "Descartar" and the editor stayed mounted, e.g. "Usar template" over a new prompt), the editor must
// drop its changes: onExternalDiscard is called for that, and the flag is published again afterwards
// (the form it loads may itself have unsaved changes).
export function useEditorDirtySync(isDirty: boolean, onExternalDiscard: () => void) {
  const setEditorDirty = usePromptStore((state) => state.setEditorDirty)
  const storeDirty = usePromptStore((state) => state.isEditorDirty)
  const [resync, setResync] = useState(0)

  const previousStoreDirty = useRef(storeDirty)
  const isDirtyRef = useRef(isDirty)
  const discardRef = useRef(onExternalDiscard)
  isDirtyRef.current = isDirty
  discardRef.current = onExternalDiscard

  useEffect(() => {
    setEditorDirty(isDirty)
  }, [isDirty, resync, setEditorDirty])

  useEffect(() => {
    const wasDirty = previousStoreDirty.current
    previousStoreDirty.current = storeDirty
    if (wasDirty && !storeDirty && isDirtyRef.current) {
      discardRef.current()
      setResync((count) => count + 1)
    }
  }, [storeDirty])

  useEffect(() => () => setEditorDirty(false), [setEditorDirty])
}
