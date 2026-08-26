import "../../libraries/Bridge/IBridgeMintTarget.sol";
import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/LightClientShared.sol";
import "../../libraries/Bridge/MPTProof.sol";
import "../../libraries/Bridge/RLPDecode.sol";
import "../../abstract/ERC20/access/Ownable.sol";
import "../../abstract/ERC20/IERC20.sol";

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
    /// Most the depositor is willing to leave a fast-fill LP for advancing
    /// funds before the source block finalises. Zero on V1 router logs.
    uint256 maxFee;
}

/**
 * @notice A fast fill: an LP paid the recipient out of its own funds before
 *         the deposit's source block finalised, in exchange for keeping up to
 *         `maxFee` when the deposit is finally proven.
 *
 *         Recorded in full because the claim has to check the fill against the
 *         PROVEN deposit -- an LP that pays the wrong recipient, the wrong
 *         token, or too little is simply not reimbursed, and the real
 *         recipient is credited as though no fill had happened.
 */
struct Fill {
    address lp;
    address recipient;
    address stratoToken;
    uint256 paid;
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

    /// Fast fills, keyed by the same depositKey as {processed}. `record` so
    /// SolidVM indexes this struct-valued mapping into Cirrus -- without it
    /// the collection is silently absent and no consumer can read fill state.
    mapping(bytes32 => Fill) public record fills;

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

    /// An LP advanced funds to the recipient ahead of finality.
    event FastFilled(
        bytes32 indexed depositKey,
        address indexed lp,
        address indexed recipient,
        address stratoToken,
        uint256 paid
    );

    /// A proven claim reimbursed the LP that had fast-filled it.
    event FastFillReimbursed(
        bytes32 indexed depositKey,
        address indexed lp,
        uint256 amount,
        uint256 paid,
        uint256 maxFee
    );

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

    /**
     * @dev Constructor only sets the owner — all chain-specific state is
     *      configured via {initialize}, which the proxy calls once after
     *      deployment. This split is what lets us deploy the contract
     *      behind a {Proxy}: the proxy holds storage, the logic
     *      contract holds code, and the constructor running on the
     *      logic contract has no business state to set.
     *
     *      Direct (non-proxy) deploys still work — call {initialize}
     *      yourself right after construction. SolidVM tests use that
     *      pattern.
     */
    constructor(address owner_) Ownable(owner_) { }

