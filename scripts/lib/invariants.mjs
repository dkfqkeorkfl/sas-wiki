// 불변식 8종 (data-contract §10) — 위반 시 **build fail**.
//
// 세 페이로드가 따로 배포되면 아래는 더 이상 자명하지 않다. 지금 성립하는 건 "빌드가 한 번에
// 만들기 때문"이라는 우연이고, 그 우연이 깨지는 첫 순간이 서버 연동이다.
//
// 메시지 계약: **무엇이 무엇을 못 찾았는지**를 담는다. "invariant 1 violated" 류는 대량 실패 시
// 원인 추적이 불가능하다.

import { getCommitDocStatuses } from './git.mjs'

const CONVENTION_RE = /^(cwiki|uwiki|feed):\s/

/** 커밋 subject 규약이 문서 id 안정성을 깨뜨리는 파일 상태를 만들면 build fail 한다. */
export function checkCommitConventions(commits, runGit, wikiPrefix) {
  const violations = []
  for (const commit of commits) {
    const match = (commit.subject || '').match(CONVENTION_RE)
    // D26: 접두어 없는 커밋도 A+D(문서 id 소실 시그니처)를 검사해야 하므로 statuses 를 모든
    // 커밋에 대해 구한다(이전엔 접두어 커밋만). 마진 비용은 non-vault(툴링) 커밋 수에 한정된다 —
    // vault 커밋(cwiki/uwiki/feed)은 원래도 여기서 git show 됐다. sha 가 달라 커밋마다 1회 spawn.
    const statuses = getCommitDocStatuses(runGit, commit.hash, wikiPrefix)
    const added = statuses.filter((entry) => entry.status === 'A')
    const deleted = statuses.filter((entry) => entry.status === 'D')

    if (!match) {
      if (added.length > 0 && deleted.length > 0) {
        violations.push({ added, commit, deleted, kind: null })
      }
      continue
    }

    const kind = match[1]

    if (kind === 'cwiki') {
      if (added.length !== 1 || deleted.length > 0) {
        violations.push({ added, commit, deleted, kind })
      }
      continue
    }

    if ((kind === 'uwiki' || kind === 'feed') && added.length > 0) {
      violations.push({ added, commit, deleted, kind })
    }
  }
  if (violations.length > 0) fail(formatConventionViolations(violations))
}

/** 역인덱스도 삭제 이력도 설명 못 한 feed 경로는 데이터 결함이다. */
export function checkFeedResolution(stats) {
  if (!stats.unresolvedPaths || stats.unresolvedPaths.length === 0) return
  const detail = stats.unresolvedPaths
    .map((entry) => `  - ${String(entry.sha).slice(0, 12)} ${entry.path}`)
    .join('\n')
  fail(
    `해석되지 않은 feed 문서 참조 ${stats.unresolvedPaths.length}건 — 빌드를 중단한다:\n` +
      detail +
      '\n  → feed 커밋이 가리킨 경로를 현재 문서 역인덱스에서 찾지 못했고, 삭제 이력으로도 설명되지 않는다.',
  )
}

/** 정상이면 void, 위반이면 구체 메시지와 함께 throw. */
export function checkInvariants(summary, feeds, body) {
  const activeDocs = summary.docs.filter((doc) => doc.status !== 'disable')
  const activeIds = new Set(activeDocs.map((doc) => doc.id))
  const docById = new Map(summary.docs.map((doc) => [doc.id, doc]))
  const activePaths = new Set(activeDocs.map((doc) => doc.breadcrumb.join('/')))

  checkFeedDocRefs(feeds, docById)
  checkBodyKeys(body, activePaths, activeIds, summary)
  checkTreeMembership(summary, activeIds)
  checkTagIndex(summary, activeIds)
  checkTreePaths(summary, docById)
  checkAnchors(feeds, body, docById)
  checkSourceCommit(summary, feeds, body)
  checkUniqueIds(summary)
}

/**
 * 6. `feeds[].docs[].anchor` ∈ headings(그 문서) **또는** null. 죽은 앵커는 점프를 무반응으로 만든다.
 *
 * `anchorText`(카드 점프 칩 라벨 — 표시용 비정규화)도 **함께** 검사한다: 그 앵커를 가진 heading 의
 * `text` 와 일치해야 하고, `anchor` 가 null 이면 `anchorText` 도 null 이어야 한다. 어긋나면 카드가
 * 엉뚱한 섹션 이름을 보여준다 — 에러 없이, 조용히.
 */
