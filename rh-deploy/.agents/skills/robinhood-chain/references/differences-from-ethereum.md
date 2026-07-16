# Differences from Ethereum, Gas Model, and Finality

Robinhood Chain runs Arbitrum Nitro. It is EVM-compatible, but several semantics differ in ways that break naively-ported contracts.

## Block and environment semantics

| Ethereum assumption | Robinhood Chain reality | What to do |
|---|---|---|
| `block.number` = current chain block | Returns an **estimate of the L1 (Ethereum) block number**, updated only periodically | For the real L2 block number, call `ArbSys(0x0000000000000000000000000000000000000064).arbBlockNumber()`. Never use `block.number` deltas for short timing/vesting windows |
| `block.prevrandao` / `block.difficulty` is pseudo-random | Returns a **constant** | Use Chainlink VRF for randomness |
| `blockhash(n)` usable for recent blocks | Supported but unreliable for older blocks; never a randomness source | Avoid as entropy |
| `block.coinbase` = validator/miner | Returns the **network fee account** | Don't use for validator logic |
| `msg.sender` of an L1-originated call = the L1 address | It's the **aliased** address (L1 address + fixed offset) for L1-contract-initiated retryable tickets | In access control comparing against a known L1 contract, compare against the alias (`applyAlias`/`undoAlias` in @arbitrum/sdk) |
| Max contract size 24 KB | **96 KB** code / **192 KB** init code | Less need for aggressive splitting |
| Priority fee buys earlier inclusion | **First-come, first-served** ordering by sequencer arrival time | Don't build priority-gas-auction or fee-bidding mechanics |
| `gasleft()` / gas estimation Ethereum-like | Behaves differently (includes L1 data component) | Use `eth_estimateGas` from the RPC; query components via ArbGasInfo / NodeInterface |

Also: the sequencer applies compliance screening — transactions linked to sanctioned addresses may be excluded.

## Gas and fees

Two components, bundled into one gas charge (you never pay them separately):

1. **L2 execution fee** — gas used × L2 gas price. Ethereum-like, typically very low and stable.
2. **L1 data fee** — cost of posting the tx's data to Ethereum blobs; proportional to **calldata size** and varies with Ethereum congestion.

Standard estimation (`eth_estimateGas`, wallets, viem/ethers fee estimation) already accounts for both.

Optimization levers, in order of impact:

- **Shrink calldata**: pack arguments tightly, avoid redundant bytes, prefer `uint`s over strings.
- **Batch operations**: one tx with N ops amortizes fixed overhead; with ERC-4337, batch calls into a single UserOperation.
- Query live pricing via the **ArbGasInfo** precompile (`0x000000000000000000000000000000000000006C`).

Native gas token is ETH — fees denominated exactly as on Ethereum.

## Transaction finality (three stages)

| Stage | Latency | Guarantee |
|---|---|---|
| **Soft confirmation** | sub-second | Sequencer has accepted/ordered/executed and returned a receipt. Reversible only if the sequencer posts a batch with altered order |
| **Posted to Ethereum** | minutes | Batch is in the L1 Inbox — ordering fixed; reorg only if Ethereum itself reorgs |
| **Ethereum finality** | ~13 min after posting | Irreversible; inherits Ethereum security |

Guidance:

- Normal UX (swaps, transfers, game moves): soft confirmation is fine.
- High-value or irreversible offchain actions (crediting a CEX account, releasing goods, settlement): wait for L1 posting or full finality.
- **The 7-day withdrawal challenge period is not a finality stage** — it's the Arbitrum fraud-proof window that applies only to L2→L1 exits through the canonical bridge.

## Upgrades

ArbOS versions upgrade onchain at scheduled times (currently ArbOS 61). Node operators must run compatible node versions before activation; the network halts cleanly at the upgrade block, no resync needed. Developers should review notices for contract/integration impact: https://docs.robinhood.com/chain/notices-and-upgrades
