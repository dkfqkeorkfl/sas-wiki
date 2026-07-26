// P3 — 오염 문서 시딩 원자 (POLLUTED-BASE 외 4종). **`expect` 를 두지 않는다**(tdd §2.3 규범 D).
//
// DAMP 경계: 이 파일은 **시딩 사실만** 만든다. "무엇이 틀렸고 그래서 어떻게 되어야 하는가" 는
//   각 스펙 본문에서 단언한다 — 헬퍼가 판정하면 스펙만 읽고는 무엇을 무는지 알 수 없다.
//   (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
//
// 자기참조 공허성 금지(tdd §2.3 규범 A): 아래 id·경로·태그·사유 문자열은 **전부 리터럴**이다.
//   `WIKI_PREFIX`·`REASON_CODES`·`IMPORTANCE` 를 import 해 입력을 만들지 않는다. 드리프트 감지는
//   트립와이어 스펙(PG9 · PL3)이 담당한다.
//
// 왜 5파일이 이 헬퍼를 공유하는가(tdd §10.3-5): POLLUTED-BASE 가 `build.doc-exclusion` ·
//   `serving.exclusion` · `summary.generator` · `summary.cli-exit` · `validate.exclusion` 에서
//   반복된다. 시딩은 기계이고 단언은 의미다 — 기계만 뽑는다(DRY), 의미는 각 스펙에 남긴다(DAMP).
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { commit, feedCommit, git, initVault, writeDoc } from './tmp-git-vault.mjs'

// ── 문서 정체성(유효 UUIDv7 리터럴 — wiki-doc.schema.json pattern 준수) ────────────────────────
export const ID_A = '0192a000-0000-7000-8000-0000000000aa' // 대조군(반드시 살아남는다)
export const ID_B = '0192b000-0000-7000-8000-0000000000bb'
export const ID_C = '0192c000-0000-7000-8000-0000000000cc'
export const ID_DUP = '0192d000-0000-7000-8000-0000000000dd' // 쌍둥이 2건이 공유하는 id

/** 스키마 위반 id — UUIDv7 pattern 을 어긴다(리터럴). */
export const BAD_ID = 'not-a-valid-uuid'

// ── 결정적 커밋 시각 ──────────────────────────────────────────────────────────────────────────
export const T1 = '2026-03-01T00:00:00Z'
export const T2 = '2026-03-02T00:00:00Z'
export const T3 = '2026-03-03T00:00:00Z'

// ── 경로·표시 문자열(리포 상대 posix — stats/리포트 좌표계와 같은 공간) ───────────────────────
export const CONTROL_REL = 'company/정상'
export const CONTROL_PATH = 'wiki/company/정상.md'
export const TWIN_A_REL = 'concept/쌍둥이-A'
export const TWIN_A_PATH = 'wiki/concept/쌍둥이-A.md'
export const TWIN_B_REL = 'concept/쌍둥이-B'
export const TWIN_B_PATH = 'wiki/concept/쌍둥이-B.md'
export const STRAY_REL = 'concept/메모장'
export const STRAY_PATH = 'wiki/concept/메모장.md'
export const BROKEN_REL = 'concept/깨진문서'
export const BROKEN_PATH = 'wiki/concept/깨진문서.md'

export const CONTROL_TAG = '반도체'
export const TWIN_TAG = '메모리'

export const CONTROL_FEED_TITLE = '정상 소식'
export const TWIN_FEED_TITLE = '쌍둥이 소식'
export const STRAY_FEED_TITLE = '메모장 소식'

/**
 * frontmatter 를 **줄 단위로 그대로** 쓰는 최저수준 원자.
 *
 * `writeDoc`(tmp-git-vault)은 정상 문서만 만든다 — 오염은 "키를 빼거나 잘못된 값을 넣는" 것이므로
 * frontmatter 를 직접 조립할 수 있어야 한다. `survival-vault.mjs` 의 `writeDraftDoc` 과 같은 관례다.
 */
export function writeRawDoc(root, rel, frontmatterLines, body = '## 정의\n\n본문 문단이다.\n') {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, ['---', ...frontmatterLines, '---', '', body].join('\n'))
  return full
}

