import "../../libraries/Bridge/INativeRedemptionTarget.sol";
import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/LightClientShared.sol";
import "../../libraries/Bridge/MPTProof.sol";
import "../../libraries/Bridge/RLPDecode.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @notice Decoded contents of a `RedemptionRequested` log emitted by
 *         the external-side {StratoNativeRepresentationBridge}.
 *         Event signature is:
 *
 *           RedemptionRequested(
 *               address indexed representationToken,
 *               uint256 amount,
 *               address indexed sender,
 *               address indexed stratoRecipient,
 *               uint96 redemptionId
 *           )
 *
 *         Note the data shape differs from {EthBridgeIn}'s
 *         DepositRouted: there's no `targetStratoToken` field because
 *         the strato-token-for-representation mapping lives entirely
 *         on STRATO (via
 *         StratoNativeBridge.stratoTokenByRepresentation[repToken][externalChainId])
 *         — the external side doesn't need to know about STRATO's
 *         token registry. So data is exactly two abi words:
 *         (amount, redemptionId) = 64 bytes.
 */
struct ClaimedRedemption {
    address representationToken;   // topics[1]
    address externalSender;        // topics[2]
    address stratoRecipient;       // topics[3]
    uint256 amount;                // data[0..32]
    uint96  redemptionId;          // data[32..64]
}

/**
 * @title  StratoNativeBridgeIn
 * @notice Trustless external→STRATO bridge claim contract for the
 *         **native bridge** flow (where users burn representation
 *         tokens on an external chain to unlock the STRATO-native
 *         tokens they back). Sister contract of {EthBridgeIn}; both
 *         share the verification skeleton (lightClient lookup →
 *         MPT proof → log decode → dedup → mintTarget callback) but
 *         differ in:
 *
 *           1. Event shape — {ClaimedRedemption} above vs {ClaimedDeposit}.
 *           2. Authorized emitter — the {StratoNativeRepresentationBridge}
 *              on the source chain, not a DepositRouter.
 *           3. Callback target — {INativeRedemptionTarget}, which
 *              releases STRATO-native funds from the custody vault
 *              instead of minting wrapped tokens.
 *
 *         Trust posture:
 *           - Caller passes a verifiable claim (light-client-anchored
 *             receipt + MPT proof); contract has zero trusted state
 *             besides the configured {representationBridge} and
 *             {redemptionRequestedSig}.
 *           - {lightClient} must already have anchored the source
 *             block's receipts root (caller invokes its
 *             anchorBlockHeader / equivalent first; the orchestrator
 *             packs both txs in a single batch).
 *           - Dedup keys are byte-identical to the standard path
 *             (keccak(externalChainId, blockNumber, txIndex, logIndex))
 *             so an attacker can't re-credit the same log via the
 *             other contract — both sides reject the same depositKey
 *             after the first credit. (The standard path's dedup lives
 *             on MercataBridge; native's lives on StratoNativeBridge.
 *             Each bridge tracks its own; they don't share storage.)
 *
 * @dev    Why this is a separate contract rather than a generic
 *         EthBridgeIn with a flavor parameter:
 *
 *           - Different event data layouts (96 vs 64 bytes) ⇒ different
 *             decoder paths.
 *           - Different callback interface ⇒ different ABI dispatch.
 *           - Cleaner audit surface — a future change to the standard
 *             flow can't accidentally widen native's attack surface,
 *             and vice versa.
 *
 *         When the flow proliferation pattern becomes painful (say,
 *         we add a third event type), the right refactor is to extract
 *         a shared internal `_verifyAndDecode(...)` library and have
 *         both contracts thin-wrap it. For two contracts it's fine to
 *         just clone.
 */
