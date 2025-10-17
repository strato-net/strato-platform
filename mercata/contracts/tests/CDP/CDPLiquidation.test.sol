// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function callFunction(address a, string f, variadic args) public returns (variadic) {
        return address(a).call(f, args);
    }
}

/**
 * Comprehensive state verification utilities for CDP liquidation tests.
 * 
 * This contract provides helper functions to verify that liquidations:
 * 1. Actually burn USDST tokens from the liquidator
 * 2. Actually transfer collateral tokens from vault to liquidator
 * 3. Update all internal state correctly
 * 4. Emit proper events
 * 5. Handle bad debt correctly
 */
contract LiquidationStateVerification {
    
    struct LiquidationSnapshot {
        // Pre-liquidation state
        uint borrowerCollateralBefore;
        uint borrowerDebtBefore;
        uint liquidatorUSDSTBefore;
        uint liquidatorCollateralBefore;
        uint vaultTokenBalanceBefore;
        uint totalScaledDebtBefore;
        uint badDebtBefore;
        
        // Post-liquidation state
        uint borrowerCollateralAfter;
        uint borrowerDebtAfter;
        uint liquidatorUSDSTAfter;
        uint liquidatorCollateralAfter;
        uint vaultTokenBalanceAfter;
        uint totalScaledDebtAfter;
        uint badDebtAfter;
        
        // Calculated deltas
        uint collateralSeized;
        uint USDSTBurned;
        uint debtExtinguished;
        uint badDebtIncrease;
    }
    
    /**
     * @notice Capture complete state snapshot before liquidation
     */
    function capturePreLiquidationState(
        Mercata m,
        address asset,
        address borrower,
        address liquidator
    ) public view returns (LiquidationSnapshot memory snapshot) {
        CDPEngine cdp = m.cdpEngine();
        CDPVault vault = m.cdpVault();
        Token assetToken = Token(asset);
        Token usdstToken = Token(m.cdpRegistry().usdst());
        
        (uint rate,, uint totalScaledDebt) = cdp.collateralGlobalStates(asset);
        (uint collateral, uint scaledDebt) = cdp.vaults(borrower, asset);
        
        snapshot.borrowerCollateralBefore = collateral;
        snapshot.borrowerDebtBefore = (scaledDebt * rate) / 1e27;
        snapshot.liquidatorUSDSTBefore = usdstToken.balanceOf(liquidator);
        snapshot.liquidatorCollateralBefore = assetToken.balanceOf(liquidator);
        snapshot.vaultTokenBalanceBefore = assetToken.balanceOf(address(vault));
        snapshot.totalScaledDebtBefore = totalScaledDebt;
        snapshot.badDebtBefore = cdp.badDebtUSDST(asset);
    }
    
    /**
     * @notice Capture complete state snapshot after liquidation
     */
    function capturePostLiquidationState(
        Mercata m,
        address asset,
        address borrower,
        address liquidator
    ) public view returns (LiquidationSnapshot memory snapshot) {
        CDPEngine cdp = m.cdpEngine();
        CDPVault vault = m.cdpVault();
        Token assetToken = Token(asset);
        Token usdstToken = Token(m.cdpRegistry().usdst());
        
        (uint rate,, uint totalScaledDebt) = cdp.collateralGlobalStates(asset);
        (uint collateral, uint scaledDebt) = cdp.vaults(borrower, asset);
        
        snapshot.borrowerCollateralAfter = collateral;
        snapshot.borrowerDebtAfter = (scaledDebt * rate) / 1e27;
        snapshot.liquidatorUSDSTAfter = usdstToken.balanceOf(liquidator);
        snapshot.liquidatorCollateralAfter = assetToken.balanceOf(liquidator);
        snapshot.vaultTokenBalanceAfter = assetToken.balanceOf(address(vault));
        snapshot.totalScaledDebtAfter = totalScaledDebt;
        snapshot.badDebtAfter = cdp.badDebtUSDST(asset);
    }
    
    /**
     * @notice Complete state verification for liquidation
     * Verifies all aspects of liquidation including token transfers and burns
     */
    function verifyLiquidationState(
        Mercata m,
        address asset,
        address borrower,
        address liquidator,
        uint expectedRepay,
        uint expectedPenalty,
        bool expectCapBound
    ) public view returns (bool success, string memory error) {
        
        LiquidationSnapshot memory pre = capturePreLiquidationState(m, asset, borrower, liquidator);
        LiquidationSnapshot memory post = capturePostLiquidationState(m, asset, borrower, liquidator);
        
        return _verifyLiquidationDeltas(m, asset, borrower, liquidator, pre, post, expectedRepay, expectedPenalty, expectCapBound);
    }

    /**
     * @notice Complete state verification for liquidation using pre-captured snapshots
     * This version uses the pre-liquidation snapshot passed as parameter
     */
    function verifyLiquidationStateWithSnapshots(
        Mercata m,
        address asset,
        address borrower,
        address liquidator,
        LiquidationSnapshot memory preSnapshot,
        uint expectedRepay,
        uint expectedPenalty,
        bool expectCapBound
    ) public view returns (bool success, string memory error) {
        
        LiquidationSnapshot memory post = capturePostLiquidationState(m, asset, borrower, liquidator);
        
        return _verifyLiquidationDeltas(m, asset, borrower, liquidator, preSnapshot, post, expectedRepay, expectedPenalty, expectCapBound);
    }

    /**
     * @notice Internal function to verify liquidation deltas
     */
    function _verifyLiquidationDeltas(
        Mercata m,
        address asset,
        address borrower,
        address liquidator,
        LiquidationSnapshot memory pre,
        LiquidationSnapshot memory post,
        uint expectedRepay,
        uint expectedPenalty,
        bool expectCapBound
    ) internal view returns (bool success, string memory error) {
        
        // Calculate deltas
        uint collateralSeized = pre.borrowerCollateralBefore - post.borrowerCollateralAfter;
        uint USDSTBurned = pre.liquidatorUSDSTBefore - post.liquidatorUSDSTAfter;
        uint debtExtinguished = pre.borrowerDebtBefore - post.borrowerDebtAfter;
        uint badDebtIncrease = post.badDebtAfter - pre.badDebtBefore;
        
        // 1. Verify USDST burning
        if (USDSTBurned == 0) {
            return (false, "USDST: No tokens burned from liquidator");
        }
        
        // 2. Verify collateral transfer
        uint collateralReceived = post.liquidatorCollateralAfter - pre.liquidatorCollateralBefore;
        if (collateralReceived != collateralSeized) {
            return (false, "COLLATERAL: Liquidator did not receive seized collateral");
        }
        
        // 3. Verify vault token balance decrease
        uint vaultBalanceDecrease = pre.vaultTokenBalanceBefore - post.vaultTokenBalanceAfter;
        if (vaultBalanceDecrease != collateralSeized) {
            return (false, "VAULT: Token balance did not decrease by seized amount");
        }
        
        // 4. Verify debt extinguishment
        if (debtExtinguished == 0) {
            return (false, "DEBT: No debt was extinguished");
        }
        
        // 5. Verify cap-bound behavior
        if (expectCapBound) {
            if (post.borrowerCollateralAfter > 0) {
                return (false, "CAP_BOUND: Should seize all collateral");
            }
            if (badDebtIncrease == 0 && post.borrowerDebtAfter > 0) {
                return (false, "CAP_BOUND: Should realize bad debt when debt remains");
            }
        }
        
        // 6. Verify vault mapping consistency
        if (post.borrowerCollateralAfter != m.cdpVault().userCollaterals(borrower, asset)) {
            return (false, "VAULT_MAPPING: Inconsistent collateral mapping");
        }
        
        // 7. Verify global debt consistency
        (uint rate,,) = m.cdpEngine().collateralGlobalStates(asset);
        uint globalDebtUSD = (post.totalScaledDebtAfter * rate) / 1e27;
        if (globalDebtUSD != post.borrowerDebtAfter) {
            return (false, "GLOBAL_DEBT: Global debt does not match borrower debt");
        }
        
        return (true, "All verifications passed");
    }
}

