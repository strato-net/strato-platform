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
        (bool success, variadic ret) = m.adminRegistry().castVoteOnIssue(address(psm), "initialize", address(USDST), address(m.feeCollector()), [address(USDC), address(USDT)], 60*60*24);
        require(success, "PSM initialize did not execute");
        require(psm.mintableToken() == address(USDST), "Mintable token should be USDST");
        (bool usdcMintEnabled, uint usdcMaxBalance, uint usdcMintFeeBps) = psm.mintConfigs(address(USDC));
        (bool usdcBurnEnabled, uint usdcMinReserve, uint usdcBurnDelay, uint usdcBurnFeeBps) = psm.burnConfigs(address(USDC));
        (bool usdtMintEnabled, uint usdtMaxBalance, uint usdtMintFeeBps) = psm.mintConfigs(address(USDT));
        (bool usdtBurnEnabled, uint usdtMinReserve, uint usdtBurnDelay, uint usdtBurnFeeBps) = psm.burnConfigs(address(USDT));
        require(usdcMintEnabled && usdcBurnEnabled, "USDC should be enabled");
        require(usdtMintEnabled && usdtBurnEnabled, "USDT should be enabled");
        require(usdcBurnDelay == 60*60*24, "USDC burn delay should be 60*60*24");
        require(usdtBurnDelay == 60*60*24, "USDT burn delay should be 60*60*24");
    }

    function it_psm_can_be_configured() {
        // beforeEach() runs the relevant code
        (bool mintEnabled, uint maxBalance, uint mintFeeBps) = psm.mintConfigs(address(USDC));
        (bool burnEnabled, uint minReserve, uint burnDelay, uint burnFeeBps) = psm.burnConfigs(address(USDC));
        require(mintEnabled, "USDC mint should be enabled");
        require(burnEnabled, "USDC burn should be enabled");
        require(maxBalance == 0, "USDC max balance should default to unlimited");
        require(minReserve == 0, "USDC min reserve should default to zero");
        require(burnDelay == 60*60*24, "USDC burn delay should default to initial delay");
        require(mintFeeBps == 0, "USDC mint fee should default to zero");
        require(burnFeeBps == 0, "USDC burn fee should default to zero");
    }

    function it_psm_can_mint() {
        // Set an Authorizable admin to enable callback-style ownership checks
        admin = User(new Admin());
        (bool success, variadic ret) = m.adminRegistry().castVoteOnIssue(address(m.adminRegistry()), "_swapAdmin", address(this), address(admin));
        require(success, "Admin swap did not execute");

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

    function it_psm_can_burn_instant() {
        fastForward(1);
        require(block.timestamp != 0, "Block timestamp cannot be 0");
        // Otherwise burnRequests entry is like
        // (100000000000000000000,
        //  7808ddabfa7a0825816032b9ee63a8e52777e119,
        //  36844afd2f73f56cc75329a6f9fdfcbac04b673e,
        //  <reference to ba85445f2c60433f84287bf81709a2ccb3a638fe//StoragePath [Field "burnRequests",Index "0",Field "requestTime"]>)

        // Begins with the end state from it_psm_can_mint()
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
        (bool burnEnabled, uint minReserve, uint burnDelay, uint burnFeeBps) = psm.burnConfigs(address(USDC));
        require(burnDelay == 0, "USDC burn delay should be 0");

        user.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        require(psm.burnReqCounter() == 1, "Burn request counter should be 1");
        // BurnRequest request;
        // (request.burnAmount, request.payoutAmount, request.redeemToken, request.requester, request.requestTime) = psm.burnRequests(0);
        // This syntax gives
        //  Unit test 'psm can burn instant' failed: Left type error: unknown case called in setVal (Probably tried to change the value of a constant):: src = SInteger 100000000000000000000, dst = SContractFunction 0000000000000000000000000000000000000000 "amount"
        (uint amount, uint payoutAmount, address redeemToken, address requester, uint requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(amount == 100e18, "Burn request amount should be 100 USDST");
        require(payoutAmount == 100e18, "Burn request payout should be 100 USDC");
        require(redeemToken == address(USDC), "Burn request redeem token should be USDC");
        require(requester == address(user), "Burn request requester should be user");
        require(requestTime == block.timestamp, "Burn request request time should be current block timestamp");
        require(USDST.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDST");
        require(psm.pendingRedemptions(address(USDC)) == 100e18, "PSM should reserve 100 USDC");
        require(psm.availableRedemptionLiquidity(address(USDC)) == 0, "PSM should have no available USDC");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC");

        // Complete the burn USDST 1:1 in exchange for USDC
        user.doSuccessfully(address(psm), "completeBurn", 1);
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDC.balanceOf(address(user)) == 100e18, "User should have 100 USDC");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should have 0 USDST");
        require(USDC.balanceOf(address(psm)) == 0, "PSM should have 0 USDC");
        require(psm.pendingRedemptions(address(USDC)) == 0, "PSM should release USDC reservation");
        (uint _amount, uint _payoutAmount, address _redeemToken, address _requester, uint _requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(_amount == 0, "Burn request amount should be 0");
        require(_payoutAmount == 0, "Burn request payout should be 0");
        require(_redeemToken == address(0), "Burn request redeem token should be 0");
        require(_requester == address(0), "Burn request requester should be 0");
        require(_requestTime == 0, "Burn request request time should be 0");
    }

    function it_psm_can_burn_delayed() {
        require(USDC.balanceOf(address(user)) == 100e18, "User should have 100 USDC");

        // Direct mint 1:1 100 USDST against the 100 USDC
        user.doSuccessfully(address(USDC), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "mint", 100e18, address(USDC));
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC");
        require(block.timestamp != 0, "Block timestamp cannot be 0");
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");

        uint burnDelay = 24*60*60;
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, burnDelay, 0);
        (bool burnEnabled, uint minReserve, uint configuredBurnDelay, uint burnFeeBps) = psm.burnConfigs(address(USDC));
        require(configuredBurnDelay == burnDelay, "USDC burn delay should be 24*60*60");

        user.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        require(psm.burnReqCounter() == 2, "Burn request counter should be 2");
        (uint amount, uint payoutAmount, address redeemToken, address requester, uint requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(amount == 100e18, "Burn request amount should be 100 USDST");
        require(payoutAmount == 100e18, "Burn request payout should be 100 USDC");
        require(redeemToken == address(USDC), "Burn request redeem token should be USDC");
        require(requester == address(user), "Burn request requester should be user");
        require(requestTime == block.timestamp, "Burn request request time should be current block timestamp");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");
        require(psm.pendingRedemptions(address(USDC)) == 100e18, "PSM should reserve 100 USDC");
        require(psm.availableRedemptionLiquidity(address(USDC)) == 0, "PSM should have no available USDC");
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");

        // Attempt to burn too early
        user.doExpectingFailure(address(psm), "completeBurn", "Burn delay not passed", psm.burnReqCounter());
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC");
        require(psm.burnReqCounter() == 2, "Burn request counter should be 2");
        require(USDST.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDST");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");

        // Attempt to burn again, still too early
        fastForward(burnDelay - 1);
        user.doExpectingFailure(address(psm), "completeBurn", "Burn delay not passed", psm.burnReqCounter());
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC");
        require(psm.burnReqCounter() == 2, "Burn request counter should be 2");
        require(USDST.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDST");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");

        // Wind the clock forward to after the burn delay
        fastForward(1);

        // Complete the burn USDST 1:1 in exchange for USDC
        user.doSuccessfully(address(psm), "completeBurn", psm.burnReqCounter());
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDC.balanceOf(address(user)) == 100e18, "User should have 100 USDC");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should have 0 USDST");
        require(USDC.balanceOf(address(psm)) == 0, "PSM should have 0 USDC");
        require(psm.pendingRedemptions(address(USDC)) == 0, "PSM should release USDC reservation");
        (uint _amount, uint _payoutAmount, address _redeemToken, address _requester, uint _requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(_amount == 0, "Burn request amount should be 0");
        require(_payoutAmount == 0, "Burn request payout should be 0");
        require(_redeemToken == address(0), "Burn request redeem token should be 0");
        require(_requester == address(0), "Burn request requester should be 0");
        require(_requestTime == 0, "Burn request request time should be 0");

        // Disable burn delay
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDT), true, 0, 0, 0);
    }

    function it_psm_can_cancel_burn() {
        // User deposits 100 USDC in the PSM, getting USDST 1:1
        user.doSuccessfully(address(USDC), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "mint", 100e18, address(USDC));

        // User requests to burn their USDST for USDC, but cancels the request before it can be completed
        user.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        require(USDST.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDST");
        require(psm.pendingRedemptions(address(USDC)) == 100e18, "PSM should reserve 100 USDC");
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        user.doSuccessfully(address(psm), "cancelBurn", psm.burnReqCounter());
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should have 0 USDST");
        require(psm.pendingRedemptions(address(USDC)) == 0, "PSM should release USDC reservation");

        // User now tries and fails to complete the burn
        user.doExpectingFailure(address(psm), "completeBurn", "Invalid burn request ID", psm.burnReqCounter());
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC, not " + string(USDC.balanceOf(address(user))));
        require(USDST.balanceOf(address(psm)) == 0, "PSM should have 0 USDST");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");
        (uint _amount, uint _payoutAmount, address _redeemToken, address _requester, uint _requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(_amount == 0, "Burn request amount should be 0");
        require(_payoutAmount == 0, "Burn request payout should be 0");
        require(_redeemToken == address(0), "Burn request redeem token should be 0");
        require(_requester == address(0), "Burn request requester should be 0");
        require(_requestTime == 0, "Burn request request time should be 0");

        // Throw away the USDST
        admin.doSuccessfully(address(USDST), "burn", address(user), 100e18);
    }

    function it_psm_works_accross_users() {
        // User2 has USDST from other sources, but has never deposited in the PSM
        user2 = new User();
        admin.doSuccessfully(address(USDST), "mint", address(user2), 300e18);

        // User1 deposits USDT in addition to the USDC they already have deposited
        admin.doSuccessfully(address(USDT), "mint", address(user), 100e18);
        user.doSuccessfully(address(USDT), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "mint", 100e18, address(USDT));

        // User1 creates a burn request, but fails to complete it
        user.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        require(USDST.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDST");
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");

        // User2 is allowed to burn their USDST for unreserved USDT
        uint initialCounter = psm.burnReqCounter() + 1;
        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDT));
        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doExpectingFailure(address(psm), "requestBurn", "Insufficient liquidity", 100e18, address(USDC));
        require(USDST.balanceOf(address(psm)) == 200e18, "PSM should have 200 USDST");
        require(USDST.balanceOf(address(user2)) == 200e18, "User2 should have 200 USDST");
        user2.doExpectingFailure(address(psm), "completeBurn", "Unauthorized", initialCounter - 1); // Can't burn the other user's request
        user2.doSuccessfully(address(psm), "completeBurn", initialCounter);

        // Enforce conditions after burns
        require(USDST.balanceOf(address(psm)) == 100e18, "PSM should have 200 USDST");
        require(USDST.balanceOf(address(user2)) == 200e18, "User2 should have 200 USDST");
        require(USDC.balanceOf(address(user2)) == 0, "User2 should have 0 USDC");
        require(USDT.balanceOf(address(user2)) == 100e18, "User2 should have 100 USDT");
        require(USDT.balanceOf(address(psm)) == 0, "PSM should have 0 USDT");
        require(USDC.balanceOf(address(psm)) == 100e18, "PSM should have 100 USDC");
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDT.balanceOf(address(user)) == 0, "User should have 0 USDT");
        require(USDC.balanceOf(address(user)) == 0, "User should have 0 USDC");
        require(psm.pendingRedemptions(address(USDC)) == 100e18, "PSM should keep user1 USDC reservation");
        require(psm.pendingRedemptions(address(USDT)) == 0, "PSM should release user2 USDT reservation");
        (uint _amount, uint _payoutAmount, address _redeemToken, address _requester, uint _requestTime) = psm.burnRequests(initialCounter);
        require(_amount == 0, "Burn request amount should be 0");
        require(_payoutAmount == 0, "Burn request payout should be 0");
        require(_redeemToken == address(0), "Burn request redeem token should be 0");
        require(_requester == address(0), "Burn request requester should be 0");
        require(_requestTime == 0, "Burn request request time should be 0");
    }

    function it_psm_liquidity_limited() {
        // User1's earlier USDC burn remains reserved until claimed or canceled
        user.doSuccessfully(address(psm), "cancelBurn", psm.burnReqCounter()-1);
        require(USDST.balanceOf(address(user)) == 100e18, "User should have 100 USDST");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should have 0 USDST");
        require(psm.pendingRedemptions(address(USDC)) == 0, "PSM should release USDC reservation");
        (uint _amount, uint _payoutAmount, address _redeemToken, address _requester, uint _requestTime) = psm.burnRequests(psm.burnReqCounter()-1);
        require(_amount == 0, "Burn request amount should be 0");
        require(_payoutAmount == 0, "Burn request payout should be 0");
        require(_redeemToken == address(0), "Burn request redeem token should be 0");
        require(_requester == address(0), "Burn request requester should be 0");
        require(_requestTime == 0, "Burn request request time should be 0");
    }

    function it_psm_enforces_mint_controls() {
        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 250e18, 0);
        admin.doSuccessfully(address(USDC), "mint", address(user2), 200e18);

        user2.doSuccessfully(address(USDC), "approve", address(psm), 200e18);

        user2.doSuccessfully(address(psm), "mint", 70e18, address(USDC));
        user2.doSuccessfully(address(psm), "mint", 75e18, address(USDC));
        user2.doExpectingFailure(address(psm), "mint", "Token balance cap exceeded", 10e18, address(USDC));

        require(USDC.balanceOf(address(psm)) == 245e18, "PSM should hold 245 USDC");
        require(USDST.balanceOf(address(user2)) == 345e18, "User2 should have original plus newly minted USDST");

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
    }

    function it_psm_enforces_burn_controls() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 100e18, 0, 0);

        user2.doSuccessfully(address(USDST), "approve", address(psm), 200e18);

        user2.doSuccessfully(address(psm), "requestBurn", 50e18, address(USDC));
        user2.doSuccessfully(address(psm), "requestBurn", 50e18, address(USDC));
        user2.doExpectingFailure(address(psm), "requestBurn", "Insufficient liquidity", 50e18, address(USDC));

        require(psm.pendingRedemptions(address(USDC)) == 100e18, "PSM should reserve 100 USDC");
        require(psm.availableRedemptionLiquidity(address(USDC)) == 45e18, "PSM should preserve min reserve");

        user2.doSuccessfully(address(psm), "cancelBurn", psm.burnReqCounter());
        user2.doSuccessfully(address(psm), "cancelBurn", psm.burnReqCounter()-1);
        require(psm.pendingRedemptions(address(USDC)) == 0, "PSM should clear outstanding burn reservations");
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

    function it_psm_enforces_enabled_controls() {
        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), false, 0, 0);
        user2.doExpectingFailure(address(psm), "mint", "Minting for this token is disabled", 10e18, address(USDC));

        admin.doSuccessfully(address(psm), "setMintConfig", address(USDC), true, 0, 0);
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), false, 0, 0, 0);
        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doExpectingFailure(address(psm), "requestBurn", "Token burn is disabled", 10e18, address(USDC));

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

    function it_psm_rejects_invalid_amounts_without_state_changes() {
        uint usdcPsmBefore = USDC.balanceOf(address(psm));
        uint usdcUserBefore = USDC.balanceOf(address(user2));
        uint usdstUserBefore = USDST.balanceOf(address(user2));
        uint usdstPsmBefore = USDST.balanceOf(address(psm));
        uint pendingBefore = psm.pendingRedemptions(address(USDC));
        uint counterBefore = psm.burnReqCounter();

        user2.doExpectingFailure(address(psm), "mint", "Amount must be nonzero", 0, address(USDC));
        user2.doExpectingFailure(address(psm), "requestBurn", "Amount must be nonzero", 0, address(USDC));

        require(USDC.balanceOf(address(psm)) == usdcPsmBefore, "PSM USDC should not change");
        require(USDC.balanceOf(address(user2)) == usdcUserBefore, "User2 USDC should not change");
        require(USDST.balanceOf(address(user2)) == usdstUserBefore, "User2 USDST should not change");
        require(USDST.balanceOf(address(psm)) == usdstPsmBefore, "PSM USDST should not change");
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore, "Pending redemptions should not change");
        require(psm.burnReqCounter() == counterBefore, "Burn counter should not change");
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

    function it_psm_rejected_burn_preserves_allowance_balances_and_counter() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, USDC.balanceOf(address(psm)), 0, 0);

        uint userBalanceBefore = USDST.balanceOf(address(user2));
        uint psmUsdBefore = USDST.balanceOf(address(psm));
        uint pendingBefore = psm.pendingRedemptions(address(USDC));
        uint counterBefore = psm.burnReqCounter();
        user2.doSuccessfully(address(USDST), "approve", address(psm), 25e18);

        user2.doExpectingFailure(address(psm), "requestBurn", "Insufficient liquidity", 25e18, address(USDC));

        require(USDST.balanceOf(address(user2)) == userBalanceBefore, "Rejected burn should not pull USDST");
        require(USDST.balanceOf(address(psm)) == psmUsdBefore, "Rejected burn should not increase PSM USDST");
        require(USDST.allowance(address(user2), address(psm)) == 25e18, "Rejected burn should not consume allowance");
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore, "Rejected burn should not reserve liquidity");
        require(psm.burnReqCounter() == counterBefore, "Rejected burn should not create request");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

    function it_psm_tracks_multiple_pending_burns_for_same_token() {
        admin.doSuccessfully(address(USDC), "mint", address(user2), 60e18);
        user2.doSuccessfully(address(USDC), "approve", address(psm), 60e18);
        user2.doSuccessfully(address(psm), "mint", 60e18, address(USDC));

        uint pendingBefore = psm.pendingRedemptions(address(USDC));
        user2.doSuccessfully(address(USDST), "approve", address(psm), 60e18);
        user2.doSuccessfully(address(psm), "requestBurn", 20e18, address(USDC));
        uint firstRequest = psm.burnReqCounter();
        user2.doSuccessfully(address(psm), "requestBurn", 40e18, address(USDC));
        uint secondRequest = psm.burnReqCounter();

        require(psm.pendingRedemptions(address(USDC)) == pendingBefore + 60e18, "Pending redemptions should aggregate requests");
        require(USDST.balanceOf(address(psm)) >= 60e18, "PSM should escrow requested USDST");

        user2.doSuccessfully(address(psm), "cancelBurn", firstRequest);
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore + 40e18, "Cancel should release only one request");
        user2.doSuccessfully(address(psm), "completeBurn", secondRequest);
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore, "Complete should release remaining request");
    }

    function it_psm_uses_per_asset_burn_delays_independently() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 24*60*60, 0);
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDT), true, 0, 0, 0);

        admin.doSuccessfully(address(USDT), "mint", address(user2), 30e18);
        user2.doSuccessfully(address(USDT), "approve", address(psm), 30e18);
        user2.doSuccessfully(address(psm), "mint", 30e18, address(USDT));

        user2.doSuccessfully(address(USDST), "approve", address(psm), 60e18);
        user2.doSuccessfully(address(psm), "requestBurn", 30e18, address(USDC));
        uint usdcRequest = psm.burnReqCounter();
        user2.doSuccessfully(address(psm), "requestBurn", 30e18, address(USDT));
        uint usdtRequest = psm.burnReqCounter();

        user2.doExpectingFailure(address(psm), "completeBurn", "Burn delay not passed", usdcRequest);
        user2.doSuccessfully(address(psm), "completeBurn", usdtRequest);
        require(psm.pendingRedemptions(address(USDT)) == 0, "USDT burn should complete immediately");
        require(psm.pendingRedemptions(address(USDC)) >= 30e18, "USDC burn should remain pending");

        user2.doSuccessfully(address(psm), "cancelBurn", usdcRequest);
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

    function it_psm_disabled_burn_blocks_completion_but_allows_cancel() {
        admin.doSuccessfully(address(USDC), "mint", address(user2), 20e18);
        user2.doSuccessfully(address(USDC), "approve", address(psm), 20e18);
        user2.doSuccessfully(address(psm), "mint", 20e18, address(USDC));

        user2.doSuccessfully(address(USDST), "approve", address(psm), 20e18);
        user2.doSuccessfully(address(psm), "requestBurn", 20e18, address(USDC));
        uint requestId = psm.burnReqCounter();
        uint pendingBeforeCancel = psm.pendingRedemptions(address(USDC));

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), false, 0, 0, 0);
        user2.doExpectingFailure(address(psm), "completeBurn", "Token burn is disabled", requestId);
        require(psm.pendingRedemptions(address(USDC)) == pendingBeforeCancel, "Disabled complete should keep reservation");

        user2.doSuccessfully(address(psm), "cancelBurn", requestId);
        require(psm.pendingRedemptions(address(USDC)) == pendingBeforeCancel - 20e18, "Cancel should release disabled burn reservation");
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

    function it_psm_rejects_invalid_config_tokens_and_fee_bps() {
        user2.doExpectingFailure(address(psm), "setMintConfig", "Only an admin or a whitelisted account can call castVoteOnIssue", address(USDC), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setMintConfig", "Invalid token", address(0), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setMintConfig", "Invalid token", address(USDST), true, 0, 0);
        admin.doExpectingFailure(address(psm), "setBurnConfig", "Invalid token", address(USDST), true, 0, 0, 0);
        admin.doExpectingFailure(address(psm), "setMintConfig", "Invalid fee bps", address(USDC), true, 0, 10001);
        admin.doExpectingFailure(address(psm), "setBurnConfig", "Invalid fee bps", address(USDC), true, 0, 0, 10001);
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
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);

        admin.doSuccessfully(address(psm), "setBurnEnabled", address(USDC), false);
        (bool burnEnabled1, uint minReserve1, uint burnDelay1, uint burnFeeBps1) = psm.burnConfigs(address(USDC));
        require(!burnEnabled1, "Burn enabled should update");
        require(minReserve1 == 0, "Burn enabled setter should preserve min reserve");
        require(burnDelay1 == 0, "Burn enabled setter should preserve delay");
        require(burnFeeBps1 == 0, "Burn enabled setter should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnMinReserve", address(USDC), 33e18);
        (bool burnEnabled2, uint minReserve2, uint burnDelay2, uint burnFeeBps2) = psm.burnConfigs(address(USDC));
        require(!burnEnabled2, "Burn reserve setter should preserve enabled");
        require(minReserve2 == 33e18, "Burn min reserve should update");
        require(burnDelay2 == 0, "Burn reserve setter should preserve delay");
        require(burnFeeBps2 == 0, "Burn reserve setter should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnDelay", address(USDC), 3600);
        (bool burnEnabled3, uint minReserve3, uint burnDelay3, uint burnFeeBps3) = psm.burnConfigs(address(USDC));
        require(!burnEnabled3, "Burn delay setter should preserve enabled");
        require(minReserve3 == 33e18, "Burn delay setter should preserve min reserve");
        require(burnDelay3 == 3600, "Burn delay should update");
        require(burnFeeBps3 == 0, "Burn delay setter should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnFeeBps", address(USDC), 17);
        (bool burnEnabled4, uint minReserve4, uint burnDelay4, uint burnFeeBps4) = psm.burnConfigs(address(USDC));
        require(!burnEnabled4, "Burn fee setter should preserve enabled");
        require(minReserve4 == 33e18, "Burn fee setter should preserve min reserve");
        require(burnDelay4 == 3600, "Burn fee setter should preserve delay");
        require(burnFeeBps4 == 17, "Burn fee should update");

        admin.doExpectingFailure(address(psm), "setBurnFeeBps", "Invalid fee bps", address(USDC), 10001);
        (bool burnEnabled5, uint minReserve5, uint burnDelay5, uint burnFeeBps5) = psm.burnConfigs(address(USDC));
        require(!burnEnabled5, "Rejected burn fee should preserve enabled");
        require(minReserve5 == 33e18, "Rejected burn fee should preserve min reserve");
        require(burnDelay5 == 3600, "Rejected burn fee should preserve delay");
        require(burnFeeBps5 == 17, "Rejected burn fee should preserve fee");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
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

    function it_psm_applies_burn_fee_to_reserved_and_paid_amount() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 100);
        admin.doSuccessfully(address(USDST), "mint", address(user2), 100e18);

        uint userUsdcBefore = USDC.balanceOf(address(user2));
        uint userUsdstBefore = USDST.balanceOf(address(user2));
        uint psmUsdcBefore = USDC.balanceOf(address(psm));
        uint collectorUsdcBefore = USDC.balanceOf(address(m.feeCollector()));
        uint pendingBefore = psm.pendingRedemptions(address(USDC));

        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        uint requestId = psm.burnReqCounter();
        (uint burnAmount, uint payoutAmount, address redeemToken, address requester, uint requestTime) = psm.burnRequests(requestId);

        require(burnAmount == 100e18, "Burn fee request should escrow full USDST");
        require(payoutAmount == 99e18, "Burn fee request should record net payout");
        require(redeemToken == address(USDC), "Burn fee request redeem token should be USDC");
        require(requester == address(user2), "Burn fee request requester should be user2");
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore + 100e18, "Burn fee should reserve full outflow");

        user2.doSuccessfully(address(psm), "completeBurn", requestId);

        require(USDST.balanceOf(address(user2)) == userUsdstBefore - 100e18, "Burn fee flow should spend escrowed USDST");
        require(USDC.balanceOf(address(user2)) == userUsdcBefore + 99e18, "Burn fee flow should pay net USDC");
        require(USDC.balanceOf(address(m.feeCollector())) == collectorUsdcBefore + 1e18, "Burn fee should go to FeeCollector");
        require(USDC.balanceOf(address(psm)) == psmUsdcBefore - 100e18, "Burn fee flow should remove full outflow from PSM");
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore, "Burn fee complete should clear full reservation");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

    function it_psm_cancel_burn_fee_request_returns_full_escrow() {
        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 100);
        admin.doSuccessfully(address(USDST), "mint", address(user2), 100e18);

        uint userUsdstBefore = USDST.balanceOf(address(user2));
        uint psmUsdstBefore = USDST.balanceOf(address(psm));
        uint pendingBefore = psm.pendingRedemptions(address(USDC));
        uint collectorUsdcBefore = USDC.balanceOf(address(m.feeCollector()));

        user2.doSuccessfully(address(USDST), "approve", address(psm), 100e18);
        user2.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        uint requestId = psm.burnReqCounter();
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore + 100e18, "Burn fee cancel test should reserve full outflow");
        require(USDST.balanceOf(address(user2)) == userUsdstBefore - 100e18, "Burn request should escrow full USDST");
        require(USDST.balanceOf(address(psm)) == psmUsdstBefore + 100e18, "PSM should hold full escrow");

        user2.doSuccessfully(address(psm), "cancelBurn", requestId);

        require(USDST.balanceOf(address(user2)) == userUsdstBefore, "Cancel should return full escrowed USDST");
        require(USDST.balanceOf(address(psm)) == psmUsdstBefore, "Cancel should remove full PSM escrow");
        require(USDC.balanceOf(address(m.feeCollector())) == collectorUsdcBefore, "Cancel should not send fee");
        require(psm.pendingRedemptions(address(USDC)) == pendingBefore, "Cancel should release full reservation");

        admin.doSuccessfully(address(psm), "setBurnConfig", address(USDC), true, 0, 0, 0);
    }

}
