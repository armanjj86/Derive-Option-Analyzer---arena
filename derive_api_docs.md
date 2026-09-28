# 📚 مستندات جامع API پلتفرم Derive.xyz
## راهنمای کامل برای توسعه‌دهندگان پایتون — آپشن‌های بیت‌کوین

---

## 1. معرفی کلی پلتفرم Derive

Derive یک پلتفرم ترید خودحضانتی (Self-Custodial) و با عملکرد بالا برای معاملات آپشن، پرپچوال و اسپات است.

### سه جزء اصلی:
| جزء | توضیح |
|-----|-------|
| **Derive Chain** | لایه تسویه — یک Optimistic Rollup روی OP Stack (اتریوم) |
| **Derive Protocol** | پروتکل تسویه برای معاملات مارجین‌دار بدون نیاز به اعتماد |
| **Derive Exchange** | اوردربوک متمرکز با تسویه غیرمتمرکز و خودحضانتی |

### محصولات پشتیبانی‌شده:
| محصول | فرمت نام‌گذاری | مثال |
|-------|---------------|------|
| **آپشن** | `$TICKER-$DAY$MONTH$YEAR-$STRIKE-C\|P` | `BTC-20250316-84000-C`, `BTC-20250316-80000-P` |
| **پرپچوال** | `$TICKER-PERP` | `BTC-PERP` |
| **اسپات** | `$BASE-$QUOTE` | `BTC-USDC` |
| **ERC20** | `$TICKER` | `BTC`, `ETH`, `USDC` |

---

## 2. آدرس‌های API

### Mainnet (اصلی):
| پروتکل | آدرس |
|---------|-------|
| **HTTP REST** | `https://api.lyra.finance` |
| **WebSocket** | `wss://api.lyra.finance/ws` |
| **RPC Node** | `https://rpc.lyra.finance` |
| **Block Explorer** | `https://explorer.lyra.finance` |

### Testnet (تست):
| پروتکل | آدرس |
|---------|-------|
| **HTTP REST** | `https://api-demo.lyra.finance` |
| **WebSocket** | `wss://api-demo.lyra.finance/ws` |
| **RPC Node** | `https://rpc-prod-testnet-0eakp60405.t.conduit.xyz` |
| **Block Explorer** | `https://explorer-prod-testnet-0eakp60405.t.conduit.xyz` |

---

## 3. پروتکل JSON-RPC

Derive از JSON-RPC استفاده می‌کند. هم روی HTTP و هم WebSocket کار می‌کند.

### ساختار درخواست WebSocket:
```json
{
  "id": "string",
  "method": "string",
  "params": {}
}
```

### ساختار پاسخ موفق:
```json
{
  "id": "string",
  "result": {}
}
```

### ساختار پاسخ خطا:
```json
{
  "id": "string",
  "error": {
    "code": -32602,
    "message": "Invalid params",
    "data": "string"
  }
}
```

### HTTP POST:
درخواست‌ها به آدرس endpoint مربوطه ارسال شده و `params` به‌صورت body ارسال می‌شود.

مثال:
```bash
curl --request POST \
     --url https://api.lyra.finance/public/get_instruments \
     --header 'accept: application/json' \
     --header 'content-type: application/json' \
     --data '{
       "currency": "BTC",
       "expired": false,
       "instrument_type": "option"
     }'
```

---

## 4. احراز هویت (Authentication)

### 4.1 احراز هویت REST (هدرها):
| هدر | توضیح |
|-----|-------|
| `X-LyraWallet` | آدرس کیف پول Derive (نه EOA اصلی — آدرس اسمارت کانترکت روی زنجیره) |
| `X-LyraTimestamp` | تایم‌استمپ UTC فعلی به میلی‌ثانیه |
| `X-LyraSignature` | امضای Keccak-256 (امضای استاندارد اتریوم) از `X-LyraTimestamp` با کلید خصوصی wallet یا session key |

```python
import time
from eth_account import Account
from eth_account.messages import encode_defunct

wallet_address = "0x..."
private_key = "0x..."
timestamp = int(time.time() * 1000)
message = encode_defunct(text=str(timestamp))
signed = Account.sign_message(message, private_key)
signature = signed.signature.hex()
```

