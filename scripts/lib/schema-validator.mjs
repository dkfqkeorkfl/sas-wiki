import fs from 'node:fs'

export function loadSchema(schemaPath) {
  return JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
}

export function validateItem(data, schema, label) {
  const errors = []
  validateAgainstSchema(data, schema, errors, label ?? '$', schema)
  return errors
}

function checkType(value, typeSpec, errors, fieldPath) {
  const types = Array.isArray(typeSpec) ? typeSpec : [typeSpec]
  if (!types.some((type) => typeMatches(value, type))) {
    errors.push(`${fieldPath}: 타입 불일치(기대: ${types.join('|')})`)
  }
}

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * 프로토타입 체인이 아니라 **자신의** 프로퍼티인지 확인한다.
 *
 * `in` 연산자는 상속 프로퍼티에도 `true` 를 반환한다(MDN `in` 연산자: "in 연산자는 지정한 프로퍼티가
 * 명시된 객체에 존재하면 true 를 반환합니다 — 상속된 프로퍼티를 포함해서요"). `required`/`properties`
 * 판정에 `in` 을 쓰면 `Object.create({...})` 로 만든 입력이 own-enumerable 프로퍼티 없이(즉
 * `JSON.stringify(data)` 가 `{}` 를 낸다) 검증을 통과한다 — 검증은 통과했는데 실제 직렬화 산출물엔
 * 그 필드가 없는 불일치가 생긴다(재현됨·보안). ES2022 의 `Object.hasOwn(obj, prop)` 이 이 판정의
 * 표준 대체제다(MDN `Object.hasOwn()`: "상속된 프로퍼티에 대해서는 false 를 반환합니다").
 */
function hasOwnField(data, key) {
  return Object.hasOwn(data, key)
}

function matchesCondition(data, condition) {
  if (!isPlainObject(data)) return false
  if (condition.required) {
    for (const req of condition.required)
      if (!(req in data) || data[req] === undefined) return false
  }
  if (condition.properties) {
    for (const [key, propSchema] of Object.entries(condition.properties)) {
      if (propSchema.const !== undefined && data[key] !== propSchema.const) return false
    }
  }
  return true
}

/**
 * 로컬 `$ref`(`#/definitions/x` · `#/$defs/x`)만 해석한다.
 *
 * 재귀 구조(summary 의 `tree` 노드)는 `$ref` 없이는 표현할 수 없다 — 인라인 몇 단계로 때우면
 * 그 깊이를 넘는 폴더가 무검증이 된다. 외부 URI 는 지원하지 않는다(의존성 0 유지).
 */
function resolveRef(schema, root) {
  let current = schema
  const seen = new Set()
  while (isPlainObject(current) && typeof current.$ref === 'string') {
    const ref = current.$ref
    if (seen.has(ref)) throw new Error(`순환 $ref: ${ref}`)
    seen.add(ref)
    if (!ref.startsWith('#/')) throw new Error(`지원하지 않는 $ref(로컬만 허용): ${ref}`)
    let target = root
    for (const segment of ref.slice(2).split('/')) {
      target = target?.[segment.replaceAll('~1', '/').replaceAll('~0', '~')]
    }
    if (target === undefined) throw new Error(`$ref 를 찾을 수 없습니다: ${ref}`)
    current = target
  }
  return current
}

function typeMatches(value, type) {
  if (type === 'null') return value === null
  if (type === 'string') return typeof value === 'string'
  if (type === 'integer') return typeof value === 'number' && Number.isInteger(value)
  if (type === 'number') return typeof value === 'number'
  if (type === 'boolean') return typeof value === 'boolean'
  if (type === 'array') return Array.isArray(value)
  if (type === 'object') return isPlainObject(value)
  // 위 7종(JSON Schema 2020-12 의 원시 타입 전부)에 없는 type 문자열은 **지원하지 않는다** — 미지원
  // 타입을 조건 없이 통과시키면(과거: `return true`) 오타·미지원 타입 선언이 검증 없이 새어나간다
  // (fail-open). 선언된 서브셋 밖은 항상 불일치로 처리한다(fail-closed).
  return false
}

function validateAgainstSchema(data, rawSchema, errors, fieldPath = '$', root = rawSchema) {
  // JSON Schema 2020-12 §4.3.2 boolean 스키마: `true` 는 이 위치의 모든 값이 유효하다는 뜻이고(아래
  // 검사들이 boolean 값엔 없는 프로퍼티를 조회해 자연히 통과한다), `false` 는 **어떤 값도 유효하지
  // 않다**는 뜻이다. 이 검증기는 객체 형태 스키마만 순회하므로 `false` 를 여기서 막지 않으면
  // (fail-open) 그 자리는 무조건 조용히 통과한다.
  if (rawSchema === false) {
    errors.push(`${fieldPath}: 스키마가 false — 이 위치는 어떤 값도 허용하지 않는다`)
    return
  }
  const schema = resolveRef(rawSchema, root)

  if (schema.type) checkType(data, schema.type, errors, fieldPath)
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(
      `${fieldPath}: enum 위반(허용값: ${JSON.stringify(schema.enum)}, 실제: ${JSON.stringify(data)})`,
    )
  }
  if (schema.pattern && typeof data === 'string' && !new RegExp(schema.pattern, 'u').test(data)) {
    errors.push(`${fieldPath}: pattern 위반("${schema.pattern}")`)
  }
  // `format` 은 `date-time` **한 값만** 지원한다(범용 포맷 검증기가 아니다 — 다른 format 값은
  // 무시한다). RFC 3339 §5.6 은 date-time 을 `full-date "T" full-time` 문법으로 정의하는데, 이
  // 검증기의 `pattern` 은 자릿수·구분자 같은 **형태**만 보고 각 자리의 **값 범위**(월 01-12·시
  // 00-23 등)는 보지 않는다 — "2026-99-99T00:00:00Z" 처럼 자릿수는 맞지만 의미가 없는 값이 pattern
  // 만으로는 통과한다(재현됨). `Date.parse` 는 ISO 8601 date-time 문자열의 연·월·일·시·분·초를 실제
  // 범위로 검사해 그 값을 걸러낸다(윤달 등 월별 최대 일수까지 보정하지는 않는 한계는 있다 — 이
  // 항목이 재현한 결함 범위 밖이다).
  if (schema.format === 'date-time' && typeof data === 'string' && Number.isNaN(Date.parse(data))) {
    errors.push(`${fieldPath}: format 위반(date-time 아님: "${data}")`)
  }
  if (schema.minimum !== undefined && typeof data === 'number' && data < schema.minimum) {
    errors.push(`${fieldPath}: minimum 위반(>= ${schema.minimum} 필요)`)
  }
  if (
    schema.minLength !== undefined &&
    typeof data === 'string' &&
    data.length < schema.minLength
  ) {
    errors.push(`${fieldPath}: minLength 위반(>= ${schema.minLength} 필요)`)
  }

  if (schema.items && Array.isArray(data)) {
    for (const [index, item] of data.entries())
      validateAgainstSchema(item, schema.items, errors, `${fieldPath}[${index}]`, root)
  }

  if (isPlainObject(data)) {
    if (schema.required) {
      for (const req of schema.required) {
        if (!hasOwnField(data, req) || data[req] === undefined)
          errors.push(`${fieldPath}: 필수 필드 누락 "${req}"`)
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!hasOwnField(data, key) || data[key] === undefined) continue
        validateAgainstSchema(data[key], propSchema, errors, `${fieldPath}.${key}`, root)
      }
    }

    // strict 쓰기(README · 불변식 8종): 모르는 필드 = 빌드 버그. 제거된 필드가 산출물에 남아 있으면
    // 여기서 죽는다 — 그것이 스키마 3종의 존재 이유다. `additionalProperties` 가 스키마 객체면
    // `Record<K, V>`(wiki_body.json 의 docs) 로 취급해 잉여 키의 **값**을 그 스키마로 검증한다.
    const extra = schema.additionalProperties
    if (extra !== undefined && extra !== true) {
      const known = new Set(Object.keys(schema.properties ?? {}))
      for (const key of Object.keys(data)) {
        if (known.has(key)) continue
        const subPath = `${fieldPath}.${key}`
        if (extra === false) errors.push(`${subPath}: 정의되지 않은 필드 "${key}"`)
        else validateAgainstSchema(data[key], extra, errors, subPath, root)
      }
    }
  }

  // `anyOf` — 분기 중 **하나라도** 통과하면 통과다. 각 분기를 **버려지는 오류 버퍼**로 시험하고,
  //   전부 실패했을 때만 한 줄로 보고한다(분기별 오류를 그대로 흘리면 "정상값인데 오류 N건" 이 된다).
  //   ★ 이 갈래가 없으면 `anyOf` 를 쓴 필드가 **무검증으로 통과**한다 — 선언은 있는데 거동이 없는
  //   상태이고, 그것은 스키마 계층의 결속을 조용히 비운다(feeds 의 `nextCursor` 가 그 자리다).
  if (Array.isArray(schema.anyOf)) {
    const branchErrors = schema.anyOf.map((branch) => {
      const probe = []
      validateAgainstSchema(data, branch, probe, fieldPath, root)
      return probe
    })
    if (!branchErrors.some((probe) => probe.length === 0)) {
      errors.push(
        `${fieldPath}: anyOf 분기 어느 것도 만족하지 않는다 — ${branchErrors.flat().join(' / ')}`,
      )
    }
  }

  if (schema.allOf) {
    for (const rule of schema.allOf) {
      if (!rule.if) {
        validateAgainstSchema(data, rule, errors, fieldPath, root)
        continue
      }
      if (matchesCondition(data, rule.if)) {
        if (rule.then) validateAgainstSchema(data, rule.then, errors, fieldPath, root)
      } else if (rule.else) {
        validateAgainstSchema(data, rule.else, errors, fieldPath, root)
      }
    }
  }

  // 판별 유니온의 **포괄 실패**. `if`/`then` 만 있는 스키마에서 어느 조건도 매치하지 않으면 지금까지는
  // strict 하위 스키마(10키/4키)가 **하나도 적용되지 않아** 임의의 값·잉여 필드가 조용히 통과했다
  // — "제거된 필드가 있으면 fail 한다"는 이 검증기의 존재 이유가 그 경우에만 무력화된다.
  // 스키마가 `discriminator` 를 선언하면 "어느 분기에도 안 걸림" 자체를 에러로 만든다.
  if (schema.discriminator && isPlainObject(data)) {
    const branches = (schema.allOf ?? []).filter((rule) => rule.if)
    if (branches.length > 0 && !branches.some((rule) => matchesCondition(data, rule.if))) {
      errors.push(
        `${fieldPath}: 판별자 "${schema.discriminator}" 의 값(${JSON.stringify(data[schema.discriminator])})이 어느 분기에도 해당하지 않는다`,
      )
    }
  }
}
