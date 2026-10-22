import { defineConfig } from 'vitest/config'

import productConfig, { documentGuardTests } from './vitest.config.js'

export default defineConfig({
  ...productConfig,
  test: {
    ...productConfig.test,
    include: ['harness/wiki-documents/__tests__/*.test.mjs'],
    exclude: [...(productConfig.test.exclude ?? []), ...documentGuardTests],
    passWithNoTests: false,
    coverage: { ...productConfig.test.coverage, enabled: false },
  },
})
