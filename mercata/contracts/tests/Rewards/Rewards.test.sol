// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/BaseCodeCollection.sol";
import "../../concrete/Rewards/Rewards.sol";

contract MockToken {
    mapping(address => uint256) public balances;

    function mint(address to, uint256 amount) external {
        balances[to] += amount;
    }

    function balanceOf(address account) external view returns (uint256) {
        return balances[account];
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balances[msg.sender] >= amount, "insufficient");
        balances[msg.sender] -= amount;
        balances[to] += amount;
        return true;
    }
}

contract ClaimActor {
    function claimAll(Rewards rewards) external {
        rewards.claimAllRewards();
    }
}

contract Describe_RewardsCommunityBonus {
    Rewards rewards;
    MockToken rewardToken;
    MockToken communityToken;
    ClaimActor holderActor;
    ClaimActor normalActor;

    address holderUser;
    address normalUser;

    uint256 constant EMISSION_RATE = 1000;
    uint256 constant STAKE_AMOUNT = 100;
    uint256 constant TWO_X = 2 * 1e18;

    function beforeEach() {
        rewardToken = new MockToken();
        communityToken = new MockToken();
        holderActor = new ClaimActor();
        normalActor = new ClaimActor();

        holderUser = address(holderActor);
        normalUser = address(normalActor);

        rewards = new Rewards(address(this));
        rewards.initialize(address(rewardToken));

        // Holder owns community token; normal user does not.
        communityToken.mint(holderUser, 1e18);
    }

    function _submitTwoPosition(
        uint256 amount,
        uint256 blockNumber,
        uint256 firstEventIndex
    ) internal {
        rewards.handleAction(
            address(this),
            "PositionOpened",
            holderUser,
            amount,
            blockNumber,
            firstEventIndex
        );
        rewards.handleAction(
            address(this),
            "PositionOpened",
            normalUser,
            amount,
            blockNumber,
            firstEventIndex + 1
        );
    }

    function _submitTwoOneTime(
        uint256 amount,
        uint256 blockNumber,
        uint256 firstEventIndex
    ) internal {
        rewards.handleAction(
            address(this),
            "OneTimeOccurred",
            holderUser,
            amount,
            blockNumber,
            firstEventIndex
        );
        rewards.handleAction(
            address(this),
            "OneTimeOccurred",
            normalUser,
            amount,
            blockNumber,
            firstEventIndex + 1
        );
    }

    function _closeTwoPosition(
        uint256 amount,
        uint256 blockNumber,
        uint256 firstEventIndex
    ) internal {
        rewards.handleAction(
            address(this),
            "PositionClosed",
            holderUser,
            amount,
            blockNumber,
            firstEventIndex
        );
        rewards.handleAction(
            address(this),
            "PositionClosed",
            normalUser,
            amount,
            blockNumber,
            firstEventIndex + 1
        );
    }

    function _setupPositionActivity() internal {
        rewards.addPositionActivitySimple(
            "LP Position",
            EMISSION_RATE,
            address(this),
            "PositionOpened",
            "PositionClosed"
        );
    }

    function _setupOneTimeActivity() internal {
        rewards.addOneTimeActivity(
            "OneTime Activity",
            EMISSION_RATE,
            address(this),
            "OneTimeOccurred"
        );
    }

    function it_should_not_apply_bonus_for_position_when_bonus_not_configured() {
        _setupPositionActivity();

        _submitTwoPosition(STAKE_AMOUNT, 100, 1);
        fastForward(10);
        _submitTwoPosition(STAKE_AMOUNT, 101, 3);

        uint256 holderRewards = rewards.unclaimedRewards(holderUser);
        uint256 normalRewards = rewards.unclaimedRewards(normalUser);

        require(normalRewards > 0, "Expected normal user rewards > 0");
        require(holderRewards == normalRewards, "No bonus expected for position without bonus config");
    }

    function it_should_apply_bonus_for_position_when_bonus_configured() {
        _setupPositionActivity();
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X);

        _submitTwoPosition(STAKE_AMOUNT, 200, 1);
        fastForward(10);
        _submitTwoPosition(STAKE_AMOUNT, 201, 3);

        uint256 holderRewards = rewards.unclaimedRewards(holderUser);
        uint256 normalRewards = rewards.unclaimedRewards(normalUser);

        require(normalRewards > 0, "Expected normal user rewards > 0");
        require(holderRewards == normalRewards * 2, "Holder should receive 2x position rewards");
    }

    function it_should_not_apply_bonus_for_onetime_when_bonus_not_configured() {
        _setupOneTimeActivity();

        _submitTwoOneTime(STAKE_AMOUNT, 300, 1);
        fastForward(10);
        _submitTwoOneTime(STAKE_AMOUNT, 301, 3);

        uint256 holderRewards = rewards.unclaimedRewards(holderUser);
        uint256 normalRewards = rewards.unclaimedRewards(normalUser);

        require(normalRewards > 0, "Expected normal user rewards > 0");
        require(holderRewards == normalRewards, "No bonus expected for one-time without bonus config");
    }

    function it_should_apply_bonus_for_onetime_when_bonus_configured() {
        _setupOneTimeActivity();
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X);

        _submitTwoOneTime(STAKE_AMOUNT, 400, 1);
        fastForward(10);
        _submitTwoOneTime(STAKE_AMOUNT, 401, 3);

        uint256 holderRewards = rewards.unclaimedRewards(holderUser);
        uint256 normalRewards = rewards.unclaimedRewards(normalUser);

        require(normalRewards > 0, "Expected normal user rewards > 0");
        require(holderRewards == normalRewards * 2, "Holder should receive 2x one-time rewards");
    }

    function it_should_settle_and_zero_stake_on_position_close_without_bonus() {
        _setupPositionActivity();

        _submitTwoPosition(STAKE_AMOUNT, 500, 1);
        fastForward(10);
        _closeTwoPosition(STAKE_AMOUNT, 501, 3);

        (uint256 holderStake, ) = rewards.userInfo(holderUser, 1);
        (uint256 normalStake, ) = rewards.userInfo(normalUser, 1);
        uint256 holderRewards = rewards.unclaimedRewards(holderUser);
        uint256 normalRewards = rewards.unclaimedRewards(normalUser);

        require(holderStake == 0, "Holder stake should be zero after full close");
        require(normalStake == 0, "Normal stake should be zero after full close");
        require(normalRewards > 0, "Normal rewards should settle on close");
        require(holderRewards == normalRewards, "No bonus expected when bonus not configured");
    }

    function it_should_settle_and_zero_stake_on_position_close_with_bonus() {
        _setupPositionActivity();
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X);

        _submitTwoPosition(STAKE_AMOUNT, 600, 1);
        fastForward(10);
        _closeTwoPosition(STAKE_AMOUNT, 601, 3);

        (uint256 holderStake, ) = rewards.userInfo(holderUser, 1);
        (uint256 normalStake, ) = rewards.userInfo(normalUser, 1);
        uint256 holderRewards = rewards.unclaimedRewards(holderUser);
        uint256 normalRewards = rewards.unclaimedRewards(normalUser);

        require(holderStake == 0, "Holder stake should be zero after full close");
        require(normalStake == 0, "Normal stake should be zero after full close");
        require(normalRewards > 0, "Normal rewards should settle on close");
        require(holderRewards == normalRewards * 2, "Holder should receive 2x settled close rewards");
    }

    function it_should_settle_via_claimAllRewards_without_new_action() {
        _setupPositionActivity();

        _submitTwoPosition(STAKE_AMOUNT, 700, 1);
        fastForward(10);

        rewardToken.mint(address(rewards), 1000000000);

        uint256 holderBefore = rewardToken.balanceOf(holderUser);
        uint256 normalBefore = rewardToken.balanceOf(normalUser);

        holderActor.claimAll(rewards);
        normalActor.claimAll(rewards);

        uint256 holderAfter = rewardToken.balanceOf(holderUser);
        uint256 normalAfter = rewardToken.balanceOf(normalUser);
        uint256 holderUnclaimed = rewards.unclaimedRewards(holderUser);
        uint256 normalUnclaimed = rewards.unclaimedRewards(normalUser);

        require(holderAfter > holderBefore, "Holder should receive claimed rewards");
        require(normalAfter > normalBefore, "Normal should receive claimed rewards");
        require(holderAfter - holderBefore == normalAfter - normalBefore, "No bonus expected on claim settle");
        require(holderUnclaimed == 0, "Holder unclaimed should reset after claim");
        require(normalUnclaimed == 0, "Normal unclaimed should reset after claim");
    }

    function it_should_apply_bonus_when_settling_via_claimAllRewards() {
        _setupPositionActivity();
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X);

        _submitTwoPosition(STAKE_AMOUNT, 800, 1);
        fastForward(10);

        rewardToken.mint(address(rewards), 1000000000);

        uint256 holderBefore = rewardToken.balanceOf(holderUser);
        uint256 normalBefore = rewardToken.balanceOf(normalUser);

        holderActor.claimAll(rewards);
        normalActor.claimAll(rewards);

        uint256 holderDelta = rewardToken.balanceOf(holderUser) - holderBefore;
        uint256 normalDelta = rewardToken.balanceOf(normalUser) - normalBefore;

        require(normalDelta > 0, "Normal should receive claimed rewards");
        require(holderDelta == normalDelta * 2, "Holder should receive 2x claimed rewards");
    }
}
