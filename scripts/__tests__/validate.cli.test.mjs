// @vitest-environment node
//
// validate.mjs CLI 계약(인자 분리 · shallow/partial 가드 · 통계 출력 · 리포트 소유) — 구 build.cli.test.
//
// build.mjs → validate.mjs 재정리 반영: summary `--out` 산출은 제거됐다. CLI 는 무결성 검증과
//   리포트 출력의 소유자다 — 통과 시 exit 0, 위반(컨벤션·스키마·unresolved·shallow·partial) 시
//   exit 1(fail-loud). 인자·게이트·통계 단언은 의미 보존.
//
// subprocess 는 **여기서만** 쓴다(CLI 회귀). 나머지는 in-process — 커버리지 계측 때문이다.
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs' // prettier-ignore
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { parseArgs } from '../validate.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT_DIR = path.resolve(HERE, '..')
const VALIDATE_SCRIPT = path.join(SCRIPT_DIR, 'validate.mjs')
const REAL_SCHEMA_DIR = path.join(SCRIPT_DIR, 'schema')

const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'
let tick = 1_136_239_445

const ctx = {
  badSchema: '',
  partial: '',
  shallow: '',
  strayFeedSha: '',
  tmp: '',
  unresolvedVault: '',
  vault: '',
}

function commit(cwd, message) {
  const date = nextDate()
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(cwd, ['rev-parse', 'HEAD'])
}

function git(cwd, args, extraEnv = {}) {
  return execFileSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: EMAIL,
      GIT_AUTHOR_NAME: NAME,
      GIT_COMMITTER_EMAIL: EMAIL,
      GIT_COMMITTER_NAME: NAME,
      ...extraEnv,
    },
  }).trim()
}

function nextDate() {
  tick += 60
  return `${tick} +0000`
}

// frontmatter 저작 UUIDv7 doc id — 결정적 counter(문서마다 유일).
let idSeq = 0
function nextDocId() {
  return `0192f0d0-0000-7000-8000-${(idSeq += 1).toString(16).padStart(12, '0')}`
}

function runCli(args) {
  return spawnSync(process.execPath, [VALIDATE_SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, SOURCE_DATE_EPOCH: '1700000000' },
  })
}

function writeDoc(root, rel, title) {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(
    full,
    [
      '---',
      `id: "${nextDocId()}"`,
      `title: ${title}`,
      'type: concept',
      'status: active',
      'tags: ["반도체"]',
      '---',
      '',
      '## 정의',
      '',
      `${title} 문서의 정의 문단이다.`,
      '',
      '## 로드맵',
      '',
      '세대 전환을 준비한다.',
      '',
    ].join('\n'),
  )
}

function writeStray(root, text) {
  // frontmatter 가 **없는** vault md — 문서가 아니다(parseMarkdownFile → null). 이 파일을 건드린 feed
  // 커밋의 diff 경로는 역인덱스로도 삭제집합으로도 해석되지 않는다 → **unresolvedPaths 로 집계**돼야 한다.
  const full = path.join(root, 'wiki', 'concept', '메모장.md')
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, `${text}\n`)
}

