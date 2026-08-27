---
id: '01a0422e-6299-70a0-89cb-0d8f7523b3c7'
title: CLARITY Act
type: concept
status: active
aliases: ['Digital Asset Market Clarity Act', 'H.R. 3633', 'Digital Asset Market Structure Act']
tags: ['가상자산', '규제', '증권법', '미국']
---

## 개요

CLARITY Act(정식 명칭: Digital Asset Market Clarity Act, 하원 법안번호 H.R. 3633, 미국 119대 의회)는 디지털자산을 증권(Security)과 상품(Commodity)으로 분류하는 기준을 정하고, 이에 따라 증권거래위원회(SEC)와 상품선물거래위원회(CFTC)의 관할을 나누려는 연방 법안이다. 2025-07-17 하원 본회의를 초당적으로 통과했다(찬성 294 : 반대 134).[^govtrack]

## 입법 현황(2026-08-27 기준)

- **하원**: 2025-07-17 통과.[^govtrack]
- **상원 농업위원회**: 2026년 1월 법안(현물 디지털상품시장 관련 부분)을 통과시켰다.[^lw-tracker]
- **상원 은행위원회**: 2026-05-14 찬성 15 : 반대 9로 법안을 통과시켰다.[^dwt]
- **상원 본회의**: 2026년 8월 여름 휴회 전 표결이 이뤄지지 않았다. 상원 다수당대표가 토론종결(cloture) 동의안을 제출해 2026-09-15 표결을 예정한 상태다.[^coindesk-0805][^qz]
- **법률 확정까지 남은 절차**: 상원 농업위원회안과 은행위원회안 조율 → 상원 본회의 60표 이상 확보 → 하원 통과안과의 양원 조율 → 대통령 서명.[^coindesk-0805]

즉 2026-08-27 시점에서 CLARITY Act는 **아직 법률로 확정되지 않았다.** 이 문서의 "현재" 서술은 이 기준일의 입법 진행 상태를 뜻하며, 최종 법제화 여부·조문은 위 절차를 거치며 달라질 수 있다.

## 규제 구조 — SEC와 CFTC

- **SEC**: 발행 단계의 증권성 판단과 발행자 공시 등 기존 증권 규제의 일부를 유지한다.
- **CFTC**: "디지털상품(Digital Commodity)"의 현물시장에 대해 새로운 배타적 규제 권한을 부여받는다. CFTC에 등록된 거래소·브로커·딜러를 통한 디지털상품 거래가 그 대상이다.[^congress-crs]
- **디지털상품(Digital Commodity) 정의**: 가치가 블록체인의 사용과 "본질적으로 연동(intrinsically linked)"된 디지털자산을 말한다. 증권·파생상품·스테이블코인은 이 정의에서 제외된다.[^datawallet]

## 성숙한 블록체인(Mature Blockchain)과 탈중앙화 판정

- 법안은 "성숙한 블록체인"을 특정인 또는 공동지배 그룹의 통제를 받지 않는 블록체인 시스템(및 그에 결부된 디지털상품)으로 정의한다.[^datawallet]
- 발행자·계열사 또는 탈중앙화 거버넌스 시스템이 "성숙" 상태를 자체적으로 인증(self-certify)할 수 있으며, 이는 반증 가능한 추정(rebuttable presumption)으로 취급된다. 규제기관은 60일 내 이의를 제기할 수 있고, 이의 제기 시 연방법원에서 다툴 수 있다.[^datawallet]
- "탈중앙화 시스템"은 특정인 또는 제휴 그룹이 프로토콜을 일방적으로 수정하거나 거버넌스를 통제할 수 없는 체계로 정의된다. 즉 "재단"·"DAO" 같은 명칭이 아니라 창업자·재단·VC의 토큰 보유 비중, 관리자 키(admin key), 검증자 집중도 등 실제 통제력을 기준으로 판단하도록 설계됐다.[^datawallet]

## 발행자 자금조달 특례

법안은 디지털상품 발행자가 연간 최대 미화 7,500만 달러까지 증권신고 없이 자금을 조달할 수 있는 신규 면제 공모(exempt offering) 제도를 신설한다. 상세 공시 의무를 충족하고, "성숙한" 블록체인 시스템이거나 4년 내 성숙 도달이 예상되는 시스템에 결부되는 것이 조건이다.[^datawallet]

## Bitcoin과 일반 알트코인의 분류 논리

