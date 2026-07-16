---
name: robinhood-chain
description: Comprehensive guide for designing, building, testing, and deploying apps on Robinhood Chain — Robinhood's Arbitrum-based Ethereum L2 for tokenized real-world assets. Use this skill whenever the user mentions Robinhood Chain (or "RH chain", "Robinhood L2", chain ID 4663 / 46630), stock tokens or tokenized equities/ETFs (AAPL, TSLA, SPY tokens, etc.), Robinhood price feeds, bridging to/from Robinhood Chain, deploying or verifying contracts on Robinhood Chain, or building any dApp/DeFi integration (lending, DEX, portfolio, AA wallet) that touches Robinhood Chain — even if they only ask how the chain differs from Ethereum or how to connect a wallet to it.
---

# Robinhood Chain Development

Robinhood Chain is a permissionless, EVM-compatible Layer-2 built on **Arbitrum Nitro** (an Arbitrum Dedicated Blockchain), using Ethereum blobs for data availability and **ETH as the native gas token**. It is optimized for tokenized real-world assets (RWAs): equities, ETFs, and private assets as onchain "Stock Tokens".

Standard EVM tooling works unmodified: Solidity/Vyper, Hardhat, Foundry, ethers.js, viem, wagmi. Ecosystem partners: Alchemy (RPC/AA), Chainlink (oracles), LayerZero, Uniswap, Morpho, Paxos (USDG).

## Quick facts

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | **4663** | **46630** |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Production RPC (Alchemy) | `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` | `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}` |
| Explorer (Blockscout) | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Gas token | ETH | ETH |

Public RPCs are rate-limited — fine for scripts and testing, not for production apps. For full endpoint lists, protocol contract addresses, precompiles, ERC-4337 contracts, and full-node instructions, read `references/network-and-contracts.md`.

## How to use this skill

1. **Always start from the "Critical differences from Ethereum" section below** — most Robinhood Chain bugs come from assuming vanilla-Ethereum semantics.
2. Then read the reference file matching the task:
   - `references/stock-tokens-and-oracles.md` — building with Stock Tokens, `uiMultiplier()`, Chainlink feeds, all token addresses. **Read this before writing any code that touches a stock token or price feed.**
   - `references/network-and-contracts.md` — endpoints, wallet connection, protocol/AA contract addresses, precompiles, running a node.
   - `references/bridging-and-messaging.md` — canonical bridge, deposits/withdrawals, L1↔L2 messaging with @arbitrum/sdk, address aliasing.
   - `references/differences-from-ethereum.md` — full detail on block semantics, gas model, finality, sequencer behavior.
3. For Hardhat test/config mechanics in a Hardhat project, also invoke the `hardhat` skill (and the matching toolbox skill) — this skill covers *what* to build for Robinhood Chain; the hardhat skill covers *how* to wire tests and config.

## Critical differences from Ethereum

These are the things that silently break contracts ported from Ethereum. Full details in `references/differences-from-ethereum.md`.

- **`block.number` is an L1 estimate**, not the L2 block number, and updates only periodically. For the real L2 block number call `arbBlockNumber()` on the **ArbSys precompile at `0x0000000000000000000000000000000000000064`**. Never use `block.number` deltas for short timing windows.
- **No onchain randomness**: `block.prevrandao` / `block.difficulty` return a constant. `blockhash(n)` is unreliable for older blocks. Use Chainlink VRF for randomness.
- **`block.coinbase`** returns the network fee account, not a validator.
- **First-come-first-served sequencing**: transaction order = arrival order at the sequencer. Priority fees do NOT buy ordering, so priority-gas-auction patterns are pointless; conversely, classic frontrunning via fee bidding doesn't work the same way.
- **Two-part gas**: total fee = L2 execution gas + L1 data fee (proportional to calldata size, varies with Ethereum congestion), bundled into one gas charge. To cut costs, minimize calldata: pack arguments, batch operations (AA UserOps). Query pricing via the ArbGasInfo precompile (`0x…006C`).
- **Address aliasing**: when an L1 contract calls into L2 (retryable ticket), `msg.sender` on L2 is the *aliased* L1 address (original + fixed offset). Access control that checks an L1 contract address must account for this (`applyAlias`/`undoAlias` in @arbitrum/sdk).
- **Contract size limit is 96 KB** (init code 192 KB) — larger than Ethereum's 24 KB.
- **Finality is staged**: sub-second soft confirmation from the sequencer → batch posted to Ethereum (minutes; ordering fixed) → Ethereum finality (~13 min after posting; irreversible). Use soft confirmation for UX; wait for L1 posting/finality before settling high-value or irreversible actions. Withdrawals to L1 additionally have a **7-day challenge period** (fraud proofs) — that's a bridge property, not finality.
- **Sequencer-level screening**: transactions linked to sanctioned addresses may be excluded.

## Stock Tokens — the 60-second model

(Details, interfaces, and the full address table: `references/stock-tokens-and-oracles.md`.)

