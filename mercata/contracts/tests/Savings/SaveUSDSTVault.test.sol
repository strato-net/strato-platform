import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Savings/SaveUSDSTVault.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

contract Describe_SaveUSDSTVault is Authorizable {
    uint public INFINITY = 2 ** 256 - 1;

    Mercata m;
    SaveUSDSTVault vault;
    address USDST;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
        vault = new SaveUSDSTVault(address(this));

        USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        Token(USDST).setStatus(2);

        vault.initialize(USDST, "Save USDST", "saveUSDST");
    }

    function it_initializes_as_an_exchange_rate_vault() public {
        require(vault.asset() == USDST, "asset not set");
        require(vault.totalSupply() == 0, "unexpected initial supply");
        require(vault.totalAssets() == 0, "unexpected initial assets");
        require(vault.previewDeposit(1e18) == 1e18, "initial deposit should be 1:1");
        require(vault.previewMint(1e18) == 1e18, "initial mint should be 1:1");
    }

    function it_cannot_be_initialized_twice() public {
        bool reverted = false;
        try vault.initialize(USDST, "Save USDST 2", "saveUSDST2") {
        } catch {
            reverted = true;
        }
        require(reverted, "second initialize should revert");
    }

    function it_prevents_donation_attacks_from_changing_total_assets() public {
        User attacker = new User();
        User victim = new User();

        Token(USDST).mint(address(attacker), 10000e18 + 1);
        attacker.do(USDST, "approve", address(vault), INFINITY);
        attacker.do(address(vault), "deposit(uint256,address)", 1, address(attacker));

        uint attackerShares = IERC20(address(vault)).balanceOf(address(attacker));
        require(attackerShares == 1, "attacker share mismatch");

        attacker.do(USDST, "transfer", address(vault), 10000e18);
        require(vault.totalAssets() == 1, "donation should not change managed assets");
        require(vault.totalSupply() == 1, "supply should remain unchanged");

        Token(USDST).mint(address(victim), 1000e18);
        victim.do(USDST, "approve", address(vault), INFINITY);
        victim.do(address(vault), "deposit(uint256,address)", 1000e18, address(victim));

        uint victimShares = IERC20(address(vault)).balanceOf(address(victim));
        require(victimShares == 1000e18, "victim should receive fair shares");
        require(vault.totalAssets() == 1000e18 + 1, "managed assets incorrect");
    }

    function it_increases_exchange_rate_when_rewards_are_notified() public {
        User saver = new User();

        Token(USDST).mint(address(saver), 100e18);
        saver.do(USDST, "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", 100e18, address(saver));

        require(vault.convertToAssets(100e18) == 100e18, "initial assets mismatch");

        Token(USDST).mint(address(this), 20e18);
        Token(USDST).approve(address(vault), 20e18);
        vault.notifyReward(20e18);

        require(vault.totalAssets() == 120e18, "reward should raise assets");
        require(vault.convertToAssets(100e18) == 120e18, "share value should increase");
        require(vault.previewDeposit(10e18) < 10e18, "post-reward deposits should mint fewer shares");
    }

    function it_reverts_reward_notification_when_no_shares_exist() public {
        Token(USDST).mint(address(this), 20e18);
        Token(USDST).approve(address(vault), 20e18);

        bool reverted = false;
        try vault.notifyReward(20e18) {
        } catch {
            reverted = true;
        }

        require(reverted, "notifyReward should revert when no shares exist");
        require(vault.totalAssets() == 0, "managed assets should remain zero");
    }

    function it_allows_withdrawal_of_principal_plus_rewards() public {
        User saver = new User();

        Token(USDST).mint(address(saver), 50e18);
        saver.do(USDST, "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", 50e18, address(saver));

        Token(USDST).mint(address(this), 10e18);
        Token(USDST).approve(address(vault), 10e18);
        vault.notifyReward(10e18);

        uint saverBalanceBefore = IERC20(USDST).balanceOf(address(saver));
        saver.do(address(vault), "redeem(uint256,address,address)", 50e18, address(saver), address(saver));
        uint saverBalanceAfter = IERC20(USDST).balanceOf(address(saver));

        require(saverBalanceAfter == saverBalanceBefore + 60e18, "redeem should return principal plus rewards");
        require(vault.totalSupply() == 0, "all shares should be burned");
        require(vault.totalAssets() == 0, "managed assets should be empty");
    }

    function it_reverts_reward_notification_after_vault_has_been_fully_redeemed() public {
        User saver = new User();

        Token(USDST).mint(address(saver), 50e18);
        saver.do(USDST, "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", 50e18, address(saver));
        saver.do(address(vault), "redeem(uint256,address,address)", 50e18, address(saver), address(saver));

        Token(USDST).mint(address(this), 10e18);
        Token(USDST).approve(address(vault), 10e18);

        bool reverted = false;
        try vault.notifyReward(10e18) {
        } catch {
            reverted = true;
        }

        require(reverted, "notifyReward should revert after full redeem");
        require(vault.totalSupply() == 0, "supply should remain zero");
        require(vault.totalAssets() == 0, "managed assets should remain zero");
    }

    function it_distributes_rewards_proportionally_to_multiple_users() public {
        User alice = new User();
        User bob = new User();

        Token(USDST).mint(address(alice), 100e18);
        alice.do(USDST, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        Token(USDST).mint(address(bob), 100e18);
        bob.do(USDST, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 100e18, address(bob));

        Token(USDST).mint(address(this), 20e18);
        Token(USDST).approve(address(vault), 20e18);
        vault.notifyReward(20e18);

        // 220 managed, 200 shares. Each user has 100 shares = 110 USDST.
        uint aliceBefore = IERC20(USDST).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));
        uint aliceGot = IERC20(USDST).balanceOf(address(alice)) - aliceBefore;
        require(aliceGot == 110e18, "alice should get 110");

        uint bobBefore = IERC20(USDST).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", 100e18, address(bob), address(bob));
        uint bobGot = IERC20(USDST).balanceOf(address(bob)) - bobBefore;
        require(bobGot == 110e18, "bob should get 110");

        require(vault.totalSupply() == 0, "all shares burned");
        require(vault.totalAssets() == 0, "vault fully drained");
    }

    function it_prices_deposits_correctly_after_reward() public {
        User alice = new User();
        User bob = new User();

        // Alice deposits 100 at 1:1, gets 100 shares
        Token(USDST).mint(address(alice), 100e18);
        alice.do(USDST, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Reward of 100 doubles the rate to 2:1
        Token(USDST).mint(address(this), 100e18);
        Token(USDST).approve(address(vault), 100e18);
        vault.notifyReward(100e18);

        // Bob deposits 100 at 2:1, gets 50 shares
        Token(USDST).mint(address(bob), 100e18);
        bob.do(USDST, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 100e18, address(bob));

        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));
        require(bobShares == 50e18, "bob should get 50 shares at 2:1 rate");

        // Another reward of 30. Total managed = 330, total shares = 150.
        Token(USDST).mint(address(this), 30e18);
        Token(USDST).approve(address(vault), 30e18);
        vault.notifyReward(30e18);

        // Alice: 100/150 * 330 = 220. Bob: 50/150 * 330 = 110.
        uint aliceBefore = IERC20(USDST).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 100e18, address(alice), address(alice));
        uint aliceGot = IERC20(USDST).balanceOf(address(alice)) - aliceBefore;
        require(aliceGot == 220e18, "alice should get 220");

        uint bobBefore = IERC20(USDST).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", 50e18, address(bob), address(bob));
        uint bobGot = IERC20(USDST).balanceOf(address(bob)) - bobBefore;
        require(bobGot == 110e18, "bob should get 110");

        require(vault.totalAssets() == 0, "vault empty");
    }

    function it_lets_last_user_drain_vault_cleanly() public {
        User alice = new User();
        User bob = new User();
        User charlie = new User();

        Token(USDST).mint(address(alice), 50e18);
        alice.do(USDST, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 50e18, address(alice));

        Token(USDST).mint(address(bob), 30e18);
        bob.do(USDST, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 30e18, address(bob));

        Token(USDST).mint(address(charlie), 20e18);
        charlie.do(USDST, "approve", address(vault), INFINITY);
        charlie.do(address(vault), "deposit(uint256,address)", 20e18, address(charlie));

        Token(USDST).mint(address(this), 10e18);
        Token(USDST).approve(address(vault), 10e18);
        vault.notifyReward(10e18);

        // Alice and bob withdraw. Charlie is last.
        alice.do(address(vault), "redeem(uint256,address,address)", 50e18, address(alice), address(alice));
        bob.do(address(vault), "redeem(uint256,address,address)", 30e18, address(bob), address(bob));

        uint charlieShares = IERC20(address(vault)).balanceOf(address(charlie));
        uint charlieBefore = IERC20(USDST).balanceOf(address(charlie));
        charlie.do(address(vault), "redeem(uint256,address,address)", charlieShares, address(charlie), address(charlie));
        uint charlieGot = IERC20(USDST).balanceOf(address(charlie)) - charlieBefore;

        require(charlieGot > 0, "charlie should get something");
        require(vault.totalSupply() == 0, "all shares burned");
        require(vault.totalAssets() == 0, "vault fully drained");
    }

    function it_reverts_deposit_of_1_wei_when_rate_is_above_1() public {
        User alice = new User();

        Token(USDST).mint(address(alice), 100e18);
        alice.do(USDST, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        Token(USDST).mint(address(this), 100e18);
        Token(USDST).approve(address(vault), 100e18);
        vault.notifyReward(100e18);

        // Rate is now 2:1. Depositing 1 wei should yield 0 shares and revert.
        User dust = new User();
        Token(USDST).mint(address(dust), 1);
        dust.do(USDST, "approve", address(vault), INFINITY);

        bool reverted = false;
        try dust.do(address(vault), "deposit(uint256,address)", 1, address(dust)) {
        } catch {
            reverted = true;
        }
        require(reverted, "1 wei deposit should revert at 2:1 rate");
    }

    function it_recovers_stray_assets_without_affecting_accounting() public {
        User saver = new User();

        Token(USDST).mint(address(saver), 100e18);
        saver.do(USDST, "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", 100e18, address(saver));

        // Donate 500 USDST directly
        Token(USDST).mint(address(this), 500e18);
        Token(USDST).transfer(address(vault), 500e18);

        require(vault.totalAssets() == 100e18, "managed assets unchanged by donation");

        uint recoveryBefore = IERC20(USDST).balanceOf(address(this));
        vault.recoverStrayAssets(address(this));
        uint recovered = IERC20(USDST).balanceOf(address(this)) - recoveryBefore;
        require(recovered == 500e18, "should recover exactly 500");
        require(vault.totalAssets() == 100e18, "managed assets still unchanged");

        // Saver can still redeem normally
        uint saverBefore = IERC20(USDST).balanceOf(address(saver));
        saver.do(address(vault), "redeem(uint256,address,address)", 100e18, address(saver), address(saver));
        uint saverGot = IERC20(USDST).balanceOf(address(saver)) - saverBefore;
        require(saverGot == 100e18, "saver gets full principal after recovery");
    }

    function it_caps_max_withdraw_by_live_balance_when_balance_drops_below_managed_assets() public {
        User saver = new User();

        Token(USDST).mint(address(saver), 100e18);
        saver.do(USDST, "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", 100e18, address(saver));

        // Simulate unexpected live-balance loss while internal accounting stays unchanged.
        Token(USDST).burn(address(vault), 40e18);

        require(vault.totalAssets() == 100e18, "managed assets unchanged");
        require(IERC20(USDST).balanceOf(address(vault)) == 60e18, "live balance reduced");
        require(vault.maxWithdraw(address(saver)) == 60e18, "maxWithdraw should cap to live balance");
    }

    function it_socializes_live_balance_loss_pro_rata_across_redeemers() public {
        User alice = new User();
        User bob = new User();

        Token(USDST).mint(address(alice), 50e18);
        alice.do(USDST, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 50e18, address(alice));

        Token(USDST).mint(address(bob), 50e18);
        bob.do(USDST, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 50e18, address(bob));

        Token(USDST).burn(address(vault), 40e18);

        require(vault.totalAssets() == 100e18, "managed assets unchanged after loss");
        require(IERC20(USDST).balanceOf(address(vault)) == 60e18, "live balance should reflect loss");
        require(vault.exchangeRate() == 6e17, "exchange rate should use redeemable assets");
        require(vault.previewRedeem(50e18) == 30e18, "half the shares should redeem half the live balance");
        require(vault.previewWithdraw(30e18) == 50e18, "withdrawing redeemable assets should burn a fair share amount");
        require(vault.maxWithdraw(address(alice)) == 30e18, "single user should only withdraw their pro-rata share");
        require(vault.maxRedeem(address(alice)) == 50e18, "full share redemption should remain available");

        uint aliceBefore = IERC20(USDST).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 50e18, address(alice), address(alice));
        uint aliceGot = IERC20(USDST).balanceOf(address(alice)) - aliceBefore;
        require(aliceGot == 30e18, "alice should absorb her pro-rata loss");

        uint bobBefore = IERC20(USDST).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", 50e18, address(bob), address(bob));
        uint bobGot = IERC20(USDST).balanceOf(address(bob)) - bobBefore;
        require(bobGot == 30e18, "bob should absorb the same pro-rata loss");

        require(vault.totalSupply() == 0, "all shares should be burned");
        require(vault.totalAssets() == 0, "managed assets should reset when the vault is emptied");
        require(IERC20(USDST).balanceOf(address(vault)) == 0, "live balance should be empty after final redeem");
    }

    function it_blocks_new_deposits_when_existing_shares_are_fully_insolvent() public {
        User incumbent = new User();
        User newcomer = new User();

        Token(USDST).mint(address(incumbent), 100e18);
        incumbent.do(USDST, "approve", address(vault), INFINITY);
        incumbent.do(address(vault), "deposit(uint256,address)", 100e18, address(incumbent));

        Token(USDST).burn(address(vault), 100e18);

        Token(USDST).mint(address(newcomer), 10e18);
        newcomer.do(USDST, "approve", address(vault), INFINITY);

        bool reverted = false;
        try newcomer.do(address(vault), "deposit(uint256,address)", 10e18, address(newcomer)) {
        } catch {
            reverted = true;
        }

        require(reverted, "deposit should revert when outstanding shares have no redeemable assets");
        require(vault.totalSupply() == 100e18, "existing shares should remain outstanding");
        require(vault.totalAssets() == 100e18, "managed accounting should remain unchanged");
        require(IERC20(USDST).balanceOf(address(vault)) == 0, "live balance should remain zero");
    }

    function it_blocks_underlying_rescue() public {
        bool reverted = false;
        try vault.rescueToken(USDST, address(this), 1) {
        } catch {
            reverted = true;
        }
        require(reverted, "underlying rescue should revert");
    }

    function it_blocks_operations_when_paused() public {
        User saver = new User();
        Token(USDST).mint(address(saver), 100e18);
        saver.do(USDST, "approve", address(vault), INFINITY);
        saver.do(address(vault), "deposit(uint256,address)", 100e18, address(saver));

        vault.pause();

        require(vault.maxDeposit(address(saver)) == 0, "maxDeposit should be 0 when paused");
        require(vault.maxMint(address(saver)) == 0, "maxMint should be 0 when paused");
        require(vault.maxWithdraw(address(saver)) == 0, "maxWithdraw should be 0 when paused");
        require(vault.maxRedeem(address(saver)) == 0, "maxRedeem should be 0 when paused");

        bool reverted = false;
        try saver.do(address(vault), "deposit(uint256,address)", 100e18, address(saver)) {
        } catch {
            reverted = true;
        }
        require(reverted, "deposit should revert when paused");

        reverted = false;
        try saver.do(address(vault), "redeem(uint256,address,address)", 100e18, address(saver), address(saver)) {
        } catch {
            reverted = true;
        }
        require(reverted, "redeem should revert when paused");

        vault.unpause();
        saver.do(address(vault), "redeem(uint256,address,address)", 100e18, address(saver), address(saver));
        require(IERC20(address(vault)).balanceOf(address(saver)) == 0, "redeem works after unpause");
    }

    function it_supports_allowance_based_redeem() public {
        User owner = new User();
        User spender = new User();

        Token(USDST).mint(address(owner), 100e18);
        owner.do(USDST, "approve", address(vault), INFINITY);
        owner.do(address(vault), "deposit(uint256,address)", 100e18, address(owner));

        // Owner approves spender to spend vault shares
        owner.do(address(vault), "approve", address(spender), 100e18);

        // Spender redeems on behalf of owner, receives the USDST
        uint spenderBefore = IERC20(USDST).balanceOf(address(spender));
        spender.do(address(vault), "redeem(uint256,address,address)", 100e18, address(spender), address(owner));
        uint spenderGot = IERC20(USDST).balanceOf(address(spender)) - spenderBefore;

        require(spenderGot == 100e18, "spender should receive the USDST");
        require(IERC20(address(vault)).balanceOf(address(owner)) == 0, "owner shares burned");
        require(vault.totalSupply() == 0, "all shares burned");
    }

    /// @notice For any deposit amount, deposit then full redeem returns the original amount (within 1 wei rounding).
    function property_deposit_redeem_round_trip_conserves_value(uint seed) public {
        uint amount = (seed % 1000000) + 1;
        amount = amount * 1e12;

        User u = new User();
        Token(USDST).mint(address(u), amount);
        u.do(USDST, "approve", address(vault), INFINITY);
        u.do(address(vault), "deposit(uint256,address)", amount, address(u));

        uint shares = IERC20(address(vault)).balanceOf(address(u));
        require(shares > 0, "should have shares");

        uint balBefore = IERC20(USDST).balanceOf(address(u));
        u.do(address(vault), "redeem(uint256,address,address)", shares, address(u), address(u));
        uint got = IERC20(USDST).balanceOf(address(u)) - balBefore;

        require(got >= amount - 1 && got <= amount, "round trip should conserve value within 1 wei");
        require(vault.totalSupply() == 0, "no shares left");
        require(vault.totalAssets() == 0, "no assets left");
    }

    /// @notice Two users deposit random amounts, a random reward arrives. Total redeemed == total deposited + reward (within rounding).
    function property_rewards_conserve_total_value(uint seedA, uint seedB, uint seedR) public {
        uint amountA = ((seedA % 500000) + 1) * 1e12;
        uint amountB = ((seedB % 500000) + 1) * 1e12;
        uint reward  = ((seedR % 100000) + 1) * 1e12;

        User alice = new User();
        User bob = new User();

        Token(USDST).mint(address(alice), amountA);
        alice.do(USDST, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", amountA, address(alice));

        Token(USDST).mint(address(bob), amountB);
        bob.do(USDST, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", amountB, address(bob));

        Token(USDST).mint(address(this), reward);
        Token(USDST).approve(address(vault), reward);
        vault.notifyReward(reward);

        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));
        uint aliceBefore = IERC20(USDST).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", aliceShares, address(alice), address(alice));
        uint aliceGot = IERC20(USDST).balanceOf(address(alice)) - aliceBefore;

        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));
        uint bobBefore = IERC20(USDST).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", bobShares, address(bob), address(bob));
        uint bobGot = IERC20(USDST).balanceOf(address(bob)) - bobBefore;

        uint totalIn = amountA + amountB + reward;
        uint totalOut = aliceGot + bobGot;

        require(totalOut >= totalIn - 2 && totalOut <= totalIn, "total value must be conserved within 2 wei rounding");
        require(vault.totalSupply() == 0, "no shares left");
        require(vault.totalAssets() <= 2, "vault should be empty within rounding");
    }

    /// @notice Exchange rate must never decrease after a deposit or reward.
    function property_exchange_rate_never_decreases(uint seedDeposit, uint seedReward, uint seedDeposit2) public {
        uint dep1 = ((seedDeposit % 500000) + 1) * 1e12;
        uint rew  = ((seedReward % 200000) + 1) * 1e12;
        uint dep2 = ((seedDeposit2 % 500000) + 1) * 1e12;

        User u1 = new User();
        User u2 = new User();

        Token(USDST).mint(address(u1), dep1);
        u1.do(USDST, "approve", address(vault), INFINITY);
        u1.do(address(vault), "deposit(uint256,address)", dep1, address(u1));
        uint rate1 = vault.exchangeRate();

        Token(USDST).mint(address(this), rew);
        Token(USDST).approve(address(vault), rew);
        vault.notifyReward(rew);
        uint rate2 = vault.exchangeRate();
        require(rate2 >= rate1, "rate must not decrease after reward");

        Token(USDST).mint(address(u2), dep2);
        u2.do(USDST, "approve", address(vault), INFINITY);
        u2.do(address(vault), "deposit(uint256,address)", dep2, address(u2));
        uint rate3 = vault.exchangeRate();
        require(rate3 >= rate2 - 1, "rate must not decrease after deposit (within 1 wei rounding)");
    }

    /// @notice maxWithdraw should never exceed both live balance and the owner's economic claim.
    function property_max_withdraw_is_bounded(uint seedDeposit, uint seedReward, uint seedBurn) public {
        uint dep = ((seedDeposit % 500000) + 1) * 1e12;
        uint rew = ((seedReward % 200000) + 1) * 1e12;

        User u = new User();
        Token(USDST).mint(address(u), dep);
        u.do(USDST, "approve", address(vault), INFINITY);
        u.do(address(vault), "deposit(uint256,address)", dep, address(u));

        Token(USDST).mint(address(this), rew);
        Token(USDST).approve(address(vault), rew);
        vault.notifyReward(rew);

        uint liveBalanceBeforeBurn = IERC20(USDST).balanceOf(address(vault));
        uint burnAmt = seedBurn % (liveBalanceBeforeBurn + 1);
        if (burnAmt > 0) {
            Token(USDST).burn(address(vault), burnAmt);
        }

        uint maxW = vault.maxWithdraw(address(u));
        uint liveBalance = IERC20(USDST).balanceOf(address(vault));
        uint claim = vault.convertToAssets(IERC20(address(vault)).balanceOf(address(u)));

        require(maxW <= liveBalance, "maxWithdraw exceeds live balance");
        require(maxW <= claim, "maxWithdraw exceeds economic claim");
    }
}