/** 정상 문서 + 태그 — 대조군이 `tags` 역색인에도 등장해야 PG2 의 4곳 대칭 단언이 성립한다. */
export function writeTaggedDoc(root, rel, { body, id, tag }) {
  return writeRawDoc(
    root,
    rel,
    [
      `title: ${rel.split('/').at(-1)}`,
      'type: concept',
      'status: active',
      `tags: ["${tag}"]`,
      `id: "${id}"`,
    ],
    body,
  )
}

/** 오염 ①: `type` 키가 아예 없다(현행 `parse-vault.mjs:70` 이 throw 하는 그 상태). */
export function writeMissingTypeDoc(root, rel, id) {
  return writeRawDoc(root, rel, [
    `title: ${rel.split('/').at(-1)}`,
    'status: active',
    `id: "${id}"`,
  ])
}

/** 오염 ②: id 가 UUIDv7 pattern 을 어긴다(스키마 위반). */
export function writeInvalidIdDoc(root, rel, id = BAD_ID) {
  return writeRawDoc(root, rel, [
    `title: ${rel.split('/').at(-1)}`,
    'type: concept',
    'status: active',
    `id: "${id}"`,
  ])
}

/** 오염 ③: 제거된 `created` 가 frontmatter 에 남아 있다(git 히스토리 유도 계약 위반). */
export function writeCreatedResidueDoc(root, rel, id) {
  return writeRawDoc(root, rel, [
    `title: ${rel.split('/').at(-1)}`,
    'type: concept',
    'status: active',
    'created: "2026-01-01"',
    `id: "${id}"`,
  ])
}

/** 오염 ④: frontmatter 가 아예 없는 `.md`(문서 후보이되 문서가 아니다 — stray). */
export function writeStrayFile(root, rel, text = '그냥 메모다. frontmatter 가 없다.') {
  const full = path.join(root, 'wiki', `${rel}.md`)
  mkdirSync(path.dirname(full), { recursive: true })
  writeFileSync(full, `${text}\n`)
  return full
}

/**
 * **CLEAN-BASE** — 오염 0건 대조군. 정상 문서 3건 + 그중 하나를 가리키는 `feed:` 1건.
 *
 * 제외 모델이 정상 문서를 갉아먹지 않는지(PG8·SR5·VD1)와 생성기 클린 경로(GN1~GN3)의 입력이다.
 */
export function seedCleanVault() {
  const vault = initVault()
  writeTaggedDoc(vault, CONTROL_REL, { id: ID_A, tag: CONTROL_TAG })
  writeDoc(vault, 'concept/메모리', { id: ID_B, wikiRoot: 'wiki' })
  writeDoc(vault, 'concept/공정', { id: ID_C, wikiRoot: 'wiki' })
  commit(vault, 'chore: 초기 문서 3건')

  writeTaggedDoc(vault, CONTROL_REL, { body: '## 정의\n\n정상 갱신.\n', id: ID_A, tag: CONTROL_TAG })
  const controlFeedSha = feedCommit(vault, { date: T1, subject: CONTROL_FEED_TITLE })
  return { controlFeedSha, vault }
}

/**
 * **POLLUTED-BASE** — tdd §3.2 의 공통 픽스처.
 *
 * ```text
 * wiki/company/정상.md       id=ID_A    tags:[반도체]  → 대조군(반드시 살아남는다)
 * wiki/concept/쌍둥이-A.md   id=ID_DUP  tags:[메모리]  ┐ 같은 id 를 가진 2건 —
 * wiki/concept/쌍둥이-B.md   id=ID_DUP  tags:[메모리]  ┘ PRD A.3 「둘 다 제외」
 * feed: 정상 소식   (T1) → 정상 수정
 * feed: 쌍둥이 소식 (T2) → 쌍둥이-A 수정   ← 제외 문서를 가리키는 피드(생존해야 한다 · docs [])
 * ```
 *
 * 세 문서 모두 **draft 가 아니다**(`dev/` 밖 · `draft` 플래그 없음) → dev·prod 양쪽에서 가시 후보다.
 * 그래야 PG5(env 무관 생존)가 draft 필터와 뒤섞이지 않는다.
 */
