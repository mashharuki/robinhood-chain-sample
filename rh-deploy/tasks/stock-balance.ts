import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtMultiplier, fmtToken, resolveDeployed } from "./lib/helpers.js";

interface Args {
  token: string;
  holder: string;
}

/**
 * raw balance と UI 換算残高（株数換算）を並べて表示する。
 * 株式分割の前後でこのタスクを実行すると「raw は不変・株数だけ変わる」ことが一目で分かる。
 */
export default async function stockBalance(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const address =
    (args.token as `0x${string}`) || (await resolveDeployed(hre.config.paths.root, chainId, "StockToken"));
  const token = await viem.getContractAt("StockToken", address);

  let holder = args.holder as `0x${string}`;
  if (!holder) {
    const [wallet] = await viem.getWalletClients();
    if (!wallet) throw new Error("--holder を指定するか、PRIVATE_KEY を設定してください");
    holder = wallet.account.address;
  }

  const [symbol, raw, ui, multiplier] = await Promise.all([
    token.read.symbol(),
    token.read.balanceOf([holder]),
    token.read.balanceOfUI([holder]),
    token.read.uiMultiplier(),
  ]);

  console.log(`${symbol} balance of ${holder}`);
  console.log(`  balanceOf   (raw)      : ${fmtToken(raw)} ${symbol}   ← 分割・配当でも変化しない`);
  console.log(`  uiMultiplier           : ${fmtMultiplier(multiplier)}`);
  console.log(`  balanceOfUI (株数換算)  : ${fmtToken(ui)} 株相当   ← raw × multiplier`);
}
