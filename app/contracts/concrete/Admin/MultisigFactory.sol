import "../../abstract/ERC20/access/Ownable.sol";
import "./MultisigWallet.sol";

/**
 * @title MultisigFactory
 * @notice Canonical registry and deterministic deployment factory for dedicated multisigs.
 */
contract record MultisigFactory is Ownable {
    uint public constant SETUP_LIFETIME = 2592000; // 30 days
    uint public constant MAX_TRANSACTION_TIMELOCK = 2592000; // 30 days

    struct LogicVersion {
        address logic;
        bool approved;
        bool revoked;
    }

    struct PendingSetup {
        address creator;
        address initialLogic;
        string initialVersion;
        uint requiredApprovals;
        uint transactionTimelock;
        uint expiresAt;
        uint confirmations;
        bool exists;
        bool deployed;
        bool cancelled;
        string label;
    }

    mapping (string => LogicVersion) public record logicVersions;
    mapping (string => mapping (string => bool)) public record upgradePaths;

    mapping (string => PendingSetup) public record pendingSetups;
    mapping (string => address[]) public record setupSigners;
    mapping (string => mapping (address => bool)) public record setupConfirmations;

    mapping (address => bool) public record factoryWallets;
    address public registryGovernance;
    uint public setupNonce;

    event RegistryGovernanceChanged(address previousGovernance, address newGovernance);
    event LogicVersionPublished(string version, address logic);
    event LogicVersionRevoked(string version, address logic);
    event UpgradePathSet(string fromVersion, string toVersion, bool approved);
    event MultisigSetupRegistered(string setupHash, address creator, address[] signers, uint requiredApprovals, uint transactionTimelock, string initialVersion, uint expiresAt, string label);
    event InitialSignerConfirmed(string setupHash, address signer, uint confirmations, uint totalSigners);
    event MultisigSetupCancelled(string setupHash, address sender);
    event MultisigCreated(address wallet, address creator, address[] signers, uint requiredApprovals, uint transactionTimelock, string initialVersion, string setupHash, string label);

    constructor(address _governance) Ownable(_governance) {}

    modifier onlyRegistryGovernance() {
        require(msg.sender == registryGovernance, "Only registry governance");
        _;
    }

    function initializeRegistryGovernance(address _registryGovernance) external onlyOwner {
        require(registryGovernance == address(0), "Registry governance already initialized");
        require(_registryGovernance != address(0), "Invalid registry governance");
        registryGovernance = _registryGovernance;
        emit RegistryGovernanceChanged(address(0), _registryGovernance);
    }

    function setRegistryGovernance(address _registryGovernance) external onlyRegistryGovernance {
        require(_registryGovernance != address(0), "Invalid registry governance");
        address previous = registryGovernance;
        registryGovernance = _registryGovernance;
        emit RegistryGovernanceChanged(previous, _registryGovernance);
    }

    function publishLogicVersion(string _version, address _logic) external onlyRegistryGovernance {
        require(_version != "", "Version is required");
        require(_logic != address(0), "Invalid logic");
        LogicVersion storage existing = logicVersions[_version];
        require(!existing.approved, "Version already exists");
        logicVersions[_version] = LogicVersion(_logic, true, false);
        emit LogicVersionPublished(_version, _logic);
    }

    function revokeLogicVersion(string _version) external onlyRegistryGovernance {
        LogicVersion storage version = logicVersions[_version];
        require(version.approved, "Unknown version");
        require(!version.revoked, "Version already revoked");
        version.revoked = true;
        emit LogicVersionRevoked(_version, version.logic);
    }

    function setUpgradePath(string _fromVersion, string _toVersion, bool _approved) external onlyRegistryGovernance {
        require(logicVersions[_fromVersion].approved, "Unknown source version");
        require(logicVersions[_toVersion].approved, "Unknown target version");
        upgradePaths[_fromVersion][_toVersion] = _approved;
        emit UpgradePathSet(_fromVersion, _toVersion, _approved);
    }

    function isVersionApproved(string _version, address _logic) external view returns (bool) {
        LogicVersion storage version = logicVersions[_version];
        return version.approved && !version.revoked && version.logic == _logic;
    }

    function isUpgradePathApproved(string _fromVersion, string _toVersion) external view returns (bool) {
        return upgradePaths[_fromVersion][_toVersion];
    }

    function registerSetup(
        address[] _signers,
        uint _requiredApprovals,
        uint _transactionTimelock,
        string _initialVersion,
        string _label
    ) external returns (string) {
        address[] canonicalSigners = _canonicalSigners(_signers);
        _validateConfiguration(canonicalSigners, _requiredApprovals);
        require(_transactionTimelock <= MAX_TRANSACTION_TIMELOCK, "Timelock exceeds maximum");
        require(bytes(_label).length <= 64, "Label exceeds 64 bytes");

        LogicVersion storage version = logicVersions[_initialVersion];
        require(version.approved && !version.revoked, "Initial version is not approved");

        string setupHash = keccak256(address(this), setupNonce);
        setupNonce++;

        for (uint i = 0; i < canonicalSigners.length; i++) {
            setupSigners[setupHash].push(canonicalSigners[i]);
        }

        uint expiresAt = block.timestamp + SETUP_LIFETIME;
        pendingSetups[setupHash] = PendingSetup(
            msg.sender,
            version.logic,
            _initialVersion,
            _requiredApprovals,
            _transactionTimelock,
            expiresAt,
            0,
            true,
            false,
            false,
            _label
        );
        emit MultisigSetupRegistered(
            setupHash,
            msg.sender,
            canonicalSigners,
            _requiredApprovals,
            _transactionTimelock,
            _initialVersion,
            expiresAt,
            _label
        );
        return setupHash;
    }

    function confirmSetup(string _setupHash) external returns (address) {
        PendingSetup storage setup = pendingSetups[_setupHash];
        _requirePending(setup);
        require(_isSetupSigner(_setupHash, msg.sender), "Caller is not a setup signer");
        require(!setupConfirmations[_setupHash][msg.sender], "Signer already confirmed");
        setupConfirmations[_setupHash][msg.sender] = true;
        setup.confirmations++;
        emit InitialSignerConfirmed(_setupHash, msg.sender, setup.confirmations, setupSigners[_setupHash].length);
        if (setup.confirmations == setupSigners[_setupHash].length) {
            return _deploy(_setupHash, setup);
        }
        return address(0);
    }

    function cancelSetup(string _setupHash) external {
        PendingSetup storage setup = pendingSetups[_setupHash];
        require(setup.exists && !setup.deployed && !setup.cancelled, "Setup is not pending");
        require(msg.sender == setup.creator || _isSetupSigner(_setupHash, msg.sender), "Not authorized to cancel");
        setup.cancelled = true;
        emit MultisigSetupCancelled(_setupHash, msg.sender);
    }

    function _deploy(string _setupHash, PendingSetup storage _setup) internal returns (address) {
        LogicVersion storage version = logicVersions[_setup.initialVersion];
        require(
            version.approved &&
            !version.revoked &&
            version.logic == _setup.initialLogic,
            "Initial version is no longer approved"
        );

        MultisigWallet wallet = new MultisigWallet{salt: _setupHash}(
            address(this),
            _setupHash
        );
        wallet.initializeDeployment(
            _setup.initialLogic,
            _setup.initialVersion,
            setupSigners[_setupHash],
            _setup.requiredApprovals,
            _setup.transactionTimelock
        );
        _setup.deployed = true;
        factoryWallets[address(wallet)] = true;
        emit MultisigCreated(
            address(wallet),
            _setup.creator,
            setupSigners[_setupHash],
            _setup.requiredApprovals,
            _setup.transactionTimelock,
            _setup.initialVersion,
            _setupHash,
            _setup.label
        );
        return address(wallet);
    }

    function _requirePending(PendingSetup storage _setup) internal {
        require(_setup.exists && !_setup.deployed && !_setup.cancelled, "Setup is not pending");
        require(block.timestamp <= _setup.expiresAt, "Setup has expired");
    }

    function _isSetupSigner(string _setupHash, address _account) internal returns (bool) {
        for (uint i = 0; i < setupSigners[_setupHash].length; i++) {
            if (setupSigners[_setupHash][i] == _account) return true;
        }
        return false;
    }

    function _validateConfiguration(address[] _signers, uint _requiredApprovals) internal {
        require(_signers.length >= 3, "At least three signers are required");
        require(_requiredApprovals >= 2 && _requiredApprovals < _signers.length, "Required approvals must satisfy 2 <= M < N");
        for (uint i = 0; i < _signers.length; i++) {
            require(_signers[i] != address(0), "Invalid signer");
            if (i > 0) require(_signers[i - 1] != _signers[i], "Duplicate signer");
        }
    }

    function _canonicalSigners(address[] _signers) internal returns (address[]) {
        address[] canonical = new address[](_signers.length);
        bool[] used = new bool[](_signers.length);
        for (uint i = 0; i < _signers.length; i++) {
            uint selected = _signers.length;
            for (uint j = 0; j < _signers.length; j++) {
                if (!used[j] && (selected == _signers.length || _addressGreaterThan(_signers[selected], _signers[j]))) {
                    selected = j;
                }
            }
            canonical[i] = _signers[selected];
            used[selected] = true;
        }
        return canonical;
    }

    function _addressGreaterThan(address _left, address _right) internal returns (bool) {
        bytes left = bytes(string(_left));
        bytes right = bytes(string(_right));
        for (uint i = 0; i < left.length; i++) {
            if (uint8(left[i]) > uint8(right[i])) return true;
            if (uint8(left[i]) < uint8(right[i])) return false;
        }
        return false;
    }
}
