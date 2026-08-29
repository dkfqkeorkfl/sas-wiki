---
id: "01a04241-ce57-7548-9765-9bc283163869"
title: 오픈AI 동맹
type: moc
status: active
aliases: ["OpenAI Ally", "OpenAI 진영", "오픈AI 생태계", "ChatGPT 생태계"]
tags: ["AI인프라", "LLM", "투자생태계", "지배구조"]
meta:
  scope: "OpenAI/ChatGPT에 대한 지분 투자자·교차투자·지배구조 관계망(2026-08-27 기준). 클라우드·컴퓨트·데이터센터 금융 관계는 UNIC/OpenAI 참고."
---

## 개요

이 문서는 OpenAI라는 회사 자체의 사실관계([[UNIC/OpenAI]])가 아니라, OpenAI에 **지분을 투자한 자본 관계망** — 누가 얼마나 투자했고, 그 결과 교차투자 구도가 어떻게 되는지 — 를 다룬다. OpenAI가 클라우드·컴퓨트·데이터센터를 누구에게서 얼마나 조달하는지, 그 계약과 금융 구조(Oracle Stargate, NVIDIA의 잔존가치보증 등 순수 벤더·금융 관계 포함)는 [[UNIC/OpenAI]]에서 다룬다 — Microsoft·Amazon·NVIDIA는 아래 표의 지분 투자자이면서 동시에 그 문서에서 다루는 OpenAI의 컴퓨트 공급자이기도 하다.

