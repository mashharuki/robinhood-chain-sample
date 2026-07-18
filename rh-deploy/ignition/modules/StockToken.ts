import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * StockToken 学習キットのデプロイモジュール。
 *
 * デプロイされるもの:
 * - StockToken     : ERC-8056 対応の学習用 Stock Token（デフォルト: mAAPL）
 * - MockPriceFeed  : Chainlink フィードのモック（8 decimals、デフォルト $200.00）
 * - StockViewer    : 正しい評価パターンを実装した read-only コントラクト
 *
 * デプロイヤー = owner = 発行体（Authorized Participant の模擬）として、
 * 初期供給 100 トークンをデプロイヤーにミントする。
 *
 * パラメータ差し替え例:
 *   bunx hardhat ignition deploy ./ignition/modules/StockToken.ts \
 *     --parameters '{"StockTokenModule":{"symbol":"mTSLA","name":"Mock Tesla Stock Token"}}'
 */
export default buildModule("StockTokenModule", (m) => {
  const name = m.getParameter("name", "Mock Apple Stock Token");
  const symbol = m.getParameter("symbol", "mAAPL");
  const initialPrice = m.getParameter("initialPrice", 200_00000000n); // $200.00 (8 decimals)
  const initialSupply = m.getParameter("initialSupply", 100n * 10n ** 18n); // 100 tokens

  const deployer = m.getAccount(0);

  const stockToken = m.contract("StockToken", [name, symbol]);
  const priceFeed = m.contract("MockPriceFeed", [initialPrice]);
  const viewer = m.contract("StockViewer");

  m.call(stockToken, "mint", [deployer, initialSupply]);

  return { stockToken, priceFeed, viewer };
});
