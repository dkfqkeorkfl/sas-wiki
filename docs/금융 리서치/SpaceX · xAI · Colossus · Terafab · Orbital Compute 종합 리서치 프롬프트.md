# SpaceX · xAI · Colossus · Terafab · Orbital Compute 종합 리서치 및 보고서 작성 프롬프트

## 0. 작업 목적

SpaceX, xAI, Grok, Colossus, AI compute 임대사업, Tesla/Optimus/Cybercab, Starlink, Starship, Terafab, orbital AI data center가 서로 어떤 관계를 가지며 발전하고 있는지 하나의 투자·산업 관점에서 분석한다.

단순히 Elon Musk가 제시하는 미래 비전을 정리하는 것이 목적이 아니다.

핵심 질문은 다음과 같다.

> **왜 SpaceX/xAI는 현재 막대한 자본을 지상 AI 데이터센터에 투입하고 있는가?**

특히 다음의 겉보기 모순을 설명해야 한다.

- xAI는 후발주자로 Grok을 빠르게 frontier AI 수준으로 끌어올리기 위해 Colossus를 건설했다.
- 그러나 Grok 자체의 상업적 수요가 Colossus의 막대한 compute capacity를 모두 흡수하지 못하는 것으로 보인다.
- 그럼에도 SpaceX/xAI는 데이터센터 투자를 축소하는 것이 아니라 오히려 확대하고 있다.
- 동시에 Musk는 Terafab, Starship, orbital AI compute 등 훨씬 장기적인 AI 인프라 구상을 추진하고 있다.
- Anthropic, Google 등 경쟁 AI 업체들은 자체 장기 데이터센터·compute capacity도 대규모로 확보하고 있으므로 현재의 Colossus 임대수요가 영구적이라고 가정하기 어렵다.
- GPU는 감가상각과 기술적 노후화가 매우 빠른 자산이다.
- 그럼에도 SpaceX는 막대한 AI CAPEX를 계속 집행하고 있다.

이 모순을 사실과 추론을 엄격히 분리하여 설명하고, 궁극적으로 SpaceX 주주가 어떤 경제적 베팅을 하고 있는지 평가한다.


# 1. 에이전트 구성

작업은 내부적으로 다음 순서로 수행한다.

## Agent A — 원칙러 / Auditor

먼저 분석의 Definition of Done(DoD)을 설계한다.

원칙러는 특히 다음 오류를 방지한다.

1. Musk의 장기 비전을 현재 사업의 원래 목적처럼 사후적으로 연결하지 않는다.
2. 회사 경영진의 주장과 독립적으로 검증된 사실을 구분한다.
3. 현재 상황과 미래 전망을 구분한다.
4. 상관관계를 인과관계로 확대하지 않는다.
5. “가능성이 높다”와 “확인됐다”를 구분한다.
6. SpaceX/xAI의 공식 홍보자료를 객관적 사실처럼 받아들이지 않는다.
7. 반대로 Musk에 대한 부정적인 언론 논조 역시 사실처럼 받아들이지 않는다.
8. 투자 thesis와 실제 확인된 재무성과를 구분한다.
9. Grok 소비자 서비스와 xAI 기반모델 기술을 구분한다.
10. 지상 Colossus와 미래 orbital compute의 경제성을 별도로 평가한다.
11. EBITDA와 감가상각 후 영업이익을 혼동하지 않는다.
12. 명목 계약기간과 실제 termination clause를 구분한다.
13. AI compute의 현재 shortage와 장기 shortage를 동일시하지 않는다.
14. 현재의 높은 임대가격을 장기 정상가격으로 가정하지 않는다.
15. “Colossus가 경쟁력이 있다”는 표현을 속도·CAPEX·TCO·전력효율·네트워크 성능 등으로 분해한다.

원칙러는 이 기준을 바탕으로 자체 DoD 체크리스트와 평가기준을 만든다.

이 내부 DoD와 사고과정은 최종 사용자에게 출력하지 않는다.


# 2. Main Agent — 전체 분석

Main Agent는 아래에 제공된 기존 논의 내용을 출발점으로 삼되 그대로 사실로 받아들이지 않는다.

필요한 경우 신뢰할 수 있는 최신 자료를 이용하여 사실관계를 보강한다.

출처 우선순위는 대략 다음과 같다.

