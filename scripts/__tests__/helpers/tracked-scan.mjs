// 추적 파일 스캔 프리미티브 — P6 부재 가드(LS·PL) 공용. tdd §7.2 의 seam 계약 그대로다.
//
// ★ **판정하지 않는다**(규범 D). `expect` 가 없고 "위반인가" 도 묻지 않는다 — 사실만 캔다.
//   「레거시인가」의 판정 권위는 스펙 본문의 **예외 레지스트리 하나**에만 산다. 스캐너에 예외 술어를
//   흩뿌리면 판정이 두 곳에 살고, 그 순간 한쪽만 고쳐도 통과하는 구멍이 생긴다.
//
// 왜 이 형태인가 (부록 B 하드닝 체크리스트):
//   H5 — `rg` 는 ignore·hidden·binary·symlink 4종을 **조용히** 건너뛴다. 그 조용함이 부재 가드를
//        공허하게 만드는 주범이라, 여기서는 건너뛴 것을 `skipped` 에 **실어 돌려준다**.
//   H7 — 비-git 디렉토리·git 실패는 **throw** 다. 빈 배열로 접으면 gitleaks #1450
//        (_"scanning zero files, which succeeds trivially"_ → `no leaks found` + exit 0)이 된다.
//   D-H — 스캔 범위는 **git 이 아는 파일**(`ls-files` ∪ `ls-files --others --exclude-standard`)이다.
//        파일시스템 전역을 고르면 gitignore 된 `logs/coverage/lcov-report/**.html` 2건 때문에
//        **영구 red** 가 된다(실측 33 vs 35). `--exclude-standard` 가 그 경계를 그대로 지킨다 —
//        상세 근거는 `listTracked` 도크.
//
// (vitest 기본 include 는 `*.test.mjs` 만 잡으므로 helpers/*.mjs 는 테스트로 수집되지 않는다 — 의도.)
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'

/**
 * 9p 공유 마운트의 소유자 불일치로 git 이 _"detected dubious ownership"_ 로 죽는 것은 **이 스캔이
 * 겨냥한 실패가 아니다.** git 정식 env config(`GIT_CONFIG_COUNT`/`_KEY_n`/`_VALUE_n`)로 그 한 줄만
 * 되살린다 — `feeds.env-leak.verify.test.mjs:104` 의 `withSafeDirectory` 와 같은 조치를 **프로세스
 * 전역 변이 없이 자식 env 로만** 건다(전역 변이는 병렬 실행 중 다른 스펙과 경합한다).
 *
 * identity(`GIT_AUTHOR_*`)는 여전히 주입하지 않으므로 헤르메틱 규약은 깨지지 않는다.
 */
function gitEnv(root) {
  return {
    ...process.env,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'safe.directory',
    GIT_CONFIG_VALUE_0: root,
  }
}

/**
 * 줄 수를 **보존하며** C 계열 주석을 걷어낸다(기존 LG1 의 `codeOnly` 계승 + 줄번호 보존 보강).
 *
 * 원본 `codeOnly` 는 블록 주석을 통째로 지워 **줄번호가 밀린다** — 진단 메시지가 `경로:줄` 을
 * 담아야 하는 이 phase 에서는 그 자체가 결함이다(H9). 그래서 블록 주석은 개행만 남기고 공백으로
 * 덮는다.
 *
 * ★ 알려진 오제거: 문자열 안의 `//`(URL 등)를 주석으로 볼 수 있다. **오제거는 안전 방향**이다 —
 *   스캔이 넓어지지 않고 좁아진다. 좁아진 만큼은 호출부의 `scannedLines` 하한(LS0)이 방어한다.
 *   `.md`·`.yml` 처럼 `//` 가 주석이 아닌 파일에서도 같은 방향으로만 틀린다.
 */
function stripCStyleComments(source) {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, (block) => block.replaceAll(/[^\n]/g, ' '))
    .replaceAll(/(^|[^:])\/\/.*$/gm, '$1')
}

