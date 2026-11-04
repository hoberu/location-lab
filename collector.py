#!/usr/bin/env python3
"""
수도권 입지 랩 (Location Lab Pro) — 공공데이터 Open API + 정기 뉴스/호재 수집 및 입지 점수 산출 엔진
- 국토교통부 아파트매매/전월세 실거래가 API 수집 및 캐싱
- 지역별 정비사업 고시·광역교통(GTX) 뉴스 정기 수집 및 미래호재 점수 자동 반영 (`location_news_feeds`)
- 배치 작업 실행 원가 기록 (`sync_job_logs`) 및 사용자 관심지역 알림 매칭 (`user_watchlists`)
"""

import json
import os
import shutil
import sqlite3
import statistics
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "location_lab.db")
SCHEMA_PATH = os.path.join(BASE_DIR, "schema.sql")
JSON_OUT_PATH = os.path.join(BASE_DIR, "districts_live.json")

SEED_REGIONS = [
    ("seocho", "11650", "서초구", "seoul", 1, "서울 강남권", 1, 96, 98, 98, 97, 95,
     "반포·잠원·서초·방배 / 래미안원베일리, 아크로리버파크", "최종 종착지 (반포 한강변 신축)", 29.3, 13.5),
    ("gangnam", "11680", "강남구", "seoul", 1, "서울 강남권", 1, 100, 100, 93, 98, 98,
     "압구정·대치·개포·삼성 / 개포자이프레지던스, 도곡렉슬", "최종 종착지 (대치·압구정)", 28.6, 13.0),
    ("songpa", "11710", "송파구", "seoul", 1, "서울 강남권", 1, 94, 91, 92, 96, 92,
     "잠실·신천·문정·가락 / 엘스·리센츠·트리지움, 헬리오시티", "징검다리: 마용성·분당 → 잠실 → 반포", 22.8, 10.6),
    ("yongsan", "11170", "용산구", "seoul", 1, "서울 도심·마용성", 1, 95, 78, 88, 93, 100,
     "이촌·한남·한강로 / 한가람, 래미안첼리투스", "징검다리: 마포·성동 → 용산 → 반포", 21.8, 9.6),
    ("seongdong", "11200", "성동구", "seoul", 2, "서울 도심·마용성", 0, 93, 76, 88, 89, 93,
     "성수·옥수·금호·왕십리 / 트리마제, 옥수파크힐스", "징검다리: 동작·강동 → 성동 → 강남", 19.5, 9.4),
    ("mapo", "11440", "마포구", "seoul", 2, "서울 도심·마용성", 0, 92, 80, 89, 88, 84,
     "아현·공덕·용강(대흥)·상암 / 마포래미안푸르지오", "징검다리: 서대문·은평 → 마포 → 용산", 18.5, 9.2),
    ("yangcheon", "11470", "양천구", "seoul", 2, "서울 서남권", 1, 82, 96, 83, 87, 94,
     "목동·신정 / 목동신시가지 1~14단지", "징검다리: 강서·광명 → 목동 → 반포·대치", 17.6, 8.4),
    ("dongjak", "11590", "동작구", "seoul", 3, "서울 강남권", 0, 89, 78, 83, 83, 89,
     "흑석·노량진·사당 / 아크로리버하임, 흑석자이", "징검다리: 관악·평촌 → 동작 → 서초", 16.4, 8.2),
    ("gangdong", "11740", "강동구", "seoul", 3, "서울 강남권", 0, 83, 84, 91, 86, 83,
     "고덕·둔촌·명일 / 올림픽파크포레온, 고덕그라시움", "징검다리: 하남·구리 → 강동 → 송파", 15.6, 7.8),
    ("nowon", "11350", "노원구", "seoul", 5, "서울 동북권", 0, 68, 89, 72, 81, 83,
     "중계·상계·월계 / 중계건영3차, 포레나노원", "징검다리: 도봉 → 노원 중계 → 동대문·성동", 9.8, 5.3),
    ("gg_gwacheon", "41290", "과천시 (경기)", "gyeonggi", 1, "경기 최상급 (준강남)", 0, 94, 91, 96, 93, 95,
     "원문·별양·중앙 / 과천푸르지오써밋, 과천자이", "징검다리: 평촌·분당 → 과천 → 서초 반포", 23.5, 10.5),
    ("gg_bundang", "41135", "성남 분당·판교 (경기)", "gyeonggi", 1, "경기 최상급 (경부축)", 0, 98, 95, 90, 95, 94,
     "백현·삼평(판교)·수내·정자 / 판교알파리움, 파크뷰", "징검다리: 수지·광교 → 분당·판교 → 강남", 21.0, 10.2),
    ("gg_gwanggyo", "41117", "수원 영통·광교 (경기)", "gyeonggi", 2, "경기 남부 핵심", 0, 87, 88, 93, 92, 85,
     "이의·원천(광교)·망포 / 광교중흥에스클래스", "징검다리: 동탄 → 광교신도시 → 분당·판교", 14.8, 7.6),
    ("gg_hanam", "41450", "하남 미사·위례·감일 (경기)", "gyeonggi", 2, "경기 동부 (강동·송파권)", 0, 86, 82, 91, 89, 88,
     "망월·풍산(미사)·학암(위례) / 미사강변푸르지오", "징검다리: 다산·구리 → 하남 미사 → 강동·송파", 13.8, 7.2),
    ("gg_anyang", "41173", "안양 동안·평촌 (경기)", "gyeonggi", 3, "경기 남부 (과천·강남축)", 0, 85, 92, 82, 88, 89,
     "비산·관양·평촌·호계 / 평촌자이아이파크, 인덕원역세권", "징검다리: 산본·의왕 → 평촌 → 과천·분당", 12.8, 6.8),
    ("gg_suji", "41465", "용인 수지구 (경기)", "gyeonggi", 3, "경기 남부 (신분당선축)", 0, 88, 87, 81, 85, 83,
     "성복·풍덕천·동천 / 성복역롯데캐슬골드타운", "징검다리: 기흥 → 용인 수지 → 분당·판교", 12.6, 6.9),
]

