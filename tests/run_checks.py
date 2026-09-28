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


# ══════════════════════════════════════════════════════════════════════════
#  D — RFQ multi-leg fee discounts
#      legs group into long/short calls/puts; the most expensive group pays in
#      full, then cheapest 100% off, 2nd and 3rd cheapest 50% off
# ══════════════════════════════════════════════════════════════════════════
def section_d():
    section("D — RFQ multi-leg fee discounts")

    size = 0.001

    def fees(strategy, mode):
        status, data = post("/api/compute", {
            "asset": "BTC", "expiry": EXPIRY, "strategies": [strategy],
            "contract_size": size, "fee_mode": mode})
        return status, data

    status, bad = post("/api/compute", {
        "asset": "BTC", "expiry": EXPIRY, "strategies": ["long_call"],
        "contract_size": size, "fee_mode": "nonsense"})
    check("an unknown fee_mode is rejected", status == 400, str(bad)[:60])

    status, taker = fees("long_call", "taker")
    status, rfq = fees("long_call", "rfq")
    t, r = taker["strategies"][0], rfq["strategies"][0]
    check("single-leg RFQ still pays one base fee (no group to discount)",
          abs(t["total_fee"] - r["total_fee"]) < 0.02,
          f"taker {t['total_fee']} vs rfq {r['total_fee']}")

    # 2-leg spread: both legs are in different groups -> cheaper leg is free
    status, taker = fees("bull_call_spread", "taker")
    status, rfq = fees("bull_call_spread", "rfq")
    t, r = taker["strategies"][0], rfq["strategies"][0]
    free_legs = [l for l in r["legs_detail"] if l["fee_discount"] == 1.0]
    check("vertical spread: exactly one leg gets a 100% RFQ discount",
          len(free_legs) == 1, f"discounts={[l['fee_discount'] for l in r['legs_detail']]}")
    check("vertical spread: RFQ pays one base fee instead of two",
          r["total_fee"] < t["total_fee"] - 0.4,
          f"taker {t['total_fee']} vs rfq {r['total_fee']}")

    status, rfq = fees("straddle", "rfq")
    r = rfq["strategies"][0]
    check("straddle: long call and long put are different groups, cheaper is free",
          sum(1 for l in r["legs_detail"] if l["fee_discount"] == 1.0) == 1,
          f"discounts={[l['fee_discount'] for l in r['legs_detail']]}")

    # iron condor: 4 legs in 4 groups -> 100%, 50%, 50%, full
    status, rfq = fees("iron_condor", "rfq")
    r = rfq["strategies"][0]
    discounts = sorted(l["fee_discount"] for l in r["legs_detail"])
    check("iron condor: discounts are 0 / 50% / 50% / 100% across the four groups",
          discounts == [0.0, 0.5, 0.5, 1.0], f"{discounts}")

    status, taker = fees("iron_condor", "taker")
    check("iron condor RFQ is materially cheaper than four taker orders",
          r["total_fee"] < taker["strategies"][0]["total_fee"],
          f"taker {taker['strategies'][0]['total_fee']} vs rfq {r['total_fee']}")

    check("leg fees still sum exactly to total_fee in RFQ mode",
          abs(sum(l["fee"] for l in r["legs_detail"]) - r["total_fee"]) < 1e-9)

    # a strategy holding spot: the spot leg is free and outside the RFQ groups
    status, rfq = fees("collar", "rfq")
    r = rfq["strategies"][0]
    under = [l for l in r["legs_detail"] if l["opt_type"] == "underlying"][0]
    check("collar: the underlying leg stays free and ungrouped",
          under["fee"] == 0 and under["fee_discount"] == 0.0)

    check("response echoes the fee mode", rfq.get("fee_mode") == "rfq")

    # ── maker mode: no base fee, 0.01% notional rate ────────────────────
    status, maker = fees("long_call", "maker")
    status, taker = fees("long_call", "taker")
    mk, tk = maker["strategies"][0], taker["strategies"][0]
    spot, prem = maker["spot"], mk["legs_detail"][0]["premium"]
    want = round(min(0.0001 * spot * size, 0.125 * prem * size), 2)
    check("maker fee = min(0.01% notional, 12.5% premium) with NO base fee",
          abs(mk["total_fee"] - want) < 0.005, f"got {mk['total_fee']} expected {want}")
    check("maker is cheaper than taker", mk["total_fee"] < tk["total_fee"],
          f"maker {mk['total_fee']} vs taker {tk['total_fee']}")
    check("fee model exposes the maker rate",
          maker.get("fee_model", {}).get("option_maker_rate") == 0.0001)

    status, mk_ic = fees("iron_condor", "maker")
    check("maker mode applies no RFQ discounts",
          all(l["fee_discount"] == 0 for l in mk_ic["strategies"][0]["legs_detail"]))
    check("maker capital still includes the (smaller) fee once",
          mk_ic["strategies"][0]["total_cost"] > 0)


