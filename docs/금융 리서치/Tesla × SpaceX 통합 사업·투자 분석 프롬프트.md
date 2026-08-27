# Tesla × SpaceX 통합 사업·투자 분석 보고서 작성 프롬프트

아래 내용은 Tesla와 SpaceX의 현재 사업, 신규 투자, 기술적 확장, 자본배분, Elon Musk의 지배구조와 양사의 관계를 장기간에 걸쳐 논의하면서 정리한 통합 브리프다.

이 내용을 **대화의 히스토리로 재현하지 말고**, 하나의 독립적인 기업·산업 분석 보고서로 재구성하라.

보고서는 단순 사업 소개가 아니라 다음 질문에 답하는 구조여야 한다.

- Tesla와 SpaceX는 현재 무엇으로 돈을 벌고 있는가?
- 각 회사의 기존 사업은 얼마나 안정적이며 경쟁자가 대체하기 어려운가?
- 지금 진행 중인 대규모 R&D와 CAPEX는 기존 사업과 어떻게 연결되는가?
- Tesla의 Robotaxi·Optimus·AI 투자는 기존 사업의 자연스러운 확장인가?
- SpaceX의 xAI·Colossus·Starship·Terafab·장기 우주 데이터센터 투자는 기존 사업과 얼마나 멀리 떨어진 베팅인가?
- Tesla와 SpaceX의 위험 구조는 어떻게 다른가?
- Elon Musk의 양사 지분율과 의결권 차이가 사업 및 자본배분의 성격에 어떤 영향을 미치는가?
- Tesla와 SpaceX를 하나의 Musk 산업 생태계로 보면 서로 어떤 자산과 기술을 공유하거나 보완하는가?

세계적인 친환경 정책 변화, 지정학적 파편화, EV 전체 시장 전망 같은 거시적인 논점은 보조적으로만 다루고, **Tesla와 SpaceX라는 두 회사 자체의 사업구조와 경쟁력에 집중**하라.

---

# 1. Tesla 최근 주가 부진에 대한 기본 해석

Tesla의 최근 주가 부진을 단순히 “자동차가 안 팔려서”라고 설명해서는 안 된다.

2026년 Q2에는 Tesla 차량 인도량이 약 48만 대 수준으로 크게 회복되었고 매출도 증가했다. 자동차 판매 자체가 붕괴한 것은 아니다.

문제는 매출 증가가 이익 증가로 연결되지 않았다는 것이다.

대화 당시 사용한 주요 수치는 대략 다음과 같다.

- Q2 매출 약 $28.2B
- 전년 대비 매출 약 +26%
- 영업이익 약 $0.4B
- 영업이익률 약 1.4%
- 전년 동기 영업이익률 약 4.1%
- R&D 약 $2.37B, 전년 대비 약 +49%
- Q2 CAPEX 약 $5.8B
- 2026년 연간 CAPEX 전망 $25B 이상
- Q2 Free Cash Flow 약 -$1.1B

따라서 최근 Tesla 주가가 받는 압력은 크게 다음 구조로 이해한다.

**자동차 사업 안정화**
→ 그러나 자동차만으로 현재 Tesla의 높은 기업가치를 설명하기 어려움
→ FSD / Robotaxi / Optimus / AI가 미래 가치의 상당 부분을 차지
→ 이를 위한 R&D와 CAPEX 급증
→ 단기 영업이익 및 FCF 악화
→ 시장이 미래 사업의 실제 수익화 속도를 더욱 엄격하게 요구
→ 높은 valuation에 대한 재평가

중요한 회계적 구분도 유지한다.

**R&D, 인건비, 초기 생산 ramp 비용 등은 영업비용으로 영업이익을 직접 감소시킨다.**

반면 공장, 데이터센터, 장비 등에 사용되는 **CAPEX는 지출 즉시 전액 영업비용으로 처리되는 것이 아니다.**

CAPEX는 먼저 현금을 소모해 Free Cash Flow를 압박하며, 이후 감가상각 등의 형태로 여러 기간에 걸쳐 손익에 반영된다.

따라서 Tesla 문제를 단순히

“CAPEX 증가 → 영업이익 감소”

라고 표현하지 말고,

