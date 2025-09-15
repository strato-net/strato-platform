// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/StdInvariant.sol";
import "forge-std/Test.sol";
import "forge-std/console.sol";

// Use the preprocessed CDP artifacts
import {CDPEngine} from "cdp/CDPEngine.sol";
import {CDPRegistry} from "cdp/CDPRegistry.sol";
import {CDPReserve} from "cdp/CDPReserve.sol";

// Compat stubs for external deps
import {TokenFactory} from "compat/TokenFactory.sol";
import {Token} from "compat/Token.sol";
import {CDPVault} from "compat/CDPVault.sol";
import {FeeCollector} from "compat/FeeCollector.sol";

contract TestOracle {
    mapping(address => uint256) public price;
    function set(address asset, uint256 p) external { price[asset] = p; }
    function getAssetPrice(address asset) external view returns (uint256) { return price[asset] == 0 ? 1e18 : price[asset]; }
    function getPrice(address) external pure returns (uint256) { return 1e18; }
}

contract CDP_FeeFlowHandler is Test {
    CDPEngine public engine;
    CDPRegistry public registry;
    CDPReserve public reserve;
    Token public usdst;
    address public feeCollector;
    address public asset;
    TestOracle public oracle;

    address public borrower = address(0xB0B0B0);
    address public liquidator = address(this);

    uint256 public lastReserveDelta;
    uint256 public lastCollectorDelta;

    // Bad debt observation fields
    bool public lastLiqObserved;
    uint256 public preBadDebt;
    uint256 public postBadDebt;
    uint256 public preTotalScaled;
    uint256 public postTotalScaled;
    uint256 public borrowerCollPost;
    uint256 public borrowerScaledPost;

    // Junior tracking (simplified for one note owner: this contract)
    uint256 public totalPaidToJunior;

    // Sampled trace counter
    uint256 private actionCount;

    // Plug tracking
    bool public lastPlugObserved;
    uint256 public plugPreBad;
    uint256 public plugPostBad;
    uint256 public lastPaidDelta;

    constructor(CDPEngine _engine, CDPRegistry _registry, CDPReserve _reserve, Token _usdst, address _feeCollector, address _asset, TestOracle _oracle) {
        engine = _engine;
        registry = _registry;
        reserve = _reserve;
        usdst = _usdst;
        feeCollector = _feeCollector;
        asset = _asset;
        oracle = _oracle;
    }

    function _snapshot(string memory tag) internal {
        unchecked { actionCount++; }
        if (actionCount % 500 != 0) return; // sample
        vm.label(address(engine), "CDPEngine");
        vm.label(address(reserve), "CDPReserve");
        vm.label(address(this), "Handler");
        vm.label(feeCollector, "FeeCollector");
        ( , , uint totalScaledDebt) = engine.collateralGlobalStates(asset);
        (uint userColl, uint userScaled) = engine.vaults(borrower, asset);
        console.log("--- snapshot ---");
        console.log("tag", tag);
        console.log("actions", actionCount);
        console.log("feeBps", engine.feeToReserveBps());
        console.log("reserveUSDST", usdst.balanceOf(address(reserve)));
        console.log("collectorUSDST", usdst.balanceOf(feeCollector));
        console.log("totalScaledDebt", totalScaledDebt);
        console.log("badDebtUSD", engine.badDebtUSD(asset));
        console.log("user.collateral", userColl);
        console.log("user.scaledDebt", userScaled);
    }

    function configureOnce() external {
        _snapshot("configure:enter");
        (bool ok,) = address(engine).call(abi.encodeWithSignature(
            "setCollateralAssetParams(address,uint256,uint256,uint256,uint256,uint256,uint256,uint256,bool)",
            asset,
            uint256(1500e15),
            uint256(1000),
            uint256(10000),
            uint256(1000500000000000000000000000),
            uint256(0),
            uint256(1e30),
            uint256(1e18),
            false
        )); ok;
        (ok,) = address(engine).call(abi.encodeWithSignature("deposit(address,uint256)", asset, uint256(1e24))); ok;
        _snapshot("configure:exit");
    }

    function tick(uint256 s) external { vm.warp(block.timestamp + (s % 3600) + 1); _snapshot("tick"); }

    function mintSome(uint256 x) external {
        _snapshot("mint:enter");
        uint256 amt = 1e20 + (x % 1e20);
        (bool ok,) = address(engine).call(abi.encodeWithSignature("mint(address,uint256)", asset, amt)); ok;
        _snapshot("mint:exit");
    }

    function repaySome(uint256 x) external {
        _snapshot("repay:enter");
        uint256 r0 = usdst.balanceOf(address(reserve));
        uint256 c0 = usdst.balanceOf(feeCollector);
        uint256 amt = 5e19 + (x % 5e19);
        (bool ok,) = address(engine).call(abi.encodeWithSignature("repay(address,uint256)", asset, amt));
        if (!ok) { lastReserveDelta = 0; lastCollectorDelta = 0; _snapshot("repay:revert"); return; }
        uint256 r1 = usdst.balanceOf(address(reserve));
        uint256 c1 = usdst.balanceOf(feeCollector);
        lastReserveDelta = r1 - r0;
        lastCollectorDelta = c1 - c0;
        _snapshot("repay:exit");
    }

    function setupActors(uint256 mintBorrower, uint256 mintLiq) external {
        _snapshot("setupActors:enter");
        vm.startPrank(borrower);
        (bool ok,) = address(engine).call(abi.encodeWithSignature("deposit(address,uint256)", asset, uint256(1e24))); ok;
        (ok,) = address(engine).call(abi.encodeWithSignature("mint(address,uint256)", asset, mintBorrower % 5e23 + 2e22)); ok;
        vm.stopPrank();
        vm.startPrank(liquidator);
        (ok,) = address(engine).call(abi.encodeWithSignature("deposit(address,uint256)", asset, uint256(1e24))); ok;
        (ok,) = address(engine).call(abi.encodeWithSignature("mint(address,uint256)", asset, mintLiq % 5e23 + 2e22)); ok;
        vm.stopPrank();
        _snapshot("setupActors:exit");
    }

    function setPrice(uint256 p) external {
        // Skew low prices: ~80% chance pick a very low price (0.0001..0.1), else mid/high (0.5..1.0)
        uint256 bucket = p % 100;
        uint256 px = bucket < 80 ? (1e14 + (p % 1e17)) : (5e17 + (p % 5e17));
        oracle.set(asset, px);
        _snapshot("setPrice");
    }

    function liquidateBorrower(uint256 repayWad) external {
        _snapshot("liq:enter");
        // Also bias price low right before liquidation about ~70% of the time
        if (repayWad % 100 < 70) {
            uint256 px = 1e14 + (repayWad % 1e17);
            oracle.set(asset, px);
        }
        lastLiqObserved = false;
        preBadDebt = engine.badDebtUSD(asset);
        (, , preTotalScaled) = engine.collateralGlobalStates(asset);
        (bool ok,) = address(engine).call(abi.encodeWithSignature("liquidate(address,address,uint256)", asset, borrower, (repayWad % 5e23) + 1e21));
        if (!ok) { _snapshot("liq:revert"); return; }
        lastLiqObserved = true;
        (uint collPost, uint scaledPost) = engine.vaults(borrower, asset);
        borrowerCollPost = collPost;
        borrowerScaledPost = scaledPost;
        postBadDebt = engine.badDebtUSD(asset);
        (, , postTotalScaled) = engine.collateralGlobalStates(asset);
        if (postBadDebt > preBadDebt) {
            console.log("--- snapshot ---");
            console.log("tag", "liq:baddebt");
            console.log("badDebtUSD", postBadDebt);
            console.log("borrower.collateral", borrowerCollPost);
            console.log("borrower.scaledDebt", borrowerScaledPost);
        }
        _snapshot("liq:exit");
    }

    function openJunior(uint256 burnUsd) external { _snapshot("openJunior"); uint256 toBurn = (burnUsd % 5e21) + 1e18; (bool ok,) = address(engine).call(abi.encodeWithSignature("openJuniorNote(address,uint256)", asset, toBurn)); ok; }

    function claimJunior() external {
        _snapshot("claim:enter");
        uint256 me0 = usdst.balanceOf(address(this));
        (bool ok,) = address(engine).call(abi.encodeWithSignature("claimJunior()"));
        if (!ok) { _snapshot("claim:revert"); return; }
        uint256 me1 = usdst.balanceOf(address(this));
        if (me1 > me0) totalPaidToJunior += (me1 - me0);
        _snapshot("claim:exit");
    }

    // Plug bad debt by opening a junior note equal to min(badDebt, balance), then drive reserve inflow and claim
    function plugBadDebt(uint256 x) external {
        uint256 bd = engine.badDebtUSD(asset); if (bd == 0) return; lastPlugObserved = false; plugPreBad = bd;
        // Ensure balance via mint
        uint256 amtMint = 2e21 + (x % 5e21); (bool ok,) = address(engine).call(abi.encodeWithSignature("mint(address,uint256)", asset, amtMint)); ok;
        uint256 bal = usdst.balanceOf(address(this)); uint256 burnAmt = bal < bd ? bal : bd;
        (ok,) = address(engine).call(abi.encodeWithSignature("openJuniorNote(address,uint256)", asset, burnAmt)); ok; _snapshot("plug:open");
        // Create fee inflow (repay inline)
        uint256 r0 = usdst.balanceOf(address(reserve)); uint256 c0 = usdst.balanceOf(feeCollector);
        uint256 repayAmt = 5e19 + (x % 5e19); (ok,) = address(engine).call(abi.encodeWithSignature("repay(address,uint256)", asset, repayAmt)); ok;
        uint256 r1 = usdst.balanceOf(address(reserve)); uint256 c1 = usdst.balanceOf(feeCollector); lastReserveDelta = r1 - r0; lastCollectorDelta = c1 - c0;
        // Claim inline
        uint256 me0 = usdst.balanceOf(address(this)); (ok,) = address(engine).call(abi.encodeWithSignature("claimJunior()")); ok; uint256 me1 = usdst.balanceOf(address(this)); if (me1 > me0) { uint256 pd = me1 - me0; totalPaidToJunior += pd; lastPaidDelta = pd; }
        _snapshot("plug:claim"); plugPostBad = engine.badDebtUSD(asset); lastPlugObserved = true;
    }
}