**중요한 원칙**: "OpenAI 진영 vs Anthropic 진영"이라는 이분법은 부정확하다. Microsoft·Amazon·NVIDIA는 두 회사 모두에 투자자로 얽혀 있다. 교차 투자 상세 매트릭스는 [[Anthropic-Ally/안트로픽-동맹#교차-투자·중복-관계]]에 이미 정리되어 있으므로 이 문서에서는 반복하지 않고 요약만 남긴다.

## 투자자 관계 — 지분 투자

| 투자자 | 투자 이력 | 2026-08 기준 상태 | 확정도 |
| --- | --- | --- | --- |
| Microsoft | 2019년부터 누적 $130억+ 투자(초기 capped-profit 구조 시절) | 2025-10-28 재편으로 OpenAI Group PBC 지분 **27%**(약 $1,350억 가치, as-converted) 보유. 재편 전에는 32.5%(전환 기준, 이후 라운드 제외)였음 | 공식 발표 |
| SoftBank | 기존 $75억 직접투자 + 공동투자자 신디케이션 $110억(누적 $400억 팔로우온 약정, 2025-12-30 완납)[^softbank-cnbc] | 2026-02-27 추가 $300억 팔로우온 계약 체결, 누적 약 $646억로 지분 약 13%[^softbank-official] | 공식 발표 |
| NVIDIA | 2025-09-22 최대 $1,000억(10GW 배치에 맞춰 단계적 투자하는 비구속적 의향서, LOI) 발표 | 2026-02-19 전후 이 구조가 **$300억 규모의 고정 지분투자**(2026-02-27 마감 라운드의 일부, 마일스톤과 무관)로 재편됐다고 보도됨. 즉 "$1,000억/10GW" 인프라 파트너십과 "$300억 지분투자"는 서로 다른 트랙으로 분리됐다[^nvda-pivot] | 공식 라운드 발표 + 재편 보도(세부 조건 미공개) |
| Amazon | 2025-11-03 AWS와 $380억 컴퓨트 계약(지분 투자 아님, [[UNIC/OpenAI]] 참고) | 2026-02-27 라운드에서 **별도로** $500억 지분 투자 발표 — 최초 $150억(Series C 우선주, 2026-03-31 납입 기한) + 조건부 $350억(IPO·AGI 등 트리거 조건). 2026년 중 전액 납입 완료 보도[^amazon-openai-50b] | 공식 발표 |

### 2026-02 라운드 규모 — 공식 발표액과 마감 후 보도액의 차이

OpenAI는 2026-02-27 이 라운드를 Amazon $500억·NVIDIA $300억·SoftBank $300억을 포함해 총 $1,100억 규모(프리머니 밸류에이션 $7,300억)로 공식 발표했다.[^round-official] 그런데 CNBC(2026-08-10)와 Dealroom(2026-08-11)은 훗날 별도의 텐더오퍼 기사를 쓰면서 이 라운드를 "2026년 3월 마감한 $1,220억 규모"였다고 배경 설명에 짧게 적었다.[^round-close] 두 매체 모두 늘어난 약 $120억을 어느 투자자가 추가로 납입했는지는 밝히지 않았고, OpenAI도 이 차액을 별도로 설명한 적이 없다 — 즉 $1,100억(공식 발표)과 $1,220억(언론의 사후 서술) 모두 출처는 있지만, 그 차액의 투자자 구성만큼은 공시·언론 보도 어느 쪽으로도 확인되지 않는다.

Microsoft·Amazon·NVIDIA는 모두 OpenAI의 클라우드·컴퓨트 공급자이기도 하다 — Azure(Microsoft)·AWS(Amazon)·GPU(NVIDIA)의 구체적 계약 규모·가동 시점, Oracle의 Stargate 클라우드 매출 계약, NVIDIA의 Ohio 데이터센터 잔존가치보증 구조는 [[UNIC/OpenAI]]에서 다룬다.

## 교차 투자 — 요약

Microsoft·Amazon·NVIDIA는 Anthropic과 OpenAI 양쪽에 동시에 지분 투자자로 얽혀 있고, Google은 Anthropic에만 직접 지분 투자자로 확인되며 OpenAI에 대한 직접 지분투자는 2026-08 기준 확인되지 않는다. Oracle은 OpenAI에 대해서도 지분 투자자가 아니라 순수 클라우드 컴퓨트 판매자(고객-공급자 관계)다. 상세 매트릭스와 각 관계의 출처는 [[Anthropic-Ally/안트로픽-동맹#교차-투자·중복-관계]] 참고.

## IPO 상태

OpenAI는 2026-06-08 SEC에 비공개 초안 S-1을 제출했다고 공식 발표했다.[^s1-openai] 2026-08-19 CFO Sarah Friar는 사내 미팅에서 "2027년에는 상장 기업이 되어 있을 것"이라고 밝혔다. 상세는 [[UNIC/OpenAI]] 참고.

## 확인 필요

아래 항목은 공시·규제 제출급 자료가 없다는 뜻이며, 실제로 존재하는 언론 보도 내용은 위 각 절 본문에 출처와 함께 적어뒀다. OpenAI의 클라우드·컴퓨트·데이터센터 금융 관계에 관한 확인 필요 항목(NVIDIA Ohio 보증 세부, Stargate 중복 계상 여부)은 [[UNIC/OpenAI]]으로 옮겼다.

- **2026년 3월 라운드 최종액($1,220억) 대비 2월 발표액($1,100억)의 ~$120억 차액**: CNBC·Dealroom(언론 보도)이 $1,220억이라는 마감 총액은 보도했지만 추가 투자자 구성은 밝히지 않음 — 상세는 "2026-02 라운드 규모" 절.
- NVIDIA의 애초 "$1,000억/10GW LOI"와 이후 "$300억 고정 지분투자"가 완전히 별개 트랙인지, 아니면 일부 대체 관계인지의 정확한 법적 구조(공시된 계약서 미확인).

## 각주

[^softbank-cnbc]: CNBC, "SoftBank has fully funded $40 billion investment in OpenAI, sources tell CNBC", cnbc.com, 2025-12-30 (확인일 2026-08-27).
[^softbank-official]: SoftBank Group Corp., "Follow-on Investments in OpenAI", group.softbank/en/news/press/20260227, 2026-02-27 (확인일 2026-08-27).
[^nvda-pivot]: Finviz(보도 인용), "Nvidia pivots to $30 billion direct stake in OpenAI decoupling from $100B milestone plan", finviz.com, 2026-02-19 전후; TechCrunch, "OpenAI raises $110B in one of the largest private funding rounds in history", techcrunch.com, 2026-02-27(NVIDIA $300억 지분 포함, 확인일 2026-08-27).
[^amazon-openai-50b]: GeekWire, "Filings: How Amazon's $50B OpenAI deal actually works"; PYMNTS, "Amazon Completes $50 Billion Investment in OpenAI"; The Information, "Amazon Completes Additional $35 Billion Investment in OpenAI" (2026년 보도 종합, 확인일 2026-08-27).
[^round-official]: TechCrunch, "OpenAI raises $110B in one of the largest private funding rounds in history", techcrunch.com, 2026-02-27 (확인일 2026-08-27).
[^round-close]: CNBC, "OpenAI wraps $7 billion share sale ahead of potential IPO", cnbc.com, 2026-08-10; Dealroom, "OpenAI self-funds $7B employee buyback, freezes valuation at $852B", dealroom.co, 2026-08-11 — 두 기사 모두 "2026년 3월 마감한 $122B 라운드"를 배경으로 언급(확인일 2026-08-27).
[^s1-openai]: OpenAI, "Confidential submission of draft S-1 to the SEC", openai.com/index/openai-submits-confidential-s-1/, 2026-06-08 (확인일 2026-08-27).
