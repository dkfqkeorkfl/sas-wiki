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
import { lstatSync, readFileSync } from 'node:fs'
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
 * 줄 수를 **보존하며** C 계열 주석을 걷어낸다 — 따옴표 상태를 추적하는 문자 스캐너다(정규식
 * 치환이 아니다). 정규식 두 방(블록 먼저 → 줄 나중)을 순서대로 쏘면 두 맹점이 생긴다:
 *   ① 문자열·템플릿 리터럴 안의 `//`·`/*` 쌍도 주석으로 오인해 그 뒤 실제 코드를 지운다.
 *   ② 줄 주석 안에 우연히 `/*` 가 있으면(URL 등) 블록 주석 시작으로 오인해 다음 `*​/` 까지 실제
 *      코드를 통째로 삼킨다 — 이 리포에서 같은 형태의 스캐너가 실제로 **16파일 773줄**을 이렇게
 *      놓쳤다(선례: `feeds.env-leak.verify.test.mjs`·`docs-contract.test.mjs` 의 `codeOnly`/
 *      `stripComments`, `helpers/static-import-graph.mjs` 의 `codeOnly`. 같은 규칙을 이 파일 안에
 *      지역 구현한다 — 파편화된 스캐너를 한 모듈로 통합하는 것은 이 phase 범위가 아니다).
 *
 * 그래서 이 스캐너는 **줄 주석을 블록 주석보다 먼저 판정**하고, 홑따옴표·겹따옴표·백틱 문자열
 * 안에서는 어떤 주석 판정도 하지 않는다(역슬래시 이스케이프 포함). 미종료 블록 주석은 EOF 까지
 * 소거한다(자바스크립트의 실제 동작과 같다).
 *
 * ★ 원본 정규식(`(^|[^:])\/\/.*$`)이 갖던 `://` 보호는 **그대로 승계**한다: 직전 문자가 `:` 면
 * `//` 를 줄 주석 시작으로 보지 않는다. 문자열 안의 URL 은 이제 따옴표 추적 자체가 지키지만, 이
 * 스캐너는 `.md`·`.yml` 처럼 문자열 개념이 없는 추적 파일에도 걸린다(`scanTierT` — Tier T 는
 * `!isProductionSource` 필터만 걸어 확장자를 가리지 않는다) — 그런 파일의 산문에 박힌
 * `https://…` 링크가 따옴표 밖에 있어도 이 보호가 계속 막아 준다.
 *
 * ★ 참고 구현(`static-import-graph.mjs` 의 `codeOnly` 등)과의 **의도적 차이 — 줄번호 보존**: 그
 * 구현들은 블록 주석을 통째로 들어내 **줄번호가 밀린다.** 진단 메시지가 `경로:줄` 을 담아야 하는
 * 이 파일에서는 그 자체가 결함이라(H9), 블록 주석은 개행만 남기고 나머지는 공백으로 덮는다 —
 * 삭제가 아니라 **자리보전**이다.
 *
 * ★ 정규식 리터럴도 문자열처럼 다룬다(따옴표 아님) — 처음엔 안 다뤘다가 **자기 발등을 찍은 실측**으로
 *   추가했다: 이 파일 자신이 속한 배치를 검수하며 이 스캐너로 `legacy-sweep.test.mjs` 를 스캔했더니,
 *   그 파일의 `/\bmessage: '/` 같은 정규식 리터럴 안의 홑따옴표를 "문자열 시작"으로 오인해 상태가
 *   어긋났고, 그 뒤로 등장하는 진짜 `//` 주석들이 더는 주석으로 인식되지 않아 주석 안의 레거시 접두사
 *   언급이 **거짓 위반으로 노출**됐다(5건 — 실제로는 전부 역사 서술 주석). 그래서 나눗셈과 정규식
 *   시작을 가르는 표준 휴리스틱(직전 유의미 토큰이 `(`·`,`·`=`·`return`·줄 시작 등 "값이 아직 안
 *   끝난 자리"면 정규식, 식별자·닫는 괄호·리터럴 뒤면 나눗셈)을 쓴다 — 완전한 JS 파서는 아니라 오판할
 *   수 있지만, 오판의 방향은 "정규식을 나눗셈으로 본다"(안전 — 그 뒤 문자를 평범하게 계속 스캔할
 *   뿐 상태가 깨지지 않는다)이지 그 반대가 아니다.
 * ★ 남는 한계(정직하게 적어 둔다): 위 휴리스틱은 완전한 렉서가 아니다 — 세미콜론 없는 코드에서
 *   `a\n/re/.test(x)` 처럼 실제로는 나눗셈인데 줄 시작이라 정규식으로 오판할 수 있는 드문 ASI
 *   경우가 있다(이 리포의 관례상 매우 드물다고 전제한다). 중첩 템플릿 리터럴(`` `a${`b`}c` `` 형태로
 *   같은 따옴표 문자가 보간식 안에서 다시 열리는 경우)도 완전한 렉서 없이는 구분할 수 없는 별도
 *   한계다. 둘 다 오제거(스캔이 좁아지는 방향)이지 넓어지는 방향은 아니다 — 좁아진 만큼은 호출부의
 *   `scannedLines` 하한(LS0)이 방어한다.
 */
function stripCStyleComments(source) {
  let out = ''
  let quote = null
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (quote) {
      out += char
      if (char === '\\') {
        out += source[index + 1] ?? ''
        index += 1
        continue
      }
      if (char === quote) quote = null
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      out += char
      continue
    }
    if (char === '/' && source[index + 1] === '/' && source[index - 1] !== ':') {
      while (index < source.length && source[index] !== '\n') index += 1
      index -= 1 // for 루프의 index+=1 과 합쳐 개행 문자 자체는 다음 반복에서 그대로 통과시킨다
      continue
    }
    if (char === '/' && source[index + 1] === '*') {
      const close = source.indexOf('*/', index + 2)
      const end = close === -1 ? source.length : close + 2
      for (let inner = index; inner < end; inner += 1) out += source[inner] === '\n' ? '\n' : ' '
      index = end - 1 // for 루프의 index+=1 과 합쳐 다음 문자부터 재개한다
      continue
    }
    if (char === '/' && precedesRegexLiteral(out)) {
      const end = consumeRegexLiteral(source, index)
      if (end !== null) {
        out += source.slice(index, end)
        index = end - 1
        continue
      }
      // 닫는 '/' 를 같은 줄에서 못 찾았다 — 정규식이 아니라 나눗셈이었다. 안전한 기본 동작(아래
      //   fallthrough)으로 이 '/' 한 글자만 평범하게 통과시킨다.
    }
    out += char
  }
  return out
}