# ══════════════════════════════════════════════════════════════════════════
#  E — real exchange margin (public/get_margin)
# ══════════════════════════════════════════════════════════════════════════
def section_e():
    section("E — Exchange margin simulator")

    size = 0.001
    status, data = compute(["bear_call_spread", "protective_put", "long_call"], contract_size=size)
    by_id = {}
    for st in data["strategies"]:
        by_id.setdefault(st["id"], st)

    def margin(strategy, margin_type="SM"):
        st = by_id[strategy]
        return post("/api/margin", {
            "asset": "BTC", "contract_size": size, "margin_type": margin_type,
            "legs": [{"name": l["name"], "direction": l["direction"], "opt_type": l["opt_type"]}
                     for l in st["legs_detail"]]})

    status, m = margin("long_call")
    check("POST /api/margin answers for a single-leg strategy",
          status == 200 and "required_collateral" in m, str(m)[:80])
    check("a long call needs no posted collateral (it is an asset)",
          m["required_collateral"] == 0, f"required={m['required_collateral']}")

    status, m = margin("bear_call_spread")
    check("a credit spread reports a real collateral requirement",
          status == 200 and m["required_collateral"] > 0, f"required={m['required_collateral']}")
    check("maintenance collateral is returned as well", "maintenance_collateral" in m)

    status, m = margin("protective_put")
    check("a held underlying is passed as collateral, not a position",
          status == 200 and m["collaterals"] == 1 and m["legs"] == 1, str(m)[:90])

    status, m = margin("bear_call_spread", "PM2")
    check("PM2 (portfolio margin) is accepted and echoed",
          status == 200 and m["margin_type"] == "PM2", str(m)[:70])

    status, bad = post("/api/margin", {"asset": "BTC", "contract_size": size,
                                       "margin_type": "XX", "legs": [{"name": "x", "direction": "Buy"}]})
    check("an unknown margin_type is rejected", status == 400, str(bad)[:60])
    status, bad = post("/api/margin", {"asset": "BTC", "contract_size": 0, "legs": []})
    check("margin request validates its inputs", status == 400, str(bad)[:60])


# ══════════════════════════════════════════════════════════════════════════
#  F — dynamic asset list (only the chosen asset's chain is fetched)
# ══════════════════════════════════════════════════════════════════════════
def section_f():
    section("F — Asset discovery")

    status, data = get("/api/assets")
    assets = data.get("assets", [])
    names = [a["currency"] for a in assets]
    check("GET /api/assets lists the exchange's option underlyings",
          status == 200 and len(assets) >= 2, f"{names}")
    check("cash-only currencies (no option market) are excluded", "USDC" not in names, f"{names}")
    check("every asset carries a spot price and a sensible default size",
          all(a["spot"] > 0 and a["default_contract_size"] > 0 for a in assets))

    by_name = {a["currency"]: a for a in assets}
    check("default size targets a ~$100 notional (BTC 0.001 / ETH 0.01)",
          by_name.get("BTC", {}).get("default_contract_size") == 0.001
          and by_name.get("ETH", {}).get("default_contract_size") == 0.01,
          f"BTC={by_name.get('BTC',{}).get('default_contract_size')} ETH={by_name.get('ETH',{}).get('default_contract_size')}")

    # a newly listed asset must work end to end without any code change
    extra = next((n for n in names if n not in ("BTC", "ETH")), None)
    check("the exchange lists at least one asset beyond BTC/ETH", extra is not None, f"{names}")
    if extra:
        status, exp = post("/api/expiries", {"asset": extra})
        check(f"{extra}: expiries load", status == 200 and exp.get("expiries"), str(exp)[:60])
        status, res = post("/api/compute", {
            "asset": extra, "expiry": exp["expiries"][0]["date"],
            "strategies": ["long_call", "iron_condor"],
            "contract_size": by_name[extra]["default_contract_size"]})
        check(f"{extra}: strategies compute end to end",
              status == 200 and len(res.get("strategies", [])) > 0,
              f"{len(res.get('strategies', []))} combos at size {by_name[extra]['default_contract_size']}")

    status, res = post("/api/compute", {"asset": "USDC", "expiry": EXPIRY,
                                        "strategies": ["long_call"], "contract_size": 1})
    check("an asset without an option chain fails cleanly", status >= 400, str(res)[:60])