beforeAll(() => {
  ctx.tmp = mkdtempSync(path.join(tmpdir(), 'wiki-cli-'))
  ctx.vault = path.join(ctx.tmp, 'vault-repo')
  mkdirSync(ctx.vault, { recursive: true })
  git(ctx.vault, ['init', '-q'])

  writeDoc(ctx.vault, 'concept/foo', '삼성전자')
  commit(ctx.vault, 'chore: 삼성전자 문서 생성')

  writeFileSync(
    path.join(ctx.vault, 'wiki', 'concept', 'foo.md'),
    `${readFileSync(path.join(ctx.vault, 'wiki', 'concept', 'foo.md'), 'utf8')}\nHBM4 로드맵을 공개했다.\n`,
  )
  commit(
    ctx.vault,
    'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking',
  )

  // prune 시나리오 — 삭제될 문서 + 그 문서를 가리키는 피드
  writeDoc(ctx.vault, 'misc/del-me', '폐기문서')
  commit(ctx.vault, 'chore: 폐기문서 문서 생성')
  writeFileSync(
    path.join(ctx.vault, 'wiki', 'misc', 'del-me.md'),
    `${readFileSync(path.join(ctx.vault, 'wiki', 'misc', 'del-me.md'), 'utf8')}\n정리 대상이다.\n`,
  )
  commit(ctx.vault, 'feed: 폐기문서 관련 소식\n\n본문.\n\nKeywords: 정리\nImportance: normal')
  git(ctx.vault, ['rm', '-q', 'wiki/misc/del-me.md'])
  commit(ctx.vault, 'chore: 폐기문서 삭제')

  // 해석 불가(unresolved) 시나리오는 **별도 vault** 다 — 본 vault 에 섞으면 컨벤션 가드가 먼저 죽인다.
  ctx.unresolvedVault = path.join(ctx.tmp, 'unresolved-repo')
  mkdirSync(ctx.unresolvedVault, { recursive: true })
  git(ctx.unresolvedVault, ['init', '-q'])
  writeDoc(ctx.unresolvedVault, 'concept/foo', '삼성전자')
  commit(ctx.unresolvedVault, 'chore: 삼성전자 문서 생성')
  writeStray(ctx.unresolvedVault, '# 메모\n\n프론트매터가 없는 임시 메모다.')
  commit(ctx.unresolvedVault, 'chore: 임시 메모 추가')
  writeStray(ctx.unresolvedVault, '# 메모\n\n갱신된 메모다.')
  writeFileSync(
    path.join(ctx.unresolvedVault, 'wiki', 'concept', 'foo.md'),
    `${readFileSync(path.join(ctx.unresolvedVault, 'wiki', 'concept', 'foo.md'), 'utf8')}\nHBM4 로드맵을 공개했다.\n`,
  )
  ctx.strayFeedSha = commit(
    ctx.unresolvedVault,
    'feed: 삼성전자 HBM4 로드맵 공개\n\n본문.\n\nKeywords: HBM\nImportance: breaking',
  )

  // shallow clone — 생성 커밋이 잘려 문서 id 가 조용히 틀어진다
  const gitDir = git(ctx.vault, ['rev-parse', '--absolute-git-dir'])
  ctx.shallow = path.join(ctx.tmp, 'shallow')
  execFileSync('git', ['clone', '--depth=1', '-q', `file://${gitDir}`, ctx.shallow], {
    encoding: 'utf8',
  })

  // partial clone(blob 필터) — blob 이 지연 로드돼 검증이 조용히 어긋난다
  ctx.partial = path.join(ctx.tmp, 'partial')
  execFileSync('git', ['clone', '-q', `file://${gitDir}`, ctx.partial], { encoding: 'utf8' })
  git(ctx.partial, ['config', 'remote.origin.partialclonefilter', 'blob:none'])

  // 스키마 위반을 강제하는 --schema 디렉토리(입력 스키마는 실물 재사용)
  ctx.badSchema = path.join(ctx.tmp, 'bad-schema')
  mkdirSync(ctx.badSchema, { recursive: true })
  copyFileSync(
    path.join(REAL_SCHEMA_DIR, 'wiki-doc.schema.json'),
    path.join(ctx.badSchema, 'wiki-doc.schema.json'),
  )
  writeFileSync(
    path.join(ctx.badSchema, 'summary.schema.json'),
    JSON.stringify({ required: ['NOPE'], type: 'object' }),
  )
  for (const file of ['feeds.schema.json', 'body.schema.json']) {
    writeFileSync(path.join(ctx.badSchema, file), JSON.stringify({ type: 'object' }))
  }
})

afterAll(() => {
  if (ctx.tmp) rmSync(ctx.tmp, { force: true, recursive: true })
})

