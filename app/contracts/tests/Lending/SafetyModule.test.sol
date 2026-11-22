import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_SafetyModule_Attacks {

    uint public INFINITY = 2 ** 256 - 1;

    constructor() {
    }

    Mercata m;
    SafetyModule freshSM;

    function beforeAll() public {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
        // Create fresh SafetyModule for each test
        freshSM = new SafetyModule(address(this));
        freshSM.initialize(address(m.lendingRegistry()), address(m.tokenFactory()));

        AdminRegistry reg = m.adminRegistry();

        // Create test tokens
        (bool executed, variadic ret) = reg.castVoteOnIssue(address(m.tokenFactory()), "createToken", "USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        address USDST = address(ret);
        (executed, ret) = reg.castVoteOnIssue(address(m.tokenFactory()), "createToken", "sUSDST", "sUSDST Token", [], [], [], "sUSDST", 0, 18);
        address sUSDST = address(ret);

        // Activate tokens
        reg.castVoteOnIssue(USDST, "setStatus", 2);
        reg.castVoteOnIssue(sUSDST, "setStatus", 2);

        // Configure lending pool
        reg.castVoteOnIssue(address(m.poolConfigurator()), "setBorrowableAsset", USDST);
        reg.castVoteOnIssue(address(m.poolConfigurator()), "setMToken", sUSDST);

        // Configure fresh SafetyModule
        freshSM.syncFromRegistry();
        freshSM.setTokens(sUSDST, USDST);

        // Whitelist tokens for SafetyModule
        reg.castVoteOnIssue(address(reg), "addWhitelist", address(sUSDST), "mint", address(freshSM));
        reg.castVoteOnIssue(address(reg), "addWhitelist", address(sUSDST), "burn", address(freshSM));
    }

    function it_recordTransfer_reverts_when_called_by_non_lendingPool() public {
        SafetyModule sm = freshSM;

        // Attempt to call recordTransfer from test contract (not LendingPool)
        // This should revert immediately due to access control
        bool reverted = false;
        try sm.recordTransfer(100e18, 0) {
            // Should not reach here
        } catch Error(string memory errorMessage) {
            log(errorMessage);
            reverted = true;
        }
        require(reverted, "recordTransfer should revert when called by non-LendingPool");
    }

}