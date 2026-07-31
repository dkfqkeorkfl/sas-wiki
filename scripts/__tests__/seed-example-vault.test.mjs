// @vitest-environment node
//
// RED-A · 시드 스크립트 계약 — scripts/wiki/seed-example-vault.mjs (plan Task 1 / tdd §4.1)
//
// RED 사유: seed-example-vault.mjs 가 **아직 없다** → 아래 import 가 모듈 해석 단계에서 실패한다.
//   무관한 문법 오류·셋업 붕괴가 아니라 **의도한 미구현** 때문에 실패한다.
//
// GREEN 대상의 계약:
//   export function seedVault({ repo, branch = 'test' }) → { branch, head, commits: string[] }
//   CLI: node scripts/wiki/seed-example-vault.mjs --repo sas-wiki --branch test
//   엔트리가드: import.meta.url === pathToFileURL(process.argv[1]).href  (build.mjs:268 선례)
//
// 왜 함수를 export 하고 CLI 를 얇게 두는가:
//   ① coverage include 가 `scripts/wiki/**/*.mjs`(vitest.config.ts:20) 다. subprocess 로만 돌리면
//      v8 이 자식 프로세스를 계측하지 못해 이 파일이 0% 로 잡히고 전역 floor 를 끌어내린다.
//      → in-process import 로 호출해 계측되게 한다(CLI 경로는 subprocess 1건으로만 확인).
//   ② 가드·결정성을 stderr 문자열 매칭이 아니라 **예외·반환값**으로 직접 단언할 수 있다.
//
// 이 스크립트가 만드는 히스토리는 **되돌릴 수 없다**(피드 id = 커밋 해시 12자, 피드 1건 = 커밋 1건,
// 문서 id = frontmatter UUIDv7, force-push·squash 금지). 그래서 결정성과 안전 가드가 품질 문제가 아니라 **안전장치**다.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { extractTrailers } from '../lib/feed.mjs'
import { isVaultDoc, readVaultFacts } from './helpers/vault-facts.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url)) // scripts/wiki/__tests__
const SEED_SCRIPT = path.resolve(HERE, 'helpers', 'seed-example-vault.mjs') // GREEN 대상

// RED 시점에 이 모듈은 존재하지 않는다. 정적 import 로 적으면 eslint 의 import-x/no-unresolved 가
// 에러를 내고, pre-commit(lint-staged)이 **RED 커밋 자체를 막는다** — 규칙을 억제하는 대신
// 해석을 런타임으로 미룬다. 실패는 여기서 "Cannot find module …" 로 명확히 드러나고,
// in-process 호출이므로 coverage 계측(vitest.config.ts:20)은 그대로 유지된다.
const { seedVault } = await import(pathToFileURL(SEED_SCRIPT).href)

// 베이스 리포의 루트 커밋 — 실 sas-wiki 의 README 커밋에 대응한다(시딩은 이 위에 얹힌다).
const BASE_SUBJECT = 'Initialize README with project title'

// 베이스 커밋의 6필드 고정(결정성). 시드 스크립트도 같은 규율을 따라야 A-1 이 통과한다.
const BASE_IDENTITY = {
  GIT_AUTHOR_DATE: '1136239445 +0000',
  GIT_AUTHOR_EMAIL: 'bot@sas.wiki',
  GIT_AUTHOR_NAME: 'SAS Wiki Bot',
  GIT_COMMITTER_DATE: '1136239445 +0000',
  GIT_COMMITTER_EMAIL: 'bot@sas.wiki',
  GIT_COMMITTER_NAME: 'SAS Wiki Bot',
}

const ctx = { baseSha: '', originDir: '', tmpRoot: '' }
let cloneSeq = 0

function execGit(cwd, args, extraEnv = {}) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
  }).trim()
}

/** 테스트마다 새 클론 — 테스트 격리(공유 상태 없음). bare origin 에서 클론하므로 SHA 가 보존된다. */
function freshClone(name) {
  cloneSeq += 1
  const dst = path.join(ctx.tmpRoot, `${name}-${cloneSeq}`)
  execFileSync('git', ['clone', '--no-local', '-q', ctx.originDir, dst], { encoding: 'utf8' })
  return dst
}

