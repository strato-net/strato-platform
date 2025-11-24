// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../Util.sol";
import "../../abstract/ERC20/access/Authorizable.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../concrete/Rewards/Rewards.sol";

contract Describe_Rewards_Management is Authorizable {
    using TestUtils for User;

    constructor() {
    }

    Mercata m;
    Token rewardToken;
    Rewards rewards;
    User user1;
    User user2;

    function beforeAll() {
        bypassAuthorizations = true;
        // Create test users once
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
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ACTIVITY MANAGEMENT
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_start_with_no_activities() {
        // then
        require(rewards.activityIds(0) == 0, "Activity IDs array should be empty");
        require(rewards.totalRewardsEmission() == 0, "Total rewards emission should be 0");
    }

    function it_should_allow_adding_new_activity() {
        // given
        uint256 activityId = 1;
        string memory name = "SwapPool-USDST/ETHST";
        uint256 emissionRate = 100;
        address allowedCaller = address(user1);

        // when
        rewards.addActivity(activityId, name, ActivityType.Position, emissionRate, allowedCaller);

        // then
        (string memory activityName, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller) =
            rewards.activities(activityId);

        require(keccak256(bytes(activityName)) == keccak256(bytes(name)), "Activity name should match");
        require(activityType == ActivityType.Position, "Activity type should match");
        require(rate == emissionRate, "Emission rate should match");
        require(accReward == 0, "Initial accRewardPerStake should be 0");
        require(lastUpdate == block.timestamp, "lastUpdateTime should be set to block.timestamp");
        require(totalStake == 0, "Initial totalStake should be 0");
        require(caller == allowedCaller, "Allowed caller should match");
        require(rewards.activityIds(0) == activityId, "Activity ID should be added to array");
        require(rewards.totalRewardsEmission() == emissionRate, "Total rewards emission should match");
    }

    function it_should_prevent_adding_activity_with_zero_address_caller() {
        // given
        uint256 activityId = 1;
        string memory name = "SwapPool";
        uint256 emissionRate = 100;
        address allowedCaller = address(0);

        // when/then
        bool reverted = false;
        try rewards.addActivity(activityId, name, ActivityType.Position, emissionRate, allowedCaller) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Adding activity with zero address caller should revert");
    }

    function it_should_prevent_adding_activity_with_empty_name() {
        // given
        uint256 activityId = 1;
        string memory name = "";
        uint256 emissionRate = 100;
        address allowedCaller = address(user1);

        // when/then
        bool reverted = false;
        try rewards.addActivity(activityId, name, ActivityType.Position, emissionRate, allowedCaller) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Adding activity with empty name should revert");
    }

    // NOTE: Duplicate activity check removed - we can add same activityId multiple times (overwrites)

    function it_should_track_total_emission_when_adding_multiple_activities() {
        // given
        uint256 activity1 = 1;
        uint256 activity2 = 2;
        uint256 activity3 = 3;
        uint256 emission1 = 100;
        uint256 emission2 = 200;
        uint256 emission3 = 300;

        // when
        rewards.addActivity(activity1, "Activity 1", ActivityType.Position, emission1, address(user1));
        require(rewards.totalRewardsEmission() == emission1, "Total emission after 1st activity");

        rewards.addActivity(activity2, "Activity 2", ActivityType.Position, emission2, address(user1));
        require(rewards.totalRewardsEmission() == emission1 + emission2, "Total emission after 2nd activity");

        rewards.addActivity(activity3, "Activity 3", ActivityType.Position, emission3, address(user1));
        require(rewards.totalRewardsEmission() == emission1 + emission2 + emission3, "Total emission after 3rd activity");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // EMISSION RATE UPDATES
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_allow_updating_emission_rate() {
        // given
        uint256 activityId = 1;
        uint256 initialEmission = 100;
        uint256 newEmission = 200;

        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, initialEmission, address(user1));
        require(rewards.totalRewardsEmission() == initialEmission, "Initial total emission");

        // when
        rewards.setEmissionRate(activityId, newEmission);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller) =
            rewards.activities(activityId);
        require(rate == newEmission, "Emission rate should be updated");
        require(rewards.totalRewardsEmission() == newEmission, "Total emission should be updated");
    }

    // NOTE: No validation for nonexistent activity - updates will succeed on any activityId

    function it_should_maintain_correct_total_emission_when_updating_rates() {
        // given - add three activities
        uint256 activity1 = 1;
        uint256 activity2 = 2;
        uint256 activity3 = 3;
        rewards.addActivity(activity1, "Activity 1", ActivityType.Position, 100, address(user1));
        rewards.addActivity(activity2, "Activity 2", ActivityType.Position, 200, address(user1));
        rewards.addActivity(activity3, "Activity 3", ActivityType.Position, 300, address(user1));

        require(rewards.totalRewardsEmission() == 600, "Initial total emission");

        // when - update emission rate for activity 2
        rewards.setEmissionRate(activity2, 500);

        // then
        require(rewards.totalRewardsEmission() == 900, "Total emission should be 100 + 500 + 300");

        // when - update emission rate for activity 1
        rewards.setEmissionRate(activity1, 50);

        // then
        require(rewards.totalRewardsEmission() == 850, "Total emission should be 50 + 500 + 300");
    }

    function it_should_allow_setting_emission_rate_to_zero() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1));

        // when
        rewards.setEmissionRate(activityId, 0);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller) =
            rewards.activities(activityId);
        require(rate == 0, "Emission rate should be 0");
        require(rewards.totalRewardsEmission() == 0, "Total emission should be 0");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ALLOWED CALLER UPDATES
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_allow_updating_allowed_caller() {
        // given
        uint256 activityId = 1;
        address initialCaller = address(user1);
        address newCaller = address(user2);

        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, initialCaller);

        // when
        rewards.setAllowedCaller(activityId, newCaller);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller) =
            rewards.activities(activityId);
        require(caller == newCaller, "Allowed caller should be updated");
    }

    // NOTE: No validation for nonexistent activity - updates will succeed on any activityId

    function it_should_prevent_setting_allowed_caller_to_zero_address() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1));

        // when/then
        bool reverted = false;
        try rewards.setAllowedCaller(activityId, address(0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Setting allowed caller to zero address should revert");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // OWNERSHIP & AUTHORIZATION
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_prevent_non_owner_from_adding_activity() {
        // given
        uint256 activityId = 1;

        // when - user1 tries to add activity
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "addActivity(uint256, string, uint8, uint256, address)",
            activityId, "Activity 1", uint8(ActivityType.Position), 100, address(user1)) {
            reverted = false;
        } catch {
            reverted = true;
        }

        // then
        require(reverted, "Non-owner should not be able to add activity");
    }

    function it_should_prevent_non_owner_from_updating_emission_rate() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1));

        // when - user1 tries to update emission rate
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "setEmissionRate(uint256, uint256)",
            activityId, 200) {
            reverted = false;
        } catch {
            reverted = true;
        }

        // then
        require(reverted, "Non-owner should not be able to update emission rate");
    }

    function it_should_prevent_non_owner_from_updating_allowed_caller() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1));

        // when - user1 tries to update allowed caller
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "setAllowedCaller(uint256, address)",
            activityId, address(user2)) {
            reverted = false;
        } catch {
            reverted = true;
        }

        // then
        require(reverted, "Non-owner should not be able to update allowed caller");
    }

}
