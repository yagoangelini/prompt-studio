import type { FeatureModule } from './context'
import { quickPasteFeature } from './quick-paste'
import { organizationFeature } from './organization'
import { dataToolsFeature } from './data-tools'

// Feature modules plugged into the main process (see ./context.ts)
export const FEATURES: readonly FeatureModule[] = [organizationFeature, dataToolsFeature, quickPasteFeature]
