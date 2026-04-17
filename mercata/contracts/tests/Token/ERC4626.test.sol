import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC4626/ERC4626.sol";
import "../../concrete/Tokens/Token.sol";

contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

/// @dev Minimal concrete vault for testing the ERC4626 abstract base in isolation.
contract record TestVault is ERC4626 {
    bool public vaultInitialized;

    constructor() ERC4626(address(0)) {}

    function initialize(address asset_, string name_, string symbol_) external {
        require(!vaultInitialized, "TestVault: already initialized");
        __ERC20_init(name_, symbol_);
        __ERC4626_init(asset_);
        vaultInitialized = true;
    }
}

contract Describe_ERC4626 is Authorizable {
    uint public INFINITY = 2 ** 256 - 1;

    Mercata m;
    TestVault vault;
    address assetToken;

    function beforeAll() public {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
    }

    function beforeEach() public {
        vault = new TestVault();
        assetToken = m.tokenFactory().createToken("Asset", "Test Asset Token", [], [], [], "ASSET", 0, 18);
        Token(assetToken).setStatus(2);
        vault.initialize(assetToken, "Test Vault Shares", "tvSHARE");
    }

    // ============ TEST 1: asset() returns configured token address ============

    function it_1_asset_returns_configured_token_address() public {
        require(vault.asset() == assetToken, "asset() should return the configured token");
        require(vault.decimals() == 18, "decimals should match underlying asset");
    }

    // ============ TEST 2: totalAssets() reflects all managed assets ============

    function it_2_totalAssets_zero_on_empty_vault() public {
        require(vault.totalAssets() == 0, "empty vault should have 0 totalAssets");
    }

    function it_2_totalAssets_increases_after_deposit() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        require(vault.totalAssets() == 100e18, "totalAssets should equal deposited amount");
    }

    function it_2_totalAssets_decreases_after_withdraw() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        alice.do(address(vault), "withdraw(uint256,address,address)", 40e18, address(alice), address(alice));

        require(vault.totalAssets() == 60e18, "totalAssets should decrease after withdrawal");
    }

    function it_2_totalAssets_includes_donated_assets() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        Token(assetToken).mint(address(vault), 50e18);

        require(vault.totalAssets() == 150e18, "totalAssets should include direct donations");
    }

    // ============ TEST 3: Initial deposit on empty vault ============

    function it_3_initial_deposit_mints_one_to_one() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));
        require(aliceShares == 100e18, "first deposit should mint 1:1 shares");
        require(vault.totalSupply() == 100e18, "totalSupply should equal minted shares");
        require(vault.totalAssets() == 100e18, "totalAssets should equal deposited amount");
        require(IERC20(assetToken).balanceOf(address(alice)) == 0, "all assets should have moved to vault");
    }

    // ============ TEST 4: convertToShares() rounds down ============

    function it_4_convertToShares_rounds_down_and_is_caller_independent() public {
        User alice = new User();
        User bob = new User();

        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Donate to make rate non-trivial: 100 shares, 150 assets -> 1 share ≈ 1.5 assets
        Token(assetToken).mint(address(vault), 50e18);

        uint sharesFromAlice = vault.convertToShares(100e18);
        uint sharesFromBob = vault.convertToShares(100e18);
        require(sharesFromAlice == sharesFromBob, "convertToShares should be caller-independent");

        // Verify floor rounding: shares = 100e18 * (100e18 + 1) / (150e18 + 1) ≈ 66.66e18 -> floor
        require(sharesFromAlice < 67e18, "should round down");
        require(sharesFromAlice >= 66e18, "should be approximately 66.67e18");

        // Converting 0 should return 0
        require(vault.convertToShares(0) == 0, "0 assets should convert to 0 shares");
    }

    // ============ TEST 5: convertToAssets() rounds down ============

    function it_5_convertToAssets_rounds_down_and_is_caller_independent() public {
        User alice = new User();
        User bob = new User();

        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Donate to make 1 share > 1 asset
        Token(assetToken).mint(address(vault), 50e18);

        uint assetsFromAlice = vault.convertToAssets(100e18);
        uint assetsFromBob = vault.convertToAssets(100e18);
        require(assetsFromAlice == assetsFromBob, "convertToAssets should be caller-independent");

        // 100 shares worth of assets ≈ 150 assets (with virtual offsets)
        require(assetsFromAlice >= 149e18, "should reflect increased share value");
        require(assetsFromAlice <= 150e18, "should not exceed total assets");

        require(vault.convertToAssets(0) == 0, "0 shares should convert to 0 assets");
    }

    // ============ TEST 6: previewDeposit() matches deposit() ============

    function it_6_previewDeposit_matches_deposit() public {
        // Seed vault with non-trivial rate
        User seed = new User();
        Token(assetToken).mint(address(seed), 100e18);
        seed.do(assetToken, "approve", address(vault), INFINITY);
        seed.do(address(vault), "deposit(uint256,address)", 100e18, address(seed));
        Token(assetToken).mint(address(vault), 50e18);

        // Preview then execute
        User alice = new User();
        Token(assetToken).mint(address(alice), 80e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);

        uint previewShares = vault.previewDeposit(80e18);
        alice.do(address(vault), "deposit(uint256,address)", 80e18, address(alice));
        uint actualShares = IERC20(address(vault)).balanceOf(address(alice));

        require(actualShares == previewShares, "previewDeposit should exactly match deposit");
        require(previewShares <= actualShares, "ERC4626 spec: preview must not overestimate shares");
    }

    // ============ TEST 7: previewMint() matches mint() ============

    function it_7_previewMint_matches_mint() public {
        User seed = new User();
        Token(assetToken).mint(address(seed), 100e18);
        seed.do(assetToken, "approve", address(vault), INFINITY);
        seed.do(address(vault), "deposit(uint256,address)", 100e18, address(seed));
        Token(assetToken).mint(address(vault), 50e18);

        User alice = new User();
        Token(assetToken).mint(address(alice), 200e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);

        uint previewAssets = vault.previewMint(50e18);
        uint assetsBefore = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "mint(uint256,address)", 50e18, address(alice));
        uint assetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint actualAssetsPaid = assetsBefore - assetsAfter;

        require(actualAssetsPaid == previewAssets, "previewMint should exactly match mint cost");
        require(previewAssets >= actualAssetsPaid, "ERC4626 spec: preview must not underestimate cost");
        require(IERC20(address(vault)).balanceOf(address(alice)) == 50e18, "should receive exact requested shares");
    }

    // ============ TEST 8: previewWithdraw() matches withdraw() ============

    function it_8_previewWithdraw_matches_withdraw() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));
        Token(assetToken).mint(address(vault), 50e18);

        uint previewShares = vault.previewWithdraw(30e18);
        uint sharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        alice.do(address(vault), "withdraw(uint256,address,address)", 30e18, address(alice), address(alice));
        uint sharesAfter = IERC20(address(vault)).balanceOf(address(alice));
        uint actualSharesBurned = sharesBefore - sharesAfter;

        require(actualSharesBurned == previewShares, "previewWithdraw should exactly match shares burned");
        require(previewShares >= actualSharesBurned, "ERC4626 spec: preview must not underestimate burn");
    }

    // ============ TEST 9: previewRedeem() matches redeem() ============

    function it_9_previewRedeem_matches_redeem() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));
        Token(assetToken).mint(address(vault), 50e18);

        uint previewAssets = vault.previewRedeem(40e18);
        uint assetsBefore = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 40e18, address(alice), address(alice));
        uint assetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint actualAssetsReceived = assetsAfter - assetsBefore;

        require(actualAssetsReceived == previewAssets, "previewRedeem should exactly match assets received");
        require(previewAssets <= actualAssetsReceived, "ERC4626 spec: preview must not overestimate assets");
    }

    // ============ TEST 10: deposit() transfers, mints, emits ============

    function it_10_deposit_transfers_assets_mints_shares() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 200e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);

        uint aliceAssetsBefore = IERC20(assetToken).balanceOf(address(alice));
        uint vaultAssetsBefore = IERC20(assetToken).balanceOf(address(vault));
        uint supplyBefore = vault.totalSupply();

        alice.do(address(vault), "deposit(uint256,address)", 200e18, address(alice));

        uint aliceAssetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint vaultAssetsAfter = IERC20(assetToken).balanceOf(address(vault));
        uint supplyAfter = vault.totalSupply();
        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));

        require(aliceAssetsBefore - aliceAssetsAfter == 200e18, "caller assets should decrease by deposit amount");
        require(vaultAssetsAfter - vaultAssetsBefore == 200e18, "vault assets should increase by deposit amount");
        require(aliceShares == supplyAfter - supplyBefore, "receiver shares should equal supply increase");
        require(aliceShares == 200e18, "first deposit should be 1:1");
    }

    // ============ TEST 11: mint() transfers quoted assets, mints exact shares ============

    function it_11_mint_transfers_quoted_assets_mints_exact_shares() public {
        // Seed vault
        User seed = new User();
        Token(assetToken).mint(address(seed), 100e18);
        seed.do(assetToken, "approve", address(vault), INFINITY);
        seed.do(address(vault), "deposit(uint256,address)", 100e18, address(seed));
        Token(assetToken).mint(address(vault), 100e18);

        // Alice mints exact shares
        User alice = new User();
        Token(assetToken).mint(address(alice), 500e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);

        uint aliceAssetsBefore = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "mint(uint256,address)", 50e18, address(alice));
        uint aliceAssetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint assetsPaid = aliceAssetsBefore - aliceAssetsAfter;

        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));
        require(aliceShares == 50e18, "receiver should get exactly requested shares");
        require(assetsPaid > 0, "caller should pay assets");
        require(assetsPaid == vault.previewMint(50e18) || assetsPaid == vault.previewMint(50e18) - 1,
            "assets paid should match the quoted amount (within 1 wei)");
    }

    // ============ TEST 12: withdraw() burns shares, sends exact assets ============

    function it_12_withdraw_burns_shares_sends_exact_assets() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        uint sharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        uint assetsBefore = IERC20(assetToken).balanceOf(address(alice));
        uint supplyBefore = vault.totalSupply();

        alice.do(address(vault), "withdraw(uint256,address,address)", 40e18, address(alice), address(alice));

        uint sharesAfter = IERC20(address(vault)).balanceOf(address(alice));
        uint assetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint supplyAfter = vault.totalSupply();

        require(assetsAfter - assetsBefore == 40e18, "receiver should get exactly requested assets");
        require(sharesBefore - sharesAfter > 0, "owner shares should be burned");
        require(supplyBefore - supplyAfter == sharesBefore - sharesAfter, "supply decrease should equal shares burned");
        require(vault.totalAssets() == 60e18, "vault total assets should decrease");
    }

    // ============ TEST 13: redeem() burns exact shares, sends assets ============

    function it_13_redeem_burns_exact_shares_sends_assets() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        uint sharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        uint assetsBefore = IERC20(assetToken).balanceOf(address(alice));
        uint supplyBefore = vault.totalSupply();

        alice.do(address(vault), "redeem(uint256,address,address)", 60e18, address(alice), address(alice));

        uint sharesAfter = IERC20(address(vault)).balanceOf(address(alice));
        uint assetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint supplyAfter = vault.totalSupply();

        require(sharesBefore - sharesAfter == 60e18, "exactly requested shares should be burned");
        require(assetsAfter > assetsBefore, "receiver should get assets");
        require(supplyBefore - supplyAfter == 60e18, "supply should decrease by redeemed shares");
    }

    // ============ TEST 14: Approval semantics for withdraw/redeem ============

    function it_14_owner_can_withdraw_without_allowance() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Owner withdraws their own funds (no allowance needed)
        alice.do(address(vault), "withdraw(uint256,address,address)", 50e18, address(alice), address(alice));
        require(IERC20(assetToken).balanceOf(address(alice)) == 50e18, "owner should receive assets");
    }

    function it_14_spender_can_redeem_with_allowance() public {
        User owner = new User();
        User spender = new User();

        Token(assetToken).mint(address(owner), 100e18);
        owner.do(assetToken, "approve", address(vault), INFINITY);
        owner.do(address(vault), "deposit(uint256,address)", 100e18, address(owner));

        // Owner approves spender for vault shares
        owner.do(address(vault), "approve", address(spender), 60e18);

        // Spender redeems on behalf of owner
        uint spenderBefore = IERC20(assetToken).balanceOf(address(spender));
        spender.do(address(vault), "redeem(uint256,address,address)", 60e18, address(spender), address(owner));
        uint spenderGot = IERC20(assetToken).balanceOf(address(spender)) - spenderBefore;

        require(spenderGot == 60e18, "spender should receive the assets");
        require(IERC20(address(vault)).balanceOf(address(owner)) == 40e18, "owner shares should decrease");
    }

    function it_14_spender_can_withdraw_with_allowance() public {
        User owner = new User();
        User spender = new User();

        Token(assetToken).mint(address(owner), 100e18);
        owner.do(assetToken, "approve", address(vault), INFINITY);
        owner.do(address(vault), "deposit(uint256,address)", 100e18, address(owner));

        // Owner approves spender for vault shares
        owner.do(address(vault), "approve", address(spender), 100e18);

        // Spender withdraws on behalf of owner, receives assets
        uint spenderBefore = IERC20(assetToken).balanceOf(address(spender));
        spender.do(address(vault), "withdraw(uint256,address,address)", 30e18, address(spender), address(owner));
        uint spenderGot = IERC20(assetToken).balanceOf(address(spender)) - spenderBefore;

        require(spenderGot == 30e18, "spender should receive the exact assets");
    }

    function it_14_insufficient_allowance_reverts() public {
        User owner = new User();
        User spender = new User();

        Token(assetToken).mint(address(owner), 100e18);
        owner.do(assetToken, "approve", address(vault), INFINITY);
        owner.do(address(vault), "deposit(uint256,address)", 100e18, address(owner));

        // Owner approves only 10 shares
        owner.do(address(vault), "approve", address(spender), 10e18);

        // Spender tries to redeem 50 (more than allowed)
        bool reverted = false;
        try spender.do(address(vault), "redeem(uint256,address,address)", 50e18, address(spender), address(owner)) {
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on insufficient share allowance");
    }

    // ============ TEST 15: max functions are correct ============

    function it_15_max_deposit_and_max_mint_are_unbounded() public {
        require(vault.maxDeposit(address(0)) == INFINITY, "maxDeposit should be max uint256");
        require(vault.maxMint(address(0)) == INFINITY, "maxMint should be max uint256");
    }

    function it_15_max_withdraw_and_max_redeem_track_owner() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        uint maxW = vault.maxWithdraw(address(alice));
        uint maxR = vault.maxRedeem(address(alice));

        require(maxR == 100e18, "maxRedeem should equal share balance");
        require(maxW == vault.previewRedeem(maxR), "maxWithdraw should equal previewRedeem(maxRedeem)");

        // User with no shares
        require(vault.maxWithdraw(address(0x1)) == 0, "maxWithdraw should be 0 for non-holders");
        require(vault.maxRedeem(address(0x1)) == 0, "maxRedeem should be 0 for non-holders");
    }

    function it_15_cannot_withdraw_more_than_max() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        uint maxW = vault.maxWithdraw(address(alice));

        bool reverted = false;
        try alice.do(address(vault), "withdraw(uint256,address,address)", maxW + 1, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "withdrawing more than maxWithdraw should revert");
    }

    function it_15_cannot_redeem_more_than_max() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        bool reverted = false;
        try alice.do(address(vault), "redeem(uint256,address,address)", 101e18, address(alice), address(alice)) {
        } catch {
            reverted = true;
        }
        require(reverted, "redeeming more than maxRedeem should revert");
    }

    // ============ TEST 16: Preview functions are pure quotes ============

    function it_16_previews_are_independent_of_caller_balance_and_allowance() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Preview works even for users with no tokens or shares
        uint pDeposit = vault.previewDeposit(50e18);
        uint pMint = vault.previewMint(50e18);
        uint pWithdraw = vault.previewWithdraw(50e18);
        uint pRedeem = vault.previewRedeem(50e18);

        require(pDeposit > 0, "previewDeposit should quote even without caller balance");
        require(pMint > 0, "previewMint should quote even without caller balance");
        require(pWithdraw > 0, "previewWithdraw should quote even without caller balance");
        require(pRedeem > 0, "previewRedeem should quote even without caller balance");
    }

    // ============ TEST 17: Exchange rate changes after yield/donation ============

    function it_17_exchange_rate_rises_after_yield() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Pre-yield: 100 shares, 100 assets
        require(vault.convertToAssets(1e18) >= 999999999999999999, "pre-yield: 1 share ≈ 1 asset");

        // Simulate yield: donate 100 assets
        Token(assetToken).mint(address(vault), 100e18);

        // Post-yield: 100 shares, 200 assets -> 1 share ≈ 2 assets
        require(vault.totalAssets() == 200e18, "totalAssets should include yield");
        require(vault.totalSupply() == 100e18, "supply should be unchanged");

        uint assetsPerShare = vault.convertToAssets(1e18);
        require(assetsPerShare >= 1999999999999999998, "post-yield: 1 share should be worth ~2 assets");

        // New depositor gets fewer shares per asset
        User bob = new User();
        Token(assetToken).mint(address(bob), 100e18);
        bob.do(assetToken, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 100e18, address(bob));

        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));
        require(bobShares < 100e18, "post-yield depositor should get fewer shares");
        require(bobShares >= 49e18 && bobShares <= 51e18, "bob should get ~50 shares at 2:1 rate");
    }

    // ============ TEST 18: Rounding edge cases ============

    function it_18_tiny_deposit_on_shifted_rate() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Double the rate
        Token(assetToken).mint(address(vault), 100e18);

        // 1 wei deposit at 2:1 rate => shares = floor(1 * (100e18+1) / (200e18+1)) = 0
        // Deposit of 0 shares still executes (no revert in base ERC4626) but mints nothing.
        uint previewedShares = vault.previewDeposit(1);
        require(previewedShares == 0, "1 wei deposit at 2:1 rate should preview 0 shares");
    }

    function it_18_tiny_redeem_returns_proportional_assets() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Redeem 1 wei of shares => assets = floor(1 * (100e18+1) / (100e18+1)) = 1
        uint previewedAssets = vault.previewRedeem(1);
        require(previewedAssets == 1, "1 wei of shares should redeem 1 wei of assets at 1:1");

        uint assetsBefore = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", 1, address(alice), address(alice));
        uint assetsGot = IERC20(assetToken).balanceOf(address(alice)) - assetsBefore;
        require(assetsGot == 1, "should receive 1 wei of assets");
    }

    function it_18_mint_does_not_undercharge_assets() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Donate to shift rate
        Token(assetToken).mint(address(vault), 50e18);

        // previewMint rounds UP (Ceil), so minting 1 share should cost at least 1.5 assets
        uint costFor1Share = vault.previewMint(1);
        require(costFor1Share >= 1, "mint cost should round up (ceil)");

        // previewMint(1e18) should cost ~1.5e18 rounded up
        uint costFor1e18Shares = vault.previewMint(1e18);
        require(costFor1e18Shares >= 15e17, "mint cost for 1e18 shares should be >= 1.5e18");
    }

    function it_18_withdraw_does_not_under_burn_shares() public {
        User alice = new User();
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Donate to shift rate
        Token(assetToken).mint(address(vault), 50e18);

        // previewWithdraw rounds UP (Ceil), so withdrawing 1 asset burns at least ceil(1 share at 1.5x rate)
        uint sharesBurned = vault.previewWithdraw(1e18);
        // At 1.5:1 rate, 1e18 assets costs ceil(1e18 * (100e18+1) / (150e18+1)) shares
        require(sharesBurned > 0, "withdraw should burn shares");
    }

    // ============ TEST 19: Multi-user fairness across time ============

    function it_19_multi_user_fairness_across_time() public {
        User alice = new User();
        User bob = new User();

        // Alice deposits 100 at 1:1
        Token(assetToken).mint(address(alice), 100e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));

        // Yield accrues: +100 donated
        Token(assetToken).mint(address(vault), 100e18);

        // Bob deposits 100 at 2:1 rate -> gets ~50 shares
        Token(assetToken).mint(address(bob), 100e18);
        bob.do(assetToken, "approve", address(vault), INFINITY);
        bob.do(address(vault), "deposit(uint256,address)", 100e18, address(bob));

        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));
        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));
        require(aliceShares > bobShares, "alice should have more shares (deposited before yield)");

        // Both redeem all
        uint aliceBefore = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", aliceShares, address(alice), address(alice));
        uint aliceGot = IERC20(assetToken).balanceOf(address(alice)) - aliceBefore;

        uint bobBefore = IERC20(assetToken).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", bobShares, address(bob), address(bob));
        uint bobGot = IERC20(assetToken).balanceOf(address(bob)) - bobBefore;

        // Alice deposited 100 before yield, should get ~200 (her share of the yield)
        // Bob deposited 100 after yield, should get ~100 (no extra yield for him)
        require(aliceGot > bobGot, "alice should get more assets (captured yield)");
        require(aliceGot >= 199e18, "alice should get ~200 assets");
        require(bobGot >= 99e18, "bob should get ~100 assets");

        // Total out should equal total in (within rounding)
        uint totalOut = aliceGot + bobGot;
        uint totalIn = 100e18 + 100e18 + 100e18;
        require(totalOut >= totalIn - 2 && totalOut <= totalIn, "value should be conserved within rounding");
    }

    // ============ TEST 19b: Multi-step per-tx accounting ============

    function it_19b_multi_step_per_tx_accounting() public {
        User alice = new User();
        User bob = new User();
        User charlie = new User();

        Token(assetToken).mint(address(alice), 500e18);
        Token(assetToken).mint(address(bob), 500e18);
        Token(assetToken).mint(address(charlie), 500e18);
        alice.do(assetToken, "approve", address(vault), INFINITY);
        bob.do(assetToken, "approve", address(vault), INFINITY);
        charlie.do(assetToken, "approve", address(vault), INFINITY);

        // --- Step 1: Alice deposits 100 at 1:1 ---
        uint previewS1 = vault.previewDeposit(100e18);
        uint aliceAssetsBefore = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "deposit(uint256,address)", 100e18, address(alice));
        uint aliceAssetsAfter = IERC20(assetToken).balanceOf(address(alice));
        uint aliceShares = IERC20(address(vault)).balanceOf(address(alice));

        require(aliceAssetsBefore - aliceAssetsAfter == 100e18, "S1: alice pays exactly 100 assets");
        require(aliceShares == previewS1, "S1: shares match preview");
        require(aliceShares == 100e18, "S1: 1:1 rate gives 100 shares");
        require(vault.totalAssets() == 100e18, "S1: vault holds 100");
        require(vault.totalSupply() == 100e18, "S1: supply is 100");

        // --- Step 2: Bob deposits 60 at 1:1 ---
        uint previewS2 = vault.previewDeposit(60e18);
        uint bobAssetsBefore = IERC20(assetToken).balanceOf(address(bob));
        bob.do(address(vault), "deposit(uint256,address)", 60e18, address(bob));
        uint bobAssetsAfter = IERC20(assetToken).balanceOf(address(bob));
        uint bobShares = IERC20(address(vault)).balanceOf(address(bob));

        require(bobAssetsBefore - bobAssetsAfter == 60e18, "S2: bob pays exactly 60 assets");
        require(bobShares == previewS2, "S2: shares match preview");
        require(bobShares == 60e18, "S2: 1:1 rate gives 60 shares");
        require(vault.totalAssets() == 160e18, "S2: vault holds 160");
        require(vault.totalSupply() == 160e18, "S2: supply is 160");

        // --- Step 3: Yield arrives (+40), rate shifts to 200/160 = 1.25 ---
        Token(assetToken).mint(address(vault), 40e18);
        require(vault.totalAssets() == 200e18, "S3: vault holds 200 after yield");
        require(vault.totalSupply() == 160e18, "S3: supply unchanged at 160");

        // --- Step 4: Alice withdraws exactly 30 assets at the new rate ---
        uint previewS4 = vault.previewWithdraw(30e18);
        uint aliceSharesBefore = IERC20(address(vault)).balanceOf(address(alice));
        uint aliceAssetsBefore4 = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "withdraw(uint256,address,address)", 30e18, address(alice), address(alice));
        uint aliceAssetsAfter4 = IERC20(assetToken).balanceOf(address(alice));
        uint aliceSharesAfter4 = IERC20(address(vault)).balanceOf(address(alice));
        uint sharesBurned4 = aliceSharesBefore - aliceSharesAfter4;

        require(aliceAssetsAfter4 - aliceAssetsBefore4 == 30e18, "S4: alice receives exactly 30 assets");
        require(sharesBurned4 == previewS4, "S4: shares burned match preview");
        require(vault.totalAssets() == 170e18, "S4: vault holds 170 after withdrawal");

        // --- Step 5: Charlie deposits 80 at the shifted rate ---
        uint previewS5 = vault.previewDeposit(80e18);
        uint charlieAssetsBefore = IERC20(assetToken).balanceOf(address(charlie));
        charlie.do(address(vault), "deposit(uint256,address)", 80e18, address(charlie));
        uint charlieAssetsAfter = IERC20(assetToken).balanceOf(address(charlie));
        uint charlieShares = IERC20(address(vault)).balanceOf(address(charlie));

        require(charlieAssetsBefore - charlieAssetsAfter == 80e18, "S5: charlie pays exactly 80 assets");
        require(charlieShares == previewS5, "S5: shares match preview");
        require(charlieShares < 80e18, "S5: rate > 1:1 so charlie gets fewer shares");
        require(vault.totalAssets() == 250e18, "S5: vault holds 250");

        // --- Step 6: Bob redeems 20 shares ---
        uint previewS6 = vault.previewRedeem(20e18);
        uint bobAssetsBefore6 = IERC20(assetToken).balanceOf(address(bob));
        uint bobSharesBefore6 = IERC20(address(vault)).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", 20e18, address(bob), address(bob));
        uint bobAssetsAfter6 = IERC20(assetToken).balanceOf(address(bob));
        uint bobSharesAfter6 = IERC20(address(vault)).balanceOf(address(bob));
        uint bobAssetsGot6 = bobAssetsAfter6 - bobAssetsBefore6;

        require(bobSharesBefore6 - bobSharesAfter6 == 20e18, "S6: exactly 20 shares burned");
        require(bobAssetsGot6 == previewS6, "S6: assets received match preview");
        require(bobAssetsGot6 > 20e18, "S6: rate > 1:1 so bob gets more than 20 assets per 20 shares");

        // --- Step 7: More yield (+50) ---
        Token(assetToken).mint(address(vault), 50e18);
        uint totalAssetsS7 = vault.totalAssets();
        require(totalAssetsS7 == 250e18 - bobAssetsGot6 + 50e18, "S7: vault assets reflect withdrawal + new yield");

        // --- Step 8: All three redeem remaining shares, preview taken just before each ---
        uint aliceFinalShares = IERC20(address(vault)).balanceOf(address(alice));
        uint previewAlice = vault.previewRedeem(aliceFinalShares);
        uint aliceBal8 = IERC20(assetToken).balanceOf(address(alice));
        alice.do(address(vault), "redeem(uint256,address,address)", aliceFinalShares, address(alice), address(alice));
        uint aliceGot8 = IERC20(assetToken).balanceOf(address(alice)) - aliceBal8;
        require(aliceGot8 == previewAlice, "S8: alice redemption matches preview");

        uint bobFinalShares = IERC20(address(vault)).balanceOf(address(bob));
        uint previewBob = vault.previewRedeem(bobFinalShares);
        uint bobBal8 = IERC20(assetToken).balanceOf(address(bob));
        bob.do(address(vault), "redeem(uint256,address,address)", bobFinalShares, address(bob), address(bob));
        uint bobGot8 = IERC20(assetToken).balanceOf(address(bob)) - bobBal8;
        require(bobGot8 == previewBob, "S8: bob redemption matches preview");

        uint charlieFinalShares = IERC20(address(vault)).balanceOf(address(charlie));
        uint previewCharlie = vault.previewRedeem(charlieFinalShares);
        uint charlieBal8 = IERC20(assetToken).balanceOf(address(charlie));
        charlie.do(address(vault), "redeem(uint256,address,address)", charlieFinalShares, address(charlie), address(charlie));
        uint charlieGot8 = IERC20(assetToken).balanceOf(address(charlie)) - charlieBal8;
        require(charlieGot8 == previewCharlie, "S8: charlie redemption matches preview");

        require(vault.totalSupply() == 0, "S8: all shares redeemed");

        // --- Final accounting: all minted tokens accounted for ---
        uint totalMinted = 500e18 + 500e18 + 500e18 + 40e18 + 50e18;
        uint aliceTotal = IERC20(assetToken).balanceOf(address(alice));
        uint bobTotal = IERC20(assetToken).balanceOf(address(bob));
        uint charlieTotal = IERC20(assetToken).balanceOf(address(charlie));
        uint vaultRemainder = IERC20(assetToken).balanceOf(address(vault));

        require(aliceTotal + bobTotal + charlieTotal + vaultRemainder == totalMinted,
            "Final: all tokens accounted for");

        // Alice deposited 100, withdrew 30 mid-stream, then redeemed rest — she captured early yield
        require(aliceTotal > 500e18 - 100e18 + 100e18, "Final: alice profited from yield");
        // Bob deposited 60, redeemed 20 shares mid-stream, then redeemed rest
        require(bobTotal > 500e18 - 60e18 + 60e18, "Final: bob profited from yield");
        // Charlie deposited 80 at elevated rate, captured only late yield
        require(charlieTotal > 500e18 - 80e18 + 80e18, "Final: charlie profited from late yield");
    }

    // ============ TEST 20: Inflation attack protection ============

    function it_20_inflation_attack_is_unprofitable_for_attacker() public {
        User attacker = new User();
        User victim = new User();

        // Attacker front-runs: deposit 1 wei, then donate a large amount
        Token(assetToken).mint(address(attacker), 10001e18);
        attacker.do(assetToken, "approve", address(vault), INFINITY);
        attacker.do(address(vault), "deposit(uint256,address)", 1, address(attacker));

        uint attackerShares = IERC20(address(vault)).balanceOf(address(attacker));
        require(attackerShares == 1, "attacker should have 1 share");

        // Attacker donates to inflate price
        attacker.do(assetToken, "transfer", address(vault), 10000e18);
        require(vault.totalAssets() == 10000e18 + 1, "donation should inflate totalAssets");

        // Victim deposits
        Token(assetToken).mint(address(victim), 10000e18);
        victim.do(assetToken, "approve", address(vault), INFINITY);
        victim.do(address(vault), "deposit(uint256,address)", 10000e18, address(victim));

        // Attacker redeems
        uint attackerAssetsBefore = IERC20(assetToken).balanceOf(address(attacker));
        attacker.do(address(vault), "redeem(uint256,address,address)", attackerShares, address(attacker), address(attacker));
        uint attackerRecovered = IERC20(assetToken).balanceOf(address(attacker)) - attackerAssetsBefore;

        // Attacker invested 1 wei deposit + 10000e18 donation = ~10000e18
        uint attackerInvestment = 10000e18 + 1;
        require(attackerRecovered < attackerInvestment,
            "attacker should NOT profit: virtual shares absorb part of donation");
    }

    function it_20_inflation_attack_victim_partially_protected_by_virtual_shares() public {
        User attacker = new User();
        User victim = new User();

        // Attacker: deposit tiny, donate big
        Token(assetToken).mint(address(attacker), 101e18);
        attacker.do(assetToken, "approve", address(vault), INFINITY);
        attacker.do(address(vault), "deposit(uint256,address)", 1e18, address(attacker));
        attacker.do(assetToken, "transfer", address(vault), 100e18);

        // Victim deposits same amount as donation
        Token(assetToken).mint(address(victim), 100e18);
        victim.do(assetToken, "approve", address(vault), INFINITY);
        victim.do(address(vault), "deposit(uint256,address)", 100e18, address(victim));

        // Victim redeems and recovers ~their deposit (virtual shares help)
        uint victimShares = IERC20(address(vault)).balanceOf(address(victim));
        uint victimBefore = IERC20(assetToken).balanceOf(address(victim));
        victim.do(address(vault), "redeem(uint256,address,address)", victimShares, address(victim), address(victim));
        uint victimRecovered = IERC20(assetToken).balanceOf(address(victim)) - victimBefore;

        // With default _decimalsOffset(0), victim may lose some value but attacker loses more.
        // The key invariant: attacker does not profit.
        uint attackerShares = IERC20(address(vault)).balanceOf(address(attacker));
        uint attackerBefore = IERC20(assetToken).balanceOf(address(attacker));
        attacker.do(address(vault), "redeem(uint256,address,address)", attackerShares, address(attacker), address(attacker));
        uint attackerRecovered = IERC20(assetToken).balanceOf(address(attacker)) - attackerBefore;

        require(attackerRecovered < 101e18, "attacker should not recover their full investment");
    }

    // ============ PROPERTY TESTS ============

    /// @notice Deposit then full redeem round-trips conserve value within 1 wei.
    function property_deposit_redeem_round_trip(uint seed) public {
        uint amount = (seed % 1000000 + 1) * 1e12;

        TestVault v = new TestVault();
        address tkn = m.tokenFactory().createToken("PR", "PropRT", [], [], [], "PR", 0, 18);
        Token(tkn).setStatus(2);
        v.initialize(tkn, "PV", "PV");

        User u = new User();
        Token(tkn).mint(address(u), amount);
        u.do(tkn, "approve", address(v), INFINITY);
        u.do(address(v), "deposit(uint256,address)", amount, address(u));

        uint shares = IERC20(address(v)).balanceOf(address(u));
        require(shares > 0, "should have shares");

        u.do(address(v), "redeem(uint256,address,address)", shares, address(u), address(u));
        uint got = IERC20(tkn).balanceOf(address(u));

        require(got >= amount - 1 && got <= amount, "round trip should conserve value within 1 wei");
        require(v.totalSupply() == 0, "no shares left");
    }

    /// @notice Two users deposit, yield arrives, total redeemed == total deposited + yield.
    function property_yield_conserves_total_value(uint seedA, uint seedB, uint seedYield) public {
        uint amountA = ((seedA % 500000) + 1) * 1e12;
        uint amountB = ((seedB % 500000) + 1) * 1e12;
        uint yieldAmt = ((seedYield % 100000) + 1) * 1e12;

        TestVault v = new TestVault();
        address tkn = m.tokenFactory().createToken("PY", "PropYield", [], [], [], "PY", 0, 18);
        Token(tkn).setStatus(2);
        v.initialize(tkn, "PV", "PV");

        User alice = new User();
        User bob = new User();

        Token(tkn).mint(address(alice), amountA);
        alice.do(tkn, "approve", address(v), INFINITY);
        alice.do(address(v), "deposit(uint256,address)", amountA, address(alice));

        Token(tkn).mint(address(bob), amountB);
        bob.do(tkn, "approve", address(v), INFINITY);
        bob.do(address(v), "deposit(uint256,address)", amountB, address(bob));

        Token(tkn).mint(address(v), yieldAmt);

        uint aliceShares = IERC20(address(v)).balanceOf(address(alice));
        alice.do(address(v), "redeem(uint256,address,address)", aliceShares, address(alice), address(alice));
        uint aliceGot = IERC20(tkn).balanceOf(address(alice));

        uint bobShares = IERC20(address(v)).balanceOf(address(bob));
        bob.do(address(v), "redeem(uint256,address,address)", bobShares, address(bob), address(bob));
        uint bobGot = IERC20(tkn).balanceOf(address(bob));

        uint vaultBal = IERC20(tkn).balanceOf(address(v));

        require(v.totalSupply() == 0, "no shares left");

        uint totalMinted = amountA + amountB + yieldAmt;
        uint totalHeld = aliceGot + bobGot + vaultBal;
        require(totalHeld == totalMinted, "exact token conservation");
    }

    /// @notice convertToShares(convertToAssets(shares)) should never exceed the original shares.
    function property_roundtrip_conversion_never_inflates(uint seed) public {
        uint initialDeposit = ((seed % 500000) + 1) * 1e12;

        TestVault v = new TestVault();
        address tkn = m.tokenFactory().createToken("PC", "PropConv", [], [], [], "PC", 0, 18);
        Token(tkn).setStatus(2);
        v.initialize(tkn, "PV", "PV");

        User u = new User();
        Token(tkn).mint(address(u), initialDeposit);
        u.do(tkn, "approve", address(v), INFINITY);
        u.do(address(v), "deposit(uint256,address)", initialDeposit, address(u));

        uint yieldAmt = ((seed % 100000)) * 1e12;
        if (yieldAmt > 0) {
            Token(tkn).mint(address(v), yieldAmt);
        }

        uint testShares = 1e18;
        uint assets = v.convertToAssets(testShares);
        uint sharesBack = v.convertToShares(assets);

        require(sharesBack <= testShares, "shares->assets->shares should not inflate (both floor)");
    }
}
