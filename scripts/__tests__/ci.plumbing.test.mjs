// @vitest-environment node
//
// CI 워크플로 배선 — PR 과 main push 에서 로컬과 같은 게이트가 돌고, 그 게이트가 믿는 전제가 지켜지는가.
//
//   · 전체 git 이력으로 체크아웃한다 — id 변경 판별(ID_TAMPERED, git blame)·피드는 이력을 읽고,
//     얕은 클론이면 validate 가 스스로 멈춘다(parse-vault.mjs assertHistoryIntegrity).
//   · 서드파티 action 은 전체 커밋 SHA 로 고정한다(태그는 옮겨질 수 있다).
//   · CI 는 커밋·push 하지 않으므로 git 훅을 설치하지 않는다(HUSKY=0).
//   · 로컬 게이트 넷(포맷·테스트+커버리지·검증·빌드)을 그대로 돌린다.
//   · PR 은 새 push 가 오면 이전 실행을 취소하고, main push 는 서로 취소하지 않는다.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8')
const lines = workflow.split('\n').map((line) => line.trim())

describe('CI 워크플로', () => {
  it('PR 과 main push 에서 돈다', () => {
    expect(workflow).toMatch(/^\s{2}pull_request:/mu)
    expect(workflow).toMatch(/^\s{2}push:\n\s{4}branches: \[main\]/mu)
  })

  it('전체 이력으로 체크아웃한다(checkout 단계의 fetch-depth: 0)', () => {
    // 파일 어딘가에 있는 것만으로는 부족하다 — 다른 단계의 `with:` 에 있으면 checkout 은 얕게 받는다.
    expect(workflow).toMatch(
      /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n(?:\s+#[^\n]*\n)*\s+fetch-depth: 0$/mu,
    )
  })

  it('모든 action 을 전체 커밋 SHA 로 고정한다', () => {
    const uses = lines.filter((line) => line.startsWith('- uses:') || line.startsWith('uses:'))

    expect(uses.length).toBeGreaterThan(0)
    for (const line of uses) expect(line).toMatch(/@[0-9a-f]{40}(\s+#\s+v\d+\.\d+\.\d+)?$/u)
  })

  it('토큰 권한은 읽기 전용이다(job 단위로 넓히지 않는다)', () => {
    expect(workflow).toMatch(/^permissions:\n\s{2}contents: read$/mu)
    expect(workflow.match(/^\s*permissions:/gmu)).toHaveLength(1)
  })

  it('git 훅을 설치하지 않는다(HUSKY=0)', () => {
    expect(lines).toContain('HUSKY: 0')
  })

  it('PR 만 같은 그룹을 공유해 이전 실행을 취소한다 — main push 는 실행마다 자기 그룹이다', () => {
    // 한 그룹에서는 진행 중이 아닌 대기 실행이 새 실행에 밀려 취소된다(GitHub 문서 "Control the
    //   concurrency of workflows and jobs"). main push 가 그룹을 공유하면 연달은 push 사이의 실행이
    //   취소될 수 있어, push 는 실행 id 로 그룹을 나눈다.
    expect(lines).toContain(
      'group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}',
    )
    expect(lines).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
  })

  it('잠금 파일 그대로 설치하고 포맷·테스트(커버리지)·검증·빌드를 순서대로 돈다', () => {
    const runs = lines.filter((line) => line.startsWith('- run:')).map((line) => line.slice(7))

    expect(runs).toEqual([
      'pnpm install --frozen-lockfile',
      'pnpm run format:check',
      'pnpm run test:coverage',
      'pnpm run validate',
      'pnpm run build',
    ])
  })
})
