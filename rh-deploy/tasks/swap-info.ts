import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtToken, fmtTimestamp, fmtUsd8, resolveDeployed } from "./lib/helpers.js";

const MODULE = "CrossChainSwapModule";

interface Args {
  sender: string;
  receiver: string;
  simulator: string;
  holder: string;
}

/**
 * クロスチェーンswapサンプルの状態をまとめて表示する。
 * Sender/Receiver のプール残高・allowlist・escrow(refunds)・フィード状態を並べて確認できる。
 */
export default async function swapInfo(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const root = hre.config.paths.root;

  const senderAddress =
    (args.sender as `0x${string}`) || (await resolveDeployed(root, chainId, "StockSwapSender", MODULE));
  const receiverAddress =
    (args.receiver as `0x${string}`) || (await resolveDeployed(root, chainId, "StockSwapReceiver", MODULE));
  const simulatorAddress =
    (args.simulator as `0x${string}`) || (await resolveDeployed(root, chainId, "CCIPLocalSimulator", MODULE));

  const sender = await viem.getContractAt("StockSwapSender", senderAddress);
  const receiver = await viem.getContractAt("StockSwapReceiver", receiverAddress);
  const simulator = await viem.getContractAt("CCIPLocalSimulator", simulatorAddress);

  const [chainSelector, , , , , ccipBnMAddress] = await simulator.read.configuration();

  const [
    paymentTokenAddress,
    stockTokenAddress,
    priceFeedAddress,
    maxStaleness,
    destinationAllowed,
    sourceAllowed,
    poolBalance,
    revenueBalance,
    totalRefunds,
  ] = await Promise.all([
    sender.read.paymentToken(),
    receiver.read.stockToken(),
    receiver.read.priceFeed(),
    receiver.read.maxStaleness(),
    sender.read.allowlistedDestinations([chainSelector, receiverAddress]),
    receiver.read.allowlistedSources([chainSelector, senderAddress]),
    (async () => {
      const stock = await viem.getContractAt("StockToken", await receiver.read.stockToken());
      return stock.read.balanceOf([receiverAddress]);
    })(),
    (async () => {
      const paymentToken = await viem.getContractAt("BurnMintERC677Helper", ccipBnMAddress);
      return paymentToken.read.balanceOf([receiverAddress]);
    })(),
    receiver.read.totalRefunds(),
  ]);

  const paymentToken = await viem.getContractAt("BurnMintERC677Helper", paymentTokenAddress);
  const stockToken = await viem.getContractAt("StockToken", stockTokenAddress);
  const priceFeed = await viem.getContractAt("MockPriceFeed", priceFeedAddress);

  const [paymentSymbol, stockSymbol, [, answer, , updatedAt], oraclePaused] = await Promise.all([
    paymentToken.read.symbol(),
    stockToken.read.symbol(),
    priceFeed.read.latestRoundData(),
    priceFeed.read.oraclePaused(),
  ]);

  let holder = args.holder as `0x${string}`;
  if (!holder) {
    const [wallet] = await viem.getWalletClients();
    holder = wallet ? wallet.account.address : "0x0000000000000000000000000000000000000000";
  }
  const holderRefund = await receiver.read.refunds([holder]);

  console.log(`CrossChainSwap @ chainId ${chainId}`);
  console.log(`  StockSwapSender    : ${senderAddress}`);
  console.log(`  StockSwapReceiver  : ${receiverAddress}`);
  console.log(`  CCIPLocalSimulator : ${simulatorAddress}`);
  console.log(`  destinationChainSelector: ${chainSelector}`);
  console.log(`  決済トークン (${paymentSymbol}, "USDC 役"): ${paymentTokenAddress}`);
  console.log();
  console.log(`allowlist:`);
  console.log(`  sender.allowlistedDestinations   : ${destinationAllowed}`);
  console.log(`  receiver.allowlistedSources      : ${sourceAllowed}`);
  console.log();
  console.log(`Receiver プール:`);
  console.log(`  ${stockSymbol} 払出プール残高       : ${fmtToken(poolBalance)} ${stockSymbol}`);
  console.log(`  ${paymentSymbol} 売上（回収可能額）    : ${fmtToken(revenueBalance - totalRefunds)} ${paymentSymbol}`);
  console.log(`  escrow 合計 (totalRefunds)        : ${fmtToken(totalRefunds)} ${paymentSymbol}`);
  console.log(`  ${holder} の escrow 残高: ${fmtToken(holderRefund)} ${paymentSymbol}${holderRefund > 0n ? " ← swap:info --holder で確認、コントラクトの withdrawFailedSwap() で回収可能" : ""}`);
  console.log();
  console.log(`価格フィード:`);
  console.log(`  price        : ${fmtUsd8(answer)}`);
  console.log(`  updatedAt    : ${fmtTimestamp(updatedAt)}`);
  console.log(`  maxStaleness : ${maxStaleness}秒`);
  console.log(`  oraclePaused : ${oraclePaused}${oraclePaused ? " ← 約定されない" : ""}`);
}
