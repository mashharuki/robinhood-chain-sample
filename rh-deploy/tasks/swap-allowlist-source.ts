import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { CCIP_TESTNET_CONFIG } from "./lib/ccip-addresses.js";
import { resolveDeployed } from "./lib/helpers.js";

interface Args {
  receiver: string;
  sender: string;
}

/**
 * 実テストネット専用のセットアップタスク。StockSwapReceiver（Robinhood Chain Testnet）に
 * StockSwapSender（Ethereum Sepolia）からの受信を許可する。
 * ソース側・宛先側が別チェーンにデプロイされる実網では、1 回の ignition デプロイで
 * 両方の allowlist を設定できない（ローカルの CrossChainSwap.ts は単一 EVM なので可能）ため、
 * 別チェーンへのデプロイ後にこのタスクで手動で繋ぐ。
 * 実行は必ず --network robinhoodTestnet で行うこと。
 */
export default async function swapAllowlistSource(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const root = hre.config.paths.root;

  const config = CCIP_TESTNET_CONFIG[chainId];
  if (config === undefined || config.moduleName !== "CrossChainSwapReceiverTestnetModule") {
    throw new Error(
      "swap:allowlist-source は Robinhood Chain Testnet の StockSwapReceiver に対する操作です。" +
        "--network robinhoodTestnet を指定してください。",
    );
  }
  const peerConfig = CCIP_TESTNET_CONFIG[config.peerChainId];

  const receiverAddress =
    (args.receiver as `0x${string}`) || (await resolveDeployed(root, chainId, "StockSwapReceiver", config.moduleName));
  const senderAddress =
    (args.sender as `0x${string}`) ||
    (await resolveDeployed(root, config.peerChainId, "StockSwapSender", config.peerModuleName));

  const receiver = await viem.getContractAt("StockSwapReceiver", receiverAddress);

  const hash = await receiver.write.allowlistSource([peerConfig.chainSelector, senderAddress, true]);
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`allowlistSource 設定完了 (tx: ${hash})`);
  console.log(`  receiver (robinhoodTestnet) : ${receiverAddress}`);
  console.log(`  許可した送信元 (sepolia)     : chainSelector ${peerConfig.chainSelector} / sender ${senderAddress}`);
}
