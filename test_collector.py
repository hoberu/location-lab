"""collector.py 실거래 파이프라인 자체 점검. 실행: python test_collector.py (네트워크 불필요)"""
import json
import os
import tempfile
from datetime import date

import collector as c

# 1) 계약년월: 연도 넘어감
assert c.recent_months(date(2026, 1, 15)) == ["202601", "202512", "202511"]

# 2) 응답 XML 파싱 (정상 / 포털 인증 오류)
ok_xml = """<response><header><resultCode>000</resultCode><resultMsg>OK</resultMsg></header>
<body><items><item><aptNm>테스트</aptNm><dealAmount> 150,000</dealAmount><excluUseAr>84.97</excluUseAr></item></items>
<totalCount>1</totalCount></body></response>""".encode()
assert c.parse_items(ok_xml) == [{"aptNm": "테스트", "dealAmount": "150,000", "excluUseAr": "84.97"}]
err_xml = b"""<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg>
<returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode>
</cmmMsgHeader></OpenAPI_ServiceResponse>"""
try:
    c.parse_items(err_xml)
    raise AssertionError("오류 응답인데 통과함")
except RuntimeError as e:
    assert "SERVICE_KEY_IS_NOT_REGISTERED_ERROR" in str(e)

# 3) 집계 필터: 직거래·해제·면적 외·월세·갱신 제외, 중앙값
T = lambda amt, ar="84.9", gbn="중개거래", cdeal="": {"dealAmount": amt, "excluUseAr": ar, "dealingGbn": gbn, "cdealType": cdeal}
R = lambda dep, ar="84.9", rent="0", ct="신규": {"deposit": dep, "excluUseAr": ar, "monthlyRent": rent, "contractType": ct}
trades = [T("100,000"), T("120,000"), T("140,000"),
          T("50,000", gbn="직거래"), T("300,000", cdeal="O"), T("90,000", ar="59.9")]
rents = [R("60,000"), R("70,000"), R("10,000", rent="150"), R("40,000", ct="갱신"), R("80,000", ct="")]
assert c.summarize(trades, rents) == (12.0, 3, 7.0, 3)

# 4) 서킷브레이커: 초기값(실측 아님)은 바로 교체, 실측 후 ±5% 급변은 2일 보류 후 3일째 반영
r = {"sale84": 20.0, "sale84_n": 0}
assert c.apply_reading(r, "sale84", 15.0, 10) == "ok" and r["sale84"] == 15.0
assert c.apply_reading(r, "sale84", 15.5, 3) == "skip" and r["sale84"] == 15.0      # 표본 부족
assert c.apply_reading(r, "sale84", 15.5, 10) == "ok" and r["sale84"] == 15.5       # +3.3%
assert c.apply_reading(r, "sale84", 18.0, 10) == "held" and r["sale84"] == 15.5     # +16% 1일째
assert c.apply_reading(r, "sale84", 18.0, 10) == "held"                             # 2일째
assert c.apply_reading(r, "sale84", 18.0, 10) == "ok" and r["sale84"] == 18.0       # 3일째 반영
assert r["sale84_held"] == 0

# 5) 전체 동기화: 한 지역 실패해도 나머지 반영, 전부 실패면 파일 보존
def fake_fetch(url, key, cd, ymd):
    if cd == "99999":
        raise RuntimeError("timeout")
    when = {"dealYear": ymd[:4], "dealMonth": ymd[4:], "dealDay": "15"}
    if ymd < "202609":  # 대표 시세(최근 3개월) 밖의 과거 달은 다른 가격 → 대표값에 섞이면 안 됨
        return [{**T("100,000"), **when}] * 6 if url == c.TRADE_URL else [{**R("50,000"), **when}] * 6
    return [{**T("150,000"), **when}] * 6 if url == c.TRADE_URL else [{**R("80,000"), **when}] * 6

with tempfile.TemporaryDirectory() as tmp:
    path = os.path.join(tmp, "snap.json")
    snap = {"regions": {"a": {"lawd_cd": "11110", "name": "A", "sale84": 10.0, "jeonse84": 5.0},
                        "b": {"lawd_cd": "11110,99999", "name": "B", "sale84": 10.0, "jeonse84": 5.0}}}
    json.dump(snap, open(path, "w", encoding="utf-8"))
    stats = c.sync_live_prices("k", date(2026, 11, 4), path=path, fetch=fake_fetch)
    out = json.load(open(path, encoding="utf-8"))
    assert stats["ok"] == 2 and stats["errors"] == 1, stats
    assert out["regions"]["a"]["sale84"] == 15.0 and out["regions"]["a"]["jeonse84"] == 8.0
    assert out["regions"]["b"]["sale84"] == 10.0  # 실패 지역은 기존 값 유지
    assert out["months"] == ["202611", "202610", "202609"]
    tr = out["regions"]["a"]["trend"]
    assert tr["months"] == ["202606", "202607", "202608", "202609", "202610", "202611"]
    assert tr["sale"] == [10.0, 10.0, 10.0, 15.0, 15.0, 15.0] and tr["jeonse"][-1] == 8.0
    rec = out["regions"]["a"]["recent"]
    assert len(rec) == c.RECENT_N and rec[0]["date"] == "2026-11-15" and rec[0]["price"] in (15.0, 8.0)
    assert "trend" not in out["regions"]["b"]  # 실패 지역은 건드리지 않음
    cx = out["regions"]["a"]["complexes"]
    assert len(cx) == 1 and cx[0]["n"] == 36 and cx[0]["median"] == 12.5  # 6개월 × 6건, 10억·15억 반반


    json.dump({"regions": {"b": snap["regions"]["b"]}}, open(path, "w", encoding="utf-8"))
    before = open(path, encoding="utf-8").read()
    try:
        c.sync_live_prices("k", date(2026, 11, 4), path=path, fetch=fake_fetch)
        raise AssertionError("전부 실패인데 통과함")
    except RuntimeError:
        assert open(path, encoding="utf-8").read() == before


