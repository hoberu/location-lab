# 🔒 수도권 입지 랩 Pro — 비공개(Private) 사이트 배포 & 운영·수익화 가이드

## 1. 검색엔진 노출 없이 '비공개 상태'로 사이트에 올리는 2가지 방법 (비용 0원)

### 방법 A: 마우스 드래그 1분 배포 (Cloudflare Pages 또는 Netlify Drop — 가장 추천)
1. [Cloudflare Pages](https://pages.cloudflare.com/) 또는 [Netlify Drop](https://app.netlify.com/drop)에 무료 가입합니다.
2. 이 압축파일(`location_lab_fullstack.zip`)의 압축을 푼 폴더를 마우스로 끌어다 놓습니다.
3. 즉시 `https://나만의주소.pages.dev` 링크가 생성됩니다 (`vercel.json` 설정으로 구글·네이버 검색로봇 수집이 자동 차단됨).
4. **초대코드 잠금 활성화**: 지인이나 베타 테스터에게 링크를 보낼 때 `https://나만의주소.pages.dev/?private=1` 로 보내면 **초대코드(`LAB2026`)를 입력해야만 화면이 열리는 비공개 베타 모드**로 작동합니다.

### 방법 B: 파이썬 백엔드 + SQLite DB까지 클라우드 서버에 올리기 (Render / Railway)
1. GitHub에서 **Private(비공개) 저장소**를 만들고 이 폴더의 파일들을 업로드합니다.
2. [Render.com](https://render.com/)에서 `New Web Service` → 해당 비공개 저장소를 연결하면 포함된 `Dockerfile`과 `render.yaml`을 인식해 자동으로 서버가 구축됩니다.
3. 환경변수 `BETA_PASSCODE=원하는비밀번호`를 설정하면 서버 단에서 외부인을 완벽히 차단할 수 있습니다.

## 2. 일일 무인 자동 운영 방법 (주 15분 관리)
- **일일 배치 실행**: 서버의 Cron 또는 GitHub Actions로 매일 새벽 06:00에 `python3 collector.py`를 실행합니다.
- **4중 무결성 방어벽**: `collector.py` 내장 `filter_outlier_transactions()`가 특수 직거래 및 ±20% 이상치를 자동 제외하고, `validate_daily_delta_circuit_breaker()`가 전일 대비 ±5% 이상 급변 시 DB 덮어쓰기를 자동 중단(Rollback)합니다.