### 4.2 احراز هویت WebSocket:
پس از اتصال، پیام `public/login` ارسال شود:
```json
{
  "method": "public/login",
  "params": {
    "wallet": "0x...",
    "timestamp": 1695836058725,
    "signature": "0x..."
  },
  "id": 1
}
```

### 4.3 Session Keys:
- کلیدهای موقت که توسط مالک حساب ثبت می‌شوند
- سه سطح دسترسی:
  - **Admin**: دسترسی کامل (ترید، واریز، برداشت، امضا)
  - **Account**: مدیریت حساب بدون امضا (لغو سفارش، تنظیمات)
  - **Read Only**: فقط خواندن اطلاعات

### 4.4 درخواست‌های Self-Custodial:
به دلیل ماهیت خودحضانتی، این عملیات نیاز به امضای جداگانه دارند:
1. ثبت سفارش (Orders)
2. واریز / برداشت (Deposit / Withdraw)
3. انتقال (Transfer)

هر درخواست self-custodial دو مرحله احراز هویت دارد:
- احراز هویت endpoint (هدرها یا WS login)
- امضای payload خاص به‌عنوان یکی از پارامترهای API

---

## 5. API عمومی (Public) — بدون نیاز به احراز هویت

این endpointها برای گرفتن دیتای بازار مناسب هستند و نیازی به کلید خصوصی ندارند.

### 5.1 دریافت همه ارزها:
```
POST /public/get_all_currencies
```
بدون پارامتر. لیست همه ارزهای فعال با قیمت اسپات فعلی و قیمت ۲۴ ساعت قبل.

### 5.2 دریافت جزئیات یک ارز:
```
POST /public/get_currency
```
| پارامتر | نوع | الزامی | توضیح |
|---------|-----|--------|-------|
| `currency` | string | ✅ | نماد ارز (مثلاً `BTC`) |

خروجی: پارامترهای ریسک، قیمت اسپات، جزئیات لندینگ

### 5.3 دریافت همه ابزارها (Instruments):
```
POST /public/get_all_instruments
```
| پارامتر | نوع | الزامی | توضیح |
|---------|-----|--------|-------|
| `currency` | string \| null | ❌ | فیلتر بر اساس ارز پایه |
| `expired` | boolean | ✅ | آیا آپشن‌های منقضی‌شده هم باشد؟ |
| `instrument_type` | string | ✅ | `erc20`, `option`, `perp` |
| `page` | integer | ❌ | شماره صفحه (پیش‌فرض: 1) |
| `page_size` | integer | ❌ | تعداد نتایج (پیش‌فرض: 100، حداکثر: 1000) |

### 5.4 دریافت ابزارهای فعال:
```
POST /public/get_instruments
```
| پارامتر | نوع | الزامی | توضیح |
|---------|-----|--------|-------|
| `currency` | string | ✅ | نماد ارز (مثلاً `BTC`) |
| `expired` | boolean | ✅ | `false` برای فقط فعال‌ها |
| `instrument_type` | string | ✅ | `option` برای آپشن‌ها |

### 5.5 دریافت یک ابزار خاص:
```
POST /public/get_instrument
```
| پارامتر | نوع | الزامی |
|---------|-----|--------|
| `instrument_name` | string | ✅ |

مثال: `BTC-20250718-110000-C`

### 5.6 دریافت تیکرها (Ticker):
```
POST /public/get_tickers
```
| پارامتر | نوع | الزامی | توضیح |
|---------|-----|--------|-------|
| `currency` | string \| null | ✅ برای آپشن | ارز پایه |
| `expiry_date` | string/integer | ✅ برای آپشن | تاریخ سررسید (YYYYMMDD) |
| `instrument_type` | string | ✅ | `option` |

خروجی شامل: بهترین bid/ask، حجم، قیمت mark، Greeks (برای آپشن‌ها)

### 5.7 آمار ترید:
```
POST /public/get_trade_history
POST /public/statistics
```

### 5.8 تاریخچه قیمت:
```
POST /public/get_index_chart_data
```
| پارامتر | نوع | الزامی |
|---------|-----|--------|
| `currency` | string | ✅ |

داده‌های OHLC اسپات از ClickHouse.

