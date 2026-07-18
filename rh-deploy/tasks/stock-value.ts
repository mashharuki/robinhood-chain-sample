import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtToken, fmtUsd18, resolveDeployed } from "./lib/helpers.js";

interface Args {
  token: string;
  feed: string;
  viewer: string;
  holder: string;
  staleness: number;
}

/**
 * StockViewer 経由で保有トークンの USD 評価額と株数換算を表示する。
 * 評価式は balanceOf × price / 1e8 のみ — フィード価格に multiplier が
 * 織り込み済みなので、multiplier を自分で掛けると二重適用になる。
 */
export default async function stockValue(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const root = hre.config.paths.root;

  const tokenAddress = (args.token as `0x${string}`) || (await resolveDeployed(root, chainId, "StockToken"));
  const feedAddress = (args.feed as `0x${string}`) || (await resolveDeployed(root, chainId, "MockPriceFeed"));
  const viewerAddress = (args.viewer as `0x${string}`) || (await resolveDeployed(root, chainId, "StockViewer"));

  const token = await viem.getContractAt("StockToken", tokenAddress);
  const viewer = await viem.getContractAt("StockViewer", viewerAddress);

  let holder = args.holder as `0x${string}`;
  if (!holder) {
    const [wallet] = await viem.getWalletClients();
    if (!wallet) throw new Error("--holder を指定するか、PRIVATE_KEY を設定してください");
    holder = wallet.account.address;
  }

  const staleness = BigInt(args.staleness);
  const [symbol, usdValue, shares] = await Promise.all([
    token.read.symbol(),
    viewer.read.holdingValueUsd([tokenAddress, feedAddress, holder, staleness]),
    viewer.read.sharesOf([tokenAddress, holder]),
  ]);

  console.log(`${symbol} holdings of ${holder}`);
  console.log(`  USD 評価額  : ${fmtUsd18(usdValue)}   (balanceOf × price / 1e8)`);
  console.log(`  株数換算    : ${fmtToken(shares)} 株相当 (balanceOfUI)`);
  console.log(`  ※ 分割後もフィード価格が同じなら USD 評価額は不変（multiplier 二重適用禁止の理由）`);
}
