/* 수도권 입지 랩 — 정책 규칙표 + 자금 시나리오 엔진
 *
 * [1부 POLICY] 정책이 바뀌면 이 객체만 고친다. 규칙마다 버전 배열로 적고(최신이 위),
 *   from(시행일)·until(종료일)·src(근거)를 남긴다. 사용자가 고른 기준일(잔금·대출 실행 예정일)에
 *   유효한 버전이 자동 적용되므로, 예고된 정책 변경도 미리 넣어둘 수 있다.
 * [2부 엔진] 순수 함수. 브라우저에서는 전역 PolicyEngine, Node에서는 require로 테스트.
 *
 * 단위: 금액 = 억 원, 연소득 = 만 원(index.html state.income과 동일), 비율 = 0~1
 */
(function (root) {
  const POLICY = {
    updated: '2026-11-04',

    // 자동 수집이 안 되는 값: 사람이 공식 발표로 확인한 날짜(checked)와 근거를 남긴다.
    // 화면에 '수동 확인'으로 표시되고, 60일이 지나면 '재확인 필요'가 뜬다.
    manualChecks: [
      { label: '주담대 LTV·구간 한도·DSR·스트레스 금리', value: '규제지역 LTV 40%(생애최초 70%) · 15억/25억 기준 6·4·2억 · DSR 40% · 스트레스 +3%p',
        source: '8·13 금융 종합대책에서 유지 확인 (언론 보도)', checked: '2026-11-04' },
      { label: '규제지역(투기과열·조정대상)', value: '서울 전역 + 경기 12곳, 2026-07-01 동탄·기흥·구리 추가',
        source: '10·15 대책, 2026-07-01 추가 지정 (언론 보도)', checked: '2026-11-04' },
      { label: '경기 토지거래허가구역', value: '경기 12곳(~2026-12-31), 동탄·기흥·구리(~2027-12-31)',
        source: '10·15 대책, 2026-07-05 지정 (언론 보도) — 경기부동산포털 자동 수집 미연결', checked: '2026-11-04' },
      { label: '정책대출 요건(디딤돌·신생아 특례)', value: '소득·순자산 5.11억·주택가격·한도 4억/3.2억 등',
        source: '주택도시기금·KB국민은행 상품 안내 (2026-10-19 기준)', checked: '2026-11-04' },
      { label: '취득세 세율·생애최초/출산 감면', value: '1~3% · 감면 200만/500만 원 (2028-12-31까지)',
        source: '지방세법, 지방세특례제한법 (언론 보도로 연장 확인)', checked: '2026-11-04' },
      { label: '증여공제·세율, 부모 차용 적정이자율', value: '5천만+혼인·출산 1억 · 10~50% · 4.6%',
        source: '상속세및증여세법·시행령 (2026 세법개정안 변경 없음)', checked: '2026-11-04' },
    ],

    // 규제지역(투기과열 겸 조정대상) — 주담대 LTV·한도, 자금조달계획서에 영향.
    // 지정 구역(zone)을 날짜와 함께 나열하고, 기준일에 유효한 구역을 모두 합쳐 판정한다.
    regulated: [
      { from: '2025-10-16', seoulAll: true,
        gyeonggi: ['gg_gwacheon', 'gg_gwangmyeong', 'gg_bundang', 'gg_seongnam_old', 'gg_gwanggyo', 'gg_anyang', 'gg_suji', 'gg_hanam'],
        src: '10·15 대책: 서울 25개구 + 과천·광명·의왕·하남·성남 분당/수정/중원·수원 영통/장안/팔달·안양 동안·용인 수지' },
      { from: '2026-07-01', gyeonggi: ['gg_dongtan', 'gg_guri'],
        src: '2026-07-01 추가 지정: 화성 동탄구·용인 기흥구·구리시' },
    ],

    // 토지거래허가구역(아파트) — 허가 후 4개월 내 입주, 2년 실거주 → 전세 끼고 사기(갭투자) 불가
    toheoje: [
      { from: '2025-10-20', until: '2026-12-31', seoulAll: true,
        gyeonggi: ['gg_gwacheon', 'gg_gwangmyeong', 'gg_bundang', 'gg_seongnam_old', 'gg_gwanggyo', 'gg_anyang', 'gg_suji', 'gg_hanam'],
        src: '10·15 대책 토지거래허가구역 (2026-12-31까지, 연장 여부 미발표)' },
      { from: '2026-07-05', until: '2027-12-31', gyeonggi: ['gg_dongtan', 'gg_guri'],
        src: '2026-07-05 지정: 화성 동탄구·용인 기흥구·구리시 (2027-12-31까지)' },
    ],

    // 시중은행 주택담보대출 (수도권 기준)
    bankLoan: [
      { from: '2025-10-16',
        ltv: { regulated: { none: 0.40, first: 0.70 }, normal: { none: 0.70, first: 0.70 } },
        capByPrice: [[15, 6], [25, 4], [Infinity, 2]],   // 수도권·규제지역: 시가 구간별 한도(억)
        capNormal: 6,                                      // 수도권 비규제 최대 6억
        dsr: 0.40,
        stressAdd: 0.03,   // 수도권·규제지역 스트레스 금리 3.0%(100% 반영). 21년 이상 고정형은 미적용
        rate: 0.048,       // 기본값. policy_live.json(한국은행 ECOS 주담대 평균금리)이 있으면 그 값으로 바뀜
        years: 30, moveInMonths: 6,
        src: '6·27·9·7·10·15 대책, 8·13 금융 종합대책(2026)에서 유지 확인 · 스트레스 DSR 2026 하반기' },
    ],

    // 정책대출. incomeMax: 부부합산 만원, priceMax·limit·assetMax: 억, areaMax: 전용㎡
    policyLoans: [
      { id: 'newborn', name: '신생아 특례 디딤돌', from: '2025-06-28',
        need: f => f.homes === 0 && f.newborn2y,
        incomeMax: f => (f.dualIncome ? 20000 : 13000), assetMax: 5.11, priceMax: 9, areaMax: 85, limit: () => 4,
        ltv: () => 0.7, dti: 0.6, rate: 0.030, rateText: '연 1.8~4.5% (5년, 추가 출산 시 연장)',
        src: '주택도시기금 신생아 특례 (2025-06-28 이후 계약 한도 4억)' },
      { id: 'didimdol', name: '디딤돌 구입자금', from: '2025-06-28',
        need: f => f.homes === 0,
        incomeMax: f => (f.married === 'within7' || f.married === 'planned' ? 8500 : (f.firstTime || f.children >= 2) ? 7000 : 6000),
        assetMax: 5.11, areaMax: 85,
        priceMax: f => (f.married === 'within7' || f.married === 'planned' || f.children >= 2 ? 6 : 5),
        limit: f => (f.married === 'within7' || f.married === 'planned' || f.children >= 2 ? 3.2 : f.firstTime ? 2.4 : 2),
        ltv: () => 0.7, dti: 0.6, rate: 0.034, rateText: '연 2.85~4.15%',
        src: '주택도시기금 디딤돌대출 (KB 안내 2026-10-19 기준)' },
      { id: 'bogeumjari', name: '보금자리론', from: '2026-10-19',
        need: f => f.homes <= 1,
        // ponytail: 신혼은 '부부 중 1명 7천만 이하'인데 1인 소득 입력이 없어 맞벌이는 반씩 번다고 가정
        incomeMax: f => ((f.married === 'within7' || f.married === 'planned') && f.dualIncome ? 14000 : 7000),
        priceMax: 6, limit: f => (f.firstTime ? 4.2 : f.children >= 2 ? 4 : 3.6),
        ltv: () => 0.7, dti: 0.6, rate: 0.051, rateText: '연 5.0~5.3% (2026-11 공시)',
        src: '한국주택금융공사 보금자리론' },
    ],

    // 취득세 (무주택·처분조건부 1주택 기준). 지방교육세 = 취득세율 × 0.1, 농특세는 85㎡ 초과만
    acqTax: [
      { from: '2020-08-12',
        rate: p => (p <= 6 ? 0.01 : p <= 9 ? (p * 2 / 3 - 3) / 100 : 0.03),
        eduRatio: 0.1, ruralOver85: 0.002, src: '지방세법 제11조' },
    ],
    // 취득세 감면 (중복 불가 → 큰 쪽 하나)
    acqRelief: [
      { id: 'first_time', name: '생애최초 주택 취득세 감면', from: '2020-07-10', until: '2028-12-31',
        need: f => f.homes === 0 && f.firstTime, priceMax: 12, max: 0.02,
        src: '지방세특례제한법 제36조의3 (2028-12-31까지 연장)' },
      { id: 'birth', name: '출산·양육 주택 취득세 감면', from: '2024-01-01', until: '2028-12-31',
        need: f => f.homes === 0 && f.newborn2y, priceMax: 12, max: 0.05,
        src: '지방세특례제한법 제36조의5 (2028-12-31까지)' },
    ],

    // 증여세 (직계존속 → 성년 자녀)
    gift: [
      { from: '2024-01-01',
        exemptAdult: 0.5,            // 10년 합산
        exemptMarriageBirth: 1,      // 혼인신고 전후 2년 또는 출생·입양 2년 내, 통합 1억
        exemptInLaw: 0.1,            // 사위·며느리(기타친족) 10년 1천만원
        brackets: [[1, 0.1, 0], [5, 0.2, 0.1], [10, 0.3, 0.6], [30, 0.4, 1.6], [Infinity, 0.5, 4.6]],
        filingCredit: 0.03, filingMonths: 3,
        src: '상속세및증여세법 제53조·제53조의2·제56조·제69조' },
    ],

    // 부모 자녀 간 차용 (금전소비대차)
    borrow: [
      { from: '2016-03-21', legalRate: 0.046, freeDiffPerYear: 0.1,  // 연 이자 차액 1천만원 미만이면 증여 아님
        src: '상증법 제41조의4, 시행령 제31조의4' },
    ],

    // 합법 절세 팁(tip)과 주의사항(warn). when(f, p, c): 지금 상황에 해당하면 표시
    //   f = 가구 사실, p = 부모 지원 입력, c = { plan, region, loan, monthlyMan, incomeMonthlyMan, date }
    tips: [
      { kind: 'tip', title: '혼인·출산 증여공제로 1인당 1억 더',
        when: (f, p) => !p.marriageBirth && (f.married === 'planned' || f.married === 'within7' || f.newborn2y),
        body: () => '혼인신고 전후 2년 안이나 자녀 출생·입양 후 2년 안에 받으면 기본공제 5천만 원과 별도로 1인당 1억 원이 더 공제됩니다(혼인·출산 합쳐 1억). 부부가 각자 부모님께 받으면 합계 3억 원까지 증여세가 없습니다. 위에서 ‘혼인·출산 증여공제 쓰기’를 켜서 비교해 보세요.',
        src: '상증법 제53조의2' },
      { kind: 'tip', title: '양가에서 각자 자기 자녀에게',
        when: (f, p) => f.married !== 'single' && !p.split && p.amount > 0.5,
        body: () => '사위·며느리가 받으면 공제가 10년간 1천만 원뿐입니다. 양가 부모님이 각자 자기 자녀에게 주면 공제를 두 사람 몫으로 받습니다.',
        src: '상증법 제53조' },
      { kind: 'tip', title: '증여세는 0원이어도 3개월 안에 신고',
        when: (f, p) => p.amount > 0,
        body: () => '증여받은 달 말일부터 3개월 안에 신고하면 낼 세금의 3%를 깎아줍니다. 공제 범위 안이라 세금이 없어도 신고해 두면 자금조달계획서·자금출처 소명 때 증빙이 됩니다.',
        src: '상증법 제68조·제69조' },
      { kind: 'tip', title: '증여공제는 10년 단위로 다시 생김',
        when: (f, p) => p.priorGift > 0,
        body: () => '이전 증여일로부터 10년이 지나면 공제 한도가 다시 생깁니다. 이전 증여일이 곧 10년이면 받는 시점을 늦추는 것만으로 세금이 줄 수 있습니다.',
        src: '상증법 제47조 제2항' },
      { kind: 'tip', title: '빌린 돈은 차용증 + 매달 실제 상환',
        when: (f, p, c) => c.plan.loan > 0,
        body: c => `차용증(금액·이자율·상환일)을 쓰고 확정일자나 공증을 받아 두세요. 원금 ${c.plan.freeLoan.toFixed(2)}억 원까지는 무이자여도 법정이자(연 ${(c.plan.legalRate * 100).toFixed(1)}%)와의 차액이 연 1천만 원 미만이라 증여로 보지 않습니다. 매달 계좌이체로 갚은 기록이 핵심입니다(현재 계획: 월 약 ${c.plan.loanMonthlyMan.toLocaleString()}만 원). 이자를 주는 경우 자녀가 이자소득세 27.5%를 원천징수·신고해야 합니다.`,
        src: '상증법 제41조의4' },
      { kind: 'tip', title: '현금 말고 계좌이체로 받기',
        when: (f, p) => p.amount > 0,
        body: () => '부모님 계좌에서 본인 계좌로 이체해 받아야 출처가 남습니다. 현금으로 찾아서 건네받으면 증여·차용 사실을 증명하기 어렵습니다.',
        src: '국세청 자금출처 조사 안내' },
      { kind: 'tip', title: '부부 공동명의 검토',
        when: f => f.married !== 'single',
        body: () => '취득세는 단독명의와 같지만, 나중에 팔 때 양도차익이 둘로 나뉘어 세율 구간이 낮아질 수 있습니다. 1주택 종합부동산세는 공동명의(각자 공제)와 단독명의 특례 중 유리한 쪽을 매년 고를 수 있습니다. 배우자 간 증여공제는 10년 6억 원입니다.',
        src: '소득세법, 종부세법 제10조의2, 상증법 제53조' },
      { kind: 'tip', title: '출산 계획이 있다면 시점 확인',
        when: f => f.homes === 0 && !f.newborn2y && f.married !== 'single',
        body: () => '대출 신청일 기준 2년 내 출산·입양 가구는 신생아 특례대출 대상이 되고, 출산 후 2년 안에 받는 증여는 출산공제가 됩니다. 위 비교표의 ‘2년 내 출산 시’ 줄에서 차이를 확인하세요.',
        src: '주택도시기금, 상증법 제53조의2' },

      { kind: 'warn', title: '자금조달계획서와 증빙',
        when: (f, p, c) => c.region && (c.region.regulated || c.region.sale84 >= 6),
        body: () => '규제지역은 모든 주택 거래, 비규제지역은 6억 원 이상 거래에 자금조달계획서를 내야 하고, 투기과열지구는 예금잔고·증여·차용 증빙도 함께 냅니다. 부모님 돈은 증여인지 차용인지 미리 정해 서류를 맞춰 두세요.',
        src: '부동산거래신고법 시행령' },
      { kind: 'warn', title: '부모님이 대출을 대신 갚아주면 증여',
        when: (f, p) => p.amount > 0,
        body: () => '내 이름 대출의 원리금·이자를 부모님이 대신 내주면 그 금액만큼 증여로 봅니다. 차용으로 받은 돈을 갚지 않고 탕감받아도 증여입니다.',
        src: '상증법 제36조' },
      { kind: 'warn', title: '차용 후 상환 기록 사후 점검',
        when: (f, p, c) => c.plan.loan > 0,
        body: () => '국세청은 부모 자녀 간 차용을 사후 관리합니다. 실제 상환 기록이 없으면 증여로 보아 증여세와 무신고·납부지연 가산세가 붙습니다.',
        src: '상증법 제45조, 국세기본법 제47조의2' },
      { kind: 'warn', title: '토지거래허가구역: 전세 끼고 못 삼',
        when: (f, p, c) => c.region && c.region.toheoje,
        body: c => `${c.region.name}은(는) 아파트를 사려면 구청 허가를 먼저 받아야 하고, 허가 후 4개월 안에 입주해 2년간 직접 살아야 합니다. 원칙적으로 전세를 끼고 살 수 없습니다.`,
        src: '부동산거래신고법 제11조·제17조' },
      { kind: 'tip', title: '세입자 있는 집도 실거주 유예로 매수 가능',
        when: (f, p, c) => c.region && c.region.toheoje && f.homes === 0 && c.date <= '2027-12-31',
        body: () => '허가구역이라도 세입자가 사는 집은 기존 임대차(갱신 1회 포함, 최대 2년)가 끝난 뒤 입주하는 조건으로 살 수 있습니다(2027-12-31까지 신청). 2026-05-12부터 계속 무주택이어야 하고, 전세보증금을 승계하는 만큼 필요한 현금이 줄어듭니다.',
        src: '토지거래허가 실거주 유예 (2026-10-01 시행)' },
      { kind: 'warn', title: '허가구역 지정 만료일 이후 기준일',
        when: (f, p, c) => c.region && c.region.scope === 'seoul' && c.date > '2026-12-31',
        body: () => '서울·경기 12곳 토지거래허가구역 지정은 2026-12-31까지이고 연장 여부는 아직 발표되지 않았습니다. 허가는 계약할 때 필요하므로 올해 안에 계약하면 허가 대상이며, 이 계산도 계약일을 오늘로 보고 판정합니다.',
        src: '10·15 대책 토지거래허가구역' },
      { kind: 'warn', title: '6개월 안에 전입·처분',
        when: (f, p, c) => c.loan && c.loan.id === 'bank',
        body: () => '수도권·규제지역에서 주담대로 집을 사면 6개월 안에 전입해야 하고, 1주택자는 6개월 안에 기존 집 명의이전까지 마쳐야 합니다. 어기면 대출을 즉시 회수하고 3년간 주택 관련 대출이 막힙니다.',
        src: '6·27 가계부채 관리방안' },
      { kind: 'warn', title: '정책대출은 실거주·추가 취득 금지',
        when: (f, p, c) => c.loan && c.loan.id !== 'bank',
        body: c => `${c.loan.name}은(는) 1개월 안에 전입해 2년 이상 실거주해야 하고, 대출 기간 중 다른 주택을 사면 회수됩니다. 소득·순자산(5.11억 이하) 기준은 대출 신청일에 다시 심사합니다.`,
        src: '주택도시기금·한국주택금융공사 상품 안내' },
      { kind: 'warn', title: '월 상환 부담',
        when: (f, p, c) => c.incomeMonthlyMan > 0 && c.monthlyMan / c.incomeMonthlyMan > 0.3,
        body: c => `최대 매수가로 사면 월 상환이 약 ${c.monthlyMan.toLocaleString()}만 원(월소득의 ${Math.round(c.monthlyMan / c.incomeMonthlyMan * 100)}%)입니다. 금리가 1%p 오르면 약 ${c.rateUpMan.toLocaleString()}만 원 더 늘어납니다. 생활비를 생각하면 30% 이내가 안전합니다.`,
        src: '자체 계산' },
    ],

    // 중개보수 상한(매매) + 법무·등기 부대비용
    fees: [
      { from: '2021-10-19',
        brokerage: p => (p < 0.5 ? 0.006 : p < 2 ? 0.005 : p < 9 ? 0.004 : p < 12 ? 0.005 : p < 15 ? 0.006 : 0.007),
        legalRatio: 0.001, src: '공인중개사법 시행규칙 (2021.10 개정)' },
    ],
  };

  // ---------------------------------------------------------------------------
  // 2부: 엔진
  // ---------------------------------------------------------------------------
  const r1 = x => Math.round(x * 10) / 10;
  const r2 = x => Math.round(x * 100) / 100;
  const r4 = x => Math.round(x * 1e4) / 1e4;  // 만원 단위

  function pick(versions, date) {
    const ok = versions.filter(v => (!v.from || v.from <= date) && (!v.until || date <= v.until));
    return ok[0] || null;
  }
  const val = (x, f) => (typeof x === 'function' ? x(f) : x);

  // 기준일에 유효한 지정 구역 중 하나라도 해당하면 true
  function inArea(zones, region, date) {
    return zones.some(z => (!z.from || z.from <= date) && (!z.until || date <= z.until) &&
      (region.scope === 'seoul' ? !!z.seoulAll : (z.gyeonggi || []).includes(region.id)));
  }
  const isRegulated = (region, date) => inArea(POLICY.regulated, region, date);
  const isToheoje = (region, date) => inArea(POLICY.toheoje, region, date);

  // 원리금균등 상환 가능 원금: 월 상환 가능액 m(억), 연이율 rate, 기간 years
  function principalFromPayment(monthly, rate, years) {
    const i = rate / 12, n = years * 12;
    return i === 0 ? monthly * n : monthly * (1 - Math.pow(1 + i, -n)) / i;
  }
  function monthlyPayment(principal, rate, years) {
    const i = rate / 12, n = years * 12;
    return i === 0 ? principal / n : principal * i / (1 - Math.pow(1 + i, -n));
  }

  function acqTax(price, f, date, areaSize) {
    const rule = pick(POLICY.acqTax, date);
    const rate = rule.rate(price);
    const base = price * (rate + rate * rule.eduRatio + (areaSize > 85 ? rule.ruralOver85 : 0));
    const reliefs = POLICY.acqRelief
      .filter(x => (!x.from || x.from <= date) && (!x.until || date <= x.until) && x.need(f) && price <= x.priceMax)
      .map(x => ({ id: x.id, name: x.name, amount: Math.min(x.max, price * rate) }));
    const best = reliefs.sort((a, b) => b.amount - a.amount)[0] || null;
    return { base: r4(base), relief: best, total: r4(base - (best ? best.amount : 0)) };
  }

  function fees(price, date) {
    const rule = pick(POLICY.fees, date);
    return r4(price * (rule.brokerage(price) + rule.legalRatio));
  }

  // 은행 주담대의 DSR 한도(스트레스 금리 가산, 기존 대출 월상환 차감)
  function bankDsrMax(f, date) {
    const bank = pick(POLICY.bankLoan, date);
    const room = Math.max(0, (f.income / 10000) * bank.dsr / 12 - (f.otherDebtMonthly || 0) / 10000);
    return principalFromPayment(room, bank.rate + bank.stressAdd, bank.years);
  }

  // 가격과 무관한 은행 대출 최대치 (최고 구간 한도와 DSR 중 작은 값)
  function loanCeiling(f, date) {
    const bank = pick(POLICY.bankLoan, date);
    return r1(Math.min(bank.capNormal, bank.capByPrice[0][1], bankDsrMax(f, date)));
  }

  // 대출 후보 전부 (적격 여부와 사유 포함). ctx: {price, regulated, f, date}
  function loanOptions(ctx) {
    const { price, regulated, f, date } = ctx;
    const income = f.income;
    const bank = pick(POLICY.bankLoan, date);
    const out = [];

    const ltv = bank.ltv[regulated ? 'regulated' : 'normal'][f.homes === 0 && f.firstTime ? 'first' : 'none'];
    const cap = regulated ? bank.capByPrice.find(([upto]) => price <= upto)[1] : bank.capNormal;
    const dsrMax = bankDsrMax(f, date);
    const bankAmt = r1(Math.min(price * ltv, cap, dsrMax));
    const bind = bankAmt >= r1(price * ltv) ? `LTV ${Math.round(ltv * 100)}%` : bankAmt >= cap ? `한도 ${cap}억` : 'DSR 40%(스트레스 금리 포함)';
    out.push({ id: 'bank', name: '시중은행 주담대', eligible: true, amount: bankAmt, rate: bank.rate, years: bank.years,
      note: `${regulated ? '규제지역' : '비규제'} · ${bind}에서 결정`, src: bank.src });

    for (const p of POLICY.policyLoans) {
      if (p.from && p.from > date) continue;
      const reasons = [];
      if (!p.need(f)) reasons.push('자격(무주택·가구 요건) 미해당');
      if (income > val(p.incomeMax, f)) reasons.push(`소득 ${val(p.incomeMax, f).toLocaleString()}만원 초과`);
      if (price > val(p.priceMax, f)) reasons.push(`주택가격 ${val(p.priceMax, f)}억 초과`);
      if (p.areaMax && (ctx.areaSize || 84) > p.areaMax) reasons.push(`전용 ${p.areaMax}㎡ 초과`);
      if (p.assetMax && (f.assets || 0) > p.assetMax) reasons.push(`순자산 ${p.assetMax}억 초과`);
      const dtiMax = principalFromPayment((income / 10000) * p.dti / 12, p.rate, 30);
      const amount = r1(Math.min(val(p.limit, f), price * val(p.ltv, f), dtiMax));
      out.push({ id: p.id, name: p.name, eligible: reasons.length === 0, reasons, amount, rate: p.rate, years: 30,
        rateText: p.rateText, note: `한도 ${val(p.limit, f)}억 · LTV ${Math.round(val(p.ltv, f) * 100)}%`, src: p.src });
    }
    return out;
  }

  function bestLoan(ctx) {
    return loanOptions(ctx).filter(o => o.eligible).sort((a, b) => b.amount - a.amount || a.rate - b.rate)[0];
  }

  // 집값 price를 사는 데 필요한 총현금 (대출 차감, 취득세·중개·법무 포함)
  function cashNeeded(ctx) {
    const loan = bestLoan(ctx);
    const tax = acqTax(ctx.price, ctx.f, ctx.date, ctx.areaSize || 84);
    const fee = fees(ctx.price, ctx.date);
    return { need: r1(ctx.price - loan.amount + tax.total + fee), loan, tax, fee };
  }

  // 가용 현금 cash로 살 수 있는 최대 집값 (필요현금이 가격에 대해 단조 증가 → 이분 탐색)
  function maxPrice(cash, base) {
    let lo = 0, hi = 100;
    if (cashNeeded({ ...base, price: 0.5 }).need > cash) return 0;
    for (let k = 0; k < 40; k++) {
      const mid = (lo + hi) / 2;
      if (cashNeeded({ ...base, price: mid }).need <= cash) lo = mid; else hi = mid;
    }
    return r1(Math.floor(lo * 10) / 10);
  }

  function giftTax(taxable, date) {
    const g = pick(POLICY.gift, date);
    if (taxable <= 0) return 0;
    const [, rate, deduct] = g.brackets.find(([upto]) => taxable <= upto);
    return r4((taxable * rate - deduct) * (1 - g.filingCredit));
  }

  // 부모 지원 구조 설계. p: {amount, split, priorGift, marriageBirth, allowLoan, loanYears}, f: 가구 사실
  // split=true면 부부가 각자 자기 부모에게 반씩 받는다고 가정
  function parentPlan(p, f, date) {
    const g = pick(POLICY.gift, date), b = pick(POLICY.borrow, date);
    const freeLoan = r2(b.freeDiffPerYear / b.legalRate);          // 무이자로 빌려도 증여가 아닌 최대 원금
    const people = p.split && f.married !== 'single' ? 2 : 1;
    const per = (p.amount || 0) / people;
    const rows = [];
    for (let k = 0; k < people; k++) {
      const exempt = Math.max(0, g.exemptAdult - (k === 0 ? p.priorGift || 0 : 0)) + (p.marriageBirth ? g.exemptMarriageBirth : 0);
      const giftFree = Math.min(per, exempt);
      let rest = per - giftFree;
      const loan = p.allowLoan ? Math.min(rest, freeLoan) : 0;
      rest -= loan;
      rows.push({ who: k === 0 ? '본인' : '배우자', exempt: r2(exempt), gift: r2(giftFree + rest), loan: r2(loan),
        tax: giftTax(rest, date), taxIfAllGift: giftTax(per - exempt, date), taxFreeMax: r2(exempt + (p.allowLoan ? freeLoan : 0)) });
    }
    const sum = k => r2(rows.reduce((s, r) => s + r[k], 0));
    const loan = sum('loan'), tax = sum('tax');
    const years = p.loanYears || 20;
    return { rows, gift: sum('gift'), loan, tax, taxIfAllGift: sum('taxIfAllGift'), net: r2((p.amount || 0) - tax),
      taxFreeMax: sum('taxFreeMax'), freeLoan, loanMonthlyMan: Math.round((loan / years / 12) * 10000), loanYears: years,
      legalRate: b.legalRate };
  }

  // 자동 수집값(policy_live.json, policy_collector.py 생성)을 규칙에 반영
  const provenance = {};
  function applyLive(live) {
    const it = (live && live.items) || {};
    if (it.bank_rate) {
      POLICY.bankLoan.forEach(v => { v.rate = it.bank_rate.value / 100; });
      provenance.bank_rate = it.bank_rate;
    }
    const bo = it.bogeumjari_rate, b = POLICY.policyLoans.find(p => p.id === 'bogeumjari');
    if (bo && b) {
      b.rate = bo.value / 100;
      b.rateText = `연 ${bo.min.toFixed(2)}~${bo.max.toFixed(2)}% (${bo.period} 공시)`;
      provenance.bogeumjari_rate = bo;
    }
    const st = it.seoul_toheoje, z = POLICY.toheoje.find(x => x.seoulAll);
    if (st && z) {
      // 서울시 목록에 '서울 25개구 아파트'가 있으면 지정 유지, 없으면 기준일 전날 종료로 본다
      z.until = st.value ? null : new Date(new Date(st.period).getTime() - 864e5).toISOString().slice(0, 10);
      provenance.seoul_toheoje = st;
    }
    return provenance;
  }

  // 화면용 출처 목록: 자동 수집 항목 + 수동 확인 항목
  function dataSources(today) {
    const bank = POLICY.bankLoan[0], bo = POLICY.policyLoans.find(p => p.id === 'bogeumjari');
    const auto = (key, label, value, fallback) => {
      const p = provenance[key];
      return p ? { label, value, kind: 'auto', source: p.source, asOf: p.period, fetched: p.fetched, url: p.url }
               : { label, value, kind: 'manual', source: fallback, asOf: POLICY.updated, stale: false };
    };
    const days = d => Math.floor((new Date(today) - new Date(d)) / 864e5);
    return [
      auto('bank_rate', '은행 주담대 금리(계산에 쓰는 값)', `연 ${(bank.rate * 100).toFixed(2)}%`, '가정값 — 자동 수집 실패'),
      auto('bogeumjari_rate', '보금자리론 금리', bo.rateText, '주택금융공사 공시 (수동)'),
      auto('seoul_toheoje', '서울 전역 아파트 토지거래허가구역', provenance.seoul_toheoje ? (provenance.seoul_toheoje.value ? '지정 중' : '해제됨') : '지정 중(~2026-12-31)', '10·15 대책 (수동)'),
      ...POLICY.manualChecks.map(m => ({ label: m.label, value: m.value, kind: 'manual', source: m.source, asOf: m.checked, stale: days(m.checked) > 60 })),
    ];
  }

  function tipsFor(f, p, c) {
    return POLICY.tips.filter(t => t.when(f, p, c)).map(t => ({ kind: t.kind, title: t.title, body: t.body(c), src: t.src }));
  }

  const api = { POLICY, tipsFor, applyLive, dataSources, pick, isRegulated, isToheoje, acqTax, fees, bankDsrMax, loanCeiling, loanOptions, bestLoan, cashNeeded, maxPrice,
    giftTax, parentPlan, monthlyPayment, principalFromPayment };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PolicyEngine = api;
})(this);
