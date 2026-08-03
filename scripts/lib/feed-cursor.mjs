// v3 P2 — 커서 계약(D7·D8) · 3단 검증(D10) · `--end-of-options`(D11) · 배치 워크(D12·D13·D23·D45).
//
// ── ★ 3단 검증은 우리 발명이 아니다 — git 문서가 그대로 권고하고 예제로 싣는다 ────────────────
//   `git-rev-parse.adoc`(git v2.51.1):
//     _"Note that if you are verifying a name from an untrusted source, it is wise to use
//       `--end-of-options` so that the name argument is not mistaken for another option."_
//   같은 문서 EXAMPLES:
//     `git rev-parse --verify --end-of-options $REV^{commit}`
//     _"This will error out if $REV is empty or not a valid revision."_
//   `gitcli.adoc`:
//     _"Because `--` disambiguates revisions and paths in some commands, it cannot be used for
//       those commands to separate options and revisions. You can use `--end-of-options` for this"_
//   ⇒ **`--` 를 쓰지 않는다.** `--` 로 "막으면" 값이 pathspec 이 되어 **exit 0 + 빈 결과**가 나오고,
//     그것은 D13(줄 수) 판정에서 「히스토리 끝」으로 오독된다(항목 0건을 「끝」으로 신고).
//
// ── 최소 git 버전 = 2.30 ────────────────────────────────────────────────────────────────────
//   RelNotes/2.24.0: _"The command line parser learned `--end-of-options` notation"_ (일반 파서)
//   RelNotes/2.30.0: _"`git rev-parse` learned the `--end-of-options` …"_ (이 파일이 쓰는 것)
//   ★ **`git-rev-list(1)` 은 `--end-of-options` 를 문서화하지 않는다** — rev-list man page 를 앵커로
//     달면 거짓 인용이다. rev-list 쪽 근거는 gitcli(7) + `revision.c` 소스이고, 컨테이너 실측은 2.51.1.
//
// ── ★ 12자는 「현재 구현값 고정」이지 「영속 계약」이 아니다 ─────────────────────────────────
//   git 문서가 축약 유일성을 _"hopefully … unique for some time"_(`core.abbrev`)으로 **자기 부인**한다.
//   장기 안전을 보장하는 것은 확률이 아니라 **D7**(커서는 불투명 문자열 — 서버가 형식을 사전 통지
//   없이 바꿀 수 있다)이다. 임계에 닿으면 길이를 늘리면 되고, 불투명 계약이 정확히 그 변경을
//   가능하게 한다. 6층에 12 를 pin 하는 것은 그 뜻이다.
//
// ── ★ 정렬 권위가 이 파일로 옮겨온다 (D39 · OQ-P2-2 (a)) ────────────────────────────────────
//   D12 워크 형태에는 **정렬 플래그가 없다** = git 기본 역시간순이 계약이다. 구 워크
//   (`git-walk.mjs:132`)는 `--author-date-order` 였다 — 즉 **정렬 권위의 실체가 바뀐다.**
//   선형 히스토리에서는 무영향이지만 **병합 토폴로지에서는 페이지 「집합」 자체가 달라진다.**
//   ★ 실측 — 아래 4줄은 **이 파일 착륙 시 컨테이너 git 2.51.1 에서 직접 잰 값**이다(side 브랜치의
//     author-date 가 main 을 추월하는 tmp 병합 리포 · ADO = `--author-date-order`). tdd §2.5-① 이
//     **다른 시딩으로** 같은 판정 3건을 먼저 기록했다 — 두 표의 커밋 이름이 다른 것은 시딩 차이다:
//       rev-list 전량                    기본: merge,m2,m1,s2,s1,base / ADO: merge,s2,s1,m2,m1,base
//       rev-list --max-count=3 --skip=1  기본: m2,m1,s2               / ADO: s2,s1,m2
//       rev-list --max-count=1 --skip=1  기본: m2                     / ADO: s2   ★★ 집합이 다르다
//       (`--max-count`/`--skip` 은 정렬 결과 **위에** 적용된다 — 「정렬 → 자름」 순서다)
//   ⇒ 플래그를 다시 붙이는 것은 계약 변경이다. 붙이지 마라.
//
// ── ★ `--max-count=N --skip=1` 은 N 건이다 (N-1 아님) ───────────────────────────────────────
//   `rev-list-options.adoc`: _"Skip `<number>` commits before starting to show the commit output."_
//   / _"Limit the output to `<number>` commits."_ + `revision.c` `get_revision()` 의 스킵 루프가
//   `max_count` 를 **감소시키지 않고** 소비한다 + 실측 일치. ⇒ **오버샘플 배수에 보정을 넣지 마라.**
//
// ── ★ `--max-count=0` 은 exit 0 + 0줄이다 ───────────────────────────────────────────────────
//   그래서 D13(stdout 줄 수) 판정에서 **「히스토리 끝」과 구분 불가**다. git 에 넘기는 `--max-count`
//   은 **항상 ≥ 1**(M8) — 아래 `batchMaxCount` 가 그 하한을 구조적으로 보장한다.
import { makeGitRunner } from './git.mjs'
import { applyIgnoreFeeds } from './ignore.mjs'

