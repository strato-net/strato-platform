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

contract Describe_RewardsCommunityBonus {
    Rewards rewards;
    MockToken rewardToken;
    MockToken communityToken;

    address constant holderUser = address(0x1111);
    address constant normalUser = address(0x2222);

    uint256 constant EMISSION_RATE = 1000;
    uint256 constant STAKE_AMOUNT = 100;
    uint256 constant TWO_X = 2 * 1e18;

    function beforeEach() {
        rewardToken = new MockToken();
        communityToken = new MockToken();

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
}
