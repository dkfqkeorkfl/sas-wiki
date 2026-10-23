# Recipe+Rubric 양식 (SSOT)

> 이 파일이 recipe+rubric 양식의 유일한 원본이다. `sas-visual-recipe/SKILL.md`·`sas-visual-judge/SKILL.md`를 포함해 다른 어떤 파일에도 아래 내용(필드 목록·구조·아래 명시된 규칙)을 다시 옮겨 적지 않는다 — 필요하면 이 파일을 가리키기만 한다. 두 스킬 다 이 파일을 직접 읽고 쓴다.

recipe+rubric은 page/feature 단위 단일 파일이다: frontmatter + `## Recipe` + `## Rubric`.

## canonical 템플릿

```markdown
---
name: <name>            # = 파일 stem; recipe 정체성
slug: <name>            # = judgments stem → <out>/<slug>.judgments.json
target: /<route>        # 판정자가 navigate 할 dev 라우트/URL (절대 URL 또는 baseUrl 기준 상대경로)
baseUrl: http://localhost:3000   # 선택: target 이 상대경로일 때 붙일 origin. 생략 시 판정자가 추론(현재 페이지 origin → 기본 localhost)
viewports: [640, 768, 1024, 1440]   # 판정자가 browser_resize 로 순회할 px (숫자=width; height 는 고정 기본값 900px)
themes: [light, dark]   # 선택(생략 시 테마 축 비활성 — 토글 없이 현재 렌더 상태 그대로 1회 판정). 명시 시 판정자가 html.dark 토글(기본)
themeApply: { strategy: class, selector: html, value: dark }   # 선택(themes 2개 이상 지정 시에만 유효, 생략 시 class/html.dark): class(classList.toggle) | attribute(data-theme) | media(prefers-color-scheme emulate) | store(앱 토글) — 판정 적용은 sas-visual-judge
locales: [ko, en]       # 선택(생략 시 로케일 축 비활성 — 현재 페이지 기본 언어만 판정)
localeApply: { strategy: route, prefix: /{locale} }   # locales 지정 시 필수(전환 메커니즘 보편 기본값 없음): route(URL 경로) | query(?lang=) | cookie | store(앱 함수 호출) — 판정 적용은 sas-visual-judge
runtime: web            # 선택(생략 시 web): web | electron | webview2 — 드라이버 분기(판정·구동은 sas-visual-judge)
launch: {}              # 선택(비웹만): electron→{ args: [진입스크립트경로, ...], executablePath?, env?, cwd? }(Playwright `_electron.launch`는 `entry` 옵션이 없다 — 진입 스크립트는 args[0]) · webview2→{ cdpEndpoint }(앱은 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` 환경변수 등으로 원격 디버깅 포트를 사전 활성화해야 함 — 일반 CLI 인자로는 안 됨)
---

# <name> — Visual/UX recipe + rubric

## Recipe

### Target

- target: <route/URL> (frontmatter 미러; 어떤 페이지/기능인지)
- Startup: target 기동 방법(예: `pnpm dev`). 어느 스킬도 서버를 띄우지 않는다.

### Surfaces

| surface | description |
| ------- | ----------- |

### States

| surface | state | trigger |
| ------- | ----- | ------- |

### Viewports

- frontmatter 미러; viewport 특이 surface 가 있으면 명시.

### Masking

- 판정 제외 셀렉터/영역(존재·구조·방향만 확인).

### Slug

- slug: <name> (frontmatter 미러)

## Rubric

<!-- 6 시각 H3 필수; interaction 은 P2 미커버 상호작용이 있을 때만. 알 수 없는 디테일은 `TODO: 사용자 확인`, 시각 카테고리 자체는 생략 금지 -->

### color

### typography

### spacing

### hierarchy

### state-feedback

### layout

### interaction <!-- 조건부: P2 가 못 잡는 상호작용·기능 결과의 기대값 -->
```

## 구조 규칙 (검증 스크립트가 기계적으로 확인)

- frontmatter 필수: `name` · `slug` · `target` · `viewports`. `locales` 지정 시 `localeApply` 동반 필수.
- `## Recipe`: Target · Surfaces · States · Masking · Slug 서브섹션 필수.
- `## Rubric`: 6 시각 카테고리(`color`/`typography`/`spacing`/`hierarchy`/`state-feedback`/`layout`) H3 전부 필수(값이 `TODO: 사용자 확인`이어도 헤딩 자체는 있어야 함). `interaction`은 조건부(없어도 무방).
- 본문에 줄번호 스타일 코드 인용(`:숫자`, `line 숫자`, `L숫자` 등)이 있으면 안 된다 — 코드 인용 규율은 `sas-visual-recipe`의 「근거 인용 규율」 참조.

이 파일은 `../sas-visual-recipe/scripts/validate-recipe.mjs`가 코드로도 그대로 확인한다(중복이 아니라 같은 규칙의 실행 가능한 버전).