beforeAll(() => {
  ctx.tmpRoot = mkdtempSync(path.join(tmpdir(), 'wiki-seed-'))
  ctx.originDir = path.join(ctx.tmpRoot, 'origin.git')
  const baseDir = path.join(ctx.tmpRoot, 'base')
  mkdirSync(ctx.originDir, { recursive: true })
  mkdirSync(baseDir, { recursive: true })

  // GOTCHA: `git init` 의 기본 브랜치명은 init.defaultBranch 에 따라 master 일 수 있다 → -b main 명시.
  // 시드 스크립트는 `checkout -b <branch> main` 을 하므로 베이스에 main 이 있어야 한다.
  execGit(ctx.originDir, ['init', '--bare', '-q', '-b', 'main'])
  execGit(baseDir, ['init', '-q', '-b', 'main'])
  writeFileSync(path.join(baseDir, 'README.md'), '# sas-wiki\n')
  execGit(baseDir, ['add', '-A'])
  execGit(baseDir, ['commit', '-q', '--no-gpg-sign', '-m', BASE_SUBJECT], BASE_IDENTITY)
  ctx.baseSha = execGit(baseDir, ['rev-parse', 'HEAD'])

  // bare origin 을 붙여 "스크립트가 push 하지 않음"(A-7)을 관측 가능하게 만든다.
  execGit(baseDir, ['remote', 'add', 'origin', ctx.originDir])
  execGit(baseDir, ['push', '-q', 'origin', 'main'])
})

afterAll(() => {
  if (ctx.tmpRoot) rmSync(ctx.tmpRoot, { force: true, recursive: true })
})

describe('seedVault — 결정성', () => {
  it('서로 다른 두 클론에 시딩하면 test 브랜치가 동일 SHA 다', () => {
    // 문서 id = frontmatter UUIDv7, 피드 id = 커밋 해시 12자. 시딩이 결정적이지 않으면
    // 재현·재시딩이 불가능해진다(이 vault 를 참조하는 P2 기대값이 전부 무의미해진다).
    const first = freshClone('det-a')
    const second = freshClone('det-b')

    const a = seedVault({ branch: 'test', repo: first })
    const b = seedVault({ branch: 'test', repo: second })

    expect(execGit(first, ['rev-parse', 'test'])).toBe(execGit(second, ['rev-parse', 'test']))
    expect(a.head).toBe(b.head)
    expect(a.head).toBe(execGit(first, ['rev-parse', 'test']))
  })

  it('CLI 로 실행해도 예제 17커밋을 쌓고 exit 0 이다', () => {
    // CLI 경로(인자 파싱·엔트리가드·exit code)는 subprocess 1건으로만 확인한다.
    const repo = freshClone('cli')

    execFileSync('node', [SEED_SCRIPT, '--repo', repo, '--branch', 'test'], { encoding: 'utf8' })

    expect(execGit(repo, ['rev-list', '--count', 'test'])).toBe('18') // 루트 1 + 예제 17
  })
})

