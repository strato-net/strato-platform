import "./ValidatorRegistry.sol";

// Temporary logic for an in-place upgrade of an operator-keyed registry proxy.
contract ValidatorRegistryMigration is ValidatorRegistry {
    event ProfileMigrated(address indexed operator, address indexed validator, string protocolValidatorId);
    event MigrationComplete(uint256 profiles);

    bool public profilesMigrated;

    constructor(address initialOwner) ValidatorRegistry(initialOwner) { }

    function migrateProfiles(address[] operatorKeys, address[] validators) external onlyOwner {
        require(!profilesMigrated, "RM: already migrated");
        uint256 count = operatorKeys.length;
        require(count > 0 && count == operatorList.length, "RM: incomplete operator list");
        require(validators.length == count, "RM: length mismatch");

        for (uint256 i = 0; i < count; i++) {
            address from = operatorKeys[i];
            address to = validators[i];
            require(from == operatorList[i], "RM: operator order mismatch");
            require(to != address(0), "RM: validator=0");
            require(operators[from].exists && operators[from].operator == address(0), "RM: not a legacy profile");
            if (to != from) {
                require(!operators[to].exists, "RM: validator already has a profile");
            }
            for (uint256 j = 0; j < i; j++) {
                require(validators[j] != to, "RM: duplicate validator");
            }
            string id = operators[from].protocolValidatorId;
            if (bytes(id).length > 0) {
                require(protocolValidatorOperators[id] == from, "RM: protocol id mismatch");
            }
        }

        for (uint256 i = 0; i < count; i++) {
            address from = operatorKeys[i];
            address to = validators[i];
            string id = operators[from].protocolValidatorId;
            if (to != from) {
                _moveProfile(from, to);
                operatorList[i] = to;
                if (bytes(id).length > 0) protocolValidatorOperators[id] = to;
            }
            emit ProfileMigrated(from, to, id);
        }
        profilesMigrated = true;
        emit MigrationComplete(count);
    }

    function _moveProfile(address from, address to) internal {
        ValidatorProfile storage a = operators[from];
        ValidatorProfile storage b = operators[to];
        b.exists = true;
        b.active = a.active;
        b.name = a.name;
        b.description = a.description;
        b.metadataURI = a.metadataURI;
        b.protocolValidatorId = a.protocolValidatorId;
        b.operator = from;

        a.exists = false;
        a.active = false;
        a.name = "";
        a.description = "";
        a.metadataURI = "";
        a.protocolValidatorId = "";
    }
}
