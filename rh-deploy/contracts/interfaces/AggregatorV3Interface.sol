// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Chainlink AggregatorV3Interface（学習用に最小定義。Chainlink パッケージは導入しない）
interface AggregatorV3Interface {
    /// @notice USD フィードは 8 decimals（例: 30000000000 = $300.00）
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @title Robinhood Chain の Stock Token フィードが追加で公開する関数
/// @notice コーポレートアクション処理中は true になり、価格を「利用不可」として扱うべき
interface IPausableOracle {
    function oraclePaused() external view returns (bool);
}