### 5.9 تاریخچه نرخ بهره:
```
POST /public/get_interest_rate_history
```

### 5.10 تاریخچه نرخ فاندینگ:
```
POST /public/get_funding_rate_history
```
| پارامتر | نوع | الزامی |
|---------|-----|--------|
| `start_timestamp` | integer | ❌ (حداکثر ۳۰ روز قبل) |
| `end_timestamp` | integer | ❌ |

### 5.11 قیمت تسویه آپشن‌ها:
```
POST /public/get_option_settlement_prices
```

### 5.12 تاریخچه تسویه آپشن‌ها:
```
POST /public/get_option_settlement_history
```

### 5.13 Margin Watch:
```
POST /public/margin-watch
```
محاسبه MtM و مارجین نگهداری برای یک ساب‌اکانت.

### 5.14 Get Margin (محاسبه مارجین):
```
POST /public/get_margin
```
محاسبه مارجین برای یک پورتفولیو و (اختیاری) تغییرات شبیه‌سازی‌شده.

### 5.15 سرور زمان:
```
POST /public/get_time
```

---

## 6. API خصوصی (Private) — نیاز به احراز هویت

### 6.1 مدیریت حساب:

| متد | توضیح | سطح دسترسی |
|-----|-------|------------|
| `private/get_account` | جزئیات حساب | read_only |
| `private/get_subaccounts` | همه ساب‌اکانت‌ها | read_only |
| `private/get_subaccount` | سفارشات باز، پوزیشن‌ها، وثیقه | read_only |
| `private/create_subaccount` | ایجاد ساب‌اکانت جدید + واریز | admin |
| `private/get_all_portfolios` | همه پورتفولیوها | read_only |

### 6.2 سفارشات (Orders):

| متد | توضیح | سطح دسترسی |
|-----|-------|------------|
| `private/order` | ثبت سفارش جدید | admin |
| `private/replace` | لغو سفارش قبلی + ثبت جدید (یک RPC) | admin |
| `private/cancel` | لغو یک سفارش | admin |
| `private/cancel_all` | لغو همه سفارشات یک ابزار | admin |
| `private/cancel_by_instrument` | لغو همه برای یک ابزار | admin |
| `private/cancel_by_label` | لغو بر اساس لیبل | admin |
| `private/cancel_by_nonce` | لغو بر اساس نانس | admin |
| `private/get_open_orders` | سفارشات باز | read_only |
| `private/get_orders` | سفارشات با فیلتر | read_only |
| `private/get_order` | یک سفارش خاص | read_only |
| `private/get_order_history` | تاریخچه سفارشات | read_only |
| `private/order_debug` | دیباگ سفارش | read_only |

#### پارامترهای کلیدی سفارش (`private/order`):
| پارامتر | نوع | الزامی | توضیح |
|---------|-----|--------|-------|
| `subaccount_id` | integer | ✅ | شناسه ساب‌اکانت |
| `instrument_name` | string | ✅ | نام ابزار (مثلاً `BTC-20250718-110000-C`) |
| `direction` | string | ✅ | `buy` یا `sell` |
| `amount` | string | ✅ | مقدار (واحد base) |
| `limit_price` | string | ✅ | قیمت حدی (برای market هم الزامی) |
| `max_fee` | string | ✅ | حداکثر کارمزد هر قرارداد |
| `order_type` | string | ❌ | `limit` (پیش‌فرض) یا `market` |
| `time_in_force` | string | ❌ | `gtc`, `post_only`, `fok`, `ioc` |
| `nonce` | integer | ✅ | یکتا: `(timestamp_ms)(random_3_digits)` |
| `signature` | string | ✅ | امضای اتریوم سفارش |
| `signature_expiry_sec` | integer | ✅ | انقضای امضا (حداقل ۵ دقیقه آینده) |
| `signer` | string | ✅ | آدرس امضاکننده |
| `reduce_only` | boolean | ❌ | فقط کاهش پوزیشن |
| `mmp` | boolean | ❌ | حفاظت بازارساز |
| `trigger_price` | string | ❌ | قیمت تریگر (سفارش شرطی) |
| `trigger_type` | string | ❌ | `stoploss` یا `takeprofit` |