describe('seedVault — 안전 가드(되돌릴 수 없는 쓰기 차단)', () => {
  it('--branch main 을 거부한다', () => {
    // main = 서비스가 소비하는 실데이터 브랜치. 예제 feed 커밋이 main 에 들어가면 빌드가 그것을
    // **가짜 뉴스로 실서비스에 띄운다**(빌드는 예제인지 구분할 수단이 없다).
    // 되돌리려면 히스토리 재작성 → 문서 id·실피드 파괴 → 사실상 되돌릴 수 없다.
    const repo = freshClone('guard-main')

    expect(() => seedVault({ branch: 'main', repo })).toThrow()
  })

  it('--branch seed 를 거부한다', () => {
    // seed 는 main 의 **스테이징**이다 — seed 로 들어간 예제는 결국 머지를 타고 서비스에 도달한다.
    // 서비스 데이터 경로에 있는 브랜치는 전부 거부한다. 예제는 test 에만, test 는 일방통행.
    const repo = freshClone('guard-seed')

    expect(() => seedVault({ branch: 'seed', repo })).toThrow()
  })

  // 금지 목록(정확 일치)은 오타 변형을 못 막는다 — `--branch` 는 사람이 손으로 치는 유일한
  // 인터페이스라 오타가 곧 사고다. 그래서 허용 목록(`test` | `test-*`)으로 뒤집었다.
  it.each(['Main', 'MAIN', 'main ', 'Seed', 'develop', 'tests', ''])(
    'test 계열이 아닌 브랜치(%j)를 거부한다',
    (branch) => {
      const repo = freshClone(`guard-allow-${branch.trim() || 'empty'}`)

      expect(() => seedVault({ branch, repo })).toThrow()
      expect(existsSync(path.join(repo, 'vault'))).toBe(false)
    },
  )

  it('detached HEAD 로 이미 시딩된 커밋을 가리키고 있으면 재시딩을 거부한다', () => {
    // 서브모듈은 포인터(SHA)로 체크아웃되므로 **detached HEAD** 가 정상 상태다 — 이미 시딩된
    // 커밋을 가리키고 있어도 로컬 refs/heads/test 는 없다. 로컬 ref 만 보는 가드는 여기서
    // "시딩 안 됨" 으로 오판하고 main 위에 히스토리를 처음부터 다시 쌓는다.
    const origin = freshClone('detached-src')
    const seeded = seedVault({ branch: 'test', repo: origin })

    const fresh = freshClone('detached')
    execGit(fresh, ['fetch', '-q', origin, 'test'])
    execGit(fresh, ['checkout', '-q', '--detach', seeded.head])
    // 전제 재확인: 로컬 브랜치 ref 는 없다(가드가 로컬 ref 만 보면 통과해버린다).
    expect(execGit(fresh, ['for-each-ref', '--format=%(refname)', 'refs/heads/test'])).toBe('')

    expect(() => seedVault({ branch: 'test', repo: fresh })).toThrow(/이미 vault 가 있다/u)
  })

  it('main 거부 시 아무것도 만들지 않는다(부분 시딩 잔재 없음)', () => {
    // 거부는 "에러를 던지는 것"이 아니라 **아무것도 만들지 않는 것**이다.
    const repo = freshClone('guard-main-clean')
    const refsBefore = execGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])
    const headBefore = execGit(repo, ['rev-parse', 'HEAD'])

    expect(() => seedVault({ branch: 'main', repo })).toThrow()

    expect(execGit(repo, ['for-each-ref', '--format=%(refname) %(objectname)'])).toBe(refsBefore)
    expect(execGit(repo, ['rev-parse', 'HEAD'])).toBe(headBefore)
    expect(execGit(repo, ['status', '--porcelain'])).toBe('')
    expect(existsSync(path.join(repo, 'vault'))).toBe(false)
  })

  it('dirty 워킹트리를 거부한다', () => {
    // 시딩은 `git add -A` 계열 조작을 한다. 무관한 변경이 섞이면 커밋 내용이 달라져 SHA 가 흔들리고
    // (결정성 붕괴) 남의 작업물이 예제 커밋에 실려 원격에 올라간다.
    const repo = freshClone('dirty')
    writeFileSync(path.join(repo, 'stray.txt'), 'uncommitted\n')

    expect(() => seedVault({ branch: 'test', repo })).toThrow()
  })

  it('git 워크트리가 아닌 경로를 거부한다', () => {
    const plain = path.join(ctx.tmpRoot, 'not-a-repo')
    mkdirSync(plain, { recursive: true })

    expect(() => seedVault({ branch: 'test', repo: plain })).toThrow()
  })

  it('이미 vault 를 가진 브랜치에 재시딩하면 거부한다(17커밋 중복 적재 차단)', () => {
    const repo = freshClone('reseed')
    seedVault({ branch: 'test', repo })

    expect(() => seedVault({ branch: 'test', repo })).toThrow()

    expect(execGit(repo, ['rev-list', '--count', 'test'])).toBe('18')
  })

  it('origin 에 push 하지 않는다', () => {
    // plan Task 1: "스크립트는 절대 push 하지 않는다". push 는 메인 에이전트의 명시적 행위여야 한다 —
    // 스크립트가 push 하면 "계약 검증 후 push" 게이트(tdd §2.1 ⑦)가 통째로 무력화된다.
    const repo = freshClone('nopush')

    seedVault({ branch: 'test', repo })

    const originRefs = execGit(ctx.originDir, ['for-each-ref', '--format=%(refname)'])
    expect(originRefs).toContain('refs/heads/main')
    expect(originRefs).not.toContain('refs/heads/test')
  })

  it('main 브랜치에 커밋을 얹지 않는다(test 는 일방통행)', () => {
    const repo = freshClone('main-intact')
    const countBefore = execGit(repo, ['rev-list', '--count', 'main'])
    const shaBefore = execGit(repo, ['rev-parse', 'main'])

    seedVault({ branch: 'test', repo })

    expect(execGit(repo, ['rev-list', '--count', 'main'])).toBe(countBefore)
    expect(execGit(repo, ['rev-parse', 'main'])).toBe(shaBefore)
  })
})