describe('parseArgs — 인자 분리(--report/--root 폐기)', () => {
  // P2(contract-simplify) 계약 반전 — tdd §4 원장 ⑨ / §3.8 DK5·DK6·DK7.
  // **왜 바뀌었나(R3 + PRD D11)**: 불리언 `--allow-deadlinks` 는 심각도를 표현하지 못한다. 조사한 모든
  //   도구가 심각도를 **설정 가능**하게 뒀고(수렴점), 기본을 `warn` 으로 내리는 것은 리서치가 아니라
  //   **PRD D11**(빌드실패 → 런타임 UX)의 제품 결정이다. 옛 플래그는 실호출자가 0이므로 **호환 별칭으로
  //   남기지 않는다**(호환 분기는 이 PRD 가 금지한다). 별칭 부재·enum fail-loud·기본값은
  //   `scripts/__tests__/validate.deadlinks.test.mjs` 의 DK5·DK6·DK7 이 문다.
  it('--vault·--schema·--deadlinks 를 절대경로/enum 으로 파싱한다', () => {
    const options = parseArgs(['--vault', 'sas-wiki', '--deadlinks', 'error'])

    expect(options.vault).toBe(path.resolve('sas-wiki'))
    expect(options.deadlinks).toBe('error')
    // 서브모듈에는 schema/ 가 없다(실측) → 기본값은 **스크립트 옆** schema/ 다.
    expect(options.schema).toBe(REAL_SCHEMA_DIR)
  })

  it('--schema 를 주면 그 디렉토리를 쓴다', () => {
    const options = parseArgs(['--vault', 'v', '--schema', 'custom/schema'])

    expect(options.schema).toBe(path.resolve('custom/schema'))
  })

  // ★ 출력 인자 이름을 4 CLI 가 하나로 쓴다 — `--out`. 예전엔 validate 만 `--report` 였는데, 호출자
  //   입장에서 "이 스크립트가 만드는 것을 어디에 쓸까"는 같은 질문이라 이름이 갈릴 이유가 없었다.
  //   인자가 **디렉토리**인 것과 파일 2개(json·txt)를 쓰는 것은 그대로다 — 바뀐 것은 이름뿐이다.
  // ★ 옵션 키가 `out` 이 아니라 `reportDir` 인 이유: `buildContent({ out, … })` 로 **죽은** `out` 을
  //   넘기는 호출부가 이 리포에 40여 곳 남아 있다(구 build.mjs 계약 잔재 · 지금은 전부 무시된다).
  //   키를 `out` 으로 잡으면 그것들이 전부 조용히 되살아나 tmp 마다 리포트를 쓰기 시작한다.
  //   플래그 이름과 옵션 키를 가르는 것은 `summary.mjs`(`--out` → `artifactPath`)의 선례 그대로다.
  it('--out 은 리포트 디렉토리로 받는다(--vault 기준 상대 경로 해석)', () => {
    const options = parseArgs(['--vault', 'v', '--out', 'logs'])

    expect(options.reportDir).toBe(path.join(path.resolve('v'), 'logs'))
  })

  it('--out 미지정이면 리포트 경로가 없다(기본값을 두지 않는다)', () => {
    expect(parseArgs(['--vault', 'v']).reportDir).toBeUndefined()
  })

  it('--report 는 거부한다(호환 별칭 금지 — `--out` 으로 대체됐다)', () => {
    expect(() => parseArgs(['--vault', 'v', '--report', 'logs'])).toThrow(/--out/)
  })

  it('--root 는 거부한다(호환 별칭 금지)', () => {
    expect(() => parseArgs(['--root', 'sas-wiki'])).toThrow(/--vault/)
  })

  it('--vault 누락 시 스크립트 자기 리포 루트로 기본값 파생한다(cwd 조용한 폴백 아님 — D3)', () => {
    // D3: --vault 필수→선택. 기본값은 cwd 가 아니라 import.meta.url 로 파생한 스크립트 자기 리포 루트.
    // 원장 ⑨: 옛 `--allow-deadlinks` 는 P2 에서 제거된다 → 인자 없이 기본값 파생을 확인한다.
    const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
    expect(parseArgs([]).vault).toBe(REPO_ROOT)
  })
})

