/* 사이트 공통 설정 — 운영자가 값만 채우면 켜진다. 비어 있으면 아무것도 불러오지 않는다.
 *   ga4           : Google Analytics 4 측정 ID (예: 'G-XXXXXXXXXX'). 방문·이벤트 통계
 *   subscribeUrl  : 정책 변경 알림 신청 폼 주소 (Google 설문지·스티비 구독 폼 등). 비어 있으면 신청 카드 숨김
 *   adsenseClient : Google AdSense 게시자 ID (예: 'ca-pub-1234567890123456'). 계산기 페이지에서만 자동 광고
 *   operatorName  : 운영자(개인정보 보호책임자) 이름 또는 상호 — 개인정보처리방침·약관에 표시
 *   contactEmail  : 문의 이메일 — 비어 있으면 GitHub 문의 게시판으로 안내
 * 입력한 금액·조건은 통계로 보내지 않는다. 이벤트에는 이름만 담는다.
 */
window.SITE_CONFIG = {
  ga4: '',
  subscribeUrl: '',
  adsenseClient: '',
  operatorName: '',
  contactEmail: '',
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
