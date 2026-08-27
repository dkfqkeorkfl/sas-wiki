---
id: "01a04241-ce57-7548-9765-9d9d8ccdc0d5"
title: Anthropic
type: company
status: active
aliases: ["안트로픽", "Claude", "클로드"]
tags: ["AI인프라", "LLM", "데이터센터", "클라우드", "비상장", "IPO"]
meta:
  ticker: null
  sector: "AI/소프트웨어"
  exchange: null
---

## 개요

Anthropic은 2021년 설립된 미국의 AI 연구·개발 기업으로, 대화형 AI 모델 Claude 시리즈와 개발자용 코딩 에이전트 Claude Code를 만든다. 창업자는 Dario Amodei(CEO)·Daniela Amodei(President) 남매를 포함한 전직 OpenAI 연구진이다. 본사는 미국 샌프란시스코에 있으며, 2026-08-27 기준 비상장(장외 사모 라운드로만 자금을 조달)이다.

Anthropic은 델라웨어주 PBC(Public Benefit Corporation)로 설립됐다. 정관에 "첨단 AI를 인류의 장기적 이익을 위해 책임감 있게 개발·유지한다"는 공익 목적을 명시하며, 이는 이사회가 주주 이익만이 아니라 이 공익 목적과 회사 행위로 실질적 영향을 받는 이해관계자의 이익까지 함께 고려할 법적 근거가 된다.[^ltbt]

## 지배구조 — PBC와 Long-Term Benefit Trust(LTBT)

Anthropic의 지배구조는 두 층으로 이뤄진다.[^ltbt][^ltbt-harvard]

1. **PBC(공익법인) 형태** — 이사회가 주주 재무이익과 공익 목적을 동시에 저울질할 수 있는 법적 재량을 준다. 다만 PBC 형태 자체는 이사가 다른 이해관계자에게 직접 책임지도록 강제하지는 않는다.
2. **Long-Term Benefit Trust(LTBT)** — 이 한계를 보완하기 위해 2023년 신설된 별도 기구다. AI 안전·국가안보·공공정책·사회적기업 분야 전문가로 구성된 5인의 독립 트러스티가, 시리즈 C 종결 시 신설된 **Class T 주식**을 통해 이사회 이사 일부(궁극적으로 과반수, 시간·펀딩 마일스톤에 따라 단계적으로 확대)를 선임·해임할 권한을 가진다. 트러스티는 Anthropic 지분을 보유하지 않고 이익을 공유하지 않으며, 시간과 노력에 대해서만 보수를 받는다. 트러스티는 임기 1년이며 후임은 기존 트러스티가 선임한다.

2026-08-27 기준 Anthropic 공식 페이지에 등재된 이사회는 Dario Amodei, Daniela Amodei, Yasmin Razavi, Reed Hastings, Chris Liddell, Vas Narasimhan이며, LTBT 트러스티는 Neil Buddy Shah(의장), Richard Fontaine, Mariano-Florentino Cuéllar, Ben Bernanke(전 연준 의장, 2026-07-09 취임)다.[^company-page][^bernanke] 이 명단에는 Amazon·Google 소속 인사가 포함되어 있지 않다 — 다만 이것이 "두 회사가 이사회 의석을 갖지 않기로 하는 정책"이라는 명시적 공식 선언인지, 아니면 현재 시점의 결과적 사실인지는 별도 확인이 필요하다(**확인 필요**).

## 사업과 제품

- **Claude 모델 패밀리**: Opus·Sonnet·Haiku 등급으로 구분되는 대화형/추론 LLM.
- **Claude Code**: 터미널·IDE에서 동작하는 에이전틱 코딩 도구. 2026년 매출 급성장의 핵심 동력으로 반복 보도된다.[^coreweave-deal]
- **Cowork**: 2026년 언급되는 신규 협업 제품(Series H 발표문 인용).[^series-h]
- API·Amazon Bedrock·Google Vertex AI·Microsoft Foundry 등 3대 클라우드 플랫폼에서 모두 서비스된다.[^series-h]

## 자금조달 이력

