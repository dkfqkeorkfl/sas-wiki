// D4 ignore-feeds tombstone — 단일 choke-point 억제 **로드·필터·hygiene** (SSOT).
//
// 잘못 발행된 feed 를 **히스토리 재작성 없이** 억제한다(RFC 6721 Atom deleted-entry 관례). 억제도
// 감사이력이라 `ignore-feeds.json` 으로 vault 에 커밋된다. 이 세 함수가 억제의 유일한 로직이며,
// validate 의 단일 지점 배선과 P5 서버가 **같은 함수를 재사용**해야 우회가 없다(Complete Mediation —
// Saltzer & Schroeder). 재구현은 두 번째 필터 경로 = 우회이므로 금지한다.
//
// **억제≠삭제**: 원본 커밋·문서·body·summary 는 그대로 살아 있다(item 제거만). 원본이 git 히스토리에
// 잔존하므로 민감정보 물리 제거엔 부적합하다(진짜 삭제는 D7 doc-DB).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadSchema, validateItem } from './schema-validator.mjs'

/** 생산 JSON Schema 디렉토리 — 이 모듈은 scripts/lib/ 이므로 상위 scripts/schema. */
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'schema')

/**
 * vault 루트의 억제 목록 파일명 — **이 리터럴의 유일한 거처**다.
 *
 * 억제는 `feeds` 출력을 바꾸는 입력이므로 이 파일명이 둘 이상이면 한쪽만 따라가고, 서빙 필터가
 * 조용히 억제를 못 보게 된다. `WIKI_PREFIX` 를 `head-state.mjs` 가 소유하는 것과 같은 이유다.
 */
export const IGNORE_FEEDS_FILE = 'ignore-feeds.json'

/**
 * vault 리포 루트의 `ignore-feeds.json`(억제 tombstone 목록)을 로드·검증한다.
 *
 * **부재 = `[]`(fail-open)** — 목록 부재는 "억제 없음"이지 "전량 억제" 가 아니다. **존재하되 스키마
 * 위반 = throw(fail-loud)** — 신뢰 못 할 억제 목록은 조용히 무시하지 않는다(malformed JSON 도 throw).
 * stale(대응 feed 없는 유효 엔트리)은 여기서 끊지 않고 `reportIgnoreHygiene` 경고로만 관측한다.
 *
 * **로더가 여기 있는 이유**: 예전에는 검증 경로(`parse-vault`)와 서빙 경로(`git-walk`)가 각자 로드했고
 * 서빙 쪽만 **스키마 검증을 건너뛰었다** — 같은 파일을 한쪽은 신뢰하고 한쪽은 안 하는 상태였다. 이
 * 모듈 헤더가 금지하는 "두 번째 필터 경로" 가 바로 그것이라 로드까지 여기로 모은다.
 */
export function loadIgnoreFeeds(vaultDir, schemaDir = SCHEMA_DIR) {
  return loadIgnoreFeedsAt(path.join(vaultDir, IGNORE_FEEDS_FILE), schemaDir)
}

/**
 * **억제 목록 파일 자체의 경로**로 로드한다 — v3 P2 `--ignore <경로>`(D20)의 착지점이다.
 *
 * 왜 이 함수가 필요한가: `loadIgnoreFeeds` 는 vault 루트에서 파일명을 **파생**하므로, 호출자가 준
 * 경로의 basename 을 쓸 방법이 없다. 그 상태에서 `--ignore <경로>` 를 지원하려면 디렉토리만 떼어
 * 넘겨야 하는데, 그러면 `--ignore /x/my-ignore.json` 이 조용히 `/x/ignore-feeds.json` 을 읽는다 —
 * **동작은 하지만 사용자가 지정한 파일이 아닌 것을 읽는** 오동작이고, 그 실패는 관측되지 않는다.
 *
 * ★ 그럼에도 **읽기·스키마 검증·에러 문구는 여기 한 곳에만 있다**(이 모듈 헤더가 금지하는 "두 번째
 * 필터 경로" 금지의 로드 층 대응). `loadIgnoreFeeds` 는 이 함수를 부르는 얇은 래퍼이고,
 * `IGNORE_FEEDS_FILE` 리터럴의 소유자도 여전히 이 파일 하나다.
 *
 * **부재 = `[]`(fail-open)** — 목록 부재는 "억제 없음" 이지 "전량 억제" 가 아니다. **존재하되 스키마
 * 위반 = throw(fail-loud)** — 신뢰 못 할 억제 목록은 조용히 무시하지 않는다(malformed JSON 도 throw).
 *
 * @param {string} ignorePath 억제 목록 파일 경로(절대경로 권장 — 호출부가 해석해 넘긴다)
 * @param {string} [schemaDir]
 */
export function loadIgnoreFeedsAt(ignorePath, schemaDir = SCHEMA_DIR) {
  if (!fs.existsSync(ignorePath)) return []
  const entries = JSON.parse(fs.readFileSync(ignorePath, 'utf8'))
  const errors = validateItem(
    entries,
    loadSchema(path.join(schemaDir, 'ignore-feeds.schema.json')),
    IGNORE_FEEDS_FILE,
  )
  if (errors.length > 0) {
    throw new Error(
      `${IGNORE_FEEDS_FILE} 스키마 위반 ${errors.length}건 — 신뢰할 수 없는 억제 목록으로 빌드를 중단한다:\n` +
        errors.map((message) => `  - ${message}`).join('\n'),
    )
  }
  return entries
}

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
