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
    MockToken communityTokenTwo;
    ClaimActor holderActor;
    ClaimActor normalActor;

    address holderUser;
    address normalUser;

    uint256 constant EMISSION_RATE = 1000;
    uint256 constant STAKE_AMOUNT = 100;
    uint256 constant TWO_X = 2 * 1e18;
    uint256 constant ONE_POINT_FIVE_X = 15 * 1e17; // 1.5x
    uint256 constant ONE_POINT_TWO_FIVE_X = 125 * 1e16; // 1.25x
    uint256 constant MIN_BALANCE = 1e18;

    function beforeEach() {
        rewardToken = new MockToken();
        communityToken = new MockToken();
        communityTokenTwo = new MockToken();
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

    function _setupPositionActivity() internal {
        rewards.addPositionActivitySimple(
            "LP Position",
            EMISSION_RATE,
            address(this),
            "PositionOpened",
            "PositionClosed"
        );
    }

    function it_should_settle_via_claimAllRewards_without_new_action() {
        _setupPositionActivity();

        _submitTwoPosition(STAKE_AMOUNT, 300, 1);
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
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X, MIN_BALANCE);

        _submitTwoPosition(STAKE_AMOUNT, 400, 1);
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

    function it_should_not_apply_bonus_when_holder_balance_below_minBalance_on_claim() {
        _setupPositionActivity();
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X, 2e18);

        _submitTwoPosition(STAKE_AMOUNT, 500, 1);
        fastForward(10);
        rewardToken.mint(address(rewards), 1000000000);

        uint256 holderBefore = rewardToken.balanceOf(holderUser);
        uint256 normalBefore = rewardToken.balanceOf(normalUser);

        holderActor.claimAll(rewards);
        normalActor.claimAll(rewards);

        uint256 holderDelta = rewardToken.balanceOf(holderUser) - holderBefore;
        uint256 normalDelta = rewardToken.balanceOf(normalUser) - normalBefore;

        require(normalDelta > 0, "Normal should receive claimed rewards");
        require(holderDelta == normalDelta, "Bonus should not apply when below minBalance");
    }

    function it_should_apply_bonus_when_holder_balance_equals_minBalance_on_claim() {
        _setupPositionActivity();
        rewards.setCommunityBonusMultiplier(address(communityToken), TWO_X, MIN_BALANCE);

        _submitTwoPosition(STAKE_AMOUNT, 600, 1);
        fastForward(10);
        rewardToken.mint(address(rewards), 1000000000);

        uint256 holderBefore = rewardToken.balanceOf(holderUser);
        uint256 normalBefore = rewardToken.balanceOf(normalUser);

        holderActor.claimAll(rewards);
        normalActor.claimAll(rewards);

        uint256 holderDelta = rewardToken.balanceOf(holderUser) - holderBefore;
        uint256 normalDelta = rewardToken.balanceOf(normalUser) - normalBefore;

        require(normalDelta > 0, "Normal should receive claimed rewards");
        require(holderDelta == normalDelta * 2, "Bonus should apply at minBalance threshold");
    }

    function it_should_apply_additive_bonus_when_multiple_tokens_qualify_on_claim() {
        _setupPositionActivity();
        communityTokenTwo.mint(holderUser, MIN_BALANCE);
        rewards.setCommunityBonusMultiplier(address(communityToken), ONE_POINT_FIVE_X, MIN_BALANCE);
        rewards.setCommunityBonusMultiplier(address(communityTokenTwo), ONE_POINT_TWO_FIVE_X, MIN_BALANCE);

        _submitTwoPosition(STAKE_AMOUNT, 700, 1);
        fastForward(10);
        rewardToken.mint(address(rewards), 1000000000);

        uint256 holderBefore = rewardToken.balanceOf(holderUser);
        uint256 normalBefore = rewardToken.balanceOf(normalUser);

        holderActor.claimAll(rewards);
        normalActor.claimAll(rewards);

        uint256 holderDelta = rewardToken.balanceOf(holderUser) - holderBefore;
        uint256 normalDelta = rewardToken.balanceOf(normalUser) - normalBefore;

        // Additive: +50% (1.5x) and +25% (1.25x) => total 1.75x.
        require(normalDelta > 0, "Normal should receive claimed rewards");
        require(holderDelta == (normalDelta * 175) / 100, "Holder should receive additive 1.75x rewards");
    }
}