#### محاسبه max_fee:
- برای سفارشات resting (maker): `max_fee > 2 × max(taker_fee, maker_fee) × spot_price + extra_fee / amount`
- برای سفارشات crossing (taker): `max_fee > maker_max_fee + base_fee / fill_amount`

### 6.3 پوزیشن‌ها:

| متد | توضیح | سطح دسترسی |
|-----|-------|------------|
| `private/get_positions` | پوزیشن‌های فعال | read_only |
| `private/get_collaterals` | وثیقه‌ها | read_only |
| `private/get_margin` | محاسبه مارجین | read_only |

### 6.4 تاریخچه و گزارشات:

| متد | توضیح |
|-----|-------|
| `private/get_trade_history` | تاریخچه تریدها |
| `private/get_funding_history` | تاریخچه فاندینگ |
| `private/get_interest_history` | تاریخچه بهره |
| `private/get_deposit_history` | تاریخچه واریز |
| `private/get_withdrawal_history` | تاریخچه برداشت |
| `private/get_erc20_transfer_history` | تاریخچه انتقال ERC20 |
| `private/get_option_settlement_history` | تاریخچه تسویه آپشن‌ها |
| `private/get_liquidation_history` | تاریخچه لیکوییدیشن |
| `private/get_subaccount_value_history` | تاریخچه ارزش ساب‌اکانت |

### 6.5 واریز، برداشت و انتقال:

| متد | توضیح | سطح دسترسی |
|-----|-------|------------|
| `private/deposit` | واریز ارز به ساب‌اکانت | admin |
| `private/withdraw` | برداشت ارز | admin |
| `private/transfer_erc20` | انتقال ERC20 بین ساب‌اکانت‌ها | admin |
| `private/transfer_position` | انتقال پوزیشن | admin |
| `private/transfer_positions` | انتقال چند پوزیشن (RFQ) | admin |

### 6.6 RFQ (درخواست قیمت):
| متد | توضیح |
|-----|-------|
| `private/send_rfq` | ارسال RFQ به مارکت‌میکرها |
| `private/send_quote` | ارسال کوت در پاسخ به RFQ |
| `private/execute_quote` | اجرای یک کوت |
| `private/cancel_rfq` | لغو RFQ |
| `private/cancel_quote` | لغو کوت |
| `private/rfq_get_best_quote` | Dry-run بهترین کوت |
| `private/poll_quotes` | بررسی کوت‌های باز |
| `private/poll_rfqs` | بررسی RFQهای باز |

### 6.7 سفارشات شرطی (Trigger Orders):
| متد | توضیح |
|-----|-------|
| `private/trigger_order` | ثبت سفارش شرطی |
| `private/cancel_trigger_order` | لغو سفارش شرطی |
| `private/get_trigger_orders` | لیست سفارشات شرطی |
| `private/cancel_all_trigger_orders` | لغو همه |

### 6.8 سفارشات Algo (TWAP):
| متد | توضیح |
|-----|-------|
| `private/algo_order` | سفارش TWAP |
| `private/cancel_algo_order` | لغو |
| `private/get_algo_orders` | لیست |
| `private/cancel_all_algo_orders` | لغو همه |

---

## 7. WebSocket Channels

### 7.1 کانال‌های عمومی (Public):

#### `ticker_slim.{instrument_name}.{interval}` ✅ (فعال — جایگزین ticker)
اطلاعات تیکر فشرده. انتشار با فاصله ۱۰۰ms یا ۱۰۰۰ms.
```
instrument_name: نام ابزار (مثلاً BTC-20250718-110000-C)
interval: 100 یا 1000 (میلی‌ثانیه)
```

**فیلدهای خروجی option_pricing:**
| فیلد | توضیح |
|------|-------|
| `ai` | Implied Volatility بهترین Ask |
| `bi` | Implied Volatility بهترین Bid |
| `d` | Delta |
| `df` | Discount Factor |
| `f` | Forward Price |
| `g` | Gamma |
| `i` | Implied Volatility |
| `m` | Mark Price |
| `r` | Rho |
| `t` | Theta |
| `v` | Vega |