/**
 * D10 ① — 커서 형식. **git 을 부르기 전에** 판정하는 방어의 주력이다:
 * `main`·`HEAD~1`·`--all`·`--output=…` 이 전부 여기서 탈락한다.
 */
const CURSOR_RE = /^[0-9a-f]{12}$/u

/** 커서 = item `id` = 커밋 해시 앞 12자(`git-walk.mjs:206` 과 같은 축약 길이). */
const CURSOR_LENGTH = 12

/**
 * D12 오버샘플 배수 — 1차 배치는 `count × 3`. `feed:` 필터·생존 판정·억제로 걸러질 몫을 감안한
 * 값이다(설계 §3-3 ②의 "×2~3" 구간 상단).
 */
const FIRST_BATCH_FACTOR = 3

/** D23 — 1차가 채우지 못했을 때의 2차 배치 배수. */
const SECOND_BATCH_FACTOR = 4

/**
 * D23 — 라이브 조회 비용 상한. **3회째는 없다.** `count=1` 씩 무한 루프는 git 프로세스 스폰의
 * 고정 비용 때문에 오히려 느리다(설계 §11-3).
 */
const MAX_BATCHES = 2

/**
 * 빈 저장소만 흡수한다 — `git-walk.mjs:135` 의 EMPTY_REPO_TOLERANCE 와 **같은 극성**이다.
 * ★ **무효 커서는 흡수하지 않는다**(D9) — 그 경로는 `resolveCursorCommit` 의 `null` 이 진다.
 */
const EMPTY_HISTORY_RE = /does not have any commits yet|unknown revision|bad revision/iu

/**
 * D10 ① — 값이 커서 **형식**인가. git 을 부르기 전에 판정하므로 boolean 이다.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isCursorFormat(value) {
  return typeof value === 'string' && CURSOR_RE.test(value)
}

/**
 * D10 ②③ + D11 — 커서를 **전체 객체명**으로 해석한다. 통과하지 못하면 `null`.
 *
 * ① 형식(`isCursorFormat`) → ② `git rev-parse --verify --quiet --end-of-options "<hash>^{commit}"`
 * → ③ stdout 이 입력으로 `startsWith`.
 *
 * - **② 는 exit 0/비0 으로만 판정한다.** 문서 보증은 _"instead exit with **non-zero** status
 *   silently"_ 까지이고 `--quiet` 유무로 1 vs 128 이 갈리는 것은 실측일 뿐이다 — 숫자에 결속하지 않는다.
 * - **③ 의 근거는 "항상 40자" 가 아니다.** SHA-256 저장소는 64자다. 근거는 `rev-parse` 가 **전체
 *   객체명을 낸다**는 것이고, 판정은 접두 일치다. 실제 방어 가치는 **refname 그림자** — 12-hex 와
 *   동명의 태그·브랜치가 있으면 ①② 를 통과한 채 **다른 커밋**으로 해석된다(그리고 그 실패는
 *   exit 0 이라 조용하다).
 * - **거부는 `null` 이지 throw 가 아니다.** 세 단계가 **같은 거부 경로**를 공유해야 호출부가 사유를
 *   한 자리에서 문구로 만든다(層을 섞지 않는다).
 * - **`cursor === undefined` 는 거부가 아니라 `HEAD` 해석이다**(`prd.md:498` _"미지정이면 HEAD 부터"_).
 *
 * @param {string|undefined} cursor 12-hex 커서. `undefined` 면 HEAD.
 * @param {{ runGit: (args: string[]) => string }} deps vault 를 cwd 로 고정한 러너(주입 seam)
 * @returns {string|null} 전체 객체명(40 또는 64 hex). 거부·미해석은 `null`.
 */
