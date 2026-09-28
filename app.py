"""
Derive.xyz Options Strategy Analyzer
====================================
Flask backend: proxies the public Derive (Lyra) REST API and computes
expiry payoff, Derive trading fees, breakevens and capital for 12 option
strategies.

Environment variables
---------------------
PORT              web server port                     (default 5000)
FLASK_DEBUG       "1" to enable the Flask debugger    (default off)
DERIVE_BASE_URL   upstream API base url               (default https://api.lyra.finance)
"""

import os
import math
import itertools
import re
from datetime import datetime, timezone
from flask import Flask, render_template, jsonify, request
import requests as http_requests

app = Flask(__name__)
# Pick up template edits without a restart during local development.
app.config["TEMPLATES_AUTO_RELOAD"] = os.environ.get("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes", "on") or os.environ.get("TEMPLATES_AUTO_RELOAD", "0") == "1"
BASE_URL = os.environ.get("DERIVE_BASE_URL", "https://api.lyra.finance").rstrip("/")
MAX_COMBOS = 30
# Derive options settle at 08:00 UTC on their expiry date.
EXPIRY_HOUR_UTC = 8
MAX_CONTRACT_SIZE = 1_000_000

# ═══ DERIVE TRADING FEES — https://docs.derive.xyz/reference/fees-1 ═══
# Option taker: $0.50 flat base fee per order + min(0.03% x notional, 12.5% x premium)
# Spot:         no maker and no taker fees
OPTION_TAKER_BASE_FEE = 0.50
OPTION_TAKER_NOTIONAL_RATE = 0.0003
OPTION_MAKER_NOTIONAL_RATE = 0.0001
OPTION_PREMIUM_FEE_CAP = 0.125
SPOT_TAKER_FEE_RATE = 0.0
FEE_MODES = ("taker", "maker", "rfq")
# ═══ CACHE (expires after 5 min) ═══
_cache = {}
def cache_get(key, ttl=300):
    import time
    entry = _cache.get(key)
    if entry and time.time() - entry["ts"] < ttl:
        return entry["data"]
    return None
def cache_set(key, data):
    import time
    _cache[key] = {"data": data, "ts": time.time()}

ATM_THRESHOLD = 0.03


# ═══════════════════════════════════════════════════════════════════════════════
#  TERMINAL OUTPUT
# ═══════════════════════════════════════════════════════════════════════════════

class C:
    """ANSI color codes for terminal."""
    RESET  = "\033[0m"
    BOLD   = "\033[1m"
    DIM    = "\033[2m"
    PURPLE = "\033[38;5;141m"
    BLUE   = "\033[38;5;111m"
    GREEN  = "\033[38;5;114m"
    RED    = "\033[38;5;210m"
    AMBER  = "\033[38;5;221m"
    CYAN   = "\033[38;5;117m"
    WHITE  = "\033[38;5;255m"
    GRAY   = "\033[38;5;243m"

BOX_TL, BOX_TR, BOX_BL, BOX_BR = "\u2554", "\u2557", "\u255a", "\u255d"
BOX_H, BOX_V, ARROW, DIAMOND, TICK = "\u2550", "\u2551", "\u25b8", "\u25c6", "\u2713"


def log_startup(port):
    """Print the boot banner, padded so the box stays aligned for any URL."""
    inner = 55  # printable width between the box borders

    def visible_len(text):
        return len(re.sub(r"\033\[[0-9;]*m", "", text))

    def row(label, value="", value_color=C.WHITE):
        pad = " " * max(0, inner - 3 - visible_len(label) - visible_len(value))
        return f"  {C.PURPLE}{BOX_V}{C.GREEN}   {label}{value_color}{value}{C.PURPLE}{pad}{BOX_V}"

    blank = f"  {C.PURPLE}{BOX_V}{' ' * inner}{BOX_V}"
    lines = [
        f"  {C.PURPLE}{C.BOLD}{BOX_TL}{BOX_H * inner}{BOX_TR}",
        blank,
        row(f"{C.CYAN}{DIAMOND}  Option Strategy Analyzer"),
        row(f"{C.DIM}Powered by Derive.xyz"),
        blank,
        row(f"{ARROW} Server:  ", f"http://localhost:{port}"),
        row(f"{ARROW} Status:  ", f"Running {TICK}", C.GREEN),
        row(f"{ARROW} API:     ", BASE_URL),
        blank,
        f"  {C.PURPLE}{BOX_BL}{BOX_H * inner}{BOX_BR}{C.RESET}",
    ]
    print("\n" + "\n".join(lines) + "\n")


def log_request(method, path, status, duration_ms=None):
    status_color = C.GREEN if 200 <= status < 300 else C.RED if status >= 400 else C.AMBER
    dur = f" {C.DIM}({duration_ms:.0f}ms){C.RESET}" if duration_ms else ""
    print(f"  {C.GRAY}▸{C.RESET} {C.DIM}{method}{C.RESET} {C.WHITE}{path}{C.RESET} → {status_color}{status}{C.RESET}{dur}")

def log_event(msg, level="info"):
    icons = {"info": f"{C.BLUE}ℹ{C.RESET}", "ok": f"{C.GREEN}✓{C.RESET}",
             "warn": f"{C.AMBER}⚠{C.RESET}", "err": f"{C.RED}✗{C.RESET}"
    }
    print(f"  {icons.get(level, icons['info'])} {msg}")


# ═══════════════════════════════════════════════════════════════════════════════
#  OPTION PARSING
# ═══════════════════════════════════════════════════════════════════════════════

def utcnow():
    """Timezone-aware current UTC time (datetime.utcnow() is deprecated)."""
    return datetime.now(timezone.utc)


def parse_expiry_date(date_str):
    """'20260130' -> aware datetime at the 08:00 UTC Derive settlement time."""
    return datetime.strptime(date_str, "%Y%m%d").replace(
        hour=EXPIRY_HOUR_UTC, tzinfo=timezone.utc)


def days_to_expiry(expiry_dt, now=None):
    """Calendar days left, rounded up — an option settling in 6h is '1d', not '0d'."""
    delta = (expiry_dt - (now or utcnow())).total_seconds()
    return max(0, math.ceil(delta / 86400.0))


def parse_option_name(name):
    parts = name.split("-")
    if len(parts) != 4: return None
    underlying, date_str, strike_str, opt_code = parts
    try:
        expiry_dt = parse_expiry_date(date_str)
        return {"underlying":underlying,"expiry":date_str,
                "expiry_display":expiry_dt.strftime("%b %d"),
                "strike":float(strike_str),
                "type":"call" if opt_code=="C" else "put",
                "type_code":opt_code,"days_to_expiry":days_to_expiry(expiry_dt)}
    except (ValueError,IndexError): return None


