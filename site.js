/* 사이트 공통 설정 — 운영자가 값만 채우면 켜진다. 비어 있으면 아무것도 불러오지 않는다.
 *   ga4           : Google Analytics 4 측정 ID (예: 'G-XXXXXXXXXX'). 방문·이벤트 통계
 *   subscribeUrl  : 정책 변경 알림 신청 폼 주소 (Google 설문지·스티비 구독 폼 등). 비어 있으면 신청 카드 숨김
 *   adsenseClient : Google AdSense 게시자 ID (예: 'ca-pub-1234567890123456'). 계산기 페이지에서만 자동 광고
 *   operatorName  : 운영자(개인정보 보호책임자) 이름 또는 상호 — 개인정보처리방침·약관에 표시
 *   contactEmail  : 문의 이메일 — 비어 있으면 GitHub 문의 게시판으로 안내
 *   donateUrl     : 후원 링크 (예: 'https://toss.me/아이디', 카카오페이 송금 코드·투네이션 주소). 비어 있으면 후원 버튼 숨김.
 *                   계좌번호를 화면에 직접 적지 말 것 — 공개 계좌는 '통장 묶기' 사기(소액 입금 후 지급정지 신고)에 노출됨
 * 입력한 금액·조건은 통계로 보내지 않는다. 이벤트에는 이름만 담는다.
 */
window.SITE_CONFIG = {
  ga4: '',
  subscribeUrl: '',
  adsenseClient: '',
  operatorName: '',
  contactEmail: '',
  donateUrl: '',
  contactUrl: 'https://github.com/hoberu/location-lab/issues',
};

(function () {
  const cfg = window.SITE_CONFIG;
  window.track = function () {};
  window.loadAds = function () {
    if (!/^ca-pub-\d{10,20}$/.test(cfg.adsenseClient)) return;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + cfg.adsenseClient;
    document.head.appendChild(s);
  };
  // 문의처·운영자 표시 (data-site="contact" / "operator" 요소에 채움)
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-site="contact"]').forEach(function (el) {
      const email = /^[^\s@<>"']+@[^\s@<>"']+\.[a-z]{2,}$/i.test(cfg.contactEmail) ? cfg.contactEmail : '';
      el.textContent = email || 'GitHub 문의 게시판';
      if (el.tagName === 'A') el.href = email ? 'mailto:' + email : cfg.contactUrl;
    });
    // 후원 버튼: donateUrl이 https 주소일 때만 보이게
    const donate = /^https:\/\/[^\s"'<>]+$/.test(cfg.donateUrl) ? cfg.donateUrl : '';
    document.querySelectorAll('[data-site="donate"]').forEach(function (el) {
      if (!donate) return;
      el.href = donate;
      el.classList.remove('hidden');
      el.addEventListener('click', function () { window.track('donate_click'); });
    });
    document.querySelectorAll('[data-site="operator"]').forEach(function (el) {
      el.textContent = cfg.operatorName || '운영자 정보 등록 예정(사업자등록 후 표시)';
    });
  });
  if (!/^G-[A-Z0-9]+$/.test(cfg.ga4)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = 'https://www.googletagmanager.com/gtag/js?id=' + cfg.ga4;
  document.head.appendChild(s);
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  // 공유 링크의 #c= 조건(금액 포함)이 주소와 함께 전송되지 않도록 해시를 뺀 주소만 보낸다
  window.gtag('config', cfg.ga4, { page_location: location.origin + location.pathname + location.search });
  window.track = function (name) { window.gtag('event', name); };
})();

