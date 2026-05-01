// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "../bridge/BridgeVault.sol";
import {STRATOEventDecoder} from "../bridge/lib/STRATOEventDecoder.sol";

/**
 * @title BridgeVaultHarness
 * @notice Test-only subclass of BridgeVault. Lets tests bypass MPT/RLP proof
 *         verification and inject a known DecodedWithdrawal directly, so we
 *         can exercise the vault's state machine and entry points without
 *         needing a real trie + signed-header pipeline.
 *
 *         Production deployments must NOT use this contract. The override
 *         here trusts whatever the caller passes in; the production
 *         _verifyEventProof is the security boundary.
 */
contract BridgeVaultHarness is BridgeVault {
    /// @dev Hand-crafted decode result indexed by a (blockNumber, txIndex,
    ///      logIndex)-derived key. Tests populate this before calling
    ///      claimWithdrawal / submitProof.
    mapping(bytes32 => STRATOEventDecoder.DecodedWithdrawal) private stub;
    mapping(bytes32 => bool) private stubSet;

    function stubProof(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        STRATOEventDecoder.DecodedWithdrawal calldata d
    ) external {
        bytes32 k = keccak256(abi.encodePacked(blockNumber, txIndex, logIndex));
        stub[k] = d;
        stubSet[k] = true;
    }

    function _verifyEventProof(
        uint256 blockNumber,
        uint256 txIndex,
        bytes[] memory, /* mptProof */
        bytes memory, /* receiptRLP */
        uint256 logIndex,
        bytes32 expectedEventNameHash
    ) internal view override returns (STRATOEventDecoder.DecodedWithdrawal memory d) {
        bytes32 k = keccak256(abi.encodePacked(blockNumber, txIndex, logIndex));
        require(stubSet[k], "harness: stub not set");
        d = stub[k];

        // Apply the same authoritative-field checks as production so the
        // tests exercise the dispatch on event name and the chain-id guard.
        if (d.contractAddress != stratoVaultAddress) revert WrongStratoVault();
        if (d.eventNameHash != expectedEventNameHash) revert UnknownEvent();
        if (d.externalChainId != externalChainId) revert WrongChainId();
    }
}
