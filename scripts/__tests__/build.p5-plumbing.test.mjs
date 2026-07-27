// @vitest-environment node
//
// P5 · Task 10 — 배관 (F-17·F-29 · 경로 형태 고정) — tdd §3.12 (PL9~PL12)
//
// 이 파일이 **경로의 정확 형태를 고정하는 유일한 자리**다(P4 AR1↔㉖ 선례). FA1·FA9 는 *성질*만 물고
//   (env 로 갈린다 · `cache/` 하위다 · 공존한다) 여기서 한 번만 리터럴로 못박는다 — 둘이 같은 것을
//   두 번 물면 이름을 바꿀 때 두 곳이 따로 논다.
//
// RED 사유:
//   · PL9 — **RED(미구현)**. `feedsArtifactPath`·`reportPath` 가 없다.
//   · PL11 — **RED(미구현)**. 리포트에 prune 진단 3키가 없고 `report.schema.json` 도 선언하지 않는다.
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
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup, commit, feedCommit, git, initVault, writeDoc } from './helpers/tmp-git-vault.mjs' // prettier-ignore
import { runGeneratorOnce } from './helpers/generator-race.mjs'

const artifactModule = await import(new URL('../lib/artifact.mjs', import.meta.url).href)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPTS_DIR = path.resolve(HERE, '..')
const REPO_ROOT = path.resolve(SCRIPTS_DIR, '..')
const REPO_GITIGNORE = path.join(REPO_ROOT, '.gitignore')
const REPORT_SCHEMA = path.join(SCRIPTS_DIR, 'schema', 'report.schema.json')
const PACKAGE_JSON = path.join(REPO_ROOT, 'package.json')

/** 리포트 진단 3키 — F-17. 리터럴이다. */
const DIAGNOSTIC_KEYS = ['invalidExcludedRefs', 'prunedFeeds', 'unresolvedPaths']

const ID_A = '0192a000-0000-7000-8000-0000000000aa'
const REL_A = 'company/삼성전자'
const STRAY_PATH = 'wiki/concept/메모장.md'

const tmps = []
afterAll(() => cleanup(...tmps))

describe('경로 정확 형태 고정 (PL9 · 🔴RED 함수 부재)', () => {
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
    expect(artifactModule.artifactPath(vault, 'dev')).toBe(
      path.join(vault, 'cache', 'summary.dev.json'),
    )
  })
})

describe('3 산출물이 워킹트리를 더럽히지 않는다 (PL10 · 실측 · `.gitignore` 추정 금지)', () => {
  it('PL10: 생성기 실행 후 `git status --porcelain` 이 비어 있다', { timeout: 300_000 }, () => {
    // **실 리포의 `.gitignore` 를 그대로 복사**해 쓴다 — tmp 전용 규칙을 새로 쓰면 "테스트가 만든
    //   ignore 규칙" 을 검증하게 되어 아무 의미가 없다.
    const vault = initVault()
    tmps.push(vault)
    expect(existsSync(REPO_GITIGNORE)).toBe(true)
    copyFileSync(REPO_GITIGNORE, path.join(vault, '.gitignore'))
    writeDoc(vault, REL_A, { body: '## 정의\n\n본문.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
    commit(vault, 'chore: 문서 1건 + gitignore')

    expect(runGeneratorOnce({ args: ['--env', 'dev', '--status'], vault }).exitCode).toBe(0)
    expect(git(vault, ['status', '--porcelain'])).toBe('')

    // 앵커: **문서를 하나 만들면 porcelain 이 비지 않는다**(git 이 죽어서 늘 빈 것을 배제).
    writeDoc(vault, 'concept/새문서', { body: '## 정의\n\n새 문서다.\n', id: ID_A })
    expect(git(vault, ['status', '--porcelain'])).not.toBe('')
  })
})

describe('리포트 진단 3키 — F-17 (PL11 · 🔴RED 미구현)', () => {
  it(
    'PL11: prune 이 실제로 일어난 vault 에서 `prunedFeeds` 등이 **>0** 이고 스키마가 선언한다',
    { timeout: 300_000 },
    () => {
      // 진단 채널이다 — 사유는 아티팩트가 아니라 **리포트**가 받는다(D-C: 부정 정보를 발행물에 싣지 않는다).
      // 앵커: 전부 0 인 vault 로 통과하는 것을 배제하려고 **prune 이 실재하는** vault 를 만든다.
      const vault = initVault()
      tmps.push(vault)
      writeDoc(vault, REL_A, { body: '## 정의\n\n본문.\n', id: ID_A, title: '삼성전자', type: 'company' }) // prettier-ignore
      // frontmatter 가 없는 `.md` — 문서 후보이되 문서가 아니다(stray). 이것을 가리키는 피드는
      //   `unresolved` 로 fail-closed 드랍된다 → prunedFeeds·unresolvedPaths 가 실제로 올라간다.
      mkdirSync(path.join(vault, 'wiki', 'concept'), { recursive: true })
      writeFileSync(path.join(vault, STRAY_PATH), '그냥 메모다. frontmatter 가 없다.\n')
      commit(vault, 'chore: 문서 1건 + 메모 1건')
      writeFileSync(path.join(vault, STRAY_PATH), '메모를 고쳤다. 여전히 frontmatter 가 없다.\n')
      feedCommit(vault, { date: '2026-05-01T00:00:00Z', subject: '메모장 소식' })

      expect(runGeneratorOnce({ args: ['--env', 'dev', '--status'], vault }).exitCode).toBe(0)
      const report = JSON.parse(
        readFileSync(path.join(vault, 'logs', 'summary.report.dev.json'), 'utf8'),
      )

      expect(report.prunedFeeds).toBeGreaterThan(0)
      expect(report.unresolvedPaths.length).toBeGreaterThan(0)
      expect(Array.isArray(report.invalidExcludedRefs)).toBe(true)

      // 스키마가 **같은 커밋에서** 따라왔는가 — `additionalProperties:false` 라 안 따라오면 산출물이
      //   자기 스키마를 어긴다(P4 AR8 과 같은 형태).
      const schema = JSON.parse(readFileSync(REPORT_SCHEMA, 'utf8'))
      expect(Object.keys(schema.properties).toSorted()).toEqual(
        expect.arrayContaining(DIAGNOSTIC_KEYS),
      )
    },
  )
})

describe('소비자 spawn 경로 결속 (PL12 · 🟢pin)', () => {
  it('PL12: `package.json` scripts 의 4개 엔트리가 그대로다', () => {
    // `plugin.ts` 가 `<wikiRoot>/scripts/<name>.mjs` 를 spawn 한다 — 파일명이 바뀌면 소비자가 죽는다.
    const scripts = JSON.parse(readFileSync(PACKAGE_JSON, 'utf8')).scripts

    expect(scripts.summary).toBe('node scripts/summary.mjs')
    expect(scripts.feeds).toBe('node scripts/feeds.mjs')
    expect(scripts.wiki).toBe('node scripts/wiki.mjs')
    expect(scripts.validate).toBe('node scripts/validate.mjs --env dev')
    for (const name of ['summary.mjs', 'feeds.mjs', 'wiki.mjs', 'validate.mjs']) {
      expect(existsSync(path.join(SCRIPTS_DIR, name))).toBe(true)
    }
  })
})
