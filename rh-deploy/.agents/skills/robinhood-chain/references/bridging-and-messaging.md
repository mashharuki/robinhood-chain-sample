# Bridging and Cross-Chain Messaging

Robinhood Chain is an Arbitrum chain, so bridging and messaging use standard Arbitrum Nitro mechanisms. Use **@arbitrum/sdk** rather than manual encoding. All contract addresses referenced here are listed in `network-and-contracts.md`.

## Canonical bridge

Trustless — no third-party validators; security inherited from Ethereum.

**Deposits (Ethereum → Robinhood Chain)**: ~10 minutes. ETH and ERC-20s via the Arbitrum canonical bridge. Deposits use the **retryable ticket** system — a failed deposit isn't lost; it can be manually redeemed within **7 days** (via ArbRetryableTx / SDK helpers).

**Withdrawals (Robinhood Chain → Ethereum)**: three steps —
1. Initiate on L2 (ArbSys / gateway).
2. Wait the **7-day challenge period** (Arbitrum fraud-proof requirement).
3. Claim on L1 (costs L1 gas).

Design UX around the 7-day exit: either surface the wait honestly or integrate a fast-liquidity bridge (LayerZero/Stargate, Chainlink CCIP/Transporter, Relay, Across, LiFi/0x all support Robinhood Chain) for users who want instant exits — noting those reintroduce third-party trust.

**Bridged token addresses differ between chains.** Never assume an L1 token's address on L2 — resolve it:

```ts
const l2Address = await l2GatewayRouter.calculateL2TokenAddress(l1TokenAddress);
```

## Registering Robinhood Chain with @arbitrum/sdk

The SDK doesn't know custom chains; register first:

```ts
import { registerCustomArbitrumNetwork } from "@arbitrum/sdk";

registerCustomArbitrumNetwork({
  name: "Robinhood Chain",
  chainId: 4663,
  parentChainId: 1,
  confirmPeriodBlocks: 45818,
  ethBridge: {
    bridge: "0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3",
    inbox: "0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D",
    sequencerInbox: "0xBd0D173EEb87D57A09521c24388a12789F33ba96",
    outbox: "0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9",
    rollup: "0x23A19d23e89166adedbDcB432518AB01e4272D94",
  },
});
```

## L1 → L2 messaging (retryable tickets, minutes)

```ts
import { ParentToChildMessageCreator } from "@arbitrum/sdk";

const messageCreator = new ParentToChildMessageCreator(parentSigner);
const tx = await messageCreator.createRetryableTicket(
  {
    to: l2Target,
    data: calldata,
    l2CallValue: 0n,
    from: await parentSigner.getAddress(),
  },
  childProvider,
);
await tx.wait();
```

**Address aliasing**: when an L1 *contract* sends a retryable ticket, `msg.sender` observed on L2 is the aliased address (L1 address + fixed offset), NOT the original. L2 contracts gating on an L1 contract address must compare against the alias — use the SDK's `applyAlias` / `undoAlias` helpers.

## L2 → L1 messaging (7-day challenge period)

Step 1 — initiate on L2 via the ArbSys precompile:

```ts
const arbSys = ArbSys__factory.connect(
  "0x0000000000000000000000000000000000000064",
  childSigner,
);
const tx = await arbSys.sendTxToL1(destinationL1Address, data, { value: 0n });
const receipt = await tx.wait();
```

Step 2 — after the challenge period, execute on L1:

```ts
const childReceipt = new ChildTransactionReceipt(receipt);
const [message] = await childReceipt.getChildToParentMessages(parentSigner);
await message.waitUntilReadyToExecute(childProvider);
await message.execute(parentSigner);
```

## Alternative interoperability

LayerZero (+ Stargate), Chainlink CCIP (+ Transporter), Relay, Across, and LiFi/0x operate on Robinhood Chain for cross-chain apps and fast bridging. The official docs don't publish their endpoint IDs/addresses — get them from each provider's own docs and verify on Blockscout before use.
