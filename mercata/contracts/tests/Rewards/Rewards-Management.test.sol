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

    uint256 testBlockNumber = 100;

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

        // Create Rewards contract directly (test contract is owner)
        rewards = new Rewards(address(this));
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
        address sourceContract = address(user1);

        // when
        rewards.addActivity(activityId, name, ActivityType.Position, emissionRate, allowedCaller, sourceContract);

        // then
        (string memory activityName, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller, address source) =
            rewards.activities(activityId);

        require(keccak256(bytes(activityName)) == keccak256(bytes(name)), "Activity name should match");
        require(activityType == ActivityType.Position, "Activity type should match");
        require(rate == emissionRate, "Emission rate should match");
        require(accReward == 0, "Initial accRewardPerStake should be 0");
        require(lastUpdate == block.timestamp, "lastUpdateTime should be set to block.timestamp");
        require(totalStake == 0, "Initial totalStake should be 0");
        require(caller == allowedCaller, "Allowed caller should match");
        require(source == sourceContract, "Source contract should match");
        require(rewards.activityIds(0) == activityId, "Activity ID should be added to array");
        require(rewards.totalRewardsEmission() == emissionRate, "Total rewards emission should match");
    }

    function it_should_prevent_adding_activity_with_zero_address_caller() {
        // given
        uint256 activityId = 1;
        string memory name = "SwapPool";
        uint256 emissionRate = 100;
        address allowedCaller = address(0);
        address sourceContract = address(user1);

        // when/then
        bool reverted = false;
        try rewards.addActivity(activityId, name, ActivityType.Position, emissionRate, allowedCaller, sourceContract) {
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
        address sourceContract = address(user1);

        // when/then
        bool reverted = false;
        try rewards.addActivity(activityId, name, ActivityType.Position, emissionRate, allowedCaller, sourceContract) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Adding activity with empty name should revert");
    }

    function it_should_prevent_adding_duplicate_activity() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));

        // when/then - try to add activity with same ID
        bool reverted = false;
        try rewards.addActivity(activityId, "Activity 2", ActivityType.Position, 200, address(user2), address(user2)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Adding duplicate activity should revert");
    }

    function it_should_track_total_emission_when_adding_multiple_activities() {
        // given
        uint256 activity1 = 1;
        uint256 activity2 = 2;
        uint256 activity3 = 3;
        uint256 emission1 = 100;
        uint256 emission2 = 200;
        uint256 emission3 = 300;

        // when
        rewards.addActivity(activity1, "Activity 1", ActivityType.Position, emission1, address(user1), address(user1));
        require(rewards.totalRewardsEmission() == emission1, "Total emission after 1st activity");

        rewards.addActivity(activity2, "Activity 2", ActivityType.Position, emission2, address(user1), address(user1));
        require(rewards.totalRewardsEmission() == emission1 + emission2, "Total emission after 2nd activity");

        rewards.addActivity(activity3, "Activity 3", ActivityType.Position, emission3, address(user1), address(user1));
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

        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, initialEmission, address(user1), address(user1));
        require(rewards.totalRewardsEmission() == initialEmission, "Initial total emission");

        // when
        rewards.setEmissionRate(activityId, newEmission);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller, address source) =
            rewards.activities(activityId);
        require(rate == newEmission, "Emission rate should be updated");
        require(rewards.totalRewardsEmission() == newEmission, "Total emission should be updated");
    }

    function it_should_prevent_updating_emission_rate_on_nonexistent_activity() {
        // given - no activity exists with id 999

        // when/then
        bool reverted = false;
        try rewards.setEmissionRate(999, 200) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Updating emission rate on nonexistent activity should revert");
    }

    function it_should_maintain_correct_total_emission_when_updating_rates() {
        // given - add three activities
        uint256 activity1 = 1;
        uint256 activity2 = 2;
        uint256 activity3 = 3;
        rewards.addActivity(activity1, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));
        rewards.addActivity(activity2, "Activity 2", ActivityType.Position, 200, address(user1), address(user1));
        rewards.addActivity(activity3, "Activity 3", ActivityType.Position, 300, address(user1), address(user1));

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
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));

        // when
        rewards.setEmissionRate(activityId, 0);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller, address source) =
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

        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, initialCaller, initialCaller);

        // when
        rewards.setAllowedCaller(activityId, newCaller);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller, address source) =
            rewards.activities(activityId);
        require(caller == newCaller, "Allowed caller should be updated");
    }

    function it_should_prevent_updating_allowed_caller_on_nonexistent_activity() {
        // given - no activity exists with id 999

        // when/then
        bool reverted = false;
        try rewards.setAllowedCaller(999, address(user1)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Updating allowed caller on nonexistent activity should revert");
    }

    function it_should_prevent_setting_allowed_caller_to_zero_address() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));

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
    // SOURCE CONTRACT UPDATES
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_allow_updating_source_contract() {
        // given
        uint256 activityId = 1;
        address initialSource = address(user1);
        address newSource = address(user2);

        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), initialSource);

        // when
        rewards.setSourceContract(activityId, newSource);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address caller, address source) =
            rewards.activities(activityId);
        require(source == newSource, "Source contract should be updated");
    }

    function it_should_prevent_updating_source_contract_on_nonexistent_activity() {
        // given - no activity exists with id 999

        // when/then
        bool reverted = false;
        try rewards.setSourceContract(999, address(user1)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Updating source contract on nonexistent activity should revert");
    }

    function it_should_prevent_setting_source_contract_to_zero_address() {
        // given
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));

        // when/then
        bool reverted = false;
        try rewards.setSourceContract(activityId, address(0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Setting source contract to zero address should revert");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // ACTIVITY TYPE VALIDATION
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_prevent_deposit_on_onetime_activity() {
        // given - add a OneTime activity
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Swap Activity", ActivityType.OneTime, 100, address(this), address(this));

        // when/then - try to deposit on OneTime activity
        bool reverted = false;
        try rewards.handleAction(Action(activityId, address(user1), 100, ActionType.Deposit, testBlockNumber, 0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Deposit should fail on OneTime activity");
    }

    function it_should_prevent_withdraw_on_onetime_activity() {
        // given - add a OneTime activity
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Swap Activity", ActivityType.OneTime, 100, address(this), address(this));

        // when/then - try to withdraw on OneTime activity
        bool reverted = false;
        try rewards.handleAction(Action(activityId, address(user1), 100, ActionType.Withdraw, testBlockNumber, 0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Withdraw should fail on OneTime activity");
    }

    function it_should_prevent_occurred_on_position_activity() {
        // given - add a Position activity
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Liquidity Pool", ActivityType.Position, 100, address(this), address(this));

        // when/then - try to call occurred on Position activity
        bool reverted = false;
        try rewards.handleAction(Action(activityId, address(user1), 100, ActionType.Occurred, testBlockNumber, 0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Occurred should fail on Position activity");
    }

    function it_should_allow_occurred_on_onetime_activity() {
        // given - add a OneTime activity
        uint256 activityId = 1;
        rewards.addActivity(activityId, "Swap Activity", ActivityType.OneTime, 100, address(this), address(this));

        // when - call occurred
        rewards.handleAction(Action(activityId, address(user1), 100, ActionType.Occurred, testBlockNumber, 0));

        // then - check user stake increased
        (uint256 stake, uint256 userIndex) = rewards.userInfo(activityId, address(user1));
        require(stake == 100, "User stake should be 100");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // OWNERSHIP & AUTHORIZATION
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_prevent_non_owner_from_adding_activity() {
        // given
        uint256 activityId = 1;

        // when - user1 tries to add activity
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "addActivity(uint256, string, uint8, uint256, address, address)",
            activityId, "Activity 1", uint8(ActivityType.Position), 100, address(user1), address(user1)) {
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
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));

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
        rewards.addActivity(activityId, "Activity 1", ActivityType.Position, 100, address(user1), address(user1));

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
