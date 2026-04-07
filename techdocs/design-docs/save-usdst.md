# saveUSDST Technical Spec

Draft: 2026-03-18

## Business Context

The protocol needs `USDST` to do three things well:

1. circulate
2. trade at size
3. be worth holding

The first comes from CDP minting. The second comes from stable liquidity. `saveUSDST` is the third leg: the native hold asset for `USDST`.

This matches the current internal framing:

- mint `USDST` against collateral
- LP in the metastable stable surface
- hold `saveUSDST`

The point of `saveUSDST` is not to replace lending or external yieldcoins. It is to give Mercata a simple native savings product for `USDST` and a clean path from bootstrap incentives to fee-funded savings yield.

## Current Protocol Context

This spec assumes the current Mercata / STRATO product stack has four relevant pieces:

1. `USDST`
   - the protocol stablecoin
   - the unit users mint, borrow, swap, spend, and save

2. `CDP`
   - the lower-cost path for minting new `USDST` against collateral
   - intended to be the primary supply engine for `USDST`

3. Lending pool
   - a separate money market for supplying and borrowing `USDST`
   - yield for suppliers depends on borrow demand and utilization

4. Stable liquidity surface
   - pools that let users move between `USDST` and external stable or yield-bearing assets such as `syrupUSDC`, `sUSDS`, and `sUSDe`

The current strategic picture is:

- CDP grows `USDST` supply
- stable liquidity makes `USDST` usable
- `saveUSDST` creates hold demand

## Definitions

### USDST

The protocol stablecoin. It is the base asset for this spec.

### saveUSDST

The proposed native savings token for `USDST`. Users deposit `USDST` and receive a non-rebasing claim whose value rises over time.

### CDP

Collateralized debt position system. Users lock collateral and mint new `USDST` against it. In current protocol economics, this is the cheaper borrowing path and the main source of new `USDST` circulation.

### Lending pool

Separate from the CDP. Users supply `USDST` or supported collateral to a money market. Supplier yield comes from borrower demand, not from a protocol savings rate.

### safetyUSDST

The safety-module token. It exists for protocol backstop and bad-debt handling. It is not the savings product described here.

### Metastable pool

The main stable liquidity surface for `USDST` against other stable or yield-bearing stable assets. Its job is to keep `USDST` easy to move into and out of at size.

### PSM

Peg stability mechanism. A backstop convertibility path, typically against `USDC` or `USDT`, used to anchor the peg and support arbitrage during larger deviations. It is not intended to be the normal day-to-day user route.

### External yield assets

Stable or dollar-like assets outside the native `saveUSDST` product that already earn yield, such as `syrupUSDC`, `sUSDS`, and `sUSDe`.

## Scope Assumptions

This document assumes:

- `saveUSDST` is a new product, not a rename of an existing token
- the lending pool remains in place
- `safetyUSDST` remains in place
- launch support comes from explicit rewards first
- fee-share support comes later
- collateral use is out of scope for launch

## Product Definition

`saveUSDST` is a non-rebasing, exchange-rate token backed by deposited `USDST`.

User flow:

1. deposit `USDST`
2. receive `saveUSDST`
3. hold while the exchange rate rises
4. redeem back to `USDST`

`saveUSDST` is:

- the savings product for `USDST`
- separate from the lending pool
- separate from `safetyUSDST`
- intended to look and behave like an `sDAI` / `sUSDS` style asset

`saveUSDST` is not:

- a lending-pool receipt token
- a bad-debt recovery token
- a CDP position
- a rebasing balance token

## Goals

- Create a simple reason to hold `USDST`
- Increase sticky `USDST` balances in the system
- Give the protocol a native savings-rate outlet
- Make the asset easy to explain and integrate
- Start with explicit support, then transition to fee share

## Non-Goals

- Do not use `saveUSDST` for protocol safety
- Do not tie core yield to lending-pool utilization
- Do not allow collateral use at launch
- Do not rely on permanent token emissions

## System Model

### Underlying and share asset

- underlying: `USDST`
- share token: `saveUSDST`

### Accounting model

The vault tracks:

- total managed `USDST`
- total `saveUSDST` shares
- user share balances

Economic identity:

- `exchangeRate = totalManagedUSDST / totalSaveUSDSTShares`

User value:

- `userUnderlyingValue = userShares * exchangeRate`

When rewards are added:

- managed `USDST` increases
- share supply stays unchanged
- exchange rate rises