function checkAnchors(feeds, body, docById) {
  for (const item of feeds.items) {
    for (const ref of item.docs) {
      const doc = docById.get(ref.id)
      const docPath = doc ? doc.breadcrumb.join('/') : ref.id
      const where = `feed ${item.id} → doc ${ref.id} (${docPath})`

      if (ref.anchor === null || ref.anchor === undefined) {
        if (ref.anchorText !== null && ref.anchorText !== undefined) {
          fail(
            `불변식 6: ${where} 의 anchor 는 null 인데 anchorText 가 "${ref.anchorText}" 다(가리킬 섹션이 없는데 라벨만 남았다)`,
          )
        }
        continue
      }

      const bodyDoc = Object.hasOwn(body.docs, docPath) ? body.docs[docPath] : undefined
      if (!bodyDoc) {
        fail(
          `불변식 6: ${where} 의 앵커 "${ref.anchor}" — 그 문서에는 body 가 없다(disable·삭제 → anchor 는 null 로 강등돼야 한다)`,
        )
      }
      const heading = bodyDoc.headings.find((candidate) => candidate.anchor === ref.anchor)
      if (!heading) {
        fail(`불변식 6: ${where} 의 앵커 "${ref.anchor}" 가 headings 에 없다(죽은 앵커)`)
      }
      if (heading.text !== ref.anchorText) {
        fail(
          `불변식 6: ${where} 의 anchorText "${ref.anchorText}" 가 앵커 "${ref.anchor}" 의 heading 원문("${heading.text}")과 다르다(카드가 엉뚱한 섹션 이름을 보여준다)`,
        )
      }
    }
  }
}

/** 2. `keys(body.docs)` == active 문서의 `breadcrumb.join('/')` — **양방향**. */
function checkBodyKeys(body, activePaths, activeIds, summary) {
  const bodyKeys = new Set(Object.keys(body.docs))
  for (const activePath of activePaths) {
    if (!bodyKeys.has(activePath)) {
      fail(`불변식 2: active 문서 "${activePath}" 의 본문이 body.docs 에 없다(문서 클릭 시 크래시)`)
    }
  }
  const disablePaths = new Map(
    summary.docs
      .filter((doc) => !activeIds.has(doc.id))
      .map((doc) => [doc.breadcrumb.join('/'), doc.id]),
  )
  for (const key of bodyKeys) {
    if (activePaths.has(key)) continue
    const reason = disablePaths.has(key)
      ? `disable 문서(${disablePaths.get(key)})의 본문이 실려 있다`
      : 'summary 의 active 문서에 없는 경로다'
    fail(`불변식 2: body.docs 의 키 "${key}" — ${reason}`)
  }
}

/** 1. `feeds[].docs[].id` ⊆ `summary.docs[].id` — **disable 포함**(정상적인 disable 운영을 죽이지 않는다). */
function checkFeedDocRefs(feeds, docById) {
  for (const item of feeds.items) {
    for (const ref of item.docs) {
      if (!docById.has(ref.id)) {
        fail(`불변식 1: feed ${item.id} → doc ${ref.id} (summary.docs 에 없음 — prune 누락 또는 역인덱스 오류)`) // prettier-ignore
      }
    }
  }
}

/** 7. 3 페이로드의 `sourceCommit` 이 동일. 다르면 배포 중 세대 혼합이다. */
function checkSourceCommit(summary, feeds, body) {
  const values = new Set([body.sourceCommit, feeds.sourceCommit, summary.sourceCommit])
  if (values.size > 1) {
    fail(
      `불변식 7: sourceCommit 불일치 — summary=${summary.sourceCommit} feeds=${feeds.sourceCommit} body=${body.sourceCommit}`,
    )
  }
}

/** 4. `tags[*]` ⊆ active ids. disable·삭제 문서가 섞이면 태그 페이지에 빈 행이 뜬다. */
function checkTagIndex(summary, activeIds) {
  for (const [tag, ids] of Object.entries(summary.tags)) {
    for (const id of ids) {
      if (!activeIds.has(id)) {
        fail(`불변식 4: tags["${tag}"] 의 doc ${id} 가 active 문서가 아니다`)
      }
    }
  }
}

