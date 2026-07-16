# Stock Tokens and Price Feeds

## What Stock Tokens are

Stock Tokens are **tokenized debt securities issued by Robinhood Assets (Jersey) Limited**. Holders get economic exposure to the underlying equity/ETF — not legal share ownership, voting rights, or direct dividend payments. They are self-custodied, live in users' wallets, and are transferable 24/7 (the *underlying* trades on market hours; the token itself is always movable).

- **Standard**: ERC-20, **18 decimals**, plus the **ERC-8056 "Scaled UI Amount" extension** for corporate actions.
- **Issuance**: only Authorized Participants (currently BBVI) can subscribe/redeem with the issuer after KYB onboarding. **Apps compose with existing tokens — you never mint.** Trading model at launch is RFQ-based swaps, but the tokens are ordinary transferable ERC-20s.
- **Compliance**: prohibited in the **US**; restricted in Canada, UK, Switzerland. Design UX and geo-gating accordingly.

## Corporate actions: the uiMultiplier

Dividends and stock splits do NOT change raw balances. Instead an onchain multiplier adjusts the shares-per-token ratio:

```solidity
// ERC-8056 core
function uiMultiplier() external view returns (uint256);      // 1e18 fixed-point; 1e18 = 1:1 (launch value)
function newUIMultiplier() external view returns (uint256);   // pending value
function effectiveAt() external view returns (uint256);       // when pending value activates
function balanceOfUI(address account) external view returns (uint256);  // UI-adjusted balance
function totalSupplyUI() external view returns (uint256);

event UIMultiplierUpdated(uint256 oldMultiplier, uint256 newMultiplier, uint256 effectiveAtTimestamp);
event TransferWithScaledUI(address indexed from, address indexed to, uint256 value, uint256 uiValue);
```

Conversion: `underlying shares = raw token amount × uiMultiplier / 1e18`.

Implications for protocol design:

- Long-term holders' raw balances never change; their *share equivalence* does. Vault/AMM accounting on raw balances is internally consistent, but anything presenting or promising "N shares of AAPL" must read the live multiplier.
- Subscribe to `UIMultiplierUpdated` offchain to react to corporate actions (re-price, notify users, temporarily pause sensitive operations).

## Price feeds (Chainlink)

Chainlink is the exclusive oracle provider. Every stock token has a live per-asset feed implementing the standard interface:

```solidity
interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId, int256 answer, uint256 startedAt,
        uint256 updatedAt, uint80 answeredInRound
    );
    function decimals() external view returns (uint8);
}
```

Rules that matter:

1. **USD feeds use 8 decimals** (e.g. `30000000000` = $300.00); tokens use 18 decimals.
2. **The feed price already includes the corporate-action multiplier.** `feed price = underlying share price × uiMultiplier`. It is the price of *one token*. **Never multiply the feed price by `uiMultiplier()` yourself — that double-counts.**
3. **Stock feeds update 24/5, following market hours.** A fixed short staleness window (e.g. 1 hour) will falsely revert on weekends/holidays. Choose staleness policy per use case: for display, show the timestamp; for lending/liquidation, define explicit market-closed behavior (e.g. block new borrows, don't liquidate on a stale price).
4. **`oraclePaused()` returns `true` during corporate actions** — treat prices as unavailable; staleness validation remains the primary safeguard.
5. **Check the L2 Sequencer Uptime Feed** before trusting prices (standard Chainlink-on-Arbitrum pattern) — prevents acting on stale data during sequencer outages.
6. **Don't hardcode feed addresses** — feed proxies, decimals, and heartbeats are maintained by Chainlink; fetch the current list from Chainlink's Robinhood Chain price feeds page and keep them configurable.

### Canonical valuation pattern

```solidity
function holdingValueUsd(
    IERC20 stockToken,
    AggregatorV3Interface priceFeed,
    address user
) external view returns (uint256) {
    // 1. sequencer uptime check omitted for brevity — do it in production
    uint256 balance = stockToken.balanceOf(user);          // 18 decimals
    (, int256 price, , uint256 updatedAt, ) = priceFeed.latestRoundData(); // 8 decimals
    require(price > 0 && updatedAt > 0, "Invalid price");
    // add staleness policy appropriate to a 24/5 feed here
    return (balance * uint256(price)) / 1e8;               // USD value, 18 decimals
}
```

### Integration checklist

1. Get the token address from the table below (or the docs Contracts page for new listings).
2. Read holdings with plain `balanceOf()`.
3. Read price from the asset's Chainlink feed (`latestRoundData()`, 8 decimals) — multiplier already included.
4. Monitor `UIMultiplierUpdated` for corporate actions; check `oraclePaused()`.
5. Apply staleness + sequencer-uptime checks.

## Token addresses (Robinhood Chain mainnet)

Infrastructure:

| Token | Address |
|---|---|
| WETH | `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73` |
| USDG | `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` |

Stock tokens:

| Ticker | Address |
|---|---|
| AAPL | `0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9` |
| AMD | `0x86923f96303D656E4aa86D9d42D1e57ad2023fdC` |
| AMZN | `0x12f190a9F9d7D37a250758b26824B97CE941bF54` |
| BABA | `0xad25Ac6C84D497db898fa1E8387bf6Af3532a1c4` |
| BE | `0x822CC93fFD030293E9842c30BBD678F530701867` |
| COIN | `0x6330D8C3178a418788dF01a47479c0ce7CCF450b` |
| CRCL | `0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5` |
| CRWV | `0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3` |
| GOOGL | `0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3` |
| INTC | `0xc72b96e0E48ecd4DC75E1e45396e26300BC39681` |
| META | `0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35` |
| MSFT | `0xe93237C50D904957Cf27E7B1133b510C669c2e74` |
| MU | `0xfF080c8ce2E5feadaCa0Da81314Ae59D232d4afD` |
| NVDA | `0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC` |
| ORCL | `0xb0992820E760d836549ba69BC7598b4af75dEE03` |
| PLTR | `0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A` |
| SNDK | `0xB90A19fF0Af67f7779afF50A882A9CfF42446400` |
| SPCX | `0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa` |
| TSLA | `0x322F0929c4625eD5bAd873c95208D54E1c003b2d` |
| USAR | `0xd917B029C761D264c6A312BBbcDA868658eF86a6` |

Tokenized ETFs:

| Ticker | Address |
|---|---|
| QQQ | `0xD5f3879160bc7c32ebb4dC785F8a4F505888de68` |
| SGOV | `0x92FD66527192E3e61d4DDd13322Aa222DE86F9B5` |
| SLV | `0x411eFb0E7f985935DAec3D4C3ebaEa0d0AD7D89f` |
| SPY | `0x117cc2133c37B721F49dE2A7a74833232B3B4C0C` |
| CUSO | `0xa30FA36Db767ad9eD3f7a60fC79526fB4d56D344` |

No testnet stock-token addresses are published — test stock-token integrations by **forking mainnet** (see SKILL.md "Developing and testing").
