// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Staking/StratoStakingMigration.sol";
import "../../concrete/Staking/ValidatorRegistryMigration.sol";
import "../../concrete/Governance/MercataGovernance.sol";
import "../../concrete/Proxy/Proxy.sol";

contract LegacyStakingForMigration is StratoStaking {
    uint256 public lastUpdateTime;
    uint256 public periodFinish;

    constructor(address initialOwner) StratoStaking(initialOwner) { }

    function seedLegacy(address operator, bool active, uint256 stake, uint256 pendingBase) public {
        operators[operator] = StakingValidator(true, active, address(0), 500, 0, stake, 10, 0, 0, 0, 0, 0, 5, 6, pendingBase);
        operatorList.push(operator);
        totalUserStake += stake;
        if (active) totalRewardableStake += stake;
    }

    function seedPosition(address user, address operator, uint256 stake, uint256 pending, uint256 paid) public {
        delegatedStake[user][operator] = stake;
        pendingDelegatorRewards[user][operator] = pending;
        userRewardPerStakePaid[user][operator] = paid;
    }

    function finishSchedule() public {
        lastUpdateTime = 10;
        periodFinish = 10;
        selfBondGraceUntil = 0;
    }
}

contract LegacyRegistryForMigration is ValidatorRegistry {
    constructor(address initialOwner) ValidatorRegistry(initialOwner) { }

    function seedLegacy(address operator, bool active, string name, string id) public {
        operators[operator] = ValidatorProfile(true, active, name, "", "", id, address(0));
        operatorList.push(operator);
        protocolValidatorOperators[id] = operator;
    }
}

contract GenesisGovernanceForMigration is MercataGovernance {
    constructor(address initialOwner) MercataGovernance(initialOwner) { }

    function seedValidator(address validator) public {
        addValidator(validator);
    }
}