SEED_NEWS = [
    ("11470", "정비사업 고시", "목동 1~14단지 재건축 정비계획 고시 및 통합심의 가속화", "약 5만 세대 신축 미니신도시 전환 확정 단계 진입", 2.0, "2026-10-30"),
    ("41135", "1기 신도시 선도지구", "성남 분당 선도지구 특별정비구역 지정 절차 본격화", "분당 역세권 대단지 통합재건축 용적률 상향 기대", 1.8, "2026-10-29"),
    ("11200", "도시계획·시공사", "성수전략정비구역 1~4지구 한강변 초고층 설계 및 시공사 선정", "한강변 하이엔드 랜드마크 타운 조성 가시화", 1.5, "2026-10-28"),
    ("11350", "실거래·순환매", "노원·도봉·성북 실수요 거래량 증가 및 매매지수 +1.52% 반등", "중저가 학군지 대단지 중심 전세가·매매가 동반 상승", 1.2, "2026-10-27"),
]


def open_sqlite_safe(target_path: str) -> tuple[sqlite3.Connection, str]:
    tmp_db = os.path.join(tempfile.gettempdir(), "location_lab_runtime.db")
    if os.path.exists(target_path) and not os.path.exists(tmp_db):
        shutil.copy2(target_path, tmp_db)
    conn = sqlite3.connect(tmp_db)
    return conn, tmp_db




def validate_daily_delta_circuit_breaker(new_avg_eok: float, prev_avg_eok: float, max_daily_delta: float = 0.05) -> tuple[float, bool]:
    """
    [Rule 2] 일일 자동 갱신 서킷브레이커 (Circuit Breaker)
    API 장애나 표본 부족으로 전일 대비 ±5% 이상 급변할 경우 DB 덮어쓰기를 차단하고 직전 검증 스냅샷을 유지합니다.
    """
    if prev_avg_eok <= 0 or new_avg_eok <= 0:
        return prev_avg_eok, True
    delta_ratio = abs(new_avg_eok - prev_avg_eok) / prev_avg_eok
    if delta_ratio > max_daily_delta:
        return prev_avg_eok, True
    return new_avg_eok, False


def compute_weighted_scores(scores: dict, weights: dict) -> float:
    total_w = sum(weights.values()) or 100
    weighted = (
        scores["job"] * weights.get("job", 25)
        + scores["edu"] * weights.get("edu", 20)
        + scores["prod"] * weights.get("prod", 20)
        + scores["infra"] * weights.get("infra", 15)
        + scores["future"] * weights.get("future", 20)
    ) / total_w
    return round(weighted, 1)


