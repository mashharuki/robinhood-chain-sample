import { parseAbi } from "viem";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtMultiplier, fmtTimestamp, fmtToken, fmtUsd8 } from "./lib/helpers.js";
import { MAINNET_STOCK_TOKENS } from "./lib/stock-addresses.js";

interface Args {
  ticker: string;
  holder: string;
  feed: string;
}

/** 実トークンの照会に必要な最小 ABI（read-only）。ERC-20 + ERC-8056 のサブセット */
const STOCK_TOKEN_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
  "function uiMultiplier() view returns (uint256)",
  "function newUIMultiplier() view returns (uint256)",
  "function effectiveAt() view returns (uint256)",
  "function totalSupplyUI() view returns (uint256)",
]);

const FEED_ABI = parseAbi([
  "function decimals() view returns (uint8)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
]);

/**
 * Robinhood Chain メインネットの「実物の」Stock Token を read-only で照会する。
 * ガス不要・書き込みなし。PRIVATE_KEY も不要（公開 RPC のみ）。
 *
 *   bunx hardhat stock:live AAPL
 *   bunx hardhat stock:live TSLA --holder 0x... --feed 0x<chainlink-feed>
 *
 * フィードアドレスは Chainlink が管理しているためハードコードしていない。
 * 価格も見たい場合は Chainlink の Robinhood Chain price feeds ページで調べて
 * --feed で渡すこと。
 */
export default async function stockLive(args: Args, hre: HardhatRuntimeEnvironment) {
  const ticker = args.ticker.toUpperCase();
  const address = MAINNET_STOCK_TOKENS[ticker];
  if (address === undefined) {
    throw new Error(
      `未知のティッカー: ${ticker}。対応ティッカー: ${Object.keys(MAINNET_STOCK_TOKENS).join(", ")}`,
    );
  }

  // --network 未指定ならメインネット（robinhood）へ read-only 接続する
  const { viem } = await hre.network.create(hre.globalOptions.network !== undefined ? undefined : "robinhood");
  const publicClient = await viem.getPublicClient();

  const chainId = await publicClient.getChainId();
  if (chainId !== 4663) {
    throw new Error(`Stock Token はメインネット (4663) にのみ存在します。接続先: chainId ${chainId}`);
  }

  const read = <T>(functionName: string, fnArgs: unknown[] = []) =>
    publicClient.readContract({
      address,
      abi: STOCK_TOKEN_ABI,
      functionName: functionName as never,
      args: fnArgs as never,
    }) as Promise<T>;

  const [name, symbol, decimals, totalSupply, multiplier, pending, effectiveAt, totalSupplyUI] = await Promise.all([
    read<string>("name"),
    read<string>("symbol"),
    read<number>("decimals"),
    read<bigint>("totalSupply"),
    read<bigint>("uiMultiplier"),
    read<bigint>("newUIMultiplier"),
    read<bigint>("effectiveAt"),
    read<bigint>("totalSupplyUI"),
  ]);

  console.log(`${ticker} — 実 Stock Token @ ${address} (Robinhood Chain mainnet)`);
  console.log(`  name / symbol     : ${name} (${symbol})`);
  console.log(`  decimals          : ${decimals}`);
  console.log(`  totalSupply (raw) : ${fmtToken(totalSupply)}`);
  console.log(`  totalSupplyUI     : ${fmtToken(totalSupplyUI)} 株相当`);
  console.log(`  uiMultiplier      : ${fmtMultiplier(multiplier)}`);
  console.log(`  newUIMultiplier   : ${fmtMultiplier(pending)} / effectiveAt ${fmtTimestamp(effectiveAt)}`);

  if (args.holder) {
    const balance = await read<bigint>("balanceOf", [args.holder]);
    console.log(`  balanceOf(${args.holder}) : ${fmtToken(balance)} ${symbol}`);
  }

  if (args.feed) {
    const feedAddress = args.feed as `0x${string}`;
    const [feedDecimals, [, answer, , updatedAt]] = await Promise.all([
      publicClient.readContract({ address: feedAddress, abi: FEED_ABI, functionName: "decimals" }),
      publicClient.readContract({ address: feedAddress, abi: FEED_ABI, functionName: "latestRoundData" }),
    ]);
    console.log(`  Chainlink price   : ${fmtUsd8(answer)} (${feedDecimals} decimals, updated ${fmtTimestamp(updatedAt)})`);
    console.log(`  ※ この価格は multiplier 織り込み済み — uiMultiplier を掛けてはいけない`);
  }
}
