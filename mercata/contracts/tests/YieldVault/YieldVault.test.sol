import "../../concrete/BaseCodeCollection.sol";
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

contract Describe_YieldVault is Authorizable {
    uint public INFINITY = 2 ** 256 - 1;
    uint public WAD = 1e18;

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
    }

    function it_cannot_initialize_twice() public {
        bool reverted = false;
        try vault.initialize(asset, "X", "X") {
        } catch {
            reverted = true;
        }
        require(reverted, "double init should revert");
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
}
