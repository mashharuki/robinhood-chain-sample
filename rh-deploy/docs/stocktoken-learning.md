# Stock Token 学習キット

Robinhood Chain の売りである **Stock Token（トークン化株式）** の仕組みを、自分の手で動かして学ぶためのキット。学習用のモック実装（ミント・分割を自由に実験できる）と、メインネットの実トークンを read-only で照会するタスクの両方が入っている。

## Stock Token とは — 5 つの要点

1. **ERC-20・18 decimals のトークン化された債務証券**。発行体は Robinhood Assets (Jersey) Ltd。保有者が得るのは対象株式への経済的エクスポージャーであり、法的な株式所有権や議決権ではない。
2. **アプリはミントできない**。発行・償還は Authorized Participant（現在は BBVI）だけが発行体との間で行う。dApp は既存トークンと compose（スワップ・レンディング・vault 等）するだけ。
3. **コーポレートアクション（株式分割・配当）は raw balance を変えない**。代わりに ERC-8056 "Scaled UI Amount" の `uiMultiplier()`（1e18 固定小数点）が「1 トークンあたりの株数」を調整する。更新は `newUIMultiplier()` / `effectiveAt()` で予約され、時刻到達で自動的に有効化される。`UIMultiplierUpdated` イベントを購読して追随する。
4. **各銘柄に Chainlink フィード**（`AggregatorV3Interface`、USD は 8 decimals）がある。**フィード価格には multiplier が既に織り込み済み**（= 1 トークンの価格）。自分で `uiMultiplier()` を掛けると二重適用になる — これが最重要の落とし穴。
5. **フィードは 24/5（市場時間）更新**。固定の短い staleness チェックは週末に誤作動する。コーポレートアクション中は `oraclePaused()` が true になる。米国では Stock Token は利用禁止（カナダ・英国・スイスも制限あり）。

## このキットの構成

| ファイル | 役割 |
|---|---|
| `contracts/StockToken.sol` | ERC-8056 対応の学習用 Stock Token（OZ ERC20 + Ownable。owner = 発行体役） |
| `contracts/MockPriceFeed.sol` | Chainlink フィードのモック（8 decimals、`oraclePaused` 付き） |
| `contracts/StockViewer.sol` | 消費側の正しい統合パターン（評価式・staleness・pause チェック） |
| `contracts/interfaces/` | `IERC8056` / `AggregatorV3Interface` の最小定義 |
| `contracts/StockToken.t.sol` | forge-std による Solidity ユニットテスト（分割・二重適用禁止などを検証） |
| `ignition/modules/StockToken.ts` | 3 コントラクトのデプロイ + 初期ミント |
| `tasks/` | 学習用 CLI タスク（下記） |

## ウォークスルー 1: ローカルで分割を体験する

ターミナル A でローカルノードを起動:

```shell
bunx hardhat node
```

ターミナル B で:

```shell
# デプロイ（mAAPL 100 トークンがデプロイヤーにミントされる）
bun run deploy:stock:local

# 基本情報と multiplier の状態
bunx hardhat stock:info --network localhost

# raw balance と株数換算を並べて表示
bunx hardhat stock:balance --network localhost
#   balanceOf   (raw)      : 100 mAAPL
#   balanceOfUI (株数換算)  : 100 株相当

# USD 評価額（$200 × 100 = $20,000）
bunx hardhat stock:value --network localhost

# 2:1 の株式分割を予約（デフォルトは 60 秒後に有効化。pending → active の遷移が観察できる）
bunx hardhat stock:split --ratio 2 --network localhost

# 有効化後にもう一度残高を見る — ここが核心
bunx hardhat stock:balance --network localhost
#   balanceOf   (raw)      : 100 mAAPL   ← 変わらない！
#   uiMultiplier           : 2x
#   balanceOfUI (株数換算)  : 200 株相当  ← 株数だけ 2 倍

# USD 評価額は分割前と同じ $20,000 のまま。
# 実世界では 1 株価格が半分になり multiplier が 2 倍になるので、
# 「multiplier 織り込み済みのフィード価格」は変わらないため。
# ここで multiplier を自分で掛けると評価額が 2 倍に壊れる（二重適用）。
bunx hardhat stock:value --network localhost
```

