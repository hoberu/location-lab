-- ============================================================================
-- 수도권 입지 랩 (Location Lab Pro) 데이터베이스 스키마 (총 7대 핵심 테이블)
-- ============================================================================

-- 1. 수도권 37개 핵심 시군구(법정동 앞 5자리 LAWD_CD) 마스터 및 입지 5대 원점수 테이블
CREATE TABLE IF NOT EXISTS regions (
    region_id VARCHAR(32) PRIMARY KEY,
    lawd_cd VARCHAR(5) NOT NULL UNIQUE,      -- 국토부 API 법정동코드 5자리 (예: 11440 마포구, 41135 성남 분당구)
    name VARCHAR(64) NOT NULL,               -- 지역명
    scope VARCHAR(16) NOT NULL,              -- 'seoul' 또는 'gyeonggi'
    tier INTEGER NOT NULL,                   -- 1 ~ 5급지
    sub_region VARCHAR(64) NOT NULL,         -- 권역 분류
    toheoje_flag INTEGER DEFAULT 0,          -- 토지거래허가구역 주요 적용 여부 (0/1)
    score_job INTEGER NOT NULL,              -- 직주근접·교통 점수 (0~100)
    score_edu INTEGER NOT NULL,              -- 학군·학원가 점수 (0~100)
    score_prod INTEGER NOT NULL,             -- 주거 상품성·균질성 점수 (0~100)
    score_infra INTEGER NOT NULL,            -- 생활 인프라·환경 점수 (0~100)
    score_future INTEGER NOT NULL,           -- 미래 호재·정비사업 점수 (0~100)
    hotspots TEXT,                           -- 핵심 생활권 및 리딩 단지
    stepping_stone TEXT,                     -- 다음 갈아타기 목표 권역
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. 일별/월별 실거래 집계 캐시 테이블 (전용 84㎡ 국민평형 기준)
CREATE TABLE IF NOT EXISTS region_market_stats (
    stat_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lawd_cd VARCHAR(5) NOT NULL,
    deal_ymd VARCHAR(6) NOT NULL,            -- 계약년월 (예: '202610')
    sale_84_avg_eok REAL NOT NULL,           -- 전용 84㎡ 평균 매매가 (억 원)
    jeonse_84_avg_eok REAL NOT NULL,         -- 전용 84㎡ 평균 전세가 (억 원)
    jeonse_ratio_pct REAL NOT NULL,          -- 전세가율 (%)
    trade_count INTEGER DEFAULT 0,           -- 월간 실거래 건수
    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(lawd_cd, deal_ymd),
    FOREIGN KEY(lawd_cd) REFERENCES regions(lawd_cd)
);

-- 3. PRO 전용: 대표 아파트 단지별 미세 입지(경사도·초품아·역세권 도보분수·세대수) 마스터 테이블
CREATE TABLE IF NOT EXISTS apt_complexes (
    complex_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    region_label VARCHAR(64) NOT NULL,
    scope VARCHAR(16) NOT NULL,
    micro_score REAL NOT NULL,
    station_desc VARCHAR(128) NOT NULL,
    chopuma_flag INTEGER DEFAULT 1,
    slope_grade VARCHAR(32) DEFAULT '평지',
    households INTEGER NOT NULL,
    build_year INTEGER NOT NULL,
    sale_84_eok REAL NOT NULL,
    jeonse_84_eok REAL NOT NULL,
    toheoje_flag INTEGER DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. 개별 아파트 단지 실거래 원장 (국토교통부 API 원본 적재용)
CREATE TABLE IF NOT EXISTS apt_transactions (
    tx_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lawd_cd VARCHAR(5) NOT NULL,
    umd_nm VARCHAR(64),
    apt_nm VARCHAR(128) NOT NULL,
    exclu_use_ar REAL NOT NULL,
    deal_amount_manwon INTEGER NOT NULL,
    tx_type VARCHAR(16) DEFAULT 'SALE',
    floor INTEGER,
    build_year INTEGER,
    deal_date VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. 정기 부동산 뉴스·정비사업 고시·교통 호재 수집 및 AI 감성/호재 점수 테이블
CREATE TABLE IF NOT EXISTS location_news_feeds (
    news_id INTEGER PRIMARY KEY AUTOINCREMENT,
    lawd_cd VARCHAR(5) NOT NULL,
    category VARCHAR(32) NOT NULL,           -- '정비사업 고시', '광역교통(GTX)', '학군·인프라', '실거래 동향'
    headline TEXT NOT NULL,                  -- 뉴스/고시 제목
    ai_summary TEXT,                         -- LLM 1줄 핵심 요약 (1회 요약 후 전 사용자 캐시 공유)
    score_delta REAL DEFAULT 0.0,            -- 미래호재 점수 가감폭 (-5.0 ~ +5.0)
    source_url TEXT,
    published_date VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 6. SaaS 사용자 구독 플랜·월별 크레딧 원장 및 관심지역 워치리스트 테이블
CREATE TABLE IF NOT EXISTS saas_users (
    user_id VARCHAR(64) PRIMARY KEY,
    email VARCHAR(128) NOT NULL UNIQUE,
    plan_tier VARCHAR(16) DEFAULT 'Free',    -- 'Free', 'Pro', 'Expert'
    monthly_credits_left INTEGER DEFAULT 15,
    billing_cycle_reset_date VARCHAR(10),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_watchlists (
    watch_id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id VARCHAR(64) NOT NULL,
    lawd_cd VARCHAR(5) NOT NULL,
    target_gap_eok REAL NOT NULL,            -- 목표 갭 금액 도달 시 알림톡 발송 기준
    notify_news_flag INTEGER DEFAULT 1,      -- 해당 지역 신규 정비사업/GTX 뉴스 알림 수신 여부
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES saas_users(user_id)
);

-- 7. 정기 배치(Cron) 작업 및 API/LLM 원가 모니터링 로그 테이블
CREATE TABLE IF NOT EXISTS sync_job_logs (
    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type VARCHAR(32) NOT NULL,           -- 'MOLIT_TRADE_SYNC', 'NEWS_AI_DIGEST'
    records_processed INTEGER DEFAULT 0,
    api_calls_used INTEGER DEFAULT 0,
    estimated_cost_krw REAL DEFAULT 0.0,     -- 1회 배치 실행 시 발생한 클라우드/LLM 토큰 원가(원)
    status VARCHAR(16) DEFAULT 'SUCCESS',
    executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
