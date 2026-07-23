/**
 * draft 판정 — dev 전용 문서인가. **OR 결합**: frontmatter 플래그(fail-open) OR `dev/` 폴더 경로
 * (fail-closed 백스톱). 신호가 늘수록 더 숨긴다(monotonic fail-safe) — 플래그를 깜빡해도 폴더가,
 * 폴더를 안 써도 플래그가 잡는다. AND 로 뒤집으면 이중 신호가 오히려 노출로 새므로 반전 금지.
 *
 * build.mjs(visibleDocs·excludedFeedRefs)와 git-walk.mjs(walkFeeds prod feed 제외)가 **동일 정의**를
 * 공유한다 — draft 판정을 두 곳에서 재구현하면 한쪽만 바뀌어 prod 누출/과잉숨김이 조용히 갈린다.
 *
 * @param {{ frontmatter: { draft?: unknown }, relPath: string }} parsed
 */
export function isDraft(parsed) {
  const flag = parsed.frontmatter.draft === true
  const inDevFolder = parsed.relPath === 'dev' || parsed.relPath.startsWith('dev/')
  return flag || inDevFolder
}
