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

    uint256 activityId = 1;
    uint256 emissionRate = 100;

    function beforeAll() {
        bypassAuthorizations = true;
        user1 = new User();
        user2 = new User();
    }

    function beforeEach() {
        // Create fresh Mercata infrastructure for each test
        m = new Mercata();
        require(address(m) != address(0), "Mercata address is 0");

        // Deploy reward token
        address tokenAddress = m.tokenFactory().createToken(
            "TestCATA",
            "Test CATA Token",
            [], [], [], "TESTCATA", 0, 18
        );
        require(tokenAddress != address(0), "Token address is 0");
        rewardToken = Token(tokenAddress);

        // Use Rewards from Mercata
        rewards = m.rewards();

        // Whitelist test contract to transfer ownership via adminRegistry voting
        m.adminRegistry().castVoteOnIssue(address(rewards), "transferOwnership", address(this));

        // Transfer ownership to test contract (now whitelisted)
        Ownable(address(rewards)).transferOwnership(address(this));

        // Initialize Rewards contract (now that we own it)
        rewards.initialize(tokenAddress);

        // Add a Position activity - test contract is the allowed caller
        rewards.addActivity(activityId, "Test Activity", ActivityType.Position, emissionRate, address(this), address(this));

        // Fund the Rewards contract with CATA tokens
        uint256 fundingAmount = 1000000 * 1e18;
        rewardToken.mint(address(rewards), fundingAmount);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // IDEMPOTENCY TESTS
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_process_action_with_valid_actionId() {
        // given - initial state
        require(rewards.lastHandledActionId() == 0, "Initial lastHandledActionId should be 0");

        // when - deposit with actionId = 1
        uint256 depositAmount = 100 * 1e18;
        rewards.deposit(1, activityId, address(user1), depositAmount);

        // then - action should be processed
        (uint256 stake, ) = rewards.userInfo(activityId, address(user1));
        require(stake == depositAmount, "Stake should be updated");
        require(rewards.lastHandledActionId() == 1, "lastHandledActionId should be 1");
    }

    function it_should_silently_ignore_duplicate_actionId() {
        // given - first deposit with actionId = 1
        uint256 depositAmount = 100 * 1e18;
        rewards.deposit(1, activityId, address(user1), depositAmount);

        (uint256 stakeAfterFirst, ) = rewards.userInfo(activityId, address(user1));
        require(stakeAfterFirst == depositAmount, "First deposit should be processed");

        // when - try to deposit again with same actionId = 1 (duplicate)
        rewards.deposit(1, activityId, address(user1), depositAmount);

        // then - duplicate should be silently ignored, stake unchanged
        (uint256 stakeAfterDuplicate, ) = rewards.userInfo(activityId, address(user1));
        require(stakeAfterDuplicate == depositAmount, "Stake should remain unchanged after duplicate");
        require(rewards.lastHandledActionId() == 1, "lastHandledActionId should still be 1");
    }

    function it_should_silently_ignore_out_of_order_actionId() {
        // given - deposit with actionId = 5
        uint256 depositAmount = 100 * 1e18;
        rewards.deposit(5, activityId, address(user1), depositAmount);

        require(rewards.lastHandledActionId() == 5, "lastHandledActionId should be 5");

        // when - try to deposit with lower actionId = 3 (out of order)
        rewards.deposit(3, activityId, address(user1), depositAmount);

        // then - out of order action should be silently ignored
        (uint256 stake, ) = rewards.userInfo(activityId, address(user1));
        require(stake == depositAmount, "Stake should remain unchanged after out-of-order action");
        require(rewards.lastHandledActionId() == 5, "lastHandledActionId should still be 5");
    }

    function it_should_process_sequential_actionIds_correctly() {
        // given/when - process multiple actions with sequential actionIds
        uint256 depositAmount = 100 * 1e18;

        rewards.deposit(1, activityId, address(user1), depositAmount);
        require(rewards.lastHandledActionId() == 1, "After action 1");

        rewards.deposit(2, activityId, address(user1), depositAmount);
        require(rewards.lastHandledActionId() == 2, "After action 2");

        rewards.deposit(3, activityId, address(user1), depositAmount);
        require(rewards.lastHandledActionId() == 3, "After action 3");

        // then - all deposits should be processed
        (uint256 stake, ) = rewards.userInfo(activityId, address(user1));
        require(stake == depositAmount * 3, "All three deposits should be processed");
    }

    function it_should_allow_gaps_in_actionIds() {
        // given/when - process actions with gaps in actionIds (1, 5, 100)
        uint256 depositAmount = 100 * 1e18;

        rewards.deposit(1, activityId, address(user1), depositAmount);
        require(rewards.lastHandledActionId() == 1, "After action 1");

        rewards.deposit(5, activityId, address(user1), depositAmount);
        require(rewards.lastHandledActionId() == 5, "After action 5");

        rewards.deposit(100, activityId, address(user1), depositAmount);
        require(rewards.lastHandledActionId() == 100, "After action 100");

        // then - all deposits should be processed
        (uint256 stake, ) = rewards.userInfo(activityId, address(user1));
        require(stake == depositAmount * 3, "All three deposits should be processed");
    }

    function it_should_handle_idempotency_across_different_action_types() {
        // given - deposit with actionId = 1
        uint256 amount = 100 * 1e18;
        rewards.deposit(1, activityId, address(user1), amount);

        // when - withdraw with actionId = 2
        rewards.withdraw(2, activityId, address(user1), amount / 2);

        // then
        (uint256 stake, ) = rewards.userInfo(activityId, address(user1));
        require(stake == amount / 2, "Stake should be 50 after withdraw");
        require(rewards.lastHandledActionId() == 2, "lastHandledActionId should be 2");

        // when - try duplicate withdraw with actionId = 2
        rewards.withdraw(2, activityId, address(user1), amount / 2);

        // then - duplicate should be ignored
        (uint256 stakeAfterDuplicate, ) = rewards.userInfo(activityId, address(user1));
        require(stakeAfterDuplicate == amount / 2, "Stake should remain 50 after duplicate withdraw");
    }

    function it_should_handle_batch_actions_with_idempotency() {
        // given - prepare batch of actions
        Action[] memory actions = new Action[](3);
        actions[0] = Action(1, activityId, address(user1), 100 * 1e18, ActionType.Deposit);
        actions[1] = Action(2, activityId, address(user1), 50 * 1e18, ActionType.Deposit);
        actions[2] = Action(3, activityId, address(user1), 25 * 1e18, ActionType.Deposit);

        // when - process batch
        rewards.batchHandleAction(actions);

        // then - all actions should be processed
        (uint256 stake, ) = rewards.userInfo(activityId, address(user1));
        require(stake == 175 * 1e18, "All batch deposits should be processed");
        require(rewards.lastHandledActionId() == 3, "lastHandledActionId should be 3");

        // when - try to replay same batch
        rewards.batchHandleAction(actions);

        // then - replayed batch should be ignored
        (uint256 stakeAfterReplay, ) = rewards.userInfo(activityId, address(user1));
        require(stakeAfterReplay == 175 * 1e18, "Stake should remain unchanged after batch replay");
    }

    function it_should_handle_partial_batch_replay() {
        // given - process first batch with actionIds 1, 2, 3
        Action[] memory batch1 = new Action[](3);
        batch1[0] = Action(1, activityId, address(user1), 100 * 1e18, ActionType.Deposit);
        batch1[1] = Action(2, activityId, address(user1), 100 * 1e18, ActionType.Deposit);
        batch1[2] = Action(3, activityId, address(user1), 100 * 1e18, ActionType.Deposit);
        rewards.batchHandleAction(batch1);

        (uint256 stakeAfterBatch1, ) = rewards.userInfo(activityId, address(user1));
        require(stakeAfterBatch1 == 300 * 1e18, "First batch should be processed");

        // when - process second batch with actionIds 2, 3, 4, 5 (2,3 are duplicates)
        Action[] memory batch2 = new Action[](4);
        batch2[0] = Action(2, activityId, address(user1), 100 * 1e18, ActionType.Deposit);  // duplicate
        batch2[1] = Action(3, activityId, address(user1), 100 * 1e18, ActionType.Deposit);  // duplicate
        batch2[2] = Action(4, activityId, address(user1), 100 * 1e18, ActionType.Deposit);  // new
        batch2[3] = Action(5, activityId, address(user1), 100 * 1e18, ActionType.Deposit);  // new
        rewards.batchHandleAction(batch2);

        // then - only new actions (4, 5) should be processed
        (uint256 stakeAfterBatch2, ) = rewards.userInfo(activityId, address(user1));
        require(stakeAfterBatch2 == 500 * 1e18, "Only new actions in second batch should be processed");
        require(rewards.lastHandledActionId() == 5, "lastHandledActionId should be 5");
    }

}
