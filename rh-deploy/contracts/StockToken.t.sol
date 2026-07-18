// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { StockToken } from "./StockToken.sol";
import { MockPriceFeed } from "./MockPriceFeed.sol";
import { StockViewer } from "./StockViewer.sol";
import { IERC8056 } from "./interfaces/IERC8056.sol";
import { AggregatorV3Interface } from "./interfaces/AggregatorV3Interface.sol";

contract StockTokenTest is Test {
    uint256 constant SCALE = 1e18;
    int256 constant INITIAL_PRICE = 200_00000000; // $200.00 (8 decimals)
    uint256 constant STALENESS = 3 days; // 週末を跨いでも誤作動しない窓

    StockToken token;
    MockPriceFeed feed;
    StockViewer viewer;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        token = new StockToken("Mock Apple Stock Token", "mAAPL");
        feed = new MockPriceFeed(INITIAL_PRICE);
        viewer = new StockViewer();
        token.mint(alice, 100e18); // 100 トークン
    }

    // ---------------- 初期状態 ----------------

    function test_InitialMultiplierIsOneToOne() public view {
        assertEq(token.uiMultiplier(), SCALE);
        assertEq(token.effectiveAt(), 0);
    }

    function test_BalanceOfUIEqualsRawAtLaunch() public view {
        assertEq(token.balanceOf(alice), 100e18);
        assertEq(token.balanceOfUI(alice), 100e18);
        assertEq(token.totalSupplyUI(), token.totalSupply());
    }

    function test_Has18Decimals() public view {
        assertEq(token.decimals(), 18);
    }

    // ---------------- 株式分割 (2:1) ----------------

    function test_SplitDoublesMultiplierButRawBalanceIsConstant() public {
        uint256 activation = block.timestamp + 1 days;
        token.scheduleUIMultiplierUpdate(2 * SCALE, activation);

        // 有効化前: 何も変わらない
        assertEq(token.uiMultiplier(), SCALE);
        assertEq(token.newUIMultiplier(), 2 * SCALE);
        assertEq(token.effectiveAt(), activation);

        // 有効化時刻を過ぎると自動で切り替わる
        vm.warp(activation);
        assertEq(token.uiMultiplier(), 2 * SCALE);
        assertEq(token.balanceOf(alice), 100e18); // raw は不変 — これが核心
        assertEq(token.balanceOfUI(alice), 200e18); // 株数換算は 2 倍
        assertEq(token.totalSupplyUI(), 200e18);
    }

    function test_ScheduleEmitsUIMultiplierUpdated() public {
        uint256 activation = block.timestamp + 1 days;
        vm.expectEmit();
        emit IERC8056.UIMultiplierUpdated(SCALE, 2 * SCALE, activation);
        token.scheduleUIMultiplierUpdate(2 * SCALE, activation);
    }

    function test_SecondScheduleComposesOnActivatedValue() public {
        // 2:1 分割を有効化した後、さらに 3:2 分割（×1.5）を予約
        token.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp + 1 days);
        vm.warp(block.timestamp + 1 days);
        token.scheduleUIMultiplierUpdate(3 * SCALE, block.timestamp + 1 days);

        assertEq(token.uiMultiplier(), 2 * SCALE); // まだ 2 倍のまま
        vm.warp(block.timestamp + 1 days);
        assertEq(token.uiMultiplier(), 3 * SCALE);
        assertEq(token.balanceOfUI(alice), 300e18);
    }

    function test_RevertWhen_ScheduleByNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp + 1 days);
    }

    function test_RevertWhen_ScheduleZeroMultiplier() public {
        vm.expectRevert("StockToken: multiplier is zero");
        token.scheduleUIMultiplierUpdate(0, block.timestamp + 1 days);
    }

    function test_RevertWhen_ScheduleInPast() public {
        vm.warp(1000);
        vm.expectRevert("StockToken: effectiveAt in past");
        token.scheduleUIMultiplierUpdate(2 * SCALE, 999);
    }

    // ---------------- ミント（Authorized Participant の模擬） ----------------

    function test_RevertWhen_MintByNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        token.mint(alice, 1e18);
    }

    // ---------------- 転送とイベント ----------------

    function test_TransferEmitsScaledUIEvent() public {
        token.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp);

        vm.prank(alice);
        vm.expectEmit();
        emit IERC8056.TransferWithScaledUI(alice, bob, 10e18, 20e18); // uiValue = raw × 2
        token.transfer(bob, 10e18);
    }

    // ---------------- StockViewer: 正しい評価パターン ----------------

    function test_HoldingValueUsd() public view {
        // 100 トークン × $200 = $20,000（18 decimals）
        uint256 value = viewer.holdingValueUsd(IERC20(address(token)), feed, alice, STALENESS);
        assertEq(value, 20_000e18);
    }

    function test_SplitDoesNotChangeUsdValue() public {
        // 2:1 分割: 実世界では 1 株の価格が半分になり multiplier が 2 倍になる。
        // フィード価格は「multiplier 織り込み済みの 1 トークンの価格」なので変わらない。
        // → USD 評価額も不変。multiplier を自分で掛けたら（二重適用）ここが 2 倍に壊れる。
        uint256 before = viewer.holdingValueUsd(IERC20(address(token)), feed, alice, STALENESS);
        token.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp);

        uint256 usdAfter = viewer.holdingValueUsd(IERC20(address(token)), feed, alice, STALENESS);
        assertEq(usdAfter, before); // USD 価値は不変
        assertEq(viewer.sharesOf(token, alice), 200e18); // 株数だけが 2 倍
    }

    function test_RevertWhen_PriceIsStale() public {
        vm.warp(block.timestamp + STALENESS + 1);
        vm.expectRevert("StockViewer: stale price");
        viewer.holdingValueUsd(IERC20(address(token)), feed, alice, STALENESS);
    }

    function test_RevertWhen_OraclePaused() public {
        feed.setOraclePaused(true); // コーポレートアクション中
        vm.expectRevert("StockViewer: oracle paused");
        viewer.holdingValueUsd(IERC20(address(token)), feed, alice, STALENESS);
    }

    function test_RevertWhen_PriceIsNotPositive() public {
        feed.setAnswer(0);
        vm.expectRevert("StockViewer: invalid price");
        viewer.holdingValueUsd(IERC20(address(token)), feed, alice, STALENESS);
    }

    function test_FeedHas8Decimals() public view {
        assertEq(feed.decimals(), 8);
    }

    // ---------------- Fuzz: multiplier と残高換算の整合性 ----------------

    function testFuzz_BalanceOfUIScalesWithMultiplier(uint64 multiplier) public {
        vm.assume(multiplier > 0);
        token.scheduleUIMultiplierUpdate(multiplier, block.timestamp);
        assertEq(token.balanceOfUI(alice), (100e18 * uint256(multiplier)) / SCALE);
        assertEq(token.balanceOf(alice), 100e18); // raw は常に不変
    }
}
