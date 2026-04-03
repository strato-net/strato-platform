import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";

contract Describe_DirectMintPSM {

    Mercata m;
    Token USDST;
    Token USDC;
    Token USDT;
    DirectMintPSM psm;

    function beforeAll() {
        m = new Mercata();

        // This ugly pattern is neccessary to avoid making this contract Authorizable,
        // which I don't want because that fails to cover EOA admin cases.
        // I don't actually understand why m.tokenFactory().createToken() fails
        //   "Cannot forge a vote on behalf of an admin without their consent" without the Authorizable setup.
        // - Adrian
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
        log("check 5");

        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(USDST), "mint", address(psm));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(USDST), "burn", address(psm));
    }

   
    function beforeEach() {
        
    }

    function it_psm_can_be_configured() {
        (bool success, variadic ret) = m.adminRegistry().castVoteOnIssue(address(psm), "initialize", address(USDST), [address(USDC), address(USDT)], 60*60*24);
        require(success, "PSM initialize did not execute");
        require(psm.mintableToken() == address(USDST), "Mintable token should be USDST");
        require(psm.eligibleTokens(address(USDC)), "USDC should be eligible");
        require(psm.eligibleTokens(address(USDT)), "USDT should be eligible");
        require(psm.burnDelay() == 60*60*24, "Burn delay should be 60*60*24");
    }

}