その他の実験:

```shell
# 発行体（owner）としてミント — Authorized Participant の subscribe の模擬
bunx hardhat stock:mint --amount 50 --network localhost

# フィード価格を更新（Chainlink ノードの役）
bunx hardhat stock:set-price --price 205.50 --network localhost

# コーポレートアクション中のオラクル停止を模擬 → stock:value が revert する
bunx hardhat stock:set-price --paused true --network localhost
bunx hardhat stock:value --network localhost   # → "StockViewer: oracle paused"
bunx hardhat stock:set-price --paused false --network localhost
```

## ウォークスルー 2: メインネットの実トークンを見る

秘密鍵もガスも不要（公開 RPC への read-only 照会）:

```shell
bunx hardhat stock:live AAPL
bunx hardhat stock:live TSLA --holder 0x...   # 特定アドレスの残高も表示
```

対応ティッカーは `tasks/lib/stock-addresses.ts` を参照（AAPL, TSLA, NVDA, SPY など 25 銘柄）。Chainlink フィードのアドレスは Chainlink が管理しているためハードコードしていない — 価格も見たい場合は [Chainlink の price feeds ページ](https://docs.chain.link/data-feeds/price-feeds/addresses)で調べて `--feed 0x...` で渡す。

## ウォークスルー 3: テストネットへデプロイ + 検証

`.env` を用意（`.env.example` 参照。テストネット ETH は Sepolia から canonical bridge で入手）:

```shell
bun run deploy:stock   # → chainId 46630 へデプロイ

# Blockscout でコントラクト検証（API キー不要）
bunx hardhat verify --network robinhoodTestnet <StockTokenアドレス> "Mock Apple Stock Token" "mAAPL"
```

デプロイ後は同じタスクが `--network robinhoodTestnet` で使える（アドレスは `ignition/deployments/chain-46630/deployed_addresses.json` から自動解決される）。

## テストネットでの実行結果

```bash
Stock Token @ 0xE47EBb7a4F13152b485886c1d74Ba1E58a8E4E4A (chainId 46630)
  name / symbol     : Mock Apple Stock Token (mAAPL)
  decimals          : 18
  owner (発行体役)   : 0xe6AA1B60c4EC760668dB3C06d7A894c5Fd39D0aa
  totalSupply (raw) : 100 mAAPL
  totalSupplyUI     : 100 株相当
  uiMultiplier      : 1x
  newUIMultiplier   : 0x (予約値)
  effectiveAt       : (なし)
```

```bash
mAAPL balance of 0xe6aa1b60c4ec760668db3c06d7a894c5fd39d0aa
  balanceOf   (raw)      : 100 mAAPL   ← 分割・配当でも変化しない
  uiMultiplier           : 1x
  balanceOfUI (株数換算)  : 100 株相当   ← raw × multiplier
```


## テスト

```shell
bunx hardhat test solidity
```

`contracts/StockToken.t.sol` が仕組みの仕様書を兼ねている。特に:

- `test_SplitDoublesMultiplierButRawBalanceIsConstant` — 分割で raw が変わらないこと
- `test_SplitDoesNotChangeUsdValue` — multiplier 二重適用禁止の理由
- `test_RevertWhen_PriceIsStale` / `test_RevertWhen_OraclePaused` — 消費側の防御

## 実物との違い（注意）

- 実物の発行体実装は非公開であり、このモックは **ERC-8056 の公開インターフェースを教材として再現したもの**。内部実装は実物と異なる可能性がある。
- 実運用の価格利用では、ここで実装した staleness / `oraclePaused` チェックに加えて **L2 Sequencer Uptime Feed の確認**が必要（Chainlink on Arbitrum の定石）。
- Stock Token は米国で利用禁止・複数国で制限あり。実チェーンで Stock Token を扱うプロダクトを作る場合はコンプライアンス設計が必須。
