// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { StockToken } from "../StockToken.sol";
import { StockSwapSender } from "./StockSwapSender.sol";

/// @notice StockSwapSender の単体テスト。
/// Router との実際の送受信は StockSwapE2E.t.sol(CCIPLocalSimulator)で検証するため、
/// ここでは Router 到達前に評価されるガード(allowlist・入力検証)と権限管理のみを見る。
contract StockSwapSenderTest is Test {
    uint64 constant DEST_SELECTOR = 16015286601757825753; // 適当なチェーンセレクタ

    StockToken payToken; // mint 可能な ERC20 として流用(USDC 役)
    StockSwapSender sender;

    address router = makeAddr("router");
    address receiver = makeAddr("receiver");
    address alice = makeAddr("alice");

    function setUp() public {
        payToken = new StockToken("Mock USD", "mUSD");
        sender = new StockSwapSender(router, address(payToken));
    }

    function test_ConstructorStoresConfig() public view {
        assertEq(address(sender.router()), router);
        assertEq(address(sender.paymentToken()), address(payToken));
        assertEq(sender.owner(), address(this));
    }

    function test_AllowlistDestinationSetAndUnset() public {
        assertFalse(sender.allowlistedDestinations(DEST_SELECTOR, receiver));
        sender.allowlistDestination(DEST_SELECTOR, receiver, true);
        assertTrue(sender.allowlistedDestinations(DEST_SELECTOR, receiver));
        sender.allowlistDestination(DEST_SELECTOR, receiver, false);
        assertFalse(sender.allowlistedDestinations(DEST_SELECTOR, receiver));
    }

    function test_RevertWhen_AllowlistByNonOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        sender.allowlistDestination(DEST_SELECTOR, receiver, true);
    }

    function test_RevertWhen_DestinationNotAllowed() public {
        vm.prank(alice);
        vm.expectRevert(
            abi.encodeWithSelector(StockSwapSender.DestinationNotAllowed.selector, DEST_SELECTOR, receiver)
        );
        sender.buyStock(DEST_SELECTOR, receiver, 1e18, alice, 0);
    }

    function test_RevertWhen_ZeroAmount() public {
        sender.allowlistDestination(DEST_SELECTOR, receiver, true);
        vm.prank(alice);
        vm.expectRevert(StockSwapSender.NothingToSend.selector);
        sender.buyStock(DEST_SELECTOR, receiver, 0, alice, 0);
    }
}
