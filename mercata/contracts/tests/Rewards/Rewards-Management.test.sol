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

    // Helper to create default position events
    function _defaultPositionEvents() internal pure returns (ActionableEvent[] memory) {
        ActionableEvent[] memory events = new ActionableEvent[](2);
        events[0] = ActionableEvent("Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("Withdraw", ActionType.Withdraw);
        return events;
    }

    // Helper functions to create unique events for testing multiple activities with same source
    function _eventsA1() internal pure returns (ActionableEvent[] memory) {
        ActionableEvent[] memory events = new ActionableEvent[](2);
        events[0] = ActionableEvent("A1Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("A1Withdraw", ActionType.Withdraw);
        return events;
    }

    function _eventsA2() internal pure returns (ActionableEvent[] memory) {
        ActionableEvent[] memory events = new ActionableEvent[](2);
        events[0] = ActionableEvent("A2Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("A2Withdraw", ActionType.Withdraw);
        return events;
    }

    function _eventsA3() internal pure returns (ActionableEvent[] memory) {
        ActionableEvent[] memory events = new ActionableEvent[](2);
        events[0] = ActionableEvent("A3Deposit", ActionType.Deposit);
        events[1] = ActionableEvent("A3Withdraw", ActionType.Withdraw);
        return events;
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
        address sourceContract = address(user1);

        // when
        rewards.addPositionActivity(activityId, name, emissionRate, sourceContract, _defaultPositionEvents());

        // then
        (string memory activityName, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address source) =
            rewards.activities(activityId);

        require(keccak256(bytes(activityName)) == keccak256(bytes(name)), "Activity name should match");
        require(activityType == ActivityType.Position, "Activity type should match");
        require(rate == emissionRate, "Emission rate should match");
        require(accReward == 0, "Initial accRewardPerStake should be 0");
        require(lastUpdate == block.timestamp, "lastUpdateTime should be set to block.timestamp");
        require(totalStake == 0, "Initial totalStake should be 0");
        require(source == sourceContract, "Source contract should match");
        require(rewards.activityIds(0) == activityId, "Activity ID should be added to array");
        require(rewards.totalRewardsEmission() == emissionRate, "Total rewards emission should match");
    }

    function it_should_prevent_adding_activity_with_empty_name() {
        // given
        uint256 activityId = 1;
        string memory name = "";
        uint256 emissionRate = 100;
        address sourceContract = address(user1);

        // when/then
        bool reverted = false;
        try rewards.addPositionActivity(activityId, name, emissionRate, sourceContract, _defaultPositionEvents()) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Adding activity with empty name should revert");
    }

    function it_should_prevent_adding_position_activity_with_empty_events() {
        // given
        uint256 activityId = 1;
        string memory name = "SwapPool";
        uint256 emissionRate = 100;
        address sourceContract = address(user1);
        ActionableEvent[] memory emptyEvents = new ActionableEvent[](0);

        // when/then
        bool reverted = false;
        try rewards.addPositionActivity(activityId, name, emissionRate, sourceContract, emptyEvents) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Adding position activity with empty events should revert");
    }

    function it_should_prevent_adding_activity_with_duplicate_event_for_same_source() {
        // given - Activity 1 with sourceContract 0xaa and events: Deposit, Withdraw
        uint256 activityId1 = 1;
        address sourceA = address(user1);
        ActionableEvent[] memory events1 = new ActionableEvent[](2);
        events1[0] = ActionableEvent("Deposit", ActionType.Deposit);
        events1[1] = ActionableEvent("Withdraw", ActionType.Withdraw);
        rewards.addPositionActivity(activityId1, "Activity 1", 100, sourceA, events1);

        // when/then - try to add Activity 2 with same sourceContract and event "Deposit"
        uint256 activityId2 = 2;
        ActionableEvent[] memory events2 = new ActionableEvent[](1);
        events2[0] = ActionableEvent("Deposit", ActionType.Deposit); // duplicate event name

        bool reverted = false;
        try rewards.addPositionActivity(activityId2, "Activity 2", 200, sourceA, events2) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should prevent duplicate event name for same source contract");
    }

    function it_should_allow_same_event_name_for_different_source_contracts() {
        // given - Activity 1 with sourceContract 0xaa and event: Withdraw
        uint256 activityId1 = 1;
        address sourceA = address(user1);
        ActionableEvent[] memory events1 = new ActionableEvent[](1);
        events1[0] = ActionableEvent("Withdraw", ActionType.Withdraw);
        rewards.addPositionActivity(activityId1, "Activity 1", 100, sourceA, events1);

        // when - add Activity 2 with different sourceContract 0xbb but same event "Withdraw"
        uint256 activityId2 = 2;
        address sourceB = address(user2);
        ActionableEvent[] memory events2 = new ActionableEvent[](1);
        events2[0] = ActionableEvent("Withdraw", ActionType.Withdraw); // same event name, different source

        // then - should succeed
        rewards.addPositionActivity(activityId2, "Activity 2", 200, sourceB, events2);

        // verify both activities exist
        (string memory name1, , , , , , ) = rewards.activities(activityId1);
        (string memory name2, , , , , , ) = rewards.activities(activityId2);
        require(keccak256(bytes(name1)) == keccak256(bytes("Activity 1")), "Activity 1 should exist");
        require(keccak256(bytes(name2)) == keccak256(bytes("Activity 2")), "Activity 2 should exist");
    }

    function it_should_allow_non_overlapping_events_for_same_source() {
        // given - Activity 1 with sourceContract 0xaa and event: Withdraw
        uint256 activityId1 = 1;
        address sourceA = address(user1);
        ActionableEvent[] memory events1 = new ActionableEvent[](1);
        events1[0] = ActionableEvent("Withdraw", ActionType.Withdraw);
        rewards.addPositionActivity(activityId1, "Activity 1", 100, sourceA, events1);

        // given - Activity 2 with same sourceContract 0xaa and event: Deposit
        uint256 activityId2 = 2;
        ActionableEvent[] memory events2 = new ActionableEvent[](1);
        events2[0] = ActionableEvent("Deposit", ActionType.Deposit);
        rewards.addPositionActivity(activityId2, "Activity 2", 200, sourceA, events2);

        // when - try to add Activity 3 with same sourceContract but event: Borrow (non-overlapping)
        uint256 activityId3 = 3;
        ActionableEvent[] memory events3 = new ActionableEvent[](1);
        events3[0] = ActionableEvent("Borrow", ActionType.Deposit);

        // then - should succeed
        rewards.addPositionActivity(activityId3, "Activity 3", 300, sourceA, events3);

        // verify all three activities exist
        (string memory name3, , , , , , ) = rewards.activities(activityId3);
        require(keccak256(bytes(name3)) == keccak256(bytes("Activity 3")), "Activity 3 should exist");
    }

    function it_should_prevent_duplicate_event_across_multiple_existing_activities() {
        // given - Activity 1 with sourceContract 0xaa and event: Withdraw
        uint256 activityId1 = 1;
        address sourceA = address(user1);
        ActionableEvent[] memory events1 = new ActionableEvent[](1);
        events1[0] = ActionableEvent("Withdraw", ActionType.Withdraw);
        rewards.addPositionActivity(activityId1, "Activity 1", 100, sourceA, events1);

        // given - Activity 2 with same sourceContract 0xaa and event: Deposit
        uint256 activityId2 = 2;
        ActionableEvent[] memory events2 = new ActionableEvent[](1);
        events2[0] = ActionableEvent("Deposit", ActionType.Deposit);
        rewards.addPositionActivity(activityId2, "Activity 2", 200, sourceA, events2);

        // when/then - try to add Activity 3 with same source and event "Deposit" (conflicts with Activity 2)
        uint256 activityId3 = 3;
        ActionableEvent[] memory events3 = new ActionableEvent[](1);
        events3[0] = ActionableEvent("Deposit", ActionType.Deposit); // conflicts with Activity 2

        bool reverted = false;
        try rewards.addPositionActivity(activityId3, "Activity 3", 300, sourceA, events3) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should prevent duplicate event name across multiple activities for same source");
    }

    function it_should_prevent_duplicate_event_for_onetime_activity() {
        // given - OneTime activity with sourceContract 0xaa and event: Swap
        uint256 activityId1 = 1;
        address sourceA = address(user1);
        rewards.addOneTimeActivity(activityId1, "Swap Activity", 100, sourceA, "Swap");

        // when/then - try to add another OneTime activity with same source and event "Swap"
        uint256 activityId2 = 2;

        bool reverted = false;
        try rewards.addOneTimeActivity(activityId2, "Another Swap", 200, sourceA, "Swap") {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Should prevent duplicate event name for OneTime activities with same source");
    }

    function it_should_prevent_duplicate_activity() {
        // given
        uint256 activityId = 1;
        rewards.addPositionActivity(activityId, "Activity 1", 100, address(user1), _defaultPositionEvents());

        // when/then - try to add activity with same ID
        bool reverted = false;
        try rewards.addPositionActivity(activityId, "Activity 2", 200, address(user2), _defaultPositionEvents()) {
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

        // when - using unique events for same source contract
        rewards.addPositionActivity(activity1, "Activity 1", emission1, address(user1), _eventsA1());
        require(rewards.totalRewardsEmission() == emission1, "Total emission after 1st activity");

        rewards.addPositionActivity(activity2, "Activity 2", emission2, address(user1), _eventsA2());
        require(rewards.totalRewardsEmission() == emission1 + emission2, "Total emission after 2nd activity");

        rewards.addPositionActivity(activity3, "Activity 3", emission3, address(user1), _eventsA3());
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

        rewards.addPositionActivity(activityId, "Activity 1", initialEmission, address(user1), _defaultPositionEvents());
        require(rewards.totalRewardsEmission() == initialEmission, "Initial total emission");

        // when
        rewards.setEmissionRate(activityId, newEmission);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address source) =
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
        // given - add three activities with unique events for same source
        uint256 activity1 = 1;
        uint256 activity2 = 2;
        uint256 activity3 = 3;
        rewards.addPositionActivity(activity1, "Activity 1", 100, address(user1), _eventsA1());
        rewards.addPositionActivity(activity2, "Activity 2", 200, address(user1), _eventsA2());
        rewards.addPositionActivity(activity3, "Activity 3", 300, address(user1), _eventsA3());

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
        rewards.addPositionActivity(activityId, "Activity 1", 100, address(user1), _defaultPositionEvents());

        // when
        rewards.setEmissionRate(activityId, 0);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address source) =
            rewards.activities(activityId);
        require(rate == 0, "Emission rate should be 0");
        require(rewards.totalRewardsEmission() == 0, "Total emission should be 0");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // SOURCE CONTRACT UPDATES
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_allow_updating_source_contract() {
        // given
        uint256 activityId = 1;
        address initialSource = address(user1);
        address newSource = address(user2);

        rewards.addPositionActivity(activityId, "Activity 1", 100, initialSource, _defaultPositionEvents());

        // when
        rewards.setSourceContract(activityId, newSource);

        // then
        (string memory name, ActivityType activityType, uint256 rate, uint256 accReward, uint256 lastUpdate, uint256 totalStake, address source) =
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
        rewards.addPositionActivity(activityId, "Activity 1", 100, address(user1), _defaultPositionEvents());

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

    function it_should_fail_on_unknown_event_for_source() {
        // given - add a OneTime activity with "Swap" event
        uint256 activityId = 1;
        rewards.addOneTimeActivity(activityId, "Swap Activity", 100, address(this), "Swap");

        // when/then - try to use an event name that doesn't exist for this source
        bool reverted = false;
        try rewards.handleAction(Action(address(this), "UnknownEvent", address(user1), 100, testBlockNumber, 0)) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "Unknown event should fail");
    }

    function it_should_allow_valid_event_on_onetime_activity() {
        // given - add a OneTime activity with "Swap" event
        uint256 activityId = 1;
        rewards.addOneTimeActivity(activityId, "Swap Activity", 100, address(this), "Swap");

        // when - use the registered "Swap" event
        rewards.handleAction(Action(address(this), "Swap", address(user1), 100, testBlockNumber, 0));

        // then - check user stake increased
        (uint256 stake, uint256 userIndex) = rewards.userInfo(activityId, address(user1));
        require(stake == 100, "User stake should be 100");
    }

    function it_should_allow_deposit_on_position_activity() {
        // given - add a Position activity with Deposit/Withdraw events
        uint256 activityId = 1;
        rewards.addPositionActivity(activityId, "Liquidity Pool", 100, address(this), _defaultPositionEvents());

        // when - use the registered "Deposit" event
        rewards.handleAction(Action(address(this), "Deposit", address(user1), 100, testBlockNumber, 0));

        // then - check user stake increased
        (uint256 stake, uint256 userIndex) = rewards.userInfo(activityId, address(user1));
        require(stake == 100, "User stake should be 100");
    }

    function it_should_allow_withdraw_on_position_activity() {
        // given - add a Position activity with Deposit/Withdraw events
        uint256 activityId = 1;
        rewards.addPositionActivity(activityId, "Liquidity Pool", 100, address(this), _defaultPositionEvents());

        // given - first deposit
        rewards.handleAction(Action(address(this), "Deposit", address(user1), 100, testBlockNumber, 0));

        // when - use the registered "Withdraw" event
        rewards.handleAction(Action(address(this), "Withdraw", address(user1), 50, testBlockNumber, 1));

        // then - check user stake decreased
        (uint256 stake, uint256 userIndex) = rewards.userInfo(activityId, address(user1));
        require(stake == 50, "User stake should be 50 after withdrawal");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // OWNERSHIP & AUTHORIZATION
    // ═════════════════════════════════════════════════════════════════════════

    function it_should_prevent_non_owner_from_updating_emission_rate() {
        // given
        uint256 activityId = 1;
        rewards.addPositionActivity(activityId, "Activity 1", 100, address(user1), _defaultPositionEvents());

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

    function it_should_prevent_non_owner_from_calling_handleAction() {
        // given
        uint256 activityId = 1;
        rewards.addPositionActivity(activityId, "Activity 1", 100, address(user1), _defaultPositionEvents());

        // when - user1 (non-owner) tries to call handleAction
        bool reverted = false;
        try TestUtils.callAs(user1, address(rewards), "handleAction((address,string,address,uint256,uint256,uint256))",
            address(user1), "Deposit", address(user2), 100, testBlockNumber, 0) {
            reverted = false;
        } catch {
            reverted = true;
        }

        // then
        require(reverted, "Non-owner should not be able to call handleAction");
    }

}
