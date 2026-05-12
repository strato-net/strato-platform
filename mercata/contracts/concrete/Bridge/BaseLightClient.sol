import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/LightClientShared.sol";
import "../../libraries/Bridge/MPTProof.sol";
import "../../libraries/Bridge/RLPDecode.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "./EthLightClient.sol";

/**
 * @notice Bundle the bridge submits with the Cannon DisputeGameCreated
 *         receipt MPT proof. Wrapped in a struct because SolidVM's
 *         calldata-arg limits get awkward at ~7+ args, and the
 *         receipt+proof pieces always travel together.
 */
struct OutputReceiptProof {
    /// L1 block in which the DisputeGameCreated log was emitted. Must
    /// already be anchored on the wrapped {EthLightClient}.
    uint256 l1BlockNumber;

    /// Position of the L1 tx that emitted the log within its block.
    uint256 txIndex;

    /// Position of the DisputeGameCreated log within that tx's logs[].
    uint256 logIndex;

    /// EIP-2718-typed (or legacy) RLP receipt bytes. The MPT proof
    /// targets this exact byte string at the receipts trie.
    bytes receiptValueBytes;

    /// Merkle-Patricia inclusion proof, root → leaf.
    bytes[] mptProof;
}

/**
 * @title  BaseLightClient
 * @notice Per-block receipts-root anchor for **Base** (the Coinbase
 *         OP-Stack L2). Trustless via composition: instead of running
 *         a separate consensus light client, we derive Base's
 *         finality from L1 by piggybacking on the existing
 *         {EthLightClient}.
 *
 *         Anchoring flow (single block):
 *
 *           1. Caller anchors the relevant L1 block on
 *              {EthLightClient} → L1 receiptsRoot becomes available.
 *           2. Caller submits an MPT proof of the
 *              `DisputeGameCreated(disputeProxy, gameType, rootClaim)`
 *              log emitted by the OP-Stack DisputeGameFactory on L1.
 *           3. Caller submits the Base block header (RLP) + the
 *              `withdrawalStorageRoot` (storage root of Base's
 *              `L2ToL1MessagePasser` predeploy at this block — a
 *              free-form input that the next check binds to the
 *              outputRoot).
 *           4. We RLP-decode the Base header to extract
 *              (parentHash, stateRoot, receiptsRoot, blockNumber)
 *              and recompute:
 *
 *                outputRoot' = keccak256(
 *                    bytes1(0x00)                  // version_byte
 *                    || stateRoot                  // from Base header
 *                    || withdrawalStorageRoot      // user-supplied
 *                    || keccak256(headerRLP)       // Base block hash
 *                )
 *
 *              and require outputRoot' == rootClaim.
 *
 *         **Parent-chain extension** ({anchorBaseBlockChainViaCannon}):
 *         dispute games are emitted at irregular intervals chosen by
 *         the proposer; for an arbitrary user deposit, a matching DGC
 *         won't usually exist for that exact L2 block. To anchor any
 *         deposit block:
 *
 *           1. Anchor a *later* Base block via the standard Cannon
 *              path — that's the "anchor" of the chain.
 *           2. Submit `parentChain[]` = headers from anchor.parentHash
 *              backwards, each verified by `keccak(headerRLP) ==
 *              previousChild.parentHash`. Every header in the walk is
 *              independently anchored.
 *
 *         All headers along the walk become {getReceiptsRoot}-queryable.
 *
 *         **Trust model (v1):** any *created* dispute game's rootClaim
 *         is accepted, without verifying the game resolved in
 *         DEFENDER_WINS state. On Base today this is acceptable
 *         because the proposer is permissioned (Coinbase / Base team
 *         only). Future hardening (status storage proof, finality
 *         delay, game-type whitelist) layers on without changing this
 *         function's shape.
 */
