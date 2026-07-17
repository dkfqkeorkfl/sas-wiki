import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['scripts/**/*.mjs'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'logs/coverage',
      // P3 실측 후 락인(D13 measure-then-lock). 최초 설정이라 하향이 아니라 회귀 floor 다.
      // 실측(2026-07-17): stmts 86.4 · branch 76.63 · funcs 92.38 · lines 89.22 → 정수 내림.
      thresholds: {
        statements: 86,
        branches: 76,
        functions: 92,
        lines: 89,
      },
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
