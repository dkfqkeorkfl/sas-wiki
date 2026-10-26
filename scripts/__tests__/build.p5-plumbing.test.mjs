// @vitest-environment node
//
// P5 · Task 10 — 배관 (F-17·F-29 · 경로 형태 고정) — tdd §3.12 (PL9~PL12)
//
// 이 파일이 **경로의 정확 형태를 고정하는 유일한 자리**다(P4 AR1↔㉖ 선례). FA1·FA9 는 *성질*만 물고
//   (env 로 갈린다 · `cache/` 하위다 · 공존한다) 여기서 한 번만 리터럴로 못박는다 — 둘이 같은 것을
//   두 번 물면 이름을 바꿀 때 두 곳이 따로 논다.
//
// 이 파일의 앵커:
//   · PL9 — `feedsArtifactPath`·`reportPath` 의 리터럴 경로를 고정한다.
//   · PL11 — 리포트에 prune 진단 3키가 있고 `report.schema.json` 이 선언한다.
//   · PL10 — `.gitignore` 가 이미 `cache`·`logs` 를 덮으므로 **오늘도 성립**한다. 그러나 "덮는다" 를
//     추정하지 않고 **실측**하는 것이 이 케이스의 값이다 — 새 산출물이 그 규칙 밖으로 나가는 순간
//     red 가 된다(예: `.cache/` 나 `reports/` 로 옮기는 구현).
//   · PL12 — **pin**. 소비자 spawn 경로(`<wikiRoot>/scripts/<name>.mjs`)가 여기에 결속돼 있다.
//
// PL13(gitlink 일치)은 **자동 단언으로 만들지 않는다** — 커밋 주체가 다르고(메인 에이전트 전담)
//   서브모듈 포인터는 테스트가 좌우할 값이 아니다. tdd §8-18 측정 항목으로 남는다.
//
// 규범 A: 경로 문자열·스크립트 문자열은 **리터럴**이다. 규범 B: "더럽히지 않는다" 앞에 **더럽혀지는
//   경우**를, "값이 있다" 앞에 **prune 이 실제로 일어난 vault** 를 둔다. 규범 F: 실 vault 는 읽기만.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs' // prettier-ignore
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { prebuildArtifacts } from './helpers/prebuild-artifacts.mjs'
import { cleanup, commit, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs' // prettier-ignore
import { runGeneratorOnce } from './helpers/generator-race.mjs'

const artifactModule = await import(new URL('../lib/artifact.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')
const REPO_GITIGNORE = path.join(REPO_ROOT, '.gitignore')
const REPORT_SCHEMA = path.join(SCRIPTS_DIR, 'schema', 'report.schema.json')
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')

/** 리포트 top-level 프로퍼티 — F-17. 리터럴이다. */
const REPORT_PROPERTY_KEYS = [
  'env',
  'excluded',
  'generatedAt',
  'invalidExcludedRefs',
  'prunedFeeds',
  'schemaVersion',
  'sourceCommit',
  'summary',
  'unresolvedPaths',
]

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const REL_A = 'company/삼성전자'
const STRAY_PATH = 'wiki/concept/메모장.md'

const tmps = []
afterAll(() => cleanup(...tmps))

describe('경로 정확 형태 고정 (PL9)', () => {
  it('PL9: `feedsArtifactPath`·`reportPath` 가 리터럴 형태와 정확히 일치한다', () => {
    const vault = path.resolve('/v')

    if (typeof artifactModule.feedsArtifactPath !== 'function') {
      throw new Error('[RED] scripts/lib/artifact.mjs 에 feedsArtifactPath export 가 아직 없다')
    }
    if (typeof artifactModule.reportPath !== 'function') {
      throw new Error('[RED] scripts/lib/artifact.mjs 에 reportPath export 가 아직 없다')
    }

    expect(artifactModule.feedsArtifactPath(vault, 'dev')).toBe(
      path.join(vault, 'cache', 'feeds.dev.json'),
    )
    expect(artifactModule.feedsArtifactPath(vault, 'prod')).toBe(
      path.join(vault, 'cache', 'feeds.prod.json'),
    )
    expect(artifactModule.reportPath(vault, 'dev', 'json')).toBe(
      path.join(vault, 'logs', 'summary.report.dev.json'),
    )
    expect(artifactModule.reportPath(vault, 'prod', 'txt')).toBe(
      path.join(vault, 'logs', 'summary.report.prod.txt'),
    )
    // 기존 슬롯은 그대로다 — 새 산출물이 옛 것을 덮어쓰지 않는다.
    // ★ v3 P4 · D27(tdd §4.3) — **축 교체**. 예전에는 `artifactModule.artifactPath(vault,'dev')` 의
    //   반환을 리터럴과 대조했으나 그 함수가 사라졌다(summary 좌표는 이제 `--summary` 를 넘기는
    //   **호출자**가 소유한다). 이 줄이 원래 무는 것은 「새 산출물이 summary 슬롯을 덮어쓰지
    //   않는다」였고, 그 주장은 함수 없이 **리터럴 조립**(규범 A)만으로 그대로 선다.
    const summarySlot = path.join(vault, 'cache', 'summary.dev.json')
    expect(artifactModule.feedsArtifactPath(vault, 'dev')).not.toBe(summarySlot)
    expect(artifactModule.reportPath(vault, 'dev', 'json')).not.toBe(summarySlot)
  })
})

describe('3 산출물이 워킹트리를 더럽히지 않는다 (PL10 · 실측 · `.gitignore` 추정 금지)', () => {
  it(
    'PL10: 생성기 실행 후 `git status --porcelain` 이 비어 있다',
    { timeout: 300_000 },
    async () => {
      // **실 리포의 `.gitignore` 를 그대로 복사**해 쓴다 — tmp 전용 규칙을 새로 쓰면 "테스트가 만든
      //   ignore 규칙" 을 검증하게 되어 아무 의미가 없다.
      const vault = initVault()
      tmps.push(vault)
      expect(existsSync(REPO_GITIGNORE)).toBe(true)
      copyFileSync(REPO_GITIGNORE, path.join(vault, '.gitignore'))
      writeDoc(vault, REL_A, { body: '## 정의\n\n본문.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
      commit(vault, 'chore: 문서 1건 + gitignore')

      await prebuildArtifacts(vault, 'dev')
      expect(git(vault, ['status', '--porcelain'])).toBe('')

      // 앵커: **문서를 하나 만들면 porcelain 이 비지 않는다**(git 이 죽어서 늘 빈 것을 배제).
      writeDoc(vault, 'concept/새문서', { body: '## 정의\n\n새 문서다.\n', id: ID_A })
      expect(git(vault, ['status', '--porcelain'])).not.toBe('')
    },
  )
})

describe('소비자 spawn 경로 결속 (PL12 · 🟢pin)', () => {
  it('PL12: `package.json` scripts 의 3개 엔트리가 그대로다', () => {
    // `plugin.ts` 가 `<wikiRoot>/scripts/<name>.mjs` 를 spawn 한다 — 파일명이 바뀌면 소비자가 죽는다.
    const scripts = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).scripts

    expect(scripts.summary).toBe('node scripts/summary.mjs')
    // ★ v3 P2 · D15(§4.5-⑤ flip) — `--count` 필수화의 귀결. 결속의 주제(파일명·경로)는 그대로다.
    expect(scripts.feeds).toBe('node scripts/feeds.mjs --count 40')
    // wiki 는 `--file` 로 지정한 마크다운 하나를 읽는다. 사람용 스크립트도 그 절대·상대 경로
    // 인자를 싣고, summary 아티팩트나 환경 인자를 요구하지 않는다.
    expect(scripts.wiki).toBe('node scripts/wiki.mjs --file wiki/KOSPI/삼성전자/삼성전자.md')
    for (const name of ['summary.mjs', 'feeds.mjs', 'wiki.mjs']) {
      expect(existsSync(path.join(SCRIPTS_DIR, name))).toBe(true)
    }
  })
})
