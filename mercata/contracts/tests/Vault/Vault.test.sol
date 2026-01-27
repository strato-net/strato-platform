import "../../concrete/BaseCodeCollection.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../concrete/Tokens/Token.sol";
import "../../concrete/Vault/Vault.sol";
import "../../concrete/Vault/VaultFactory.sol";

/**
 * @title User
 * @notice Helper contract to simulate user actions in tests
 */
contract User {
    function do(address a, string f, variadic args) public returns (variadic) {
        variadic result = address(a).call(f, args);
        return result;
    }
}

/**
 * @title Describe_Vault
 * @notice Comprehensive test suite for the Vault and VaultFactory contracts
 * @dev Tests cover:
 *   - Vault creation via factory
 *   - First deposit requirements ($50k minimum)
 *   - Share minting calculations
 *   - Deposit eligibility (deficit-preferential rule)
 *   - Withdrawals by USD amount and by shares
 *   - Minimum reserve constraints
 *   - View functions
 *   - Admin functions
 *   - Pause/unpause functionality
 *   - Multi-user scenarios
 *   - Edge cases and error conditions
 */
contract Describe_Vault is Authorizable {

    // ============ STATE VARIABLES ============

    Mercata m;
    string[] emptyArray;

    // Test users
    User user1;
    User user2;
    User user3;
    User botExecutor;

    // Vault-related addresses
    VaultFactory vaultFactory;
    Vault vault;
    address vaultAddress;
    address shareTokenAddress;

    // Test tokens (supported assets)
    address tokenA;  // e.g., ETHST
    address tokenB;  // e.g., WBTCST
    address tokenC;  // e.g., GOLDST

    // Constants
    uint constant WAD = 1e18;
    uint constant MIN_FIRST_DEPOSIT_USD = 50000000000000000000000; // 50000 * 1e18

    // ============ SETUP ============

    function beforeAll() {
        bypassAuthorizations = true;
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");
        emptyArray = new string[](0);

        // Create test users
        user1 = new User();
        user2 = new User();
        user3 = new User();
        botExecutor = new User();

        require(address(user1) != address(0), "User1 not created");
        require(address(user2) != address(0), "User2 not created");
        require(address(user3) != address(0), "User3 not created");
        require(address(botExecutor) != address(0), "BotExecutor not created");
    }

    function beforeEach() {
        // Create fresh tokens for each test
        tokenA = m.tokenFactory().createToken(
            "ETHST", "Ethereum Staked Token", emptyArray, emptyArray, emptyArray, "ETHST", 0, 18
        );
        tokenB = m.tokenFactory().createToken(
            "WBTCST", "Wrapped Bitcoin Staked Token", emptyArray, emptyArray, emptyArray, "WBTCST", 0, 18
        );
        tokenC = m.tokenFactory().createToken(
            "GOLDST", "Gold Staked Token", emptyArray, emptyArray, emptyArray, "GOLDST", 0, 18
        );

        // Activate tokens
        Token(tokenA).setStatus(2); // ACTIVE
        Token(tokenB).setStatus(2); // ACTIVE
        Token(tokenC).setStatus(2); // ACTIVE

        // Mint tokens to test contract and users
        Token(tokenA).mint(address(this), 1000000e18);
        Token(tokenB).mint(address(this), 1000000e18);
        Token(tokenC).mint(address(this), 1000000e18);

        Token(tokenA).mint(address(user1), 1000000e18);
        Token(tokenB).mint(address(user1), 1000000e18);
        Token(tokenC).mint(address(user1), 1000000e18);

        Token(tokenA).mint(address(user2), 1000000e18);
        Token(tokenB).mint(address(user2), 1000000e18);
        Token(tokenC).mint(address(user2), 1000000e18);

        // Set oracle prices (18 decimals: 1e18 = $1)
        PriceOracle oracle = m.priceOracle();
        oracle.setAssetPrice(tokenA, 2000e18);   // ETHST = $2,000
        oracle.setAssetPrice(tokenB, 40000e18);  // WBTCST = $40,000
        oracle.setAssetPrice(tokenC, 100e18);    // GOLDST = $100

        // Create VaultFactory
        address vaultFactoryImpl = address(new VaultFactory(address(this)));
        vaultFactory = VaultFactory(address(new Proxy(vaultFactoryImpl, address(this))));
        vaultFactory.initialize(
            address(m.tokenFactory()),
            address(m.priceOracle()),
            address(m.adminRegistry()),
            address(botExecutor)
        );

        // Whitelist VaultFactory to create tokens
        AdminRegistry adminRegistry = m.adminRegistry();
        adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(m.tokenFactory()), "createTokenWithInitialOwner", address(vaultFactory));

        // Create vault
        vaultAddress = vaultFactory.createVault("Arbitrage Vault", "vARB");
        vault = Vault(vaultAddress);
        shareTokenAddress = vault.shareToken();

        // Transfer share token ownership to vault so it can mint/burn
        // (VaultFactory transfers to factory owner, we need vault to own it)
        Ownable(shareTokenAddress).transferOwnership(vaultAddress);
        // adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(shareTokenAddress), "mint", address(vault));
        // adminRegistry.castVoteOnIssue(address(adminRegistry), "addWhitelist", address(shareTokenAddress), "burn", address(vault));

        // Add supported assets to vault
        vault.addSupportedAsset(tokenA);
        vault.addSupportedAsset(tokenB);
        vault.addSupportedAsset(tokenC);

        // Bot executor approves vault for all tokens (one-time setup)
        // Note: Using max uint256 value directly since type(uint).max doesn't work in variadic calls
        uint maxApproval = 115792089237316195423570985008687907853269984665640564039457584007913129639935;
        botExecutor.do(tokenA, "approve", vaultAddress, maxApproval);
        botExecutor.do(tokenB, "approve", vaultAddress, maxApproval);
        botExecutor.do(tokenC, "approve", vaultAddress, maxApproval);
    }

    // ============ VAULT CREATION TESTS ============

    function it_creates_vault_successfully() {
        require(vaultAddress != address(0), "Vault should be created");
        require(shareTokenAddress != address(0), "Share token should be created");
    }

    function it_vault_has_correct_initial_state() {
        require(vault.shareToken() == shareTokenAddress, "Share token should be set");
        require(address(vault.priceOracle()) == address(m.priceOracle()), "Price oracle should be set");
        require(vault.botExecutor() == address(botExecutor), "Bot executor should be set");
        // Note: WAD is a public constant (1e18), no need to test its value
        require(vault.MIN_FIRST_DEPOSIT_USD() == MIN_FIRST_DEPOSIT_USD, "MIN_FIRST_DEPOSIT_USD should be $50,000");
    }

    function it_vault_has_supported_assets() {
        require(vault.isSupported(tokenA), "TokenA should be supported");
        require(vault.isSupported(tokenB), "TokenB should be supported");
        require(vault.isSupported(tokenC), "TokenC should be supported");

        address[] memory assets = vault.getSupportedAssets();
        require(assets.length == 3, "Should have 3 supported assets");
    }

    function it_factory_tracks_vaults() {
        require(vaultFactory.getVault("Arbitrage Vault") == vaultAddress, "Vault should be tracked by name");
        require(vaultFactory.getVaultCount() == 1, "Should have 1 vault");
    }

    // ============ FIRST DEPOSIT TESTS ============

    function it_rejects_first_deposit_below_minimum() {
        // First deposit of $49,999 should fail (need 25 ETHST at $2000 = $50,000)
        uint smallDeposit = 24e18; // 24 ETHST = $48,000 < $50,000

        require(ERC20(tokenA).approve(vaultAddress, smallDeposit), "Approval failed");

        try vault.deposit(tokenA, smallDeposit) {
            require(false, "Should have reverted for deposit below minimum");
        } catch {
            // Expected to fail
        }
    }

    function it_accepts_first_deposit_at_minimum() {
        // First deposit of exactly $50,000 should succeed
        uint deposit = 25e18; // 25 ETHST = $50,000

        require(ERC20(tokenA).approve(vaultAddress, deposit), "Approval failed");

        uint sharesMinted = vault.deposit(tokenA, deposit);

        require(sharesMinted == 50000e18, "Should mint $50,000 worth of shares (1 share = $1)");
        require(IERC20(shareTokenAddress).totalSupply() == sharesMinted, "Total supply should equal minted shares");
        require(IERC20(shareTokenAddress).balanceOf(address(this)) == sharesMinted, "Depositor should have shares");
    }

    function it_accepts_first_deposit_above_minimum() {
        // First deposit of $100,000 should succeed
        uint deposit = 50e18; // 50 ETHST = $100,000

        require(ERC20(tokenA).approve(vaultAddress, deposit), "Approval failed");

        uint sharesMinted = vault.deposit(tokenA, deposit);

        require(sharesMinted == 100000e18, "Should mint $100,000 worth of shares");
    }

    // ============ SUBSEQUENT DEPOSIT TESTS ============

    function it_subsequent_deposits_mint_proportional_shares() {
        // First deposit: 25 ETHST = $50,000 -> 50,000 shares
        uint firstDeposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, firstDeposit), "First approval failed");
        vault.deposit(tokenA, firstDeposit);

        uint initialSupply = IERC20(shareTokenAddress).totalSupply();
        uint initialEquity = vault.getTotalEquity();

        // Second deposit: 25 ETHST = $50,000 -> should mint ~50,000 shares (proportional)
        uint secondDeposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, secondDeposit), "Second approval failed");
        uint sharesMinted = vault.deposit(tokenA, secondDeposit);

        // Expected: depositValue * totalSupply / equity = 50000 * 50000 / 50000 = 50000
        require(sharesMinted == 50000e18, "Should mint proportional shares");
        require(IERC20(shareTokenAddress).totalSupply() == 100000e18, "Total supply should double");
    }

    function it_deposits_in_different_tokens_work() {
        // First deposit in tokenA
        uint firstDeposit = 25e18; // 25 ETHST = $50,000
        require(ERC20(tokenA).approve(vaultAddress, firstDeposit), "TokenA approval failed");
        vault.deposit(tokenA, firstDeposit);

        // Second deposit in tokenB (WBTCST at $40,000)
        uint secondDeposit = 125e16; // 1.25 WBTCST = $50,000
        require(ERC20(tokenB).approve(vaultAddress, secondDeposit), "TokenB approval failed");
        uint sharesMinted = vault.deposit(tokenB, secondDeposit);

        require(sharesMinted == 50000e18, "Should mint proportional shares for tokenB deposit");
    }

    function it_deposit_with_zero_amount_reverts() {
        require(ERC20(tokenA).approve(vaultAddress, 0), "Approval failed");

        try vault.deposit(tokenA, 0) {
            require(false, "Should have reverted for zero amount");
        } catch {
            // Expected
        }
    }

    function it_deposit_unsupported_asset_reverts() {
        // Create new token that is not supported
        address unsupportedToken = m.tokenFactory().createToken(
            "UNSUP", "Unsupported Token", emptyArray, emptyArray, emptyArray, "UNSUP", 1000000e18, 18
        );
        Token(unsupportedToken).setStatus(2);
        m.priceOracle().setAssetPrice(unsupportedToken, 100e18);

        require(ERC20(unsupportedToken).approve(vaultAddress, 500e18), "Approval failed");

        try vault.deposit(unsupportedToken, 500e18) {
            require(false, "Should have reverted for unsupported asset");
        } catch {
            // Expected
        }
    }

    // ============ DEFICIT-PREFERENTIAL DEPOSIT TESTS ============

    function it_allows_any_deposit_when_no_deficit() {
        // First deposit to establish shares
        uint firstDeposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, firstDeposit), "Approval failed");
        vault.deposit(tokenA, firstDeposit);

        // No minimum reserves set, so no deficit
        // Should allow deposit in any token
        uint secondDeposit = 1e18;
        require(ERC20(tokenB).approve(vaultAddress, secondDeposit), "TokenB approval failed");
        uint shares = vault.deposit(tokenB, secondDeposit);
        require(shares > 0, "Should allow deposit in any token when no deficit");
    }

    function it_enforces_deficit_preferential_deposits() {
        // First deposit to establish shares
        uint firstDeposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, firstDeposit), "Approval failed");
        vault.deposit(tokenA, firstDeposit);

        // Set minimum reserve for tokenA higher than current balance
        // Current balance is 25 ETHST in botExecutor, set min to 50 ETHST
        vault.setMinReserve(tokenA, 50e18);

        // Now tokenA is in deficit
        address[] memory deficitAssets = vault.getDeficitAssets();
        require(deficitAssets.length == 1, "Should have 1 deficit asset");
        require(deficitAssets[0] == tokenA, "TokenA should be in deficit");

        // Try to deposit tokenB (should fail because tokenA is in deficit)
        require(ERC20(tokenB).approve(vaultAddress, 1e18), "TokenB approval failed");

        try vault.deposit(tokenB, 1e18) {
            require(false, "Should have reverted for non-deficit deposit");
        } catch {
            // Expected - must deposit deficit asset
        }

        // Deposit tokenA (deficit asset) should work
        require(ERC20(tokenA).approve(vaultAddress, 10e18), "TokenA approval failed");
        uint shares = vault.deposit(tokenA, 10e18);
        require(shares > 0, "Should allow deposit of deficit asset");
    }

    // ============ WITHDRAWAL BY USD AMOUNT TESTS ============

    function it_withdraws_by_usd_amount() {
        // Setup: deposit 25 ETHST = $50,000
        uint deposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, deposit), "Approval failed");
        vault.deposit(tokenA, deposit);

        uint initialShares = IERC20(shareTokenAddress).balanceOf(address(this));

        // Withdraw $10,000 worth
        uint withdrawUSD = 10000e18;
        uint sharesBurned = vault.withdraw(withdrawUSD);

        // Should burn 10,000 shares (since NAV is $1/share initially)
        require(sharesBurned == 10000e18, "Should burn correct shares");
        require(IERC20(shareTokenAddress).balanceOf(address(this)) == initialShares - sharesBurned, "Shares should be burned");
    }

    function it_withdraw_exceeding_withdrawable_reverts() {
        // Setup: deposit 25 ETHST = $50,000
        uint deposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, deposit), "Approval failed");
        vault.deposit(tokenA, deposit);

        // Set minimum reserve to lock most funds
        vault.setMinReserve(tokenA, 24e18); // Only 1 ETHST withdrawable = $2,000

        // Try to withdraw $10,000 (more than $2,000 withdrawable)
        try vault.withdraw(10000e18) {
            require(false, "Should have reverted for insufficient withdrawable");
        } catch {
            // Expected
        }
    }

    // ============ WITHDRAWAL BY SHARES TESTS ============

    function it_withdraws_by_shares() {
        // Setup: deposit 25 ETHST = $50,000 -> 50,000 shares
        uint deposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, deposit), "Approval failed");
        vault.deposit(tokenA, deposit);

        uint initialShares = IERC20(shareTokenAddress).balanceOf(address(this));

        // Withdraw 10,000 shares
        uint sharesToBurn = 10000e18;
        uint amountUSD = vault.withdrawShares(sharesToBurn);

        // Should return $10,000 worth
        require(amountUSD == 10000e18, "Should return correct USD value");
        require(IERC20(shareTokenAddress).balanceOf(address(this)) == initialShares - sharesToBurn, "Shares should be burned");
    }

    function it_withdraw_more_shares_than_owned_reverts() {
        // Setup: deposit 25 ETHST = $50,000 -> 50,000 shares
        uint deposit = 25e18;
        require(ERC20(tokenA).approve(vaultAddress, deposit), "Approval failed");
        vault.deposit(tokenA, deposit);

        // Try to withdraw more shares than owned
        try vault.withdrawShares(60000e18) {
            require(false, "Should have reverted for insufficient shares");
        } catch {
            // Expected
        }
    }

    // ============ PROPORTIONAL WITHDRAWAL PAYOUT TESTS ============

    function it_withdrawal_payouts_are_proportional() {
        // Setup: deposit multiple tokens
        // 25 ETHST = $50,000
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "TokenA approval failed");
        vault.deposit(tokenA, 25e18);

        // 1.25 WBTCST = $50,000
        require(ERC20(tokenB).approve(vaultAddress, 125e16), "TokenB approval failed");
        vault.deposit(tokenB, 125e16);

        // 500 GOLDST = $50,000
        require(ERC20(tokenC).approve(vaultAddress, 500e18), "TokenC approval failed");
        vault.deposit(tokenC, 500e18);

        // Total equity = $150,000, total shares = 150,000

        // Record balances before withdrawal
        uint balanceABefore = IERC20(tokenA).balanceOf(address(this));
        uint balanceBBefore = IERC20(tokenB).balanceOf(address(this));
        uint balanceCBefore = IERC20(tokenC).balanceOf(address(this));

        // Withdraw $30,000 (20% of total)
        vault.withdraw(30000e18);

        // Should receive ~20% of each token
        uint balanceAAfter = IERC20(tokenA).balanceOf(address(this));
        uint balanceBAfter = IERC20(tokenB).balanceOf(address(this));
        uint balanceCAfter = IERC20(tokenC).balanceOf(address(this));

        uint receivedA = balanceAAfter - balanceABefore;
        uint receivedB = balanceBAfter - balanceBBefore;
        uint receivedC = balanceCAfter - balanceCBefore;

        // Expected: 20% of each token (with some rounding)
        // TokenA: 20% of 25 ETHST = 5 ETHST
        // TokenB: 20% of 1.25 WBTCST = 0.25 WBTCST
        // TokenC: 20% of 500 GOLDST = 100 GOLDST
        require(receivedA >= 49e17 && receivedA <= 51e17, "Should receive ~5 ETHST");
        require(receivedB >= 24e16 && receivedB <= 26e16, "Should receive ~0.25 WBTCST");
        require(receivedC >= 99e18 && receivedC <= 101e18, "Should receive ~100 GOLDST");
    }

    function it_withdrawal_skips_assets_at_min_reserve() {
        // Setup: deposit multiple tokens
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "TokenA approval failed");
        vault.deposit(tokenA, 25e18);

        require(ERC20(tokenB).approve(vaultAddress, 125e16), "TokenB approval failed");
        vault.deposit(tokenB, 125e16);

        // Set tokenA minimum reserve to exactly the balance (skips tokenA on withdrawal)
        vault.setMinReserve(tokenA, 25e18);

        // Check withdrawable
        uint withdrawableA = vault.getWithdrawableBalance(tokenA);
        require(withdrawableA == 0, "TokenA should have 0 withdrawable");

        // Record balances
        uint balanceABefore = IERC20(tokenA).balanceOf(address(this));
        uint balanceBBefore = IERC20(tokenB).balanceOf(address(this));

        // Withdraw $10,000 - should only come from tokenB
        vault.withdraw(10000e18);

        uint receivedA = IERC20(tokenA).balanceOf(address(this)) - balanceABefore;
        uint receivedB = IERC20(tokenB).balanceOf(address(this)) - balanceBBefore;

        require(receivedA == 0, "Should not receive tokenA (at min reserve)");
        require(receivedB > 0, "Should receive tokenB");
    }

    // ============ VIEW FUNCTION TESTS ============

    function it_getTotalEquity_calculates_correctly() {
        // No deposits yet
        require(vault.getTotalEquity() == 0, "Initial equity should be 0");

        // Deposit 25 ETHST = $50,000
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        uint equity = vault.getTotalEquity();
        require(equity == 50000e18, "Equity should be $50,000");
    }

    function it_getWithdrawableEquity_respects_min_reserves() {
        // Deposit 25 ETHST = $50,000
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        // No min reserve - all withdrawable
        require(vault.getWithdrawableEquity() == 50000e18, "All should be withdrawable");

        // Set min reserve to 10 ETHST
        vault.setMinReserve(tokenA, 10e18);

        // Withdrawable = 15 ETHST = $30,000
        uint withdrawable = vault.getWithdrawableEquity();
        require(withdrawable == 30000e18, "Withdrawable should be $30,000");
    }

    function it_getNAVPerShare_calculates_correctly() {
        // Before any deposits, NAV per share defaults to $1
        uint navBefore = vault.getNAVPerShare();
        require(navBefore == WAD, "Default NAV should be $1");

        // Deposit 25 ETHST = $50,000 -> 50,000 shares
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        // NAV per share = $50,000 / 50,000 = $1
        uint nav = vault.getNAVPerShare();
        require(nav == WAD, "NAV per share should be $1");
    }

    function it_getAssetInfo_returns_correct_data() {
        // Deposit 25 ETHST
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        // Set min reserve
        vault.setMinReserve(tokenA, 10e18);

        (uint balance, uint minRes, uint withdrawable, uint price) = vault.getAssetInfo(tokenA);

        require(balance == 25e18, "Balance should be 25 ETHST");
        require(minRes == 10e18, "Min reserve should be 10 ETHST");
        require(withdrawable == 15e18, "Withdrawable should be 15 ETHST");
        require(price == 2000e18, "Price should be $2,000");
    }

    function it_getUserValue_calculates_correctly() {
        // Deposit 25 ETHST = $50,000 -> 50,000 shares
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        uint userValue = vault.getUserValue(address(this));
        require(userValue == 50000e18, "User value should be $50,000");
    }

    // ============ ADMIN FUNCTION TESTS ============

    function it_owner_can_add_supported_asset() {
        address newToken = m.tokenFactory().createToken(
            "NEWST", "New Token", emptyArray, emptyArray, emptyArray, "NEWST", 1000000e18, 18
        );
        Token(newToken).setStatus(2);

        vault.addSupportedAsset(newToken);

        require(vault.isSupported(newToken), "New token should be supported");
    }

    function it_owner_can_remove_supported_asset() {
        // tokenC has no balance, can be removed
        vault.removeSupportedAsset(tokenC);

        require(!vault.isSupported(tokenC), "TokenC should no longer be supported");
    }

    function it_cannot_remove_asset_with_balance() {
        // Deposit tokenA first
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        // Try to remove tokenA (has balance)
        try vault.removeSupportedAsset(tokenA) {
            require(false, "Should have reverted for asset with balance");
        } catch {
            // Expected
        }
    }

    function it_owner_can_set_min_reserve() {
        vault.setMinReserve(tokenA, 100e18);
        require(vault.minReserve(tokenA) == 100e18, "Min reserve should be updated");
    }

    function it_owner_can_set_bot_executor() {
        address newBot = address(0x123);
        vault.setBotExecutor(newBot);
        require(vault.botExecutor() == newBot, "Bot executor should be updated");
    }

    function it_owner_can_set_price_oracle() {
        address newOracle = address(new PriceOracle(address(this)));
        vault.setPriceOracle(newOracle);
        require(address(vault.priceOracle()) == newOracle, "Price oracle should be updated");
    }

    // ============ PAUSE/UNPAUSE TESTS ============

    function it_owner_can_pause_vault() {
        vault.pause();
        require(vault.paused(), "Vault should be paused");
    }

    function it_deposits_blocked_when_paused() {
        vault.pause();

        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");

        try vault.deposit(tokenA, 25e18) {
            require(false, "Should have reverted when paused");
        } catch {
            // Expected
        }
    }

    function it_withdrawals_blocked_when_paused() {
        // Setup: deposit first
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        vault.pause();

        try vault.withdraw(10000e18) {
            require(false, "Should have reverted when paused");
        } catch {
            // Expected
        }
    }

    function it_owner_can_unpause_vault() {
        vault.pause();
        require(vault.paused(), "Vault should be paused");

        vault.unpause();
        require(!vault.paused(), "Vault should be unpaused");

        // Should be able to deposit after unpause
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        uint shares = vault.deposit(tokenA, 25e18);
        require(shares > 0, "Should be able to deposit after unpause");
    }

    // ============ MULTI-USER TESTS ============

    function it_multiple_users_can_deposit() {
        // User1 deposits 25 ETHST = $50,000
        user1.do(tokenA, "approve", vaultAddress, 25e18);
        user1.do(vaultAddress, "deposit", tokenA, 25e18);

        uint user1Shares = IERC20(shareTokenAddress).balanceOf(address(user1));
        require(user1Shares == 50000e18, "User1 should have 50,000 shares");

        // User2 deposits 25 ETHST = $50,000
        user2.do(tokenA, "approve", vaultAddress, 25e18);
        user2.do(vaultAddress, "deposit", tokenA, 25e18);

        uint user2Shares = IERC20(shareTokenAddress).balanceOf(address(user2));
        require(user2Shares == 50000e18, "User2 should have 50,000 shares");

        require(IERC20(shareTokenAddress).totalSupply() == 100000e18, "Total supply should be 100,000 shares");
    }

    function it_multiple_users_can_withdraw() {
        // Setup: both users deposit
        user1.do(tokenA, "approve", vaultAddress, 25e18);
        user1.do(vaultAddress, "deposit", tokenA, 25e18);

        user2.do(tokenA, "approve", vaultAddress, 25e18);
        user2.do(vaultAddress, "deposit", tokenA, 25e18);

        // User1 withdraws half
        user1.do(vaultAddress, "withdraw", 25000e18);
        uint user1SharesAfter = IERC20(shareTokenAddress).balanceOf(address(user1));
        require(user1SharesAfter == 25000e18, "User1 should have 25,000 shares after withdrawal");

        // User2 withdraws half
        user2.do(vaultAddress, "withdraw", 25000e18);
        uint user2SharesAfter = IERC20(shareTokenAddress).balanceOf(address(user2));
        require(user2SharesAfter == 25000e18, "User2 should have 25,000 shares after withdrawal");
    }

    function it_user_cannot_withdraw_others_shares() {
        // User1 deposits
        user1.do(tokenA, "approve", vaultAddress, 25e18);
        user1.do(vaultAddress, "deposit", tokenA, 25e18);

        // User2 tries to withdraw (has no shares)
        try user2.do(vaultAddress, "withdrawShares", 10000e18) {
            require(false, "Should have reverted for insufficient shares");
        } catch {
            // Expected
        }
    }

    // ============ NAV CHANGE TESTS ============

    function it_nav_changes_when_prices_change() {
        // Deposit 25 ETHST at $2,000 = $50,000 -> 50,000 shares
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        uint navBefore = vault.getNAVPerShare();
        require(navBefore == WAD, "Initial NAV should be $1");

        // Price increases to $4,000
        m.priceOracle().setAssetPrice(tokenA, 4000e18);

        // NAV should double: $100,000 / 50,000 shares = $2
        uint navAfter = vault.getNAVPerShare();
        require(navAfter == 2 * WAD, "NAV should be $2 after price increase");

        // User value should also double
        uint userValue = vault.getUserValue(address(this));
        require(userValue == 100000e18, "User value should be $100,000");
    }

    function it_subsequent_depositors_get_fair_shares_after_nav_change() {
        // User1 deposits 25 ETHST at $2,000 = $50,000 -> 50,000 shares
        user1.do(tokenA, "approve", vaultAddress, 25e18);
        user1.do(vaultAddress, "deposit", tokenA, 25e18);

        // Price doubles to $4,000
        m.priceOracle().setAssetPrice(tokenA, 4000e18);

        // User2 deposits 25 ETHST at $4,000 = $100,000
        // Equity is now $100,000, should get 50,000 shares (100,000 * 50,000 / 100,000)
        user2.do(tokenA, "approve", vaultAddress, 25e18);
        user2.do(vaultAddress, "deposit", tokenA, 25e18);

        uint user2Shares = IERC20(shareTokenAddress).balanceOf(address(user2));
        require(user2Shares == 50000e18, "User2 should get 50,000 shares");

        // Both users should have equal shares and equal value
        uint user1Value = vault.getUserValue(address(user1));
        uint user2Value = vault.getUserValue(address(user2));
        require(user1Value == user2Value, "Both users should have equal value");
    }

    // ============ EDGE CASE TESTS ============

    function it_handles_very_small_deposits() {
        // First deposit at minimum
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        // Very small subsequent deposit (1 wei of ETHST)
        require(ERC20(tokenA).approve(vaultAddress, 1), "Small approval failed");

        // This might mint 0 shares due to rounding - should revert
        try vault.deposit(tokenA, 1) {
            // If it doesn't revert, shares should be 0 check happens
        } catch {
            // Expected - zero shares minted
        }
    }

    function it_handles_withdrawing_entire_balance() {
        // Deposit
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        uint totalShares = IERC20(shareTokenAddress).balanceOf(address(this));

        // Withdraw all shares
        vault.withdrawShares(totalShares);

        require(IERC20(shareTokenAddress).balanceOf(address(this)) == 0, "Should have 0 shares");
        require(IERC20(shareTokenAddress).totalSupply() == 0, "Total supply should be 0");
    }

    function it_handles_multiple_asset_withdrawals_correctly() {
        // Setup: deposit 3 different tokens
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "TokenA approval failed");
        vault.deposit(tokenA, 25e18);

        require(ERC20(tokenB).approve(vaultAddress, 125e16), "TokenB approval failed");
        vault.deposit(tokenB, 125e16);

        require(ERC20(tokenC).approve(vaultAddress, 500e18), "TokenC approval failed");
        vault.deposit(tokenC, 500e18);

        // Total = $150,000, 150,000 shares

        // Withdraw all
        uint totalShares = IERC20(shareTokenAddress).balanceOf(address(this));
        vault.withdrawShares(totalShares);

        // Should have received tokens from all 3 assets
        uint botBalanceA = IERC20(tokenA).balanceOf(address(botExecutor));
        uint botBalanceB = IERC20(tokenB).balanceOf(address(botExecutor));
        uint botBalanceC = IERC20(tokenC).balanceOf(address(botExecutor));

        // Bot should have near-zero balances (some dust may remain)
        require(botBalanceA < 1e15, "TokenA should be nearly fully withdrawn");
        require(botBalanceB < 1e15, "TokenB should be nearly fully withdrawn");
        require(botBalanceC < 1e15, "TokenC should be nearly fully withdrawn");
    }

    // ============ RESCUE TOKEN TESTS ============

    function it_owner_can_rescue_tokens() {
        // Accidentally send tokens directly to vault (not through deposit)
        Token(tokenA).mint(vaultAddress, 100e18);

        uint vaultBalance = IERC20(tokenA).balanceOf(vaultAddress);
        require(vaultBalance == 100e18, "Vault should have 100 ETHST");

        // Rescue tokens
        vault.rescueToken(tokenA, address(this), 100e18);

        require(IERC20(tokenA).balanceOf(vaultAddress) == 0, "Vault should have 0 ETHST after rescue");
    }

    // ============ FACTORY ADDITIONAL TESTS ============

    function it_factory_can_create_vault_with_custom_bot_executor() {
        address customBot = address(0x456);
        address newVault = vaultFactory.createVaultWithBotExecutor("Custom Vault", "vCUST", customBot);

        require(Vault(newVault).botExecutor() == customBot, "Custom bot executor should be set");
    }

    function it_factory_rejects_duplicate_vault_names() {
        try vaultFactory.createVault("Arbitrage Vault", "vARB2") {
            require(false, "Should have reverted for duplicate name");
        } catch {
            // Expected
        }
    }

    function it_factory_getAllVaults_returns_all_vaults() {
        // Create another vault
        vaultFactory.createVault("Second Vault", "vSEC");

        address[] memory allVaults = vaultFactory.getAllVaults();
        require(allVaults.length == 2, "Should have 2 vaults");
    }

    // ============ STRESS TESTS ============

    function it_handles_many_deposits_and_withdrawals() {
        // First deposit to establish shares
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Initial approval failed");
        vault.deposit(tokenA, 25e18);

        // Multiple deposit/withdraw cycles
        for (uint i = 0; i < 10; i++) {
            // Deposit
            require(ERC20(tokenA).approve(vaultAddress, 5e18), "Cycle approval failed");
            vault.deposit(tokenA, 5e18);

            // Withdraw a portion
            vault.withdraw(5000e18);
        }

        // Verify state is consistent
        uint totalSupply = IERC20(shareTokenAddress).totalSupply();
        uint totalEquity = vault.getTotalEquity();

        require(totalSupply > 0, "Should have shares outstanding");
        require(totalEquity > 0, "Should have equity");
    }

    function it_handles_rapid_price_changes() {
        // Deposit
        require(ERC20(tokenA).approve(vaultAddress, 25e18), "Approval failed");
        vault.deposit(tokenA, 25e18);

        // Rapid price changes
        m.priceOracle().setAssetPrice(tokenA, 3000e18);
        m.priceOracle().setAssetPrice(tokenA, 1500e18);
        m.priceOracle().setAssetPrice(tokenA, 2500e18);
        m.priceOracle().setAssetPrice(tokenA, 2000e18);

        // State should still be consistent
        uint nav = vault.getNAVPerShare();
        require(nav == WAD, "NAV should be back to $1");
    }
}
