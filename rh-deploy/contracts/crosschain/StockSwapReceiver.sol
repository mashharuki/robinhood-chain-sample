// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { CCIPReceiver } from "@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol";
import { Client } from "@chainlink/contracts-ccip/contracts/libraries/Client.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { AggregatorV3Interface, IPausableOracle } from "../interfaces/AggregatorV3Interface.sol";

/// @title StockSwapReceiver — Robinhood Chain 側で Stock Token を払い出す swap 実行コントラクト
/// @notice CCIP で届いた決済トークン+購入指示を受け、Chainlink フィード価格で
///         Stock Token(mAAPL)をプールから払い出す。価格検証は StockViewer と同じ規律:
///         - フィード価格には uiMultiplier が織込み済み。ここで multiplier を掛けると二重適用。
///         - 24/5 更新のフィードなので staleness 窓はコンストラクタで用途に応じて設定。
///         - コーポレートアクション中(oraclePaused)は約定しない。
/// @dev defensive receiver パターン: ビジネス検証の失敗で revert すると、Router が配送済みの
///      トークンごとメッセージが stuck する。そこで try/catch で失敗を捕捉し、決済トークンを
///      recipient 宛の escrow(refunds)に退避して withdrawFailedSwap で回収可能にする。
contract StockSwapReceiver is CCIPReceiver, Ownable {
    using SafeERC20 for IERC20;

    error SourceNotAllowed(uint64 chainSelector, address sender);
    error OnlySelf();
    error NoRefundAvailable();

    event SwapExecuted(
        bytes32 indexed messageId, address indexed recipient, uint256 amountIn, uint256 amountOut, uint256 price
    );
    event SwapFailed(bytes32 indexed messageId, address indexed recipient, uint256 amountIn, bytes reason);
    event FailedSwapWithdrawn(address indexed recipient, uint256 amount);

    /// @notice フィード価格のスケール(USD フィードは 8 decimals)
    uint256 public constant FEED_SCALE = 1e8;

    /// @notice 払い出す Stock Token(18 decimals)
    IERC20 public immutable stockToken;
    /// @notice 受け取る決済トークン(USDC 役の CCIP-BnM。USD 建て 1:1 とみなす)
    IERC20 public immutable paymentToken;
    /// @notice Stock Token の Chainlink フィード(価格には uiMultiplier 織込み済み)
    AggregatorV3Interface public immutable priceFeed;
    /// @notice 許容する価格経過秒数(24/5 フィードなので週末を跨げる窓にする)
    uint256 public immutable maxStaleness;

    /// @notice 受信を許可する (ソースチェーンセレクタ, Sender アドレス) の組
    mapping(uint64 => mapping(address => bool)) public allowlistedSources;
    /// @notice swap 失敗時に退避された決済トークン(recipient => 量)
    mapping(address => uint256) public refunds;

    constructor(address router_, address stockToken_, address paymentToken_, address priceFeed_, uint256 maxStaleness_)
        CCIPReceiver(router_)
        Ownable(msg.sender)
    {
        stockToken = IERC20(stockToken_);
        paymentToken = IERC20(paymentToken_);
        priceFeed = AggregatorV3Interface(priceFeed_);
        maxStaleness = maxStaleness_;
    }

    /// @notice 受信元の許可設定。未知のチェーン・コントラクトからの注文を拒否する。
    function allowlistSource(uint64 chainSelector, address sender, bool allowed) external onlyOwner {
        allowlistedSources[chainSelector][sender] = allowed;
    }

    /// @dev CCIP Router だけが呼べる(CCIPReceiver の onlyRouter)。
    ///      allowlist 違反はメッセージ自体の受け入れ拒否として revert し、
    ///      ビジネス検証(価格・スリッページ・プール残高)の失敗は escrow に退避する。
    function _ccipReceive(Client.Any2EVMMessage memory message) internal override {
        uint64 srcChain = message.sourceChainSelector;
        address srcSender = abi.decode(message.sender, (address));
        if (!allowlistedSources[srcChain][srcSender]) revert SourceNotAllowed(srcChain, srcSender);

        (address recipient, uint256 minAmountOut) = abi.decode(message.data, (address, uint256));
        uint256 amountIn = message.destTokenAmounts[0].amount;

        // 外部呼び出し経由にすることで revert を catch できるようにする(defensive receiver)
        try this.executeSwap(recipient, amountIn, minAmountOut) returns (uint256 amountOut, uint256 price) {
            emit SwapExecuted(message.messageId, recipient, amountIn, amountOut, price);
        } catch (bytes memory reason) {
            refunds[recipient] += amountIn;
            emit SwapFailed(message.messageId, recipient, amountIn, reason);
        }
    }

    /// @notice swap 本体。this.executeSwap() 経由でのみ呼ばれる(onlySelf)。
    /// @dev 計算式は amountIn × 1e8 / price のみ。uiMultiplier は絶対に掛けない
    ///      (フィード価格に織込み済み — このキット最重要の落とし穴)。
    function executeSwap(address recipient, uint256 amountIn, uint256 minAmountOut)
        external
        returns (uint256 amountOut, uint256 price)
    {
        if (msg.sender != address(this)) revert OnlySelf();

        require(!IPausableOracle(address(priceFeed)).oraclePaused(), "StockSwapReceiver: oracle paused");
        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        require(answer > 0 && updatedAt > 0, "StockSwapReceiver: invalid price");
        require(block.timestamp - updatedAt <= maxStaleness, "StockSwapReceiver: stale price");

        price = uint256(answer);
        amountOut = (amountIn * FEED_SCALE) / price; // 18 decimals
        require(amountOut >= minAmountOut, "StockSwapReceiver: slippage");
        require(stockToken.balanceOf(address(this)) >= amountOut, "StockSwapReceiver: insufficient pool");

        stockToken.safeTransfer(recipient, amountOut);
    }

    /// @notice swap 失敗時に escrow された決済トークンを引き出す。
    function withdrawFailedSwap() external {
        uint256 amount = refunds[msg.sender];
        if (amount == 0) revert NoRefundAvailable();
        refunds[msg.sender] = 0;
        paymentToken.safeTransfer(msg.sender, amount);
        emit FailedSwapWithdrawn(msg.sender, amount);
    }

    /// @notice 発行体役(owner)によるプール補充の逆操作 — 余剰 Stock Token の回収。
    function withdrawStock(address to, uint256 amount) external onlyOwner {
        stockToken.safeTransfer(to, amount);
    }
}
