import "../../abstract/ERC20/access/Ownable.sol";

// Staking-side hooks the registry drives. Everything is keyed by validator address.
interface IStratoStakingValidatorSync {
    function syncValidatorRecord(address validator, bool active, uint256 commissionBps, address operator) external;
    function syncValidatorOperator(address validator, address operator) external;
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
// operatorAuthorizationDigest. First listing by the owner (an admin vote) is the one
// exception, since the admins vouch for the binding. Nobody can claim a node they do not
// run, and nobody, the owner included, moves a validator to another operator without the
// key. A consented handover binds here at once; the staking contract gives it a week's
// notice and completes it when the incoming operator has bonded.
//
// Delisting is the owner's (the admins', collectively) quality-control power, and it is
// accountable: an ordinary removal is announced with its published grounds and executes
// NOTICE_SECONDS later; the emergency path removes one named validator at once, with its
// grounds on record. Both go through the staking contract's per-block churn and readiness
// rules like any other change to the set.
//
// Upgraded in place on helium from an operator-keyed layout. SolidVM storage is keyed by
// name, so the historical names stay (operators, operatorList, protocolValidatorOperators)
// and are now keyed by validator. Helium listed every validator as its own operator, so a
// profile written before the switch has no operator field and its key is its operator.
contract ValidatorRegistry is Ownable {
    event Initialized(address indexed staking);
    event ValidatorListed(address indexed validator, address indexed operator, uint256 commissionBps);
    event ValidatorRelisted(address indexed validator, address indexed operator, uint256 commissionBps);
    event RemovalAnnounced(address indexed validator, string grounds, uint256 readyTime);
    event RemovalCancelled(address indexed validator);
    event ValidatorDelisted(address indexed validator);
    event ValidatorRemoved(address indexed validator, string grounds, bool emergency);
    event ValidatorProfileUpdated(address indexed validator);
    event OperatorChanged(address indexed validator, address indexed oldOperator, address indexed newOperator);

    // Seven days: the notice before an announced removal executes.
    uint256 public constant NOTICE_SECONDS = 604800;

    IStratoStakingValidatorSync public staking;

    // Validators in listing order. Delisted validators stay so their records remain addressable.
    address[] public operatorList;
    mapping(address => ValidatorProfile) public operators;
    mapping(string => address) public protocolValidatorOperators;
    // Operator authorizations each validator key has granted. Part of the signed digest, so
    // every signature is good for exactly one binding.
    mapping(address => uint256) public authorizationNonce;
    // An announced removal: when it was announced and the published grounds.
    mapping(address => uint256) public removalAnnouncedAt;
    mapping(address => string) public removalGrounds;

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
        // `+ 0` materialises a never-written nonce. SolidVM feeds an unwritten storage slot to
        // abi.encodePacked as zero bytes, not as uint256(0), which dropped the nonce from the
        // digest of every validator that had not yet consented, so no first signature could
        // verify. Not redundant.
        return authorizationDigest(address(this), validator, operator, authorizationNonce[validator] + 0);
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

        // Relisting reuses the validator's slot and keeps its operator: moving a validator to
        // another operator is the key's decision, not the owner's.
        require(!profile.active, "VR: validator active");
        require(operator == operatorOf(validator), "VR: handover needs consent");
        _setProtocolValidatorId(validator, profile.protocolValidatorId, protocolValidatorId);
        profile.active = true;
        profile.name = name;
        profile.description = description;
        profile.metadataURI = metadataURI;
        profile.protocolValidatorId = protocolValidatorId;

        staking.syncValidatorRecord(validator, true, commissionBps, operator);
        emit ValidatorRelisted(validator, operator, commissionBps);
    }

    // Admin listing (and relisting of a delisted validator under its operator). The admins
    // vouch for a first binding, so no validator signature is needed.
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

    // Hand a validator to a new operator, with the validator key's consent to that operator.
    // The binding moves here; staking announces the handover and completes it a week later,
    // once the incoming operator has bonded, paying the outgoing operator out then. Until
    // then the outgoing operator still operates in staking's eyes; the key may bind back to
    // it to withdraw the handover.
    function setOperator(address validator, address newOperator, uint8 v, uint256 r, uint256 s) external {
        require(operators[validator].exists, "VR: validator missing");
        require(newOperator != address(0), "VR: operator=0");
        address oldOperator = operatorOf(validator);
        require(oldOperator != newOperator, "VR: same operator");
        _consumeAuthorization(validator, newOperator, v, r, s);
        operators[validator].operator = newOperator;
        staking.syncValidatorOperator(validator, newOperator);
        emit OperatorChanged(validator, oldOperator, newOperator);
    }

    // ---- delisting and profile ----------------------------------------------------------

    function _delist(address validator, string grounds, bool emergency) internal {
        ValidatorProfile storage profile = operators[validator];
        require(profile.exists, "VR: validator missing");
        require(profile.active, "VR: validator inactive");

        profile.active = false;
        removalAnnouncedAt[validator] = 0;
        delete removalGrounds[validator];
        // Delisting stops future income in staking and returns the operator's bond, but does
        // not erase historical state or claims.
        staking.syncValidatorRecord(validator, false, 0, operatorOf(validator));

        emit ValidatorDelisted(validator);
        emit ValidatorRemoved(validator, grounds, emergency);
    }

    // Ordinary removal, step one: publish the grounds and start the notice.
    function announceRemoval(address validator, string grounds) external onlyOwner {
        ValidatorProfile storage profile = operators[validator];
        require(profile.exists && profile.active, "VR: validator missing");
        require(bytes(grounds).length > 0, "VR: grounds required");
        removalAnnouncedAt[validator] = block.timestamp;
        removalGrounds[validator] = grounds;
        emit RemovalAnnounced(validator, grounds, block.timestamp + NOTICE_SECONDS);
    }

    function cancelRemoval(address validator) external onlyOwner {
        require(removalAnnouncedAt[validator] != 0, "VR: no removal pending");
        removalAnnouncedAt[validator] = 0;
        delete removalGrounds[validator];
        emit RemovalCancelled(validator);
    }

    // Ordinary removal, step two: execute an announced removal once its notice has run.
    function removeValidator(address validator) external onlyOwner {
        require(removalAnnouncedAt[validator] != 0, "VR: removal not announced");
        require(block.timestamp >= removalAnnouncedAt[validator] + NOTICE_SECONDS, "VR: removal notice running");
        _delist(validator, removalGrounds[validator], false);
    }

    // The emergency path: one named validator, at once, with its grounds on record.
    function emergencyRemove(address validator, string grounds) external onlyOwner {
        require(bytes(grounds).length > 0, "VR: grounds required");
        _delist(validator, grounds, true);
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
