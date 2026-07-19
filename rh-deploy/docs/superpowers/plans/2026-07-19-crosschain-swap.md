# CCIP準拠クロスチェーンStock Token購入サンプル 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 他チェーンの決済トークン(CCIP-BnM=USDC役)をCCIPで送り、Robinhood Chain役のReceiverがChainlinkフィード価格でmAAPL(既存StockToken)を払い出すクロスチェーンswapサンプルを、CCIPLocalSimulatorで完全ローカルにE2Eテスト可能な形で追加する。

**Architecture:** CCIP programmable token transfer(トークン+データ同時送信)。ソース側`StockSwapSender`が決済トークン+`abi.encode(recipient, minAmountOut)`を`ccipSend`し、宛先側`StockSwapReceiver`(CCIPReceiver継承)がフィード価格検証→mAAPL払出。ビジネス検証失敗時はrevertせずescrow退避(defensive receiverパターン)。テストは`@chainlink/local`のCCIPLocalSimulator(単一EVM内にRouterを模擬)で行う。

**Tech Stack:** Hardhat 3 / Solidity 0.8.28 / forge-std / viem + node:test / Hardhat Ignition / @chainlink/local 0.2.9 / @chainlink/contracts-ccip 1.6.2 / OpenZeppelin 5.x

**Spec:** `docs/superpowers/specs/2026-07-19-crosschain-swap-design.md`

## Global Constraints

- パッケージマネージャは **bun**(コマンドは `bun add` / `bunx hardhat ...`)。プロジェクトはESM(`"type": "module"`)。
- 依存バージョン固定: `@chainlink/local@0.2.9`、`@chainlink/contracts-ccip@1.6.2`、`@chainlink/contracts@1.5.0`(0.2.9のdependenciesと一致させる)。
- 新規Solidityファイルのpragmaは `^0.8.24`(CCIP 1.6.2系と互換を保つ。既存ファイルの`^0.8.28`は変更しない)。
- フィード価格にはuiMultiplierが織込み済み。**swap計算でmultiplierを掛けてはならない**(二重適用禁止)。式は `amountOut = amountIn × 1e8 / price` のみ。
- staleness窓はReceiverのコンストラクタ引数(デフォルト3 days = 259_200秒)。
- コメント・ドキュメントは既存ファイルと同様に日本語で、「実物のCCIP/Stock Tokenとの対応」を説明する学習キット文体に合わせる。
- コミットメッセージ末尾に `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` を付ける。
- 実網(テストネット/メインネット)へのデプロイ・秘密鍵を使う操作は本計画のスコープ外。すべてローカル。

---

### Task 1: 依存関係の追加とビルド基盤

**Files:**
- Modify: `package.json`(bun addによる)
- Create: `contracts/crosschain/CCIPLocalSimulatorImport.sol`
- Modify(必要時のみ): `hardhat.config.ts:9-24`(solidityプロファイル)

**Interfaces:**
- Consumes: なし
- Produces: `@chainlink/local`・`@chainlink/contracts-ccip`のimportが解決しコンパイルが通る状態。`CCIPLocalSimulator`のartifact(TS/Ignitionからデプロイ可能)。

- [ ] **Step 1: 依存を追加**

```bash
bun add @chainlink/local@0.2.9 @chainlink/contracts-ccip@1.6.2 @chainlink/contracts@1.5.0
```

- [ ] **Step 2: artifact生成用のimport専用ファイルを作成**

`contracts/crosschain/CCIPLocalSimulatorImport.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TS テスト・Ignition から CCIPLocalSimulator をデプロイできるように
// artifact を生成させるための import 専用ファイル。
// CCIPLocalSimulator は単一 EVM 内にソース/宛先両方の CCIP Router・
// LINK・テストトークン (CCIP-BnM) を模擬する Chainlink 公式のローカルシミュレータ。
import { CCIPLocalSimulator } from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
```

- [ ] **Step 3: 依存パッケージのpragmaを確認**

```bash
grep -rh "pragma solidity" node_modules/@chainlink/local/src/ccip/ node_modules/@chainlink/contracts-ccip/contracts/libraries/Client.sol node_modules/@chainlink/contracts-ccip/contracts/applications/CCIPReceiver.sol | sort -u
```

Expected: `^0.8.x`系の浮動pragma、または`0.8.24`等の固定pragmaの一覧が出る。

- [ ] **Step 4: コンパイル実行(必要ならコンパイラ設定を追加)**

```bash
bunx hardhat build
```

Expected: `Compiled N Solidity files successfully`。

Step 3で0.8.28に合致しない固定pragma(例: `pragma solidity 0.8.24;`)があってコンパイルが失敗する場合のみ、`hardhat.config.ts`のsolidityプロファイルを複数コンパイラ構成に変更する:

```ts
  solidity: {
    profiles: {
      default: {
        compilers: [{ version: "0.8.28" }, { version: "0.8.24" }],
      },
      production: {
        compilers: [
          { version: "0.8.28", settings: { optimizer: { enabled: true, runs: 200 } } },
          { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
        ],
      },
    },
  },
```

