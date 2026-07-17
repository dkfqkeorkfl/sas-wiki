import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      // P3 moves scripts here. P2 matches 0 files, so thresholds stay absent until measured.
      include: ['scripts/**/*.mjs'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'logs/coverage',
    },
    // Tests seed their own git repos and must inject GIT_AUTHOR_*/GIT_COMMITTER_* explicitly.
    // Without this, a developer's ~/.gitconfig silently supplies the identity, so a test that
    // forgets to inject it passes locally and fails only on CI, which has no git identity.
    env: { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' },
    hookTimeout: 60000,
    testTimeout: 30000,
    // No include/environment keys: Vitest defaults already match *.test.mjs in node.
  },
})
