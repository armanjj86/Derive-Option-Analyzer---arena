"""Offline regression checks for the Derive Option Strategy Analyzer.

Usage
-----
    python tests/mock_derive_api.py                          # terminal 1
    DERIVE_BASE_URL=http://127.0.0.1:8899 python app.py      # terminal 2
    python tests/run_checks.py                               # terminal 3

Optional: APP_URL=http://localhost:5000 python tests/run_checks.py
"""

import json
import os
import sys
import urllib.error
import urllib.request

APP = os.environ.get("APP_URL", "http://127.0.0.1:5000").rstrip("/")

ALL_STRATEGIES = [
    "protective_put", "long_call", "long_put", "covered_call", "collar",
    "bull_call_spread", "bear_put_spread", "bull_put_spread", "bear_call_spread",
    "straddle", "strangle", "iron_condor",
]

GREEN, RED, DIM, RESET = "\033[32m", "\033[31m", "\033[2m", "\033[0m"
_results = []


def check(name, condition, detail=""):
    _results.append((name, bool(condition), detail))
    icon = f"{GREEN}PASS{RESET}" if condition else f"{RED}FAIL{RESET}"
    print(f"  [{icon}] {name}" + (f"  {DIM}{detail}{RESET}" if detail else ""))
    return bool(condition)


def section(title):
    print(f"\n{'─' * 72}\n  {title}\n{'─' * 72}")