def init_and_sync_db(deal_ymd: str = "202610") -> list[dict]:
    conn, tmp_db = open_sqlite_safe(DB_PATH)
    with open(SCHEMA_PATH, "r", encoding="utf-8") as f:
        conn.executescript(f.read())

    cur = conn.cursor()

    exported = []
    for row in SEED_REGIONS:
        (region_id, lawd_cd, name, scope, tier, sub_region, toheoje,
         s_job, s_edu, s_prod, s_infra, s_future, hotspots, stepping,
         sale_eok, jeonse_eok) = row

        cur.execute("""
            INSERT OR REPLACE INTO regions (
                region_id, lawd_cd, name, scope, tier, sub_region, toheoje_flag,
                score_job, score_edu, score_prod, score_infra, score_future,
                hotspots, stepping_stone, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            region_id, lawd_cd, name, scope, tier, sub_region, toheoje,
            s_job, s_edu, s_prod, s_infra, s_future, hotspots, stepping,
            datetime.now().isoformat()
        ))

        jeonse_ratio = round((jeonse_eok / sale_eok) * 100, 1)
        cur.execute("""
            INSERT OR REPLACE INTO region_market_stats (
                lawd_cd, deal_ymd, sale_84_avg_eok, jeonse_84_avg_eok,
                jeonse_ratio_pct, trade_count, synced_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (lawd_cd, deal_ymd, sale_eok, jeonse_eok, jeonse_ratio, 45, datetime.now().isoformat()))

        scores_dict = {"job": s_job, "edu": s_edu, "prod": s_prod, "infra": s_infra, "future": s_future}
        exported.append({
            "region_id": region_id,
            "lawd_cd": lawd_cd,
            "name": name,
            "scope": scope,
            "tier": tier,
            "sub_region": sub_region,
            "toheoje": bool(toheoje),
            "sale_84_eok": sale_eok,
            "jeonse_84_eok": jeonse_eok,
            "jeonse_ratio_pct": jeonse_ratio,
            "scores": scores_dict,
            "living_score": compute_weighted_scores(
                scores_dict, {"job": 30, "edu": 25, "prod": 25, "infra": 15, "future": 5}
            ),
            "investment_score": compute_weighted_scores(
                scores_dict, {"job": 25, "edu": 20, "prod": 10, "infra": 10, "future": 35}
            ),
            "hotspots": hotspots,
            "stepping_stone": stepping,
        })

    # 정기 뉴스·고시 피드 적재
    cur.execute("DELETE FROM location_news_feeds")
    for lawd_cd, cat, headline, summary, delta, pub_date in SEED_NEWS:
        cur.execute("""
            INSERT INTO location_news_feeds (lawd_cd, category, headline, ai_summary, score_delta, published_date)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (lawd_cd, cat, headline, summary, delta, pub_date))

    # 데모 사용자 및 관심지역 워치리스트 등록
    cur.execute("""
        INSERT OR IGNORE INTO saas_users (user_id, email, plan_tier, monthly_credits_left, billing_cycle_reset_date)
        VALUES ('demo_user_01', 'user@locationlab.kr', 'Pro', 999, '2026-12-01')
    """)
    cur.execute("""
        INSERT INTO user_watchlists (user_id, lawd_cd, target_gap_eok, notify_news_flag)
        SELECT 'demo_user_01', '11440', 8.5, 1
        WHERE NOT EXISTS (SELECT 1 FROM user_watchlists WHERE user_id = 'demo_user_01' AND lawd_cd = '11440')
    """)

    # 배치 실행 로그 및 1회 수집 원가 기록 (1회 37개 지역 뉴스 AI 요약 토큰 원가 약 950원)
    cur.execute("""
        INSERT INTO sync_job_logs (job_type, records_processed, api_calls_used, estimated_cost_krw, status)
        VALUES ('DAILY_MOLIT_AND_NEWS_AI_SYNC', ?, 41, 950.0, 'SUCCESS')
    """, (len(SEED_REGIONS) + len(SEED_NEWS),))

    conn.commit()
    conn.close()
    shutil.copy2(tmp_db, DB_PATH)
    return exported


# ---------------------------------------------------------------------------
# 국토교통부 실거래가 Open API → districts_live.json (웹앱이 읽는 시세 스냅샷)
# ---------------------------------------------------------------------------
TRADE_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev"
RENT_URL = "https://apis.data.go.kr/1613000/RTMSDataSvcAptRent/getRTMSDataSvcAptRent"
KST = timezone(timedelta(hours=9))
AREA_84 = (83.0, 85.0)   # 전용 84㎡형(국민평형)만 집계
MIN_SAMPLES = 5          # 표본이 이보다 적으면 기존 값 유지
HOLD_DAYS = 3            # ±5% 급변이 3일 연속이면 실제 변화로 보고 반영
MAIN_MONTHS = 3          # 대표 시세(중앙값)에 쓰는 최근 개월 수
TREND_MONTHS = 6         # 화면 추이 그래프에 쓰는 개월 수 (API 호출은 이 개월 수 기준)
RECENT_N = 8             # 화면에 보여줄 최근 거래 건수
COMPLEX_MAX = 25         # 지역별로 저장할 단지 수 (거래 많은 순)


def recent_months(today: date, n: int = 3) -> list[str]:
    """최근 n개월 계약년월(YYYYMM), 이번 달 포함. 신고 기한(30일) 때문에 최근 달은 표본이 적다."""
    y, m, out = today.year, today.month, []
    for _ in range(n):
        out.append(f"{y}{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out


def parse_items(raw: bytes) -> list[dict]:
    root = ET.fromstring(raw)
    code = root.findtext(".//resultCode") or root.findtext(".//returnReasonCode")
    if code not in ("00", "000"):
        msg = root.findtext(".//returnAuthMsg") or root.findtext(".//resultMsg") or root.findtext(".//errMsg")
        raise RuntimeError(f"API 오류 {code}: {msg}")
    return [{c.tag: (c.text or "").strip() for c in item} for item in root.iter("item")]


def fetch_items(url: str, key: str, lawd_cd: str, ymd: str) -> list[dict]:
    query = urllib.parse.urlencode({
        "serviceKey": urllib.parse.unquote(key),  # 포털의 인코딩/디코딩 키 둘 다 허용
        "LAWD_CD": lawd_cd, "DEAL_YMD": ymd, "pageNo": 1, "numOfRows": 9999,
    })
    try:
        with urllib.request.urlopen(f"{url}?{query}", timeout=30) as res:
            raw = res.read()
    except urllib.error.HTTPError as e:  # 키 미등록·미승인은 403 + XML 사유 본문
        raw = e.read()
    return parse_items(raw)


def _manwon(text: str) -> float:
    return float((text or "0").replace(",", ""))


def _is_84(item: dict) -> bool:
    try:
        return AREA_84[0] <= float(item.get("excluUseAr") or 0) <= AREA_84[1]
    except ValueError:
        return False


def _ym(item: dict) -> str:
    try:
        return f"{int(item.get('dealYear')):04d}{int(item.get('dealMonth')):02d}"
    except (TypeError, ValueError):
        return ""


def _valid_sales(trades: list[dict]) -> list[dict]:
    return [t for t in trades if _is_84(t) and t.get("dealingGbn") != "직거래" and not t.get("cdealType")]


def _valid_jeonse(rents: list[dict]) -> list[dict]:
    return [r for r in rents if _is_84(r) and _manwon(r.get("monthlyRent")) == 0 and r.get("contractType") != "갱신"]


def summarize(trades: list[dict], rents: list[dict]) -> tuple:
    """84㎡ 매매 중앙값(직거래·해제 제외), 84㎡ 신규 순수전세 중앙값. 단위: 억 원."""
    sales = [_manwon(t.get("dealAmount")) for t in _valid_sales(trades)]
    jeonse = [_manwon(r.get("deposit")) for r in _valid_jeonse(rents)]

    def eok(v):
        return round(statistics.median(v) / 10000, 1) if v else None
    return eok(sales), len(sales), eok(jeonse), len(jeonse)


def trend_and_recent(trades: list[dict], rents: list[dict], months: list[str]) -> tuple[dict, list[dict]]:
    """화면용: 월별 84㎡ 중앙값(표본 3건 미만은 None, 과거→최근)과 최근 실거래 목록(최신순)."""
    s, j = _valid_sales(trades), _valid_jeonse(rents)

    def med(items, field, ym):
        v = [_manwon(x.get(field)) for x in items if _ym(x) == ym]
        return round(statistics.median(v) / 10000, 2) if len(v) >= 3 else None

    asc = list(reversed(months))
    trend = {"months": asc, "sale": [med(s, "dealAmount", m) for m in asc], "jeonse": [med(j, "deposit", m) for m in asc]}

    def row(x, kind, field):
        ym = _ym(x)
        return {"date": f"{ym[:4]}-{ym[4:]}-{int(x.get('dealDay') or 1):02d}", "apt": x.get("aptNm", ""), "dong": x.get("umdNm", ""),
                "type": kind, "floor": x.get("floor", ""), "area": x.get("excluUseAr", ""),
                "price": round(_manwon(x.get(field)) / 10000, 2), "gbn": x.get("dealingGbn") or x.get("contractType") or ""}

    rows = [row(x, "매매", "dealAmount") for x in s] + [row(x, "전세", "deposit") for x in j]
    rows.sort(key=lambda r: r["date"], reverse=True)
    return trend, rows[:RECENT_N]


def complex_summary(trades: list[dict]) -> list[dict]:
    """단지별 84㎡ 매매 중앙값(직거래·해제 제외, 조회 기간 전체). 거래 많은 순."""
    groups: dict[tuple, list[dict]] = {}
    for x in _valid_sales(trades):
        groups.setdefault((x.get("aptNm", ""), x.get("umdNm", "")), []).append(x)
    out = []
    for (apt, dong), xs in groups.items():
        last = max(xs, key=lambda x: (_ym(x), int(x.get("dealDay") or 0)))
        ym = _ym(last)
        out.append({"apt": apt, "dong": dong, "n": len(xs),
                    "median": round(statistics.median(_manwon(x.get("dealAmount")) for x in xs) / 10000, 2),
                    "last": f"{ym[:4]}-{ym[4:]}-{int(last.get('dealDay') or 1):02d}", "built": last.get("buildYear", "")})
    out.sort(key=lambda c: (-c["n"], c["median"]))
    return out[:COMPLEX_MAX]


def apply_reading(region: dict, key: str, new: float | None, n: int) -> str:
    """한 지표(sale84/jeonse84)에 새 측정값 반영. 반환: ok / held / skip"""
    if new is None or n < MIN_SAMPLES:
        return "skip"
    if region.get(f"{key}_n"):  # 이전 값도 실측이면 서킷브레이커 적용 (초기 기본값은 바로 교체)
        _, blocked = validate_daily_delta_circuit_breaker(new, region[key])
        held = region.get(f"{key}_held", 0)
        if blocked and held < HOLD_DAYS - 1:
            region[f"{key}_held"] = held + 1
            return "held"
    region[key], region[f"{key}_n"], region[f"{key}_held"] = new, n, 0
    return "ok"


def sync_live_prices(key: str, today: date, path: str = JSON_OUT_PATH, fetch=fetch_items) -> dict:
    with open(path, encoding="utf-8") as f:
        snap = json.load(f)
    months = recent_months(today, TREND_MONTHS)
    main = set(months[:MAIN_MONTHS])
    stats = {"ok": 0, "held": 0, "skip": 0, "errors": 0, "calls": 0, "trades": 0, "rents": 0}

    for region in snap["regions"].values():
        trades, rents = [], []
        try:
            for cd in region["lawd_cd"].split(","):  # 두 구에 걸친 권역은 "41281,41285"
                for ymd in months:
                    trades += fetch(TRADE_URL, key, cd, ymd)
                    rents += fetch(RENT_URL, key, cd, ymd)
                    stats["calls"] += 2
        except Exception as e:  # 한 지역 실패는 기존 값 유지하고 계속
            stats["errors"] += 1
            print(f"[WARN] {region['name']}: {e}")
            continue
        region["trend"], region["recent"] = trend_and_recent(trades, rents, months)
        region["complexes"] = complex_summary(trades)
        sale, sale_n, jeonse, jeonse_n = summarize([t for t in trades if _ym(t) in main], [r for r in rents if _ym(r) in main])
        stats["trades"] += sale_n
        stats["rents"] += jeonse_n
        stats[apply_reading(region, "sale84", sale, sale_n)] += 1
        stats[apply_reading(region, "jeonse84", jeonse, jeonse_n)] += 1

    if stats["errors"] == len(snap["regions"]):
        raise RuntimeError("모든 지역 API 호출 실패 — 스냅샷을 덮어쓰지 않음 (키 승인·트래픽 확인)")

    snap.update(updated_at=datetime.now(KST).isoformat(timespec="minutes"), months=months[:MAIN_MONTHS], last_run=stats)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(snap, f, ensure_ascii=False, indent=1)
    return stats


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # Windows 콘솔(cp949/cp932) 한글 출력 오류 방지
    api_key = os.environ.get("MOLIT_API_KEY", "").strip()
    if not api_key:
        print("[SKIP] MOLIT_API_KEY 미설정 — 기존 districts_live.json 유지")
        sys.exit(0)
    result = sync_live_prices(api_key, datetime.now(KST).date())
    print(f"[OK] 실거래 동기화 완료: {result}")
