import { parseUnits } from "viem";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtUsd8, resolveDeployed } from "./lib/helpers.js";

interface Args {
  feed: string;
  price: string;
  paused: string;
}

/**
 * モックフィードを操作する（Chainlink ノード群の役を演じる）。
 * --price 205.50       価格を更新（USD）
 * --paused true|false  コーポレートアクション中のオラクル停止を模擬
 */
export default async function stockSetPrice(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const address =
    (args.feed as `0x${string}`) || (await resolveDeployed(hre.config.paths.root, chainId, "MockPriceFeed"));
  const feed = await viem.getContractAt("MockPriceFeed", address);

  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("フィード更新には owner のウォレットが必要です（PRIVATE_KEY を設定してください）");

  if (!args.price && !args.paused) {
    throw new Error("--price か --paused のどちらかを指定してください");
  }

  if (args.price) {
    const answer = parseUnits(args.price, 8);
    const hash = await feed.write.setAnswer([answer]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`price updated → ${fmtUsd8(answer)} (tx: ${hash})`);
  }

  if (args.paused) {
    if (args.paused !== "true" && args.paused !== "false") {
      throw new Error(`--paused は true か false で指定してください（受け取った値: ${args.paused}）`);
    }
    const paused = args.paused === "true";
    const hash = await feed.write.setOraclePaused([paused]);
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`oraclePaused → ${paused} (tx: ${hash})`);
  }
}
