import { concatHex, encodeAbiParameters, formatEther, parseEventLogs, parseUnits, zeroAddress } from "viem";
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { CCIP_TESTNET_CONFIG } from "./lib/ccip-addresses.js";
import { resolveDeployed } from "./lib/helpers.js";

const SEPOLIA_CHAIN_ID = 11_155_111;
const ROBINHOOD_TESTNET_CHAIN_ID = 46_630;
const DRIP_AMOUNT = 10n ** 18n; // BurnMintERC677Helper.drip() は 1 回で 1e18 固定
// StockSwapSender.buyStock が Client._argsToBytes(EVMExtraArgsV1{gasLimit}) に渡す値と同じ
const CCIP_GAS_LIMIT = 400_000n;
// Chainlink CCIP の Client.EVM_EXTRA_ARGS_V1_TAG（bytes4(keccak256("CCIP EVMExtraArgsV1"))）。
// node_modules/@chainlink/contracts-ccip/contracts/libraries/Client.sol で確認済みの定数。
const EVM_EXTRA_ARGS_V1_TAG = "0x97a657c9" as const;

interface Args {
  amount: string;
  minAmountOut: string;
  recipient: string;
  feeBufferBps: number;
  sender: string;
  receiver: string;
}

/**
 * 実テストネット（Ethereum Sepolia → Robinhood Chain Testnet）で本物の CCIP メッセージを送る。
 * ローカルの swap:buy と異なり CCIPLocalSimulator のような同期配送は無いため、この 1 回の
 * 実行では「送信」までしか確認できない。配送・payoutの確認は数分後に
 * `bunx hardhat swap:info-testnet` を実行するか、返される messageId で
 * https://ccip.chain.link を確認すること。
 */
export default async function swapBuyTestnet(args: Args, hre: HardhatRuntimeEnvironment) {
  const root = hre.config.paths.root;
  const sourceConfig = CCIP_TESTNET_CONFIG[SEPOLIA_CHAIN_ID];
  const destConfig = CCIP_TESTNET_CONFIG[ROBINHOOD_TESTNET_CHAIN_ID];

  const { viem } = await hre.network.create("sepolia");
  const publicClient = await viem.getPublicClient();

  const senderAddress =
    (args.sender as `0x${string}`) ||
    (await resolveDeployed(root, SEPOLIA_CHAIN_ID, "StockSwapSender", sourceConfig.moduleName));
  const receiverAddress =
    (args.receiver as `0x${string}`) ||
    (await resolveDeployed(root, ROBINHOOD_TESTNET_CHAIN_ID, "StockSwapReceiver", destConfig.moduleName));

  const sender = await viem.getContractAt("StockSwapSender", senderAddress);
  const router = await viem.getContractAt("IRouterClient", await sender.read.router());
  const paymentToken = await viem.getContractAt("BurnMintERC677Helper", await sender.read.paymentToken());

  const [buyer] = await viem.getWalletClients();
  if (!buyer) {
    throw new Error("swap:buy-testnet には送信元(Sepolia)の資金を持つウォレットが必要です（PRIVATE_KEY を設定してください）");
  }

  const recipient = (args.recipient as `0x${string}`) || buyer.account.address;
  const amountIn = parseUnits(args.amount, 18);
  const minAmountOut = parseUnits(args.minAmountOut, 18);
  if (amountIn === 0n) throw new Error("--amount は 0 より大きい値を指定してください");

  const [symbol, balance] = await Promise.all([
    paymentToken.read.symbol(),
    paymentToken.read.balanceOf([buyer.account.address]),
  ]);
  if (balance < amountIn) {
    const drips = (amountIn - balance + DRIP_AMOUNT - 1n) / DRIP_AMOUNT;
    console.log(
      `${symbol} 残高不足のため drip() を ${drips} 回実行します（1 回 1 ${symbol} 固定）。` +
        `実テストネットのため各回ブロック確定を待ちます — 数が多いと時間がかかります。`,
    );
    for (let i = 0n; i < drips; i++) {
      const hash = await paymentToken.write.drip([buyer.account.address]);
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }

  const approveHash = await paymentToken.write.approve([senderAddress, amountIn]);
  await publicClient.waitForTransactionReceipt({ hash: approveHash });

  // StockSwapSender.buyStock が組み立てるものと同じ Client.EVM2AnyMessage で
  // 実際の CCIP 手数料を見積もる（固定値の当て推量ではなく Router.getFee を直接呼ぶ）。
  const extraArgs = concatHex([EVM_EXTRA_ARGS_V1_TAG, encodeAbiParameters([{ type: "uint256" }], [CCIP_GAS_LIMIT])]);
  const fee = await router.read.getFee([
    destConfig.chainSelector,
    {
      receiver: encodeAbiParameters([{ type: "address" }], [receiverAddress]),
      data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [recipient, minAmountOut]),
      tokenAmounts: [{ token: paymentToken.address, amount: amountIn }],
      feeToken: zeroAddress,
      extraArgs,
    },
  ]);
  const bufferBps = BigInt(args.feeBufferBps);
  const value = (fee * (10_000n + bufferBps)) / 10_000n; // 余剰は StockSwapSender が自動返金する

  console.log(
    `swap:buy-testnet — ${args.amount} ${symbol} (Sepolia) → recipient ${recipient} (Robinhood Chain Testnet) へ mAAPL 払出を要求`,
  );
  console.log(`  sender   : ${senderAddress} (Ethereum Sepolia)`);
  console.log(`  receiver : ${receiverAddress} (Robinhood Chain Testnet)`);
  console.log(`  CCIP見積り手数料: ${formatEther(fee)} ETH（送付額 ${formatEther(value)} ETH。余剰は自動返金）`);

  const buyHash = await sender.write.buyStock(
    [destConfig.chainSelector, receiverAddress, amountIn, recipient, minAmountOut],
    { value },
  );
  const receipt = await publicClient.waitForTransactionReceipt({ hash: buyHash });

  const [orderSent] = parseEventLogs({ abi: sender.abi, eventName: "SwapOrderSent", logs: receipt.logs });

  console.log(`tx: ${buyHash} (status: ${receipt.status})`);
  if (orderSent) {
    console.log(`  CCIP messageId: ${orderSent.args.messageId}`);
    console.log(`  配送状況: https://ccip.chain.link/msg/${orderSent.args.messageId}`);
  }
  console.log(
    `  実 CCIP の配送には数分かかる。数分後に \`bunx hardhat swap:info-testnet\` で ` +
      `mAAPL 払出（プール残高減少）または escrow 退避を確認すること。`,
  );
}
