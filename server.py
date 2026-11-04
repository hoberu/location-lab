#!/usr/bin/env python3
"""
수도권 입지 랩 (Location Lab Pro) — 백엔드 REST API 서버
- /api/regions : 서울·경기 핵심 권역 맞춤형 입지 스코어링 및 가용 자산 진입 시뮬레이션
- /api/transfer-simulate : [PRO] 기존 주택 매도 → 상급지 갈아타기 세금·부대비용 공제 및 목표 단지 매칭
- /api/complexes : [PRO] 개별 아파트 단지 미세 입지(초품아·경사도·역세권·세대수) 조회

실행 방법:
  python3 collector.py
  python3 server.py --port 8080
"""

import argparse
import json
import os
import sqlite3
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

from collector import DB_PATH, compute_weighted_scores, init_and_sync_db, open_sqlite_safe


def query_ranked_regions(weights: dict, seed_eok: float, income_manwon: float, scope: str = "all") -> dict:
    if not os.path.exists(DB_PATH):
        init_and_sync_db("202610")

    conn, _ = open_sqlite_safe(DB_PATH)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    sql = """
        SELECT r.*, s.sale_84_avg_eok, s.jeonse_84_avg_eok, s.jeonse_ratio_pct, s.trade_count
        FROM regions r
        JOIN region_market_stats s ON r.lawd_cd = s.lawd_cd
    """
    params = []
    if scope in ("seoul", "gyeonggi"):
        sql += " WHERE r.scope = ?"
        params.append(scope)

    rows = cur.execute(sql, params).fetchall()
    conn.close()

    loan_limit = round(min(12.0, max(1.5, (income_manwon / 10000.0) * 5.0)), 1)

    items = []
    for r in rows:
        scores = {
            "job": r["score_job"],
            "edu": r["score_edu"],
            "prod": r["score_prod"],
            "infra": r["score_infra"],
            "future": r["score_future"],
        }
        custom_score = compute_weighted_scores(scores, weights)
        live_score = compute_weighted_scores(scores, {"job": 30, "edu": 25, "prod": 25, "infra": 15, "future": 5})
        invest_score = compute_weighted_scores(scores, {"job": 25, "edu": 20, "prod": 10, "infra": 10, "future": 35})

        sale = r["sale_84_avg_eok"]
        jeonse = r["jeonse_84_avg_eok"]
        ltv_cap = 0.50 if (r["scope"] == "seoul" and r["tier"] == 1) else 0.60
        max_loan = min(loan_limit, round(sale * ltv_cap, 1))

        need_live_cash = round(sale - max_loan + sale * 0.025, 1)
        need_gap_cash = round(sale - jeonse + sale * 0.025, 1)

        items.append({
            "region_id": r["region_id"],
            "lawd_cd": r["lawd_cd"],
            "name": r["name"],
            "scope": r["scope"],
            "tier": r["tier"],
            "sub_region": r["sub_region"],
            "toheoje": bool(r["toheoje_flag"]),
            "sale_84_eok": sale,
            "jeonse_84_eok": jeonse,
            "jeonse_ratio_pct": r["jeonse_ratio_pct"],
            "custom_score": custom_score,
            "living_score": live_score,
            "investment_score": invest_score,
            "need_live_cash_eok": need_live_cash,
            "need_gap_cash_eok": need_gap_cash,
            "can_live": seed_eok >= need_live_cash,
            "can_gap": (not bool(r["toheoje_flag"])) and (seed_eok >= need_gap_cash),
            "hotspots": r["hotspots"],
            "stepping_stone": r["stepping_stone"],
        })

    items.sort(key=lambda x: x["custom_score"], reverse=True)
    for idx, it in enumerate(items, 1):
        it["rank"] = idx

    return {
        "input_summary": {
            "seed_eok": seed_eok,
            "income_manwon": income_manwon,
            "estimated_loan_limit_eok": loan_limit,
            "weights": weights,
            "scope": scope,
        },
        "total_count": len(items),
        "accessible_living_count": sum(1 for x in items if x["can_live"]),
        "accessible_gap_count": sum(1 for x in items if x["can_gap"]),
        "regions": items,
    }