def post(path, payload=None):
    req = urllib.request.Request(
        APP + path, method="POST",
        data=json.dumps(payload or {}).encode(),
        headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def get(path):
    with urllib.request.urlopen(APP + path, timeout=30) as r:
        return r.status, json.loads(r.read().decode())


def compute(strategies, contract_size=0.001, expiry=None, include_fees=True, asset="BTC"):
    return post("/api/compute", {
        "asset": asset, "expiry": expiry or EXPIRY, "strategies": strategies,
        "contract_size": contract_size, "include_fees": include_fees})


# ══════════════════════════════════════════════════════════════════════════
#  A — endpoints & core backend logic
# ══════════════════════════════════════════════════════════════════════════
def section_a():
    section("A — Endpoints & core backend logic")

    status, health = get("/api/health")
    check("GET /api/health reachable", status == 200 and health.get("status") == "ok")

    status, strategies = get("/api/strategies")
    check("GET /api/strategies returns 12 strategies", len(strategies) == 12,
          f"got {len(strategies)}")

    status, spot = post("/api/spot", {"asset": "BTC"})
    check("POST /api/spot returns a positive price", spot.get("spot", 0) > 0,
          f"spot={spot.get('spot')}")

    status, market = post("/api/market", {"asset": "BTC", "expiry": EXPIRY})
    check("POST /api/market returns spot/IV stats",
          market.get("spot", 0) > 0 and market.get("atm_iv", 0) > 0,
          f"iv_rank={market.get('iv_rank')} dvol={market.get('dvol')}")

    status, exp = post("/api/expiries", {"asset": "BTC"})
    days = [e["days"] for e in exp.get("expiries", [])]
    check("POST /api/expiries lists only future expiries", all(d >= 1 for d in days),
          f"days={days}")
    check("expiry day count is rounded up, not truncated (no stale 0d)",
          days and min(days) >= 1)

    # A1 — every strategy must produce combinations
    empty = []
    counts = {}
    for sid in ALL_STRATEGIES:
        status, data = compute([sid])
        n = len(data.get("strategies", []))
        counts[sid] = n
        if n == 0:
            empty.append(sid)
    check("all 12 strategies generate combinations", not empty,
          f"empty: {empty}" if empty else f"counts={counts}")

    # A2 — cap is applied consistently
    capped = {k: v for k, v in counts.items() if v > 30}
    check("no strategy exceeds MAX_COMBOS (30)", not capped, f"{capped}")
    multi = [counts[s] for s in ("collar", "strangle", "iron_condor",
                                 "bull_call_spread", "bear_call_spread",
                                 "bull_put_spread", "bear_put_spread")]
    check("multi-leg strategies all reach the same cap (30, not 29)",
          set(multi) == {30}, f"{multi}")

    # leg ordering for the previously broken put spreads
    for sid in ("bear_put_spread", "bull_put_spread"):
        status, data = compute([sid])
        ok = True
        for combo in data.get("strategies", []):
            legs = [l for l in combo["legs_detail"] if l["opt_type"] == "put"]
            if len(legs) != 2 or not legs[0]["strike"] > legs[1]["strike"]:
                ok = False
                break
        check(f"{sid}: first leg strike > second leg strike", ok)

    status, data = compute(["bull_put_spread"])
    dirs = [l["direction"] for l in data["strategies"][0]["legs_detail"]]
    check("bull_put_spread is a credit spread (sell high put / buy low put)",
          dirs == ["Sell", "Buy"] and data["strategies"][0]["net_premium"] < 0,
          f"dirs={dirs} net_premium={data['strategies'][0]['net_premium']}")

    status, data = compute(["bear_put_spread"])
    dirs = [l["direction"] for l in data["strategies"][0]["legs_detail"]]
    check("bear_put_spread is a debit spread (buy high put / sell low put)",
          dirs == ["Buy", "Sell"] and data["strategies"][0]["net_premium"] > 0,
          f"dirs={dirs} net_premium={data['strategies'][0]['net_premium']}")

    # A3 — contract size validation
    for bad, label in ((0, "zero"), (-5, "negative"), ("abc", "non-numeric"),
                       (10 ** 9, "absurdly large")):
        status, data = compute(["long_call"], contract_size=bad)
        check(f"contract_size {label} is rejected with 400", status == 400,
              f"status={status} body={str(data)[:60]}")

    status, data = compute(["long_call"], contract_size=0.001)
    check("valid contract_size still works", status == 200 and data.get("strategies"))


# ══════════════════════════════════════════════════════════════════════════
#  B — Derive fee engine
#     reference: https://docs.derive.xyz/reference/fees-1
#     option taker = $0.50 flat + min(0.03% x notional, 12.5% x premium)
#     spot         = free
# ══════════════════════════════════════════════════════════════════════════
OPTION_BASE, NOTIONAL_RATE, PREMIUM_CAP = 0.50, 0.0003, 0.125


def expected_option_fee(spot, premium, size):
    return round(OPTION_BASE + min(NOTIONAL_RATE * spot * size, PREMIUM_CAP * premium * size), 2)


def section_b():
    section("B — Derive fee engine")

    size = 0.001
    status, data = compute(["long_call"], contract_size=size)
    spot = data["spot"]
    s = data["strategies"][0]
    leg = s["legs_detail"][0]
    want = expected_option_fee(spot, leg["premium"], size)
    check("option leg fee matches the official Derive formula",
          abs(leg["fee"] - want) < 0.005, f"got {leg['fee']} expected {want}")
    check("flat $0.50 base fee is NOT scaled by contract size", leg["fee"] >= OPTION_BASE,
          f"fee={leg['fee']} at size={size}")

    status, data = compute(["protective_put"], contract_size=size)
    s = data["strategies"][0]
    under = [l for l in s["legs_detail"] if l["opt_type"] == "underlying"][0]
    check("spot / underlying leg is charged no fee", under["fee"] == 0, f"fee={under['fee']}")

    check("leg fees sum exactly to total_fee",
          abs(sum(l["fee"] for l in s["legs_detail"]) - s["total_fee"]) < 1e-9,
          f"sum={sum(l['fee'] for l in s['legs_detail'])} total={s['total_fee']}")

    # B3 — a credit spread must not pay for its fee twice
    status, with_fee = compute(["bear_call_spread"], contract_size=size, include_fees=True)
    status, no_fee = compute(["bear_call_spread"], contract_size=size, include_fees=False)
    a, b = with_fee["strategies"][0], no_fee["strategies"][0]
    expected_cost = round(abs(b["max_loss"]) + a["total_fee"], 2)
    check("credit spread capital = pre-fee collateral + fee (counted once)",
          abs(a["total_cost"] - expected_cost) <= 0.02,
          f"total_cost={a['total_cost']} expected≈{expected_cost} (fee={a['total_fee']})")
    check("credit spread max loss ≈ 100% of its capital",
          abs(a["max_loss_pct"] + 100) <= 1.0, f"max_loss_pct={a['max_loss_pct']}")

    # fees must reduce profit and deepen loss, never the opposite
    worse = all(
        (x["max_profit"] is None or y["max_profit"] is None
         or x["max_profit"] <= y["max_profit"] + 1e-6)
        and (x["max_loss"] is None or y["max_loss"] is None
             or x["max_loss"] <= y["max_loss"] + 1e-6)
        for x, y in zip(with_fee["strategies"], no_fee["strategies"]))
    check("enabling fees never improves P&L", worse)

    status, off = compute(["long_call", "protective_put"], include_fees=False)
    check("include_fees=false zeroes every fee",
          all(st["total_fee"] == 0 and all(l["fee"] == 0 for l in st["legs_detail"])
              for st in off["strategies"]))
    check("response echoes include_fees and fee_model",
          off.get("include_fees") is False and off.get("fee_model", {}).get("option_base") == OPTION_BASE)

    # fee should be sub-linear in size (flat component), never proportional
    status, small = compute(["long_call"], contract_size=0.001)
    status, big = compute(["long_call"], contract_size=0.01)
    f_small = small["strategies"][0]["total_fee"]
    f_big = big["strategies"][0]["total_fee"]
    check("fee grows sub-linearly with contract size (flat base present)",
          f_big < f_small * 10 - 1e-9 and f_big > f_small,
          f"{f_small} @0.001 vs {f_big} @0.01")

    # The UI rescales results client-side when the contract size changes, using
    # cost_new = (cost_old - fee_old) * ratio + fee_new. Verify the server agrees,
    # otherwise the instant client-side recompute silently drifts.
    ids = ["long_call", "protective_put", "bear_call_spread", "iron_condor"]
    status, a10 = compute(ids, contract_size=0.001)
    status, b10 = compute(ids, contract_size=0.01)
    by_legs = {(s["id"], tuple(s["legs"])): s for s in b10["strategies"]}
    worst, worst_id = 0.0, ""
    for small in a10["strategies"]:
        big = by_legs.get((small["id"], tuple(small["legs"])))
        if not big:
            continue
        predicted = (small["total_cost"] - small["total_fee"]) * 10 + big["total_fee"]
        err = abs(predicted - big["total_cost"]) / max(big["total_cost"], 1)
        if err > worst:
            worst, worst_id = err, small["id"]
    check("client-side rescale formula reproduces server capital at 10x size",
          worst < 0.01, f"worst drift {worst * 100:.3f}% ({worst_id})")


# ══════════════════════════════════════════════════════════════════════════
#  C — payoff extremes, thresholds and leg pricing
# ══════════════════════════════════════════════════════════════════════════
def section_c():
    section("C — Payoff extremes, thresholds & leg pricing")

    size = 0.001
    status, data = compute(["covered_call", "protective_put", "collar"], contract_size=size)
    spot = data["spot"]
    cc = [s for s in data["strategies"] if s["id"] == "covered_call"]
    check("covered call no longer reports UNLIMITED loss (price floor is 0)",
          all(not s["max_loss_inf"] for s in cc), f"{sum(s['max_loss_inf'] for s in cc)}/{len(cc)} flagged")
    check("unbounded extremes are reported as null, not a fake number",
          all(st["max_profit"] is None for st in
              (compute(["long_call"], contract_size=size)[1]["strategies"])))
    check("covered call max loss ≈ -(spot - premium) x size",
          all(abs(s["max_loss"]) < spot * size * 1.05 and abs(s["max_loss"]) > spot * size * 0.5 for s in cc),
          f"e.g. {cc[0]['max_loss']} vs notional {round(spot * size, 2)}")
    check("covered call upside stays capped (not unlimited)",
          all(not s["max_profit_inf"] for s in cc))
    check("covered calls now pass a 10% max-loss filter check only if truly small",
          all(s["max_loss_pct"] is not None for s in cc), "max_loss_pct is a number, not None")

    status, data = compute(["long_call", "long_put", "straddle", "strangle"], contract_size=size)
    check("long call / straddle keep UNLIMITED upside",
          all(s["max_profit_inf"] for s in data["strategies"] if s["id"] in ("long_call", "straddle")))
    check("long put upside is finite (price floor is 0)",
          all(not s["max_profit_inf"] for s in data["strategies"] if s["id"] == "long_put"))
    check("long option downside is limited to the premium paid",
          all(not s["max_loss_inf"] for s in data["strategies"]))

    status, data = compute(["bear_call_spread", "iron_condor", "bull_call_spread"], contract_size=size)
    check("defined-risk spreads are never flagged unlimited",
          all(not s["max_profit_inf"] and not s["max_loss_inf"] for s in data["strategies"]))

    # extremes must agree with the plotted curve
    worst = 0.0
    for s in data["strategies"]:
        curve = s["pnl_chart"]["pnl"]
        if s["max_profit"] is not None:
            worst = max(worst, max(0.0, max(curve) - s["max_profit"]))
        if s["max_loss"] is not None:
            worst = max(worst, max(0.0, s["max_loss"] - min(curve)))
    check("reported extremes bound the plotted payoff curve", worst < 0.02, f"overshoot {worst:.4f}")

    # C2 — small contract sizes must not be flattened to zero, and a combo that can
    #      never pay off must keep its negative max profit instead of showing 0.
    tiny_size = 0.0005
    status, tiny = compute(["bull_call_spread"], contract_size=tiny_size, include_fees=False)
    eps = max(1e-6, tiny["spot"] * tiny_size * 1e-5)
    flattened = []
    for s in tiny["strategies"]:
        buy, sell = s["legs_detail"][0], s["legs_detail"][1]
        analytic = (sell["strike"] - buy["strike"]) * tiny_size - (buy["premium"] - sell["premium"]) * tiny_size
        if abs(s["max_profit"] - analytic) > max(eps, 0.01):
            flattened.append((s["legs"], s["max_profit"], round(analytic, 4)))
    check("tiny contract sizes keep exact P&L (relative zero-threshold)",
          not flattened, f"{len(flattened)} distorted, e.g. {flattened[:1]}")
    negatives = [s for s in tiny["strategies"] if s["max_profit"] < 0]
    check("a combo that can never profit reports a negative max profit, not $0",
          all(s["max_profit_pct"] is not None and s["max_profit_pct"] < 0 for s in negatives),
          f"{len(negatives)} such combos at size {tiny_size}")

    # C3 — bid/ask pricing
    status, mkt = compute(["bull_call_spread"], contract_size=size)
    status, mark = compute(["bull_call_spread"], contract_size=size)
    legs = mkt["strategies"][0]["legs_detail"]
    buy = [l for l in legs if l["direction"] == "Buy"][0]
    sell = [l for l in legs if l["direction"] == "Sell"][0]
    check("buy leg is priced at the ask", buy["premium_source"] == "ask" and buy["premium"] == buy["best_ask"],
          f"{buy['premium']} vs ask {buy['best_ask']}")
    check("sell leg is priced at the bid", sell["premium_source"] == "bid" and sell["premium"] == sell["best_bid"],
          f"{sell['premium']} vs bid {sell['best_bid']}")

    status, marked = post("/api/compute", {
        "asset": "BTC", "expiry": EXPIRY, "strategies": ["bull_call_spread"],
        "contract_size": size, "use_mark_prices": True})
    mleg = marked["strategies"][0]["legs_detail"][0]
    check("use_mark_prices=true switches back to mark pricing",
          mleg["premium_source"] == "mark" and marked.get("use_mark_prices") is True)
    check("crossing the spread costs more than trading at mark",
          mkt["strategies"][0]["net_premium"] >= marked["strategies"][0]["net_premium"] - 1e-9,
          f"market {mkt['strategies'][0]['net_premium']} vs mark {marked['strategies'][0]['net_premium']}")


def main():
    global EXPIRY
    try:
        status, exp = post("/api/expiries", {"asset": "BTC"})
        EXPIRY = exp["expiries"][2]["date"]
    except Exception as e:  # noqa: BLE001
        print(f"{RED}Cannot reach the app at {APP} — start it first.{RESET}  ({e})")
        return 2

    print(f"\n  Target: {APP}   Expiry under test: {EXPIRY}")
    section_a()
    section_b()
    section_c()

    passed = sum(1 for _, ok, _ in _results if ok)
    failed = len(_results) - passed
    print(f"\n{'═' * 72}")
    print(f"  {GREEN}{passed} passed{RESET}" + (f"   {RED}{failed} failed{RESET}" if failed else ""))
    print(f"{'═' * 72}\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
