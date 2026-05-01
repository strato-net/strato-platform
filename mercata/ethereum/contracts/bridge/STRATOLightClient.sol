// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

import {STRATOEventDecoder} from "./lib/STRATOEventDecoder.sol";

/**
 * @title STRATOLightClient
 * @notice On-chain light client for the STRATO consensus layer. Tracks the
 *         current validator set and the receipts roots of finalized STRATO
 *         blocks so the BridgeVault can verify withdrawal proofs.
 *
 * Consensus model (per the Phase 0 spec, §2-§5):
 *
 *   - STRATO uses BFT-style finality with deterministic commit signatures.
 *   - A header is accepted once at least ceil(2/3) of the currently authorized
 *     validators have signed the canonical commit message.
 *   - Validator-set rotations are carried inside header fields and signed by
 *     the OUTGOING set; this client enforces sequential rotation so a caller
 *     cannot skip past a rotation header.
 *
 * Trust assumption: at every block height, at least 2/3 of the active
 * validators are honest. Same as STRATO's own consensus.
 */
contract STRATOLightClient is
    Initializable,
    OwnableUpgradeable,
    UUPSUpgradeable
{
    // ============ Custom Errors ============

    error EmptyValidatorSet();
    error HeaderNotInOrder();
    error ValidatorSetMismatch();
    error InvalidSignature();
    error DuplicateSigner();
    error InsufficientQuorum();
    error InvalidHeaderEncoding();
    error UnsupportedHeaderVersion();
    error ValidatorAlreadyPresent();
    error ValidatorNotPresent();

    // ============ State Variables ============

    /// @notice Highest STRATO block number whose header has been accepted.
    uint256 public tip;

    /// @notice Membership map of the currently authorized validators.
    mapping(address => bool) public isValidator;

    /// @notice Number of currently authorized validators (cardinality of
    ///         `isValidator`). Used to compute the BFT quorum.
    uint256 public validatorCount;

    /// @notice Commitment to the current validator set: keccak256 of the
    ///         sorted (ascending) addresses concatenated. Allows a callable
    ///         "sanity match" against `header.currentValidators` without
    ///         iterating the set on every header submission.
    bytes32 public validatorSetCommitment;

    /// @notice Sparse map of stored receipts roots, keyed by block number.
    ///         Only blocks the BridgeVault has been asked to verify against
    ///         have entries here; the rest are pruned to avoid unbounded state.
    mapping(uint256 => bytes32) private _receiptsRootByBlock;

    /// @notice Marker that distinguishes "block hasn't been submitted" from
    ///         "block was submitted with the empty-trie sentinel". Without
    ///         this, a Receipt root of bytes32(0) would be ambiguous.
    mapping(uint256 => bool) private _hasReceiptsRoot;

    // ============ Events ============

    event HeaderSubmitted(
        uint256 indexed blockNumber,
        bytes32 indexed blockHash,
        bytes32 receiptsRoot,
        uint256 newTip
    );

    event ValidatorSetRotated(
        uint256 indexed atBlockNumber,
        address[] added,
        address[] removed,
        uint256 newCount,
        bytes32 newCommitment
    );

    // ============ Constants ============

    /// @notice IBFT commit-message domain separator. Validator commit
    ///         signatures sign keccak256(blockHash || COMMIT_DOMAIN).
    bytes1 internal constant COMMIT_DOMAIN = 0x02;

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /**
     * @param owner_ Owner of the upgrade rights.
     * @param genesisBlockNumber Block number to start tracking from. Headers
     *                           accepted later must satisfy `number > tip`.
     * @param genesisValidators Initial authorized validator set, in sorted
     *                          (ascending) order. Sort is checked.
     */
    function initialize(
        address owner_,
        uint256 genesisBlockNumber,
        address[] calldata genesisValidators
    ) public initializer {
        require(owner_ != address(0), "owner zero");
        if (genesisValidators.length == 0) revert EmptyValidatorSet();

        __Ownable_init(owner_);
        __UUPSUpgradeable_init();

        // Install the genesis validator set. Caller must pass a sorted,
        // strictly-ascending list: enforces uniqueness for free and lets us
        // compute the canonical commitment without an extra sort.
        address prev = address(0);
        for (uint256 i; i < genesisValidators.length; ++i) {
            address v = genesisValidators[i];
            require(v > prev, "validators not strictly ascending");
            isValidator[v] = true;
            prev = v;
        }
        validatorCount = genesisValidators.length;
        validatorSetCommitment = _commitToSortedSet(genesisValidators);
        tip = genesisBlockNumber;
    }

    // ============ External: header submission ============

    /**
     * @notice Submit a finalized STRATO header. Anyone can call; the proof is
     *         in the bytes (signatures), so unauthorized callers can't lie.
     *
     * @param headerRLP RLP-encoded V2 header with the `signatures` field
     *                  emptied -- exactly the bytes the validators signed.
     *                  Must have `header.currentValidators` matching the
     *                  client's tracked set, otherwise the caller is trying
     *                  to skip a rotation and gets rejected.
     * @param signatures Concatenated 65-byte ECDSA signatures (R || S || V),
     *                   one per signing validator. V is 0 or 1; this client
     *                   adds 27 internally for `ecrecover`.
     */
    function submitHeader(bytes calldata headerRLP, bytes[] calldata signatures)
        external
    {
        STRATOEventDecoder.DecodedHeader memory h = STRATOEventDecoder.decodeHeader(headerRLP);
        if (h.number <= tip) revert HeaderNotInOrder();

        // Skip-safety check: header's currentValidators must hash to the same
        // commitment we currently track. If a rotation happened between tip
        // and h.number that the caller didn't walk through, this fails and
        // the caller has to submit the rotation header(s) first.
        if (
            keccak256(abi.encodePacked(h.currentValidators)) !=
            validatorSetCommitment
        ) revert ValidatorSetMismatch();

        bytes32 blockHash = keccak256(headerRLP);
        bytes32 commitMsg = keccak256(abi.encodePacked(blockHash, COMMIT_DOMAIN));

        _verifyQuorum(commitMsg, signatures);

        // Record the receipts root before applying the validator-set diff so
        // that `getReceiptsRoot(h.number)` works even for the rotation block.
        _receiptsRootByBlock[h.number] = h.receiptsRoot;
        _hasReceiptsRoot[h.number] = true;

        if (h.newValidators.length != 0 || h.removedValidators.length != 0) {
            // We have the sorted pre-diff list right here in h.currentValidators
            // (it's what we just commitment-checked), so we can compute the
            // new commitment exactly without an off-chain witness.
            _applyValidatorDiff(
                h.number,
                h.currentValidators,
                h.newValidators,
                h.removedValidators
            );
        }

        tip = h.number;
        emit HeaderSubmitted(h.number, blockHash, h.receiptsRoot, h.number);
    }

    // ============ External: views ============

    /**
     * @notice Returns the receipts root that was committed to by the STRATO
     *         block at `blockNumber`, or reverts if no header for that block
     *         has been submitted.
     */
    function getReceiptsRoot(uint256 blockNumber) external view returns (bytes32) {
        require(_hasReceiptsRoot[blockNumber], "receipts root not stored");
        return _receiptsRootByBlock[blockNumber];
    }

    function hasReceiptsRoot(uint256 blockNumber) external view returns (bool) {
        return _hasReceiptsRoot[blockNumber];
    }

    function quorumSize() public view returns (uint256) {
        // floor(2N/3) + 1, mirroring STRATO's own check (3*votes > 2*N).
        return (2 * validatorCount) / 3 + 1;
    }

    // ============ Internal: signature verification ============

    /// @dev Recovers each signer, requires distinctness and quorum membership.
    function _verifyQuorum(bytes32 commitMsg, bytes[] calldata signatures)
        internal
        view
    {
        uint256 q = quorumSize();
        if (signatures.length < q) revert InsufficientQuorum();

        // Track distinct recovered addresses without dynamic memory allocation:
        // we rely on the caller passing already-distinct sorted signatures and
        // confirm strictly-ascending recovery order. Cheaper than a hash set
        // and forces clients to canonicalize their submission.
        address prev = address(0);
        uint256 distinctValid;
        for (uint256 i; i < signatures.length; ++i) {
            address signer = _recover(commitMsg, signatures[i]);
            if (signer == address(0)) revert InvalidSignature();
            if (signer <= prev) revert DuplicateSigner();
            prev = signer;
            if (isValidator[signer]) {
                unchecked {
                    ++distinctValid;
                }
            }
        }
        if (distinctValid < q) revert InsufficientQuorum();
    }

    function _recover(bytes32 hash_, bytes calldata sig)
        internal
        pure
        returns (address)
    {
        if (sig.length != 65) revert InvalidSignature();
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        // STRATO stores V as 0 or 1; ecrecover expects 27 or 28.
        if (v < 2) v += 27;
        if (v != 27 && v != 28) revert InvalidSignature();
        return ecrecover(hash_, v, r, s);
    }

    // ============ Internal: validator set ============

    function _applyValidatorDiff(
        uint256 atBlockNumber,
        address[] memory currentSorted,
        address[] memory added,
        address[] memory removed
    ) internal {
        // Update the on-chain membership map.
        for (uint256 i; i < added.length; ++i) {
            address v = added[i];
            if (isValidator[v]) revert ValidatorAlreadyPresent();
            isValidator[v] = true;
        }
        for (uint256 i; i < removed.length; ++i) {
            address v = removed[i];
            if (!isValidator[v]) revert ValidatorNotPresent();
            isValidator[v] = false;
        }

        validatorCount = validatorCount + added.length - removed.length;

        // Recompute the commitment from the pre-diff sorted list (passed in
        // as currentSorted -- we already commitment-checked it in submitHeader)
        // plus the diff. Strict-ascending order is preserved by the
        // membership-map updates we just did, so we can emit the new
        // commitment from the same data.
        validatorSetCommitment = _commitWithDiff(currentSorted, added, removed);

        emit ValidatorSetRotated(
            atBlockNumber,
            added,
            removed,
            validatorCount,
            validatorSetCommitment
        );
    }

    /**
     * @dev Compute keccak256 over the post-diff sorted validator set.
     *
     *      Strategy: build a working list of (currentSorted ∖ removed),
     *      preserving order; then merge in `added` (which we sort first if
     *      needed, but the protocol convention is sorted-ascending). Linear
     *      in |currentSorted| + |added|, with an O(|currentSorted| · |removed|)
     *      worst case for the removal pass. Validator counts stay small in
     *      practice (~14), so this is well under any gas cliff.
     */
    function _commitWithDiff(
        address[] memory currentSorted,
        address[] memory added,
        address[] memory removed
    ) internal pure returns (bytes32) {
        // 1. Filter out removed validators from currentSorted.
        address[] memory kept = new address[](currentSorted.length);
        uint256 keptLen;
        for (uint256 i; i < currentSorted.length; ++i) {
            address v = currentSorted[i];
            bool isRemoved;
            for (uint256 j; j < removed.length; ++j) {
                if (removed[j] == v) {
                    isRemoved = true;
                    break;
                }
            }
            if (!isRemoved) {
                kept[keptLen++] = v;
            }
        }
        // Reject removals that didn't actually land (consistency with the
        // membership-map updates above; if `removed` references unknowns we
        // would've reverted there, but defense-in-depth).
        if (keptLen + removed.length != currentSorted.length) {
            revert ValidatorNotPresent();
        }

        // 2. Merge `added` into `kept` in ascending order. `added` MUST be
        //    sorted ascending (protocol convention) and disjoint from `kept`.
        address[] memory merged = new address[](keptLen + added.length);
        uint256 ki;
        uint256 ai;
        uint256 mi;
        // Confirm `added` is strictly ascending.
        address prev;
        for (uint256 a; a < added.length; ++a) {
            require(added[a] > prev || a == 0, "added not ascending");
            prev = added[a];
        }
        while (ki < keptLen && ai < added.length) {
            if (kept[ki] < added[ai]) {
                merged[mi++] = kept[ki++];
            } else if (kept[ki] > added[ai]) {
                merged[mi++] = added[ai++];
            } else {
                // Duplicate -- the membership-map check above would've caught
                // this, but be loud anyway.
                revert ValidatorAlreadyPresent();
            }
        }
        while (ki < keptLen) merged[mi++] = kept[ki++];
        while (ai < added.length) merged[mi++] = added[ai++];

        return keccak256(abi.encodePacked(merged));
    }

    function _commitToSortedSet(address[] calldata sorted)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(sorted));
    }

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
