// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Rewards/Rewards.sol";

contract Describe_Rewards_Idempotency is Authorizable {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    Token rewardToken;
    Rewards rewards;
    User user1;
    User user2;

    uint256 liquidityActivityId = 1;
    uint256 liquidityEmissionRate = 900;

    function beforeAll() {
        bypassAuthorizations = true;
        user1 = new User();
        user2 = new User();
    }

    function beforeEach() {
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        address tokenAddress = m.tokenFactory().createToken(
            "TestCATA",
            "Test CATA Token",
            [], [], [], "TESTCATA", 0, 18
        );
        require(tokenAddress != address(0), "Token address is 0");
        rewardToken = Token(tokenAddress);

        rewards = new Rewards(address(this));
        rewards.initialize(tokenAddress);

        rewards.addActivity(liquidityActivityId, "Lending Pool Liquidity", ActivityType.Position, liquidityEmissionRate, address(this), address(this));

        uint256 fundingAmount = 1000000 * 1e18;
        rewardToken.mint(address(rewards), fundingAmount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Duplicate events in same block are silently ignored
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_ignore_duplicate_event_in_same_block() {
        // given - user1 deposits 1000 units with eventHash=42 in block 100
        uint256 depositAmount = 1000 * 1e18;
        uint256 blockNum = 100;
        uint256 eventHash = 42;
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, eventHash);

        // when - the same event is sent again (same blockNumber and eventHash)
        // This simulates a duplicate event from the indexer
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, eventHash);

        // then - user's stake should only be 1000 (not 2000), proving the duplicate was ignored
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount, "Duplicate event should be ignored - stake should be 1000, not 2000");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Old block events are silently ignored
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_ignore_old_block_events() {
        // given - process an event in block 200
        uint256 depositAmount = 1000 * 1e18;
        uint256 newerBlock = 200;
        uint256 olderBlock = 100;
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, newerBlock, 1);

        // when - an event from an older block (100) arrives late
        // This simulates out-of-order or replayed old events
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, olderBlock, 2);

        // then - user's stake should still be 1000 (old block event ignored)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount, "Old block event should be ignored - stake should be 1000, not 2000");

        // then - currentBlock should still be 200
        require(rewards.currentBlockHandled() == newerBlock, "currentBlock should remain at 200");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Hash set is cleared when moving to a new block
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_clear_hash_set_when_moving_to_new_block() {
        // given - process event with hash=42 in block 100
        uint256 depositAmount = 500 * 1e18;
        uint256 block100 = 100;
        uint256 block101 = 101;
        uint256 eventHash = 42;

        rewards.deposit(liquidityActivityId, address(user1), depositAmount, block100, eventHash);

        // when - move to block 101 and use the SAME eventHash (42)
        // This should work because hash set is cleared when moving to a new block
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, block101, eventHash);

        // then - user's stake should be 1000 (both deposits processed)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount * 2, "Same hash in different blocks should both be processed");

        // then - currentBlock should be 101
        require(rewards.currentBlockHandled() == block101, "currentBlock should be 101");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Different hashes in same block are all processed
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_process_different_hashes_in_same_block() {
        // given - multiple events with different hashes in the same block
        uint256 depositAmount = 100 * 1e18;
        uint256 blockNum = 100;

        // when - process 5 different events in the same block
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, 1);
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, 2);
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, 3);
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, 4);
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, 5);

        // then - all 5 deposits should be processed (total 500)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount * 5, "All unique events in same block should be processed");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Withdraw is also idempotent
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_handle_withdraw_idempotently() {
        // given - user deposits 1000 units
        uint256 depositAmount = 1000 * 1e18;
        uint256 withdrawAmount = 400 * 1e18;
        uint256 blockNum = 100;
        rewards.deposit(liquidityActivityId, address(user1), depositAmount, blockNum, 1);

        // when - withdraw with eventHash=2
        rewards.withdraw(liquidityActivityId, address(user1), withdrawAmount, blockNum, 2);

        // when - duplicate withdraw event (same hash)
        rewards.withdraw(liquidityActivityId, address(user1), withdrawAmount, blockNum, 2);

        // then - stake should be 600 (1000 - 400), not 200 (1000 - 400 - 400)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount - withdrawAmount, "Duplicate withdraw should be ignored");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Batch actions also respect idempotency
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_handle_batch_actions_idempotently() {
        // given - prepare a batch of actions with some duplicates
        uint256 depositAmount = 100 * 1e18;
        uint256 blockNum = 100;

        Action[] memory actions = new Action[](4);
        actions[0] = Action(liquidityActivityId, address(user1), depositAmount, ActionType.Deposit, blockNum, 1);
        actions[1] = Action(liquidityActivityId, address(user1), depositAmount, ActionType.Deposit, blockNum, 2);
        actions[2] = Action(liquidityActivityId, address(user1), depositAmount, ActionType.Deposit, blockNum, 1); // duplicate
        actions[3] = Action(liquidityActivityId, address(user1), depositAmount, ActionType.Deposit, blockNum, 3);

        // when - process batch
        rewards.batchHandleAction(actions);

        // then - only 3 unique events should be processed (hashes 1, 2, 3)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount * 3, "Batch should ignore duplicate hashes");
    }

}