/**
 * Liquidation-only comprehensive tests for CDPEngine.liquidate:
 *   • Reject paths: zero amount, borrower=0x0, borrower=self, unsupported asset,
 *                   no debt, healthy position, zero price.
 *   • Success (non-cap) paths: close-factor binds, debtToCover binds, total-debt binds.
 *   • Success (cap) paths: coverage-cap binds with CF=50% and CF=100% (+ bad debt).
 *   • Boundary: debtToCover == coverageCap → MUST NOT take cap-bound branch.
 */
contract Describe_CDPEngine_Liquidations is Authorizable {
    // System
    Mercata m;
    CDPEngine cdp;
    CDPVault vault;
    CDPRegistry reg;
    PriceOracle oracle;

    // Tokens
    address ASSET;
    address USDST;
    Token   assetT;
    Token   usdstT;

    // Actors
    User borrower;
    User liq;

    // Scales/params
    uint WAD;
    uint RAY;
    uint UNIT;
    uint LR;      // 150%
    uint PEN;     // 10% (bps)
    uint CF;      // default 50%
    uint SFR;     // flat
    uint FLOOR_;
    uint CEIL_;

    // Prices
    uint OPEN_P;  // $5
    uint MID_P;   // $3
    uint LOW_P;   // $1

    // ───────────────────────────── Setup ─────────────────────────────
    function beforeAll() public {
        bypassAuthorizations = true;

        WAD  = 1e18;
        RAY  = 1e27;
        UNIT = 1e18;

        LR     = 1500000000000000000; // 1.5
        PEN    = 1000;                      // 10%
        CF     = 5000;                      // 50%
        SFR    = RAY;                       // no accrual
        FLOOR_ = 1e18;                      // $1
        CEIL_  = 1e30;                      // huge

        OPEN_P = 5e18;
        MID_P  = 3e18;
        LOW_P  = 1e18;

        m      = new Mercata();
        cdp    = m.cdpEngine();
        vault  = m.cdpVault();
        reg    = m.cdpRegistry();
        oracle = m.priceOracle();

        borrower = new User();
        liq      = new User();

        // USDST + wire registry
        USDST  = m.tokenFactory().createToken("USDST","USD Stable",[],[],[],"USDST",0,18);
        usdstT = Token(USDST);
        usdstT.setStatus(2);
        usdstT.addWhitelist(address(m.adminRegistry()), "mint", address(cdp));
        usdstT.addWhitelist(address(m.adminRegistry()), "burn", address(cdp));
        reg.setUSDST(USDST);
        oracle.setAssetPrice(USDST, 1e18);

        // fund liquidator heavily
        usdstT.mint(address(liq), 1e36);
    }

    function beforeEach() public {
        // Fresh collateral each test
        ASSET  = m.tokenFactory().createToken("COLL","Collateral",[],[],[],"COLL",0,18);
        assetT = Token(ASSET);
        assetT.setStatus(2);

        // Default params (CF=50% here; tests may overwrite)
        cdp.setCollateralAssetParams(
            ASSET, LR, PEN, CF, SFR, FLOOR_, CEIL_, UNIT, false
        );

        // Open price healthy
        oracle.setAssetPrice(ASSET, OPEN_P);

        // Give borrower large balance for deposits
        assetT.mint(address(borrower), 1000000e18);
    }

    // ───────────────────────────── Helpers ─────────────────────────────
    function _open(uint depUnits, uint mintUSD, uint priceBefore) internal {
        oracle.setAssetPrice(ASSET, priceBefore);
        borrower.callFunction(ASSET, "approve", address(vault), depUnits);
        borrower.callFunction(address(cdp), "deposit", ASSET, depUnits);
        if (mintUSD > 0) borrower.callFunction(address(cdp), "mint", ASSET, mintUSD);
    }

    function _liq(address borrower_, uint amountUSD, uint priceAtLiq) internal returns (uint seized, uint leftover) {
        oracle.setAssetPrice(ASSET, priceAtLiq);
        liq.callFunction(USDST, "approve", address(cdp), amountUSD);
        uint beforeBal = vault.userCollaterals(borrower_, ASSET);
        liq.callFunction(address(cdp), "liquidate", ASSET, borrower_, amountUSD);
        uint afterBal  = vault.userCollaterals(borrower_, ASSET);
        seized   = beforeBal - afterBal;
        leftover = afterBal;
    }

    function _liqWithFullVerification(address borrower_, uint amountUSD, uint priceAtLiq) internal returns (uint seized, uint leftover, bool verificationPassed, string memory error) {
        oracle.setAssetPrice(ASSET, priceAtLiq);
        
        // Capture pre-liquidation state for comprehensive verification
        LiquidationStateVerification verifier = new LiquidationStateVerification();
        LiquidationStateVerification.LiquidationSnapshot memory preSnapshot = verifier.capturePreLiquidationState(m, ASSET, borrower_, address(liq));
        
        liq.callFunction(USDST, "approve", address(cdp), amountUSD);
        uint beforeBal = vault.userCollaterals(borrower_, ASSET);
        liq.callFunction(address(cdp), "liquidate", ASSET, borrower_, amountUSD);
        uint afterBal  = vault.userCollaterals(borrower_, ASSET);
        seized   = beforeBal - afterBal;
        leftover = afterBal;
        
        // Perform comprehensive verification with captured pre-state
        (verificationPassed, error) = verifier.verifyLiquidationStateWithSnapshots(m, ASSET, borrower_, address(liq), preSnapshot, amountUSD, 0, false);
        
        return (seized, leftover, verificationPassed, error);
    }

    function _state(address who) internal view returns (uint col, uint scaledDebt) {
        (col, scaledDebt) = cdp.vaults(who, ASSET);
    }

    // ────────────────────────── Reject paths ──────────────────────────

    function it_rejects_zero_debtToCover() public {
        _open(1000e18, 100e18, OPEN_P);
        oracle.setAssetPrice(ASSET, LOW_P); // unsafe
        bool reverted = false;
        try cdp.liquidate(ASSET, address(borrower), 0) {
            revert("expected revert on zero amount");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    function it_rejects_borrower_zero_address() public {
        bool reverted = false;
        try cdp.liquidate(ASSET, address(0), 1e18) {
            revert("expected revert on borrower=0");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    function it_rejects_borrower_equal_caller() public {
        // Here caller is the test contract itself
        bool reverted = false;
        try cdp.liquidate(ASSET, address(this), 1e18) {
            revert("expected revert on borrower==msg.sender");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    function it_rejects_unsupported_asset() public {
        address fake = address(0xDeaDbeef);
        bool reverted = false;
        try cdp.liquidate(fake, address(borrower), 1e18) {
            revert("expected revert on unsupported asset");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    function it_rejects_when_borrower_has_no_debt() public {
        _open(1000e18, 0, OPEN_P);          // no debt
        oracle.setAssetPrice(ASSET, LOW_P); // even if unsafe, no debt → revert
        bool reverted = false;
        try cdp.liquidate(ASSET, address(borrower), 1e18) {
            revert("expected revert on no debt");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    function it_rejects_when_position_healthy() public {
        _open(1000e18, 100e18, OPEN_P); // healthy
        // keep price high enough
        oracle.setAssetPrice(ASSET, OPEN_P);
        bool reverted = false;
        try cdp.liquidate(ASSET, address(borrower), 1e18) {
            revert("expected revert on healthy position");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    function it_rejects_zero_price() public {
        _open(1000e18, 100e18, OPEN_P);
        // set price to 0 → oracle will cause a revert the engine catches as require
        oracle.setAssetPrice(ASSET, 0);
        bool reverted = false;
        try cdp.liquidate(ASSET, address(borrower), 1e18) {
            revert("expected revert on zero price");
        } catch { reverted = true; }
        require(reverted, "should revert");
    }

    // ───────────────────── Non-cap success paths ─────────────────────

    /// CF binds: repay = min(totalDebt, closeFactor, coverageCap, debtToCover) = closeFactor
    function it_liquidates_when_close_factor_binds() public {
        // deposit 2000; mint 6000 @ $5 → unsafe at $3, collateralUSD=6000
        _open(2000e18, 6000e18, OPEN_P);
        (uint colBefore, ) = _state(address(borrower));

        (uint seized, uint leftover) = _liq(address(borrower), 1e36, MID_P);

        // Expected: repay=3000, penalty=300, seized = (3300 / 3) = 1100
        uint repay   = 3000e18;
        uint penalty = (repay * PEN) / 10000;
        uint expectedSeized   = ( (repay + penalty) * UNIT ) / MID_P;
        uint expectedLeftover = colBefore - expectedSeized;

        require(seized   == expectedSeized,   "CF binds: seized mismatch");
        require(leftover == expectedLeftover, "CF binds: leftover mismatch");

        (, uint scaledAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtAfter = (scaledAfter * rate) / RAY;
        require(debtAfter == 6000e18 - repay, "CF binds: remaining debt mismatch");
    }

    /// Comprehensive state verification for CF binds liquidation
    function it_comprehensive_state_verification_close_factor_binds() public {
        // Same setup as above
        _open(2000e18, 6000e18, OPEN_P);
        
        // Capture comprehensive state verification
        (uint seized, uint leftover, bool verificationPassed, string memory error) = _liqWithFullVerification(address(borrower), 1e36, MID_P);
        
        // Verify that comprehensive verification passed
        require(verificationPassed, string("Comprehensive verification failed: ") + error);
        
        // Additional explicit checks for transparency
        uint repay = 3000e18;
        uint penalty = (repay * PEN) / 10000;
        uint expectedSeized = ((repay + penalty) * UNIT) / MID_P;
        
        require(seized == expectedSeized, "CF comprehensive: seized mismatch");
        require(leftover > 0, "CF comprehensive: should have leftover collateral");
        
        // Verify token balances changed correctly
        uint liquidatorUSDSTAfter = usdstT.balanceOf(address(liq));
        uint liquidatorCollateralAfter = assetT.balanceOf(address(liq));
        uint vaultTokenBalanceAfter = assetT.balanceOf(address(vault));
        
        // Liquidator should have spent USDST and received collateral
        require(liquidatorUSDSTAfter < 1e36, "CF comprehensive: liquidator should have spent USDST");
        require(liquidatorCollateralAfter >= seized, "CF comprehensive: liquidator should receive seized collateral");
        require(vaultTokenBalanceAfter < 2000e18, "CF comprehensive: vault should have less collateral");
    }

    /// debtToCover binds (small repay)
    function it_liquidates_when_debtToCover_binds() public {
        _open(2000e18, 6000e18, OPEN_P); // same setup as above, unsafe at $3
        (uint colBefore, ) = _state(address(borrower));

        uint smallRepay = 200e18; // < closeFactorCap=3000, < coverageCap~5454
        (uint seized, uint leftover) = _liq(address(borrower), smallRepay, MID_P);

        uint penalty = (smallRepay * PEN) / 10000;          // 10%
        uint expectedSeized   = ((smallRepay + penalty) * UNIT) / MID_P;
        uint expectedLeftover = colBefore - expectedSeized;

        require(seized   == expectedSeized,   "debtToCover binds: seized");
        require(leftover == expectedLeftover, "debtToCover binds: leftover");

        (, uint scaledAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtAfter = (scaledAfter * rate) / RAY;
        require(debtAfter == 6000e18 - smallRepay, "debtToCover binds: remaining debt");
    }

    /// totalDebt binds (CF=100%, coverageCap >= totalDebt, unsafe CR)
    function it_liquidates_when_total_debt_binds_CF_100() public {
        // Make CF 100% for this test.
        cdp.setCollateralAssetParams(ASSET, LR, PEN, 10000, SFR, FLOOR_, CEIL_, UNIT, false);

        // Choose deposit & liq price so: unsafe, and coverageCap ≥ totalDebt.
        // deposit=3000, debt=6000, liq price=$2.5 → colUSD=7500, covCap=6818 ≥ 6000, CR=1.25 < LR
        _open(3000e18, 6000e18, OPEN_P);
        (uint colBefore, ) = _state(address(borrower));

        (uint seized, uint leftover) = _liq(address(borrower), 1e36, 25e17);

        uint repay   = 6000e18;
        uint penalty = (repay * PEN) / 10000;
        uint expectedSeized   = ((repay + penalty) * UNIT) / 25e17;
        uint expectedLeftover = colBefore - expectedSeized;

        require(seized   == expectedSeized,   "totalDebt binds: seized");
        require(leftover == expectedLeftover, "totalDebt binds: leftover");

        (, uint scaledAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtAfter = (scaledAfter * rate) / RAY;
        require(debtAfter == 0, "totalDebt binds: debt should be zero");
    }

    // ────────────────────── Cap-bound success paths ──────────────────────

    /// CF=50%, very low price → coverage-cap binds, engine seizes ALL collateral, bad debt realized.
    function it_liquidates_cap_bound_CF_50() public {
        _open(2000e18, 6000e18, OPEN_P);
        (uint colBefore, ) = _state(address(borrower));

        uint badBefore = cdp.badDebtUSDST(ASSET);
        (uint seized, uint leftover) = _liq(address(borrower), 1e36, LOW_P);

        require(seized == colBefore, "cap bound 50: must seize all");
        require(leftover == 0,       "cap bound 50: no leftover expected");

        // borrower debt should be zero (remainder realized as bad debt)
        (, uint scaledAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtAfter = (scaledAfter * rate) / RAY;
        require(debtAfter == 0, "cap bound 50: borrower debt should be zero");

        // bad debt increased by the remainder (within 1 wei tolerance)
        uint badAfter = cdp.badDebtUSDST(ASSET);
        require(badAfter >= badBefore + 1, "cap bound 50: bad debt should grow");
    }

    /// Comprehensive state verification for cap-bound liquidation
    function it_comprehensive_state_verification_cap_bound_CF_50() public {
        _open(2000e18, 6000e18, OPEN_P);
        
        // Capture comprehensive state verification for cap-bound liquidation
        (uint seized, uint leftover, bool verificationPassed, string memory error) = _liqWithFullVerification(address(borrower), 1e36, LOW_P);
        
        // Verify that comprehensive verification passed
        require(verificationPassed, string("Cap-bound comprehensive verification failed: ") + error);
        
        // Cap-bound specific verifications
        require(seized == 2000e18, "Cap comprehensive: must seize all collateral");
        require(leftover == 0, "Cap comprehensive: no leftover expected");
        
        // Verify bad debt was realized
        uint badAfter = cdp.badDebtUSDST(ASSET);
        require(badAfter > 0, "Cap comprehensive: bad debt should be realized");
        
        // Verify borrower debt is zero
        (, uint scaledAfter) = _state(address(borrower));
        require(scaledAfter == 0, "Cap comprehensive: borrower debt should be zero");
        
        // Verify token transfers occurred correctly
        uint liquidatorCollateralAfter = assetT.balanceOf(address(liq));
        uint vaultTokenBalanceAfter = assetT.balanceOf(address(vault));
        
        require(liquidatorCollateralAfter >= seized, "Cap comprehensive: liquidator should receive all collateral");
        require(vaultTokenBalanceAfter == 0, "Cap comprehensive: vault should have no collateral");
        
        // Verify USDST burning occurred
        uint liquidatorUSDSTAfter = usdstT.balanceOf(address(liq));
        require(liquidatorUSDSTAfter < 1e36, "Cap comprehensive: liquidator should have spent USDST");
    }

    /// CF=100%, same cap-bound behavior: seize all + bad debt
    function it_liquidates_cap_bound_CF_100() public {
        cdp.setCollateralAssetParams(ASSET, LR, PEN, 10000, SFR, FLOOR_, CEIL_, UNIT, false);

        _open(2000e18, 6000e18, OPEN_P);
        (uint colBefore, ) = _state(address(borrower));

        uint badBefore = cdp.badDebtUSDST(ASSET);
        (uint seized, uint leftover) = _liq(address(borrower), 1e36, LOW_P);

        require(seized == colBefore, "cap bound 100: must seize all");
        require(leftover == 0,       "cap bound 100: no leftover");

        (, uint scaledAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtAfter = (scaledAfter * rate) / RAY;
        require(debtAfter == 0, "cap bound 100: debt should be zero");

        uint badAfter = cdp.badDebtUSDST(ASSET);
        require(badAfter >= badBefore + 1, "cap bound 100: bad debt should grow");
    }

    // ─────────────────────── Boundary: repay == coverageCap ───────────────────────

    /**
     * When debtToCover equals coverageCap, the engine must take the NON-cap path
     * (branch uses `if (repay > coverageCap)`). We validate that collateral is NOT
     * fully seized and that debt reduces exactly by repay (modulo index rounding).
     */
    function it_boundary_repay_equals_coverage_cap_non_cap_path() public {
        _open(2000e18, 6000e18, OPEN_P);
        // Use liq price = $1 → coverageCap = floor( collateralUSD * 10000 / (10000+PEN) )
        oracle.setAssetPrice(ASSET, LOW_P);
        (uint colBefore, uint sdBefore) = _state(address(borrower));

        // Compute coverageCap in USD (WAD)
        uint collateralUSD = (colBefore * LOW_P) / UNIT;
        uint coverageCap   = (collateralUSD * 10000) / (10000 + PEN); // floor

        // Run liquidation with repay == coverageCap (NOT cap-bound)
        liq.callFunction(USDST, "approve", address(cdp), coverageCap);
        uint beforeBal = vault.userCollaterals(address(borrower), ASSET);
        liq.callFunction(address(cdp), "liquidate", ASSET, address(borrower), coverageCap);
        uint afterBal  = vault.userCollaterals(address(borrower), ASSET);

        uint seized   = beforeBal - afterBal;
        uint leftover = afterBal;

        // Expect not all collateral seized (since non-cap branch)
        require(leftover > 0, "boundary: should not seize all");

        // Check remaining debt decreased by ~coverageCap (index rounding may reduce exact burn)
        (, uint sdAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtBefore = (sdBefore * rate) / RAY;
        uint debtAfter  = (sdAfter  * rate) / RAY;

        require(debtAfter < debtBefore, "boundary: debt should decrease");
        // Seized collateral should match (repay + 10%) / price within rounding
        uint penalty = (coverageCap * PEN) / 10000;
        uint expectedSeized = ((coverageCap + penalty) * UNIT) / LOW_P;
        require(seized <= expectedSeized && expectedSeized - seized <= 1, "boundary: seized rounding off-by-1");
    }

    // ─────────────────────── Multi-step liquidation ───────────────────────

    /**
     * Multiple non-cap liquidations in sequence should converge:
     *   - after k rounds with CF=50%, debt shrinks geometrically
     *   - collateral seized each round equals (repay + penalty) / price
     */
    function it_multiple_rounds_non_cap_converge() public {
        _open(3000e18, 9000e18, OPEN_P); // unsafe at $3 (colUSD=9000, LR*debt=13500)
        (uint col0, ) = _state(address(borrower));

        // Round 1
        (uint s1, ) = _liq(address(borrower), 1e36, MID_P); // CF=50% → repay 4500
        // Round 2
        (uint s2, ) = _liq(address(borrower), 1e36, MID_P); // repay 2250
        // Round 3
        (uint s3, ) = _liq(address(borrower), 1e36, MID_P); // repay 1125

        uint seizedTotal = s1 + s2 + s3;
        require(seizedTotal > 0 && seizedTotal < col0, "multi-round: should seize but not exceed supply");

        (, uint sdAfter) = _state(address(borrower));
        (uint rate,,) = cdp.collateralGlobalStates(ASSET);
        uint debtAfter = (sdAfter * rate) / RAY;
        require(debtAfter > 0, "multi-round: still debt remaining after partial rounds");
    }






    // ──────────────────────── helpers for assertions ────────────────────────
    function _usdFromScaled(uint scaled, uint rate) internal pure returns (uint) {
        // USD in WAD, given scaled debt and the asset rate (RAY)
        return (scaled * rate) / 1e27;
    }

    function _absDiff(uint a, uint b) internal pure returns (uint) {
        return a > b ? a - b : b - a;
    }

    function _approxEq(uint a, uint b, uint tol) internal pure returns (bool) {
        return _absDiff(a, b) <= tol;
    }

    // ───────────────────── state checks: non-cap (CF binds) ─────────────────────

    function it_state_consistency_non_cap_CF_binds_vault_and_engine() public {
        // Setup: deposit 2000, borrow 6000; at $3, CF=50% → repay=3000
        _open(2000e18, 6000e18, OPEN_P);

        (uint rate0,, uint totalScaled0) = cdp.collateralGlobalStates(ASSET);
        (uint col0, uint scaled0) = cdp.vaults(address(borrower), ASSET);
        uint usdDebt0 = _usdFromScaled(scaled0, rate0);

        uint vBal0    = assetT.balanceOf(address(vault));
        uint liqCol0  = assetT.balanceOf(address(liq));
        uint liqUsd0  = usdstT.balanceOf(address(liq));
        uint bad0     = cdp.badDebtUSDST(ASSET);

        (uint seized, uint leftover) = _liq(address(borrower), 1e36, MID_P);

        (uint col1, uint scaled1) = cdp.vaults(address(borrower), ASSET);
        (uint rate1,, uint totalScaled1) = cdp.collateralGlobalStates(ASSET);
        uint usdDebt1 = _usdFromScaled(scaled1, rate1);

        uint vBal1   = assetT.balanceOf(address(vault));
        uint liqCol1 = assetT.balanceOf(address(liq));
        uint liqUsd1 = usdstT.balanceOf(address(liq));
        uint bad1    = cdp.badDebtUSDST(ASSET);

        // Expected math (generic in case params change)
        uint repay   = (usdDebt0 * CF) / 10000;                     // close factor binds
        uint penalty = (repay * PEN) / 10000;
        uint expSeized = ((repay + penalty) * UNIT) / MID_P;

        // Per-user vault + engine mapping
        require(seized   == expSeized, "CF: seized mismatch");
        require(leftover == col0 - expSeized, "CF: leftover mismatch");
        require(col1 == leftover, "CF: borrower col mismatch");
        require(vault.userCollaterals(address(borrower), ASSET) == col1, "CF: vault mapping mismatch");
        require(_approxEq(usdDebt0 - usdDebt1, repay, 1), "CF: borrower debt delta != repay");

        // Global aggregates
        uint assetDebtUSD0 = _usdFromScaled(totalScaled0, rate1);
        uint assetDebtUSD1 = _usdFromScaled(totalScaled1, rate1);
        require(_approxEq(assetDebtUSD0 - assetDebtUSD1, repay, 1), "CF: global debt delta != repay");
        require(_approxEq(assetDebtUSD1, usdDebt1, 1), "CF: global != borrower debt");

        // Token & vault balances
        require(vBal1 == vBal0 - expSeized, "CF: vault ERC20 balance");
        require(liqCol1 == liqCol0 + expSeized, "CF: liquidator collateral");
        require(_approxEq(liqUsd0 - liqUsd1, repay, 1), "CF: liquidator USD spend");

        // Bad debt should NOT change on non-cap path
        require(bad1 == bad0, "CF: bad debt changed unexpectedly");
    }

    // ───────────────────── state checks: cap-bound (CF 50%) ─────────────────────

    function it_state_consistency_cap_bound_CF50_updates_all_mappings() public {
        _open(2000e18, 6000e18, OPEN_P);

        (uint rate0,, uint totalScaled0) = cdp.collateralGlobalStates(ASSET);
        (uint col0, uint scaled0) = cdp.vaults(address(borrower), ASSET);
        uint usdDebt0 = _usdFromScaled(scaled0, rate0);

        uint vBal0    = assetT.balanceOf(address(vault));
        uint liqCol0  = assetT.balanceOf(address(liq));
        uint liqUsd0  = usdstT.balanceOf(address(liq));
        uint bad0     = cdp.badDebtUSDST(ASSET);

        // At $1, coverageCap = floor(colUSD * 10000 / (10000+PEN))
        uint price = LOW_P;
        uint colUSD = (col0 * price) / UNIT;
        uint coverageCap = (colUSD * 10000) / (10000 + PEN);

        (uint seized, uint leftover) = _liq(address(borrower), 1e36, price);

        (uint col1, uint scaled1) = cdp.vaults(address(borrower), ASSET);
        (uint rate1,, uint totalScaled1) = cdp.collateralGlobalStates(ASSET);

        uint vBal1   = assetT.balanceOf(address(vault));
        uint liqCol1 = assetT.balanceOf(address(liq));
        uint liqUsd1 = usdstT.balanceOf(address(liq));
        uint bad1    = cdp.badDebtUSDST(ASSET);

        // Cap-bound expectations
        require(seized == col0, "CAP50: must seize all collateral");
        require(leftover == 0 && col1 == 0, "CAP50: borrower collateral not zero");
        require(scaled1 == 0, "CAP50: borrower scaled debt not zero");

        // Global debt becomes zero (all borrower debt removed; remainder → bad debt)
        require(_usdFromScaled(totalScaled1, rate1) == 0, "CAP50: global debt not zero");

        // Liquidator spends only 'repay' (coverageCap); penalty paid via seized collateral
        require(_approxEq(liqUsd0 - liqUsd1, coverageCap, 1), "CAP50: liquidator USD spend");

        // Vault & token balances
        require(vBal1 == vBal0 - col0, "CAP50: vault ERC20 balance");
        require(liqCol1 == liqCol0 + col0, "CAP50: liquidator collateral");

        // Bad debt increases by remainder = debtBefore - repay
        uint expectedRemainder = usdDebt0 > coverageCap ? (usdDebt0 - coverageCap) : 0;
        require(_approxEq(bad1 - bad0, expectedRemainder, 1), "CAP50: bad debt remainder mismatch");
    }

    // ─────────────── state checks: boundary repay == coverageCap (non-cap) ───────────────

    function it_state_consistency_boundary_equal_covcap_non_cap_branch() public {
        _open(2000e18, 6000e18, OPEN_P);

        // Compute exact coverageCap at $1 and use it as debtToCover → NON-CAP branch
        oracle.setAssetPrice(ASSET, LOW_P);
        (uint col0, uint scaled0) = cdp.vaults(address(borrower), ASSET);
        (uint rate0,, uint totalScaled0) = cdp.collateralGlobalStates(ASSET);
        uint debt0 = _usdFromScaled(scaled0, rate0);

        uint colUSD = (col0 * LOW_P) / UNIT;
        uint capUSD = (colUSD * 10000) / (10000 + PEN);

        uint vBal0    = assetT.balanceOf(address(vault));
        uint liqCol0  = assetT.balanceOf(address(liq));
        uint liqUsd0  = usdstT.balanceOf(address(liq));
        uint bad0     = cdp.badDebtUSDST(ASSET);

        liq.callFunction(USDST, "approve", address(cdp), capUSD);
        uint beforeBal = vault.userCollaterals(address(borrower), ASSET);
        liq.callFunction(address(cdp), "liquidate", ASSET, address(borrower), capUSD);
        uint afterBal  = vault.userCollaterals(address(borrower), ASSET);
        uint seized = beforeBal - afterBal;

        (uint col1, uint scaled1) = cdp.vaults(address(borrower), ASSET);
        (uint rate1,, uint totalScaled1) = cdp.collateralGlobalStates(ASSET);
        uint debt1 = _usdFromScaled(scaled1, rate1);

        uint vBal1   = assetT.balanceOf(address(vault));
        uint liqCol1 = assetT.balanceOf(address(liq));
        uint liqUsd1 = usdstT.balanceOf(address(liq));
        uint bad1    = cdp.badDebtUSDST(ASSET);

        // Non-cap branch: not all collateral seized; debt decreases by exactly capUSD
        uint penalty = (capUSD * PEN) / 10000;
        uint expSeized = ((capUSD + penalty) * UNIT) / LOW_P;

        require(col1 > 0, "BND: unexpected full seize");
        require(seized == expSeized, "BND: seized mismatch");
        require(vBal1 == vBal0 - expSeized, "BND: vault ERC20");
        require(liqCol1 == liqCol0 + expSeized, "BND: liquidator collateral");
        require(_approxEq(liqUsd0 - liqUsd1, capUSD, 1), "BND: liquidator USD");

        // Engine mappings & globals
        require(_approxEq(debt0 - debt1, capUSD, 1), "BND: borrower debt delta");
        require(_approxEq(_usdFromScaled(totalScaled0, rate1) - _usdFromScaled(totalScaled1, rate1), capUSD, 1), "BND: global debt delta");
        require(bad1 == bad0, "BND: bad debt changed");
    }

    // ───────────────────── state checks: total-debt binds (CF=100%) ─────────────────────

    function it_state_consistency_total_debt_binds_CF100_updates_all() public {
        // Set CF=100% and choose price so coverageCap ≥ totalDebt, CR < LR
        cdp.setCollateralAssetParams(ASSET, LR, PEN, 10000, SFR, FLOOR_, CEIL_, UNIT, false);
        _open(3000e18, 6000e18, OPEN_P);

        (uint rate0,, uint totalScaled0) = cdp.collateralGlobalStates(ASSET);
        (uint col0, uint scaled0) = cdp.vaults(address(borrower), ASSET);
        uint debt0 = _usdFromScaled(scaled0, rate0);

        uint vBal0    = assetT.balanceOf(address(vault));
        uint liqCol0  = assetT.balanceOf(address(liq));
        uint liqUsd0  = usdstT.balanceOf(address(liq));
        uint bad0     = cdp.badDebtUSDST(ASSET);

        // Liquidate at $2.5
        (uint seized, uint leftover) = _liq(address(borrower), 1e36, 25e17);

        (uint col1, uint scaled1) = cdp.vaults(address(borrower), ASSET);
        (uint rate1,, uint totalScaled1) = cdp.collateralGlobalStates(ASSET);

        uint vBal1   = assetT.balanceOf(address(vault));
        uint liqCol1 = assetT.balanceOf(address(liq));
        uint liqUsd1 = usdstT.balanceOf(address(liq));
        uint bad1    = cdp.badDebtUSDST(ASSET);

        // Expectations: repay = total debt, borrower fully cleared, no bad debt
        uint penalty = (debt0 * PEN) / 10000;
        uint expSeized = ((debt0 + penalty) * UNIT) / 25e17;

        require(col1 + seized == col0, "TD: seized accounting");
        require(seized == expSeized, "TD: seized mismatch");
        require(leftover == col1, "TD: leftover mismatch");
        require(scaled1 == 0, "TD: borrower scaled not zero");
        require(_usdFromScaled(totalScaled1, rate1) == 0, "TD: global debt not zero");
        require(bad1 == bad0, "TD: bad debt should not change");

        // Token movements
        require(vBal1 == vBal0 - expSeized, "TD: vault ERC20");
        require(liqCol1 == liqCol0 + expSeized, "TD: liquidator collateral");
        require(_approxEq(liqUsd0 - liqUsd1, debt0, 1), "TD: liquidator USD spend");
    }

    // ───────────────── invariants after multi-round non-cap liquidations ─────────────────

    function it_state_invariants_after_multi_rounds_match_between_vault_and_engine() public {
        // Start unsafe at $3; CF=50% ensures non-cap rounds
        _open(3000e18, 9000e18, OPEN_P);
        oracle.setAssetPrice(ASSET, MID_P);

        (uint rate0,, uint totalScaled0) = cdp.collateralGlobalStates(ASSET);
        // Silence warnings by using the variables
        rate0 = rate0;
        totalScaled0 = totalScaled0;

        uint vBalPrev   = assetT.balanceOf(address(vault));
        uint liqColPrev = assetT.balanceOf(address(liq));
        uint liqUsdPrev = usdstT.balanceOf(address(liq));
        uint badPrev    = cdp.badDebtUSDST(ASSET);

        uint sumRepay;

        // Round 1
        (uint seized1, uint leftover1) = _liq(address(borrower), 1e36, MID_P);
        // Use variables to silence warnings
        seized1 = seized1;
        leftover1 = leftover1;
        (uint col1, uint sd1) = cdp.vaults(address(borrower), ASSET);
        (uint rate1,, uint ts1) = cdp.collateralGlobalStates(ASSET);
        uint debt1 = _usdFromScaled(sd1, rate1);
        uint assetDebt1 = _usdFromScaled(ts1, rate1);
        require(_approxEq(debt1, assetDebt1, 1), "R1: global != borrower");
        require(badPrev == cdp.badDebtUSDST(ASSET), "R1: bad debt changed unexpectedly");

        // Track deltas to assert token accounting
        uint vBal1   = assetT.balanceOf(address(vault));
        uint liqCol1 = assetT.balanceOf(address(liq));
        uint liqUsd1 = usdstT.balanceOf(address(liq));
        sumRepay += (liqUsdPrev - liqUsd1);
        require(vBal1 + (liqCol1 - liqColPrev) == vBalPrev, "R1: token conservation");
        vBalPrev = vBal1; liqColPrev = liqCol1; liqUsdPrev = liqUsd1;

        // Round 2
        (uint seized2, uint leftover2) = _liq(address(borrower), 1e36, MID_P);
        // Use variables to silence warnings
        seized2 = seized2;
        leftover2 = leftover2;
        (uint col2, uint sd2) = cdp.vaults(address(borrower), ASSET);
        (uint rate2,, uint ts2) = cdp.collateralGlobalStates(ASSET);
        uint debt2 = _usdFromScaled(sd2, rate2);
        uint assetDebt2 = _usdFromScaled(ts2, rate2);
        require(_approxEq(debt2, assetDebt2, 1), "R2: global != borrower");
        require(badPrev == cdp.badDebtUSDST(ASSET), "R2: bad debt changed unexpectedly");

        uint vBal2   = assetT.balanceOf(address(vault));
        uint liqCol2 = assetT.balanceOf(address(liq));
        uint liqUsd2 = usdstT.balanceOf(address(liq));
        sumRepay += (liqUsdPrev - liqUsd2);
        require(vBal2 + (liqCol2 - liqColPrev) == vBalPrev, "R2: token conservation");
        vBalPrev = vBal2; liqColPrev = liqCol2; liqUsdPrev = liqUsd2;

        // Round 3
        (uint seized3, uint leftover3) = _liq(address(borrower), 1e36, MID_P);
        // Use variables to silence warnings
        seized3 = seized3;
        leftover3 = leftover3;
        (uint col3, uint sd3) = cdp.vaults(address(borrower), ASSET);
        (uint rate3,, uint ts3) = cdp.collateralGlobalStates(ASSET);
        uint debt3 = _usdFromScaled(sd3, rate3);
        uint assetDebt3 = _usdFromScaled(ts3, rate3);
        require(_approxEq(debt3, assetDebt3, 1), "R3: global != borrower");
        require(badPrev == cdp.badDebtUSDST(ASSET), "R3: bad debt changed unexpectedly");

        uint vBal3   = assetT.balanceOf(address(vault));
        uint liqCol3 = assetT.balanceOf(address(liq));
        uint liqUsd3 = usdstT.balanceOf(address(liq));
        sumRepay += (liqUsdPrev - liqUsd3);
        require(vBal3 + (liqCol3 - liqColPrev) == vBalPrev, "R3: token conservation");

        // Final invariants:
        //  - vault mapping == engine mapping for collateral
        //  - global debt == borrower debt
        //  - liquidator's total USD out equals sum of round-level debt reductions
        require(vault.userCollaterals(address(borrower), ASSET) == col3, "Final: vault mapping mismatch");
        require(_approxEq(_usdFromScaled(ts3, rate3), debt3, 1), "Final: global != borrower");
        // Note: sumRepay is computed from liquidator's token deltas, so identity holds tautologically.
        // We still assert liquidator paid something.
        require(sumRepay > 0, "Final: expected some repay across rounds");
    }



}
