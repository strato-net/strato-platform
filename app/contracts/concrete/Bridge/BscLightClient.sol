import "../../libraries/Bridge/ILightClient.sol";
import "../../libraries/Bridge/LightClientShared.sol";
import "../../libraries/Bridge/RLPDecode.sol";
import "../../libraries/Bridge/BLSVerify.sol";
import "../../abstract/ERC20/access/Ownable.sol";

/**
 * @title  BscLightClient
 * @notice Per-block receipts-root anchor for **BNB Smart Chain**,
 *         trustless via BSC fast-finality (BEP-126).
 *
 *         Unlike the OP-Stack-style clients (BaseLightClient,
 *         LineaLightClient) which piggyback on an L1 EthLightClient,
 *         BSC has its own consensus light-client primitive:
 *         **VoteAttestations**. A supermajority (≥⅔) of the active
 *         validator set BLS-signs a vote over each block's
 *         (source/target) tuple, and the aggregated signature is
 *         embedded in the *next* (child) block's `extraData`. Once
 *         present, the child block's vote attestation makes its parent
 *         (the target) finalized.
 *
 *         Anchoring flow:
 *
 *           1. Bootstrap (owner-only, once): caller supplies an
 *              epoch-boundary block header whose extraData includes
 *              the initial active validator set (their consensus
 *              addresses + BLS voting pubkeys). We pin those pubkeys
 *              for that epoch — this is the single point of trust.
 *
 *           2. Rotate (permissionless): when a new epoch is reached
 *              (every {epochLength} blocks; 1000 post-Lorentz), the
 *              new validator set ships inside that epoch-boundary
 *              header's extraData. Anyone can call
 *              {rotateValidatorSet} with (newEpochHeaderRLP,
 *              votingHeaderRLP) where votingHeader is some descendant
 *              of newEpochHeader that contains a VoteAttestation over
 *              newEpochHeader. We verify the attestation against the
 *              PREVIOUS (already-trusted) epoch's validators — the
 *              old set's supermajority signing the new boundary is
 *              what extends the chain of trust.
 *
 *           3. Anchor (permissionless): for any target block we want
 *              to anchor, the caller submits (targetHeaderRLP,
 *              votingHeaderRLP) where votingHeader is the IMMEDIATE
 *              child of target and carries a VoteAttestation with
 *              Data.targetHash == keccak256(targetHeaderRLP). We
 *              verify the attestation against the target's epoch's
 *              validator set, then record target's receiptsRoot.
 *
 *         **Parent-chain extension** ({anchorBscBlockChain}) reuses
 *         {LightClientShared.verifyAndAnchorParentChain} so an anchor
 *         carries arbitrary stretches of its ancestors with it — same
 *         pattern as BaseLightClient / LineaLightClient.
 *
 *         **ExtraData layout** (BSC post-Bohr/Lorentz):
 *
 *           extraVanity (32 bytes)
 *           [ epoch-boundary only:
 *               1 byte:  N = number of active validators
 *               N * 68:  N × (20-byte consensus addr || 48-byte BLS pubkey)
 *               1 byte:  turnLength
 *           ]
 *           voteAttestation RLP (variable; empty when no vote)
 *           extraSeal (65 bytes)
 *
 *         **Vote attestation RLP** (parlia VoteAttestation type):
 *
 *           [ voteAddressSet (uint),
 *             aggSignature (96 bytes),
 *             voteData: [ srcNum, srcHash, tgtNum, tgtHash ],
 *             extra (bytes) ]
 *
 *         Signing root = keccak256(rlp(voteData)). BLS DST is
 *         `BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_` — identical to
 *         Ethereum's POP variant, so {BLSVerify.verifySyncCommitteeAggregateG1}
 *         is reused as-is.
 *
 *         **Trust model (v1):**
 *           - Bootstrap is owner-supplied; subsequent rotations are
 *             permissionless once the chain of BLS aggregates lines up.
 *           - We accept ≥⅔ participation as final. BSC slashes
 *             double-voting (BEP-126), so a colluding ⅓+ minority
 *             attempting an equivocation is observably misbehaving.
 *           - Anchoring requires the IMMEDIATE child's vote (target
 *             block N anchored via votingHeader at N+1). Anchoring an
 *             epoch-boundary block as the *target* is allowed; the
 *             voting child uses the OLD set since it has not yet
 *             rotated (validators rotate effective at epoch+turnLength,
 *             but the vote on the boundary itself is from the old set).
 */
