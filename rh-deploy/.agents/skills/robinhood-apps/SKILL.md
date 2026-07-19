---
name: robinhood-apps
description: Comprehensive guide for planning, designing, building, and testing applications that integrate with Robinhood — the official Crypto Trading API (trading.robinhood.com, Ed25519-signed REST), Agentic Trading via Robinhood's official MCP server (agent.robinhood.com), and product/architecture planning across Robinhood's offerings (stocks, options, crypto, futures, prediction markets). Use this skill whenever the user mentions Robinhood or the Robinhood API in any app-building context — a crypto trading bot, DCA/auto-invest bot, portfolio dashboard, price alerts, order automation, "connect my AI agent to Robinhood", x-api-key/x-signature/Ed25519 auth, or planning/designing/testing any app that reads Robinhood data or places Robinhood orders — even if they don't name a specific API. For topics purely about Robinhood Chain (the L2, chain ID 4663), stock tokens, or on-chain contracts, use the robinhood-chain skill instead; for apps that touch both, use both skills.
---

# Building Apps on Robinhood

Robinhood exposes exactly **two official programmatic surfaces** plus one blockchain:

| Surface | What it is | Assets | Who can use it |
|---|---|---|---|
| **Crypto Trading API** | Ed25519-signed REST API at `https://trading.robinhood.com` | Crypto only (USD pairs) | US Robinhood Crypto customers |
| **Agentic Trading (MCP)** | Official MCP server at `https://agent.robinhood.com/mcp/trading` for AI agents | Stocks (beta; options/crypto/futures planned) | US customers with an Agentic account |
| **Robinhood Chain** | Arbitrum-based L2 for tokenized assets | Stock tokens, USDG, ETH | Permissionless (stock tokens prohibited in US) |

**There is NO official REST API for stocks, options, or futures trading.** Libraries that offer this (robin_stocks, pyrh, etc.) reverse-engineer the private mobile/web API: they violate Robinhood's terms, break without notice, fight with 2FA/device checks, and risk account restriction. Never build on them; steer users to the surfaces above (agent-driven stock trading → Agentic MCP) or to brokers with real APIs (Alpaca, IBKR) if they need programmatic equities.

## How to use this skill

1. **Pick the surface first** using the table above — most "Robinhood app" ideas map to the Crypto Trading API; "let my AI agent trade" maps to Agentic MCP; anything on-chain goes to the `robinhood-chain` skill.
2. For **planning/design work** (企画・設計) — product landscape, app archetypes, architecture, compliance — read `references/product-and-planning.md`.
3. For **any code that calls the Crypto Trading API**, read `references/crypto-trading-api.md` (full endpoint/schema reference) and `references/typescript-client.md` (verified client implementation + signing self-test). The raw OpenAPI spec is bundled at `references/robinhood-crypto-openapi.json` for codegen or exact schema lookups.
4. Work through the **gotchas below before writing code** — most Robinhood API bugs are one of these seven.

## Crypto Trading API — quick facts

- Base URL `https://trading.robinhood.com`. Two versions: **v1** (no fee tiers) and **v2** (fee tiers; only v2 volume counts toward tiers). All read endpoints exist on both; no v1 deprecation timeline.
- Auth: every request carries `x-api-key`, `x-signature`, `x-timestamp`. Signature = Ed25519 over `api_key + timestamp + path + method + body`.
- Credentials are created in crypto account settings on **web classic** (you upload the Ed25519 *public* key, Robinhood issues an API key `rh-api-<uuid>`; you can scope which API actions a key may perform).
- Rate limits: **100 requests/min per account, bursts to 300**, token-bucket per endpoint. Handle 429 with backoff.
- Orders: `market`, `limit`, `stop_loss`, `stop_limit`; time-in-force `gtc`/`gfd`/`gfw`/`gfm`; states `open → partially_filled → filled | canceled | failed`.
- US customers only, USD trading pairs only.

## The seven gotchas that break Robinhood API code

