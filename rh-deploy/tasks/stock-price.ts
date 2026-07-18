import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtTimestamp, fmtUsd8, resolveDeployed } from "./lib/helpers.js";

interface Args {
  feed: string;
}

/** モックフィードの現在価格・更新時刻・oraclePaused を表示する */
export default async function stockPrice(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const address =
    (args.feed as `0x${string}`) || (await resolveDeployed(hre.config.paths.root, chainId, "MockPriceFeed"));
  const feed = await viem.getContractAt("MockPriceFeed", address);

  const [[roundId, answer, , updatedAt], decimals, paused] = await Promise.all([
    feed.read.latestRoundData(),
    feed.read.decimals(),
    feed.read.oraclePaused(),
  ]);

  console.log(`PriceFeed @ ${address}`);
  console.log(`  price        : ${fmtUsd8(answer)} (raw: ${answer}, ${decimals} decimals)`);
  console.log(`  roundId      : ${roundId}`);
  console.log(`  updatedAt    : ${fmtTimestamp(updatedAt)}`);
  console.log(`  oraclePaused : ${paused}${paused ? " ← コーポレートアクション中は価格を信用しないこと" : ""}`);
  console.log(`  ※ フィード価格には uiMultiplier が織り込み済み（= 1 トークンの価格）`);
}