**R&D 및 신규사업 운영비 증가 → 현재 영업이익 압박**

와

**CAPEX 증가 → 현재 현금흐름 압박 + 향후 감가상각 부담**

으로 구분한다.

---

# 2. Tesla 자동차 사업은 이미 실체가 있는 코어 사업이다

Tesla 자동차 사업을 초기 EV 스타트업처럼 취급하면 안 된다.

Tesla는 이미 수백만 대 규모의 차량을 판매했고, 대화 당시 약 970만 대 수준의 누적 설치기반(installed base)이 있는 것으로 다뤘다.

자동차 사업은 여전히 경쟁 산업이다.

Tesla는 BYD, 현대·기아, BMW, Mercedes-Benz, 중국 EV 업체 및 기존 자동차 기업과 경쟁할 수밖에 없으며, SpaceX의 국가안보 발사체 사업처럼 경쟁자가 극도로 제한된 산업은 아니다.

따라서 Tesla 자동차 사업 자체를 “대체불가능”이라고 표현해서는 안 된다.

그러나 Tesla의 경쟁력을 단순한 EV 하드웨어로 평가해서도 안 된다.

Tesla는 다음 요소를 수직 통합했다.

**차량 하드웨어**
+ **Tesla 자체 소프트웨어/UI**
+ **OTA**
+ **Tesla App**
+ **Supercharger**
+ **FSD**
+ **차량 데이터**
+ **AI 학습**
+ **서비스 및 향후 각종 구독**

이 때문에 Tesla 자동차는 전통 자동차보다 훨씬 강한 connected platform 성격을 가진다.

---

# 3. Tesla를 단순 자동차 판매량이 아니라 Installed Base 관점에서 분석한다

Tesla 차량 한 대 판매를 일회성 자동차 매출로만 보지 않는다.

Tesla가 궁극적으로 원하는 구조는 다음과 같다.

**Tesla 차량 판매**
→ Tesla 계정 및 App
→ OTA
→ FSD subscription
→ Premium Connectivity / 충전 / 보험 / 서비스
→ 지속적인 주행 데이터 발생
→ AI 학습
→ FSD 성능 개선
→ 소프트웨어 가치 증가
→ 고객 LTV 증가
→ 다음 Tesla 구매 유인 증가

따라서 자동차 한 대는 장기적으로 **소프트웨어와 서비스를 판매할 수 있는 설치기반** 역할을 할 수 있다.

대화 당시 언급된 수치는 다음과 같다.

- 누적 Tesla 차량 약 970만 대
- Active FSD 약 148만
- 북미 신규 차량의 FSD 선택률 약 55% 이상
- FSD가 미국에서 월 $99 구독 중심 구조로 전환
- Services & Other 매출 Q2 약 $4.58B
- Services & Other 매출 전년 대비 약 +50%
- Services gross profit 약 $648M 수준

이런 숫자는 Tesla가 완전히 자동차 하드웨어 판매만으로 돈을 버는 기업이 아니라는 근거로 사용한다.

향후 Tesla를 평가할 때 단순 분기 차량 인도량 외에도 다음과 같은 개념을 중요하게 다룬다.

Installed Base

FSD attach rate

Active FSD

FSD churn

구독 ARPU

Services revenue 및 gross profit

고객 재구매율

차량당 Lifetime Value

Robotaxi paid miles

자동차 gross margin

---

# 4. Tesla의 Lock-in은 존재하지만 Apple 수준이라고 보기는 아직 어렵다

Tesla 생태계를 Apple과 비교할 수는 있지만 동일시해서는 안 된다.

Apple 사용자가 iPhone에서 Android로 이동할 경우 다음과 같은 생태계 전체의 이전비용이 발생한다.

iCloud

Apple Watch

AirPods

Apple Pay

앱 구매

사진

메시지

가족 계정

기타 Apple 서비스

반면 Tesla 운전자가 BMW, Mercedes, Hyundai, BYD 등 다른 자동차로 이동한다고 해서 개인의 전체 디지털 생활이 파괴되지는 않는다.

따라서 현재 Tesla는

**Apple급 폐쇄형 Lock-in 플랫폼**

이라기보다는

