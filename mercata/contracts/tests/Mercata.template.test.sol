import "../concrete/BaseCodeCollection.sol";
import "../abstract/ERC20/IERC20.sol";
import "../abstract/ERC20/access/Authorizable.sol";
import "../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_BadDebt_Basic is Authorizable {

    constructor() {
    }

    Mercata m;

    User user1;
    User user2;

    address USDST;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
    }

    function it_aa_can_deploy_Mercata() public {
        require(address(m) != address(0), "address is 0");
    }

    // Test basic token creation functionality
    function it_ab_can_create_tokens() public {
        // Create test token for borrowing
        USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        require(address(USDST) != address(0), "Failed to create USDST token");
    }

    // Test token activation functionality
    function it_ac_can_activate_tokens() public {
        // Set tokens to active status
        Token(USDST).setStatus(2);
        
        // Basic checks - tokens activated successfully
        require(Token(USDST).status() == TokenStatus.ACTIVE, "USDST token not activated");
    }

    // Test complete lending pool configuration with full setup
    function it_ad_can_configure_lending_pool() public {
        // Get the lending pool and configurator from Mercata infrastructure
        LendingPool pool = m.lendingPool();
        PoolConfigurator configurator = m.poolConfigurator();
        PriceOracle oracle = m.priceOracle();
        require(address(pool) != address(0), "LendingPool not found");
        require(address(configurator) != address(0), "PoolConfigurator not found");

        // Configure USDST
        configurator.configureAsset(
            USDST,
            0,
            0, 
            11000,
            500,
            1000,
            1000000001547125956666413085
        );
        
        // Verify that assets are properly configured in the pool
        require(pool.configuredAssets(0) == USDST, "USDST not correctly configured in configured assets");
    }

    function it_ae_persists_accross_tests() public {
        LendingPool pool = m.lendingPool();
        require(pool.configuredAssets(0) == USDST, "No persistent configured assets");
    }

    function it_ba_can_display_logs() public {
        log("Hello, world! We're at " + string(address(m)));
    }

    function it_ca_can_simulate_users() public {
        user1 = new User();
        user2 = new User();

        Token(USDST).mint(address(this), 1000e18);
        IERC20(USDST).transfer(address(user1), 1000e18);
        require(IERC20(USDST).balanceOf(address(user1)) == 1000e18, "User1 should have 1000 USDST after receipt");
        user1.do(USDST, "transfer", address(user2), 1000e18);
        require(IERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST after transfer out");
        require(IERC20(USDST).balanceOf(address(user2)) == 1000e18, "User2 should have 1000 USDST after receipt");
        user2.do(USDST, "transfer", address(this), 1000e18);
        require(IERC20(USDST).balanceOf(address(user2)) == 0, "User2 should have 0 USDST after transfer out");
        require(IERC20(USDST).balanceOf(address(this)) == 1000e18, "Admin should have 1000 USDST after receipt");
        Token(USDST).burn(address(this), 1000e18);
    }

}