| 라운드/이벤트 | 시점 | 규모 | 밸류에이션(포스트머니) | 비고 |
| --- | --- | --- | --- | --- |
| Amazon 1차 투자 | 2023-09 | 최대 $40억(초기 $12.5억 집행) | — | Amazon 최초 투자 발표 |
| Google 1차 투자 | 2023-10 | $20억 | — | 지분 약 10% |
| Amazon 추가 투자 | 2024-11 | $40억(누적 $80억) | — | [^amazon-4b] |
| Google 추가 투자 | 2026-01 | $10억(누적 $30억) | — | [^google-jan] |
| Microsoft·NVIDIA 동시 투자 | 2025-11-18 | Microsoft 최대 $50억 · NVIDIA 최대 $100억 | 약 $3,500억 | Azure $300억 구매·1GW 추가 계약과 동시 발표 |
| Amazon 확장 투자 | 2026-04-20 | 즉시 $50억 + 최대 조건부 $200억(신규 최대 $250억) | — | AWS $1,000억+ 10년 구매약정과 묶임[^amazon-2026] |
| Google 확장 투자 | 2026-04-24 | 즉시 $100억 + 최대 조건부 $300억(신규 최대 $400억) | — | [^google-2026] |
| Series H | 2026-05-28 | $650억 | **$9,650억** | Altimeter·Dragoneer·Greenoaks·Sequoia 주도. 하이퍼스케일러 기투자분 $150억(Amazon $50억 포함) 포함[^series-h] |

**금액 종류 구분**: 위 표의 "$50억", "$100억" 등은 대부분 **지분 투자 약정액**(집행 완료분과 조건부 향후분이 섞여 있음)이며, 아래 "클라우드·컴퓨트 공급망과 데이터센터 금융" 절에서 다루는 클라우드 구매약정(예: AWS $1,000억+)·데이터센터 리스(TeraWulf $190억)·금융 보증(Google의 데이터센터 신용보강)과는 **성격이 다른 숫자**다. 이 문서는 이 구분을 문서 전체에서 유지한다. 각 투자자의 지분 투자 상세·이사회 구성·교차투자 구도는 [[Anthropic-Ally/안트로픽-동맹]] 참고.

## 매출 지표

Anthropic은 2026-05-28 Series H 발표에서 "run-rate revenue(연환산 매출)가 이달 초 $470억을 넘어섰다"고 공식 언급했다.[^series-h] 이는 2025년 말 약 $90억, 2026년 4월 초 $300억대로 보도된 수치에서 매우 가파르게 증가한 것이다[^coreweave-deal] — 다만 "run-rate"는 특정 시점 월매출을 12개월로 단순 환산한 값이며 연간 확정 실적이 아니라는 점에 유의해야 한다. 매출의 약 80%가 기업 고객에서 나온다는 보도가 있다.[^ft-google-financing]

## IPO 추진 상황

- **2026-06-01**: Anthropic, PBC가 SEC에 Form S-1 초안을 비공개로 제출했다고 공식 발표. "SEC 심사 완료 후 상장 여부를 선택할 수 있는 옵션을 확보하는 것"이라고 설명하며, 상장 여부·시점은 시장 상황에 달려 있다고 명시했다.[^s1-official][^s1-cnbc]
- **2026-08월 중**: CFO Krishna Rao가 은행·투자자 대상 사전 미팅("test-the-water")을 진행 중이라는 보도가 있다. IPO 설명서에 AI 반발 여론·데이터센터 관련 리스크가 위험요인으로 명시될 것이라는 보도도 있다.[^ipo-risk]
- 2026-08-21 시점 일부 투자자는 상장 시 밸류에이션이 약 $2조에 이를 수 있다고 보고 있다는 보도가 있으나, 이는 **투자자 추정치이며 확정된 공모가가 아니다**(**미확정**).[^ipo-risk]
- 실제 상장 시점(예: 2026년 9월)은 여러 매체가 거론하지만 Anthropic이 공식 확정한 바 없다(**미확정**).

## 클라우드·컴퓨트 공급망과 데이터센터 금융

Amazon·Google·Microsoft·NVIDIA가 Anthropic에 얼마나 지분을 투자했는지, 그리고 이 네 회사가 Anthropic과 OpenAI 양쪽에 걸쳐 있는 교차투자 구도는 [[Anthropic-Ally/안트로픽-동맹]]에서 다룬다. 이 절은 그 네 회사를 포함해 Anthropic이 실제로 컴퓨트·클라우드·데이터센터를 어디서 얼마나 조달하는지, 그 계약과 금융 구조에 집중한다.

### 클라우드·컴퓨트 계약

