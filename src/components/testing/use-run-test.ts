import { useCallback } from 'react'
import type { ApiTestResponse } from '@/types'
import { usePromptStore } from '@/stores/usePromptStore'
import { getTestIssues, useTestingStore } from './testing-store'
import { testResultToast } from './testing-format'

// Runs the test configured in the "Testar prompt" tab and reports the outcome in a toast.
// Used by the tab itself and by "Reexecutar" in the history.
export function useRunTest(): () => Promise<ApiTestResponse | null> {
  const { addToast } = usePromptStore()
  return useCallback(async () => {
    const state = useTestingStore.getState()
    if (state.isLoading) return null
    const issues = getTestIssues(state)
    if (issues.length > 0) {
      // Clears the result on screen: it would not match what is being sent
      await state.runTest()
      addToast({
        type: 'error',
        title: 'Não foi possível executar o teste',
        description: issues.map((issue) => issue.message).join(' '),
      })
      return null
    }
    // The request lives in the store, so it finishes even if the user leaves this tab
    const result = await state.runTest()
    if (result) addToast(testResultToast(result))
    return result
  }, [addToast])
}