1. **Sign the exact bytes you send.** The server verifies the signature over the request body as received. Serialize the body to a string once, sign that string, and send that same string (don't re-serialize). The official docs' example table is itself inconsistent here — its sample signature was generated over a Python `str(dict)` repr, not the JSON shown. Use the verified self-test vector in `references/typescript-client.md` to prove your signer correct before touching the network.
2. **Timestamps expire in 30 seconds.** Generate the Unix timestamp (seconds, UTC) immediately before each request — never reuse one across retries, and check for clock skew when auth fails mysteriously (NTP-sync CI/servers).
3. **Symbols must be uppercase trading pairs** (`BTC-USD`, not `btc-usd` or `BTC`); holdings use bare asset codes (`BTC`). Only USD-quoted pairs are accepted; v2 ordering additionally requires `is_api_tradable=true` on the pair.
4. **`client_order_id` is your idempotency key** — a UUID you generate. Persist it *before* submitting so a timeout/retry can safely resubmit the same order instead of double-buying.
5. **Paths differ between versions in non-obvious ways**: v1 estimated price is `/api/v1/crypto/marketdata/estimated_price/`, but v2 moved it to `/api/v2/crypto/trading/estimated_price/`. v2 requires an `account_number` query param on holdings/orders (get it from `GET /api/v2/crypto/trading/accounts/`). Keep trailing slashes — they're part of the signed path.
6. **Quantities have exchange-defined bounds**: validate against `min_order_size`/`max_order_size` (v1) or `min_order_amount`/`max_order_size` (v2) from the trading-pairs endpoint, and respect `asset_increment`/`quote_increment` precision. Send quantities/prices as **strings** (as the official examples do) to avoid float drift.
7. **There is no sandbox.** Every authenticated call hits your real account. Test with the layered strategy below instead of "just trying it".

## Planning and designing (企画・設計)

When asked to plan or design a Robinhood app, don't jump to code — produce a short design covering, in order:

1. **Surface + eligibility**: which API, and can the target users even use it (US-only, crypto account required, Agentic account for MCP)?
2. **Money-safety model**: how are orders bounded (per-order max, daily budget, allow-listed symbols)? What happens on partial fills, `failed` states, or an unreachable API mid-strategy? Every trading app needs an explicit **order state machine** and a **reconciliation loop** (poll `GET orders` and reconcile against local state — there are no webhooks or streaming; polling within the rate budget is the only push-free option).
3. **Key custody**: the Ed25519 private key can move real money. Keep it in a secrets manager/env var, never in code or the frontend; scope the API credential to only the actions the app needs (read-only keys for dashboards).
4. **Fees & spread**: v1 prices embed a spread (market-maker quotes); v2 charges an explicit `fee_ratio` with volume tiers. Estimated price ≠ execution price — surface `estimated_price` results to users before ordering.
5. **Rate budget**: 100 req/min shared across the whole account — decide polling cadences up front (e.g., best_bid_ask every 5s = 12/min per symbol).

App archetypes with worked design notes (DCA bot, dashboard, alerts, agent integration) are in `references/product-and-planning.md`.

## Developing

Use the client in `references/typescript-client.md` as the base — it's built on `node:crypto` (no extra deps), its signing is verified against the official test vector, and it handles the gotchas (single-serialization signing, fresh timestamps, 429 backoff, pagination). Python users: the official docs ship a PyNaCl client; the same rules apply.

Keep a hard separation between **strategy logic** (pure, testable functions: "given holdings and price, what order should exist?") and **execution** (the API client) — this is what makes the testing strategy below possible.

## Testing

Layered, from free to risky — go in this order and stop escalating as soon as confidence suffices:

1. **Signature self-test** (no network): assert your signer reproduces the known-good signature from the vector in `references/typescript-client.md`.
2. **Pure-logic unit tests**: strategy functions, quantity rounding to `asset_increment`, order-size validation, state-machine transitions — no client involved.
3. **Mocked-transport tests**: inject a fake `fetch` returning fixtures shaped like the schemas in `references/crypto-trading-api.md` (including 400 validation errors, 429s, and pagination pages). Test retry/idempotency by simulating a timeout after the order was actually placed.
4. **Live read-only smoke test**: a separately-scoped read-only credential hitting `accounts`/`trading_pairs`/`best_bid_ask` — safe and proves auth end-to-end.
5. **Live micro-order test** (only when order placement itself must be proven): smallest allowed limit order priced far off-market so it rests unfilled, assert it appears with state `open`, then cancel it and assert the cancel. Never leave test orders resting.
