import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Proxy/Proxy.sol";
import "../../concrete/YieldVault/YieldVault.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }

    function do0(address a, string f) public returns (variadic) {
        variadic result = address(a).call(f);
        return result;
    }
}

contract FailingAccrualToken is ERC20 {
    mapping(address => bool) public blockedBalance;
    mapping(address => bool) public blockedAllowance;
    mapping(address => bool) public blockedTransfer;
    mapping(address => bool) public falseTransfer;

    constructor() ERC20("Failing Accrual Token", "FAIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function balanceOf(address account) public view override returns (uint256) {
        require(!blockedBalance[account], "FailingAccrualToken: balance blocked");
        return super.balanceOf(account);
    }

    function allowance(address owner_, address spender) public view override returns (uint256) {
        require(!blockedAllowance[owner_], "FailingAccrualToken: allowance blocked");
        return super.allowance(owner_, spender);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        require(!blockedTransfer[from], "FailingAccrualToken: transfer blocked");
        if (falseTransfer[from]) return false;
        return super.transferFrom(from, to, value);
    }

    function setFailures(address account, bool balance, bool allowance_, bool transfer_, bool false_) external {
        blockedBalance[account] = balance;
        blockedAllowance[account] = allowance_;
        blockedTransfer[account] = transfer_;
        falseTransfer[account] = false_;
    }
}