1. SEC filings / IPO documents / 계약서
2. SpaceX, xAI, Tesla 공식자료
3. 회사 실적발표 및 경영진 발언
4. Reuters, FT, WSJ, Bloomberg 등 신뢰도 높은 언론
5. 관련 기업 공식자료
6. 기타 분석자료

회사 자체 주장은 반드시 `회사 주장`임을 구별한다.


# 3. 반드시 보존해야 할 기존 논의

## A. Colossus의 시작

초기 xAI는 OpenAI, Google, Anthropic보다 늦게 출발한 후발주자였다.

이미 경쟁사에는 다음과 같은 자산이 존재했다.

- OpenAI: 연구조직, ChatGPT, Microsoft, API ecosystem
- Google: DeepMind, Search, YouTube, Android, Cloud, TPU
- Anthropic: 연구조직, AWS/Google 지원, 기업시장, Claude/Claude Code

xAI는 이러한 시간적 격차를 단기간에 따라잡을 필요가 있었다.

사람, 연구문화, ecosystem, 사용자 기반은 돈만으로 즉시 만들기 어렵지만 compute는 상대적으로 자본을 투입해 빠르게 확보할 수 있다.

따라서 초기 전략은 대략 다음과 같이 해석되었다.

후발 xAI
→ 막대한 자본 투입
→ 세계 최대급 AI cluster 구축
→ training/RL/experiment iteration 증가
→ Grok 성능 빠르게 향상
→ frontier AI 경쟁 진입

즉 Colossus의 원래 목적은 기본적으로 Grok/xAI 모델 개발이었다.


## B. Colossus의 급속한 증설

Colossus는 매우 빠른 속도로 GPU 규모를 확대했다.

논의 과정에서는 다음과 같은 단계가 다뤄졌다.

100K GPU
→ 200K
→ 1M H100-equivalent 이상 규모 계획/확장

Grok 3, Grok 4 및 이후 모델의 compute 확대와 밀접한 관계가 있었다.

중요한 것은 단순 모델 크기뿐 아니라 대규모 compute를 이용하여

- pretraining
- reinforcement learning
- reasoning
- coding
- agent
- multimodal/video
- 기타 대규모 실험

등을 병렬화함으로써 연구 iteration speed를 높이는 전략이었다는 점이다.

그러나 이것이 실제 경쟁사 대비 어느 정도 연구개발 속도 우위를 만들었는지는 별도로 검증한다.


# 4. 핵심 전환점 — Colossus의 미사용 capacity

논의에서 가장 중요한 발견 중 하나다.

SpaceX/관련 공시에서는 외부 고객에게 제공되는 compute와 관련하여 `unused compute capacity`를 monetization한다는 취지의 표현이 확인되었다.

따라서 다음 명제를 구분해야 한다.

**확인 가능한 사실:**

Grok/xAI 내부 workload가 모든 Colossus capacity를 항상 소비하는 것은 아니다.

**추론:**

xAI가 예상보다 빠르게 infrastructure를 확대했지만 Grok의 경제적 수요가 그 속도를 따라가지 못했을 가능성이 있다.

후자를 사실처럼 단정하지 않는다.


# 5. Anthropic / Google 등 외부 compute 계약

Colossus의 일부 compute가 외부 고객에게 판매되기 시작했다.

논의에서 확인한 주요 사례에는 Anthropic과 Google이 포함된다.

검증해야 할 내용:

- 제공 GPU 규모
- 계약 금액
- 월별 또는 총 계약금액
- 실제 계약기간
- termination clause
- capacity reservation 여부
- 실제 utilization
- inference/training/post-training/RL 등의 용도
- 고객 데이터/IP 보호조건

특히 명목상 장기계약이라 하더라도 90일 termination 조항 등이 있다면 이를 명확히 설명한다.

따라서 이를 전통적인 장기 데이터센터 lease와 동일하게 취급해서는 안 된다.


# 6. 경쟁사의 Colossus 사용 문제

Anthropic, Google 등은 SpaceX/xAI와 AI 시장에서 경쟁관계이기도 하다.

따라서 경쟁사의 핵심 infrastructure를 사용하는 데에는 전략적 위험이 존재할 수 있다.

검토할 사항:

