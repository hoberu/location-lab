#!/usr/bin/env python3
"""
정책 수치 자동 수집 → policy_live.json (policy.js가 읽어 수동 값을 덮어씀)

공식 기관이 공개하는 값만 가져온다. 소스별로 실패하면 이전 값을 그대로 두고 errors에 기록한다.
  - bank_rate      : 한국은행 ECOS, 예금은행 주택담보대출 금리(신규취급액 기준, 월)
  - bogeumjari_rate: 한국주택금융공사 보금자리론 금리안내 (공시일별 고정금리표)
  - seoul_toheoje  : 서울부동산정보광장 토지거래허가구역 지정현황 (서울시)
서울 허가구역 목록이 바뀌면 policy_alert.md를 남겨 워크플로우가 GitHub 이슈로 알린다.
환경변수 ECOS_API_KEY (없으면 ECOS 공개 샘플키 — 최근 10건만 조회 가능)
"""
import hashlib
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(BASE_DIR, "policy_live.json")
ALERT_PATH = os.path.join(BASE_DIR, "policy_alert.md")
KST = timezone(timedelta(hours=9))
UA = {"User-Agent": "Mozilla/5.0 (LocationLab policy collector)"}

ECOS_URL = "https://ecos.bok.or.kr/api/StatisticSearch/{key}/json/kr/1/10/121Y006/M/{start}/{end}/BECBLA0302"
HF_URL = "https://www.hf.go.kr/ko/sub01/sub01_01_04.do"
SEOUL_URL = "https://land.seoul.go.kr/land/other/searchAppointStatusList.do"
MAX_RATE_JUMP = 1.5  # %p. 이보다 크게 바뀌면 오류로 보고 이전 값 유지


