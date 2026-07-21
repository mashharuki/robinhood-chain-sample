import { parseUnits } from "viem";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtToken, resolveDeployed } from "./lib/helpers.js";

const MODULE = "CrossChainSwapModule";
const DRIP_AMOUNT = 10n ** 18n; // BurnMintERC677Helper.drip() は 1 回で 1e18 固定

interface Args {
  amount: string;
  minAmountOut: string;
  recipient: string;
  value: string;
  sender: string;
  receiver: string;
  simulator: string;
}

/**
 * StockSwapSender.buyStock を呼び出し、CCIPLocalSimulator 経由で
 * Robinhood Chain 役の StockSwapReceiver に決済トークン+購入指示を送る。
 * ローカルシミュレータは単一 EVM 内で即時に _ccipReceive まで実行するため、
 * このタスク 1 回の実行で送信 → 配送 → mAAPL 払出まで完結する。
 *
 * 決済トークン(CCIP-BnM)は誰でも呼べる drip() フォーセットで手に入るため、
 * 残高不足なら購入前に自動で drip() する。
 */
export default async function swapBuy(args: Args, hre: HardhatRuntimeEnvironment) {
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
  const simulator = await viem.getContractAt("CCIPLocalSimulator", simulatorAddress);

  const [chainSelector, , , , , ccipBnMAddress] = await simulator.read.configuration();
  const paymentToken = await viem.getContractAt("BurnMintERC677Helper", ccipBnMAddress);

  const [buyer] = await viem.getWalletClients();
  if (!buyer) throw new Error("swap:buy には購入者のウォレットが必要です（PRIVATE_KEY を設定してください）");

  const recipient = (args.recipient as `0x${string}`) || buyer.account.address;
  const amountIn = parseUnits(args.amount, 18);
  const minAmountOut = parseUnits(args.minAmountOut, 18);
  const value = parseUnits(args.value, 18);
  if (amountIn === 0n) throw new Error("--amount は 0 より大きい値を指定してください");

  const [symbol, balance] = await Promise.all([
    paymentToken.read.symbol(),
    paymentToken.read.balanceOf([buyer.account.address]),
  ]);
  if (balance < amountIn) {
    const drips = (amountIn - balance + DRIP_AMOUNT - 1n) / DRIP_AMOUNT; // ceil
    console.log(`${symbol} 残高不足のため drip() を ${drips} 回実行します（1 回 1 ${symbol}）...`);
    for (let i = 0n; i < drips; i++) {
      const hash = await paymentToken.write.drip([buyer.account.address]);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  const approveHash = await paymentToken.write.approve([senderAddress, amountIn]);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  console.log(`swap:buy — ${args.amount} ${symbol} → recipient ${recipient} へ mAAPL 払出を要求`);
  console.log(`  sender  : ${senderAddress}`);
  console.log(`  receiver: ${receiverAddress} (chainSelector ${chainSelector})`);
  console.log(`  minAmountOut: ${args.minAmountOut}`);

  const buyHash = await sender.write.buyStock([chainSelector, receiverAddress, amountIn, recipient, minAmountOut], {
    value,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });

  const receiver = await viem.getContractAt("StockSwapReceiver", receiverAddress);
  const stockToken = await viem.getContractAt("StockToken", await receiver.read.stockToken());
  const [stockSymbol, stockBalance, refund] = await Promise.all([
    stockToken.read.symbol(),
    stockToken.read.balanceOf([recipient]),
    receiver.read.refunds([recipient]),
  ]);

  console.log(`tx: ${buyHash} (status: ${receipt.status})`);
  console.log(`  recipient の ${stockSymbol} 残高: ${fmtToken(stockBalance)} ${stockSymbol}`);
  if (refund > 0n) {
    console.log(
      `  ⚠ swap が約定しませんでした — ${symbol} ${fmtToken(refund)} が escrow に退避されています。` +
        `原因は minAmountOut 未達・プール不足・oracle 停止のいずれか（swap:info で詳細を確認可能）。` +
        `Solidity 側の withdrawFailedSwap() で回収できます。`,
    );
  }
}