describe('validate CLI — 히스토리 무결성 선제 fail', () => {
  it('shallow 리포는 이유와 복구 명령을 담아 실패한다', () => {
    const result = runCli(['--vault', ctx.shallow])

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/shallow|얕은/i)
    expect(`${result.stderr}${result.stdout}`).toMatch(/fetch-depth|unshallow|fetch/i)
  })

  it('partial clone(blob 필터)도 실패한다', () => {
    const result = runCli(['--vault', ctx.partial])

    expect(result.status).not.toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/partial|blob/i)
  })

  it('정상 full clone 은 성공한다(과잉 검출 방지)', () => {
    const result = runCli(['--vault', ctx.vault])

    expect(result.status).toBe(0)
  })
})

describe('validate CLI — JSON 미생산 · vault 무오염', () => {
  it('무결성 통과해도 JSON 을 만들지 않고 vault 워킹트리를 더럽히지 않는다', () => {
    const result = runCli(['--vault', ctx.vault])

    expect(result.status).toBe(0)
    // validate 는 검증 전용 — 산출 JSON 을 vault 어디에도 쓰지 않는다.
    for (const file of ['wiki_summary.json', 'wiki_feeds.json', 'wiki_body.json']) {
      expect(existsSync(path.join(ctx.vault, file)), file).toBe(false)
      expect(existsSync(path.join(ctx.vault, 'wiki', file)), file).toBe(false)
    }
    expect(git(ctx.vault, ['status', '--porcelain'])).toBe('')
  })

  it('content.json·prototype.html 을 더 이상 만들지 않는다', () => {
    runCli(['--vault', ctx.vault])

    expect(existsSync(path.join(ctx.vault, 'content.json'))).toBe(false)
    expect(existsSync(path.join(ctx.vault, 'prototype.html'))).toBe(false)
  })

  it('스키마 위반은 exit 1 로 죽는다', () => {
    const result = runCli(['--vault', ctx.vault, '--schema', ctx.badSchema])

    expect(result.status).toBe(1)
    expect(`${result.stderr}${result.stdout}`).toMatch(/스키마|schema|NOPE/i)
  })
})

describe('validate CLI — 통계 stdout (조용한 유실 종료)', () => {
  it('docs·feeds·prune·unresolved·warnings 를 stdout 에 낸다', () => {
    const result = runCli(['--vault', ctx.vault])

    for (const token of ['docs=', 'feeds=', 'prune=', 'unresolved=', 'warnings=']) {
      expect(result.stdout, token).toContain(token)
    }
  })

  it('해석 실패 경로는 sha·경로를 담아 exit 1 로 죽는다', () => {
    // "삭제 이력으로도 설명되지 않는" 경로는 데이터 결함이므로 통과시키지 않고 중단한다.
    const result = runCli(['--vault', ctx.unresolvedVault])

    expect(result.status).toBe(1)
    const output = `${result.stderr}${result.stdout}`
    expect(output).toContain('wiki/concept/메모장.md')
    expect(output).toContain(ctx.strayFeedSha.slice(0, 12))
  })

  it('prune 건수가 stdout 에 나온다', () => {
    const result = runCli(['--vault', ctx.vault])

    expect(result.stdout).toContain('prune=1')
  })
})