This is the right model for the product because it is simple, non-rebasing, and familiar to users who know `sDAI` or `sUSDS`.

### Accounting requirement

The implementation should account against managed assets, not blindly against raw token balance. Reward injections must be explicit. Unexpected direct transfers should not silently distort the exchange rate.

## Functional Requirements

### User actions

- deposit `USDST`
- mint shares
- withdraw `USDST`
- redeem shares
- view exchange rate
- view current redeemable value

### Protocol / governance actions

- configure or approve any fee-share routing into the product
- pause / unpause if needed
- recover stray assets without affecting core accounting

### Interface shape

The interface should be ERC-4626-shaped:

- `deposit`
- `mint`
- `withdraw`
- `redeem`
- `totalAssets`
- `convertToShares`
- `convertToAssets`
- preview functions

The important point is standard savings-vault semantics, even if the implementation uses repo-specific accounting patterns internally.

## Product Positioning Relative To Existing Components

### Lending pool

The lending pool remains the money-market layer for `USDST`. It is not being replaced.

The reason not to make it the primary savings product is that supplier yield depends on borrow demand in a venue where users already have cheaper ways to borrow through the CDP path. If utilization has to be subsidized to make the savings story work, it is cleaner to support `saveUSDST` directly.

### safetyUSDST

`safetyUSDST` is the safety layer. It exists for bad-debt recovery and protocol backstop functions.

`saveUSDST` is the savings layer. It should not inherit cooldown, slashing, or backstop semantics.

### External yield assets

`saveUSDST` does not need to outyield every external asset in every regime. It does need to be the best native destination for `USDST`.

## Funding Model

### Phase 1: bootstrap incentives

At launch, `saveUSDST` should not use a hard `USDST` cash subsidy as the main incentive.

Reason:

- cheap internal borrow paths make a hard-cash savings subsidy mechanically loopable
- if users can mint or borrow `USDST` below the headline `saveUSDST` rate, the protocol is just paying for a carry trade
- that is especially unattractive before fee-funded yield is real

The launch posture should therefore be:

- no hard-cash `USDST` base subsidy
- use the floating token for temporary promotional incentives if needed
- reserve direct exchange-rate growth for real fee-funded cash flows or very deliberate governance decisions

This keeps early incentives softer, reduces obvious carry extraction, and preserves the long-run meaning of `saveUSDST` as a savings product rather than a farm.

At launch, the exchange rate starts at 1:1 and remains flat. Exchange-rate growth begins when fee-share routing is activated.

### Phase 2: fee-share transition

As protocol revenues grow, part of protocol revenue should be routed to `saveUSDST`.

Candidate sources:

- stability fees
- lending fees
- swap fees
- other protocol revenues, subject to governance choice

### Phase 3: steady state

Long-term target:

- fee-funded base savings rate
- market-level stability fees over time
- temporary token incentives only when strategically justified

The product should move from "promotion-supported" to "fee-supported", not remain a perpetual emissions sink.

## Economics

### Strategic target

The current internal materials imply a working `saveUSDST` hold-demand target around `$20M`.

That is a useful planning target because it is large enough to matter for `USDST` retention, but still small enough to bootstrap deliberately.

### Implied fee-funded base rate

The useful thing about `saveUSDST` is that the long-run exchange-rate growth is modelable before fee share is turned on.

Very roughly:

- `saveUSDST base rate ~= (USDST debt outstanding * stability fee * allocation to saveUSDST) / saveUSDST TVL`

This should be the anchor for the product.

It allows the team to estimate:

- the fee-funded rate the product can support later
- the gap between that rate and the headline launch rate
- how much temporary promotion is actually needed

If the protocol becomes widely used and stability fees rise toward market, the fee-funded base rate should rise with it.

### Launch yield range

The current internal materials point to a visible launch rate in the mid-single digits. That is still the right qualitative range for the headline number.

Recommended working range:

- `5-8%` headline launch APY, assuming the floating token launches and incentives are active

This should be understood as a combined number, not a pure fee-funded rate.

Why:

- below that, the product may not feel different enough from idle `USDST`
- far above that, it starts to look like a short-lived subsidy rather than a real savings product

## Yield Presentation

Users should see one headline yield number.

That is how vault products are understood in practice.

Recommended presentation:

- headline APY: one combined current rate
- below the fold: breakdown by source

The breakdown should separate:

- modeled or actual fee-funded base rate
- temporary floating-token incentive rate
- any other temporary promotional components

The product should not expect users to parse the decomposition before deciding whether the vault is attractive.

