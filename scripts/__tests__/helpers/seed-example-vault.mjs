#!/usr/bin/env node
// 예제 vault 를 **결정적으로** 시딩한다 (plan Task 1 / tdd §4.1).
//
// 이 스크립트가 만드는 히스토리는 되돌릴 수 없다 —
//   문서 id = frontmatter 저작 UUIDv7(불변), 피드 1건 = 커밋 1건(피드 id = 커밋 해시 12자).
//   force-push·squash·rebase 가 금지되므로 잘못 쌓으면 브랜치를 버리고 처음부터 다시 만들어야 한다.
// 그래서 결정성(고정 6필드 + --no-gpg-sign)과 안전 가드(비-git·dirty·main·재시딩 거부)는
// 품질 문제가 아니라 **안전장치**다.
//
// 사용: node scripts/wiki/seed-example-vault.mjs --repo sas-wiki --branch test
// 이 스크립트는 **절대 push 하지 않는다.** push 는 사람이 명시적으로 한다.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** 예제 브랜치의 분기점. */
const BASE_BRANCH = 'main'

/**
 * 시딩이 **허용되는** 브랜치 — `test` 또는 `test-*` 뿐이다.
 *
 * 금지 목록(`main`·`seed`)이 아니라 **허용 목록**인 이유: 금지 목록은 정확 일치라서 `Main`·`MAIN`·
 * `' main'` 같은 사소한 오타 변형이 그대로 빠져나간다. `--branch` 는 사람이 손으로 치는 유일한
 * 인터페이스이므로 오타가 곧 사고다. "무엇이 위험한가"를 열거하는 대신 "무엇만 안전한가"를 못박는다.
 *
 * 왜 이렇게까지 하는가: `main` 은 서비스가 소비하는 실데이터 브랜치이고 `seed` 는 그 스테이징이다
 * (→ `main` 으로 머지된다). 어느 쪽이든 예제 `feed:` 커밋이 들어가면 빌드가 그것을 **가짜 뉴스로
 * 실서비스에 띄운다** — 빌드는 히스토리의 `feed:` 커밋을 전부 뉴스로 만들 뿐, 예제인지 구분할
 * 수단이 없다. 되돌리려면 히스토리 재작성이 필요하고 그건 피드 정체성(=커밋 해시)과 실피드를
 * 파괴한다(문서 id 는 frontmatter 라 무관하나, 감사추적 피드가 깨진다). 예제는 `test` 계열에만 쌓고,
 * 그 브랜치는 어디로도 머지하지 않는다(일방통행).
 */
const SEED_BRANCH_RE = /^test(?:-[\w.-]+)?$/

// ── 결정성 6필드 (git t/test-lib.sh 의 test_tick 관례 · build.smoke.test.mjs:28-57 미러) ──
// 하나라도 빠지면 SHA 가 환경마다 달라진다 = 문서 id 가 흔들린다.
const BOT_EMAIL = 'bot@sas.wiki'
const BOT_NAME = 'SAS Wiki Bot'
const FIRST_TICK = 1_136_239_445
const TICK_STEP = 60

/** vault 문서 루트(리포 상대). 파일명이 곧 슬러그다 — 슬러그화가 없다(`parse.mjs:99-107`). */
const WIKI_DIR = 'wiki'

const DOC_HBM = 'concept/HBM'
const DOC_HBM_MOVED = 'tech/HBM'
const DOC_HYNIX = 'company/SK하이닉스'
const DOC_MOC = 'moc/반도체'
const DOC_ONDEVICE = 'concept/온디바이스-AI'
const DOC_SAMSUNG = 'company/삼성전자'
const DOC_SCRAP = 'concept/폐기예정-메모'
const DOC_TSMC = 'company/TSMC'