contract BaseLightClient is Ownable, ILightClient {
    /// Cap on parent-chain extension length. ~256 is plenty for any
    /// realistic gap between user deposit and proposer anchor block
    /// (Base produces ~30 blocks/min; anchors typically every few
    /// hours = ~10k blocks). At 256 a user has to wait for an
    /// in-window anchor — sub-9-minute UX. SolidVM's iteration cap
    /// makes a higher value gas-prohibitive.
    uint256 internal constant MAX_PARENT_CHAIN_LEN = 256;

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    /// Wrapped Ethereum L1 light client. We trust whatever it has
    /// already verified.
    EthLightClient public l1LightClient;

    /// OP-Stack DisputeGameFactory address on L1.
    address public disputeGameFactory;

    /// keccak256 of `DisputeGameCreated(address,uint32,bytes32)`.
    /// Constructor-supplied so OP-Stack event-shape tweaks don't
    /// require a redeploy.
    bytes32 public disputeGameCreatedSig;

    /// Anchored Base receipts roots, keyed by L2 block number.
    /// bytes32(0) means "not yet anchored".
    mapping(uint256 => bytes32) internal anchoredReceiptsRoot;

    /// Anchored bool flag — distinct from receiptsRoot != 0 to
    /// preserve the same "isAnchored vs zero hash" semantics
    /// EthLightClient established.
    mapping(uint256 => bool) internal anchoredFlag;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event BaseBlockAnchored(
        uint256 indexed l2BlockNumber,
        bytes32 receiptsRoot,
        bytes32 outputRoot,
        uint256 l1BlockNumber
    );
    /// Emitted once per ancestor anchored via parent-chain extension.
    event BaseBlockExtended(
        uint256 indexed l2BlockNumber,
        bytes32 receiptsRoot
    );
    event L1LightClientUpdated(address oldClient, address newClient);
    event DisputeGameFactoryUpdated(address oldFactory, address newFactory);
    event DisputeGameCreatedSigUpdated(bytes32 oldSig, bytes32 newSig);

    // ─────────────────────────────────────────────────────────────────
    // Construction & admin
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Constructor only sets the owner — all chain-specific state
     *      goes through {initialize} so the contract can be deployed
     *      behind a {Proxy}. See {EthBridgeIn} for the same pattern.
     */
    constructor(address owner_) Ownable(owner_) { }

    /**
     * @notice Configure L1 light client + DisputeGameFactory + DGC sig.
     *         Called once by the proxy admin after deploy.
     *
     *         `l1LightClient_` is `address` rather than `EthLightClient`
     *         because SolidVM's JSON-RPC ABI doesn't know how to encode
     *         contract-typed args; we cast on assignment.
     */
    function initialize(
        address l1LightClient_,
        address disputeGameFactory_,
        bytes32 disputeGameCreatedSig_
    ) external onlyOwner {
        require(l1LightClient_ != address(0), "BaseLightClient: l1 zero");
        require(disputeGameFactory_ != address(0), "BaseLightClient: factory zero");
        require(disputeGameCreatedSig_ != bytes32(0), "BaseLightClient: sig zero");
        l1LightClient = EthLightClient(l1LightClient_);
        disputeGameFactory = disputeGameFactory_;
        disputeGameCreatedSig = disputeGameCreatedSig_;
    }

    function setL1LightClient(EthLightClient newClient) external onlyOwner {
        require(address(newClient) != address(0), "BaseLightClient: l1 zero");
        address old = address(l1LightClient);
        l1LightClient = newClient;
        emit L1LightClientUpdated(old, address(newClient));
    }

    function setDisputeGameFactory(address newFactory) external onlyOwner {
        require(newFactory != address(0), "BaseLightClient: factory zero");
        address old = disputeGameFactory;
        disputeGameFactory = newFactory;
        emit DisputeGameFactoryUpdated(old, newFactory);
    }

    function setDisputeGameCreatedSig(bytes32 newSig) external onlyOwner {
        require(newSig != bytes32(0), "BaseLightClient: sig zero");
        bytes32 old = disputeGameCreatedSig;
        disputeGameCreatedSig = newSig;
        emit DisputeGameCreatedSigUpdated(old, newSig);
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
     * @notice Anchor a single Base block by verifying an L1-finalized
     *         DisputeGameCreated whose `rootClaim` matches the canonical
     *         OP-Stack outputRoot for that block.
     */
    function anchorBaseBlockViaCannon(
        OutputReceiptProof proof,
        bytes baseHeaderRLP,
        bytes32 withdrawalStorageRoot
    ) external returns (uint256 l2BlockNumber, bytes32 receiptsRoot) {
        bytes32 l1ReceiptsRoot = l1LightClient.getReceiptsRoot(proof.l1BlockNumber);
        require(l1ReceiptsRoot != bytes32(0), "BaseLightClient: l1 block not anchored");

        bytes32 outputRoot = _verifyAndDecodeDisputeGameCreated(l1ReceiptsRoot, proof);

        LightClientShared.BlockHeader memory h = LightClientShared.decodeStandardHeader(baseHeaderRLP);
        bytes32 baseBlockHash = keccak256(baseHeaderRLP);
        bytes32 computed = keccak256(
            abi.encodePacked(
                bytes1(0x00),
                h.stateRoot,
                withdrawalStorageRoot,
                baseBlockHash
            )
        );
        require(computed == outputRoot, "BaseLightClient: outputRoot mismatch");

        _anchor(h.number, h.receiptsRoot);
        emit BaseBlockAnchored(h.number, h.receiptsRoot, outputRoot, proof.l1BlockNumber);
        return (h.number, h.receiptsRoot);
    }

    // ─────────────────────────────────────────────────────────────────
    // Anchor — parent-chain extension
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor a Base block plus an arbitrary stretch of its
     *         ancestors. The first header (`baseHeaderRLP`) is verified
     *         via the standard Cannon path against an L1-finalized
     *         DisputeGameCreated. Each entry of `parentChain[]` is then
     *         verified against the previous header's `parentHash` and
     *         independently anchored.
     *
     *         Use this when the user's deposit block is older than any
     *         dispute game's claimed L2 block — typical case for
     *         freshly-deposited claims, since proposers anchor on their
     *         own cadence (~hours apart on testnet, less on mainnet).
     *
     * @param  proof                    L1 DisputeGameCreated MPT proof.
     * @param  baseHeaderRLP            RLP of the *anchor* Base block
     *                                  (the one bound by rootClaim).
     * @param  withdrawalStorageRoot    Storage root for the anchor block.
     * @param  parentChain              Headers walking back from
     *                                  anchor.parentHash, each in RLP.
     *                                  parentChain[0] = anchor's parent;
     *                                  parentChain[N-1] = oldest ancestor.
     * @return anchorBlockNumber        Anchor block's number (== first
     *                                  anchored block).
     * @return oldestBlockNumber        Number of parentChain[N-1] (== last
     *                                  anchored block in the chain).
     */
    function anchorBaseBlockChainViaCannon(
        OutputReceiptProof proof,
        bytes baseHeaderRLP,
        bytes32 withdrawalStorageRoot,
        bytes[] parentChain
    ) external returns (uint256 anchorBlockNumber, uint256 oldestBlockNumber) {
        require(
            parentChain.length <= MAX_PARENT_CHAIN_LEN,
            "BaseLightClient: parent chain too long"
        );

        // ── 1. Anchor the head of the chain (standard Cannon path).
        bytes32 l1ReceiptsRoot = l1LightClient.getReceiptsRoot(proof.l1BlockNumber);
        require(l1ReceiptsRoot != bytes32(0), "BaseLightClient: l1 block not anchored");

        bytes32 outputRoot = _verifyAndDecodeDisputeGameCreated(l1ReceiptsRoot, proof);

        LightClientShared.BlockHeader memory anchor = LightClientShared.decodeStandardHeader(baseHeaderRLP);
        bytes32 anchorBlockHash = keccak256(baseHeaderRLP);
        bytes32 computed = keccak256(
            abi.encodePacked(
                bytes1(0x00),
                anchor.stateRoot,
                withdrawalStorageRoot,
                anchorBlockHash
            )
        );
        require(computed == outputRoot, "BaseLightClient: outputRoot mismatch");

        _anchor(anchor.number, anchor.receiptsRoot);
        emit BaseBlockAnchored(anchor.number, anchor.receiptsRoot, outputRoot, proof.l1BlockNumber);

        anchorBlockNumber = anchor.number;

        // ── 2. Walk parents via the shared helper. Each entry's keccak
        //       must equal the previous child's parentHash; each is
        //       independently anchored via the `_anchorFromShared`
        //       self-only callback below.
        oldestBlockNumber = LightClientShared.verifyAndAnchorParentChain(
            anchor,
            parentChain,
            address(this),
            "_anchorFromShared"
        );
    }

    /**
     * @dev Library callback. {LightClientShared.verifyAndAnchorParentChain}
     *      reaches back into us to record each verified parent.
     *      The self-only guard is what keeps this from being a public
     *      "anchor anything" footgun: the library is compiled-in to
     *      this contract, so when *it* invokes `address(this).call(...)`,
     *      `msg.sender == address(this)` holds. No external caller can
     *      satisfy that.
     */
    function _anchorFromShared(uint256 blockNumber, bytes32 receiptsRoot) external {
        require(msg.sender == address(this), "BaseLightClient: self-only");
        _anchor(blockNumber, receiptsRoot);
        emit BaseBlockExtended(blockNumber, receiptsRoot);
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
                "BaseLightClient: receiptsRoot conflict on re-anchor"
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
     * @dev MPT-prove the L1 receipt and decode rootClaim from a
     *      DisputeGameCreated log. Topics layout:
     *
     *        topic[0] = sig
     *        topic[1] = disputeProxy   (address, padded to bytes32)
     *        topic[2] = gameType       (uint32, padded to bytes32)
     *        topic[3] = rootClaim      (the L2 outputRoot we want)
     */
    function _verifyAndDecodeDisputeGameCreated(
        bytes32 l1ReceiptsRoot,
        OutputReceiptProof proof
    ) private view returns (bytes32 outputRoot) {
        bytes mptKey = LightClientShared.rlpUint(proof.txIndex);
        require(
            MPTProof.verifyInclusion(l1ReceiptsRoot, mptKey, proof.receiptValueBytes, proof.mptProof),
            "BaseLightClient: MPT proof failed"
        );

        bytes receiptRlp = LightClientShared.stripTypedTxPrefix(proof.receiptValueBytes);
        bytes[] receiptFields = RLPDecode.decodeList(receiptRlp);
        require(receiptFields.length == 4, "BaseLightClient: receipt must be 4-field list");

        bytes[] receiptLogs = RLPDecode.decodeList(receiptFields[3]);
        require(proof.logIndex < receiptLogs.length, "BaseLightClient: logIndex out of range");

        bytes[] logFields = RLPDecode.decodeList(receiptLogs[proof.logIndex]);
        require(logFields.length == 3, "BaseLightClient: log must be 3-field list");

        address logAddr = RLPDecode.decodeAddress(logFields[0]);
        require(logAddr == disputeGameFactory, "BaseLightClient: log not from factory");

        bytes[] topics = RLPDecode.decodeList(logFields[1]);
        require(topics.length == 4, "BaseLightClient: expected 4 topics");
        require(
            RLPDecode.decodeBytes32(topics[0]) == disputeGameCreatedSig,
            "BaseLightClient: topic[0] not DisputeGameCreated"
        );

        outputRoot = RLPDecode.decodeBytes32(topics[3]);
    }

}