contract Describe_UpquarkMigration {
    address constant OPERATOR = address(0x1111);
    address constant VALIDATOR = address(0xaaaa);
    address constant INACTIVE = address(0x2222);
    address constant USER = address(0x3333);
    address constant REWARDS_ONLY_USER = address(0x4444);

    Proxy stakingProxy;
    Proxy registryProxy;
    StratoStakingMigration staking;
    ValidatorRegistryMigration registry;

    function beforeEach() public {
        stakingProxy = new Proxy(address(new LegacyStakingForMigration(address(this))), address(this));
        LegacyStakingForMigration oldStaking = LegacyStakingForMigration(address(stakingProxy));
        oldStaking.initialize(address(0x1234), address(0x5678), 100, 1000, 50);
        oldStaking.seedLegacy(OPERATOR, true, 300, 7);
        oldStaking.seedLegacy(INACTIVE, false, 0, 19);
        oldStaking.seedPosition(USER, OPERATOR, 300, 11, 4);
        oldStaking.seedPosition(REWARDS_ONLY_USER, OPERATOR, 0, 5, 2);
        oldStaking.finishSchedule();
        stakingProxy.setLogicContract(address(new StratoStakingMigration(address(this))));
        staking = StratoStakingMigration(address(stakingProxy));

        registryProxy = new Proxy(address(new LegacyRegistryForMigration(address(this))), address(this));
        LegacyRegistryForMigration oldRegistry = LegacyRegistryForMigration(address(registryProxy));
        oldRegistry.seedLegacy(OPERATOR, true, "active", "v1");
        oldRegistry.seedLegacy(INACTIVE, false, "inactive", "v13");
        registryProxy.setLogicContract(address(new ValidatorRegistryMigration(address(this))));
        registry = ValidatorRegistryMigration(address(registryProxy));
    }

    function _operators() internal pure returns (address[] memory operatorKeys, address[] memory validators) {
        operatorKeys = new address[](2);
        operatorKeys[0] = OPERATOR;
        operatorKeys[1] = INACTIVE;
        validators = new address[](2);
        validators[0] = VALIDATOR;
        validators[1] = INACTIVE;
    }

    function _migrate() internal {
        (address[] memory operatorKeys, address[] memory validators) = _operators();
        uint256[] memory counts = new uint256[](2);
        counts[0] = 2;
        address[] memory users = new address[](2);
        users[0] = USER;
        users[1] = REWARDS_ONLY_USER;
        staking.migrateRecords(operatorKeys, validators, counts, users);
        registry.migrateProfiles(operatorKeys, validators);
    }

    function it_preserves_active_positions_and_inactive_rewards_across_final_swap() public {
        (address[] memory operatorKeys, address[] memory validators) = _operators();
        address[] memory shortKeys = new address[](1);
        shortKeys[0] = OPERATOR;
        address[] memory shortValidators = new address[](1);
        shortValidators[0] = VALIDATOR;
        uint256[] memory shortCounts = new uint256[](1);
        shortCounts[0] = 2;
        address[] memory users = new address[](2);
        users[0] = USER;
        users[1] = REWARDS_ONLY_USER;
        bool rejected = false;
        try staking.migrateRecords(shortKeys, shortValidators, shortCounts, users) {
        } catch {
            rejected = true;
        }
        require(rejected, "partial staking migration accepted");
        rejected = false;
        try registry.migrateProfiles(shortKeys, shortValidators) {
        } catch {
            rejected = true;
        }
        require(rejected, "partial registry migration accepted");

        _migrate();
        require(staking.recordCount() == 2 && registry.validatorCount() == 2, "record count");
        require(staking.operatorList(0) == VALIDATOR && staking.operatorList(1) == INACTIVE, "staking keys");
        require(registry.operatorList(0) == VALIDATOR && registry.operatorList(1) == INACTIVE, "registry keys");
        require(staking.delegatedStake(USER, VALIDATOR) == 300 && staking.delegatedStake(USER, OPERATOR) == 0, "principal");
        require(staking.pendingDelegatorRewards(USER, VALIDATOR) == 11, "pending reward");
        require(staking.userRewardPerStakePaid(USER, VALIDATOR) == 4, "checkpoint");
        require(staking.pendingDelegatorRewards(REWARDS_ONLY_USER, VALIDATOR) == 5, "reward-only user");
        require(staking.userRewardPerStakePaid(REWARDS_ONLY_USER, VALIDATOR) == 2, "zero-stake checkpoint");
        require(staking.operatorOf(VALIDATOR) == OPERATOR, "active operator");
        require(staking.operatorOf(INACTIVE) == INACTIVE, "inactive claim owner");
        require(registry.operatorOf(VALIDATOR) == OPERATOR, "registry operator");
        require(registry.protocolValidatorOperators("v1") == VALIDATOR, "protocol id moved");
        require(registry.protocolValidatorOperators("v13") == INACTIVE, "inactive id retained");

        stakingProxy.setLogicContract(address(new StratoStaking(address(this))));
        registryProxy.setLogicContract(address(new ValidatorRegistry(address(this))));
        StratoStaking finalStaking = StratoStaking(address(stakingProxy));
        ValidatorRegistry finalRegistry = ValidatorRegistry(address(registryProxy));
        (,,,,,,,,,,,,,,uint256 pendingBase) = finalStaking.operators(INACTIVE);
        require(pendingBase == 19, "inactive accrued reward lost");
        require(finalRegistry.operatorOf(INACTIVE) == INACTIVE, "inactive profile lost");
    }

    function it_bootstraps_only_a_fully_migrated_active_governance_set() public {
        _migrate();
        staking.setValidatorRegistry(address(registry));
        GenesisGovernanceForMigration gov = new GenesisGovernanceForMigration(address(this));
        gov.seedValidator(VALIDATOR);
        gov.setStakingContract(address(staking));
        staking.setGovernance(address(gov), false);
        staking.setValidatorParams(100, 0, 0, 0);

        bool rejected = false;
        gov.seedValidator(INACTIVE);
        try staking.bootstrapIncumbents() {
        } catch {
            rejected = true;
        }
        require(rejected && staking.validatorCount() == 0, "inactive incumbent seated");

        // A fresh governance set with only the funded, active validator succeeds.
        GenesisGovernanceForMigration activeGov = new GenesisGovernanceForMigration(address(this));
        activeGov.seedValidator(VALIDATOR);
        activeGov.setStakingContract(address(staking));
        staking.setGovernance(address(activeGov), false);
        staking.bootstrapIncumbents();
        require(staking.validatorCount() == 1 && staking.isValidator(VALIDATOR), "incumbent not seated");
        require(staking.governanceSyncEnabled(), "governance sync not enabled");
        require(!staking.isValidator(INACTIVE), "inactive record seated");
        require(!staking.seatedUnderSelfBondRule(VALIDATOR), "incumbent not grandfathered");
        require(activeGov.validatorStake(VALIDATOR) == 300, "governance weight");
    }

    function it_accepts_a_fifteen_record_109_position_one_shot_call() public {
        Proxy largeProxy = new Proxy(address(new LegacyStakingForMigration(address(this))), address(this));
        LegacyStakingForMigration legacy = LegacyStakingForMigration(address(largeProxy));
        legacy.initialize(address(0x1234), address(0x5678), 100, 1000, 150);

        address[] memory operatorKeys = new address[](15);
        address[] memory validators = new address[](15);
        uint256[] memory counts = new uint256[](15);
        address[] memory users = new address[](109);
        uint256 position = 0;
        for (uint256 i = 0; i < 15; i++) {
            address operator = address(uint160(0x10000 + i));
            address validator = address(uint160(0x20000 + i));
            operatorKeys[i] = operator;
            validators[i] = validator;
            counts[i] = i < 5 ? 9 : (i < 13 ? 8 : 0);
            legacy.seedLegacy(operator, i < 13, counts[i], 0);
            for (uint256 j = 0; j < counts[i]; j++) {
                address user = address(uint160(0x30000 + position));
                users[position] = user;
                legacy.seedPosition(user, operator, 1, 0, 0);
                position++;
            }
        }
        require(position == 109, "bad fixture");
        legacy.finishSchedule();
        largeProxy.setLogicContract(address(new StratoStakingMigration(address(this))));
        StratoStakingMigration large = StratoStakingMigration(address(largeProxy));
        large.migrateRecords(operatorKeys, validators, counts, users);
        require(large.recordCount() == 15 && large.delegatedStake(users[108], validators[12]) == 1,
                "large migration failed");
    }
}
