import "../../abstract/ERC20/access/Ownable.sol";

// Minimal interface used to keep staking accounting in sync with registry lifecycle changes.
interface IStratoStakingOperatorSync {
    function syncOperator(address operator, bool active, uint256 commissionBps) external;
}

// Human-facing validator metadata. The operator address is the canonical on-chain key;
// protocolValidatorId is display/future protocol mapping data, not an auth address.
struct ValidatorProfile {
    bool exists;
    bool active;
    string name;
    string description;
    string metadataURI;
    string protocolValidatorId;
}

// Permissioned validator profile registry. Staking owns balances/rewards; this contract
// owns who is active and what metadata users see for each operator.
contract record ValidatorRegistry is Ownable {
    event Initialized(address indexed staking);
    event StakingUpdated(address indexed oldStaking, address indexed newStaking);
    event OperatorAdded(address indexed operator, uint256 commissionBps);
    event OperatorRemoved(address indexed operator);
    event OperatorReactivated(address indexed operator, uint256 commissionBps);
    event OperatorProfileUpdated(address indexed operator);

    IStratoStakingOperatorSync public staking;

    // Operators remain in the list after removal so historical records stay addressable.
    address[] public record operatorList;
    mapping(address => ValidatorProfile) public record operators;
    mapping(string => address) public record protocolValidatorOperators;

    constructor(address initialOwner) Ownable(initialOwner) { }

    modifier onlyOperatorProfileManager(address operator) {
        ValidatorProfile storage profile = operators[operator];
        require(profile.exists, "VR: operator missing");
        require(msg.sender == owner() || msg.sender == operator, "VR: not operator");
        _;
    }

    function initialize(address _staking) external onlyOwner {
        require(address(staking) == address(0), "VR: initialized");
        _setStaking(_staking);
        emit Initialized(_staking);
    }

    function operatorCount() external view returns (uint256) {
        return operatorList.length;
    }

    function _setStaking(address _staking) internal {
        require(_staking != address(0), "VR: staking=0");
        address oldStaking = address(staking);
        staking = IStratoStakingOperatorSync(_staking);
        emit StakingUpdated(oldStaking, _staking);
    }

    function setStaking(address _staking) external onlyOwner {
        _setStaking(_staking);
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

    function _addOperator(
        address operator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) internal {
        require(address(staking) != address(0), "VR: staking missing");
        require(operator != address(0), "VR: operator=0");

        ValidatorProfile storage profile = operators[operator];

        // First add creates the profile and the staking accounting record.
        if (!profile.exists) {
            _setProtocolValidatorId(operator, "", protocolValidatorId);
            operators[operator] = ValidatorProfile(
                true,
                true,
                name,
                description,
                metadataURI,
                protocolValidatorId
            );
            operatorList.push(operator);
            staking.syncOperator(operator, true, commissionBps);
            emit OperatorAdded(operator, commissionBps);
            return;
        }

        // Reactivation reuses the existing operator slot and resyncs staking accounting.
        require(!profile.active, "VR: operator active");
        _setProtocolValidatorId(operator, profile.protocolValidatorId, protocolValidatorId);
        profile.active = true;
        profile.name = name;
        profile.description = description;
        profile.metadataURI = metadataURI;
        profile.protocolValidatorId = protocolValidatorId;

        staking.syncOperator(operator, true, commissionBps);
        emit OperatorReactivated(operator, commissionBps);
    }

    function addOperator(
        address operator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) external onlyOwner {
        _addOperator(operator, commissionBps, name, description, metadataURI, protocolValidatorId);
    }

    function addOperators(
        address[] operators_,
        uint256[] commissionBps,
        string[] names,
        string[] descriptions,
        string[] metadataURIs,
        string[] protocolValidatorIds
    ) external onlyOwner {
        uint256 count = operators_.length;
        require(count > 0, "VR: empty batch");
        require(commissionBps.length == count, "VR: length mismatch");
        require(names.length == count, "VR: length mismatch");
        require(descriptions.length == count, "VR: length mismatch");
        require(metadataURIs.length == count, "VR: length mismatch");
        require(protocolValidatorIds.length == count, "VR: length mismatch");

        for (uint256 i = 0; i < count; i++) {
            _addOperator(
                operators_[i],
                commissionBps[i],
                names[i],
                descriptions[i],
                metadataURIs[i],
                protocolValidatorIds[i]
            );
        }
    }

    function removeOperator(address operator) external onlyOwner {
        ValidatorProfile storage profile = operators[operator];
        require(profile.exists, "VR: operator missing");
        require(profile.active, "VR: operator inactive");

        profile.active = false;
        // Removal stops future accrual in staking but does not erase historical state.
        staking.syncOperator(operator, false, 0);

        emit OperatorRemoved(operator);
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
