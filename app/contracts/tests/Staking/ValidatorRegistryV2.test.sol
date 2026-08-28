// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

// ─────────────────────────────────────────────────────────────────────────────
// V2 staking tests. These run against ValidatorRegistryV2.sol, which is parked
// outside BaseCodeCollection until the validator fleet is upgraded past the
// staking fork.
//
// NOT run by Jenkins: the "Contract tests" stage skips *V2.test.sol. Run them
// by hand with:  solid-vm-cli test ValidatorRegistryV2.test.sol
//
// The V1 tests for the shipped contract live in the matching non-V2 file.
// ─────────────────────────────────────────────────────────────────────────────

import "../../concrete/Staking/ValidatorRegistryV2.sol";
import "../Util.sol";

contract record MockOperatorSync is IStratoStakingOperatorSync {
    uint256 public syncCount;
    address public lastOperator;
    bool public lastActive;
    uint256 public lastCommissionBps;

    address public lastValidatorAddress;
    uint256 public validatorAddressSyncCount;

    mapping(address => bool) public record operatorActive;
    mapping(address => uint256) public record operatorCommissionBps;
    mapping(address => address) public record operatorValidator;

    function syncOperator(address operator, bool active, uint256 commissionBps, address validatorAddress) external override {
        syncCount += 1;
        lastOperator = operator;
        lastActive = active;
        lastCommissionBps = commissionBps;
        lastValidatorAddress = validatorAddress;
        operatorActive[operator] = active;
        operatorCommissionBps[operator] = commissionBps;
        operatorValidator[operator] = validatorAddress;
    }

    function syncValidatorAddress(address operator, address validatorAddress) external override {
        validatorAddressSyncCount += 1;
        lastOperator = operator;
        lastValidatorAddress = validatorAddress;
        operatorValidator[operator] = validatorAddress;
    }

    mapping(address => bool) public record overOneThird;
    function setOverOneThird(address operator, bool over) public { overOneThird[operator] = over; }
    function exceedsOneThird(address operator) external view override returns (bool) { return overOneThird[operator]; }
}

contract Describe_ValidatorRegistryV2 {
    ValidatorRegistry registry;
    MockOperatorSync staking;

    User operatorA;
    User operatorB;
    User user;

    function beforeAll() public {
        operatorA = new User();
        operatorB = new User();
        user = new User();
    }

    function beforeEach() public {
        staking = new MockOperatorSync();
        registry = new ValidatorRegistry(address(this));
        registry.initialize(address(staking));
    }

    function _addOperatorA() internal {
        registry.addOperator(address(operatorA), 500, "Operator A", "First operator", "ipfs://operator-a", "validator-a", address(0));
    }

    function _profile(address operator) internal returns (
        bool exists,
        bool active,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) {
        address validatorAddress;
        (exists, active, name, description, metadataURI, protocolValidatorId, validatorAddress) = registry.operators(operator);
    }









    function it_binds_validator_addresses_uniquely_and_syncs_staking() public {
        registry.addOperator(address(operatorA), 500, "Operator A", "", "", "validator-a", address(0xaaaa));
        (,,,,,, address validatorAddress) = registry.operators(address(operatorA));
        require(validatorAddress == address(0xaaaa), "Profile validator address");
        require(registry.validatorOperators(address(0xaaaa)) == address(operatorA), "Reverse lookup");
        require(staking.lastValidatorAddress() == address(0xaaaa), "Synced to staking on add");

        bool duplicateRejected = false;
        try registry.addOperator(address(operatorB), 250, "Operator B", "", "", "validator-b", address(0xaaaa)) {
        } catch {
            duplicateRejected = true;
        }
        require(duplicateRejected, "Validator address must be unique");

        registry.setValidatorAddress(address(operatorA), address(0xabcd));
        require(registry.validatorOperators(address(0xaaaa)) == address(0), "Old address released");
        require(registry.validatorOperators(address(0xabcd)) == address(operatorA), "New address bound");
        require(staking.validatorAddressSyncCount() == 1, "Address change synced to staking");
        require(staking.operatorValidator(address(operatorA)) == address(0xabcd), "Staking sees the new address");

        registry.setValidatorAddress(address(operatorA), address(0));
        require(registry.validatorOperators(address(0xabcd)) == address(0), "Zero clears the binding");

        bool unauthorizedRejected = false;
        try user.do(address(registry), "setValidatorAddress(address,address)", address(operatorA), address(0x1234)) {
        } catch {
            unauthorizedRejected = true;
        }
        require(unauthorizedRejected, "Only the owner binds validator addresses");

        registry.removeOperator(address(operatorA));
        require(staking.lastValidatorAddress() == address(0), "Removal passes the stored address");
    }

    function it_emergency_kick_only_by_the_kicker_and_only_over_one_third() public {
        _addOperatorA();
        user.doExpectingFailure(address(registry), "emergencyKick(address)", "VR: not the emergency kicker", address(operatorA));

        registry.setEmergencyKicker(address(user));
        user.doExpectingFailure(address(registry), "emergencyKick(address)", "VR: operator below one third of stake", address(operatorA));

        staking.setOverOneThird(address(operatorA), true);
        user.doSuccessfully(address(registry), "emergencyKick(address)", address(operatorA));
        (, bool active,,,,,) = registry.operators(address(operatorA));
        require(!active, "Operator removed");
        require(!staking.lastActive(), "Staking synced as removed");
    }
}