| 공급자 | 계약 내용 | 규모 | 시점/가동 | 확정도 |
| --- | --- | --- | --- | --- |
| AWS | Project Rainier(1차 훈련·클라우드 파트너), AWS 기술에 10년간 $1,000억+ 지출 약정, Trainium2~4·Graviton 옵션 | 100만+ Trainium2 가동 중, 2026년 말까지 약 1GW(Trainium2+3), 최대 5GW까지 확장 계약(2026-04-20) | 2025-10 Rainier 전면 가동, 2026년 순차 확장[^amazon-compute-official] | 공식 발표 |
| Google Cloud / TPU | Google Cloud 이용 + TPU 공급(2023년부터), Broadcom과 공동설계 | 최대 100만 TPU(2025-10 발표), 2026-04-06 Broadcom과 함께 추가로 5GW 차세대 TPU capacity 계약(Anthropic 자체 Series H 발표 기준) | 2026년 순차 가동, 5GW분은 2027년부터 | 공식 발표 — 단 총 TPU 대수·GW 수치가 여러 발표에 걸쳐 나와 누적 여부는 확인 필요 |
| Microsoft Azure | $300억 구매 + 최대 1GW 추가 | NVIDIA Grace Blackwell·Vera Rubin 시스템 기반 | 2025-11-18 발표 | 공식 발표 |
| CoreWeave | 다년(multi-year) GPU 클라우드 계약, 금액 비공개 | 단계적 롤아웃(phased infrastructure roll-out) | 2026-04-10 발표, 2026년 하반기부터 컴퓨트 온라인 | 공식 발표(금액은 미공개) |
| SpaceX/xAI Colossus 1·2 | 브리지 컴퓨트 임차(용도: Claude Pro/Max/Code·API 사용한도 확대) | 월 $12.5억 지급(SEC 공시) | 2026-05-06 계약, 2026-05-28 Series H 발표에 Colossus 1·2 모두 언급 | 계약 존재·금액은 확정, **지속기간은 아래 별도 서술** |

### Anthropic이 Colossus를 쓰는 방식 — 그리고 이 컴퓨트원의 신뢰성

Colossus 자체의 GPU 구성·xAI/SpaceX 합병 배경 등 계약의 정본 서술은 [[GroupX/일론머스크-그룹]]·[[NASDAQ/SpaceX]]에 있다. 이 절은 "Anthropic이 이 컴퓨트를 어떻게 확보·활용하는가, 그리고 투자자가 Anthropic의 컴퓨트 포트폴리오를 평가할 때 이 계약을 얼마나 신뢰할 수 있는가"에 집중한다.

Anthropic은 2026-05-06 xAI(SpaceXAI)와 계약을 맺어 Colossus 1(NVIDIA GPU 22만 개 이상, 300MW+)에 접근권을 얻었고, 이 컴퓨트를 Claude Pro·Max 구독자와 Claude Code·API 사용한도 확대에 곧바로 투입했다.[^xai-news] SpaceX의 IPO S-1 공시는 이 계약을 "고객(Anthropic)이 2029년 5월까지 월 $12.5억을 지급"하는 조건으로 기술하며, 양측이 90일 사전통지로 해지할 수 있다는 조항도 함께 명시한다.[^techcrunch-lease] 그런데 2026-05-28 SpaceX 회장 Elon Musk는 X(트위터)에서 이 설명과 배치되는 말을 남겼다 — "SpaceX는 수년간 Colossus를 임대하기로 약정한 적이 없다. 이는 180일 기본계약이고 그 이후 90일 사전통지 상호 해지가 가능하다. 단기 계약은 우리 쪽 요청이었다"는 것이다.[^musk-6month] 규제 제출서류(2029년 5월까지 월정액 지급)와 회장 개인 발언(180일 기본계약)이 정면으로 엇갈리는 셈이며, 어느 쪽이 실제 구속력을 갖는지는 확인되지 않는다. 2026-06-21 Consens.io는 TechCrunch·CNBC 등의 보도를 종합해 "SpaceX가 임박하게 계약을 해지할 조짐은 없지만, 계약 자체는 의도적으로 단기 유연성을 갖도록 설계돼 있다"고 추정했다.[^consens-cancel]