// 어려운 용어 풀이 — 단락(section 등)마다 처음 나오는 용어에 점선 밑줄과 * 표시.
// 마우스를 올리거나 누르면(모바일은 누르기) 짧은 설명이 뜬다. 화면이 다시 그려져도 자동으로 다시 표시.
// 용어를 더하려면 아래 TERMS에 [제목, [화면에서 찾을 말들], 설명]을 추가한다.
(function () {
  const TERMS = [
    ['스트레스 DSR', ['스트레스 DSR', '스트레스 금리'], '금리가 오를 때를 대비해, 대출 한도(DSR)를 계산할 때만 실제 금리에 더하는 가상의 금리입니다. 수도권·규제지역은 3%p(변동형 기준, 혼합형은 80%·주기형은 40%만)라 그만큼 한도가 줄어듭니다. 실제로 내는 이자가 늘지는 않습니다.'],
    ['DSR', ['DSR'], '총부채원리금상환비율. 1년 동안 갚는 모든 대출의 원금+이자가 연소득에서 차지하는 비율입니다. 은행 대출은 40%를 넘을 수 없어서, 소득이 대출 한도를 정합니다.'],
    ['LTV', ['LTV'], '주택담보인정비율. 집값 대비 빌릴 수 있는 비율입니다. 10억 원 집에 LTV 40%면 최대 4억 원까지 빌릴 수 있습니다.'],
    ['DTI', ['DTI'], '총부채상환비율. 이번 주택담보대출의 원리금과 다른 대출의 이자만 연소득과 비교합니다. DSR보다 느슨해서 디딤돌·보금자리론 같은 정책대출에 쓰입니다.'],
    ['주담대', ['주담대', '주택담보대출'], '주택담보대출. 사는 집을 담보로 은행에서 빌리는 돈입니다.'],
    ['규제지역', ['규제지역', '투기과열지구', '조정대상지역'], '투기과열지구·조정대상지역. 대출 비율(LTV)이 낮고 집값 구간별 한도가 있으며, 모든 거래에 자금조달계획서를 내야 합니다. 지금은 서울 전역과 경기 일부입니다.'],
    ['토지거래허가구역', ['토지거래허가구역', '토허제'], '집을 사기 전에 구청 허가를 받아야 하는 곳입니다. 허가 후 4개월 안에 입주해 2년 이상 직접 살아야 해서, 전세를 끼고 사는 것(갭투자)이 원칙적으로 안 됩니다.'],
    ['갭투자', ['갭투자'], '전세 보증금을 끼고, 집값과 전세금의 차이(갭)만큼의 현금으로 집을 사는 방법입니다.'],
    ['생애최초', ['생애최초'], '세대원 모두 집을 가져본 적이 없는 사람이 처음 집을 사는 경우입니다. 대출 비율 우대(LTV 70%)와 취득세 감면(최대 200만 원)을 받을 수 있습니다.'],
    ['디딤돌대출', ['디딤돌'], '주택도시기금의 무주택 서민용 집 구입 대출입니다. 소득·집값 기준이 있고 금리가 시중은행보다 낮습니다.'],
    ['신생아 특례대출', ['신생아 특례'], '대출 신청일 기준 2년 안에 아이를 낳거나 입양한 무주택 가구가 받는 저금리 집 구입 대출입니다. 집값 9억 원·전용 85㎡ 이하, 최대 4억 원.'],
    ['보금자리론', ['보금자리론'], '한국주택금융공사의 장기 고정금리 대출입니다. 집값 6억 원 이하이고, 금리가 대출 기간 내내 같습니다.'],
    ['취득세', ['취득세'], '집을 살 때 한 번 내는 지방세입니다. 1주택 기준 집값의 1~3%에 지방교육세(취득세의 10%)가 붙고, 전용 85㎡ 초과는 농어촌특별세 0.2%가 더해집니다.'],
    ['중개보수', ['중개보수', '복비'], '공인중개사에게 내는 수수료(복비)입니다. 집값 구간별 법정 상한(0.4~0.7%) 안에서 협의하고, 부가세는 따로 붙을 수 있습니다.'],
    ['혼인·출산 공제', ['혼인·출산 증여공제', '혼인·출산 공제', '출산공제'], '혼인신고 전후 2년 안이나 아이 출생·입양 후 2년 안에 부모님께 받으면, 기본 5천만 원에 더해 1억 원이 더 공제됩니다(혼인·출산 합쳐 평생 1억 원).'],
    ['증여공제', ['증여공제', '증여재산공제'], '증여세 없이 받을 수 있는 금액입니다. 성인 자녀는 부모님(두 분 합산)께 10년 동안 5천만 원까지 세금이 없습니다.'],
    ['차용증', ['차용증'], '부모님께 돈을 "빌렸다"는 계약서입니다. 금액·이자율·갚는 날을 적고, 실제로 계좌이체로 갚은 기록이 있어야 증여로 보지 않습니다.'],
    ['법정이자율', ['법정이자율', '법정이자'], '부모·자녀 사이 돈거래에서 세법이 기준으로 보는 이자율(연 4.6%)입니다. 이보다 적게 받으면 차액을 증여로 보지만, 그 차액이 1년에 1천만 원 미만이면 증여로 보지 않습니다.'],
    ['자금조달계획서', ['자금조달계획서'], '집 살 돈을 어디서 마련했는지(예금·대출·증여 등) 신고하는 서류입니다. 규제지역은 모든 거래, 그 밖의 지역은 6억 원 이상 거래에 냅니다.'],
    ['원리금균등', ['원리금균등'], '매달 같은 금액(원금+이자)을 갚는 방식입니다. 이 사이트의 월 상환액은 모두 이 방식으로 계산합니다.'],
    ['과세표준', ['과세표준'], '공제를 뺀 뒤 세율을 곱하는 금액입니다. 예: 3억 원 증여 - 공제 5천만 원 = 과세표준 2억 5천만 원.'],
    ['처분조건부', ['처분조건부'], '이미 집이 있는 사람이 정해진 기간(보통 6개월) 안에 기존 집을 팔기로 약속하고 새 집 대출을 받는 조건입니다.'],
    ['순자산', ['순자산'], '가진 재산(예금·집·전세보증금 등)에서 빚을 뺀 금액입니다. 정책대출은 부부 합산 순자산 기준이 있습니다.'],
    ['변동형', ['변동형'], '대출 금리가 시장 금리를 따라 주기적으로(보통 6개월) 바뀌는 상품입니다. 대출 한도 계산 때 스트레스 금리를 100% 더해서 한도가 가장 작게 나옵니다.'],
    ['혼합형', ['혼합형'], '처음 몇 년(보통 5년)은 고정금리, 그 뒤 변동금리로 바뀌는 상품입니다. 대출 한도 계산 때 스트레스 금리를 80%만 더합니다.'],
    ['주기형', ['주기형'], '5년 등 정해진 주기마다 금리를 다시 정하는 상품입니다. 대출 한도 계산 때 스트레스 금리를 40%만 더해서 한도가 더 나옵니다.'],
    ['실거래가', ['실거래가'], '국토교통부에 신고된 실제 계약 가격입니다. 계약 후 30일 안에 신고하므로 최근 거래는 늦게 반영될 수 있습니다.'],
    ['호가', ['호가'], '집주인이 팔겠다고 내놓은 희망 가격입니다. 실제로 거래된 가격(실거래가)과 다를 수 있습니다.'],
    ['전용면적', ['전용면적', '국민평형', '전용 59㎡', '전용 84㎡', '전용 114㎡'], '현관 안쪽, 실제로 사는 공간의 면적입니다. 전용 84㎡(국민평형)는 흔히 34평형, 59㎡는 24평형이라고 부릅니다.'],
    ['입지 점수', ['입지 점수'], '교통·학군·생활편의 등을 이 사이트가 자체 기준으로 매긴 점수입니다. 공식 통계가 아니라 참고용입니다.'],
  ];
  const INFO = {}, WORD = {};
  TERMS.forEach(function (t) { INFO[t[0]] = t[2]; t[1].forEach(function (w) { WORD[w] = t[0]; }); });
  const words = Object.keys(WORD).sort(function (a, b) { return b.length - a.length; });   // 긴 말 먼저(스트레스 DSR > DSR)
  const RE = new RegExp(words.map(function (w) { return w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }).join('|'), 'g');
  const SKIP = 'script,style,textarea,input,select,option,button,a,summary,canvas,svg,.term,#termTip,#printReport,[data-noterm]';
  const BLOCK = 'section,details,main > *,[id^="view"] > *,footer,header';

  function mark() {
    const seen = new Map();
    const first = function (blk, title) {   // 이 단락에서 처음이면 true
      let s = seen.get(blk);
      if (!s) { s = new Set(Array.from(blk.querySelectorAll('.term'), function (e) { return e.dataset.term; })); seen.set(blk, s); }
      if (s.has(title)) return false;
      s.add(title);
      return true;
    };
    const nodes = [];
    const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n; (n = tw.nextNode());) {
      RE.lastIndex = 0;
      const p = n.parentElement;
      if (p && RE.test(n.nodeValue) && !p.closest(SKIP) && p.getClientRects().length) nodes.push(n);
    }
    nodes.forEach(function (node) {
      const blk = node.parentElement.closest(BLOCK) || document.body;
      const text = node.nodeValue;
      let frag = null, last = 0, m;
      RE.lastIndex = 0;
      while ((m = RE.exec(text))) {
        const title = WORD[m[0]];
        if (!first(blk, title)) continue;
        frag = frag || document.createDocumentFragment();
        frag.append(text.slice(last, m.index));
        const s = document.createElement('span');
        s.className = 'term';
        s.dataset.term = title;
        s.tabIndex = 0;
        s.setAttribute('role', 'button');
        s.textContent = m[0];
        frag.append(s);
        last = m.index + m[0].length;
      }
      if (frag) { frag.append(text.slice(last)); node.replaceWith(frag); }
    });
  }

  let tip, cur = null, pinned = false, hideT = 0;
  function show(el, pin) {
    clearTimeout(hideT);
    const title = el.dataset.term;
    tip.textContent = '';
    const b = document.createElement('strong');
    b.textContent = title;
    tip.append(b, document.createTextNode(' ' + INFO[title]));
    if (cur && cur !== el) cur.removeAttribute('aria-describedby');
    cur = el; pinned = pin;
    el.setAttribute('aria-describedby', 'termTip');
    tip.hidden = false;
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
    tip.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    tip.style.top = Math.max(8, r.bottom + h + 8 > innerHeight ? r.top - h - 6 : r.bottom + 6) + 'px';
  }
  function hide() {
    if (!tip || tip.hidden) return;
    tip.hidden = true;
    if (cur) cur.removeAttribute('aria-describedby');
    cur = null; pinned = false;
  }
  const termOf = function (t) { return t && t.closest ? t.closest('.term') : null; };
  const inTip = function (t) { return t && t.closest ? t.closest('#termTip') : null; };

  document.addEventListener('DOMContentLoaded', function () {
    const css = document.createElement('style');
    css.textContent =
      '.term{border-bottom:1px dotted currentColor;cursor:help}' +
      '.term::after{content:"*";font-size:.75em;font-weight:700;vertical-align:super;line-height:0;margin-left:1px;opacity:.7}' +
      '.term:focus-visible{outline:2px solid #6366f1;outline-offset:1px;border-radius:2px}' +
      '#termTip{position:fixed;z-index:9999;max-width:min(300px,calc(100vw - 16px));padding:8px 10px;border-radius:8px;background:#0f172a;color:#f8fafc;' +
      'font-size:12px;font-weight:400;line-height:1.55;text-align:left;white-space:normal;box-shadow:0 8px 24px rgba(0,0,0,.25)}' +
      '#termTip strong{color:#fcd34d;font-weight:700}#termTip[hidden]{display:none}' +
      '@media print{.term{border:0}.term::after{content:none}#termTip{display:none}}';
    document.head.appendChild(css);
    tip = document.createElement('div');
    tip.id = 'termTip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);

    // 화면이 다시 그려지거나 탭이 바뀌면(클래스 변경) 잠시 뒤 다시 표시. 표시하는 동안은 관찰을 멈춰 무한 반복 방지
    const OPTS = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'open', 'hidden'] };
    let t = 0;
    const obs = new MutationObserver(function () { clearTimeout(t); t = setTimeout(run, 150); });
    function run() { obs.disconnect(); mark(); obs.observe(document.body, OPTS); }
    run();

    document.addEventListener('pointerover', function (e) {
      if (e.pointerType !== 'mouse') return;
      const el = termOf(e.target);
      if (el) show(el, pinned && cur === el);
      else if (inTip(e.target)) clearTimeout(hideT);
    });
    document.addEventListener('pointerout', function (e) {
      if (e.pointerType !== 'mouse' || pinned) return;
      if (termOf(e.target) || inTip(e.target)) { clearTimeout(hideT); hideT = setTimeout(hide, 200); }
    });
    // 누르기: 열고 고정 / 다시 누르면 닫기. 카드·라벨 위 용어를 눌러도 카드 동작은 하지 않음
    document.addEventListener('click', function (e) {
      const el = termOf(e.target);
      if (el) {
        e.preventDefault(); e.stopPropagation();
        if (cur === el && pinned) hide(); else show(el, true);
      } else if (!inTip(e.target)) hide();
    }, true);
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') return hide();
      const el = termOf(e.target);
      if (el && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        if (cur === el && pinned) hide(); else show(el, true);
      }
    });
    addEventListener('scroll', hide, true);
    addEventListener('resize', hide);
  });
})();
