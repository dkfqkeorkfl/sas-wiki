// @vitest-environment node
//
// P3 · Task 4 — 신선도 지문 (`scripts/lib/fingerprint.mjs` 신설) — tdd §3.5 (FG0~FG9)
//
// RED 사유(전 케이스 공통 · **미구현**): `scripts/lib/fingerprint.mjs` 가 **부재**하고
//   `computeInputsFingerprint` export 도 없다. 지연 import + 케이스별 되던지기로 collection error 를
//   피한다(tdd §2.4).
//
// 이 파일이 확정하는 seam (tdd §3.0):
//   computeInputsFingerprint({ env, scriptsDir, sourceCommit, vaultDir }) → /^[0-9a-f]{16}$/
//     입력 = <scriptsDir>/**/*.mjs (경로에 `__tests__` 세그먼트가 있으면 제외)
//          + <scriptsDir>/schema/*.json
//          + <vaultDir>/wiki/**/*.md
//          + env + sourceCommit
//     정렬된 상대경로 + 내용 바이트를 순서대로 먹인다(결정성).
//     scriptsDir 기본값 = import.meta.url 파생(= sas-wiki/scripts).
//
// **이 절이 공허성 위험이 가장 높다**(tdd §2.3 지문 전용 규범):
//   · 구현을 흉내 내 기대값을 만들지 않는다. **리터럴 해시를 박지 않는다**(브리틀 + 자기참조).
//     전 케이스가 **차등 비교**다 — 같은 입력이면 같고, 한 축만 바꾸면 다르다.
//   · 실제 파일을 고쳐 관측하되 **실 리포의 `scripts/**` 는 절대 고치지 않는다**(§10.1 절대금지 7).
//     `scriptsDir` seam 에 tmp 를 주입한다. 기본값이 실 `scripts/` 를 가리킨다는 사실은 FG8 이 별도로
//     못박고, 그 케이스는 실 파일을 **읽기만** 한다.
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import {
  cleanup,
  commit,
  git,
  initVault,
  writeDoc,
} from '../../__tests__/helpers/tmp-git-vault.mjs'

const loaded = await import(new URL('../fingerprint.mjs', import.meta.url).href).catch((error) => ({
  __loadError: error instanceof Error ? error.message : String(error),
}))

function fingerprint(input) {
  if (loaded.__loadError !== undefined) {
    throw new Error(
      `[RED] scripts/lib/fingerprint.mjs 가 아직 없다 (P3 Task 4 미구현): ${loaded.__loadError}`,
    )
  }
  if (typeof loaded.computeInputsFingerprint !== 'function') {
    throw new Error('[RED] fingerprint.mjs 에 computeInputsFingerprint export 가 아직 없다') // prettier-ignore
  }
  return loaded.computeInputsFingerprint(input)
}

const HERE = path.dirname(fileURLToPath(import.meta.url))
/** 실 생성기 소스 루트 — FG8 만 쓰고 **읽기 전용**이다. */
const REAL_SCRIPTS_DIR = path.resolve(HERE, '..', '..')

/** 히스토리 좌표 리터럴 — 지문 입력 중 하나. 구현이 이 값을 어떻게 섞는지는 묻지 않는다. */
const COMMIT_ONE = '1111111111111111111111111111111111111111'
const COMMIT_TWO = '2222222222222222222222222222222222222222'

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const ID_B = '0192b000-0000-7000-8000-0000000000bb'

const tmps = []
afterAll(() => cleanup(...tmps))

function track(dir) {
  tmps.push(dir)
  return dir
}

/** 생성기 소스 루트를 흉내 낸 tmp — `.mjs` 2개 + `schema/*.json` 1개 + `__tests__/` 1개. */
function makeScriptsDir() {
  const root = track(mkdtempSync(path.join(tmpdir(), 'wiki-fp-scripts-')))
  mkdirSync(path.join(root, 'lib'), { recursive: true })
  mkdirSync(path.join(root, 'schema'), { recursive: true })
  mkdirSync(path.join(root, '__tests__'), { recursive: true })
  writeFileSync(path.join(root, 'summary.mjs'), "export const kind = 'summary'\n")
  writeFileSync(path.join(root, 'lib', 'parse-vault.mjs'), "export const kind = 'parse'\n")
  writeFileSync(path.join(root, 'schema', 'summary.schema.json'), '{ "title": "wiki_summary" }\n')
  writeFileSync(path.join(root, '__tests__', 'x.test.mjs'), '// 테스트다.\nexport const t = 1\n')
  return root
}

/** git 없는 순수 문서 트리 — 지문은 파일 내용만 읽는다(대부분의 케이스에 git 이 필요 없다). */
function makePlainVault() {
  const root = track(mkdtempSync(path.join(tmpdir(), 'wiki-fp-vault-')))
  mkdirSync(path.join(root, 'wiki', 'company'), { recursive: true })
  writeFileSync(
    path.join(root, 'wiki', 'company', '정상.md'),
    `---\ntitle: 정상\ntype: concept\nstatus: active\nid: "${ID_A}"\n---\n\n## 정의\n\n본문 문단이다.\n`,
  )
  return root
}

