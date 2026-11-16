import "./StratoStaking.sol";

// Temporary logic for an in-place upgrade of an operator-keyed staking proxy.
// Remove it by installing plain StratoStaking after migration and bootstrap.
contract StratoStakingMigration is StratoStaking {
    event RecordMigrated(address indexed operator, address indexed validator, uint256 positions, uint256 delegatedStake);
    event MigrationComplete(uint256 records, uint256 positions);
    event IncumbentsBootstrapped(uint256 validators);

    // Historical schedule fields no longer declared by the final implementation.
    uint256 public lastUpdateTime;
    uint256 public periodFinish;
    bool public recordsMigrated;

    constructor(address initialOwner) StratoStaking(initialOwner) { }

    function migrateRecords(
        address[] operatorKeys,
        address[] validators,
        uint256[] positionCounts,
        address[] delegators
    ) external onlyOwner onlyInitialized {
        require(!recordsMigrated, "SM: already migrated");
        require(periodFinish > 0 && lastUpdateTime >= periodFinish, "SM: reward schedule not final");
        uint256 count = operatorKeys.length;
        require(count > 0 && count == operatorList.length, "SM: incomplete operator list");
        require(validators.length == count && positionCounts.length == count, "SM: length mismatch");

        uint256 start = 0;
        for (uint256 i = 0; i < count; i++) {
            address from = operatorKeys[i];
            address to = validators[i];
            require(from == operatorList[i], "SM: operator order mismatch");
            require(to != address(0), "SM: validator=0");
            require(operators[from].exists && operators[from].operator == address(0), "SM: not a legacy record");
            require(!isValidator[to], "SM: validator already seated");
            if (to != from) {
                require(!operators[to].exists, "SM: validator already has a record");
            }
            for (uint256 j = 0; j < i; j++) {
                require(validators[j] != to, "SM: duplicate validator");
            }

            uint256 end = start + positionCounts[i];
            require(end <= delegators.length, "SM: too few delegators");
            uint256 listed = 0;
            for (uint256 k = start; k < end; k++) {
                address user = delegators[k];
                listed += delegatedStake[user][from];
                if (to != from) {
                    require(delegatedStake[user][to] == 0
                        && userRewardPerStakePaid[user][to] == 0
                        && pendingDelegatorRewards[user][to] == 0
                        && userFeePerStakePaid[user][to] == 0
                        && pendingDelegatorFees[user][to] == 0, "SM: destination position exists");
                }
            }
            require(listed == operators[from].delegatedStake, "SM: delegators do not cover the record");
            start = end;
        }
        require(start == delegators.length, "SM: too many delegators");

        start = 0;
        for (uint256 i = 0; i < count; i++) {
            address from = operatorKeys[i];
            address to = validators[i];
            uint256 end = start + positionCounts[i];
            if (to != from) {
                for (uint256 k = start; k < end; k++) {
                    _movePosition(delegators[k], from, to);
                }
                _moveRecord(from, to);
                operatorList[i] = to;
            }
            emit RecordMigrated(from, to, positionCounts[i], operators[to].delegatedStake);
            start = end;
        }
        recordsMigrated = true;
        emit MigrationComplete(count, delegators.length);
    }

    // Seat the complete existing governance set in one transaction before joins open.
    // A failed preflight or governance weight update reverts the entire set.
    function bootstrapIncumbents() external onlyOwner onlyInitialized {
        require(recordsMigrated, "SM: records not migrated");
        require(!governanceSyncEnabled && governance != address(0), "SM: governance sync must be off");
        require(address(validatorRegistry) != address(0), "SM: registry missing");
        require(validatorCount == 0 && activeValidators.length == 0, "SM: already bootstrapped");
        require(joinsOpenFromBlock == 0, "SM: joins already scheduled");

        IStakingGovernance g = IStakingGovernance(governance);
        require(g.stakingContract() == address(this), "SM: governance not wired");
        require(minStake > 0, "SM: min stake missing");
        uint256 count = g.validatorCount();
        require(count > 0 && count <= effectiveCap(), "SM: invalid validator count");

        for (uint256 i = 0; i < count; i++) {
            address validator = g.validators(i);
            StakingValidator storage v = operators[validator];
            (bool listed, bool active,,,,,) = validatorRegistry.operators(validator);
            require(listed && active && v.exists && v.active, "SM: incumbent not active");
            require(validatorRegistry.operatorOf(validator) == operatorOf(validator), "SM: operator mismatch");
            require(!isValidator[validator] && g.validatorMap(validator) > 0, "SM: incumbent already seated");
            require(_validatorWeight(v) > 0 && _validatorWeight(v) >= minStake, "SM: incumbent underfunded");
            require(_votingWeight(validator) > 0, "SM: incumbent voting weight zero");
        }

        governanceSyncEnabled = true;
        emit GovernanceSet(governance, true);
        for (uint256 i = 0; i < count; i++) {
            address validator = g.validators(i);
            _activate(validator);
            seatedUnderSelfBondRule[validator] = false;
            require(g.validatorStake(validator) > 0, "SM: zero governance weight");
        }
        emit IncumbentsBootstrapped(count);
    }

    function _movePosition(address user, address from, address to) internal {
        uint256 staked = delegatedStake[user][from];
        if (staked > 0) {
            delegatedStake[user][to] = staked;
            delegatedStake[user][from] = 0;
        }
        uint256 pending = pendingDelegatorRewards[user][from];
        if (pending > 0) {
            pendingDelegatorRewards[user][to] = pending;
            pendingDelegatorRewards[user][from] = 0;
        }
        uint256 paid = userRewardPerStakePaid[user][from];
        if (paid > 0) {
            userRewardPerStakePaid[user][to] = paid;
            userRewardPerStakePaid[user][from] = 0;
        }
        uint256 pendingFees = pendingDelegatorFees[user][from];
        if (pendingFees > 0) {
            pendingDelegatorFees[user][to] = pendingFees;
            pendingDelegatorFees[user][from] = 0;
        }
        uint256 feePaid = userFeePerStakePaid[user][from];
        if (feePaid > 0) {
            userFeePerStakePaid[user][to] = feePaid;
            userFeePerStakePaid[user][from] = 0;
        }
    }

    function _moveRecord(address from, address to) internal {
        StakingValidator storage a = operators[from];
        StakingValidator storage b = operators[to];
        b.exists = true;
        b.active = a.active;
        b.operator = from;
        b.commissionBps = a.commissionBps;
        b.selfBond = a.selfBond;
        b.delegatedStake = a.delegatedStake;
        b.delegatorRewardPerStakeStored = a.delegatorRewardPerStakeStored;
        b.pendingSelfBondRewards = a.pendingSelfBondRewards;
        b.pendingCommission = a.pendingCommission;
        b.stakeRewardPerTokenPaid = a.stakeRewardPerTokenPaid;
        b.baseRewardPerOperatorPaid = a.baseRewardPerOperatorPaid;
        b.pendingBaseRewards = a.pendingBaseRewards;
        b.feePerStakeStored = a.feePerStakeStored;
        b.pendingSelfBondFees = a.pendingSelfBondFees;
        b.pendingFeeCommission = a.pendingFeeCommission;

        a.exists = false;
        a.active = false;
        a.commissionBps = 0;
        a.selfBond = 0;
        a.delegatedStake = 0;
        a.delegatorRewardPerStakeStored = 0;
        a.pendingSelfBondRewards = 0;
        a.pendingCommission = 0;
        a.stakeRewardPerTokenPaid = 0;
        a.baseRewardPerOperatorPaid = 0;
        a.pendingBaseRewards = 0;
        a.feePerStakeStored = 0;
        a.pendingSelfBondFees = 0;
        a.pendingFeeCommission = 0;
    }
}
