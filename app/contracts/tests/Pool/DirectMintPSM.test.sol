import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";

contract Describe_DirectMintPSM {

    Mercata m;
    Token USDST;
    Token USDC;
    Token USDT;
    DirectMintPSM psm;
    User user;
    User user2;
    User admin;

    function beforeAll() {
        m = new Mercata();

        // This ugly pattern is neccessary to avoid making this contract Authorizable,
        // which I don't want because that fails to cover EOA admin cases.
        (bool success1, variadic retUSDST) = m.adminRegistry().castVoteOnIssue(address(m.tokenFactory()), "createToken", "USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        require(success1, "USDST not created");
        USDST = Token(address(retUSDST));
        (bool success2, variadic retUSDC) = m.adminRegistry().castVoteOnIssue(address(m.tokenFactory()), "createToken", "USDC", "USDC Token", [], [], [], "USDC", 0, 18);
        require(success2, "USDC not created");
        USDC = Token(address(retUSDC));
        (bool success3, variadic retUSDT) = m.adminRegistry().castVoteOnIssue(address(m.tokenFactory()), "createToken", "USDT", "USDT Token", [], [], [], "USDT", 0, 18);
        require(success3, "USDT not created");
        USDT = Token(address(retUSDT));

        (bool success4, variadic retUSDSTStatus) = m.adminRegistry().castVoteOnIssue(address(USDST), "setStatus", 2);
        require(success4, "USDST status not set");
        require(USDST.status() == TokenStatus.ACTIVE, "USDST status not active");
        (bool success5, variadic retUSDCStatus) = m.adminRegistry().castVoteOnIssue(address(USDC), "setStatus", 2);
        require(success5, "USDC status not set");
        require(USDC.status() == TokenStatus.ACTIVE, "USDC status not active");
        (bool success6, variadic retUSDTStatus) = m.adminRegistry().castVoteOnIssue(address(USDT), "setStatus", 2);
        require(success6, "USDT status not set");
        require(USDT.status() == TokenStatus.ACTIVE, "USDT status not active");

        psm = DirectMintPSM(address(new Proxy(address(new DirectMintPSM(address(0xdeadbeef))), address(m.adminRegistry()))));

        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(USDST), "mint", address(psm));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(USDST), "burn", address(psm));
    }


    function beforeEach() {
        (bool success, variadic ret) = m.adminRegistry().castVoteOnIssue(address(psm), "initialize", address(USDST), address(m.feeCollector()), [address(USDC), address(USDT)]);
        require(success, "PSM initialize did not execute");
        require(psm.mintableToken() == address(USDST), "Mintable token should be USDST");
        (bool usdcMintEnabled, uint usdcMaxBalance, uint usdcMintFeeBps) = psm.mintConfigs(address(USDC));
        (bool usdcBurnEnabled, uint usdcMinReserve, uint usdcBurnFeeBps) = psm.burnConfigs(address(USDC));
        (bool usdtMintEnabled, uint usdtMaxBalance, uint usdtMintFeeBps) = psm.mintConfigs(address(USDT));
        (bool usdtBurnEnabled, uint usdtMinReserve, uint usdtBurnFeeBps) = psm.burnConfigs(address(USDT));
        require(usdcMintEnabled && usdcBurnEnabled, "USDC should be enabled");
        require(usdtMintEnabled && usdtBurnEnabled, "USDT should be enabled");
    }

    function _ensureAuthorizableAdmin() internal {
        if (address(admin) == address(0)) {
            admin = User(new Admin());
            (bool success, variadic ret) = m.adminRegistry().castVoteOnIssue(address(m.adminRegistry()), "_swapAdmin", address(this), address(admin));
            require(success, "Admin swap did not execute");
        }
    }

    function _createActiveToken(string _name, string _symbol, uint8 _decimals) internal returns (Token token) {
        _ensureAuthorizableAdmin();
        variadic ret = admin.doSuccessfully(address(m.tokenFactory()), "createToken", _name, _name, [], [], [], _symbol, 0, _decimals);
        token = Token(address(ret));
        admin.doSuccessfully(address(token), "setStatus", 2);
        require(token.status() == TokenStatus.ACTIVE, "Created token should be active");
    }

    function _newPsm() internal returns (DirectMintPSM freshPsm) {
        _ensureAuthorizableAdmin();
        freshPsm = DirectMintPSM(address(new Proxy(address(new DirectMintPSM(address(0xdeadbeef))), address(m.adminRegistry()))));
        admin.doSuccessfully(address(m.adminRegistry()), "addWhitelist", address(USDST), "mint", address(freshPsm));
        admin.doSuccessfully(address(m.adminRegistry()), "addWhitelist", address(USDST), "burn", address(freshPsm));
    }

    function _newInitializedPsm() internal returns (DirectMintPSM freshPsm) {
        freshPsm = _newPsm();
        admin.doSuccessfully(address(freshPsm), "initialize", address(USDST), address(m.feeCollector()), [address(USDC), address(USDT)]);
    }

    function it_psm_can_be_configured() {
        // beforeEach() runs the relevant code
        (bool mintEnabled, uint maxBalance, uint mintFeeBps) = psm.mintConfigs(address(USDC));
        (bool burnEnabled, uint minReserve, uint burnFeeBps) = psm.burnConfigs(address(USDC));
        require(mintEnabled, "USDC mint should be enabled");
        require(burnEnabled, "USDC burn should be enabled");
        require(maxBalance == 0, "USDC max balance should default to unlimited");
        require(minReserve == 0, "USDC min reserve should default to zero");
        require(mintFeeBps == 0, "USDC mint fee should default to zero");
        require(burnFeeBps == 0, "USDC burn fee should default to zero");
    }

    function it_psm_can_mint() {
        // Set an Authorizable admin to enable callback-style ownership checks
        _ensureAuthorizableAdmin();

        // Mint user 100 USDC against which to direct mint
        user = new User();
        admin.doSuccessfully(address(USDC), "mint", address(user), 100e18);
        require(user.doSuccessfully(address(psm), "mintableToken") == address(USDST), "Mintable token should be USDST");
        require(USDC.balanceOf(address(user)) == 100e18, "User should have 100 USDC");

        // Direct mint 1:1 100 USDST against the 100 USDC
        user.doSuccessfully(address(USDC), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "mint", 100e18, address(USDC));
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC");
    }

    function it_psm_can_redeem_in_a_single_step() {
        // Begins with the end state from it_psm_can_mint()
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");

        // A single call burns the USDST and pays out the USDC 1:1.
        user.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "redeem", 100e18, address(USDC));

        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDC.balanceOf(address(user)) == 100e18, "User should have 100 USDC");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should never escrow USDST");
        require(USDC.balanceOf(address(psm)) == 0, "PSM should have 0 USDC");
        require(psm.availableRedemptionLiquidity(address(USDC)) == 0, "PSM should have no available USDC");
    }

    function it_psm_works_accross_users() {
        // User2 has USDST from other sources, but has never deposited in the PSM
        user2 = new User();
        admin.doSuccessfully(address(USDST), "mint", address(user2), 300e18);

        // User1 deposits the USDC they just redeemed, plus fresh USDT
        user.doSuccessfully(address(USDC), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "mint", 100e18, address(USDC));
        admin.doSuccessfully(address(USDT), "mint", address(user), 100e18);
        user.doSuccessfully(address(USDT), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "mint", 100e18, address(USDT));
        require(USDST.balanceOf(address(user)) == 200e18, "User should have 200 USDST");

        // User2 redeems their own USDST against unrelated PSM liquidity
        user2.doSuccessfully(address(USDST), "approve", address(psm), 300e18);
        user2.doSuccessfully(address(psm), "redeem", 100e18, address(USDT));
        require(USDST.balanceOf(address(user2)) == 200e18, "User2 should have 200 USDST");
        require(USDT.balanceOf(address(user2)) == 100e18, "User2 should have 100 USDT");
        require(USDT.balanceOf(address(psm)) == 0, "PSM should have 0 USDT");

        // USDT liquidity is now exhausted, and nobody can redeem beyond what backs the PSM
        user2.doExpectingFailure(address(psm), "redeem", "Insufficient liquidity", 1e18, address(USDT));
        user2.doExpectingFailure(address(psm), "redeem", "Insufficient liquidity", 200e18, address(USDC));

        // One user's redemption does not touch another's balance
        require(USDST.balanceOf(address(user)) == 200e18, "User1 USDST should be untouched by user2 redemption");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should still hold user1 USDC backing");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should hold no USDST between redemptions");
    }

    function it_psm_liquidity_limited() {
        // Redeemable liquidity is exactly what the PSM holds — there is nothing reserved.
        require(psm.availableRedemptionLiquidity(address(USDC)) == USDC.balanceOf(address(psm)), "Available USDC should equal PSM balance");
        require(psm.availableRedemptionLiquidity(address(USDT)) == 0, "Available USDT should be zero");

        // User1 redeems half of their USDST, leaving the rest outstanding.
        user.doSuccessfully(address(USDST), "approve", address(psm), 200e18);
        user.doSuccessfully(address(psm), "redeem", 50e18, address(USDC));
        require(USDC.balanceOf(address(user)) == 50e18, "User should receive 50 USDC");
        require(USDST.balanceOf(address(user)) == 150e18, "User should retain 150 USDST");
        require(psm.availableRedemptionLiquidity(address(USDC)) == 50e18, "Remaining USDC should stay redeemable");

        // The rest of their USDST is unbacked by USDC and cannot be redeemed.
        user.doExpectingFailure(address(psm), "redeem", "Insufficient liquidity", 150e18, address(USDC));

        // Return the PSM to a 100 USDC backing for the tests that follow.
        user.doSuccessfully(address(USDC), "approve", address(psm), 50e18);
        user.doSuccessfully(address(psm), "mint", 50e18, address(USDC));
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should hold 100 USDC");
    }

    function it_psm_enforces_mint_controls() {
        uint psmUsdcBefore = USDC.balanceOf(address(psm));
        uint user2UsdstBefore = USDST.balanceOf(address(user2));

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, psmUsdcBefore + 145e18, 0);
        admin.doSuccessfully(address(USDC), "mint", address(user2), 200e18);

        user2.doSuccessfully(address(USDC), "approve", address(psm), 200e18);

        user2.doSuccessfully(address(psm), "mint", 70e18, address(USDC));
        user2.doSuccessfully(address(psm), "mint", 75e18, address(USDC));
        user2.doExpectingFailure(address(psm), "mint", "Token balance cap exceeded", 10e18, address(USDC));

        require(USDC.balanceOf(address(psm)) == psmUsdcBefore + 145e18, "PSM should hold the capped USDC");
        require(USDST.balanceOf(address(user2)) == user2UsdstBefore + 145e18, "User2 should have original plus newly minted USDST");

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
    }

    function it_psm_enforces_burn_controls() {
        // minReserve is a hard floor on redeemable liquidity.
        uint psmUsdcBefore = USDC.balanceOf(address(psm));
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, psmUsdcBefore - 100e18, 0);
        require(psm.availableRedemptionLiquidity(address(USDC)) == 100e18, "PSM should preserve min reserve");

        user2.doSuccessfully(address(USDST), "approve", address(psm), 200e18);
        user2.doSuccessfully(address(psm), "redeem", 50e18, address(USDC));
        require(psm.availableRedemptionLiquidity(address(USDC)) == 50e18, "Redeem should draw down available liquidity");

        user2.doSuccessfully(address(psm), "redeem", 50e18, address(USDC));
        require(psm.availableRedemptionLiquidity(address(USDC)) == 0, "Redeem should exhaust available liquidity");

        // The reserve itself is untouchable.
        user2.doExpectingFailure(address(psm), "redeem", "Insufficient liquidity", 1e18, address(USDC));
        require(USDC.balanceOf(address(psm)) == psmUsdcBefore - 100e18, "PSM should retain exactly minReserve");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0);
    }

    function it_psm_enforces_enabled_controls() {
        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), false, 0, 0);
        user2.doExpectingFailure(address(psm), "mint", "Minting for this token is disabled", 10e18, address(USDC));

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), false, 0, 0);
        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doExpectingFailure(address(psm), "redeem", "Token burn is disabled", 10e18, address(USDC));

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0);
    }

    function it_psm_requires_active_tokens_for_user_flows() {
        admin.doSuccessfully(address(USDC), "mint", address(user2), 30e18);
        user2.doSuccessfully(address(USDC), "approve", address(psm), 30e18);
        user2.doSuccessfully(address(psm), "mint", 10e18, address(USDC));
        user2.doSuccessfully(address(USDST), "approve", address(psm), 10e18);

        admin.doSuccessfully(address(USDC), "setStatus", 3);
        user2.doExpectingFailure(address(psm), "mint", "Token not active", 10e18, address(USDC));
        user2.doExpectingFailure(address(psm), "redeem", "Token not active", 10e18, address(USDC));

        admin.doSuccessfully(address(USDC), "setStatus", 2);
        user2.doSuccessfully(address(psm), "redeem", 10e18, address(USDC));
    }

    function it_psm_rejects_invalid_amounts_without_state_changes() {
        uint usdcPsmBefore = USDC.balanceOf(address(psm));
        uint usdcUserBefore = USDC.balanceOf(address(user2));
        uint usdstUserBefore = USDST.balanceOf(address(user2));
        uint usdstPsmBefore = USDST.balanceOf(address(psm));

        user2.doExpectingFailure(address(psm), "mint", "Amount must be nonzero", 0, address(USDC));
        user2.doExpectingFailure(address(psm), "redeem", "Amount must be nonzero", 0, address(USDC));

        require(USDC.balanceOf(address(psm)) == usdcPsmBefore, "PSM USDC should not change");
        require(USDC.balanceOf(address(user2)) == usdcUserBefore, "User2 USDC should not change");
        require(USDST.balanceOf(address(user2)) == usdstUserBefore, "User2 USDST should not change");
        require(USDST.balanceOf(address(psm)) == usdstPsmBefore, "PSM USDST should not change");
    }

    function it_psm_rejected_mint_preserves_allowance_and_balances() {
        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, USDC.balanceOf(address(psm)) + 5e18, 0);
        admin.doSuccessfully(address(USDC), "mint", address(user2), 20e18);

        uint userBalanceBefore = USDC.balanceOf(address(user2));
        uint psmBalanceBefore = USDC.balanceOf(address(psm));
        uint usdBalanceBefore = USDST.balanceOf(address(user2));
        user2.doSuccessfully(address(USDC), "approve", address(psm), 20e18);

        user2.doExpectingFailure(address(psm), "mint", "Token balance cap exceeded", 10e18, address(USDC));

        require(USDC.balanceOf(address(user2)) == userBalanceBefore, "Rejected mint should not pull USDC");
        require(USDC.balanceOf(address(psm)) == psmBalanceBefore, "Rejected mint should not increase PSM USDC");
        require(USDST.balanceOf(address(user2)) == usdBalanceBefore, "Rejected mint should not mint USDST");
        require(USDC.allowance(address(user2), address(psm)) == 20e18, "Rejected mint should not consume allowance");

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
    }

    function it_psm_rejected_redeem_preserves_allowance_and_balances() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, USDC.balanceOf(address(psm)), 0);

        uint userBalanceBefore = USDST.balanceOf(address(user2));
        uint psmUsdBefore = USDST.balanceOf(address(psm));
        uint psmUsdcBefore = USDC.balanceOf(address(psm));
        user2.doSuccessfully(address(USDST), "approve", address(psm), 25e18);

        user2.doExpectingFailure(address(psm), "redeem", "Insufficient liquidity", 25e18, address(USDC));

        require(USDST.balanceOf(address(user2)) == userBalanceBefore, "Rejected redeem should not pull USDST");
        require(USDST.balanceOf(address(psm)) == psmUsdBefore, "Rejected redeem should not increase PSM USDST");
        require(USDC.balanceOf(address(psm)) == psmUsdcBefore, "Rejected redeem should not pay out USDC");
        require(USDST.allowance(address(user2), address(psm)) == 25e18, "Rejected redeem should not consume allowance");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0);
    }

    function it_psm_rejects_invalid_config_tokens_and_fee_bps() {
        user2.doExpectingFailure(address(psm), "setMintConfig", "Only an admin or a whitelisted account can call castVoteOnIssue", address(USDC), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setMintConfig", "Invalid token", address(0), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setMintConfig", "Invalid token", address(USDST), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setBurnConfig", "Invalid token", address(USDST), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setMintConfig", "Invalid fee bps", address(USDC), true, 0, 10001);
        admin.doExpectingFailure(address(psm), "setBurnConfig", "Invalid fee bps", address(USDC), true, 0, 10001);
    }

    function it_psm_supports_granular_mint_config_setters() {
        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);

        admin.doSuccessfully(address(psm), "setMintEnabled", address(USDC), false);
        (bool mintEnabled1, uint maxBalance1, uint mintFeeBps1) = psm.mintConfigs(address(USDC));
        require(!mintEnabled1, "Mint enabled should update");
        require(maxBalance1 == 0, "Mint enabled setter should preserve max balance");
        require(mintFeeBps1 == 0, "Mint enabled setter should preserve fee");

        admin.doSuccessfully(address(psm), "setMintMaxBalance", address(USDC), 123e18);
        (bool mintEnabled2, uint maxBalance2, uint mintFeeBps2) = psm.mintConfigs(address(USDC));
        require(!mintEnabled2, "Mint max balance setter should preserve enabled");
        require(maxBalance2 == 123e18, "Mint max balance should update");
        require(mintFeeBps2 == 0, "Mint max balance setter should preserve fee");

        admin.doSuccessfully(address(psm), "setMintFeeBps", address(USDC), 42);
        (bool mintEnabled3, uint maxBalance3, uint mintFeeBps3) = psm.mintConfigs(address(USDC));
        require(!mintEnabled3, "Mint fee setter should preserve enabled");
        require(maxBalance3 == 123e18, "Mint fee setter should preserve max balance");
        require(mintFeeBps3 == 42, "Mint fee should update");

        admin.doExpectingFailure(address(psm), "setMintFeeBps", "Invalid fee bps", address(USDC), 10001);
        (bool mintEnabled4, uint maxBalance4, uint mintFeeBps4) = psm.mintConfigs(address(USDC));
        require(!mintEnabled4, "Rejected mint fee should preserve enabled");
        require(maxBalance4 == 123e18, "Rejected mint fee should preserve max balance");
        require(mintFeeBps4 == 42, "Rejected mint fee should preserve fee");

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
    }

    function it_psm_supports_granular_burn_config_setters() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0);

        admin.doSuccessfully(address(psm), "setBurnEnabled", address(USDC), false);
        (bool burnEnabled1, uint minReserve1, uint burnFeeBps1) = psm.burnConfigs(address(USDC));
        require(!burnEnabled1, "Burn enabled should update");
        require(minReserve1 == 0, "Burn enabled setter should preserve min reserve");
        require(burnFeeBps1 == 0, "Burn enabled setter should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnMinReserve", address(USDC), 33e18);
        (bool burnEnabled2, uint minReserve2, uint burnFeeBps2) = psm.burnConfigs(address(USDC));
        require(!burnEnabled2, "Burn reserve setter should preserve enabled");
        require(minReserve2 == 33e18, "Burn min reserve should update");
        require(burnFeeBps2 == 0, "Burn reserve setter should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnFeeBps", address(USDC), 17);
        (bool burnEnabled3, uint minReserve3, uint burnFeeBps3) = psm.burnConfigs(address(USDC));
        require(!burnEnabled3, "Burn fee setter should preserve enabled");
        require(minReserve3 == 33e18, "Burn fee setter should preserve min reserve");
        require(burnFeeBps3 == 17, "Burn fee should update");

        admin.doExpectingFailure(address(psm), "setBurnFeeBps", "Invalid fee bps", address(USDC), 10001);
        (bool burnEnabled4, uint minReserve4, uint burnFeeBps4) = psm.burnConfigs(address(USDC));
        require(!burnEnabled4, "Rejected burn fee should preserve enabled");
        require(minReserve4 == 33e18, "Rejected burn fee should preserve min reserve");
        require(burnFeeBps4 == 17, "Rejected burn fee should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0);
    }

    function it_psm_sends_mint_fee_to_fee_collector_without_breaking_backing() {
        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 100);
        admin.doSuccessfully(address(USDC), "mint", address(user2), 100e18);

        uint userUsdcBefore = USDC.balanceOf(address(user2));
        uint userUsdstBefore = USDST.balanceOf(address(user2));
        uint psmUsdcBefore = USDC.balanceOf(address(psm));
        uint collectorUsdcBefore = USDC.balanceOf(address(m.feeCollector()));

        user2.doSuccessfully(address(USDC), "approve", address(psm), 100e18);
        user2.doSuccessfully(address(psm), "mint", 100e18, address(USDC));

        require(USDC.balanceOf(address(user2)) == userUsdcBefore - 100e18, "Mint fee flow should pull full USDC");
        require(USDC.balanceOf(address(psm)) == psmUsdcBefore + 99e18, "Mint fee flow should keep net backing");
        require(USDC.balanceOf(address(m.feeCollector())) == collectorUsdcBefore + 1e18, "Mint fee should go to FeeCollector");
        require(USDST.balanceOf(address(user2)) == userUsdstBefore + 99e18, "Mint fee flow should mint net USDST");

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
    }

    function it_psm_enforces_global_mint_pause_controls() {
        admin.doSuccessfully(address(USDC), "mint", address(user2), 20e18);
        user2.doSuccessfully(address(USDC), "approve", address(psm), 20e18);

        admin.doSuccessfully(address(psm), "pauseMint");
        require(psm.mintPaused(), "Mint should be paused");
        user2.doExpectingFailure(address(psm), "mint", "Minting is paused", 10e18, address(USDC));

        admin.doSuccessfully(address(psm), "unpauseMint");
        require(!psm.mintPaused(), "Mint should be unpaused");
        user2.doSuccessfully(address(psm), "mint", 10e18, address(USDC));
    }

    function it_psm_enforces_global_burn_pause_controls() {
        user2.doSuccessfully(address(USDST), "approve", address(psm), 40e18);

        admin.doSuccessfully(address(psm), "pauseBurn");
        require(psm.burnPaused(), "Burn should be paused");
        user2.doExpectingFailure(address(psm), "redeem", "Burning is paused", 10e18, address(USDC));

        admin.doSuccessfully(address(psm), "unpauseBurn");
        require(!psm.burnPaused(), "Burn should be unpaused");
        user2.doSuccessfully(address(psm), "redeem", 10e18, address(USDC));
    }

    function it_psm_applies_redeem_fee_to_payout_and_collector() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 100);
        admin.doSuccessfully(address(USDST), "mint", address(user2), 100e18);

        uint userUsdcBefore = USDC.balanceOf(address(user2));
        uint userUsdstBefore = USDST.balanceOf(address(user2));
        uint psmUsdcBefore = USDC.balanceOf(address(psm));
        uint collectorUsdcBefore = USDC.balanceOf(address(m.feeCollector()));

        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doSuccessfully(address(psm), "redeem", 100e18, address(USDC));

        require(USDST.balanceOf(address(user2)) == userUsdstBefore - 100e18, "Redeem should burn the full amount of USDST");
        require(USDC.balanceOf(address(user2)) == userUsdcBefore + 99e18, "Redeem should pay net USDC");
        require(USDC.balanceOf(address(m.feeCollector())) == collectorUsdcBefore + 1e18, "Redeem fee should go to FeeCollector");
        require(USDC.balanceOf(address(psm)) == psmUsdcBefore - 100e18, "Redeem should remove full outflow from PSM");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0);
    }

    function it_psm_rejects_invalid_initialize_inputs() {
        DirectMintPSM fresh = _newPsm();

        admin.doExpectingFailure(address(fresh), "initialize", "Invalid mintable token", address(0), address(m.feeCollector()), [address(USDC)]);
        admin.doExpectingFailure(address(fresh), "initialize", "Invalid fee collector", address(USDST), address(0), [address(USDC)]);
        admin.doExpectingFailure(address(fresh), "initialize", "Invalid eligible tokens", address(USDST), address(m.feeCollector()), []);
        admin.doExpectingFailure(address(fresh), "initialize", "Invalid token", address(USDST), address(m.feeCollector()), [address(USDST)]);

        Token sixDecimalToken = _createActiveToken("Six Decimal Token", "SIX", 6);
        admin.doExpectingFailure(address(fresh), "initialize", "Decimal mismatch", address(USDST), address(m.feeCollector()), [address(sixDecimalToken)]);

        variadic retPending = admin.doSuccessfully(address(m.tokenFactory()), "createToken", "Pending Token", "Pending Token", [], [], [], "PEND", 0, 18);
        Token pendingToken = Token(address(retPending));
        admin.doExpectingFailure(address(fresh), "initialize", "Token not active", address(USDST), address(m.feeCollector()), [address(pendingToken)]);

        admin.doSuccessfully(address(fresh), "initialize", address(USDST), address(m.feeCollector()), [address(USDC)]);
        require(fresh.mintableToken() == address(USDST), "Valid initialize should set mintable token");
        (bool mintEnabled, uint maxBalance, uint mintFeeBps) = fresh.mintConfigs(address(USDC));
        (bool burnEnabled, uint minReserve, uint burnFeeBps) = fresh.burnConfigs(address(USDC));
        require(mintEnabled && burnEnabled, "Valid initialize should enable eligible token");
        require(maxBalance == 0 && minReserve == 0, "Valid initialize should set defaults");
        require(mintFeeBps == 0 && burnFeeBps == 0, "Valid initialize should set zero fees");
    }

    function it_psm_reinitialize_is_currently_allowed_and_overwrites_admin_config() {
        DirectMintPSM fresh = _newInitializedPsm();
        FeeCollector newCollector = FeeCollector(address(new Proxy(address(new FeeCollector(address(0xdeadbeef))), address(m.adminRegistry()))));

        admin.doSuccessfully(address(fresh), "setMintConfig", address(USDC), true, 500e18, 25);
        admin.doSuccessfully(address(fresh), "initialize", address(USDST), address(newCollector), [address(USDT)]);

        require(address(fresh.feeCollector()) == address(newCollector), "Reinitialize should overwrite fee collector today");
        (bool usdcMintEnabled, uint usdcMaxBalance, uint usdcMintFeeBps) = fresh.mintConfigs(address(USDC));
        (bool usdtMintEnabled, uint usdtMaxBalance, uint usdtMintFeeBps) = fresh.mintConfigs(address(USDT));
        (bool usdtBurnEnabled, uint usdtMinReserve, uint usdtBurnFeeBps) = fresh.burnConfigs(address(USDT));
        require(usdcMintEnabled && usdcMaxBalance == 500e18 && usdcMintFeeBps == 25, "Reinitialize should not clear old token config today");
        require(usdtMintEnabled && usdtMaxBalance == 0 && usdtMintFeeBps == 0, "Reinitialize should set new mint config today");
        require(usdtBurnEnabled && usdtMinReserve == 0 && usdtBurnFeeBps == 0, "Reinitialize should set new burn config today");
    }

    function it_psm_fee_bps_10000_rejects_user_flows_without_state_changes() {
        DirectMintPSM fresh = _newInitializedPsm();
        User actor = new User();
        admin.doSuccessfully(address(USDC), "mint", address(actor), 20e18);

        admin.doSuccessfully(address(fresh), "setMintFeeBps", address(USDC), 10000);
        actor.doSuccessfully(address(USDC), "approve", address(fresh), 20e18);
        actor.doExpectingFailure(address(fresh), "mint", "Mint amount must be nonzero", 10e18, address(USDC));
        require(USDC.balanceOf(address(actor)) == 20e18, "Rejected 100% mint fee should not pull USDC");
        require(USDST.balanceOf(address(actor)) == 0, "Rejected 100% mint fee should not mint USDST");
        require(USDC.allowance(address(actor), address(fresh)) == 20e18, "Rejected 100% mint fee should preserve allowance");

        admin.doSuccessfully(address(fresh), "setMintFeeBps", address(USDC), 0);
        actor.doSuccessfully(address(fresh), "mint", 10e18, address(USDC));

        admin.doSuccessfully(address(fresh), "setBurnFeeBps", address(USDC), 10000);
        actor.doSuccessfully(address(USDST), "approve", address(fresh), 10e18);
        actor.doExpectingFailure(address(fresh), "redeem", "Payout amount must be nonzero", 10e18, address(USDC));
        require(USDST.balanceOf(address(actor)) == 10e18, "Rejected 100% burn fee should not pull USDST");
        require(USDST.allowance(address(actor), address(fresh)) == 10e18, "Rejected 100% burn fee should preserve allowance");
        require(USDC.balanceOf(address(fresh)) == 10e18, "Rejected 100% burn fee should not pay out USDC");
    }

    function it_psm_rejects_zero_fee_collector_and_self_collector_breaks_fee_flows() {
        DirectMintPSM fresh = _newInitializedPsm();
        User actor = new User();
        admin.doSuccessfully(address(USDC), "mint", address(actor), 20e18);

        admin.doExpectingFailure(address(fresh), "setFeeCollector", "Invalid fee collector", address(0));
        admin.doSuccessfully(address(fresh), "setFeeCollector", address(fresh));
        admin.doSuccessfully(address(fresh), "setMintFeeBps", address(USDC), 100);

        uint userUsdcBefore = USDC.balanceOf(address(actor));
        uint psmUsdcBefore = USDC.balanceOf(address(fresh));
        uint userUsdstBefore = USDST.balanceOf(address(actor));

        actor.doSuccessfully(address(USDC), "approve", address(fresh), 20e18);
        actor.doExpectingFailure(address(fresh), "mint", "Balance mismatch", 20e18, address(USDC));

        require(USDC.balanceOf(address(actor)) == userUsdcBefore, "Self fee collector revert should restore user USDC");
        require(USDC.balanceOf(address(fresh)) == psmUsdcBefore, "Self fee collector revert should restore PSM USDC");
        require(USDST.balanceOf(address(actor)) == userUsdstBefore, "Self fee collector revert should not mint USDST");
    }

    function it_psm_rejects_unauthorized_admin_controls_without_state_changes() {
        DirectMintPSM fresh = _newInitializedPsm();
        User outsider = new User();

        outsider.doExpectingFailure(address(fresh), "pauseMint", "Only an admin or a whitelisted account can call castVoteOnIssue");
        outsider.doExpectingFailure(address(fresh), "pauseBurn", "Only an admin or a whitelisted account can call castVoteOnIssue");
        outsider.doExpectingFailure(address(fresh), "setFeeCollector", "Only an admin or a whitelisted account can call castVoteOnIssue", address(m.feeCollector()));
        outsider.doExpectingFailure(address(fresh), "setBurnMinReserve", "Only an admin or a whitelisted account can call castVoteOnIssue", address(USDC), 1e18);

        require(!fresh.mintPaused(), "Unauthorized pauseMint should not mutate state");
        require(!fresh.burnPaused(), "Unauthorized pauseBurn should not mutate state");
        require(address(fresh.feeCollector()) == address(m.feeCollector()), "Unauthorized fee collector change should not mutate state");
    }

    function it_psm_redeem_leaves_no_escrow_or_request_state() {
        DirectMintPSM fresh = _newInitializedPsm();
        User redeemer = new User();

        admin.doSuccessfully(address(USDC), "mint", address(redeemer), 100e18);
        redeemer.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        redeemer.doSuccessfully(address(fresh), "mint", 100e18, address(USDC));

        redeemer.doSuccessfully(address(USDST), "approve", address(fresh), 100e18);
        redeemer.doSuccessfully(address(fresh), "redeem", 40e18, address(USDC));

        // Nothing is held back mid-flight: the PSM never holds the mintable token.
        require(USDST.balanceOf(address(fresh)) == 0, "PSM should hold no USDST after redeem");
        require(USDC.balanceOf(address(fresh)) == 60e18, "PSM should hold only unredeemed backing");
        require(fresh.availableRedemptionLiquidity(address(USDC)) == 60e18, "Available liquidity should equal the remaining balance");

        // A second redeem from the same approval works without any intermediate step.
        redeemer.doSuccessfully(address(fresh), "redeem", 60e18, address(USDC));
        require(USDC.balanceOf(address(redeemer)) == 100e18, "Redeemer should recover the full backing");
        require(USDST.balanceOf(address(redeemer)) == 0, "Redeemer should have burned all USDST");
        require(fresh.availableRedemptionLiquidity(address(USDC)) == 0, "PSM should be fully drained");
    }

    function it_psm_redeem_honours_min_reserve_precisely() {
        DirectMintPSM fresh = _newInitializedPsm();
        User redeemer = new User();

        admin.doSuccessfully(address(USDC), "mint", address(redeemer), 100e18);
        redeemer.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        redeemer.doSuccessfully(address(fresh), "mint", 100e18, address(USDC));

        // 1% redeem fee, and 40 USDC that must stay in the PSM.
        admin.doSuccessfully(address(fresh), "setBurnConfig", address(USDC), true, 40e18, 100);
        require(fresh.availableRedemptionLiquidity(address(USDC)) == 60e18, "minReserve should withhold 40 USDC");

        uint collectorBefore = USDC.balanceOf(address(m.feeCollector()));

        redeemer.doSuccessfully(address(USDST), "approve", address(fresh), 100e18);
        redeemer.doExpectingFailure(address(fresh), "redeem", "Insufficient liquidity", 61e18, address(USDC));

        redeemer.doSuccessfully(address(fresh), "redeem", 60e18, address(USDC));

        require(USDC.balanceOf(address(redeemer)) == 59400000000000000000, "Redeemer should receive 60 USDC less 1% fee");
        require(USDC.balanceOf(address(m.feeCollector())) == collectorBefore + 600000000000000000, "Fee should reach the FeeCollector");
        require(USDC.balanceOf(address(fresh)) == 40e18, "PSM should retain exactly minReserve");
        require(USDST.balanceOf(address(redeemer)) == 40e18, "Only the redeemed USDST should be burned");
    }

    function _newVault() internal returns (SaveUSDSTVault vault) {
        _ensureAuthorizableAdmin();
        vault = SaveUSDSTVault(address(new Proxy(address(new SaveUSDSTVault(address(0xdeadbeef))), address(m.adminRegistry()))));
        admin.doSuccessfully(address(vault), "initialize", address(USDST), "Save USDST", "saveUSDST");
    }

    function it_psm_mint_and_save_delivers_shares_instead_of_usdst() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));
        require(fresh.savingsVault() == address(vault), "PSM should record the savings vault");
        require(fresh.savingsDepositAvailable(100e18), "Savings deposit should be available");

        User saver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(saver), 100e18);
        saver.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        saver.doSuccessfully(address(fresh), "mintAndSave", 100e18, address(USDC));

        // The user ends up holding shares, never the underlying.
        require(USDST.balanceOf(address(saver)) == 0, "Saver should receive shares, not USDST");
        require(vault.balanceOf(address(saver)) == 100e18, "Saver should hold 100 saveUSDST");

        // The vault custodies the freshly minted USDST.
        require(USDST.balanceOf(address(vault)) == 100e18, "Vault should custody the USDST");
        require(vault.totalAssets() == 100e18, "Vault should account for the deposit");

        // The PSM keeps the collateral and retains nothing else.
        require(USDC.balanceOf(address(fresh)) == 100e18, "PSM should hold the collateral");
        require(USDST.balanceOf(address(fresh)) == 0, "PSM should not retain USDST");
        require(USDST.allowance(address(fresh), address(vault)) == 0, "PSM should leave no standing allowance");
    }

    function it_psm_mint_and_save_applies_mint_fee_before_depositing() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));
        admin.doSuccessfully(address(fresh), "setMintFeeBps", address(USDC), 100);

        uint collectorBefore = USDC.balanceOf(address(m.feeCollector()));

        User saver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(saver), 100e18);
        saver.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        saver.doSuccessfully(address(fresh), "mintAndSave", 100e18, address(USDC));

        // Only the net amount reaches the vault.
        require(vault.balanceOf(address(saver)) == 99e18, "Saver should hold shares for the net mint");
        require(USDST.balanceOf(address(vault)) == 99e18, "Vault should custody only the net USDST");
        require(USDC.balanceOf(address(m.feeCollector())) == collectorBefore + 1e18, "Mint fee should reach the FeeCollector");
        require(USDC.balanceOf(address(fresh)) == 99e18, "PSM should keep net backing");
    }

    function it_psm_mint_and_save_prices_shares_at_the_live_exchange_rate() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));

        User first = new User();
        admin.doSuccessfully(address(USDC), "mint", address(first), 100e18);
        first.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        first.doSuccessfully(address(fresh), "mintAndSave", 100e18, address(USDC));
        require(vault.balanceOf(address(first)) == 100e18, "First saver should mint 1:1");

        // Double the vault's assets, so one share is now worth two USDST.
        admin.doSuccessfully(address(USDST), "mint", address(vault), 100e18);
        admin.doSuccessfully(address(vault), "recordRewardTransfer", 100e18);
        require(vault.totalAssets() == 200e18, "Vault should credit the reward");
        require(vault.previewDeposit(100e18) == 50e18, "Deposits should now price at 2:1");

        User second = new User();
        admin.doSuccessfully(address(USDC), "mint", address(second), 100e18);
        second.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        second.doSuccessfully(address(fresh), "mintAndSave", 100e18, address(USDC));

        require(vault.balanceOf(address(second)) == 50e18, "Second saver should receive rate-adjusted shares");
        require(vault.balanceOf(address(first)) == 100e18, "First saver's shares should be undiluted");
        require(USDST.balanceOf(address(fresh)) == 0, "PSM should not retain USDST across deposits");
    }

    function it_psm_savings_availability_prices_pending_accrual() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));

        User saver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(saver), 100e18);
        saver.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);
        saver.doSuccessfully(address(fresh), "mintAndSave", 100e18, address(USDC));

        User distributor = new User();
        admin.doSuccessfully(address(USDST), "mint", address(distributor), 100e18);
        distributor.doSuccessfully(address(USDST), "approve", address(vault), 100e18);
        admin.doSuccessfully(address(vault), "setRewardDistributor", address(distributor));
        admin.doSuccessfully(address(vault), "setPerSecondSavingsRate", 1000000021979553151239153027);
        fastForward(1);

        require(vault.previewDeposit(1) == 1, "Realized preview should still be 1:1");
        (, uint fundedAmount) = vault.pendingAccrual();
        require(fundedAmount > 0, "Expected funded pending accrual");
        require(!fresh.savingsDepositAvailable(1), "Projected zero-share deposit should be unavailable");

        User dustSaver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(dustSaver), 1);
        dustSaver.doSuccessfully(address(USDC), "approve", address(fresh), 1);
        dustSaver.doExpectingFailure(address(fresh), "mintAndSave", "Savings deposit unavailable", 1, address(USDC));

        require(USDC.balanceOf(address(dustSaver)) == 1, "Rejected save should preserve collateral");
        require(USDC.allowance(address(dustSaver), address(fresh)) == 1, "Rejected save should preserve allowance");
        require(vault.balanceOf(address(dustSaver)) == 0, "Rejected save should mint no shares");
    }

    function it_psm_plain_mint_still_delivers_usdst_when_a_vault_is_set() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));

        User minter = new User();
        admin.doSuccessfully(address(USDC), "mint", address(minter), 50e18);
        minter.doSuccessfully(address(USDC), "approve", address(fresh), 50e18);
        minter.doSuccessfully(address(fresh), "mint", 50e18, address(USDC));

        // Configuring a vault must not change the default mint path.
        require(USDST.balanceOf(address(minter)) == 50e18, "Plain mint should still deliver USDST");
        require(vault.balanceOf(address(minter)) == 0, "Plain mint should not mint shares");
        require(vault.totalAssets() == 0, "Plain mint should not touch the vault");
    }

    function it_psm_mint_and_save_requires_a_configured_vault() {
        DirectMintPSM fresh = _newInitializedPsm();
        require(!fresh.savingsDepositAvailable(10e18), "Savings should be unavailable with no vault");

        User saver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(saver), 20e18);
        saver.doSuccessfully(address(USDC), "approve", address(fresh), 20e18);

        saver.doExpectingFailure(address(fresh), "mintAndSave", "Savings deposit unavailable", 10e18, address(USDC));

        require(USDC.balanceOf(address(saver)) == 20e18, "Rejected save should not pull collateral");
        require(USDC.balanceOf(address(fresh)) == 0, "Rejected save should not bank collateral");
        require(USDST.balanceOf(address(saver)) == 0, "Rejected save should not mint USDST");
    }

    function it_psm_mint_and_save_reverts_and_rolls_back_when_vault_is_paused() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));

        User saver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(saver), 20e18);
        saver.doSuccessfully(address(USDC), "approve", address(fresh), 20e18);

        admin.doSuccessfully(address(vault), "pause");
        require(!fresh.savingsDepositAvailable(10e18), "Paused vault should report unavailable");
        saver.doExpectingFailure(address(fresh), "mintAndSave", "Savings deposit unavailable", 10e18, address(USDC));

        // The collateral pull and the USDST mint both unwind with the deposit.
        require(USDC.balanceOf(address(saver)) == 20e18, "Paused save should not pull collateral");
        require(USDC.balanceOf(address(fresh)) == 0, "Paused save should not bank collateral");
        require(USDST.balanceOf(address(fresh)) == 0, "Paused save should not leave USDST in the PSM");
        require(USDST.balanceOf(address(vault)) == 0, "Paused save should not reach the vault");

        admin.doSuccessfully(address(vault), "unpause");
        saver.doSuccessfully(address(fresh), "mintAndSave", 10e18, address(USDC));
        require(vault.balanceOf(address(saver)) == 10e18, "Save should succeed once the vault is unpaused");
    }

    function it_psm_set_savings_vault_validates_asset_and_can_be_cleared() {
        DirectMintPSM fresh = _newInitializedPsm();

        // A vault over a different asset is rejected outright.
        Token OTHER = _createActiveToken("Other Stable", "OTHER", 18);
        SaveUSDSTVault wrongVault = SaveUSDSTVault(address(new Proxy(address(new SaveUSDSTVault(address(0xdeadbeef))), address(m.adminRegistry()))));
        admin.doSuccessfully(address(wrongVault), "initialize", address(OTHER), "Other Vault", "saveOTHER");
        admin.doExpectingFailure(address(fresh), "setSavingsVault", "Vault asset mismatch", address(wrongVault));
        require(fresh.savingsVault() == address(0), "Rejected vault should not be recorded");

        // The matching vault is accepted, then cleared with the zero address.
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));
        require(fresh.savingsVault() == address(vault), "Matching vault should be recorded");

        admin.doSuccessfully(address(fresh), "setSavingsVault", address(0));
        require(fresh.savingsVault() == address(0), "Zero address should clear the vault");
        require(!fresh.savingsDepositAvailable(10e18), "Cleared vault should report unavailable");

        User outsider = new User();
        outsider.doExpectingFailure(address(fresh), "setSavingsVault", "Only an admin or a whitelisted account can call castVoteOnIssue", address(vault));
    }

    function it_psm_mint_and_save_respects_mint_controls() {
        DirectMintPSM fresh = _newInitializedPsm();
        SaveUSDSTVault vault = _newVault();
        admin.doSuccessfully(address(fresh), "setSavingsVault", address(vault));

        User saver = new User();
        admin.doSuccessfully(address(USDC), "mint", address(saver), 100e18);
        saver.doSuccessfully(address(USDC), "approve", address(fresh), 100e18);

        // The savings path shares every gate with the plain mint path.
        admin.doSuccessfully(address(fresh), "pauseMint");
        saver.doExpectingFailure(address(fresh), "mintAndSave", "Minting is paused", 10e18, address(USDC));
        admin.doSuccessfully(address(fresh), "unpauseMint");

        admin.doSuccessfully(address(fresh), "setMintEnabled", address(USDC), false);
        saver.doExpectingFailure(address(fresh), "mintAndSave", "Minting for this token is disabled", 10e18, address(USDC));
        admin.doSuccessfully(address(fresh), "setMintEnabled", address(USDC), true);

        admin.doSuccessfully(address(fresh), "setMintMaxBalance", address(USDC), 10e18);
        saver.doExpectingFailure(address(fresh), "mintAndSave", "Token balance cap exceeded", 20e18, address(USDC));
        admin.doSuccessfully(address(fresh), "setMintMaxBalance", address(USDC), 0);

        saver.doExpectingFailure(address(fresh), "mintAndSave", "Amount must be nonzero", 0, address(USDC));

        require(vault.totalAssets() == 0, "No rejected save should reach the vault");
        require(USDC.balanceOf(address(fresh)) == 0, "No rejected save should bank collateral");

        saver.doSuccessfully(address(fresh), "mintAndSave", 20e18, address(USDC));
        require(vault.balanceOf(address(saver)) == 20e18, "Save should succeed once controls allow it");
    }

}
