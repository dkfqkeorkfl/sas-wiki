// @vitest-environment node
//
// P1 3-A · scripts/wiki/build.mjs CLI 엔트리 import-safety RED
// 대상: build.mjs 엔트리가드 + lib/* 개별 import 가능성
// RED 사유: scripts/wiki/build.mjs · lib/* 미구현(모듈 부재) → dynamic import reject.
//
// 계약(Task1): build.mjs 는 `if (import.meta.url === pathToFileURL(process.argv[1]).href) main()`
//   엔트리가드로 import 시 main() 을 실행하지 않는다(부작용/process.exit 없이 로드 가능).
//   가드가 없으면 import 즉시 main() 이 돌아 git/vault 부재로 process.exit(1) → 테스트 런 붕괴.
import { describe, expect, it } from 'vitest'

describe('build.mjs 엔트리 import-safety', () => {
  it('build.mjs 를 import 해도 main() 이 실행되지 않는다(부작용/exit 없이 로드)', async () => {
    // import 가 resolve 되고 그 다음 줄에 도달한다는 것 자체가 "main 미실행" 의 증거
    // (가드 부재 시 process.exit 로 여기 도달 못 함).
    const mod = await import('../build.mjs')

    expect(mod).toBeDefined()
  })

  it('파생 순수 함수를 lib/* 에서 개별 import 할 수 있다', async () => {
    const parse = await import('../lib/parse.mjs')
    const feed = await import('../lib/feed.mjs')

    expect(typeof parse.parseFrontmatterYaml).toBe('function')
    expect(typeof feed.parseCommitForFeed).toBe('function')
  })
})
