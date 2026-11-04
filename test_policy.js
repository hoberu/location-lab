// policy.js 엔진 자체 점검. 실행: node test_policy.js
const assert = require('assert');
const E = require('./policy.js');
const D = '2026-11-04';
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.006, `${msg}: ${a} != ${b}`);
const base = { homes: 0, firstTime: false, married: 'single', children: 0, newborn2y: false, dualIncome: false, otherDebtMonthly: 0, income: 12000, assets: 3 };

// 증여세: 과세표준 1억 → 1천만 × 0.97, 2억 → (4천 - 1천) × 0.97
near(E.giftTax(1, D), 0.097, '증여세 1억');
near(E.giftTax(2, D), 0.291, '증여세 2억');
assert.strictEqual(E.giftTax(0, D), 0);

// 부모 지원 3억(혼자, 차용 허용): 공제 0.5 + 무이자 차용 2.17 + 나머지 0.33 증여(과세)
let p = E.parentPlan({ amount: 3, allowLoan: true }, base, D);
near(p.loan, 2.17, '무이자 차용');
near(p.tax, 0.032, '차용 구조 세금');
near(p.taxIfAllGift, 0.388, '전액 증여 세금');
near(p.net, 3 - p.tax, '실수령');
// 결혼 예정 부부가 각자 + 혼인공제: 1인 1.5억까지 0원, 세금 0원 최대 = 2 × (1.5 + 2.17)
p = E.parentPlan({ amount: 3, split: true, marriageBirth: true, allowLoan: true }, { ...base, married: 'planned' }, D);
assert.strictEqual(p.tax, 0);
assert.strictEqual(p.loan, 0);
near(p.taxFreeMax, 7.34, '세금 0원 최대');
// 미혼이면 split 무시
assert.strictEqual(E.parentPlan({ amount: 1, split: true }, base, D).rows.length, 1);
// 10년 내 기존 증여가 공제를 깎음
near(E.parentPlan({ amount: 0.5, priorGift: 0.3 }, base, D).tax, E.giftTax(0.3, D), '기존 증여 합산');

// 취득세: 6억 1.1%, 7.5억 2.2%, 9억 3.3%
near(E.acqTax(6, base, D, 84).total, 0.066, '취득세 6억');
near(E.acqTax(7.5, base, D, 84).total, 0.165, '취득세 7.5억');
near(E.acqTax(9, base, D, 84).total, 0.297, '취득세 9억');
// 생애최초 감면 200만(2028년까지), 12억 초과·기간 후엔 없음
const ft = { ...base, firstTime: true };
near(E.acqTax(5, ft, D, 84).total, 0.035, '생애최초 감면');
assert.strictEqual(E.acqTax(13, ft, D, 84).relief, null);
assert.strictEqual(E.acqTax(5, ft, '2029-01-02', 84).relief, null);

// 규제지역·허가구역: 날짜에 따라 자동 변경
const dongtan = { id: 'gg_dongtan', scope: 'gyeonggi' }, gangnam = { id: 'gangnam', scope: 'seoul' }, goyang = { id: 'gg_goyang', scope: 'gyeonggi' };
assert.strictEqual(E.isRegulated(dongtan, '2026-06-30'), false);
assert.strictEqual(E.isRegulated(dongtan, D), true);
assert.strictEqual(E.isRegulated(gangnam, D), true);
assert.strictEqual(E.isRegulated(goyang, D), false);
assert.strictEqual(E.isToheoje(gangnam, '2027-01-15'), false);  // 현 지정 만료 후 (연장 시 규칙 추가)
assert.strictEqual(E.isToheoje(dongtan, '2027-01-15'), true);

// 은행 주담대: 20억(규제) → LTV 8억보다 구간 한도 4억이 작음
const bank = (price, f, regulated = true) => E.loanOptions({ price, regulated, f, date: D, areaSize: 84 }).find(o => o.id === 'bank');
assert.strictEqual(bank(20, base).amount, 4);
assert.strictEqual(bank(30, base).amount, 2);
// 10억(규제, 일반) → LTV 40% = 4억
assert.strictEqual(bank(10, base).amount, 4);
// 생애최초 12억 → LTV 8.4억, 한도 6억, DSR(소득 1.2억·스트레스 7.8%)이 더 작음
const dsr = Math.round(E.bankDsrMax(base, D) * 10) / 10;
assert.ok(dsr > 4 && dsr < 6, `DSR 한도 ${dsr}`);
assert.strictEqual(bank(12, ft).amount, dsr);
// 기존 대출 월상환이 있으면 DSR 한도 감소
assert.ok(E.bankDsrMax({ ...base, otherDebtMonthly: 100 }, D) < E.bankDsrMax(base, D));

