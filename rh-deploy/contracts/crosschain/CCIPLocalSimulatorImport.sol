// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TS テスト・Ignition から CCIPLocalSimulator をデプロイできるように
// artifact を生成させるための import 専用ファイル。
// CCIPLocalSimulator は単一 EVM 内にソース/宛先両方の CCIP Router・
// LINK・テストトークン (CCIP-BnM) を模擬する Chainlink 公式のローカルシミュレータ。
import { CCIPLocalSimulator } from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
