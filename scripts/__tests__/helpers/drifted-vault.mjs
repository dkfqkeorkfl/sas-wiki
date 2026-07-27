// P5 — **드리프트** vault 시딩 원자 (`ID_TAMPERED` · `DELETED_ID_REUSE`). **`expect` 금지**(규범 D).
//
// 왜 신설인가(tdd M8 · §13): `polluted-vault.mjs`·`survival-vault.mjs` 어디에도 **id 사후 변조 시더가
//   없다**. 그리고 실 vault 에는 드리프트 사례가 **0건**이라 얕은/깊은 두 티어의 결과가 완전히 같다
//   (tdd M7). 즉 이 픽스처가 없으면 §3.5 DR(드리프트 반전) 전량이 **원리적으로 작성 불가**하고,
//   실 vault 로 드리프트를 검증하려는 시도는 전부 공허하다.
//
// 무엇이 드리프트인가: 깊은 티어(생성기·validate)만 내리는 판정 **둘**이다(tdd B6).
//   · `ID_TAMPERED`      — 생성 시점 blob 의 id ≠ 지금 frontmatter 의 id
//   · `DELETED_ID_REUSE` — 삭제된 문서의 id 를 살아 있는 문서가 재사용
//   얕은 티어(오늘의 서빙)는 둘 다 못 보므로 **제외되지 않은 채 서빙된다** — 그것이 B7·B8 결함이다.
//
// DAMP 경계(tmp-git-vault.mjs·polluted-vault.mjs 헤더 계승): 이 파일은 **시딩 사실만** 만든다.
//   "그래서 어떻게 되어야 하는가" 는 각 스펙 본문이 단언한다. 결함은 vault 당 **딱 한 곳만** 주입한다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// 자기참조 공허성 금지(규범 A): 아래 id·경로·제목·본문 마커는 **전부 리터럴**이다. `WIKI_PREFIX` ·
//   `REASON_CODES` · `IGNORE_FEEDS_FILE` 를 import 해 입력을 만들지 않는다.
//
// ★ 본문을 **충분히 다르게** 쓴다: `getCommitDocStatuses`·`collectDeletedDocEvents` 가 `--find-renames`
//   를 못박으므로 내용이 비슷하면 git 이 A+D 를 R(rename) 한 건으로 접어 버리고, 그러면 픽스처가
//   겨냥한 조건(재사용된 id 의 **삭제 이벤트**)에 도달조차 못 한다(P1 FP4 사고 · polluted-vault.mjs:208).
import { commit, feedCommit, git, initVault, writeDoc } from './tmp-git-vault.mjs'

// ── 문서 정체성(유효 UUIDv7 리터럴 — wiki-doc.schema.json pattern 준수) ────────────────────────
/** 대조군 문서 — 어느 vault 에서도 **반드시 살아남는다**(드리프트가 전면 확산되지 않았다는 앵커). */
export const ID_HEALTHY = '0192e000-0000-7000-8000-0000000000e1'
/** 드리프트 문서의 **생성 시점** id — 변조 전 값이자 대조 vault 의 최종 값이다. */
export const ID_ORIGINAL = '0192e000-0000-7000-8000-0000000000e2'
/** 사후 변조로 갈아끼운 id — 생성 시점 id 와 다르므로 깊은 티어가 `ID_TAMPERED` 로 잡는다. */
export const ID_TAMPERED_NOW = '0192e000-0000-7000-8000-0000000000e3'
/** 삭제된 문서의 id — 살아 있는 다른 경로가 이것을 재사용한다(`DELETED_ID_REUSE`). */
export const ID_REUSED = '0192e000-0000-7000-8000-0000000000e4'
/** draft 문서 id — DR5 의 **극성 대조**(fail-closed 드랍)를 만드는 쪽이다. */
export const ID_DRAFT = '0192e000-0000-7000-8000-0000000000e5'

// ── 경로(canonical path = breadcrumb.join('/')) 와 리포 상대 posix 경로 ────────────────────────
export const HEALTHY_REL = 'company/정상문서'
export const HEALTHY_PATH = 'wiki/company/정상문서.md'
export const DRIFT_REL = 'company/알파'
export const DRIFT_PATH = 'wiki/company/알파.md'
export const DELETED_REL = 'company/베타'
export const DELETED_PATH = 'wiki/company/베타.md'
export const REUSE_REL = 'tech/베타-신규'
export const REUSE_PATH = 'wiki/tech/베타-신규.md'
export const DRAFT_REL = 'dev/실험문서'
export const DRAFT_PATH = 'wiki/dev/실험문서.md'

// ── 본문 마커 — "이 문서의 본문이 실제로 렌더됐는가" 를 스펙이 문자열로 관측하는 좌표 ───────────
export const HEALTHY_MARKER = '정상본문마커'
export const DRIFT_MARKER = '드리프트본문마커'
export const REUSE_MARKER = '재사용본문마커'
export const DRAFT_MARKER = '초안본문마커'

