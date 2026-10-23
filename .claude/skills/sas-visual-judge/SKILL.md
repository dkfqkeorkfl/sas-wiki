---
name: sas-visual-judge
description: 기존 recipe+rubric(`docs/qa/dev/<name>.md`) 대비 시각·UX 사양과 (P2 가 결정적으로 못 잡는) 상호작용·기능 결과 적합성을 Playwright snapshot 루프로 판정하고 verdict 를 `logs/qa/dev/<slug>.judgments.json` 에 기록한다. 대상 런타임은 웹(기본)·Electron·WebView2(Tauri-Windows) — recipe frontmatter `runtime` 으로 드라이버를 자동 분기한다(런타임별 드라이버·가용 제약은 본문 「런타임 · 드라이버」 표 참조). 사용자가 웹/Electron/데스크탑 화면의 시각/디자인/UX 검증·"recipe 돌려줘/시각 테스트해줘/디자인 판정"·다크모드·반응형 시각 확인·다국어(로케일)별 레이아웃 확인·디자인 사양 적합성·P3 시각검증을 언급하거나 요청하면 use proactively("스크린샷" 단어가 없어도). recipe 작성·수정은 `sas-visual-recipe`(보통 `sas-tdd-guide` 가 호출)가 맡고, 이 스킬은 구동·판정만 한다.
---

# sas-visual-judge

시각·UX 사양 + (P2 가 신뢰성 있게 못 잡는) 상호작용·기능 결과 적합성을 **recipe + rubric 대비 LLM(=세션 CC) 판정**으로 검증하는 스킬. 픽셀 diff("변했나")가 아니라 "사양 *의도*에 맞나"를 판정한다(픽셀 베이스라인 `toHaveScreenshot` 아님). 드라이버 = Playwright(런타임별 매핑은 「런타임 · 드라이버」 표), 판정자 = 세션 CC. **기능 판정은 P2(결정적 E2E)가 신뢰성 있게 못 잡는 것에 한정**하며, LLM 판정은 결정적 게이트가 아니라 비결정적 보완이다(열거 가능한 기능 회귀의 권위는 P1/P2). recipe **작성·수정**은 이 스킬의 일이 아니다 — `sas-visual-recipe`(형제 스킬, recipe+rubric 양식의 SSOT)가 만들고 고치며, 이 스킬은 기존 recipe+rubric 을 *구동·판정*한다. 판정 중 recipe 를 고칠 이유를 발견해도 직접 편집하지 않고 핸드오프 노트로 넘긴다.

## 트리거

- 사용자가 시각/디자인/UX 검증·recipe 구동·verdict 산출을 요청할 때.
- 신규/변경 화면의 디자인 사양 적합성(색·타이포·간격·위계·상태 피드백·반응형)을 확인해야 할 때.
- `<in>`(기본 `docs/qa/dev/`)에 recipe+rubric 이 있고 그 verdict 가 필요할 때.
- P2 결정적 E2E 로 신뢰성 있게 못 잡는 상호작용·기능 결과(복잡 드래그 등)의 QA·홀리스틱 회귀 확인이 필요할 때.

## 입력

- `<name>` — recipe stem. 단일 파일 `<in>/<name>.md`(frontmatter + `## Recipe` + `## Rubric`)를 가리킨다. 전체 경로 직접 지정도 허용. (예: `login-card`, `dashboard`) 양식은 `sas-visual-recipe/RECIPE-FORMAT.md` 가 SSOT 이며, 이 스킬은 그 형식대로 작성된 파일을 읽기만 하고 형식을 재정의하지 않는다.
- `--in`(선택): recipe가 있는 기준 폴더. 기본값 `docs/qa/dev`.
- `--out`(선택): 출력 기준 폴더. 기본값 `logs/qa/dev`. 판정 결과는 `<out>/<slug>.judgments.json`, 캡처는 `<out>/captures/<slug>/...`에 함께 기록한다(「산출 스키마」·「산출물」 절 경로는 이 기준 폴더를 전제로 한다).
- 런타임·드라이버는 recipe frontmatter `runtime`(생략 시 `web`)·`launch` 에서 읽는다 — 별도 인자 불요.

## 유효 recipe 체크리스트

판정 전에 `node .claude/skills/sas-visual-recipe/scripts/validate-recipe.mjs <recipe 경로> <프로젝트 루트>`를 실행한다. 실패하면 `blocked`(날조 금지) — 무엇을 검사하는지는 `sas-visual-recipe/RECIPE-FORMAT.md`의 「구조 규칙」이 SSOT 이므로 여기서 재기술하지 않는다.

