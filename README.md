# 수도권 입지 랩 (Location Lab Pro) — 풀스택 백엔드 & 공공데이터 수집 패키지

본 패키지는 웹 프론트엔드(`seoul_real_estate_analyzer.html`)와 연동하여 실제 상용 유료 서비스(SaaS)로 운영할 수 있도록 구성된 **공공데이터 Open API 수집기 + SQLite/PostgreSQL 데이터베이스 + 백엔드 REST API 서버** 코드입니다.

## 1. 구성 파일

* `schema.sql` — 수도권 시군구(법정동코드 5자리 `LAWD_CD`), 5대 입지 원점수, 월별 전용 84㎡ 매매·전세 실거래 통계, 개별 아파트 실거래 원장, SaaS 사용자 크레딧 관리 테이블 정의서
* `collector.py` — 국토교통부 아파트매매 실거래가 Open API(`apis.data.go.kr`)를 호출해 전용 84㎡(75~86㎡) 거래건을 필터링·평균 내고, 입지 점수를 계산해 `location_lab.db`와 `districts_live.json`에 저장하는 배치 스크립트
* `server.py` — 사용자의 가용 현금(종잣돈), 연소득(스트레스 DSR 한도 산출), 5대 입지 가중치를 입력받아 실시간 순위와 진입 가능 여부를 JSON으로 반환하는 REST API 서버

## 2. 빠른 실행 방법 (로컬 및 클라우드 서버)

```bash
# 1) 초기 DB 생성 및 실거래 데이터 동기화 (환경변수 미설정 시 내장 검증 데이터로 즉시 빌드)
export MOLIT_API_KEY="공공데이터포털에서_발급받은_Decoding_인증키"
python3 collector.py

# 2) 백엔드 API 동작 테스트
python3 server.py --test-once

# 3) REST API 서버 실행 (기본 포트 8080)
python3 server.py --port 8080
```

## 3. 매일 새벽 자동 업데이트 (Cron 설정 예시)

사용자가 접속할 때마다 정부 API를 직접 호출하지 않고, 하루 1회 새벽 3시에 `collector.py`를 실행해 DB를 갱신하면 서버 비용과 API 트래픽을 95% 이상 절감할 수 있습니다.

```cron
0 3 * * * /usr/bin/python3 /path/to/location_lab_fullstack/collector.py >> /var/log/location_lab_sync.log 2>&1
```

## 4. 상용 서비스 출시 시 저작권·법적 준수 사항

1. **독자적 방법론 명칭 사용**: 특정 도서 제목이나 저자 필명을 상업적 UI에 노출하지 않고, `징검다리 갈아타기 모델`, `일자리·교통 결절점 모델`, `전세레버리지 저평가 모델` 등 자체 정량 프레임워크 명칭을 사용합니다.
2. **면책 조항(Disclaimer) 고지**: 본 서비스는 공공데이터 기반의 정량적 입지 정보 분석 도구이며, 공인중개사법상 중개 행위나 자본시장법상 개별 투자 자문이 아님을 약관 및 하단에 명시합니다.