// ── 문서 7종 (frontmatter 계약: schema/wiki-doc.schema.json) ────────────────────
// GOTCHA(파서가 진짜 YAML 이 아니다 — `parse.mjs:4-65`):
//   · 최상위 키는 들여쓰기 0, 중첩 맵은 1단계까지 · `meta:` 하위는 **정확히 2칸**.
//   · 숫자로만 이뤄진 값(`005930`)은 따옴표 없이 쓰면 **number 로 파싱**된다 → 스키마의 string 위반.
//   · `created`/`updated` 를 쓰면 build 가 throw 한다(git 이 채운다). `id` 는 frontmatter 에 저작한
//     불변 UUIDv7 이다(D1) — 결정성을 위해 고정 리터럴을 쓴다(랜덤 금지 → SHA 흔들림 방지).
//   · `type: company` 는 `meta.{ticker,sector,exchange}` **3키 전부** 필요(값 null 은 허용, 키 부재 불허).
// 본문은 `##` 헤딩 2~3개를 갖는다 — 피드 anchor 가 "바뀐 섹션의 heading" 이라 헤딩이 없으면 anchor 를 못 만든다.
const DOCUMENTS = {
  [DOC_HBM]: `---
id: "0192e100-0000-7000-8000-000000000004"
title: HBM
type: concept
status: active
tags: ["메모리", "AI"]
---

## 정의

HBM(High Bandwidth Memory)은 DRAM 다이를 수직으로 적층해 대역폭을 끌어올린 메모리다.

## 로드맵

HBM3E 를 거쳐 HBM4 로 세대가 이어진다.

## 공급망

[[삼성전자]] 와 [[SK하이닉스]] 가 주요 공급자이며 [[TSMC]] 가 패키징을 담당한다.
`,
  [DOC_HYNIX]: `---
id: "0192e100-0000-7000-8000-000000000002"
title: SK하이닉스
type: company
status: active
aliases: ["SK Hynix", "000660"]
tags: ["반도체", "메모리"]
meta:
  ticker: "000660"
  sector: "반도체"
  exchange: "KRX"
---

## 개요

SK하이닉스는 DRAM·NAND 를 주력으로 하는 메모리 반도체 기업이다.

## 메모리 사업

[[HBM]] 초기 시장을 선점했다.
`,
  [DOC_MOC]: `---
id: "0192e100-0000-7000-8000-000000000007"
title: 반도체
type: moc
status: active
tags: ["반도체"]
---

## 기업

- [[삼성전자]]
- [[SK하이닉스]]
- [[TSMC]]

## 기술

- [[HBM]]
- [[온디바이스-AI]]
`,
  [DOC_ONDEVICE]: `---
id: "0192e100-0000-7000-8000-000000000005"
title: 온디바이스 AI
type: concept
status: active
tags: ["AI"]
---

## 정의

온디바이스 AI 는 추론을 클라우드가 아닌 단말에서 수행하는 방식이다.

## 적용 사례

스마트폰·PC 에 NPU 가 탑재되며 저지연·프라이버시 이점을 얻는다.
`,
  [DOC_SAMSUNG]: `---
id: "0192e100-0000-7000-8000-000000000001"
title: 삼성전자
type: company
status: active
aliases: ["Samsung", "005930"]
tags: ["반도체", "메모리"]
meta:
  ticker: "005930"
  sector: "반도체"
  exchange: "KRX"
---

## 개요

삼성전자는 메모리·시스템 반도체와 완제품을 함께 다루는 종합 전자 기업이다.

## 사업 부문

DS(반도체)와 DX(디바이스 경험)로 나뉜다.

## 메모리 로드맵

[[HBM]] 세대 전환을 준비하고 있다.
`,
  [DOC_SCRAP]: `---
id: "0192e100-0000-7000-8000-000000000006"
title: 폐기예정 메모
type: concept
status: active
tags: ["임시"]
---

## 메모

정리 전 임시로 둔 메모 문서다.

## 후속

정식 문서로 승격되지 않으면 제거한다.
`,
  [DOC_TSMC]: `---
id: "0192e100-0000-7000-8000-000000000003"
title: TSMC
type: company
status: active
aliases: ["台積電", "2330"]
tags: ["반도체", "파운드리"]
meta:
  ticker: "2330"
  sector: "파운드리"
  exchange: null
---

## 개요

TSMC 는 세계 최대 파운드리 기업이다.

## 선단 공정

3nm·2nm 노드를 양산하며 [[HBM]] 패키징 수요를 함께 받는다.
`,
}

