interface IMultisigVersionRegistry {
    function isVersionApproved(string version, address logic) external view returns (bool);
    function isUpgradePathApproved(string fromVersion, string toVersion) external view returns (bool);
}

/**
 * @title MultisigWallet
 * @notice Permanent treasury address and upgrade shell for MultisigLogic.
 */
contract record MultisigWallet {
    uint public constant UPGRADE_DELAY = 604800; // 7 days
    uint public constant UPGRADE_EXPIRY_WINDOW = 604800; // 7 days

    struct PendingUpgrade {
        address targetLogic;
        string fromVersion;
        string targetVersion;
        string migrationFunction;
        uint epoch;
        uint executableAt;
        uint expiresAt;
        bool exists;
    }

    address public immutable multisigFactory;
    string public immutable multisigSetupHash;
    address public logicContract;
    string public multisigCurrentVersion;
    uint public multisigEpoch;
    bool public multisigActive;
    bool public multisigUpgradesFrozen;
    PendingUpgrade public multisigPendingUpgrade;

    event UpgradeScheduled(address targetLogic, string fromVersion, string targetVersion, string migrationFunction, uint epoch, uint executableAt, uint expiresAt);
    event UpgradeCancelled(address targetLogic, string targetVersion);
    event UpgradeExecuted(address executor, address previousLogic, address targetLogic, string fromVersion, string targetVersion, uint epoch);
    event UpgradesFrozen(uint epoch);
    event ConfigurationAdvanced(uint epoch);

    modifier onlySelf() {
        require(msg.sender == address(this), "Only the wallet may call");
        _;
    }

    constructor(address _factory, string _setupHash) {
        require(msg.sender == _factory, "Factory must deploy wallet");
        require(_factory != address(0), "Invalid factory");
        multisigFactory = _factory;
        multisigSetupHash = _setupHash;
    }

    function initializeDeployment(
        address _initialLogic,
        string _initialVersion,
        address[] _signers,
        uint _requiredApprovals,
        uint _transactionTimelock
    ) external {
        require(msg.sender == multisigFactory, "Only the factory may initialize");
        require(!multisigActive, "Wallet already initialized");
        require(_initialLogic != address(0), "Invalid logic");
        logicContract = _initialLogic;
        multisigCurrentVersion = _initialVersion;
        multisigEpoch = 1;
        _initialLogic.delegatecall("initialize", _signers, _requiredApprovals, _transactionTimelock);
        multisigActive = true;
    }

    function scheduleUpgrade(
        address _targetLogic,
        string _targetVersion,
        string _migrationFunction
    ) external onlySelf {
        require(!multisigUpgradesFrozen, "Upgrades are frozen");
        require(_targetLogic != address(0), "Invalid logic");
        require(
            IMultisigVersionRegistry(multisigFactory).isVersionApproved(_targetVersion, _targetLogic),
            "Target version is not approved"
        );
        require(
            IMultisigVersionRegistry(multisigFactory).isUpgradePathApproved(multisigCurrentVersion, _targetVersion),
            "Upgrade path is not approved"
        );
        require(
            !multisigPendingUpgrade.exists || block.timestamp > multisigPendingUpgrade.expiresAt,
            "An upgrade is already pending"
        );
        if (_migrationFunction != "") {
            require(_isMigrationName(_migrationFunction), "Invalid migration function");
        }

        uint executableAt = block.timestamp + UPGRADE_DELAY;
        uint expiresAt = executableAt + UPGRADE_EXPIRY_WINDOW;
        multisigPendingUpgrade = PendingUpgrade(
            _targetLogic,
            multisigCurrentVersion,
            _targetVersion,
            _migrationFunction,
            multisigEpoch,
            executableAt,
            expiresAt,
            true
        );
        emit UpgradeScheduled(
            _targetLogic,
            multisigCurrentVersion,
            _targetVersion,
            _migrationFunction,
            multisigEpoch,
            executableAt,
            expiresAt
        );
    }

    function cancelUpgrade() external onlySelf {
        require(multisigPendingUpgrade.exists, "No pending upgrade");
        address targetLogic = multisigPendingUpgrade.targetLogic;
        string targetVersion = multisigPendingUpgrade.targetVersion;
        _clearPendingUpgrade();
        emit UpgradeCancelled(targetLogic, targetVersion);
    }

    function executeUpgrade() external {
        require(!multisigUpgradesFrozen, "Upgrades are frozen");
        PendingUpgrade storage pending = multisigPendingUpgrade;
        require(pending.exists, "No pending upgrade");
        require(block.timestamp >= pending.executableAt, "Upgrade delay has not elapsed");
        require(block.timestamp <= pending.expiresAt, "Upgrade has expired");
        require(pending.epoch == multisigEpoch, "Upgrade epoch is stale");
        require(pending.fromVersion == multisigCurrentVersion, "Current version changed");
        require(
            IMultisigVersionRegistry(multisigFactory).isVersionApproved(pending.targetVersion, pending.targetLogic),
            "Target version is not approved"
        );
        require(
            IMultisigVersionRegistry(multisigFactory).isUpgradePathApproved(multisigCurrentVersion, pending.targetVersion),
            "Upgrade path is not approved"
        );

        address previousLogic = logicContract;
        address targetLogic = pending.targetLogic;
        string fromVersion = multisigCurrentVersion;
        string targetVersion = pending.targetVersion;
        string migrationFunction = pending.migrationFunction;

        logicContract = targetLogic;
        multisigCurrentVersion = targetVersion;
        _clearPendingUpgrade();
        multisigEpoch++;

        if (migrationFunction != "") {
            targetLogic.delegatecall(migrationFunction);
        }
        emit UpgradeExecuted(msg.sender, previousLogic, targetLogic, fromVersion, targetVersion, multisigEpoch);
    }

    function freezeUpgrades() external onlySelf {
        require(!multisigUpgradesFrozen, "Upgrades already frozen");
        _clearPendingUpgrade();
        multisigUpgradesFrozen = true;
        emit UpgradesFrozen(multisigEpoch);
    }

    function advanceConfiguration() external onlySelf {
        _clearPendingUpgrade();
        multisigEpoch++;
        emit ConfigurationAdvanced(multisigEpoch);
    }

    function argumentAt(uint _index, variadic _arguments) external returns (bool) {
        variadic value = _arguments[_index];
        return true;
    }

    function _isMigrationName(string _name) internal returns (bool) {
        bytes name = bytes(_name);
        bytes prefix = bytes("migrate");
        if (name.length < prefix.length) return false;
        for (uint i = 0; i < prefix.length; i++) {
            if (name[i] != prefix[i]) return false;
        }
        return true;
    }

    function _clearPendingUpgrade() internal {
        multisigPendingUpgrade.targetLogic = address(0);
        multisigPendingUpgrade.fromVersion = "";
        multisigPendingUpgrade.targetVersion = "";
        multisigPendingUpgrade.migrationFunction = "";
        multisigPendingUpgrade.epoch = 0;
        multisigPendingUpgrade.executableAt = 0;
        multisigPendingUpgrade.expiresAt = 0;
        multisigPendingUpgrade.exists = false;
    }

    fallback(variadic args) external returns (variadic) {
        require(multisigActive, "Wallet is not active");
        require(!_isMigrationName(msg.sig), "Migration functions run only during an upgrade");
        return logicContract.delegatecall(msg.sig, args);
    }
}
