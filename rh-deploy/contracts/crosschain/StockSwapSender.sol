// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { IRouterClient } from "@chainlink/contracts-ccip/contracts/interfaces/IRouterClient.sol";
import { Client } from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title StockSwapSender — ソースチェーン側の「株を買う」注文送信コントラクト
/// @notice CCIP の programmable token transfer(トークン+データ同時送信)で、
///         決済トークン(USDC 役)と購入指示(受取人・最小受取量)を Robinhood Chain 役の
///         StockSwapReceiver へ送る。実物の CCIP でも同じ interface(IRouterClient /
///         Client ライブラリ)を使うため、Router アドレスを差し替えるだけで実網に移行できる。
/// @dev 手数料は native(ETH)払い。msg.value から実費を引いた残りは呼び出し元に返金する。
contract StockSwapSender is Ownable {
    using SafeERC20 for IERC20;

    error DestinationNotAllowed(uint64 chainSelector, address receiver);
    error NothingToSend();
    error NotEnoughNativeForFee(uint256 provided, uint256 required);
    error RefundFailed();

    event SwapOrderSent(
        bytes32 indexed messageId,
        uint64 indexed destinationChainSelector,
        address indexed receiver,
        address recipient,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 fee
    );

    /// @notice 宛先チェーンの CCIP Router(実網では chainlink docs 記載の Router アドレス)
    IRouterClient public immutable router;
    /// @notice 決済トークン(このサンプルでは CCIP-BnM を USDC 役として使う)
    IERC20 public immutable paymentToken;

    /// @notice 送信を許可する (宛先チェーンセレクタ, Receiver アドレス) の組
    mapping(uint64 => mapping(address => bool)) public allowlistedDestinations;

    constructor(address router_, address paymentToken_) Ownable(msg.sender) {
        router = IRouterClient(router_);
        paymentToken = IERC20(paymentToken_);
    }

    /// @notice 送信先の許可設定。誤送金(未知のチェーン・未知のコントラクトへの送信)を防ぐ。
    function allowlistDestination(uint64 chainSelector, address receiver, bool allowed) external onlyOwner {
        allowlistedDestinations[chainSelector][receiver] = allowed;
    }

    /// @notice 決済トークン amountIn を送り、宛先で Stock Token を recipient に払い出させる。
    /// @dev 事前に paymentToken.approve(address(this SwapSender), amountIn) が必要。
    /// @param minAmountOut 宛先で受け取る Stock Token の最小量(スリッページ保護)。
    ///        下回った場合は宛先側で escrow に退避され、recipient が決済トークンを回収できる。
    function buyStock(
        uint64 destinationChainSelector,
        address receiver,
        uint256 amountIn,
        address recipient,
        uint256 minAmountOut
    ) external payable returns (bytes32 messageId) {
        if (!allowlistedDestinations[destinationChainSelector][receiver]) {
            revert DestinationNotAllowed(destinationChainSelector, receiver);
        }
        if (amountIn == 0) revert NothingToSend();

        paymentToken.safeTransferFrom(msg.sender, address(this), amountIn);
        // Router がトークンを引き取れるように approve(OZ v5 では safeApprove 廃止のため forceApprove)
        paymentToken.forceApprove(address(router), amountIn);

        Client.EVMTokenAmount[] memory tokenAmounts = new Client.EVMTokenAmount[](1);
        tokenAmounts[0] = Client.EVMTokenAmount({ token: address(paymentToken), amount: amountIn });

        Client.EVM2AnyMessage memory message = Client.EVM2AnyMessage({
            receiver: abi.encode(receiver),
            data: abi.encode(recipient, minAmountOut),
            tokenAmounts: tokenAmounts,
            // 宛先で _ccipReceive(価格参照+transfer)を実行するためのガス上限
            extraArgs: Client._argsToBytes(Client.EVMExtraArgsV1({ gasLimit: 400_000 })),
            feeToken: address(0) // native 払い
        });

        uint256 fee = router.getFee(destinationChainSelector, message);
        if (msg.value < fee) revert NotEnoughNativeForFee(msg.value, fee);

        messageId = router.ccipSend{ value: fee }(destinationChainSelector, message);

        // 余剰の native を返金
        if (msg.value > fee) {
            (bool ok, ) = msg.sender.call{ value: msg.value - fee }("");
            if (!ok) revert RefundFailed();
        }

        emit SwapOrderSent(messageId, destinationChainSelector, receiver, recipient, amountIn, minAmountOut, fee);
    }
}