At the same time, the protocol must track the decomposition internally so it is always clear which part of the yield is durable and which part is promotional.

## Launch Policy

### Scope

Launch `saveUSDST` as:

- deposit
- hold
- redeem

Only.

### Collateral policy

Do not allow `saveUSDST` as collateral anywhere at launch.

That means:

- no CDP collateral
- no lending-pool collateral

### Rationale

CDP collateral is too reflexive:

- mint `USDST`
- wrap into `saveUSDST`
- use a claim on `USDST` to mint more `USDST`

Lending collateral is more defensible because there is a financing cost and actual pool liquidity constraints. Even so, launch exclusion is still preferable because bootstrap rewards would distort the loop and complicate the rollout.

Future lending-collateral eligibility can be revisited once:

- fee share is the dominant yield source
- bootstrap support is no longer the main APY driver
- haircut, cap, and monitoring policy are defined

CDP collateral should remain out of scope.

## Integrations

The system needs to support:

- wallet / portfolio visibility for `saveUSDST`
- exchange-rate and redeemable-value display
- API endpoints for public and user-specific vault state
- standard preview functions for integrators
- clear labeling distinct from lending and safety

User-facing copy should consistently frame:

- `USDST` as the routing and transaction asset
- `saveUSDST` as the native savings asset

## KPIs

Primary KPIs:

- `saveUSDST` TVL
- share of circulating `USDST` held in `saveUSDST`
- average holding duration
- retention after incentives taper
- share of newly minted / borrowed `USDST` that ends up saved
- fee-share coverage ratio over time

## Risks

- If launch support is too low, users route directly into external yield assets
- If launch support is too high, TVL can become mercenary
- If taper is too sharp, retention will be poor
- If product boundaries are blurry, users will confuse savings, lending, and safety
- If collateral is enabled too early, recursive loops complicate risk before the savings product is proven

## Recommendation

Launch `saveUSDST` as the native savings-rate product for `USDST`.

Keep the story simple:

- mint `USDST`
- use `USDST`
- save `USDST`

Keep the first version simple too:

- exchange-rate token
- no hard-cash `USDST` launch subsidy
- optional floating-token promotional incentives
- later fee share
- no collateral at launch

That is the cleanest way to create durable hold demand for `USDST` without mixing savings, leverage, and safety into one product.

## Implementation Notes

### Existing contract

`SaveUSDSTVault.sol` in `mercata/contracts/concrete/Savings/` already implements the core vault. It is the share token itself (ERC-20), with ERC-4626-shaped deposit / mint / withdraw / redeem and managed-asset accounting.

### Contract interactions at launch

The vault's only runtime dependency is the `USDST` ERC-20 token. It does not interact with the CDP, lending pool, safety module, or any rewards system.

This is the key architectural difference from `SafetyModule` (safetyUSDST), which imports and calls `LendingPool`, `LiquidityPool`, and `LendingRegistry`. `SaveUSDSTVault` is standalone.

At launch:

- `deposit` / `mint`: pull `USDST` from user via `transferFrom`, mint shares
- `withdraw` / `redeem`: burn shares, transfer `USDST` to user
- `exchangeRate`: read-only, returns `totalAssets * 1e18 / totalSupply`

No other contract calls. No external state reads. The vault holds `USDST` and tracks `_managedAssets` internally.

### What `notifyReward` is and when it matters

The current contract has a `notifyReward` method that pulls `USDST` from the owner and adds it to `_managedAssets`, raising the exchange rate for all holders.

At launch, this is unused. The exchange rate is flat at 1:1. Promotional incentives use the floating token through a separate system that does not touch the vault.

When fee-share routing activates (Phase 2), the vault will need a mechanism to receive protocol revenue and credit it as managed assets. Whether that mechanism is the existing `notifyReward` (pull from owner), a push-style `recordTransfer` (like SafetyModule uses for LendingPool), or a continuous drip is a Phase 2 design decision. The launch contract does not need to commit to one.

### Deployment sequence

1. Deploy `SaveUSDSTVault` behind proxy (via `BaseCodeCollection`)
2. Call `initialize(USDST, "Save USDST", "saveUSDST")`
3. Set pause authority
4. Register in UI and API as a first-class product

### UI and API

The system needs:

- public vault state (total assets, total supply, exchange rate)
- user share balance and redeemable value
- deposit and redeem actions

Present `saveUSDST` as its own product, not as a tab inside lending or safety.
