import type { FeatureModule } from './context'

// Quick paste: global shortcut that opens a prompt picker and pastes into the active app
export const quickPasteFeature: FeatureModule = {
  name: 'quick-paste',
  registerIpc() {
    // Filled in by the feature implementation
  },
}