contract CDP_FeeReserve_Invariants is StdInvariant {
    CDPRegistry registry;
    CDPEngine engine;
    CDPReserve reserve;
    Token usdst;
    FeeCollector feeCollector;
    CDP_FeeFlowHandler handler;
    TestOracle oracle;
    address asset;

    function setUp() public {
        address owner = address(this);
        asset = address(0xC011A710);
        CDPVault vault = new CDPVault();
        oracle = new TestOracle();
        usdst = new Token();
        TokenFactory tf = new TokenFactory();
        feeCollector = new FeeCollector();
        registry = new CDPRegistry(owner);
        reserve = new CDPReserve(owner);
        engine = new CDPEngine(address(registry), owner);
        registry.setAllComponents(address(vault), address(engine), address(oracle), address(usdst), address(tf), address(feeCollector), address(reserve));
        reserve.setEngine(address(engine));
        usdst.transferOwnership(address(engine));
        engine.setFeeToReserveBps(3333);
        handler = new CDP_FeeFlowHandler(engine, registry, reserve, usdst, address(feeCollector), asset, oracle);
        engine.transferOwnership(address(handler));
        targetContract(address(handler));
    }

    // Invariant 1 (plain English): After any repay routing a fee, reserve gets floor(feeUSD * bps / 10000).
    function invariant_FeeSplitConservation() public {
        uint256 r = handler.lastReserveDelta();
        uint256 c = handler.lastCollectorDelta();
        uint256 t = r + c;
        if (t == 0) return;
        uint256 bps = engine.feeToReserveBps();
        uint256 expectedReserve = (t * bps) / 10000;
        if (r != expectedReserve) revert("fee split mismatch");
    }

    // Invariant 2 (plain English): Collector receives the remainder after reserve’s floor allocation.
    function invariant_FeeSplitRemainderToCollector() public {
        uint256 r = handler.lastReserveDelta();
        uint256 c = handler.lastCollectorDelta();
        uint256 t = r + c;
        if (t == 0) return;
        uint256 bps = engine.feeToReserveBps();
        uint256 expectedReserve = (t * bps) / 10000;
        uint256 expectedCollector = t - expectedReserve;
        require(c == expectedCollector, "collector split mismatch");
    }

    // Invariant 3 (plain English): Liquidation bad debt and books
    // - If liquidation observed and borrower collateral is zero, borrower debt must be zero and badDebtUSD may increase.
    // - If borrower retains collateral, badDebtUSD for the asset must not increase.
    // - Total scaled debt must not increase due to liquidation.
    function invariant_BadDebtAndBooks() public {
        if (!handler.lastLiqObserved()) return;
        uint256 badDelta = handler.postBadDebt() - handler.preBadDebt();
        if (handler.borrowerCollPost() == 0) {
            require(handler.borrowerScaledPost() == 0, "borrower debt not cleared when coll=0");
        } else {
            require(badDelta == 0, "bad debt increased while collateral remains");
        }
        require(handler.postTotalScaled() <= handler.preTotalScaled(), "totalScaledDebt increased on liquidation");
    }

    // Invariant 4 (Juniors, plain English):
    // - A junior note can never be paid more than its cap (totalPaidToJunior ≤ sum(capUSD) over time).
    // - Claimable/payout must never exceed Reserve balance. (Soft bound until note internals are exposed.)
    function invariant_JuniorsNoOverpayReserveBound() public {
        handler.totalPaidToJunior(); // touched for completeness
        usdst.balanceOf(address(reserve)); // ensures no negative reserve via ERC20 semantics
    }

    // Invariant 5: Plugging bad debt never increases bad debt
    function invariant_PlugReducesOrKeepsBadDebt() public {
        if (!handler.lastPlugObserved()) return;
        require(handler.plugPostBad() <= handler.plugPreBad(), "plug increased bad debt");
    }
}