export function seedPollutedVault() {
  const vault = initVault()
  writeTaggedDoc(vault, CONTROL_REL, { id: ID_A, tag: CONTROL_TAG })
  writeTaggedDoc(vault, TWIN_A_REL, { id: ID_DUP, tag: TWIN_TAG })
  writeTaggedDoc(vault, TWIN_B_REL, { id: ID_DUP, tag: TWIN_TAG })
  commit(vault, 'chore: 초기 문서 3건')

  writeTaggedDoc(vault, CONTROL_REL, { body: '## 정의\n\n정상 갱신.\n', id: ID_A, tag: CONTROL_TAG })
  const controlFeedSha = feedCommit(vault, { date: T1, subject: CONTROL_FEED_TITLE })

  writeTaggedDoc(vault, TWIN_A_REL, { body: '## 정의\n\n쌍둥이 갱신.\n', id: ID_DUP, tag: TWIN_TAG })
  const twinFeedSha = feedCommit(vault, { date: T2, subject: TWIN_FEED_TITLE })

  return { controlFeedSha, twinFeedSha, vault }
}

/**
 * **STRAY-BASE** — frontmatter 없는 `.md` 를 `feed:` 커밋이 수정한다.
 *
 * "어느 커밋이 깨진 문서를 참조하는가" 의 진단 좌표(`{ path, sha }`)가 제외 모델로 옮겨가면서도
 * 살아남는지(PG7 · F5)를 보는 입력이다.
 */
export function seedStrayVault() {
  const vault = initVault()
  writeTaggedDoc(vault, CONTROL_REL, { id: ID_A, tag: CONTROL_TAG })
  writeStrayFile(vault, STRAY_REL)
  commit(vault, 'chore: 초기 문서 1건 + 메모 1건')

  writeStrayFile(vault, STRAY_REL, '메모를 고쳤다. 여전히 frontmatter 가 없다.')
  const strayFeedSha = feedCommit(vault, { date: T3, subject: STRAY_FEED_TITLE })
  return { strayFeedSha, vault }
}

/**
 * **CONVENTION-BASE** — 커밋 컨벤션 위반(A+D 한 커밋) **과** 제외 대상 문서가 동시에 있는 vault.
 *
 * 게이트 순서(컨벤션 → 문서)가 보존되는지(VD6)만을 위한 입력이다. 제외 사유는 **스키마 위반**을
 * 쓴다 — 중복 id 는 현행에서 파싱 단계(`derive`)가 먼저 죽여 "순서" 자체를 관측할 수 없다.
 */
export function seedConventionViolationVault() {
  const vault = initVault()
  writeTaggedDoc(vault, CONTROL_REL, { id: ID_A, tag: CONTROL_TAG })
  writeRawDoc(
    vault,
    'concept/이전',
    ['title: 이전', 'type: concept', 'status: active', `id: "${ID_B}"`],
    // ★ 아래 두 문서의 본문을 **거의 겹치지 않게** 쓴다. `getCommitDocStatuses` 는 `--find-renames`
    //   를 못박으므로(`git.mjs:240`) 내용이 비슷하면 git 이 A+D 를 **R(rename) 한 건**으로 접어
    //   버리고, 그러면 이 픽스처가 겨냥한 컨벤션 위반이 발생하지 않는다(실측으로 확인했다).
    '## 정의\n\n노광 장비 도입 일정과 웨이퍼 투입량 계획을 정리한 문서다.\n\n## 로드맵\n\n이머전 노광에서 EUV 로 전환하는 시점을 분기별로 적는다.\n',
  )
  commit(vault, 'chore: 초기 문서 2건')

  // A+D 를 한 커밋에 — `checkCommitConventions` 가 문서 id 소실 시그니처로 잡는 그 형태다.
  git(vault, ['rm', '-q', 'wiki/concept/이전.md'])
  writeRawDoc(
    vault,
    BROKEN_REL,
    ['title: 깨진문서', 'type: concept', 'status: active', `id: "${BAD_ID}"`],
    '## 정의\n\n환율 변동이 수출 채권 회수에 미치는 영향을 다룬다.\n\n## 배경\n\n결제 통화별 헤지 비율과 만기 구조를 표로 남긴다.\n',
  )
  commit(vault, 'chore: 문서 교체 + 깨진 문서 추가')
  return { brokenPath: BROKEN_PATH, removedPath: 'wiki/concept/이전.md', vault }
}