contract Describe_YieldVault is Authorizable {
    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;
    uint public MAX_RATE = 1000000021979553151239153027;
    uint public MONTH = 2592000;

    Mercata m;
    YieldVault vault;
    address asset;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
        vault = new YieldVault(address(this));
        asset = m.tokenFactory().createToken("ETH", "Wrapped ETH", [], [], [], "ETH", 0, 18);
        Token(asset).setStatus(2);
        vault.initialize(asset, "ETH Carry Vault", "carryETH");
    }

    function _mintAndDeposit(User user, uint amount) internal {
        Token(asset).mint(address(user), amount);
        user.do(asset, "approve", address(vault), INFINITY);
        user.do(address(vault), "deposit(uint256,address)", amount, address(user));
    }

    function _approveStrategy(address strategy) internal {
        vault.setStrategyApproval(strategy, true);
    }

    function _configureFundedAccrual(User distributor, uint rate) internal {
        if (!vault.accrualInitialized()) {
            vault.initializeAccrual();
        }
        vault.setRewardDistributor(address(distributor));
        vault.setPerSecondSavingsRate(rate);
    }

    function _deployProxiedVault() internal returns (YieldVault proxiedVault) {
        address impl = address(new YieldVault(address(this)));
        proxiedVault = YieldVault(address(new Proxy(impl, address(this))));
        proxiedVault.initialize(asset, "ETH Carry Vault", "carryETH");
    }

    function it_initializes_correctly() public {
        require(vault.asset() == asset, "asset mismatch");
        require(vault.vaultInitialized(), "not initialized");
        require(vault.totalAssets() == 0, "totalAssets should be 0");
        require(vault.totalSupply() == 0, "totalSupply should be 0");
        require(vault.deployedAssets() == 0, "deployedAssets should be 0");
        require(vault.minIdleBps() == 0, "minIdleBps should start at 0");
        require(vault.exchangeRate() == WAD, "empty vault rate should be 1e18");
        require(vault.nextRequestId() == 1, "queue ids should start at 1");
        require(!vault.accrualInitialized(), "accrual should require opt-in initialization");
        require(vault.perSecondSavingsRate() == 0, "rate should be unset");
        require(vault.accrualBaseAssets() == 0, "initial accrual base should be zero");
    }

    function it_cannot_initialize_twice() public {
        bool reverted = false;
        try vault.initialize(asset, "X", "X") {
        } catch {
            reverted = true;
        }
        require(reverted, "double init should revert");
    }

    function it_initializes_accrual_as_an_opt_in_feature() public {
        User alice = new User();
        _mintAndDeposit(alice, 100e18);

        vault.initializeAccrual();

        require(vault.accrualInitialized(), "accrual should initialize");
        require(vault.perSecondSavingsRate() == 1e27, "initial rate should be flat");
        require(vault.accrualBaseAssets() == 100e18, "initial base should checkpoint active assets");

        bool reverted = false;
        try vault.initializeAccrual() {
        } catch {
            reverted = true;
        }
        require(reverted, "double accrual initialization should revert");
    }

    function it_only_deploys_to_approved_strategies_and_respects_idle_reserve() public {
        User alice = new User();
        address strategy = address(new User());

        _mintAndDeposit(alice, 100e18);
        require(vault.maxDeploy() == 100e18, "full idle deployable by default");

        bool reverted = false;
        try vault.deployCapital(strategy, 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "unapproved strategy should revert");

        _approveStrategy(strategy);
        vault.setMinIdleBps(1000);
        require(vault.maxDeploy() == 90e18, "10% idle reserve should be enforced");

        reverted = false;
        try vault.deployCapital(strategy, 91e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "deploy over reserve should revert");

        vault.deployCapital(strategy, 90e18);
        require(vault.strategyDebt(strategy) == 90e18, "strategy debt tracked");
        require(vault.deployedAssets() == 90e18, "deployed assets tracked");
        require(IERC20(asset).balanceOf(address(vault)) == 10e18, "idle reserve remains in vault");
    }

    function it_returnCapital_realizes_profit_without_manual_gain_reporting() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);

        Token(asset).mint(address(strategy), 85e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 85e18);

        require(vault.strategyDebt(address(strategy)) == 0, "strategy debt should be repaid");
        require(vault.deployedAssets() == 0, "all deployed assets should be repaid");
        require(vault.totalAssets() == 105e18, "returned profit should raise active assets");
        require(vault.exchangeRate() == (105e18 * WAD) / 100e18, "exchange rate should reflect realized profit");
    }

    function it_reportStrategyLoss_is_strategy_specific_write_down() public {
        User alice = new User();
        address strategyA = address(new User());
        address strategyB = address(new User());

        _mintAndDeposit(alice, 200e18);
        _approveStrategy(strategyA);
        _approveStrategy(strategyB);

        vault.deployCapital(strategyA, 120e18);
        vault.deployCapital(strategyB, 40e18);
        vault.reportStrategyLoss(strategyA, 30e18);

        require(vault.strategyDebt(strategyA) == 90e18, "strategy A debt reduced");
        require(vault.strategyDebt(strategyB) == 40e18, "strategy B debt unchanged");
        require(vault.deployedAssets() == 130e18, "global deployed assets reduced");
        require(vault.totalAssets() == 170e18, "active assets reflect realized write-down");
    }

    function it_pause_blocks_new_entry_and_admin_mutation_but_allows_unwind() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 60e18);
        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 20e18, address(alice), address(alice));

        vault.pause();

        require(vault.maxDeposit(address(alice)) == 0, "maxDeposit should be 0 when paused");
        require(vault.maxMint(address(alice)) == 0, "maxMint should be 0 when paused");
        require(vault.maxWithdraw(address(alice)) == 0, "maxWithdraw should be 0 when paused");
        require(vault.maxRedeem(address(alice)) == 0, "maxRedeem should be 0 when paused");

        bool reverted = false;
        try alice.do(address(vault), "deposit(uint256,address)", 10e18, address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "deposit should revert when paused");

        reverted = false;
        try vault.deployCapital(address(strategy), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "deploy should revert when paused");

        reverted = false;
        try vault.processQueue(1, INFINITY) {
        } catch {
            reverted = true;
        }
        require(reverted, "queue processing should revert when paused");

        reverted = false;
        try vault.reportStrategyLoss(address(strategy), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "loss write-down should revert when paused");

        Token(asset).mint(address(strategy), 60e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 60e18);
        require(vault.deployedAssets() == 0, "capital return should still work while paused");
    }

    function it_redeemOrQueue_queues_when_idle_is_insufficient() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 100e18, address(alice), address(alice));

        uint64 requestId = vault.activeRequestId(address(alice));
        require(requestId == 1, "alice should receive first queue id");
        require(vault.queueHead() == requestId, "head should point to alice");
        require(vault.queueTail() == requestId, "tail should point to alice");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 0, "owner balance should move into escrow");
        require(IERC20(address(vault)).balanceOf(address(vault)) == 100e18, "queued shares should sit in vault custody");
        require(vault.totalQueuedShares() == 100e18, "queued shares should be tracked");
    }

    function it_redeemOrQueue_pays_immediately_when_fully_liquid() public {
        User alice = new User();

        _mintAndDeposit(alice, 100e18);

        uint aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 40e18, address(alice), address(alice));
        uint assetsReceived = IERC20(asset).balanceOf(address(alice)) - aliceBefore;

        require(assetsReceived >= 40e18 - 1 && assetsReceived <= 40e18, "immediate path should pay preview assets");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 60e18, "shares should be burned immediately");
        require(vault.totalQueuedShares() == 0, "nothing should be queued");
        require(vault.activeRequestId(address(alice)) == 0, "no queue request should exist");
    }

    function it_redeemOrQueue_queues_full_request_and_stores_receiver_when_not_fully_liquid() public {
        User alice = new User();
        User strategy = new User();
        address receiver = address(new User());

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);

        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 100e18, receiver, address(alice));

        require(IERC20(address(vault)).balanceOf(address(alice)) == 0, "owner should hold no active shares");
        require(IERC20(address(vault)).balanceOf(address(vault)) == 100e18, "all queued shares should sit in escrow");
        uint64 requestId = vault.activeRequestId(address(alice));
        require(requestId != 0, "request should exist");
        (uint256 shares, address reqReceiver,, bool exists) = vault.requests(requestId);
        require(exists, "request should be live");
        require(shares == 100e18, "full request should queue");
        require(reqReceiver == receiver, "receiver should be stored");
        require(vault.totalQueuedShares() == 100e18, "queued share total should increase");
    }

    function it_restricts_users_to_one_active_request() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 50e18, address(alice), address(alice));

        bool reverted = false;
        try alice.do(address(vault), "requestRedeem(uint256,address,address)", 1e18, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "second request should revert");
    }

    function it_cancelRequest_returns_head_request_shares() public {
        User strategy = new User();

        Token(asset).mint(address(this), 100e18);
        IERC20(asset).approve(address(vault), INFINITY);
        vault.deposit(100e18, address(this));
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        vault.requestRedeem(100e18, address(this), address(this));

        vault.cancelRequest();

        require(IERC20(address(vault)).balanceOf(address(this)) == 100e18, "queued shares should return to user");
        require(vault.activeRequestId(address(this)) == 0, "request id should clear");
        require(vault.queueHead() == 0, "head should clear");
        require(vault.queueTail() == 0, "tail should clear");
        require(vault.totalQueuedShares() == 0, "queued shares should clear");
    }

    function it_cancelRequest_advances_head_without_touching_tail() public {
        User alice = new User();
        User bob = new User();
        User charlie = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _mintAndDeposit(charlie, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 250e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        bob.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(bob), address(bob));
        charlie.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(charlie), address(charlie));

        uint64 bobRequestId = vault.activeRequestId(address(bob));
        uint64 charlieRequestId = vault.activeRequestId(address(charlie));
        require(vault.queueHead() == vault.activeRequestId(address(alice)), "alice should start at head");
        require(vault.queueTail() == charlieRequestId, "charlie should start at tail");

        alice.do0(address(vault), "cancelRequest()");

        require(vault.queueHead() == bobRequestId, "head should advance to bob");
        require(vault.queueTail() == charlieRequestId, "tail should remain charlie");
        require(vault.activeRequestId(address(alice)) == 0, "alice request should clear");
        require(vault.totalQueuedShares() == 200e18, "only alice queued shares should be removed");
    }

    function it_processQueue_partially_processes_head_when_idle_is_limited() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));

        (uint256 processed, uint256 burnedShares, uint256 reservedAssets) = vault.processQueue(1, INFINITY);

        require(processed == 1, "one request should be processed");
        require(burnedShares == 20e18, "only idle-sized shares should burn");
        require(reservedAssets == 20e18, "only idle-sized assets should reserve");
        require(vault.claimableAssets(address(alice)) == 20e18, "claimable assets should increase");
        require(vault.totalClaimableAssets() == 20e18, "global claimables should increase");
        require(vault.totalQueuedShares() == 80e18, "remaining queued shares should stay pending");
        uint64 requestId = vault.activeRequestId(address(alice));
        (uint256 remainingShares,, , bool exists) = vault.requests(requestId);
        require(exists, "request should still exist");
        require(remainingShares == 80e18, "request should keep remaining shares");
    }

    function it_processQueue_partial_fill_respects_asset_budget_at_non_unit_rate() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 3e18);
        _mintAndDeposit(bob, 3e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 5e18);

        Token(asset).mint(address(strategy), 6e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 6e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 3e18, address(alice), address(alice));

        (uint256 processed, uint256 burnedShares, uint256 reservedAssets) = vault.processQueue(1, 1e18);

        require(processed == 1, "partial head processing should count as one processed request");
        require(burnedShares > 0 && burnedShares < 3e18, "partial branch should burn some but not all shares");
        require(reservedAssets > 0, "partial branch should reserve assets");
        require(reservedAssets <= 1e18, "partial branch must respect the asset budget");
        require(vault.claimableAssets(address(alice)) == reservedAssets, "claimable assets should match reserved amount");

        uint64 requestId = vault.activeRequestId(address(alice));
        (uint256 remainingShares,, , bool exists) = vault.requests(requestId);
        require(exists, "request should remain open after partial fill");
        require(remainingShares + burnedShares == 3e18, "partial fill should conserve requested shares");
    }

    function it_processQueue_fully_processes_fifo_before_next_request() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 120e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        bob.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(bob), address(bob));

        Token(asset).mint(address(strategy), 100e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 100e18);

        (uint256 processed, uint256 burnedShares, uint256 reservedAssets) = vault.processQueue(2, INFINITY);

        require(processed == 2, "both queue nodes should be touched");
        require(burnedShares == 180e18, "alice should clear and bob should process partially");
        require(reservedAssets == 180e18, "available idle should reserve across fifo processing");
        require(vault.claimableAssets(address(alice)) == 100e18, "alice should be fully claimable");
        require(vault.claimableAssets(address(bob)) == 80e18, "bob should receive the remaining idle");
        require(vault.activeRequestId(address(alice)) == 0, "alice request should clear");
        require(vault.activeRequestId(address(bob)) != 0, "bob request should remain");
        require(vault.queueHead() == vault.activeRequestId(address(bob)), "bob should now be queue head");
    }

    function it_claim_transfers_reserved_assets() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);

        uint aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "claim(address)", address(alice));
        uint claimed = IERC20(asset).balanceOf(address(alice)) - aliceBefore;

        require(claimed == 20e18, "claim should transfer reserved assets");
        require(vault.claimableAssets(address(alice)) == 0, "claimable should clear");
        require(vault.totalClaimableAssets() == 0, "global claimables should clear");
    }

    function it_allows_new_deposits_while_queue_exists() public {
        User incumbent = new User();
        User newcomer = new User();
        User strategy = new User();

        _mintAndDeposit(incumbent, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        incumbent.do(address(vault), "redeemOrQueue(uint256,address,address)", 100e18, address(incumbent), address(incumbent));

        Token(asset).mint(address(newcomer), 10e18);
        newcomer.do(asset, "approve", address(vault), INFINITY);
        newcomer.do(address(vault), "deposit(uint256,address)", 10e18, address(newcomer));

        require(IERC20(address(vault)).balanceOf(address(newcomer)) == 10e18, "new deposits should still mint active shares");
        require(vault.totalQueuedShares() == 100e18, "queue should remain intact");
        require(vault.totalSupply() == 110e18, "queued and active shares should coexist");
    }

    function it_keeps_queued_unprocessed_shares_in_pricing() public {
        User alice = new User();
        User bob = new User();
        User newcomer = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);

        Token(asset).mint(address(strategy), 200e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 200e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));

        require(vault.totalAssets() == 250e18, "vault should include realized profit");
        require(vault.totalSupply() == 200e18, "queued shares should remain in total supply before processing");
        require(vault.previewDeposit(125e18) == 100e18, "deposit pricing should still include queued unprocessed shares");

        Token(asset).mint(address(newcomer), 125e18);
        newcomer.do(asset, "approve", address(vault), INFINITY);
        newcomer.do(address(vault), "deposit(uint256,address)", 125e18, address(newcomer));

        require(IERC20(address(vault)).balanceOf(address(newcomer)) == 100e18, "new depositor should mint at the ordinary vault rate");
    }

    function it_immediate_withdrawals_are_capped_by_claimable_reservations() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);

        require(vault.maxWithdraw(address(bob)) == 0, "reserved claimable assets should block instant withdrawals");
        require(vault.maxRedeem(address(bob)) == 0, "bob redeem should be fully blocked until more idle arrives");
    }

    function it_open_queue_blocks_instant_exits_and_deployment_after_capital_returns() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));

        Token(asset).mint(address(strategy), 100e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 100e18);

        require(vault.freeIdleForInstantWithdrawals() == 0, "open queue should zero instant idle");
        require(vault.maxWithdraw(address(bob)) == 0, "returned idle should not be available to non-queued users");
        require(vault.maxRedeem(address(bob)) == 0, "returned idle should not enable instant redeem");
        require(vault.maxDeploy() == 0, "returned idle should not be redeployable while queue is open");
        require(vault.freeIdleForQueueProcessing() == 150e18, "returned idle should remain available for queue processing");

        bool reverted = false;
        try bob.do(address(vault), "redeem(uint256,address,address)", 10e18, address(bob), address(bob)) {
        } catch {
            reverted = true;
        }
        require(reverted, "instant redeem should revert while queue is open");
    }

    function it_proxy_single_open_request_keeps_head_and_tail_aligned() public {
        User alice = new User();
        User strategy = new User();

        vault = _deployProxiedVault();
        require(vault.nextRequestId() == 1, "proxied vault should initialize nextRequestId");

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));

        uint64 requestId = vault.activeRequestId(address(alice));
        require(requestId != 0, "request should exist");
        require(vault.queueHead() == requestId, "proxy queue head should match request id");
        require(vault.queueTail() == requestId, "proxy queue tail should match request id");
        require(vault.totalQueuedShares() == 100e18, "proxy queue should retain queued shares");
    }

    function it_proxy_full_process_of_last_request_clears_queue_pointers() public {
        User alice = new User();
        User strategy = new User();

        vault = _deployProxiedVault();
        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));

        Token(asset).mint(address(strategy), 80e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 80e18);

        vault.processQueue(1, INFINITY);

        require(vault.totalQueuedShares() == 0, "queued shares should clear after full processing");
        require(vault.totalClaimableAssets() == 100e18, "processed assets should become claimable");
        require(vault.queueHead() == 0, "queue head should clear after final processed request");
        require(vault.queueTail() == 0, "queue tail should clear after final processed request");

        alice.do(address(vault), "claim(address)", address(alice));

        require(vault.totalClaimableAssets() == 0, "claim should clear reserved assets");
        require(vault.queueHead() == 0, "queue head should stay clear after claim");
        require(vault.queueTail() == 0, "queue tail should stay clear after claim");
    }

    function it_accrues_compounded_funded_rewards_from_checkpointed_assets() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint credited = vault.accrue();

        require(credited > 5e18 && credited < 6e18, "unexpected monthly accrual");
        require(vault.totalAssets() == 100e18 + credited, "accrual should raise assets");
        require(vault.accrualBaseAssets() == vault.activeAssets(), "base should checkpoint active assets");
    }

    function it_preserves_donation_nav_without_retroactively_accruing_on_it() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 100e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        Token(asset).mint(address(alice), 900e18);
        alice.do(asset, "transfer", address(vault), 900e18);

        (uint target, uint funded) = vault.pendingAccrual();
        require(target == funded, "pending reward should be fully funded");
        require(target > 5e18 && target < 6e18, "donation should not inflate elapsed reward");
        require(vault.totalAssets() == 1000e18, "donation should preserve existing NAV behavior");
        require(vault.exchangeRate() == 10e18, "donation should preserve existing share pricing");

        uint credited = vault.accrue();
        require(credited == target, "accrual should match checkpointed target");
        require(vault.totalAssets() == 1000e18 + credited, "donation and reward should remain in vault");
        require(vault.accrualBaseAssets() == vault.activeAssets(), "donation should enter future accrual base");
    }

    function it_excludes_profit_returned_while_paused_from_the_elapsed_interval() public {
        User alice = new User();
        User distributor = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 50e18);

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        vault.pause();
        fastForward(MONTH);

        Token(asset).mint(address(strategy), 5e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 55e18);

        require(vault.totalAssets() == 105e18, "paused profit should increase NAV");
        require(vault.accrualBaseAssets() == 100e18, "paused profit should not alter elapsed base");

        vault.unpause();
        (uint target,) = vault.pendingAccrual();
        require(target > 5e18 && target < 6e18, "elapsed reward should use the pre-profit base");

        uint credited = vault.accrue();
        require(credited == target, "elapsed reward should settle after unpause");
        require(vault.accrualBaseAssets() == 105e18 + credited, "profit should enter the future base");

        fastForward(MONTH);
        (uint futureTarget,) = vault.pendingAccrual();
        require(futureTarget > 6e18 && futureTarget < 7e18, "future reward should include returned profit");
    }

    function it_does_not_charge_the_first_distributor_for_an_earlier_interval() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        vault.initializeAccrual();
        vault.setPerSecondSavingsRate(MAX_RATE);
        fastForward(MONTH);

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        uint beforeBalance = IERC20(asset).balanceOf(address(distributor));
        uint credited = vault.setRewardDistributor(address(distributor));

        require(credited == 0, "first distributor should not fund historical time");
        require(IERC20(asset).balanceOf(address(distributor)) == beforeBalance, "distributor balance changed");
        (uint target, uint funded) = vault.pendingAccrual();
        require(target == 0 && funded == 0, "first distributor should start a new interval");

        fastForward(MONTH);
        credited = vault.accrue();
        require(credited > 5e18 && credited < 6e18, "new distributor should fund future time");
    }

    function it_keeps_reward_distributors_separate_from_strategies() public {
        User alice = new User();
        User account = new User();
        vault.initializeAccrual();
        _approveStrategy(address(account));

        bool reverted = false;
        try vault.setRewardDistributor(address(account)) {
        } catch {
            reverted = true;
        }
        require(reverted, "approved strategy should not become distributor");

        vault.setStrategyApproval(address(account), false);
        vault.setRewardDistributor(address(account));

        reverted = false;
        try vault.setStrategyApproval(address(account), true) {
        } catch {
            reverted = true;
        }
        require(reverted, "distributor should not become approved strategy");

        vault.setRewardDistributor(address(0));
        vault.setStrategyApproval(address(account), true);
        require(vault.approvedStrategies(address(account)), "separate strategy should remain configurable");

        _mintAndDeposit(alice, 100e18);
        vault.deployCapital(address(account), 50e18);
        vault.setStrategyApproval(address(account), false);

        reverted = false;
        try vault.setRewardDistributor(address(account)) {
        } catch {
            reverted = true;
        }
        require(reverted, "strategy debt should block distributor configuration");
    }

    function it_accrues_only_available_funding_without_backlog() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 1e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint credited = vault.accrue();
        require(credited == 1e18, "accrual should cap at available funding");

        Token(asset).mint(address(distributor), 10e18);
        credited = vault.accrue();
        require(credited == 0, "underfunded amount should not become backlog");
        require(vault.totalAssets() == 101e18, "only funded reward should be credited");
    }

    function it_caps_accrual_by_distributor_allowance() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), 1e18);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (uint target, uint funded) = vault.pendingAccrual();
        require(target > 5e18 && target < 6e18, "unexpected target");
        require(funded == 1e18, "pending reward should respect allowance");
        require(vault.accrue() == 1e18, "credited reward should respect allowance");
    }

    function it_settles_the_old_rate_before_a_rate_change() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint credited = vault.setPerSecondSavingsRate(1e27);
        require(credited > 5e18 && credited < 6e18, "old rate should settle");

        fastForward(MONTH);
        require(vault.accrue() == 0, "flat rate should not accrue");
    }

    function it_settles_from_the_old_distributor_before_switching() public {
        User alice = new User();
        User oldDistributor = new User();
        User newDistributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(oldDistributor), 20e18);
        Token(asset).mint(address(newDistributor), 20e18);
        oldDistributor.do(asset, "approve", address(vault), INFINITY);
        newDistributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(oldDistributor, MAX_RATE);

        fastForward(MONTH);
        uint oldBefore = IERC20(asset).balanceOf(address(oldDistributor));
        uint newBefore = IERC20(asset).balanceOf(address(newDistributor));
        uint credited = vault.setRewardDistributor(address(newDistributor));

        require(credited > 5e18 && credited < 6e18, "old distributor should settle");
        require(
            IERC20(asset).balanceOf(address(oldDistributor)) == oldBefore - credited,
            "old distributor should fund elapsed time"
        );
        require(
            IERC20(asset).balanceOf(address(newDistributor)) == newBefore,
            "new distributor should not fund historical time"
        );
    }

    function it_excludes_processed_claims_from_the_accrual_base() public {
        User alice = new User();
        User bob = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        vault.initializeAccrual();
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);

        require(vault.totalClaimableAssets() == 100e18, "claim should be reserved");
        require(vault.accrualBaseAssets() == 100e18, "claim should leave only active assets in base");

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);
        fastForward(MONTH);

        (uint target,) = vault.pendingAccrual();
        require(target > 5e18 && target < 6e18, "fixed claim should not earn rewards");
    }

    function it_accrues_before_pricing_a_new_deposit() public {
        User alice = new User();
        User bob = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (, uint funded) = vault.pendingAccrual();
        require(vault.previewDeposit(100e18) == 100e18, "realized preview behavior should remain unchanged");

        Token(asset).mint(address(bob), 100e18);
        bob.do(asset, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 100e18, address(bob));

        require(
            IERC20(address(vault)).balanceOf(address(bob)) < 100e18,
            "deposit should price after funded accrual"
        );
        require(vault.totalAssets() == 200e18 + funded, "deposit should retain credited reward");
    }

    function it_accrues_before_pricing_an_asset_withdrawal() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint previewedShares = vault.previewWithdraw(10e18);
        require(previewedShares == 10e18, "realized preview behavior should remain unchanged");
        uint sharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        alice.do(address(vault), "withdraw(uint256,address,address)", 10e18, address(alice), address(alice));

        require(
            sharesBefore - IERC20(address(vault)).balanceOf(address(alice)) < previewedShares,
            "withdraw should price after funded accrual"
        );
        require(IERC20(asset).balanceOf(address(alice)) == 10e18, "withdraw should pay requested assets");
    }

    function it_keeps_user_operations_live_when_distributor_calls_fail() public {
        User alice = new User();
        User distributor = new User();
        User strategy = new User();

        FailingAccrualToken failingToken = new FailingAccrualToken();
        vault = new YieldVault(address(this));
        asset = address(failingToken);
        vault.initialize(asset, "ETH Carry Vault", "carryETH");

        failingToken.mint(address(alice), 230e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 200e18, address(alice));

        failingToken.mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        failingToken.setFailures(address(distributor), true, false, false, false);
        fastForward(86400);
        alice.do(address(vault), "deposit(uint256,address)", 10e18, address(alice));

        failingToken.setFailures(address(distributor), false, true, false, false);
        fastForward(86400);
        alice.do(address(vault), "mint(uint256,address)", 10e18, address(alice));

        failingToken.setFailures(address(distributor), false, false, true, false);
        fastForward(86400);
        alice.do(address(vault), "withdraw(uint256,address,address)", 5e18, address(alice), address(alice));

        failingToken.setFailures(address(distributor), false, false, false, true);
        fastForward(86400);
        alice.do(address(vault), "redeem(uint256,address,address)", 5e18, address(alice), address(alice));

        failingToken.setFailures(address(distributor), false, false, true, false);
        fastForward(86400);
        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 5e18, address(alice), address(alice));
        require(vault.activeRequestId(address(alice)) == 0, "liquid redemption should not queue");

        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 200e18);
        fastForward(86400);
        alice.do(address(vault), "redeemOrQueue(uint256,address,address)", 10e18, address(alice), address(alice));
        require(vault.activeRequestId(address(alice)) != 0, "illiquid redemption should queue");

        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 200e18);
        fastForward(86400);
        vault.processQueue(1, INFINITY);
        require(vault.claimableAssets(address(alice)) == 10e18, "queue processing should remain live");
        alice.do(address(vault), "claim(address)", address(alice));

        failingToken.setFailures(address(distributor), false, false, false, false);
        (uint target, uint funded) = vault.pendingAccrual();
        require(target == 0 && funded == 0, "failed intervals should not become backlog");

        fastForward(MONTH);
        uint credited = vault.accrue();
        require(credited > 11e18 && credited < 12e18, "accrual should resume after recovery");
    }

    function it_blocks_reward_configuration_and_transfers_while_paused() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);
        fastForward(MONTH);

        uint distributorBefore = IERC20(asset).balanceOf(address(distributor));
        vault.pause();

        bool reverted = false;
        try vault.accrue() {
        } catch {
            reverted = true;
        }
        require(reverted, "explicit accrual should be paused");

        reverted = false;
        try vault.setPerSecondSavingsRate(1e27) {
        } catch {
            reverted = true;
        }
        require(reverted, "rate update should be paused");

        reverted = false;
        try vault.setRewardDistributor(address(0)) {
        } catch {
            reverted = true;
        }
        require(reverted, "distributor update should be paused");
        require(
            IERC20(asset).balanceOf(address(distributor)) == distributorBefore,
            "pause should prevent reward transfers"
        );

        vault.unpause();
        (uint target, uint funded) = vault.pendingAccrual();
        require(target > 5e18 && target < 6e18, "elapsed interval should remain pending");
        require(funded == target, "pending reward should remain funded");
        require(vault.accrue() == target, "reward should accrue after unpause");
    }
}