**فیلدهای stats (آمار ۲۴ ساعته):**
| فیلد | توضیح |
|------|-------|
| `c` | تعداد قراردادهای معامله‌شده |
| `h` | بالاترین قیمت |
| `l` | پایین‌ترین قیمت |
| `n` | تعداد معاملات |
| `oi` | Open Interest فعلی |
| `p` | درصد تغییر (آپشن: تغییر پریمیوم، پرپ: تغییر مارک) |
| `pr` | حجم پریمیوم |
| `v` | حجم نامینال |

**فیلدهای عمومی:**
| فیلد | توضیح |
|------|-------|
| `a` | بهترین Ask |
| `b` | بهترین Bid |
| `A` | مقدار در بهترین Ask |
| `B` | مقدار در بهترین Bid |
| `I` | Index Price |
| `M` | Mark Price |
| `maxp` | حداکثر قیمت خرید تهاجمی |
| `minp` | حداقل قیمت فروش تهاجمی |
| `f` | نرخ فاندینگ ساعتی (فقط پرپچوال) |

#### `orderbook.{instrument_name}.{group}.{depth}`
```
depth: 1, 10, 20, 100
group: 1, 10, 100
```
انتشار با فاصله ۱۰۰ms (تغییر) یا ۱ ثانیه (بدون تغییر).

#### `trades.{instrument_name}`
تریدهای لحظه‌ای یک ابزار. شامل: `trade_price`, `trade_amount`, `direction`, `timestamp`, `trade_id`

#### `spot_feed.{currency}`
قیمت اسپات لحظه‌ای یک ارز.

#### `ticker.{instrument_name}.{interval}` ⚠️ (منسوخ — از ۱ دسامبر ۲۰۲۵)
نسخه کامل‌تر اما منسوخ. از `ticker_slim` استفاده شود.

### 7.2 کانال‌های خصوصی (Private — نیاز به login):

#### `{subaccount_id}.orders`
تغییرات سفارشات. شامل: `order_status`, `filled_amount`, `cancel_reason`, ...

#### `{subaccount_id}.trades`
تریدهای کاربر. شامل: `trade_price`, `liquidity_role`, `realized_pnl`, ...

#### `{subaccount_id}.quotes`
تغییرات کوت‌ها (RFQ). شامل: `status`, `fill_pct`, ...

#### `{subaccount_id}.balances`
تغییرات بالانس.

### 7.3 subscribe/unsubscribe:
```json
{
  "method": "subscribe",
  "params": {
    "channels": ["ticker_slim.BTC-20250718-110000-C.100", "spot_feed.BTC"]
  },
  "id": 1
}
```

---

## 8. ساختار کارمزدها

### 8.1 اوردربوک:
| ابزار | Taker | Maker |
|-------|-------|-------|
| اسپات | بدون کارمزد | بدون کارمزد |
| پرپچوال | $0.1 + 0.03% × نامینال | 0.01% × نامینال |
| آپشن | $0.5 + min(0.03% × نامینال, 12.5% × پریمیوم) | min(0.01% × نامینال, 12.5% × پریمیوم) |

### 8.2 RFQ:
- کارمزد taker به هر دو طرف اعمال می‌شود
- تخفیف تا ۱۰۰٪ روی لگ ارزان‌تر:
  - اسپرد ۲ لگی (استرادل، ورتیکال، کلندر): لگ دوم رایگان
  - آپشن + پرپچوال: ارزان‌ترین لگ رایگان

### 8.3 باکس اسپرد:
کارمزد = `نامینال × 0.5% × سال‌های تا سررسید` + $0.5 base fee (taker)

---

## 9. محدودیت‌ها (Rate Limits)

### 9.1 تریدر:
| نوع | محدودیت | Burst |
|-----|---------|-------|
| Matching (سفارش) | 1 TPS | 5x |
| Per-instrument matching | 1 TPS | 5x |
| Non-matching (خواندن) | 5 TPS | 5x |
| اتصالات | 4x هر IP | — |

### 9.2 بازارساز (Market Maker):
| نوع | محدودیت | Burst |
|-----|---------|-------|
| Matching | 500+ TPS | 5x |
| Per-instrument | 10+ TPS | 5x |
| Non-matching | 500+ TPS | 5x |
| اتصالات | تا 64x هر IP | — |

**نکته:** Burst هر ۵ ثانیه ریفرش می‌شود.