- `### interaction`은 조건부다(P2가 못 잡는 상호작용이 있을 때만; 없어도 검증 스크립트가 요구하지 않는다).
- 값이 `TODO: 사용자 확인`인 카테고리는(검증 스크립트 통과와 별개로) block이 아니라 해당 디테일만 보류한다(판정 시 `verdict: "deferred"`).

## 런타임 · 드라이버

recipe frontmatter `runtime`(생략 시 `web`)으로 드라이버를 분기한다. 판정 계약(recipe+rubric·6 카테고리·judgments 스키마·경로·루프)은 런타임과 무관하게 동일하고, 바뀌는 것은 타깃 도달 방법(구동·캡처)뿐이다.

| runtime                                      | 드라이버                             | 도달 방법                                                                                                                                                                                                                                   | 주의                                                                        |
| -------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `web` (기본)                                 | MCP `browser_*`                      | `target` URL `browser_navigate`                                                                                                                                                                                                             | 헤드리스 가능. 유일한 무조건 지원 경로                                      |
| `electron`                                   | Playwright `_electron` script-driver | `_electron.launch(launch)` → `firstWindow()` = Page(`launch.args[0]`이 진입 스크립트 — Playwright에 `entry` 옵션은 없다) (대안: running-app + MCP `--cdp-endpoint` attach — 렌더러 한정: 다중 윈도우·네이티브 드래그·main 불가)             | **EXPERIMENTAL**. Linux/CI 가상 디스플레이(xvfb) 필요(완전 헤드리스 아님)   |
| `webview2` (Chromium webview; 예: Tauri-Win) | CDP attach                           | 앱 기동 전 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<port>` 환경변수(또는 동등한 레지스트리·`CoreWebView2EnvironmentOptions` 설정)로 미리 활성화된 포트에 `connectOverCDP`/MCP `--cdp-endpoint` → `pages()[0]` = Page | **Windows·host-bound**. Chromium webview 만. 일반 CLI 인자로는 활성화 안 됨 |

**Electron 드라이버 선택**: 기본은 `_electron.launch`. 순수 렌더러 시각·단일 윈도우만이면 `--cdp-endpoint` attach 가 가벼운 대안(browser_* 루프 그대로) — 다중 윈도우·네이티브 드래그·main 프로세스는 attach 로 불가하므로 launch 가 기본.

**범위 밖(이 스킬이 구동하지 않음).** Tauri(mac/linux: WebKitGTK/WKWebView — CDP 없음)·iOS·네이티브 모바일·네이티브 데스크탑(Qt/GTK/WinUI 등)은 Playwright 드라이버가 없다 → `blocked` 보고 후 host-only/별도 도구(Appium·WinAppDriver 등)로 위임. Flutter web(CanvasKit)은 DOM 이 없어 본 스킬 대상이 아니다.

## 게이트 (하드)

다음을 충족하지 않으면 **즉시 중단**하고 사유·대안을 안내한다. **결과어 구분**(먼저 확인): 드라이버 자체가 미가용하면 세션을 중단한다(파일 미산출); 드라이버는 있지만 런타임·recipe 가 범위 밖/무효면 `blocked` verdict 를 기록한다(파일 산출).

- **선택된 `runtime` 의 드라이버가 현재 세션에서 가용**한가(「런타임 · 드라이버」). 미충족이면 즉시 중단한다.
  - `web`(기본): Playwright MCP `browser_*`. 미가용 → 중단("Playwright MCP 필요"). `browser_*` 가 붙어 있고 `target` 도달 가능하면 컨테이너·호스트 무관하게 실행.
  - `electron`: `_electron.launch` script-driver 로 앱을 띄울 수 있는가 — MCP `browser_*` 단독으론 불가(앱 launch 진입점 없음). 미가용 → 중단("Electron script driver(`_electron.launch`) 필요").
  - `webview2`: 앱이 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`(또는 동등 설정)로 원격 디버깅 포트가 미리 활성화된 채 기동돼 CDP 엔드포인트가 도달 가능한가(`connectOverCDP`/MCP `--cdp-endpoint`). 미도달 → 중단.
  - 드라이버 없는 런타임(tauri mac/linux·iOS·네이티브) → `blocked` 보고(범위 밖, host-only/별도 도구 위임).
- `<in>/<name>.md` 가 위 **유효 recipe 체크리스트**를 충족하는가 — 미충족 시 `blocked` 보고(날조 금지).

## 절차 (snapshot 루프)

