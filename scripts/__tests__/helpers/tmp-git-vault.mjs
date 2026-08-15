// 실 git tmp vault 시딩 프리미티브 — frontmatter UUIDv7 doc-id 무결성 RED 공용 (P1 Task 2·3·4).
//
// DAMP 경계: 이 파일은 **정상 시딩 원자만** 제공한다(`expect` 없음). 결함(id 부재·사후 변조·중복)은
//   각 스펙 본문에서 **딱 한 곳만** 주입한다 → 무엇이 틀렸는지가 스펙에 보인다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// 결정성: git t/test-lib.sh test_tick 관례(고정 시각·identity). ~/.gitconfig 누출은 vitest.config.js 의
//   GIT_CONFIG_GLOBAL=/dev/null 이 막지만, identity 는 여기서 명시 주입한다(CI 무-identity 환경 재현).
//
// ★ 이 "결정성"의 실제 범위 — `tick` 은 **이 모듈 인스턴스 하나가 공유하는 전역 상태**다(파일 맨
//   아래 `let tick` 참조). 그래서 어떤 vault 가 받는 날짜는 "그 vault 자신의 내용"이 아니라 **같은
//   모듈 인스턴스 안에서 이 vault 이전에 몇 번 커밋했는가**로 정해진다. 즉 이 파일이 보장하는 것은
//   "같은 테스트 파일을 같은 케이스 순서·개수로 다시 돌리면 같은 히스토리가 나온다"(git 의
//   test_tick 원 관례와 동일한 범위 — CI 재현성)이지, "내용이 같은 두 vault 는 항상 같은(또는 항상
//   다른) SHA 를 받는다"가 **아니다**. 케이스를 추가·재배치하면 그 뒤에 만들어지는 vault 들의
//   날짜·SHA 가 조용히 달라진다 — 이것은 버그가 아니라 이 파일의 실제 계약이다. 그래서 어떤 스펙도
//   SHA·날짜를 **리터럴로 하드코딩하면 안 된다**(vault 히스토리 하드결합 금지 — 이미 이 리포의
//   일반 원칙). 두 vault 의 SHA 가 **다르다**에 의존하는 단언이 있다면 그 다름은 이 tick 공유
//   때문이 아니라 vault 자체의 실제 내용 차이(경로·메시지 등)에서 나와야 한다.
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const NAME = 'SAS Wiki Bot'
const EMAIL = 'bot@sas.wiki'

/** `type: company` 의 스키마 필수 `meta` 최소값. 리터럴이다 — 프로덕션 스키마에서 유도하지 않는다(규범 A). */
const DEFAULT_COMPANY_META = { exchange: 'KRX', sector: '테스트', ticker: '000000' }
// 모듈 전역 — 이 인스턴스 안의 **호출 순서**가 이후 만들어지는 모든 vault 의 날짜·SHA 에 영향을
//   준다(파일 머리 "이 결정성의 실제 범위" 참조). vault 마다 리셋하지 않는다: 리셋하면 내용이 같은
//   두 vault 가 같은 SHA 를 받게 되는데, 이 헬퍼를 한 파일에서 둘 이상 부르는 테스트가 그 SHA
//   동일/상이 자체에 의존하는지(예: feedId 를 유일성 키로 쓰는 단언) 리포 전수를 실행해 확인하지
//   않고는 안전을 장담할 수 없다 — 파급이 이 헬퍼의 importer 전체(약 60여 파일)로 번지기 때문이다.
//   그래서 동작은 바꾸지 않고 이 주석으로 범위만 정확히 못박는다.
let tick = 1_136_239_445

export function git(cwd, args, extraEnv = {}) {
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

/** 스테이징 전량 + 결정적 날짜 커밋. HEAD 해시를 돌려준다. */
export function commit(cwd, message) {
  const date = nextDate()
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: date,
    GIT_COMMITTER_DATE: date,
  })
  return git(cwd, ['rev-parse', 'HEAD'])
}

