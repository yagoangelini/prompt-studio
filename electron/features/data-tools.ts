import { ipcMain } from 'electron'
import type { FeatureModule } from './context'
import type { ApiTestRequest, ApiTestResponse } from '../../src/types'
import { executeApiTest } from '../api-test'

// Running "Testes" requests, per window (webContents id), so they can be canceled
const apiTests = new Map<number, AbortController>()

// Data tools: automatic backup, Claude Code commands export, "Testes" requests and their history
export const dataToolsFeature: FeatureModule = {
  name: 'data-tools',
  registerIpc() {
    // Testing handlers: one request per window, 60 s timeout, can be canceled
    ipcMain.handle('test-prompt', async (event, request: ApiTestRequest): Promise<ApiTestResponse> => {
      const windowId = event.sender.id
      apiTests.get(windowId)?.abort()
      const controller = new AbortController()
      apiTests.set(windowId, controller)
      try {
        return await executeApiTest(request, controller.signal)
      } finally {
        if (apiTests.get(windowId) === controller) apiTests.delete(windowId)
      }
    })

    ipcMain.handle('test-prompt:cancel', (event) => {
      const controller = apiTests.get(event.sender.id)
      if (!controller) return { success: false }
      controller.abort()
      return { success: true }
    })
  },
}
