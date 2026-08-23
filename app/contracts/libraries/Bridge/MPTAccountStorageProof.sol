import "./MPTProof.sol";
import "./RLPDecode.sol";

/**
 * @title  MPTAccountStorageProof
 * @notice State + storage MPT verifier for Ethereum-shaped chains.
 *         Thin layer over {MPTProof}: the underlying trie traversal
 *         is identical to the receipts trie (same node shapes, same
 *         HP encoding). What differs:
 *
 *           - **Hashed keys**. The state trie keys addresses by
 *             keccak256(addr); the storage trie keys slots by
 *             keccak256(slot). Receipts trie used raw rlp(txIndex).
 *
 *           - **Account leaf shape**. State-trie leaves carry
 *             rlp([nonce, balance, storageRoot, codeHash]); storage-trie
 *             leaves carry rlp(value-with-leading-zeros-stripped).
 *             The MPT layer just checks bytes equality, so callers must
 *             pre-encode the leaf bytes correctly.
 *
 *         Used by light clients that need to reach into L1 state — the
 *         L1-anchored Base / Linea / Scroll / etc. flows all sit on
 *         this library.
 */
library MPTAccountStorageProof {
    using RLPDecode for *;

    /**
     * @notice Verify an account proof and pull out the storage root.
     *
     *         The account leaf in the state trie is RLP of the 4-tuple
     *         [nonce, balance, storageRoot, codeHash]. We hash the
     *         account address with keccak256 to get the trie key,
     *         delegate the proof walk to {MPTProof.verifyInclusion},
     *         then RLP-decode the leaf to extract `storageRoot` for
     *         the caller.
     *
     * @param  stateRoot       Block header's stateRoot field.
     * @param  account         Address whose state we're proving.
     * @param  accountLeafRLP  rlp([nonce, balance, storageRoot, codeHash]).
     *                         Provided by the caller (eth_getProof's
     *                         account fields → re-encode).
     * @param  accountProof    Trie nodes from stateRoot down to the
     *                         account leaf.
     * @return storageRoot     Decoded from accountLeafRLP[2]. Use this
     *                         as the root for {verifyStorageSlot} calls.
     */
    function verifyAccountAndGetStorageRoot(
        bytes32 stateRoot,
        address account,
        bytes accountLeafRLP,
        bytes[] accountProof
    ) internal pure returns (bytes32 storageRoot) {
        bytes hashedKey = abi.encodePacked(keccak256(abi.encodePacked(account)));
        require(
            MPTProof.verifyInclusion(stateRoot, hashedKey, accountLeafRLP, accountProof),
            "MPTAccountStorageProof: account proof failed"
        );

        bytes[] fields = RLPDecode.decodeList(accountLeafRLP);
        require(fields.length == 4, "MPTAccountStorageProof: account leaf must be 4-field");
        storageRoot = RLPDecode.decodeBytes32(fields[2]);
    }

    /**
     * @notice Verify a single storage slot's value against a storage root.
     *
     *         The storage trie keys slots by keccak256(slot). The leaf
     *         value is rlp(slotValue) with leading zeros stripped from
     *         the slotValue uint256 — so a slot containing 0x0..01
     *         encodes to 0x01 (1 byte), and a slot containing 0
     *         encodes to 0x80 (empty string).
     *
     *         Callers must pre-encode `valueRLP` to match. For the
     *         common case "I want to assert this slot equals
     *         <bytes32>", use {encodeStorageValue} below.
     *
     * @param  storageRoot   Account's storage trie root (from
     *                       {verifyAccountAndGetStorageRoot}).
     * @param  slotKey       Raw 32-byte slot index — NOT hashed; this
     *                       function hashes it internally.
     * @param  valueRLP      rlp(slotValue). See above.
     * @param  storageProof  Trie nodes from storageRoot to the leaf.
     * @return True iff the slot's leaf matches `valueRLP`.
     */
    function verifyStorageSlot(
        bytes32 storageRoot,
        bytes32 slotKey,
        bytes valueRLP,
        bytes[] storageProof
    ) internal pure returns (bool) {
        bytes hashedKey = abi.encodePacked(keccak256(abi.encodePacked(slotKey)));
        return MPTProof.verifyInclusion(storageRoot, hashedKey, valueRLP, storageProof);
    }

    /**
     * @notice Canonical RLP encoding of a 32-byte storage slot value.
     *         Matches what {verifyStorageSlot} expects in `valueRLP`.
     *
     *         Rules:
     *           - 0  → 0x80 (empty string)
     *           - 1..127       → single self-encoded byte
     *           - leading-zero-stripped uint  → length-prefix + bytes
     *
     *         For a 32-byte word, length is at most 32 → fits the
     *         RLP "short string" form (0x80 + len) for the prefix.
     */
    function encodeStorageValue(bytes32 value) internal pure returns (bytes) {
        // Strip leading zero bytes.
        uint256 v = uint256(value);
        if (v == 0) {
            return bytes(uint256(0x80));     // empty string
        }
        // Compute the minimum-byte BE form.
        bytes raw = bytes(v);                // SolidVM: bytes(integer) → minimum-byte BE
        if (raw.length == 1 && uint8(raw[0]) < 0x80) {
            return raw;                      // self-encoded
        }
        bytes prefix = bytes(uint256(0x80) + raw.length);
        return prefix + raw;
    }

    /**
     * @notice Re-encode the (nonce, balance, storageRoot, codeHash)
     *         account state into the RLP form the state trie stores.
     *         Use this to construct `accountLeafRLP` for
     *         {verifyAccountAndGetStorageRoot} when you have the four
     *         fields directly (e.g. from eth_getProof's account section)
     *         rather than a pre-encoded blob.
     */
    function encodeAccountLeaf(
        uint256 nonce,
        uint256 balance,
        bytes32 storageRoot,
        bytes32 codeHash
    ) internal pure returns (bytes) {
        bytes nonceBytes = _rlpUint(nonce);
        bytes balBytes   = _rlpUint(balance);
        bytes srBytes    = _rlpBytes32(storageRoot);
        bytes chBytes    = _rlpBytes32(codeHash);
        bytes payload = nonceBytes + balBytes + srBytes + chBytes;
        return _rlpListPrefix(payload.length) + payload;
    }

    // ─────────────────────────────────────────────────────────────────
    // RLP encoding helpers (inlined to avoid a third copy if future
    // libraries also need them; mirrors EthBridgeIn._rlpUint /
    // BaseLightClient._rlpUint).
    // ─────────────────────────────────────────────────────────────────

    function _rlpUint(uint256 v) private pure returns (bytes) {
        if (v == 0) return bytes(uint256(0x80));
        if (v < 0x80) return bytes(v);
        bytes valueBytes = bytes(v);
        bytes prefix = bytes(uint256(0x80) + valueBytes.length);
        return prefix + valueBytes;
    }

    function _rlpBytes32(bytes32 b) private pure returns (bytes) {
        // bytes32 → 32-byte string. RLP "short string" prefix is
        // 0x80 + length.
        bytes prefix = bytes(uint256(0x80 + 32));
        return prefix + abi.encodePacked(b);
    }

    function _rlpListPrefix(uint256 payloadLen) private pure returns (bytes) {
        if (payloadLen < 56) {
            return bytes(uint256(0xc0 + payloadLen));
        }
        // Long list: 0xf7 + len(len), len-bytes-BE
        bytes lenBytes = bytes(payloadLen);   // minimum-byte BE
        bytes prefix = bytes(uint256(0xf7 + lenBytes.length));
        return prefix + lenBytes;
    }
}