describe('seedVault — 시딩 결과가 vault 계약을 만족한다(드라이런 게이트)', () => {
  // 실 서브모듈·원격을 더럽히기 **전에** 임시 클론에서 계약 위반을 먼저 잡는다.
  // vault.contract.test.mjs(RED-B)와 같은 계약을 묻지만 대상 리포가 다르다 —
  // 스크립트가 맞아도 시딩·push·포인터 bump 를 안 했을 수 있으므로 둘 다 필요하다.
  const seeded = { examples: [], facts: null }

  beforeAll(() => {
    const repo = freshClone('contract')
    seedVault({ branch: 'test', repo })
    seeded.facts = readVaultFacts(repo, { rootSha: ctx.baseSha }) // 임시 리포의 루트는 sas-wiki 루트가 아니다
    seeded.examples = seeded.facts.commits.filter((commit) => commit.sha !== ctx.baseSha)
  })

  it('문서 5개 이상을 HEAD 에 남긴다', () => {
    expect(seeded.facts.mdFiles.length).toBeGreaterThanOrEqual(5)
  })

  it('예제 커밋 17건이 cwiki|uwiki|feed 규약을 따른다', () => {
    expect(seeded.examples.length).toBe(17) // R1: every() 의 vacuous 통과 방지
    const offenders = seeded.examples.filter(
      (commit) => !/^(cwiki|uwiki|feed): .+$/.test(commit.subject),
    )
    expect(offenders.map((commit) => commit.subject)).toEqual([])
  })

  it('커밋은 신규 파일을 정확히 1개 만든다(문서 id 충돌 차단)', () => {
    const cwiki = seeded.examples.filter((commit) => commit.subject.startsWith('cwiki: '))
    expect(cwiki.length).toBeGreaterThanOrEqual(7)

    for (const commit of cwiki) {
      const added = commit.changes.filter((change) => change.status === 'A')
      expect(added, commit.subject).toHaveLength(1)
      expect(isVaultDoc(added[0].path), commit.subject).toBe(true)
    }
  })

  it('active·disable 문서를 모두 남긴다', () => {
    expect(
      seeded.facts.docs.filter((doc) => doc.status === 'active').length,
    ).toBeGreaterThanOrEqual(3)
    expect(
      seeded.facts.docs.filter((doc) => doc.status === 'disable').length,
    ).toBeGreaterThanOrEqual(1)
  })

  it('rename 을 남기고 새 경로가 HEAD 에 존재한다', () => {
    const renames = seeded.examples
      .flatMap((commit) => commit.changes)
      .filter((change) => change.status === 'R' && isVaultDoc(change.newPath))
    expect(renames.length).toBeGreaterThanOrEqual(1)
    for (const rename of renames) expect(seeded.facts.mdFiles).toContain(rename.newPath)
  })

  it('삭제된 문서와 그것을 가리키는 feed 커밋을 함께 남긴다(prune 대상 실재)', () => {
    const deleted = seeded.examples
      .flatMap((commit) => commit.changes)
      .filter((change) => change.status === 'D' && isVaultDoc(change.path))
      .map((change) => change.path)
    expect(deleted.length).toBeGreaterThanOrEqual(1)

    const feeds = seeded.examples.filter((commit) => commit.subject.startsWith('feed: '))
    for (const deletedPath of deleted) {
      expect(seeded.facts.mdFiles).not.toContain(deletedPath)
      const touching = feeds.filter((commit) =>
        commit.changes.some((change) => (change.newPath ?? change.path) === deletedPath),
      )
      expect(
        touching.length,
        `삭제 문서(${deletedPath})를 가리키는 feed 커밋 부재`,
      ).toBeGreaterThanOrEqual(1)
    }
  })

  it('문서 2개 이상을 수정한 feed 커밋을 남긴다(다중 문서 피드)', () => {
    const feeds = seeded.examples.filter((commit) => commit.subject.startsWith('feed: '))
    expect(feeds.length).toBeGreaterThanOrEqual(5)

    const multi = feeds.filter(
      (commit) =>
        new Set(
          commit.changes
            .map((change) => change.newPath ?? change.path)
            .filter((p) => isVaultDoc(p)),
        ).size >= 2,
    )
    expect(multi.length).toBeGreaterThanOrEqual(1)
  })

  it('feed 커밋의 Keywords·Importance 가 프로덕션 파서에 trailer 로 인식된다', () => {
    // 문자열 포함이 아니라 extractTrailers(`lib/feed.mjs:26-55`)로 묻는다 —
    // "마지막 빈 줄 뒤 블록의 모든 줄"이 `Key: value` 여야 인정되고, 한 줄이라도 어기면
    // 블록 전체가 본문으로 흡수된다(= keywords·importance 가 조용히 사라진다).
    const feeds = seeded.examples.filter((commit) => commit.subject.startsWith('feed: '))
    expect(feeds.length).toBeGreaterThanOrEqual(5)

    const parsed = feeds.map((commit) => extractTrailers(commit.body).trailers)
    expect(parsed.filter((trailers) => Boolean(trailers.keywords)).length).toBeGreaterThanOrEqual(1)
    expect(
      parsed.filter((trailers) => ['breaking', 'highlight', 'normal'].includes(trailers.importance))
        .length,
    ).toBeGreaterThanOrEqual(1)
  })
})