- 고객 모델과 데이터에 대한 계약상 보호
- infrastructure operator가 관찰할 수 있는 metadata의 범위
- training topology
- GPU utilization
- network pattern
- workload 규모와 timing
- 핵심 frontier pretraining을 경쟁사 infrastructure에서 실행할 유인
- inference, RL, post-training, burst capacity 등에 사용할 유인

“SpaceX가 고객의 모델 내용을 볼 수 있다”처럼 근거 없는 주장을 하지 않는다.

가능한 정보와 실제 계약상 권리를 구분한다.


# 7. Colossus 자체의 경쟁력

논의 과정에서 다음 가설이 제기되었다.

> Grok을 위해 만든 Colossus가 예상보다 잘 만들어졌고, AI compute infrastructure 자체가 별도의 사업성을 가진다는 것을 SpaceX/xAI가 발견했을 가능성이 있다.

이것은 반드시 세분화하여 검증한다.

### 상대적으로 강하게 확인되는 요소

- 매우 빠른 구축속도
- 대규모 GPU cluster 운영능력
- 전력 확보
- liquid cooling
- high-density rack
- networking
- 대규모 cluster orchestration

### 회사 주장에 가까운 요소

- 경쟁사보다 낮은 MW당 건설비
- 경쟁사보다 낮은 총 compute cost
- 구조적으로 우월한 TCO

독립적인 AWS / Google / Oracle / CoreWeave / Microsoft 등과의 동일조건 TCO 비교가 없다면 `입증됨`이라고 표현하지 않는다.


# 8. Colossus 사업모델의 변화

초기:

Colossus
→ Grok training

현재:

Colossus
→ xAI/Grok 내부 workload
+
→ 외부 third-party compute

SpaceX는 이를 내부 AI와 third-party workload 사이에서 compute를 배분하는 `dual monetization strategy`로 설명한 바 있다.

따라서 Colossus는 단순 Grok 전용 supercomputer에서 점차 범용 AI compute asset의 성격을 갖게 되었다고 볼 수 있다.

그러나 다음 표현은 구분한다.

**사실에 가까움:**

SpaceX가 third-party compute monetization을 공식 사업으로 확대하고 있다.

**추론:**

Grok의 수익성이 예상보다 떨어졌기 때문에 데이터센터 임대사업으로 피벗했다.

후자는 충분히 가능한 해석이지만 직접적인 회사 확인이 없다면 추론으로 표시한다.


# 9. 왜 지금도 데이터센터를 계속 증설하는가?

이 보고서의 가장 중요한 질문이다.

단순히 “AI 수요가 증가하고 있기 때문”이라고 답하지 않는다.

다음 경제논리를 검토한다.

현재 AI compute 시장은 공급 부족 상태일 가능성이 높다.

SpaceX/xAI는 대규모 AI cluster를 경쟁사보다 매우 빠르게 가동할 수 있는 역량을 보여줬다.

현재 외부 고객은 높은 가격을 지불할 의사가 있다.

SpaceX 경영진은 신규 compute capital deployment의 payback period가 매우 짧다는 취지의 주장을 한 바 있다.

이를 바탕으로 다음 전략 가설을 평가한다.

> 현재 AI compute scarcity가 매우 크기 때문에, 장기적으로 GPU 가치가 빠르게 하락하더라도 초기 1~2년 동안 높은 utilization과 높은 임대가격으로 CAPEX를 빠르게 회수할 수 있다면 지금 대규모로 건설하는 것이 경제적으로 합리적일 수 있다.

그러나 payback period가 실제로 독립적으로 확인된 수치인지, 경영진의 전망/계산인지 명확히 구분한다.


# 10. SpaceX가 실제로 베팅하는 것

핵심 가설:

> 미래 AI compute demand 증가속도 > compute supply 증가속도

즉 전세계에서 데이터센터를 대규모로 건설하더라도

- inference
- coding agents
- autonomous agents
- multimodal
- video generation
- scientific AI
- simulation
- robotics
- physical AI

등의 workload 증가가 공급 증가를 계속 앞지를 것이라고 SpaceX가 베팅하고 있을 가능성이 있다.

하지만 이것은 사실이 아니라 투자 가설이다.

반드시 반대 시나리오도 다룬다.

- 모델 효율 개선
- quantization
- distillation
- ASIC
- TPU
- Trainium
- local inference
- inference optimization
- AI 성장률 둔화
- hyperscaler 자체 capacity 완공

