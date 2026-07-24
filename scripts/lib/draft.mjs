/**
 * draft 판정 — dev 전용 문서인가. **OR 결합**: frontmatter 플래그 OR `dev/` 폴더 경로(백스톱).
 * 신호가 늘수록 더 숨긴다(monotonic fail-safe) — 플래그를 깜빡해도 폴더가, 폴더를 안 써도 플래그가
 * 잡는다. AND 로 뒤집으면 이중 신호가 오히려 노출로 새므로 반전 금지.
 *
 * 플래그 판정은 **fail-closed** 다: 미지정·`false` 만 공개이고, 불리언이 아닌 값은 전부 draft 로 본다
 * (초판은 `=== true` 라 `draft: yes` 가 공개로 샜다 — 감사 H4).
 *
 * build.mjs(visibleDocs·excludedFeedRefs)와 git-walk.mjs(walkFeeds prod feed 제외)가 **동일 정의**를
 * 공유한다 — draft 판정을 두 곳에서 재구현하면 한쪽만 바뀌어 prod 누출/과잉숨김이 조용히 갈린다.
 *
 * @param {{ frontmatter: { draft?: unknown }, relPath: string }} parsed
 */
export function isDraft(parsed) {
  // 불리언만 신뢰한다. `draft: yes`·`draft: 1` 처럼 **불리언이 아닌 값은 판단 불가**이므로 숨긴다 —
  //   parse.mjs 의 parseScalar 는 리터럴 'true'/'false' 만 강제하고, 문서 스키마 검증(type: boolean)은
  //   validate.mjs 에만 있어 엔드포인트 경로에서는 돌지 않는다. 오탈자로 공개되는 쪽이 오탈자로
  //   숨는 쪽보다 훨씬 비싸다(숨김은 눈에 띄어 고쳐지고, 누출은 되돌릴 수 없다).
  const raw = parsed.frontmatter.draft
  const flag = raw !== undefined && raw !== false
  const inDevFolder = parsed.relPath === 'dev' || parsed.relPath.startsWith('dev/')
  return flag || inDevFolder
}