export function resolveCursorCommit(cursor, { runGit } = {}) {
  if (cursor === undefined) return revParseCommit(runGit, 'HEAD')
  if (!isCursorFormat(cursor)) return null
  const objectName = revParseCommit(runGit, cursor)
  if (objectName === null) return null
  return objectName.startsWith(cursor) ? objectName : null
}

/**
 * 커서 위치에서 한 페이지를 **git 워크로 계산**한다 — D12 배치 · D13 종료 판정 · D23 상한 ·
 * D45 0건 커서.
 *
 * 절차(설계 §3-3 ①~⑤):
 *   ① 시작점 결정 — `after` 가 있으면 **그 커밋 다음부터**(`--skip=1`), 없으면 **HEAD 부터**.
 *      ★ 두 어휘가 다른 것이 계약이다: `--skip=1` 을 시작점에도 걸면 HEAD 커밋 자신이 페이지에서
 *      빠져 **가장 최신 피드가 조용히 사라진다**(§7 무유실 논거가 깨진다).
 *   ② `git rev-list --max-count=<n> [--skip=1] --end-of-options <시작점>` 1회.
 *   ③④ `resolveItems` 가 `feed:` 필터 + 생존 판정(`judgeFeedSurvival`)을 지고, 여기서 억제
 *      (`applyIgnoreFeeds`)를 적용한다 — 억제는 **`ignore.mjs` 한 곳이 유일한 구현**이다(D20).
 *   ⑤ `count` 를 채웠으면 종료. 못 채웠으면 **한 번만 더**(×4) 조회한다.
 *
 * ★ **`parseVault` 를 경유하지 않는다.** 커서 워크는 생성기 툴체인(render·derive)을 쓰지 않는다.
 *
 * @param {string} vaultDir git vault repository root
 * @param {{
 *   after?: string,
 *   count: number,
 *   ignoreEntries?: object[],
 *   resolveItems: (shas: string[]) => object[],
 *   runGit?: (args: string[]) => string,
 *   timeoutMs?: number,
 * }} options
 *   `resolveItems` 는 커밋 해시 배열을 **워크 순서 그대로** 받아 살아남은 feed item 을 돌려준다
 *   (③④ 중 ③). 주입인 이유는 그 해석기가 HEAD 문서 상태·경로 역인덱스를 들고 있어 이 파일의
 *   책임(배치·커서)과 층이 다르기 때문이다. `timeoutMs` 는 러너를 직접 주입하지 않을 때만 쓰인다.
 * @returns {{ items: object[], nextCursor: string|null }}
 *   `nextCursor` 는 **12-hex 문자열**이고 히스토리 끝에서만 `null` 이다(D45 · C12).
 */
export function walkCursorPage(
  vaultDir,
  { after, count, ignoreEntries = [], resolveItems, runGit, timeoutMs } = {},
) {
  const resolvedRunGit = runGit ?? makeGitRunner(vaultDir, { timeoutMs })
  const start = resolveCursorCommit(after, { runGit: resolvedRunGit })
  if (start === null) {
    // 커서를 준 쪽이면 **무효 커서**다 — 조용히 빈 페이지를 내면 「피드 끝」으로 오독된다(D9).
    if (after !== undefined) {
      throw new Error(`after 커서를 해석할 수 없습니다(cursor=${JSON.stringify(after)}).`)
    }
    // 커서가 없는데 HEAD 가 안 잡히는 정상 상태는 **커밋 0건 리포** 하나다(EMPTY_REPO_TOLERANCE).
    // git 자체의 가용성은 호출부의 `checkGitAvailable`(`git.mjs:43`)이 이미 가른다.
    return { items: [], nextCursor: null }
  }

  const collected = []
  const seen = new Set()
  let walkFrom = start
  // ① 의 귀결 — 시작점은 포함하고, 이어받은 커서는 건너뛴다.
  let skipStart = after !== undefined
  let lastWalked = null
  let historyEnded = false

  for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
    const maxCount = batchMaxCount(count, batch === 0 ? FIRST_BATCH_FACTOR : SECOND_BATCH_FACTOR)
    const shas = revListBatch(resolvedRunGit, { maxCount, skipStart, start: walkFrom })
    // D13 — 종료 판정은 exit code 가 아니라 **stdout 줄 수**다(빈 결과도 exit 0 이다).
    if (shas.length < maxCount) historyEnded = true
    // 0줄이면 이어갈 시작점이 없다 — 같은 질의를 한 번 더 내는 것일 뿐이다.
    if (shas.length === 0) break

    lastWalked = shas.at(-1)
    for (const item of applyIgnoreFeeds(resolveItems(shas), ignoreEntries)) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      collected.push(item)
    }
    if (collected.length >= count) break

    walkFrom = lastWalked
    skipStart = true
  }

  const items = collected.slice(0, count)
  return { items, nextCursor: nextCursorFor({ collected, count, historyEnded, items, lastWalked }) }
}