정규 순회 순서: **각 surface → (`locales` 지정 시) 각 locale → 각 viewport → (`themes` 지정 시) 각 theme → 각 state**. locale·viewport·theme 는 _상태 트리거보다 먼저_ 확정한다 — 반응형 UI 에서 locale/viewport/theme 변경이 이미 트리거된 상태를 무효화하지 않게(예: 데스크탑에서 연 메뉴가 모바일 폭에서 사라짐). locale 은 텍스트 길이 자체를 바꿔 레이아웃에 영향을 주므로 viewport·theme 보다 바깥쪽에 둔다. 상태 간에는 base state 로 reset(재 navigate 또는 트리거 해제) 후 다음 상태를 적용해 상태 누수를 막는다(재현성 확보). 아래 절차의 `browser_*` 표기는 `web`/MCP 기준이며, `electron`·`webview2` 드라이버에선 동일 스텝을 resolved Playwright Page API 로 수행한다.

1. **recipe+rubric 로드** — 단일 파일 `<in>/<name>.md` 를 읽어 frontmatter(`slug`·`target`·`viewports` + 있으면 `themes`·`locales`·`localeApply` 등 선택 필드) + `## Recipe`(target·surface/상태 목록·마스킹) + `## Rubric`(6 카테고리 기대값)을 파싱한다. 두 번째 파일 로드는 없다.
2. **드라이버 해석 + 타깃 도달** — frontmatter `runtime`(생략 시 `web`)으로 드라이버를 고른다(「런타임 · 드라이버」).
   - `web`: `target` 이 절대 URL 이면 그대로, 상대경로면 `baseUrl`(있으면) → 현재 열린 페이지 origin → 기본 `http://localhost:3000` 순으로 origin 을 붙여 `browser_navigate`.
   - `electron`: `_electron.launch(launch)` → `firstWindow()` 로 렌더러 Page 확보(또는 running-app + `--cdp-endpoint` attach).
   - `webview2`: `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`(또는 동등 설정)로 원격 디버깅 포트가 미리 활성화된 앱에 `connectOverCDP`/`--cdp-endpoint` attach → `pages()[0]`.
     도달 불가면 기동·포트 확인을 요청한다(스킬은 앱·서버를 띄우지 않는다). `locales` 지정 + `localeApply.strategy: route` 면 이 navigate 타깃 자체가 locale 별로 달라진다(prefix 적용) — 3단계 루프에서 locale 이 바뀔 때마다 이 단계를 다시 수행한다. 이후 루프는 resolved Page/타깃에서 동일하게 돈다.
3. **루프** — 위 정규 순서(surface → locale → viewport → theme → state)로 각 조합마다:
   - 다음을 순서대로 수행한다:
     1. **reset** — base state 로 되돌린다(재 navigate 또는 트리거 해제).
     2. **(`locales` 지정 시) locale 전환** — `localeApply.strategy` 별: `route`=2단계 방식으로 해당 locale 타깃에 재 navigate · `query`=URL 쿼리 파라미터를 붙여 navigate · `cookie`=`browser_evaluate` 로 쿠키 설정 후 reload · `store`=지정 함수/API 호출로 목표 locale 설정 — 반응형 갱신이면 그대로, 리로드가 필요하면 호출 후 reload 하고 반영 확인까지 대기한다.
     3. **viewport 적용** — `browser_resize`(`viewports` 숫자=width; height 는 고정 기본값 900px — 레시피가 `{width,height}` 로 명시하면 우선. browser_resize 는 width·height 를 모두 요구하므로 미명시 height 를 세션마다 달라지지 않게 고정).
     4. **(`themes` 지정 시) theme 전환** — 레시피가 `themeApply` 를 지정하면 그 방식으로 목표 상태를 결정적으로 *설정*한다(attribute=지정 attr/value set·remove, media=prefers-color-scheme emulate, store=앱 토글을 목표 상태로 호출). 미지정 시 기본은 `browser_evaluate` 로 `document.documentElement.classList.toggle('dark', theme === 'dark')` — **인자 2개형으로 현재 상태와 무관하게 결정적으로 설정한다. 인자 없는 `toggle('dark')` 호출은 금지**(루프 상태에 따라 뒤집힘).
     5. **navigate/settle** — 라우트·핵심 셀렉터 ready 대기 → `document.fonts.ready` 대기 → 가능하면 애니메이션/전환 비활성화로 프레임 고정 → 짧은 안정화. 타임아웃 초과 시 해당 조합은 `verdict: "timeout"`으로 기록한다(미드애니메이션·프리폰트 캡처 금지). `blocked`는 recipe 자체가 무효하거나 드라이버가 없을 때 전용이라, 개별 조합의 실행 실패와 구분한다.
     6. **상태 트리거** — `browser_click`/`browser_type`/`browser_hover` 로 focus·hover·열림·error 등 도달.
     7. **캡처** — `browser_snapshot`(구조) + `browser_take_screenshot`(viewport 권장; `fullPage` 는 sticky/frosted 합성 아티팩트 주의).
   - rubric 의 6 시각 카테고리(`color`/`typography`/`spacing`/`hierarchy`/`state-feedback`/`layout`) + (있으면) `interaction` 각각을 기대값 대비 판정 → `judgments[]` 항목. rubric 값이 `TODO: 사용자 확인` 인 항목은 판정하지 않고 `verdict: "deferred"`(점수 `null`)로 기록한다 — fail 아님, 사용자 확인 보류.
   - **P2 로 신뢰성 있게 단언 가능한 기능은 판정하지 않는다.** recipe 에 그런 항목이 들어와 있으면 판정하지 말고 `verdict: "skipped"` + `reason: "P2-scope: 결정적 단언 가능 → P1/P2 소관"` 로 표기하고 핸드오프 노트를 남긴다(rubric 작성자가 `sas-visual-recipe` 로 recipe 를 고쳐 P2 로 내리도록).