**자동차 산업에서 매우 강력한 connected-car platform**

이라고 평가하는 것이 적절하다.

Tesla가 향후 FSD, 보험, 에너지, 충전, Robotaxi, 차량 내 AI 등을 더욱 깊게 묶으면 Lock-in은 강화될 수 있다.

고객 충성도 역시 양면적으로 평가한다.

과거 Tesla의 브랜드 충성도가 매우 높은 수준이었던 것은 사실이지만 Musk 정치행보와 경쟁 EV 증가 등의 영향으로 일부 기간 충성도가 상당히 떨어졌다.

그러나 동시에 자동차 업계 전체에서 보면 Tesla가 여전히 매우 높은 재구매율과 경쟁사 고객 유입 능력을 보이는 지표도 존재했다.

따라서

“Tesla 고객은 절대 다른 차로 가지 않는다”

도 틀리고,

“Tesla 고객 충성도가 무너졌다”

도 과도하다.

가장 적절한 표현은

**과거 압도적인 수준에서는 약화됐지만 자동차 산업에서는 여전히 강한 브랜드 충성도와 생태계 효과를 가지고 있다**

이다.

---

# 5. Tesla의 가장 중요한 Flywheel은 데이터와 AI다

Tesla 생태계의 핵심 강점을 단순 Lock-in보다 다음의 Data Flywheel에서 찾는다.

**차량 증가**
→ 실제 도로 주행 데이터 증가
→ FSD 학습 데이터 증가
→ Cortex에서 AI 모델 학습
→ FSD 성능 개선
→ FSD 구독 가치 증가
→ FSD 사용자 증가
→ Tesla 차량 구매 유인 증가
→ 차량 증가

즉 Tesla 사용자는 단순히 제품을 구매하는 소비자뿐 아니라 Tesla AI를 개선하는 실제 환경 데이터를 생산하는 분산형 edge network이기도 하다.

이 점이 단순 자동차 회사나 Apple 생태계와도 다른 Tesla의 중요한 특성이다.

---

# 6. Cortex 데이터센터는 일반 데이터센터 사업과 구분한다

Tesla의 Cortex 1과 Cortex 2는 계획상 데이터센터가 아니라 이미 실제 AI 학습에 사용하는 내부 컴퓨팅 인프라로 다뤘다.

대화에서 사용한 규모는 대략

- Cortex 1: 90MW 이상
- Cortex 2: 115MW 이상

수준이다.

Tesla Cortex의 고객은 외부 클라우드 고객이 아니라 사실상 Tesla 자신이다.

따라서 일반 데이터센터 사업처럼

“대형 고객이 계약을 종료해서 건물이 놀게 되는 위험”

이 핵심은 아니다.

Tesla Cortex의 경제적 위험은 오히려 다음과 같다.

**막대한 AI compute 투자**
→ FSD / Robotaxi / Optimus 성능 향상
→ 실제 구독 및 노동대체 수익 증가

이 연결이 충분히 빠르고 크게 발생하느냐가 핵심이다.

즉 Tesla 데이터센터는

**데이터센터 임대산업의 utilization risk**

보다는

**AI R&D 투자 회수 risk**

가 본질적이다.

---

# 7. Robotaxi는 이미 실체가 있지만 아직 세 가지 병목이 존재한다

Tesla Robotaxi를 “아직 존재하지 않는 사업”으로 취급해서는 안 된다.

일부 지역에서는 실제 유료 서비스와 무인운행이 시작된 상태로 다뤘다.

그러나 Robotaxi가 이미 완성된 기술이고 법만 해결하면 된다는 식으로 평가해서도 안 된다.

현재 병목은 세 가지가 동시에 존재한다.

**기술·안전 검증**

**Fleet 운영 및 서비스 확장**

**법·규제**

지역별 차이도 중요하다.

California 같은 지역에서는 규제와 허가가 매우 큰 병목이다.

반면 Texas처럼 규제 장벽이 상대적으로 낮은 지역에서도 차량 수, 서비스 범위, 대기시간, 안전성 검증, teleoperation, 충전·정비·청소 등 fleet operation 문제가 존재한다.

따라서

**Robotaxi = 규제만 풀리면 즉시 폭발적으로 확대되는 사업**