투자자 입장에서 중요한 것은 이 엇갈림이 Anthropic의 컴퓨트 안정성 평가에 주는 함의다. Anthropic의 2026-05-28 Series H 발표문은 Colossus 1·2를 AWS·Google Cloud와 나란히 나열했지만,[^series-h] Musk의 설명이 맞다면 이 컴퓨트원은 AWS(10년 $1,000억+ 약정)·Google(5GW 다년 계약)보다 훨씬 단기적이고 해지 가능성이 높은 브리지 컴퓨트에 가깝다. 즉 Anthropic이 확보한 컴퓨트 용량 중 일부는 90일(또는 180일) 안에 줄어들 수 있는 물량이며, 장기 컴퓨트 안정성을 평가할 때 이를 AWS·Google 계약과 같은 신뢰도로 취급해서는 안 된다.

### 데이터센터 개발·금융 구조

| 프로젝트 | 개발사 | 규모 | 금융 구조 | 시점 |
| --- | --- | --- | --- | --- |
| 미국 전역(텍사스·뉴욕 등) | Fluidstack | $500억 규모(전체 인프라 투자, 임대료 아님) | Anthropic 전용 맞춤 데이터센터 | 2025-11-12 발표, 2026년 순차 가동[^fluidstack] |
| Justified Data Campus(Kentucky, Hawesville) | TeraWulf | 401MW, 20년 리스, 계약가치 약 $190억 | 투자등급 신용으로 뒷받침된다고 설명 | 2026-07-06 발표, 2027년 하반기 최초 가동~2028년 초 401MW 완전 가동[^terawulf] |
| Hubbard, Texas 캠퍼스 | Nexus Data Centers | 천연가스 발전 1.6GW 포함, 약 $150억(브리지론 $140억+RCF) | Morgan Stanley 주선 은행단, Google이 리스·전력비 지급 의무 보증(추정), 대가로 지분 취득 예정(추정) | 2026-07-30~08 보도 |

**Nexus/Texas 지분 참여**: 이 프로젝트를 뒷받침하는 공식 발표·계약서는 아직 없고, 있는 것은 언론 취재뿐이다. 2026-07-30 CNBC(Ashley Capoot·Hugh Son 기자)는 소식통을 인용해 Morgan Stanley가 이끄는 은행단이 Nexus Data Centers에 $150억을 빌려주는 방안을 막바지 협의(advanced talks) 중이며 Google이 투자등급 신용으로 Anthropic의 의무를 보증하기로 합의했다고 추정했고,[^nexus-cnbc] 같은 날 Reuters는 Wall Street Journal을 인용해 Google이 채무불이행 시 발생하는 손실을 최소 필요 수준까지만 보증하기로 했다고 전했다.[^nexus-reuters] 2026-08-04 Global Data Center Hub는 이 두 보도를 종합해 그 대가로 Google이 데이터센터·발전 프로젝트 지분 약 20%를 취득할 것으로 추정했다.[^nexus-reuters] Google·Anthropic·Nexus 중 어느 쪽도 지분 취득이나 최종 대출 규모를 공식 확인한 적은 없다.

### Google의 Anthropic向 TPU 금융 — "$200B Wall Street 머신"

Financial Times가 2026-08-03 단독 보도한 구조로, 여러 매체가 후속 보도했다. 핵심 구조는 다음과 같다.[^ft-google-financing][^techtimes-financing]

- Google이 Broadcom과 공동설계한 TPU를 판매하고, 별도로 그 TPU를 담는 데이터센터를 신용보증한다 — **공급자·보증인·주주(Google의 Anthropic 지분 약 14%로 보도)를 동시에 겸하는 구조**.
- **Compute SPV**: Morgan Stanley가 조성한 특수목적법인. Apollo·Blackstone이 앵커 투자자로 참여한 사모신용으로 자금을 조달해 TPU를 매입한 뒤 Anthropic에 리스한다. 2026년 6월 1차 트랜치는 약 $350억(약 100만 개 Ironwood TPU, 약 1GW)이었다.
- **Broadcom의 잔존가치보증(residual value guarantee)**: Anthropic이 리스료를 지불하지 못하고 하드웨어 재판매가가 대출잔액에 못 미칠 경우, Broadcom이 그 차액(1차 트랜치 $350억 중 약 $300억 해당분)을 부담한다. 이 보증 덕에 선순위 트랜치가 정크 등급에서 투자적격에 가까운 등급으로 올라섰다고 분석된다.
- Alphabet의 2026년 2분기 10-Q(2026-07-24 제출)에 따르면 데이터센터 리스보증 노출이 9개월 전 $65억에서 **$438억**으로 급증했고, 여기에 확정 전 추가 보증 $241억, 미개시 리스 $852억, 전력보증 $76억을 더하면 관련 오프밸런스시트 노출이 **$1,500억+**에 이른다.
- 전체 계약(TPU+데이터센터) 규모는 약 **$2,000억**으로 집계되며, 이는 Anthropic의 매출 성장(2026년 4월 기준 연환산 $300억대, 이후 5월 $470억으로 보도)에 의존한다.
- **부수 효과**: Jefferies 분석 기준 Google 신용보증을 받는 데이터센터 사업자의 부채 조달금리(약 7.1%)가 NVIDIA 생태계 기반 사업자(약 9.3%)보다 2.2%p 낮다고 보도됐다 — TPU 공급망이 금융 조달비용에서도 경쟁우위를 만든다는 분석이다.

