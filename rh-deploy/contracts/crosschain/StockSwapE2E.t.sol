// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import {
    CCIPLocalSimulator,
    IRouterClient,
    BurnMintERC677Helper
} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import { StockToken } from "../StockToken.sol";
import { MockPriceFeed } from "../MockPriceFeed.sol";
import { StockSwapSender } from "./StockSwapSender.sol";
import { StockSwapReceiver } from "./StockSwapReceiver.sol";

/// @notice CCIPLocalSimulator による E2E テスト。
/// 単一 EVM 内にソース/宛先両方の Router を模擬し、
/// 「決済トークン+購入指示の送信 → Router 配送 → フィード価格で mAAPL 払出」の
/// フルパイプラインを検証する。
contract StockSwapE2ETest is Test {
    uint256 constant SCALE = 1e18;
    int256 constant INITIAL_PRICE = 200_00000000; // $200.00
    uint256 constant STALENESS = 3 days;

    CCIPLocalSimulator simulator;
    uint64 chainSelector;
    IRouterClient sourceRouter;
    IRouterClient destinationRouter;
    BurnMintERC677Helper ccipBnM; // USDC 役の決済トークン

    StockToken stock;
    MockPriceFeed feed;
    StockSwapSender sender;
    StockSwapReceiver receiver;

    address alice = makeAddr("alice");

    function setUp() public {
        simulator = new CCIPLocalSimulator();
        (
            uint64 chainSelector_,
            IRouterClient sourceRouter_,
            IRouterClient destinationRouter_,
            ,
            ,
            BurnMintERC677Helper ccipBnM_,
        ) = simulator.configuration();
        chainSelector = chainSelector_;
        sourceRouter = sourceRouter_;
        destinationRouter = destinationRouter_;
        ccipBnM = ccipBnM_;

        stock = new StockToken("Mock Apple Stock Token", "mAAPL");
        feed = new MockPriceFeed(INITIAL_PRICE);
        sender = new StockSwapSender(address(sourceRouter), address(ccipBnM));
        receiver = new StockSwapReceiver(
            address(destinationRouter), address(stock), address(ccipBnM), address(feed), STALENESS
        );

        sender.allowlistDestination(chainSelector, address(receiver), true);
        receiver.allowlistSource(chainSelector, address(sender), true);
        stock.mint(address(receiver), 1_000e18); // 払出プール

        _drip(alice, 100); // 100 BnM = $100 相当
        vm.deal(alice, 10 ether); // CCIP 手数料用
    }

    /// drip は 1 回で 1e18 を mint するため、必要枚数分ループする
    function _drip(address to, uint256 times) internal {
        for (uint256 i = 0; i < times; i++) {
            ccipBnM.drip(to);
        }
    }

    function test_E2E_BuyStockAcrossChains() public {
        vm.startPrank(alice);
        ccipBnM.approve(address(sender), 100e18);
        // $200 で 100 BnM → 0.5 mAAPL
        sender.buyStock{ value: 1 ether }(chainSelector, address(receiver), 100e18, alice, 5e17);
        vm.stopPrank();

        assertEq(stock.balanceOf(alice), 5e17); // 0.5 mAAPL 受領
        assertEq(ccipBnM.balanceOf(alice), 0); // 決済トークンは送信済み
        assertEq(ccipBnM.balanceOf(address(receiver)), 100e18); // 宛先に配送済み
        assertEq(receiver.refunds(alice), 0);
    }

    function test_E2E_SplitHalvedPriceDoublesPayout() public {
        // 2:1 分割: multiplier 2 倍 + フィード価格半減。swap は価格だけを見るので払出は 2 倍。
        stock.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp);
        feed.setAnswer(100_00000000); // $100

        vm.startPrank(alice);
        ccipBnM.approve(address(sender), 100e18);
        sender.buyStock{ value: 1 ether }(chainSelector, address(receiver), 100e18, alice, 1e18);
        vm.stopPrank();

        assertEq(stock.balanceOf(alice), 1e18); // 分割前(0.5e18)の 2 倍
    }

    function test_E2E_SlippageFailureEscrowsAndWithdraw() public {
        vm.startPrank(alice);
        ccipBnM.approve(address(sender), 100e18);
        // minAmountOut を実際の 0.5e18 より大きくして意図的に失敗させる
        sender.buyStock{ value: 1 ether }(chainSelector, address(receiver), 100e18, alice, 1e18);

        assertEq(stock.balanceOf(alice), 0); // 約定していない
        assertEq(receiver.refunds(alice), 100e18); // escrow に退避

        receiver.withdrawFailedSwap();
        vm.stopPrank();

        assertEq(ccipBnM.balanceOf(alice), 100e18); // 決済トークンを回収
        assertEq(receiver.refunds(alice), 0);
    }
}
