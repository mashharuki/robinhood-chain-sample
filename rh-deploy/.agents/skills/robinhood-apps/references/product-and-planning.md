# Robinhood Product Landscape, Agentic Trading, and App Planning

Read this when the task is 企画/設計 (planning, product design, architecture) or involves connecting AI agents to Robinhood.

## Table of contents

1. [Product landscape (2026)](#product-landscape-2026)
2. [Developer surface decision guide](#developer-surface-decision-guide)
3. [Agentic Trading — the official MCP server](#agentic-trading--the-official-mcp-server)
4. [App archetypes with design notes](#app-archetypes-with-design-notes)
5. [Compliance and risk checklist](#compliance-and-risk-checklist)
6. [Architecture patterns for trading apps](#architecture-patterns-for-trading-apps)

## Product landscape (2026)

What Robinhood the company offers (useful when scoping what an "app about Robinhood" could touch):

- **Brokerage**: stocks & ETFs (Robinhood Financial), options, futures & cleared swaps (Robinhood Derivatives), prediction markets ("Predict"), retirement/custodial accounts.
- **Crypto** (Robinhood Crypto): 24/7 trading, staking/earning, self-custody wallet — and the **Crypto Trading API** (the only official REST API).
- **Robinhood Chain**: Arbitrum-based L2 for tokenized stocks/RWAs → covered by the `robinhood-chain` skill.
- **Agentic**: **Agentic Trading** (AI agents trade via MCP in a dedicated account, launched 2026-05-27, beta) and an Agentic (virtual) credit card.
- **Consumer finance**: Gold subscription, Gold/Platinum credit cards, banking/spending accounts, Legend desktop trading platform, Cortex AI insights.

## Developer surface decision guide

| The user wants… | Use |
|---|---|
| Programmatic **crypto** trading/data under their own control | Crypto Trading API (`crypto-trading-api.md` + `typescript-client.md`) |
| An **AI agent** that trades **stocks** in their account | Agentic Trading MCP (below) |
| Anything on **Robinhood Chain** / stock tokens / contracts | `robinhood-chain` skill |
| Programmatic **stock/options** trading via REST | **Doesn't exist officially.** Options: (a) reframe as agent-driven → Agentic MCP; (b) different broker with a real API (Alpaca, IBKR, Tradier); (c) manual trading assisted by a dashboard using third-party market data. Never the reverse-engineered private API (ToS violation, 2FA breakage, account-restriction risk). |
| Market **data only** (no Robinhood account actions) | Third-party data APIs (Robinhood's data endpoints require customer credentials and are account-rate-limited) |

## Agentic Trading — the official MCP server

Robinhood's own MCP server lets AI agents (Claude Code, Claude Desktop, ChatGPT, Cursor, Codex, Grok, and any MCP-compatible client) read a customer's Robinhood data and place trades in a **dedicated Agentic account**.

- **Server URL**: `https://agent.robinhood.com/mcp/trading` (HTTP transport)
- **Claude Code setup**: `claude mcp add robinhood-trading --transport http https://agent.robinhood.com/mcp/trading`
- **Claude Desktop**: Settings → Connectors → Add custom connector (same URL). Other platforms: add the URL in their MCP/apps settings.
- **Onboarding**: user authenticates the agent, then opens an Agentic account (desktop web only; requires a primary individual investing account in good standing; counts toward the 10-account max). The user funds it with a dedicated budget — the agent can only trade those funds.
- **Capabilities**: read all accounts' positions/balances/history/watchlists; place orders (stocks only during beta — options, crypto, event contracts, futures planned); portfolio building, rebalancing, risk/market analysis.
- **Safety model**: trading restricted to the Agentic account; configurable order preview/approval before execution; push notification per trade; activity feed and P&L in-app; disconnect anytime. Robinhood does not supervise agents — the user bears full responsibility, so any agent you design should keep its own guardrails (budget caps, allow-listed tickers, human approval for orders above a threshold).

When a user asks "make an AI trade for me on Robinhood": this MCP server is the sanctioned path. Design the agent's *strategy and guardrails*; the MCP server handles auth and execution.

## App archetypes with design notes

### 1. DCA / auto-invest bot (crypto)
- Schedule (cron) → check buying power (`accounts`) → `estimated_price` (ask side) → place **market or limit** order with `quote_amount`-style sizing (v1 market orders take `asset_quantity` only, so convert: `asset_quantity = usd_budget / ask`, rounded DOWN to `asset_increment`).
- Idempotency: derive `client_order_id` deterministically per scheduled slot (e.g. UUIDv5 of "dca-2026-07-19") so a crashed/rerun job can't double-buy.
- Reconcile the previous run's order state before placing a new one.

### 2. Portfolio dashboard
- Read-only credential (scope it at creation!). Poll `holdings` + `best_bid_ask`; value = quantity × bid (what you'd get selling). Cache aggressively — 100 req/min covers ~8 symbols at 5 s refresh with headroom.
- If it also shows Robinhood Chain assets, combine with the `robinhood-chain` skill (on-chain balances + Chainlink feeds).

### 3. Price alerts / signals
- Poller + threshold rules → notification channel. Store last-seen prices; alert on crossings, not levels (avoids re-firing). Respect the rate budget; batch symbols into one `best_bid_ask` call (repeatable `symbol` param).

### 4. Strategy/trading bot (limit orders, stops)
- Full order-state machine + reconciliation loop mandatory (below). Use v2 if fee transparency matters (explicit `fee_ratio`, `est_total_cost`).
- Backtest strategy logic offline against historical data from a third-party source — the Robinhood API has **no historical candles endpoint**; only live best-bid-ask and estimates.

### 5. Agent-assisted investing (stocks)
- Agentic MCP; your deliverable is prompts/tooling around the MCP server plus guardrails, not HTTP code.

## Compliance and risk checklist

Surface these in any 企画 document:

- **Eligibility**: Crypto API & Agentic Trading = US customers only. Robinhood Chain stock tokens = prohibited in the US. An app can't assume one user base fits all three.
- **Credentials move real money.** Scope keys minimally (read-only where possible), store in secret managers, rotate on suspicion; never ship a private key to a browser/mobile client — server-side signing only.
- **No sandbox** for the Crypto API — testing touches real funds (see SKILL.md testing ladder).
- **Fees/spread disclosure**: v1 embeds spread; v2 has tiered explicit fees (only v2 volume builds tiers). Show users estimated totals (`est_total_cost` / `est_total_credit`) before ordering.
- **Not investment advice**: an app suggesting trades should carry disclaimers; Robinhood disclaims responsibility for agent output, and so should the app.
- **Terms of service**: only documented public APIs; no scraping/private-API use; respect rate limits.

## Architecture patterns for trading apps

**Signer isolation**: one small module owns the private key and exposes `sign(request) → headers`. Everything else handles plain data. Makes key custody auditable and the rest of the app testable without secrets.

**Order state machine**: `intent → submitted → open → partially_filled → filled | canceled | failed`, persisted locally keyed by `client_order_id`. Transitions only via API reconciliation, never assumption. Handle the awkward cases explicitly: submit timeout (state unknown → query by `client_order_id` filter or resubmit same UUID), cancel racing a fill (cancel is async — the order may fill anyway), `partially_filled` then canceled (position changed even though the order "failed").

**Reconciliation loop**: there are no webhooks/streams. A background poller (`GET orders?updated_at_start=<last sync>`) is the source of truth; local state is a cache. On startup, reconcile before doing anything else.

**Clock discipline**: the 30-second timestamp window means NTP-synced hosts and signing immediately before send (never pre-computing signatures into a queue).

**Rate budgeting**: give each subsystem (pricing poller, reconciler, order path) an explicit requests/min allocation summing under 100, and make the client's 429 backoff a shared token bucket so one subsystem can't starve the others.