**주의**: 위 수치는 대부분 SEC 10-Q 공시(1차 자료)와 FT 단독보도를 여러 매체가 인용한 것으로, 금액 종류(보증 한도·실집행액·프로젝트 총액)를 서로 혼동하지 않아야 한다. "$2,000억 = Google이 Anthropic에 투자한 돈"이 아니라 "TPU 판매+데이터센터 보증을 합친 계약 총액"이라는 점을 특히 유의해야 한다. Google의 Anthropic 지분 투자 자체는 [[Anthropic-Ally/안트로픽-동맹]]의 투자자 관계 표를 참고한다.

## 확인 필요

- 이사회에 Amazon·Google 인사가 없는 것이 명시적 정책인지 결과적 현황인지
- IPO 실제 상장 시점과 공모가
- 2026년 매출 run-rate 급증($90억→$470억)의 세부 구성(기업 계약 갱신 vs 신규 고객 vs Claude Code 단가 변화)
- **SpaceX/xAI Colossus 계약 기간**: S-1("2029-05까지 월정액")과 Musk 개인 발언("180일+90일 해지")이 병기된 채 미해소 — 상세는 "Anthropic이 Colossus를 쓰는 방식" 절.
- **Google의 Nexus/Texas 지분 20% 취득**: CNBC·Reuters(WSJ 인용)·Global Data Center Hub의 추정만 있고 공식 확인은 없음 — 상세는 "Nexus/Texas 지분 참여" 절.
- 2026년 3월 Google TPU 확장분(5GW)과 2025년 10월 발표분(최대 100만 TPU, 1GW+)의 누적 관계 — 별개 계약인지 동일 계약의 갱신인지 공식 자료로 확인하지 못함.

## 각주