(この形で設定エラーになる場合はHardhat 3のドキュメント https://hardhat.org/docs の「Configuring the compiler」に従い同等の複数バージョン構成にする。)

再度 `bunx hardhat build` が成功すること。

- [ ] **Step 5: 既存テストが壊れていないことを確認**

```bash
bunx hardhat test
```

Expected: 既存のCounter/StockTokenテストが全てPASS。

- [ ] **Step 6: Commit**

```bash
git add package.json bun.lock contracts/crosschain/CCIPLocalSimulatorImport.sol hardhat.config.ts
git commit -m "build: CCIPローカルシミュレータ関連の依存を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: StockSwapSender(ソース側送信コントラクト)

**Files:**
- Create: `contracts/crosschain/StockSwapSender.sol`
- Test: `contracts/crosschain/StockSwapSender.t.sol`

**Interfaces:**
- Consumes: `IRouterClient` / `Client`(@chainlink/contracts-ccip)、OZ `Ownable` / `IERC20` / `SafeERC20`
- Produces(後続タスクが依存):
  - `constructor(address router_, address paymentToken_)`
  - `function buyStock(uint64 destinationChainSelector, address receiver, uint256 amountIn, address recipient, uint256 minAmountOut) external payable returns (bytes32 messageId)`
  - `function allowlistDestination(uint64 chainSelector, address receiver, bool allowed) external`(onlyOwner)
  - `mapping(uint64 => mapping(address => bool)) public allowlistedDestinations`
  - `IERC20 public immutable paymentToken` / `IRouterClient public immutable router`
  - `event SwapOrderSent(bytes32 indexed messageId, uint64 indexed destinationChainSelector, address indexed receiver, address recipient, uint256 amountIn, uint256 minAmountOut, uint256 fee)`
  - errors: `DestinationNotAllowed(uint64,address)` / `NothingToSend()` / `NotEnoughNativeForFee(uint256,uint256)` / `RefundFailed()`

- [ ] **Step 1: 失敗するテストを書く**

`contracts/crosschain/StockSwapSender.t.sol`:

```solidity
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
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
bunx hardhat test solidity
```

Expected: FAIL(`StockSwapSender.sol` が存在せずコンパイルエラー)。

- [ ] **Step 3: 実装を書く**

`contracts/crosschain/StockSwapSender.sol`:

```solidity
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
bunx hardhat test solidity
```

Expected: `StockSwapSenderTest` の5件が全てPASS(既存テストもPASSのまま)。

- [ ] **Step 5: Commit**

```bash
git add contracts/crosschain/StockSwapSender.sol contracts/crosschain/StockSwapSender.t.sol
git commit -m "feat: クロスチェーンswap送信側 StockSwapSender を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: StockSwapReceiver(宛先側swap実行コントラクト)

**Files:**
- Create: `contracts/crosschain/StockSwapReceiver.sol`
- Test: `contracts/crosschain/StockSwapReceiver.t.sol`

**Interfaces:**
- Consumes: `CCIPReceiver` / `Client`(@chainlink/contracts-ccip)、既存 `AggregatorV3Interface` / `IPausableOracle`(`contracts/interfaces/AggregatorV3Interface.sol`)、既存 `StockToken` / `MockPriceFeed`(テストで使用)
- Produces(後続タスクが依存):
  - `constructor(address router_, address stockToken_, address paymentToken_, address priceFeed_, uint256 maxStaleness_)`
  - `function allowlistSource(uint64 chainSelector, address sender, bool allowed) external`(onlyOwner)
  - `function executeSwap(address recipient, uint256 amountIn, uint256 minAmountOut) external returns (uint256 amountOut, uint256 price)`(onlySelf)
  - `function withdrawFailedSwap() external`
  - `function withdrawStock(address to, uint256 amount) external`(onlyOwner)
  - `mapping(address => uint256) public refunds` / `mapping(uint64 => mapping(address => bool)) public allowlistedSources`
  - `IERC20 public immutable stockToken` / `IERC20 public immutable paymentToken` / `AggregatorV3Interface public immutable priceFeed` / `uint256 public immutable maxStaleness`
  - events: `SwapExecuted(bytes32 indexed messageId, address indexed recipient, uint256 amountIn, uint256 amountOut, uint256 price)` / `SwapFailed(bytes32 indexed messageId, address indexed recipient, uint256 amountIn, bytes reason)` / `FailedSwapWithdrawn(address indexed recipient, uint256 amount)`
  - errors: `SourceNotAllowed(uint64,address)` / `OnlySelf()` / `NoRefundAvailable()`

- [ ] **Step 1: 失敗するテストを書く**

`contracts/crosschain/StockSwapReceiver.t.sol`:

```solidity
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
}
```

- [ ] **Step 2: テストが失敗することを確認**

```bash
bunx hardhat test solidity
```

Expected: FAIL(`StockSwapReceiver.sol` が存在せずコンパイルエラー)。

- [ ] **Step 3: 実装を書く**

`contracts/crosschain/StockSwapReceiver.sol`:

```solidity
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
```

- [ ] **Step 4: テストが通ることを確認**

```bash
bunx hardhat test solidity
```

Expected: `StockSwapReceiverTest` の17件が全てPASS(既存テストもPASSのまま)。

注: `CCIPReceiver`と`Ownable`の多重継承で`supportsInterface`等の衝突エラーが出た場合は、CCIP 1.6.2の`CCIPReceiver`定義を確認し、必要なoverrideを追加する(CCIPReceiverはIERC165を実装しているがOwnableとは衝突しないはず)。

- [ ] **Step 5: Commit**

```bash
git add contracts/crosschain/StockSwapReceiver.sol contracts/crosschain/StockSwapReceiver.t.sol
git commit -m "feat: クロスチェーンswap受信側 StockSwapReceiver を追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: CCIPLocalSimulatorによるE2Eテスト(Solidity)

**Files:**
- Test: `contracts/crosschain/StockSwapE2E.t.sol`

**Interfaces:**
- Consumes: Task 2の`StockSwapSender.buyStock` / Task 3の`StockSwapReceiver`一式、`CCIPLocalSimulator.configuration()`(戻り値: `uint64 chainSelector_, IRouterClient sourceRouter_, IRouterClient destinationRouter_, WETH9 wrappedNative_, LinkToken linkToken_, BurnMintERC677Helper ccipBnM_, BurnMintERC677Helper ccipLnM_`)、`BurnMintERC677Helper.drip(address)`(1回で1e18をmint)
- Produces: 送信→Router→受信→払出のフルパイプラインが動く証明。

- [ ] **Step 1: 失敗するテストを書く**

`contracts/crosschain/StockSwapE2E.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Test } from "forge-std/Test.sol";
import {
    CCIPLocalSimulator,
    IRouterClient,
    BurnMintERC677Helper
} from "@chainlink/local/src/ccip/CCIPLocalSimulator.sol";
import { StockToken } from "../StockToken.sol";
import { MockPriceFeed } from "../MockPriceFeed.sol";
import { StockSwapSender } from "./StockSwapSender.sol";
import { StockSwapReceiver } from "./StockSwapReceiver.sol";

