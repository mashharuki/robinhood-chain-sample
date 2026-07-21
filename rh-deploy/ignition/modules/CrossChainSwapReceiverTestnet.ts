import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * クロスチェーンswapサンプルの宛先側（Robinhood Chain Testnet）実デプロイモジュール。
 *
 * デプロイされるもの:
 * - StockToken     : このサンプル専用の mAAPL（払出プール）
 * - MockPriceFeed  : Chainlink フィードのモック（8 decimals、デフォルト $200.00）
 * - StockSwapReceiver : 実 CCIP Router 宛に構築（router パラメータのデフォルトは
 *                        CCIP ディレクトリで確認済みの Robinhood Chain Testnet の実アドレス。
 *                        tasks/lib/ccip-addresses.ts 参照）
 *
 * ソース側（StockSwapSender）は別チェーンにデプロイするため、このモジュールは
 * allowlistSource を呼ばない。CrossChainSwapSenderTestnet デプロイ後に
 * `bunx hardhat swap:allowlist-source --network robinhoodTestnet` を実行すること。
 *
 * 実行例:
 *   bunx hardhat ignition deploy ./ignition/modules/CrossChainSwapReceiverTestnet.ts --network robinhoodTestnet
 */
export default buildModule("CrossChainSwapReceiverTestnetModule", (m) => {
  const name = m.getParameter("name", "Mock Apple Stock Token");
  const symbol = m.getParameter("symbol", "mAAPL");
  const initialPrice = m.getParameter("initialPrice", 200_00000000n); // $200.00 (8 decimals)
  const poolSupply = m.getParameter("poolSupply", 1_000n * 10n ** 18n); // 払出プール 1000 mAAPL
  const maxStaleness = m.getParameter("maxStaleness", 259_200n); // 3日（24/5フィードの週末を跨げる窓）

  // Robinhood Chain Testnet の実 Router / CCIP-BnM（tasks/lib/ccip-addresses.ts と同じ値）。
  // https://docs.chain.link/ccip/directory/testnet/chain/robinhood-testnet
  const router = m.getParameter("router", "0x30D197C6F5bE050D5525dD94d01760FaCdB67e7C");
  const ccipBnM = m.getParameter("ccipBnM", "0x2ad603bBe7DfffE7A50740F28d4fFf89a0Db7167");

  const stockToken = m.contract("StockToken", [name, symbol]);
  const priceFeed = m.contract("MockPriceFeed", [initialPrice]);

  const receiver = m.contract("StockSwapReceiver", [router, stockToken, ccipBnM, priceFeed, maxStaleness]);

  m.call(stockToken, "mint", [receiver, poolSupply]);

  return { stockToken, priceFeed, receiver };
});