// 정책대출 자격: 신생아 특례는 9억 이하·85㎡ 이하·순자산 5.11억 이하
const nb = { ...base, newborn2y: true, children: 1 };
const nbOpt = (price, f = nb, areaSize = 84) => E.loanOptions({ price, regulated: true, f, date: D, areaSize }).find(o => o.id === 'newborn');
assert.strictEqual(nbOpt(8).eligible, true);
assert.strictEqual(nbOpt(8).amount, 4);
assert.strictEqual(nbOpt(9.5).eligible, false);
assert.strictEqual(nbOpt(8, nb, 114).eligible, false);
assert.strictEqual(nbOpt(8, { ...nb, assets: 6 }).eligible, false);
assert.strictEqual(nbOpt(8, { ...nb, income: 15000 }).eligible, false);
assert.strictEqual(nbOpt(8, { ...nb, income: 15000, dualIncome: true }).eligible, true);

// 최대 매수가: 그 가격은 살 수 있고 조금 더 비싸면 못 삼
const ctx = { regulated: true, f: base, date: D, areaSize: 84 };
const mp = E.maxPrice(6, ctx);
assert.ok(E.cashNeeded({ ...ctx, price: mp }).need <= 6, `최대가 ${mp}`);
assert.ok(E.cashNeeded({ ...ctx, price: mp + 0.3 }).need > 6);
assert.ok(E.maxPrice(8, ctx) > mp);  // 현금이 늘면 최대가도 증가

// 팁: 결혼 예정이면 혼인공제 팁, 차용이 있으면 차용 팁·경고
const plan = E.parentPlan({ amount: 3, allowLoan: true }, { ...base, married: 'planned' }, D);
const tips = E.tipsFor({ ...base, married: 'planned' }, { amount: 3, allowLoan: true }, { plan, region: { ...gangnam, name: '강남구', regulated: true, toheoje: true, sale84: 28 }, loan: { id: 'bank' }, monthlyMan: 300, rateUpMan: 30, incomeMonthlyMan: 1000, date: D });
const titles = tips.map(t => t.title).join('|');
['혼인·출산 증여공제', '차용증', '토지거래허가구역', '자금조달계획서', '실거주 유예'].forEach(k => assert.ok(titles.includes(k), `팁 누락: ${k}`));
tips.forEach(t => assert.ok(t.body && t.src, `팁 내용 누락: ${t.title}`));

console.log('test_policy OK');

// 자동 수집값 반영 (policy_live.json)
{
  const E2 = (() => { delete require.cache[require.resolve('./policy.js')]; return require('./policy.js'); })();
  E2.applyLive({ items: {
    bank_rate: { value: 4.88, period: '2026-09', source: 'ECOS', fetched: '2026-11-04' },
    bogeumjari_rate: { value: 5.2, min: 5.0, max: 5.3, period: '2026-11-09', source: 'HF', fetched: '2026-11-04' },
    seoul_toheoje: { value: true, period: '2026-11-03', source: '서울시', fetched: '2026-11-04' } } });
  assert.ok(Math.abs(E2.POLICY.bankLoan[0].rate - 0.0488) < 1e-9);
  assert.ok(E2.POLICY.policyLoans.find(p => p.id === 'bogeumjari').rateText.includes('5.00~5.30'));
  assert.strictEqual(E2.isToheoje({ id: 'gangnam', scope: 'seoul' }, '2027-03-01'), true);   // 서울시 목록에 있으면 유지
  const src = E2.dataSources('2026-11-04');
  assert.strictEqual(src.filter(s => s.kind === 'auto').length, 3);
  assert.ok(E2.dataSources('2027-02-01').some(s => s.stale));                                 // 60일 지나면 재확인
  E2.applyLive({ items: { seoul_toheoje: { value: false, period: '2027-01-10', source: '서울시', fetched: '2027-01-10' } } });
  assert.strictEqual(E2.isToheoje({ id: 'gangnam', scope: 'seoul' }, '2027-01-15'), false);  // 목록에서 빠지면 해제
  assert.strictEqual(E2.isToheoje({ id: 'gangnam', scope: 'seoul' }, '2027-01-05'), true);
  console.log('test_policy applyLive OK');
}
