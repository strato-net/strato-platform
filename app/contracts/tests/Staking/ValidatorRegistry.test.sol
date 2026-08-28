// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

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

contract Describe_ValidatorRegistry {
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

    function it_initializes_once_with_fixed_staking_target() public {
        require(address(registry.staking()) == address(staking), "Initial staking target");

        bool reinitialized = false;
        try registry.initialize(address(staking)) {
        } catch {
            reinitialized = true;
        }
        require(reinitialized, "Registry should initialize once");

        ValidatorRegistry zeroRegistry = new ValidatorRegistry(address(this));
        bool zeroRejected = false;
        try zeroRegistry.initialize(address(0)) {
        } catch {
            zeroRejected = true;
        }
        require(zeroRejected, "Zero staking target rejected");
    }

    function it_adds_operator_profile_and_syncs_staking() public {
        _addOperatorA();

        (bool exists, bool active, string name, string description, string metadataURI, string protocolValidatorId) = _profile(address(operatorA));

        require(registry.operatorCount() == 1, "Operator count");
        require(registry.operatorList(0) == address(operatorA), "Operator list");
        require(exists, "Profile exists");
        require(active, "Profile active");
        require(keccak256(name) == keccak256("Operator A"), "Profile name");
        require(keccak256(description) == keccak256("First operator"), "Profile description");
        require(keccak256(metadataURI) == keccak256("ipfs://operator-a"), "Profile metadata URI");
        require(keccak256(protocolValidatorId) == keccak256("validator-a"), "Protocol validator id");
        require(registry.protocolValidatorOperators("validator-a") == address(operatorA), "Protocol id owner");

        require(staking.syncCount() == 1, "Sync count");
        require(staking.lastOperator() == address(operatorA), "Synced operator");
        require(staking.lastActive(), "Synced active");
        require(staking.lastCommissionBps() == 500, "Synced commission");
        require(staking.operatorActive(address(operatorA)), "Operator active in staking");
        require(staking.operatorCommissionBps(address(operatorA)) == 500, "Operator commission in staking");
    }

    function it_batch_adds_operators() public {
        address[] memory operators = new address[](2);
        operators[0] = address(operatorA);
        operators[1] = address(operatorB);

        uint256[] memory commissions = new uint256[](2);
        commissions[0] = 500;
        commissions[1] = 250;

        string[] memory names = new string[](2);
        names[0] = "Operator A";
        names[1] = "Operator B";

        string[] memory descriptions = new string[](2);
        descriptions[0] = "First operator";
        descriptions[1] = "Second operator";

        string[] memory metadataURIs = new string[](2);
        metadataURIs[0] = "ipfs://operator-a";
        metadataURIs[1] = "ipfs://operator-b";

        string[] memory protocolValidatorIds = new string[](2);
        protocolValidatorIds[0] = "validator-a";
        protocolValidatorIds[1] = "validator-b";

        address[] memory validatorAddresses = new address[](2);
        validatorAddresses[0] = address(0xaaaa);
        validatorAddresses[1] = address(0xbbbb);

        registry.addOperators(operators, commissions, names, descriptions, metadataURIs, protocolValidatorIds, validatorAddresses);

        (bool exists, bool active, string name,,,) = _profile(address(operatorB));

        require(registry.operatorCount() == 2, "Operator count");
        require(registry.operatorList(1) == address(operatorB), "Second operator");
        require(exists, "Operator B exists");
        require(active, "Operator B active");
        require(keccak256(name) == keccak256("Operator B"), "Operator B name");
        require(staking.syncCount() == 2, "Batch sync count");
        require(staking.lastOperator() == address(operatorB), "Last synced operator");
        require(staking.lastCommissionBps() == 250, "Last synced commission");
    }

    function it_rejects_invalid_operator_adds() public {
        bool zeroOperatorRejected = false;
        try registry.addOperator(address(0), 0, "Zero", "", "", "", address(0)) {
        } catch {
            zeroOperatorRejected = true;
        }
        require(zeroOperatorRejected, "Zero operator should reject");

        _addOperatorA();

        bool duplicateRejected = false;
        try registry.addOperator(address(operatorA), 500, "Operator A", "", "", "", address(0)) {
        } catch {
            duplicateRejected = true;
        }
        require(duplicateRejected, "Active duplicate should reject");

        address[] memory operators = new address[](1);
        operators[0] = address(operatorB);

        uint256[] memory commissions = new uint256[](1);
        commissions[0] = 250;

        string[] memory emptyStrings = new string[](0);
        string[] memory oneString = new string[](1);
        oneString[0] = "";

        bool lengthMismatchRejected = false;
        address[] memory oneAddress = new address[](1);
        try registry.addOperators(operators, commissions, emptyStrings, oneString, oneString, oneString, oneAddress) {
        } catch {
            lengthMismatchRejected = true;
        }
        require(lengthMismatchRejected, "Batch length mismatch should reject");
    }

    function it_enforces_unique_non_empty_protocol_validator_ids() public {
        _addOperatorA();

        bool duplicateAddRejected = false;
        try registry.addOperator(address(operatorB), 250, "Operator B", "", "", "validator-a", address(0)) {
        } catch {
            duplicateAddRejected = true;
        }
        require(duplicateAddRejected, "Duplicate protocol id add should reject");

        registry.addOperator(address(operatorB), 250, "Operator B", "", "", "validator-b", address(0));

        bool duplicateUpdateRejected = false;
        try operatorB.do(
            address(registry),
            "updateProfile",
            address(operatorB),
            "Operator B",
            "",
            "",
            "validator-a"
        ) {
        } catch {
            duplicateUpdateRejected = true;
        }
        require(duplicateUpdateRejected, "Duplicate protocol id update should reject");

        registry.updateProfile(address(operatorA), "Operator A", "", "", "validator-a-v2");
        require(registry.protocolValidatorOperators("validator-a") == address(0), "Old protocol id cleared");
        require(registry.protocolValidatorOperators("validator-a-v2") == address(operatorA), "New protocol id owner");

        registry.updateProfile(address(operatorB), "Operator B", "", "", "validator-a");
        require(registry.protocolValidatorOperators("validator-a") == address(operatorB), "Released protocol id reused");
    }

    function it_allows_operator_and_owner_profile_updates() public {
        _addOperatorA();

        operatorA.do(
            address(registry),
            "updateProfile",
            address(operatorA),
            "Operator A Self",
            "Self updated",
            "ipfs://self",
            "validator-a-self"
        );

        (,, string selfName, string selfDescription, string selfMetadataURI, string selfProtocolValidatorId) = _profile(address(operatorA));
        require(keccak256(selfName) == keccak256("Operator A Self"), "Self update name");
        require(keccak256(selfDescription) == keccak256("Self updated"), "Self update description");
        require(keccak256(selfMetadataURI) == keccak256("ipfs://self"), "Self update metadata");
        require(keccak256(selfProtocolValidatorId) == keccak256("validator-a-self"), "Self update protocol id");
        require(registry.protocolValidatorOperators("validator-a") == address(0), "Old self protocol id cleared");
        require(registry.protocolValidatorOperators("validator-a-self") == address(operatorA), "Self protocol id owner");

        registry.updateProfile(address(operatorA), "Operator A Admin", "Admin updated", "ipfs://admin", "validator-a-admin");

        (,, string adminName, string adminDescription, string adminMetadataURI, string adminProtocolValidatorId) = _profile(address(operatorA));
        require(keccak256(adminName) == keccak256("Operator A Admin"), "Admin update name");
        require(keccak256(adminDescription) == keccak256("Admin updated"), "Admin update description");
        require(keccak256(adminMetadataURI) == keccak256("ipfs://admin"), "Admin update metadata");
        require(keccak256(adminProtocolValidatorId) == keccak256("validator-a-admin"), "Admin update protocol id");
        require(registry.protocolValidatorOperators("validator-a-self") == address(0), "Old admin protocol id cleared");
        require(registry.protocolValidatorOperators("validator-a-admin") == address(operatorA), "Admin protocol id owner");
    }

    function it_rejects_profile_update_by_unrelated_user() public {
        _addOperatorA();

        bool unauthorized = false;
        try user.do(
            address(registry),
            "updateProfile",
            address(operatorA),
            "Bad Update",
            "",
            "",
            ""
        ) {
        } catch {
            unauthorized = true;
        }
        require(unauthorized, "Unrelated user should not update profile");

        bool missingRejected = false;
        try registry.updateProfile(address(operatorB), "Missing", "", "", "") {
        } catch {
            missingRejected = true;
        }
        require(missingRejected, "Missing operator should reject profile update");
    }

    function it_removes_operator_syncs_staking_and_reactivates_without_duplicate_list_entry() public {
        _addOperatorA();

        registry.removeOperator(address(operatorA));

        (, bool active,,,,) = _profile(address(operatorA));
        require(!active, "Operator inactive");
        require(registry.operatorCount() == 1, "Operator count after removal");
        require(staking.syncCount() == 2, "Removal sync count");
        require(staking.lastOperator() == address(operatorA), "Removed operator synced");
        require(!staking.lastActive(), "Removal synced inactive");
        require(staking.lastCommissionBps() == 0, "Removal commission");
        require(!staking.operatorActive(address(operatorA)), "Operator inactive in staking");

        bool duplicateRemovalRejected = false;
        try registry.removeOperator(address(operatorA)) {
        } catch {
            duplicateRemovalRejected = true;
        }
        require(duplicateRemovalRejected, "Inactive removal should reject");

        registry.addOperator(address(operatorA), 700, "Operator A Reactivated", "Back online", "", "validator-a-v2", address(0));

        (, bool reactivated, string name, string description,, string protocolValidatorId) = _profile(address(operatorA));
        require(reactivated, "Operator reactivated");
        require(registry.operatorCount() == 1, "Reactivation should not duplicate list entry");
        require(keccak256(name) == keccak256("Operator A Reactivated"), "Reactivated name");
        require(keccak256(description) == keccak256("Back online"), "Reactivated description");
        require(keccak256(protocolValidatorId) == keccak256("validator-a-v2"), "Reactivated protocol id");
        require(staking.syncCount() == 3, "Reactivation sync count");
        require(staking.operatorActive(address(operatorA)), "Operator active in staking");
        require(staking.operatorCommissionBps(address(operatorA)) == 700, "Reactivated commission");
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