/**
 * `feed:` 커밋 원자 — subject + `Keywords`/`Importance` trailer + **author-date 통제**.
 *
 * feeds 바운디드 워크(P5 git-walk) RED 시딩용이다. 기존 `commit` 은 generic subject 만 지원하고
 * author-date 를 통제하지 못해(tick +60 자동) 워크순서=author-date 로 강제된다 — 그러면 "git
 * 워크순서 ≠ author-date → JS 재정렬 권위"(GW3) 를 시딩으로 재현할 수 없다. 이 원자는:
 *   · subject → `feed: <subject>` (feed.mjs FEED_SUBJECT_RE 매칭)
 *   · keywords/importance → 커밋 body 하단 trailer(`Keywords: …`·`Importance: …`, feed.mjs extractTrailers)
 *   · **date 를 GIT_AUTHOR_DATE/COMMITTER_DATE 로 그대로 주입**(피드 ts = author-date = `%aI`).
 *     date 미지정이면 결정적 `nextDate()` (commit 과 동일 tick 계열).
 *
 * 스테이징 전량을 커밋하므로, 호출 **전에** `writeDoc`/`git mv`/`git rm` 등으로 vault 문서를 건드려
 * 두면 그 문서를 가리키는 피드가 된다(feed.mjs 의 diff→docs 해석 계약). HEAD 해시를 돌려준다
 * (feedId = `hash.slice(0, 12)`).
 *
 * @param {string} cwd vault 루트
 * @param {{ date?: string, importance?: 'breaking'|'highlight'|'normal', keywords?: string[], subject: string }} spec
 */
export function feedCommit(cwd, { date, importance = 'normal', keywords = [], subject } = {}) {
  const when = date ?? nextDate()
  const trailers = []
  if (keywords.length > 0) trailers.push(`Keywords: ${keywords.join(', ')}`)
  trailers.push(`Importance: ${importance}`)
  const message = `feed: ${subject}\n\n본문 문단이다.\n\n${trailers.join('\n')}`
  git(cwd, ['add', '-A'])
  git(cwd, ['commit', '--no-gpg-sign', '-m', message], {
    GIT_AUTHOR_DATE: when,
    GIT_COMMITTER_DATE: when,
  })
  return git(cwd, ['rev-parse', 'HEAD'])
}

export function initVault() {
  const vault = mkdtempSync(path.join(tmpdir(), 'wiki-red-'))
  git(vault, ['init', '-q'])
  return vault
}

export function makeOut() {
  return mkdtempSync(path.join(tmpdir(), 'wiki-red-out-'))
}

/**
 * `dir` 이 `os.tmpdir()` 아래인지 검증한다. 이 모듈이 만드는 모든 디렉토리는
 * `mkdtempSync(path.join(tmpdir(), …))` 산출이라 **부모가 항상 `os.tmpdir()` 자신**이다 — 그래서 부모
 * 하나만 realpath 하면 충분하다.
 *
 * - `dir` 자신은 realpath 하지 않는다: `cleanup()` 은 이미 지워진 경로도 받을 수 있고(호출부가
 *   `finally` 에서 무조건 부르는 관례), 존재하지 않는 경로에서 `realpathSync` 는 던진다. 부모
 *   (`os.tmpdir()`)는 프로세스 생애 동안 항상 존재하므로 안전하다.
 * - macOS 처럼 `os.tmpdir()` 자체가 심링크(`/tmp` → `/private/tmp`)인 환경을 흡수하려고 부모와
 *   기준 둘 다 같은 방식(`realpathSync`)으로 정규화한 뒤 비교한다.
 * - 비교는 `path.resolve` 후 **구분자까지 포함**한 접두 비교다(`startsWith(base)` 만 쓰면
 *   `<tmp>-evil` 같은 형제 디렉토리가 접두어 일치로 통과한다). `os.tmpdir()` 자기 자신(=하위가 아닌
 *   경계값)도 통과시키지 않는다 — 이 모듈은 항상 그 아래 한 단계를 만든다.
 */