4. **마스킹** — recipe 의 마스킹 영역(실시간 데이터·애니메이션 프레임·계정 텍스트·랜덤 배열)은 **스크린샷을 편집하지 않고**, 해당 셀렉터를 판정 추론에서 제외한다(존재·방향·구조만 확인).
5. **산출** — `judgments[]` → verdict JSON 을 `<out>/<slug>.judgments.json` 에, 캡처를 `<out>/captures/<slug>/<surface>-<state>[-<locale>][-<theme>]-<viewport>.png` 규약으로 기록(`locale`·`theme` 세그먼트는 해당 축이 비활성이면 생략). 콘솔에 요약 보고.

## 산출 스키마 (judgments verdict)

`<out>/<slug>.judgments.json` (slug = recipe frontmatter `slug` 값; 기본 `logs/qa/dev` 이하는 gitignore):

```jsonc
{
  "slug": "auth-popup",
  "target": "/login",
  "runtime": "web",                          // 선택: 판정에 쓰인 런타임(provenance; 생략 시 web)
  "verdict": "pass" | "fail" | "blocked",   // judgments 하나라도 fail → fail; rubric 카테고리 부재 또는 개별 항목에 timeout 이 하나라도 있으면 → blocked(판정 미완결); 판정 항목이 전부 deferred/skipped(pass·fail·timeout 0건)면 blocked. deferred·skipped 는 top-level 을 fail 시키지 않음
  "judgments": [
    {
      "surface": "login | signup | ...",
      "state": "default | field-focus | error | ...",
      "locale": "ko | en | ...",             // locales 지정 시에만 포함 — 로케일 축 비활성 시 필드 자체 생략
      "theme": "light | dark",               // themes 지정 시에만 포함 — 테마 축 비활성 시 필드 자체 생략
      "viewport": 768,
      "category": "color | typography | spacing | hierarchy | state-feedback | layout | interaction",
      "score": 0.0,                          // 0..1 rubric 적합도; 기준선 ≥0.8 pass / <0.8 fail (rubric 가 항목 임계를 명시하면 그것 우선). skipped·deferred 는 null 허용
      "verdict": "pass" | "fail" | "skipped" | "deferred" | "timeout", // skipped = P2-scope 유입(판정 제외); deferred = rubric 값이 `TODO: 사용자 확인`(판정 보류, fail 아님); timeout = 이 조합의 navigate/settle 이 시간 안에 끝나지 않아 실행 자체가 미완결(recipe 무효를 뜻하는 top-level blocked 와는 다른 원인 — 하나라도 있으면 top-level 을 blocked 로 올림)
      "reason": "<rubric 항목 참조한 구체 사유 — 자유 추측 금지>",
      "capture": "<out>/captures/<slug>/<surface>-<state>[-<locale>][-<theme>]-<viewport>.png"
    }
  ]
}
```

예 (`logs/qa/dev/login-card.judgments.json`):

