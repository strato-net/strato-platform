// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/IERC20.sol";
import "../../concrete/Tokens/Token.sol";

contract Describe_SafetyModule {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    User user1;
    User user2;

    address USDST;
    address mUSDST;
    address sUSDST;

    SafetyModule sm;

    function beforeAll() {
        // Create test users once
        user1 = new User();
        user2 = new User();
    }

    function beforeEach() {
        // Create fresh Mercata infrastructure for each test
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        // Get SafetyModule
        sm = m.safetyModule();

        // Create tokens
        USDST = m.tokenFactory().createToken("USDST", "USDST Token", [], [], [], "USDST", 0, 18);
        mUSDST = m.tokenFactory().createToken("mUSDST", "mUSDST Token", [], [], [], "mUSDST", 0, 18);
        sUSDST = m.tokenFactory().createToken("sUSDST", "sUSDST Token", [], [], [], "sUSDST", 0, 18);

        require(address(USDST) != address(0), "Failed to create USDST token");
        require(address(mUSDST) != address(0), "Failed to create mUSDST token");
        require(address(sUSDST) != address(0), "Failed to create sUSDST token");

        // Activate tokens
        Token(USDST).setStatus(2);
        Token(mUSDST).setStatus(2);
        Token(sUSDST).setStatus(2);

        // Whitelist tokens
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(m.liquidityPool()));
        Token(mUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(m.liquidityPool()));
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "mint", address(sm));
        Token(sUSDST).addWhitelist(address(m.adminRegistry()), "burn", address(sm));

        // Configure lending pool
        PoolConfigurator configurator = m.poolConfigurator();
        configurator.setBorrowableAsset(USDST);
        configurator.setMToken(mUSDST);

        // Configure SafetyModule
        uint cooldown = 100; // 100 seconds for testing
        uint window = 200;   // 200 seconds window
        uint maxSlashBps = 3000;
        sm.setParams(cooldown, window, maxSlashBps);
        sm.syncFromRegistry();
        sm.setTokens(sUSDST, USDST);


    }

    function require_equal(uint observed, uint expected, string memory message) public {
        require(observed == expected, message + " Got: " + string(observed) + ", expected: " + string(expected));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // COOLDOWN TESTS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_prevent_cooldown_with_no_stake() public {
	// ensure block.timestamp is not 0
        fastForward(10);

        // User has no sUSDST tokens
        require_equal(IERC20(sUSDST).balanceOf(address(user1)), 0, "User should have no sUSDST initially");

        // Try to start cooldown - should fail
        bool reverted = false;
        try user1.do(address(sm), "startCooldown") {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "startCooldown should fail with no stake");
    }

    function it_should_allow_cooldown_after_deposit() public {
	// ensure block.timestamp is not 0
        fastForward(10);

        uint amount = 1000e18;

        // Mint and stake
        Token(USDST).mint(address(user1), amount);
        TestUtils.callAs(user1, USDST, "approve(address, uint256)", address(sm), amount);
        TestUtils.callAs(user1, address(sm), "stake(uint256, uint256)", amount, 0);

        // User should have sUSDST
        uint balance = IERC20(sUSDST).balanceOf(address(user1));
        require(balance > 0, "User should have sUSDST tokens");

        // Start cooldown - should succeed
        user1.do(address(sm), "startCooldown");

        // Verify cooldown was started
        uint cooldownStart = sm.cooldownStart(address(user1));
        require(cooldownStart > 0, "Cooldown should be started");
        require_equal(cooldownStart, block.timestamp, "Cooldown start should be current timestamp");
    }

    function it_should_allow_multiple_cooldown_starts() public {
	// ensure block.timestamp is not 0
        fastForward(10);

        uint amount = 1000e18;

        // Mint and stake
        Token(USDST).mint(address(user1), amount);
        TestUtils.callAs(user1, USDST, "approve(address, uint256)", address(sm), amount);
        TestUtils.callAs(user1, address(sm), "stake(uint256, uint256)", amount, 0);

        // Start cooldown first time
        user1.do(address(sm), "startCooldown");
        uint firstCooldownStart = sm.cooldownStart(address(user1));
        require(firstCooldownStart > 0, "Should have initial cooldown");

        // Fast forward time
        fastForward(10);

        // Start cooldown again - should update the timestamp
        user1.do(address(sm), "startCooldown");
        uint secondCooldownStart = sm.cooldownStart(address(user1));
        require(secondCooldownStart > firstCooldownStart, "Cooldown should be updated to later timestamp");
    }

    function it_should_prevent_cooldown_after_transferring_all_tokens() public {
	// ensure block.timestamp is not 0
        fastForward(10);

        uint amount = 1000e18;

        // Mint and stake
        Token(USDST).mint(address(user1), amount);
        TestUtils.callAs(user1, USDST, "approve(address, uint256)", address(sm), amount);
        TestUtils.callAs(user1, address(sm), "stake(uint256, uint256)", amount, 0);

        // User transfers all sUSDST to another address
        uint balance = IERC20(sUSDST).balanceOf(address(user1));
        TestUtils.callAs(user1, sUSDST, "transfer(address, uint256)", address(user2), balance);

        require_equal(IERC20(sUSDST).balanceOf(address(user1)), 0, "User should have no sUSDST after transfer");

        // Try to start cooldown - should fail
        bool reverted = false;
        try user1.do(address(sm), "startCooldown") {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "startCooldown should fail after transferring all tokens");
    }
}