/** 실 git vault — FG3(미커밋 편집 앵커)·FG7(`git mv`)만 쓴다. */
function makeGitVault() {
  const vault = track(initVault())
  writeDoc(vault, 'company/정상', { id: ID_A, wikiRoot: 'wiki' })
  writeDoc(vault, 'concept/메모리', { id: ID_B, wikiRoot: 'wiki' })
  commit(vault, 'chore: 초기 문서 2건')
  return vault
}

const base = (scriptsDir, vaultDir) => ({
  env: 'dev',
  scriptsDir,
  sourceCommit: COMMIT_ONE,
  vaultDir,
})

describe('computeInputsFingerprint — 형식·결정성 (FG0·FG1 · 🔴RED 미구현)', () => {
  it('FG0: 반환이 16자리 소문자 hex 다', () => {
    expect(fingerprint(base(makeScriptsDir(), makePlainVault()))).toMatch(/^[0-9a-f]{16}$/)
  })

  it('FG1: 같은 입력으로 2회 호출 → **동일** (Map 순회·시계 혼입이면 red)', () => {
    const input = base(makeScriptsDir(), makePlainVault())

    expect(fingerprint(input)).toBe(fingerprint(input))
  })
})

describe('computeInputsFingerprint — 입력 축별 차등 (FG2~FG7·FG9 · 🔴RED 미구현)', () => {
  it('FG2: 생성기 소스 `.mjs` 1바이트 변경 → **다름** (F-6 생성기 코드 드리프트)', () => {
    const scriptsDir = makeScriptsDir()
    const vaultDir = makePlainVault()
    const input = base(scriptsDir, vaultDir) // 앵커: sourceCommit 은 두 호출에서 **같은 리터럴**이다
    const before = fingerprint(input)

    writeFileSync(path.join(scriptsDir, 'lib', 'parse-vault.mjs'), "export const kind = 'parseX'\n")

    expect(fingerprint(input)).not.toBe(before)
  })

  it('FG3: vault 문서를 **커밋하지 않고** 편집 → **다름** (도입되는 회귀의 유일한 방어선)', () => {
    // ★ 앵커 2개가 필수다(규범 B). 없으면 "HEAD 가 움직여서 지문이 바뀐 것" 과 구분되지 않는다.
    const scriptsDir = makeScriptsDir()
    const vaultDir = makeGitVault()
    const input = base(scriptsDir, vaultDir)
    const headBefore = git(vaultDir, ['rev-parse', 'HEAD'])
    const before = fingerprint(input)

    const docPath = path.join(vaultDir, 'wiki', 'company', '정상.md')
    writeFileSync(docPath, `${readFileSync(docPath, 'utf8')}\n추가 문장이다.\n`)

    // 앵커 ①: 워킹트리가 실제로 더러워졌다(편집이 반영됐다).
    expect(git(vaultDir, ['status', '--porcelain'])).not.toBe('')
    // 앵커 ②: HEAD 는 움직이지 않았다 → 지문 변화의 원인은 **미커밋 내용** 뿐이다.
    expect(git(vaultDir, ['rev-parse', 'HEAD'])).toBe(headBefore)

    expect(fingerprint(input)).not.toBe(before)
  })

  it('FG4: `SOURCE_DATE_EPOCH` 만 바꿔도 → **동일** (시계는 입력이 아니다)', () => {
    const input = base(makeScriptsDir(), makePlainVault())
    const saved = process.env.SOURCE_DATE_EPOCH
    try {
      process.env.SOURCE_DATE_EPOCH = '1700000000'
      const before = fingerprint(input)
      process.env.SOURCE_DATE_EPOCH = '1800000000'

      expect(fingerprint(input)).toBe(before)
    } finally {
      if (saved === undefined) delete process.env.SOURCE_DATE_EPOCH
      else process.env.SOURCE_DATE_EPOCH = saved
    }
  })

  it('FG5: `env` 만 dev↔prod → **다름** (같으면 dev 캐시가 prod 로 서빙된다)', () => {
    const scriptsDir = makeScriptsDir()
    const vaultDir = makePlainVault()

    expect(fingerprint({ ...base(scriptsDir, vaultDir), env: 'prod' })).not.toBe(
      fingerprint({ ...base(scriptsDir, vaultDir), env: 'dev' }),
    )
  })

  it('FG6: `__tests__/` 파일 편집 → **동일** (과잉 무효화 방지)', () => {
    // 없으면 테스트 한 줄 고칠 때마다 9.8초 재생성이 돈다.
    const scriptsDir = makeScriptsDir()
    const input = base(scriptsDir, makePlainVault())
    const before = fingerprint(input)

    writeFileSync(path.join(scriptsDir, '__tests__', 'x.test.mjs'), '// 고쳤다.\nexport const t = 2\n') // prettier-ignore

    expect(fingerprint(input)).toBe(before)
  })

  it('FG11: vault **루트의 무관 파일** 편집 → **동일** (과잉 무효화 방지 · 반대 방향 짝)', () => {
    // ★ P5(D-H)가 `ignore-feeds.json` 을 지문 입력에서 뺐다. 그 전환을 무는 케이스들(SU1~SU4)은
    //   전부 **억제 파일 한 좌표**만 본다 — vault 루트가 통째로 입력이 되는 방향의 회귀는 아무도
    //   못 잡는다. 그러면 억제 한 줄 편집이 23~26초 재생성을 부르던 상태로 조용히 되돌아간다.
    //   삭제된 `fingerprint.ignore-input.test.mjs` 의 FP3 이 이 좌표를 갖고 있었고, 그 파일은
    //   억제 케이스만 SU 로 승계되며 사라졌다 — **이 케이스가 그 공백을 잇는다**.
    //   `FG6` 은 `scripts/__tests__/` 좌표라 vault 루트를 덮지 못한다(다른 루트다).
    const scriptsDir = makeScriptsDir()
    const vaultDir = makePlainVault()
    const input = base(scriptsDir, vaultDir)
    const docFile = path.join(vaultDir, 'wiki', 'company', '정상.md')
    const original = readFileSync(docFile, 'utf8')
    const before = fingerprint(input)

    // 앵커(규범 B): 같은 vault·같은 호출이 **문서** 편집에는 실제로 반응한다 — 관측이 살아 있다.
    writeFileSync(docFile, `${original}\n추가된 문단이다.\n`)
    expect(fingerprint(input)).not.toBe(before)
    writeFileSync(docFile, original)
    expect(fingerprint(input)).toBe(before)

    // 본 단언: 루트의 비-문서 파일은 지문을 흔들지 않는다.
    writeFileSync(path.join(vaultDir, 'NOTE.txt'), '위키 문서가 아니다.\n')

    expect(fingerprint(input)).toBe(before)
  })

  it('FG7: vault 문서를 `git mv` 로 **경로만** 변경 → **다름** (경로가 입력에 들어간다)', () => {
    const scriptsDir = makeScriptsDir()
    const vaultDir = makeGitVault()
    const input = base(scriptsDir, vaultDir)
    const before = fingerprint(input)

    git(vaultDir, ['mv', 'wiki/concept/메모리.md', 'wiki/concept/메모리소자.md'])

    expect(fingerprint(input)).not.toBe(before)
  })

  it('FG9: `sourceCommit` 만 다르다 → **다름** (히스토리 좌표가 입력)', () => {
    const scriptsDir = makeScriptsDir()
    const vaultDir = makePlainVault()

    expect(fingerprint({ ...base(scriptsDir, vaultDir), sourceCommit: COMMIT_TWO })).not.toBe(
      fingerprint({ ...base(scriptsDir, vaultDir), sourceCommit: COMMIT_ONE }),
    )
  })
})