- Stock Tokens are **ERC-20, 18 decimals**, tokenized debt securities issued by Robinhood Assets (Jersey) Ltd — economic exposure, not legal share ownership. Standard `balanceOf`/`transfer`/`approve` work; they compose with any DeFi protocol.
- **You cannot mint them.** Only Authorized Participants subscribe from the issuer. Apps *compose* with existing tokens (swaps, lending, vaults) rather than issuing them.
- **Corporate actions (splits, dividends) are handled by an onchain multiplier** (ERC-8056 "Scaled UI Amount"): raw balances stay static; `uiMultiplier()` (1e18 fixed-point) scales shares-per-token. Monitor `UIMultiplierUpdated` events.
- **Every stock token has a Chainlink feed** (`AggregatorV3Interface`, 8 decimals for USD). **The feed price ALREADY includes the multiplier — never apply `uiMultiplier()` on top of the feed price.** USD value = `balanceOf(user) × price / 1e8` (result in 18 decimals).
- Stock feeds update **24/5 (market hours)** — a naive "revert if older than 1 hour" staleness check bricks your app every weekend. Use asset-appropriate staleness windows, check `oraclePaused()` (true during corporate actions), and check the **L2 Sequencer Uptime Feed** before trusting any price.
- Compliance: Stock Tokens are **prohibited in the US** and restricted in Canada/UK/Switzerland. Surface this in product design; don't build US-targeted stock-token flows.

## Designing an app on Robinhood Chain

When asked to design or architect an app, work through this checklist and state your reasoning:

1. **Which assets?** Stock tokens (compose-only), USDG stablecoin, WETH, bridged ERC-20s (addresses differ from L1 — resolve via `calculateL2TokenAddress` on the L2 Gateway Router, never assume).
2. **Price integrity**: per-asset Chainlink feed + staleness window appropriate to a 24/5 feed + `oraclePaused()` + sequencer uptime check. For lending/liquidation logic, decide behavior during market close and corporate actions (e.g., pause liquidations when the oracle is paused rather than liquidating on stale prices).
3. **Corporate-action safety**: any protocol holding stock tokens long-term must tolerate `uiMultiplier` changes. Raw balances don't move, but *value* and share-equivalence do — vault share math based on raw balances is safe; anything converting to "shares of underlying" must read the current multiplier.
4. **Finality policy**: what needs soft confirmation vs. L1 finality? Deposits/withdrawals crossing to Ethereum need the 7-day period in the UX.
5. **Ordering assumptions**: no fee-based ordering. Don't design auctions/MEV mechanics that assume priority fees.
6. **AA opportunity**: first-class ERC-4337 (EntryPoint v0.6/0.7/0.8 deployed) + EIP-7702. Gas sponsorship and batching via Alchemy/ZeroDev are the idiomatic UX for consumer apps here.
7. **Compliance**: jurisdiction restrictions on stock tokens; sequencer screening of sanctioned addresses.

## Developing and testing

**Unit tests**: mock the feed (implement `AggregatorV3Interface` with 8 decimals) and a mock ERC-20+`uiMultiplier()` token. Test multiplier changes explicitly (e.g., 2:1 split → multiplier doubles, raw balance constant).

**Integration tests — fork Robinhood Chain mainnet.** Stock tokens can't be minted and testnet has no stock-token liquidity, so the realistic way to test integrations is forking mainnet at the public RPC and impersonating holders or writing balances directly:

- Hardhat 3: `network.create()`/config with `forking: { url: "https://rpc.mainnet.chain.robinhood.com" }`, then `hardhat_impersonateAccount` on a holder (find one via Blockscout token holders page) or `hardhat_setStorageAt` on the balance slot.
- Foundry: `vm.createSelectFork(rpcUrl)`, then `deal`/`vm.prank`.

Verify against the real feed + real token in the fork before any mainnet deploy. Remember the public RPC is rate-limited — cache the fork block number for deterministic, faster CI runs.

**Testnet**: deploy to chain 46630 first for anything involving real transactions (bridge flows, AA). Get testnet ETH by bridging Sepolia ETH via the canonical bridge (testnet L1 contracts are on Sepolia — L1 WETH `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` is Sepolia WETH).

## Deploying and verifying

Contracts deploy unmodified (Solidity ^0.8.13+ examples in docs). Never hardcode private keys — use env vars or keystore.

**Hardhat** (v3 style; adapt to project conventions — invoke the `hardhat` skill for config mechanics):

```ts
networks: {
  robinhood: {
    type: "http",
    url: process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com",
    chainId: 4663,
    accounts: [process.env.PRIVATE_KEY],
  },
  robinhoodTestnet: {
    type: "http",
    url: "https://rpc.testnet.chain.robinhood.com",
    chainId: 46630,
    accounts: [process.env.PRIVATE_KEY],
  },
},
```

Verification is via **Blockscout** (no API key needed — use `"empty"` as apiKey with etherscan-style plugins):

```js
etherscan: {
  apiKey: { robinhood: "empty" },
  customChains: [{
    network: "robinhood",
    chainId: 4663,
    urls: {
      apiURL: "https://robinhoodchain.blockscout.com/api",
      browserURL: "https://robinhoodchain.blockscout.com/",
    },
  }],
},
```

**Foundry**:

```bash
forge create src/MyContract.sol:MyContract --rpc-url $RH_RPC_URL --private-key $PRIVATE_KEY --broadcast

forge verify-contract <address> src/MyContract.sol:MyContract \
  --chain-id 4663 --verifier blockscout \
  --verifier-url https://robinhoodchain.blockscout.com/api/
```

**viem**: no built-in chain definition — define it with `defineChain({ id: 4663, ... })` (full snippet in `references/network-and-contracts.md`).

## Support and upgrades

- The chain periodically upgrades ArbOS onchain at scheduled times (currently ArbOS 61); node operators must update before activation — watch the notices page (`https://docs.robinhood.com/chain/notices-and-upgrades`).
- Technical issues, security reports, partnerships: **chain-developers-group@robinhood.com**.
- ToS notes for builders: non-custodial (Robinhood never holds user assets), no warranty on bridge/infra, don't build competing products on their Services, no sanctioned users/VPN masking.
