// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { Client } from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { CCIPReceiver } from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import { StockToken } from "../StockToken.sol";
import { MockPriceFeed } from "../MockPriceFeed.sol";
import { StockSwapReceiver } from "./StockSwapReceiver.sol";

/// @notice StockSwapReceiver の単体テスト。
/// 実際の CCIP 配送は StockSwapE2E.t.sol で検証する。ここでは Router を prank で演じ、
/// Any2EVMMessage を手組みして swap ロジック・escrow・アクセス制御を網羅する。
/// (実物の Router もトークンを Receiver へ transfer してから ccipReceive を呼ぶため、
///  「先に mint → prank で ccipReceive」はプロトコルの順序を忠実に再現している)
contract StockSwapReceiverTest is Test {
    uint256 constant SCALE = 1e18;
    int256 constant INITIAL_PRICE = 200_00000000; // $200.00 (8 decimals)
    uint256 constant STALENESS = 3 days;
    uint64 constant SOURCE_SELECTOR = 16015286601757825753;

    StockToken stock; // mAAPL
    StockToken payToken; // mUSD(mint 可能な ERC20 として流用)
    MockPriceFeed feed;
    StockSwapReceiver receiver;

    address router = makeAddr("router");
    address srcSender = makeAddr("srcSender"); // ソースチェーン側 StockSwapSender 役
    address alice = makeAddr("alice");

    function setUp() public {
        stock = new StockToken("Mock Apple Stock Token", "mAAPL");
        payToken = new StockToken("Mock USD", "mUSD");
        feed = new MockPriceFeed(INITIAL_PRICE);
        receiver = new StockSwapReceiver(router, address(stock), address(payToken), address(feed), STALENESS);
        receiver.allowlistSource(SOURCE_SELECTOR, srcSender, true);
        stock.mint(address(receiver), 1_000e18); // 払出プール
    }

    /// Router がトークンを配送済みの状態を作ってから ccipReceive を呼ぶヘルパ
    function _deliver(bytes32 messageId, address from, address recipient, uint256 amountIn, uint256 minOut) internal {
        payToken.mint(address(receiver), amountIn); // Router によるトークン配送の再現
        Client.EVMTokenAmount[] memory tokens = new Client.EVMTokenAmount[](1);
        tokens[0] = Client.EVMTokenAmount({ token: address(payToken), amount: amountIn });
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: messageId,
            sourceChainSelector: SOURCE_SELECTOR,
            sender: abi.encode(from),
            data: abi.encode(recipient, minOut),
            destTokenAmounts: tokens
        });
        vm.prank(router);
        receiver.ccipReceive(message);
    }

    // ---------------- ハッピーパス ----------------

    function test_SwapPaysOutAtFeedPrice() public {
        // $200 で 1000 mUSD → 5 mAAPL
        _deliver("m1", srcSender, alice, 1_000e18, 5e18);
        assertEq(stock.balanceOf(alice), 5e18);
        assertEq(stock.balanceOf(address(receiver)), 995e18);
        assertEq(receiver.refunds(alice), 0);
    }

    function test_SwapEmitsSwapExecuted() public {
        payToken.mint(address(receiver), 1_000e18);
        Client.EVMTokenAmount[] memory tokens = new Client.EVMTokenAmount[](1);
        tokens[0] = Client.EVMTokenAmount({ token: address(payToken), amount: 1_000e18 });
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: bytes32(uint256(1)),
            sourceChainSelector: SOURCE_SELECTOR,
            sender: abi.encode(srcSender),
            data: abi.encode(alice, uint256(5e18)),
            destTokenAmounts: tokens
        });
        vm.expectEmit();
        emit StockSwapReceiver.SwapExecuted(bytes32(uint256(1)), alice, 1_000e18, 5e18, uint256(INITIAL_PRICE));
        vm.prank(router);
        receiver.ccipReceive(message);
    }

    function test_AmountOutRoundsDown() public {
        // $300 で 1000 mUSD → 3.333...e18(切り捨て)
        feed.setAnswer(300_00000000);
        _deliver("m2", srcSender, alice, 1_000e18, 0);
        assertEq(stock.balanceOf(alice), uint256(1_000e18) * 1e8 / 300_00000000);
    }

    function test_SplitHalvedPriceDoublesPayout() public {
        // 2:1 分割: フィード価格が半分になる(multiplier はフィードに織込み済みなので
        // swap 側では一切読まない — 価格だけで払出量が自動的に 2 倍になる)
        stock.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp);
        feed.setAnswer(100_00000000); // $100
        _deliver("m3", srcSender, alice, 1_000e18, 0);
        assertEq(stock.balanceOf(alice), 10e18); // 分割前の 5e18 の 2 倍
    }

    // ---------------- 失敗時の escrow 退避 ----------------

    function test_SlippageFailureEscrowsPayment() public {
        _deliver("m4", srcSender, alice, 1_000e18, 6e18); // 実際は 5e18 しか出ない
        assertEq(stock.balanceOf(alice), 0);
        assertEq(receiver.refunds(alice), 1_000e18);
    }

    function test_WithdrawFailedSwapReturnsPayment() public {
        _deliver("m5", srcSender, alice, 1_000e18, 6e18);
        vm.prank(alice);
        receiver.withdrawFailedSwap();
        assertEq(payToken.balanceOf(alice), 1_000e18);
        assertEq(receiver.refunds(alice), 0);
    }

    function test_RevertWhen_WithdrawWithoutRefund() public {
        vm.prank(alice);
        vm.expectRevert(StockSwapReceiver.NoRefundAvailable.selector);
        receiver.withdrawFailedSwap();
    }

    function test_InsufficientPoolEscrows() public {
        // プールは 1000 mAAPL。$200 × 300,000 mUSD = 1500 mAAPL 分の注文
        _deliver("m6", srcSender, alice, 300_000e18, 0);
        assertEq(stock.balanceOf(alice), 0);
        assertEq(receiver.refunds(alice), 300_000e18);
    }

    function test_OraclePausedEscrows() public {
        feed.setOraclePaused(true); // コーポレートアクション中
        _deliver("m7", srcSender, alice, 1_000e18, 0);
        assertEq(receiver.refunds(alice), 1_000e18);
    }

    function test_StalePriceEscrows() public {
        vm.warp(block.timestamp + STALENESS + 1);
        _deliver("m8", srcSender, alice, 1_000e18, 0);
        assertEq(receiver.refunds(alice), 1_000e18);
    }

    function test_InvalidPriceEscrows() public {
        feed.setAnswer(0);
        _deliver("m9", srcSender, alice, 1_000e18, 0);
        assertEq(receiver.refunds(alice), 1_000e18);
    }

    // ---------------- アクセス制御 ----------------

    function test_RevertWhen_CcipReceiveFromNonRouter() public {
        Client.Any2EVMMessage memory message; // 中身はゼロ値でよい(router チェックが先)
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(CCIPReceiver.InvalidRouter.selector, alice));
        receiver.ccipReceive(message);
    }

    function test_RevertWhen_SourceNotAllowed() public {
        address evil = makeAddr("evil");
        payToken.mint(address(receiver), 1e18);
        Client.EVMTokenAmount[] memory tokens = new Client.EVMTokenAmount[](1);
        tokens[0] = Client.EVMTokenAmount({ token: address(payToken), amount: 1e18 });
        Client.Any2EVMMessage memory message = Client.Any2EVMMessage({
            messageId: "evil",
            sourceChainSelector: SOURCE_SELECTOR,
            sender: abi.encode(evil),
            data: abi.encode(alice, uint256(0)),
            destTokenAmounts: tokens
        });
        vm.prank(router);
        vm.expectRevert(
            abi.encodeWithSelector(StockSwapReceiver.SourceNotAllowed.selector, SOURCE_SELECTOR, evil)
        );
        receiver.ccipReceive(message);
    }

    function test_RevertWhen_ExecuteSwapCalledExternally() public {
        vm.prank(alice);
        vm.expectRevert(StockSwapReceiver.OnlySelf.selector);
        receiver.executeSwap(alice, 1e18, 0);
    }

    function test_RevertWhen_AllowlistByNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        receiver.allowlistSource(SOURCE_SELECTOR, alice, true);
    }

    function test_WithdrawStockOnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        receiver.withdrawStock(alice, 1e18);

        receiver.withdrawStock(address(this), 10e18); // owner は回収できる
        assertEq(stock.balanceOf(address(this)), 10e18);
    }

    // ---------------- 成功swapの売上(決済トークン)回収 ----------------

    function test_WithdrawPaymentOnlyOwner() public {
        _deliver("m10", srcSender, alice, 1_000e18, 5e18); // 成功swap: 1000 mUSD が売上として滞留

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        receiver.withdrawPayment(alice, 1_000e18);

        receiver.withdrawPayment(address(this), 1_000e18); // owner は売上を回収できる
        assertEq(payToken.balanceOf(address(this)), 1_000e18);
    }

    function test_RevertWhen_WithdrawPaymentEatsIntoRefunds() public {
        _deliver("m11", srcSender, alice, 1_000e18, 6e18); // 失敗swap: 1000 mUSD が escrow(refunds)

        vm.expectRevert(bytes("StockSwapReceiver: refunds reserved"));
        receiver.withdrawPayment(address(this), 1_000e18);
    }
}
