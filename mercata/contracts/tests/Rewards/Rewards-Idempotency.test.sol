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

        ActionableEvent[] memory events = new ActionableEvent[](2);
        events[0] = ActionableEvent("Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("Withdraw", ActionType.Withdraw);
        rewards.addPositionActivity(liquidityActivityId, "Lending Pool Liquidity", liquidityEmissionRate, address(this), address(this), events);

        uint256 fundingAmount = 1000000 * 1e18;
        rewardToken.mint(address(rewards), fundingAmount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Duplicate events in same block are silently ignored
    // Hash is calculated from keccak256(blockNumber, eventIndex)
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_ignore_duplicate_event_in_same_block() {
        // given - user1 deposits 1000 units in block 100, eventIndex 0
        uint256 depositAmount = 1000 * 1e18;
        uint256 blockNum = 100;
        uint256 eventIndex = 0;
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, eventIndex));

        // when - the same event is sent again (same blockNumber and eventIndex)
        // This simulates a duplicate event from the indexer
        // Hash = keccak256(blockNumber, eventIndex) - same = duplicate
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, eventIndex));

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
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, newerBlock, 0));

        // when - an event from an older block (100) arrives late
        // This simulates out-of-order or replayed old events
        rewards.handleAction(Action(address(this), "Deposit", address(user1), 500 * 1e18, olderBlock, 0));

        // then - user's stake should still be 1000 (old block event ignored)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount, "Old block event should be ignored - stake should be 1000, not 1500");

        // then - currentBlock should still be 200
        require(rewards.currentBlockHandled() == newerBlock, "currentBlock should remain at 200");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Hash set is cleared when moving to a new block
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_clear_hash_set_when_moving_to_new_block() {
        // given - process event in block 100, eventIndex 0
        uint256 depositAmount = 500 * 1e18;
        uint256 block100 = 100;
        uint256 block101 = 101;

        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, block100, 0));

        // when - move to block 101 with same eventIndex (0)
        // Since blockNumber is part of the hash, this produces a different hash
        // Hash set is also cleared when moving to a new block
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, block101, 0));

        // then - user's stake should be 1000 (both deposits processed)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount * 2, "Events in different blocks should both be processed");

        // then - currentBlock should be 101
        require(rewards.currentBlockHandled() == block101, "currentBlock should be 101");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Different eventIndex in same block are all processed
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_process_different_hashes_in_same_block() {
        // given - multiple events with different eventIndex in the same block
        uint256 blockNum = 100;
        uint256 depositAmount = 100 * 1e18;

        // when - process 5 different events in the same block with different eventIndex
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 0));
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 1));
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 2));
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 3));
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 4));

        // then - all 5 deposits should be processed (total 500)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == 500 * 1e18, "All unique events in same block should be processed");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Withdraw is also idempotent
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_handle_withdraw_idempotently() {
        // given - user deposits 1000 units
        uint256 depositAmount = 1000 * 1e18;
        uint256 withdrawAmount = 400 * 1e18;
        uint256 blockNum = 100;
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 0));

        // when - withdraw 400 units with eventIndex 1
        rewards.handleAction(Action(address(this), "Withdraw", address(user1), withdrawAmount, blockNum, 1));

        // when - duplicate withdraw event (same blockNumber and eventIndex = same hash)
        rewards.handleAction(Action(address(this), "Withdraw", address(user1), withdrawAmount, blockNum, 1));

        // then - stake should be 600 (1000 - 400), not 200 (1000 - 400 - 400)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == depositAmount - withdrawAmount, "Duplicate withdraw should be ignored");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Batch actions also respect idempotency
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_handle_batch_actions_idempotently() {
        // given - prepare a batch of actions with some duplicates
        // Same blockNumber + eventIndex = same hash = duplicate
        uint256 blockNum = 100;
        uint256 depositAmount = 100 * 1e18;

        Action[] memory actions = new Action[](4);
        actions[0] = Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 0);
        actions[1] = Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 1);
        actions[2] = Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 0); // duplicate of actions[0]
        actions[3] = Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 2);

        // when - process batch
        rewards.batchHandleAction(actions);

        // then - only 3 unique events should be processed (eventIndex 0, 1, 2)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == 300 * 1e18, "Batch should ignore duplicate hashes");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY: Emergency override resets state
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_allow_owner_to_emergency_override() {
        // given - process some events in block 100
        uint256 blockNum = 100;
        uint256 depositAmount = 100 * 1e18;
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 0));
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 1));

        require(rewards.currentBlockHandled() == 100, "currentBlockHandled should be 100");

        // when - owner calls emergencyOverride to reset to block 50
        rewards.emergencyOverride(50);

        // then - currentBlockHandled should be 50
        require(rewards.currentBlockHandled() == 50, "currentBlockHandled should be reset to 50");

        // then - old hashes should be cleared, so same blockNumber+eventIndex can be reprocessed
        rewards.handleAction(Action(address(this), "Deposit", address(user1), depositAmount, blockNum, 0));

        // then - stake should be 300 (original 100 + 100 + new 100)
        (uint256 stake, uint256 userIndex) = rewards.userInfo(liquidityActivityId, address(user1));
        require(stake == 300 * 1e18, "Hash should be reprocessed after emergency override");
    }

    function it_should_prevent_non_owner_from_emergency_override() {
        // given - some state exists
        rewards.handleAction(Action(address(this), "Deposit", address(user1), 100 * 1e18, 100, 0));

        // when - non-owner tries to call emergencyOverride
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "emergencyOverride(uint256)", 50) {
            reverted = false;
        } catch {
            reverted = true;
        }

        // then - should revert
        require(reverted, "Non-owner should not be able to call emergencyOverride");
    }

}
