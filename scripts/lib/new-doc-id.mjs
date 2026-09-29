import { v7 as uuidv7 } from 'uuid'

/**
 * 새 문서 id(UUIDv7)를 발급한다.
 *
 * `doc-id.mjs` 와 분리한 이유: 그 모듈은 서빙 경로(feeds 등)까지 import 하는데, 서빙 경로는 npm
 * 패키지를 로드하지 않는다는 계약이 있다(`serving.cost-profile.test.mjs`). 발급은 커밋 직전 훅만
 * 하므로 `uuid` 는 이 모듈에만 둔다.
 */
export function newDocId() {
  return uuidv7()
}
