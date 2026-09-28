"""Offline mock of the Derive (Lyra) public REST API.

Lets the analyzer be developed and tested without internet access or real
market data. Prices come from a Black-Scholes model so the payoff maths,
Greeks and fee calculations all get realistic inputs.

    python tests/mock_derive_api.py            # listens on 127.0.0.1:8899
    DERIVE_BASE_URL=http://127.0.0.1:8899 python app.py
"""

import math
import random
from datetime import datetime, timedelta, timezone

from flask import Flask, jsonify, request

app = Flask(__name__)
random.seed(7)

PORT = 8899
SPOT = {"BTC": 117250.37, "ETH": 4212.55}
SPOT_24H = {"BTC": 114980.10, "ETH": 4301.22}
EXPIRY_OFFSETS_DAYS = (2, 5, 9, 16, 30, 60)


def expiries():
    base = datetime.now(timezone.utc)
    return [(base + timedelta(days=d)).strftime("%Y%m%d") for d in EXPIRY_OFFSETS_DAYS]


def strikes(asset):
    spot = SPOT[asset]
    step = 2000 if asset == "BTC" else 100
    mid = round(spot / step) * step
    return [mid + i * step for i in range(-5, 6)]


def black_scholes(S, K, T, sigma, is_call):
    if T <= 0:
        T = 1 / 365
    d1 = (math.log(S / K) + 0.5 * sigma * sigma * T) / (sigma * math.sqrt(T))
    d2 = d1 - sigma * math.sqrt(T)
    cdf = lambda x: 0.5 * (1 + math.erf(x / math.sqrt(2)))
    if is_call:
        price, delta = S * cdf(d1) - K * cdf(d2), cdf(d1)
    else:
        price, delta = K * cdf(-d2) - S * cdf(-d1), cdf(d1) - 1
    pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2 * math.pi)
    gamma = pdf / (S * sigma * math.sqrt(T))
    vega = S * pdf * math.sqrt(T) / 100
    theta = -(S * pdf * sigma) / (2 * math.sqrt(T)) / 365
    return max(price, 1.0), delta, gamma, vega, theta


@app.post("/public/get_all_currencies")
def get_all_currencies():
    return jsonify({"result": [
        {"currency": c, "spot_price": str(SPOT[c]), "spot_price_24h": str(SPOT_24H[c])}
        for c in SPOT
    ]})


@app.post("/public/get_instruments")
def get_instruments():
    currency = (request.json or {}).get("currency", "BTC")
    result = [
        {"instrument_name": f"{currency}-{e}-{int(k)}-{t}", "is_active": True,
         "instrument_type": "option", "base_currency": currency}
        for e in expiries() for k in strikes(currency) for t in ("C", "P")
    ]
    # noise used to verify the filtering logic
    result.append({"instrument_name": f"{currency}-{expiries()[0]}-1-C", "is_active": False,
                   "instrument_type": "option"})
    result.append({"instrument_name": "SOL-20991231-100-C", "is_active": True,
                   "instrument_type": "option"})
    return jsonify({"result": result})


@app.post("/public/get_tickers")
def get_tickers():
    body = request.json or {}
    currency = body.get("currency", "BTC")
    instrument_type = body.get("instrument_type", "option")
    spot = SPOT[currency]

    if instrument_type == "perp":
        return jsonify({"result": {"tickers": {f"{currency}-PERP": {
            "I": str(spot), "M": str(spot),
            "a": str(spot * 1.0002), "b": str(spot * 0.9998)}}}})

    expiry = str(body.get("expiry_date") or expiries()[0])
    try:
        dte = (datetime.strptime(expiry, "%Y%m%d").replace(tzinfo=timezone.utc)
               - datetime.now(timezone.utc)).days
    except ValueError:
        return jsonify({"result": {"tickers": {}}})
    T = max(dte, 1) / 365

    tickers = {}
    for k in strikes(currency):
        for t in ("C", "P"):
            iv = 0.55 + abs(k - spot) / spot * 0.35
            price, delta, gamma, vega, theta = black_scholes(spot, k, T, iv, t == "C")
            tickers[f"{currency}-{expiry}-{int(k)}-{t}"] = {
                "a": str(round(price * 1.03, 2)), "b": str(round(price * 0.97, 2)),
                "A": "5", "B": "5", "I": str(spot), "M": str(round(price, 2)),
                "option_pricing": {
                    "d": str(round(delta, 4)), "g": str(round(gamma, 8)),
                    "t": str(round(theta, 4)), "v": str(round(vega, 4)), "r": "0.01",
                    "i": str(round(iv, 4)), "f": str(spot), "m": str(round(price, 2)),
                    "df": "1", "bi": str(round(iv * 0.98, 4)), "ai": str(round(iv * 1.02, 4))},
                "stats": {"oi": str(random.randint(5, 900)), "v": str(random.randint(0, 200)),
                          "c": "0", "n": 12},
            }
    return jsonify({"result": {"tickers": tickers}})


@app.post("/public/get_margin")
def get_margin():
    """Very small standard-margin approximation — enough to exercise the plumbing.

    net margin = mark-to-market + collateral value - requirement
      long option : requirement 0 (it is an asset)
      short option: requirement = 15% of spot per contract, floored at 10%
      collateral  : valued at spot with a 10% haircut
    """
    body = request.json or {}
    mtm = 0.0
    requirement = 0.0
    for pos in body.get("simulated_positions") or []:
        name = pos["instrument_name"]
        amount = float(pos["amount"])
        parts = name.split("-")
        if len(parts) != 4:
            continue
        cur, expiry, strike, kind = parts[0], parts[1], float(parts[2]), parts[3]
        spot = SPOT.get(cur, 0)
        try:
            dte = max((datetime.strptime(expiry, "%Y%m%d").replace(tzinfo=timezone.utc)
                       - datetime.now(timezone.utc)).days, 1)
        except ValueError:
            dte = 1
        iv = 0.55 + abs(strike - spot) / spot * 0.35
        price, *_ = black_scholes(spot, strike, dte / 365, iv, kind == "C")
        mtm += amount * price
        if amount < 0:
            requirement += abs(amount) * max(0.15 * spot, 0.10 * spot)
    collateral = 0.0
    for col in body.get("simulated_collaterals") or []:
        collateral += float(col["amount"]) * SPOT.get(col["asset_name"], 1.0) * 0.90

    net_initial = mtm + collateral - requirement
    net_maintenance = net_initial + requirement * 0.25
    return jsonify({"result": {
        "subaccount_id": 0,
        "is_valid_trade": net_initial >= 0,
        "pre_initial_margin": f"{net_initial:.4f}",
        "post_initial_margin": f"{net_initial:.4f}",
        "pre_maintenance_margin": f"{net_maintenance:.4f}",
        "post_maintenance_margin": f"{net_maintenance:.4f}",
    }})


@app.post("/<path:unused>")
def fallback(unused):
    return jsonify({"result": {}})


if __name__ == "__main__":
    print(f"Mock Derive API listening on http://127.0.0.1:{PORT}")
    app.run(host="127.0.0.1", port=PORT, debug=False)
