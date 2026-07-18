import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtMultiplier, fmtTimestamp, fmtToken, resolveDeployed } from "./lib/helpers.js";

interface Args {
  token: string;
}

/** Stock Token の基本情報と multiplier の状態を表示する */
export default async function stockInfo(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();

  const address =
    (args.token as `0x${string}`) || (await resolveDeployed(hre.config.paths.root, chainId, "StockToken"));
  const token = await viem.getContractAt("StockToken", address);

  const [name, symbol, decimals, totalSupply, multiplier, pending, effectiveAt, totalSupplyUI, owner] =
    await Promise.all([
      token.read.name(),
      token.read.symbol(),
      token.read.decimals(),
      token.read.totalSupply(),
      token.read.uiMultiplier(),
      token.read.newUIMultiplier(),
      token.read.effectiveAt(),
      token.read.totalSupplyUI(),
      token.read.owner(),
    ]);

  console.log(`Stock Token @ ${address} (chainId ${chainId})`);
  console.log(`  name / symbol     : ${name} (${symbol})`);
  console.log(`  decimals          : ${decimals}`);
  console.log(`  owner (発行体役)   : ${owner}`);
  console.log(`  totalSupply (raw) : ${fmtToken(totalSupply)} ${symbol}`);
  console.log(`  totalSupplyUI     : ${fmtToken(totalSupplyUI)} 株相当`);
  console.log(`  uiMultiplier      : ${fmtMultiplier(multiplier)}`);
  console.log(`  newUIMultiplier   : ${fmtMultiplier(pending)} (予約値)`);
  console.log(`  effectiveAt       : ${fmtTimestamp(effectiveAt)}`);
}