// ── 히스토리 17커밋 (순서 고정 — 시나리오가 순서에 의존한다) ─────────────────────
// GOTCHA(trailer — `feed.mjs:26-55`): 본문과 **빈 줄 1개**로 분리된 **마지막 블록**의
//   **모든 줄**이 `Key: value` 여야 trailer 로 인정된다. 한 줄만 어겨도 블록 전체가 본문으로 흡수된다
//   (= Keywords·Importance 가 조용히 사라진다).
// GOTCHA(cwiki): 신규 파일이 **정확히 1개**여야 한다 — 빌드의 커밋 컨벤션 가드가 강제한다(생성 원자성·
//   감사추적). 문서 id 는 frontmatter 저작 UUIDv7 이라 커밋 해시 충돌 문제는 없지만 규칙은 유지된다.
// GOTCHA(git mv·git rm): 내용 수정과 섞지 않는다 — rename 유사도 판정이 흔들린다.
const STEPS = [
  // 1-7 · cwiki — 문서 생성(각 문서는 frontmatter 에 저작된 UUIDv7 id 를 갖는다)
  { apply: (repo) => createDoc(repo, DOC_SAMSUNG), message: 'cwiki: 삼성전자 문서 생성' },
  { apply: (repo) => createDoc(repo, DOC_HYNIX), message: 'cwiki: SK하이닉스 문서 생성' },
  { apply: (repo) => createDoc(repo, DOC_TSMC), message: 'cwiki: TSMC 문서 생성' },
  { apply: (repo) => createDoc(repo, DOC_HBM), message: 'cwiki: HBM 문서 생성' },
  { apply: (repo) => createDoc(repo, DOC_ONDEVICE), message: 'cwiki: 온디바이스 AI 문서 생성' },
  { apply: (repo) => createDoc(repo, DOC_SCRAP), message: 'cwiki: 폐기예정 메모 문서 생성' },
  { apply: (repo) => createDoc(repo, DOC_MOC), message: 'cwiki: 반도체 MOC 문서 생성' },

  // 8 · feed — 단일 문서 피드 + anchor(바뀐 섹션의 heading)
  {
    apply: (repo) => appendDoc(repo, DOC_SAMSUNG, '12단 HBM3E 양산 승인을 획득했다.'),
    message: [
      'feed: 삼성전자, HBM3E 12단 양산 승인',
      '',
      '삼성전자가 HBM3E 12단 제품의 양산 승인을 획득했다. 하반기 공급이 시작된다.',
      '',
      'Keywords: HBM, 양산, 삼성전자',
      'Importance: breaking',
    ].join('\n'),
  },

  // 9 · feed — **다중 문서 피드**(docs[] 2건). 필터=ANY · 표시=ALL 규칙의 유일한 검증 데이터
  {
    apply: (repo) => {
      appendDoc(repo, DOC_SAMSUNG, 'HBM 장기 공급 계약을 체결했다.')
      appendDoc(repo, DOC_HYNIX, 'HBM 장기 공급 계약을 체결했다.')
    },
    message: [
      'feed: SK하이닉스·삼성전자, HBM 공급 계약 체결',
      '',
      '두 회사가 동일 고객사와 HBM 장기 공급 계약을 체결했다.',
      '',
      'Keywords: HBM, 공급계약',
      'Importance: highlight',
    ].join('\n'),
  },

  // 10 · uwiki — 뉴스 미발행 커밋(피드에 뜨지 않는다)
  {
    apply: (repo) => editDoc(repo, DOC_HBM, '대역폭을 끌어올린', '대역폭을 크게 끌어올린'),
    message: 'uwiki: HBM 문서 오탈자 수정',
  },

  // 11 · feed — 곧 이동할 문서를 가리키는 피드(#12 의 rename 추적 대상)
  {
    apply: (repo) => appendDoc(repo, DOC_HBM, 'HBM4 는 2048비트 인터페이스를 채택한다.'),
    message: [
      'feed: HBM4 로드맵 갱신',
      '',
      'HBM4 규격이 확정되며 인터페이스 폭이 두 배로 늘어난다.',
      '',
      'Keywords: HBM4, 로드맵',
      'Importance: normal',
    ].join('\n'),
  },

  // 12 · uwiki — **rename**(git mv 단독 커밋). #11 의 diff 경로를 현재 문서 id 로 매핑해야 한다.
  //   실패하면 앵커가 조용히 사라진다(`feed.mjs:108-109` 가 매칭 실패를 조용히 버린다).
  {
    apply: (repo) => moveDoc(repo, DOC_HBM, DOC_HBM_MOVED),
    message: 'uwiki: HBM 문서를 tech/ 로 이동',
  },

  // 13 · feed — 곧 비활성화될 문서를 가리키는 피드(#14 이후에도 **살아남아야** 한다)
  {
    apply: (repo) => appendDoc(repo, DOC_ONDEVICE, '주요 제조사가 NPU 탑재를 확대한다.'),
    message: [
      'feed: 온디바이스 AI, 스마트폰 탑재 확대',
      '',
      '주요 제조사가 플래그십 전 라인업에 NPU 를 탑재한다.',
      '',
      'Keywords: 온디바이스, NPU',
      'Importance: normal',
    ].join('\n'),
  },

  // 14 · uwiki — disable 전환. 과거 피드는 살아남고 점프 시 안내 화면으로 간다(스텁 4키)
  {
    apply: (repo) => editDoc(repo, DOC_ONDEVICE, 'status: active', 'status: disable'),
    message: 'uwiki: 온디바이스 AI 문서 비활성화',
  },

  // 15 · feed — 곧 삭제될 문서를 가리키는 피드(#16 의 prune 대상 — 이게 있어야 prune 이 검증된다)
  {
    apply: (repo) => appendDoc(repo, DOC_SCRAP, '정리 대상으로 분류됐다.'),
    message: [
      'feed: 폐기예정 메모 관련 소식',
      '',
      '임시 메모 문서가 정리 대상으로 분류됐다.',
      '',
      'Keywords: 정리',
      'Importance: normal',
    ].join('\n'),
  },

  // 16 · uwiki — **삭제**(git rm 단독 커밋) → #15 피드는 docs[] 가 비어 prune 된다
  { apply: (repo) => removeDoc(repo, DOC_SCRAP), message: 'uwiki: 폐기예정 메모 삭제' },

  // 17 · feed — **frontmatter 만 수정** → 본문 hunk 가 없어 anchor 가 null 이 된다(nullable 커버)
  {
    apply: (repo) => editDoc(repo, DOC_SAMSUNG, 'exchange: "KRX"', 'exchange: "KOSPI"'),
    message: [
      'feed: 삼성전자 거래소 정보 정정',
      '',
      '상장 거래소 표기를 정정했다.',
      '',
      'Keywords: 정정',
      'Importance: normal',
    ].join('\n'),
  },
]