# ---------------------------------------------------------------------------
# policy_collector.py (정책 수치 자동 수집) 파서·보존 로직
# ---------------------------------------------------------------------------
import policy_collector as pc

ecos = json.dumps({"StatisticSearch": {"row": [{"TIME": "202609", "DATA_VALUE": "4.88"}, {"TIME": "202608", "DATA_VALUE": "4.66"}]}}).encode()
assert pc.parse_ecos(ecos) == (4.88, "2026-09")
try:
    pc.parse_ecos(json.dumps({"RESULT": {"CODE": "INFO-100"}}).encode())
    raise AssertionError("ECOS 오류 응답 통과")
except RuntimeError:
    pass

hf_html = """<p>기준금리 공시일 : 2026년 11월 09일 (연 %)</p><table><tr><td>u-보금자리론</td><td>5.10</td><td>5.20</td><td>5.25</td><td>5.30</td><td>5.35</td><td>5.40</td></tr>
<tr><td>아낌e보금자리론</td><td>5.00</td><td>5.10</td><td>5.15</td><td>5.20</td><td>5.25</td><td>5.30</td></tr></table>
<p>공시일 : 2026년 11월 01일 (연 %)</p><table><tr><td>아낌e보금자리론</td><td>4.90</td><td>5.00</td><td>5.05</td><td>5.10</td><td>5.15</td><td>5.20</td></tr></table>""".encode()
assert pc.parse_hf(hf_html) == {"posted": "2026-11-09", "rates": [5.0, 5.1, 5.15, 5.2, 5.25, 5.3]}

seoul = lambda rows: json.dumps({"result": rows}, ensure_ascii=False).encode()
row_all = {"crtrYmd": "2026. 11. 03", "dsgnAuthrNm": "국토교통부 장관", "dsgnTypeNm": "서울시 25개 區 전체", "frstDsgnYmd": "2025-10-20", "areaCn": "市 전체", "rmrkCn": "아파트"}
row_gn = {"crtrYmd": "2026. 11. 03", "dsgnAuthrNm": "서울시장", "dsgnTypeNm": "강남·송파·서초·용산구", "frstDsgnYmd": "2025-03-24", "areaCn": "區 전체", "rmrkCn": "‘아파트’ 용도"}
s1 = pc.parse_seoul(seoul([row_gn, row_all]))
assert s1["all_apartments"] is True and s1["asof"] == "2026-11-03"
s2 = pc.parse_seoul(seoul([row_gn]))
assert s2["all_apartments"] is False and s2["hash"] != s1["hash"]

with tempfile.TemporaryDirectory() as tmp:
    out, alert = os.path.join(tmp, "live.json"), os.path.join(tmp, "alert.md")
    seoul_now = {"v": s1}
    def ok_bank(prev, today): return {"value": 4.88, "period": "2026-09"}
    def bad(prev, today): raise RuntimeError("down")
    def seoul_src(prev, today): return {"value": seoul_now["v"]["all_apartments"], "period": "2026-11-03", "hash": seoul_now["v"]["hash"]}
    pc.collect(out, alert, {"bank_rate": ok_bank, "seoul_toheoje": seoul_src}, date(2026, 11, 4))
    assert not os.path.exists(alert)                      # 첫 수집은 비교 대상 없음
    # 은행 소스 장애 + 서울 목록 변경 → 은행 값은 이전 것 유지, 변경 알림 생성
    seoul_now["v"] = s2
    res = pc.collect(out, alert, {"bank_rate": bad, "seoul_toheoje": seoul_src}, date(2026, 11, 5))
    assert res["items"]["bank_rate"]["value"] == 4.88 and "bank_rate" in res["errors"]
    assert "해제됨" in open(alert, encoding="utf-8").read()
    # 전부 실패하면 파일을 건드리지 않음
    before = open(out, encoding="utf-8").read()
    try:
        pc.collect(out, alert, {"bank_rate": bad}, date(2026, 11, 6))
        raise AssertionError("전부 실패인데 통과")
    except RuntimeError:
        assert open(out, encoding="utf-8").read() == before
# 금리 급변·범위 이상은 거부
for v, prev in ((20.0, None), (7.0, {"value": 4.9})):
    try:
        pc._check_rate(v, prev)
        raise AssertionError(f"금리 {v} 통과")
    except ValueError:
        pass

# 단지별 집계: 직거래 제외, 거래 많은 순
cs = c.complex_summary([
    {**T("100,000"), "aptNm": "가", "umdNm": "동1", "dealYear": "2026", "dealMonth": "10", "dealDay": "3", "buildYear": "2010"},
    {**T("120,000"), "aptNm": "가", "umdNm": "동1", "dealYear": "2026", "dealMonth": "11", "dealDay": "1", "buildYear": "2010"},
    {**T("90,000"), "aptNm": "나", "umdNm": "동2", "dealYear": "2026", "dealMonth": "09", "dealDay": "9", "buildYear": "1999"},
    {**T("50,000", gbn="직거래"), "aptNm": "나", "umdNm": "동2", "dealYear": "2026", "dealMonth": "09", "dealDay": "9"},
])
assert [(x["apt"], x["n"], x["median"], x["last"]) for x in cs] == [("가", 2, 11.0, "2026-11-01"), ("나", 1, 9.0, "2026-09-09")]

print("test_collector OK")
