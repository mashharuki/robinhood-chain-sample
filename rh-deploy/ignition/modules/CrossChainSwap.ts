import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * クロスチェーンswapサンプルのローカルウォークスルー用デプロイモジュール。
 *
 * デプロイされるもの:
 * - CCIPLocalSimulator : ソース/宛先両方の CCIP Router・CCIP-BnM（USDC 役）を単一 EVM 内に模擬
 * - StockToken         : このサンプル専用の mAAPL（払出プール）
 * - MockPriceFeed      : Chainlink フィードのモック（8 decimals、デフォルト $200.00）
 * - StockSwapSender    : ソースチェーン役。決済トークン+購入指示を送信
 * - StockSwapReceiver  : Robinhood Chain 役。フィード価格で mAAPL を払い出す
 *
 * Sender→Receiver の allowlist を設定し、Receiver のプールに初期 mAAPL をミントするところまで行う。
 * 実網には CCIPLocalSimulator が存在しないため、このモジュールは学習用ローカルネットワーク専用。
 * 実網移行時は sourceRouter_/destinationRouter_ の代わりに Chainlink docs 記載の実 Router アドレスを
 * コンストラクタに渡すだけで済む設計（詳細は docs/crosschain-swap-learning.md）。
 *
 * 実行例:
 *   bunx hardhat ignition deploy ./ignition/modules/CrossChainSwap.ts --network localhost
 */
export default buildModule("CrossChainSwapModule", (m) => {
  const name = m.getParameter("name", "Mock Apple Stock Token");
  const symbol = m.getParameter("symbol", "mAAPL");
  const initialPrice = m.getParameter("initialPrice", 200_00000000n); // $200.00 (8 decimals)
  const poolSupply = m.getParameter("poolSupply", 1_000n * 10n ** 18n); // 払出プール 1000 mAAPL
  const maxStaleness = m.getParameter("maxStaleness", 259_200n); // 3日（24/5フィードの週末を跨げる窓）

  const simulator = m.contract("CCIPLocalSimulator");
  const chainSelector = m.staticCall(simulator, "configuration", [], "chainSelector_", { id: "chainSelector" });
  const sourceRouter = m.staticCall(simulator, "configuration", [], "sourceRouter_", { id: "sourceRouter" });
  const destinationRouter = m.staticCall(simulator, "configuration", [], "destinationRouter_", {
    id: "destinationRouter",
  });
  const ccipBnM = m.staticCall(simulator, "configuration", [], "ccipBnM_", { id: "ccipBnM" });

  const stockToken = m.contract("StockToken", [name, symbol]);
  const priceFeed = m.contract("MockPriceFeed", [initialPrice]);

  const sender = m.contract("StockSwapSender", [sourceRouter, ccipBnM]);
  const receiver = m.contract("StockSwapReceiver", [
    destinationRouter,
    stockToken,
    ccipBnM,
    priceFeed,
    maxStaleness,
  ]);

  m.call(sender, "allowlistDestination", [chainSelector, receiver, true]);
  m.call(receiver, "allowlistSource", [chainSelector, sender, true]);
  m.call(stockToken, "mint", [receiver, poolSupply]);

  return { simulator, stockToken, priceFeed, sender, receiver };
});
