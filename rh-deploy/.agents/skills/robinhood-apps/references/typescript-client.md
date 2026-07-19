# TypeScript Client for the Robinhood Crypto Trading API

A dependency-free client built on `node:crypto` (Node 18+; Ed25519 supported natively). The signing logic below has been **verified against the official documentation's test vector**.

## Table of contents

1. [Generating a keypair](#generating-a-keypair)
2. [The client](#the-client)
3. [Signature self-test (run this first)](#signature-self-test)
4. [Usage examples](#usage-examples)
5. [Testing patterns](#testing-patterns)

## Generating a keypair

Run once; register the printed public key in crypto account settings (web classic → Add key), keep the private key in a secrets manager / env var. Robinhood expects both as base64 of the 32 raw bytes (seed for the private key) — the PyNaCl format, not PEM.

```ts
import { generateKeyPairSync } from "node:crypto";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const pubJwk = publicKey.export({ format: "jwk" });
const privJwk = privateKey.export({ format: "jwk" });
// JWK uses base64url; Robinhood wants standard base64
const b64 = (s: string) => Buffer.from(s, "base64url").toString("base64");
console.log("Public key (register at Robinhood):", b64(pubJwk.x!));
console.log("Private key (keep secret, e.g. RH_PRIVATE_KEY env):", b64(privJwk.d!));
```

## The client

Design points, each mapping to a documented API rule:

- **Sign-what-you-send**: the body is `JSON.stringify`ed exactly once; the same string is signed and transmitted.
- **Fresh timestamp per attempt**: timestamps expire after 30 s, so retries re-sign with a new timestamp.
- **Query string is part of the signed path**.
- **429/5xx backoff** with exponential delay + jitter; 4xx (except 429) surfaces the API's structured error immediately.
- Quantities/prices are passed as **strings** (avoids float drift; matches official examples).

```ts
// robinhood.ts
import { createPrivateKey, createPublicKey, sign, type KeyObject } from "node:crypto";

export interface RobinhoodError {
  type: "validation_error" | "client_error" | "server_error";
  errors: { detail: string; attr: string | null }[];
}

export class RobinhoodApiError extends Error {
  constructor(public status: number, public body: RobinhoodError | string) {
    super(`Robinhood API ${status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
}

export type Paginated<T> = { next: string | null; previous: string | null; results: T[] };

export interface OrderConfigs {
  market_order_config?: { asset_quantity: string };
  limit_order_config?: { asset_quantity?: string; quote_amount?: string; limit_price: string; time_in_force?: "gtc" | "gfd" | "gfw" | "gfm" };
  stop_loss_order_config?: { asset_quantity?: string; quote_amount?: string; stop_price: string; time_in_force?: "gtc" | "gfd" | "gfw" | "gfm" };
  stop_limit_order_config?: { asset_quantity?: string; quote_amount?: string; limit_price: string; stop_price: string; time_in_force?: "gtc" | "gfd" | "gfw" | "gfm" };
}

export interface PlaceOrderRequest extends OrderConfigs {
  symbol: string;               // uppercase pair, e.g. "BTC-USD"
  client_order_id: string;      // UUID you generate — idempotency key; persist before submitting
  side: "buy" | "sell";
  type: "market" | "limit" | "stop_loss" | "stop_limit";
}

export interface Order extends OrderConfigs {
  id: string;
  account_number: string;
  symbol: string;
  client_order_id: string;
  side: "buy" | "sell";
  type: "market" | "limit" | "stop_loss" | "stop_limit";
  state: "open" | "partially_filled" | "filled" | "canceled" | "failed";
  average_price: number | null;
  filled_asset_quantity: number;
  executions: { effective_price: string; quantity: string; timestamp: string }[];
  created_at: string;
  updated_at: string;
}

type FetchLike = typeof fetch;

export class RobinhoodCrypto {
  private key: KeyObject;
  private baseUrl = "https://trading.robinhood.com";

  constructor(
    private apiKey: string,
    privateKeyBase64Seed: string,          // 32-byte Ed25519 seed, base64 (see key generation)
    private fetchImpl: FetchLike = fetch,  // injectable for tests
    private maxRetries = 3,
  ) {
    // Wrap the 32-byte seed in a PKCS8 DER envelope — avoids JWK's requirement
    // to also supply the public key. (Verified against the official test vector.)
    const seed = Buffer.from(privateKeyBase64Seed, "base64");
    if (seed.length !== 32) throw new Error("private key must be a base64 32-byte Ed25519 seed");
    const pkcs8 = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
    this.key = createPrivateKey({ key: pkcs8, format: "der", type: "pkcs8" });
  }

  /** Base64 public key as Robinhood expects it when registering the credential. */
  publicKeyBase64(): string {
    const jwk = createPublicKey(this.key).export({ format: "jwk" });
    return Buffer.from(jwk.x as string, "base64url").toString("base64");
  }

  /** message = api_key + timestamp + path(+query) + METHOD + body */
  signMessage(timestamp: number, pathWithQuery: string, method: "GET" | "POST", body = ""): string {
    const message = `${this.apiKey}${timestamp}${pathWithQuery}${method}${body}`;
    return sign(null, Buffer.from(message, "utf8"), this.key).toString("base64");
  }

  private async request<T>(method: "GET" | "POST", pathWithQuery: string, bodyObj?: unknown): Promise<T> {
    const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj); // serialize ONCE
    for (let attempt = 0; ; attempt++) {
      const timestamp = Math.floor(Date.now() / 1000); // fresh per attempt — 30 s validity
      const res = await this.fetchImpl(this.baseUrl + pathWithQuery, {
        method,
        headers: {
          "x-api-key": this.apiKey,
          "x-timestamp": String(timestamp),
          "x-signature": this.signMessage(timestamp, pathWithQuery, method, body),
          "Content-Type": "application/json; charset=utf-8",
        },
        body: body || undefined, // send the exact signed string
      });
      if (res.ok) return (await res.json()) as T;
      const retriable = res.status === 429 || res.status >= 500;
      if (retriable && attempt < this.maxRetries) {
        const delay = 2 ** attempt * 1000 + Math.random() * 250;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      let errBody: RobinhoodError | string;
      try { errBody = (await res.json()) as RobinhoodError; } catch { errBody = await res.text(); }
      throw new RobinhoodApiError(res.status, errBody);
    }
  }

  private query(params: Record<string, string | string[] | undefined>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined) continue;
      for (const item of Array.isArray(v) ? v : [v]) parts.push(`${k}=${encodeURIComponent(item)}`);
    }
    return parts.length ? `?${parts.join("&")}` : "";
  }

  /** Follow `next` cursors until exhausted. */
  async allPages<T>(firstPath: string): Promise<T[]> {
    const out: T[] = [];
    let path: string | null = firstPath;
    while (path) {
      const page: Paginated<T> = await this.request<Paginated<T>>("GET", path);
      out.push(...page.results);
      path = page.next ? page.next.replace(this.baseUrl, "") : null;
    }
    return out;
  }

  // ---- v1 ----
  getAccount() { return this.request("GET", "/api/v1/crypto/trading/accounts/"); }
  getTradingPairs(...symbols: string[]) {
    return this.request<Paginated<unknown>>("GET", `/api/v1/crypto/trading/trading_pairs/${this.query({ symbol: symbols })}`);
  }
  getHoldings(...assetCodes: string[]) {
    return this.request<Paginated<unknown>>("GET", `/api/v1/crypto/trading/holdings/${this.query({ asset_code: assetCodes })}`);
  }
  getBestBidAsk(...symbols: string[]) {
    return this.request("GET", `/api/v1/crypto/marketdata/best_bid_ask/${this.query({ symbol: symbols })}`);
  }
  getEstimatedPrice(symbol: string, side: "bid" | "ask" | "both", quantities: string[]) {
    return this.request("GET", `/api/v1/crypto/marketdata/estimated_price/${this.query({ symbol, side, quantity: quantities.join(",") })}`);
  }
  getOrders(filters: Record<string, string> = {}) {
    return this.request<Paginated<Order>>("GET", `/api/v1/crypto/trading/orders/${this.query(filters)}`);
  }
  getOrder(orderId: string) { return this.request<Order>("GET", `/api/v1/crypto/trading/orders/${orderId}/`); }
  placeOrder(order: PlaceOrderRequest) { return this.request<Order>("POST", "/api/v1/crypto/trading/orders/", order); }
  cancelOrder(orderId: string) { return this.request("POST", `/api/v1/crypto/trading/orders/${orderId}/cancel/`); }

  // ---- v2 (account-scoped; fee tiers) ----
  getAccountsV2() { return this.request<Paginated<unknown>>("GET", "/api/v2/crypto/trading/accounts/"); }
  getHoldingsV2(accountNumber: string, ...assetCodes: string[]) {
    return this.request<Paginated<unknown>>("GET", `/api/v2/crypto/trading/holdings/${this.query({ account_number: accountNumber, asset_code: assetCodes })}`);
  }
  getBestBidAskV2(...symbols: string[]) {
    return this.request("GET", `/api/v2/crypto/marketdata/best_bid_ask/${this.query({ symbol: symbols })}`);
  }
  getEstimatedPriceV2(symbol: string, side: "bid" | "ask", quantities: string[]) {
    // NOTE: v2 moved this under /trading/, not /marketdata/
    return this.request("GET", `/api/v2/crypto/trading/estimated_price/${this.query({ symbol, side, quantity: quantities.join(",") })}`);
  }
  getOrdersV2(accountNumber: string, filters: Record<string, string> = {}) {
    return this.request<Paginated<Order>>("GET", `/api/v2/crypto/trading/orders/${this.query({ account_number: accountNumber, ...filters })}`);
  }
  placeOrderV2(accountNumber: string, order: PlaceOrderRequest) {
    return this.request<Order>("POST", `/api/v2/crypto/trading/orders/${this.query({ account_number: accountNumber })}`, order);
  }
  cancelOrderV2(orderId: string) { return this.request("POST", `/api/v2/crypto/trading/orders/${orderId}/cancel/`); }
}
```

Because the key is reconstructed from the seed, `client.publicKeyBase64()` returns exactly the string to register at Robinhood — handy for verifying the deployed secret matches the registered credential.

## Signature self-test

Run before any live call. **Caveat discovered by verification**: the official docs' example table shows a JSON body, but the published expected signature was actually generated over the *Python `str(dict)` repr* of that body (single quotes, spaced). So the vector below uses that exact string — the point is to prove your **Ed25519 mechanics** (seed → key, message concatenation, base64 output) are correct. In production, what matters is signing the byte-identical string you transmit.

```ts
import { strict as assert } from "node:assert";

const client = new RobinhoodCrypto(
  "rh-api-6148effc-c0b1-486c-8940-a1d099456be6",
  "xQnTJVeQLmw1/Mg2YimEViSpw/SdJcgNXZ5kQkAXNPU=", // docs example key — never use for real
);
assert.equal(client.publicKeyBase64(), "jPItx4TLjcnSUnmnXQQyAKL4eJj3+oWNNMmmm2vATqk=");

const body =
  "{'client_order_id': '131de903-5a9c-4260-abc1-28d562a5dcf0', 'side': 'buy', " +
  "'symbol': 'BTC-USD', 'type': 'market', 'market_order_config': {'asset_quantity': '0.1'}}";

const sig = client.signMessage(1698708981, "/api/v1/crypto/trading/orders/", "POST", body);
assert.equal(sig, "q/nEtxp/P2Or3hph3KejBqnw5o9qeuQ+hYRnB56FaHbjDsNUY9KhB1asMxohDnzdVFSD7StaTqjSd9U9HvaRAw==");
console.log("signature self-test passed");
```

## Usage examples

```ts
const rh = new RobinhoodCrypto(process.env.RH_API_KEY!, process.env.RH_PRIVATE_KEY!);

// Read-only warm-up (safe smoke test)
console.log(await rh.getAccount());
const pairs = await rh.allPages("/api/v1/crypto/trading/trading_pairs/?symbol=BTC-USD");

// Estimate before ordering: buying → ask side
const est = await rh.getEstimatedPrice("BTC-USD", "ask", ["0.0001"]);

// Place a market buy (v1). Persist client_order_id BEFORE submitting.
import { randomUUID } from "node:crypto";
const clientOrderId = randomUUID();
const order = await rh.placeOrder({
  symbol: "BTC-USD",
  client_order_id: clientOrderId,
  side: "buy",
  type: "market",
  market_order_config: { asset_quantity: "0.0001" },
});

// Reconcile until terminal state (no webhooks exist — poll within rate budget)
let state = order.state;
while (state === "open" || state === "partially_filled") {
  await new Promise((r) => setTimeout(r, 2000));
  state = (await rh.getOrder(order.id)).state;
}
```

## Testing patterns

**Unit-test the signer** with the self-test vector above (belongs in CI).

**Mock the transport** — the constructor takes a `fetch` implementation, so tests need no network and no nock/msw:

```ts
import { describe, it, expect } from "vitest";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; json: unknown }): typeof fetch {
  return (async (url: any, init: any) => {
    const { status, json } = handler(String(url), init ?? {});
    return new Response(JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

it("retries on 429 then succeeds", async () => {
  let calls = 0;
  const rh = new RobinhoodCrypto("rh-api-test", TEST_SEED, fakeFetch(() => {
    calls++;
    return calls === 1
      ? { status: 429, json: { type: "client_error", errors: [{ detail: "throttled", attr: null }] } }
      : { status: 200, json: { account_number: "A1", status: "active", buying_power: "100.00", buying_power_currency: "USD" } };
  }));
  await rh.getAccount();
  expect(calls).toBe(2);
});

it("propagates validation errors with attr", async () => {
  const rh = new RobinhoodCrypto("rh-api-test", TEST_SEED, fakeFetch(() => ({
    status: 400,
    json: { type: "validation_error", errors: [{ detail: "Ensure symbol is uppercase.", attr: "symbol" }] },
  })));
  await expect(rh.placeOrder(/* ... */)).rejects.toThrow(RobinhoodApiError);
});
```

Cover at minimum: 429 retry, 400 validation surface, pagination traversal (two pages then `next: null`), idempotent resubmission after a simulated timeout (same `client_order_id`), and quantity rounding against `asset_increment`.

**Live testing**: there is **no sandbox**. Escalate: read-only-scoped key against `GET` endpoints → tiny far-off-market limit order → verify `open` → cancel → verify `canceled`.