// ── 피드 제목·시각(결정적) ────────────────────────────────────────────────────────────────────
export const DRIFT_FEED_TITLE = '알파 소식'
export const REUSE_FEED_TITLE = '베타 소식'
export const DRAFT_FEED_TITLE = '실험 소식'
export const FEED_TS = '2026-05-01T00:00:00Z'

const HEALTHY_BODY = `## 정의\n\n${HEALTHY_MARKER} — 대조군 문서다. 반도체 후공정 패키징 수율과 검사 장비 도입 일정을 정리한다.\n`
/** 대조 vault 의 3번째 커밋용 — **드리프트 문서는 건드리지 않는다**(둘의 알파 본문이 글자까지 같아야 한다). */
const HEALTHY_BODY_V2 = `## 정의\n\n${HEALTHY_MARKER} — 대조군 문서다. 검사 장비 도입 일정을 분기별로 갱신했다.\n`
const DRIFT_BODY_V1 = `## 정의\n\n초판 본문이다. 알파 법인의 설립 연혁과 지분 구조를 기록한다.\n`
const DRIFT_BODY_V2 = `## 정의\n\n${DRIFT_MARKER} — 갱신 본문이다. 알파 법인의 신규 공장 착공과 증설 계획을 다룬다.\n`
const DELETED_BODY = `## 정의\n\n베타 법인의 물류 창고 임차 계약과 재고 회전율 추이를 기록한 문서다.\n`
const REUSE_BODY_V1 = `## 개요\n\n환율 헤지 비율과 결제 통화별 만기 구조를 표로 남긴 전혀 다른 문서다.\n`
const REUSE_BODY_V2 = `## 개요\n\n${REUSE_MARKER} — 환율 헤지 비율을 분기별로 갱신했다. 결제 통화 구성도 함께 손봤다.\n`
const DRAFT_BODY_V1 = `## 정의\n\n초안 문서다. 아직 공개하지 않는 실험 메모를 담는다.\n`
const DRAFT_BODY_V2 = `## 정의\n\n${DRAFT_MARKER} — 초안을 갱신했다. 여전히 dev 폴더 아래에 있다.\n`

/**
 * **TAMPERED** — 생성 시점 id 와 현재 id 가 어긋난 문서 1건 + 정상 문서 1건 + 그 드리프트 문서를
 * 가리키는 `feed:` 1건.
 *
 * ```text
 * ① wiki/company/정상문서.md id=ID_HEALTHY   ┐ 초기 커밋
 *    wiki/company/알파.md     id=ID_ORIGINAL ┘
 * ② wiki/company/알파.md 갱신 → feed: 알파 소식      ← 이 피드가 그 문서를 가리킨다
 * ③ wiki/company/알파.md 의 **id 만** ID_TAMPERED_NOW 로 변조 커밋   ← 결함 주입 1곳
 * ```
 *
 * 얕은 티어: 알파는 정상 문서로 보이고 피드는 그것을 가리킨다(**오늘의 서빙** · B7).
 * 깊은 티어: 알파가 `ID_TAMPERED` 로 제외되고, 피드는 **생존하되 `docs: []`**(fail-open) 이 된다.
 */
export function seedTamperedVault() {
  const vault = initVault()
  writeDoc(vault, HEALTHY_REL, { body: HEALTHY_BODY, id: ID_HEALTHY, title: '정상문서' })
  writeDoc(vault, DRIFT_REL, { body: DRIFT_BODY_V1, id: ID_ORIGINAL, title: '알파' })
  commit(vault, 'chore: 문서 2건 생성')

  writeDoc(vault, DRIFT_REL, { body: DRIFT_BODY_V2, id: ID_ORIGINAL, title: '알파' })
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: DRIFT_FEED_TITLE })

  // 결함 주입 — **id 만** 갈아끼운다. 경로·본문·나머지 frontmatter 는 대조 vault 와 글자까지 같다.
  writeDoc(vault, DRIFT_REL, { body: DRIFT_BODY_V2, id: ID_TAMPERED_NOW, title: '알파' })
  commit(vault, 'chore: id 사후 변조')

  return {
    feedId: feedSha.slice(0, 12),
    feedSha,
    tamperedPath: DRIFT_PATH,
    tamperedRel: DRIFT_REL,
    vault,
  }
}

/**
 * **CONTROL** — `seedTamperedVault()` 와 **같은 모양, 변조 없음**. 전 DR 케이스의 대조군이다.
 *
 * 세 번째 커밋도 그대로 낸다(커밋 수·경로·피드가 같아야 "차이의 원인이 변조뿐" 이라고 말할 수 있다).
 * 다른 것은 **id 를 갈아끼우지 않는다**는 것 하나뿐이다.
 */
