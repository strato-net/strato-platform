import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_BadDebt_Basic {

    constructor() {
    }

    Mercata m;

    User user1;
    User user2;

    Token USDST;

    function beforeAll() public {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        user1 = new User();
        user2 = new User();
        require(address(user1) != address(0), "User1 address is 0");
        require(address(user2) != address(0), "User2 address is 0");

        USDST = Token(m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18));
        require(address(USDST) != address(0), "USDST address is 0");
    }

    function beforeEach() public {
    }

    function it_proxy_aa_can_deploy_Mercata() public {
        require(address(m) != address(0), "address is 0");
    }

    function it_proxy_can_deploy_proxy() public {
        address feeCollectorImpl = address(new FeeCollector(this));
        require(address(feeCollectorImpl) != address(0), "FeeCollector address is 0");
        FeeCollector feeCollector = FeeCollector(address(new Proxy(feeCollectorImpl, this)));

        Token(USDST).mint(address(feeCollector), 100e18);
        // Ensure the functions may be called through the proxy
        feeCollector.withdrawToken(address(USDST), address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 100e18, "User1 should have 100 USDST");
        
        // Cleanup
        Token(USDST).burn(address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST");
    }

    function it_proxy_can_transfer_ownership() public {
        address feeCollectorImpl = address(new FeeCollector(this));
        require(address(feeCollectorImpl) != address(0), "FeeCollector address is 0");
        FeeCollector feeCollector = FeeCollector(address(new Proxy(feeCollectorImpl, this)));
        Ownable(feeCollector).transferOwnership(address(user1));

        Token(USDST).mint(address(feeCollector), 100e18);
        // Ensure that ownership was successfully transferred
        user1.do(address(feeCollector), "withdrawToken", address(USDST), address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 100e18, "User1 should have 100 USDST");

        // Cleanup
        Token(USDST).burn(address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST");
    }

    function it_proxy_can_non_proxy_transfer_ownership() public {
        FeeCollector feeCollector = new FeeCollector(this);
        Ownable(feeCollector).transferOwnership(address(user1));
        require(Ownable(feeCollector).owner() == address(user1), "Owner is not user1");

        Token(USDST).mint(address(feeCollector), 100e18);
        // Ensure that ownership was successfully transferred
        user1.do(address(feeCollector), "withdrawToken", address(USDST), address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 100e18, "User1 should have 100 USDST");

        // Cleanup
        Token(USDST).burn(address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST");
    }

    function it_proxy_ignores_impl_owner_if_proxied() public {
        address feeCollectorImpl = address(new FeeCollector(this)); // "this" is impl owner; should be ignored
        require(address(feeCollectorImpl) != address(0), "FeeCollector address is 0");
        FeeCollector feeCollector = FeeCollector(address(new Proxy(feeCollectorImpl, address(user1))));
        
        try Ownable(feeCollector).transferOwnership(address(user2))
            { revert("Ownership transfer should fail"); } catch {}

        Token(USDST).mint(address(feeCollector), 100e18);
        try feeCollector.withdrawToken(address(USDST), address(user1), 100e18)
            { revert("Withdrawal should fail"); } catch {}
        require(ERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST");

        // Cleanup
        Token(USDST).burn(address(feeCollector), 100e18);
        require(ERC20(USDST).balanceOf(address(feeCollector)) == 0, "FeeCollector should have 0 USDST");   
    }

    function it_proxy_can_upgrade_proxy() public {
        address adminRegistryImpl = address(new AdminRegistry());
        AdminRegistry adminRegistry = AdminRegistry(address(new Proxy(adminRegistryImpl, this)));
        adminRegistry.initialize([this]);

        // Ensure that new logic contract keeps old storage values (related to onlyOnce modifier)
        Proxy(address(adminRegistry)).setLogicContract(address(new AdminRegistry()));
        try adminRegistry.initialize([this])
            { revert("AdminRegistry can be re-initialized"); } catch {}
    }

    function it_proxy_can_access_boolean_member_var() public {
                // Test that admins array access should be possible for fresh AdminRegistry
        AdminRegistry fresh_admin_registry = new AdminRegistry();
        fresh_admin_registry.initialize([this]);
        require(fresh_admin_registry.initialized(), "AdminRegistry should be initialized");

        // Test that admins array access should be possible for fresh proxied AdminRegistry
        AdminRegistry fresh_proxied_admin_registry = AdminRegistry(address(new Proxy(address(fresh_admin_registry), this)));
        fresh_proxied_admin_registry.initialize([this]);
        require(fresh_proxied_admin_registry.initialized(), "AdminRegistry should be initialized");

        // Test that admins array access should be possible for mercata's AdminRegistry
        require(m.adminRegistry().initialized(), "AdminRegistry should be initialized");
    }

    function it_proxy_can_access_admins_array() public {
                // Test that admins array access should be possible for fresh AdminRegistry
        AdminRegistry fresh_admin_registry = new AdminRegistry();
        fresh_admin_registry.initialize([this]);
        address[] memory fresh_admins = fresh_admin_registry.admins();
        require(fresh_admins.length == 1, "Should have 1 initial admin");
        require(fresh_admins[0] == this, "First admin should be this");

        // Test that admins array access should be possible for fresh proxied AdminRegistry
        AdminRegistry fresh_proxied_admin_registry = AdminRegistry(address(new Proxy(address(fresh_admin_registry), this)));
        fresh_proxied_admin_registry.initialize([this]);
        address[] memory fresh_proxied_admins = fresh_proxied_admin_registry.admins();
        require(fresh_proxied_admins.length == 1, "Should have 1 initial admin");
        require(fresh_proxied_admins[0] == this, "First admin should be this");

        // Test that admins array access should be possible for mercata's AdminRegistry
        address[] memory admins = m.adminRegistry().admins();
        require(admins.length == 1, "Should have 1 initial admin");
        require(admins[0] == this, "First admin should be this");
    }

    function it_proxy_can_become_what_it_is_not() public {
        address feeCollectorImpl = address(new FeeCollector(this));
        require(address(feeCollectorImpl) != address(0), "FeeCollector implementation address is 0");
        FeeCollector feeCollector = FeeCollector(address(new Proxy(feeCollectorImpl, this)));
        require(address(feeCollector) != address(0), "FeeCollector proxy address is 0");
        require(address(feeCollector) != address(feeCollectorImpl), "FeeCollector proxy address should not be the same as the implementation address");
        Ownable(feeCollector).transferOwnership(address(user1));

        Token(USDST).mint(address(feeCollector), 200e18);
        user1.do(address(feeCollector), "withdrawToken", address(USDST), address(user1), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 100e18, "User1 should have 100 USDST");

        // Upgrade to a different implementation
        user1.do(address(feeCollector), "setLogicContract", address(new AdminRegistry()));

        // Ensure that old implementation functions are not callable
        try feeCollector.withdrawToken(address(USDST), address(user1), 100e18)
            { revert("Old implementation functions should not be callable"); } catch {}
        require(ERC20(USDST).balanceOf(address(user1)) == 100e18, "User1 should not have gained any USDST");

        // Can treat feeCollector as an AdminRegistry now
        AdminRegistry(address(feeCollector)).initialize([this]);

        // Note: Succeeds so far, then fails for the same reason as the previous test

        // Can get public member vars on our newly upgraded feeCollector
        bool my_initialized = AdminRegistry(address(feeCollector)).initialized();
        require(my_initialized, "AdminRegistry should be initialized");
        address[] memory my_admins = AdminRegistry(address(feeCollector)).admins();
        require(my_admins.length == 1, "Should have 1 initial admin");
        address admin = my_admins[0];
        require(admin == this, "First admin should be this");

        // Cleanup
        Token(USDST).burn(address(user1), 100e18);
        Token(USDST).burn(address(feeCollector), 100e18);
        require(ERC20(USDST).balanceOf(address(user1)) == 0, "User1 should have 0 USDST");
        require(ERC20(USDST).balanceOf(address(feeCollector)) == 0, "FeeCollector should have 0 USDST");
    }

    function it_proxy_should_not_compile_because_sets_variables_to_functions() public {
        address adminRegistryImpl = address(new AdminRegistry());
        AdminRegistry adminRegistry = AdminRegistry(address(new Proxy(adminRegistryImpl, address(user1))));
        adminRegistry.initialize([this]);

        bool initialized1 = adminRegistry.initialized;
        log(string(initialized1));

        // Upgrade to a different implementation
        user1.do(address(adminRegistry), "setLogicContract", address(new FeeCollector(this)));

        // Ensure that old member vars are accessible
        bool initialized2 = adminRegistry.initialized;
        log(string(initialized2));
    }
}
