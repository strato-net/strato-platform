import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Metals/MetalForge.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_MetalForge is Authorizable {

    Mercata m;
    string[] emptyArray;

    MetalForge forge;
    PriceOracle oracle;
    address treasurer;
    FeeCollector collector;

    address usdstAddr;
    address goldAddr;
    address silverAddr;
    address altPayAddr;

    User buyer1;
    User buyer2;

    uint WAD;
    uint GOLD_PRICE;
    uint SILVER_PRICE;
    uint ALTPAY_PRICE;
    uint USDST_FEE_BPS;
    uint ALTPAY_FEE_BPS;
    uint GOLD_CAP;
    uint SILVER_CAP;
    uint BUYER_BALANCE;

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        emptyArray = new string[](0);
        buyer1 = new User();
        buyer2 = new User();
        WAD = 1e18;
        GOLD_PRICE = 2000e18;
        SILVER_PRICE = 25e18;
        ALTPAY_PRICE = 2e18;
        USDST_FEE_BPS = 100;
        ALTPAY_FEE_BPS = 200;
        GOLD_CAP = 1000000e18;
        SILVER_CAP = 10000000e18;
        BUYER_BALANCE = 10000000e18;
    }

    function beforeEach() {
        oracle = new PriceOracle(address(this));
        oracle.initialize();
        treasurer = address(0xDEAD);
        collector = new FeeCollector(address(this));

        usdstAddr = m.tokenFactory().createToken("USDST", "USD Stablecoin", emptyArray, emptyArray, emptyArray, "USDST", 0, 18);
        goldAddr = m.tokenFactory().createToken("Gold", "Tokenized Gold", emptyArray, emptyArray, emptyArray, "GOLD", 0, 18);
        silverAddr = m.tokenFactory().createToken("Silver", "Tokenized Silver", emptyArray, emptyArray, emptyArray, "SLVR", 0, 18);
        altPayAddr = m.tokenFactory().createToken("AltPay", "Alt Payment Token", emptyArray, emptyArray, emptyArray, "ALT", 0, 18);

        Token(usdstAddr).setStatus(2);
        Token(goldAddr).setStatus(2);
        Token(silverAddr).setStatus(2);
        Token(altPayAddr).setStatus(2);

        forge = new MetalForge(address(this));
        forge.initialize(address(oracle), treasurer, address(collector), usdstAddr);

        oracle.setAssetPrice(goldAddr, GOLD_PRICE);
        oracle.setAssetPrice(silverAddr, SILVER_PRICE);
        oracle.setAssetPrice(altPayAddr, ALTPAY_PRICE);

        forge.setMetalConfig(goldAddr, true, GOLD_CAP);
        forge.setMetalConfig(silverAddr, true, SILVER_CAP);
        forge.setPayTokenConfig(usdstAddr, true, USDST_FEE_BPS);
        forge.setPayTokenConfig(altPayAddr, true, ALTPAY_FEE_BPS);

        AdminRegistry adminReg = m.adminRegistry();
        adminReg.castVoteOnIssue(address(adminReg), "addWhitelist", goldAddr, "mint", address(forge));
        adminReg.castVoteOnIssue(address(adminReg), "addWhitelist", silverAddr, "mint", address(forge));

        Token(usdstAddr).mint(address(buyer1), BUYER_BALANCE);
        Token(usdstAddr).mint(address(buyer2), BUYER_BALANCE);
        Token(altPayAddr).mint(address(buyer1), BUYER_BALANCE);
        Token(altPayAddr).mint(address(buyer2), BUYER_BALANCE);

        buyer1.do(usdstAddr, "approve", address(forge), 2**256 - 1);
        buyer1.do(altPayAddr, "approve", address(forge), 2**256 - 1);
        buyer2.do(usdstAddr, "approve", address(forge), 2**256 - 1);
        buyer2.do(altPayAddr, "approve", address(forge), 2**256 - 1);
    }

    // ============================================================
    // ================ INITIALIZATION (BOILERPLATE) ==============
    // ============================================================

    function it_forge_initializes_with_correct_dependencies() {
        require(address(forge.oracle()) == address(oracle), "Oracle mismatch");
        require(address(forge.treasurer()) == treasurer, "Treasury mismatch");
        require(address(forge.feeCollector()) == address(collector), "FeeCollector mismatch");
        require(address(forge.usdst()) == usdstAddr, "USDST mismatch");
        require(forge.WAD() == 1e18, "WAD mismatch");
    }

    function it_forge_reverts_initialize_with_zero_address() {
        MetalForge f = new MetalForge(address(this));
        bool reverted;

        reverted = false;
        try { f.initialize(address(0), treasurer, address(collector), usdstAddr); } catch { reverted = true; }
        require(reverted, "Should revert with zero oracle");

        reverted = false;
        try { f.initialize(address(oracle), address(0), address(collector), usdstAddr); } catch { reverted = true; }
        require(reverted, "Should revert with zero treasurer");

        reverted = false;
        try { f.initialize(address(oracle), treasurer, address(0), usdstAddr); } catch { reverted = true; }
        require(reverted, "Should revert with zero feeCollector");

        reverted = false;
        try { f.initialize(address(oracle), treasurer, address(collector), address(0)); } catch { reverted = true; }
        require(reverted, "Should revert with zero usdst");
    }

    function it_forge_reverts_initialize_by_non_owner() {
        MetalForge f = new MetalForge(address(this));
        bool reverted = false;
        try {
            buyer1.do(address(f), "initialize", address(oracle), treasurer, address(collector), usdstAddr);
        } catch {
            reverted = true;
        }
        require(reverted, "Non-owner should not initialize");
    }

    function it_forge_reverts_admin_functions_by_non_owner() {
        bool reverted;

        reverted = false;
        try { buyer1.do(address(forge), "setOracle", address(oracle)); } catch { reverted = true; }
        require(reverted, "Non-owner should not setOracle");

        reverted = false;
        try { buyer1.do(address(forge), "setMetalConfig", goldAddr, true, 100e18); } catch { reverted = true; }
        require(reverted, "Non-owner should not setMetalConfig");

        reverted = false;
        try { buyer1.do(address(forge), "setPayTokenConfig", usdstAddr, true, 100); } catch { reverted = true; }
        require(reverted, "Non-owner should not setPayTokenConfig");
    }

    // ============================================================
    // ================== BASIC MINTING ===========================
    // ============================================================

    function it_forge_mints_metal_with_usdst_payment() {
        uint payAmount = 10000e18;
        // fee = 10000e18 * 100 / 10000 = 100e18, principal = 9900e18
        // fundsUSD = 9900e18 (USDST branch), goldAmount = 9900e18 * 1e18 / 2000e18 = 4.95e18
        uint expectedGold = (((payAmount - (payAmount * USDST_FEE_BPS) / 10000)) * WAD) / GOLD_PRICE;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == expectedGold, "Buyer gold balance wrong");
    }

    function it_forge_mints_metal_with_non_usdst_payment() {
        uint payAmount = 10000e18;
        // fee = 10000e18 * 200 / 10000 = 200e18, principal = 9800e18
        // fundsUSD = 9800e18 * 2e18 / 1e18 = 19600e18
        // goldAmount = 19600e18 * 1e18 / 2000e18 = 9.8e18
        uint feeAmt = (payAmount * ALTPAY_FEE_BPS) / 10000;
        uint principal = payAmount - feeAmt;
        uint fundsUSD = (principal * ALTPAY_PRICE) / WAD;
        uint expectedGold = (fundsUSD * WAD) / GOLD_PRICE;

        buyer1.do(address(forge), "mintMetal", goldAddr, altPayAddr, payAmount, 0);

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == expectedGold, "Buyer gold balance wrong");
    }

    function it_forge_reverts_mint_when_disabled() {
        forge.setMetalEnabled(goldAddr, false);
        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 1000e18, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when metal disabled");

        forge.setMetalEnabled(goldAddr, true);
        forge.setPayTokenEnabled(usdstAddr, false);
        reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 1000e18, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when pay token disabled");
    }

    function it_forge_reverts_mint_with_zero_pay_amount() {
        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 0, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert with zero payAmount");
    }

    // ============================================================
    // =============== FEE CALCULATION & DISTRIBUTION =============
    // ============================================================

    function it_forge_computes_correct_fee_and_principal() {
        uint payAmount = 7777e18;
        uint expectedFee = (payAmount * USDST_FEE_BPS) / 10000;
        uint expectedPrincipal = payAmount - expectedFee;

        uint treasurerBefore = ERC20(usdstAddr).balanceOf(treasurer);
        uint collectorBefore = ERC20(usdstAddr).balanceOf(address(collector));

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        uint treasurerAfter = ERC20(usdstAddr).balanceOf(treasurer);
        uint collectorAfter = ERC20(usdstAddr).balanceOf(address(collector));

        require(treasurerAfter - treasurerBefore == expectedPrincipal, "Treasury did not receive principal");
        require(collectorAfter - collectorBefore == expectedFee, "Collector did not receive fee");
    }

    function it_forge_distributes_payment_to_treasurer_and_fee_collector() {
        uint payAmount = 5000e18;
        uint expectedFee = (payAmount * USDST_FEE_BPS) / 10000;
        uint expectedPrincipal = payAmount - expectedFee;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(usdstAddr).balanceOf(treasurer) == expectedPrincipal, "Treasury balance wrong");
        require(ERC20(usdstAddr).balanceOf(address(collector)) == expectedFee, "Collector balance wrong");
    }

    function it_forge_payment_conservation_invariant() {
        uint[3] memory amounts = [uint(1e18), 12345e18, 999999e18];

        for (uint i = 0; i < 3; i++) {
            MetalForge f = new MetalForge(address(this));
            FeeCollector c = new FeeCollector(address(this));
            address t = address(uint(0xBEEF) + i);
            f.initialize(address(oracle), t, address(c), usdstAddr);
            f.setMetalConfig(goldAddr, true, GOLD_CAP);
            f.setPayTokenConfig(usdstAddr, true, USDST_FEE_BPS);
            AdminRegistry adminReg = m.adminRegistry();
            adminReg.castVoteOnIssue(address(adminReg), "addWhitelist", goldAddr, "mint", address(f));
            Token(usdstAddr).mint(address(buyer1), amounts[i]);
            buyer1.do(usdstAddr, "approve", address(f), amounts[i]);

            uint buyerBefore = ERC20(usdstAddr).balanceOf(address(buyer1));
            buyer1.do(address(f), "mintMetal", goldAddr, usdstAddr, amounts[i], 0);
            uint buyerAfter = ERC20(usdstAddr).balanceOf(address(buyer1));

            uint treasurerGot = ERC20(usdstAddr).balanceOf(t);
            uint collectorGot = ERC20(usdstAddr).balanceOf(address(c));

            require(buyerBefore - buyerAfter == amounts[i], "Buyer spent wrong amount");
            require(treasurerGot + collectorGot == amounts[i], "principal + fee != payAmount");
        }
    }

    function it_forge_dust_payment_bypasses_fee() {
        uint payAmount = 99;
        uint expectedFee = (payAmount * USDST_FEE_BPS) / 10000;
        require(expectedFee == 0, "Precondition: fee should round to 0 for dust");

        Token(usdstAddr).mint(address(buyer1), payAmount);
        buyer1.do(usdstAddr, "approve", address(forge), payAmount);

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(usdstAddr).balanceOf(treasurer) == payAmount, "All dust should go to treasurer");
        require(ERC20(usdstAddr).balanceOf(address(collector)) == 0, "Collector should get nothing from dust");
    }

    function it_forge_zero_fee_sends_all_to_treasurer() {
        forge.setPayTokenConfig(usdstAddr, true, 0);
        uint payAmount = 5000e18;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(usdstAddr).balanceOf(treasurer) == payAmount, "Treasury should receive all");
        require(ERC20(usdstAddr).balanceOf(address(collector)) == 0, "Collector should receive nothing");
    }

    // ============================================================
    // ============== METAL AMOUNT ARITHMETIC =====================
    // ============================================================

    function it_forge_computes_correct_metal_amount() {
        uint payAmount = 10000e18;
        uint fee = (payAmount * USDST_FEE_BPS) / 10000;
        uint principal = payAmount - fee;
        uint expectedGold = (principal * WAD) / GOLD_PRICE;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == expectedGold, "Gold amount mismatch");
        require(expectedGold == 4950000000000000000, "Expected 4.95e18 gold");
    }

    function it_forge_usdst_branch_skips_pay_token_oracle() {
        uint payAmount = 2000e18;
        forge.setPayTokenConfig(usdstAddr, true, 0);

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        uint expectedGold = (payAmount * WAD) / GOLD_PRICE;
        require(ERC20(goldAddr).balanceOf(address(buyer1)) == expectedGold, "USDST branch: gold mismatch");
        require(expectedGold == 1e18, "2000 USDST at $2000/oz = 1 oz");
    }

    function it_forge_non_usdst_branch_uses_pay_token_price() {
        uint payAmount = 1000e18;
        forge.setPayTokenConfig(altPayAddr, true, 0);

        // fundsUSD = 1000e18 * 2e18 / 1e18 = 2000e18
        // goldAmount = 2000e18 * 1e18 / 2000e18 = 1e18
        buyer1.do(address(forge), "mintMetal", goldAddr, altPayAddr, payAmount, 0);

        uint expectedGold = ((payAmount * ALTPAY_PRICE) / WAD * WAD) / GOLD_PRICE;
        require(ERC20(goldAddr).balanceOf(address(buyer1)) == expectedGold, "AltPay branch: gold mismatch");
        require(expectedGold == 1e18, "1000 ALT at $2/ALT and $2000/oz = 1 oz");
    }

    function it_forge_metal_amount_rounds_down() {
        oracle.setAssetPrice(goldAddr, 3e18);
        forge.setPayTokenConfig(usdstAddr, true, 0);
        uint payAmount = 10e18;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        uint goldBal = ERC20(goldAddr).balanceOf(address(buyer1));
        // metalAmount = (10e18 * 1e18) / 3e18 = 3333333333333333333 (floors)
        require(goldBal == 3333333333333333333, "Should floor to 3.33..e18");
        require(goldBal * 3e18 <= payAmount * WAD, "metalAmount * price <= fundsUSD * WAD");
        require((goldBal + 1) * 3e18 > payAmount * WAD, "Next integer would exceed");
    }

    function it_forge_high_metal_price_yields_zero_metal() {
        oracle.setAssetPrice(goldAddr, 1e30);
        forge.setPayTokenConfig(usdstAddr, true, 0);
        uint payAmount = 1;

        Token(usdstAddr).mint(address(buyer1), payAmount);
        buyer1.do(usdstAddr, "approve", address(forge), payAmount);

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == 0, "Should mint 0 metal");
    }

    // ============================================================
    // ================== SLIPPAGE PROTECTION =====================
    // ============================================================

    function it_forge_reverts_on_slippage_exceeded() {
        uint payAmount = 2000e18;
        forge.setPayTokenConfig(usdstAddr, true, 0);
        // metalAmount = (2000e18 * 1e18) / 2000e18 = 1e18
        uint tooHigh = 1e18 + 1;

        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, tooHigh);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when minMetalOut exceeds actual output");
    }

    function it_forge_accepts_mint_at_exact_slippage_boundary() {
        uint payAmount = 2000e18;
        forge.setPayTokenConfig(usdstAddr, true, 0);
        uint exactAmount = (payAmount * WAD) / GOLD_PRICE;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, exactAmount);

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == exactAmount, "Should mint at exact boundary");
    }

    // ============================================================
    // ===================== MINT CAP =============================
    // ============================================================

    function it_forge_reverts_when_mint_cap_exceeded() {
        forge.setMetalConfig(goldAddr, true, 1e18);
        forge.setPayTokenConfig(usdstAddr, true, 0);
        // 4000 USDST → 2 oz gold, but cap is 1 oz
        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 4000e18, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert when exceeding mint cap");
    }

    function it_forge_accepts_mint_at_exact_cap_boundary() {
        forge.setMetalConfig(goldAddr, true, 1e18);
        forge.setPayTokenConfig(usdstAddr, true, 0);
        // 2000 USDST → exactly 1 oz gold = exactly the cap
        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 2000e18, 0);

        require(forge.totalMinted(goldAddr) == 1e18, "totalMinted should equal cap");
    }

    function it_forge_mint_cap_is_per_metal() {
        forge.setMetalConfig(goldAddr, true, 10e18);
        forge.setPayTokenConfig(usdstAddr, true, 0);
        forge.setPayTokenConfig(altPayAddr, true, 0);

        // Mint 5 oz via USDST: 10000 USDST → 5 oz
        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 10000e18, 0);
        require(forge.totalMinted(goldAddr) == 5e18, "totalMinted after USDST mint");

        // Mint 5 oz via altPay: 5000 ALT at $2 → 10000 USD → 5 oz
        buyer1.do(address(forge), "mintMetal", goldAddr, altPayAddr, 5000e18, 0);
        require(forge.totalMinted(goldAddr) == 10e18, "totalMinted should accumulate across pay tokens");

        // Cap (10 oz) is now full — any further mint should revert
        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 2000e18, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert: cap reached via combined pay tokens");
    }

    function it_forge_total_minted_accumulates_correctly() {
        forge.setPayTokenConfig(usdstAddr, true, 0);
        uint cumulative = 0;

        for (uint i = 1; i <= 5; i++) {
            uint payAmount = i * 2000e18;
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);
            cumulative += (payAmount * WAD) / GOLD_PRICE;
            require(forge.totalMinted(goldAddr) == cumulative, "totalMinted mismatch after mint");
        }
    }

    function it_forge_lowered_cap_blocks_further_minting() {
        forge.setPayTokenConfig(usdstAddr, true, 0);

        // Mint 5 oz
        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 10000e18, 0);
        require(forge.totalMinted(goldAddr) == 5e18, "Should have 5 oz minted");

        // Lower cap to 5 oz (equal to totalMinted) — should not revert
        forge.setMintCap(goldAddr, 5e18);

        // Any additional mint should revert
        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 2000e18, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert after cap lowered to totalMinted");
    }

    // ============================================================
    // ============= FEE BPS BOUNDARY CONDITIONS ==================
    // ============================================================

    function it_forge_fee_bps_10000_mints_zero_metal() {
        forge.setPayTokenConfig(usdstAddr, true, 10000);
        uint payAmount = 1000e18;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == 0, "Should mint 0 metal at 100% fee");
        require(ERC20(usdstAddr).balanceOf(address(collector)) == payAmount, "All payment to fee collector");
        require(ERC20(usdstAddr).balanceOf(treasurer) == 0, "Nothing to treasurer");
    }

    function it_forge_reverts_when_fee_bps_exceeds_10000() {
        forge.setPayTokenConfig(usdstAddr, true, 10001);
        bool reverted = false;
        try {
            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 1000e18, 0);
        } catch {
            reverted = true;
        }
        require(reverted, "Should revert: feeAmount > payAmount causes underflow");
    }

    // ============================================================
    // ============== CONFIG MANAGEMENT ===========================
    // ============================================================

    function it_forge_set_config_stores_values() {
        forge.setMetalConfig(goldAddr, false, 42e18);
        (bool mEnabled, uint mCap) = forge.metalConfigs(goldAddr);
        require(!mEnabled, "Metal should be disabled");
        require(mCap == 42e18, "MintCap mismatch");

        forge.setPayTokenConfig(usdstAddr, false, 555);
        (bool pEnabled, uint pFee) = forge.payTokenConfigs(usdstAddr);
        require(!pEnabled, "PayToken should be disabled");
        require(pFee == 555, "FeeBps mismatch");
    }

    function it_forge_set_metal_and_pay_token_config_independently() {
        forge.setMetalConfig(goldAddr, true, 50e18);
        forge.setMetalConfig(silverAddr, false, 99e18);

        (bool gEnabled, uint gCap) = forge.metalConfigs(goldAddr);
        (bool sEnabled, uint sCap) = forge.metalConfigs(silverAddr);
        require(gEnabled && gCap == 50e18, "Gold config wrong");
        require(!sEnabled && sCap == 99e18, "Silver config wrong");

        forge.setPayTokenConfig(usdstAddr, true, 300);
        forge.setPayTokenConfig(altPayAddr, false, 0);

        (bool uEnabled, uint uFee) = forge.payTokenConfigs(usdstAddr);
        (bool aEnabled, uint aFee) = forge.payTokenConfigs(altPayAddr);
        require(uEnabled && uFee == 300, "USDST pay config wrong");
        require(!aEnabled && aFee == 0, "AltPay pay config wrong");
    }

    function it_forge_individual_setters_update_single_field() {
        // setMintCap should only update mintCap, not isEnabled
        forge.setMetalConfig(goldAddr, true, 100e18);
        forge.setMintCap(goldAddr, 200e18);
        (bool enabled, uint cap) = forge.metalConfigs(goldAddr);
        require(enabled, "setMintCap should not change isEnabled");
        require(cap == 200e18, "setMintCap should update cap");

        // setFeeBps should only update feeBps, not isEnabled
        forge.setPayTokenConfig(usdstAddr, true, 100);
        forge.setFeeBps(usdstAddr, 500);
        (bool pEnabled, uint fee) = forge.payTokenConfigs(usdstAddr);
        require(pEnabled, "setFeeBps should not change isEnabled");
        require(fee == 500, "setFeeBps should update fee");

        // setMetalEnabled should only update isEnabled, not mintCap
        forge.setMetalEnabled(goldAddr, false);
        (bool en2, uint cap2) = forge.metalConfigs(goldAddr);
        require(!en2, "setMetalEnabled should disable");
        require(cap2 == 200e18, "setMetalEnabled should not change cap");

        // setPayTokenEnabled should only update isEnabled, not feeBps
        forge.setPayTokenEnabled(usdstAddr, false);
        (bool en3, uint fee2) = forge.payTokenConfigs(usdstAddr);
        require(!en3, "setPayTokenEnabled should disable");
        require(fee2 == 500, "setPayTokenEnabled should not change feeBps");
    }

    // ============================================================
    // ============= MULTI-BUYER / MULTI-METAL ====================
    // ============================================================

    function it_forge_multiple_buyers_mint_same_metal() {
        forge.setPayTokenConfig(usdstAddr, true, 0);
        uint pay1 = 4000e18;
        uint pay2 = 6000e18;

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, pay1, 0);
        buyer2.do(address(forge), "mintMetal", goldAddr, usdstAddr, pay2, 0);

        uint gold1 = (pay1 * WAD) / GOLD_PRICE;
        uint gold2 = (pay2 * WAD) / GOLD_PRICE;

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == gold1, "Buyer1 gold wrong");
        require(ERC20(goldAddr).balanceOf(address(buyer2)) == gold2, "Buyer2 gold wrong");
        require(forge.totalMinted(goldAddr) == gold1 + gold2, "totalMinted should reflect both");
    }

    function it_forge_multiple_metals_independent_state() {
        forge.setPayTokenConfig(usdstAddr, true, 0);

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, 4000e18, 0);
        buyer1.do(address(forge), "mintMetal", silverAddr, usdstAddr, 500e18, 0);

        uint goldMinted = (4000e18 * WAD) / GOLD_PRICE;
        uint silverMinted = (500e18 * WAD) / SILVER_PRICE;

        require(forge.totalMinted(goldAddr) == goldMinted, "Gold totalMinted wrong");
        require(forge.totalMinted(silverAddr) == silverMinted, "Silver totalMinted wrong");
        require(goldMinted != silverMinted, "Sanity: amounts differ");
    }

    // ============================================================
    // ============ END-TO-END BALANCE INVARIANTS =================
    // ============================================================

    function it_forge_end_to_end_balance_invariants() {
        uint payAmount = 8000e18;
        uint fee = (payAmount * USDST_FEE_BPS) / 10000;
        uint principal = payAmount - fee;
        uint expectedGold = (principal * WAD) / GOLD_PRICE;

        uint buyerPayBefore = ERC20(usdstAddr).balanceOf(address(buyer1));
        uint buyerGoldBefore = ERC20(goldAddr).balanceOf(address(buyer1));
        uint treasurerBefore = ERC20(usdstAddr).balanceOf(treasurer);
        uint collectorBefore = ERC20(usdstAddr).balanceOf(address(collector));
        uint goldSupplyBefore = ERC20(goldAddr).totalSupply();

        buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payAmount, 0);

        require(buyerPayBefore - ERC20(usdstAddr).balanceOf(address(buyer1)) == payAmount, "Buyer pay delta");
        require(ERC20(goldAddr).balanceOf(address(buyer1)) - buyerGoldBefore == expectedGold, "Buyer gold delta");
        require(ERC20(usdstAddr).balanceOf(treasurer) - treasurerBefore == principal, "Treasury delta");
        require(ERC20(usdstAddr).balanceOf(address(collector)) - collectorBefore == fee, "Collector delta");
        require(ERC20(goldAddr).totalSupply() - goldSupplyBefore == expectedGold, "Gold supply delta");
    }

    function it_forge_cumulative_mints_preserve_invariants() {
        forge.setPayTokenConfig(usdstAddr, true, 0);

        uint totalPaid = 0;
        uint totalGold = 0;

        uint[3] memory payments = [uint(2000e18), 4000e18, 6000e18];
        uint[3] memory prices = [uint(2000e18), 1800e18, 2200e18];

        for (uint i = 0; i < 3; i++) {
            oracle.setAssetPrice(goldAddr, prices[i]);
            uint expectedGold = (payments[i] * WAD) / prices[i];

            buyer1.do(address(forge), "mintMetal", goldAddr, usdstAddr, payments[i], 0);

            totalPaid += payments[i];
            totalGold += expectedGold;
        }

        require(ERC20(goldAddr).balanceOf(address(buyer1)) == totalGold, "Cumulative gold balance wrong");
        require(ERC20(usdstAddr).balanceOf(treasurer) == totalPaid, "Cumulative treasurer balance wrong");
        require(forge.totalMinted(goldAddr) == totalGold, "Cumulative totalMinted wrong");
    }
}