/** `git ls-files` 한 번. 실패는 삼키지 않는다(H7). */
function lsFiles(root, extraArgs) {
  return execFileSync('git', ['-C', root, 'ls-files', '-z', ...extraArgs], {
    encoding: 'utf8',
    env: gitEnv(root),
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
    .split('\0')
    .filter(Boolean)
}

/**
 * **git 이 아는 파일 전수** — 추적(`ls-files`) ∪ 미추적-비무시(`--others --exclude-standard`).
 *
 * ★ 왜 `--others` 까지 넣나(tdd §D-H 의 문언은 "추적 전역" 이다 — 여기서 한 걸음 넓혔다):
 *   ① D-H 가 파일시스템 전역을 금지한 **이유**는 gitignore 된 `logs/coverage/lcov-report/**.html`
 *      2건이 영구 red 를 만들기 때문이다(실측 33 vs 35). `--exclude-standard` 는 `.gitignore` 를
 *      그대로 존중하므로 **그 이유는 완전히 충족**된다.
 *   ② 이 리포에는 훅도 CI 도 없다 — 새 위반이 들어오는 유일한 경로가 **아직 커밋되지 않은 새 파일**
 *      이다. 추적본만 보면 가드가 항상 한 커밋 늦게 깨어나고, 예외 레지스트리는 자기 자신(아직
 *      미추적인 신규 가드 파일)을 "죽은 예외" 로 오판한다.
 *   ③ 대신 감수하는 것: 워킹트리에 남은 **비무시 스크래치 파일**도 스캔된다. 그것이 red 를 내면
 *      그 파일은 곧 커밋될 후보이므로 red 가 정직하다(치우거나 예외로 등재하라는 신호다).
 *
 * NUL 구분은 **필수**다. 실측: 이 리포의 `wiki/` 에 한글 경로가 실재해 개행 파싱을 쓰면 git 이
 * `"wiki/company/..."` 형태로 따옴표 이스케이프한 문자열을 그대로 흘린다.
 *
 * @param {string} repoRoot 리포 루트(절대·상대 무관 — 내부에서 resolve)
 * @returns {{ files: string[], skipped: { path: string, why: string }[] }}
 *   `files` = 텍스트로 읽힌 것 · `skipped` = 읽지 못했거나 바이너리로 판정한 것.
 *   두 배열의 합집합이 엔트리 전수다(**조용히 버리는 것이 없다**).
 * @throws git 이 실패하면(비-git·권한·부재) 그대로 던진다 — 빈 배열로 접지 않는다(H7).
 */
export function listTracked(repoRoot) {
  const root = path.resolve(repoRoot)
  const entries = [...new Set([...lsFiles(root, []), ...lsFiles(root, ['--others', '--exclude-standard'])])] // prettier-ignore

  const files = []
  const skipped = []
  for (const rel of entries.sort()) {
    const full = path.join(root, rel)
    try {
      // gitlink(서브모듈)는 인덱스에 1엔트리로 있지만 파일이 아니다 — 조용히 흘리지 않고 싣는다.
      if (!statSync(full).isFile()) {
        skipped.push({ path: rel, why: 'not-a-regular-file' })
        continue
      }
      if (readFileSync(full).includes(0)) {
        skipped.push({ path: rel, why: 'binary' })
        continue
      }
      files.push(rel)
    } catch (error) {
      skipped.push({ path: rel, why: `unreadable:${error?.code ?? 'unknown'}` })
    }
  }
  return { files, skipped }
}

/**
 * 주어진 파일 목록에서 패턴에 걸리는 줄을 캔다. **예외를 적용하지 않는다**(판정 권위 하나).
 *
 * @param {object} options
 * @param {string[]} options.files `listTracked(...).files` 를 그대로 받는다(이미 읽기 가능·텍스트)
 * @param {RegExp} options.pattern 줄 단위 매치 패턴(전역 플래그는 제거하고 쓴다 — lastIndex 오염 방지)
 * @param {string} options.repoRoot 리포 루트
 * @param {boolean} [options.stripComments] true 면 C 계열 주석을 걷어낸 뒤 매치한다
 * @returns {{ hits: { line: number, path: string, text: string }[], scannedFiles: number, scannedLines: number }}
 */
export function scanTracked({ files, pattern, repoRoot, stripComments = false }) {
  const root = path.resolve(repoRoot)
  const linePattern = new RegExp(pattern.source, pattern.flags.replace('g', ''))
  const hits = []
  let scannedFiles = 0
  let scannedLines = 0

  for (const rel of files) {
    const source = readFileSync(path.join(root, rel), 'utf8')
    const lines = (stripComments ? stripCStyleComments(source) : source).split('\n')
    scannedFiles += 1
    scannedLines += lines.length
    for (const [index, text] of lines.entries()) {
      if (linePattern.test(text)) hits.push({ line: index + 1, path: rel, text: text.trim() })
    }
  }

  return { hits, scannedFiles, scannedLines }
}
