import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC4626/ERC4626.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/YieldVault/YieldVault.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
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

    // ============ Initialization & Admin ============

    function it_initializes_correctly() public {
        require(vault.asset() == asset, "asset mismatch");
        require(vault.vaultInitialized(), "not initialized");
        require(vault.totalAssets() == 0, "totalAssets should be 0");
        require(vault.totalSupply() == 0, "totalSupply should be 0");
        require(vault.deployedAssets() == 0, "deployedAssets should be 0");
        require(vault.exchangeRate() == WAD, "empty vault rate should be 1e18");
    }

    function it_cannot_initialize_twice() public {
        bool reverted = false;
        try vault.initialize(asset, "X", "X") {
        } catch {
            reverted = true;
        }
        require(reverted, "double init should revert");
    }

    function it_pause_blocks_deposits_and_withdrawals() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);

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

        vault.unpause();

        alice.do(address(vault), "deposit(uint256,address)", 10e18, address(alice));
        require(IERC20(address(vault)).balanceOf(address(alice)) == 10e18, "deposit should work after unpause");
    }

    // ============ totalAssets = idle + deployedAssets ============

    function it_totalAssets_equals_idle_plus_deployed() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        require(vault.totalAssets() == 100e18, "totalAssets should equal deposit");
        require(vault.deployedAssets() == 0, "nothing deployed yet");

        // Deploy 60 to a strategy address
        address strategy = address(new User());
        Token(asset).mint(strategy, 0);
        vault.deployCapital(strategy, 60e18);

        uint idle = IERC20(asset).balanceOf(address(vault));
        require(idle == 40e18, "idle should be 40");
        require(vault.deployedAssets() == 60e18, "deployedAssets should be 60");
        require(vault.totalAssets() == 100e18, "totalAssets should still be 100 (idle + deployed)");
    }

    // ============ deployCapital ============

    function it_deployCapital_transfers_assets_out() public {
        User alice = new User();
        Token(asset).mint(address(alice), 200e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 200e18, address(alice));

        address strategy = address(new User());
        vault.deployCapital(strategy, 80e18);

        require(IERC20(asset).balanceOf(strategy) == 80e18, "strategy should receive assets");
        require(IERC20(asset).balanceOf(address(vault)) == 120e18, "vault idle should decrease");
        require(vault.deployedAssets() == 80e18, "deployedAssets tracking");
    }

    function it_deployCapital_reverts_on_insufficient_idle() public {
        User alice = new User();
        Token(asset).mint(address(alice), 50e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 50e18, address(alice));

        bool reverted = false;
        try vault.deployCapital(address(0x1), 51e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when deploying more than idle");
    }

    function it_deployCapital_reverts_zero() public {
        User alice = new User();
        Token(asset).mint(address(alice), 50e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 50e18, address(alice));

        bool reverted = false;
        try vault.deployCapital(address(0x1), 0) {
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero deploy");
    }

    // ============ returnCapital ============

    function it_returnCapital_brings_assets_back() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        User strategy = new User();
        vault.deployCapital(address(strategy), 60e18);

        // Strategy approves vault to pull back
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 60e18);

        require(vault.deployedAssets() == 0, "deployedAssets should be 0 after full return");
        require(IERC20(asset).balanceOf(address(vault)) == 100e18, "vault should have all assets back");
        require(vault.totalAssets() == 100e18, "totalAssets unchanged");
    }

    function it_returnCapital_reverts_exceeding_deployed() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        vault.deployCapital(address(0x1), 50e18);

        bool reverted = false;
        try vault.returnCapital(address(0x1), 51e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "returning more than deployed should revert");
    }

    // ============ reportStrategyGain ============

    function it_reportStrategyGain_increases_totalAssets_and_exchange_rate() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        vault.deployCapital(address(0x1), 80e18);
        require(vault.totalAssets() == 100e18, "pre-gain totalAssets");

        vault.reportStrategyGain(20e18);

        require(vault.deployedAssets() == 100e18, "deployedAssets should be 80 + 20 gain");
        require(vault.totalAssets() == 120e18, "totalAssets should be idle(20) + deployed(100) = 120");

        uint rate = vault.exchangeRate();
        // 120e18 assets / 100e18 shares * 1e18 = 1.2e18
        require(rate > WAD, "exchange rate should rise after gain");
        require(rate == (120e18 * WAD) / 100e18, "rate should be exactly 1.2e18");
    }

    function it_reportStrategyGain_reverts_zero() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        bool reverted = false;
        try vault.reportStrategyGain(0) {
        } catch {
            reverted = true;
        }
        require(reverted, "zero gain should revert");
    }

    // ============ reportStrategyLoss ============

    function it_reportStrategyLoss_decreases_totalAssets_and_exchange_rate() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        vault.deployCapital(address(0x1), 80e18);
        vault.reportStrategyLoss(30e18);

        require(vault.deployedAssets() == 50e18, "deployedAssets should be 80 - 30");
        require(vault.totalAssets() == 70e18, "totalAssets should be idle(20) + deployed(50) = 70");

        uint rate = vault.exchangeRate();
        require(rate < WAD, "exchange rate should fall after loss");
        require(rate == (70e18 * WAD) / 100e18, "rate should be exactly 0.7e18");
    }

    function it_reportStrategyLoss_reverts_exceeding_deployed() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        vault.deployCapital(address(0x1), 50e18);

        bool reverted = false;
        try vault.reportStrategyLoss(51e18) {
        } catch {
            reverted = true;
        }
        require(reverted, "loss exceeding deployed should revert");
    }

    // ============ maxWithdraw / maxRedeem capped at idle ============

    function it_maxWithdraw_capped_at_idle_balance() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Before deployment: alice can withdraw all
        require(vault.maxWithdraw(address(alice)) == 100e18, "pre-deploy: full withdraw");
        require(vault.maxRedeem(address(alice)) == 100e18, "pre-deploy: full redeem");

        // Deploy 70, leaving 30 idle
        vault.deployCapital(address(0x1), 70e18);

        uint maxW = vault.maxWithdraw(address(alice));
        uint maxR = vault.maxRedeem(address(alice));

        require(maxW == 30e18, "maxWithdraw should be capped at idle (30)");
        require(maxR <= 30e18, "maxRedeem should be capped at idle shares equivalent");
    }

    function it_withdraw_reverts_when_exceeding_idle() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        vault.deployCapital(address(0x1), 70e18);

        bool reverted = false;
        try alice.do(address(vault), "withdraw(uint256,address,address)", 31e18, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "withdrawing more than idle should revert");
    }

    // ============ Gain → new depositor gets fewer shares (fairness) ============

    function it_gain_dilutes_new_depositors_correctly() public {
        User alice = new User();
        User bob = new User();

        // Alice deposits 100 at 1:1
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Deploy and report gain
        vault.deployCapital(address(0x1), 80e18);
        vault.reportStrategyGain(20e18);
        // totalAssets = 20 idle + 100 deployed = 120, supply = 100 shares, rate ~1.2

        uint previewShares = vault.previewDeposit(120e18);

        // Bob deposits 120 assets at ~1.2 rate
        Token(asset).mint(address(bob), 120e18);
        bob.do(asset, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 120e18, address(bob));

        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));
        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));

        require(aliceShares == 100e18, "alice should still have 100 shares");
        require(bobShares == previewShares, "deposit must match previewDeposit");
        require(bobShares == 100e18, "bob gets exactly 100e18 shares at 1.2 rate");
        require(vault.totalAssets() == 240e18, "totalAssets = 240");
        require(vault.totalSupply() == 200e18, "totalSupply = 200");
    }

    // ============ Loss → existing depositors bear the loss ============

    function it_loss_socializes_among_existing_holders() public {
        User alice = new User();
        User bob = new User();

        // Alice and Bob each deposit 100
        Token(asset).mint(address(alice), 100e18);
        Token(asset).mint(address(bob), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        bob.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));
        bob.do(address(vault), "deposit(uint256,address)", 100e18, address(bob));

        // Deploy and report loss
        vault.deployCapital(address(0x1), 150e18);
        vault.reportStrategyLoss(50e18);
        // totalAssets = 50 idle + 100 deployed = 150, supply = 200, rate = 0.75

        uint rate = vault.exchangeRate();
        require(rate == (150e18 * WAD) / 200e18, "rate should be 0.75e18");

        // Alice redeems all — should get 75 (her 100 shares at 0.75 rate)
        uint alicePreview = vault.previewRedeem(100e18);
        require(alicePreview == 75e18, "alice should preview 75 for 100 shares");
    }

    // ============ Full deploy-gain-return-withdraw cycle ============

    function it_full_capital_management_cycle() public {
        User alice = new User();
        User strategy = new User();

        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Step 1: Deploy 80 to strategy
        vault.deployCapital(address(strategy), 80e18);
        require(IERC20(asset).balanceOf(address(strategy)) == 80e18, "strategy got 80");

        // Step 2: Strategy earns profit — report gain of 20
        vault.reportStrategyGain(20e18);
        require(vault.totalAssets() == 120e18, "totalAssets after gain");

        // Step 3: Return all capital (80 original + need to also return the 20 gain to make it withdrawable)
        // The gain is virtual in deployedAssets. Strategy has 80 actual tokens.
        // Return the 80 that was actually sent
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 80e18);
        // deployedAssets = 100 (gain) - 80 (returned) = 20 still deployed virtually

        require(vault.deployedAssets() == 20e18, "20 virtual deployed remains after returning 80");
        require(IERC20(asset).balanceOf(address(vault)) == 100e18, "vault has 100 idle");
        require(vault.totalAssets() == 120e18, "totalAssets still 120 (100 idle + 20 virtual)");

        // Step 4: To realize the gain, mint the profit tokens and return them
        Token(asset).mint(address(strategy), 20e18);
        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 20e18);

        require(vault.deployedAssets() == 0, "all capital returned");
        require(IERC20(asset).balanceOf(address(vault)) == 120e18, "vault has 120 idle");

        // Step 5: Alice redeems all — gets ~120 (100 shares at 1.2 rate, virtual offset may cause ±1 wei)
        uint previewAssets = vault.previewRedeem(100e18);
        uint aliceBefore = IERC20(asset).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));
        uint aliceGot = IERC20(asset).balanceOf(address(alice)) - aliceBefore;

        require(aliceGot == previewAssets, "redemption matches preview");
        require(aliceGot >= 120e18 - 1 && aliceGot <= 120e18, "alice gets ~120 (within 1 wei of virtual offset)");
        require(aliceGot > 100e18, "alice profits from the 20 gain");
        require(vault.totalSupply() == 0, "no shares remaining");
    }

    // ============ Partial withdrawal while capital is deployed ============

    function it_partial_withdraw_respects_idle_cap() public {
        User alice = new User();

        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        vault.deployCapital(address(0x1), 60e18);
        // idle = 40, deployed = 60

        // Alice can withdraw up to 40 (idle)
        uint maxW = vault.maxWithdraw(address(alice));
        require(maxW == 40e18, "max withdraw = idle");

        alice.do(address(vault), "withdraw(uint256,address,address)", 30e18, address(alice), address(alice));
        require(IERC20(asset).balanceOf(address(alice)) == 30e18, "alice got 30");

        // idle now 10, deployed still 60
        require(IERC20(asset).balanceOf(address(vault)) == 10e18, "vault idle = 10");
        require(vault.deployedAssets() == 60e18, "deployed unchanged");
        require(vault.totalAssets() == 70e18, "totalAssets = 10 + 60 = 70");
    }

    // ============ Deploy/return doesn't change exchange rate ============

    function it_deploy_and_return_preserve_exchange_rate() public {
        User alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        uint rateBefore = vault.exchangeRate();

        User strategy = new User();
        vault.deployCapital(address(strategy), 70e18);

        uint rateAfterDeploy = vault.exchangeRate();
        require(rateAfterDeploy == rateBefore, "deploy should not change exchange rate");

        strategy.do(asset, "approve", address(vault), INFINITY);
        vault.returnCapital(address(strategy), 70e18);

        uint rateAfterReturn = vault.exchangeRate();
        require(rateAfterReturn == rateBefore, "return should not change exchange rate");
    }

    // ============ Multiple gains and losses ============

    function it_sequential_gains_and_losses_track_correctly() public {
        User alice = new User();
        Token(asset).mint(address(alice), 200e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 200e18, address(alice));

        vault.deployCapital(address(0x1), 150e18);
        // idle=50, deployed=150, total=200, rate=1.0

        vault.reportStrategyGain(50e18);
        // deployed=200, total=250, rate=1.25
        require(vault.totalAssets() == 250e18, "after gain: total=250");
        require(vault.exchangeRate() == (250e18 * WAD) / 200e18, "rate=1.25");

        vault.reportStrategyLoss(100e18);
        // deployed=100, total=150, rate=0.75
        require(vault.totalAssets() == 150e18, "after loss: total=150");
        require(vault.exchangeRate() == (150e18 * WAD) / 200e18, "rate=0.75");

        vault.reportStrategyGain(50e18);
        // deployed=150, total=200, rate=1.0
        require(vault.totalAssets() == 200e18, "after second gain: total=200");
        require(vault.exchangeRate() == WAD, "rate back to 1.0");
    }

    // ============ Call-chain correctness: all entry points at non-1:1 rates ============
    // These tests verify that deposit/mint/withdraw/redeem use the correct
    // (overridden) totalAssets when the vault has deployedAssets > 0.

    function _setupGainState() internal returns (User alice) {
        alice = new User();
        Token(asset).mint(address(alice), 100e18);
        alice.do(asset, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));
        vault.deployCapital(address(0x1), 80e18);
        vault.reportStrategyGain(20e18);
        // State: idle=20, deployed=100, totalAssets=120, supply=100, rate=1.2
    }

    function it_deposit_matches_preview_at_non_1to1_rate() public {
        _setupGainState();
        User bob = new User();
        Token(asset).mint(address(bob), 60e18);
        bob.do(asset, "approve", address(vault), INFINITY);

        uint preview = vault.previewDeposit(60e18);
        bob.do(address(vault), "deposit(uint256,address)", 60e18, address(bob));
        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));

        require(bobShares == preview, "deposit: shares must match preview");
        require(bobShares == 50e18, "deposit: 60 assets at 1.2 rate = 50 shares");
    }

    function it_mint_matches_preview_at_non_1to1_rate() public {
        _setupGainState();
        User bob = new User();
        Token(asset).mint(address(bob), 200e18);
        bob.do(asset, "approve", address(vault), INFINITY);

        uint previewAssets = vault.previewMint(50e18);
        uint bobAssetsBefore = IERC20(asset).balanceOf(address(bob));
        bob.do(address(vault), "mint(uint256,address)", 50e18, address(bob));
        uint bobAssetsAfter = IERC20(asset).balanceOf(address(bob));
        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));

        uint assetsPaid = bobAssetsBefore - bobAssetsAfter;
        require(bobShares == 50e18, "mint: got exactly 50 shares");
        require(assetsPaid == previewAssets, "mint: assets paid must match preview");
        // At 1.2 rate, 50 shares costs 60 assets (rounded up)
        require(assetsPaid >= 60e18 && assetsPaid <= 60e18 + 1, "mint: ~60 assets for 50 shares");
    }

    function it_withdraw_matches_preview_at_non_1to1_rate() public {
        User alice = _setupGainState();
        // Alice has 100 shares at 1.2 rate. idle=20, so maxWithdraw capped at 20
        uint previewShares = vault.previewWithdraw(12e18);
        uint aliceSharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        uint aliceAssetsBefore = IERC20(asset).balanceOf(address(alice));

        alice.do(address(vault), "withdraw(uint256,address,address)", 12e18, address(alice), address(alice));

        uint aliceSharesAfter = IERC20(address(vault)).balanceOf(address(alice));
        uint aliceAssetsAfter = IERC20(asset).balanceOf(address(alice));
        uint sharesBurned = aliceSharesBefore - aliceSharesAfter;
        uint assetsReceived = aliceAssetsAfter - aliceAssetsBefore;

        require(assetsReceived == 12e18, "withdraw: received exactly 12 assets");
        require(sharesBurned == previewShares, "withdraw: shares burned must match preview");
        // At 1.2 rate, 12 assets costs 10 shares (rounded up)
        require(sharesBurned >= 10e18 && sharesBurned <= 10e18 + 1, "withdraw: ~10 shares for 12 assets");
    }

    function it_redeem_matches_preview_at_non_1to1_rate() public {
        User alice = _setupGainState();
        // Alice redeems 10 shares at 1.2 rate
        uint previewAssets = vault.previewRedeem(10e18);
        uint aliceAssetsBefore = IERC20(asset).balanceOf(address(alice));

        alice.do(address(vault), "redeem(uint256,address,address)", 10e18, address(alice), address(alice));

        uint aliceAssetsAfter = IERC20(asset).balanceOf(address(alice));
        uint assetsReceived = aliceAssetsAfter - aliceAssetsBefore;
        uint aliceSharesAfter = IERC20(address(vault)).balanceOf(address(alice));

        require(assetsReceived == previewAssets, "redeem: assets must match preview");
        // At 1.2 rate, 10 shares ≈ 12 assets (virtual offset rounds down by up to 1 wei)
        require(assetsReceived >= 12e18 - 1 && assetsReceived <= 12e18, "redeem: ~12 assets for 10 shares");
        require(aliceSharesAfter == 90e18, "redeem: 100 - 10 = 90 shares remaining");
    }

    function it_all_previews_use_correct_totalAssets() public {
        _setupGainState();
        // With totalAssets=120, supply=100: rate=1.2
        // If the base totalAssets (idle=20) were used instead, these would all be wrong

        uint depositShares = vault.previewDeposit(120e18);
        require(depositShares == 100e18, "previewDeposit: 120/1.2 = 100 shares");

        uint mintAssets = vault.previewMint(100e18);
        // roundUp: 100 * (120+1) / (100+1) = 12010000.../101... rounds up to 120e18 + 1 or 120e18
        require(mintAssets >= 120e18 && mintAssets <= 120e18 + 1, "previewMint: 100 shares ~= 120 assets");

        uint withdrawShares = vault.previewWithdraw(12e18);
        // roundUp: 12 * (100+1) / (120+1) = ~10 shares
        require(withdrawShares >= 10e18 && withdrawShares <= 10e18 + 1, "previewWithdraw: 12 assets ~= 10 shares");

        uint redeemAssets = vault.previewRedeem(10e18);
        // roundDown: 10 * (120+1) / (100+1) ≈ 12e18 (virtual offset rounds down by up to 1 wei)
        require(redeemAssets >= 12e18 - 1 && redeemAssets <= 12e18, "previewRedeem: ~12 assets for 10 shares");
    }

    // ============ Property: deposit-redeem round-trip at 1:1 with no yield ============

    function property_deposit_redeem_round_trip_no_yield(uint seed) public {
        uint amount = (seed % 1000000 + 1) * 1e12;

        YieldVault v = new YieldVault(address(this));
        address tkn = m.tokenFactory().createToken("P", "Prop", [], [], [], "P", 0, 18);
        Token(tkn).setStatus(2);
        v.initialize(tkn, "PV", "PV");

        User u = new User();
        Token(tkn).mint(address(u), amount);
        u.do(tkn, "approve", address(v), INFINITY);
        u.do(address(v), "deposit(uint256,address)", amount, address(u));

        uint shares = IERC20(address(v)).balanceOf(address(u));
        u.do(address(v), "redeem(uint256,address,address)", shares, address(u), address(u));
        uint got = IERC20(tkn).balanceOf(address(u));

        require(got >= amount - 1 && got <= amount, "round trip conserves within 1 wei");
        require(v.totalSupply() == 0, "no shares left");
    }

    // ============ Property: gain never lost — depositor always gets at least gain share ============

    function property_gain_flows_to_depositor(uint seed) public {
        uint depositAmt = ((seed % 500000) + 1) * 1e12;
        uint gain = ((seed % 100000) + 1) * 1e12;

        YieldVault v = new YieldVault(address(this));
        address tkn = m.tokenFactory().createToken("PG", "PropG", [], [], [], "PG", 0, 18);
        Token(tkn).setStatus(2);
        v.initialize(tkn, "PV", "PV");

        User u = new User();
        Token(tkn).mint(address(u), depositAmt);
        u.do(tkn, "approve", address(v), INFINITY);
        u.do(address(v), "deposit(uint256,address)", depositAmt, address(u));

        v.deployCapital(address(0x1), depositAmt);
        v.reportStrategyGain(gain);

        // Return all + gain (mint to simulate strategy profit)
        Token(tkn).mint(address(u), depositAmt + gain);
        u.do(tkn, "approve", address(v), INFINITY);
        v.returnCapital(address(u), depositAmt + gain);

        uint shares = IERC20(address(v)).balanceOf(address(u));
        u.do(address(v), "redeem(uint256,address,address)", shares, address(u), address(u));
        uint finalBal = IERC20(tkn).balanceOf(address(u));

        require(finalBal >= depositAmt + gain - 1, "depositor should capture deposit + gain");
    }
}
