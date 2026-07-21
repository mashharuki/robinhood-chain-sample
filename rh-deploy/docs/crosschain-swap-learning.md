# クロスチェーンswap学習キット（CCIP準拠）

「他チェーンの資金で Robinhood Chain 上の Stock Token を買う」クロスチェーンswapのサンプル。[Stock Token 学習キット](./stocktoken-learning.md)の mAAPL / MockPriceFeed を土台に、Chainlink CCIP の **programmable token transfer**（トークン+データ同時送信）パターンで購入注文を送る。

## クロスチェーンswapとは — 5 つの要点

1. **programmable token transfer**。決済トークン（このサンプルでは CCIP-BnM を「USDC 役」として使う）と購入指示（`abi.encode(recipient, minAmountOut)`）を、CCIP の `Client.EVM2AnyMessage` の `tokenAmounts` + `data` に同時に載せて送る。
2. **defensive receiver パターン**。宛先の `_ccipReceive` は Router 以外・未許可ソースからの呼び出しには revert するが、価格検証やスリッページなどの**ビジネス検証の失敗では revert しない**。revert するとトークンごとメッセージが Router 側で stuck するため、失敗時は決済トークンを `recipient` 宛の escrow（`refunds`）に退避し、`withdrawFailedSwap()` で回収可能にする。
3. **フィード価格には uiMultiplier が織り込み済み**。払出数量 = `amountIn(18dec) × 1e8 / price(8dec)` のみで、multiplier を重ねて適用してはならない — [Stock Token 学習キット](./stocktoken-learning.md)と同じ最重要の落とし穴。
4. **完全ローカル・オフラインで検証する**。`@chainlink/local` の `CCIPLocalSimulator` が単一 EVM 内にソース/宛先両方の Router を模擬するため、2 チェーン起動なしで送信 → 配送 → 払出の全パイプラインを 1 トランザクションで検証できる。
5. **Router を差し替えるだけで実網に移行できる設計**。コンストラクタで Router アドレスを受け取るだけの構成にしてあるため、ローカルの `CCIPLocalSimulator` の代わりに [CCIP ディレクトリ](https://docs.chain.link/ccip/directory/testnet)の実 Router を渡せば実テストネットでも動く（下記「実テストネットで購入を体験する」）。Robinhood Chain **mainnet** の Router はまだ非公開のため、実網デプロイは testnet までがスコープ。

## このキットの構成

| ファイル | 役割 |
|---|---|
| `contracts/crosschain/StockSwapSender.sol` | ソース側。決済トークンを受け取り `ccipSend` で送信。宛先の allowlist（owner管理）、手数料はnative払い |
| `contracts/crosschain/StockSwapReceiver.sol` | `CCIPReceiver`継承。allowlist検証 → フィード価格取得（staleness/`oraclePaused`チェック）→ mAAPL払出。失敗時はescrow退避 |
| `contracts/crosschain/CCIPLocalSimulatorImport.sol` | TS/Ignitionから`CCIPLocalSimulator`をデプロイできるようartifactを生成させるためのimport専用ファイル |
| `contracts/crosschain/*.t.sol` | forge-std + CCIPLocalSimulatorによるSolidityテスト（主力。アクセス制御・価格計算・escrowを網羅） |
| `test/CrossChainSwap.ts` | node:test + viemによるTS E2Eテスト（ユーザ視点のフロー1本） |
| `ignition/modules/CrossChainSwap.ts` | ローカルウォークスルー用デプロイモジュール（simulator + StockToken + MockPriceFeed + Sender/Receiver、allowlist設定、初期mAAPLミントまで一括） |
| `tasks/swap-buy.ts` / `tasks/swap-info.ts` | ローカルシミュレータ向けCLI。`swap:buy`=購入実行（残高不足ならdrip()で自動補充）、`swap:info`=プール残高・escrow・allowlist・フィード状態の表示 |
| `ignition/modules/CrossChainSwapReceiverTestnet.ts` / `CrossChainSwapSenderTestnet.ts` | 実テストネット（Ethereum Sepolia → Robinhood Chain Testnet）向けデプロイモジュール。実 Router / 実 CCIP-BnM アドレスを使う |
| `tasks/lib/ccip-addresses.ts` | 実テストネットの CCIP chain selector・Router・CCIP-BnM アドレス（[CCIP ディレクトリ](https://docs.chain.link/ccip/directory/testnet)から取得し、`TokenAdminRegistry.getPool()`が非ゼロを返すことをon-chainで確認済み） |
| `tasks/swap-buy-testnet.ts` / `tasks/swap-info-testnet.ts` / `tasks/swap-allowlist-source.ts` | 実テストネット向けCLI。`swap:buy-testnet`=本物のCCIPメッセージ送信（`Router.getFee`で実手数料を見積もる）、`swap:info-testnet`=Sepolia側・Robinhood Chain Testnet側を横断して状態表示、`swap:allowlist-source`=別チェーンにデプロイしたSenderからの受信をReceiver側で許可するセットアップ |

## ウォークスルー: ローカルで購入を体験する

ターミナル A でローカルノードを起動:

```shell
bunx hardhat node
```

ターミナル B で:

```shell
# デプロイ（simulator + mAAPL + MockPriceFeed + Sender/Receiver、プールに mAAPL 1000 枚をミント）
bunx hardhat ignition deploy ./ignition/modules/CrossChainSwap.ts --network localhost

# 状態を確認（allowlist・プール残高・フィード価格）
bunx hardhat swap:info --network localhost

# $200 で 100 CCIP-BnM を送金 → 0.5 mAAPL を購入
# 決済トークン残高が足りなければ drip()（1回1トークン固定のフォーセット）で自動補充される
bunx hardhat swap:buy --amount 100 --min-amount-out 0.4 --network localhost
#   recipient の mAAPL 残高: 0.5 mAAPL

# もう一度状態を見る — プールが減り、売上（回収可能額）が増えている
bunx hardhat swap:info --network localhost
#   mAAPL 払出プール残高    : 999.5 mAAPL
#   CCIP-BnM 売上（回収可能額）: 100 CCIP-BnM
```

### スリッページ失敗 → escrow退避を体験する

`minAmountOut` を実際の払出数量より大きくすると、swap は revert せずに escrow へ退避する（defensive receiver パターンの核心）:

```shell
bunx hardhat swap:buy --amount 100 --min-amount-out 999 --network localhost
#   ⚠ swap が約定しませんでした — CCIP-BnM 100 が escrow に退避されています。

bunx hardhat swap:info --network localhost
#   escrow 合計 (totalRefunds): 100 CCIP-BnM
```

escrow の回収（`withdrawFailedSwap()`）には専用タスクを用意していない。`bunx hardhat console --network localhost` などから直接呼び出す:

```ts
const receiver = await viem.getContractAt("StockSwapReceiver", "0x...");
await receiver.write.withdrawFailedSwap({ account: /* recipient のアカウント */ });
```

### フィード価格の変化で払出数量が自動的に変わることを確認する

Receiver の払出計算は `amountIn × 1e8 / price` の**フィード価格だけ**を見ており、`uiMultiplier`（分割の株数換算）は一切参照しない。分割で株価が実際に半分になった状況は、フィード価格の更新だけで再現できる（`stock:set-price` は `CrossChainSwapModule#MockPriceFeed` を明示的に指定する。デフォルトの解決先は `StockTokenModule` 側のため）:

```shell
FEED=$(jq -r '."CrossChainSwapModule#MockPriceFeed"' ignition/deployments/chain-31337/deployed_addresses.json)
bunx hardhat stock:set-price --feed $FEED --price 100.00 --network localhost   # $200 → $100（2:1分割相当）
bunx hardhat swap:buy --amount 100 --network localhost
#   recipient の mAAPL 残高: 1.0 mAAPL   ← 価格半減前の 2 倍
```

## テスト

```shell
bunx hardhat test solidity   # StockSwap*.t.sol — アクセス制御・価格計算・escrowの網羅的な検証
bunx hardhat test nodejs     # test/CrossChainSwap.ts — ユーザ視点のE2Eフロー1本
```

`StockSwapE2E.t.sol` が送信→配送→払出のフルパイプラインを、`StockSwapReceiver.t.sol` / `StockSwapSender.t.sol` がアクセス制御・スリッページ・staleness・`oraclePaused`などの防御を個別に検証している。

## 実テストネットで購入を体験する（Ethereum Sepolia → Robinhood Chain Testnet）

ローカルの `CCIPLocalSimulator` は単一 EVM 内で送信〜配送〜払出を同期的に模擬するが、実網では Router 経由の本物の CCIP メッセージが 2 つの別チェーンをまたいで**非同期**に配送される（数分かかる）。`tasks/lib/ccip-addresses.ts` に、[CCIP ディレクトリ](https://docs.chain.link/ccip/directory/testnet)で確認し、かつ `TokenAdminRegistry.getPool()` が非ゼロを返すことを on-chain で確認済みの実アドレスをまとめてある。

準備:

```shell
cp .env.example .env
# PRIVATE_KEY に Sepolia ETH を持つウォレットの秘密鍵を設定
# （Sepolia ETH は https://sepoliafaucet.com などで入手）
```

デプロイは 2 段階（宛先→送信元の順）。宛先を先に確定させないと、送信元側の `allowlistDestination` に渡す receiver アドレスが決まらないため:

```shell
# 1. 宛先（Robinhood Chain Testnet）: mAAPL + MockPriceFeed + StockSwapReceiver
bunx hardhat ignition deploy ./ignition/modules/CrossChainSwapReceiverTestnet.ts --network robinhoodTestnet
# → CrossChainSwapReceiverTestnetModule#StockSwapReceiver のアドレスをメモ

# 2. 送信元（Ethereum Sepolia）: StockSwapSender（宛先を allowlistDestination まで一括で設定）
bunx hardhat ignition deploy ./ignition/modules/CrossChainSwapSenderTestnet.ts \
  --network sepolia \
  --parameters '{"CrossChainSwapSenderTestnetModule":{"receiver":"0x<手順1のReceiverアドレス>"}}'

# 3. 逆方向のallowlistは別チェーンの操作になるためignitionでは一括にできない。
#    宛先側でSenderからの受信を許可する（必ず --network robinhoodTestnet）
bunx hardhat swap:allowlist-source --network robinhoodTestnet

# 状態確認（Sepolia側・Robinhood Chain Testnet側を横断して表示。--network は無視して両方に接続する）
bunx hardhat swap:info-testnet

# 購入（Sepolia上のCCIP-BnMをdrip()で補充→承認→ccipSend。実配送は数分かかる）
bunx hardhat swap:buy-testnet --amount 5 --min-amount-out 0.02
#   CCIP messageId: 0x...
#   配送状況: https://ccip.chain.link/msg/0x...

# 数分待ってから再度確認 — mAAPLが払い出されているはず
bunx hardhat swap:info-testnet
```

`swap:buy-testnet` は `Router.getFee` で実際の CCIP 手数料を見積もってから送金する（ローカル版の `swap:buy` のような固定値の当て推量ではない）。`drip()` はテストネット上の実トランザクションなので、`--amount` を大きくすると必要な drip 回数が増えてブロック確定待ちに時間がかかる点に注意（デフォルトは 5）。

## スコープ外・実物との違い

- **Robinhood Chain mainnet へのデプロイ**（CCIP の実 Router アドレスが mainnet 向けにはまだ非公開のため）。判明後は `StockSwapSender` / `StockSwapReceiver` のコンストラクタに渡す Router アドレスを mainnet の実アドレスに差し替えるだけで移行できる設計にしてある（testnet で実証済みの構成と同じ）。
- **売り方向**（mAAPL → 他チェーン）は未実装。
- **CCT**（独自トークンのクロスチェーン対応化）は未使用。決済トークンはローカルシミュレータ/testnetいずれも CCIP-BnM を「USDC 役」として使っている — 独自トークンの CCIP 登録手続きを省いて swap ロジックに集中するため。
- **LINK建て手数料は未対応**。手数料は native 払いのみ。