등으로 compute 수요 또는 가격이 예상보다 빠르게 안정될 수 있다.


# 11. 가장 중요한 위험 — 공급과잉

현재 Anthropic, Google, Microsoft, Amazon, Meta, Oracle, OpenAI 등은 엄청난 규모의 장기 AI infrastructure를 구축하거나 계약하고 있다.

따라서 현재 Colossus를 사용하는 고객도 몇 년 후 자체 capacity가 완성되면 사용량을 줄일 수 있다.

핵심 시나리오:

현재:

Demand 100
Supply 60

→ 높은 compute 가격

미래 Bull:

Demand 500
Supply 300

→ shortage 지속
→ Colossus 높은 utilization
→ 증설 성공

미래 Bear:

Demand 200
Supply 350

→ 공급과잉
→ rental price 하락
→ utilization 하락
→ 계약 종료
→ GPU 감가상각 부담 증가

이것이 SpaceX AI infrastructure 전략의 핵심 위험이다.


# 12. GPU 감가상각과 기술 노후화

AI 데이터센터는 일반적인 부동산형 데이터센터와 다르다.

GPU 세대가

H100/H200
→ Blackwell
→ Rubin
→ 차세대

로 발전하면서 동일 전력당 compute 및 token 생산성이 크게 개선될 수 있다.

따라서 기존 GPU cluster는 경제적 가치가 빠르게 하락할 수 있다.

분석할 사항:

- GPU depreciation
- useful life
- residual value
- 전력당 성능
- $/token
- 신규 GPU 대비 구형 GPU 임대가격
- CAPEX 회수기간

따라서 SpaceX의 전략이 성공하려면 초기 몇 년 동안 높은 utilization과 가격을 유지하여 투자금을 빠르게 회수하는 것이 중요하다.


# 13. EBITDA와 실제 경제적 수익성

AI 사업 평가에서 Adjusted EBITDA만 사용하지 않는다.

다음 항목을 반드시 구분한다.

Revenue
→ EBITDA
→ depreciation
→ operating income
→ CAPEX
→ free cash flow

특히 GPU depreciation이 매우 크므로

**Adjusted EBITDA 흑자 ≠ AI infrastructure의 경제성이 완전히 검증됨**

이라는 점을 강조한다.

SpaceX AI 부문의 실제 영업손익과 CAPEX를 확인한다.


# 14. Grok의 장기적 의미

중요한 구분:

### Consumer Grok

ChatGPT / Claude / Gemini와 직접 경쟁하는 소비자·기업 AI 서비스.

### xAI foundation model technology

Musk ecosystem에 들어갈 수 있는 기반 intelligence technology.

Grok 앱이 ChatGPT보다 시장점유율이 낮다고 해서 Musk의 전체 AI 전략이 자동으로 실패하는 것은 아니다.

Tesla, X, Starlink, Optimus, Cybercab 등이 xAI technology를 사용할 수 있기 때문이다.

그러나 xAI 모델이 경쟁사보다 지나치게 성능이 낮다면 Tesla 등 다른 사업의 경쟁력을 훼손하면서까지 내부 모델을 사용할 경제적 이유는 약해질 수 있다.

따라서 필요한 것은 반드시 Grok 소비자시장 1위가 아니라 **충분한 frontier competitiveness**일 가능성이 있다.


# 15. Apple 비교

장기 Musk ecosystem을 설명할 때 Apple의 vertical integration 전략과 비교한다.

Apple은 처음부터 모든 기술을 자체 개발하지 않았다.

필요할 때 Intel, Qualcomm, Google 등 외부 기술을 사용한 뒤 자체 기술이 충분히 경쟁력을 갖추면 Apple Silicon 등의 내부 기술로 전환했다.

따라서 Tesla/Optimus 역시 반드시 현재부터 Grok만 사용해야 하는 것은 아니다.

외부 AI를 사용하다가 xAI가 충분히 성장하면 내부 모델로 전환할 수도 있다.

이 때문에

> “미래 Optimus를 위해 지금 당장 Grok이 frontier여야 하므로 Colossus 투자가 필수였다.”

라는 주장은 논리적으로 충분하지 않다.

Colossus의 초기 대규모 투자는 **현재 AI 모델 경쟁에서 xAI/Grok 자체가 frontier가 되려는 공격적 시도**였다는 해석을 별도로 평가한다.


