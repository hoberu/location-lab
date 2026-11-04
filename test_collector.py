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
    return [T("150,000")] * 6 if url == c.TRADE_URL else [R("80,000")] * 6

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

    json.dump({"regions": {"b": snap["regions"]["b"]}}, open(path, "w", encoding="utf-8"))
    before = open(path, encoding="utf-8").read()
    try:
        c.sync_live_prices("k", date(2026, 11, 4), path=path, fetch=fake_fetch)
        raise AssertionError("전부 실패인데 통과함")
    except RuntimeError:
        assert open(path, encoding="utf-8").read() == before

print("test_collector OK")
