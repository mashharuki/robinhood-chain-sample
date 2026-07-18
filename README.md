# robinhood-chain-sample

Robinhood Chainを調査・検証するためのサンプルリポジトリ

## テストネットにデプロイしたコントラクト

[0xfDFaDffE28d17935A48ffB1Ab3076dBc8CadE623](https://explorer.testnet.chain.robinhood.com/address/0xfDFaDffE28d17935A48ffB1Ab3076dBc8CadE623?tab=index)

```bash
Deployed Addresses

CounterModule#Counter - 0xfDFaDffE28d17935A48ffB1Ab3076dBc8CadE623
StockTokenModule#MockPriceFeed - 0x77D775cCC1434D82D8d74e790C25c91FFC8e6108
StockTokenModule#StockToken - 0xE47EBb7a4F13152b485886c1d74Ba1E58a8E4E4A
StockTokenModule#StockViewer - 0xAAF6A7A22f2bcd602e280A4b42fF73FE0A4e7DB1
```

```bash
mAAPL holdings of 0xe6aa1b60c4ec760668db3c06d7a894c5fd39d0aa
  USD 評価額  : $20000   (balanceOf × price / 1e8)
  株数換算    : 100 株相当 (balanceOfUI)
  ※ 分割後もフィード価格が同じなら USD 評価額は不変（multiplier 二重適用禁止の理由）
```

```bash
scheduled 2:1 split (tx: 0x6198e0e2ddac5385e2daa4f1cf4ec41bbb58f956423f3ef322a73f0423cafe03)
  uiMultiplier    : 1x → 2x
  effectiveAt     : 1784390464 (2026-07-18T16:01:04.000Z) (60 秒後)
  有効化後に stock:balance を実行すると raw 不変・株数 2 倍が確認できます
```

適用後

```bash
mAAPL balance of 0xe6aa1b60c4ec760668db3c06d7a894c5fd39d0aa
  balanceOf   (raw)      : 100 mAAPL   ← 分割・配当でも変化しない
  uiMultiplier           : 2x
  balanceOfUI (株数換算)  : 200 株相当   ← raw × multiplier
```

```bash
mAAPL holdings of 0xe6aa1b60c4ec760668db3c06d7a894c5fd39d0aa
  USD 評価額  : $20000   (balanceOf × price / 1e8)
  株数換算    : 200 株相当 (balanceOfUI)
  ※ 分割後もフィード価格が同じなら USD 評価額は不変（multiplier 二重適用禁止の理由）
```

```bash
AAPL — 実 Stock Token @ 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 (Robinhood Chain mainnet)
  name / symbol     : Apple • Robinhood Token (AAPL)
  decimals          : 18
  totalSupply (raw) : 2407.375
  totalSupplyUI     : 2407.375 株相当
  uiMultiplier      : 1x
  newUIMultiplier   : 1x / effectiveAt (なし)
```


## 参考文献
- [開発者向けドキュメント](https://docs.robinhood.com/chain/)
- [テストネット faucet サイト](https://faucet.testnet.chain.robinhood.com/?address=0xe6AA1B60c4EC760668dB3C06d7A894c5Fd39D0aa)
- [Building with Stock Tokens](https://docs.robinhood.com/chain/building-with-stock-tokens)
- [テストネット Explorer](https://explorer.testnet.chain.robinhood.com/)
- [Robinhood 本体のドキュメント](https://robinhood.com/us/en/?wpsrc=Organic+Search&wpsn=www.google.com)