# 16. Tesla / Physical AI / Optimus / Cybercab

Musk의 장기 AI ecosystem에서 Tesla는 physical AI와 제조 플랫폼 역할을 할 가능성이 있다.

그러나 Grok과 Tesla physical AI를 동일시하지 않는다.

Optimus/Cybercab에는

- perception
- vision
- planning
- actuator control
- low-latency local inference

등 별도의 physical AI stack이 필요하다.

xAI/Grok 계열 모델은 보다 고수준의

- language understanding
- reasoning
- planning
- agent coordination

등에 연결될 가능성이 있다.

이 역할분담이 실제 공식적으로 어느 수준까지 확인됐는지 검증한다.


# 17. Musk 장기 ecosystem 가설

논의 과정에서 다음과 같은 전체 그림을 구성했다.

### Network
Starlink

### Launch / Logistics
Starship / SpaceX

### Intelligence
xAI / Grok / agents

### Physical production & robotics
Tesla / Optimus / Cybercab

### Current AI compute
Colossus / terrestrial data centers

### Future chip supply
Terafab

### Long-term compute scaling
Orbital AI data centers

그러나 이것을 처음부터 존재했던 완성된 master plan이라고 표현하지 않는다.

실제로는 각각의 사업과 병목이 시간에 따라 추가·변경·확장되었을 가능성이 높다.


# 18. Terafab

Terafab의 목적을 정확히 분석한다.

단순히 Nvidia를 대체하는 자체 GPU 공장이라고 단순화하지 않는다.

검토할 요소:

- chip design
- manufacturing
- packaging
- testing
- Tesla AI chips
- Optimus
- Cybercab
- SpaceX AI infrastructure
- orbital compute

그리고 현재 Nvidia와의 관계도 분석한다.

Terafab이

`Nvidia 즉시 대체`

인지,

`외부 공급업체와 병행하면서 장기적으로 자체 silicon 비중 확대`

인지 구분한다.

Terafab의 실제 투자규모, 일정, 기술적 난이도와 fab 수율 리스크도 포함한다.


# 19. Orbital AI Data Center

Musk가 장기적으로 orbital compute를 추진하는 이유를 분석한다.

단순히

“우주는 냉각하기 쉽다”

고 표현하지 않는다.

오히려 우주에서는 대류냉각이 불가능하므로 thermal radiation/radiator 문제가 중요하다.

가능한 장점은:

- 높은 태양광 utilization
- 지상 전력망 제약 회피
- 토지 문제 회피
- 일부 permitting 문제 회피
- Starship 발사능력 활용
- Starlink laser network 활용

등이다.

반대로 위험은:

- launch cost
- radiation
- maintenance
- replacement
- cooling/radiator mass
- latency
- networking
- repair difficulty
- orbital debris
- chip replacement cycle

등이다.

SpaceX가 제시하는 orbital compute 경제성이 현재 입증된 것인지 장기 목표인지 반드시 구분한다.


# 20. Colossus → Orbital Compute 연결

다음 가설을 평가한다.

현재:

terrestrial Colossus
→ AI compute 운영경험
→ 외부 고객 확보
→ 현금흐름
→ 대규모 cluster 기술 축적

병행:

Terafab
→ 자체 compute silicon 공급 확대

Starship
→ launch cost 감소

Starlink
→ orbital networking

장기:

orbital compute

이 구조가 SpaceX의 공식 전략과 어느 정도 일치하는지 확인한다.

다만

> “현재 Colossus 고객이 자동으로 미래 orbital compute 고객이 된다.”

고 단정하지 않는다.

Anthropic 등의 orbital compute 관심표명과 실제 장기 구매계약을 구분한다.


# 21. Colossus는 orbital DC의 전단계였는가?

중요한 결론 후보:

**아니다.**

Colossus가 처음 만들어진 시점의 직접 목적은 Grok/xAI 모델 경쟁이었다.

Orbital compute와 Terafab의 장기 비전을 나중에 Colossus의 원래 목적처럼 소급해서 설명하면 안 된다.

더 정확한 가능성은:

Grok 경쟁
→ Colossus 대규모 구축
→ compute infrastructure 능력 축적
→ AI compute shortage 및 외부 수요 발견
→ third-party monetization
→ compute infrastructure 사업 확대
→ Terafab/orbital compute와 장기적으로 연결

이다.

