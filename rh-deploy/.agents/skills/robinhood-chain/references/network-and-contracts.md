# Network, Endpoints, and Contract Addresses

## Network configuration

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 4663 | 46630 |
| Currency symbol | ETH | ETH |
| Public RPC | `https://rpc.mainnet.chain.robinhood.com` | `https://rpc.testnet.chain.robinhood.com` |
| Block explorer | `https://robinhoodchain.blockscout.com` | `https://explorer.testnet.chain.robinhood.com` |
| Sequencer feed (ws) | `wss://feed.mainnet.chain.robinhood.com` | `wss://feed.testnet.chain.robinhood.com` |
| Sequencer endpoint | `https://sequencer.mainnet.chain.robinhood.com` | `https://sequencer.testnet.chain.robinhood.com` |

Parent chain: Ethereum mainnet (testnet's parent is Sepolia).

### Production RPC providers

Public endpoints are rate-limited and not for production. Use a provider:

- **Alchemy** (recommended; also the AA infra partner):
  - RPC: `https://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` / `https://robinhood-testnet.g.alchemy.com/v2/{API_KEY}`
  - WebSocket: `wss://robinhood-mainnet.g.alchemy.com/v2/{API_KEY}` / `wss://robinhood-testnet.g.alchemy.com/v2/{API_KEY}`
- **QuickNode**: `https://{ENDPOINT}.robinhood-mainnet.quiknode.pro/{TOKEN}`
- Also supported: Blockdaemon, dRPC, Validation Cloud.

## Wallet connection

Compatible with all EVM wallets (MetaMask, Phantom, Robinhood Wallet app, …). To add the network programmatically:

```ts
await window.ethereum.request({
  method: "wallet_addEthereumChain",
  params: [{
    chainId: "0x1237", // 4663
    chainName: "Robinhood Chain",
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: ["https://rpc.mainnet.chain.robinhood.com"],
    blockExplorerUrls: ["https://robinhoodchain.blockscout.com"],
  }],
});
```

(Testnet: chainId `0xB626` = 46630, testnet RPC/explorer URLs.)

### viem chain definition

viem has no built-in definition; define one:

```ts
import { defineChain } from "viem";

export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const robinhoodChainTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});
```

## Protocol contracts

### Core (on Ethereum L1)

| Contract | Mainnet | Testnet (Sepolia) |
|---|---|---|
| Rollup | `0x23A19d23e89166adedbDcB432518AB01e4272D94` | `0xdc5F8E399DBd8a9F5F87AeC4C23Beb12431b386D` |
| Sequencer Inbox | `0xBd0D173EEb87D57A09521c24388a12789F33ba96` | `0xA0D9dB3DC9791D54b5183C1C1866eFe1eCA7D414` |
| Delayed Inbox | `0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D` | `0xF2939afA86F6f933A3CE17fCAB007907B6b0B7a4` |
| Bridge | `0xDf8755334ce7A73cCF6b581C02eA649AE3E864b3` | `0x96295BDad104eaD97cC08797b3dC68efF59CcF30` |
| Outbox | `0xf0ce991ea4A0d2400A4AB49b20ae333f6Dce3DE9` | `0x8D180Caf588f3Da027BEf1F42a106Da93F90b166` |
| CoreProxyAdmin | `0x1232813BDd40aa9d53066A880dE78a4Be70B90FD` | `0x20d5d542c1bF0a3c295524Eaef336fC07e890622` |

### Token bridge — L1 gateways

| Contract | Mainnet | Testnet (Sepolia) |
|---|---|---|
| L1 Gateway Router | `0x6a2E3a1e16FC29f27Ce61429746D558d656975bB` | `0xF6F11aAEE80875776C264d93B37B34cE437382D1` |
| L1 ERC20 Gateway | `0x85001CC4867C5e1C22dA4B79BB8852B9e2a06da0` | `0x52C2976cbDEf48BcC51d07d3c523769F76ECBd09` |
| L1 Arb-Custom Gateway | `0x9368EAEbFe6E063C69dcF8126711A6997E0eCeE1` | `0xFB4aa8024F70B00121723A9C923BaD0Dd2dFaf8F` |
| L1 WETH Gateway | `0xF7e12b9614b509C747ab4423bC4ACF923759Cf1B` | `0x8f8A6799F2b1978c6586318543c73D8Fb12f218f` |
| L1 WETH | `0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2` | `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` |
| L1 Multicall | `0x7cdCB0Cc61f47B8Dd8f47C5A29edaDd84a1BDf5e` | — |

### Token bridge — L2 gateways (on Robinhood Chain)

| Contract | Mainnet | Testnet |
|---|---|---|
| L2 Gateway Router | `0x1E324B9316138CA9a73F960213621AD1aaf01B89` | `0x77bF00A6A90c600f214b34BAFBB7918c0cF113A8` |
| L2 ERC20 Gateway | `0xfd9b17206278C16DdaacF6AC8f05dBf97EdCb31e` | `0x8689aFB9086734e12beA6b5DF541a1da252Ea32a` |
| L2 Arb-Custom Gateway | `0x912285144fC0f6e89d3Ed16F5Ab72f87A1878959` | `0xE4EE9C15e2cA44136796342e31b67d953E67a70b` |
| L2 WETH Gateway | `0x1D187C3E2dA52D72BC9C41e3AbA0fdFa6a7bF055` | `0x5A8F55202A625D12FFCb76F857FE4563bC8Ce413` |
| L2 WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` | `0x7943e237c7F95DA44E0301572D358911207852Fa` |
| L2 Multicall | `0x2cAC2D899eCC914d704FeaAE33ac1bF36277DaD1` | `0xa432504b6F04Cafe775b09D8AA92e8dbe41Ec7a8` |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | same |

### Arbitrum precompiles (L2, same on both networks)

| Precompile | Address | Use |
|---|---|---|
| ArbSys | `0x0000000000000000000000000000000000000064` | L2 block number, L2→L1 messages |
| ArbGasInfo | `0x000000000000000000000000000000000000006C` | Gas pricing components |
| ArbRetryableTx | `0x000000000000000000000000000000000000006E` | Retryable ticket management |
| ArbAddressTable | `0x0000000000000000000000000000000000000066` | Calldata compression |
| ArbInfo | `0x0000000000000000000000000000000000000065` | Account info |
| ArbAggregator | `0x000000000000000000000000000000000000006D` | |
| ArbFunctionTable | `0x0000000000000000000000000000000000000068` | |
| ArbOwner / ArbOwnerPublic | `0x…0070` / `0x…006b` | Chain administration |
| ArbStatistics | `0x000000000000000000000000000000000000006F` | |
| ArbWasm / ArbWasmCache | `0x…0071` / `0x…0072` | Stylus |
| NodeInterface | `0x00000000000000000000000000000000000000C8` | Gas estimation (RPC-only virtual contract) |

## ERC-4337 / Account Abstraction contracts (L2)

First-class ERC-4337 support plus EIP-7702 (EOAs can delegate to contract code without changing address). Bundler/paymaster infra: **Alchemy** (batching, spend policies, gas sponsorship) and **ZeroDev** (embedded wallets, automation, cross-chain execution). Alchemy bundler URL is the same as its RPC URL.

| Contract | Address |
|---|---|
| EntryPoint v0.6.0 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` |
| SenderCreator v0.6.0 | `0x7fc98430eAEdbb6070B35B39D798725049088348` |
| EntryPoint v0.7.0 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` |
| SenderCreator v0.7.0 | `0xEFC2c1444eBCC4Db75e7613d20C6a62fF67A167C` |
| EntryPoint v0.8.0 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` |
| SenderCreator v0.8.0 | `0x449ED7C3e6Fee6a97311d4b55475DF59C44AdD33` |
| Safe Module Setup v0.3.0 | `0x2dd68b007B46fBe91B9A7c3EDa5A7a1063cB5b47` |
| Safe 4337 Module v0.3.0 | `0x75cf11467937ce3F2f357CE24ffc3DBF8fD5c226` |

## Infrastructure tokens (L2 mainnet)

| Token | Address |
|---|---|
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| USDG (Paxos stablecoin) | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

Stock token addresses: see `stock-tokens-and-oracles.md`.

## Running a full node

- Docker image: `offchainlabs/nitro-node:v3.11.2-3599aca` (ArbOS 61 — check the notices page for upgrades before pinning).
- Hardware: 8+ modern cores with strong single-core perf, 64 GB RAM min (128 GB recommended), NVMe SSD sized at (2 × chain size) + 20%.
- Requires an L1 execution RPC **and** an L1 beacon endpoint (blob data). L1 must be synced before L2 finishes syncing.
- Config files: mainnet needs `robinhood-chain-info.json` + `robinhood-genesis.json` (`--init.genesis-json-file`); testnet only `robinhood-chain-testnet-info.json`.
- Key flags:
  ```
  --chain.info-files=/home/nitro/config/robinhood-chain-info.json
  --parent-chain.connection.url=<L1_RPC>
  --parent-chain.blob-client.beacon-url=<L1_BEACON>
  --http.addr=0.0.0.0 --http.port=8547 --http.api=net,web3,eth
  --node.feed.input.url=wss://feed.mainnet.chain.robinhood.com   # live sequencer feed
  --init.url=<SNAPSHOT_URL>                                      # optional faster sync
  ```
- Ports: 8547 HTTP RPC, 8548 WebSocket.
