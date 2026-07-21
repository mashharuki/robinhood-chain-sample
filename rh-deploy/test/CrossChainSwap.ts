import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";

const SCALE = 10n ** 18n;
const INITIAL_PRICE = 200_00000000n; // $200.00 (8 decimals)
const STALENESS = 3n * 24n * 60n * 60n; // 3 days
const POOL_SUPPLY = 1_000n * SCALE;
const DRIP_AMOUNT = SCALE; // BurnMintERC677Helper.drip() は 1 回で 1e18 固定

/**
 * ユーザ視点のクロスチェーンswap E2E: デプロイ → drip → approve → buy → mAAPL受領確認。
 * CCIPLocalSimulator が単一 EVM 内でソース/宛先両方の Router を模擬するため、
 * buyStock 1 回の呼び出しで送信 → 配送 → 払出までが同一トランザクションで完結する。
 */
describe("CrossChainSwap", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [, buyer] = await viem.getWalletClients();

  async function deployCrossChainSwap() {
    const simulator = await viem.deployContract("CCIPLocalSimulator");
    const [chainSelector, sourceRouter, destinationRouter, , , ccipBnMAddress] =
      await simulator.read.configuration();

    const stockToken = await viem.deployContract("StockToken", ["Mock Apple Stock Token", "mAAPL"]);
    const priceFeed = await viem.deployContract("MockPriceFeed", [INITIAL_PRICE]);

    const sender = await viem.deployContract("StockSwapSender", [sourceRouter, ccipBnMAddress]);
    const receiver = await viem.deployContract("StockSwapReceiver", [
      destinationRouter,
      stockToken.address,
      ccipBnMAddress,
      priceFeed.address,
      STALENESS,
    ]);

    await sender.write.allowlistDestination([chainSelector, receiver.address, true]);
    await receiver.write.allowlistSource([chainSelector, sender.address, true]);
    await stockToken.write.mint([receiver.address, POOL_SUPPLY]);

    const paymentToken = await viem.getContractAt("BurnMintERC677Helper", ccipBnMAddress);

    return { chainSelector, stockToken, priceFeed, sender, receiver, paymentToken };
  }

  it("ユーザがソースチェーンから決済トークンを送ると、宛先で mAAPL を受け取れる", async function () {
    const { chainSelector, stockToken, sender, receiver, paymentToken } = await deployCrossChainSwap();

    const amountIn = 100n * SCALE; // 100 CCIP-BnM ($100 相当)
    const minAmountOut = 0n;

    // drip() は 1 回 1 トークン固定のフォーセット。amountIn 分だけ購入者に配る。
    const drips = amountIn / DRIP_AMOUNT;
    for (let i = 0n; i < drips; i++) {
      await paymentToken.write.drip([buyer.account.address], { account: buyer.account });
    }
    assert.equal(await paymentToken.read.balanceOf([buyer.account.address]), amountIn);

    await paymentToken.write.approve([sender.address, amountIn], { account: buyer.account });

    await sender.write.buyStock(
      [chainSelector, receiver.address, amountIn, buyer.account.address, minAmountOut],
      { account: buyer.account, value: 10n ** 18n }, // CCIP手数料上限。余剰は自動返金される
    );

    // $200 で 100 CCIP-BnM → 0.5 mAAPL（フィード価格の織り込み済み uiMultiplier を二重適用しない）
    assert.equal(await stockToken.read.balanceOf([buyer.account.address]), 5n * 10n ** 17n);
    assert.equal(await paymentToken.read.balanceOf([buyer.account.address]), 0n);
    assert.equal(await paymentToken.read.balanceOf([receiver.address]), amountIn);
    assert.equal(await receiver.read.refunds([buyer.account.address]), 0n);
  });
});
