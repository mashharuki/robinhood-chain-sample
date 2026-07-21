/**
 * クロスチェーンswapサンプルの実テストネット向け CCIP 定数。
 *
 * 出典: https://docs.chain.link/ccip/directory/testnet/chain/robinhood-testnet
 *       https://docs.chain.link/ccip/directory/testnet/chain/ethereum-sepolia
 * CCIP-BnM アドレスは各チェーンの TokenAdminRegistry.getPool() が非ゼロを返すことを
 * 実際に on-chain で確認済み（同名の偽トークンが複数出回っているため、名前だけでは信用しない）。
 *
 * Robinhood Chain 本番(mainnet)の Router 等はまだ非公開のため、対応するエントリはない
 * （docs/crosschain-swap-learning.md の「スコープ外」を参照）。
 */

export interface CcipNetworkConfig {
  /** このチェーン自身の CCIP chain selector */
  chainSelector: bigint;
  /** このチェーンの CCIP Router */
  router: `0x${string}`;
  /** このチェーンで CCIP 越しに送受信できる決済トークン（CCIP-BnM。"USDC 役"） */
  ccipBnM: `0x${string}`;
  /** クロスチェーンswapサンプルの相手側チェーンの chainId */
  peerChainId: number;
  /** このチェーンにデプロイする ignition モジュール名 */
  moduleName: string;
  /** 相手側チェーンにデプロイされている ignition モジュール名 */
  peerModuleName: string;
}

const SEPOLIA_CHAIN_ID = 11_155_111;
const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

export const CCIP_TESTNET_CONFIG: Record<number, CcipNetworkConfig> = {
  [SEPOLIA_CHAIN_ID]: {
    // ソース側（StockSwapSender をデプロイ）
    chainSelector: 16_015_286_601_757_825_753n,
    router: "0x0BF3dE8c5D3e8A2B34D2BEeB17ABfCeBaf363A59",
    ccipBnM: "0xFd57b4ddBf88a4e07fF4e34C487b99af2Fe82a05",
    peerChainId: ROBINHOOD_TESTNET_CHAIN_ID,
    moduleName: "CrossChainSwapSenderTestnetModule",
    peerModuleName: "CrossChainSwapReceiverTestnetModule",
  },
  [ROBINHOOD_TESTNET_CHAIN_ID]: {
    // 宛先側（StockSwapReceiver をデプロイ）
    chainSelector: 2_032_988_798_112_970_440n,
    router: "0x30D197C6F5bE050D5525dD94d01760FaCdB67e7C",
    ccipBnM: "0x2ad603bBe7DfffE7A50740F28d4fFf89a0Db7167",
    peerChainId: SEPOLIA_CHAIN_ID,
    moduleName: "CrossChainSwapReceiverTestnetModule",
    peerModuleName: "CrossChainSwapSenderTestnetModule",
  },
};
