import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/ERC20.sol";
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

contract record FailingTransferToken is ERC20 {
    bool public failTransfers;

    constructor() ERC20("Failing Asset", "FAIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setFailTransfers(bool failTransfers_) external {
        failTransfers = failTransfers_;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (failTransfers) return false;
        return super.transfer(to, value);
    }
}

contract YieldVaultUpgradeHarness is YieldVault {
    constructor(address initialOwner) YieldVault(initialOwner) {}

    function clearAccrualInitializationForTest() external onlyOwner {
        perSecondSavingsRate = 0;
        lastAccrual = 0;
        rewardDistributor = address(0);
        accrualInitialized = false;
        accountedAssets = 0;
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
        vault.setRewardDistributor(address(distributor));
        vault.setPerSecondSavingsRate(rate);
    }

    function _deployProxiedVault() internal returns (YieldVault proxiedVault) {
        address impl = address(new YieldVault(address(this)));
        proxiedVault = YieldVault(address(new Proxy(impl, address(this))));
        proxiedVault.initialize(asset, "ETH Carry Vault", "carryETH");
    }

    function _reconciledActiveAssets() internal view returns (uint256) {
        uint256 recognizedAssets = vault.totalAssets();
        if (vault.accountedAssets() < recognizedAssets) {
            recognizedAssets = vault.accountedAssets();
        }

        uint256 claims = vault.totalClaimableAssets();
        if (recognizedAssets <= claims) return 0;
        return recognizedAssets - claims;
    }

    function _assertReconciledRateNotDecreased(
        uint256 activeAssetsBefore,
        uint256 supplyBefore,
        string reason
    ) internal view {
        uint256 activeAssetsAfter = _reconciledActiveAssets();
        uint256 supplyAfter = vault.totalSupply();
        if (supplyBefore == 0 || supplyAfter == 0) return;

        require(
            activeAssetsAfter * supplyBefore >= activeAssetsBefore * supplyAfter,
            reason
        );
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

    function it_returnCapital_settles_accrual_before_realizing_profit() public {
        User alice = new User();
        User strategy = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 100e18);

        Token(asset).mint(address(distributor), 100e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (, uint fundedBeforeProfit) = vault.pendingAccrual();
        uint distributorBefore = IERC20(asset).balanceOf(address(distributor));

        Token(asset).mint(address(strategy), 900e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 1000e18);

        require(fundedBeforeProfit > 5e18 && fundedBeforeProfit < 6e18, "unexpected pre-profit accrual");
        require(
            distributorBefore - IERC20(asset).balanceOf(address(distributor)) == fundedBeforeProfit,
            "profit should not retroactively increase accrual"
        );
        require(vault.deployedAssets() == 0, "strategy principal should be repaid");
        require(vault.totalAssets() == 1000e18 + fundedBeforeProfit, "profit settlement total mismatch");
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

    function it_reportStrategyLoss_settles_accrual_before_write_down() public {
        User alice = new User();
        User strategy = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 1000e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 1000e18);

        Token(asset).mint(address(distributor), 100e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (, uint fundedBeforeLoss) = vault.pendingAccrual();
        uint distributorBefore = IERC20(asset).balanceOf(address(distributor));
        vault.reportStrategyLoss(address(strategy), 900e18);

        require(fundedBeforeLoss > 58e18 && fundedBeforeLoss < 59e18, "unexpected pre-loss accrual");
        require(
            distributorBefore - IERC20(asset).balanceOf(address(distributor)) == fundedBeforeLoss,
            "loss should not retroactively reduce accrual"
        );
        require(vault.deployedAssets() == 100e18, "strategy loss should reduce deployed assets");
        require(vault.totalAssets() == 100e18 + fundedBeforeLoss, "loss settlement total mismatch");
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

        reverted = false;
        try vault.accrue() {
        } catch {
            reverted = true;
        }
        require(reverted, "accrual should revert when paused");

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
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        require(vault.accountedAssets() == vault.totalAssets(), "deposit accounting mismatch");
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        require(vault.accountedAssets() == vault.totalAssets(), "deploy accounting mismatch");
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);
        require(vault.accountedAssets() == vault.totalAssets(), "queue processing should preserve accounting");

        vault.setRewardDistributor(address(distributor));
        Token(asset).mint(address(alice), 5e18);
        alice.do(asset, "transfer", address(vault), 5e18);
        require(vault.totalAssets() - vault.accountedAssets() == 5e18, "claim stray amount mismatch");

        uint aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "claim(address)", address(alice));
        uint claimed = IERC20(asset).balanceOf(address(alice)) - aliceBefore;

        require(claimed == 20e18, "claim should transfer reserved assets");
        require(IERC20(asset).balanceOf(address(distributor)) == 5e18, "claim should remove stray assets");
        require(vault.claimableAssets(address(alice)) == 0, "claimable should clear");
        require(vault.totalClaimableAssets() == 0, "global claimables should clear");
        require(vault.accountedAssets() == 80e18, "claim accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "claim should restore live alignment");
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

    function it_initializes_funded_accrual_once() public {
        require(vault.accrualInitialized(), "accrual should initialize");
        require(vault.accountedAssets() == 0, "accounted assets should start empty");
        require(vault.perSecondSavingsRate() == 1e27, "initial accrual rate should be flat");
        require(vault.lastAccrual() == block.timestamp, "initial accrual timestamp mismatch");
        require(vault.rewardDistributor() == address(0), "unexpected reward distributor");

        bool reverted = false;
        try vault.initializeAccrual() {
        } catch {
            reverted = true;
        }
        require(reverted, "accrual initialization should be one-time");
    }

    function it_only_allows_owner_to_call_external_accrue() public {
        User caller = new User();
        bool reverted = false;
        try caller.do(address(vault), "accrue()") {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner accrual should revert");
        require(vault.accrue() == 0, "owner accrual should remain callable");
    }

    function it_rejects_vault_as_reward_distributor() public {
        bool reverted = false;
        try vault.setRewardDistributor(address(vault)) {
        } catch {
            reverted = true;
        }

        require(reverted, "vault should not be its own distributor");
        require(vault.rewardDistributor() == address(0), "distributor should remain unset");
    }

    function it_rejects_indebted_strategy_as_reward_distributor() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 50e18);

        bool reverted = false;
        try vault.setRewardDistributor(address(strategy)) {
        } catch {
            reverted = true;
        }

        require(reverted, "indebted strategy should not become distributor");
        require(vault.rewardDistributor() == address(0), "distributor should remain unset");
        require(vault.strategyDebt(address(strategy)) == 50e18, "strategy debt should remain unchanged");
    }

    function it_rejects_deployment_to_reward_distributor() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        vault.setRewardDistributor(address(distributor));
        _approveStrategy(address(distributor));

        bool reverted = false;
        try vault.deployCapital(address(distributor), 50e18) {
        } catch {
            reverted = true;
        }

        require(reverted, "distributor should not receive deployed capital");
        require(vault.strategyDebt(address(distributor)) == 0, "distributor should have no strategy debt");
        require(vault.deployedAssets() == 0, "deployed assets should remain zero");
        require(vault.idleAssets() == 100e18, "idle assets should remain in vault");
    }

    function it_keeps_virtual_and_live_accounting_aligned_without_donations() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();
        User distributor = new User();

        require(vault.accountedAssets() == vault.totalAssets(), "initial accounting mismatch");

        _mintAndDeposit(alice, 100e18);
        require(vault.accountedAssets() == 100e18, "deposit accounting mismatch");
        require(vault.accountedAssets() == vault.idleAssets() + vault.deployedAssets(), "deposit live mismatch");

        Token(asset).mint(address(bob), 50e18);
        bob.do(asset, "approve", address(vault), INFINITY);
        bob.do(address(vault), "mint(uint256,address)", 50e18, address(bob));
        require(vault.accountedAssets() == 150e18, "mint accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "mint live mismatch");

        alice.do(address(vault), "withdraw(uint256,address,address)", 20e18, address(alice), address(alice));
        require(vault.accountedAssets() == 130e18, "withdraw accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "withdraw live mismatch");

        bob.do(address(vault), "redeem(uint256,address,address)", 10e18, address(bob), address(bob));
        require(vault.accountedAssets() == 120e18, "redeem accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "redeem live mismatch");

        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 60e18);
        require(vault.accountedAssets() == 120e18, "deploy should preserve accounting");
        require(vault.idleAssets() == 60e18, "deploy idle mismatch");
        require(vault.deployedAssets() == 60e18, "deploy debt mismatch");
        require(vault.accountedAssets() == vault.idleAssets() + vault.deployedAssets(), "deploy live mismatch");

        Token(asset).mint(address(strategy), 5e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 65e18);
        require(vault.accountedAssets() == 125e18, "profit return accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "profit return live mismatch");

        vault.deployCapital(address(strategy), 50e18);
        vault.reportStrategyLoss(address(strategy), 10e18);
        require(vault.accountedAssets() == 115e18, "loss accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "loss live mismatch");

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);
        fastForward(MONTH);
        uint credited = vault.accrue();

        require(credited > 0, "expected funded accrual");
        require(vault.accountedAssets() == 115e18 + credited, "accrual accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "accrual live mismatch");
    }

    function it_removes_direct_donations_before_deposit_pricing() public {
        User attacker = new User();
        User victim = new User();
        User distributor = new User();

        _mintAndDeposit(attacker, 2);
        vault.setRewardDistributor(address(distributor));
        require(vault.accountedAssets() == 2, "pre-donation accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "pre-donation live mismatch");

        Token(asset).mint(address(attacker), 100e18);
        attacker.do(asset, "transfer", address(vault), 100e18);

        require(vault.totalAssets() == 100e18 + 2, "view should see donation before reconciliation");
        require(vault.accountedAssets() == 2, "donation should not update accounting");
        require(vault.totalAssets() - vault.accountedAssets() == 100e18, "stray amount mismatch");

        Token(asset).mint(address(victim), 100e18);
        victim.do(asset, "approve", address(vault), INFINITY);
        uint previewedShares = vault.previewDeposit(100e18);
        victim.do(address(vault), "deposit(uint256,address)", 100e18, address(victim));

        require(previewedShares == 100e18, "deposit preview should ignore donation");
        require(
            IERC20(address(vault)).balanceOf(address(victim)) == previewedShares,
            "deposit should match reconciled preview"
        );
        require(vault.totalAssets() == 100e18 + 2, "donation should be removed before deposit");
        require(vault.accountedAssets() == 100e18 + 2, "accounted assets should sync after deposit");
        require(vault.accountedAssets() == vault.totalAssets(), "cleanup should restore live alignment");
        require(IERC20(asset).balanceOf(address(distributor)) == 100e18, "distributor should receive removed donation");
    }

    function it_cleans_preexisting_donation_when_initial_distributor_is_configured() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(alice), 25e18);
        alice.do(asset, "transfer", address(vault), 25e18);

        require(vault.accountedAssets() == 100e18, "donation should not update accounting");
        require(vault.totalAssets() == 125e18, "live assets should include donation");

        vault.setRewardDistributor(address(distributor));

        require(vault.rewardDistributor() == address(distributor), "distributor should be configured");
        require(IERC20(asset).balanceOf(address(distributor)) == 25e18, "distributor should receive stray assets");
        require(vault.totalAssets() == 100e18, "cleanup live assets mismatch");
        require(vault.accountedAssets() == 100e18, "cleanup accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "initial setup should restore alignment");
    }

    function it_cleans_donation_before_capital_deployment() public {
        User alice = new User();
        User distributor = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        vault.setRewardDistributor(address(distributor));
        _approveStrategy(address(strategy));

        Token(asset).mint(address(alice), 50e18);
        alice.do(asset, "transfer", address(vault), 50e18);
        require(vault.totalAssets() - vault.accountedAssets() == 50e18, "expected donated excess");

        vault.deployCapital(address(strategy), 40e18);

        require(IERC20(asset).balanceOf(address(distributor)) == 50e18, "distributor should receive donation");
        require(vault.idleAssets() == 60e18, "post-deploy idle mismatch");
        require(vault.deployedAssets() == 40e18, "post-deploy debt mismatch");
        require(vault.accountedAssets() == 100e18, "post-deploy accounting mismatch");
        require(vault.accountedAssets() == vault.totalAssets(), "post-deploy live mismatch");
    }

    function it_prevents_donations_from_inflating_distributor_accrual() public {
        User alice = new User();
        User distributor = new User();
        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 200e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (uint targetBefore, uint fundedBefore) = vault.pendingAccrual();
        require(targetBefore == fundedBefore && fundedBefore > 0, "expected funded pending accrual");

        Token(asset).mint(address(alice), 900e18);
        alice.do(asset, "transfer", address(vault), 900e18);
        (uint targetAfter, uint fundedAfter) = vault.pendingAccrual();

        require(targetAfter == targetBefore, "pending target should ignore donation");
        require(fundedAfter == fundedBefore, "pending funding should ignore donation");

        uint credited = vault.accrue();
        require(credited == fundedBefore, "accrual should use accounted base");
        require(vault.totalAssets() == 100e18 + credited, "donation should be removed before accrual");
        require(vault.accountedAssets() == 100e18 + credited, "accounting should sync after accrual");
        require(vault.accountedAssets() == vault.totalAssets(), "accrual cleanup should restore alignment");
        require(
            IERC20(asset).balanceOf(address(distributor)) == 1100e18 - credited,
            "donation should be returned to distributor"
        );
    }

    function it_accrues_compounded_funded_rewards_into_idle_assets() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 25e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint supplyBefore = vault.totalSupply();
        uint distributorBefore = IERC20(asset).balanceOf(address(distributor));
        uint credited = vault.accrue();

        require(credited > 5e18 && credited < 6e18, "unexpected compounded reward");
        require(vault.idleAssets() == 100e18 + credited, "reward should enter idle assets");
        require(vault.totalAssets() == 100e18 + credited, "reward should raise total assets");
        require(vault.activeAssets() == 100e18 + credited, "reward should raise active assets");
        require(vault.totalSupply() == supplyBefore, "accrual should not mint shares");
        require(vault.deployedAssets() == 0, "accrual should not change deployed assets");
        require(
            distributorBefore - IERC20(asset).balanceOf(address(distributor)) == credited,
            "distributor debit mismatch"
        );
        require(vault.exchangeRate() > WAD, "accrual should raise exchange rate");
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
        require(vault.totalAssets() == 101e18, "only funded reward should be credited");

        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        uint creditedAgain = vault.accrue();
        require(creditedAgain == 0, "unfunded reward should not become backlog");
        require(vault.totalAssets() == 101e18, "late funding should not catch up");
    }

    function it_caps_accrual_by_distributor_allowance() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), 2e18);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint credited = vault.accrue();
        require(credited == 2e18, "accrual should cap at allowance");
        require(vault.totalAssets() == 102e18, "allowance-capped reward mismatch");
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
        require(funded > 0, "expected pending funded reward");
        uint previewedShares = vault.previewDeposit(110e18);

        Token(asset).mint(address(bob), 110e18);
        bob.do(asset, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 110e18, address(bob));

        require(vault.totalAssets() == 210e18 + funded, "deposit should accrue first");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 100e18, "alice shares should not change");
        require(
            IERC20(address(vault)).balanceOf(address(bob)) == previewedShares,
            "deposit should match projected preview"
        );
        require(vault.convertToAssets(100e18) > 100e18, "alice should retain accrued value");
    }

    function it_accrues_before_pricing_a_mint_and_matches_preview() public {
        User alice = new User();
        User bob = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint previewedAssets = vault.previewMint(100e18);
        require(previewedAssets > 100e18, "mint preview should include pending accrual");

        Token(asset).mint(address(bob), previewedAssets);
        bob.do(asset, "approve", address(vault), INFINITY);
        bob.do(address(vault), "mint(uint256,address)", 100e18, address(bob));

        require(IERC20(address(vault)).balanceOf(address(bob)) == 100e18, "minted shares mismatch");
        require(IERC20(asset).balanceOf(address(bob)) == 0, "mint should spend previewed assets");
    }

    function it_accrues_before_withdrawal_pricing() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint previewedShares = vault.previewWithdraw(50e18);
        uint sharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        alice.do(address(vault), "withdraw(uint256,address,address)", 50e18, address(alice), address(alice));
        uint sharesBurned = sharesBefore - IERC20(address(vault)).balanceOf(address(alice));

        require(sharesBurned == previewedShares, "withdraw should match projected preview");
        require(IERC20(asset).balanceOf(address(alice)) == 50e18, "withdraw assets mismatch");
    }

    function it_accrues_before_redeem_pricing() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint previewedAssets = vault.previewRedeem(100e18);
        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));

        require(IERC20(asset).balanceOf(address(alice)) == previewedAssets, "redeem should match projected preview");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 0, "all shares should burn");
    }

    function it_projects_max_exit_on_reconciled_assets_and_pending_accrual() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (, uint funded) = vault.pendingAccrual();
        Token(asset).mint(address(alice), 50e18);
        alice.do(asset, "transfer", address(vault), 50e18);

        uint previewedAssets = vault.previewRedeem(100e18);
        require(previewedAssets == 100e18 + funded, "redeem preview should ignore donation");
        require(vault.maxWithdraw(address(alice)) == previewedAssets, "max withdraw should use projected assets");
        require(vault.maxRedeem(address(alice)) == 100e18, "max redeem should use projected assets");

        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) == previewedAssets, "projected max exit mismatch");
    }

    function it_projects_donation_reconciliation_that_funds_distributor() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        Token(asset).mint(address(alice), 10e18);
        alice.do(asset, "transfer", address(vault), 10e18);

        (, uint funded) = vault.pendingAccrual();
        uint previewedAssets = vault.previewRedeem(100e18);
        require(funded > 5e18 && funded < 6e18, "swept donation should fund pending accrual");
        require(previewedAssets == 100e18 + funded, "preview should simulate donation reconciliation");

        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) == previewedAssets, "reconciled preview mismatch");
    }

    function it_accrues_before_queue_processing_and_keeps_processed_claim_fixed() public {
        User alice = new User();
        User strategy = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        vault.processQueue(1, INFINITY);
        uint fixedClaim = vault.claimableAssets(address(alice));

        require(fixedClaim > 20e18, "funded reward should increase queue liquidity");
        require(vault.totalQueuedShares() > 0, "limited idle should leave queued shares");
        require(vault.deployedAssets() == 80e18, "queue accrual should not change deployed assets");

        fastForward(MONTH);
        vault.accrue();
        require(vault.claimableAssets(address(alice)) == fixedClaim, "processed claim should remain fixed");
    }

    function it_rate_change_settles_old_rate_before_update() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 25e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        (, uint funded) = vault.pendingAccrual();
        uint credited = vault.setPerSecondSavingsRate(1e27);

        require(credited == funded && credited > 0, "old rate should settle before update");
        require(vault.perSecondSavingsRate() == 1e27, "new rate mismatch");

        uint assetsAfterChange = vault.totalAssets();
        fastForward(MONTH);
        require(vault.accrue() == 0, "flat rate should not accrue");
        require(vault.totalAssets() == assetsAfterChange, "flat rate should not change assets");
    }

    function it_distributor_change_settles_from_old_distributor() public {
        User alice = new User();
        User oldDistributor = new User();
        User newDistributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(oldDistributor), 10e18);
        oldDistributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(oldDistributor, MAX_RATE);

        fastForward(MONTH);
        uint oldBalance = IERC20(asset).balanceOf(address(oldDistributor));
        uint credited = vault.setRewardDistributor(address(newDistributor));

        require(credited > 0, "old distributor should settle pending reward");
        require(
            oldBalance - IERC20(asset).balanceOf(address(oldDistributor)) == credited,
            "old distributor debit mismatch"
        );
        require(vault.rewardDistributor() == address(newDistributor), "new distributor mismatch");
    }

    function it_keeps_realized_and_projected_exchange_rates_separate() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(distributor), 10e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);

        fastForward(MONTH);
        uint realizedRate = vault.exchangeRate();
        uint projectedRate = vault.projectedExchangeRate();
        (uint target, uint funded) = vault.pendingAccrual();

        require(realizedRate == WAD, "realized rate should ignore pending accrual");
        require(target == funded && funded > 0, "expected fully funded projection");
        require(projectedRate > realizedRate, "projected rate should include pending accrual");

        vault.accrue();
        require(vault.exchangeRate() == projectedRate, "realized rate should match projection");
    }

    function it_proxy_upgrade_preserves_state_and_initializes_accrual() public {
        address firstImpl = address(new YieldVaultUpgradeHarness(address(this)));
        Proxy proxy = new Proxy(firstImpl, address(this));
        vault = YieldVault(address(proxy));
        vault.initialize(asset, "ETH Carry Vault", "carryETH");

        User alice = new User();
        User strategy = new User();
        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);

        uint64 requestId = vault.activeRequestId(address(alice));
        uint supplyBefore = vault.totalSupply();
        uint queuedBefore = vault.totalQueuedShares();
        uint claimableBefore = vault.totalClaimableAssets();
        YieldVaultUpgradeHarness(address(proxy)).clearAccrualInitializationForTest();
        require(!vault.accrualInitialized(), "legacy proxy should have no accrual state");

        address nextImpl = address(new YieldVault(address(this)));
        proxy.setLogicContract(nextImpl);
        vault.initializeAccrual();

        require(vault.asset() == asset, "asset should survive upgrade");
        require(vault.totalSupply() == supplyBefore, "supply should survive upgrade");
        require(vault.deployedAssets() == 80e18, "deployed assets should survive upgrade");
        require(vault.strategyDebt(address(strategy)) == 80e18, "strategy debt should survive upgrade");
        require(vault.activeRequestId(address(alice)) == requestId, "request id should survive upgrade");
        require(vault.totalQueuedShares() == queuedBefore, "queued shares should survive upgrade");
        require(vault.totalClaimableAssets() == claimableBefore, "claimable assets should survive upgrade");
        require(vault.accrualInitialized(), "accrual migration should initialize");
        require(vault.accountedAssets() == 100e18, "migration should snapshot existing economic assets");
        require(vault.perSecondSavingsRate() == 1e27, "migrated rate should start flat");
        require(vault.lastAccrual() == block.timestamp, "migrated timestamp mismatch");
    }

    function it_reconciled_share_rate_never_decreases_without_loss() public {
        User alice = new User();
        User bob = new User();
        User newcomer = new User();
        User strategy = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        uint256 activeAssetsBefore = _reconciledActiveAssets();
        uint256 supplyBefore = vault.totalSupply();

        _mintAndDeposit(bob, 100e18);
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "deposit reduced reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        Token(asset).mint(address(bob), 50e18);
        bob.do(asset, "approve", address(vault), INFINITY);
        bob.do(address(vault), "mint(uint256,address)", 50e18, address(bob));
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "mint reduced reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "deployment reduced reconciled rate");

        strategy.do(asset, "approve", address(vault), INFINITY);
        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        vault.returnCapital(address(strategy), 100e18);
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "principal return reduced reconciled rate");

        Token(asset).mint(address(strategy), 10e18);
        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        vault.returnCapital(address(strategy), 60e18);
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "profit reduced reconciled rate");

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);
        fastForward(MONTH);

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        require(vault.accrue() > 0, "expected funded accrual");
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "accrual reduced reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        alice.do(address(vault), "withdraw(uint256,address,address)", 20e18, address(alice), address(alice));
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "withdraw reduced reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        bob.do(address(vault), "redeem(uint256,address,address)", 10e18, address(bob), address(bob));
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "redeem reduced reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        Token(asset).mint(address(newcomer), 27e18);
        newcomer.do(asset, "transfer", address(vault), 7e18);
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "donation changed reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        newcomer.do(asset, "approve", address(vault), INFINITY);
        newcomer.do(address(vault), "deposit(uint256,address)", 20e18, address(newcomer));
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "post-donation deposit reduced rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 10e18, address(alice), address(alice));
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "queue request reduced reconciled rate");

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        alice.do0(address(vault), "cancelRequest()");
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "queue cancellation reduced rate");

        uint256 deployable = vault.maxDeploy();
        require(deployable > 10e18, "expected deployable idle");
        vault.deployCapital(address(strategy), deployable - 10e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 20e18, address(alice), address(alice));

        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        uint256 vaultUnderlyingBefore = IERC20(asset).balanceOf(address(vault));
        vault.processQueue(1, 5e18);
        require(
            IERC20(asset).balanceOf(address(vault)) == vaultUnderlyingBefore,
            "queue processing transferred underlying"
        );
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "partial processing reduced rate");

        require(vault.claimableAssets(address(alice)) > 0, "expected partial claim");
        activeAssetsBefore = _reconciledActiveAssets();
        supplyBefore = vault.totalSupply();
        alice.do(address(vault), "claim(address)", address(alice));
        _assertReconciledRateNotDecreased(activeAssetsBefore, supplyBefore, "claim reduced reconciled rate");
    }

    function it_only_authorized_reported_loss_reduces_share_value_exactly() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();
        User attacker = new User();
        User sink = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);
        strategy.do(asset, "transfer", address(sink), 60e18);

        uint256 activeAssetsBefore = _reconciledActiveAssets();
        uint256 supplyBefore = vault.totalSupply();
        uint256 debtBefore = vault.strategyDebt(address(strategy));
        uint256 accountedBefore = vault.accountedAssets();

        bool reverted = false;
        try attacker.do(address(vault), "reportStrategyLoss(address,uint256)", address(strategy), 60e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner loss report should revert");
        require(_reconciledActiveAssets() == activeAssetsBefore, "failed report changed active assets");
        require(vault.totalSupply() == supplyBefore, "failed report changed supply");
        require(vault.strategyDebt(address(strategy)) == debtBefore, "failed report changed debt");
        require(vault.accountedAssets() == accountedBefore, "failed report changed accounting");

        reverted = false;
        try vault.reportStrategyLoss(address(strategy), 0) {
        } catch {
            reverted = true;
        }
        require(reverted, "zero loss should revert");

        reverted = false;
        try vault.reportStrategyLoss(address(strategy), 151e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "excess loss should revert");

        reverted = false;
        try vault.reportStrategyLoss(address(sink), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "unindebted strategy loss should revert");
        require(_reconciledActiveAssets() == activeAssetsBefore, "invalid losses changed active assets");
        require(vault.totalSupply() == supplyBefore, "invalid losses changed supply");

        vault.reportStrategyLoss(address(strategy), 60e18);

        require(vault.strategyDebt(address(strategy)) == 90e18, "strategy debt loss mismatch");
        require(vault.deployedAssets() == 90e18, "deployed loss mismatch");
        require(vault.accountedAssets() == 140e18, "accounted loss mismatch");
        require(_reconciledActiveAssets() == 140e18, "active loss mismatch");
        require(vault.totalSupply() == 200e18, "loss should not burn shares");
        require(vault.previewRedeem(100e18) == 70e18, "loss should reduce each half to 70");
    }

    function it_partial_queue_claim_stays_fixed_while_remainder_bears_loss() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();
        User attacker = new User();
        User sink = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);

        uint256 vaultUnderlyingBefore = IERC20(asset).balanceOf(address(vault));
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        require(
            IERC20(asset).balanceOf(address(vault)) == vaultUnderlyingBefore,
            "request transferred underlying"
        );

        vault.processQueue(1, INFINITY);
        require(
            IERC20(asset).balanceOf(address(vault)) == vaultUnderlyingBefore,
            "processing transferred underlying"
        );
        require(vault.claimableAssets(address(alice)) == 50e18, "first claim portion mismatch");
        require(vault.totalQueuedShares() == 50e18, "queued remainder mismatch");

        strategy.do(asset, "transfer", address(sink), 60e18);
        vault.reportStrategyLoss(address(strategy), 60e18);

        require(vault.claimableAssets(address(alice)) == 50e18, "loss changed fixed claim");
        require(vault.previewRedeem(50e18) == 30e18, "queued remainder did not bear loss");

        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 90e18);
        vault.processQueue(1, INFINITY);

        require(vault.totalQueuedShares() == 0, "queued remainder should clear");
        require(vault.claimableAssets(address(alice)) == 80e18, "total claim should be 80");
        require(vault.previewRedeem(100e18) == 60e18, "bob should retain 60");

        bool reverted = false;
        try attacker.do(address(vault), "claim(address)", address(attacker)) {
        } catch {
            reverted = true;
        }
        require(reverted, "another user should not claim alice assets");
        require(vault.claimableAssets(address(alice)) == 80e18, "failed claim changed alice claim");

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "claim(address)", address(alice));
        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 80e18, "alice claim mismatch");
        require(vault.totalAssets() == 60e18, "remaining assets mismatch");
        require(vault.accountedAssets() == 60e18, "remaining accounting mismatch");
    }

    function it_keeps_claim_reserves_senior_after_queue_closes() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 100e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        uint256 vaultUnderlyingBefore = IERC20(asset).balanceOf(address(vault));
        vault.processQueue(1, INFINITY);

        require(vault.queueHead() == 0, "queue should be closed");
        require(vault.totalQueuedShares() == 0, "queued shares should be zero");
        require(vault.totalClaimableAssets() == 100e18, "claim reserve mismatch");
        require(IERC20(asset).balanceOf(address(vault)) == vaultUnderlyingBefore, "processing moved reserve");
        require(vault.idleAssets() == vault.totalClaimableAssets(), "idle should equal reserved claims");
        require(vault.maxWithdraw(address(bob)) == 0, "deployed active assets should not expose claims");
        require(vault.maxDeploy() == 0, "claim reserve should not be deployable");

        bool reverted = false;
        try vault.deployCapital(address(strategy), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "deployment should not consume claim reserve");

        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 100e18);

        uint256 bobBefore = IERC20(asset).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", 100e18, address(bob), address(bob));
        require(IERC20(asset).balanceOf(address(bob)) - bobBefore == 100e18, "bob active exit mismatch");
        require(vault.idleAssets() == 100e18, "bob exit consumed claim reserve");
        require(vault.totalClaimableAssets() == 100e18, "bob exit changed claim reserve");

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "claim(address)", address(alice));
        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 100e18, "alice reserve claim mismatch");
        require(vault.totalAssets() == 0, "vault should be empty");
        require(vault.accountedAssets() == 0, "accounting should be empty");
    }

    function it_rejects_new_deposits_into_a_fully_impaired_share_supply() public {
        User alice = new User();
        User newcomer = new User();
        User strategy = new User();
        User sink = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 100e18);
        strategy.do(asset, "transfer", address(sink), 100e18);
        vault.reportStrategyLoss(address(strategy), 100e18);

        require(vault.totalSupply() == 100e18, "impaired shares should remain");
        require(_reconciledActiveAssets() == 0, "active assets should be zero");
        require(vault.previewDeposit(1e18) == 0, "insolvent preview should mint zero shares");

        Token(asset).mint(address(newcomer), 1e18);
        newcomer.do(asset, "approve", address(vault), INFINITY);

        bool reverted = false;
        try newcomer.do(address(vault), "deposit(uint256,address)", 1e18, address(newcomer)) {
        } catch {
            reverted = true;
        }
        require(reverted, "deposit into impaired supply should revert");
        require(vault.totalSupply() == 100e18, "failed deposit changed supply");
        require(vault.accountedAssets() == 0, "failed deposit changed accounting");
    }

    function it_enforces_owner_authorization_for_value_management() public {
        User alice = new User();
        User strategy = new User();
        User attacker = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));

        bool reverted = false;
        try attacker.do(address(vault), "deployCapital(address,uint256)", address(strategy), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner deployment should revert");
        require(vault.deployedAssets() == 0, "failed deployment changed debt");

        vault.deployCapital(address(strategy), 80e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        uint256 debtBefore = vault.strategyDebt(address(strategy));
        uint256 accountedBefore = vault.accountedAssets();

        reverted = false;
        try attacker.do(address(vault), "returnCapital(address,uint256)", address(strategy), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner capital return should revert");

        reverted = false;
        try attacker.do(address(vault), "reportStrategyLoss(address,uint256)", address(strategy), 1e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner loss report should revert");

        reverted = false;
        try attacker.do(address(vault), "setMinIdleBps(uint256)", 1000) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner idle update should revert");

        reverted = false;
        try attacker.do(address(vault), "setStrategyApproval(address,bool)", address(attacker), true) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner strategy approval should revert");

        reverted = false;
        try attacker.do(address(vault), "setPerSecondSavingsRate(uint256)", MAX_RATE) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner rate update should revert");

        reverted = false;
        try attacker.do(address(vault), "setRewardDistributor(address)", address(distributor)) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner distributor update should revert");

        require(vault.strategyDebt(address(strategy)) == debtBefore, "failed admin calls changed debt");
        require(vault.accountedAssets() == accountedBefore, "failed admin calls changed accounting");
        require(vault.minIdleBps() == 0, "failed admin call changed idle bps");
        require(!vault.approvedStrategies(address(attacker)), "failed admin call approved attacker");
        require(vault.rewardDistributor() == address(0), "failed admin call changed distributor");

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        reverted = false;
        try attacker.do(address(vault), "processQueue(uint256,uint256)", 1, INFINITY) {
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner queue processing should revert");
        require(vault.totalQueuedShares() == 100e18, "failed processing changed queue");
        require(vault.totalClaimableAssets() == 0, "failed processing created claim");
    }

    function it_enforces_delegated_exit_allowances() public {
        User alice = new User();
        User spender = new User();

        _mintAndDeposit(alice, 100e18);

        bool reverted = false;
        try spender.do(address(vault), "withdraw(uint256,address,address)", 10e18, address(spender), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "unapproved delegated withdraw should revert");

        reverted = false;
        try spender.do(address(vault), "redeem(uint256,address,address)", 10e18, address(spender), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "unapproved delegated redeem should revert");

        reverted = false;
        try spender.do(address(vault), "requestRedeem(uint256,address,address)", 10e18, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "unapproved delegated queue request should revert");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 100e18, "failed delegated calls changed shares");

        alice.do(address(vault), "approve", address(spender), 10e18);
        spender.do(
            address(vault),
            "requestRedeem(uint256,address,address)",
            10e18,
            address(alice),
            address(alice)
        );

        require(vault.totalQueuedShares() == 10e18, "delegated request queue mismatch");
        require(IERC20(address(vault)).allowance(address(alice), address(spender)) == 0, "queue allowance not spent");
        alice.do0(address(vault), "cancelRequest()");

        alice.do(address(vault), "approve", address(spender), 10e18);
        uint256 spenderBefore = IERC20(asset).balanceOf(address(spender));
        spender.do(
            address(vault),
            "redeem(uint256,address,address)",
            10e18,
            address(spender),
            address(alice)
        );

        require(IERC20(asset).balanceOf(address(spender)) - spenderBefore == 10e18, "delegated redeem payout mismatch");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 90e18, "delegated redeem share mismatch");
        require(IERC20(address(vault)).allowance(address(alice), address(spender)) == 0, "redeem allowance not spent");
    }

    function it_conserves_accounting_and_classifies_every_underlying_outflow() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();
        User distributor = new User();
        User receiver = new User();
        User sink = new User();

        uint256 expectedAccounted;
        uint256 vaultBefore;
        uint256 recipientBefore;

        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        vaultBefore = IERC20(asset).balanceOf(address(vault));
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));
        expectedAccounted += IERC20(asset).balanceOf(address(vault)) - vaultBefore;
        require(vault.accountedAssets() == expectedAccounted, "deposit ledger mismatch");

        Token(asset).mint(address(bob), 50e18);
        bob.do(asset, "approve", address(vault), INFINITY);
        vaultBefore = IERC20(asset).balanceOf(address(vault));
        bob.do(address(vault), "mint(uint256,address)", 50e18, address(bob));
        expectedAccounted += IERC20(asset).balanceOf(address(vault)) - vaultBefore;
        require(vault.accountedAssets() == expectedAccounted, "mint ledger mismatch");

        _approveStrategy(address(strategy));
        vaultBefore = IERC20(asset).balanceOf(address(vault));
        recipientBefore = IERC20(asset).balanceOf(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        require(vaultBefore - IERC20(asset).balanceOf(address(vault)) == 80e18, "deployment vault delta mismatch");
        require(
            IERC20(asset).balanceOf(address(strategy)) - recipientBefore == 80e18,
            "deployment strategy delta mismatch"
        );
        require(vault.strategyDebt(address(strategy)) == 80e18, "deployment debt mismatch");
        require(vault.accountedAssets() == expectedAccounted, "deployment changed accounting");

        Token(asset).mint(address(strategy), 10e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vaultBefore = IERC20(asset).balanceOf(address(vault));
        vault.returnCapital(address(strategy), 90e18);
        require(IERC20(asset).balanceOf(address(vault)) - vaultBefore == 90e18, "return vault delta mismatch");
        expectedAccounted += 10e18;
        require(vault.accountedAssets() == expectedAccounted, "profit ledger mismatch");
        require(vault.strategyDebt(address(strategy)) == 0, "principal debt should clear");

        Token(asset).mint(address(distributor), 20e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);
        fastForward(MONTH);

        uint256 supplyBefore = vault.totalSupply();
        vaultBefore = IERC20(asset).balanceOf(address(vault));
        uint256 credited = vault.accrue();
        require(credited > 0, "expected ledger accrual");
        require(IERC20(asset).balanceOf(address(vault)) - vaultBefore == credited, "accrual balance delta mismatch");
        expectedAccounted += credited;
        require(vault.accountedAssets() == expectedAccounted, "accrual ledger mismatch");
        require(vault.totalSupply() == supplyBefore, "accrual changed supply");

        vaultBefore = IERC20(asset).balanceOf(address(vault));
        recipientBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "withdraw(uint256,address,address)", 20e18, address(alice), address(alice));
        require(vaultBefore - IERC20(asset).balanceOf(address(vault)) == 20e18, "withdraw vault delta mismatch");
        require(IERC20(asset).balanceOf(address(alice)) - recipientBefore == 20e18, "withdraw receiver delta mismatch");
        expectedAccounted -= 20e18;
        require(vault.accountedAssets() == expectedAccounted, "withdraw ledger mismatch");

        vaultBefore = IERC20(asset).balanceOf(address(vault));
        bob.do(address(vault), "requestRedeem(uint256,address,address)", 20e18, address(receiver), address(bob));
        require(IERC20(asset).balanceOf(address(vault)) == vaultBefore, "request moved underlying");
        require(vault.accountedAssets() == expectedAccounted, "request changed accounting");

        vault.processQueue(1, INFINITY);
        require(IERC20(asset).balanceOf(address(vault)) == vaultBefore, "processing moved underlying");
        require(vault.accountedAssets() == expectedAccounted, "processing changed accounting");

        uint256 claim = vault.claimableAssets(address(bob));
        require(claim > 0, "expected queue claim");
        recipientBefore = IERC20(asset).balanceOf(address(receiver));
        bob.do(address(vault), "claim(address)", address(receiver));
        require(vaultBefore - IERC20(asset).balanceOf(address(vault)) == claim, "claim vault delta mismatch");
        require(IERC20(asset).balanceOf(address(receiver)) - recipientBefore == claim, "claim receiver delta mismatch");
        expectedAccounted -= claim;
        require(vault.accountedAssets() == expectedAccounted, "claim ledger mismatch");

        Token(asset).mint(address(alice), 5e18);
        alice.do(asset, "transfer", address(vault), 5e18);
        require(vault.accountedAssets() == expectedAccounted, "donation changed accounting");

        vaultBefore = IERC20(asset).balanceOf(address(vault));
        recipientBefore = IERC20(asset).balanceOf(address(distributor));
        vault.accrue();
        require(vaultBefore - IERC20(asset).balanceOf(address(vault)) == 5e18, "stray removal delta mismatch");
        require(
            IERC20(asset).balanceOf(address(distributor)) - recipientBefore == 5e18,
            "stray recipient delta mismatch"
        );
        require(vault.accountedAssets() == expectedAccounted, "stray removal changed accounting");

        vault.deployCapital(address(strategy), 30e18);
        require(vault.accountedAssets() == expectedAccounted, "second deployment changed accounting");
        strategy.do(asset, "transfer", address(sink), 10e18);
        vault.reportStrategyLoss(address(strategy), 10e18);
        expectedAccounted -= 10e18;
        require(vault.accountedAssets() == expectedAccounted, "loss ledger mismatch");
    }

    function it_allows_processed_claim_and_partial_cancellation_while_paused() public {
        User alice = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);

        require(vault.claimableAssets(address(alice)) == 20e18, "partial claim mismatch");
        require(vault.totalQueuedShares() == 80e18, "partial queue mismatch");

        vault.pause();

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "claim(address)", address(alice));
        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 20e18, "paused claim mismatch");

        alice.do0(address(vault), "cancelRequest()");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 80e18, "paused cancel share mismatch");
        require(vault.totalQueuedShares() == 0, "paused cancel queue mismatch");
        require(vault.totalClaimableAssets() == 0, "paused claim should clear reserve");
        require(vault.queueHead() == 0 && vault.queueTail() == 0, "paused unwind should clear queue");
    }

    function it_rejects_non_head_cancellation_without_changing_queue() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 150e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        bob.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(bob), address(bob));

        uint64 aliceRequestId = vault.activeRequestId(address(alice));
        uint64 bobRequestId = vault.activeRequestId(address(bob));
        uint256 underlyingBefore = IERC20(asset).balanceOf(address(vault));
        uint256 escrowedSharesBefore = IERC20(address(vault)).balanceOf(address(vault));

        bool reverted = false;
        try bob.do0(address(vault), "cancelRequest()") {
        } catch {
            reverted = true;
        }

        require(reverted, "non-head cancellation should revert");
        require(vault.queueHead() == aliceRequestId, "failed cancellation changed head");
        require(vault.queueTail() == bobRequestId, "failed cancellation changed tail");
        require(vault.activeRequestId(address(alice)) == aliceRequestId, "failed cancellation changed alice request");
        require(vault.activeRequestId(address(bob)) == bobRequestId, "failed cancellation changed bob request");
        require(vault.totalQueuedShares() == 200e18, "failed cancellation changed queued shares");
        require(IERC20(address(vault)).balanceOf(address(vault)) == escrowedSharesBefore, "failed cancellation changed escrow");
        require(IERC20(asset).balanceOf(address(vault)) == underlyingBefore, "failed cancellation moved underlying");
    }

    function it_excludes_processed_claim_liabilities_from_accrual() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        _mintAndDeposit(bob, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 100e18);

        alice.do(address(vault), "requestRedeem(uint256,address,address)", 100e18, address(alice), address(alice));
        vault.processQueue(1, INFINITY);

        require(vault.queueHead() == 0, "queue should close after full processing");
        require(vault.claimableAssets(address(alice)) == 100e18, "alice claim mismatch");
        require(vault.totalClaimableAssets() == 100e18, "global claim mismatch");
        require(vault.activeAssets() == 100e18, "active accrual base mismatch");
        require(vault.totalSupply() == 100e18, "active supply mismatch");

        Token(asset).mint(address(distributor), 25e18);
        distributor.do(asset, "approve", address(vault), INFINITY);
        _configureFundedAccrual(distributor, MAX_RATE);
        fastForward(MONTH);

        (uint256 target, uint256 funded) = vault.pendingAccrual();
        require(target == funded, "expected fully funded active accrual");
        require(target > 5e18 && target < 6e18, "claim liabilities inflated accrual target");

        uint256 distributorBefore = IERC20(asset).balanceOf(address(distributor));
        uint256 credited = vault.accrue();

        require(credited == target, "credited accrual should match active target");
        require(
            distributorBefore - IERC20(asset).balanceOf(address(distributor)) == credited,
            "distributor debit mismatch"
        );
        require(vault.claimableAssets(address(alice)) == 100e18, "accrual changed fixed claim");
        require(vault.totalClaimableAssets() == 100e18, "accrual changed global claim");
        require(vault.activeAssets() == 100e18 + credited, "credited accrual should benefit only active assets");
        require(vault.previewRedeem(100e18) == 100e18 + credited, "active holder accrual mismatch");
    }

    function it_recognizes_recovered_loss_as_profit_on_later_return() public {
        User alice = new User();
        User strategy = new User();
        User sink = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);

        strategy.do(asset, "transfer", address(sink), 20e18);
        vault.reportStrategyLoss(address(strategy), 20e18);

        require(vault.strategyDebt(address(strategy)) == 60e18, "post-loss debt mismatch");
        require(vault.deployedAssets() == 60e18, "post-loss deployed mismatch");
        require(vault.accountedAssets() == 80e18, "post-loss accounting mismatch");
        require(vault.previewRedeem(100e18) == 80e18, "post-loss redemption mismatch");

        Token(asset).mint(address(strategy), 20e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 80e18);

        require(vault.strategyDebt(address(strategy)) == 0, "recovered debt should clear");
        require(vault.deployedAssets() == 0, "recovered deployed assets should clear");
        require(vault.accountedAssets() == 100e18, "recovered loss should restore accounting");
        require(vault.previewRedeem(100e18) == 100e18, "recovered value mismatch");

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 100e18, "recovered exit mismatch");
    }

    function it_keeps_aggregate_deployed_assets_equal_to_strategy_debts() public {
        User alice = new User();
        User strategyA = new User();
        User strategyB = new User();
        User sink = new User();

        _mintAndDeposit(alice, 300e18);
        _approveStrategy(address(strategyA));
        _approveStrategy(address(strategyB));
        vault.deployCapital(address(strategyA), 120e18);
        vault.deployCapital(address(strategyB), 80e18);

        require(
            vault.deployedAssets() == vault.strategyDebt(address(strategyA)) + vault.strategyDebt(address(strategyB)),
            "initial aggregate debt mismatch"
        );

        Token(asset).mint(address(strategyA), 30e18);
        strategyA.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategyA), 150e18);

        strategyB.do(asset, "transfer", address(sink), 20e18);
        vault.reportStrategyLoss(address(strategyB), 20e18);

        require(vault.strategyDebt(address(strategyA)) == 0, "strategy A debt should clear");
        require(vault.strategyDebt(address(strategyB)) == 60e18, "strategy B debt mismatch");
        require(
            vault.deployedAssets() == vault.strategyDebt(address(strategyA)) + vault.strategyDebt(address(strategyB)),
            "post-outcome aggregate debt mismatch"
        );
        require(vault.accountedAssets() == 310e18, "aggregate outcome accounting mismatch");

        strategyB.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategyB), 60e18);

        require(vault.deployedAssets() == 0, "all deployed assets should clear");
        require(vault.strategyDebt(address(strategyA)) + vault.strategyDebt(address(strategyB)) == 0, "debts should clear");

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 300e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 310e18, "aggregate outcome exit mismatch");
    }

    function it_starts_a_new_lifecycle_at_one_to_one_after_full_exit() public {
        User alice = new User();
        User bob = new User();
        User strategy = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);

        Token(asset).mint(address(strategy), 20e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 100e18);

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));

        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 120e18, "first lifecycle exit mismatch");
        require(vault.totalSupply() == 0, "first lifecycle supply should clear");
        require(vault.totalAssets() == 0, "first lifecycle assets should clear");
        require(vault.accountedAssets() == 0, "first lifecycle accounting should clear");

        _mintAndDeposit(bob, 40e18);

        require(IERC20(address(vault)).balanceOf(address(bob)) == 40e18, "new lifecycle should mint one to one");
        require(vault.totalSupply() == 40e18, "new lifecycle supply mismatch");
        require(vault.accountedAssets() == 40e18, "new lifecycle accounting mismatch");
        require(vault.exchangeRate() == WAD, "new lifecycle rate should be one to one");
    }

    function it_allows_request_owner_to_choose_claim_receiver_at_claim_time() public {
        User alice = new User();
        User strategy = new User();
        User requestedReceiver = new User();
        User claimReceiver = new User();

        _mintAndDeposit(alice, 100e18);
        _approveStrategy(address(strategy));
        vault.deployCapital(address(strategy), 80e18);
        alice.do(
            address(vault),
            "requestRedeem(uint256,address,address)",
            100e18,
            address(requestedReceiver),
            address(alice)
        );
        vault.processQueue(1, INFINITY);

        require(vault.claimableAssets(address(alice)) == 20e18, "claim amount mismatch");
        uint256 requestedReceiverBefore = IERC20(asset).balanceOf(address(requestedReceiver));
        uint256 claimReceiverBefore = IERC20(asset).balanceOf(address(claimReceiver));
        alice.do(address(vault), "claim(address)", address(claimReceiver));

        require(
            IERC20(asset).balanceOf(address(requestedReceiver)) == requestedReceiverBefore,
            "stored receiver should not receive claim automatically"
        );
        require(
            IERC20(asset).balanceOf(address(claimReceiver)) - claimReceiverBefore == 20e18,
            "owner-selected claim receiver mismatch"
        );

        uint256 accountedBefore = vault.accountedAssets();
        bool reverted = false;
        try alice.do(address(vault), "claim(address)", address(claimReceiver)) {
        } catch {
            reverted = true;
        }
        require(reverted, "repeated claim should revert");
        require(vault.accountedAssets() == accountedBefore, "repeated claim changed accounting");
        require(vault.totalClaimableAssets() == 0, "repeated claim changed liabilities");
    }

    function it_recovers_from_a_donation_made_before_distributor_configuration() public {
        User alice = new User();
        User distributor = new User();

        _mintAndDeposit(alice, 100e18);
        Token(asset).mint(address(alice), 5e18);
        alice.do(asset, "transfer", address(vault), 5e18);

        uint256 sharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        uint256 accountedBefore = vault.accountedAssets();
        bool reverted = false;
        try alice.do(address(vault), "withdraw(uint256,address,address)", 10e18, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }

        require(reverted, "withdraw should block until a distributor can receive stray assets");
        require(IERC20(address(vault)).balanceOf(address(alice)) == sharesBefore, "blocked withdraw changed shares");
        require(vault.accountedAssets() == accountedBefore, "blocked withdraw changed accounting");
        require(vault.totalAssets() == 105e18, "blocked withdraw changed live assets");

        vault.setRewardDistributor(address(distributor));

        require(IERC20(asset).balanceOf(address(distributor)) == 5e18, "configured distributor did not receive donation");
        require(vault.totalAssets() == 100e18, "donation recovery assets mismatch");
        require(vault.accountedAssets() == 100e18, "donation recovery accounting mismatch");

        uint256 aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "withdraw(uint256,address,address)", 10e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) - aliceBefore == 10e18, "withdraw did not recover");
    }

    function it_reverts_failed_underlying_payout_atomically() public {
        FailingTransferToken failingAsset = new FailingTransferToken();
        vault = new YieldVault(address(this));
        asset = address(failingAsset);
        vault.initialize(asset, "Failing Asset Vault", "failVault");

        User alice = new User();
        failingAsset.mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        failingAsset.setFailTransfers(true);
        uint256 aliceSharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        uint256 supplyBefore = vault.totalSupply();
        uint256 accountedBefore = vault.accountedAssets();
        uint256 vaultAssetsBefore = IERC20(asset).balanceOf(address(vault));

        bool reverted = false;
        try alice.do(address(vault), "redeem(uint256,address,address)", 10e18, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }

        require(reverted, "failed underlying payout should revert");
        require(IERC20(address(vault)).balanceOf(address(alice)) == aliceSharesBefore, "failed payout burned shares");
        require(vault.totalSupply() == supplyBefore, "failed payout changed supply");
        require(vault.accountedAssets() == accountedBefore, "failed payout changed accounting");
        require(IERC20(asset).balanceOf(address(vault)) == vaultAssetsBefore, "failed payout changed vault assets");
        require(IERC20(asset).balanceOf(address(alice)) == 0, "failed payout credited receiver");

        failingAsset.setFailTransfers(false);
        alice.do(address(vault), "redeem(uint256,address,address)", 10e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) == 10e18, "payout did not recover");
    }
}