단, `외부 수요를 우연히 발견했다` 같은 심리적·경영적 인과는 직접 증거가 없다면 추론으로 표시한다.


# 22. SpaceX 주식의 성격

SpaceX라는 기업 자체의 사업 안정성과 SpaceX 주식의 투자위험을 구분한다.

기존 핵심 사업:

- launch
- Starlink
- satellite infrastructure

은 상대적으로 견고한 현금창출 기반일 수 있다.

반면 현재 막대한 자본이 투입되는:

- xAI
- Grok
- Colossus
- AI compute infrastructure
- Terafab
- orbital compute

는 훨씬 높은 불확실성을 가진다.

따라서 SpaceX 주식은 단순히 안정적인 우주·통신기업에 투자하는 것이 아니라

> **강한 기존 사업에서 발생하는 현금과 IPO 자본을 이용하여 초대형 AI infrastructure 프로젝트에 함께 베팅하는 투자**

라는 성격을 갖는지 평가한다.


# 23. 투자자의 Bull Case

다음 조건들이 성립하는 경우를 분석한다.

- AI compute demand가 계속 폭증
- 공급 증가보다 수요 증가가 빠름
- Colossus 높은 utilization 유지
- 높은 compute rental price 유지
- 빠른 CAPEX 회수
- xAI/Grok 경쟁력 개선
- agent economy 성장
- physical AI 성장
- Terafab 성공
- 자체 silicon 비용절감
- Starship launch cost 하락
- orbital compute 기술적 성공

이 경우 SpaceX는 단순 우주기업을 넘어

**launch + communications + AI + compute + semiconductor + physical AI infrastructure**

를 수직계열화한 기업이 될 가능성이 있다.


# 24. 투자자의 Bear Case

다음 조건들을 반드시 다룬다.

- AI compute demand 성장 둔화
- hyperscaler 데이터센터 대량 완공
- Anthropic/Google 등의 자체 capacity 확보
- Colossus 계약 종료
- utilization 감소
- rental price 하락
- GPU depreciation
- ASIC/TPU/Trainium 경쟁
- 모델 efficiency 향상
- xAI 자체 workload 부족
- Grok의 경쟁력 정체
- Terafab 기술/수율 실패
- orbital compute 경제성 실패
- Starship cost reduction 지연
- AI CAPEX가 Starlink/launch의 현금을 지속적으로 흡수

특히

**좋은 기존 사업 + 나쁜 capital allocation**

이 동시에 존재할 수 있다는 점을 평가한다.


# 25. 핵심 모니터링 지표

향후 SpaceX의 AI 전략을 평가할 때 다음을 우선적으로 추적한다.

1. Colossus 외부 utilization
2. 내부 xAI utilization
3. GPU당 compute rental price
4. 신규 compute 계약규모
5. 계약 termination 조건
6. Anthropic/Google 계약 유지 여부
7. 고객 집중도
8. 신규 고객 다양화
9. 신규 compute CAPEX
10. CAPEX payback period
11. MW당 구축비
12. 전력비
13. GPU depreciation
14. AI segment operating income
15. AI segment Adjusted EBITDA
16. AI free cash flow
17. 신규 GPU 세대 전환속도
18. $/token
19. Terafab CAPEX와 일정
20. Terafab 실제 수율
21. orbital compute prototype 일정
22. Starship kg당 launch cost
23. Grok/xAI 실제 사용량
24. agent workload 증가율
25. SpaceX 전체 CAPEX 중 AI 비중

특히 다음 신호를 경고지표로 평가한다.

> CAPEX payback period가 지속적으로 길어지는 현상

예:

<1년
→ 18개월
→ 2년
→ 3년

으로 늘어난다면 compute scarcity와 pricing power가 약해지고 있을 가능성이 있다.


# 26. 반드시 검증해야 할 숫자

기존 대화에서 다음 숫자들이 언급되었다.

모두 최신 공식자료 또는 신뢰도 높은 자료로 다시 검증한다.