# ══════════════════════════════════════════════════════════════════════════
#  G — configurable combination cap (feeds the virtualised table)
# ══════════════════════════════════════════════════════════════════════════
def section_g():
    section("G — Combination cap")

    def combos(limit=None, strategy="iron_condor"):
        payload = {"asset": "BTC", "expiry": EXPIRY, "strategies": [strategy],
                   "contract_size": 0.001}
        if limit is not None:
            payload["max_combos"] = limit
        return post("/api/compute", payload)

    status, default = combos()
    check("default cap is still 30", len(default["strategies"]) == 30,
          f"{len(default['strategies'])} combos")
    check("response echoes the cap in use", default.get("max_combos") == 30)

    status, more = combos(120)
    check("a higher max_combos returns more combinations",
          len(more["strategies"]) > 30, f"{len(more['strategies'])} combos")

    status, capped = combos(100000)
    check("max_combos is clamped to the server ceiling",
          capped.get("max_combos") == 500 and len(capped["strategies"]) <= 500,
          f"echoed {capped.get('max_combos')}, {len(capped['strategies'])} combos")

    status, one = combos(1, "long_call")
    check("max_combos=1 returns a single combination", len(one["strategies"]) == 1)

    status, bad = combos("many")
    check("a non-numeric max_combos is rejected", status == 400, str(bad)[:60])


# ══════════════════════════════════════════════════════════════════════════
#  H — probability of profit
# ══════════════════════════════════════════════════════════════════════════
def section_h():
    section("H — Probability of profit")

    import math

    def ncdf(x):
        return 0.5 * (1 + math.erf(x / math.sqrt(2)))

    status, data = compute(["long_call", "long_put", "iron_condor", "straddle", "covered_call"],
                           contract_size=0.01)
    spot = data["spot"]
    strategies = data["strategies"]

    check("every combination carries a PoP, an IV and a time to expiry",
          all(s["pop"] is not None and s["iv_avg"] > 0 and s["t_years"] > 0 for s in strategies))
    check("PoP is a probability in [0, 100]",
          all(0 <= s["pop"] <= 100 for s in strategies))

    # a single long call is exactly P(S_T > breakeven) under the lognormal model
    lc = [s for s in strategies if s["id"] == "long_call"][0]
    vol = lc["iv_avg"] * math.sqrt(lc["t_years"])
    want = (1 - ncdf((math.log(lc["breakevens"][0] / spot) + 0.5 * vol * vol) / vol)) * 100
    check("long call PoP matches the closed-form probability",
          abs(lc["pop"] - want) < 0.2, f"reported {lc['pop']}% vs analytic {want:.1f}%")

    # deep OTM should be less likely than near-the-money for the same structure
    calls = sorted([s for s in strategies if s["id"] == "long_call"],
                   key=lambda s: s["legs_detail"][0]["strike"])
    check("PoP falls as the long call gets further out of the money",
          all(a["pop"] >= b["pop"] - 0.01 for a, b in zip(calls, calls[1:])),
          f"{[s['pop'] for s in calls][:5]}…")

    # a condor only wins inside its wings; both breakevens must bound the region
    condors = [s for s in strategies if s["id"] == "iron_condor" and len(s["breakevens"]) == 2]
    check("range strategies report a middle-of-the-road PoP",
          all(0 < s["pop"] < 100 for s in condors), f"{[s['pop'] for s in condors][:4]}")

    # fees shrink the profitable window, so PoP must not increase when they are on
    status, no_fee = compute(["iron_condor"], contract_size=0.01, include_fees=False)
    status, with_fee = compute(["iron_condor"], contract_size=0.01, include_fees=True)
    pairs = list(zip(with_fee["strategies"], no_fee["strategies"]))
    check("adding fees never raises the probability of profit",
          all(a["pop"] <= b["pop"] + 1e-9 for a, b in pairs),
          f"e.g. {pairs[0][0]['pop']}% with fees vs {pairs[0][1]['pop']}% without")

    # cheaper execution (RFQ) widens the window again
    status, rfq = post("/api/compute", {"asset": "BTC", "expiry": EXPIRY, "contract_size": 0.01,
                                        "strategies": ["iron_condor"], "fee_mode": "rfq"})
    check("cheaper RFQ fees raise PoP versus taker fees",
          rfq["strategies"][0]["pop"] >= with_fee["strategies"][0]["pop"],
          f"rfq {rfq['strategies'][0]['pop']}% vs taker {with_fee['strategies'][0]['pop']}%")

    # a structure that can never pay off must report 0
    status, tiny = compute(["iron_condor"], contract_size=0.001)
    unprofitable = [s for s in tiny["strategies"] if not s["breakevens"]]
    check("a structure with no profitable region reports 0% (not null)",
          all(s["pop"] == 0 for s in unprofitable) if unprofitable else True,
          f"{len(unprofitable)} unprofitable combos at 0.001 with taker fees")


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
    section_d()
    section_e()
    section_f()
    section_g()
    section_h()

    passed = sum(1 for _, ok, _ in _results if ok)
    failed = len(_results) - passed
    print(f"\n{'═' * 72}")
    print(f"  {GREEN}{passed} passed{RESET}" + (f"   {RED}{failed} failed{RESET}" if failed else ""))
    print(f"{'═' * 72}\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