/** 3. `tree` 문서 ⊆ active, 그리고 **모든 active 문서가 정확히 한 노드**에 속한다. */
function checkTreeMembership(summary, activeIds) {
  const seen = new Map()
  for (const node of flattenTree(summary.tree)) {
    for (const id of node.docs) {
      if (!activeIds.has(id)) {
        fail(`불변식 3: tree 노드 "${node.path}" 의 doc ${id} 가 active 문서가 아니다`)
      }
      if (seen.has(id)) {
        fail(`불변식 3: doc ${id} 가 두 노드에 있다("${seen.get(id)}", "${node.path}")`)
      }
      seen.set(id, node.path)
    }
  }
  for (const id of activeIds) {
    if (!seen.has(id)) fail(`불변식 3: active doc ${id} 가 tree 어느 노드에도 없다(사이드바 누락)`)
  }
}

/** 5. `tree[].path` == 그 노드 문서들의 `breadcrumb.slice(0,-1).join('/')`. */
function checkTreePaths(summary, docById) {
  for (const node of flattenTree(summary.tree)) {
    for (const id of node.docs) {
      const doc = docById.get(id)
      if (!doc) continue // 불변식 3 이 이미 잡는다
      const expected = doc.breadcrumb.slice(0, -1).join('/')
      if (expected !== node.path) {
        fail(
          `불변식 5: doc ${id} 의 폴더는 "${expected}" 인데 tree 노드 "${node.path}" 에 있다(서브트리 필터가 엉뚱한 문서를 집계한다)`,
        )
      }
    }
  }
}

/** 8. `summary.docs[].id` 유일 — `cwiki` 1파일 규칙의 최후 방어선. 중복이면 참조가 **틀린 문서**를 가리킨다. */
function checkUniqueIds(summary) {
  const seen = new Map()
  for (const doc of summary.docs) {
    const twin = seen.get(doc.id)
    if (twin) {
      fail(
        `불변식 8: doc id ${doc.id} 가 중복이다("${twin.breadcrumb.join('/')}", "${doc.breadcrumb.join('/')}") — 한 커밋이 문서 2개를 만들었다`,
      )
    }
    seen.set(doc.id, doc)
  }
}

function fail(message) {
  throw new Error(message)
}

function flattenTree(nodes) {
  const out = []
  const walk = (list) => {
    for (const node of list) {
      out.push(node)
      walk(node.children)
    }
  }
  walk(nodes)
  return out
}

function formatConventionViolation({ added, commit, deleted, kind }) {
  const lines = [`  - ${commit.hash.slice(0, 12)} ${commit.subject}`]
  if (kind === 'cwiki') {
    lines.push(
      `      cwiki 는 신규 vault 문서 1개만 추가해야 한다(현재 신규 ${added.length}개, 삭제 ${deleted.length}개).`,
    )
  } else if (!kind) {
    lines.push(
      `      접두어 없는 커밋은 vault 문서 추가와 삭제를 같은 커밋에 담을 수 없다(현재 신규 ${added.length}개, 삭제 ${deleted.length}개).`,
    )
  } else {
    lines.push(`      ${kind} 는 신규 vault 문서를 추가할 수 없다(현재 신규 ${added.length}개).`)
  }
  for (const entry of added) lines.push(`      신규 파일 추가: ${entry.path}`)
  for (const entry of deleted) lines.push(`      동시 삭제:     ${entry.path}`)
  if (added.length > 0 && deleted.length > 0) {
    lines.push(
      '      → 이동을 git 이 rename 으로 못 봤다(유사도 미달). 이동과 내용 재작성을 같은 커밋에',
      '        넣지 마라 — 문서 id 가 바뀌고 과거 피드가 전부 사라진다. 이동만 담은 uwiki 커밋과',
      '        내용 수정 커밋으로 분리하라.',
    )
  }
  return lines.join('\n')
}

function formatConventionViolations(violations) {
  const header = `컨벤션 위반 ${violations.length}건 — 빌드를 중단한다:`
  const body = violations.map(formatConventionViolation).join('\n')
  return `${header}\n${body}`
}