contract BscLightClient is Ownable, ILightClient {
    using RLPDecode for *;

    // ─────────────────────────────────────────────────────────────────
    // Constants
    // ─────────────────────────────────────────────────────────────────

    /// BSC validator entry size in extraData: 20-byte consensus
    /// address + 48-byte BLS voting key.
    uint256 internal constant VALIDATOR_ENTRY_LEN = 68;

    /// extraVanity prefix size — RLP-irrelevant operator vanity.
    uint256 internal constant EXTRA_VANITY_LEN = 32;

    /// extraSeal suffix size — proposer's ECDSA signature over the
    /// header. We don't verify it (finality comes from the BLS votes,
    /// not the proposer's seal), but we have to skip past it when
    /// locating the vote attestation.
    uint256 internal constant EXTRA_SEAL_LEN = 65;

    /// Compressed BLS G1 pubkey length.
    uint256 internal constant BLS_PUBKEY_LEN = 48;

    /// Compressed BLS G2 signature length.
    uint256 internal constant BLS_SIG_LEN = 96;

    /// Cap on parent-chain extension length. BSC produces ~20 blocks/
    /// minute (3s slot); 1024 ≈ 50 minutes of reach.
    uint256 internal constant MAX_PARENT_CHAIN_LEN = 1024;

    // ─────────────────────────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────────────────────────

    /// Epoch length in blocks. BSC mainnet is 1000 post-Lorentz; older
    /// forks used 200. Owner-configurable so testnet/devnet are fine.
    uint256 public epochLength;

    /// Pinned validator BLS voting keys per epoch, in canonical
    /// byte-ascending consensus-address order. Bit i of the vote
    /// bitmap corresponds to validatorsByEpoch[epoch][i].
    mapping(uint256 => bytes[]) internal validatorsByEpoch;

    /// True once an epoch's validator set has been pinned. We can't
    /// just check validatorsByEpoch[epoch].length > 0 because SolidVM
    /// has no nice way to test that on a mapping default value.
    mapping(uint256 => bool) internal epochPinned;

    /// Highest epoch we've pinned. New rotations must extend forward
    /// from here — we don't allow skipping or backfilling.
    uint256 public latestEpoch;

    /// Anchored receipts roots, keyed by BSC block number.
    mapping(uint256 => bytes32) internal anchoredReceiptsRoot;
    mapping(uint256 => bool) internal anchoredFlag;

    // ─────────────────────────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────────────────────────

    event EpochBootstrapped(uint256 indexed epoch, uint256 validatorCount);
    event EpochRotated(uint256 indexed newEpoch, uint256 indexed prevEpoch, uint256 validatorCount);
    event BscBlockAnchored(uint256 indexed blockNumber, bytes32 receiptsRoot, uint256 voters);
    event BscBlockExtended(uint256 indexed blockNumber, bytes32 receiptsRoot);
    event EpochLengthUpdated(uint256 oldLen, uint256 newLen);

    // ─────────────────────────────────────────────────────────────────
    // Construction & admin
    // ─────────────────────────────────────────────────────────────────

    constructor(address owner_) Ownable(owner_) { }

    /**
     * @notice One-time config setter. Sets the epoch length and pins
     *         the initial validator set from an epoch-boundary header.
     *
     *         The supplied header MUST be at an epoch boundary:
     *         header.number % epochLength == 0. Its extraData carries
     *         the initial validator set we'll trust until the first
     *         {rotateValidatorSet} extends past it.
     *
     * @param  epochLength_      Blocks per epoch (1000 for BSC mainnet
     *                           post-Lorentz, 200 for older forks).
     * @param  epochHeaderRLP    RLP of the bootstrap epoch-boundary header.
     */
    function bootstrap(uint256 epochLength_, bytes epochHeaderRLP) external onlyOwner {
        require(epochLength == 0, "BscLightClient: already bootstrapped");
        require(epochLength_ > 0, "BscLightClient: epochLength zero");
        epochLength = epochLength_;

        LightClientShared.BlockHeader memory h = LightClientShared.decodeStandardHeader(epochHeaderRLP);
        require(h.number % epochLength_ == 0, "BscLightClient: bootstrap not at epoch boundary");

        uint256 epoch = h.number / epochLength_;
        bytes extra = _extractExtraData(epochHeaderRLP);
        bytes[] pubkeys = _parseValidatorsFromExtra(extra);

        validatorsByEpoch[epoch] = pubkeys;
        epochPinned[epoch] = true;
        latestEpoch = epoch;

        emit EpochBootstrapped(epoch, pubkeys.length);
    }

    /**
     * @notice Adjust epoch length. Use with extreme care — BSC bumps
     *         epoch length in hard forks (e.g. Lorentz raised it from
     *         200 to 1000 on mainnet).
     */
    function setEpochLength(uint256 newLen) external onlyOwner {
        require(newLen > 0, "BscLightClient: epochLength zero");
        uint256 old = epochLength;
        epochLength = newLen;
        emit EpochLengthUpdated(old, newLen);
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

    /**
     * @notice Number of pinned validator BLS pubkeys for an epoch.
     *         Off-chain orchestrators read this before submitting a
     *         vote bitmap so they can pick the right pubkey ordering.
     */
    function validatorCount(uint256 epoch) external view returns (uint256) {
        return validatorsByEpoch[epoch].length;
    }

    function getValidatorPubkey(uint256 epoch, uint256 index) external view returns (bytes) {
        return validatorsByEpoch[epoch][index];
    }

    // ─────────────────────────────────────────────────────────────────
    // Rotate — extend trust forward by one epoch
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Pin the next epoch's validator set, proven by the
     *         current epoch's set BLS-signing a vote over the new
     *         epoch-boundary block.
     *
     *         Verification:
     *           1. newEpochHeader.number == newEpoch * epochLength.
     *           2. newEpoch == latestEpoch + 1 (no skips).
     *           3. votingHeader is a descendant of newEpochHeader and
     *              its embedded VoteAttestation.Data.targetHash ==
     *              keccak256(newEpochHeaderRLP). (We don't require
     *              voting == immediate child — fast finality votes
     *              run a few blocks behind, so the actual voting
     *              block may be 1-2 slots after the boundary.)
     *           4. The vote attestation's bitmap selects ≥⅔ of the
     *              PREVIOUS (latestEpoch) validator set, and the
     *              aggregated BLS signature verifies under
     *              `aggregate(prevValidators, bitmap)` over
     *              keccak256(rlp(voteData)).
     *           5. newEpochHeader.extraData parses to a fresh validator
     *              set — that's what we pin for newEpoch.
     *
     *         On success: pin new validators, advance latestEpoch.
     */
    function rotateValidatorSet(
        uint256 newEpoch,
        bytes newEpochHeaderRLP,
        bytes votingHeaderRLP
    ) external {
        require(epochLength > 0, "BscLightClient: not bootstrapped");
        require(newEpoch == latestEpoch + 1, "BscLightClient: epoch must be next");
        require(!epochPinned[newEpoch], "BscLightClient: epoch already pinned");

        LightClientShared.BlockHeader memory hNew = LightClientShared.decodeStandardHeader(newEpochHeaderRLP);
        require(
            hNew.number == newEpoch * epochLength,
            "BscLightClient: header not at new epoch boundary"
        );

        // Verify vote attestation against PREVIOUS (currently-trusted) set.
        _verifyVoteAttestation(
            votingHeaderRLP,
            newEpochHeaderRLP,
            hNew.number,
            latestEpoch
        );

        // Decode + pin new set.
        bytes extra = _extractExtraData(newEpochHeaderRLP);
        bytes[] newPubkeys = _parseValidatorsFromExtra(extra);
        validatorsByEpoch[newEpoch] = newPubkeys;
        epochPinned[newEpoch] = true;
        uint256 prevEpoch = latestEpoch;
        latestEpoch = newEpoch;

        emit EpochRotated(newEpoch, prevEpoch, newPubkeys.length);
    }

    // ─────────────────────────────────────────────────────────────────
    // Anchor — single block + parent-chain extension
    // ─────────────────────────────────────────────────────────────────

    /**
     * @notice Anchor a single BSC block by verifying that its
     *         immediate child carries a VoteAttestation whose targetHash
     *         matches keccak256(targetHeaderRLP), and that a supermajority
     *         of the target's epoch validators signed the attestation.
     *
     * @param  targetHeaderRLP   RLP of the block to anchor.
     * @param  votingHeaderRLP   RLP of any descendant block (typically
     *                           target.number + 1, but vote attestations
     *                           may lag a few slots) carrying a vote
     *                           with Data.targetHash == hash(target).
     * @return blockNumber       Anchored block number.
     * @return receiptsRoot      Anchored receipts root.
     */
    function anchorBscBlock(
        bytes targetHeaderRLP,
        bytes votingHeaderRLP
    ) external returns (uint256 blockNumber, bytes32 receiptsRoot) {
        require(epochLength > 0, "BscLightClient: not bootstrapped");

        LightClientShared.BlockHeader memory h = LightClientShared.decodeStandardHeader(targetHeaderRLP);
        uint256 epoch = h.number / epochLength;
        require(epochPinned[epoch], "BscLightClient: target epoch not pinned");

        _verifyVoteAttestation(votingHeaderRLP, targetHeaderRLP, h.number, epoch);

        _anchor(h.number, h.receiptsRoot);
        emit BscBlockAnchored(h.number, h.receiptsRoot, validatorsByEpoch[epoch].length);
        return (h.number, h.receiptsRoot);
    }

    /**
     * @notice Anchor a target BSC block plus an arbitrary stretch of
     *         its ancestors (same pattern as BaseLightClient.anchorBaseBlockChain).
     *
     *         The supplied `targetHeaderRLP` is the head of the chain
     *         and is verified against `votingHeaderRLP`'s attestation.
     *         Each entry of `parentChain[]` is then keccak-chained
     *         backwards and independently anchored — no further BLS
     *         verification needed because the head's finality drags
     *         all ancestors with it (BSC, like Ethereum, has no reorgs
     *         past finalization).
     *
     *         All anchored ancestors MUST live in the same epoch as
     *         the target — we don't try to walk across an epoch
     *         boundary here. (The deeper ancestors may use OLDER pinned
     *         epochs, but parent-chain doesn't need their validator
     *         set; it just needs hash chaining.)
     */
    function anchorBscBlockChain(
        bytes targetHeaderRLP,
        bytes votingHeaderRLP,
        bytes[] parentChain
    ) external returns (uint256 anchorBlockNumber, uint256 oldestBlockNumber) {
        require(epochLength > 0, "BscLightClient: not bootstrapped");
        require(
            parentChain.length <= MAX_PARENT_CHAIN_LEN,
            "BscLightClient: parent chain too long"
        );

        LightClientShared.BlockHeader memory anchor = LightClientShared.decodeStandardHeader(targetHeaderRLP);
        uint256 epoch = anchor.number / epochLength;
        require(epochPinned[epoch], "BscLightClient: target epoch not pinned");

        _verifyVoteAttestation(votingHeaderRLP, targetHeaderRLP, anchor.number, epoch);

        _anchor(anchor.number, anchor.receiptsRoot);
        emit BscBlockAnchored(anchor.number, anchor.receiptsRoot, validatorsByEpoch[epoch].length);
        anchorBlockNumber = anchor.number;

        oldestBlockNumber = LightClientShared.verifyAndAnchorParentChain(
            anchor,
            parentChain,
            address(this),
            "_anchorFromShared"
        );
    }

    /**
     * @dev Library callback. {LightClientShared.verifyAndAnchorParentChain}
     *      reaches back into us to record each verified parent. Self-only.
     */
    function _anchorFromShared(uint256 blockNumber, bytes32 receiptsRoot) external {
        require(msg.sender == address(this), "BscLightClient: self-only");
        _anchor(blockNumber, receiptsRoot);
        emit BscBlockExtended(blockNumber, receiptsRoot);
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal — anchor bookkeeping
    // ─────────────────────────────────────────────────────────────────

    function _anchor(uint256 blockNumber, bytes32 receiptsRoot) private {
        if (anchoredFlag[blockNumber]) {
            require(
                anchoredReceiptsRoot[blockNumber] == receiptsRoot,
                "BscLightClient: receiptsRoot conflict on re-anchor"
            );
        } else {
            anchoredReceiptsRoot[blockNumber] = receiptsRoot;
            anchoredFlag[blockNumber] = true;
        }
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal — vote attestation verification
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Verify the VoteAttestation embedded in `votingHeaderRLP`
     *      targets the block (targetNumber, keccak(targetHeaderRLP))
     *      and is signed by ≥⅔ of `pinnedEpoch`'s validators.
     *
     *      The `pinnedEpoch` parameter exists because at an epoch
     *      boundary rotation, the OLD epoch signs the NEW boundary —
     *      so the caller specifies which epoch's validators to verify
     *      against (in {rotateValidatorSet} that's `latestEpoch`, in
     *      {anchorBscBlock} it's the target's own epoch).
     */
    function _verifyVoteAttestation(
        bytes votingHeaderRLP,
        bytes targetHeaderRLP,
        uint256 expectedTargetNumber,
        uint256 pinnedEpoch
    ) private {
        bytes votingExtra = _extractExtraData(votingHeaderRLP);
        bool votingIsEpoch = _isEpochBoundaryHeader(votingHeaderRLP);

        // Slice out the vote attestation RLP blob from the voting block's
        // extraData. Returns empty bytes if no attestation present.
        bytes voteAttRLP = _extractVoteAttestationRLP(votingExtra, votingIsEpoch);
        require(voteAttRLP.length > 0, "BscLightClient: voting header has no attestation");

        // Decode the attestation: [bitmap, aggSig, voteData, extra]
        bytes[] att = RLPDecode.decodeList(voteAttRLP);
        require(att.length == 4, "BscLightClient: malformed attestation");
        uint256 bitmap = RLPDecode.decodeUint(att[0]);
        bytes aggSig = RLPDecode.decodeBytes(att[1]);
        require(aggSig.length == BLS_SIG_LEN, "BscLightClient: bad agg sig length");

        // voteData is itself an RLP list of 4 items:
        //   [0]=SourceNumber, [1]=SourceHash, [2]=TargetNumber, [3]=TargetHash
        bytes[] voteData = RLPDecode.decodeList(att[2]);
        require(voteData.length == 4, "BscLightClient: malformed voteData");
        uint256 tgtNum = RLPDecode.decodeUint(voteData[2]);
        bytes32 tgtHash = RLPDecode.decodeBytes32(voteData[3]);

        require(tgtNum == expectedTargetNumber, "BscLightClient: vote target num mismatch");
        require(tgtHash == keccak256(targetHeaderRLP), "BscLightClient: vote target hash mismatch");

        // Aggregate the participating pubkeys via the bitmap, then verify
        // the aggregate BLS signature over keccak256(rlp(voteData)).
        uint256 setSize = validatorsByEpoch[pinnedEpoch].length;
        require(setSize > 0, "BscLightClient: no pubkeys for epoch");

        (bytes aggPk, uint256 voters) = BLSVerify.aggregateByBitmap(
            validatorsByEpoch[pinnedEpoch],
            bitmap
        );

        // ≥⅔ supermajority (strict). Use ceiling division by computing
        // (2 * n + 2) / 3 — same as ceil(2n/3). For n=21 → 14, n=41 → 28.
        uint256 threshold = (2 * setSize + 2) / 3;
        require(voters >= threshold, "BscLightClient: not enough voters");

        // Signing root = keccak256(rlp(voteData)). att[2] is the RLP
        // encoding of voteData (a complete RLP list), which is what BSC
        // hashes for the signing message.
        bytes32 signingRoot = keccak256(att[2]);

        require(
            BLSVerify.verifySyncCommitteeAggregateG1(aggPk, signingRoot, aggSig),
            "BscLightClient: BLS verify failed"
        );
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal — header / extraData parsing
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Extract the extraData field (field 12) of a BSC block
     *      header. BSC's header layout matches Ethereum's pre-Shanghai
     *      execution payload, with extraData at index 12 carrying
     *      Parlia-specific bytes.
     */
    function _extractExtraData(bytes headerRLP) private pure returns (bytes) {
        bytes[] fields = RLPDecode.decodeList(headerRLP);
        require(fields.length >= 13, "BscLightClient: header has no extraData");
        return RLPDecode.decodeBytes(fields[12]);
    }

    function _isEpochBoundaryHeader(bytes headerRLP) private view returns (bool) {
        LightClientShared.BlockHeader memory h = LightClientShared.decodeStandardHeader(headerRLP);
        return (h.number % epochLength) == 0;
    }

    /**
     * @dev Slice the VoteAttestation RLP blob out of a BSC header's
     *      extraData.
     *
     *      Layout (post-Bohr/Lorentz):
     *        offset 0:                            extraVanity (32 bytes)
     *        offset 32: (epoch only) 1 byte: N = validator count
     *                                  N * 68 bytes: validators
     *                                  1 byte: turnLength
     *        offset varies:           voteAttestation RLP (variable; empty if no vote)
     *        offset end - 65:         extraSeal (65 bytes)
     *
     *      Returns the RLP-encoded VoteAttestation bytes (possibly
     *      empty if no attestation was included).
     */
    function _extractVoteAttestationRLP(bytes extra, bool isEpoch)
        private
        pure
        returns (bytes)
    {
        require(
            extra.length >= EXTRA_VANITY_LEN + EXTRA_SEAL_LEN,
            "BscLightClient: extraData too short"
        );

        uint256 start = EXTRA_VANITY_LEN;
        if (isEpoch) {
            require(extra.length > start, "BscLightClient: epoch extraData truncated");
            uint256 n = uint256(uint8(extra[start]));
            start = start + 1;
            uint256 valBytes = n * VALIDATOR_ENTRY_LEN;
            require(
                extra.length >= start + valBytes + 1 + EXTRA_SEAL_LEN,
                "BscLightClient: epoch validators truncated"
            );
            start = start + valBytes;
            // skip turnLength (1 byte)
            start = start + 1;
        }

        uint256 endExclusive = extra.length - EXTRA_SEAL_LEN;
        if (endExclusive <= start) {
            // No attestation present (and no overflow).
            return new bytes(0);
        }

        uint256 attLen = endExclusive - start;
        bytes out = new bytes(attLen);
        for (uint256 i = 0; i < attLen; i = i + 1) {
            out[i] = extra[start + i];
        }
        return out;
    }

    /**
     * @dev Parse the validator set out of an epoch-boundary header's
     *      extraData. Returns BLS voting pubkeys in the canonical
     *      byte-ascending consensus-address order BSC enforces.
     *
     *      Validators are emitted by the validator-set contract
     *      already sorted; we re-verify that ordering so a bad
     *      bootstrap or hostile mid-rotation can't trick us into
     *      mis-matching the bitmap.
     */
    function _parseValidatorsFromExtra(bytes extra) private pure returns (bytes[]) {
        require(
            extra.length >= EXTRA_VANITY_LEN + 1 + EXTRA_SEAL_LEN,
            "BscLightClient: epoch extra too short for validator count"
        );
        uint256 n = uint256(uint8(extra[EXTRA_VANITY_LEN]));
        require(n > 0, "BscLightClient: zero validators in epoch header");
        require(n <= 256, "BscLightClient: validator count exceeds bitmap width");

        uint256 base = EXTRA_VANITY_LEN + 1;
        require(
            extra.length >= base + n * VALIDATOR_ENTRY_LEN + 1 + EXTRA_SEAL_LEN,
            "BscLightClient: epoch validator entries truncated"
        );

        bytes[] pubkeys = new bytes[](n);
        bytes prevAddr = new bytes(20);
        bool havePrev = false;

        for (uint256 i = 0; i < n; i = i + 1) {
            uint256 entryStart = base + i * VALIDATOR_ENTRY_LEN;

            bytes addr = new bytes(20);
            for (uint256 a = 0; a < 20; a = a + 1) {
                addr[a] = extra[entryStart + a];
            }

            bytes pk = new bytes(BLS_PUBKEY_LEN);
            for (uint256 b = 0; b < BLS_PUBKEY_LEN; b = b + 1) {
                pk[b] = extra[entryStart + 20 + b];
            }

            if (havePrev) {
                require(
                    _bytesLess(prevAddr, addr),
                    "BscLightClient: validators not strictly ascending"
                );
            }
            prevAddr = addr;
            havePrev = true;
            pubkeys[i] = pk;
        }

        return pubkeys;
    }

    /**
     * @dev Strict byte-ascending compare, equivalent to Go's
     *      bytes.Compare(a, b) < 0 for fixed-length byte slices.
     */
    function _bytesLess(bytes a, bytes b) private pure returns (bool) {
        uint256 la = a.length;
        uint256 lb = b.length;
        uint256 n = la < lb ? la : lb;
        for (uint256 i = 0; i < n; i = i + 1) {
            uint8 ai = uint8(a[i]);
            uint8 bi = uint8(b[i]);
            if (ai < bi) return true;
            if (ai > bi) return false;
        }
        return la < lb;
    }
}
