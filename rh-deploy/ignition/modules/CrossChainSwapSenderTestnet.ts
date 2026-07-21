import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * クロスチェーンswapサンプルのソース側（Ethereum Sepolia）実デプロイモジュール。
 *
 * StockSwapReceiver を先に `CrossChainSwapReceiverTestnet.ts` で Robinhood Chain Testnet へ
 * デプロイしてから実行すること。receiver アドレスはこのモジュールの必須パラメータ
 * （デフォルト値なし）— ignition/deployments/chain-46630/deployed_addresses.json の
 * CrossChainSwapReceiverTestnetModule#StockSwapReceiver を確認して渡す。
 *
 * デプロイと同時に、宛先(Robinhood Chain Testnet)を allowlistDestination で許可する。
 * 逆方向（receiver.allowlistSource）は別チェーンの操作になるため、デプロイ後に
 * `bunx hardhat swap:allowlist-source --network robinhoodTestnet` を実行すること。
 *
 * 実行例:
 *   bunx hardhat ignition deploy ./ignition/modules/CrossChainSwapSenderTestnet.ts \
 *     --network sepolia \
 *     --parameters '{"CrossChainSwapSenderTestnetModule":{"receiver":"0x..."}}'
 */
export default buildModule("CrossChainSwapSenderTestnetModule", (m) => {
  // Ethereum Sepolia の実 Router / CCIP-BnM（tasks/lib/ccip-addresses.ts と同じ値）。
  // https://docs.chain.link/ccip/directory/testnet/chain/ethereum-sepolia
  const router = m.getParameter("router", "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59");
  const ccipBnM = m.getParameter("ccipBnM", "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05");
  // Robinhood Chain Testnet の CCIP chain selector（tasks/lib/ccip-addresses.ts と同じ値）。
  const destinationChainSelector = m.getParameter("destinationChainSelector", 2_032_988_798_112_970_440n);
  // 必須: CrossChainSwapReceiverTestnetModule#StockSwapReceiver のアドレス
  const receiver = m.getParameter<`0x${string}`>("receiver");

  const sender = m.contract("StockSwapSender", [router, ccipBnM]);

  m.call(sender, "allowlistDestination", [destinationChainSelector, receiver, true]);

  return { sender };
});
