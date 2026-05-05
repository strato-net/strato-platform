import "../../libraries/Bridge/IBridgeMintTarget.sol";
import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/MPTProof.sol";
import "../../libraries/Bridge/RLPDecode.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @notice Decoded contents of a `DepositRouted` log emitted by the
 *         Ethereum-side DepositRouter. The event signature is
 *
 *           DepositRouted(
 *               address indexed token,
 *               uint256 amount,
 *               address indexed sender,
 *               address indexed stratoAddress,
 *               address targetStratoToken,
 *               uint96 depositId
 *           )
 */
struct ClaimedDeposit {
    address ethToken;
    address ethSender;
    address stratoRecipient;
    address targetStratoToken;
    uint256 amount;
    uint96  depositId;
}

/**
 * @notice EIP-712-style claim assignment. The original recipient (the
 *         `stratoRecipient` decoded from the deposit log) signs a
 *         ClaimAssignment authorizing some other address to receive
 *         the credit. Liquidity providers buy these signed assignments
 *         off-chain in exchange for advancing funds before finality —
 *         then post-finality, the LP submits the claim with the
 *         assignment attached and the bridge credits them instead of
 *         the original recipient.
 *
 *         Signature scheme (EIP-712 inspired, simplified for v1):
 *           digest = keccak256(0x1901 || DOMAIN_SEPARATOR || structHash)
 *           structHash = keccak256(ASSIGNMENT_TYPEHASH || depositKey || padded_addr || deadline)
 *           where DOMAIN_SEPARATOR = keccak256("EthBridgeIn:v1")
 *           and  ASSIGNMENT_TYPEHASH = keccak256(
 *               "ClaimAssignment(bytes32 depositKey,address newRecipient,uint256 deadline)"
 *           )
 *
 *         Signer must be the deposit's stratoRecipient (decoded from
 *         the log). The assignment is bound to a specific depositKey,
 *         so an LP can't reuse a signature on a different deposit.
 *
 *         Setting `newRecipient = address(0)` means "no assignment" —
 *         the credit goes to the original stratoRecipient as usual.
 *         Useful as a sentinel so callers can pass an empty
 *         assignment unconditionally.
 *
 *         Future hardening (v2): bind to chainId + verifyingContract
 *         in the domain separator for cross-deployment replay safety.
 *         Today's v1 binding is by depositKey alone.
 */
struct ClaimAssignment {
    bytes32 depositKey;
    address newRecipient;
    uint256 deadline;
    uint8   v;
    bytes32 r;
    bytes32 s;
}

/**
 * @title  EthBridgeIn
 * @notice Trustless Ethereum→STRATO bridge claim contract. Verifies
 *         that a `DepositRouted` log was emitted by the configured
 *         DepositRouter on Ethereum, in a block whose receipts_root
 *         has been anchored by EthLightClient.
 *
 *         Verification chain:
 *           1. Caller passes (blockNumber, txIndex, logIndex,
 *              receiptValueBytes, mptProof).
 *           2. Look up receiptsRoot from EthLightClient (must already
 *              be anchored — caller is responsible for invoking
 *              {EthLightClient.anchorBlockHeader} first).
 *           3. MPT verify: receiptValueBytes appears at key
 *              `rlp(txIndex)` under that receipts_root.
 *           4. RLP-decode the receipt (handling EIP-2718 typed-tx
 *              prefixes), find logs[logIndex].
 *           5. Match log.address to the configured deposit router and
 *              log.topics[0] to the canonical DepositRouted signature.
 *           6. ABI-decode the indexed and non-indexed log fields.
 *           7. Dedup via processed[depositKey]; emit ClaimVerified.
 *
 *         Tokenization integration (calling TokenFactory.mint /
 *         MercataBridge.creditDeposit) is intentionally separated:
 *         the trustless verification logic stays in this contract,
 *         and a downstream module hooked off the ClaimVerified event
 *         performs the actual mint. That separation keeps the
 *         consensus-critical surface narrow and auditable.
 *
 * @dev    The event signature for DepositRouted in our deployment is
 *           keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
 *         Computed once and stored on bootstrap so the event sig can
 *         be updated if the off-chain emitter ever changes shape
 *         (without redeploying the bridge).
 */
