# 設計: CCIP準拠クロスチェーンStock Token購入サンプル

日付: 2026-07-19
ステータス: 承認済み

## 目的

「他チェーンの資金でRobinhood Chain上のStock Tokenを買う」クロスチェーンswapのサンプル実装を、既存のStockToken学習キットに追加する。Chainlink CCIPの **programmable token transfer**(トークン+データ同時送信)パターンに準拠したコントラクトを実装し、`@chainlink/local` の `CCIPLocalSimulator` で完全ローカル・オフラインでE2Eテストする。

## 背景と制約

- 本リポジトリはHardhat 3 + viem + node:test構成の学習キット。ERC-8056対応の `StockToken.sol`(mAAPL)、`MockPriceFeed.sol`(8 decimals・`oraclePaused`付き)、消費側統合パターンの `StockViewer.sol` が既にある。
- Robinhood ChainではCCIPが稼働しているが、公式ドキュメントにRouter等の実アドレスが未公開。よって実網デプロイはスコープ外とし、実CCIP interface準拠のコントラクト+ローカルシミュレータ検証までを本サンプルの範囲とする。
- Stock Tokenの価格フィードにはuiMultiplierが織り込み済み。swap計算でmultiplierを重ねて適用してはならない(このキット最重要の落とし穴)。

## アーキテクチャ

```
[Source Chain: Ethereum役]
  ユーザ ── 決済トークン + abi.encode(recipient, minAmountOut) ──▶ StockSwapSender
                                                                    │ ccipSend (手数料はnative)
                                                                    ▼
                                                          CCIP Router (CCIPLocalSimulator)
                                                                    │ _ccipReceive
[Dest Chain: Robinhood Chain役]                                     ▼
  StockSwapReceiver
   ├─ Router検証 + 許可済みソースチェーン/送信者チェック
   ├─ MockPriceFeed参照 + staleness / oraclePaused チェック(StockViewerと同じ規律)
   ├─ mAAPL払出数量 = 決済額 × 1e8 / feed価格
   └─ 成功: mAAPLをrecipientへ / 失敗: 決済トークンをescrowし引出可能に
```

- 決済トークンはシミュレータ付属の **CCIP-BnM を「USDC役」** として使う。CCIPLocalSimulatorのRouterを通せるのは登録済みトークンのみであり、独自トークンの登録手続きを省いてswapロジックに集中するため。
- CCIPLocalSimulatorは単一EVM内にソース/宛先両方のRouterを模擬する(2プロセス・2チェーン起動は不要)。

## コンポーネント

| ファイル | 役割 |
|---|---|
| `contracts/crosschain/StockSwapSender.sol` | ソース側。ユーザから決済トークンを受け取り、`Client.EVM2AnyMessage`(tokenAmounts + data)を組み立てて`ccipSend`。宛先チェーンselector/receiverのallowlist(owner管理)、ownerによる残余資金回収。手数料はnative払い |
| `contracts/crosschain/StockSwapReceiver.sol` | `CCIPReceiver`継承。`_ccipReceive`で(1) allowlist検証 (2) フィード価格取得+staleness/`oraclePaused`チェック (3) 払出数量計算+`minAmountOut`・プール残高チェック (4) mAAPL transfer。検証失敗時はrevertせず決済トークンをrecipient宛escrowに退避し、`withdrawFailedSwap`で引出可能にする(CCIP公式のdefensive receiverパターン。トークン+データ転送でrevertすると資金回収が困難になるため) |
| `contracts/crosschain/StockSwap.t.sol` | forge-std + CCIPLocalSimulatorによるSolidityテスト(主力) |
| `test/CrossChainSwap.ts` | node:test + viemによるTS E2Eテスト(ユーザ視点のフロー1本) |
| `ignition/modules/CrossChainSwap.ts` | ローカルウォークスルー用: simulator + StockToken + MockPriceFeed + Sender/Receiver をデプロイし、Receiverプールに初期mAAPLをmint |
| `tasks/swap-buy.ts`, `tasks/swap-info.ts` | 既存`stock:*`タスクと同スタイルのCLI。`swap:buy`=購入実行、`swap:info`=プール残高・escrow・許可状態の表示 |
| `docs/crosschain-swap-learning.md` | stocktoken-learning.mdと同形式のウォークスルー文書。スコープ外事項(実網デプロイ、売り方向、CCT)と、実網移行時はコンストラクタのRouterアドレス差し替えのみで済む設計であることを明記 |

## 価格計算

- フィードは8 decimals(USD)。決済トークン(CCIP-BnM、18 decimals)をUSD建て1:1のステーブルコイン相当とみなす。
- `amountOut(18dec) = amountIn(18dec) × 1e8 / price(8dec)`。multiplierは適用しない(フィードに織込み済み)。
- 分割等でフィード価格が変われば払出数量が自動的に変わる(例: 2:1分割→価格半減→枚数2倍)。
- staleness窓はReceiverのコンストラクタ引数で設定可能とする(24/5更新のフィードに固定短時間チェックは不適切、という既存キットの教訓を引き継ぐ)。

## エラーハンドリング方針

- `ccipReceive`のRouter以外からの呼出し → revert(CCIPReceiver標準)。
- 未許可ソースチェーン/送信者 → revert(メッセージ自体を受け付けない)。
- ビジネス検証の失敗(minAmountOut未達・プール不足・oracle停止・stale価格) → revertせずescrow退避 + イベント発行。
- Sender側: 未許可宛先、決済額0 → revert。

## テスト計画

Solidityテスト(`StockSwap.t.sol`):
1. ハッピーパス: 送信→受信→フィード価格通りのmAAPL払出、送り手/受け手残高検証
2. 価格計算: $200で1000送金→5枚。端数が発生する額での切り捨て確認
3. `minAmountOut`未達 → escrow退避・`withdrawFailedSwap`で回収可能
4. プール流動性不足 → 同上
5. `oraclePaused()==true` / stale価格 → 同上(不正価格で約定しない)
6. 2:1株式分割後(feed価格を半分に更新)→ 同一決済額で払出枚数2倍
7. アクセス制御: Router以外からの`ccipReceive`拒否、未許可ソースチェーン/送信者拒否、allowlist管理のonlyOwner

TSテスト(`test/CrossChainSwap.ts`):
- ユーザ視点のE2E 1本(デプロイ→drip→approve→buy→mAAPL受領確認)。

## 依存関係・設定変更

- 追加: `@chainlink/local`、`@chainlink/contracts-ccip`(必要に応じ`@chainlink/contracts`)。バージョンは実装時に`npm view`で最新安定を確認。
- 両パッケージのpragmaを確認し、0.8.28で解決できない場合は`hardhat.config.ts`にコンパイラ設定を追加(実装時に検証)。
- TS/Ignitionからsimulatorをデプロイするため、`contracts/crosschain/`にimport専用の薄い.solファイルを置いてartifactを生成する。

## スコープ外

- 実テストネット/メインネットへのデプロイ(CCIP実アドレス未公開のため。判明後はRouterアドレス差し替えで移行可能な設計とする)
- 売り方向(mAAPL→他チェーン)
- CCT(独自トークンのクロスチェーン対応化)
- LINK建て手数料(native払いのみ)