def simulate_transfer(current_sale: float, current_loan: float, extra_cash: float, new_income: float, tax_exempt: bool = True) -> dict:
    """
    [PRO] 기존 주택 매도 후 세금·중개보수·이사비를 공제한 순 가용 갈아타기 자금 및 상급지 매칭
    """
    sell_brokerage = current_sale * 0.0045
    if tax_exempt:
        cap_gains_tax = max(0.0, (current_sale - 12.0) * 0.08)
    else:
        cap_gains_tax = max(0.0, (current_sale * 0.25) * 0.22)

    net_proceeds = round(max(0.0, current_sale - current_loan - sell_brokerage - cap_gains_tax + extra_cash), 2)
    new_loan_limit = round(min(12.0, max(1.5, (new_income / 10000.0) * 5.0)), 1)
    gross_power = net_proceeds + new_loan_limit
    acq_tax_rate = 0.033 if gross_power > 9.0 else (0.022 if gross_power > 6.0 else 0.011)
    buy_costs = round(gross_power * (acq_tax_rate + 0.005) + 0.05, 2)

    return {
        "net_proceeds_eok": net_proceeds,
        "new_loan_limit_eok": new_loan_limit,
        "estimated_buy_costs_eok": buy_costs,
        "max_target_live_price_eok": round(max(0.0, gross_power - buy_costs), 1),
        "max_target_gap_budget_eok": round(max(0.0, net_proceeds - buy_costs), 1),
    }


class LocationLabHandler(BaseHTTPRequestHandler):
    def _send_json(self, data: dict, status: int = 200):
        body = json.dumps(data, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)

        if parsed.path == "/api/regions":
            weights = {
                "job": int(qs.get("w_job", [25])[0]),
                "edu": int(qs.get("w_edu", [20])[0]),
                "prod": int(qs.get("w_prod", [20])[0]),
                "infra": int(qs.get("w_infra", [15])[0]),
                "future": int(qs.get("w_future", [20])[0]),
            }
            seed = float(qs.get("seed", [6.0])[0])
            income = float(qs.get("income", [12000])[0])
            scope = qs.get("scope", ["all"])[0]
            res = query_ranked_regions(weights, seed, income, scope)
            self._send_json(res)
        elif parsed.path == "/api/transfer-simulate":
            cur_sale = float(qs.get("current_sale", [10.5])[0])
            cur_loan = float(qs.get("current_loan", [3.5])[0])
            extra = float(qs.get("extra_cash", [1.5])[0])
            income = float(qs.get("new_income", [13000])[0])
            exempt = qs.get("tax_exempt", ["true"])[0].lower() == "true"
            self._send_json(simulate_transfer(cur_sale, cur_loan, extra, income, exempt))
        elif parsed.path == "/api/health":
            self._send_json({"status": "ok", "service": "Location Lab Pro API"})
        elif parsed.path in ("/", "/index.html"):
            required_code = os.environ.get("BETA_PASSCODE", "").strip()
            provided_code = qs.get("code", [""])[0].strip()
            if required_code and provided_code != required_code:
                self._send_json({
                    "status": "locked",
                    "message": "비공개 베타 사이트입니다. URL 뒤에 ?code=초대코드 를 붙여 접속하거나 프론트엔드 초대코드 화면을 이용하세요."
                }, status=401)
                return
            html_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "index.html")
            if os.path.exists(html_path):
                with open(html_path, "rb") as hf:
                    content = hf.read()
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("X-Robots-Tag", "noindex, nofollow")
                self.send_header("Content-Length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)
            else:
                self._send_json({"error": "index.html not found"}, status=404)
        else:
            self._send_json({
                "endpoints": [
                    "/",
                    "/api/health",
                    "/api/regions?seed=6.0&income=12000&scope=all",
                    "/api/transfer-simulate?current_sale=10.5&current_loan=3.5&extra_cash=1.5&new_income=13000"
                ]
            })


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--test-once", action="store_true", help="Run a single query test and exit")
    args = parser.parse_args()

    if args.test_once:
        sample = query_ranked_regions({"job": 30, "edu": 25, "prod": 25, "infra": 10, "future": 10}, 6.0, 12000)
        tr_sample = simulate_transfer(10.5, 3.5, 1.5, 13000, True)
        print(f"[TEST OK] 1위 지역: {sample['regions'][0]['name']} ({sample['regions'][0]['custom_score']}점), "
              f"갈아타기 실거주 상한가: {tr_sample['max_target_live_price_eok']}억 원")
    else:
        server = HTTPServer(("0.0.0.0", args.port), LocationLabHandler)
        print(f"Location Lab Pro API Server running on http://localhost:{args.port}")
        server.serve_forever()
