import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/LightClientShared.sol";
import "../../libraries/Bridge/MPTProof.sol";
import "../../libraries/Bridge/RLPDecode.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "./EthLightClient.sol";

/**
 * @notice Bundle the bridge submits with the LineaRollup
 *         `DataFinalizedV3` receipt MPT proof. Same shape as
 *         {OutputReceiptProof} from BaseLightClient — wrapped in a
 *         struct because SolidVM's calldata-arg limits get awkward
 *         at ~7+ args, and the receipt + proof pieces always travel
 *         together.
 */
struct LineaReceiptProof {
    /// L1 block in which the DataFinalizedV3 log was emitted. Must
    /// already be anchored on the wrapped {EthLightClient}.
    uint256 l1BlockNumber;

    /// Position of the L1 tx that emitted the log within its block.
    uint256 txIndex;

    /// Position of the DataFinalizedV3 log within that tx's logs[].
    uint256 logIndex;

    /// EIP-2718-typed (or legacy) RLP receipt bytes. The MPT proof
    /// targets this exact byte string at the receipts trie.
    bytes receiptValueBytes;

    /// Merkle-Patricia inclusion proof, root → leaf.
    bytes[] mptProof;
}

/**
 * @title  LineaLightClient
 * @notice Per-block receipts-root anchor for **Linea** (ConsenSys
 *         zkEVM L2). Trustless via composition: instead of running a
 *         separate consensus light client, we derive Linea's
 *         finality from L1 by piggybacking on the existing
 *         {EthLightClient}.
 *
 *         Linea differs from OP-Stack rollups in two ways that
 *         matter here:
 *
 *           - **Finality model.** Linea is a zk-rollup; finalization
 *             on L1 means a SNARK proof has verified the L2 state
 *             transition. No challenge window, no dispute games —
 *             once the {DataFinalizedV3} event fires, the asserted
 *             state root is canonical.
 *
 *           - **State commitment shape.** OP-Stack proposers commit
 *             to `outputRoot = keccak(0x00‖stateRoot‖wsRoot‖blockHash)`,
 *             which requires the storage root of L2's MessagePasser
 *             predeploy + the block hash for verification. Linea
 *             commits to the L2 `stateRoot` directly; no preimage
 *             reconstruction needed.
 *
 *         Anchoring flow (single block):
 *
 *           1. Caller anchors the relevant L1 block on
 *              {EthLightClient} → L1 receiptsRoot becomes available.
 *           2. Caller submits an MPT proof of the
 *              `DataFinalizedV3(startBlock, endBlock, shnarf,
 *              parentStateRoot, finalStateRoot)` log emitted by the
 *              LineaRollup contract on L1.
 *           3. Caller submits the Linea block header (RLP) for the
 *              `endBlock` named in the event.
 *           4. We RLP-decode the Linea header and require
 *              `header.stateRoot == finalStateRoot` (from event) and
 *              `header.number == endBlockNumber` (from event topic).
 *              That binds the supplied header to the L1-attested
 *              commitment.
 *
 *         **Parent-chain extension** ({anchorLineaBlockChain}):
 *         finalizations on L1 cover *ranges* of L2 blocks
 *         [startBlock, endBlock]. We anchor the endBlock via the
 *         standard path above, then walk back through the supplied
 *         `parentChain[]` headers — each verified by `keccak(rlp) ==
 *         previousChild.parentHash` and `number == previous - 1`.
 *         Every header in the walk is independently anchored.
 *
 *         **Trust model.** Trust derives entirely from EthLightClient:
 *         if a SNARK was verified on L1 inside the anchored L1 block,
 *         no party can have caused the `DataFinalizedV3` log to fire
 *         without a valid proof. There is no permissioned proposer
 *         to trust separately.
 *
 *         **Why not L1 storage proof.** Linea V3 doesn't persist
 *         per-L2-block state roots in a simple `stateRootHashes`
 *         mapping (V3 added the shnarf-based finalization model).
 *         The receipt-proof approach is uniform with how we treat
 *         Base/Cannon and avoids depending on storage-layout details
 *         of an actively-upgraded contract.
 */
