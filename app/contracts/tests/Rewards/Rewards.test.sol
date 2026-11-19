// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract Describe_RewardsDirectPayout {
    using TestUtils for User;

    constructor() {}

    Mercata m;
    User owner;
    User user1;
    User user2;
    address sourceContract;
    string eventName;
    address rewardsAddr;
    address rewardTokenAddr;

    function beforeAll() {
        owner = new User();
        user1 = new User();
        user2 = new User();
        sourceContract = address(0xBEEF);
        eventName = "BonusApplied";

        Rewards rewards = new Rewards(address(this));
        rewardsAddr = address(rewards);
        require(rewardsAddr != address(0), "Rewards address is 0");

        m = new Mercata();

        (bool executed, variadic ret) = m.adminRegistry().castVoteOnIssue(address(m.tokenFactory()), "createToken",
            "TestCATA", "Test CATA Token", [], [], [], "TCATA", 0, 18
        );
        rewardTokenAddr = address(ret);

        address(rewardsAddr).call("initialize", rewardTokenAddr);
        m.adminRegistry().castVoteOnIssue(rewardTokenAddr, "mint", rewardsAddr, 1000000 * 1e18);
        Ownable(rewardsAddr).transferOwnership(address(owner));
        owner.do(rewardsAddr, "addOneTimeDirectPayoutActivity", "BonusReward", sourceContract, eventName);
    }

    function _getUnclaimed(address user) internal returns (uint256) {
        return address(rewardsAddr).call("unclaimedRewards", user);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // DIRECT PAYOUT
    // ═════════════════════════════════════════════════════════════════════════

    function it_aa_direct_payout_credits_unclaimed_rewards() {
        uint256 before = _getUnclaimed(address(user1));
        uint256 amount = 500 * 1e18;
        owner.do(rewardsAddr, "handleAction", sourceContract, eventName, address(user1), amount, uint256(0), uint256(0));
        require(_getUnclaimed(address(user1)) == before + amount, "Unclaimed rewards should increase by payout amount");
    }

    function it_ab_direct_payout_accumulates_multiple_payouts() {
        uint256 before = _getUnclaimed(address(user1));
        uint256 amount1 = 100 * 1e18;
        uint256 amount2 = 250 * 1e18;
        owner.do(rewardsAddr, "handleAction", sourceContract, eventName, address(user1), amount1, uint256(0), uint256(0));
        owner.do(rewardsAddr, "handleAction", sourceContract, eventName, address(user1), amount2, uint256(0), uint256(0));
        require(_getUnclaimed(address(user1)) == before + amount1 + amount2, "Unclaimed rewards should accumulate");
    }

    function it_ac_direct_payout_skips_zero_amount() {
        uint256 before = _getUnclaimed(address(user1));
        owner.do(rewardsAddr, "handleAction", sourceContract, eventName, address(user1), uint256(0), uint256(0), uint256(0));
        require(_getUnclaimed(address(user1)) == before, "Zero amount should not change rewards");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BATCH DIRECT PAYOUT
    // ═════════════════════════════════════════════════════════════════════════

    function it_ad_batch_handles_direct_payout_actions() {
        uint256 before1 = _getUnclaimed(address(user1));
        uint256 before2 = _getUnclaimed(address(user2));
        uint256 amount1 = 300 * 1e18;
        uint256 amount2 = 700 * 1e18;

        address[] memory srcs = new address[](2);
        srcs[0] = sourceContract;
        srcs[1] = sourceContract;

        string[] memory evts = new string[](2);
        evts[0] = eventName;
        evts[1] = eventName;

        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = amount1;
        amounts[1] = amount2;

        uint256[] memory blks = new uint256[](2);
        blks[0] = 0;
        blks[1] = 0;

        uint256[] memory indexes = new uint256[](2);
        indexes[0] = 0;
        indexes[1] = 0;

        owner.do(rewardsAddr, "batchHandleAction", srcs, evts, users, amounts, blks, indexes);

        require(_getUnclaimed(address(user1)) == before1 + amount1, "User1 unclaimed should increase");
        require(_getUnclaimed(address(user2)) == before2 + amount2, "User2 unclaimed should increase");
    }

    function it_ae_batch_rejects_array_length_mismatch() {
        address[] memory srcs = new address[](2);
        srcs[0] = sourceContract;
        srcs[1] = sourceContract;

        string[] memory evts = new string[](1);
        evts[0] = eventName;

        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100;
        amounts[1] = 200;

        uint256[] memory blks = new uint256[](2);
        blks[0] = 0;
        blks[1] = 0;

        uint256[] memory indexes = new uint256[](2);
        indexes[0] = 0;
        indexes[1] = 0;

        try owner.do(rewardsAddr, "batchHandleAction", srcs, evts, users, amounts, blks, indexes) {
            require(false, "Should have reverted on array length mismatch");
        } catch {
        }
    }

    function it_af_batch_rejects_exceeding_max_batch_size() {
        owner.do(rewardsAddr, "setMaxBatchSize", uint256(1));

        address[] memory srcs = new address[](2);
        srcs[0] = sourceContract;
        srcs[1] = sourceContract;

        string[] memory evts = new string[](2);
        evts[0] = eventName;
        evts[1] = eventName;

        address[] memory users = new address[](2);
        users[0] = address(user1);
        users[1] = address(user2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 100;
        amounts[1] = 200;

        uint256[] memory blks = new uint256[](2);
        blks[0] = 0;
        blks[1] = 0;

        uint256[] memory indexes = new uint256[](2);
        indexes[0] = 0;
        indexes[1] = 0;

        try owner.do(rewardsAddr, "batchHandleAction", srcs, evts, users, amounts, blks, indexes) {
            require(false, "Should have reverted on batch too large");
        } catch {
        }

        // Reset maxBatchSize for subsequent tests
        owner.do(rewardsAddr, "setMaxBatchSize", uint256(500));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // CLAIM AFTER DIRECT PAYOUT
    // ═════════════════════════════════════════════════════════════════════════

    function it_ag_can_claim_direct_payout_rewards() {
        uint256 amount = 1000 * 1e18;
        owner.do(rewardsAddr, "handleAction", sourceContract, eventName, address(user1), amount, uint256(0), uint256(0));

        uint256 unclaimed = _getUnclaimed(address(user1));
        require(unclaimed > 0, "Should have unclaimed before claim");

        uint256 balanceBefore = Token(rewardTokenAddr).balanceOf(address(user1));
        TestUtils.callAs(user1, rewardsAddr, "claimAllRewards()");
        uint256 balanceAfter = Token(rewardTokenAddr).balanceOf(address(user1));

        require(_getUnclaimed(address(user1)) == 0, "Unclaimed should be 0 after claim");
        require(balanceAfter - balanceBefore == unclaimed, "User should receive all unclaimed reward tokens");
    }
}

contract Describe_RewardsTransfer {
    using TestUtils for User;

    constructor() {}

    Rewards rewards;
    User user1;
    User user2;
    address vault;
    address emissionVault;
    address rewardTokenAddr;
    uint256 activityId;
    uint256 emissionActivityId;
    uint256 nextBlock;

    function beforeAll() {
        user1 = new User();
        user2 = new User();
        vault = address(0xCAFE);
        emissionVault = address(0xD00D);
        nextBlock = 1;

        rewards = new Rewards(address(this));
        Mercata m = new Mercata();
        (bool executed, variadic ret) = m.adminRegistry().castVoteOnIssue(address(m.tokenFactory()), "createToken",
            "TestCATA", "Test CATA Token", [], [], [], "TCATA", 0, 18
        );
        rewardTokenAddr = address(ret);
        rewards.initialize(rewardTokenAddr);
        m.adminRegistry().castVoteOnIssue(rewardTokenAddr, "mint", address(rewards), 1000000 * 1e18);

        activityId = _addTransferableActivity("Vault Shares", vault);
        emissionActivityId = _addTransferableActivity("Emitting Vault Shares", emissionVault);
    }

    function _addTransferableActivity(string name, address source) internal returns (uint256) {
        ActionableEvent[] events = new ActionableEvent[](3);
        events[0] = ActionableEvent("Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("Withdraw", ActionType.Withdraw);
        events[2] = ActionableEvent("Transfer", ActionType.Transfer);
        return rewards.addPositionActivity(name, 0, source, events);
    }

    function _nextBlock() internal returns (uint256) {
        uint256 blockNumber = nextBlock;
        nextBlock = nextBlock + 1;
        return blockNumber;
    }

    function _stake(uint256 id, address user) internal returns (uint256) {
        (uint256 stake, uint256 userIndex) = rewards.userInfo(user, id);
        return stake;
    }

    function _totalStake(uint256 id) internal returns (uint256) {
        (uint256 accRewardPerStake, uint256 lastUpdateTime, uint256 totalStake) = rewards.activityStates(id);
        return totalStake;
    }

    function _deposit(address source, address user, uint256 amount) internal {
        rewards.handleAction(source, "Deposit", user, amount, _nextBlock(), uint256(0));
    }

    function _transfer(address source, address sender, address recipient, uint256 amount) internal returns (uint256) {
        uint256 blockNumber = _nextBlock();
        rewards.handleTransfer(source, "Transfer", sender, recipient, amount, blockNumber, uint256(0));
        return blockNumber;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TRANSFER
    // ═════════════════════════════════════════════════════════════════════════

    function it_aa_transfer_moves_stake_from_sender_to_recipient() {
        _deposit(vault, address(user1), 100);
        uint256 totalBefore = _totalStake(activityId);

        _transfer(vault, address(user1), address(user2), 40);

        require(_stake(activityId, address(user1)) == 60, "Sender stake should decrease by the transferred amount");
        require(_stake(activityId, address(user2)) == 40, "Recipient stake should increase by the transferred amount");
        require(_totalStake(activityId) == totalBefore, "Total stake should be unchanged by a transfer");
    }

    function it_ab_transfer_replay_is_idempotent() {
        uint256 blockNumber = _transfer(vault, address(user1), address(user2), 10);
        uint256 senderStake = _stake(activityId, address(user1));
        uint256 recipientStake = _stake(activityId, address(user2));

        rewards.handleTransfer(vault, "Transfer", address(user1), address(user2), 10, blockNumber, uint256(0));
        rewards.handleTransfer(vault, "Transfer", address(user1), address(user2), 25, blockNumber, uint256(0));

        require(_stake(activityId, address(user1)) == senderStake, "Replayed transfer should not change sender stake");
        require(_stake(activityId, address(user2)) == recipientStake, "Replayed transfer should not change recipient stake");
    }

    function it_ac_transfer_consumes_the_source_event_key() {
        uint256 recipientStake = _stake(activityId, address(user2));
        uint256 blockNumber = _transfer(vault, address(user1), address(user2), 5);

        // A Deposit relayed under the same (blockNumber, eventIndex) is the same source event
        rewards.handleAction(vault, "Deposit", address(user2), 999, blockNumber, uint256(0));

        require(_stake(activityId, address(user2)) == recipientStake + 5, "One source event must be applied once");
    }

    function it_ad_transfer_caps_at_sender_tracked_stake() {
        User sender = new User();
        User recipient = new User();
        _deposit(vault, address(sender), 10);
        uint256 totalBefore = _totalStake(activityId);

        _transfer(vault, address(sender), address(recipient), 25);

        require(_stake(activityId, address(sender)) == 0, "Sender stake should floor at zero");
        require(_stake(activityId, address(recipient)) == 10, "Recipient should receive only the tracked stake");
        require(_totalStake(activityId) == totalBefore, "Total stake should be unchanged when capped");
    }

    function it_ae_untracked_sender_moves_nothing() {
        User sender = new User();
        User recipient = new User();
        uint256 totalBefore = _totalStake(activityId);

        _transfer(vault, address(sender), address(recipient), 25);

        require(_stake(activityId, address(sender)) == 0, "Untracked sender stays at zero");
        require(_stake(activityId, address(recipient)) == 0, "Recipient of untracked shares earns no stake");
        require(_totalStake(activityId) == totalBefore, "Total stake should be unchanged");
    }

    function it_af_self_and_zero_amount_transfers_change_nothing() {
        uint256 senderStake = _stake(activityId, address(user1));
        uint256 recipientStake = _stake(activityId, address(user2));
        uint256 totalBefore = _totalStake(activityId);

        _transfer(vault, address(user1), address(user1), 30);
        _transfer(vault, address(user1), address(user2), 0);

        require(_stake(activityId, address(user1)) == senderStake, "Self/zero transfers should not change sender stake");
        require(_stake(activityId, address(user2)) == recipientStake, "Zero transfer should not change recipient stake");
        require(_totalStake(activityId) == totalBefore, "Total stake should be unchanged");
    }

    function it_ag_transfer_below_min_amount_is_skipped() {
        _deposit(vault, address(user1), 100);
        rewards.setActivityMinAmount(activityId, 50);
        uint256 senderStake = _stake(activityId, address(user1));
        uint256 recipientStake = _stake(activityId, address(user2));

        _transfer(vault, address(user1), address(user2), 20);
        require(_stake(activityId, address(user2)) == recipientStake, "Transfer below minAmount should be ignored");

        _transfer(vault, address(user1), address(user2), 50);
        require(_stake(activityId, address(user1)) == senderStake - 50, "Transfer at minAmount should apply to sender");
        require(_stake(activityId, address(user2)) == recipientStake + 50, "Transfer at minAmount should apply to recipient");

        rewards.setActivityMinAmount(activityId, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // REWARD SETTLEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function it_ah_transfer_settles_both_users_at_the_same_index() {
        User sender = new User();
        User recipient = new User();
        rewards.setEmissionRate(emissionActivityId, 1e18); // 1 CATA per second
        _deposit(emissionVault, address(sender), 100);
        _deposit(emissionVault, address(recipient), 100);

        fastForward(100); // 100 CATA split 50/50
        _transfer(emissionVault, address(sender), address(recipient), 50);

        require(rewards.unclaimedRewards(address(sender)) == 50e18, "Sender's pre-transfer rewards settle at the transfer");
        require(rewards.unclaimedRewards(address(recipient)) == 50e18, "Recipient's pre-transfer rewards settle at the same index");

        fastForward(100); // 100 CATA split 25/75 on stakes 50/150
        TestUtils.callAs(sender, address(rewards), "claimAllRewards()");
        TestUtils.callAs(recipient, address(rewards), "claimAllRewards()");

        require(Token(rewardTokenAddr).balanceOf(address(sender)) == 75e18, "Sender: 50 before + 25 after the transfer");
        require(Token(rewardTokenAddr).balanceOf(address(recipient)) == 125e18, "Recipient: 50 before + 75 after the transfer");

        rewards.setEmissionRate(emissionActivityId, 0);
    }

    // ═════════════════════════════════════════════════════════════════════════
    // BATCH TRANSFER
    // ═════════════════════════════════════════════════════════════════════════

    function it_ai_batch_transfer_processes_all_and_isolates_failures() {
        User sender1 = new User();
        User sender2 = new User();
        User recipient = new User();
        _deposit(vault, address(sender1), 100);
        _deposit(vault, address(sender2), 100);
        uint256 totalBefore = _totalStake(activityId);

        address[] memory srcs = new address[](3);
        srcs[0] = vault;
        srcs[1] = address(0xBAD); // unknown source: fails without aborting the batch
        srcs[2] = vault;

        string[] memory evts = new string[](3);
        evts[0] = "Transfer";
        evts[1] = "Transfer";
        evts[2] = "Transfer";

        address[] memory senders = new address[](3);
        senders[0] = address(sender1);
        senders[1] = address(sender1);
        senders[2] = address(sender2);

        address[] memory recipients = new address[](3);
        recipients[0] = address(recipient);
        recipients[1] = address(recipient);
        recipients[2] = address(recipient);

        uint256[] memory amounts = new uint256[](3);
        amounts[0] = 10;
        amounts[1] = 10;
        amounts[2] = 20;

        uint256[] memory blks = new uint256[](3);
        blks[0] = _nextBlock();
        blks[1] = _nextBlock();
        blks[2] = _nextBlock();

        uint256[] memory indexes = new uint256[](3);
        indexes[0] = 0;
        indexes[1] = 0;
        indexes[2] = 0;

        rewards.batchHandleTransfer(srcs, evts, senders, recipients, amounts, blks, indexes);

        require(_stake(activityId, address(sender1)) == 90, "First transfer should apply");
        require(_stake(activityId, address(sender2)) == 80, "Transfer after the failed one should apply");
        require(_stake(activityId, address(recipient)) == 30, "Recipient should receive both valid transfers");
        require(_totalStake(activityId) == totalBefore, "Total stake should be unchanged by the batch");
    }

    function it_aj_batch_transfer_rejects_array_length_mismatch() {
        address[] memory srcs = new address[](2);
        srcs[0] = vault;
        srcs[1] = vault;

        string[] memory evts = new string[](2);
        evts[0] = "Transfer";
        evts[1] = "Transfer";

        address[] memory senders = new address[](1);
        senders[0] = address(user1);

        address[] memory recipients = new address[](2);
        recipients[0] = address(user2);
        recipients[1] = address(user2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        uint256[] memory blks = new uint256[](2);
        blks[0] = _nextBlock();
        blks[1] = _nextBlock();

        uint256[] memory indexes = new uint256[](2);
        indexes[0] = 0;
        indexes[1] = 0;

        try rewards.batchHandleTransfer(srcs, evts, senders, recipients, amounts, blks, indexes) {
            require(false, "Should have reverted on array length mismatch");
        } catch {
        }
    }

    function it_ak_batch_transfer_rejects_exceeding_max_batch_size() {
        rewards.setMaxBatchSize(uint256(1));

        address[] memory srcs = new address[](2);
        srcs[0] = vault;
        srcs[1] = vault;

        string[] memory evts = new string[](2);
        evts[0] = "Transfer";
        evts[1] = "Transfer";

        address[] memory senders = new address[](2);
        senders[0] = address(user1);
        senders[1] = address(user1);

        address[] memory recipients = new address[](2);
        recipients[0] = address(user2);
        recipients[1] = address(user2);

        uint256[] memory amounts = new uint256[](2);
        amounts[0] = 1;
        amounts[1] = 1;

        uint256[] memory blks = new uint256[](2);
        blks[0] = _nextBlock();
        blks[1] = _nextBlock();

        uint256[] memory indexes = new uint256[](2);
        indexes[0] = 0;
        indexes[1] = 0;

        try rewards.batchHandleTransfer(srcs, evts, senders, recipients, amounts, blks, indexes) {
            require(false, "Should have reverted on batch too large");
        } catch {
        }

        // Reset maxBatchSize for subsequent tests
        rewards.setMaxBatchSize(uint256(500));
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GUARDS
    // ═════════════════════════════════════════════════════════════════════════

    function it_al_handle_action_rejects_transfer_routes() {
        uint256 senderStake = _stake(activityId, address(user1));
        uint256 blockNumber = _nextBlock();
        string rejection;

        try rewards.handleAction(vault, "Transfer", address(user1), 10, blockNumber, uint256(0)) {
            require(false, "handleAction should reject a Transfer route");
        } catch Error(string e) {
            rejection = e;
        }
        TestUtils.assertErrorMessage(rejection, "Use handleTransfer for transfer events", "handleAction");
        require(_stake(activityId, address(user1)) == senderStake, "Rejected action must not change stake");

        // The rejected call must not have consumed the event key
        rewards.handleTransfer(vault, "Transfer", address(user1), address(user2), 10, blockNumber, uint256(0));
        require(_stake(activityId, address(user1)) == senderStake - 10, "Transfer should apply after the rejected action");
    }

    function it_am_handle_transfer_rejects_non_transfer_routes_and_zero_addresses() {
        uint256 senderStake = _stake(activityId, address(user1));
        uint256 recipientStake = _stake(activityId, address(user2));

        try rewards.handleTransfer(vault, "Deposit", address(user1), address(user2), 10, _nextBlock(), uint256(0)) {
            require(false, "A Deposit route is not a transfer event");
        } catch {
        }
        try rewards.handleTransfer(vault, "Transfer", address(0), address(user2), 10, _nextBlock(), uint256(0)) {
            require(false, "Zero sender should be rejected");
        } catch {
        }
        try rewards.handleTransfer(vault, "Transfer", address(user1), address(0), 10, _nextBlock(), uint256(0)) {
            require(false, "Zero recipient should be rejected");
        } catch {
        }
        try rewards.handleTransfer(address(0xBAD), "Transfer", address(user1), address(user2), 10, _nextBlock(), uint256(0)) {
            require(false, "Unknown source should be rejected");
        } catch {
        }

        require(_stake(activityId, address(user1)) == senderStake, "Rejected transfers must not change sender stake");
        require(_stake(activityId, address(user2)) == recipientStake, "Rejected transfers must not change recipient stake");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // GOVERNANCE
    // ═════════════════════════════════════════════════════════════════════════

    function it_an_set_position_activity_events_can_register_transfer() {
        address lateVault = address(0xFEED);
        uint256 lateActivityId = rewards.addPositionActivitySimple("Late Vault", 0, lateVault, "Deposit", "Withdraw");

        ActionableEvent[] events = new ActionableEvent[](3);
        events[0] = ActionableEvent("Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("Withdraw", ActionType.Withdraw);
        events[2] = ActionableEvent("Transfer", ActionType.Transfer);
        rewards.setPositionActivityEvents(lateActivityId, events);

        _deposit(lateVault, address(user1), 30);
        _transfer(lateVault, address(user1), address(user2), 30);

        require(_stake(lateActivityId, address(user1)) == 0, "Sender stake moved on the late-registered route");
        require(_stake(lateActivityId, address(user2)) == 30, "Recipient stake received on the late-registered route");
    }

    function it_ao_deposit_and_withdraw_are_unaffected() {
        User user = new User();
        _deposit(vault, address(user), 50);
        rewards.handleAction(vault, "Withdraw", address(user), 20, _nextBlock(), uint256(0));
        require(_stake(activityId, address(user)) == 30, "Withdraw should decrease stake");

        rewards.handleAction(vault, "Withdraw", address(user), 100, _nextBlock(), uint256(0));
        require(_stake(activityId, address(user)) == 0, "Withdraw exceeding stake should floor at zero");
    }
}