function assertWithinTmpRoot(dir) {
  const resolved = path.resolve(dir)
  const parent = path.dirname(resolved)
  const base = realpathSync(tmpdir())
  const realParent = existsSync(parent) ? realpathSync(parent) : parent
  const normalized = path.join(realParent, path.basename(resolved))
  if (!normalized.startsWith(`${base}${path.sep}`)) {
    throw new Error(
      `cleanup() 은 os.tmpdir()(${base}) 바깥 경로를 지우지 않는다 — 받은 경로: ${dir} (정규화: ${normalized})`,
    )
  }
}

export function cleanup(...dirs) {
  for (const dir of dirs) {
    if (!dir) continue
    assertWithinTmpRoot(dir)
    rmSync(dir, { force: true, recursive: true })
  }
}

/**
 * `<wikiRoot>/<rel>.md` 를 쓴다.
 *
 * `id` 를 주면 frontmatter 에 `id: "<id>"`(따옴표 스칼라 — parse.mjs:199 분기)로 넣는다.
 * `id` 를 생략하면 **pre-id 문서**(생성 blob 에 id 부재)를 시뮬레이션한다. type/status/body 는 기본 유효.
 *
 * `wikiRoot` 는 **리터럴 기본값**이다 — `parse-vault.mjs` 의 `WIKI_PREFIX` 를 import 하지 않는다
 * (자기참조 공허성 금지 · tdd §2.3 규범 A). 드리프트 감지는 트립와이어 스펙
 * `scripts/lib/__tests__/git.doc-predicates.test.mjs` 의 PR5 가 담당한다.
 *
 * **GREEN 단계 기본값은 현행 루트(`'wiki'`)** 다.
 * 루트 이관을 다루는 신규 스펙은 새 루트든 옛 루트든 `wikiRoot` 를 항상 명시한다.
 */
export function writeDoc(
  root,
  rel,
  {
    body = '## 정의\n\n본문 문단이다.\n',
    id,
    meta,
    status = 'active',
    title,
    type = 'concept',
    wikiRoot = 'wiki',
  } = {},
) {
  const full = path.join(root, ...wikiRoot.split('/'), `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  const fm = [
    '---',
    `title: ${title ?? rel.split('/').at(-1)}`,
    `type: ${type}`,
    `status: ${status}`,
  ]
  if (id !== undefined) fm.push(`id: "${id}"`)
  // `type: company` 는 스키마상 `meta` 가 필수다(조건부 required). P3 이전에는 문서 스키마 검증이
  //   `validate.mjs` 에서만 돌아 **서빙 경로가 이 위반을 통과**시켰고, 그래서 이 헬퍼가 meta 없이도
  //   쓸 만했다. P3 부터 판정이 얕은 티어(항상)로 올라와 그런 문서는 서빙에서도 제외된다 —
  //   즉 이 헬퍼가 만들던 company 문서는 이제 **부적합 데이터**다. 픽스처는 유효 문서를 만들어야
  //   부재 단언이 공허해지지 않으므로, 지정이 없으면 타입이 요구하는 최소 meta 를 채운다.
  const resolvedMeta = meta ?? (type === 'company' ? DEFAULT_COMPANY_META : undefined)
  if (resolvedMeta !== undefined) {
    fm.push('meta:')
    for (const [key, value] of Object.entries(resolvedMeta)) fm.push(`  ${key}: "${value}"`)
  }
  fm.push('---', '', body)
  writeFileSync(full, fm.join('\n'))
  return full
}

/** `<wikiRoot>/<rel>.md` 를 읽는다. `wikiRoot` 계약은 `writeDoc` 과 동일(리터럴 기본값). */
export function readDoc(root, rel, { wikiRoot = 'wiki' } = {}) {
  return readFileSync(path.join(root, ...wikiRoot.split('/'), `${rel}.md`), 'utf8')
}