이라고 보면 지나치게 낙관적이다.

또한 Tesla는 과거 Musk가 제시했던 Robotaxi 확대 속도보다 실제 확대가 느리게 진행되는 모습을 보였으며, 이것이 최근 Tesla valuation 재평가에 영향을 준 중요한 요인 가운데 하나다.

---

# 8. Optimus는 세계 최상위 휴머노이드 후보지만 이미 완전히 검증된 제품은 아니다

Optimus의 기술을 지나치게 낮게 평가해서는 안 된다.

Tesla가 Optimus에서 노리는 핵심은 단순 보행 로봇이 아니다.

사람의 생활환경과 작업환경에서 사용할 수 있는

**고자유도 인간형 손**

**촉각 센싱**

**섬세한 manipulation**

**AI vision**

**자율 행동**

을 결합한 범용 휴머노이드다.

따라서 Optimus는 현재 세계적인 dexterous humanoid 경쟁의 최상위권 후보군에 포함하는 것이 적절하다.

다만

“세계에서 가장 섬세한 로봇으로 객관적인 1위가 확정됐다”

고 단정하지 않는다.

Figure의 휴머노이드와 Boston Dynamics Atlas 등도 매우 높은 수준의 manipulation, tactile sensing, 전신 제어 능력을 보여주고 있다.

현재 Optimus의 위험은 처음 공개됐던 시절의

“Tesla가 실제 휴머노이드 로봇을 만들 수 있는가?”

에서 점차

“좋은 휴머노이드를 실제 산업제품으로 만들 수 있는가?”

쪽으로 이동하고 있다고 평가한다.

남은 핵심 문제는 다음과 같다.

장시간 작업 신뢰성

실제 산업·가정환경에서의 실패율

부품 수명

안전성

대량생산 수율

제조원가

유지보수 비용

인간 노동 대비 경제성

외부 고객의 대규모 구매 의사

Tesla는 자동차 대량생산 과정에서 확보한 모터, 배터리, power electronics, 컴퓨터비전, inference, 제조 자동화 등의 역량을 Optimus에 상당 부분 재사용할 수 있다.

따라서 Optimus는 Tesla 본업과 동떨어진 프로젝트가 아니라 **Tesla의 기존 기술 스택을 Physical AI로 확장하는 사업**으로 본다.

---

# 9. Tesla의 미래 사업은 대체로 기존 사업의 “인접 확장”이다

Tesla 신규 R&D를 하나의 구조로 보면 다음과 같다.

**자동차**
→ 운전자 보조
→ FSD
→ Robotaxi
→ Cybercab

그리고

**자동차 대량생산**
→ motor
→ actuator
→ battery
→ electronics
→ Optimus

그리고

**수백만 대 차량**
→ 실제 데이터
→ Cortex
→ AI 학습
→ FSD / Robotaxi / Optimus

그리고 장기적으로

**자체 AI chip 및 semiconductor**
→ 차량
→ Robotaxi
→ Optimus

로 연결된다.

따라서 Tesla가 현재 막대한 R&D와 CAPEX를 사용하고 있기는 하지만, 대부분 기존 Tesla가 이미 가지고 있는 역량에서 한두 단계 옆으로 확장하는 프로젝트다.

이 점이 SpaceX의 신규 프로젝트와 가장 큰 차이다.

---

# 10. Terafab과 Tesla 데이터센터는 현재 진행 단계를 구분한다

Terafab 때문에 Tesla CAPEX가 전부 증가했다고 해석해서는 안 된다.

2026년 Tesla의 높은 CAPEX에는 여러 사업이 포함된다.

Cortex 데이터센터

AI compute

Cybercab 생산라인

Optimus 생산설비

배터리 및 에너지 시설

충전망

반도체 관련 시설

기타 공장 및 생산설비

Terafab

등이다.

Cortex는 이미 현실의 운영 자산이다.

Tesla의 semiconductor research fab 역시 건설 및 장비조달 단계로 다뤘다.

반면 Tesla와 SpaceX가 추진하는 대규모 Terafab은 프로젝트가 공식화되고 초기 실행단계에 들어갔지만, 대규모 반도체 생산이 이미 이루어지는 시설은 아니다.

