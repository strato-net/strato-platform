import "../../abstract/ERC20/access/Ownable.sol";

// Staking-side hooks the registry drives. Everything is keyed by validator address.
interface IStratoStakingValidatorSync {
    function syncValidatorRecord(address validator, bool active, uint256 commissionBps, address operator) external;
    function syncValidatorOperator(address validator, address operator) external;
    function exceedsOneThird(address validator) external view returns (bool);
}

// Human-facing validator metadata, keyed by the validator (consensus node) address. The
// operator is the account that manages the validator: it self-bonds, sets commission and
// collects the operator's share of rewards. protocolValidatorId is display data.
struct ValidatorProfile {
    bool exists;
    bool active;
    string name;
    string description;
    string metadataURI;
    string protocolValidatorId;
    address operator;
}

// Validator registry. Staking owns balances and rewards; this contract owns which
// validators are listed, who operates them, and what users see about them.
//
// A validator can only be bound to an operator with the validator key's consent: a
// transaction sent from the validator address itself, or the key's signature over
// operatorAuthorizationDigest. Listing by the owner (an admin vote) is the one exception,
// since the admins vouch for the binding. Nobody can claim a node they do not run.
//
// Upgraded in place on helium from an operator-keyed layout. SolidVM storage is keyed by
// name, so the historical names stay (operators, operatorList, protocolValidatorOperators)
// and are now keyed by validator. Helium listed every validator as its own operator, so a
// profile written before the switch has no operator field and its key is its operator.
contract ValidatorRegistry is Ownable {
    event Initialized(address indexed staking);
    event ValidatorListed(address indexed validator, address indexed operator, uint256 commissionBps);
    event ValidatorRelisted(address indexed validator, address indexed operator, uint256 commissionBps);
    event ValidatorDelisted(address indexed validator);
    event ValidatorProfileUpdated(address indexed validator);
    event OperatorChanged(address indexed validator, address indexed oldOperator, address indexed newOperator);
    event EmergencyKickerSet(address indexed kicker);
    event EmergencyKick(address indexed validator, address indexed kicker);

    IStratoStakingValidatorSync public staking;
    // Under stake-weighted quorum a validator holding more than a third of the stake can
    // stall the chain and cannot be jailed (no block commits without its seal). This key
    // may delist such a validator without waiting for an owner vote.
    address public emergencyKicker;

    // Validators in listing order. Delisted validators stay so their records remain addressable.
    address[] public operatorList;
    mapping(address => ValidatorProfile) public operators;
    mapping(string => address) public protocolValidatorOperators;
    // Operator authorizations each validator key has granted. Part of the signed digest, so
    // every signature is good for exactly one binding.
    mapping(address => uint256) public authorizationNonce;

    constructor(address initialOwner) Ownable(initialOwner) { }

    modifier onlyProfileManager(address validator) {
        require(operators[validator].exists, "VR: validator missing");
        require(msg.sender == owner() || msg.sender == operatorOf(validator), "VR: not operator");
        _;
    }

    function initialize(address _staking) external onlyOwner {
        require(address(staking) == address(0), "VR: initialized");
        require(_staking != address(0), "VR: staking=0");
        staking = IStratoStakingValidatorSync(_staking);
        emit Initialized(_staking);
    }

    function validatorCount() external view returns (uint256) {
        return operatorList.length;
    }

    function operatorOf(address validator) public view returns (address) {
        ValidatorProfile storage profile = operators[validator];
        if (!profile.exists) return address(0);
        return profile.operator == address(0) ? validator : profile.operator;
    }

    // ---- validator key consent ------------------------------------------------------

    // What a validator key signs to make `operator` its operator. Plain keccak256 over the
    // packed encoding with no message prefix, because a node's vault signs a raw 32-byte
    // hash. The registry address scopes a signature to one network's registry and the nonce
    // makes it single use.
    function authorizationDigest(address registry, address validator, address operator, uint256 nonce) public pure returns (bytes32) {
        return keccak256(abi.encodePacked("STRATO validator operator authorization", registry, validator, operator, nonce));
    }

    function operatorAuthorizationDigest(address validator, address operator) public view returns (bytes32) {
        return authorizationDigest(address(this), validator, operator, authorizationNonce[validator]);
    }

    // Accepts v as a recovery id (0/1) or in the 27/28 form.
    function _recoverSigner(bytes32 digest, uint8 v, uint256 r, uint256 s) internal virtual returns (address) {
        uint8 recoveryV = v < 27 ? v + 27 : v;
        if (recoveryV != 27 && recoveryV != 28) return address(0);
        return ecrecover(digest, recoveryV, r, s);
    }

    // Spend the validator key's consent to `operator`: the key sent this transaction, or it
    // signed the current digest.
    function _consumeAuthorization(address validator, address operator, uint8 v, uint256 r, uint256 s) internal {
        if (msg.sender != validator) {
            address signer = _recoverSigner(operatorAuthorizationDigest(validator, operator), v, r, s);
            require(signer != address(0) && signer == validator, "VR: validator did not authorize operator");
        }
        authorizationNonce[validator] += 1;
    }

    // ---- listing ----------------------------------------------------------------------

    function _sameString(string left, string right) internal pure returns (bool) {
        return keccak256(left) == keccak256(right);
    }

    function _setProtocolValidatorId(address validator, string oldProtocolValidatorId, string newProtocolValidatorId) internal {
        if (_sameString(oldProtocolValidatorId, newProtocolValidatorId)) return;

        if (bytes(newProtocolValidatorId).length > 0) {
            address current = protocolValidatorOperators[newProtocolValidatorId];
            require(current == address(0) || current == validator, "VR: duplicate protocol id");
            protocolValidatorOperators[newProtocolValidatorId] = validator;
        }

        if (bytes(oldProtocolValidatorId).length > 0) {
            delete protocolValidatorOperators[oldProtocolValidatorId];
        }
    }

    function _list(
        address validator,
        address operator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) internal {
        require(address(staking) != address(0), "VR: staking missing");
        require(validator != address(0), "VR: validator=0");
        require(operator != address(0), "VR: operator=0");

        ValidatorProfile storage profile = operators[validator];

        // First listing creates the profile and the staking record.
        if (!profile.exists) {
            _setProtocolValidatorId(validator, "", protocolValidatorId);
            operators[validator] = ValidatorProfile(true, true, name, description, metadataURI, protocolValidatorId, operator);
            operatorList.push(validator);
            staking.syncValidatorRecord(validator, true, commissionBps, operator);
            emit ValidatorListed(validator, operator, commissionBps);
            return;
        }

        // Relisting reuses the validator's slot; staking settles a change of operator.
        require(!profile.active, "VR: validator active");
        address oldOperator = operatorOf(validator);
        _setProtocolValidatorId(validator, profile.protocolValidatorId, protocolValidatorId);
        profile.active = true;
        profile.name = name;
        profile.description = description;
        profile.metadataURI = metadataURI;
        profile.protocolValidatorId = protocolValidatorId;
        profile.operator = operator;

        staking.syncValidatorRecord(validator, true, commissionBps, operator);
        if (oldOperator != operator) emit OperatorChanged(validator, oldOperator, operator);
        emit ValidatorRelisted(validator, operator, commissionBps);
    }

    // Admin listing (and relisting of a delisted validator). The admins vouch for the
    // validator/operator binding, so no validator signature is needed.
    function addValidator(
        address validator,
        address operator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) external onlyOwner {
        _list(validator, operator, commissionBps, name, description, metadataURI, protocolValidatorId);
    }

    function addValidators(
        address[] validators,
        address[] operators_,
        uint256[] commissionBps,
        string[] names,
        string[] descriptions,
        string[] metadataURIs,
        string[] protocolValidatorIds
    ) external onlyOwner {
        uint256 count = validators.length;
        require(count > 0, "VR: empty batch");
        require(operators_.length == count, "VR: length mismatch");
        require(commissionBps.length == count, "VR: length mismatch");
        require(names.length == count, "VR: length mismatch");
        require(descriptions.length == count, "VR: length mismatch");
        require(metadataURIs.length == count, "VR: length mismatch");
        require(protocolValidatorIds.length == count, "VR: length mismatch");

        for (uint256 i = 0; i < count; i++) {
            _list(validators[i], operators_[i], commissionBps[i], names[i], descriptions[i], metadataURIs[i], protocolValidatorIds[i]);
        }
    }

    // Permissionless listing: msg.sender becomes the operator of `validator`, with that
    // validator key's consent (v, r, s over operatorAuthorizationDigest(validator, msg.sender);
    // ignored when the validator key sends the transaction itself). Listing only lets the
    // validator receive stake; joining the consensus set is StratoStaking.tryActivate.
    // Relisting a delisted validator stays with the owner.
    function register(
        address validator,
        uint256 commissionBps,
        string name,
        string description,
        string metadataURI,
        uint8 v,
        uint256 r,
        uint256 s
    ) external {
        require(validator != address(0), "VR: validator=0");
        require(!operators[validator].exists, "VR: already registered");
        _consumeAuthorization(validator, msg.sender, v, r, s);
        _list(validator, msg.sender, commissionBps, name, description, metadataURI, "");
    }

    // ---- operator changes -------------------------------------------------------------

    function _changeOperator(address validator, address newOperator) internal {
        require(newOperator != address(0), "VR: operator=0");
        address oldOperator = operatorOf(validator);
        require(oldOperator != newOperator, "VR: same operator");
        operators[validator].operator = newOperator;
        // Staking pays out and unbonds what the outgoing operator owns.
        staking.syncValidatorOperator(validator, newOperator);
        emit OperatorChanged(validator, oldOperator, newOperator);
    }

    // Hand a validator to a new operator, with the validator key's consent to that operator.
    function setOperator(address validator, address newOperator, uint8 v, uint256 r, uint256 s) external {
        require(operators[validator].exists, "VR: validator missing");
        _consumeAuthorization(validator, newOperator, v, r, s);
        _changeOperator(validator, newOperator);
    }

    function adminSetOperator(address validator, address newOperator) external onlyOwner {
        require(operators[validator].exists, "VR: validator missing");
        _changeOperator(validator, newOperator);
    }

    // ---- delisting and profile ----------------------------------------------------------

    function _delist(address validator) internal {
        ValidatorProfile storage profile = operators[validator];
        require(profile.exists, "VR: validator missing");
        require(profile.active, "VR: validator inactive");

        profile.active = false;
        // Delisting stops future income in staking but does not erase historical state.
        staking.syncValidatorRecord(validator, false, 0, operatorOf(validator));

        emit ValidatorDelisted(validator);
    }

    function removeValidator(address validator) external onlyOwner {
        _delist(validator);
    }

    function setEmergencyKicker(address kicker) external onlyOwner {
        emergencyKicker = kicker;
        emit EmergencyKickerSet(kicker);
    }

    function emergencyKick(address validator) external {
        require(emergencyKicker != address(0) && msg.sender == emergencyKicker, "VR: not the emergency kicker");
        require(staking.exceedsOneThird(validator), "VR: validator below one third of stake");
        _delist(validator);
        emit EmergencyKick(validator, msg.sender);
    }

    function updateProfile(
        address validator,
        string name,
        string description,
        string metadataURI,
        string protocolValidatorId
    ) external onlyProfileManager(validator) {
        ValidatorProfile storage profile = operators[validator];
        _setProtocolValidatorId(validator, profile.protocolValidatorId, protocolValidatorId);
        profile.name = name;
        profile.description = description;
        profile.metadataURI = metadataURI;
        profile.protocolValidatorId = protocolValidatorId;

        emit ValidatorProfileUpdated(validator);
    }
}
