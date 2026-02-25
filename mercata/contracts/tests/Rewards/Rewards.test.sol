// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";

contract Describe_RewardsDirectPayout is Authorizable {
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
        bypassAuthorizations = true;
        owner = new User();
        user1 = new User();
        user2 = new User();
        sourceContract = address(0xBEEF);
        eventName = "BonusApplied";

        Rewards rewards = new Rewards(address(this));
        rewardsAddr = address(rewards);
        require(rewardsAddr != address(0), "Rewards address is 0");

        m = new Mercata();

        rewardTokenAddr = m.tokenFactory().createToken(
            "TestCATA", "Test CATA Token", [], [], [], "TCATA", 0, 18
        );

        address(rewardsAddr).call("initialize", rewardTokenAddr);
        Token(rewardTokenAddr).mint(rewardsAddr, 1000000 * 1e18);
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
