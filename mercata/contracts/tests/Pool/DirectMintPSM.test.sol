import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";

contract Describe_DirectMintPSM {

    Mercata m;
    Token USDST;
    Token USDC;
    Token USDT;
    DirectMintPSM psm;
    User user;
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
        (bool success, variadic ret) = m.adminRegistry().castVoteOnIssue(address(psm), "initialize", address(USDST), [address(USDC), address(USDT)], 60*60*24);
        require(success, "PSM initialize did not execute");
        require(psm.mintableToken() == address(USDST), "Mintable token should be USDST");
        require(psm.eligibleTokens(address(USDC)), "USDC should be eligible");
        require(psm.eligibleTokens(address(USDT)), "USDT should be eligible");
        require(psm.burnDelay() == 60*60*24, "Burn delay should be 60*60*24");
    }

    function it_psm_can_be_configured() {
        // beforeEach() runs the relevant code
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

        admin.doSuccessfully(address(psm), "setBurnDelay", 0);
        require(psm.burnDelay() == 0, "Burn delay should be 0");

        user.doSuccessfully(address(psm), "requestBurn", 100e18, address(USDC));
        require(psm.burnReqCounter() == 1, "Burn request counter should be 1");
        // BurnRequest request;
        // (request.amount, request.redeemToken, request.requester, request.requestTime) = psm.burnRequests(0);
        // This syntax gives
        //  Unit test 'psm can burn instant' failed: Left type error: unknown case called in setVal (Probably tried to change the value of a constant):: src = SInteger 100000000000000000000, dst = SContractFunction 0000000000000000000000000000000000000000 "amount"
        (uint amount, address redeemToken, address requester, uint requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(amount == 100e18, "Burn request amount should be 100 USDST");
        require(redeemToken == address(USDC), "Burn request redeem token should be USDC");
        require(requester == address(user), "Burn request requester should be user");
        require(requestTime == block.timestamp, "Burn request request time should be current block timestamp");

        // Complete the burn USDST 1:1 in exchange for USDC
        user.doSuccessfully(address(psm), "completeBurn", 1);
        require(USDST.balanceOf(address(user)) == 0, "User should have 0 USDST");
        require(USDC.balanceOf(address(user)) == 100e18, "User should have 100 USDC");
        require(USDST.balanceOf(address(psm)) == 0, "PSM should have 0 USDST");
        require(USDC.balanceOf(address(psm)) == 0, "PSM should have 0 USDC");
        (uint _amount, address _redeemToken, address _requester, uint _requestTime) = psm.burnRequests(psm.burnReqCounter());
        require(_amount == 0, "Burn request amount should be 0");
        require(_redeemToken == address(0), "Burn request redeem token should be 0");
        require(_requester == address(0), "Burn request requester should be 0");
        require(_requestTime == 0, "Burn request request time should be 0");
    }

}