describe('computeInputsFingerprint — 기본 scriptsDir (FG8 · pair)', () => {
  it('FG8: `scriptsDir` 생략 == 실 `sas-wiki/scripts` 명시 (기본값이 실제 생성기를 가리킨다)', () => {
    // ★ 실 파일을 **읽기만** 한다. 이 못이 없으면 tmp 주입 seam 만 검증되고, 운영 기본값이
    //   엉뚱한 디렉토리를 가리켜도(예: `lib/` 만) 아무도 모른다.
    const vaultDir = makePlainVault()
    const explicit = fingerprint({
      env: 'dev',
      scriptsDir: REAL_SCRIPTS_DIR,
      sourceCommit: COMMIT_ONE,
      vaultDir,
    })

    expect(fingerprint({ env: 'dev', sourceCommit: COMMIT_ONE, vaultDir })).toBe(explicit)
  })
})

describe('computeInputsFingerprint — vault 경계 (FG10 · pair · 보안 리뷰 반영)', () => {
  it('FG10: 심볼릭 링크 너머의 `.md` 는 입력이 아니다 · 진짜 파일은 입력이다', () => {
    // ★ 실측으로 잡힌 결함: 워커가 `fs.statSync` 를 쓰면 링크를 **추종**해 `wiki/x -> /etc` 같은 항목
    //   하나로 vault 밖 파일이 지문에 섞였다(문서 수집 쪽 `parse.mjs` 는 이미 `Dirent` 로 걸렀는데
    //   지문만 다른 워커를 써서 생긴 비대칭).
    const scriptsDir = makeScriptsDir()
    const vaultDir = makePlainVault()
    const outside = track(mkdtempSync(path.join(tmpdir(), 'wiki-fp-outside-')))
    writeFileSync(path.join(outside, '비밀.md'), '# vault 밖 문서\n')

    const before = fingerprint(base(scriptsDir, vaultDir))
    symlinkSync(outside, path.join(vaultDir, 'wiki', 'company', '링크'), 'dir')

    expect(fingerprint(base(scriptsDir, vaultDir))).toBe(before)

    // 앵커(규범 B): 워커가 죽어 있어서 "안 바뀐" 것이 아니다 — 같은 자리에 **진짜** 파일을 두면 바뀐다.
    writeFileSync(path.join(vaultDir, 'wiki', 'company', '진짜.md'), '# vault 안 문서\n')
    expect(fingerprint(base(scriptsDir, vaultDir))).not.toBe(before)
  })
})
