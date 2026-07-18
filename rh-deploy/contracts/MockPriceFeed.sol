// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { AggregatorV3Interface, IPausableOracle } from "./interfaces/AggregatorV3Interface.sol";

/// @title MockPriceFeed — Chainlink フィードを模した学習用オラクル
/// @notice 実物では Chainlink が唯一のオラクルプロバイダで、各 Stock Token に USD フィード
///         （8 decimals）がある。重要な性質:
///         - フィード価格には uiMultiplier が既に織り込まれている（= 1トークンの価格）。
///           自分で multiplier を掛けてはいけない（二重適用になる）。
///         - 株式フィードは 24/5（市場時間）でしか更新されない → 固定の短い staleness
///           チェックは週末に誤作動する。
///         - コーポレートアクション中は oraclePaused() が true になる。
contract MockPriceFeed is Ownable, AggregatorV3Interface, IPausableOracle {
    uint80 private _roundId;
    int256 private _answer;
    uint256 private _updatedAt;
    bool private _oraclePaused;

    /// @param initialAnswer 初期価格（8 decimals。例: 200_00000000 = $200.00）
    constructor(int256 initialAnswer) Ownable(msg.sender) {
        _setAnswer(initialAnswer);
    }

    /// @notice USD フィードは 8 decimals（トークンの 18 decimals と混同しないこと）
    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)
    {
        return (_roundId, _answer, _updatedAt, _updatedAt, _roundId);
    }

    /// @inheritdoc IPausableOracle
    function oraclePaused() external view returns (bool) {
        return _oraclePaused;
    }

    /// @notice 価格を更新（Chainlink ノード群の役を演じる）
    function setAnswer(int256 answer) external onlyOwner {
        _setAnswer(answer);
    }

    /// @notice コーポレートアクション中のオラクル停止を模擬
    function setOraclePaused(bool paused) external onlyOwner {
        _oraclePaused = paused;
    }

    function _setAnswer(int256 answer) private {
        _roundId += 1;
        _answer = answer;
        _updatedAt = block.timestamp;
    }
}