[^ltbt]: Anthropic, "The Long-Term Benefit Trust", anthropic.com/news/the-long-term-benefit-trust, 2023-09-19 (확인일 2026-08-27).
[^ltbt-harvard]: Harvard Law School Forum on Corporate Governance, "Anthropic Long-Term Benefit Trust", corpgov.law.harvard.edu, 2023-10-28 (확인일 2026-08-27).
[^company-page]: Anthropic, "Company" 페이지(이사회·LTBT 트러스티 명단), anthropic.com/company (확인일 2026-08-27).
[^bernanke]: Anthropic, "Ben Bernanke appointed to Anthropic's Long-Term Benefit Trust", anthropic.com/news/ben-bernanke, 2026-07-09 (확인일 2026-08-27).
[^amazon-4b]: CNBC, "Amazon to invest another $4 billion in Anthropic, OpenAI's biggest rival", cnbc.com, 2024-11-22 (확인일 2026-08-27).
[^google-jan]: Gulf News 등 2026년 1월 Google 추가 $10억 투자 보도 종합("Google agrees to invest up to $2 billion in OpenAI rival Anthropic" 계열 후속 보도), gulfnews.com (확인일 2026-08-27).
[^amazon-2026]: CNBC, "Amazon to invest up to another $25 billion in Anthropic as part of AI infrastructure deal", cnbc.com, 2026-04-20; Anthropic, "Anthropic and Amazon expand collaboration for up to 5 gigawatts of new compute", anthropic.com/news/anthropic-amazon-compute, 2026-04-20 (확인일 2026-08-27).
[^google-2026]: CNBC, "Google to invest up to $40 billion in Anthropic as search giant spreads its AI bets", cnbc.com, 2026-04-24 (확인일 2026-08-27).
[^series-h]: Anthropic, "Anthropic raises $65B in Series H funding at $965B post-money valuation", anthropic.com/news/series-h, 2026-05-28 (확인일 2026-08-27).
[^coreweave-deal]: The Next Web(CoreWeave-Anthropic 계약 분석 기사), "CoreWeave signs multi-year Anthropic deal as nine of ten top AI model providers join its platform", thenextweb.com, 2026-08-05 — Anthropic 연환산 매출이 2025년 말 약 $90억에서 2026년 4월 초 $300억대로 늘었다는 보도 인용(확인일 2026-08-27).
[^ft-google-financing]: Financial Times, "Inside Google's $200bn Wall Street finance machine for Anthropic", ft.com, 2026-08-03(간접 인용은 techtimes.com, forkast.news 등 2차 보도 종합, 확인일 2026-08-27).
[^s1-official]: Anthropic, "Anthropic confidentially submits draft S-1 to the SEC", anthropic.com/news/confidential-draft-s1-sec, 2026-06-01 (확인일 2026-08-27).
[^s1-cnbc]: CNBC, "Anthropic confidentially files IPO prospectus with SEC, landmark deal", cnbc.com, 2026-06-01; AP News, "Anthropic races toward a Wall Street debut with a confidential SEC filing", apnews.com, 2026-06-01 (확인일 2026-08-27).
[^ipo-risk]: CNBC, "Anthropic IPO filing will show AI backlash as risk, sources say", cnbc.com, 2026-08-21 (확인일 2026-08-27).
[^amazon-compute-official]: Anthropic, "Anthropic and Amazon expand collaboration for up to 5 gigawatts of new compute", anthropic.com/news/anthropic-amazon-compute, 2026-04-20 (확인일 2026-08-27).
[^xai-news]: xAI, "New Compute Partnership with Anthropic", x.ai/news/anthropic-compute-partnership, 2026-05-06 (확인일 2026-08-27).
[^techcrunch-lease]: TechCrunch, "How long is Anthropic's lease with SpaceX? Opinions vary", techcrunch.com, 2026-05-28 — SpaceX S-1 공시 F-62·F-96·13·146쪽 인용(확인일 2026-08-27).
[^musk-6month]: The Next Web, "Musk walks back the Anthropic Colossus deal to a six-month lease", thenextweb.com, 2026-05-28; Tech Startups, "Elon Musk says SpaceX only agreed to 6-month Colossus AI lease with Anthropic despite $1.25B deal", techstartups.com, 2026-05-28(Musk X 게시물 인용, 확인일 2026-08-27).
[^consens-cancel]: Consens.io, "Will SpaceX cancel its compute lease deals with Google and Anthropic?", consens.io, 2026-06-21(TechCrunch·CNBC 등 종합, 확인일 2026-08-27).
[^fluidstack]: Anthropic, "Anthropic invests $50 billion in American AI infrastructure", anthropic.com/news/anthropic-invests-50-billion-in-american-ai-infrastructure, 2025-11-12 (확인일 2026-08-27).
[^terawulf]: TeraWulf, "TeraWulf Announces Anthropic Lease at Justified Data Campus", investors.terawulf.com, 2026-07-06; CNBC, "TeraWulf shares soar after Anthropic leases data center in Kentucky", cnbc.com, 2026-07-06 (확인일 2026-08-27).
[^nexus-cnbc]: CNBC, "Nexus Data Centers in advanced talks to secure $15B for Google-backed Anthropic data center", cnbc.com, 2026-07-30 (확인일 2026-08-27).
[^nexus-reuters]: Reuters, "Banks in talks to lend $15 billion for Anthropic data center backed by Google, WSJ reports", reuters.com, 2026-07-30(WSJ 인용); Global Data Center Hub, "The Lenders Are Not Underwriting Anthropic. They Are Underwriting Google.", globaldatacenterhub.com, 2026-08-04(지분 약 20% 취득 예상 보도, 확인일 2026-08-27).
[^techtimes-financing]: TechTimes, "Google Built Credit Guarantee Infrastructure Giving Its TPU Chips 2-Point Rate Edge Over Nvidia", techtimes.com, 2026-08-04 — Alphabet 2026년 2분기 10-Q(2026-07-24 제출) 수치 인용(확인일 2026-08-27).