// ────────────────────────────────────────────────────────────────────────────
// RP(이사분) — 리포트 소유권이 생성기에서 **게이트로 되돌아온다** (v3 P1 Task 7 · D5·D24 · §4.3 ⑦)
//
// 이 다섯 케이스는 `summary.generator.test.mjs` 의 RP1~RP5 가 **검사하던 것을 그대로** 검사한다 —
//   바뀌는 것은 **호출 대상**뿐이다(생성기 → `validate.mjs --out`). 삭제가 아니라 이사이므로,
//   원본 RP1~RP5 의 제거는 **GREEN 원자 커밋의 몫**이다(규범 L: RED 커밋에 삭제 0건).
//   ☞ 그때까지 두 벌이 공존하고, 그 공존 자체가 "옮겼다" 의 증거다.
//
// ★ RP2 는 **축 교체**다: 옛 케이스는 _"두 리포트가 캐시와 같은 상관 토큰을 담는다"_ 를 물었는데
//   그 축이 사라진다. 같은 질문("이 리포트가 저 산출물의 것인가")을 `sourceCommit` 으로 다시 묻는다 —
//   **판정이 아니라 관측**이므로 v3 D1 위반이 아니다(§3.12 와 같은 계약).
//
// ★ 왜 exit code 를 여기서 단언하지 않는가: 게이트 판정 축은 `validate.exclusion.test.mjs`(VD2·VD3)와
//   위의 CLI 절이 소유한다. 여기서 무는 것은 **관측 채널이 실제로 발행되는가** 뿐이고, 그 둘은 서로
//   독립이어야 한다 — _"관측 실패를 산출물 실패로 승격하지 않는다"_(D-F)의 반대 방향이 곧 이것이다.
//
// ★ 인자 이름은 `--report` → **`--out`** 으로 바뀌었다(4 CLI 통일). 디렉토리를 받아 json·txt 2파일을
//   쓴다는 계약 자체는 그대로이므로 아래 다섯 케이스가 무는 것도 그대로다.
// 규범 A: 경로 조각·파일명은 **리터럴**이다(plan Task 7 이 확정한 형태 그대로).
// 규범 F: 실 vault 를 건드리지 않는다 — 이 절의 vault 는 전부 tmp 다.
// ────────────────────────────────────────────────────────────────────────────

const reportJsonIn = (dir, env) => path.join(dir, `summary.report.${env}.json`)
const reportTxtIn = (dir, env) => path.join(dir, `summary.report.${env}.txt`)
const readReport = (file) => JSON.parse(readFileSync(file, 'utf8'))

function freshReportDir() {
  const dir = mkdtempSync(path.join(tmpdir(), 'wiki-report-'))
  reportDirs.push(dir)
  return dir
}

const reportDirs = []
afterAll(() => {
  for (const dir of reportDirs) rmSync(dir, { force: true, recursive: true })
})

