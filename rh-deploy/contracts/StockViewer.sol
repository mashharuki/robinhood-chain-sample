// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC8056 } from "./interfaces/IERC8056.sol";
import { AggregatorV3Interface, IPausableOracle } from "./interfaces/AggregatorV3Interface.sol";

/// @title StockViewer — Stock Token を「消費する側」の正しい統合パターンの見本
/// @notice Robinhood Chain 上の DeFi/ポートフォリオアプリが Stock Token を評価するときの
///         canonical パターンを実装した read-only コントラクト。
contract StockViewer {
    /// @notice 保有トークンの USD 評価額（18 decimals）を返す
    /// @dev 重要: フィード価格（8 decimals）には uiMultiplier が既に織り込まれている。
    ///      ここで token.uiMultiplier() を掛けると二重適用になり評価額が壊れる。
    ///      正しい式は balanceOf × price / 1e8 だけ。
    /// @param maxStaleness 許容する価格の経過秒数。実フィードは 24/5 更新なので、
    ///        用途に応じて選ぶ（週末を跨ぐなら 1 時間などの固定値は誤作動する）。
    function holdingValueUsd(IERC20 stockToken, AggregatorV3Interface priceFeed, address user, uint256 maxStaleness)
        external
        view
        returns (uint256)
    {
        // 実運用ではさらに L2 Sequencer Uptime Feed の確認を挟む（Chainlink on Arbitrum の定石）
        require(!IPausableOracle(address(priceFeed)).oraclePaused(), "StockViewer: oracle paused");

        uint256 balance = stockToken.balanceOf(user); // 18 decimals
        (, int256 price,, uint256 updatedAt,) = priceFeed.latestRoundData(); // 8 decimals
        require(price > 0 && updatedAt > 0, "StockViewer: invalid price");
        require(block.timestamp - updatedAt <= maxStaleness, "StockViewer: stale price");

        return (balance * uint256(price)) / 1e8; // USD, 18 decimals
    }

    /// @notice 保有トークンの株数換算（18 decimals）
    /// @dev 「N 株の AAPL」を表示・約束するものだけが multiplier を読む。
    ///      raw balance ベースの会計（vault のシェア計算など）は multiplier を読む必要がない。
    function sharesOf(IERC8056 stockToken, address user) external view returns (uint256) {
        return stockToken.balanceOfUI(user);
    }
}
