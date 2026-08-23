import "./RLPDecode.sol";

/**
 * @title  LightClientShared
 * @notice Building blocks shared by L1-anchored cross-chain light
 *         clients (BaseLightClient, LineaLightClient, …). The common
 *         shape is:
 *
 *           1. L1 block is anchored on EthLightClient (receipts root
 *              available via {ILightClient.getReceiptsRoot}).
 *           2. An MPT proof verifies a specific log inside that L1
 *              block (DisputeGameCreated for Cannon, DataFinalizedV3
 *              for Linea). The log carries an L2 state-commitment hint.
 *           3. An L2 block header is presented + verified against the
 *              hint (compute outputRoot for Base, or just compare
 *              stateRoot for Linea).
 *           4. A parent-chain walk anchors all L2 blocks from the
 *              head-of-chain down to the deposit's block.
 *
 *         Steps 1–3 are chain-specific (different event shapes,
 *         different verification rules). Step 4 plus the RLP/header
 *         helpers powering it are byte-identical between Base and
 *         Linea, so they live here.
 */
library LightClientShared {
    using RLPDecode for *;

    /// Subset of an Ethereum execution-payload block header that
    /// anchoring needs. We index only up to field 8, so post-Shanghai/
    /// post-Cancun extensions (which add fields ≥ 13) are tolerated.
    struct BlockHeader {
        bytes32 parentHash;    // field 0
        bytes32 stateRoot;     // field 3
        bytes32 receiptsRoot;  // field 5
        uint256 number;        // field 8
    }

    // ─────────────────────────────────────────────────────────────────
    // RLP helpers (formerly duplicated in EthBridgeIn + BaseLightClient)
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Canonical RLP encoding of a non-negative integer in
     *         minimum-byte big-endian form. Used to build the MPT key
     *         from a receipts-trie tx index, and as part of higher-
     *         level RLP encoders.
     *
     *         Rules:
     *           - 0          → 0x80 (RLP empty string)
     *           - 1..127     → self-encoded single byte
     *           - otherwise  → 0x80 + len, then BE-minimum value bytes
     */
    function rlpUint(uint256 v) internal pure returns (bytes) {
        if (v == 0) return bytes(uint256(0x80));
        if (v < 0x80) return bytes(v);
        bytes valueBytes = bytes(v);
        bytes prefix = bytes(uint256(0x80) + valueBytes.length);
        return prefix + valueBytes;
    }

    /**
     * @notice Strip the leading EIP-2718 transaction-type envelope
     *         byte from a receipt blob, leaving the legacy-shaped RLP
     *         list. Legacy receipts (first byte already in the RLP
     *         list range 0xc0..0xff) are returned unchanged.
     *
     *         Used before decoding receipts pulled from a Merkle
     *         proof — the receipts trie stores the typed envelope
     *         form, but RLPDecode.decodeList expects a bare list.
     */
    function stripTypedTxPrefix(bytes b) internal pure returns (bytes) {
        require(b.length > 0, "LightClientShared: empty receipt");
        if (uint8(b[0]) >= 0xc0) {
            return b;
        }
        bytes inner = new bytes(b.length - 1);
        for (uint256 i = 1; i < b.length; i = i + 1) {
            inner[i - 1] = b[i];
        }
        return inner;
    }

    /**
     * @notice RLP-decode an Ethereum execution-payload block header
     *         and return the four fields anchoring needs.
     *
     *         Field positions match the post-Cancun header layout —
     *         which has held stable for `parentHash` (0), `stateRoot`
     *         (3), `receiptsRoot` (5), `number` (8) across every
     *         hard fork. Newer fields (blobGasUsed, excessBlobGas,
     *         parentBeaconBlockRoot, requestsHash) sit past index 8
     *         and don't affect the indices we read.
     */
    function decodeStandardHeader(bytes headerRLP)
        internal
        pure
        returns (BlockHeader memory h)
    {
        bytes[] fields = RLPDecode.decodeList(headerRLP);
        require(fields.length >= 9, "LightClientShared: header too short");
        h.parentHash   = RLPDecode.decodeBytes32(fields[0]);
        h.stateRoot    = RLPDecode.decodeBytes32(fields[3]);
        h.receiptsRoot = RLPDecode.decodeBytes32(fields[5]);
        h.number       = RLPDecode.decodeUint(fields[8]);
        return h;
    }

    // ─────────────────────────────────────────────────────────────────
    // Parent-chain walk
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Walk an L2 ancestor chain from {anchorHeader} backwards
     *         to its `parentChain[N-1]` ancestor, anchoring each block
     *         along the way via `lightClient.{anchorMethod}(blockNumber,
     *         receiptsRoot)`.
     *
     *         Invariants checked per step:
     *           (a) keccak256(parentChain[i]) == previous block's
     *               parentHash (hash-chain continuity).
     *           (b) parent.number == previous block's number - 1
     *               (no skips).
     *         A break of either invariant reverts the whole call —
     *         partial anchors aren't possible.
     *
     *         The {anchorMethod} on the LightClient MUST be guarded
     *         with `require(msg.sender == address(this))`. Because the
     *         library is compiled-in to the LightClient, the
     *         `lightClient.call(anchorMethod, ...)` here runs *from*
     *         the LightClient (msg.sender == address(this)). External
     *         callers can't satisfy that, so the method stays
     *         effectively private despite being externally callable.
     *
     *         The head block itself ({anchorHeader}) is NOT anchored
     *         by this function — it's the caller's responsibility to
     *         anchor the head before invoking us. We only walk
     *         parents.
     *
     * @param  anchorHeader   Pre-decoded head-of-chain header.
     * @param  parentChain    RLP-encoded ancestor headers, in walk
     *                        order: parentChain[0] is anchor.parent,
     *                        parentChain[N-1] is the oldest ancestor.
     * @param  lightClient    Address of the LightClient contract whose
     *                        anchor method to call back into.
     * @param  anchorMethod   Name of the (self-only-callable) method:
     *                        `f(uint256 blockNumber, bytes32 receiptsRoot)`.
     * @return oldestNumber   Number of parentChain[N-1] (== anchor's
     *                        number - parentChain.length), or
     *                        anchorHeader.number if parentChain is empty.
     */
    function verifyAndAnchorParentChain(
        BlockHeader memory anchorHeader,
        bytes[] parentChain,
        address lightClient,
        string anchorMethod
    ) internal returns (uint256 oldestNumber) {
        bytes32 expectedParentHash = anchorHeader.parentHash;
        uint256 expectedNumber = anchorHeader.number - 1;
        oldestNumber = anchorHeader.number;

        for (uint256 i = 0; i < parentChain.length; i = i + 1) {
            bytes parentRLP = parentChain[i];
            require(
                keccak256(parentRLP) == expectedParentHash,
                "LightClientShared: parent hash mismatch"
            );
            BlockHeader memory parent = decodeStandardHeader(parentRLP);
            require(
                parent.number == expectedNumber,
                "LightClientShared: parent number not contiguous"
            );
            lightClient.call(anchorMethod, parent.number, parent.receiptsRoot);
            expectedParentHash = parent.parentHash;
            expectedNumber = parent.number - 1;
            oldestNumber = parent.number;
        }
    }
}