/// @notice CCIPLocalSimulator による E2E テスト。
/// 単一 EVM 内にソース/宛先両方の Router を模擬し、
/// 「決済トークン+購入指示の送信 → Router 配送 → フィード価格で mAAPL 払出」の
/// フルパイプラインを検証する。
contract StockSwapE2ETest is Test {
    uint256 constant SCALE = 1e18;
    int256 constant INITIAL_PRICE = 200_00000000; // $200.00
    uint256 constant STALENESS = 3 days;

    CCIPLocalSimulator simulator;
    uint64 chainSelector;
    IRouterClient sourceRouter;
    IRouterClient destinationRouter;
    BurnMintERC677Helper ccipBnM; // USDC 役の決済トークン

    StockToken stock;
    MockPriceFeed feed;
    StockSwapSender sender;
    StockSwapReceiver receiver;

    address alice = makeAddr("alice");

    function setUp() public {
        simulator = new CCIPLocalSimulator();
        (
            uint64 chainSelector_,
            IRouterClient sourceRouter_,
            IRouterClient destinationRouter_,
            ,
            ,
            BurnMintERC677Helper ccipBnM_,
        ) = simulator.configuration();
        chainSelector = chainSelector_;
        sourceRouter = sourceRouter_;
        destinationRouter = destinationRouter_;
        ccipBnM = ccipBnM_;

        stock = new StockToken("Mock Apple Stock Token", "mAAPL");
        feed = new MockPriceFeed(INITIAL_PRICE);
        sender = new StockSwapSender(address(sourceRouter), address(ccipBnM));
        receiver = new StockSwapReceiver(
            address(destinationRouter), address(stock), address(ccipBnM), address(feed), STALENESS
        );

        sender.allowlistDestination(chainSelector, address(receiver), true);
        receiver.allowlistSource(chainSelector, address(sender), true);
        stock.mint(address(receiver), 1_000e18); // 払出プール

        _drip(alice, 100); // 100 BnM = $100 相当
        vm.deal(alice, 10 ether); // CCIP 手数料用
    }

    /// drip は 1 回で 1e18 を mint するため、必要枚数分ループする
    function _drip(address to, uint256 times) internal {
        for (uint256 i = 0; i < times; i++) {
            ccipBnM.drip(to);
        }
    }

    function test_E2E_BuyStockAcrossChains() public {
        vm.startPrank(alice);
        ccipBnM.approve(address(sender), 100e18);
        // $200 で 100 BnM → 0.5 mAAPL
        sender.buyStock{ value: 1 ether }(chainSelector, address(receiver), 100e18, alice, 5e17);
        vm.stopPrank();

        assertEq(stock.balanceOf(alice), 5e17); // 0.5 mAAPL 受領
        assertEq(ccipBnM.balanceOf(alice), 0); // 決済トークンは送信済み
        assertEq(ccipBnM.balanceOf(address(receiver)), 100e18); // 宛先に配送済み
        assertEq(receiver.refunds(alice), 0);
    }

    function test_E2E_SplitHalvedPriceDoublesPayout() public {
        // 2:1 分割: multiplier 2 倍 + フィード価格半減。swap は価格だけを見るので払出は 2 倍。
        stock.scheduleUIMultiplierUpdate(2 * SCALE, block.timestamp);
        feed.setAnswer(100_00000000); // $100

        vm.startPrank(alice);
        ccipBnM.approve(address(sender), 100e18);
        sender.buyStock{ value: 1 ether }(chainSelector, address(receiver), 100e18, alice, 1e18);
        vm.stopPrank();

        assertEq(stock.balanceOf(alice), 1e18); // 分割前(0.5e18)の 2 倍
    }

    function test_E2E_SlippageFailureEscrowsAndWithdraw() public {
        vm.startPrank(alice);
        ccipBnM.approve(address(sender), 100e18);
        // minAmountOut を実際の 0.5e18 より大きくして意図的に失敗させる
        sender.buyStock{ value: 1 ether }(chainSelector, address(receiver), 100e18, alice, 1e18);

        assertEq(stock.balanceOf(alice), 0); // 約定していない
        assertEq(receiver.refunds(alice), 100e18); // escrow に退避

        receiver.withdrawFailedSwap();
        vm.stopPrank();

        assertEq(ccipBnM.balanceOf(alice), 100e18); // 決済トークンを回収
        assertEq(receiver.refunds(alice), 0);
    }
}
```

- [ ] **Step 2: テストを実行して結果を確認**

```bash
bunx hardhat test solidity
```

Expected: `StockSwapE2ETest` の3件がPASS。もし`configuration()`の分割代入で「戻り値の数が合わない」コンパイルエラーが出た場合は、`node_modules/@chainlink/local/src/ccip/CCIPLocalSimulator.sol`の`configuration()`定義を確認して分割代入の要素数・型を合わせる(WETH9等の型importが必要な場合も同ファイルのexportに合わせる)。

- [ ] **Step 3: Commit**

```bash
git add contracts/crosschain/StockSwapE2E.t.sol
git commit -m "test: CCIPLocalSimulator によるクロスチェーンswap E2Eテストを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: TS E2Eテスト(ユーザ視点のフロー)