- Colossus 최초 100K GPU 구축기간
- 200K GPU 확대기간
- 1M H100-equivalent 규모
- Anthropic 제공 GPU 수
- Anthropic 월 계약금액
- Anthropic termination clause
- Google 제공 GPU 수
- Google 월 계약금액
- Google termination clause
- SpaceX Q2 AI revenue
- SpaceX Q2 AI Adjusted EBITDA
- SpaceX Q2 AI operating income/loss
- SpaceX Q2 AI CAPEX
- 신규 cloud compute 계약금액
- 신규 compute CAPEX payback period
- SpaceX IPO 조달금액
- Terafab 초기 투자액
- Terafab 장기 예상 투자액
- SpaceX가 목표로 하는 compute GW
- Anthropic orbital compute 관련 interest
- orbital compute deployment 목표연도

숫자가 서로 다른 자료에서 다르면 차이가 발생하는 이유를 설명한다.


# 27. 원칙러 2차 검수

Main Agent가 초안을 완성하면 Agent A가 다시 검토한다.

각 항목을 다음 등급으로 평가한다.

- PASS
- PARTIAL
- FAIL

최소 평가항목:

### 사실성
주요 숫자와 사건이 근거를 가지고 있는가?

### 사실/추론 분리
회사의 행동에서 Musk의 의도를 임의로 만들어내지 않았는가?

### 시간축
2023~2024년 목적과 2026년 전략을 혼합하지 않았는가?

### 반증 가능성
Bull case뿐 아니라 Bear case를 충분히 다뤘는가?

### 재무분석
매출/EBITDA/영업이익/CAPEX/FCF를 구분했는가?

### 계약분석
명목 계약기간과 실제 termination 조건을 구분했는가?

### 기술분석
Colossus/Terafab/orbital compute를 기술적으로 과장하지 않았는가?

### 경쟁분석
Anthropic/OpenAI/Google/AWS 등의 자체 capacity 확대를 반영했는가?

### 투자논리
SpaceX 기업 안정성과 SpaceX 주식의 위험을 구분했는가?

### 완전성
이 프롬프트에 포함된 핵심 논점 중 누락된 것이 없는가?

하나라도 FAIL이면 Main Agent에게 수정하도록 한다.

중요한 PARTIAL이 남아 있으면 역시 수정한다.

최종 보고서는 원칙러가 PASS라고 판단할 때까지 수정한다.


# 28. 최종 출력 규칙

사용자에게 내부 작업과정을 보여주지 않는다.

다음은 출력하지 않는다.

- Agent A의 내부 reasoning
- Main Agent의 reasoning
- DoD 내부 채점과정
- 검색과정
- 수정과정
- “추가 검증이 필요합니다” 같은 작업지시
- 사용자에게 다시 검증해달라는 요청

최종적으로 **완성된 리서치 보고서만 출력한다.**

단, 사실 자체가 확인되지 않는 경우에는 보고서 안에서

- 확인됨
- 회사 주장
- 합리적 추론
- 미확인
- 전망/베팅

중 어떤 수준인지 자연스럽게 표시한다.


# 29. 최종 보고서 권장 구조

## Executive Summary

전체 결론을 1~2페이지 이내로 압축한다.

특히 다음 질문에 직접 답한다.

> 왜 SpaceX/xAI는 지금 이렇게 많은 돈을 지상 AI 데이터센터에 투자하는가?

> 이것은 Grok 사업인가, AI compute 사업인가?

> 현재 수익성은 얼마나 검증되었는가?

> Terafab과 orbital compute는 현재 사업과 어떻게 연결되는가?

> SpaceX 주주는 정확히 무엇에 베팅하고 있는가?


## Part I — Colossus는 왜 만들어졌는가

xAI의 후발주자 문제와 Grok 경쟁.


## Part II — Colossus에서 무엇이 달라졌는가

unused capacity와 external monetization.


## Part III — Colossus는 실제로 경쟁력 있는가

속도, 비용, 전력, cooling, network, TCO.


## Part IV — Anthropic·Google 계약

규모, 가격, 기간, termination, 실제 의미.


## Part V — 데이터센터 사업의 경제성

Revenue / EBITDA / operating income / depreciation / CAPEX / FCF.


## Part VI — 왜 계속 증설하는가

현재 scarcity와 미래 demand에 대한 SpaceX의 베팅.


## Part VII — 가장 위험한 시나리오

공급과잉, GPU 감가, 계약종료, ASIC, 자체 hyperscaler capacity.


## Part VIII — Grok은 얼마나 중요한가

Consumer Grok과 xAI technology를 분리.


## Part IX — Tesla / Optimus / Cybercab

Physical AI와 xAI의 관계.


