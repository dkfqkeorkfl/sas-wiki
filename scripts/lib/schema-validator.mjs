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
  return true
}

function validateAgainstSchema(data, rawSchema, errors, fieldPath = '$', root = rawSchema) {
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
        if (!(req in data) || data[req] === undefined)
          errors.push(`${fieldPath}: 필수 필드 누락 "${req}"`)
      }
    }

    if (schema.properties) {
      for (const [key, propSchema] of Object.entries(schema.properties)) {
        if (!(key in data) || data[key] === undefined) continue
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