```jsonc
{
  "slug": "login-card",
  "target": "/login",
  "verdict": "fail",
  "judgments": [
    {
      "surface": "login",
      "state": "default",
      "theme": "light",
      "viewport": 768,
      "category": "color",
      "score": 0.95,
      "verdict": "pass",
      "reason": "rubric color: accent 가 Sign in CTA 에만 적용됨",
      "capture": "logs/qa/dev/captures/login-card/login-default-light-768.png",
    },
    {
      "surface": "login",
      "state": "field-focus",
      "theme": "light",
      "viewport": 768,
      "category": "state-feedback",
      "score": 0.4,
      "verdict": "fail",
      "reason": "rubric state-feedback: focus ring 부재(기대 ≥2px accent)",
      "capture": "logs/qa/dev/captures/login-card/login-focus-light-768.png",
    },
    {
      "surface": "login",
      "state": "submit",
      "theme": "light",
      "viewport": 768,
      "category": "interaction",
      "score": 0.9,
      "verdict": "pass",
      "reason": "rubric interaction: 유효 입력 제출 시 성공 흐름 자연스러움",
      "capture": "logs/qa/dev/captures/login-card/login-submit-light-768.png",
    },
  ],
}
```

## 결정성 (재현·설명 가능)

판정자가 세션 CC 이므로 API 온도 핀이 아니라 **구조 고정**으로 결정성을 확보한다 — rubric 이 PASS/FAIL 을 정의하며(주관 배제), **rubric 에 없는 새 기준은 날조하지 않는다.** 자유 텍스트 verdict 는 금지하고 `judgments[]` 스키마로만 출력을 강제한다.

카테고리 enum·점수 기준선·verdict 상태값(pass/fail/skipped/deferred/timeout/blocked)·P2-scope 처리는 위 「산출 스키마 (judgments verdict)」·「절차」 절이 SSOT 다 — 여기서 재정의하지 않는다.

## 산출물

- `<out>/<slug>.judgments.json` — verdict + judgments[] (기본 `logs/qa/dev` 이하는 gitignore).
- `<out>/captures/<slug>/*.png` — 캡처(기본 `logs/qa/dev` 이하는 gitignore).
- 콘솔 요약: `runtime` + `verdict` + 카테고리별 pass/fail/skipped/deferred/timeout 카운트 + fail 사유 + deferred(=`TODO: 사용자 확인`)·timeout 잔여.

## DoD

- recipe 의 전 surface × (`locales` 지정 시 각 locale, 미지정 시 1회) × 명시 뷰포트 × (`themes` 지정 시 각 theme, 미지정 시 1회) × 상태 조합에 대해 `judgments[]` 산출(timeout 도 하나의 결과로 기록 — 조합을 누락시키지 않는다).
- `<out>/<slug>.judgments.json` 기록 + 콘솔 verdict 보고.
- fail 항목은 rubric 항목을 참조한 구체 사유 동반. rubric 미작성 카테고리는 `blocked`. P2-scope 유입 항목은 `skipped` + 핸드오프 노트. `TODO: 사용자 확인` 항목은 `deferred` 로 기록. navigate/settle 시간 초과 항목은 `timeout` 으로 기록(그 사실 하나로 top-level 이 `blocked` 가 됨).

## 외부 의존

- 판정 LLM = 세션 구독(외부 LLM API·키 0).
- 드라이버·도달 방법·헤드리스/host 제약은 「런타임 · 드라이버」 표가 SSOT. 여기선 추가 패키지·런타임 의존만 명시:
  - `web`: `@playwright/mcp` + Chromium.
  - `electron`: Playwright `_electron` + 안정화 헬퍼(예: `electron-playwright-helpers`) + xvfb. MCP 단독으론 앱 launch 불가 → script-driver 필요.
  - `webview2`: Playwright(`connectOverCDP`) 또는 MCP `--cdp-endpoint`. 앱은 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`(또는 동등 설정)로 원격 디버깅 포트 사전 활성화(외부 책임).
- **렌더 deps**: 스크린샷 충실도를 위해 선택 런타임의 렌더 의존성 + 필요한 폰트가 설치돼 있어야 한다 — 폰트 부재 시 fallback 렌더로 typography 가 false-fail 날 수 있다. 로케일별 폰트(CJK 등)도 동일하게 적용.
- **로케일 전환**: `localeApply`(route/query 는 `browser_navigate`, cookie/store 는 `browser_evaluate`) — 테마 전환과 동일 메커니즘 재사용, 추가 패키지 불요.
- recipe+rubric 포맷의 SSOT 는 `sas-visual-recipe/RECIPE-FORMAT.md` 다(「입력」 참조). 그 외 `references/`·`examples/`·`scripts/` 등 저장소 내부 임시 문서 의존은 없다.
