// draft↔public 문서 ID 충돌 테스트가 공유하는 vault 시딩 원자. 단언과 정리는 호출부가 소유한다.
// 이 파일은 시딩 사실만 만들고 vault 경로를 반환하며 `expect` 를 두지 않는다.
import { commit, initVault, writeDoc } from './tmp-git-vault.mjs'

const ID_SHARED = '0192a000-0000-7000-8000-0000000000aa'
const ID_OTHER = '0192b000-0000-7000-8000-0000000000bb'
const REL_PUBLIC = 'company/공개'
/** `wiki/dev/` 폴더 안의 문서는 그 위치만으로 draft 다. */
const REL_DRAFT = 'dev/초안'

/** public 1건 + draft 1건이 같은 id 를 쓰는 vault. */
export function seedCollisionVault() {
  const vault = initVault()
  writeDoc(vault, REL_PUBLIC, { id: ID_SHARED })
  writeDoc(vault, REL_DRAFT, { id: ID_SHARED })
  commit(vault, 'chore: 공개 문서 + 같은 id draft')
  return vault
}

/** 형태는 같고 id 만 다른 대조군 vault. */
export function seedDistinctVault() {
  const vault = initVault()
  writeDoc(vault, REL_PUBLIC, { id: ID_SHARED })
  writeDoc(vault, REL_DRAFT, { id: ID_OTHER })
  commit(vault, 'chore: 공개 문서 + 다른 id draft')
  return vault
}
