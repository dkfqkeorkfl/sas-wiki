import { defaultSchema } from 'rehype-sanitize'

/**
 * rehype-sanitize allowlist — GitHub 기본 스키마를 **위키링크·heading id 계약 보존**에 필요한
 * 최소한으로만 확장한다(그 이상 열지 않는다 — defense-in-depth).
 *
 * - `<a>` 에 `wiki-link`/`wiki-link-dead` class 와 `data-path`/`data-anchor` 속성 허용.
 * - heading `id` 는 기본 스키마가 `user-content-` 접두로 clobber 하므로 그 clobber 를 끈다
 *   (slugifyHeading 앵커와 byte-identical 해야 lockstep 이 유지된다).
 *
 * 그 외 위험(raw `<script>`·`javascript:` href 등)은 기본 스키마가 그대로 차단한다.
 */
// 기본 스키마의 `a` 속성에는 이미 `['className', 'data-footnote-backref']` 제약이 들어 있다.
// className 항목이 둘이면 첫(제약) 항목이 이겨 wiki-link 가 걸러진다 → 하나로 **병합**한다.
const defaultAttrs = defaultSchema.attributes ?? {}
const defaultAAttrs = defaultAttrs.a ?? []
const aWithoutClassName = defaultAAttrs.filter(
  (entry) => !(Array.isArray(entry) && entry[0] === 'className'),
)
const defaultAClassNames = (
  defaultAAttrs.find((entry) => Array.isArray(entry) && entry[0] === 'className') ?? ['className']
).slice(1)

export const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultAttrs,
    a: [
      ...aWithoutClassName,
      ['className', ...defaultAClassNames, 'wiki-link', 'wiki-link-dead'],
      'dataPath',
      'dataAnchor',
    ],
  },
  // heading id 만 원문 slug 그대로 보존한다(기본값 clobber 는 id 를 user-content- 로 접두 → lockstep 파손).
  // name·aria-* 의 clobber 방어는 유지한다(id 만 제외 — 불필요한 defense-in-depth 해제 금지).
  clobber: ['ariaDescribedBy', 'ariaLabelledBy', 'name'],
}
