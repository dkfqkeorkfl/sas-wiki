// @vitest-environment node
//
// P3 · Task 6 — 원자 발행 동시성 하드 게이트 (**자식 2 프로세스**) — tdd §3.7 (AT6)
//
// RED 사유(**미구현**): `scripts/lib/atomic.mjs` 가 부재해 생산자 자식이 `writeFileAtomic` 을 로드하지
//   못한다 → 드라이버가 `producer.loadError` 를 보고하고 첫 단언에서 red 다.
//
// 왜 단위 테스트로는 부족한가: Node 는 단일 스레드라 한 프로세스 안에서 write 와 read 가 애초에
//   겹치지 않는다 — "쓰고 나서 읽어보니 멀쩡하더라" 는 **아무것도 증명하지 못한다**. 소비자를 별도
//   프로세스로 띄워야 "생산자가 갈아끼우는 동안 소비자가 무엇을 보는가" 가 관측된다.
//
// 경계(tdd §3.7 · §8.2): 하드 게이트는 **컨테이너 로컬 fs**(`os.tmpdir()`)에서만 건다 — 그것이 우리
//   코드의 성질이다. 9p(`/workspace`) 결과는 통과/실패가 아니라 **측정**이며 tdd §8.2 표에 기록한다.
//   로컬 0건 · 9p >0건이면 원인은 우리 코드가 아니라 파일시스템이다(F-note + `--out` 훅으로 처리).
//
// 관측 채널은 `helpers/atomic-stress.mjs` 드라이버가 stdout JSON 으로 낸다(헬퍼에 `expect` 없음 · 규범 D).
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterAll, describe, expect, it } from 'vitest'

import { cleanup } from './helpers/tmp-git-vault.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DRIVER = path.join(HERE, 'helpers', 'atomic-stress.mjs')

const GENERATIONS = 40

// 드라이버는 `ROLE`(기본 `driver`)·`PAYLOAD_KB`(기본 256)·`GENERATIONS`·`CACHE_DIR` 를 **환경에서**
//   읽는다. 그래서 자식 env 를 `{ ...process.env }` 로만 넘기면 러너를 띄운 셸에 남아 있던 값이
//   그대로 새어 든다 — 특히 `ROLE=producer` 가 있으면 최상위 호출이 드라이버 분기가 아니라
//   **생산자 자식 분기로 들어가** 보고 JSON 을 내지 않는다. 페이로드 크기도 마찬가지로 흔들려
//   "커널이 1회 write 로 내보내지 못할 만큼 크게" 라는 이 스펙의 전제가 조용히 깨진다.
//   네 값을 **전부 명시**해 주변 환경이 결과를 바꾸지 못하게 한다.
const PAYLOAD_KB = 256
const driverEnv = (cacheDir) => ({
  ...process.env,
  CACHE_DIR: cacheDir,
  GENERATIONS: String(GENERATIONS),
  PAYLOAD_KB: String(PAYLOAD_KB),
  ROLE: 'driver',
})

const tmps = []
afterAll(() => cleanup(...tmps))

describe('원자 발행 동시성 — 컨테이너 로컬 fs 하드 게이트 (AT6 · 🔴RED 미구현)', () => {
  // ★ 타임아웃을 **명시**한다. 아래 `spawnSync` 는 이벤트 루프를 동기 블록하므로 vitest 의
  //   `testTimeout`(30s) 타이머가 이 구간을 끊지 못한다 — 자식이 행(hang)하면 선언값과 무관하게
  //   최대 120s 를 블록한다. 그 사실을 설정에 드러내 "이 스위트는 30s 안에 끝난다" 는 기대와 어긋나지
  //   않게 한다(느슨하게 푸는 것이 아니라 **실제 상한을 정직하게 적는 것**이다).
  it(
    'AT6: 소비자가 ENOENT 0건 · 파싱 실패 0건 · 중간 세대 0건을 본다',
    { timeout: 130_000 },
    () => {
      const cacheDir = mkdtempSync(path.join(tmpdir(), 'wiki-atomic-at6-'))
      tmps.push(cacheDir)

      const child = spawnSync(process.execPath, [DRIVER], {
        encoding: 'utf8',
        env: driverEnv(cacheDir),
        maxBuffer: 16 * 1024 * 1024,
        timeout: 120_000,
      })

      // 자식의 종료 상태를 **먼저** 판정한다. 이걸 건너뛰고 곧장 `JSON.parse(child.stdout)` 로 가면
      //   드라이버가 spawn 조차 못 했거나(`error`), 타임아웃으로 시그널에 죽었거나(`signal`),
      //   비정상 종료한(`status !== 0`) 경우가 **파싱 에러로 위장**된다 — 원인이 "원자성 위반"이
      //   아니라 "자식이 죽었다" 인데 실패 메시지는 그 사실을 가리키지 않는다.
      expect(child.error, `드라이버 spawn 실패: ${child.error?.message ?? ''}`).toBeUndefined()
      expect(child.signal, `드라이버가 시그널로 종료(타임아웃 의심): ${child.stderr}`).toBeNull()
      expect(child.status, `드라이버 비정상 종료: ${child.stderr}`).toBe(0)
      expect(child.stdout.trim(), `드라이버 보고가 비었다: ${child.stderr}`).not.toBe('')

      const report = JSON.parse(child.stdout)

      // ① 미구현 신호를 **먼저** 명시한다 — 이게 없으면 "생산자가 아무것도 안 써서 소비자가 아무 실패도
      //    못 봤다" 가 0건으로 통과한다(전형적 공허).
      expect(
        report.producer?.loadError,
        '생산자가 lib/atomic.mjs 를 로드하지 못했다',
      ).toBeUndefined()

      // ② 위험 실재 앵커(규범 B): 생산자가 실제로 N회 갈아끼웠고, 소비자가 실제로 읽었으며,
      //    **여러 세대를 목격**했다 = 두 프로세스의 구간이 실제로 겹쳤다.
      expect(report.producer.writes).toBe(GENERATIONS)
      expect(report.consumer.reads).toBeGreaterThan(0)
      expect(report.consumer.generationsSeen).toBeGreaterThanOrEqual(2)

      // ③ 본 단언 — 발행이 원자적이면 소비자는 부재도, 찢긴 JSON 도, 섞인 세대도 보지 못한다.
      expect(report.consumer.enoent).toBe(0)
      expect(report.consumer.parseFail).toBe(0)
      expect(report.consumer.unknownGeneration).toBe(0)
      // ④ 소비자 루프 상한(consume() 의 데드라인)을 실제로 소모했는지 — 옵션만 두고 결과를 안 보면
      //    "무한 행을 막는 장치가 있다"는 조용한 주장으로 남는다.
      expect(report.consumer.timedOut, '소비자 루프가 데드라인을 소모했다').toBe(false)
    },
  )
})