**Files:**
- Test: `test/CrossChainSwap.ts`

**Interfaces:**
- Consumes: Task 1のartifact(`CCIPLocalSimulator`)、Task 2/3のコントラクト。viemクライアントは既存`test/Counter.ts`と同じ`network.create()`パターン。
- Produces: `bunx hardhat test nodejs`で走るE2Eテスト1本。

- [ ] **Step 1: 失敗するテストを書く**

`test/CrossChainSwap.ts`:

```ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { parseEther } from "viem";

/**
 * クロスチェーンswapのユーザ視点E2E。
 * スクリプト/フロントエンドから見た一連の流れ(approve → buyStock → 残高確認)を検証する。
 * 価格は $2.00 にして「10 mUSD → 5 mAAPL」というキリの良い数字で確認する。
 */
describe("CrossChainSwap (E2E)", async function () {
  const { viem } = await network.create();

  it("他チェーンの決済トークンで mAAPL を購入できる", async function () {
    const [wallet] = await viem.getWalletClients();
    const user = wallet.account.address;

    // --- 環境構築(CCIPシミュレータ + 学習キット一式) ---
    const simulator = await viem.deployContract("CCIPLocalSimulator");
    const config = await simulator.read.configuration();
    // configuration() の戻り: [chainSelector, sourceRouter, destinationRouter, wrappedNative, link, ccipBnM, ccipLnM]
    const chainSelector = config[0];
    const sourceRouter = config[1];
    const destinationRouter = config[2];
    const bnmAddress = config[5];

    const ccipBnM = await viem.getContractAt("BurnMintERC677Helper", bnmAddress);
    const stock = await viem.deployContract("StockToken", ["Mock Apple Stock Token", "mAAPL"]);
    const feed = await viem.deployContract("MockPriceFeed", [2_00000000n]); // $2.00
    const sender = await viem.deployContract("StockSwapSender", [sourceRouter, bnmAddress]);
    const receiver = await viem.deployContract("StockSwapReceiver", [
      destinationRouter,
      stock.address,
      bnmAddress,
      feed.address,
      259_200n, // 3 days
    ]);

    await sender.write.allowlistDestination([chainSelector, receiver.address, true]);
    await receiver.write.allowlistSource([chainSelector, sender.address, true]);
    await stock.write.mint([receiver.address, parseEther("1000")]); // 払出プール

    // --- ユーザの操作: drip で決済トークンを入手(1回 = 1e18) ---
    for (let i = 0; i < 10; i++) {
      await ccipBnM.write.drip([user]);
    }
    assert.equal(await ccipBnM.read.balanceOf([user]), parseEther("10"));

    // --- approve → クロスチェーン購入 ---
    await ccipBnM.write.approve([sender.address, parseEther("10")]);
    await sender.write.buyStock(
      [chainSelector, receiver.address, parseEther("10"), user, parseEther("5")],
      { value: parseEther("1") }, // CCIP手数料(余剰は返金される)
    );

    // --- 検証: $2 × 5 mAAPL = 10 mUSD ---
    assert.equal(await stock.read.balanceOf([user]), parseEther("5"));
    assert.equal(await ccipBnM.read.balanceOf([user]), 0n);
    assert.equal(await ccipBnM.read.balanceOf([receiver.address]), parseEther("10"));
    assert.equal(await receiver.read.refunds([user]), 0n);
  });
});
```

