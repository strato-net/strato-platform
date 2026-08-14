// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

interface ISP1VerifierSolidVM {
    function verifyProof(bytes32 programVKey, bytes memory publicValues, bytes memory proofBytes) external view;
}

/// @title SP1 Helios light client for SolidVM
/// @notice Stores Ethereum headers and storage values committed by the
/// Across-pinned SP1 Helios program. Public values are decoded as canonical
/// Solidity ABI bytes so they can be passed through unchanged by the prover.
contract SP1HeliosSolidVM {
    uint public GENESIS_TIME;
    uint public SECONDS_PER_SLOT;
    uint public SLOTS_PER_PERIOD;
    uint public SLOTS_PER_EPOCH;
    uint public constant MAX_SLOT_AGE = 604800;

    uint public head;
    mapping(uint => bytes32) public headers;
    mapping(uint => bytes32) public executionStateRoots;
    mapping(uint => bytes32) public syncCommittees;
    mapping(uint => bool) internal syncCommitteeSet;
    mapping(bytes32 => bytes32) public storageValues;

    bytes32 public heliosProgramVkey;
    address public verifier;
    bytes32 constant DEFAULT_ADMIN_ROLE_VALUE = bytes32(0);
    bytes32 constant STATE_UPDATER_ROLE_VALUE = bytes32(
        0x7f496d3b3a5b8d5d66b1301ac9407fb7ebb241c9fb60310446582db629b01709
    );
    bytes32 constant VKEY_UPDATER_ROLE_VALUE = bytes32(
        0x07ecc55c8d82c6f82ef86e34d1905e0f2873c085733fa96f8a6e0316b050d174
    );
    mapping(address => bool) public defaultAdmins;
    mapping(address => bool) public stateUpdaters;
    mapping(address => bool) public vkeyUpdaters;
    mapping(bytes32 => mapping(uint => address)) internal roleMembers;
    mapping(bytes32 => uint) internal roleMemberCounts;
    mapping(bytes32 => mapping(address => uint)) internal roleMemberIndexes;

    event HeadUpdate(uint indexed slot, bytes32 indexed root);
    event SyncCommitteeUpdate(uint indexed period, bytes32 indexed root);
    event StorageSlotVerified(uint indexed head, bytes32 indexed key, bytes32 value, address contractAddress);
    event HeliosProgramVkeyUpdated(bytes32 indexed oldHeliosProgramVkey, bytes32 indexed newHeliosProgramVkey);
    event StateUpdaterSet(address indexed updater, bool enabled);
    event VkeyUpdaterSet(address indexed updater, bool enabled);
    event RoleGranted(bytes32 indexed role, address indexed account, address indexed sender);
    event RoleRevoked(bytes32 indexed role, address indexed account, address indexed sender);

    modifier onlyAdmin() {
        require(defaultAdmins[msg.sender], "Helios admin only");
        _;
    }

    modifier onlyStateUpdater() {
        require(stateUpdaters[msg.sender], "Helios state updater only");
        _;
    }

    modifier onlyVkeyUpdater() {
        require(vkeyUpdaters[msg.sender], "Helios vkey updater only");
        _;
    }

    constructor(
        uint genesisTime,
        uint initialHead,
        bytes32 initialHeader,
        bytes32 initialExecutionStateRoot,
        bytes32 initialSyncCommitteeHash,
        bytes32 initialHeliosProgramVkey,
        uint secondsPerSlot,
        uint slotsPerEpoch,
        uint slotsPerPeriod,
        address verifierAddress,
        address initialAdmin,
        address initialStateUpdater,
        address initialVkeyUpdater
    ) {
        require(initialHeader != bytes32(0), "Helios initial header is zero");
        require(initialSyncCommitteeHash != bytes32(0), "Helios initial committee is zero");
        require(secondsPerSlot > 0 && slotsPerEpoch > 0 && slotsPerPeriod > 0, "Helios timing is zero");
        require(verifierAddress != address(0), "Helios verifier is zero");
        require(initialAdmin != address(0), "Helios admin is zero");

        GENESIS_TIME = genesisTime;
        SECONDS_PER_SLOT = secondsPerSlot;
        SLOTS_PER_EPOCH = slotsPerEpoch;
        SLOTS_PER_PERIOD = slotsPerPeriod;
        head = initialHead;
        headers[initialHead] = initialHeader;
        executionStateRoots[initialHead] = initialExecutionStateRoot;
        uint initialPeriod = getSyncCommitteePeriod(initialHead);
        syncCommittees[initialPeriod] = initialSyncCommitteeHash;
        syncCommitteeSet[initialPeriod] = true;
        heliosProgramVkey = initialHeliosProgramVkey;
        verifier = verifierAddress;
        _grantRole(DEFAULT_ADMIN_ROLE_VALUE, initialAdmin);

        if (initialStateUpdater != address(0)) {
            _grantRole(STATE_UPDATER_ROLE_VALUE, initialStateUpdater);
        }
        if (initialVkeyUpdater != address(0)) {
            _grantRole(VKEY_UPDATER_ROLE_VALUE, initialVkeyUpdater);
        }
    }

    /// @notice AccessControl-compatible role surface used by Across's
    /// canonical executeExternalCall governance messages. Every role is
    /// administered by DEFAULT_ADMIN_ROLE, matching SP1Helios v4.1.28.
    function DEFAULT_ADMIN_ROLE() public pure returns (bytes32) {
        return DEFAULT_ADMIN_ROLE_VALUE;
    }

    function STATE_UPDATER_ROLE() public pure returns (bytes32) {
        return STATE_UPDATER_ROLE_VALUE;
    }

    function VKEY_UPDATER_ROLE() public pure returns (bytes32) {
        return VKEY_UPDATER_ROLE_VALUE;
    }

    function hasRole(bytes32 role, address account) public view returns (bool) {
        if (role == DEFAULT_ADMIN_ROLE_VALUE) return defaultAdmins[account];
        if (role == STATE_UPDATER_ROLE_VALUE) return stateUpdaters[account];
        if (role == VKEY_UPDATER_ROLE_VALUE) return vkeyUpdaters[account];
        return false;
    }

    function getRoleAdmin(bytes32) public pure returns (bytes32) {
        return DEFAULT_ADMIN_ROLE_VALUE;
    }

    function getRoleMemberCount(bytes32 role) public view returns (uint) {
        return roleMemberCounts[role];
    }

    function getRoleMember(bytes32 role, uint index) public view returns (address) {
        require(index < roleMemberCounts[role], "Helios role index out of bounds");
        return roleMembers[role][index];
    }

    function supportsInterface(bytes4 interfaceId) public pure returns (bool) {
        return interfaceId == bytes4(0x01ffc9a7) || interfaceId == bytes4(0x7965db0b)
            || interfaceId == bytes4(0x5a05180f);
    }

    function grantRole(bytes32 role, address account) public onlyAdmin {
        _grantRole(role, account);
    }

    function _grantRole(bytes32 role, address account) internal {
        require(account != address(0), "Helios role account is zero");
        require(
            role == DEFAULT_ADMIN_ROLE_VALUE || role == STATE_UPDATER_ROLE_VALUE
                || role == VKEY_UPDATER_ROLE_VALUE,
            "Helios unsupported role"
        );
        if (hasRole(role, account)) return;
        if (role == DEFAULT_ADMIN_ROLE_VALUE) defaultAdmins[account] = true;
        if (role == STATE_UPDATER_ROLE_VALUE) stateUpdaters[account] = true;
        if (role == VKEY_UPDATER_ROLE_VALUE) vkeyUpdaters[account] = true;
        uint index = roleMemberCounts[role];
        roleMembers[role][index] = account;
        roleMemberCounts[role] = index + 1;
        roleMemberIndexes[role][account] = index + 1;
        emit RoleGranted(role, account, msg.sender);
    }

    function revokeRole(bytes32 role, address account) public onlyAdmin {
        _revokeRole(role, account);
    }

    function renounceRole(bytes32 role, address account) public {
        require(account == msg.sender, "Helios can only renounce self");
        _revokeRole(role, account);
    }

    function _revokeRole(bytes32 role, address account) internal {
        require(
            role == DEFAULT_ADMIN_ROLE_VALUE || role == STATE_UPDATER_ROLE_VALUE
                || role == VKEY_UPDATER_ROLE_VALUE,
            "Helios unsupported role"
        );
        if (!hasRole(role, account)) return;
        if (role == DEFAULT_ADMIN_ROLE_VALUE) {
            require(roleMemberCounts[role] > 1, "Helios cannot remove last admin");
        }
        if (role == DEFAULT_ADMIN_ROLE_VALUE) defaultAdmins[account] = false;
        if (role == STATE_UPDATER_ROLE_VALUE) stateUpdaters[account] = false;
        if (role == VKEY_UPDATER_ROLE_VALUE) vkeyUpdaters[account] = false;

        uint indexPlusOne = roleMemberIndexes[role][account];
        require(indexPlusOne > 0, "Helios role enumeration missing");
        uint index = indexPlusOne - 1;
        uint lastIndex = roleMemberCounts[role] - 1;
        if (index != lastIndex) {
            address lastAccount = roleMembers[role][lastIndex];
            roleMembers[role][index] = lastAccount;
            roleMemberIndexes[role][lastAccount] = index + 1;
        }
        roleMembers[role][lastIndex] = address(0);
        roleMemberCounts[role] = lastIndex;
        roleMemberIndexes[role][account] = 0;
        emit RoleRevoked(role, account, msg.sender);
    }

    function setStateUpdater(address updater, bool enabled) public onlyAdmin {
        require(updater != address(0), "Helios updater is zero");
        if (enabled) grantRole(STATE_UPDATER_ROLE_VALUE, updater);
        else revokeRole(STATE_UPDATER_ROLE_VALUE, updater);
        emit StateUpdaterSet(updater, enabled);
    }

    function setVkeyUpdater(address updater, bool enabled) public onlyAdmin {
        require(updater != address(0), "Helios updater is zero");
        if (enabled) grantRole(VKEY_UPDATER_ROLE_VALUE, updater);
        else revokeRole(VKEY_UPDATER_ROLE_VALUE, updater);
        emit VkeyUpdaterSet(updater, enabled);
    }

    function updateHeliosProgramVkey(bytes32 newHeliosProgramVkey) public onlyVkeyUpdater {
        bytes32 oldHeliosProgramVkey = heliosProgramVkey;
        require(oldHeliosProgramVkey != newHeliosProgramVkey, "Helios vkey unchanged");
        heliosProgramVkey = newHeliosProgramVkey;
        emit HeliosProgramVkeyUpdated(oldHeliosProgramVkey, newHeliosProgramVkey);
    }

    function readUint(bytes memory data, uint offset) internal pure returns (uint result) {
        require(offset + 32 <= data.length, "Helios public values out of bounds");
        for (uint i = 0; i < 32; i++) {
            result = (result << 8) | data[offset + i];
        }
    }

    function readBytes32(bytes memory data, uint offset) internal pure returns (bytes32) {
        return bytes32(readUint(data, offset));
    }

    /// @notice Verify and apply one canonical SP1 Helios public-values update.
    /// Layout: abi.encode(ProofOutputs), where ProofOutputs contains nine head
    /// words and a dynamic array of static (key,value,address) slot tuples.
    function update(bytes memory proof, bytes memory publicValues) public onlyStateUpdater {
        require(publicValues.length >= 352, "Helios public values too short");
        uint tupleStart = readUint(publicValues, 0);
        require(tupleStart == 32, "Helios non-canonical tuple offset");

        bytes32 newExecutionStateRoot = readBytes32(publicValues, tupleStart);
        bytes32 newHeader = readBytes32(publicValues, tupleStart + 32);
        bytes32 nextSyncCommitteeHash = readBytes32(publicValues, tupleStart + 64);
        uint newHead = readUint(publicValues, tupleStart + 96);
        bytes32 prevHeader = readBytes32(publicValues, tupleStart + 128);
        uint prevHead = readUint(publicValues, tupleStart + 160);
        bytes32 syncCommitteeHash = readBytes32(publicValues, tupleStart + 192);
        bytes32 startSyncCommitteeHash = readBytes32(publicValues, tupleStart + 224);
        uint slotsOffset = readUint(publicValues, tupleStart + 256);
        require(slotsOffset == 288, "Helios non-canonical slots offset");

        uint slotsStart = tupleStart + slotsOffset;
        uint slotsLength = readUint(publicValues, slotsStart);
        require(
            publicValues.length == slotsStart + 32 + slotsLength * 96,
            "Helios malformed storage slots"
        );

        require(newHead > prevHead, "Helios head did not increase");
        bytes32 storedPrevHeader = headers[prevHead];
        require(storedPrevHeader != bytes32(0), "Helios previous header missing");
        require(storedPrevHeader == prevHeader, "Helios previous header mismatch");

        uint previousTimestamp = slotTimestamp(prevHead);
        require(block.timestamp >= previousTimestamp, "Helios previous head is in the future");
        require(block.timestamp - previousTimestamp <= MAX_SLOT_AGE, "Helios previous head too old");

        uint currentPeriod = getSyncCommitteePeriod(prevHead);
        require(
            syncCommittees[currentPeriod] == startSyncCommitteeHash,
            "Helios start committee mismatch"
        );

        ISP1VerifierSolidVM(verifier).verifyProof(heliosProgramVkey, publicValues, proof);

        bytes32 storedNewHeader = headers[newHead];
        if (uint(storedNewHeader) == 0) {
            headers[newHead] = newHeader;
        } else {
            require(storedNewHeader == newHeader, "Helios new header mismatch");
        }

        if (head < newHead) {
            head = newHead;
            emit HeadUpdate(newHead, newHeader);
        }

        bytes32 storedExecutionRoot = executionStateRoots[newHead];
        if (uint(storedExecutionRoot) == 0) {
            executionStateRoots[newHead] = newExecutionStateRoot;
        } else {
            require(storedExecutionRoot == newExecutionStateRoot, "Helios execution root mismatch");
        }

        uint cursor = slotsStart + 32;
        for (uint i = 0; i < slotsLength; i++) {
            bytes32 slotKey = readBytes32(publicValues, cursor);
            bytes32 slotValue = readBytes32(publicValues, cursor + 32);
            uint contractWord = readUint(publicValues, cursor + 64);
            require(contractWord <= ((1 << 160) - 1), "Helios slot address is non-canonical");
            address contractAddress = address(contractWord);
            storageValues[computeStorageKey(newHead, contractAddress, slotKey)] = slotValue;
            emit StorageSlotVerified(newHead, slotKey, slotValue, contractAddress);
            cursor += 96;
        }

        uint newPeriod = getSyncCommitteePeriod(newHead);
        if (!syncCommitteeSet[newPeriod]) {
            syncCommittees[newPeriod] = syncCommitteeHash;
            syncCommitteeSet[newPeriod] = true;
            emit SyncCommitteeUpdate(newPeriod, syncCommitteeHash);
        } else {
            require(syncCommittees[newPeriod] == syncCommitteeHash, "Helios current committee already differs");
        }
        if (nextSyncCommitteeHash != bytes32(0)) {
            uint nextPeriod = newPeriod + 1;
            if (!syncCommitteeSet[nextPeriod]) {
                syncCommittees[nextPeriod] = nextSyncCommitteeHash;
                syncCommitteeSet[nextPeriod] = true;
                emit SyncCommitteeUpdate(nextPeriod, nextSyncCommitteeHash);
            } else {
                require(
                    syncCommittees[nextPeriod] == nextSyncCommitteeHash,
                    "Helios next committee already differs"
                );
            }
        }
    }

    function getSyncCommitteePeriod(uint slot) public view returns (uint) {
        return slot / SLOTS_PER_PERIOD;
    }

    function getCurrentEpoch() public view returns (uint) {
        return head / SLOTS_PER_EPOCH;
    }

    function slotTimestamp(uint slot) public view returns (uint) {
        return GENESIS_TIME + slot * SECONDS_PER_SLOT;
    }

    function headTimestamp() public view returns (uint) {
        return slotTimestamp(head);
    }

    function computeStorageKey(uint beaconSlot, address contractAddress, bytes32 storageSlot)
        public pure returns (bytes32)
    {
        return keccak256(abi.encodePacked(beaconSlot, contractAddress, storageSlot));
    }

    function getStorageSlot(uint beaconSlot, address contractAddress, bytes32 storageSlot)
        public view returns (bytes32)
    {
        return storageValues[computeStorageKey(beaconSlot, contractAddress, storageSlot)];
    }
}