contract EthBridgeIn is Ownable {
    using RLPDecode for *;

    // ─────────────────────────────────────────────────────────────────
    // EIP-712 constants (precomputed off-chain to avoid runtime keccak)
    // ─────────────────────────────────────────────────────────────────

    /// keccak256("EthBridgeIn:v1") — domain separator for v1 of the
    /// claim-assignment scheme. Constant so signatures can be
    /// pre-computed off-chain without depending on deployment specifics.
    bytes32 constant DOMAIN_SEPARATOR =
        bytes32(hex"36eec31ea92b007b08060dd7f286f181473321810dbad5e99d2444f84d542d53");

    /// keccak256("ClaimAssignment(bytes32 depositKey,address newRecipient,uint256 deadline)")
    bytes32 constant ASSIGNMENT_TYPEHASH =
        bytes32(hex"60eb56ba5f9062650211119df58cdbc350096368e17dcf2d21250fab31bd346d");

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    /// The light client providing verified receiptsRoots for the
    /// configured `srcChainId`. Concretely an EthLightClient when
    /// srcChainId is mainnet/Sepolia, a BaseLightClient when srcChainId
    /// is Base, etc. — anything implementing {ILightClient}.
    ILightClient public lightClient;

    /// Source chain identifier (e.g. 11155111 for Sepolia, 1 for mainnet).
    /// Used in the dedup key so claims from different chains don't collide.
    uint256 public srcChainId;

    /// DepositRouter contract address on the source chain. The verifier
    /// requires log.address to equal this; any other emitter is rejected.
    address public depositRouter;

    /// keccak256 of the canonical DepositRouted event signature.
    /// Bootstrap-time configurable so the event shape can be updated
    /// without redeploying the bridge if the Eth-side router changes.
    bytes32 public depositRoutedSig;

    /// Dedup: keccak256(abi.encode(srcChainId, blockNumber, txIndex, logIndex)).
    /// Once true, the same deposit can never be re-claimed.
    mapping(bytes32 => bool) public processed;

    /// Optional mint callback. If non-zero, claim() invokes
    /// {IBridgeMintTarget.creditTrustlessDeposit} on this address
    /// after dedup. With address(0) the contract just emits
    /// ClaimVerified and an off-chain process performs the credit.
    /// The flag mode is the safest production posture; integration
    /// mode is what the tokenization layer wants once trust is in
    /// place.
    address public mintTarget;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    /// @notice Emitted on successful claim verification. Downstream
    ///         minting infrastructure listens for this and credits
    ///         `claim.stratoRecipient` with `claim.amount` of the
    ///         STRATO token mapped to `claim.ethToken`.
    event ClaimVerified(
        bytes32 indexed depositKey,
        uint256 srcChainId,
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        ClaimedDeposit claim
    );

    event LightClientUpdated(address oldClient, address newClient);
    event RouterUpdated(address oldRouter, address newRouter);
    event EventSigUpdated(bytes32 oldSig, bytes32 newSig);
    event MintTargetUpdated(address oldTarget, address newTarget);

    /// @notice Emitted when a claim used a valid signed assignment
    ///         and the credit was redirected away from the original
    ///         stratoRecipient. Off-chain accounting (LPs, indexers)
    ///         keys off this to track who actually received the funds.
    event ClaimReassigned(
        bytes32 indexed depositKey,
        address indexed originalRecipient,
        address indexed assignedRecipient,
        uint256 deadline
    );

    // ─────────────────────────────────────────────────────────────────
    // Construction & admin
    // ─────────────────────────────────────────────────────────────────

    constructor(
        address owner_,
        ILightClient lightClient_,
        uint256 srcChainId_,
        address depositRouter_,
        bytes32 depositRoutedSig_
    ) Ownable(owner_) {
        require(address(lightClient_) != address(0), "EthBridgeIn: lightClient zero");
        require(depositRouter_ != address(0), "EthBridgeIn: router zero");
        require(depositRoutedSig_ != bytes32(0), "EthBridgeIn: sig zero");
        lightClient = lightClient_;
        srcChainId = srcChainId_;
        depositRouter = depositRouter_;
        depositRoutedSig = depositRoutedSig_;
    }

    function setLightClient(ILightClient newClient) external onlyOwner {
        require(address(newClient) != address(0), "EthBridgeIn: lightClient zero");
        address old = address(lightClient);
        lightClient = newClient;
        emit LightClientUpdated(old, address(newClient));
    }

    function setDepositRouter(address newRouter) external onlyOwner {
        require(newRouter != address(0), "EthBridgeIn: router zero");
        address old = depositRouter;
        depositRouter = newRouter;
        emit RouterUpdated(old, newRouter);
    }

    function setDepositRoutedSig(bytes32 newSig) external onlyOwner {
        require(newSig != bytes32(0), "EthBridgeIn: sig zero");
        bytes32 old = depositRoutedSig;
        depositRoutedSig = newSig;
        emit EventSigUpdated(old, newSig);
    }

    /// Set the mint callback target (or address(0) to disable
    /// auto-mint and operate in observer mode where downstream
    /// systems consume the ClaimVerified event).
    function setMintTarget(address newTarget) external onlyOwner {
        address old = mintTarget;
        mintTarget = newTarget;
        emit MintTargetUpdated(old, newTarget);
    }

    // ─────────────────────────────────────────────────────────────────
    // Permissionless: claim
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Verify a deposit and credit the corresponding receipt.
     *
     *         The caller must have already invoked
     *         {EthLightClient.anchorBlockHeader} for `blockNumber`;
     *         this function only does the post-anchor work
     *         (MPT proof + log decode + dedup).
     *
     * @param blockNumber       Ethereum execution-layer block number where
     *                          the deposit log lives.
     * @param txIndex           Index of the transaction within the block.
     *                          Used to derive the MPT key (`rlp(txIndex)`).
     * @param logIndex          Index of the DepositRouted log within the
     *                          transaction's receipt. Must be < receipt.logs.length.
     * @param receiptValueBytes The MPT trie's stored value: legacy receipts
     *                          are `rlp(receipt)`; EIP-2718 typed-tx
     *                          receipts are `txType_byte || rlp(receipt)`.
     *                          Pass exactly what's in the trie.
     * @param mptProof          Sequence of RLP-encoded trie nodes from
     *                          root to leaf, as returned by
     *                          eth_getProof / eth_getTransactionReceipt
     *                          + custom proof builder.
     * @param assignment        Optional signed claim assignment that
     *                          redirects the credit to a different
     *                          recipient. When `assignment.newRecipient`
     *                          is the zero address the assignment is
     *                          ignored and the credit goes to the
     *                          stratoRecipient decoded from the log.
     */
    function claim(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes   receiptValueBytes,
        bytes[] mptProof,
        ClaimAssignment assignment
    ) external returns (bytes32 depositKey) {
        // 1. Look up the verified receipts_root from the light client.
        bytes32 receiptsRoot = lightClient.getReceiptsRoot(blockNumber);
        require(receiptsRoot != bytes32(0), "EthBridgeIn: block not anchored");

        // 2. MPT inclusion proof against the receipts trie.
        bytes mptKey = _rlpUint(txIndex);
        require(
            MPTProof.verifyInclusion(receiptsRoot, mptKey, receiptValueBytes, mptProof),
            "EthBridgeIn: MPT proof failed"
        );

        // 3. Strip EIP-2718 type-prefix and decode the receipt RLP.
        // We avoid the variable name `log` because SolidVM treats that
        // identifier as a builtin function, so a local of the same
        // name shadows the wrong way.
        bytes receiptRlp = _stripTypedTxPrefix(receiptValueBytes);
        bytes[] receiptFields = RLPDecode.decodeList(receiptRlp);
        require(receiptFields.length == 4, "EthBridgeIn: receipt must be 4-field list");
        // receiptFields = [status, cumulativeGasUsed, logsBloom, logs]
        bytes[] receiptLogs = RLPDecode.decodeList(receiptFields[3]);
        require(logIndex < receiptLogs.length, "EthBridgeIn: logIndex out of range");

        // 4. Decode the target log: [address, topics, data].
        bytes[] logFields = RLPDecode.decodeList(receiptLogs[logIndex]);
        require(logFields.length == 3, "EthBridgeIn: log must be 3-field list");

        address logAddr = RLPDecode.decodeAddress(logFields[0]);
        require(logAddr == depositRouter, "EthBridgeIn: log not from router");

        bytes[] topics = RLPDecode.decodeList(logFields[1]);
        require(topics.length == 4, "EthBridgeIn: expected 4 topics");
        require(RLPDecode.decodeBytes32(topics[0]) == depositRoutedSig,
                "EthBridgeIn: topic[0] not DepositRouted");

        bytes logData = RLPDecode.decodeBytes(logFields[2]);
        ClaimedDeposit memory dep = _decodeDepositLog(topics, logData);

        // 5. Dedup.
        depositKey = keccak256(abi.encode(srcChainId, blockNumber, txIndex, logIndex));
        require(!processed[depositKey], "EthBridgeIn: already processed");
        processed[depositKey] = true;

        // 6. Optional claim assignment. If newRecipient is non-zero,
        //    the original stratoRecipient must have signed an
        //    EIP-712 ClaimAssignment authorizing the redirect.
        address effectiveRecipient = dep.stratoRecipient;
        if (assignment.newRecipient != address(0)) {
            _verifyAssignment(assignment, depositKey, dep.stratoRecipient);
            effectiveRecipient = assignment.newRecipient;
            emit ClaimReassigned(depositKey, dep.stratoRecipient, assignment.newRecipient, assignment.deadline);
        }

        // 7. Optional mint callback. If the mint target reverts, our
        //    storage write to `processed` is rolled back with the
        //    transaction, so the user can re-claim once the
        //    integration is fixed (e.g., admin enables the route on
        //    the mint-target's allowlist).
        if (mintTarget != address(0)) {
            IBridgeMintTarget(mintTarget).creditTrustlessDeposit(
                depositKey,
                srcChainId,
                dep.ethToken,
                dep.ethSender,
                effectiveRecipient,
                dep.targetStratoToken,
                dep.amount
            );
        }

        emit ClaimVerified(depositKey, srcChainId, blockNumber, txIndex, logIndex, dep);
        return depositKey;
    }

    // ─────────────────────────────────────────────────────────────────
    // EIP-712 assignment verification
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Verify an EIP-712 signed claim assignment. Reverts on any
     *      failure so the surrounding tx rolls back the dedup flag.
     */
    function _verifyAssignment(
        ClaimAssignment assignment,
        bytes32 expectedDepositKey,
        address expectedSigner
    ) private view {
        require(
            assignment.depositKey == expectedDepositKey,
            "EthBridgeIn: assignment depositKey mismatch"
        );
        // Strict <: an assignment with deadline == block.timestamp has
        // already expired by the time it's mined. Also rejects the
        // deadline=0 sentinel cleanly.
        require(
            block.timestamp < assignment.deadline,
            "EthBridgeIn: assignment expired"
        );

        // structHash = keccak256(typeHash || depositKey || padded_addr || deadline)
        // Manual ABI-encode (each value occupies 32 bytes).
        bytes encoded = bytes(ASSIGNMENT_TYPEHASH)
                      + bytes(assignment.depositKey)
                      + bytes(_addressTo32(assignment.newRecipient))
                      + bytes(_uint256To32(assignment.deadline));
        bytes32 structHash = keccak256(encoded);

        // digest = keccak256("\x19\x01" || DOMAIN_SEPARATOR || structHash)
        // 0x1901 packs to 2 bytes via the integer-to-bytes builtin.
        bytes32 digest = keccak256(
            bytes(uint256(0x1901))
            + bytes(DOMAIN_SEPARATOR)
            + bytes(structHash)
        );

        // SolidVM's ecrecover dispatcher requires r/s as uint or hex
        // string; cast bytes32 → uint256 before passing.
        address signer = ecrecover(digest, assignment.v, uint256(assignment.r), uint256(assignment.s));
        require(signer != address(0), "EthBridgeIn: ecrecover failed");
        require(signer == expectedSigner, "EthBridgeIn: assignment not signed by recipient");
    }

    /// @dev Pad an address into a 32-byte left-zero word (right-aligned
    ///      address bytes), the layout EIP-712 ABI-encode uses.
    function _addressTo32(address a) private pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @dev Cast uint256 to bytes32 (BE; same byte layout).
    function _uint256To32(uint256 v) private pure returns (bytes32) {
        return bytes32(v);
    }

    // ─────────────────────────────────────────────────────────────────
    // Decode helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Decode a DepositRouted log's topics + data into the
     *      structured form. Topic layout (recall: indexed parameters
     *      occupy topics in declaration order):
     *        topics[0] = event signature hash
     *        topics[1] = token (address, indexed)
     *        topics[2] = sender (address, indexed)
     *        topics[3] = stratoAddress (address, indexed)
     *      Data: abi.encode(amount, targetStratoToken, depositId)
     *        data[0..32]  = amount (uint256)
     *        data[32..64] = targetStratoToken (address, right-aligned)
     *        data[64..96] = depositId (uint96, right-aligned)
     */
    function _decodeDepositLog(bytes[] topics, bytes data)
        private
        pure
        returns (ClaimedDeposit memory dep)
    {
        // Indexed addresses arrive as 32-byte big-endian words.
        dep.ethToken         = _addressFromTopic(topics[1]);
        dep.ethSender        = _addressFromTopic(topics[2]);
        dep.stratoRecipient  = _addressFromTopic(topics[3]);

        require(data.length == 96, "EthBridgeIn: data must be 96 bytes (3 abi words)");
        dep.amount             = _readUint256(data, 0);
        dep.targetStratoToken  = _readAddress(data, 32);
        dep.depositId          = uint96(_readUint256(data, 64));
    }

    /// @dev Topic items in raw log RLP are 32-byte string items. After
    ///      RLPDecode.decodeBytes32, we have a bytes32 with the address
    ///      right-aligned in the low 20 bytes (per EVM topic encoding).
    function _addressFromTopic(bytes topicRlp) private pure returns (address) {
        bytes32 raw = RLPDecode.decodeBytes32(topicRlp);
        return address(uint160(uint256(raw)));
    }

    /// @dev Read a uint256 from `data` at byte offset `off`, big-endian.
    function _readUint256(bytes data, uint256 off) private pure returns (uint256 v) {
        require(off + 32 <= data.length, "EthBridgeIn: read OOB");
        v = 0;
        for (uint256 i = 0; i < 32; i = i + 1) {
            v = (v << 8) | uint256(uint8(data[off + i]));
        }
    }

    /// @dev Read a right-aligned address from `data` at byte offset `off`
    ///      (an ABI-encoded address word: 12 zero bytes + 20 address bytes).
    function _readAddress(bytes data, uint256 off) private pure returns (address) {
        return address(uint160(_readUint256(data, off)));
    }

    /**
     * @dev If `b` starts with an EIP-2718 transaction-type prefix
     *      (single byte < 0xc0), strip it and return the remaining
     *      RLP. Otherwise return `b` unchanged. The prefix is always
     *      0x01..0x7f for the typed-tx envelopes we care about
     *      (EIP-2930, EIP-1559, EIP-4844, EIP-7702 …); 0x00..0x7f is
     *      the safe range, anything < 0xc0 isn't a top-level RLP list
     *      so it can't be a legacy receipt.
     */
    function _stripTypedTxPrefix(bytes b) private pure returns (bytes) {
        require(b.length > 0, "EthBridgeIn: empty receipt");
        if (uint8(b[0]) >= 0xc0) {
            // Legacy receipt: the bytes are already pure RLP.
            return b;
        }
        bytes out = new bytes(b.length - 1);
        for (uint256 i = 0; i < out.length; i = i + 1) {
            out[i] = b[i + 1];
        }
        return out;
    }

    /**
     * @dev RLP-encode a uint as the receipts-trie key. RLP integer
     *      encoding canonicalizes to the minimum-byte big-endian form.
     *
     *      Implemented via SolidVM's `bytes(integer)` builtin, which
     *      gives the minimum-byte BE representation directly — avoids
     *      manual byte-by-byte construction (which the typechecker
     *      doesn't love because of the bytes1/uint8 cast story).
     *
     *      Special cases:
     *        v = 0     → 0x80 (empty string)
     *        v < 0x80  → single self-encoded byte
     */
    function _rlpUint(uint256 v) private pure returns (bytes) {
        if (v == 0) return bytes(uint256(0x80));         // empty string in RLP
        if (v < 0x80) return bytes(v);                   // self-encoded byte
        bytes valueBytes = bytes(v);                     // BE bytes, no leading zeros
        bytes prefix = bytes(uint256(0x80) + valueBytes.length);
        return prefix + valueBytes;
    }
}