- [ ] **Step 2: コンパイル+型チェック**

```bash
bunx hardhat build && bunx tsc --noEmit
```

Expected: 成功。`deployContract("CCIPLocalSimulator")`や`getContractAt("BurnMintERC677Helper")`で「artifact名が曖昧/見つからない」エラーが出た場合は、fully qualified name(例: `"@chainlink/local/src/ccip/CCIPLocalSimulator.sol:CCIPLocalSimulator"`)に置き換える。

- [ ] **Step 3: テストが通ることを確認**

```bash
bunx hardhat test nodejs
```

Expected: `CrossChainSwap (E2E)` がPASS(既存Counter.tsもPASSのまま)。

- [ ] **Step 4: Commit**

```bash
git add test/CrossChainSwap.ts
git commit -m "test: クロスチェーンswapのTS E2Eテストを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: Ignitionモジュール + CLIタスク(swap:buy / swap:info)

**Files:**
- Create: `ignition/modules/CrossChainSwap.ts`
- Create: `tasks/swap-buy.ts`
- Create: `tasks/swap-info.ts`
- Modify: `tasks/index.ts:142`(配列末尾にタスク2件を追加)
- Modify: `tasks/lib/helpers.ts:29`(`resolveSwapDeployed`を追加)
- Modify: `package.json`(`deploy:swap:local`スクリプト追加)

**Interfaces:**
- Consumes: Task 1-3の全コントラクト、既存`fmtToken`/`fmtUsd8`(tasks/lib/helpers.ts)
- Produces:
  - `CrossChainSwapModule`(returns `{ simulator, stockToken, priceFeed, sender, receiver }`)
  - `resolveSwapDeployed(rootDir: string, chainId: number, contract: "CCIPLocalSimulator" | "StockToken" | "MockPriceFeed" | "StockSwapSender" | "StockSwapReceiver"): Promise<\`0x${string}\`>`
  - CLIタスク `swap:buy` / `swap:info`

- [ ] **Step 1: Ignitionモジュールを書く**

`ignition/modules/CrossChainSwap.ts`:

```ts
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

/**
 * クロスチェーンswap学習キットのデプロイモジュール(ローカル専用)。
 *
 * CCIPLocalSimulator(単一EVM内のCCIP Router模擬)ごとデプロイするため、
 * localhost での学習用。実網では simulator の代わりに実 Router アドレスを
 * Sender/Receiver のコンストラクタに渡す。
 *
 * デプロイされるもの:
 * - CCIPLocalSimulator : Router・LINK・CCIP-BnM(決済トークン役)を内包
 * - StockToken (mAAPL) + MockPriceFeed ($200.00)
 * - StockSwapSender / StockSwapReceiver(相互にallowlist設定済み)
 * - Receiver プールに 1000 mAAPL をミント
 */
export default buildModule("CrossChainSwapModule", (m) => {
  const initialPrice = m.getParameter("initialPrice", 200_00000000n); // $200.00
  const poolSupply = m.getParameter("poolSupply", 1_000n * 10n ** 18n);
  const maxStaleness = m.getParameter("maxStaleness", 259_200n); // 3 days

  const simulator = m.contract("CCIPLocalSimulator");
  const chainSelector = m.staticCall(simulator, "configuration", [], "chainSelector_", { id: "cfgChainSelector" });
  const sourceRouter = m.staticCall(simulator, "configuration", [], "sourceRouter_", { id: "cfgSourceRouter" });
  const destinationRouter = m.staticCall(simulator, "configuration", [], "destinationRouter_", {
    id: "cfgDestinationRouter",
  });
  const ccipBnM = m.staticCall(simulator, "configuration", [], "ccipBnM_", { id: "cfgCcipBnM" });

  const stockToken = m.contract("StockToken", ["Mock Apple Stock Token", "mAAPL"]);
  const priceFeed = m.contract("MockPriceFeed", [initialPrice]);

  const sender = m.contract("StockSwapSender", [sourceRouter, ccipBnM]);
  const receiver = m.contract("StockSwapReceiver", [destinationRouter, stockToken, ccipBnM, priceFeed, maxStaleness]);

  m.call(sender, "allowlistDestination", [chainSelector, receiver, true]);
  m.call(receiver, "allowlistSource", [chainSelector, sender, true]);
  m.call(stockToken, "mint", [receiver, poolSupply]);

  return { simulator, stockToken, priceFeed, sender, receiver };
});
```

注: `m.staticCall`の第4引数は戻り値の名前(`chainSelector_`等)。名前解決に失敗する場合はインデックス(0,1,2,5)に置き換える。

