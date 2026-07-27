import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      include: ['scripts/**/*.mjs'],
      // 테스트 자산은 **프로덕션 커버리지가 아니다.** 이걸 안 빼면 헬퍼를 추가할 때마다 분모가
      //   늘어 프로덕션 게이트가 내려간다 — 즉 "테스트를 더 쓰면 커버리지 게이트가 red 가 되는"
      //   역인센티브다. P4 에서 실제로 발생했다: 헬퍼 2개를 더했더니 프로덕션은 그대로인데
      //   혼합 수치가 floor 밑으로 떨어졌다(실측 · 아래 표). `atomic-stress.mjs` 는 자식 프로세스로
      //   spawn 되는 드라이버라 in-process 계측이 **구조적으로 불가능**해 영구 페널티였다.
      exclude: ['**/__tests__/**'],
      provider: 'v8',
      reporter: ['text', 'lcov', 'json-summary'],
      reportsDirectory: 'logs/coverage',
      // P3 실측 후 락인(D13 measure-then-lock). 최초 설정이라 하향이 아니라 회귀 floor 다.
      // 실측(2026-07-17): stmts 86.4 · branch 76.63 · funcs 92.38 · lines 89.22 → 정수 내림.
      //
      // **임계는 P4 에서 올리지도 내리지도 않았다.** 범위만 바로잡았고, 그 결과 프로덕션이 홀로
      //   floor 를 지므로 실질은 더 엄격하다. 범위 교정 후 실측(2026-07-28):
      //   프로덕션 stmts 88.67 · branch 80.61 · funcs 95.20 · lines 90.63 — **교정 전에도 네 임계를
      //   전부 넘고 있었다**(혼합 84.60/77.01/91.30/86.16 은 헬퍼가 끌어내린 값이다).
      //   즉 게이트의 의도는 늘 충족돼 있었고 측정 범위만 틀렸다. 재락인은 별도 판단으로 남긴다.
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