let tick = FIRST_TICK

/**
 * 예제 vault 를 `branch` 에 결정적으로 시딩한다. **push 하지 않는다.**
 *
 * @param {{ repo: string, branch?: string }} options
 * @returns {{ branch: string, commits: string[], head: string }}
 */
export function seedVault({ branch = 'test', repo }) {
  const repoDir = path.resolve(repo)

  // ── 안전 가드 — ref·워킹트리를 건드리기 **전에** 전부 통과해야 한다.
  //    거부는 "에러를 던지는 것"이 아니라 **아무것도 만들지 않는 것**이다.
  assertGitWorktree(repoDir)
  assertClean(repoDir)
  assertSeedBranchAllowed(branch)
  assertNotSeeded(repoDir, branch)

  const baseRef = resolveBaseRef(repoDir)
  checkoutSeedBranch(repoDir, branch, baseRef)

  tick = FIRST_TICK
  const commits = STEPS.map((step) => {
    step.apply(repoDir)
    return commit(repoDir, step.message)
  })

  return { branch, commits, head: commits.at(-1) }
}

/** 파일 끝에 문단을 덧붙인다(마지막 `##` 섹션에 속하므로 anchor 가 산출된다). */
function appendDoc(repoDir, relDoc, paragraph) {
  const full = docPath(repoDir, relDoc)
  fs.writeFileSync(full, `${fs.readFileSync(full, 'utf8')}\n${paragraph}\n`, 'utf8')
}

/** 워킹트리가 클린해야 한다 — 무관한 변경이 예제 커밋에 섞이면 SHA 가 흔들리고(결정성 붕괴) 원격에 실려 나간다. */
function assertClean(repoDir) {
  const status = git(repoDir, ['status', '--porcelain'])
  if (status !== '') {
    throw new Error(`워킹트리가 dirty 하다 — 시딩을 거부한다:\n${status}`)
  }
}