- [ ] **Step 2: helpers.tsにresolverを追加**

`tasks/lib/helpers.ts`の`resolveDeployed`の直後に追加(既存関数は変更しない):

```ts
/** Ignition の deployed_addresses.json から CrossChainSwapModule のアドレスを解決する */
export async function resolveSwapDeployed(
  rootDir: string,
  chainId: number,
  contract: "CCIPLocalSimulator" | "StockToken" | "MockPriceFeed" | "StockSwapSender" | "StockSwapReceiver",
): Promise<`0x${string}`> {
  const file = path.join(rootDir, "ignition", "deployments", `chain-${chainId}`, "deployed_addresses.json");
  let json: Record<string, string>;
  try {
    json = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new Error(
      `chain-${chainId} へのデプロイ記録が見つかりません (${file})。` +
        `先に \`bun run deploy:swap:local\` を実行してください。`,
    );
  }
  const address = json[`CrossChainSwapModule#${contract}`];
  if (address === undefined) {
    throw new Error(`deployed_addresses.json に CrossChainSwapModule#${contract} がありません`);
  }
  return address as `0x${string}`;
}
```

- [ ] **Step 3: swap:info タスクを書く**

`tasks/swap-info.ts`:

```ts
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { fmtToken, fmtUsd8, resolveSwapDeployed } from "./lib/helpers.js";

interface Args {
  holder: string;
}

/**
 * クロスチェーンswapキットの状態を表示する。
 * プール残高・escrow・フィード価格を一覧し、swap:buy の前後で見比べる。
 */
export default async function swapInfo(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const root = hre.config.paths.root;

  const receiver = await viem.getContractAt(
    "StockSwapReceiver",
    await resolveSwapDeployed(root, chainId, "StockSwapReceiver"),
  );
  const stock = await viem.getContractAt("StockToken", await resolveSwapDeployed(root, chainId, "StockToken"));
  const feed = await viem.getContractAt("MockPriceFeed", await resolveSwapDeployed(root, chainId, "MockPriceFeed"));

  const [poolBalance, maxStaleness, roundData, paused] = await Promise.all([
    stock.read.balanceOf([receiver.address]),
    receiver.read.maxStaleness(),
    feed.read.latestRoundData(),
    feed.read.oraclePaused(),
  ]);

  console.log("クロスチェーンswapキットの状態");
  console.log(`  mAAPL プール残高        : ${fmtToken(poolBalance)} mAAPL`);
  console.log(`  フィード価格            : ${fmtUsd8(roundData[1])} (oraclePaused: ${paused})`);
  console.log(`  staleness 許容窓        : ${maxStaleness} 秒`);

  if (args.holder) {
    const holder = args.holder as `0x${string}`;
    const [stockBal, refund] = await Promise.all([
      stock.read.balanceOf([holder]),
      receiver.read.refunds([holder]),
    ]);
    console.log(`  ${holder} の mAAPL      : ${fmtToken(stockBal)}`);
    console.log(`  ${holder} の escrow     : ${fmtToken(refund)} (swap失敗時の退避分。withdrawFailedSwapで回収)`);
  }
}
```

- [ ] **Step 4: swap:buy タスクを書く**

`tasks/swap-buy.ts`:

```ts
import type { HardhatRuntimeEnvironment } from "hardhat/types/hre";
import { parseEther } from "viem";
import { fmtToken, resolveSwapDeployed } from "./lib/helpers.js";

interface Args {
  amount: string;
  min: string;
}

/**
 * クロスチェーン購入を実行する:
 * 1. CCIP-BnM を drip で入手(1回 = 1トークン)
 * 2. Sender に approve
 * 3. buyStock で送信 → シミュレータの Router が即時配送 → mAAPL 受領
 */
