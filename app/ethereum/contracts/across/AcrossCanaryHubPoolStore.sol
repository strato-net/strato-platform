// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Immutable Ethereum state anchor for an Across Universal Spoke canary
/// @notice Stores exactly one relay-message hash in the same mapping layout as
/// HubPoolStore. This contract is a test anchor, not the canonical Across
/// HubPoolStore and not a substitute for Across governance registration.
contract AcrossCanaryHubPoolStore {
    mapping(uint256 nonce => bytes32 messageHash) public relayMessageCallData;

    event CanaryRelayMessageStored(uint256 indexed nonce, bytes32 indexed messageHash);

    constructor(uint256 nonce, bytes memory message) {
        require(message.length != 0, "Across canary message is empty");
        bytes32 messageHash = keccak256(message);
        relayMessageCallData[nonce] = messageHash;
        emit CanaryRelayMessageStored(nonce, messageHash);
    }
}