def moneyness(strike, spot, opt_type):
    if spot <= 0: return "ATM"
    diff = (strike - spot) / spot
    if abs(diff) <= ATM_THRESHOLD: return "ATM"
    if opt_type == "call": return "ITM" if diff < 0 else "OTM"
    else: return "ITM" if diff > 0 else "OTM"


def strategy_moneyness(leg_details, spot):
    if spot <= 0: return "ATM"
    net_delta = 0.0
    for l in leg_details:
        if l["opt_type"] == "underlying":
            net_delta += 1.0 if l["direction"] in ("Buy","Long") else -1.0
        else:
            sign = 1 if l["direction"] == "Buy" else -1
            net_delta += sign * (l["greeks"] or {}).get("delta", 0)
    if abs(net_delta) < 0.15: return "ATM"
    return "Bullish" if net_delta > 0 else "Bearish"


# ═══════════════════════════════════════════════════════════════════════════════
#  STRATEGIES
# ═══════════════════════════════════════════════════════════════════════════════

STRATEGIES = [
    {"id":"protective_put","name":"Protective Put","emoji":"🛡️","category":"hedging","risk":"bullish_hedged",
     "requires_holding":True,"market":"Bullish with downside protection",
     "description":"Hold the underlying asset + buy a put option to protect against downside while keeping upside potential.",
     "features":["Limited downside risk","Keeps unlimited upside","Costs the put premium","Good for uncertain markets"],
     "legs":[{"dir":"hold","type":"underlying","strike":"SPOT"},{"dir":"buy","type":"put","strike":"STRIKE"}]},
    {"id":"long_call","name":"Long Call","emoji":"📈","category":"single","risk":"bullish",
     "requires_holding":False,"market":"Strongly bullish",
     "description":"Buy a call option to profit from upward price movement with limited risk.",
     "features":["Unlimited upside potential","Limited downside (premium only)","Leveraged exposure","Time decay hurts"],
     "legs":[{"dir":"buy","type":"call","strike":"STRIKE"}]},
    {"id":"long_put","name":"Long Put","emoji":"📉","category":"single","risk":"bearish",
     "requires_holding":False,"market":"Strongly bearish",
     "description":"Buy a put option to profit from downward price movement with limited risk.",
     "features":["Large downside profit potential","Limited loss (premium only)","Good for hedging","Time decay hurts"],
     "legs":[{"dir":"buy","type":"put","strike":"STRIKE"}]},
    {"id":"covered_call","name":"Covered Call","emoji":"🛡️","category":"income","risk":"neutral_bullish",
     "requires_holding":True,"market":"Neutral to mildly bullish",
     "description":"Hold the underlying + sell a call to earn premium income while capping upside.",
     "features":["Generates income","Reduces cost basis","Capped upside","Mild downside protection"],
     "legs":[{"dir":"hold","type":"underlying","strike":"SPOT"},{"dir":"sell","type":"call","strike":"STRIKE"}]},
    {"id":"collar","name":"Collar","emoji":"🔒","category":"hedging","risk":"bullish_hedged",
     "requires_holding":True,"market":"Neutral hedging",
     "description":"Hold underlying + buy OTM put + sell OTM call for low-cost downside protection.",
     "features":["Low-cost protection","Capped upside & downside","Good for profit-locking","Zero-cost possible"],
     "legs":[{"dir":"hold","type":"underlying","strike":"SPOT"},{"dir":"buy","type":"put","strike":"LONG"},{"dir":"sell","type":"call","strike":"SHORT"}]},
    {"id":"bull_call_spread","name":"Bull Call Spread","emoji":"🟢","category":"spread","risk":"bullish",
     "requires_holding":False,"market":"Moderately bullish",
     "description":"Buy lower-strike call + sell higher-strike call for defined risk/reward.",
     "features":["Limited profit & loss","Lower cost than long call","Defined risk/reward","Best near expiry if bullish"],
     "legs":[{"dir":"buy","type":"call","strike":"LONG"},{"dir":"sell","type":"call","strike":"SHORT"}]},
    {"id":"bear_put_spread","name":"Bear Put Spread","emoji":"🔴","category":"spread","risk":"bearish",
     "requires_holding":False,"market":"Moderately bearish",
     "description":"Buy higher-strike put + sell lower-strike put for defined risk/reward.",
     "features":["Limited profit & loss","Lower cost than long put","Defined risk/reward","Profits from decline"],
     "legs":[{"dir":"buy","type":"put","strike":"LONG"},{"dir":"sell","type":"put","strike":"SHORT"}]},
    {"id":"bull_put_spread","name":"Bull Put Spread","emoji":"🟢","category":"spread","risk":"bullish",
     "requires_holding":False,"market":"Mildly bullish (income)",
     "description":"Sell higher put + buy lower put — a credit spread that profits if price stays above.",
     "features":["Receives premium upfront","Limited risk","Profits from time decay","Neutral to bullish bias"],
     "legs":[{"dir":"sell","type":"put","strike":"SHORT"},{"dir":"buy","type":"put","strike":"LONG"}]},
    {"id":"bear_call_spread","name":"Bear Call Spread","emoji":"🔴","category":"spread","risk":"bearish",
     "requires_holding":False,"market":"Mildly bearish (income)",
     "description":"Sell lower call + buy higher call — a credit spread that profits if price stays below.",
     "features":["Receives premium upfront","Limited risk","Profits from time decay","Neutral to bearish bias"],
     "legs":[{"dir":"sell","type":"call","strike":"SHORT"},{"dir":"buy","type":"call","strike":"LONG"}]},
    {"id":"straddle","name":"Straddle","emoji":"⚡","category":"volatility","risk":"neutral",
     "requires_holding":False,"market":"High volatility expected",
     "description":"Buy call + put at same strike — profit from large moves in either direction.",
     "features":["Profits from big moves","Unlimited upside potential","Limited downside (premium)","Needs significant movement"],
     "legs":[{"dir":"buy","type":"call","strike":"STRADDLE"},{"dir":"buy","type":"put","strike":"STRADDLE"}]},
    {"id":"strangle","name":"Strangle","emoji":"⚡","category":"volatility","risk":"neutral",
     "requires_holding":False,"market":"High volatility expected (cheaper)",
     "description":"Buy OTM call + OTM put — cheaper alternative to straddle.",
     "features":["Cheaper than straddle","Needs bigger move to profit","Unlimited upside potential","Two breakeven points"],
     "legs":[{"dir":"buy","type":"call","strike":"LONG"},{"dir":"buy","type":"put","strike":"LONG2"}]},
    {"id":"iron_condor","name":"Iron Condor","emoji":"🦅","category":"range","risk":"neutral",
     "requires_holding":False,"market":"Low volatility / range-bound",
     "description":"Sell OTM put spread + sell OTM call spread — profit when price stays in range.",
     "features":["Profits from low volatility","Limited risk both sides","Time decay is your friend","Defined max profit/loss"],
     "legs":[{"dir":"buy","type":"put","strike":"LONG2"},{"dir":"sell","type":"put","strike":"LONG"},{"dir":"sell","type":"call","strike":"SHORT"},{"dir":"buy","type":"call","strike":"SHORT2"}]},
]