### 9.3 درخواست‌های خاص:
- `private/cancel_all`: 1 TPS
- `private/cancel_by_label` (بدون instrument_name): 10 TPS

### 9.4 بررسی محدودیت باقیمانده (فقط WebSocket):
```json
{"method": "public/getRateLimits", "params": {}, "id": 1}
```

---

## 10. کدهای خطا (Error Codes)

### خطا‌های عمومی:
| کد | پیام | توضیح |
|----|------|-------|
| 0 | - | بدون خطا |
| -32000 | Rate limit exceeded | محدودیت نرخ |
| -32100 | Concurrent WS limit exceeded | محدودیت اتصالات |
| -32700 | Parse error | JSON نامعتبر |
| -32600 | Invalid Request | درخواست نامعتبر |
| -32601 | Method not found | متد ناموجود |
| -32602 | Invalid params | پارامترهای نامعتبر |
| -32603 | Internal error | خطای داخلی |

### خطاهای سفارش:
| کد | پیام | توضیح |
|----|------|-------|
| 9000 | Order confirmation timeout | تایم‌اوت تایید سفارش |
| 9001 | Engine confirmation timeout | تایم‌اوت موتور |
| 11000 | Insufficient funds | موجودی ناکافی |
| 11003 | Already cancelled | قبلاً لغو شده |
| 11004 | Already filled | قبلاً پر شده |
| 11006 | Does not exist | وجود ندارد |
| 11007 | Self-crossing disallowed | عبور با سفارش خودی مجاز نیست |
| 11008 | Post only cannot cross | سفارش post-only نباید عبور کند |
| 11009 | Zero liquidity | نقدینگی صفر |
| 11011 | Invalid signature expiry | انقضای امضا نامعتبر |
| 11012 | Invalid amount | مقدار نامعتبر |
| 11013 | Invalid limit price | قیمت حدی نامعتبر |
| 11014 | FOK not filled | FOK پر نشد |
| 11015 | MMP frozen | حفاظت بازارساز فعال شد |
| 11017 | Non unique nonce | نانس تکراری |
| 11018 | Invalid nonce date | تاریخ نانس نامعتبر |
| 11023 | Max fee too low | max_fee خیلی کم |
| 11025 | Reduce only reject | سفارش reduce-only رد شد |

---

## 11. ثابت‌های پروتکل (Mainnet)

| ثابت | مقدار |
|------|-------|
| CHAIN_ID | 957 |
| DOMAIN_SEPARATOR (Matching.sol) | `0xd96e5f90797da7ec8dc4e276260c7f3f87fedf68775fbe1ef116e996fc60441b` |
| ACTION_TYPEHASH | `0x4d7a9f27c403ff9c0f19bce61d76d82f9aa29f8d6d4b0c5474607d9770d1af17` |

### آدرس قراردادها (Mainnet):
| قرارداد | آدرس |
|---------|-------|
| Matching.sol | `0xeB8d770ec18DB98Db922E9D83260A585b9F0DeAD` |
| SubAccount.sol | `0xE7603DF191D699d8BD9891b821347dbAb889E5a5` |
| USDC (6 decimals) | `0x6879287835A86F50f784313dBEd5E5cCC5bb8481` |
| Option.sol (BTC) | `0xd0711b9eBE84b778483709CDe62BacFDBAE13623` |
| Perp.sol (BTC) | `0xDBa83C0C654DB1cd914FA2710bA743e925B53086` |
| Option.sol (ETH) | `0x4BB4C3CDc7562f08e9910A0C7D8bB7e108861eB4` |
| Perp.sol (ETH) | `0xAf65752C4643E25C02F693f9D4FE19cF23a095E3` |

---

## 12. کلاینت‌ها و ابزارهای موجود

### 12.1 کلاینت پایتون (کامیونیتی):
```
https://github.com/8ball030/derive_client
```
- نصب: `pip install derive-client` (نسخه فعلی: 0.3.14)
- شامل SDK امضای on-chain: `https://github.com/derivexyz/v2-action-signing-python`
- مثال سفارش: `https://github.com/8ball030/derive_client/blob/main/examples/create_order.py`

### 12.2 کلاینت Rust:
```
https://github.com/derivexyz/cockpit/tree/master/lyra-client
```