describe('리포트 소유권 이사 (RP1~RP5)', () => {
  it('RP1: `--out <dir>` 가 json·txt **2파일**을 만든다', () => {
    const dir = freshReportDir()
    // 앵커: 실행 **전에는 없다**(원래 있던 파일을 보고 통과하는 것을 배제).
    expect(existsSync(reportJsonIn(dir, 'dev'))).toBe(false)

    const result = runCli(['--vault', ctx.vault, '--env', 'dev', '--out', dir])

    expect(existsSync(reportJsonIn(dir, 'dev')), `${result.stderr}${result.stdout}`).toBe(true)
    expect(existsSync(reportTxtIn(dir, 'dev'))).toBe(true)
  })

  it('RP2: 두 리포트가 **산출물과 같은 `sourceCommit`** 을 담는다 (세대 어긋남 방어 · 축 교체)', () => {
    const dir = freshReportDir()

    runCli(['--vault', ctx.vault, '--env', 'dev', '--out', dir])

    expect(existsSync(reportJsonIn(dir, 'dev'))).toBe(true) // 앵커 ①: 파일이 실재한다
    const report = readReport(reportJsonIn(dir, 'dev'))
    // 앵커 ②: 값이 **40자 hex** 다(빈 문자열끼리 일치하는 공허 통과 배제).
    expect(report.sourceCommit).toMatch(/^[0-9a-f]{40}$/)
    expect(report.sourceCommit).toBe(git(ctx.vault, ['rev-parse', 'HEAD']))
    expect(readFileSync(reportTxtIn(dir, 'dev'), 'utf8')).toContain(report.sourceCommit)
  })

  it('RP3: 제외가 있는 vault 의 리포트가 excluded 를 담고 카운터와 정합한다', async () => {
    // 앵커: 이 vault 는 **실제로** 제외 문서를 갖는다(0 == 0 으로 공허 통과하는 것을 배제) —
    //   `validate.exclusion.test.mjs` VD2 가 같은 픽스처로 그 사실을 이미 못박는다.
    const { seedPollutedVault } = await import(
      new URL('./helpers/polluted-vault.mjs', import.meta.url).href
    )
    const polluted = seedPollutedVault()
    reportDirs.push(polluted.vault)
    const dir = freshReportDir()

    runCli(['--vault', polluted.vault, '--env', 'dev', '--max-excluded', '2', '--out', dir])

    expect(existsSync(reportJsonIn(dir, 'dev'))).toBe(true)
    const report = readReport(reportJsonIn(dir, 'dev'))
    expect(report.excluded).toHaveLength(2)
    for (const entry of report.excluded) {
      expect(Object.keys(entry).toSorted()).toEqual(['id', 'message', 'path', 'reasonCode'])
    }
    // 배열 길이와 카운터의 **정합**까지 본다 — 둘이 갈리면 리포트를 믿을 수 없다.
    expect(report.summary.excluded).toBe(2)
  })

  it('RP4: 리포트를 못 써도 **게이트 판정 자체는 살아 있다**', () => {
    // ★ D-F "관측 실패를 산출물 실패로 승격하지 않는다" 의 게이트 판(版). 로그를 못 썼다고 검증
    //   결과를 버리는 것은 우선순위가 뒤집힌 것이다.
    const blocker = path.join(ctx.tmp, 'report-blocker')
    writeFileSync(blocker, 'not a directory')

    const result = runCli(['--vault', ctx.vault, '--env', 'dev', '--out', blocker])

    // 앵커: 같은 vault 가 정상 `--out` 에서는 통과한다(vault 자체가 깨져서 통과하는 것 배제).
    const control = runCli(['--vault', ctx.vault, '--env', 'dev', '--out', freshReportDir()])
    expect(control.status, control.stderr).toBe(0)

    // 판정은 그대로 0 이고, **무엇이 왜** 실패했는지는 stderr 가 말한다.
    expect(result.status, `${result.stderr}${result.stdout}`).toBe(0)
    expect(`${result.stderr}${result.stdout}`).toMatch(/report|리포트/i)
  })

  it('RP5: 생성된 report.json 이 `report.schema.json` 을 통과한다', async () => {
    const { loadSchema, validateItem } = await import(
      new URL('../lib/schema-validator.mjs', import.meta.url).href
    )
    const schemaPath = path.join(REAL_SCHEMA_DIR, 'report.schema.json')
    const dir = freshReportDir()

    runCli(['--vault', ctx.vault, '--env', 'dev', '--out', dir])

    expect(existsSync(schemaPath)).toBe(true) // 앵커: 스키마가 실재한다(자기 스키마 드리프트 차단)
    expect(existsSync(reportJsonIn(dir, 'dev'))).toBe(true)
    expect(
      validateItem(readReport(reportJsonIn(dir, 'dev')), loadSchema(schemaPath), 'report.json'),
    ).toEqual([])
  })
})

// ────────────────────────────────────────────────────────────────────────────
// 결론 요약 stdout (SM1~SM3) — 다른 3 CLI 와 같은 규약: **기본은 stdout, `--out` 이면 파일까지**.
//
// 예전엔 vault 상태 결론(총계·제외·sourceCommit)이 `--report` 파일에만 있었다. 그래서 리포트를
//   요청하지 않고 돌리면 게이트 실패 시 "무엇이 왜 막혔는가" 는 에러 문구 한 줄뿐이었다.
//
// ★ 이 요약은 **게이트보다 먼저** 나온다(리포트 파일이 그런 것과 같은 이유 · D-F). 진단은 검증이
//   통과할 때가 아니라 **막힐 때** 가장 필요하다. SM2 가 그 순서를 무는 케이스다.
//
// ★ SM4 는 **그 원칙의 남은 구멍**을 문다. 리포트 파일 쓰기는 게이트보다 먼저 시도되지만, 그 실패
//   통지(`report error`)는 `buildContent` 가 **반환한 뒤** `main` 이 냈다. 그래서 쓰기가 실패한 채로
//   게이트까지 막으면 반환이 일어나지 않아 **통지가 통째로 사라졌다**(실측: 통과하는 vault 에서는
//   나오고 막히는 vault 에서는 안 나온다). "관측이 가장 필요한 순간에 관측이 사라진다" 는 이 절의
//   전제와 정면으로 어긋난다.
// ────────────────────────────────────────────────────────────────────────────