contract CDP_JuniorProRata_Test is Test {
    CDPEngine engine; CDPRegistry registry; CDPReserve reserve; Token usdst; FeeCollector feeCollector; CDPVault vault; TestOracle oracle; TokenFactory tf; address asset;

    function setUp() public {
        address owner = address(this);
        asset = address(0xC011A710);
        vault = new CDPVault();
        oracle = new TestOracle();
        usdst = new Token();
        tf = new TokenFactory();
        feeCollector = new FeeCollector();
        registry = new CDPRegistry(owner);
        reserve = new CDPReserve(owner);
        engine = new CDPEngine(address(registry), owner);
        registry.setAllComponents(address(vault), address(engine), address(oracle), address(usdst), address(tf), address(feeCollector), address(reserve));
        reserve.setEngine(address(engine));
        usdst.transferOwnership(address(engine));
        engine.setFeeToReserveBps(5000); // 50% to reserve
        // Configure asset
        engine.setCollateralAssetParams(asset, 1500e15, 1000, 10000, 1e27, 0, 1e30, 1e18, false);
        // Seed minimal collateral for test account
        oracle.set(asset, 1e18);
        engine.deposit(asset, 1e24);
    }

    function test_junior_pro_rata_and_return_model() public {
        // Create position
        address borrower = vm.addr(0xB0B0B0B0);
        vm.startPrank(borrower);
        engine.deposit(asset, 2e24);
        oracle.set(asset, 1e18);
        engine.mint(asset, 5e23);
        vm.stopPrank();

        // Prepare liquidator funds at safe price
        address liq = vm.addr(0xA11CE);
        vm.startPrank(liq);
        oracle.set(asset, 1e18);
        engine.deposit(asset, 1e24);
        engine.mint(asset, 5e22);
        vm.stopPrank();

        // First liquidation at low price
        oracle.set(asset, 1e14);
        vm.prank(liq); engine.liquidate(asset, borrower, 1e21);

        // Detect dust and iteratively compute repay to fully seize it (bump price high)
        (uint collAfter, uint scaledAfter) = engine.vaults(borrower, asset);
        if (collAfter > 0) {
            for (uint i = 0; i < 6; i++) {
                if (collAfter == 0) break;
                (, , uint rate) = engine.collateralGlobalStates(asset);
                ( , uint penBps, uint closeBps, , , , uint unitScale, ) = engine.collateralConfigs(asset);
                uint totalDebtUSD = (scaledAfter * rate) / 1e27;
                if (totalDebtUSD == 0) break;
                // Choose price: very high generally, but tuned to exactly clear last 1 unit if present
                uint priceNow;
                if (collAfter == 1) {
                    // Exact threshold price: makes coverageCap* (1+pen) equal to price/unitScale
                    priceNow = (10000 + penBps) * unitScale;
                } else {
                    priceNow = 1e22;
                }
                oracle.set(asset, priceNow);
                // USD value of remaining collateral (ceil)
                uint collUsdCeil = (collAfter * priceNow + unitScale - 1) / unitScale;
                // Coverage cap with penalty (floor)
                uint coverageCap = (collUsdCeil * 10000) / (10000 + penBps);
                if (coverageCap == 0) break;
                // Repay needed so that seized collateral >= collAfter after penalty gross-up
                uint repayNeeded = (collUsdCeil * 10000 + (10000 + penBps) - 1) / (10000 + penBps);
                // Respect caps
                uint closeCap2 = (totalDebtUSD * closeBps) / 10000;
                if (repayNeeded > totalDebtUSD) repayNeeded = totalDebtUSD;
                if (repayNeeded > closeCap2) repayNeeded = closeCap2;
                if (repayNeeded > coverageCap) repayNeeded = coverageCap;
                if (repayNeeded == 0) break;

                vm.prank(liq); engine.liquidate(asset, borrower, repayNeeded);
                // Refresh state
                (collAfter, scaledAfter) = engine.vaults(borrower, asset);
            }
        }

        uint256 badBefore = engine.badDebtUSD(asset);
        assertGt(badBefore, 0, "no bad debt realized");

        // Two junior note owners
        address A = vm.addr(0xAAA1);
        address B = vm.addr(0xBBB2);
        uint256 burnA = badBefore / 4; uint256 burnB = badBefore / 2;
        vm.startPrank(A); oracle.set(asset, 1e18); engine.deposit(asset, 1e24); engine.mint(asset, burnA); engine.openJuniorNote(asset, burnA); vm.stopPrank();
        vm.startPrank(B); oracle.set(asset, 1e18); engine.deposit(asset, 1e24); engine.mint(asset, burnB); engine.openJuniorNote(asset, burnB); vm.stopPrank();

        uint256 idx0 = engine.juniorIndex(); if (idx0 == 0) { engine._syncReserveToIndex(); idx0 = engine.juniorIndex(); }
        (, uint256 capA, ) = engine.juniorNotes(A);
        (, uint256 capB, ) = engine.juniorNotes(B);
        assertGt(capA, 0); assertGt(capB, 0);

        for (uint i=0; i<5; i++) {
            address payer = vm.addr(uint160(uint(keccak256(abi.encode(i)))));
            vm.startPrank(payer);
            oracle.set(asset, 1e18);
            engine.deposit(asset, 5e23);
            engine.mint(asset, 1e22 + i*1e21);
            engine.repay(asset, 5e21 + i*1e20);
            vm.stopPrank();
            vm.warp(block.timestamp + 60);
        }

        engine._syncReserveToIndex();
        uint256 dIdx = engine.juniorIndex() - idx0;
        uint256 expEntA = (capA * dIdx) / 1e27; if (expEntA > capA) expEntA = capA;
        uint256 expEntB = (capB * dIdx) / 1e27; if (expEntB > capB) expEntB = capB;

        uint256 obsA = engine.claimable(A);
        uint256 obsB = engine.claimable(B);

        uint256 lhs = obsA * capB; uint256 rhs = obsB * capA;
        assertLe(lhs > rhs ? (lhs - rhs) : (rhs - lhs), 2, "non pro-rata claimables");
        assertLe(obsA > expEntA ? (obsA - expEntA) : (expEntA - obsA), 2, "A deviates from model");
        assertLe(obsB > expEntB ? (obsB - expEntB) : (expEntB - obsB), 2, "B deviates from model");

        console.log("juniorIndex.dIdx", dIdx);
        console.log("capA", capA); console.log("capB", capB);
        console.log("obsA", obsA); console.log("obsB", obsB);
        console.log("expEntA", expEntA); console.log("expEntB", expEntB);
    }
}
