// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { ERC20 } from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC8056 } from "./interfaces/IERC8056.sol";

/// @title StockToken — Robinhood Chain の Stock Token を模した学習用トークン
/// @notice 実物の Stock Token は Robinhood Assets (Jersey) Ltd が発行する ERC-20（18 decimals）で、
///         コーポレートアクション（株式分割・配当）を ERC-8056 "Scaled UI Amount" の
///         uiMultiplier で表現する。このコントラクトはその仕組みを自分の手で動かして
///         学ぶための再現実装。
/// @dev 実物との対応:
///      - owner = 発行体（issuer）。実物では Authorized Participant（現在は BBVI）だけが
///        発行体との間で subscribe/redeem でき、一般アプリはミント不可。ここでは owner の
///        mint() でそれを模擬する。
///      - 分割・配当は raw balance を変えない。multiplier の予約更新
///        （newUIMultiplier / effectiveAt）で「1トークンあたりの株数」だけが変わる。
contract StockToken is ERC20, Ownable, IERC8056 {
    /// @notice multiplier の固定小数点スケール（1e18 = 1:1）
    uint256 public constant MULTIPLIER_SCALE = 1e18;

    /// 直近に有効化が確定した multiplier
    uint256 private _currentMultiplier;
    /// 予約中の multiplier（_effectiveAt 到達で有効になる）
    uint256 private _pendingMultiplier;
    /// 予約の有効化時刻（0 = 予約なし）
    uint256 private _effectiveAtTimestamp;

    constructor(string memory name_, string memory symbol_) ERC20(name_, symbol_) Ownable(msg.sender) {
        _currentMultiplier = MULTIPLIER_SCALE;
    }

    // ---------------------------------------------------------------
    // ERC-8056 view
    // ---------------------------------------------------------------

    /// @inheritdoc IERC8056
    /// @dev 予約時刻を過ぎていれば pending 値が現在値。トランザクションを追加で
    ///      送らなくても、時間経過だけで自動的に切り替わる。
    function uiMultiplier() public view returns (uint256) {
        if (_effectiveAtTimestamp != 0 && block.timestamp >= _effectiveAtTimestamp) {
            return _pendingMultiplier;
        }
        return _currentMultiplier;
    }

    /// @inheritdoc IERC8056
    function newUIMultiplier() external view returns (uint256) {
        return _pendingMultiplier;
    }

    /// @inheritdoc IERC8056
    function effectiveAt() external view returns (uint256) {
        return _effectiveAtTimestamp;
    }

    /// @inheritdoc IERC8056
    /// @dev underlying shares = raw amount × uiMultiplier / 1e18
    function balanceOfUI(address account) external view returns (uint256) {
        return (balanceOf(account) * uiMultiplier()) / MULTIPLIER_SCALE;
    }

    /// @inheritdoc IERC8056
    function totalSupplyUI() external view returns (uint256) {
        return (totalSupply() * uiMultiplier()) / MULTIPLIER_SCALE;
    }

    // ---------------------------------------------------------------
    // 発行体（owner）専用
    // ---------------------------------------------------------------

    /// @notice 発行体によるミント。実物では Authorized Participant の subscribe に相当し、
    ///         一般のアプリ・ユーザーは決してミントできない（既存トークンと compose するだけ）。
    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice コーポレートアクションの予約。例: 2:1 の株式分割 → 現在の multiplier × 2 を予約。
    /// @param newMultiplier_ 新しい multiplier（1e18 固定小数点）
    /// @param effectiveAt_ 有効化タイムスタンプ（現在以降）
    function scheduleUIMultiplierUpdate(uint256 newMultiplier_, uint256 effectiveAt_) external onlyOwner {
        require(newMultiplier_ > 0, "StockToken: multiplier is zero");
        require(effectiveAt_ >= block.timestamp, "StockToken: effectiveAt in past");

        // すでに有効化済みの予約があれば、それを現在値として確定させてから上書きする
        uint256 old = uiMultiplier();
        _currentMultiplier = old;
        _pendingMultiplier = newMultiplier_;
        _effectiveAtTimestamp = effectiveAt_;

        emit UIMultiplierUpdated(old, newMultiplier_, effectiveAt_);
    }

    // ---------------------------------------------------------------
    // 転送フック
    // ---------------------------------------------------------------

    /// @dev すべての残高変動（mint/burn/transfer）で raw 値と UI 換算値の両方をイベントに残す。
    ///      オフチェーンはこれと UIMultiplierUpdated を購読してコーポレートアクションに追随する。
    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        emit TransferWithScaledUI(from, to, value, (value * uiMultiplier()) / MULTIPLIER_SCALE);
    }
}