/** `--repo` 오타·경로 착오를 즉시 잡는다(상위 리포로 새어 올라가는 것도 차단). */
function assertGitWorktree(repoDir) {
  if (!fs.existsSync(path.join(repoDir, '.git'))) {
    throw new Error(`git 워크트리가 아니다: ${repoDir}`)
  }
  const top = git(repoDir, ['rev-parse', '--show-toplevel'])
  if (fs.realpathSync(top) !== fs.realpathSync(repoDir)) {
    throw new Error(
      `${repoDir} 가 자기 리포의 루트가 아니다(상위 리포 '${top}' 가 응답) — 거부한다.`,
    )
  }
}

/**
 * 이미 시딩된 리포에 다시 쌓는 것을 거부한다(문서 중복·피드 2배). `--force` 는 만들지 않는다.
 *
 * **로컬 `refs/heads/<branch>` 만 보면 안 된다.** 서브모듈은 포인터(SHA)로 체크아웃되므로 보통
 * **detached HEAD** 상태이고, 이미 시딩된 커밋을 가리키고 있어도 로컬 브랜치 ref 는 없다
 * (원격 추적 ref 만 있다). 그 상태에서 로컬 ref 만 확인하면 "시딩 안 됨"으로 오판해 `main` 위에
 * 히스토리를 **처음부터 다시 쌓는다** — 베이스가 한 커밋이라도 전진해 있으면 조용히 다른 SHA 체인이
 * 만들어지고(= 문서 id 가 전부 바뀐다), push 를 시도하는 순간에야 non-fast-forward 로 알게 된다.
 * → 로컬 ref · 원격 추적 ref · 현재 HEAD 를 **전부** 본다.
 */