contract StratoNativeBridgeIn is Ownable {
    using RLPDecode for *;

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    /// Light client providing verified receiptsRoots for the configured
    /// `srcChainId`. EthLightClient for Sepolia/mainnet, BaseLightClient
    /// for Base, LineaLightClient for Linea, BscLightClient for BSC.
    ILightClient public lightClient;

    /// External chain id (matches the chain the representation bridge
    /// lives on). Used in the dedup key so claims from different chains
    /// don't collide, and (when the orchestrator routes them) so the
    /// downstream target can look up the right asset config.
    uint256 public srcChainId;

    /// StratoNativeRepresentationBridge address on the source chain.
    /// The verifier requires `log.address` to equal this; any other
    /// emitter is rejected (the rep bridge is the only contract that
    /// can legitimately mint/burn the representation tokens it issues).
    address public representationBridge;

    /// keccak256 of the canonical RedemptionRequested event signature:
    ///   keccak256("RedemptionRequested(address,uint256,address,address,uint96)")
    /// Bootstrap-time configurable so a future event-shape revision
    /// can be supported without redeploying.
    bytes32 public redemptionRequestedSig;

    /// Dedup keyed on (externalChainId, blockNumber, txIndex, logIndex).
    /// Once true, the same redemption can never be re-credited via this
    /// contract.
    mapping(bytes32 => bool) public processed;

    /// Optional callback target. If non-zero, {claim} invokes
    /// {INativeRedemptionTarget.creditNativeRedemptionWithProof} on
    /// this address after dedup. Production deploys point this at
    /// {StratoNativeBridge}. address(0) puts the contract in
    /// observer mode (just emits {ClaimVerified}).
    address public redemptionTarget;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    /// @notice Emitted on successful verification. Downstream consumers
    ///         (indexers, the redemption target's own
    ///         NativeRedemptionTrustlesslyCredited event) key off this
    ///         and the depositKey.
    event ClaimVerified(
        bytes32 indexed depositKey,
        uint256 srcChainId,
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        ClaimedRedemption claim
    );

    event LightClientUpdated(address oldClient, address newClient);
    event RepresentationBridgeUpdated(address oldBridge, address newBridge);
    event EventSigUpdated(bytes32 oldSig, bytes32 newSig);
    event RedemptionTargetUpdated(address oldTarget, address newTarget);

    // ─────────────────────────────────────────────────────────────────
    // Construction & admin
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Constructor only sets the owner; chain-specific state is
     *      configured via {initialize}, which the proxy calls once after
     *      deployment. Mirrors the {EthBridgeIn} pattern.
     */
    constructor(address owner_) Ownable(owner_) { }

    /**
     * @notice Configure chain-specific state. Called once by the proxy
     *         admin (or by the deployer for direct deploys).
     */
    function initialize(
        address lightClient_,
        uint256 srcChainId_,
        address representationBridge_,
        bytes32 redemptionRequestedSig_
    ) external onlyOwner {
        require(lightClient_ != address(0), "SNBI: lightClient zero");
        require(representationBridge_ != address(0), "SNBI: rep bridge zero");
        require(redemptionRequestedSig_ != bytes32(0), "SNBI: sig zero");
        lightClient = ILightClient(lightClient_);
        srcChainId = srcChainId_;
        representationBridge = representationBridge_;
        redemptionRequestedSig = redemptionRequestedSig_;
    }

    function setLightClient(ILightClient newClient) external onlyOwner {
        require(address(newClient) != address(0), "SNBI: lightClient zero");
        address old = address(lightClient);
        lightClient = newClient;
        emit LightClientUpdated(old, address(newClient));
    }

    function setRepresentationBridge(address newBridge) external onlyOwner {
        require(newBridge != address(0), "SNBI: rep bridge zero");
        address old = representationBridge;
        representationBridge = newBridge;
        emit RepresentationBridgeUpdated(old, newBridge);
    }

    function setRedemptionRequestedSig(bytes32 newSig) external onlyOwner {
        require(newSig != bytes32(0), "SNBI: sig zero");
        bytes32 old = redemptionRequestedSig;
        redemptionRequestedSig = newSig;
        emit EventSigUpdated(old, newSig);
    }

    /// Set the callback target (typically {StratoNativeBridge}). Pass
    /// address(0) to disable the auto-release path and operate in
    /// observer mode — useful for testing the verifier in isolation.
    function setRedemptionTarget(address newTarget) external onlyOwner {
        address old = redemptionTarget;
        redemptionTarget = newTarget;
        emit RedemptionTargetUpdated(old, newTarget);
    }

    // ─────────────────────────────────────────────────────────────────
    // Permissionless: claim
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Verify a RedemptionRequested log and credit the native
     *         redemption on the configured target.
     *
     *         The caller must have already anchored `blockNumber` on
     *         the wrapped light client.
     *
     * @param blockNumber       Source-chain block where the
     *                          RedemptionRequested log lives.
     * @param txIndex           Index of the tx within the block.
     * @param logIndex          Index of the RedemptionRequested log
     *                          within the tx's receipt.logs[].
     * @param receiptValueBytes The MPT-stored receipt value (typed-tx
     *                          prefix + RLP for EIP-2718 receipts;
     *                          plain RLP for legacy).
     * @param mptProof          Receipts-trie inclusion proof root→leaf.
     * @return depositKey       The dedup key written for this claim
     *                          (same key the redemption target dedups on).
     */
    function claim(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes   receiptValueBytes,
        bytes[] mptProof
    ) external returns (bytes32 depositKey) {
        // 1. Look up the verified receipts_root from the light client.
        bytes32 receiptsRoot = lightClient.getReceiptsRoot(blockNumber);
        require(receiptsRoot != bytes32(0), "SNBI: block not anchored");

        // 2. MPT inclusion proof against the receipts trie.
        bytes mptKey = LightClientShared.rlpUint(txIndex);
        require(
            MPTProof.verifyInclusion(receiptsRoot, mptKey, receiptValueBytes, mptProof),
            "SNBI: MPT proof failed"
        );

        // 3. Strip EIP-2718 type-prefix and decode the receipt RLP.
        //    Avoid the variable name `log` — SolidVM treats it as a
        //    builtin and locals of the same name shadow incorrectly.
        bytes receiptRlp = LightClientShared.stripTypedTxPrefix(receiptValueBytes);
        bytes[] receiptFields = RLPDecode.decodeList(receiptRlp);
        require(receiptFields.length == 4, "SNBI: receipt must be 4-field list");
        bytes[] receiptLogs = RLPDecode.decodeList(receiptFields[3]);
        require(logIndex < receiptLogs.length, "SNBI: logIndex out of range");

        // 4. Decode the target log: [address, topics, data].
        bytes[] logFields = RLPDecode.decodeList(receiptLogs[logIndex]);
        require(logFields.length == 3, "SNBI: log must be 3-field list");

        address logAddr = RLPDecode.decodeAddress(logFields[0]);
        require(logAddr == representationBridge, "SNBI: log not from rep bridge");

        bytes[] topics = RLPDecode.decodeList(logFields[1]);
        require(topics.length == 4, "SNBI: expected 4 topics");
        require(
            RLPDecode.decodeBytes32(topics[0]) == redemptionRequestedSig,
            "SNBI: topic[0] not RedemptionRequested"
        );

        bytes logData = RLPDecode.decodeBytes(logFields[2]);
        ClaimedRedemption memory red = _decodeRedemptionLog(topics, logData);

        // 5. Dedup. Same key shape as EthBridgeIn — and since the two
        //    contracts target disjoint downstream mints (MercataBridge
        //    vs StratoNativeBridge), there's no cross-flow collision
        //    even if both verifiers were registered for the same chain.
        depositKey = keccak256(abi.encode(srcChainId, blockNumber, txIndex, logIndex));
        require(!processed[depositKey], "SNBI: already processed");
        processed[depositKey] = true;

        // 6. Callback. We pass `representationBridge` as the
        //    externalBridge component — the redemption target keys its
        //    deposits mapping on (externalChainId, externalBridge,
        //    externalRedemptionId), and the externalBridge MUST be the
        //    contract that emitted the log (which we just MPT-verified).
        if (redemptionTarget != address(0)) {
            INativeRedemptionTarget(redemptionTarget).creditNativeRedemptionWithProof(
                depositKey,
                srcChainId,
                representationBridge,
                uint256(red.redemptionId),
                red.externalSender,
                red.representationToken,
                red.stratoRecipient,
                red.amount
            );
        }

        emit ClaimVerified(depositKey, srcChainId, blockNumber, txIndex, logIndex, red);
        return depositKey;
    }

    // ─────────────────────────────────────────────────────────────────
    // Decode helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Decode a RedemptionRequested log's topics + data.
     *      Indexed addresses occupy topics in declaration order:
     *        topics[0] = event signature hash
     *        topics[1] = representationToken (indexed)
     *        topics[2] = sender (indexed)
     *        topics[3] = stratoRecipient (indexed)
     *      Data: abi.encode(amount, redemptionId)
     *        data[0..32]  = amount (uint256)
     *        data[32..64] = redemptionId (uint96, right-aligned in word)
     */
    function _decodeRedemptionLog(bytes[] topics, bytes data)
        private
        pure
        returns (ClaimedRedemption memory red)
    {
        red.representationToken = _addressFromTopic(topics[1]);
        red.externalSender      = _addressFromTopic(topics[2]);
        red.stratoRecipient     = _addressFromTopic(topics[3]);

        require(data.length == 64, "SNBI: data must be 64 bytes (2 abi words)");
        red.amount       = _readUint256(data, 0);
        red.redemptionId = uint96(_readUint256(data, 32));
    }

    /// @dev Topic items are 32-byte string items; the address sits
    ///      right-aligned in the low 20 bytes (EVM topic encoding).
    function _addressFromTopic(bytes topicRlp) private pure returns (address) {
        bytes32 raw = RLPDecode.decodeBytes32(topicRlp);
        return address(uint160(uint256(raw)));
    }

    /// @dev Read a big-endian uint256 from `data` at byte offset `off`.
    function _readUint256(bytes data, uint256 off) private pure returns (uint256 v) {
        require(off + 32 <= data.length, "SNBI: read OOB");
        v = 0;
        for (uint256 i = 0; i < 32; i = i + 1) {
            v = (v << 8) | uint256(uint8(data[off + i]));
        }
    }
}
