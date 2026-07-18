import { parseUnits } from "viem";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtToken, resolveDeployed } from "./lib/helpers.js";

interface Args {
  token: string;
  to: string;
  amount: string;
}

/**
 * 発行体（owner）としてミントする — Authorized Participant の subscribe の模擬。
 * 実物の Stock Token ではアプリ・ユーザーは決してミントできない点に注意。
 */
export default async function stockMint(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const address =
    (args.token as `0x${string}`) || (await resolveDeployed(hre.config.paths.root, chainId, "StockToken"));
  const token = await viem.getContractAt("StockToken", address);

  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("ミントには owner のウォレットが必要です（PRIVATE_KEY を設定してください）");

  const to = (args.to as `0x${string}`) || wallet.account.address;
  const amount = parseUnits(args.amount, 18);

  const hash = await token.write.mint([to, amount]);
  await publicClient.waitForTransactionReceipt({ hash });

  const [symbol, raw] = await Promise.all([token.read.symbol(), token.read.balanceOf([to])]);
  console.log(`minted ${args.amount} ${symbol} → ${to} (tx: ${hash})`);
  console.log(`  new balanceOf: ${fmtToken(raw)} ${symbol}`);
}
