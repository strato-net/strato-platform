// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.30;

import "./AcrossV4SpokePool.sol";

interface IHeliosSolidVM {
    function getStorageSlot(uint beaconSlot, address contractAddress, bytes32 storageSlot)
        external view returns (bytes32);
    function headTimestamp() external view returns (uint);
    function grantRole(bytes32 role, address account) external;
    function revokeRole(bytes32 role, address account) external;
    function renounceRole(bytes32 role, address account) external;
    function updateHeliosProgramVkey(bytes32 newHeliosProgramVkey) external;
}

/// @title Ethereum-rooted Across V4 Universal Spoke for SolidVM
/// @notice Replaces EVM delegatecall with a strict SolidVM dispatcher for the
/// admin selectors the spoke implements. The message envelope and selectors
/// remain canonical Solidity ABI bytes stored by Ethereum's HubPoolStore.
contract AcrossV4UniversalSpoke is AcrossV4SpokePool {
    address public owner;
    uint public ADMIN_UPDATE_BUFFER;
    address public helios;
    address public hubPoolStore;
    mapping(uint => bool) public executedMessages;
    bool internal adminCallValidated;

    event RelayedCallData(uint indexed nonce, address caller);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event AdminExternalCallExecuted(address indexed target, bytes data);

    constructor(
        address initialEmergencyOwner,
        address initialCrossDomainAdmin,
        address initialWithdrawalRecipient,
        uint32 quoteTimeBuffer,
        uint32 deadlineBuffer,
        uint32 initialDepositId,
        uint adminUpdateBufferSeconds,
        address heliosAddress,
        address hubPoolStoreAddress
    ) AcrossV4SpokePool(initialCrossDomainAdmin, quoteTimeBuffer, deadlineBuffer, initialDepositId) {
        require(initialEmergencyOwner != address(0), "Across emergency owner is zero");
        require(initialWithdrawalRecipient != address(0), "Across withdrawal recipient is zero");
        require(adminUpdateBufferSeconds > 0, "Across admin update buffer is zero");
        require(heliosAddress != address(0), "Across Helios is zero");
        require(hubPoolStoreAddress != address(0), "Across HubPoolStore is zero");
        owner = initialEmergencyOwner;
        withdrawalRecipient = initialWithdrawalRecipient;
        // A new Universal Spoke has not yet proved any Ethereum governance
        // messages, configured token return routes, or handed Helios control
        // to this contract. Keep all public value-moving paths closed until
        // Ethereum governance explicitly activates them through executeMessage.
        pausedDeposits = true;
        pausedFills = true;
        ADMIN_UPDATE_BUFFER = adminUpdateBufferSeconds;
        helios = heliosAddress;
        hubPoolStore = hubPoolStoreAddress;
        emit OwnershipTransferred(address(0), initialEmergencyOwner);
    }

    function transferOwnership(address newOwner) public {
        require(msg.sender == owner, "Across emergency owner only");
        require(newOwner != address(0), "Across emergency owner is zero");
        address oldOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }

    function renounceOwnership() public {
        require(msg.sender == owner, "Across emergency owner only");
        address oldOwner = owner;
        owner = address(0);
        emit OwnershipTransferred(oldOwner, address(0));
    }

    function readAdminWord(bytes memory data, uint offset) internal pure returns (uint result) {
        require(offset + 32 <= data.length, "Across admin calldata out of bounds");
        for (uint i = 0; i < 32; i++) {
            result = (result << 8) | data[offset + i];
        }
    }

    function readAdminSelector(bytes memory data) internal pure returns (uint result) {
        require(data.length >= 4, "Across admin selector missing");
        for (uint i = 0; i < 4; i++) {
            result = (result << 8) | data[i];
        }
    }

    function getSlotKey(uint nonce) public pure returns (bytes32) {
        return keccak256(bytes(bytes32(nonce)) + bytes(bytes32(0)));
    }

    function executeMessage(uint messageNonce, bytes memory message, uint blockNumber) public {
        require(!adminCallValidated, "Across admin call already active");
        require(message.length >= 96, "Across admin message too short");

        uint targetWord = readAdminWord(message, 0);
        require(targetWord <= ((1 << 160) - 1), "Across target is non-canonical");
        address target = address(targetWord);
        require(target == address(0) || target == address(this), "Across message has wrong target");
        require(readAdminWord(message, 32) == 64, "Across non-canonical message offset");

        uint callLength = readAdminWord(message, 64);
        uint paddedCallLength = ((callLength + 31) / 32) * 32;
        require(message.length == 96 + paddedCallLength, "Across malformed admin message");
        bytes memory callData = new bytes(callLength);
        for (uint i = 0; i < callLength; i++) {
            callData[i] = message[96 + i];
        }
        for (uint i = callLength; i < paddedCallLength; i++) {
            require(message[96 + i] == 0, "Across nonzero ABI padding");
        }

        bytes32 provedValue = IHeliosSolidVM(helios).getStorageSlot(
            blockNumber,
            hubPoolStore,
            getSlotKey(messageNonce)
        );
        require(provedValue == keccak256(message), "Across proved slot value mismatch");
        require(!executedMessages[messageNonce], "Across admin message already executed");

        executedMessages[messageNonce] = true;
        emit RelayedCallData(messageNonce, msg.sender);
        adminCallValidated = true;
        dispatchAdminCall(callData);
        adminCallValidated = false;
    }

    /// @notice Break-glass path matching the pinned Universal Spoke: the
    /// emergency owner may use the same strict dispatcher only after Helios
    /// has remained stale for the configured buffer.
    function adminExecuteMessage(bytes memory message) public {
        require(msg.sender == owner, "Across emergency owner only");
        require(!adminCallValidated, "Across admin call already active");
        uint heliosHeadTimestamp = IHeliosSolidVM(helios).headTimestamp();
        require(heliosHeadTimestamp <= block.timestamp, "Across Helios head is in future");
        require(
            block.timestamp - heliosHeadTimestamp >= ADMIN_UPDATE_BUFFER,
            "Across Helios update is too recent"
        );
        adminCallValidated = true;
        dispatchAdminCall(message);
        adminCallValidated = false;
    }

    /// @notice Canonical Across admin surface, narrowed to role/vkey changes
    /// on this spoke's Helios contract. The pinned EVM implementation can call
    /// arbitrary targets; SolidVM deliberately rejects every other target and
    /// selector while preserving the upstream function ABI and event.
    function executeExternalCall(bytes memory message)
        public onlyAdmin nonReentrant returns (bytes memory returnData)
    {
        require(message.length >= 96, "Across external message too short");
        uint targetWord = readAdminWord(message, 0);
        require(targetWord <= ((1 << 160) - 1), "Across external target is non-canonical");
        address target = address(targetWord);
        require(target == helios, "Across external target is not Helios");
        require(readAdminWord(message, 32) == 64, "Across external data offset invalid");

        uint dataLength = readAdminWord(message, 64);
        uint paddedDataLength = ((dataLength + 31) / 32) * 32;
        require(dataLength >= 4, "Across external data too short");
        require(message.length == 96 + paddedDataLength, "Across external message malformed");
        bytes memory data = new bytes(dataLength);
        for (uint i = 0; i < dataLength; i++) {
            data[i] = message[96 + i];
        }
        for (uint i = dataLength; i < paddedDataLength; i++) {
            require(message[96 + i] == 0, "Across external padding is nonzero");
        }

        uint selector = readAdminSelector(data);
        if (selector == 0x2f2ff15d || selector == 0xd547741f || selector == 0x36568abe) {
            require(data.length == 68, "Across Helios role calldata length invalid");
            bytes32 role = bytes32(readAdminWord(data, 4));
            uint accountWord = readAdminWord(data, 36);
            require(accountWord <= ((1 << 160) - 1), "Across Helios role address is non-canonical");
            address account = address(accountWord);
            if (selector == 0x2f2ff15d) IHeliosSolidVM(target).grantRole(role, account);
            if (selector == 0xd547741f) IHeliosSolidVM(target).revokeRole(role, account);
            if (selector == 0x36568abe) IHeliosSolidVM(target).renounceRole(role, account);
        } else if (selector == 0x397f3dd4) {
            require(data.length == 36, "Across Helios vkey calldata length invalid");
            IHeliosSolidVM(target).updateHeliosProgramVkey(bytes32(readAdminWord(data, 4)));
        } else {
            revert("Across unsupported Helios selector");
        }

        emit AdminExternalCallExecuted(target, data);
        return bytes("");
    }

    function dispatchAdminCall(bytes memory callData) internal {
        uint selector = readAdminSelector(callData);
        if (selector == 0x738b62e5) {
            require(callData.length == 36, "Across pause calldata length invalid");
            uint booleanWord = readAdminWord(callData, 4);
            require(booleanWord <= 1, "Across admin bool is non-canonical");
            pauseDeposits(booleanWord == 1);
        } else if (selector == 0x99cc2968) {
            require(callData.length == 36, "Across pause calldata length invalid");
            uint booleanWord = readAdminWord(callData, 4);
            require(booleanWord <= 1, "Across admin bool is non-canonical");
            pauseFills(booleanWord == 1);
        } else if (selector == 0x493a4f84) {
            require(callData.length == 68, "Across root calldata length invalid");
            relayRootBundle(bytes32(readAdminWord(callData, 4)), bytes32(readAdminWord(callData, 36)));
        } else if (selector == 0x8a7860ce) {
            require(callData.length == 36, "Across delete calldata length invalid");
            emergencyDeleteRootBundle(readAdminWord(callData, 4));
        } else if (selector == 0xde7eba78) {
            require(callData.length == 36, "Across admin-address calldata length invalid");
            uint adminWord = readAdminWord(callData, 4);
            require(adminWord <= ((1 << 160) - 1), "Across admin address is non-canonical");
            setCrossDomainAdmin(address(adminWord));
        } else if (selector == 0xfc8a584f) {
            require(callData.length == 36, "Across withdrawal calldata length invalid");
            uint recipientWord = readAdminWord(callData, 4);
            require(recipientWord <= ((1 << 160) - 1), "Across withdrawal address is non-canonical");
            setWithdrawalRecipient(address(recipientWord));
        } else if (selector == 0xb7473550) {
            require(callData.length == 132, "Across return route calldata length invalid");
            uint tokenWord = readAdminWord(callData, 4);
            uint bridgeWord = readAdminWord(callData, 36);
            uint externalChainId = readAdminWord(callData, 68);
            uint externalTokenWord = readAdminWord(callData, 100);
            require(tokenWord <= ((1 << 160) - 1), "Across return token is non-canonical");
            require(bridgeWord <= ((1 << 160) - 1), "Across return bridge is non-canonical");
            require(
                externalTokenWord <= ((1 << 160) - 1),
                "Across external token is non-canonical"
            );
            setTokenReturnRoute(
                address(tokenWord),
                address(bridgeWord),
                externalChainId,
                address(externalTokenWord)
            );
        } else if (selector == 0x7659f9e0) {
            require(callData.length >= 68, "Across external calldata too short");
            require(readAdminWord(callData, 4) == 32, "Across external calldata offset invalid");
            uint messageLength = readAdminWord(callData, 36);
            uint paddedMessageLength = ((messageLength + 31) / 32) * 32;
            require(
                callData.length == 68 + paddedMessageLength,
                "Across external calldata malformed"
            );
            bytes memory externalMessage = new bytes(messageLength);
            for (uint i = 0; i < messageLength; i++) {
                externalMessage[i] = callData[68 + i];
            }
            for (uint i = messageLength; i < paddedMessageLength; i++) {
                require(callData[68 + i] == 0, "Across external calldata padding is nonzero");
            }
            executeExternalCall(externalMessage);
        } else {
            revert("Across unsupported admin selector");
        }
    }

    function _requireAdminSender() internal view override {
        require(adminCallValidated, "Across admin call was not Ethereum-proved");
    }
}