대화에서 사용한 Terafab 1단계 투자규모는 약 $16.8B다.

Terafab의 목적은 단순 logic chip 공장 하나가 아니라 장기적으로

Logic

Memory

Advanced Packaging

Testing

을 수직 통합하려는 것이다.

Tesla와 SpaceX가 각각 필요로 하는 AI·로봇·자동차·데이터센터용 반도체 공급망을 더 직접적으로 통제하려는 성격으로 해석한다.

Tesla와 SpaceX 각각이 정확히 얼마를 부담할지는 분리해서 생각해야 하며, $16.8B 전체를 Tesla CAPEX라고 계산해서는 안 된다.

---

# 11. SpaceX의 기존 핵심사업은 Tesla보다 더 강한 해자를 가지고 있다

SpaceX를 고위험 회사라고 표현할 때 기존 사업과 신규 사업을 반드시 분리한다.

현재 SpaceX의 핵심 사업은 매우 강하다.

**Starlink**

**Starshield**

**Falcon 9**

**Dragon**

**NASA 및 미국 정부·국방 발사**

등은 이미 실체가 있는 사업이다.

특히 발사체와 국가안보 위성통신 사업은 일반 소비재보다 사업자 변경비용과 진입장벽이 훨씬 높다.

Tesla 자동차 고객은 가격, 디자인, 브랜드, 기능 등에 따라 BYD나 BMW나 Hyundai 등으로 옮길 수 있다.

반면 국가안보 발사 사업자는

발사 신뢰성

발사빈도

payload integration

보안

궤도투입 능력

재사용 운용 경험

정부 인증

등이 필요하기 때문에 단기간에 대체하기 어렵다.

따라서 **현재 기존사업의 해자만 비교하면 SpaceX가 Tesla보다 더 강하다**고 평가한다.

---

# 12. 그러나 SpaceX 사업의 성장이 “보장”된 것은 아니다

SpaceX가 미국 국가안보에 매우 중요한 기업이라는 사실을

“SpaceX 매출과 이익은 앞으로 계속 증가할 수밖에 없다”

로 확대해석해서는 안 된다.

미국 정부는 오히려 SpaceX에 지나치게 의존하는 위험을 피하기 위해

ULA

Blue Origin

Rocket Lab

기타 발사기업

을 지속적으로 육성하고 있다.

국가안보에서는 single point of failure를 피해야 하기 때문이다.

따라서 SpaceX는

**매우 강력한 전략자산이고 생존 위험을 크게 줄여주는 정부·국방 수요를 가지고 있다**

고 평가할 수 있지만,

**절대 대체불가능하고 실적 성장이 보장된 기업**

이라고 표현하지 않는다.

---

# 13. SpaceX는 강력한 코어사업을 기반으로 훨씬 더 공격적인 신규 사업을 추진한다

SpaceX의 신규 확장은 Tesla보다 기술적·자본적 점프가 훨씬 크다.

현재 논의한 연결관계는 다음과 같다.

**Starlink**
→ 글로벌 통신망
→ AI network 활용 가능성

**xAI / Grok**
→ AI 모델 및 서비스

**Colossus 계열 AI 데이터센터**
→ 자체 AI 학습
→ 외부 compute 공급

**Starship**
→ 초대형·저비용 우주운송망

**Terafab**
→ 대규모 AI semiconductor 공급망

그리고 장기적으로

**Starship + Starlink + 자체 반도체 + 태양광 발전 + 우주 인프라**
→ **Orbital AI Data Center**

라는 방향이다.

Colossus와 같은 지상 데이터센터는 이미 현실의 인프라이며 외부 고객을 통한 수익화 가능성이 존재한다.

그러나 외부 AI compute 사업은 다음 위험이 있다.

GPU 투자비

빠른 세대교체와 감가상각

대규모 전력비

장기 고객계약 유지

utilization

AI compute 가격 하락

경쟁 데이터센터 증설

즉 Tesla Cortex와 달리 SpaceX/xAI의 데이터센터는 내부 AI R&D 뿐 아니라 **데이터센터 사업자 자체의 경제성 위험**도 갖는다.

---