### 12.3 ادغام‌ها:
- **Hummingbot**: `https://hummingbot.org/exchanges/derive/`
- **CCXT**: `https://github.com/ccxt/ccxt/blob/master/python/ccxt/derive.py`

---

## 13. راهنمای شروع سریع (Flow برای خواندن دیتای آپشن بیت‌کوین)

### مرحله ۱: گرفتن لیست آپشن‌های فعال BTC
```python
import requests

url = "https://api.lyra.finance/public/get_instruments"
data = {
    "currency": "BTC",
    "expired": False,
    "instrument_type": "option"
}
response = requests.post(url, json=data)
instruments = response.json()
```

### مرحله ۲: گرفتن تیکر آپشن خاص
```python
url = "https://api.lyra.finance/public/get_tickers"
data = {
    "currency": "BTC",
    "expiry_date": "20250718",
    "instrument_type": "option"
}
response = requests.post(url, json=data)
tickers = response.json()
```

### مرحله ۳: اتصال WebSocket برای دیتای لحظه‌ای
```python
import websockets
import json
import asyncio

async def stream():
    async with websockets.connect("wss://api.lyra.finance/ws") as ws:
        # سابسکرایب به تیکر
        await ws.send(json.dumps({
            "method": "subscribe",
            "params": {"channels": ["ticker_slim.BTC-20250718-110000-C.100"]},
            "id": 1
        }))
        # سابسکرایب به اوردربوک
        await ws.send(json.dumps({
            "method": "subscribe",
            "params": {"channels": ["orderbook.BTC-20250718-110000-C.10.20"]},
            "id": 2
        }))
        # سابسکرایب به تریدها
        await ws.send(json.dumps({
            "method": "subscribe",
            "params": {"channels": ["trades.BTC-20250718-110000-C"]},
            "id": 3
        }))
        
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            print(data)

asyncio.run(stream())
```

### مرحله ۴: گرفتن اسپات BTC
```python
async def stream_spot():
    async with websockets.connect("wss://api.lyra.finance/ws") as ws:
        await ws.send(json.dumps({
            "method": "subscribe",
            "params": {"channels": ["spot_feed.BTC"]},
            "id": 1
        }))
        while True:
            msg = await ws.recv()
            print(json.loads(msg))
```

### مرحله ۵: ثبت سفارش (نیاز به احراز هویت)
```python
# نیاز به private key و subaccount_id
import time, random
from eth_account import Account
from eth_account.messages import encode_defunct

def sign_order(private_key, params_to_sign):
    """امضای payload سفارش"""
    # ... (نیاز به EIP-712 signing — از SDK استفاده شود)
    pass

order_params = {
    "subaccount_id": 12345,
    "instrument_name": "BTC-20250718-110000-C",
    "direction": "buy",
    "amount": "0.1",
    "limit_price": "5000",
    "max_fee": "100",
    "order_type": "limit",
    "time_in_force": "gtc",
    "nonce": int(time.time() * 1000) * 1000 + random.randint(0, 999),
    "signature_expiry_sec": int(time.time()) + 3600,
    "signature": "0x...",  # امضای واقعی
    "signer": "0x..."
}

# ارسال با هدرهای احراز هویت
headers = {
    "X-LyraWallet": "0x...",
    "X-LyraTimestamp": str(int(time.time() * 1000)),
    "X-LyraSignature": "0x...",
    "Content-Type": "application/json"
}
response = requests.post(
    "https://api.lyra.finance/private/order",
    json=order_params,
    headers=headers
)
```

---

## 14. ساختار Greeks و مفاهیم آپشن

در پاسخ `ticker_slim` و `get_tickers`، فیلد `option_pricing` شامل:

| Greek | فیلد (ticker_slim) | فیلد (ticker) | توضیح |
|-------|-------------------|---------------|-------|
| Delta | `d` | `delta` | حساسیت قیمت به تغییر قیمت پایه |
| Gamma | `g` | `gamma` | تغییرات Delta |
| Theta | `t` | `theta` | کاهش ارزش با گذشت زمان |
| Vega | `v` | `vega` | حساسیت به نوسان |
| Rho | `r` | `rho` | حساسیت به نرخ بهره |
| IV | `i` | `iv` | نوسان ضمنی |
| Mark Price | `m` | `mark_price` | قیمت مارک |
| Forward Price | `f` | `forward_price` | قیمت فوروارد |
| Bid IV | `bi` | `bid_iv` | IV بهترین bid |
| Ask IV | `ai` | `ask_iv` | IV بهترین ask |
| Discount Factor | `df` | `discount_factor` | ضریب تخفیف |