def http(url: str, data: bytes | None = None) -> bytes:
    req = urllib.request.Request(url, data=data, headers=UA, method="POST" if data is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as res:
        return res.read()


def _check_rate(v: float, prev: dict | None) -> float:
    if not 1.0 <= v <= 15.0:
        raise ValueError(f"금리 범위 이상: {v}")
    if prev and abs(v - prev["value"]) > MAX_RATE_JUMP:
        raise ValueError(f"이전 값 {prev['value']}% 대비 급변: {v}%")
    return v


# --- 파서 (네트워크 없이 테스트 가능) -------------------------------------------
def parse_ecos(raw: bytes) -> tuple[float, str]:
    d = json.loads(raw)
    if "StatisticSearch" not in d:
        raise RuntimeError(f"ECOS 오류: {d.get('RESULT', d)}")
    rows = sorted(d["StatisticSearch"]["row"], key=lambda r: r["TIME"])
    last = rows[-1]
    return float(last["DATA_VALUE"]), f"{last['TIME'][:4]}-{last['TIME'][4:]}"


def parse_hf(raw: bytes) -> dict:
    """가장 최근 공시일의 아낌e보금자리론 만기별 금리(10~50년)."""
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", raw.decode("utf-8", "replace"), flags=re.S)
    txt = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", t)))
    tables = re.findall(r"공시일\s*:\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일(.*?)(?=공시일\s*:|$)", txt)
    if not tables:
        raise RuntimeError("보금자리론 금리표를 찾지 못함 (페이지 구조 변경?)")
    best = max(tables, key=lambda m: (int(m[0]), int(m[1]), int(m[2])))
    row = re.search(r"아낌e\s*보금자리론((?:\s+\d+\.\d+){3,6})", best[3])
    if not row:
        raise RuntimeError("아낌e보금자리론 행을 찾지 못함")
    rates = [float(x) for x in row.group(1).split()]
    return {"posted": f"{best[0]}-{int(best[1]):02d}-{int(best[2]):02d}", "rates": rates}


def parse_seoul(raw: bytes) -> dict:
    rows = json.loads(raw).get("result") or []
    if not rows:
        raise RuntimeError("서울시 지정현황 응답이 비어 있음")
    zones = [{"by": r.get("dsgnAuthrNm", ""), "name": r.get("dsgnTypeNm", ""), "since": r.get("frstDsgnYmd", ""),
              "area": r.get("areaCn", ""), "note": r.get("rmrkCn", "")} for r in rows]
    all_apt = any("국토교통부" in z["by"] and "25" in z["name"] and "아파트" in z["note"] for z in zones)
    asof = (rows[0].get("crtrYmd") or "").replace(". ", "-").replace(".", "-").strip("-")
    digest = hashlib.sha256(json.dumps(zones, ensure_ascii=False, sort_keys=True).encode()).hexdigest()[:16]
    return {"all_apartments": all_apt, "asof": asof, "zones": zones, "hash": digest}


# --- 소스별 수집 ----------------------------------------------------------------
def fetch_bank_rate(prev, today: date) -> dict:
    key = os.environ.get("ECOS_API_KEY", "").strip() or "sample"
    start = (today.replace(day=1) - timedelta(days=200)).strftime("%Y%m")
    v, period = parse_ecos(http(ECOS_URL.format(key=urllib.parse.quote(key), start=start, end=today.strftime("%Y%m"))))
    return {"value": _check_rate(v, prev), "unit": "%", "period": period,
            "source": "한국은행 ECOS · 예금은행 주택담보대출 금리(신규취급액, 121Y006)", "url": "https://ecos.bok.or.kr"}


def fetch_bogeumjari(prev, today: date) -> dict:
    hf = parse_hf(http(HF_URL))
    mid = hf["rates"][min(3, len(hf["rates"]) - 1)]  # 30년 만기(4번째 열)를 대표값으로
    return {"value": _check_rate(mid, prev), "min": min(hf["rates"]), "max": max(hf["rates"]), "unit": "%",
            "period": hf["posted"], "source": "한국주택금융공사 · 아낌e보금자리론 고정금리(30년 대표)", "url": HF_URL}


def fetch_seoul_toheoje(prev, today: date) -> dict:
    s = parse_seoul(http(SEOUL_URL, data=b""))
    return {"value": s["all_apartments"], "period": s["asof"], "zones": s["zones"], "hash": s["hash"],
            "source": "서울부동산정보광장 · 토지거래허가구역 지정현황(서울시)", "url": "https://land.seoul.go.kr/land/other/appointStatusSeoul.do"}


SOURCES = {"bank_rate": fetch_bank_rate, "bogeumjari_rate": fetch_bogeumjari, "seoul_toheoje": fetch_seoul_toheoje}


def collect(path: str = OUT_PATH, alert_path: str = ALERT_PATH, sources=SOURCES, today: date | None = None) -> dict:
    today = today or datetime.now(KST).date()
    try:
        with open(path, encoding="utf-8") as f:
            old = json.load(f)
    except FileNotFoundError:
        old = {"items": {}}
    items, errors, alerts = dict(old.get("items", {})), {}, []

    for name, fn in sources.items():
        prev = old.get("items", {}).get(name)
        try:
            item = fn(prev, today)
            item["fetched"] = today.isoformat()
            items[name] = item
            if name == "seoul_toheoje" and prev and prev.get("hash") != item["hash"]:
                alerts.append(f"- 서울 토지거래허가구역 지정현황이 바뀌었습니다 (기준일 {item['period']}). "
                              f"서울 전역 아파트 지정: {'유지' if item['value'] else '**해제됨**'}. {item.get('url', '')}")
        except Exception as e:  # 한 소스 실패는 이전 값 유지
            errors[name] = f"{type(e).__name__}: {e}"
            print(f"[WARN] {name}: {errors[name]}")

    if len(errors) == len(sources):
        raise RuntimeError(f"모든 정책 소스 수집 실패 — 파일 유지: {errors}")
    out = {"updated_at": datetime.now(KST).isoformat(timespec="minutes"), "items": items, "errors": errors}
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    if alerts:
        with open(alert_path, "w", encoding="utf-8") as f:
            f.write("정책 데이터 자동 감지 결과, 아래 항목이 바뀌었습니다. `policy.js` 규칙과 맞는지 확인해 주세요.\n\n" + "\n".join(alerts) + "\n")
    return out


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    res = collect()
    print(f"[OK] 정책 데이터 {len(res['items'])}개 · 오류 {len(res['errors'])}개: "
          + ", ".join(f"{k}={v['value']}({v['period']})" for k, v in res["items"].items()))