    /**
     * @notice Configure the chain-specific bridge-in state. Called
     *         once by the proxy admin (or by the deployer for direct
     *         deploys) immediately after construction.
     *
     *         `lightClient_` is `address` rather than `ILightClient`
     *         because SolidVM's JSON-RPC ABI doesn't know how to
     *         encode interface-typed args; we cast on assignment.
     *
     *         Calling twice is permitted but discouraged: it's
     *         equivalent to invoking the four individual setters
     *         atomically. For per-field updates, prefer
     *         {setLightClient} / {setDepositRouter} / {setDepositRoutedSig}.
     */
    function initialize(
        address lightClient_,
        uint256 srcChainId_,
        address depositRouter_,
        bytes32 depositRoutedSig_
    ) external onlyOwner {
        require(lightClient_ != address(0), "EthBridgeIn: lightClient zero");
        require(depositRouter_ != address(0), "EthBridgeIn: router zero");
        require(depositRoutedSig_ != bytes32(0), "EthBridgeIn: sig zero");
        lightClient = ILightClient(lightClient_);
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
    // Permissionless: fast fill
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Advance funds to a deposit's recipient before its source block
     *         has finalised, in exchange for being reimbursed the full deposit
     *         once it is proven.
     *
     *         Permissionless and unverified on purpose. Nothing here proves the
     *         deposit exists -- the LP asserts it does and wears the loss if it
     *         never finalises or differs from what was filled. The bridge is
     *         never at risk: it still pays out exactly once, against a proven
     *         log, and only redirects that payout to an LP whose fill MATCHES
     *         the proven deposit.
     *
     *         The transfer runs through this contract so the fill is atomic --
     *         either the recipient is paid and the LP recorded, or neither.
     *         An LP that pays out-of-band records nothing and is not reimbursed.
     *
     * @param depositKey  keccak256(abi.encode(srcChainId, blockNumber, txIndex, logIndex)).
     * @param recipient   Must equal the deposit's stratoRecipient or the fill
     *                    is ignored at claim time.
     * @param stratoToken Must equal the deposit's targetStratoToken.
     * @param payAmount   Transferred to `recipient` now. Reimbursement requires
     *                    payAmount + maxFee >= the proven amount.
     */
    function fastFill(
        bytes32 depositKey,
        address recipient,
        address stratoToken,
        uint256 payAmount
    ) external {
        require(recipient != address(0), "EthBridgeIn: zero recipient");
        require(stratoToken != address(0), "EthBridgeIn: zero strato token");
        require(payAmount > 0, "EthBridgeIn: zero pay amount");
        require(!processed[depositKey], "EthBridgeIn: already claimed");
        require(fills[depositKey].lp == address(0), "EthBridgeIn: already filled");

        // Record before the external call so a token whose transferFrom
        // re-enters cannot find an unfilled slot.
        fills[depositKey] = Fill(msg.sender, recipient, stratoToken, payAmount);

        require(
            IERC20(stratoToken).transferFrom(msg.sender, recipient, payAmount),
            "EthBridgeIn: transferFrom failed"
        );

        emit FastFilled(depositKey, msg.sender, recipient, stratoToken, payAmount);
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
        bytes mptKey = LightClientShared.rlpUint(txIndex);
        require(
            MPTProof.verifyInclusion(receiptsRoot, mptKey, receiptValueBytes, mptProof),
            "EthBridgeIn: MPT proof failed"
        );

        // 3. Strip EIP-2718 type-prefix and decode the receipt RLP.
        // We avoid the variable name `log` because SolidVM treats that
        // identifier as a builtin function, so a local of the same
        // name shadows the wrong way.
        bytes receiptRlp = LightClientShared.stripTypedTxPrefix(receiptValueBytes);
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

        // 6. Fast fill takes precedence over everything else: if an LP
        //    already paid this recipient out of its own funds, the payout is
        //    theirs. The fill is only honoured when it MATCHES the proven
        //    deposit -- right recipient, right token, and enough paid that the
        //    depositor's declared maxFee covers the shortfall.
        //
        //    The else-branch matters as much as the if. Without it an attacker
        //    could fill any deposit with dust purely to occupy the slot and
        //    lock the real recipient out forever; instead their dust is a gift
        //    and the recipient is still credited in full.
        //
        //    Compared as `paid + maxFee >= amount` rather than
        //    `paid >= amount - maxFee` so a malformed maxFee cannot underflow.
        address effectiveRecipient = dep.stratoRecipient;
        Fill memory fill = fills[depositKey];
        bool reimbursingLp =
            fill.lp != address(0) &&
            fill.recipient == dep.stratoRecipient &&
            fill.stratoToken == dep.targetStratoToken &&
            fill.paid + dep.maxFee >= dep.amount;

        if (reimbursingLp) {
            effectiveRecipient = fill.lp;
            emit FastFillReimbursed(depositKey, fill.lp, dep.amount, fill.paid, dep.maxFee);
        } else if (assignment.newRecipient != address(0)) {
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
    ) internal view {
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
    function _addressTo32(address a) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(a)));
    }

    /// @dev Cast uint256 to bytes32 (BE; same byte layout).
    function _uint256To32(uint256 v) internal pure returns (bytes32) {
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
        internal
        pure
        returns (ClaimedDeposit memory dep)
    {
        // Indexed addresses arrive as 32-byte big-endian words.
        dep.ethToken         = _addressFromTopic(topics[1]);
        dep.ethSender        = _addressFromTopic(topics[2]);
        dep.stratoRecipient  = _addressFromTopic(topics[3]);

        // V1 routers emit 3 non-indexed words; V2 appends `maxFee`. A given
        // deployment only ever sees one shape (topic[0] is checked against the
        // configured depositRoutedSig), but accepting both means one contract
        // spans a router migration.
        require(
            data.length == 96 || data.length == 128,
            "EthBridgeIn: data must be 96 or 128 bytes"
        );
        dep.amount             = _readUint256(data, 0);
        dep.targetStratoToken  = _readAddress(data, 32);
        dep.depositId          = uint96(_readUint256(data, 64));
        dep.maxFee             = data.length == 128 ? _readUint256(data, 96) : 0;
    }

    /// @dev Topic items in raw log RLP are 32-byte string items. After
    ///      RLPDecode.decodeBytes32, we have a bytes32 with the address
    ///      right-aligned in the low 20 bytes (per EVM topic encoding).
    function _addressFromTopic(bytes topicRlp) internal pure returns (address) {
        bytes32 raw = RLPDecode.decodeBytes32(topicRlp);
        return address(uint160(uint256(raw)));
    }

    /// @dev Read a uint256 from `data` at byte offset `off`, big-endian.
    function _readUint256(bytes data, uint256 off) internal pure returns (uint256 v) {
        require(off + 32 <= data.length, "EthBridgeIn: read OOB");
        v = 0;
        for (uint256 i = 0; i < 32; i = i + 1) {
            v = (v << 8) | uint256(uint8(data[off + i]));
        }
    }

    /// @dev Read a right-aligned address from `data` at byte offset `off`
    ///      (an ABI-encoded address word: 12 zero bytes + 20 address bytes).
    function _readAddress(bytes data, uint256 off) internal pure returns (address) {
        return address(uint160(_readUint256(data, off)));
    }
}