- **Bitcoin**은 공식 발행 주체·경영진·투자금을 모집한 발행자가 없고, 특정 회사가 사라져도 네트워크가 지속되며, 현재 투자자가 특정 운영자의 노력에 의존하지 않는다는 점에서 상품(Commodity)에 가깝다고 평가된다.
- 반면 일반적인 알트코인 프로젝트는 창업자·개발사·재단이 토큰 발행량 중 상당 부분을 미리 배정받고(Founder/Team/VC/Treasury Allocation), 토큰 판매 대금으로 개발을 진행하며, 프로젝트 성공이 토큰 가격과 내부자의 경제적 이익으로 직결되는 구조를 가진다는 점에서 증권적 성격이 강하다는 주장이 있다. 회계상 배당을 하지 않는 비영리 "재단" 구조라 해도, 재단이 토큰을 대량 보유하고 가격 상승으로 관계자의 경제적 이익이 커진다는 사실 자체는 사라지지 않는다는 지적이다.
- CLARITY는 네트워크가 초기 단계(증권적 성격이 강함)에서 성숙 단계(상품적 성격이 강함)로 전환할 수 있다는 논리를, 위의 "성숙한 블록체인" 자기인증 제도로 구조화한 것이다. 이 전환 논리가 내부자 물량 문제·투자자 보호 공백을 실질적으로 충분히 막는지, 아니면 규제차익(regulatory arbitrage)의 통로가 되는지는 찬반이 갈리는 정책적 쟁점이며 확정된 평가가 아니다(**미확정**).

## 트럼프 일가 이해충돌 쟁점

이 쟁점은 출처 신뢰도가 크게 엇갈리므로 아래에서 등급을 구분해 병기한다.

**입법 절차상 확정된 사실**: 2026-08-27 기준 윤리조항(ethics provision)은 상원 협상 중인 초안 문구일 뿐 **아직 법률로 확정되지 않았다.** 최종 조문은 9월 예정된 상원 표결과 이후 양원 조율 과정에서 달라질 수 있다.

**언론 보도를 통한 추정**
- 트럼프 대통령 및 가족과 연관된 가상자산 사업(World Liberty Financial/WLFI, TRUMP 밈코인 등)의 이해충돌 문제가 상원 윤리조항 협상의 핵심 쟁점으로 보도됐다.[^yahoo-ethics]
- 관련 자산·수익 규모는 언론사마다 다른 추정치를 보도했다 — 로이터가 약 23억 달러로 추정한 수치가 "Crypto in America" 뉴스레터를 통해 재인용됐고[^yahoo-ethics], Tech Times는 별도로 약 14억 달러 상당의 크립토 수익으로 보도했다[^techtimes]. 두 수치 모두 **추정치**이며 산정 기준·시점이 서로 달라 직접 비교할 수 없다.
- CoinDesk·Transparency International 보도에 따르면, 상원 협상 중인 초안은 공직자와 배우자의 **신규** 토큰 발행·후원(sponsorship)을 제한하는 방향으로 잠정 합의됐다고 전해지나, 트럼프와 관련된 **기존** 사업이 이해관계자 자산을 매각(divest)하거나 백지신탁(blind trust)에 넘긴 이후에도 그의 이름·초상권을 이용해 추가 디지털자산을 발행·판매하는 것은 명시적으로 허용한다는 비판이 제기됐다.[^coindesk-0722][^transparency]

**당사자 발언**: 백악관 크립토 위원회(White House Crypto Council)의 실무 책임자 Patrick Witt는 윤리 제한이 "대통령부터 가장 말단 공무원까지 균일하게 적용"되어야 하며, 트럼프나 그 가족을 특정해 지목하는 문구는 받아들이지 않겠다는 입장을 밝힌 것으로 보도됐다(직접 인용문이 아니라 언론이 전한 취지 — 원문 발언 그대로는 확인되지 않음).[^yahoo-ethics] 이 사안에 대한 트럼프 대통령 본인의 직접 공개 발언은 2026-08-27 기준 확인되지 않았다.

## 관련 문서

한국의 가상자산 관련 세제는 이 법안과 별개의 논의이지만 [[laws/ko/enacted/가상자산-과세]]에서 다룬다.

## 각주

[^govtrack]: GovTrack.us, "H.R. 3633 (119th): Digital Asset Market Clarity Act" — 하원 통과 2025-07-17 (확인일 2026-08-27)
[^lw-tracker]: Latham & Watkins, "US Crypto Policy Tracker: Legislative Developments", lw.com (확인일 2026-08-27)
[^dwt]: Davis Wright Tremaine, "Senate Banking Committee Advances Crypto Market Structure Bill", dwt.com, 2026-05
[^coindesk-0805]: CoinDesk, "Here are the possible outcomes for CLARITY right now", coindesk.com, 2026-08-05
[^qz]: Quartz, "Senate delays Digital Asset Market Clarity Act vote to September", qz.com, 2026-08-10
[^congress-crs]: Congress.gov CRS(Congressional Research Service), "Crypto Legislation: An Overview of H.R. 3633, the CLARITY Act"(IN12583)
[^datawallet]: Datawallet, "CLARITY Act Explained: SEC and CFTC Crypto Rules in 2026", datawallet.com (확인일 2026-08-27)
[^yahoo-ethics]: Yahoo News, "CLARITY Act Ethics Talks Stall Over $2.3B in Trump Crypto Holdings"
[^techtimes]: Tech Times, "CLARITY Act Stalls on Only Clause That Could Limit Trump's $1.4B Crypto Income", techtimes.com, 2026-07-16
[^coindesk-0722]: CoinDesk, "New Clarity Act emerges that's a start on the final draft, makes ethics rule temporary", coindesk.com, 2026-07-22
[^transparency]: Transparency International U.S., "Senate's New CLARITY Act Leaves Trump's Core Crypto Conflicts Unchecked", us.transparency.org