contract LineaLightClient is Ownable, ILightClient {
    /// Cap on parent-chain extension length. Linea finalizes ~hourly
    /// covering ranges of ~2500 L2 blocks per batch; to reach an
    /// arbitrary deposit inside the latest finalization, we may need
    /// to walk back near the full batch range from `endBlock`. We
    /// pick 3000 (worst-case Linea batch) to make any in-range
    /// deposit claimable in one tx. If SolidVM's iteration cap rejects
    /// this in practice, lower this and split anchoring across calls.
    uint256 internal constant MAX_PARENT_CHAIN_LEN = 3000;

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    /// Wrapped Ethereum L1 light client. We trust whatever it has
    /// already verified.
    EthLightClient public l1LightClient;

    /// LineaRollup proxy address on L1.
    address public lineaRollup;

    /// keccak256 of the finalization event signature. Constructor-
    /// supplied so Linea event-shape changes (V3 → V4 …) don't force
    /// a redeploy.
    bytes32 public dataFinalizedSig;

    /// Anchored Linea receipts roots, keyed by L2 block number.
    /// bytes32(0) means "not yet anchored".
    mapping(uint256 => bytes32) internal anchoredReceiptsRoot;

    /// Anchored bool flag — distinct from receiptsRoot != 0 to
    /// preserve the same "isAnchored vs zero hash" semantics
    /// EthLightClient established.
    mapping(uint256 => bool) internal anchoredFlag;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event LineaBlockAnchored(
        uint256 indexed l2BlockNumber,
        bytes32 receiptsRoot,
        bytes32 finalStateRoot,
        uint256 l1BlockNumber
    );
    /// Emitted once per ancestor anchored via parent-chain extension.
    event LineaBlockExtended(
        uint256 indexed l2BlockNumber,
        bytes32 receiptsRoot
    );
    event L1LightClientUpdated(address oldClient, address newClient);
    event LineaRollupUpdated(address oldRollup, address newRollup);
    event DataFinalizedSigUpdated(bytes32 oldSig, bytes32 newSig);

    // ─────────────────────────────────────────────────────────────────
    // Construction & admin
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Constructor only sets the owner — all chain-specific state
     *      goes through {initialize} so the contract can be deployed
     *      behind a {Proxy}. Mirrors BaseLightClient.
     */
    constructor(address owner_) Ownable(owner_) { }

    /**
     * @notice Configure L1 light client + LineaRollup + finalization
     *         event signature. Called once by the proxy admin after
     *         deploy.
     */
    function initialize(
        address l1LightClient_,
        address lineaRollup_,
        bytes32 dataFinalizedSig_
    ) external onlyOwner {
        require(l1LightClient_ != address(0), "LineaLightClient: l1 zero");
        require(lineaRollup_ != address(0), "LineaLightClient: rollup zero");
        require(dataFinalizedSig_ != bytes32(0), "LineaLightClient: sig zero");
        l1LightClient = EthLightClient(l1LightClient_);
        lineaRollup = lineaRollup_;
        dataFinalizedSig = dataFinalizedSig_;
    }

    function setL1LightClient(EthLightClient newClient) external onlyOwner {
        require(address(newClient) != address(0), "LineaLightClient: zero");
        address old = address(l1LightClient);
        l1LightClient = newClient;
        emit L1LightClientUpdated(old, address(newClient));
    }

    function setLineaRollup(address newRollup) external onlyOwner {
        require(newRollup != address(0), "LineaLightClient: zero");
        address old = lineaRollup;
        lineaRollup = newRollup;
        emit LineaRollupUpdated(old, newRollup);
    }

    function setDataFinalizedSig(bytes32 newSig) external onlyOwner {
        require(newSig != bytes32(0), "LineaLightClient: zero");
        bytes32 old = dataFinalizedSig;
        dataFinalizedSig = newSig;
        emit DataFinalizedSigUpdated(old, newSig);
    }

    // ─────────────────────────────────────────────────────────────────
    // ILightClient
    // ─────────────────────────────────────────────────────────────────

    function getReceiptsRoot(uint256 blockNumber) external view override returns (bytes32) {
        return anchoredReceiptsRoot[blockNumber];
    }

    function isAnchored(uint256 blockNumber) external view override returns (bool) {
        return anchoredFlag[blockNumber];
    }

    // ─────────────────────────────────────────────────────────────────
    // Anchor — single-block path
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor the *end-of-range* Linea block from an L1
     *         finalization. The block's state root must match the
     *         `finalStateRoot` carried in the L1
     *         {DataFinalizedV3} event.
     */
    function anchorLineaBlock(
        LineaReceiptProof proof,
        bytes lineaHeaderRLP
    ) external returns (uint256 l2BlockNumber, bytes32 receiptsRoot) {
        bytes32 l1ReceiptsRoot = l1LightClient.getReceiptsRoot(proof.l1BlockNumber);
        require(l1ReceiptsRoot != bytes32(0), "LineaLightClient: l1 block not anchored");

        (uint256 endBlockNumber, bytes32 finalStateRoot) =
            _verifyAndDecodeDataFinalized(l1ReceiptsRoot, proof);

        LightClientShared.BlockHeader memory h = LightClientShared.decodeStandardHeader(lineaHeaderRLP);
        require(h.number == endBlockNumber, "LineaLightClient: header number != endBlock");
        require(h.stateRoot == finalStateRoot, "LineaLightClient: header stateRoot != finalStateRoot");

        _anchor(h.number, h.receiptsRoot);
        emit LineaBlockAnchored(h.number, h.receiptsRoot, finalStateRoot, proof.l1BlockNumber);
        return (h.number, h.receiptsRoot);
    }

    // ─────────────────────────────────────────────────────────────────
    // Anchor — parent-chain extension
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor the end-of-range Linea block plus an arbitrary
     *         stretch of its ancestors. The first header
     *         (`lineaHeaderRLP`) is verified via the standard path
     *         against an L1-finalized {DataFinalizedV3} event. Each
     *         entry of `parentChain[]` is then verified against the
     *         previous header's `parentHash` + decremented number,
     *         and independently anchored.
     *
     *         Used when the user's deposit block is older than the
     *         most-recent finalization's `endBlock` — typical case
     *         for a deposit between finalizations.
     *
     * @param  proof              L1 DataFinalizedV3 MPT proof.
     * @param  lineaHeaderRLP     RLP of the *endBlock* Linea header.
     * @param  parentChain        Headers walking back from
     *                            endBlock.parentHash, each in RLP.
     *                            parentChain[0] = endBlock's parent;
     *                            parentChain[N-1] = oldest ancestor.
     * @return anchorBlockNumber  endBlock's number.
     * @return oldestBlockNumber  Number of parentChain[N-1].
     */
    function anchorLineaBlockChain(
        LineaReceiptProof proof,
        bytes lineaHeaderRLP,
        bytes[] parentChain
    ) external returns (uint256 anchorBlockNumber, uint256 oldestBlockNumber) {
        require(
            parentChain.length <= MAX_PARENT_CHAIN_LEN,
            "LineaLightClient: parent chain too long"
        );

        // ── 1. Anchor the head of the chain (endBlock of the finalization).
        bytes32 l1ReceiptsRoot = l1LightClient.getReceiptsRoot(proof.l1BlockNumber);
        require(l1ReceiptsRoot != bytes32(0), "LineaLightClient: l1 block not anchored");

        (uint256 endBlockNumber, bytes32 finalStateRoot) =
            _verifyAndDecodeDataFinalized(l1ReceiptsRoot, proof);

        LightClientShared.BlockHeader memory anchor = LightClientShared.decodeStandardHeader(lineaHeaderRLP);
        require(anchor.number == endBlockNumber, "LineaLightClient: header number != endBlock");
        require(anchor.stateRoot == finalStateRoot, "LineaLightClient: header stateRoot != finalStateRoot");

        _anchor(anchor.number, anchor.receiptsRoot);
        emit LineaBlockAnchored(anchor.number, anchor.receiptsRoot, finalStateRoot, proof.l1BlockNumber);

        anchorBlockNumber = anchor.number;

        // ── 2. Walk parents via the shared helper. Same callback
        //       pattern as BaseLightClient — `_anchorFromShared` is
        //       self-only callable.
        oldestBlockNumber = LightClientShared.verifyAndAnchorParentChain(
            anchor,
            parentChain,
            address(this),
            "_anchorFromShared"
        );
    }

    /**
     * @dev Library callback. {LightClientShared.verifyAndAnchorParentChain}
     *      reaches back into us to record each verified parent. The
     *      self-only guard is what keeps this from being a public
     *      "anchor anything" footgun: the library is compiled-in to
     *      this contract, so when *it* invokes `address(this).call(...)`,
     *      `msg.sender == address(this)` holds. No external caller can
     *      satisfy that.
     */
    function _anchorFromShared(uint256 blockNumber, bytes32 receiptsRoot) external {
        require(msg.sender == address(this), "LineaLightClient: self-only");
        _anchor(blockNumber, receiptsRoot);
        emit LineaBlockExtended(blockNumber, receiptsRoot);
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal — anchor helpers
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Idempotent anchor: re-anchoring the same block with the
     *      same receiptsRoot is a no-op; conflict revert on a different
     *      root (an L1 reorg we refuse to track silently).
     */
    function _anchor(uint256 blockNumber, bytes32 receiptsRoot) private {
        if (anchoredFlag[blockNumber]) {
            require(
                anchoredReceiptsRoot[blockNumber] == receiptsRoot,
                "LineaLightClient: receiptsRoot conflict on re-anchor"
            );
        } else {
            anchoredReceiptsRoot[blockNumber] = receiptsRoot;
            anchoredFlag[blockNumber] = true;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal — receipt + log decoding
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev MPT-prove the L1 receipt and decode the L2 end-block +
     *      final state root from a DataFinalizedV3 log. Topic layout
     *      (3 indexed args + 2 in data):
     *
     *        topic[0] = sig
     *        topic[1] = startBlockNumber (uint256 indexed)
     *        topic[2] = endBlockNumber   (uint256 indexed) → we want this
     *        topic[3] = shnarf           (bytes32 indexed)
     *        data[0..32]  = parentStateRootHash (bytes32)
     *        data[32..64] = finalStateRootHash  (bytes32) → we want this
     */
    function _verifyAndDecodeDataFinalized(
        bytes32 l1ReceiptsRoot,
        LineaReceiptProof proof
    ) private view returns (uint256 endBlockNumber, bytes32 finalStateRoot) {
        bytes mptKey = LightClientShared.rlpUint(proof.txIndex);
        require(
            MPTProof.verifyInclusion(l1ReceiptsRoot, mptKey, proof.receiptValueBytes, proof.mptProof),
            "LineaLightClient: MPT proof failed"
        );

        bytes receiptRlp = LightClientShared.stripTypedTxPrefix(proof.receiptValueBytes);
        bytes[] receiptFields = RLPDecode.decodeList(receiptRlp);
        require(receiptFields.length == 4, "LineaLightClient: receipt must be 4-field list");

        bytes[] receiptLogs = RLPDecode.decodeList(receiptFields[3]);
        require(proof.logIndex < receiptLogs.length, "LineaLightClient: logIndex out of range");

        bytes[] logFields = RLPDecode.decodeList(receiptLogs[proof.logIndex]);
        require(logFields.length == 3, "LineaLightClient: log must be 3-field list");

        address logAddr = RLPDecode.decodeAddress(logFields[0]);
        require(logAddr == lineaRollup, "LineaLightClient: log not from LineaRollup");

        bytes[] topics = RLPDecode.decodeList(logFields[1]);
        require(topics.length == 4, "LineaLightClient: expected 4 topics");
        require(
            RLPDecode.decodeBytes32(topics[0]) == dataFinalizedSig,
            "LineaLightClient: topic[0] not DataFinalizedV3"
        );

        endBlockNumber = uint256(RLPDecode.decodeBytes32(topics[2]));

        bytes logData = RLPDecode.decodeBytes(logFields[2]);
        require(logData.length >= 64, "LineaLightClient: log data too short");
        // finalStateRoot starts at byte offset 32 (after parentStateRoot).
        bytes finalStateRootBytes = new bytes(32);
        for (uint256 i = 0; i < 32; i = i + 1) {
            finalStateRootBytes[i] = logData[32 + i];
        }
        finalStateRoot = bytes32(finalStateRootBytes);
    }
}
