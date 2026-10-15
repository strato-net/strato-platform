import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Admin/AdminRegistry.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/Tokens/TokenFactory.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Lending/PriceOracle.sol";
import "../../concrete/Vault/Vault.sol";

/**
 * @title User
 * @notice Simulates an end user (or a non-admin caller) in tests
 */
contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }

    function redeem(address vault, address[] holders) public returns (uint) {
        return Vault(vault).redeemAllFor(holders);
    }
}

/**
 * @title AdminUser
 * @notice A second AdminRegistry admin. Must be Authorizable so the registry
 *         accepts votes routed through Ownable's governance fallback.
 */
contract AdminUser is Authorizable {
    constructor() {
        bypassAuthorizations = true;
    }

    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

/**
 * @title Describe_VaultRedeemAllFor
 * @notice Standalone harness for Vault.redeemAllFor (the sunset sweep).
 * @dev Wires TokenFactory, PriceOracle, AdminRegistry, Proxy and Vault directly
 *      instead of through BaseCodeCollection, so it compiles on the local
 *      solid-vm-cli (which cannot build the Staking contracts the collection imports).
 *      Ownership mirrors prod: the share token is owned by an AdminRegistry and the
 *      vault burns/mints through whitelist entries; the vault proxy is owned by this
 *      test contract by default and handed to a registry in the governance tests.
 */
contract Describe_VaultRedeemAllFor is Authorizable {

    string[] emptyArray;

    TokenFactory tokenFactory;
    PriceOracle oracle;
    AdminRegistry adminRegistry;

    User botExecutor;
    User user1;
    User user2;
    User user3;
    User stranger;

    Vault vault;
    address vaultAddress;
    address shareTokenAddress;

    address tokenA; // ETHST  $2,000
    address tokenB; // WBTCST $40,000
    address tokenC; // GOLDST $100

    uint constant WAD = 1e18;
    uint constant MAX_UINT = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
    uint constant TOL = 1e9; // rounding tolerance in token wei (1e-9 tokens)

    // ============ SETUP ============

    function beforeAll() {
        bypassAuthorizations = true;
        emptyArray = new string[](0);

        botExecutor = new User();
        user1 = new User();
        user2 = new User();
        user3 = new User();
        stranger = new User();
    }

    function beforeEach() {
        tokenFactory = new TokenFactory(address(this));
        oracle = new PriceOracle(address(this));
        oracle.initialize();

        // Governance: this test contract is the sole admin of a proxied AdminRegistry
        adminRegistry = AdminRegistry(address(new Proxy(address(new AdminRegistry()), address(this))));
        adminRegistry.initialize([address(this)]);
        Ownable(address(adminRegistry)).transferOwnership(address(adminRegistry));

        tokenA = _createAsset("ETHST", 2000e18);
        tokenB = _createAsset("WBTCST", 40000e18);
        tokenC = _createAsset("GOLDST", 100e18);

        // Vault behind a Proxy, as on prod. This test contract is the owner.
        address impl = address(new Vault(address(this)));
        vaultAddress = address(new Proxy(impl, address(this)));
        vault = Vault(vaultAddress);

        // Share token owned by the AdminRegistry; vault whitelisted to mint/burn (prod layout)
        shareTokenAddress = tokenFactory.createToken(
            "Vault Shares", "share token", emptyArray, emptyArray, emptyArray, "SLP", 0, 18
        );
        Token(shareTokenAddress).setStatus(2);
        Ownable(shareTokenAddress).transferOwnership(address(adminRegistry));
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", shareTokenAddress, "mint", vaultAddress);
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", shareTokenAddress, "burn", vaultAddress);

        vault.initialize(address(oracle), address(botExecutor), shareTokenAddress);
        vault.addSupportedAsset(tokenA);
        vault.addSupportedAsset(tokenB);
        vault.addSupportedAsset(tokenC);

        // Bot executor (a plain account on prod) approves the vault for every asset
        botExecutor.do(tokenA, "approve", vaultAddress, MAX_UINT);
        botExecutor.do(tokenB, "approve", vaultAddress, MAX_UINT);
        botExecutor.do(tokenC, "approve", vaultAddress, MAX_UINT);
    }

    // ============ HELPERS ============

    function _createAsset(string symbol, uint price) internal returns (address token) {
        token = tokenFactory.createToken(symbol, symbol, emptyArray, emptyArray, emptyArray, symbol, 0, 18);
        Token(token).setStatus(2);
        Token(token).mint(address(user1), 1000000e18);
        Token(token).mint(address(user2), 1000000e18);
        Token(token).mint(address(user3), 1000000e18);
        oracle.setAssetPrice(token, price);
        return token;
    }

    function _deposit(User u, address token, uint amount) internal {
        u.do(token, "approve", vaultAddress, amount);
        u.do(vaultAddress, "deposit", token, amount);
    }

    /// user1 $40,000 ETHST, user2 $20,000 WBTCST, user3 $10,000 GOLDST -> $70,000, 70,000 shares
    function _seed() internal {
        _deposit(user1, tokenA, 20e18);
        _deposit(user2, tokenB, 5e17);
        _deposit(user3, tokenC, 100e18);
    }

    function _shares(address who) internal view returns (uint) {
        return IERC20(shareTokenAddress).balanceOf(who);
    }

    function _bal(address token, address who) internal view returns (uint) {
        return IERC20(token).balanceOf(who);
    }

    function _assertApprox(uint actual, uint expected, string label) internal {
        uint diff = actual > expected ? actual - expected : expected - actual;
        require(diff <= TOL, label + ": expected " + string(expected) + " got " + string(actual));
    }

    function _three() internal returns (address[]) {
        address[] holders = new address[](3);
        holders[0] = address(user1);
        holders[1] = address(user2);
        holders[2] = address(user3);
        return holders;
    }

    // ============ CORE BEHAVIOUR ============

    function it_redeems_every_holder_pro_rata() {
        _seed();

        uint supply0 = IERC20(shareTokenAddress).totalSupply();
        uint s1 = _shares(address(user1));
        uint s2 = _shares(address(user2));
        uint s3 = _shares(address(user3));
        require(supply0 == 70000e18, "seed supply");
        require(s1 == 40000e18 && s2 == 20000e18 && s3 == 10000e18, "seed shares");

        uint a0 = _bal(tokenA, address(botExecutor));
        uint b0 = _bal(tokenB, address(botExecutor));
        uint c0 = _bal(tokenC, address(botExecutor));

        uint u1a = _bal(tokenA, address(user1)); uint u1b = _bal(tokenB, address(user1)); uint u1c = _bal(tokenC, address(user1));
        uint u2a = _bal(tokenA, address(user2)); uint u2b = _bal(tokenB, address(user2)); uint u2c = _bal(tokenC, address(user2));
        uint u3a = _bal(tokenA, address(user3)); uint u3b = _bal(tokenB, address(user3)); uint u3c = _bal(tokenC, address(user3));

        uint redeemed = vault.redeemAllFor(_three());
        require(redeemed == 3, "should redeem 3 holders");

        // Every holder receives shares_i / supply_0 of every asset
        _assertApprox(_bal(tokenA, address(user1)) - u1a, (s1 * a0) / supply0, "user1 tokenA");
        _assertApprox(_bal(tokenB, address(user1)) - u1b, (s1 * b0) / supply0, "user1 tokenB");
        _assertApprox(_bal(tokenC, address(user1)) - u1c, (s1 * c0) / supply0, "user1 tokenC");
        _assertApprox(_bal(tokenA, address(user2)) - u2a, (s2 * a0) / supply0, "user2 tokenA");
        _assertApprox(_bal(tokenB, address(user2)) - u2b, (s2 * b0) / supply0, "user2 tokenB");
        _assertApprox(_bal(tokenC, address(user2)) - u2c, (s2 * c0) / supply0, "user2 tokenC");
        _assertApprox(_bal(tokenA, address(user3)) - u3a, (s3 * a0) / supply0, "user3 tokenA");
        _assertApprox(_bal(tokenB, address(user3)) - u3b, (s3 * b0) / supply0, "user3 tokenB");
        _assertApprox(_bal(tokenC, address(user3)) - u3c, (s3 * c0) / supply0, "user3 tokenC");

        // All shares gone, only rounding dust left with the executor
        require(_shares(address(user1)) == 0 && _shares(address(user2)) == 0 && _shares(address(user3)) == 0, "shares burned");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero");
        require(_bal(tokenA, address(botExecutor)) <= TOL, "tokenA dust only");
        require(_bal(tokenB, address(botExecutor)) <= TOL, "tokenB dust only");
        require(_bal(tokenC, address(botExecutor)) <= TOL, "tokenC dust only");
    }

    function it_skips_non_holders_and_duplicates() {
        _seed();

        address[] holders = new address[](6);
        holders[0] = address(stranger);
        holders[1] = address(user1);
        holders[2] = address(user1);
        holders[3] = address(user2);
        holders[4] = address(botExecutor);
        holders[5] = address(user3);

        uint redeemed = vault.redeemAllFor(holders);
        require(redeemed == 3, "only the three real holders count");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero");
        require(_bal(tokenA, address(stranger)) == 0 && _bal(tokenB, address(stranger)) == 0 && _bal(tokenC, address(stranger)) == 0, "stranger paid nothing");
    }

    function it_partial_batches_compose() {
        _seed();
        uint supply0 = IERC20(shareTokenAddress).totalSupply();
        uint s2 = _shares(address(user2));
        uint b0 = _bal(tokenB, address(botExecutor));
        uint u2b = _bal(tokenB, address(user2));

        address[] first = new address[](1);
        first[0] = address(user1);
        require(vault.redeemAllFor(first) == 1, "first batch");
        require(_shares(address(user1)) == 0, "user1 out");
        require(_shares(address(user2)) == s2, "user2 untouched by first batch");

        address[] second = new address[](2);
        second[0] = address(user2);
        second[1] = address(user3);
        require(vault.redeemAllFor(second) == 2, "second batch");

        // user2's slice is still shares_2 / supply_0 of the original balance
        _assertApprox(_bal(tokenB, address(user2)) - u2b, (s2 * b0) / supply0, "user2 tokenB across batches");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero");
        require(_bal(tokenA, address(botExecutor)) <= TOL && _bal(tokenB, address(botExecutor)) <= TOL && _bal(tokenC, address(botExecutor)) <= TOL, "dust only");
    }

    function it_burns_dust_shares_without_payout() {
        _seed();
        // 1 wei of shares is worth $0 after flooring
        user1.do(shareTokenAddress, "transfer", address(stranger), 1);
        require(_shares(address(stranger)) == 1, "stranger holds 1 wei share");

        address[] holders = new address[](1);
        holders[0] = address(stranger);
        uint redeemed = vault.redeemAllFor(holders);

        require(redeemed == 1, "dust holder counted");
        require(_shares(address(stranger)) == 0, "dust share burned");
        require(_bal(tokenA, address(stranger)) == 0 && _bal(tokenB, address(stranger)) == 0 && _bal(tokenC, address(stranger)) == 0, "no payout for dust");
    }

    function it_leaves_position_intact_when_liquidity_is_blocked() {
        _seed();
        // Reserve all ETHST: withdrawable equity drops to $30,000 (WBTCST + GOLDST)
        vault.setMinReserve(tokenA, 20e18);
        require(vault.getWithdrawableEquity() == 30000e18, "withdrawable equity");

        uint s1 = _shares(address(user1));
        uint redeemed = vault.redeemAllFor(_three());

        // user1 ($40,000) cannot be paid in full -> skipped, not burned, not partially paid
        require(redeemed == 2, "two holders redeemed");
        require(_shares(address(user1)) == s1, "user1 shares intact");
        require(_bal(tokenB, address(user1)) == 1000000e18 && _bal(tokenC, address(user1)) == 1000000e18, "user1 received nothing");
        require(_shares(address(user2)) == 0 && _shares(address(user3)) == 0, "others redeemed");
        // Reserved asset was never touched
        require(_bal(tokenA, address(botExecutor)) == 20e18, "reserved ETHST untouched");
    }

    function it_works_while_paused() {
        _seed();
        vault.pause();

        // Users are frozen
        bool reverted = false;
        try {
            user2.do(vaultAddress, "withdrawShares", 1e18);
        } catch {
            reverted = true;
        }
        require(reverted, "user withdraw must revert while paused");

        // The sweep is not
        uint redeemed = vault.redeemAllFor(_three());
        require(redeemed == 3, "sweep runs while paused");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero");
    }

    function it_handles_zero_equity_by_burning_only() {
        _seed();
        // Executor moves every asset away: equity becomes 0 while shares remain
        botExecutor.do(tokenA, "transfer", address(stranger), _bal(tokenA, address(botExecutor)));
        botExecutor.do(tokenB, "transfer", address(stranger), _bal(tokenB, address(botExecutor)));
        botExecutor.do(tokenC, "transfer", address(stranger), _bal(tokenC, address(botExecutor)));
        require(vault.getTotalEquity() == 0, "equity zero");

        uint redeemed = vault.redeemAllFor(_three());
        require(redeemed == 3, "all burned");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero");
    }

    function it_ten_holders_in_one_call() {
        _seed();
        User[] extra = new User[](7);
        address[] holders = new address[](10);
        holders[0] = address(user1);
        holders[1] = address(user2);
        holders[2] = address(user3);
        for (uint i = 0; i < 7; i++) {
            extra[i] = new User();
            Token(tokenC).mint(address(extra[i]), 10e18);
            _deposit(extra[i], tokenC, 10e18); // $1,000 each
            holders[3 + i] = address(extra[i]);
        }
        require(IERC20(shareTokenAddress).totalSupply() == 77000e18, "ten-holder supply");

        uint redeemed = vault.redeemAllFor(holders);
        require(redeemed == 10, "ten holders redeemed");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero");
        for (uint j = 0; j < 7; j++) {
            require(_shares(address(extra[j])) == 0, "extra holder burned");
            require(_bal(tokenC, address(extra[j])) > 0, "extra holder paid");
        }
    }

    // ============ REGRESSION: USER PATHS STILL PAY THE CALLER ============

    function it_existing_withdraw_paths_still_pay_the_caller() {
        _seed();
        uint u2b = _bal(tokenB, address(user2));
        uint u1b = _bal(tokenB, address(user1));

        user2.do(vaultAddress, "withdrawShares", 20000e18);
        require(_shares(address(user2)) == 0, "user2 burned");
        require(_bal(tokenB, address(user2)) > u2b, "user2 was paid");
        require(_bal(tokenB, address(user1)) == u1b, "user1 untouched");

        uint u3c = _bal(tokenC, address(user3));
        user3.do(vaultAddress, "withdraw", 5000e18);
        require(_bal(tokenC, address(user3)) > u3c, "user3 was paid by withdraw()");
        require(_shares(address(user3)) < 10000e18, "user3 shares reduced");
    }

    // ============ ACCESS CONTROL AND GOVERNANCE ============

    function it_rejects_non_owner_callers() {
        _seed();
        uint supply0 = IERC20(shareTokenAddress).totalSupply();

        bool reverted = false;
        try {
            stranger.redeem(vaultAddress, _three());
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner call must revert (direct owner)");
        require(IERC20(shareTokenAddress).totalSupply() == supply0, "nothing burned");

        // Same with the vault owned by the AdminRegistry (prod layout)
        vault.transferOwnership(address(adminRegistry));
        reverted = false;
        try {
            stranger.redeem(vaultAddress, _three());
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner call must revert (registry owner)");
        require(IERC20(shareTokenAddress).totalSupply() == supply0, "nothing burned via registry");
    }

    function it_executes_through_admin_registry_vote() {
        _seed();
        vault.transferOwnership(address(adminRegistry));
        require(vault.owner() == address(adminRegistry), "registry owns vault");

        uint supply0 = IERC20(shareTokenAddress).totalSupply();
        uint s1 = _shares(address(user1));
        uint a0 = _bal(tokenA, address(botExecutor));
        uint u1a = _bal(tokenA, address(user1));

        // Sole admin: one vote reaches the 60% threshold and the registry re-enters the vault
        address(vault).call("redeemAllFor", _three());

        require(IERC20(shareTokenAddress).totalSupply() == 0, "supply zero after vote");
        _assertApprox(_bal(tokenA, address(user1)) - u1a, (s1 * a0) / supply0, "user1 tokenA via vote");
        require(_bal(tokenA, address(botExecutor)) <= TOL, "dust only via vote");
    }

    function it_requires_threshold_votes_before_executing() {
        _seed();

        // Fresh registry with two admins (this test + adminUser): 60% of 2 needs both votes
        AdminUser adminUser = new AdminUser();
        AdminRegistry twoAdmins = AdminRegistry(address(new Proxy(address(new AdminRegistry()), address(this))));
        twoAdmins.initialize([address(this), address(adminUser)]);
        Ownable(address(twoAdmins)).transferOwnership(address(twoAdmins));
        vault.transferOwnership(address(twoAdmins));

        uint supply0 = IERC20(shareTokenAddress).totalSupply();
        address[] holders = _three();

        // First vote: issue created, nothing executes
        address(vault).call("redeemAllFor", holders);
        require(IERC20(shareTokenAddress).totalSupply() == supply0, "first vote must not execute");

        // Second admin votes with identical arguments: executes
        adminUser.do(vaultAddress, "redeemAllFor", holders);
        require(IERC20(shareTokenAddress).totalSupply() == 0, "second vote executes");
        require(_bal(tokenA, address(botExecutor)) <= TOL, "dust only after governed sweep");
    }
}