# 14. SpaceX의 우주 데이터센터는 기존 SpaceX 신규사업 중에서도 훨씬 더 높은 위험 단계다

우주 데이터센터를 Colossus와 같은 수준의 현재 사업으로 취급하지 않는다.

지상 데이터센터는 이미 현실이다.

반면 대규모 orbital AI data center는 장기 비전이다.

이 사업은 여러 전제가 동시에 성립해야 한다.

Starship 완전재사용

매우 낮은 kg당 발사비

대규모 우주 전력 공급

열 방출 및 냉각

방사선 대응

우주에서의 유지보수

통신 지연 및 bandwidth

반도체 교체

경제적인 수명

지상 데이터센터 대비 총비용 경쟁력

따라서 SpaceX 신규사업의 가장 큰 특징은

**사업들끼리 강하게 연결되어 있는 동시에 전 단계가 실패하면 후속사업의 경제성도 영향을 받는 dependency risk가 크다**

는 것이다.

---

# 15. Tesla와 SpaceX를 비교하면 기존사업과 미래사업의 위험도가 반대로 나타난다

기존 핵심사업의 해자:

**SpaceX > Tesla**

SpaceX의 발사·Starlink·국가안보 사업은 경쟁자 진입 및 대체 난이도가 Tesla 자동차보다 높다.

반면 신규 사업이 기존 사업과 얼마나 가까운지를 비교하면:

**Tesla > SpaceX**

Tesla:

EV
→ FSD
→ Robotaxi

자동차 제조
→ Optimus

차량 데이터
→ Cortex

Cortex
→ Physical AI

라는 비교적 가까운 확장이다.

SpaceX:

Starlink
→ AI

Falcon
→ Starship

Starship
→ 초저가 대량 우주운송

AI DC
→ Orbital DC

반도체 구매
→ Terafab

이라는 훨씬 큰 기술 점프가 포함된다.

따라서 가장 적절한 요약은 다음과 같다.

**Tesla는 성공한 현실 사업 위에서 상당히 위험한 인접 신사업을 추진하는 기업이다.**

**SpaceX는 매우 강력하고 대체하기 어려운 현실 사업 위에서 극단적으로 위험하고 장기적인 frontier 사업을 동시에 추진하는 기업이다.**

---

# 16. 기업 생존 위험과 투자수익 위험은 구분한다

SpaceX의 신규사업이 Tesla보다 공격적이라고 해서 SpaceX라는 회사가 쉽게 망한다는 뜻은 아니다.

Starlink, 정부·국방 사업, 발사체 사업이라는 강력한 현금창출 기반이 있다.

대화에서는 SpaceX가 매우 큰 현금 및 유동성 완충장치를 가지고 있는 것으로 평가했다.

따라서 두 회사 모두 **기업 자체가 사라질 위험**과 **현재 valuation을 정당화할 미래 수익을 만들어내지 못할 위험**을 구분한다.

SpaceX는 생존력은 매우 강하지만 신규 프로젝트 자본배분의 불확실성이 매우 크다.

Tesla 역시 자동차·에너지·서비스라는 실체가 있지만 Robotaxi·Optimus·AI에 부여된 valuation을 실제 이익으로 전환할 수 있느냐는 별도의 문제다.

---

# 17. Elon Musk의 Tesla와 SpaceX 지배력 차이는 매우 중요하다

대화 당시 사용한 최신 공시 기준으로 Musk의 Tesla beneficial ownership은 약 **19.9%** 수준이었다.

반면 SpaceX에서는 Class B의 복수의결권 구조를 통해 약 **82.4% 수준의 voting power**를 유지하는 것으로 다뤘다.

이 차이는 양사의 자본배분 성격을 이해할 때 중요하다.

Tesla에서는 Musk가 엄청난 영향력을 갖지만

과반 지분이 아니고,

일반적인 공개시장 감시,

이사회,

기관투자자,

일반주주,

관련자거래 규제,

시장 valuation

등의 제약을 동시에 받는다.

따라서 Tesla의 대규모 신규투자는 기존 Tesla 사업과 어떤 시너지가 있는지 설명할 필요가 상대적으로 크다.

