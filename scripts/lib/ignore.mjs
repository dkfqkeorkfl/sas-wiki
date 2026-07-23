// D4 ignore-feeds tombstone — 단일 choke-point 억제 필터 + hygiene (SSOT).
//
// 잘못 발행된 feed 를 **히스토리 재작성 없이** 억제한다(RFC 6721 Atom deleted-entry 관례). 억제도
// 감사이력이라 `ignore-feeds.json` 으로 vault 에 커밋된다. 이 두 함수가 억제의 유일한 로직이며,
// build.mjs 의 단일 지점 배선과 P5 서버가 **같은 함수를 재사용**해야 우회가 없다(Complete Mediation —
// Saltzer & Schroeder). 재구현은 두 번째 필터 경로 = 우회이므로 금지한다.
//
// **억제≠삭제**: 원본 커밋·문서·body·summary 는 그대로 살아 있다(item 제거만). 원본이 git 히스토리에
// 잔존하므로 민감정보 물리 제거엔 부적합하다(진짜 삭제는 D7 doc-DB).

/**
 * 억제 목록의 id 를 가진 피드 아이템을 제거한다.
 *
 * **순수 함수**: 입력 `items`·`entries` 를 변형하지 않고 신규 배열을 반환하며, 남은 항목은 입력
 * 객체를 **그대로**(동일 참조) 실어 보낸다 — 억제는 제거일 뿐 내용 변형이 아니다. 순서를 보존
 * (입력의 subsequence)하므로 페이지네이션과 직교한다: `ignore 후 slice` == `slice-after-ignore`.
 * 억제 목록은 id 만 읽는다(`when`·`reason` 은 감사 메타). 존재하지 않는 id 는 무해한 no-op 이다.
 *
 * @template {{ id: string }} T
 * @param {T[]} items FeedItem[] (id = feed 커밋해시 12hex)
 * @param {{ id: string }[]} entries tombstone 엔트리
 * @returns {T[]} 억제 id 를 제외한 신규 배열
 */
export function applyIgnoreFeeds(items, entries) {
  const ignore = new Set(entries.map((entry) => entry.id))
  return items.filter((item) => !ignore.has(item.id))
}

/**
 * 억제 목록의 id 가 실존 feed(현·과거 커밋)에 대응하는지 관측한다 — 미대응 = **stale**.
 *
 * stale 엔트리를 **반환만** 한다(경고용). `entries` 를 변형·삭제하지 **않는다** — 자동 GC 는 억제
 * 영구성을 위배해 억제를 몰래 해제할 수 있어 금지한다(관행). 존재하지 않는 id 억제는 무해(no-op)
 * 하되 오타·drift 신호이므로 경고로 노출한다(RFC 6721 security: 미출현 id 억제 무시 권고와 정합).
 *
 * @param {{ id: string }[]} entries 억제 목록
 * @param {Set<string>} allFeedIds 억제 전 전체 feed id 집합(pruned feed 포함 — 오판 방지)
 * @returns {{ id: string }[]} stale 엔트리(원본의 부분집합 — 별도 배열, 제자리 변형 아님)
 */
export function reportIgnoreHygiene(entries, allFeedIds) {
  return entries.filter((entry) => !allFeedIds.has(entry.id))
}
