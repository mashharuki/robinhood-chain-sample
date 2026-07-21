import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { CCIP_TESTNET_CONFIG } from "./lib/ccip-addresses.js";
import { fmtToken, fmtTimestamp, fmtUsd8, resolveDeployed } from "./lib/helpers.js";

const SEPOLIA_CHAIN_ID = 11_155_111;
const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;

interface Args {
  sender: string;
  receiver: string;
  holder: string;
}

/**
 * 実テストネット（Ethereum Sepolia → Robinhood Chain Testnet）の状態表示。
 * ソース・宛先が別チェーンにあるため、--network フラグに関わらず
 * hre.network.create() で両方に個別接続して並べて表示する。
 */
export default async function swapInfoTestnet(args: Args, hre: HardhatRuntimeEnvironment) {
  const root = hre.config.paths.root;
  const sourceConfig = CCIP_TESTNET_CONFIG[SEPOLIA_CHAIN_ID];
  const destConfig = CCIP_TESTNET_CONFIG[ROBINHOOD_TESTNET_CHAIN_ID];

  const sepolia = await hre.network.create("sepolia");
  const robinhoodTestnet = await hre.network.create("robinhoodTestnet");

  const senderAddress =
    (args.sender as `0x${string}`) ||
    (await resolveDeployed(root, SEPOLIA_CHAIN_ID, "StockSwapSender", sourceConfig.moduleName));
  const receiverAddress =
    (args.receiver as `0x${string}`) ||
    (await resolveDeployed(root, ROBINHOOD_TESTNET_CHAIN_ID, "StockSwapReceiver", destConfig.moduleName));

  const sender = await sepolia.viem.getContractAt("StockSwapSender", senderAddress);
  const receiver = await robinhoodTestnet.viem.getContractAt("StockSwapReceiver", receiverAddress);

  const [destAllowed, srcAllowed, senderPaymentTokenAddress, receiverPaymentTokenAddress, stockTokenAddress, priceFeedAddress, maxStaleness] =
    await Promise.all([
      sender.read.allowlistedDestinations([destConfig.chainSelector, receiverAddress]),
      receiver.read.allowlistedSources([sourceConfig.chainSelector, senderAddress]),
      sender.read.paymentToken(),
      receiver.read.paymentToken(),
      receiver.read.stockToken(),
      receiver.read.priceFeed(),
      receiver.read.maxStaleness(),
    ]);

  const senderPaymentToken = await sepolia.viem.getContractAt("BurnMintERC677Helper", senderPaymentTokenAddress);
  const receiverPaymentToken = await robinhoodTestnet.viem.getContractAt("BurnMintERC677Helper", receiverPaymentTokenAddress);
  const stockToken = await robinhoodTestnet.viem.getContractAt("StockToken", stockTokenAddress);
  const priceFeed = await robinhoodTestnet.viem.getContractAt("MockPriceFeed", priceFeedAddress);

  let holder = args.holder as `0x${string}`;
  if (!holder) {
    const [wallet] = await sepolia.viem.getWalletClients();
    holder = wallet ? wallet.account.address : "0x0000000000000000000000000000000000000000";
  }

  const [symbol, holderBalance, poolBalance, revenueBalance, totalRefunds, holderRefund, stockSymbol, [, answer, , updatedAt], oraclePaused] =
    await Promise.all([
      senderPaymentToken.read.symbol(),
      senderPaymentToken.read.balanceOf([holder]),
      stockToken.read.balanceOf([receiverAddress]),
      receiverPaymentToken.read.balanceOf([receiverAddress]),
      receiver.read.totalRefunds(),
      receiver.read.refunds([holder]),
      stockToken.read.symbol(),
      priceFeed.read.latestRoundData(),
      priceFeed.read.oraclePaused(),
    ]);

  console.log(`CrossChainSwap（実テストネット: Ethereum Sepolia → Robinhood Chain Testnet）`);
  console.log(`  StockSwapSender   (sepolia)          : ${senderAddress}`);
  console.log(`  StockSwapReceiver (robinhoodTestnet)  : ${receiverAddress}`);
  console.log();
  console.log(`allowlist:`);
  console.log(`  sender.allowlistedDestinations : ${destAllowed}`);
  console.log(`  receiver.allowlistedSources     : ${srcAllowed}${srcAllowed ? "" : " ← swap:allowlist-source --network robinhoodTestnet を実行してください"}`);
  console.log();
  console.log(`Sepolia 側:`);
  console.log(`  ${holder} の ${symbol} 残高: ${fmtToken(holderBalance)} ${symbol}`);
  console.log();
  console.log(`Robinhood Chain Testnet 側:`);
  console.log(`  ${stockSymbol} 払出プール残高       : ${fmtToken(poolBalance)} ${stockSymbol}`);
  console.log(`  ${symbol} 売上（回収可能額）    : ${fmtToken(revenueBalance - totalRefunds)} ${symbol}`);
  console.log(`  escrow 合計 (totalRefunds)        : ${fmtToken(totalRefunds)} ${symbol}`);
  console.log(
    `  ${holder} の escrow 残高: ${fmtToken(holderRefund)} ${symbol}${holderRefund > 0n ? " ← withdrawFailedSwap() で回収可能" : ""}`,
  );
  console.log();
  console.log(`価格フィード (robinhoodTestnet):`);
  console.log(`  price        : ${fmtUsd8(answer)}`);
  console.log(`  updatedAt    : ${fmtTimestamp(updatedAt)}`);
  console.log(`  maxStaleness : ${maxStaleness}秒`);
  console.log(`  oraclePaused : ${oraclePaused}${oraclePaused ? " ← 約定されない" : ""}`);
}