반면 SpaceX에서는 Musk의 의결권 지배력이 압도적이기 때문에 훨씬 장기간에 걸쳐 낮은 초기 ROI와 극단적인 기술위험을 감수하는 프로젝트를 추진하기 쉽다.

이 차이는 SpaceX가 Falcon 재사용과 같은 당시에는 비현실적으로 보이던 기술을 장기간 밀어붙일 수 있었던 이유 중 하나일 수 있다.

동시에 Mars, Starship, 우주 데이터센터 등 엄청난 자본을 필요로 하는 프로젝트에 오랫동안 자금을 투입할 수 있는 위험요인이기도 하다.

따라서

**Tesla 신규사업이 상대적으로 현실적이고 기존사업 인접성이 높은 이유가 Musk 지분율이 낮기 때문이다**

라고 단일 원인으로 설명하지 않는다.

더 정확한 구조는 다음과 같다.

Musk 지배력 차이
+
Tesla의 상장사 구조
+
Tesla 기존 고객 및 자동차 사업
+
Tesla 이사회와 공개시장 감시
+
Tesla가 이미 보유한 기술과 신규사업의 높은 인접성

이 함께 작용한다.

---

# 18. Tesla와 SpaceX는 독립회사지만 점차 더 많은 연결부를 가진다

두 회사를 하나의 기업처럼 취급해서는 안 된다.

Tesla와 SpaceX는 별도의 법인이고 각 회사 주주의 이해관계도 다르다.

그러나 Musk 생태계 관점에서는 점차 기술적·재무적·물리적 접점이 늘어나고 있다.

대화에서 다룬 주요 연결은 다음과 같다.

### Tesla의 SpaceX 지분투자

Tesla가 SpaceX 지분에 약 $2B를 투자한 것으로 다뤘다.

이는 Tesla 자체 공장에 사용하는 CAPEX와 별개의 투자활동이다.

### Tesla 제품의 SpaceX 공급

SpaceX가 Tesla의 Megapack 및 일부 Tesla 제품을 구매하는 관련자거래가 존재한다.

대화 당시 Tesla가 SpaceX 관련 Megapack 거래에서 Q2 약 $318M 수준의 매출을 인식한 것으로 다뤘다.

### Grok과 Tesla

Tesla 차량 소프트웨어에 Grok 기능이 통합되면서 xAI와 Tesla 차량 플랫폼 사이에도 접점이 생긴다.

### Terafab

Tesla와 SpaceX가 동시에 필요한 대규모 AI 및 physical-AI semiconductor 공급망을 공동으로 수직 통합하려는 핵심 접점이다.

Tesla 측 수요:

차량

FSD inference

Cybercab

Optimus

향후 AI chip

SpaceX/xAI 측 수요:

Colossus

Grok

대규모 AI compute

장기적으로는 우주 AI compute

따라서 Terafab은 Musk 생태계에서 **Tesla의 Physical AI와 SpaceX/xAI의 대규모 AI compute가 만나는 물리적 공급망 노드**라고 해석할 수 있다.

---

# 19. 최종적인 Tesla 사업 프레임

Tesla는 더 이상 다음 하나로 평가하지 않는다.

“EV 회사”

대신 다음과 같이 본다.

**EV 제조**
+
**Connected Vehicle Platform**
+
**FSD Subscription**
+
**Robotaxi Network**
+
**AI Training Infrastructure**
+
**Physical AI**
+
**Optimus**
+
**Energy**
+
**향후 Semiconductor Vertical Integration**

Tesla의 미래가치는 자동차 판매량 자체보다 차량 설치기반을 얼마나 고마진 소프트웨어·AI·서비스 매출로 전환할 수 있는지가 더욱 중요해질 가능성이 있다.

따라서 Tesla 장기 분석의 핵심 질문은

**자동차를 얼마나 많이 파느냐**

에서 점차

**한 명의 Tesla 고객과 한 대의 Tesla 차량이 수명 전체에서 얼마의 경제적 가치를 만들어내느냐**

로 이동해야 한다.

---

# 20. 최종적인 SpaceX 사업 프레임

SpaceX 역시 단순 발사체 회사로 평가하지 않는다.

현재 사업:

