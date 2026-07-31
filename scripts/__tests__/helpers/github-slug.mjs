// README 앵커 정합(AC) 프리미티브 — GitHub 슬러그 **근사** + 마크다운 구조 추출. tdd §7.2 · OQ-P6-2 = b.
//
// ★ **판정하지 않는다**(규범 D). `expect` 가 없다 — 사실만 캔다.
//
// ★★ **프로덕션 `slugifyHeading`(`scripts/lib/parse.mjs:67`)을 import 하지 않는다.**
//   그것은 위키링크 앵커용이고 `-+ → -` 축약이 있어 GitHub 과 갈린다. 실측(N6): 36 heading 중
//   **8개**에서 결과가 다르고, 현 README 에 **실재하는 링크 `#dev--prod`(2건)를 MISS 로 오판**한다.
//   "이미 리포에 슬러거가 있는데 왜 또 만드나" 는 가장 자연스럽고 가장 틀린 선택이다 — 그 함정을
//   **AC3 이 계약으로 못박는다**(여기 주석이 아니라 실행되는 단언이 재발을 막는다).
//
// 왜 `github-slugger` 를 안 쓰나(OQ-P6-2 = b): 의존성에 없고(전이 포함 확인) 이 리포는 의존성 추가에
//   보수적이다(리소스 리포 · 9p 공유 `node_modules` 재설치 위험). 대신 방어를 셋으로 나눈다 —
//   **AC2**(리터럴 코퍼스) · **AC6**(heading 구두점 allowlist — 새 문자가 들어오면 red) ·
//   **P4 H6-1**(GitHub 실렌더 육안). 실패 방향이 안전하다: 근사가 갈리면 **false red** 가 나지
//   조용히 통과하지 않는다.
import fs from 'node:fs'

/**
 * GitHub 앵커 슬러그 근사.
 *
 * 규칙(현 README 코퍼스 전수로 검증 — AC2):
 *   1. `trim` → 소문자
 *   2. 문자·숫자·공백·`-`·`_` 를 **뺀 나머지 제거**(구두점은 사라지되 자리는 남지 않는다)
 *   3. 공백 **1자당 하이픈 1개**(★ 축약하지 않는다 — `dev / prod` → `dev--prod`)
 *
 * ★ 3번이 프로덕션 슬러거와 갈리는 지점이다. 축약하면 `#dev--prod` 를 못 찾는다.
 * ★ `→`(U+2192)의 GitHub 처리는 **우리가 검증하지 못했다**(현재 링크 대상이 아니다) — AC2 코퍼스에서
 *   `TODO: 사용자 확인`(P4 H6-1 소유)으로 두고 기대값을 단언하지 않는다.
 */
export function githubSlug(text) {
  return String(text)
    .trim()
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}\s_-]/gu, '')
    .replaceAll(/\s/g, '-')
}

/**
 * ATX heading 텍스트 — **코드펜스 안은 제외**(AC5).
 *
 * 앵커가 실재한다: `README.md:189` 에 bash 주석 `# 1페이지 → items: …` 가 **실제로 있다**.
 * 펜스를 안 보면 그것이 heading 으로 세어져 slug 집합이 오염되고, AC1 이 조용히 넓어진다.
 */
export function extractHeadings(markdown) {
  const headings = []
  let inFence = false
  for (const line of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue
    const match = line.match(/^#{1,6}\s+(.*)$/)
    if (match) headings.push(match[1].trim())
  }
  return headings
}

/**
 * 절간 링크의 slug — `](#slug)` 만. 외부 링크(`](http…`)는 **구조적으로 제외**된다(AC7).
 *
 * 외부 링크를 검사 대상에 넣지 않는 이유: 네트워크 의존이라 비결정적이고 느리다. 그 결정을 여기
 * 주석과 AC7 케이스 **양쪽**에 남긴다 — 다음 사람이 범위를 넓히려 할 때 근거가 보여야 한다.
 */
export function extractAnchorLinks(markdown) {
  const slugs = []
  const pattern = /\]\(#([^)]+)\)/g
  let match = pattern.exec(markdown)
  while (match !== null) {
    slugs.push(match[1])
    match = pattern.exec(markdown)
  }
  return slugs
}

/**
 * 결속 마커 구간 — `<!-- contract:<name> -->` … `<!-- /contract:<name> -->` 사이의 줄들.
 *
 * ★ **`null` 을 돌려준다(throw 하지 않는다)** — 마커 부재로 파일의 다른 케이스까지 죽으면
 *   collection error 가 되고, 그것을 러너 요약이 **PASS 로 오보고**한다(§7.3). 부재는 `*0` 앵커
 *   케이스(PT0·EN0)가 **명시적 red** 로 잡는다.
 * ★ 열림/닫힘이 각 1개가 아니면(0개·중복) 역시 `null` 이다 — "두 번째 마커 안에 계약을 숨기는"
 *   우회를 구간 추출 단계에서 끊는다.
 *
 * @returns {string[] | null}
 */
export function extractMarkerBlock(markdown, name) {
  const lines = markdown.split('\n')
  const openIndexes = []
  const closeIndexes = []
  for (const [index, line] of lines.entries()) {
    if (line.includes(`<!-- contract:${name} -->`)) openIndexes.push(index)
    if (line.includes(`<!-- /contract:${name} -->`)) closeIndexes.push(index)
  }
  if (openIndexes.length !== 1 || closeIndexes.length !== 1) return null
  if (closeIndexes[0] <= openIndexes[0]) return null
  return lines.slice(openIndexes[0] + 1, closeIndexes[0])
}

/** README 원문 — 호출부가 경로를 매번 조립하지 않게 하는 얇은 편의(사실만 캔다). */
export function readMarkdown(filePath) {
  return fs.readFileSync(filePath, 'utf8')
}