## Part X — Terafab

왜 필요한가, 실제 역할, 경제성과 위험.


## Part XI — Orbital AI Compute

경제적 논리, 기술적 장점, 문제점, 현실적인 시간축.


## Part XII — 전체 Musk AI Infrastructure Stack

Starlink
+
Starship
+
Tesla
+
xAI
+
Colossus
+
Terafab
+
Orbital Compute

각각의 역할과 연결관계를 설명한다.


## Part XIII — Bull vs Bear

가능하면 동일한 기준으로 양쪽 시나리오를 비교한다.


## Part XIV — SpaceX 투자자가 실제로 사고 있는 것

SpaceX의 기존 사업가치와 AI infrastructure option을 분리하여 설명한다.


## Part XV — 향후 반드시 볼 지표

투자 thesis가 맞는지 틀리는지 판단할 leading indicators를 제시한다.


# 30. 최종 결론에서 반드시 답할 질문

최종 보고서는 최소한 다음 질문에 명확하게 답해야 한다.

1. Colossus는 원래 Grok을 위해 만들어졌는가?
2. 왜 Grok이 모든 compute를 쓰지 못하는가?
3. 왜 남는 compute를 경쟁사에게 임대하는가?
4. 왜 경쟁사들이 SpaceX/xAI의 compute를 사용하는가?
5. 그들이 자체 데이터센터를 완성하면 Colossus를 떠날 가능성은 얼마나 되는가?
6. Colossus의 실제 경쟁력은 무엇인가?
7. 경쟁사 대비 비용우위가 정말 검증되었는가?
8. GPU의 빠른 감가상각에도 불구하고 왜 지금 증설하는가?
9. 현재 높은 compute 가격은 얼마나 지속가능한가?
10. SpaceX가 가장 크게 베팅하는 미래 가정은 무엇인가?
11. AI compute가 공급과잉이 되면 어떤 일이 발생하는가?
12. Grok이 ChatGPT보다 약해도 Musk의 전체 전략은 가능한가?
13. Grok 소비자 점유율과 xAI 기술력 중 무엇이 더 중요한가?
14. Tesla/Optimus/Cybercab과 xAI는 실제로 어떻게 연결될 수 있는가?
15. Terafab은 왜 필요한가?
16. Terafab이 Nvidia를 대체하려는 것인가?
17. orbital compute가 필요한 진짜 이유는 무엇인가?
18. orbital compute는 현실적으로 언제 경제성을 가질 수 있는가?
19. Colossus→Terafab→orbital compute라는 연결은 실제 회사 전략인가, 사후적 해석인가?
20. 현재 AI 사업은 실제로 돈을 벌고 있는가?
21. Adjusted EBITDA와 감가상각 후 수익성은 얼마나 다른가?
22. SpaceX의 기존 사업은 AI CAPEX 위험을 얼마나 흡수할 수 있는가?
23. AI 투자 실패가 SpaceX 전체에 어느 정도 영향을 줄 수 있는가?
24. 현재 SpaceX 주식은 안정적 우주기업 투자에 가까운가, 고위험 AI infrastructure 투자에 가까운가?
25. 현재 valuation은 이 미래 성공을 얼마나 선반영하고 있는가?


# 31. 최종 분석 원칙

보고서를 읽은 사람이 다음 두 극단 중 어느 쪽으로도 유도되어서는 안 된다.

### 잘못된 낙관

“AI 수요는 무조건 폭증하므로 SpaceX 데이터센터는 성공한다.”

### 잘못된 비관

“Grok이 ChatGPT보다 약하므로 SpaceX의 AI 투자는 실패한다.”

대신 다음 구조를 유지한다.

**확인된 사실**

↓

**현재 경제성**

↓

**SpaceX 경영진의 판단**

↓

**그 판단에 필요한 핵심 가정**

↓

**가정이 맞았을 때의 결과**

vs

**가정이 틀렸을 때의 결과**

↓

**현재 valuation이 어느 정도 성공을 요구하는지**

최종 목적은 Elon Musk의 미래상을 홍보하거나 반박하는 것이 아니라,

> **SpaceX가 왜 현재 이런 자본배분을 하고 있는지, 그 전략이 어떤 조건에서 합리적이며 어떤 조건에서 대규모 자본파괴로 변할 수 있는지를 객관적으로 설명하는 것**

이다.