---

## 15. نکات مهم برای توسعه

### 15.1 نانس (Nonce):
- فرمت: `(timestamp_ms)(random_3_digits)` مثلاً `1695836058725001`
- ۱۰ رقم اول باید تایم‌استمپ UTC ثانیه باشد (حداکثر ۱ ساعت اختلاف)
- استفاده تکراری = خطا

### 15.2 Instrument Name برای آپشن:
```
BTC-YYYYMMDD-STRIKE-C  (Call)
BTC-YYYYMMDD-STRIKE-P  (Put)
```
مثال: `BTC-20250718-110000-C` = آپشن Call بیت‌کوین با استرایک ۱۱۰,۰۰۰ دلار و سررسید ۱۸ ژوئیه ۲۰۲۵

### 15.3 حداقل/حداکثر مقدار سفارش:
از طریق `minimum_amount` و `maximum_amount` در تیکر قابل دریافت.

### 15.4 محدودیت باز:
`amount_step`: حداقل افزایش معتبر مقدار سفارش.

### 15.5 ابزارهای ccxt:
```python
import ccxt
exchange = ccxt.derive({
    'apiKey': '...',
    'secret': '...',
})
markets = exchange.load_markets()
```

---

## 16. خلاصه endpointهای کلیدی برای پروژه شما

### برای خواندن دیتای آپشن BTC (بدون احراز هویت):
```
✅ POST /public/get_all_currencies          → لیست ارزها + قیمت اسپات
✅ POST /public/get_instruments              → لیست آپشن‌های BTC
✅ POST /public/get_tickers                  → تیکر + Greeks آپشن‌ها
✅ POST /public/get_instrument               → جزئیات یک آپشن خاص
✅ POST /public/get_index_chart_data         → نمودار قیمت اسپات
✅ POST /public/get_option_settlement_prices → قیمت‌های تسویه
✅ POST /public/get_trade_history            → تاریخچه معاملات
✅ POST /public/statistics                   → آمار کلی
✅ POST /public/get_time                     → زمان سرور
✅ WS: ticker_slim.{instrument}.100          → تیکر لحظه‌ای
✅ WS: orderbook.{instrument}.10.20          → اوردربوک لحظه‌ای
✅ WS: trades.{instrument}                   → تریدهای لحظه‌ای
✅ WS: spot_feed.BTC                         → قیمت اسپات لحظه‌ای
```

### برای ثبت سفارش و مدیریت حساب (نیاز به احراز هویت):
```
🔐 POST /private/order                      → ثبت سفارش
🔐 POST /private/cancel                     → لغو سفارش
🔐 POST /private/get_positions              → پوزیشن‌ها
🔐 POST /private/get_open_orders            → سفارشات باز
🔐 POST /private/get_subaccount             → اطلاعات ساب‌اکانت
🔐 POST /private/deposit                    → واریز
🔐 POST /private/withdraw                   → برداشت
🔐 WS: {subaccount_id}.orders               → آپدیت سفارشات
🔐 WS: {subaccount_id}.trades               → تریدهای کاربر
```

---

## 17. لینک‌های مفید

| منبع | آدرس |
|------|------|
| داکیومنت اصلی | https://docs.derive.xyz |
| متن فرمت‌شده برای AI | https://docs.derive.xyz/llms.txt |
| اپلیکیشن ترید | https://app.derive.xyz/trade/options |
| پایتون کلاینت | https://github.com/8ball030/derive_client |
| Python Signing SDK | https://github.com/derivexyz/v2-action-signing-python |
| Rust Client | https://github.com/derivexyz/cockpit |
| CCXT Integration | https://github.com/ccxt/ccxt |
| Discord | https://discord.com/invite/derive |

---

*تاریخ تهیه: ۱ ژوئیه ۲۰۲۶ — اطلاعات بر اساس مستندات رسمی Derive.xyz*
