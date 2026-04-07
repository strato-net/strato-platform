import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_SafetyModule_Attacks is Authorizable {

    uint public INFINITY = 2 ** 256 - 1;

    constructor() {
    }

    Mercata m;
    SafetyModule freshSM;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
        // Create fresh SafetyModule for each test
        freshSM = new SafetyModule(address(this));
        freshSM.initialize(address(m.lendingRegistry()), address(m.tokenFactory()));

        // Create test tokens
        address USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        address sUSDST = m.tokenFactory().createToken("sUSDST", "sUSDST Token", [], [], [], "sUSDST", 0, 18);

        // Activate tokens
        Token(USDST).setStatus(2);
        Token(sUSDST).setStatus(2);

        // Configure lending pool
        m.poolConfigurator().setBorrowableAsset(USDST);
        m.poolConfigurator().setMToken(sUSDST);

        // Configure fresh SafetyModule
        freshSM.syncFromRegistry();
        freshSM.setTokens(sUSDST, USDST);

        // Whitelist tokens for SafetyModule
        m.adminRegistry().addWhitelist(address(sUSDST), "mint", address(freshSM));
        m.adminRegistry().addWhitelist(address(sUSDST), "burn", address(freshSM));
    }

    function it_prevents_share_dilution_via_donation() public {
        SafetyModule sm = freshSM;
        address asset = address(sm.asset());
        address sToken = address(sm.sToken());

        User attacker = new User();
        User victim = new User();

        // Attacker stakes 1 wei
        Token(asset).mint(address(attacker), 1);
        attacker.do(asset, "approve", address(sm), INFINITY);
        attacker.do(address(sm), "stake(uint256,uint256)", 1, 1);

        uint attackerShares = IERC20(sToken).balanceOf(address(attacker));
        require(attackerShares == 1, "Attacker should have 1 share");

        // Attacker attempts to donate 10,000 USDST directly to contract
        uint donationAmount = 10000e18;
        Token(asset).mint(address(attacker), donationAmount);
        attacker.do(asset, "transfer", address(sm), donationAmount);

        // Internal tracking prevents donation from affecting totalAssets
        require(sm.totalAssets() == 1, "Total assets NOT inflated by donation");
        require(sm.totalShares() == 1, "Only 1 share exists");

        // Victim can now stake 9,999 USDST successfully (no dilution)
        Token(asset).mint(address(victim), 9999e18);
        victim.do(asset, "approve", address(sm), INFINITY);
        victim.do(address(sm), "stake(uint256,uint256)", 9999e18, 9999e18);

        uint victimShares = IERC20(sToken).balanceOf(address(victim));
        require(victimShares == 9999e18, "Victim gets fair shares for deposit");
        require(sm.totalShares() == 1 + 9999e18, "Total shares = 1 + 9999e18");
        require(sm.totalAssets() == 1 + 9999e18, "Total assets = 1 + 9999e18");

        // Both users get fair share values
        uint attackerShareValue = (attackerShares * sm.totalAssets()) / sm.totalShares();
        uint victimShareValue = (victimShares * sm.totalAssets()) / sm.totalShares();

        require(attackerShareValue == 1, "Attacker's share worth exactly 1 wei");
        require(victimShareValue == 9999e18, "Victim's shares worth exactly 9999e18");

        // No profit for attacker from donation
        require(attackerShareValue == 1, "Attacker gets no profit from donation");
    }

    function it_allows_small_deposits_after_donation() public {
        SafetyModule sm = freshSM;
        address asset = address(sm.asset());

        User attacker = new User();

        // Attacker stakes 1 wei and attempts to donate 10,000 USDST
        Token(asset).mint(address(attacker), 10000e18 + 1);
        attacker.do(asset, "approve", address(sm), INFINITY);
        attacker.do(address(sm), "stake(uint256,uint256)", 1, 1);
        attacker.do(asset, "transfer", address(sm), 10000e18);

        // Internal tracking prevents donation from affecting exchange rate
        require(sm.totalAssets() == 1, "Total assets NOT affected by donation");
        require(sm.totalShares() == 1, "Only 1 share exists");

        // Test various deposit amounts - all should work normally
        uint[] memory amounts = [1e18, 10e18, 100e18, 1000e18, 5000e18, 9999e18];

        for (uint i = 0; i < amounts.length; i++) {
            User victim = new User();
            Token(asset).mint(address(victim), amounts[i]);
            victim.do(asset, "approve", address(sm), INFINITY);

            // All deposits should succeed with fair share calculation
            victim.do(address(sm), "stake(uint256,uint256)", amounts[i], amounts[i]);

            uint victimShares = IERC20(address(sm.sToken())).balanceOf(address(victim));
            require(victimShares == amounts[i], "Victim gets fair shares for deposit");
        }

        // Verify final state is correct
        require(sm.totalAssets() == 1 + 1e18 + 10e18 + 100e18 + 1000e18 + 5000e18 + 9999e18, "Total assets correct");
        require(sm.totalShares() == 1 + 1e18 + 10e18 + 100e18 + 1000e18 + 5000e18 + 9999e18, "Total shares correct");
    }

    function it_allows_recovery_of_stray_assets() public {
        SafetyModule sm = freshSM;
        address asset = address(sm.asset());

        User attacker = new User();
        User victim = new User();

        // Attacker stakes 1 wei
        Token(asset).mint(address(attacker), 1);
        attacker.do(asset, "approve", address(sm), INFINITY);
        attacker.do(address(sm), "stake(uint256,uint256)", 1, 1);

        // Attacker donates 10,000 USDST directly to contract
        uint donationAmount = 10000e18;
        Token(asset).mint(address(attacker), donationAmount);
        attacker.do(asset, "transfer", address(sm), donationAmount);

        // Internal tracking is unaffected
        require(sm.totalAssets() == 1, "Internal tracking unaffected by donation");

        // Admin can recover stray assets
        uint balanceBefore = IERC20(asset).balanceOf(address(this));
        sm.recoverStrayAssets(address(this));
        uint balanceAfter = IERC20(asset).balanceOf(address(this));

        require(balanceAfter == balanceBefore + donationAmount, "Stray assets recovered");
        require(sm.totalAssets() == 1, "Internal tracking still unaffected");

        // Victim can still stake normally
        Token(asset).mint(address(victim), 1000e18);
        victim.do(asset, "approve", address(sm), INFINITY);
        victim.do(address(sm), "stake(uint256,uint256)", 1000e18, 1000e18);

        uint victimShares = IERC20(address(sm.sToken())).balanceOf(address(victim));
        require(victimShares == 1000e18, "Victim gets fair shares");
        require(sm.totalAssets() == 1 + 1000e18, "Total assets updated correctly");
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