export function seedControlVault() {
  const vault = initVault()
  writeDoc(vault, HEALTHY_REL, { body: HEALTHY_BODY, id: ID_HEALTHY, title: '정상문서' })
  writeDoc(vault, DRIFT_REL, { body: DRIFT_BODY_V1, id: ID_ORIGINAL, title: '알파' })
  commit(vault, 'chore: 문서 2건 생성')

  writeDoc(vault, DRIFT_REL, { body: DRIFT_BODY_V2, id: ID_ORIGINAL, title: '알파' })
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: DRIFT_FEED_TITLE })

  // 커밋 수를 맞추되 **드리프트 문서는 손대지 않는다** — 알파의 본문·id 가 tampered vault 와
  //   글자까지 같아야 "차이의 원인이 id 변조 하나" 라고 말할 수 있다.
  writeDoc(vault, HEALTHY_REL, { body: HEALTHY_BODY_V2, id: ID_HEALTHY, title: '정상문서' })
  commit(vault, 'chore: 변조 없는 대조 커밋')

  return {
    feedId: feedSha.slice(0, 12),
    feedSha,
    tamperedPath: DRIFT_PATH,
    tamperedRel: DRIFT_REL,
    vault,
  }
}

/**
 * **ID_REUSE** — 삭제된 문서의 id 를 다른 경로가 재사용한다.
 *
 * ```text
 * ① wiki/company/정상문서.md id=ID_HEALTHY  ┐ 초기 커밋
 *    wiki/company/베타.md     id=ID_REUSED  ┘
 * ② wiki/company/베타.md **삭제** 커밋              ← 결함의 전반부
 * ③ wiki/tech/베타-신규.md 를 **같은 id** 로 생성   ← 결함 주입 1곳(본문은 전혀 다르다)
 * ④ 그 문서를 갱신 → feed: 베타 소식
 * ```
 *
 * ②③ 을 **다른 커밋**으로 나눈 이유: 한 커밋에 넣으면 `--find-renames` 가 A+D 를 R 로 접어
 * 삭제 이벤트 자체가 사라진다(위 헤더 ★). 본문도 서로 겹치지 않게 썼다.
 */
export function seedIdReuseVault() {
  const vault = initVault()
  writeDoc(vault, HEALTHY_REL, { body: HEALTHY_BODY, id: ID_HEALTHY, title: '정상문서' })
  writeDoc(vault, DELETED_REL, { body: DELETED_BODY, id: ID_REUSED, title: '베타' })
  commit(vault, 'chore: 문서 2건 생성')

  git(vault, ['rm', '-q', DELETED_PATH])
  commit(vault, 'chore: 베타 문서 삭제')

  writeDoc(vault, REUSE_REL, { body: REUSE_BODY_V1, id: ID_REUSED, title: '베타 신규' })
  commit(vault, 'chore: 삭제된 id 를 재사용한 문서 생성')

  writeDoc(vault, REUSE_REL, { body: REUSE_BODY_V2, id: ID_REUSED, title: '베타 신규' })
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: REUSE_FEED_TITLE })

  return {
    deletedPath: DELETED_PATH,
    feedId: feedSha.slice(0, 12),
    feedSha,
    reusedId: ID_REUSED,
    reusedPath: REUSE_PATH,
    reusedRel: REUSE_REL,
    vault,
  }
}

/**
 * **DRAFT-REF** — prod 에서 **사라지는** 피드. DR5 의 극성 대조군이다.
 *
 * draft 문서(=`dev/` 폴더)만 가리키는 피드는 prod 에서 `draft-excluded` → **fail-closed 드랍**이다.
 * 드리프트 문서를 가리키는 피드(`invalid-excluded` → fail-open **생존**)와 극성이 반대라서,
 * "사유가 뒤바뀌면 서빙이 뒤집힌다"(R2 D3)를 관측 가능한 짝으로 만든다.
 */
export function seedDraftRefVault() {
  const vault = initVault()
  writeDoc(vault, HEALTHY_REL, { body: HEALTHY_BODY, id: ID_HEALTHY, title: '정상문서' })
  writeDoc(vault, DRAFT_REL, { body: DRAFT_BODY_V1, id: ID_DRAFT, title: '실험문서' })
  commit(vault, 'chore: 정상 1건 + 초안 1건 생성')

  writeDoc(vault, DRAFT_REL, { body: DRAFT_BODY_V2, id: ID_DRAFT, title: '실험문서' })
  const feedSha = feedCommit(vault, { date: FEED_TS, subject: DRAFT_FEED_TITLE })

  return {
    draftPath: DRAFT_PATH,
    draftRel: DRAFT_REL,
    feedId: feedSha.slice(0, 12),
    feedSha,
    vault,
  }
}
