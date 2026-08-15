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
 * 코드펜스 여는 줄의 마커를 잡는다 — CommonMark spec(§4.5 Fenced code blocks, spec.commonmark.org)
 * 축자 인용:
 *   "A code fence is a sequence of at least three consecutive backtick characters (`) or
 *   tildes (~). ... The line with the opening code fence may be indented up to three spaces."
 *   "The content of the code block consists of all subsequent lines, until a closing code
 *   fence of the **same type** as the code block began with (backticks or tildes), and **with
 *   at least as many backticks or tildes as the opening code fence**."
 * 종류·길이를 무시한 단순 토글은 ``` 로 연 펜스가 ~~~ 로도, 더 짧은 펜스로도 닫힌 것처럼 오판한다.
 *
 * @returns {{ char: string, length: number } | null}
 */
function matchFenceMarker(line) {
  const match = line.match(/^ {0,3}(`{3,}|~{3,})/)
  return match ? { char: match[1][0], length: match[1].length } : null
}

/**
 * 코드펜스 안 여부를 줄 단위로 계산한다 — S1(fence 종류·길이)·S2(fence 안 링크 제외)·S3(fence 안
 * 마커 제외)이 **같은 규칙을 공유**한다(REFACTOR: 파일 안 로컬 통합 — 새 헬퍼 파일 추출 금지).
 *
 * @param {string[]} lines
 * @returns {boolean[]} `lines` 와 같은 길이 — i번째 줄이 펜스 **안**(여는/닫는 줄 포함)이면 true
 */
function computeFenceMask(lines) {
  const mask = []
  let opening = null
  for (const line of lines) {
    const marker = matchFenceMarker(line)
    if (opening === null) {
      if (marker) {
        opening = marker
        mask.push(true)
      } else {
        mask.push(false)
      }
      continue
    }
    mask.push(true)
    if (marker && marker.char === opening.char && marker.length >= opening.length) {
      opening = null
    }
  }
  return mask
}

/**
 * ATX heading 하나를 줄에서 뽑는다(없으면 `null`) — CommonMark spec(§4.2 ATX headings) 축자 인용:
 *   "The opening # character may be indented 0-3 spaces. The opening sequence of # characters
 *   must be followed by spaces or tabs, or by the end of line. ... A closing sequence of any
 *   number of unescaped # characters ... is optional; it must be preceded by spaces or tabs
 *   and may be followed by spaces or tabs only."
 * G4: 3칸까지 들여쓴 heading 과 닫는 `#` 시퀀스(`## 제목 ##`)를 반영한다(이전엔 둘 다 무시했다).
 *
 * @returns {string | null}
 */
function matchAtxHeading(line) {
  const opening = line.match(/^ {0,3}#{1,6}(?:[ \t]+(.*))?$/)
  if (!opening) return null
  const raw = (opening[1] ?? '').trim()
  return raw.replace(/(?:^|[ \t])#+[ \t]*$/, '').trim()
}

/**
 * ATX heading 텍스트 — **코드펜스 안은 제외**(AC5).
 *
 * 앵커가 실재한다: `README.md:189` 에 bash 주석 `# 1페이지 → items: …` 가 **실제로 있다**.
 * 펜스를 안 보면 그것이 heading 으로 세어져 slug 집합이 오염되고, AC1 이 조용히 넓어진다.
 */
export function extractHeadings(markdown) {
  const lines = markdown.split('\n')
  const fenced = computeFenceMask(lines)
  const headings = []
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue
    const heading = matchAtxHeading(line)
    if (heading !== null) headings.push(heading)
  }
  return headings
}

/**
 * 한 줄 안의 인라인 코드 스팬을 제거한다 — CommonMark spec(§6.1 Code spans) 요지: 여는/닫는
 * 백틱 런(run)의 **길이가 같아야** 스팬이 닫힌다(``` `a` ``` · ``` ``a` `` ``` 둘 다 유효).
 * 줄을 넘어가는 스팬은 다루지 않는다(그 경우는 이미 코드펜스이거나 극히 드문 형태다 — 근사 범위).
 */
function stripInlineCode(line) {
  return line.replace(/(`+)[^`]*?\1/g, '')
}

/**
 * 절간 링크의 slug — `](#slug)` 만. 외부 링크(`](http…`)는 **구조적으로 제외**된다(AC7).
 * **코드펜스·인라인 코드 안은 제외**(S2) — 그 안의 `](#…)` 는 예시 텍스트이지 실제 링크가 아니다.
 *
 * 외부 링크를 검사 대상에 넣지 않는 이유: 네트워크 의존이라 비결정적이고 느리다. 그 결정을 여기
 * 주석과 AC7 케이스 **양쪽**에 남긴다 — 다음 사람이 범위를 넓히려 할 때 근거가 보여야 한다.
 */
export function extractAnchorLinks(markdown) {
  const lines = markdown.split('\n')
  const fenced = computeFenceMask(lines)
  const slugs = []
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue
    for (const match of stripInlineCode(line).matchAll(/\]\(#([^)]+)\)/g)) {
      slugs.push(match[1])
    }
  }
  return slugs
}

/**
 * 결속 마커 구간 — `<!-- contract:<name> -->` … `<!-- /contract:<name> -->` 사이의 줄들.
 * **코드펜스 안의 마커는 세지 않는다**(S3) — 안 그러면 코드블록에 마커를 적어 계약 구간을
 * 위조할 수 있다(스푸핑).
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
  const fenced = computeFenceMask(lines)
  const openIndexes = []
  const closeIndexes = []
  for (const [index, line] of lines.entries()) {
    if (fenced[index]) continue
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
