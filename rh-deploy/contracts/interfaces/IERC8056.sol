// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IERC8056 — "Scaled UI Amount" extension (learning copy)
/// @notice Robinhood Chain の Stock Token が実装するコーポレートアクション用の拡張。
///         株式分割や配当は raw balance を変更せず、この multiplier（1e18 固定小数点）で
///         「1トークンあたりの株数」を調整する。
interface IERC8056 {
    /// @notice 現在有効な multiplier。1e18 = 1:1（ローンチ時の値）
    function uiMultiplier() external view returns (uint256);

    /// @notice 予約中（pending）の multiplier
    function newUIMultiplier() external view returns (uint256);

    /// @notice 予約中の multiplier が有効化されるタイムスタンプ（0 = 予約なし）
    function effectiveAt() external view returns (uint256);

    /// @notice UI 換算残高 = balanceOf(account) × uiMultiplier / 1e18（= 株数換算）
    function balanceOfUI(address account) external view returns (uint256);

    /// @notice UI 換算の総供給量
    function totalSupplyUI() external view returns (uint256);

    event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
    event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue);
}