/**
 * M8 — git 에 넘어가는 `--max-count` 의 **하한 1** 을 구조적으로 보장한다.
 * `--max-count=0` 은 exit 0 + 0줄이라 「히스토리 끝」과 구분되지 않는다.
 */
function batchMaxCount(count, factor) {
  const oversampled = Math.floor(count * factor)
  return Number.isFinite(oversampled) && oversampled >= 1 ? oversampled : 1
}

/**
 * D45 — 0건 페이지에서도 커서가 끊기지 않는다. `null` 은 **히스토리 끝** 하나만 뜻한다.
 *
 * AIP-158: _"If the end of the collection has been reached, the `next_page_token` field **must** be
 * empty. This is the **only** way to communicate 'end-of-collection' to users."_ / 부분 반환은
 * _"including zero results, even if not at the end"_ 로 정상 경로다. ⇒ 0건에 `null` 을 주면
 * 「끝」을 **거짓 신고**하는 것이고, 그 순간 §7 무유실 논거가 깨진다.
 */
function nextCursorFor({ collected, count, historyEnded, items, lastWalked }) {
  // 아직 남은 것이 손에 있다 — 다음 페이지는 이 페이지 **마지막 항목**부터 이어받는다.
  if (collected.length > count) return items.at(-1).id
  if (historyEnded) return null
  if (items.length > 0) return items.at(-1).id
  // 0건인데 끝은 아니다 → 실을 「항목」이 없으므로 **마지막으로 워크한 커밋**을 싣는다.
  return lastWalked === null ? null : lastWalked.slice(0, CURSOR_LENGTH)
}

/**
 * D12 워크 1회. **정렬 플래그를 붙이지 않는다**(파일 머리의 정렬 권위 주석 참조).
 *
 * argv 순서가 계약이다 — 옵션은 전부 `--end-of-options` **앞**, revision 은 **뒤**.
 */
function revListBatch(runGit, { maxCount, skipStart, start }) {
  const args = ['rev-list', `--max-count=${maxCount}`]
  if (skipStart) args.push('--skip=1')
  args.push('--end-of-options', start)

  let raw
  try {
    raw = runGit(args)
  } catch (error) {
    if (isEmptyHistory(error)) return []
    throw error
  }
  return raw.split('\n').filter((line) => line !== '')
}

/**
 * `rev-parse --verify --quiet --end-of-options "<rev>^{commit}"` 의 stdout(전체 객체명).
 * 비0 종료·빈 출력은 `null` — **exit code 숫자에 결속하지 않는다**.
 *
 * `^{commit}` 만으로는 부족하다: `^{<type>}` 는 _"dereference the object at `<rev>` recursively
 * until an object of type `<type>` is found"_ 라 **결과 객체 타입 단언**이지 입력 구문 제약이
 * 아니다 — `<rev>` 로 유효한 모든 표기(브랜치·태그·`HEAD~1`)가 exit 0 으로 통과한다.
 */
function revParseCommit(runGit, rev) {
  let raw
  try {
    raw = runGit(['rev-parse', '--verify', '--quiet', '--end-of-options', `${rev}^{commit}`])
  } catch {
    return null
  }
  const objectName = String(raw).trim()
  return objectName === '' ? null : objectName
}

function isEmptyHistory(error) {
  const stderr = typeof error?.stderr === 'string' ? error.stderr : ''
  return EMPTY_HISTORY_RE.test(`${error?.message ?? ''}\n${stderr}`)
}