**Falcon / Dragon**
+
**Starlink**
+
**Starshield**
+
**NASA / 상업 / 국방**

미래 확장:

**Starship**
+
**xAI / Grok**
+
**Colossus 및 대규모 AI Compute**
+
**Terafab**
+
**장기 Orbital Compute**

SpaceX의 강점은 이미 현재 사업에서 강력한 진입장벽과 전략적 중요성을 확보했다는 것이다.

위험은 그 현재 사업에서 발생하는 자본과 기술력을 매우 많은 미래 프로젝트에 동시에 투입하고 있다는 것이다.

따라서 SpaceX는

**코어사업의 위험은 Tesla보다 낮을 수 있지만, 신규 자본배분 위험은 Tesla보다 훨씬 높을 수 있는 기업**

으로 본다.

---

# 21. 두 회사를 한 문장씩 정의한다

Tesla:

**“대규모 차량 설치기반과 제조·AI 역량을 이용해 자동차에서 Physical AI 플랫폼으로 확장하는 회사.”**

SpaceX:

**“발사체와 Starlink라는 독보적인 우주 인프라를 기반으로 AI·초대형 우주운송·반도체·장기 우주컴퓨팅까지 확장하려는 회사.”**

두 회사를 비교한 핵심 문장:

**“SpaceX는 기존사업의 해자가 더 강하지만 미래사업의 기술·자본 위험도 훨씬 높고, Tesla는 기존사업의 경쟁위험은 더 크지만 미래사업이 기존 Tesla 기술과 훨씬 가깝게 연결돼 있다.”**

Elon Musk의 지배구조까지 포함한 핵심 문장:

**“SpaceX는 Musk가 사실상 지배하는 장기 기술제국에 가깝고, Tesla는 Musk가 강하게 이끌지만 공개시장·이사회·기존 고객·사업모델에 훨씬 더 구속된 Physical AI 플랫폼에 가깝다.”**

---

# 보고서 작성 방식

위 통합 브리프를 기반으로 하나의 완성된 기업·투자 분석 보고서를 작성하라.

대화 내용을 순서대로 요약하지 말고 논리적으로 재구성한다.

보고서는 최소한 다음 흐름이 자연스럽게 연결되도록 한다.

**Tesla 기존 사업 → Tesla 생태계 → FSD/Robotaxi → Optimus → Cortex → CAPEX와 수익화 → SpaceX 기존 사업 → SpaceX 신규 AI/Starship 투자 → Terafab → Musk 지배구조 → Tesla/SpaceX 연결 → 상대적 위험도 → 장기 투자 관점**

특히 다음과 같은 단순화는 피한다.

“Tesla는 자동차 회사다.”

“Tesla 소프트웨어는 완전히 대체불가능하다.”

“Tesla 고객은 Apple처럼 절대 이탈하지 않는다.”

“Robotaxi는 규제만 풀리면 완성된다.”

“Optimus는 이미 세계 최고의 완성형 로봇이다.”

“Tesla의 CAPEX가 전부 당기 영업이익을 감소시킨다.”

“Terafab 때문에 현재 Tesla CAPEX가 전부 증가했다.”

“SpaceX는 국가안보 기업이므로 절대 경쟁받지 않고 성장이 보장된다.”

“SpaceX가 위험하므로 회사 자체가 쉽게 파산할 수 있다.”

“Tesla의 신규사업이 현실적인 이유는 Musk의 낮은 지분율 하나뿐이다.”

최종 보고서는 특정 회사를 옹호하거나 비판하기보다 **현재 돈을 버는 사업, 신규 사업의 인접성, 기술 위험, 자본 위험, 규제 위험, 현금흐름, 장기 수익화 가능성을 분리해서 설명​**한다.

마지막에는 Tesla와 SpaceX 각각에 대해 다음 세 요소를 명확하게 정리한다.

**현재 확실성이 높은 가치**

**아직 미래 기대에 의존하는 가치**

**투자자가 가장 주의해서 관찰해야 할 사업화 병목**

전체 글은 금융·기술에 관심 있는 일반 투자자가 이해할 수 있을 정도로 쉽게 쓰되, 기업분석 보고서로 장기 보관할 수 있을 정도로 논리적이고 상세하게 작성한다.