/**
 * 직전까지 방출된 코드(`out`)를 보고 다음 `/` 가 **정규식 리터럴의 시작일 가능성이 높은 자리**인지
 * 가른다(나눗셈 연산자와의 표준 휴리스틱 구분 — 완전한 파서 없이 실용적으로 가른다). 직전 유의미
 * 문자가 값을 "아직 안 끝낸" 토큰(여는 괄호·쉼표·대입·비교·논리 연산자 등)이거나 줄이 막 시작했거나
 * `return`/`typeof`/`case` 같은 정규식-선행 키워드로 끝나면 정규식으로 본다. 식별자·숫자·문자열·
 * `)`·`]`·`}` 뒤라면 나눗셈이다.
 */
const REGEX_PRECEDING_KEYWORD_RE =
  /(^|[^\w$])(return|typeof|instanceof|delete|void|throw|case|yield|await|in|of|new|else|do)$/u
function precedesRegexLiteral(out) {
  const trimmed = out.replace(/[ \t]+$/u, '') // 같은 줄의 후행 공백만 없앤다 — 개행은 "줄 시작" 신호로 남긴다
  if (trimmed === '') return true // 파일 시작
  const last = trimmed.at(-1)
  if (last === '\n') return true
  if ('([{,;:=!&|?+-*%^~<>'.includes(last)) return true
  return REGEX_PRECEDING_KEYWORD_RE.test(trimmed)
}

/**
 * 여는 `/`(`start`)부터 정규식 리터럴을 소비한다. 문자 클래스(`[...]`) 안의 `/` 는 종료 신호가
 * 아니고, 역슬래시 이스케이프는 다음 한 글자를 건너뛴다. 플래그(`gimsuy` 등)까지 소비한 뒤 인덱스를
 * 돌려준다. **같은 줄 안에서 닫는 `/` 를 못 찾으면 `null`**(정규식 리터럴은 여러 줄에 걸칠 수
 * 없다 — 이 경우 애초에 정규식이 아니었다는 뜻이므로 호출부가 나눗셈으로 되돌린다).
 */
function consumeRegexLiteral(source, start) {
  let index = start + 1
  let inClass = false
  while (index < source.length) {
    const char = source[index]
    if (char === '\n') return null
    if (char === '\\') {
      index += 2
      continue
    }
    if (char === '[') {
      inClass = true
      index += 1
      continue
    }
    if (char === ']') {
      inClass = false
      index += 1
      continue
    }
    if (char === '/' && !inClass) {
      index += 1
      while (index < source.length && /[a-zA-Z]/u.test(source[index])) index += 1
      return index
    }
    index += 1
  }
  return null
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
      // `statSync` 는 심링크를 **따라가서** 그 타깃을 본다 — vault 밖을 가리키는 심링크가 그 타깃이
      //   마침 일반 파일이면 "일반 파일" 로 통과해 스캔에 들어오고, `skipped` 에는 남지 않는다.
      //   호출부(LS8)의 "스킵됐다" 주장과 실제가 어긋나는 지점이라 `lstatSync` 로 **엔트리 자신**을
      //   본다 — 심링크는 그 자체로 스킵 사유가 된다(타깃을 따라가 안전한지 판단하지 않는다. 상대적
      //   심링크든 vault 밖 절대경로 심링크든 전부 같은 사유로 배제해야 조용히 벗어나는 경로가 없다).
      const entryStat = lstatSync(full)
      if (entryStat.isSymbolicLink()) {
        skipped.push({ path: rel, why: 'symlink' })
        continue
      }
      // gitlink(서브모듈)는 인덱스에 1엔트리로 있지만 파일이 아니다 — 조용히 흘리지 않고 싣는다.
      if (!entryStat.isFile()) {
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