export default async function swapBuy(args: Args, hre: HardhatRuntimeEnvironment) {
  const { viem } = await hre.network.create();
  const publicClient = await viem.getPublicClient();
  const chainId = await publicClient.getChainId();
  const root = hre.config.paths.root;
  const [wallet] = await viem.getWalletClients();
  if (!wallet) throw new Error("ウォレットがありません(localhost で実行してください)");
  const user = wallet.account.address;

  const simulator = await viem.getContractAt(
    "CCIPLocalSimulator",
    await resolveSwapDeployed(root, chainId, "CCIPLocalSimulator"),
  );
  const sender = await viem.getContractAt(
    "StockSwapSender",
    await resolveSwapDeployed(root, chainId, "StockSwapSender"),
  );
  const receiverAddress = await resolveSwapDeployed(root, chainId, "StockSwapReceiver");
  const stock = await viem.getContractAt("StockToken", await resolveSwapDeployed(root, chainId, "StockToken"));

  const config = await simulator.read.configuration();
  const chainSelector = config[0];
  const ccipBnM = await viem.getContractAt("BurnMintERC677Helper", config[5]);

  const amountIn = parseEther(args.amount);
  const minOut = parseEther(args.min);

  // drip は 1 回 1e18。必要枚数分入手する(学習用なので端数は切り上げ)
  const drips = Number((amountIn + 10n ** 18n - 1n) / 10n ** 18n);
  console.log(`CCIP-BnM を ${drips} 回 drip して決済トークンを入手...`);
  for (let i = 0; i < drips; i++) {
    await ccipBnM.write.drip([user]);
  }

  await ccipBnM.write.approve([sender.address, amountIn]);
  console.log(`buyStock: ${args.amount} BnM → mAAPL (minOut: ${args.min})`);
  await sender.write.buyStock([chainSelector, receiverAddress, amountIn, user, minOut], {
    value: parseEther("1"), // 手数料(余剰は自動返金)
  });

  const [stockBal, bnmBal] = await Promise.all([stock.read.balanceOf([user]), ccipBnM.read.balanceOf([user])]);
  console.log("完了:");
  console.log(`  mAAPL 残高   : ${fmtToken(stockBal)}`);
  console.log(`  BnM 残高     : ${fmtToken(bnmBal)}`);
  console.log(`  ※ minOut を高くしすぎると escrow に退避される — swap:info --holder ${user} で確認`);
}
```

- [ ] **Step 5: tasks/index.ts に登録**

`tasks/index.ts`の配列末尾(`stock:live`タスクの`.build(),`の後、`];`の前)に追加:

```ts
  task("swap:buy", "クロスチェーン購入を実行(drip → approve → buyStock → mAAPL 受領)")
    .addOption({
      name: "amount",
      description: "決済トークン量(トークン単位。例: 10)",
      type: ArgumentType.STRING,
      defaultValue: "10",
    })
    .addOption({
      name: "min",
      description: "最小受取 mAAPL 量(スリッページ保護。例: 0.05)",
      type: ArgumentType.STRING,
      defaultValue: "0",
    })
    .setAction(() => import("./swap-buy.js"))
    .build(),

  task("swap:info", "クロスチェーンswapキットの状態(プール・価格・escrow)を表示")
    .addOption({
      name: "holder",
      description: "残高・escrow を照会するアドレス(任意)",
      type: ArgumentType.STRING,
      defaultValue: "",
    })
    .setAction(() => import("./swap-info.js"))
    .build(),
```

- [ ] **Step 6: package.json にデプロイスクリプトを追加**

`package.json`の`scripts`に追加:

```json
    "deploy:swap:local": "bunx hardhat ignition deploy ./ignition/modules/CrossChainSwap.ts --network localhost"
```

- [ ] **Step 7: ローカルノードでウォークスルーを実際に実行して検証**

ターミナルAで(バックグラウンド起動でもよい):

```bash
bunx hardhat node
```

ターミナルBで:

```bash
bun run deploy:swap:local
bunx hardhat swap:info --network localhost
bunx hardhat swap:buy --amount 10 --network localhost
```

Expected:
- deploy成功(`CrossChainSwapModule#StockSwapReceiver`等のアドレスが表示される)
- `swap:info`: プール残高 1000 mAAPL、価格 $200.00
- `swap:buy`: mAAPL残高 `0.05`(= 10 / 200)が表示される

`m.staticCall`の名前解決エラーが出た場合はStep 1の注に従いインデックス指定に修正して再実行。検証後、ノードを停止。

- [ ] **Step 8: 型チェックと全テスト**

```bash
bunx hardhat build && bunx tsc --noEmit && bunx hardhat test
```

Expected: すべて成功。

- [ ] **Step 9: Commit**

```bash
git add ignition/modules/CrossChainSwap.ts tasks/swap-buy.ts tasks/swap-info.ts tasks/index.ts tasks/lib/helpers.ts package.json
git commit -m "feat: クロスチェーンswapのIgnitionモジュールとCLIタスクを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: 学習ドキュメントと最終検証

**Files:**
- Create: `docs/crosschain-swap-learning.md`
- Modify: `README.md:9`(Stock Token学習キットの注記の直後にポインタを追記)

**Interfaces:**
- Consumes: Task 1-6の成果物すべて
- Produces: ウォークスルー文書。最終検証済みのブランチ。

- [ ] **Step 1: 学習ドキュメントを書く**

`docs/crosschain-swap-learning.md` を作成する。`docs/stocktoken-learning.md`と同じ文体・構成(冒頭に要点、構成テーブル、ウォークスルー、落とし穴、スコープ外)で、以下の内容を含める:

```markdown
# クロスチェーンswap学習キット(Chainlink CCIP)

「他チェーンの資金で Robinhood Chain の Stock Token を買う」を、Chainlink CCIP の
**programmable token transfer**(トークン+データ同時送信)で実装した学習キット。
実 CCIP と同じ interface(IRouterClient / CCIPReceiver / Client)に準拠し、
`@chainlink/local` の CCIPLocalSimulator で完全ローカルに動かす。

## 要点 5 つ

1. **CCIP はトークンとデータを 1 メッセージで送れる**。このキットでは決済トークン
   (CCIP-BnM = USDC 役)と `abi.encode(recipient, minAmountOut)` を同時に送る。
2. **受信側は CCIPReceiver を継承し、Router だけが `ccipReceive` を呼べる**。
   さらにソースチェーン/送信者の allowlist で未知の注文を拒否する。
