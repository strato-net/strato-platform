import "../../abstract/ERC20/access/Ownable.sol";

// Minimal interface used to keep staking accounting in sync with registry lifecycle changes.
interface IStratoStakingOperatorSync {
    function syncOperator(address operator, bool active, uint256 commissionBps, address validatorAddress) external;
    function syncValidatorAddress(address operator, address validatorAddress) external;
    function exceedsOneThird(address operator) external view returns (bool);
}

// Human-facing validator metadata. The operator address is the canonical on-chain key;
// validatorAddress is the consensus identity (node key) the operator runs, and
// protocolValidatorId is display data.
struct ValidatorProfile {
    bool exists;
    bool active;
    string name;
    string description;
    string metadataURI;
    string protocolValidatorId;
    address validatorAddress;
}

// Permissioned validator profile registry. Staking owns balances/rewards; this contract
// owns who is active and what metadata users see for each operator.
contract  ValidatorRegistry is Ownable {
    event Initialized(address indexed staking);
    event OperatorAdded(address indexed operator, uint256 commissionBps);
    event OperatorRemoved(address indexed operator);
    event OperatorReactivated(address indexed operator, uint256 commissionBps);
    event OperatorProfileUpdated(address indexed operator);
    event ValidatorAddressSet(address indexed operator, address indexed oldValidator, address indexed newValidator);
    event EmergencyKickerSet(address indexed kicker);
    event EmergencyKick(address indexed operator, address indexed kicker);

    IStratoStakingOperatorSync public staking;
    // Under stake-weighted quorum an operator holding more than a third of the stake
    // can stall the chain and cannot be jailed (no block commits without its seal).
    // This key may remove such an operator without waiting for an owner vote.
    address public emergencyKicker;

    // Operators remain in the list after removal so historical records stay addressable.
    address[] public  operatorList;
    mapping(address => ValidatorProfile) public  operators;
    mapping(string => address) public  protocolValidatorOperators;
    // Consensus identity => operator; a validator address belongs to at most one operator.
    mapping(address => address) public  validatorOperators;

    constructor(address initialOwner) Ownable(initialOwner) { }

    modifier onlyOperatorProfileManager(address operator) {
        ValidatorProfile storage profile = operators[operator];
        require(profile.exists, "VR: operator missing");
        require(msg.sender == owner() || msg.sender == operator, "VR: not operator");
        _;
    }

    function initialize(address _staking) external onlyOwner {
        require(address(staking) == address(0), "VR: initialized");
        require(_staking != address(0), "VR: staking=0");
        staking = IStratoStakingOperatorSync(_staking);
        emit Initialized(_staking);
    }

    function operatorCount() external view returns (uint256) {
        return operatorList.length;
    }

    function _sameString(string left, string right) internal pure returns (bool) {
        return keccak256(left) == keccak256(right);
    }

    function _setProtocolValidatorId(address operator, string oldProtocolValidatorId, string newProtocolValidatorId) internal {
        if (_sameString(oldProtocolValidatorId, newProtocolValidatorId)) return;

        if (bytes(newProtocolValidatorId).length > 0) {
            address currentOperator = protocolValidatorOperators[newProtocolValidatorId];
            require(currentOperator == address(0) || currentOperator == operator, "VR: duplicate protocol id");
            protocolValidatorOperators[newProtocolValidatorId] = operator;
        }

        if (bytes(oldProtocolValidatorId).length > 0) {
            delete protocolValidatorOperators[oldProtocolValidatorId];
        }
    }

    function _setValidatorAddress(address operator, address oldValidatorAddress, address newValidatorAddress) internal {
        if (oldValidatorAddress == newValidatorAddress) return;

        if (newValidatorAddress != address(0)) {
            address currentOperator = validatorOperators[newValidatorAddress];
            require(currentOperator == address(0) || currentOperator == operator, "VR: duplicate validator address");
            validatorOperators[newValidatorAddress] = operator;
        }

        if (oldValidatorAddress != address(0)) {
            delete validatorOperators[oldValidatorAddress];
        }

        emit ValidatorAddressSet(operator, oldValidatorAddress, newValidatorAddress);
    }

    function _addOperator(
        address operator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId,
        address validatorAddress
    ) internal {
        require(address(staking) != address(0), "VR: staking missing");
        require(operator != address(0), "VR: operator=0");

        ValidatorProfile storage profile = operators[operator];

        // First add creates the profile and the staking accounting record.
        if (!profile.exists) {
            _setProtocolValidatorId(operator, "", protocolValidatorId);
            _setValidatorAddress(operator, address(0), validatorAddress);
            operators[operator] = ValidatorProfile(
                true,
                true,
                name,
                description,
                metadataURI,
                protocolValidatorId,
                validatorAddress
            );
            operatorList.push(operator);
            staking.syncOperator(operator, true, commissionBps, validatorAddress);
            emit OperatorAdded(operator, commissionBps);
            return;
        }

        // Reactivation reuses the existing operator slot and resyncs staking accounting.
        require(!profile.active, "VR: operator active");
        _setProtocolValidatorId(operator, profile.protocolValidatorId, protocolValidatorId);
        _setValidatorAddress(operator, profile.validatorAddress, validatorAddress);
        profile.active = true;
        profile.name = name;
        profile.description = description;
        profile.metadataURI = metadataURI;
        profile.protocolValidatorId = protocolValidatorId;
        profile.validatorAddress = validatorAddress;

        staking.syncOperator(operator, true, commissionBps, validatorAddress);
        emit OperatorReactivated(operator, commissionBps);
    }

    function addOperator(
        address operator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId,
        address validatorAddress
    ) external onlyOwner {
        _addOperator(operator, commissionBps, name, description, metadataURI, protocolValidatorId, validatorAddress);
    }

    // Permissionless registration of a new operator (msg.sender). Registering only
    // lists the operator so it can self-bond and receive stake; joining the consensus
    // set is StratoStaking.tryActivate (minStake, room, joinsPaused). Reactivation of a
    // removed operator stays with the owner.
    function register(
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId,
        address validatorAddress
    ) external {
        require(!operators[msg.sender].exists, "VR: already registered");
        require(validatorAddress != address(0), "VR: validator address=0");
        _addOperator(msg.sender, commissionBps, name, description, metadataURI, protocolValidatorId, validatorAddress);
    }

    function addOperators(
        address[] operators_,
        uint256[] commissionBps,
        string[] names,
        string[] descriptions,
        string[] metadataURIs,
        string[] protocolValidatorIds,
        address[] validatorAddresses
    ) external onlyOwner {
        uint256 count = operators_.length;
        require(count > 0, "VR: empty batch");
        require(commissionBps.length == count, "VR: length mismatch");
        require(names.length == count, "VR: length mismatch");
        require(descriptions.length == count, "VR: length mismatch");
        require(metadataURIs.length == count, "VR: length mismatch");
        require(protocolValidatorIds.length == count, "VR: length mismatch");
        require(validatorAddresses.length == count, "VR: length mismatch");

        for (uint256 i = 0; i < count; i++) {
            _addOperator(
                operators_[i],
                commissionBps[i],
                names[i],
                descriptions[i],
                metadataURIs[i],
                protocolValidatorIds[i],
                validatorAddresses[i]
            );
        }
    }

    // The validator address is a consensus identity, so only the owner may bind it.
    // A zero address clears it (the operator then cannot be a validator).
    function setValidatorAddress(address operator, address validatorAddress) external onlyOwner {
        ValidatorProfile storage profile = operators[operator];
        require(profile.exists, "VR: operator missing");

        _setValidatorAddress(operator, profile.validatorAddress, validatorAddress);
        profile.validatorAddress = validatorAddress;
        staking.syncValidatorAddress(operator, validatorAddress);
    }

    function _removeOperator(address operator) internal {
        ValidatorProfile storage profile = operators[operator];
        require(profile.exists, "VR: operator missing");
        require(profile.active, "VR: operator inactive");

        profile.active = false;
        // Removal stops future accrual in staking but does not erase historical state.
        staking.syncOperator(operator, false, 0, profile.validatorAddress);

        emit OperatorRemoved(operator);
    }

    function removeOperator(address operator) external onlyOwner {
        _removeOperator(operator);
    }

    function setEmergencyKicker(address kicker) external onlyOwner {
        emergencyKicker = kicker;
        emit EmergencyKickerSet(kicker);
    }

    function emergencyKick(address operator) external {
        require(emergencyKicker != address(0) && msg.sender == emergencyKicker, "VR: not the emergency kicker");
        require(staking.exceedsOneThird(operator), "VR: operator below one third of stake");
        _removeOperator(operator);
        emit EmergencyKick(operator, msg.sender);
    }

    function updateProfile(
        address operator,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) external onlyOperatorProfileManager(operator) {
        ValidatorProfile storage profile = operators[operator];
        _setProtocolValidatorId(operator, profile.protocolValidatorId, protocolValidatorId);
        profile.name = name;
        profile.description = description;
        profile.metadataURI = metadataURI;
        profile.protocolValidatorId = protocolValidatorId;

        emit OperatorProfileUpdated(operator);
    }
}
