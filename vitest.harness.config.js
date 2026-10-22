import { defineConfig } from 'vitest/config'

import productConfig from './vitest.config.js'

export default defineConfig({
  ...productConfig,
  test: {
    ...productConfig.test,
    include: ['harness/validation-regression/__tests__/*.test.mjs'],
    passWithNoTests: false,
    coverage: { ...productConfig.test.coverage, enabled: false },
  },
})