describe('결론 요약 stdout (SM1~SM4)', () => {
  it('SM1: `--out` 없이도 결론 요약을 stdout 에 내고, 파일은 쓰지 않는다', () => {
    const result = runCli(['--vault', ctx.vault, '--env', 'dev'])

    expect(result.status, `${result.stderr}${result.stdout}`).toBe(0)
    expect(result.stdout).toMatch(/total=\d+ included=\d+ excluded=\d+/)
    // 요약이 stdout 으로 나온다고 해서 리포트 파일이 딸려 나오지는 않는다(vault 무오염 계약 유지).
    expect(existsSync(path.join(ctx.vault, 'logs'))).toBe(false)
  })

  it('SM2: 게이트가 막아도 결론 요약은 stdout 에 남는다', () => {
    // 앵커 ①: 이 vault 는 **실제로** 게이트에 걸린다(통과한 실행을 보고 통과하는 것을 배제).
    const result = runCli(['--vault', ctx.unresolvedVault, '--env', 'dev'])
    expect(result.status).toBe(1)

    // 앵커 ②: 게이트 뒤에서 나오는 통계 줄은 **없다** — 그러므로 아래 요약은 게이트 **앞**에서
    //   나온 것이고, 이 케이스가 무는 것이 순서라는 사실이 공허해지지 않는다.
    expect(result.stdout).not.toContain('[wiki] docs=')

    expect(result.stdout).toMatch(/total=\d+ included=\d+ excluded=\d+/)
    expect(result.stdout).toMatch(/sourceCommit=[0-9a-f]{40}/)
  })

  it('SM3: 요약의 총계가 리포트 파일의 총계와 같다(두 채널이 갈리지 않는다)', () => {
    const dir = freshReportDir()

    const result = runCli(['--vault', ctx.vault, '--env', 'dev', '--out', dir])

    const report = readReport(reportJsonIn(dir, 'dev'))
    // 앵커: 파일 쪽 값이 **실재하는 수**다(0 == 0 으로 공허 통과하는 것을 배제).
    expect(report.summary.total).toBeGreaterThan(0)
    expect(result.stdout).toContain(
      `total=${report.summary.total} included=${report.summary.included} excluded=${report.summary.excluded}`,
    )
    expect(result.stdout).toContain(`sourceCommit=${report.sourceCommit}`)
  })

  it('SM4: 리포트 파일을 못 써도 게이트가 막는 상황에서 그 사실이 유실되지 않는다', () => {
    // 디렉토리 자리에 **파일**을 둔다 → `writeReport` 의 mkdir 이 EEXIST 로 실패한다.
    const blocker = path.join(ctx.tmp, 'report-blocker-with-gate')
    writeFileSync(blocker, 'not a directory')

    // 앵커 ①: 같은 blocker 로 **게이트를 통과하는** vault 를 돌리면 통지가 나온다(RP4 와 같은 축).
    //   즉 blocker 는 쓰기를 확실히 실패시키고, 통지 문구도 실재한다 — 아래 단언이 "원래 안 나오는
    //   문구를 찾는" 공허가 되지 않는다.
    const control = runCli(['--vault', ctx.vault, '--env', 'dev', '--out', blocker])
    expect(control.status, `${control.stderr}${control.stdout}`).toBe(0)
    expect(`${control.stderr}${control.stdout}`).toContain('report error')

    const result = runCli(['--vault', ctx.unresolvedVault, '--env', 'dev', '--out', blocker])

    // 앵커 ②: 게이트가 **실제로** 막았다(통과한 실행을 보고 통과하는 것을 배제).
    expect(result.status).toBe(1)
    // 본체: 그래도 쓰기 실패 통지가 남는다. 게이트 에러가 그것을 잡아먹지 않는다.
    expect(`${result.stderr}${result.stdout}`).toContain('report error')
  })
})
