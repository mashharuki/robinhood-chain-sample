
# Robinhood Crypto Trading API — Full Reference

Extracted from the official OpenAPI spec embedded in https://docs.robinhood.com/crypto/trading/ (spec bundled at `robinhood-crypto-openapi.json`). Base URL: **`https://trading.robinhood.com`**.

## Table of contents

1. [Versions: v1 vs v2](#versions-v1-vs-v2)
2. [Authentication](#authentication)
3. [Pagination](#pagination)
4. [Rate limiting](#rate-limiting)
5. [Error responses](#error-responses)
6. [v1 endpoints](#v1-endpoints)
7. [v2 endpoints](#v2-endpoints)
8. [Order model](#order-model)
9. [Schemas](#schemas)

## Versions: v1 vs v2

| | v1 | v2 |
|---|---|---|
| Order fees | Spread baked into price (market makers) | Explicit `fee_ratio`, volume-based fee tiers (partner exchanges) |
| Fee tier volume | Doesn't count | Only v2 orders count toward 30-day volume |
| `account_number` | Implicit (current user) | **Required query param** on holdings/orders/place/get |
| Estimated price path | `/api/v1/crypto/marketdata/estimated_price/` | `/api/v2/crypto/trading/estimated_price/` (moved under trading!) |
| Tradable pairs | `status: tradable` | Additionally requires `is_api_tradable: true` |
| Order response extras | — | `fee_charged`, `estimated_fee_remaining` |
| Deprecation | No timeline announced | — |

Read-only actions exist on both. Fee schedule: https://cdn.robinhood.com/assets/robinhood/legal/rhc-fee-schedule.pdf. US customers only.

## Authentication

Every request needs three headers:

| Header | Value |
|---|---|
| `x-api-key` | API key from crypto account settings (web classic). Keys issued after 2024-08-13 look like `rh-api-<uuid>`. |
| `x-timestamp` | Current Unix timestamp in **seconds** (UTC). **Valid for only 30 seconds** — expired timestamps are rejected. |
| `x-signature` | Base64 Ed25519 signature of `{api_key}{timestamp}{path}{method}{body}` |

- `path` includes the leading `/api/...` and the **trailing slash**, plus query string if present (sign exactly what you request).
- `method` is uppercase (`GET`, `POST`).
- For requests without a body, omit the body from the message.
- **The signed body string must be byte-identical to the transmitted request body.** Serialize once; sign and send the same string.
- Setup flow: generate an Ed25519 keypair locally → register the **public** key (base64, 32 raw bytes) in crypto account settings ("Add key", choose permitted API actions) → receive the API key. The private key never leaves your machine; Robinhood never asks for it.

Official signature test vector (verified — see `typescript-client.md` for a runnable self-test and an important caveat about the body encoding):

| Field | Value |
|---|---|
| Private key (base64 seed) | `xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=` |
| Public key | `jPItx4TLjcnSUnmnXQQyAKL4eJj3+oWNNMmmm2vATqk=` |
| API key | `rh-api-6148effc-c0b1-486c-8940-a1d099456be6` |
| Timestamp | `1698708981` |
| Method / Path | `POST` / `/api/v1/crypto/trading/orders/` |
| Expected `x-signature` | `q/nEtxp/P2Or3hph3KejBqnw5o9qeuQ+hYRnB56FaHbjDsNUY9KhB1asMxohDnzdVFSD7StaTqjSd9U9HvaRAw==` |

## Pagination

List endpoints return:

```json
{ "next": "https://trading.robinhood.com/...?cursor={CURSOR_ID}", "previous": null, "results": [ ... ] }
```

Follow `next` (strip the base URL, sign the remaining path+query) until `null`. Some endpoints accept `limit` (page size) and `cursor` query params.

## Rate limiting

- **100 requests/min per user account; bursts up to 300** (token bucket: capacity = burst, refilled at an interval; exact values vary per endpoint and service conditions).
- Exceeding returns **429**. Back off (exponential + jitter) and retry; budget your polling cadence so normal operation stays well under 100/min account-wide.

## Error responses

```json
{ "type": "validation_error", "errors": [ { "detail": "human readable message", "attr": "client_order_id" } ] }
```

- `type`: `validation_error` (400) | `client_error` (4xx except 400) | `server_error` (5xx).
- `attr`: offending field name (or `non_field_errors`) for validation errors; `null` otherwise.
- Status codes in use: 400, 401, 403, 404, 405, 406, 415, 429, 500, 503.

## v1 endpoints

All paths are signed including trailing slash. Query strings: repeat the param for multiple values (`?symbol=BTC-USD&symbol=ETH-USD`), always uppercase.

### GET `/api/v1/crypto/trading/accounts/`
Account details for the current user → [`Account`](#account).

### GET `/api/v1/crypto/trading/trading_pairs/`
Params: `symbol` (repeatable), `limit`, `cursor`. → paginated [`TradingPair`](#tradingpair). No `symbol` = all supported pairs.

### GET `/api/v1/crypto/trading/holdings/`
Params: `asset_code` (repeatable, e.g. `BTC`), `limit`, `cursor`. → paginated [`Holdings`](#holdings).

### GET `/api/v1/crypto/trading/orders/`
Params (all optional): `created_at_start`, `created_at_end`, `updated_at_start`, `updated_at_end` (ISO 8601), `symbol`, `id` (order UUID), `side`, `state`, `type`, `limit`, `cursor`. → paginated [`Order`](#order-model).

### GET `/api/v1/crypto/trading/orders/{id}/`
Single order by ID (used by the official sample client) → [`Order`](#order-model).

### POST `/api/v1/crypto/trading/orders/`
Place an order. Body (`AddOrder`):

```json
{
  "symbol": "BTC-USD",
  "client_order_id": "<uuid you generate — idempotency key>",
  "side": "buy",
  "type": "market",
  "market_order_config": { "asset_quantity": "0.0001" }
}
```

Exactly one `*_order_config` matching `type` is required:

| type | config key | fields |
|---|---|---|
| `market` | `market_order_config` | `asset_quantity` |
| `limit` | `limit_order_config` | `asset_quantity` *or* `quote_amount`, `limit_price` |
| `stop_loss` | `stop_loss_order_config` | `asset_quantity` *or* `quote_amount`, `stop_price`, `time_in_force` |
| `stop_limit` | `stop_limit_order_config` | `asset_quantity` *or* `quote_amount`, `limit_price`, `stop_price`, `time_in_force` |

`asset_quantity` and `quote_amount` are mutually exclusive where both are supported. The OpenAPI schema types these as numbers, but official examples send decimal **strings** — send strings.

### POST `/api/v1/crypto/trading/orders/{id}/cancel/`
No body. 200 → confirmation text: `Cancel request was submitted for order {id}`. Cancellation is async — confirm via order state.

### GET `/api/v1/crypto/marketdata/best_bid_ask/`
Params: `symbol` (repeatable). → `{ results: [BidAskPrice] }`. One bid/ask per symbol from market makers, spread included, size-independent:
`price` (mid), `bid_inclusive_of_sell_spread`, `sell_spread`, `ask_inclusive_of_buy_spread`, `buy_spread`, `timestamp`.

### GET `/api/v1/crypto/marketdata/estimated_price/`
Params: `symbol` (one pair), `side` = `bid` | `ask` | `both`, `quantity` = comma-separated list, max 10 (`0.1,1,1.999`). Quantities must be within `min_order_size`..`max_order_size` of the pair.
→ `{ results: [EstimatedPrice] }` — expected execution price per quantity. **Buy → request `ask`; sell → request `bid`.**

## v2 endpoints

Same auth. Key difference: account-scoped — call `GET accounts` first and pass `account_number`.

### GET `/api/v2/crypto/trading/accounts/`
Params: `cursor`, `limit`. → paginated [`V2Account`](#v2account) incl. `buying_power` and `fee_tier_status` (`fee_ratio`, `thirty_day_volume`, `next_fee_tier_ratio`, `next_fee_tier_threshold` — nulls at best tier). The default account has `is_api_tradable: true`.

### GET `/api/v2/crypto/trading/trading_pairs/`
Params: `symbol` (repeatable), `cursor`, `limit`. → paginated [`V2TradingPair`](#v2tradingpair). Only pairs with `is_api_tradable: true` can be ordered via v2; v2 adds `min_order_amount` (min in quote currency, e.g. USD).

### GET `/api/v2/crypto/trading/holdings/`
Params: **`account_number` (required)**, `asset_code` (repeatable), `cursor`, `limit`. → paginated `V2Holding` (`total_quantity`, `quantity_available_for_trading` as strings).

### GET `/api/v2/crypto/marketdata/best_bid_ask/`
Params: `symbol` (repeatable; must be `is_api_tradable` USD pairs). → `{ results: [{ symbol, bid, ask, timestamp }] }` — prices from partner exchanges, **fee excluded**.

### GET `/api/v2/crypto/trading/estimated_price/`
(Note the `/trading/` segment.) Params: `symbol`, `side` (`bid`|`ask`), `quantity` (comma-separated, ≤10, < pair `max_order_size`).
→ `V2EstimatedPrice`: `bid`, `ask`, `fee_ratio`, `est_fee` (= fee_ratio × price × qty), `est_total_cost` (= qty × ask + est_fee), `est_total_credit` (= qty × bid − est_fee).

### GET `/api/v2/crypto/trading/orders/`
Params: **`account_number` (required)**, plus the same filters as v1 (`created_at_*`, `updated_at_*`, `symbol`, `id`, `side`, `state`, `type`, `cursor`, `limit`). → paginated `V2CryptoOrder` = Order + `fee_charged` + `estimated_fee_remaining`.

### GET `/api/v2/crypto/trading/orders/{id}/`
Single order; `account_number` query param required.

### POST `/api/v2/crypto/trading/orders/`
**`account_number` as query param** (part of the signed path). Body `AddOrderV2` — same shape as v1 `AddOrder`, with one addition: `limit_order_config` also accepts `time_in_force`. Only `is_api_tradable` USD pairs.

### POST `/api/v2/crypto/trading/orders/{id}/cancel/`
Same as v1 cancel.

## Order model

States: `open` → `partially_filled` → `filled` | `canceled` | `failed`.

Order response fields: `id` (server UUID), `account_number`, `symbol`, `client_order_id` (your idempotency UUID), `side` (`buy`/`sell`), `type`, `state`, `average_price`, `filled_asset_quantity`, `executions[]` (`effective_price`, `quantity`, `timestamp` — strings), `created_at`, `updated_at`, and the echoed `*_order_config`.

Time in force (stop orders on v1; stop + limit orders on v2): `gtc` (until canceled), `gfd` (day), `gfw` (week), `gfm` (month). Market orders execute immediately — no TIF.

## Schemas

### Account
`account_number`, `status` (`active`|`deactivated`|`sell_only`), `buying_power` (string), `buying_power_currency` (`USD`).

### V2Account
Account fields plus `account_type` (e.g. `individual`), `is_api_tradable` (bool), `fee_tier_status` object.

### TradingPair
`symbol` (`BTC-USD`), `asset_code`, `quote_code`, `quote_increment` (price precision), `asset_increment` (quantity precision), `min_order_size`, `max_order_size`, `status` (`tradable`|`untradable`|`sellonly`). All numerics are decimal strings.

### V2TradingPair
Same plus `min_order_amount` (quote currency) and `is_api_tradable` (bool). Increments up to 18 dp; max_order_size up to 16 dp.

### Holdings
`account_number`, `asset_code`, `total_quantity`, `quantity_available_for_trading` (available = total minus amounts locked in open orders).

### BidAskPrice (v1)
`symbol`, `price` (mid), `bid_inclusive_of_sell_spread`, `sell_spread`, `ask_inclusive_of_buy_spread`, `buy_spread`, `timestamp`.

### EstimatedPrice (v1)
`symbol`, `side` (`bid`|`ask`), `price`, `quantity`, spread fields as above, `timestamp`.

### ErrorResponse
`type` + `errors[{ detail, attr }]` as described in [Error responses](#error-responses).