def get_all_strategies(): return STRATEGIES
def get_strategy_by_id(sid): return next((s for s in STRATEGIES if s["id"]==sid), None)


# ═══════════════════════════════════════════════════════════════════════════════
#  API HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def fetch_instruments(currency, instrument_type="option", expired=False):
    resp = http_requests.post(f"{BASE_URL}/public/get_instruments",
        json={"currency":currency,"expired":expired,"instrument_type":instrument_type}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data: raise Exception(data["error"].get("message","API Error"))
    result = data.get("result",[])
    raw_list = result if isinstance(result,list) else result.get("instruments",[])
    filtered = []
    for item in raw_list:
        name = item.get("instrument_name", "") if isinstance(item, dict) else ""
        if name.upper().startswith(f"{currency.upper()}-") and item.get("is_active", False):
            filtered.append(item)
    return filtered


def fetch_tickers(currency, expiry_date, instrument_type="option"):
    cache_key = f"tickers_{currency}_{expiry_date}_{instrument_type}"
    cached = cache_get(cache_key, ttl=15)
    if cached: return cached
    resp = http_requests.post(f"{BASE_URL}/public/get_tickers",
        json={"currency":currency,"expiry_date":expiry_date,"instrument_type":instrument_type}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    if "error" in data: raise Exception(data["error"].get("message","API Error"))
    result = data.get("result",{})
    tickers_dict = result.get("tickers",{})
    tickers = []
    for instrument_name, t in tickers_dict.items():
        if not instrument_name.upper().startswith(f"{currency.upper()}-"):
            continue
        raw_op = t.get("option_pricing") or {}
        option_pricing = {"delta":raw_op.get("d","0"),"gamma":raw_op.get("g","0"),"theta":raw_op.get("t","0"),
            "vega":raw_op.get("v","0"),"rho":raw_op.get("r","0"),"iv":raw_op.get("i","0"),
            "forward_price":raw_op.get("f","0"),"mark_price":raw_op.get("m","0"),
            "discount_factor":raw_op.get("df","1"),"bid_iv":raw_op.get("bi","0"),"ask_iv":raw_op.get("ai","0")}
        raw_st = t.get("stats") or {}
        stats = {"oi":raw_st.get("oi","0"),"v":raw_st.get("v","0"),"c":raw_st.get("c","0"),"n":raw_st.get("n",0)}
        tickers.append({"instrument_name":instrument_name,"best_ask_price":t.get("a","0"),
            "best_bid_price":t.get("b","0"),"best_ask_amount":t.get("A","0"),"best_bid_amount":t.get("B","0"),
            "index_price":t.get("I","0"),"mark_price":t.get("M","0"),
            "option_pricing":option_pricing,"stats":stats})
    cache_set(cache_key, tickers)
    return tickers


def _combination_candidates(sid, spot, calls, puts):
    """Yield candidate leg tuples for a strategy, in the order its legs are declared.

    `calls` / `puts` arrive sorted by ascending strike. The order of the yielded
    options must match the order of `STRATEGIES[...]["legs"]` (underlying legs are
    skipped by the caller), e.g. both put spreads declare the HIGHER strike leg
    first, so put-spread candidates are yielded as [higher, lower].
    """
    if sid in ("long_call", "covered_call"):
        for opt in calls:
            yield [opt]

    elif sid in ("long_put", "protective_put"):
        for opt in puts:
            yield [opt]

    elif sid in ("bull_call_spread", "bear_call_spread"):
        # legs: lower-strike call first, higher-strike call second
        for i, low in enumerate(calls):
            for high in calls[i + 1:]:
                if high["strike"] > low["strike"]:
                    yield [low, high]

    elif sid in ("bear_put_spread", "bull_put_spread"):
        # legs: higher-strike put first, lower-strike put second
        desc = sorted(puts, key=lambda x: -x["strike"])
        for i, high in enumerate(desc):
            for low in desc[i + 1:]:
                if low["strike"] < high["strike"]:
                    yield [high, low]

    elif sid == "collar":
        otm_puts = [p for p in puts if p["strike"] < spot]
        otm_calls = [c for c in calls if c["strike"] > spot]
        for pp in otm_puts:
            for cc in otm_calls:
                yield [pp, cc]

    elif sid == "straddle":
        call_map = {c["strike"]: c for c in calls}
        put_map = {p["strike"]: p for p in puts}
        for k in sorted(set(call_map) & set(put_map)):
            yield [call_map[k], put_map[k]]

    elif sid == "strangle":
        otm_calls = [c for c in calls if c["strike"] >= spot]
        otm_puts = sorted([p for p in puts if p["strike"] <= spot], key=lambda x: -x["strike"])
        for co in otm_calls:
            for po in otm_puts:
                if co["strike"] != po["strike"]:
                    yield [co, po]

    elif sid == "iron_condor":
        otm_puts = sorted([p for p in puts if p["strike"] < spot], key=lambda x: -x["strike"])
        otm_calls = [c for c in calls if c["strike"] > spot]
        # legs: buy lower put, sell higher put, sell lower call, buy higher call
        for i, sell_put in enumerate(otm_puts):
            for buy_put in otm_puts[i + 1:]:
                for j, sell_call in enumerate(otm_calls):
                    for buy_call in otm_calls[j + 1:]:
                        yield [buy_put, sell_put, sell_call, buy_call]


def generate_combinations(strategy, spot, calls, puts):
    """Return at most MAX_COMBOS strike combinations for the given strategy."""
    return list(itertools.islice(
        _combination_candidates(strategy["id"], spot, calls, puts), MAX_COMBOS))


def leg_premium(opt, direction, use_mark=False):
    """Executable premium for one leg.

    A buy lifts the offer and a sell hits the bid, so using the mark price for both
    sides (the previous behaviour) ignored the bid/ask spread and made every spread
    look cheaper than it trades. Falls back to mark, then to the other side of the
    book, when a quote is missing.
    """
    ask, bid, mark = opt["best_ask"], opt["best_bid"], opt["mark_price"]
    if use_mark:
        for price, src in ((mark, "mark"), (ask, "ask"), (bid, "bid")):
            if price > 0:
                return price, src
        return 0.0, "none"
    order = ((ask, "ask"), (mark, "mark"), (bid, "bid")) if direction > 0 else \
            ((bid, "bid"), (mark, "mark"), (ask, "ask"))
    for price, src in order:
        if price > 0:
            return price, src
    return 0.0, "none"


def payoff_at(legs, spot, price, contract_size=1, fee=0.0):
    """Net P&L of the position at `price` on expiry day."""
    total = 0.0
    for leg in legs:
        d, ot, k, p = leg["direction"], leg["opt_type"], leg["strike"], leg["premium"]
        if ot == "underlying":
            total += d * (price - spot)
        elif ot == "call":
            total += d * (max(price - k, 0) - p)
        else:
            total += d * (max(k - price, 0) - p)
    return total * contract_size - fee


def payoff_extremes(legs, spot, contract_size=1, fee=0.0):
    """Exact best/worst case of a piecewise-linear expiry payoff.

    Kinks only occur at strikes, so the extremes are found among {0, strikes, +inf}.
    The far-upside behaviour is decided by the slope above the highest strike:
    calls and the underlying contribute +1 per unit, puts contribute 0. Downside is
    always bounded because the price cannot go below zero — which is why a covered
    call must NOT be reported as having unlimited loss.
    """
    strikes = sorted({l["strike"] for l in legs if l["opt_type"] != "underlying"})
    slope_up = sum(l["direction"] for l in legs if l["opt_type"] in ("call", "underlying"))

    probe = [0.0] + strikes
    probe.append((max(strikes) if strikes else spot) * 1.5 + spot * 0.5)
    values = [(payoff_at(legs, spot, price, contract_size, fee), price) for price in probe]

    max_profit, max_profit_price = max(values, key=lambda v: v[0])
    max_loss, max_loss_price = min(values, key=lambda v: v[0])
    return {
        "max_profit": max_profit, "max_profit_price": max_profit_price,
        "max_loss": max_loss, "max_loss_price": max_loss_price,
        "max_profit_inf": slope_up > 0,
        "max_loss_inf": slope_up < 0,
    }


def option_variable_fee(spot, premium, amount, taker=True):
    """Variable part of a Derive option fee for one leg.

    https://docs.derive.xyz/reference/fees-1
        taker: min(0.03% x notional, 12.5% x premium)
        maker: min(0.01% x notional, 12.5% x premium)
    with notional = spot x amount and premium = option price x amount.
    """
    rate = OPTION_TAKER_NOTIONAL_RATE if taker else OPTION_MAKER_NOTIONAL_RATE
    return min(rate * spot * amount, OPTION_PREMIUM_FEE_CAP * premium * amount)


def spot_taker_fee(spot, amount):
    """Derive charges no maker/taker fee on spot trades."""
    return SPOT_TAKER_FEE_RATE * spot * amount


def rfq_group(leg):
    """RFQ fee group of a leg: long calls / long puts / short calls / short puts."""
    side = "long" if leg["direction"] == "Buy" else "short"
    return f"{side}_{leg['opt_type']}s"


def apply_rfq_discounts(fees_by_leg, groups):
    """Apply Derive's RFQ multi-leg discount to per-leg variable fees.

    Legs are grouped (long calls / long puts / short calls / short puts / perps),
    the fee is summed per group and the most expensive group always pays in full.
    Ranked by group total, the remaining groups get: cheapest 100% off, second and
    third cheapest 50% off, anything else no discount.
    """
    totals = {}
    for idx, group in groups.items():
        totals[group] = totals.get(group, 0.0) + fees_by_leg[idx]
    if len(totals) <= 1:
        return {idx: 1.0 for idx in groups}

    # cheapest first; the most expensive group is excluded from the discount ladder
    ranked = sorted(totals, key=lambda g: totals[g])[:-1]
    discount = {}
    for rank, group in enumerate(ranked):
        discount[group] = 0.0 if rank == 0 else (0.5 if rank in (1, 2) else 1.0)
    return {idx: discount.get(group, 1.0) for idx, group in groups.items()}


def apply_trading_fees(leg_details, spot, contract_size, include_fees=True, fee_mode="taker"):
    """Attach a per-leg `fee` to leg_details and return their exact total.

    fee_mode:
      taker  each leg is its own aggressive orderbook order:
             $0.50 base per leg + the variable taker fee
      maker  resting limit orders: variable maker fee only, no base fee
      rfq    one multi-leg quote: variable taker fee per leg with the RFQ group
             discounts, plus a single $0.50 base fee for the whole structure
             (attributed to the leg that pays the full fee, so the per-leg column
             still adds up to the total)

    Leg fees are rounded to cents (what actually gets charged) and the total is the
    sum of those rounded values, so the breakdown always adds up to the total.
    """
    if not include_fees:
        for leg in leg_details:
            leg["fee"] = 0.0
        return 0.0

    taker = fee_mode != "maker"
    raw = {}
    groups = {}
    for idx, leg in enumerate(leg_details):
        if leg["opt_type"] == "underlying":
            raw[idx] = spot_taker_fee(spot, contract_size)   # spot is free on Derive
        else:
            raw[idx] = option_variable_fee(spot, leg["premium"], contract_size, taker)
            groups[idx] = rfq_group(leg)

    multipliers = apply_rfq_discounts(raw, groups) if fee_mode == "rfq" else {}

    base_target = None
    if fee_mode == "rfq" and groups:
        # the single taker base fee rides along with the most expensive leg
        base_target = max(groups, key=lambda i: raw[i] * multipliers.get(i, 1.0))

    total = 0.0
    for idx, leg in enumerate(leg_details):
        fee = raw[idx] * multipliers.get(idx, 1.0)
        if fee_mode == "taker" and leg["opt_type"] != "underlying":
            fee += OPTION_TAKER_BASE_FEE          # one order per leg
        if idx == base_target:
            fee += OPTION_TAKER_BASE_FEE          # one order for the whole RFQ
        leg["fee"] = round(fee, 2)
        leg["fee_discount"] = round(1 - multipliers.get(idx, 1.0), 2) if idx in groups else 0.0
        total += leg["fee"]
    return round(total, 2)


def compute_payoff(legs, spot, contract_size=1, n_points=250):
    min_k = min((l["strike"] for l in legs if l["opt_type"]!="underlying"),default=spot*0.7)
    max_k = max((l["strike"] for l in legs if l["opt_type"]!="underlying"),default=spot*1.3)
    lo = max(spot*0.5,min_k*0.7); hi = min(spot*2.0,max_k*1.5)
    lo,hi = min(lo,spot*0.8),max(hi,spot*1.2)
    step=(hi-lo)/(n_points-1); prices=[lo+i*step for i in range(n_points)]
    net_premium=sum(l["direction"]*l["premium"] for l in legs if l["opt_type"]!="underlying")*contract_size
    pnl=[]
    for price in prices:
        total=0.0
        for l in legs:
            d,ot,k,p=l["direction"],l["opt_type"],l["strike"],l["premium"]
            if ot=="underlying": total+=d*(price-spot)
            elif ot=="call": total+=d*(max(price-k,0)-p)
            elif ot=="put": total+=d*(max(k-price,0)-p)
        # 4 decimals: the client rescales this curve when the contract size
        # changes, and 2-decimal rounding lost the sign of small payoffs.
        pnl.append(round(total*contract_size,4))
    return prices,pnl,net_premium


# ═══════════════════════════════════════════════════════════════════════════════
#  ROUTES
# ═══════════════════════════════════════════════════════════════════════════════

@app.route("/")
def index(): return render_template("index.html")


@app.route("/api/strategies")
def api_strategies(): return jsonify(get_all_strategies())


def default_contract_size(spot):
    """A sensible default trade size for any asset: the power of ten whose
    notional is closest to ~$100, so BTC -> 0.001, ETH -> 0.01, SOL -> 1."""
    if not spot or spot <= 0:
        return 1.0
    exponent = round(math.log10(100.0 / spot))
    return float(min(max(10 ** exponent, 0.0001), 1000))


def fetch_currencies():
    """All currencies configured on the exchange (cached — it is one call)."""
    cached = cache_get("all_currencies", ttl=300)
    if cached is not None:
        return cached
    resp = http_requests.post(f"{BASE_URL}/public/get_all_currencies",
                              headers={"accept": "application/json",
                                       "content-type": "application/json"},
                              json={}, timeout=15)
    resp.raise_for_status()
    data = resp.json().get("result", []) or []
    cache_set("all_currencies", data)
    return data


def currency_has_options(entry):
    """True when the exchange has an option asset registered for this currency.

    v3 exposes an `option` asset entry; older payloads only carry `market_type`,
    so both shapes are accepted and we never have to probe instruments per asset.
    """
    if entry.get("option"):
        return True
    market_type = str(entry.get("market_type") or "").upper()
    return market_type in ("ALL", "SRM_OPTION_ONLY")


@app.route("/api/assets", methods=["GET", "POST"])
def api_assets():
    """Tradable option underlyings, straight from the exchange.

    One upstream call lists every currency together with its registered assets,
    so the UI can offer exactly what Derive supports without fetching an option
    chain per asset — chains are only loaded for the asset the user picks.
    """
    try:
        assets = []
        for entry in fetch_currencies():
            currency = str(entry.get("currency", "")).upper()
            if not currency or not currency_has_options(entry):
                continue
            try:
                spot = float(entry.get("spot_price") or 0)
            except (TypeError, ValueError):
                spot = 0.0
            try:
                spot_24h = float(entry.get("spot_price_24h") or 0)
            except (TypeError, ValueError):
                spot_24h = 0.0
            assets.append({
                "currency": currency,
                "spot": round(spot, 2),
                "spot_24h": round(spot_24h, 2),
                "change_24h": round((spot - spot_24h) / spot_24h * 100, 2) if spot_24h else 0.0,
                "has_perp": bool(entry.get("perp")),
                "default_contract_size": default_contract_size(spot),
            })
        assets.sort(key=lambda a: (-a["spot"], a["currency"]))
        if not assets:
            return jsonify({"error": "No option markets available"}), 503
        log_event(f"Loaded {len(assets)} option underlyings from the exchange")
        return jsonify({"assets": assets})
    except http_requests.RequestException as e:
        return jsonify({"error": f"Could not reach the exchange: {e}"}), 502
    except Exception as e:
        log_event(f"/api/assets failed: {e}", "error")
        return jsonify({"error": str(e)}), 500


MARGIN_TYPES = ("SM", "PM2")


@app.route("/api/margin", methods=["POST"])
def api_margin():
    """Real exchange margin for one strategy via Derive's public simulator.

    https://docs.derive.xyz/api-reference/subaccounts/publicget_margin
    Option legs are sent as simulated positions (negative amount = short) and a
    held underlying as simulated collateral. The response is NET margin — mark to
    market minus the requirement — so the collateral a trader must post is
    max(0, -net_initial_margin).

    Deliberately one call per request (triggered from the chart modal) instead of
    one per combination: analysing 30 combos would otherwise fire 30 upstream
    requests and blow through Derive's 5 requests/second read limit.
    """
    try:
        body = request.json or {}
        asset = str(body.get("asset", "BTC")).upper()
        legs = body.get("legs") or []
        margin_type = str(body.get("margin_type", "SM")).upper()
        if margin_type not in MARGIN_TYPES:
            return jsonify({"error": f"margin_type must be one of {', '.join(MARGIN_TYPES)}"}), 400
        try:
            contract_size = float(body.get("contract_size", 1))
        except (TypeError, ValueError):
            return jsonify({"error": "Contract size must be a number"}), 400
        if not (contract_size > 0):
            return jsonify({"error": "Contract size must be greater than zero"}), 400
        if not legs:
            return jsonify({"error": "No legs supplied"}), 400

        positions, collaterals = [], []
        for leg in legs:
            direction = 1 if str(leg.get("direction", "Buy")).lower() in ("buy", "long") else -1
            if leg.get("opt_type") == "underlying":
                collaterals.append({"asset_name": asset,
                                    "amount": str(direction * contract_size)})
                continue
            name = leg.get("name") or leg.get("instrument_name")
            if not name:
                return jsonify({"error": "Leg is missing an instrument name"}), 400
            positions.append({"instrument_name": name,
                              "amount": str(direction * contract_size)})
        if not positions:
            return jsonify({"error": "No option legs to margin"}), 400

        payload = {"margin_type": margin_type,
                   "simulated_collaterals": collaterals,
                   "simulated_positions": positions}
        if margin_type == "PM2":
            payload["market"] = asset

        resp = http_requests.post(f"{BASE_URL}/public/get_margin",
                                  headers={"accept": "application/json",
                                           "content-type": "application/json"},
                                  json=payload, timeout=15)
        if resp.status_code != 200:
            log_event(f"get_margin upstream {resp.status_code}", "warn")
            return jsonify({"error": f"Exchange margin service returned {resp.status_code}"}), 502
        result = (resp.json() or {}).get("result") or {}
        if not result:
            return jsonify({"error": "Exchange margin service returned no result"}), 502

        def num(key):
            try:
                return float(result.get(key) or 0)
            except (TypeError, ValueError):
                return 0.0

        initial = num("pre_initial_margin")
        maintenance = num("pre_maintenance_margin")
        return jsonify({
            "asset": asset, "margin_type": margin_type,
            "contract_size": contract_size,
            "net_initial_margin": round(initial, 2),
            "net_maintenance_margin": round(maintenance, 2),
            "required_collateral": round(max(0.0, -initial), 2),
            "maintenance_collateral": round(max(0.0, -maintenance), 2),
            "legs": len(positions), "collaterals": len(collaterals),
        })
    except http_requests.RequestException as e:
        return jsonify({"error": f"Could not reach the exchange margin service: {e}"}), 502
    except Exception as e:
        log_event(f"/api/margin failed: {e}", "error")
        return jsonify({"error": str(e)}), 500


@app.route("/api/health")
def api_health():
    try:
        resp = http_requests.post(f"{BASE_URL}/public/get_all_currencies",
            headers={"accept":"application/json","content-type":"application/json"}, json={}, timeout=5)
        if resp.status_code == 200: return jsonify({"status":"ok","api":"reachable"})
        return jsonify({"status":"degraded","api":"unreachable"}), 503
    except: return jsonify({"status":"down","api":"unreachable"}), 503


@app.route("/api/spot", methods=["POST"])
def api_spot():
    try:
        asset = request.json.get("asset","BTC")
        cache_key = f"spot_{asset}"
        cached = cache_get(cache_key, ttl=5) # 5 second spot cache
        if cached: return jsonify({"spot":round(cached,2),"asset":asset})
        
        r = http_requests.post(f"{BASE_URL}/public/get_tickers",
            json={"currency": asset, "instrument_type": "perp"}, timeout=8)
        for name, t in r.json().get("result", {}).get("tickers", {}).items():
            s = float(t.get("I", 0))
            if s > 0:
                cache_set(cache_key, s)
                return jsonify({"spot":round(s,2),"asset":asset})
        return jsonify({"spot":0,"asset":asset})
    except Exception as e: return jsonify({"spot":0,"error":str(e)})


@app.route("/api/expiries", methods=["POST"])
def api_expiries():
    try:
        asset = request.json.get("asset","BTC")
        cache_key = f"instruments_{asset}"
        instruments = cache_get(cache_key)
        if not instruments:
            instruments = fetch_instruments(asset,"option",False)
            cache_set(cache_key, instruments)
        expiries,seen=[],set(); now = utcnow()
        for inst in instruments:
            if not inst.get("is_active", False): continue
            info = parse_option_name(inst.get("instrument_name",""))
            if info and info["underlying"].upper() == asset.upper() and info["expiry"] not in seen:
                exp_dt = parse_expiry_date(info["expiry"]); days = days_to_expiry(exp_dt, now)
                if exp_dt > now:
                    expiries.append({"date":info["expiry"],"display":exp_dt.strftime("%b %d, %Y")+f" ({days}d)","days":days})
                    seen.add(info["expiry"])
        expiries.sort(key=lambda x:x["date"])
        log_event(f"Loaded {len(expiries)} expiry dates for {asset}")
        return jsonify({"expiries":expiries})
    except Exception as e: return jsonify({"error":str(e)}),500


@app.route("/api/compute", methods=["POST"])
def api_compute():
    try:
        body=request.json or {}; asset=body.get("asset","BTC"); expiry=body.get("expiry")
        strategy_ids=body.get("strategies",[])
        include_fees=bool(body.get("include_fees", True))
        use_mark_prices=bool(body.get("use_mark_prices", False))
        fee_mode=str(body.get("fee_mode", "taker")).lower()
        if fee_mode not in FEE_MODES:
            return jsonify({"error":f"fee_mode must be one of {', '.join(FEE_MODES)}"}),400
        if not expiry: return jsonify({"error":"Select an expiry"}),400
        if not strategy_ids: return jsonify({"error":"Select at least one strategy"}),400

        # ── Validate contract size (a zero/negative/NaN size silently produced
        #    inverted or all-zero results before) ──
        try:
            contract_size = float(body.get("contract_size", 1))
        except (TypeError, ValueError):
            return jsonify({"error":"Contract size must be a number"}),400
        if math.isnan(contract_size) or math.isinf(contract_size) or contract_size <= 0:
            return jsonify({"error":"Contract size must be greater than zero"}),400
        if contract_size > MAX_CONTRACT_SIZE:
            return jsonify({"error":f"Contract size must be at most {MAX_CONTRACT_SIZE:,.0f}"}),400

        log_event(f"Computing {len(strategy_ids)} strategies for {asset} {expiry} (size={contract_size})")
        tickers=fetch_tickers(asset,expiry,"option")
        if not tickers: return jsonify({"error":f"No options for {asset} expiring {expiry}"}),404

        calls,puts=[],[]; spot=0.0; expiry_display=""
        for t in tickers:
            info=parse_option_name(t["instrument_name"])
            if not info or info["underlying"].upper() != asset.upper(): continue
            if not expiry_display: expiry_display=datetime.strptime(info["expiry"],"%Y%m%d").strftime("%b %d, %Y")
            best_ask=float(t.get("best_ask_price",0)); best_bid=float(t.get("best_bid_price",0))
            mark_price=float(t.get("mark_price",0)); idx_price=float(t.get("index_price",0))
            if idx_price>0: spot=idx_price
            op=t.get("option_pricing") or {}; st=t.get("stats") or {}
            greeks={"delta":float(op.get("delta",0)),"gamma":float(op.get("gamma",0)),
                "theta":float(op.get("theta",0)),"vega":float(op.get("vega",0)),
                "rho":float(op.get("rho",0)),"iv":float(op.get("iv",0))}
            entry={"name":t["instrument_name"],"strike":info["strike"],"type":info["type"],
                "expiry_display":info["expiry_display"],"days_to_expiry":info["days_to_expiry"],
                "best_ask":best_ask,"best_bid":best_bid,"mark_price":mark_price,
                "greeks":greeks,"open_interest":float(st.get("oi",0)),"volume":float(st.get("v",0))}
            (calls if info["type"]=="call" else puts).append(entry)
        calls.sort(key=lambda x:x["strike"]); puts.sort(key=lambda x:x["strike"])
        if spot<=0: return jsonify({"error":"Could not determine spot price"}),500

        results=[]; total_combos=0
        for strategy_id in strategy_ids:
            strategy=get_strategy_by_id(strategy_id)
            if not strategy: continue
            combos=generate_combinations(strategy,spot,calls,puts)
            strategy_combos=0
            for combo_opts in combos:
                combo_copy=list(combo_opts); calc_legs=[]; leg_details=[]
                has_underlying=False
                for leg_def in strategy["legs"]:
                    if leg_def["type"]=="underlying":
                        has_underlying=True
                        calc_legs.append({"direction":1,"opt_type":"underlying","strike":spot,"premium":0})
                        leg_details.append({"name":f"{asset} Spot","direction":"Long","opt_type":"underlying",
                            "strike":spot,"expiry_display":"—","premium":0,"mark_price":0,
                            "best_ask":0,"best_bid":0,
                            "greeks":{"delta":1,"gamma":0,"theta":0,"vega":0,"iv":0},
                            "open_interest":0,"volume":0,"description":f"Long {asset}","moneyness":"ATM"})
                        continue
                    opt=combo_copy.pop(0) if combo_copy else None
                    if not opt: break
                    direction=1 if leg_def["dir"] in ("buy","hold") else -1
                    dir_label="Buy" if direction>0 else "Sell"
                    premium, premium_source = leg_premium(opt, direction, use_mark_prices)
                    mn=moneyness(opt["strike"],spot,opt["type"])
                    calc_legs.append({"direction":direction,"opt_type":opt["type"],"strike":opt["strike"],"premium":premium})
                    s_val=int(opt["strike"]) if opt["strike"]==int(opt["strike"]) else opt["strike"]
                    leg_details.append({"name":opt["name"],"direction":dir_label,"opt_type":opt["type"],
                        "strike":opt["strike"],"expiry_display":opt["expiry_display"],"premium":premium,
                        "premium_source":premium_source,
                        "mark_price":opt["mark_price"],"best_ask":opt["best_ask"],"best_bid":opt["best_bid"],
                        "greeks":opt["greeks"],"open_interest":opt["open_interest"],"volume":opt["volume"],
                        "description":f"{dir_label} {asset} {s_val} {'Call' if opt['type']=='call' else 'Put'} ({opt['expiry_display']})",
                        "moneyness":mn})
                if not calc_legs: continue

                total_fee = apply_trading_fees(leg_details, spot, contract_size,
                                               include_fees, fee_mode)

                prices, pnl_ex_fee, net_premium = compute_payoff(calc_legs, spot, contract_size)
                # Fees are paid up front, so they shift the whole payoff curve down.
                pnl = [round(p - total_fee, 4) for p in pnl_ex_fee] if total_fee > 0 else pnl_ex_fee
                # Collateral is sized on the pre-fee payoff; the fee is added once, below.
                max_loss_ex_fee = min(pnl_ex_fee) if pnl_ex_fee else 0.0

                if not pnl: continue

                # ═══ EXACT EXTREMES ═══
                # The expiry payoff is piecewise linear, so its extremes sit either at
                # a strike, at S=0, or out at infinity. Evaluating those points exactly
                # replaces the old grid scan + magnitude heuristics, which wrongly called
                # a covered call's (bounded) downside "unlimited".
                extremes = payoff_extremes(calc_legs, spot, contract_size, total_fee)
                max_profit = extremes["max_profit"]
                max_loss = extremes["max_loss"]
                max_profit_price = extremes["max_profit_price"]
                max_loss_price = extremes["max_loss_price"]
                max_profit_inf = extremes["max_profit_inf"]
                max_loss_inf = extremes["max_loss_inf"]

                # Values below this are indistinguishable from zero for this trade size
                # (an absolute $0.01 cut-off hid real P&L at small contract sizes).
                zero_eps = max(1e-6, spot * contract_size * 1e-5)
                # Only snap values that are *within* epsilon of zero. A genuinely
                # negative max profit (a combo that can never pay off after crossing
                # the spread) must stay negative instead of being shown as break-even.
                if not max_loss_inf and abs(max_loss) <= zero_eps:
                    max_loss = 0.0
                if not max_profit_inf and abs(max_profit) <= zero_eps:
                    max_profit = 0.0

                # ═══ CAPITAL ═══
                # Underlying value (for strategies that hold the asset) + net debit
                # paid, or the collateral a credit strategy must post. The pre-fee
                # max loss is used here so the fee is not counted twice.
                underlying_cost = spot * contract_size if has_underlying else 0
                collateral = abs(min(max_loss_ex_fee, 0.0))
                if extremes["max_loss_inf"]:
                    collateral = abs(min(min(pnl_ex_fee), 0.0))
                if net_premium > 0:      # debit — premium is paid up front
                    total_cost = underlying_cost + net_premium
                elif net_premium < 0:    # credit — post collateral for the worst case
                    total_cost = underlying_cost + collateral
                else:                    # zero premium
                    total_cost = underlying_cost or collateral or 1
                total_cost += total_fee  # fees are cash out of the same account

                # Percentage: relative to total_cost
                if total_cost > 0:
                    if max_profit_inf: max_profit_pct = None
                    else:
                        raw = max_profit / total_cost * 100
                        max_profit_pct = round(min(raw,999.9),2) if abs(raw)>500 else round(raw,2)
                    if max_loss_inf: max_loss_pct = None
                    elif max_loss >= -zero_eps: max_loss_pct = 0.0
                    else:
                        raw = max_loss / total_cost * 100
                        max_loss_pct = round(max(raw,-999.9),2) if abs(raw)>500 else round(raw,2)
                else:
                    max_profit_pct=None; max_loss_pct=0.0 if max_loss >= -zero_eps else None

                # Breakevens
                breakevens=[]
                for i in range(len(pnl)-1):
                    if pnl[i]*pnl[i+1]<0:
                        x0,x1=prices[i],prices[i+1]; y0,y1=pnl[i],pnl[i+1]
                        if y1!=y0: breakevens.append(round(x0+(0-y0)*(x1-x0)/(y1-y0),2))
                distance_info=[]
                for be in breakevens:
                    dist_pct=round((be-spot)/spot*100,2)
                    if dist_pct>0: distance_info.append({"price":be,"pct":dist_pct,"label":"↑ to profit"})
                    else: distance_info.append({"price":be,"pct":abs(dist_pct),"label":"↓ to profit"})

                # Net option premium only (the underlying leg is capital, not premium):
                # positive = net debit paid, negative = net credit received.
                net_premium = sum(l["direction"] * l["premium"] for l in calc_legs
                                  if l["opt_type"] != "underlying") * contract_size
                overall_mn=strategy_moneyness(leg_details,spot)
                results.append({"id":strategy["id"],"name":f"{strategy['emoji']} {strategy['name']}",
                    "description":strategy["description"],"category":strategy["category"],"risk":strategy["risk"],
                    "moneyness":overall_mn,"legs":[ld["description"] for ld in leg_details],
                    "legs_detail":leg_details,"contract_size":contract_size,
                    "net_premium":round(net_premium,2),"total_cost":round(total_cost,2),"total_fee":round(total_fee,2),
                    # An unbounded extreme has no meaningful number — send null so no
                    # consumer accidentally treats the probe value as the real maximum.
                    "max_profit":None if max_profit_inf else round(max_profit,2),
                    "max_profit_pct":max_profit_pct,
                    "max_profit_inf":max_profit_inf,
                    "max_loss":None if max_loss_inf else round(max_loss,2),
                    "max_loss_pct":max_loss_pct,"max_loss_inf":max_loss_inf,
                    "max_profit_price":round(max_profit_price,2),"max_loss_price":round(max_loss_price,2),
                    "breakevens":breakevens,"distance":distance_info,
                    "pnl_chart":{"prices":[round(p,2) for p in prices],"pnl":pnl,"spot":round(spot,2),"breakevens":breakevens}})
                strategy_combos+=1
            total_combos+=strategy_combos

        if not results: return jsonify({"error":"No strategies could be computed."}),404
        log_event(f"Computed {total_combos} combinations across {len(strategy_ids)} strategies","ok")
        return jsonify({"spot":round(spot,2),"asset":asset,"expiry":expiry,
            "expiry_display":expiry_display,"contract_size":contract_size,
            "include_fees":include_fees,"use_mark_prices":use_mark_prices,"fee_mode":fee_mode,
            "fee_model":{"option_base":OPTION_TAKER_BASE_FEE,
                         "option_notional_rate":OPTION_TAKER_NOTIONAL_RATE,
                         "option_maker_rate":OPTION_MAKER_NOTIONAL_RATE,
                         "option_premium_cap":OPTION_PREMIUM_FEE_CAP,
                         "spot_rate":SPOT_TAKER_FEE_RATE},
            "strategies":results})
    except http_requests.exceptions.ConnectionError: return jsonify({"error":"Cannot connect to Derive API."}),503
    except http_requests.exceptions.Timeout: return jsonify({"error":"API timeout."}),504
    except Exception as e: log_event(f"Error: {str(e)}","err"); return jsonify({"error":f"Error: {str(e)}"}),500


# ═══════════════════════════════════════════════════════════════════════════════
#  REQUEST LOGGING MIDDLEWARE
# ═══════════════════════════════════════════════════════════════════════════════

@app.before_request
def before_request():
    import time
    request._start_time = time.time()

@app.after_request
def after_request(response):
    import time
    if hasattr(request, '_start_time'):
        duration = (time.time() - request._start_time) * 1000
        log_request(request.method, request.path, response.status_code, duration)
    return response




@app.route("/api/market", methods=["POST"])
def api_market():
    """Market stats — all API calls in PARALLEL for max speed."""
    try:
        import concurrent.futures
        body = request.json or {}
        asset = body.get("asset", "BTC")
        cached_expiry = body.get("expiry", None)

        # Find expiry if not cached
        expiry = cached_expiry
        if not expiry:
            cache_key = f"instruments_{asset}"
            instruments = cache_get(cache_key)
            if not instruments:
                instruments = fetch_instruments(asset, "option", False)
                cache_set(cache_key, instruments)
            now = utcnow()
            for inst in instruments:
                parts = inst.get("instrument_name", "").split("-")
                if len(parts) >= 2:
                    try:
                        exp_dt = parse_expiry_date(parts[1])
                        if exp_dt > now:
                            expiry = parts[1]
                            break
                    except:
                        continue

        # ── Run 3 API calls in PARALLEL ──
        def fetch_spot():
            try:
                r = http_requests.post(f"{BASE_URL}/public/get_tickers",
                    json={"currency": asset, "instrument_type": "perp"}, timeout=8)
                for name, t in r.json().get("result", {}).get("tickers", {}).items():
                    s = float(t.get("I", 0))
                    if s > 0:
                        return s
            except:
                pass
            return 0

        def fetch_iv():
            if not expiry:
                return []
            try:
                tickers = fetch_tickers(asset, expiry, "option")
                iv_data = []
                for name, t in (tickers.items() if isinstance(tickers, dict) else
                                [(x.get("instrument_name", ""), x) for x in tickers]):
                    if not name.upper().startswith(f"{asset.upper()}-"):
                        continue
                    parts = name.split("-")
                    if len(parts) < 4:
                        continue
                    op = t.get("option_pricing") or {}
                    iv = float(op.get("iv", 0))
                    try:
                        strike = float(parts[2])
                    except:
                        continue
                    if iv > 0:
                        iv_data.append({"strike": strike, "iv": iv})
                return iv_data
            except:
                return []

        def fetch_currencies():
            cached = cache_get("currencies", ttl=300)
            if cached:
                return cached
            try:
                resp = http_requests.post(f"{BASE_URL}/public/get_all_currencies",
                    headers={"accept": "application/json", "content-type": "application/json"},
                    json={}, timeout=8)
                data = resp.json().get("result", [])
                cache_set("currencies", data)
                return data
            except:
                return []

        # Execute all 3 in parallel
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
            f_spot = executor.submit(fetch_spot)
            f_iv = executor.submit(fetch_iv)
            f_curr = executor.submit(fetch_currencies)
            spot = f_spot.result()
            iv_data = f_iv.result()
            currencies = f_curr.result()

        # Process results
        spot_24h = 0
        for c in currencies:
            if isinstance(c, dict) and c.get("currency") == asset:
                spot_24h = float(c.get("spot_price_24h", 0))
                if spot <= 0:
                    spot = float(c.get("spot_price", 0))
                break

        dvol = 0
        iv_rank = 0
        atm_iv = 0
        if iv_data and spot > 0:
            atm = min(iv_data, key=lambda x: abs(x["strike"] - spot))
            atm_iv = atm["iv"]
            all_ivs = sorted([d["iv"] for d in iv_data])
            below = sum(1 for iv in all_ivs if iv <= atm_iv)
            iv_rank = round(below / len(all_ivs) * 100) if all_ivs else 0
            dvol = round(atm_iv * 100, 1)

        return jsonify({
            "asset": asset,
            "spot": round(spot, 2),
            "spot_24h": round(spot_24h, 2),
            "change_24h": round((spot - spot_24h) / spot_24h * 100, 2) if spot_24h > 0 else 0,
            "dvol": dvol,
            "iv_rank": iv_rank,
            "atm_iv": round(atm_iv * 100, 1),
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    # Debug mode exposes the interactive Werkzeug console — opt-in only.
    debug = os.environ.get("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes", "on")
    log_startup(port)
    if debug:
        log_event("FLASK_DEBUG is enabled — do not use this on a public host", "warn")
    app.run(host="0.0.0.0", port=port, debug=debug)
