// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../Util.sol";

/**
 * @title LendingPool Initialization Guard Tests
 * @notice Proves that LendingPool.initialize() is one-shot.
 * @dev The guard `require(borrowIndex == 0, "Already initialized")` relies on
 *      borrowIndex being 0 only in the default (pre-init) state. After the first
 *      call it is set to RAY and is only ever grown by `_accrue`, so re-calling
 *      initialize must always revert — even on already-deployed instances that
 *      have no dedicated `initialized` storage slot.
 */
contract Describe_LendingPool_InitGuard is Authorizable {
    using TestUtils for User;

    uint constant RAY = 1e27;
    uint constant APY_5_PERCENT = 1000000001547125956666413085;

    Mercata m;
    LendingPool pool;

    constructor() {
        bypassAuthorizations = true;
    }

    function beforeAll() public {
        m = new Mercata();
        pool = m.lendingPool();
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Proxy path: LendingPool was initialized once by Mercata's constructor.
    // Test contract is the sole admin (via swapAdmin), so onlyOwner calls reach
    // the inner guard via AdminRegistry voting and must revert.
    // ───────────────────────────────────────────────────────────────────────────

    /// @notice Mercata's constructor calls initialize once; verify it took effect.
    function it_initguard_aa_first_init_succeeded() public {
        require(pool.borrowIndex() == RAY, "borrowIndex should be RAY after first init");
        require(address(pool.registry()) != address(0), "registry should be set after first init");
    }

    /// @notice Re-init on an already-initialized proxy pool must revert and
    ///         leave accounting state untouched.
    function it_initguard_ab_proxy_re_init_reverts_and_preserves_state() public {
        uint idxBefore = pool.borrowIndex();
        uint lastBefore = pool.lastAccrual();
        address registryBefore = address(pool.registry());

        bool reverted = false;
        try pool.initialize(
            address(m.lendingRegistry()),
            address(m.poolConfigurator()),
            address(m.tokenFactory()),
            address(m.feeCollector()),
            address(m.safetyModule())
        ) {
            // Should not reach here.
        } catch {
            reverted = true;
        }
        require(reverted, "re-init on initialized pool must revert");

        require(pool.borrowIndex() == idxBefore, "borrowIndex must not change on failed re-init");
        require(pool.lastAccrual() == lastBefore, "lastAccrual must not change on failed re-init");
        require(address(pool.registry()) == registryBefore, "registry must not change on failed re-init");
    }

    /// @notice A malicious registry passed to a re-init attempt must also be
    ///         rejected by the guard (not silently accepted).
    function it_initguard_ac_proxy_re_init_blocked_with_malicious_registry() public {
        address attackerRegistry = address(new LendingRegistry(address(this)));
        address registryBefore = address(pool.registry());

        bool reverted = false;
        try pool.initialize(
            attackerRegistry,
            address(m.poolConfigurator()),
            address(m.tokenFactory()),
            address(m.feeCollector()),
            address(m.safetyModule())
        ) {
            // Should not reach here.
        } catch {
            reverted = true;
        }
        require(reverted, "re-init with malicious registry must revert");
        require(address(pool.registry()) == registryBefore, "registry must not be swapped by failed re-init");
        require(address(pool.registry()) != attackerRegistry, "registry must not equal attacker registry");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Fresh-impl path: test contract is the direct owner, so onlyOwner passes
    // without AdminRegistry voting and the exact revert message is preserved.
    // This also exercises the check on a proxy-style fresh contract where
    // borrowIndex starts at 0 — the happy-path deployment scenario.
    // ───────────────────────────────────────────────────────────────────────────

    /// @notice A brand-new LendingPool accepts its first initialize and rejects
    ///         every subsequent one with the exact guard revert message.
    function it_initguard_ad_fresh_pool_lifecycle() public {
        LendingPool fresh = new LendingPool(address(this));
        require(fresh.borrowIndex() == 0, "fresh pool borrowIndex must be 0");

        fresh.initialize(
            address(m.lendingRegistry()),
            address(m.poolConfigurator()),
            address(m.tokenFactory()),
            address(m.feeCollector()),
            address(m.safetyModule())
        );
        require(fresh.borrowIndex() == RAY, "fresh pool borrowIndex should be RAY after init");

        string memory expectedErr = "Borrow index is not zero; re-initialization not allowed";
        string memory err;
        try fresh.initialize(
            address(m.lendingRegistry()),
            address(m.poolConfigurator()),
            address(m.tokenFactory()),
            address(m.feeCollector()),
            address(m.safetyModule())
        ) {
            require(false, "second initialize on fresh pool must revert");
        } catch Error(string memory e) {
            err = e;
        }
        require(err == expectedErr, "Wrong revert message. Got: " + err);
        require(fresh.borrowIndex() == RAY, "borrowIndex must not reset on failed re-init");
    }

    // ───────────────────────────────────────────────────────────────────────────
    // Accrual path: after real interest accrues, borrowIndex > RAY. The guard
    // (borrowIndex == 0) must still block — this validates the chosen sentinel
    // across the full post-init lifecycle, not just the immediate post-init state.
    // ───────────────────────────────────────────────────────────────────────────

    function it_initguard_ae_re_init_blocked_after_accrual() public {
        PoolConfigurator configurator = m.poolConfigurator();
        PriceOracle oracle = m.priceOracle();
        CollateralVault cv = m.collateralVault();

        address USDST = m.tokenFactory().createToken("USDSTi", "USDSTi", [], [], [], "USDSTi", 0, 18);
        address mUSDST = m.tokenFactory().createToken("mUSDSTi", "mUSDSTi", [], [], [], "mUSDSTi", 0, 18);
        address GOLDST = m.tokenFactory().createToken("GOLDSTi", "GOLDSTi", [], [], [], "GOLDSTi", 0, 18);
        Token(USDST).setStatus(2);
        Token(mUSDST).setStatus(2);
        Token(GOLDST).setStatus(2);

        m.adminRegistry().addWhitelist(mUSDST, "mint", address(m.liquidityPool()));
        m.adminRegistry().addWhitelist(mUSDST, "burn", address(m.liquidityPool()));

        configurator.setBorrowableAsset(USDST);
        configurator.setMToken(mUSDST);
        configurator.setDebtCeilings(10000000e18, 10000000e18);
        configurator.configureAsset(USDST, 0, 0, 11000, 500, 1000, APY_5_PERCENT);
        configurator.configureAsset(GOLDST, 7500, 8000, 10500, 0, 0, RAY);

        oracle.setAssetPrice(USDST, 1e18);
        oracle.setAssetPrice(GOLDST, 100e18);

        // Advance time so _accrue has a non-zero dt to compound over.
        fastForward(365 * 24 * 60 * 60); // 1 year

        Token(USDST).mint(address(this), 1000e18);
        IERC20(USDST).approve(address(m.liquidityPool()), 2 ** 256 - 1);
        pool.depositLiquidity(1000e18); // first _accrue with dt > 0 → borrowIndex grows

        uint idxAfter = pool.borrowIndex();
        require(idxAfter > RAY, "borrowIndex should be > RAY after accrual. Got: " + string(idxAfter));

        // Guard must still block re-init now that borrowIndex is strictly > RAY.
        bool reverted = false;
        try pool.initialize(
            address(m.lendingRegistry()),
            address(m.poolConfigurator()),
            address(m.tokenFactory()),
            address(m.feeCollector()),
            address(m.safetyModule())
        ) {
            // Should not reach here.
        } catch {
            reverted = true;
        }
        require(reverted, "re-init must revert even when borrowIndex > RAY");
        require(pool.borrowIndex() == idxAfter, "borrowIndex must not be reset by failed re-init");
    }
}
