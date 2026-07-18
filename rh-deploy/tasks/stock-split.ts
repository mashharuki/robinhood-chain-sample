import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtMultiplier, fmtTimestamp, resolveDeployed } from "./lib/helpers.js";

interface Args {
  token: string;
  ratio: number;
  delay: number;
}

/**
 * 株式分割をシミュレートする: 現在の uiMultiplier × ratio を予約更新する。
 * 例: --ratio 2 → 2:1 分割（1株が2株に）。raw balance は変わらず、
 * balanceOfUI（株数換算）だけが ratio 倍になる。
 * 実世界ではこのとき 1 株価格が 1/ratio になるため、フィード価格（= multiplier
 * 織り込み済みの 1 トークン価格）は変わらない。
 */
export default async function stockSplit(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const address =
    (args.token as `0x${string}`) || (await resolveDeployed(hre.config.paths.root, chainId, "StockToken"));
  const token = await viem.getContractAt("StockToken", address);

  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("分割の予約には owner のウォレットが必要です（PRIVATE_KEY を設定してください）");

  if (args.ratio <= 0) throw new Error("--ratio は正の数で指定してください");
  const ratioScaled = BigInt(Math.round(args.ratio * 1_000_000)); // 小数比率（1.5 等）対応

  const current = await token.read.uiMultiplier();
  const newMultiplier = (current * ratioScaled) / 1_000_000n;

  // アイドル状態のローカルノードでは最新ブロックの timestamp が実時刻より過去なので、
  // チェーン時刻と実時刻の遅い方を基準にする（コントラクトは effectiveAt >= block.timestamp を要求）
  const latestBlock = await publicClient.getBlock();
  const wallClock = BigInt(Math.floor(Date.now() / 1000));
  const base = latestBlock.timestamp > wallClock ? latestBlock.timestamp : wallClock;
  const effectiveAt = base + BigInt(args.delay);

  const hash = await token.write.scheduleUIMultiplierUpdate([newMultiplier, effectiveAt]);
  await publicClient.waitForTransactionReceipt({ hash });

  console.log(`scheduled ${args.ratio}:1 split (tx: ${hash})`);
  console.log(`  uiMultiplier    : ${fmtMultiplier(current)} → ${fmtMultiplier(newMultiplier)}`);
  console.log(`  effectiveAt     : ${fmtTimestamp(effectiveAt)} (${args.delay} 秒後)`);
  console.log(`  有効化後に stock:balance を実行すると raw 不変・株数 ${args.ratio} 倍が確認できます`);
}