3. **defensive receiver パターン**: トークン+データ転送で `_ccipReceive` が revert すると
   配送済みトークンごとメッセージが stuck する。ビジネス検証(価格・スリッページ・
   プール残高)の失敗は try/catch で捕捉して escrow に退避し、`withdrawFailedSwap` で
   回収可能にする。
4. **swap 計算はフィード価格だけを使う**: `amountOut = amountIn × 1e8 / price`。
   フィード価格には uiMultiplier が織込み済みなので、multiplier を掛けると二重適用になる
   (Stock Token 学習キットと同じ最重要の落とし穴)。分割が起きるとフィード価格が変わり、
   払出枚数は自動的に追随する。
5. **Robinhood Chain では CCIP が稼働しているが Router 実アドレスは公式未公開**。
   このキットのコントラクトは実 CCIP interface 準拠なので、アドレス判明後は
   コンストラクタの Router を差し替えるだけでテストネット/メインネットに移行できる。

## このキットの構成

| ファイル | 役割 |
|---|---|
| `contracts/crosschain/StockSwapSender.sol` | ソース側。決済トークン+購入指示を ccipSend(手数料 native 払い・余剰返金) |
| `contracts/crosschain/StockSwapReceiver.sol` | 宛先側。フィード価格検証 → mAAPL 払出。失敗時は escrow 退避 |
| `contracts/crosschain/CCIPLocalSimulatorImport.sol` | CCIPLocalSimulator の artifact 生成用 import |
| `contracts/crosschain/StockSwapSender.t.sol` | Sender 単体テスト(ガード・権限) |
| `contracts/crosschain/StockSwapReceiver.t.sol` | Receiver 単体テスト(Router を prank で演じ swap ロジックを網羅) |
| `contracts/crosschain/StockSwapE2E.t.sol` | CCIPLocalSimulator によるフルパイプライン E2E |
| `test/CrossChainSwap.ts` | ユーザ視点の TS E2E |
| `ignition/modules/CrossChainSwap.ts` | ローカルウォークスルー用デプロイ(localhost 専用) |
| `tasks/swap-buy.ts` / `tasks/swap-info.ts` | 学習用 CLI タスク |

## ウォークスルー: ローカルでクロスチェーン購入を体験する

ターミナル A:

    bunx hardhat node

ターミナル B:

    # デプロイ(simulator + mAAPL + フィード $200 + Sender/Receiver + プール 1000 mAAPL)
    bun run deploy:swap:local

    # 状態確認
    bunx hardhat swap:info --network localhost

    # 10 BnM($10 相当)で購入 → $200 なので 0.05 mAAPL
    bunx hardhat swap:buy --amount 10 --network localhost

    # スリッページ保護を意図的に発動させる(--min を不可能な値に)
    bunx hardhat swap:buy --amount 10 --min 1 --network localhost
    # → mAAPL は増えず、escrow に退避される。swap:info --holder <自分> で確認し、
    #   StockSwapReceiver.withdrawFailedSwap() で回収できる

    # 株式分割を起こしてから買うと払出枚数が変わることも確認できる
    # (stock:set-price でフィード価格を半分にする — 実世界の 2:1 分割相当)
    bunx hardhat stock:set-price --price 100 --network localhost   # ※ CrossChainSwapModule の feed を --feed で指定
    bunx hardhat swap:buy --amount 10 --network localhost          # → 0.1 mAAPL(2 倍)

## テスト

    bunx hardhat test            # 全部
    bunx hardhat test solidity   # Solidity のみ(単体 + E2E)
    bunx hardhat test nodejs     # TS のみ

## スコープ外(将来課題)

- 実網デプロイ(CCIP Router 実アドレスの公式公開待ち)
- 売り方向(mAAPL → 他チェーン)・CCT(独自トークンのクロスチェーン化)・LINK 建て手数料
```

(`stock:set-price`はStockTokenModule用のresolverを使うため、CrossChainSwapModuleのfeedアドレスを`--feed`で明示する必要がある — ウォークスルー内の注記の通り。)

- [ ] **Step 2: READMEにポインタを追記**

`README.md`のStock Token学習キット注記(`> **Stock Token 学習キット**: ...`)の直後に追加:

```markdown
> **クロスチェーンswap学習キット**: Chainlink CCIP の programmable token transfer で「他チェーンの資金で Stock Token を買う」を体験するキットを同梱。使い方は [docs/crosschain-swap-learning.md](./docs/crosschain-swap-learning.md) を参照。
```

- [ ] **Step 3: 最終検証(全ビルド・型チェック・全テスト)**

```bash
bunx hardhat build && bunx tsc --noEmit && bunx hardhat test
```

Expected: コンパイル成功、型エラーなし、全テスト(既存 + Sender単体5 + Receiver単体17 + E2E 3 + TS 1)PASS。

- [ ] **Step 4: Commit**

```bash
git add docs/crosschain-swap-learning.md README.md
git commit -m "docs: クロスチェーンswap学習キットのウォークスルーを追加

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