function assertNotSeeded(repoDir, branch) {
  const candidates = [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`, 'HEAD']
  for (const ref of candidates) {
    if (!refExists(repoDir, ref)) continue
    const tree = tryGit(repoDir, ['ls-tree', '-r', '--name-only', ref])
    if (tree.split('\n').some((line) => line.startsWith(`${WIKI_DIR}/`))) {
      throw new Error(
        `이미 vault 가 있다(${ref}) — 재시딩을 거부한다(중복 적재).\n` +
          `다시 만들려면 그 브랜치를 명시적으로 버리고(git branch -D ${branch}) 시작하라.`,
      )
    }
  }
}

/** 허용 목록 밖의 브랜치는 전부 거부한다 — 사유는 `SEED_BRANCH_RE` 참조. */
function assertSeedBranchAllowed(branch) {
  if (!SEED_BRANCH_RE.test(branch)) {
    throw new Error(
      `'${branch}' 에는 예제 vault 를 시딩할 수 없다 — 허용 브랜치는 'test' 또는 'test-*' 뿐이다.\n` +
        `서비스 데이터 브랜치(main·seed)로 새어나간 예제는 되돌릴 수 없다(히스토리 재작성 = 문서 id 파괴).`,
    )
  }
}

function checkoutSeedBranch(repoDir, branch, baseRef) {
  if (refExists(repoDir, `refs/heads/${branch}`)) git(repoDir, ['checkout', '-q', branch])
  else git(repoDir, ['checkout', '-q', '-b', branch, baseRef])
}

/** 결정성 6필드 + `--no-gpg-sign` 으로 커밋한다. 하나라도 빠지면 SHA 가 환경마다 달라진다. */
function commit(repoDir, message) {
  tick += TICK_STEP
  const date = `${tick} +0000`
  git(repoDir, ['add', '-A'])
  git(repoDir, ['commit', '-q', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_AUTHOR_EMAIL: BOT_EMAIL,
    GIT_AUTHOR_NAME: BOT_NAME,
    GIT_COMMITTER_DATE: date,
    GIT_COMMITTER_EMAIL: BOT_EMAIL,
    GIT_COMMITTER_NAME: BOT_NAME,
  })
  return git(repoDir, ['rev-parse', 'HEAD'])
}

function createDoc(repoDir, relDoc) {
  const full = docPath(repoDir, relDoc)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  // LF 고정 — `os.EOL` 을 쓰면 플랫폼별로 blob 이 달라져 SHA 가 갈린다(결정성 붕괴).
  fs.writeFileSync(full, DOCUMENTS[relDoc], 'utf8')
}

function docPath(repoDir, relDoc) {
  return path.join(repoDir, WIKI_DIR, `${relDoc}.md`)
}

/** 문자열 1건 치환(정확히 1회 등장해야 한다 — 조용한 no-op 을 막는다). */
function editDoc(repoDir, relDoc, from, to) {
  const full = docPath(repoDir, relDoc)
  const before = fs.readFileSync(full, 'utf8')
  if (!before.includes(from)) throw new Error(`치환 대상을 찾지 못했다: ${relDoc} <- "${from}"`)
  fs.writeFileSync(full, before.replace(from, to), 'utf8')
}

/**
 * git 실행기.
 *
 * `core.quotepath=false` — 한글 경로(`wiki/company/삼성전자.md`)를 octal escape 없이 다룬다(`lib/git.mjs:45` 선례).
 *
 * `core.autocrlf` 는 **덮어쓰지 않는다.** 파일을 항상 LF 로 쓰므로(`os.EOL` 금지) add 필터가
 * `true`든 `false`든 blob 은 LF 로 동일하다 = SHA 결정성 유지. 반대로 여기서 `false` 를 강제하면
 * autocrlf=true 로 이미 체크아웃된 워킹트리(CRLF)가 dirty 로 보여 가드가 오탐한다.
 */
function git(repoDir, args, extraEnv = {}) {
  return execFileSync('git', ['-C', repoDir, '-c', 'core.quotepath=false', ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function main(argv) {
  const options = parseArgs(argv)
  const result = seedVault(options)
  console.log(git(path.resolve(options.repo), ['log', '--oneline', '-n', '20', result.branch]))
  console.log(
    `\n${result.commits.length}커밋을 '${result.branch}' 에 시딩했다(HEAD=${result.head.slice(0, 12)}).`,
  )
  console.log('push 는 사람이 한다: git -C <repo> push -u origin <branch> (--force·squash 금지)')
}

/** `git mv` 단독 커밋 — 내용 수정과 섞으면 rename 유사도 판정이 흔들린다. */
function moveDoc(repoDir, fromDoc, toDoc) {
  fs.mkdirSync(path.dirname(docPath(repoDir, toDoc)), { recursive: true })
  git(repoDir, ['mv', posixDocPath(fromDoc), posixDocPath(toDoc)])
}

function parseArgs(argv) {
  const options = { branch: 'test', repo: 'sas-wiki' }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const value = argv[i + 1]
    if (arg === '--repo' || arg === '--branch') {
      if (!value) throw new Error(`${arg} requires a value`)
      options[arg === '--repo' ? 'repo' : 'branch'] = value
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}\nUsage: ${usage()}`)
  }
  return options
}

function posixDocPath(relDoc) {
  return `${WIKI_DIR}/${relDoc}.md`
}

function refExists(repoDir, ref) {
  return tryGit(repoDir, ['rev-parse', '--verify', '--quiet', ref]) !== ''
}

/** `git rm` 단독 커밋 — 삭제된 문서를 가리키던 피드는 P2 가 prune 한다. */
function removeDoc(repoDir, relDoc) {
  git(repoDir, ['rm', '-q', posixDocPath(relDoc)])
}

/** 서브모듈은 detached HEAD 로 체크아웃되는 경우가 많아 로컬 `main` 이 없을 수 있다 → 원격 추적 ref 로 폴백. */
function resolveBaseRef(repoDir) {
  for (const ref of [`refs/heads/${BASE_BRANCH}`, `refs/remotes/origin/${BASE_BRANCH}`]) {
    if (refExists(repoDir, ref)) return ref
  }
  throw new Error(`베이스 브랜치(${BASE_BRANCH})를 찾지 못했다 — 시딩할 분기점이 없다.`)
}

function tryGit(repoDir, args) {
  try {
    return git(repoDir, args)
  } catch {
    return ''
  }
}

function usage() {
  return 'node scripts/wiki/seed-example-vault.mjs --repo <path> [--branch test]'
}

// 엔트리가드(`build.mjs:268` 선례) — import 시에는 실행되지 않는다.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main(process.argv.slice(2))
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
