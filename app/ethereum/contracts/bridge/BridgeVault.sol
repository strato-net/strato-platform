// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./STRATOLightClient.sol";
import {MerklePatricia} from "./lib/MerklePatricia.sol";
import {STRATOEventDecoder} from "./lib/STRATOEventDecoder.sol";

/**
 * @title BridgeVault
 * @notice Ethereum-side counterpart of STRATO's MercataBridge for the
 *         proof-based withdrawal flow (proof-based-withdrawals-phase0.md, §7-§8).
 *
 *         Holds the locked balances of bridged-in assets and releases them
 *         when presented with a verified proof of a STRATO-side
 *         `Withdrawal` (small / instant) or `WithdrawalRequested` (large /
 *         admin-gated) event.
 *
 * Trust boundaries:
 *   - Anyone can call `claimWithdrawal` or `submitProof` -- the proof IS the
 *     authorization.
 *   - The admin multisig can ONLY approve or reject already-proven large
 *     withdrawals. It cannot release funds without a proof. A compromised
 *     multisig is therefore inert: it can DoS large withdrawals (by
 *     rejecting), but it cannot drain the vault.
 *   - The light client's tracked validator set is the upstream root of trust;
 *     the vault delegates "is this STRATO state real" to it.
 */
contract BridgeVault is
    Initializable,
    OwnableUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    // ============ Errors ============

    error InvalidAddress();
    error NonceAlreadyConsumed();
    error NonceNotAwaitingApproval();
    error AmountBelowInstantThreshold();
    error AmountAboveInstantThreshold();
    error WrongChainId();
    error WrongStratoVault();
    error NotAdmin();
    error EthTransferFailed();
    error ProofVerificationFailed();
    error UnknownEvent();
    /// @dev Hot-path event arrived without a non-zero seq (legacy 8-arg log).
    ///      Sequenced claims require the post-fork 10-arg event layout.
    error UnsequencedHotEvent();
    /// @dev Submitted seq is below the vault's nextSeqToProcess. The earlier
    ///      seq was already drained, so this proof is either a replay or a
    ///      forgery -- either way, reject.
    error SequenceAlreadyProcessed();
    /// @dev Caller asked processQueue to do work but the queue isn't ready
    ///      to advance (next slot is empty). Returns gracefully via revert
    ///      so wallet callers aren't surprised by a "succeeded but did
    ///      nothing" tx.
    error QueueEmpty();

    // ============ State machine ============

    enum NonceState {
        Unused, // 0: never seen
        Claimed, // 1: terminal -- funds released
        AwaitingApproval, // 2: large-withdrawal proof submitted, admin must decide
        Rejected, // 3: terminal -- admin rejected
        Queued // 4: hot-path proof verified but blocked behind earlier sequences
    }

    /// @notice Status of each (blockNumber, txIndex, logIndex)-derived nonce.
    mapping(bytes32 => NonceState) public nonceState;

    /// @notice For pending large withdrawals: snapshot of the proven payload
    ///         so admin approval can release without reverifying the proof.
    struct PendingWithdrawal {
        address externalToken; // address(0) == ETH
        address externalRecipient;
        uint256 externalTokenAmount;
    }
    mapping(bytes32 => PendingWithdrawal) public pending;

    /// @notice Snapshot of a hot-path claim that arrived out of order. Stored
    ///         keyed by `seq` so the drain loop can pop them by incrementing
    ///         `nextSeqToProcess`. The nonce is included so we can flip
    ///         `nonceState[nonce]` from Queued to Claimed atomically when
    ///         the slot is drained.
    struct QueuedClaim {
        bytes32 nonce;
        address externalToken;
        address externalRecipient;
        uint256 externalTokenAmount;
    }

    /// @notice DEPRECATED. Release is no longer ordered, so nothing is ever
    ///         queued. Retained only so the storage layout is unchanged
    ///         across the upgrade that removed sequencing; do not read it.
    mapping(uint256 => QueuedClaim) public queuedClaims;

    /// @notice DEPRECATED. Was the next expected hot-withdrawal sequence.
    ///         Release is no longer ordered, so this never advances and is
    ///         meaningless -- off-chain callers must not gate on it. Retained
    ///         only to keep the storage layout stable across the upgrade.
    uint256 public nextSeqToProcess;

    /// @notice DEPRECATED alongside ordering. `claimWithdrawal` no longer
    ///         drains anything; only the migration-only `processQueue` uses
    ///         a bound, and it takes one from its caller.
    uint256 public constant MAX_DRAIN_PER_CLAIM = 16;

    // ============ Configuration ============

    /// @notice Threshold below which a `Withdrawal` event auto-releases funds
    ///         and at/above which a `WithdrawalRequested` event is required.
    ///         Keyed by external token address (`address(0)` for ETH).
    ///
    ///         Must mirror the threshold used on the STRATO side. Mismatches
    ///         are a UX bug, not a fund-safety risk: the vault enforces its
    ///         OWN threshold on what it'll auto-release.
    mapping(address => uint256) public instantThreshold;

    /// @notice Light client used to look up STRATO receipts roots.
    STRATOLightClient public lightClient;

    /// @notice Multisig authorized to approve/reject large withdrawals.
    address public adminMultisig;

    /// @notice The address of the STRATO-side bridge contract whose events
    ///         are authoritative. Logs from any other contract are ignored.
    address public stratoVaultAddress;

    /// @notice Chain identifier this vault represents to the STRATO side.
    ///         Withdrawals tagged for a different chain are rejected.
    uint256 public externalChainId;

    /// @notice keccak256 hash of the canonical event names. Cheaper to
    ///         compare 32-byte hashes than full strings on every claim.
    bytes32 public constant WITHDRAWAL_EVENT_HASH = keccak256("Withdrawal");
    bytes32 public constant WITHDRAWAL_REQUESTED_EVENT_HASH =
        keccak256("WithdrawalRequested");

    // ============ Events ============

    event WithdrawalClaimed(
        bytes32 indexed nonce,
        address indexed externalToken,
        address indexed externalRecipient,
        uint256 externalTokenAmount
    );

    event WithdrawalAwaitingApproval(
        bytes32 indexed nonce,
        address indexed externalToken,
        address indexed externalRecipient,
        uint256 externalTokenAmount
    );

    event WithdrawalApproved(bytes32 indexed nonce);
    event WithdrawalRejected(bytes32 indexed nonce, string reason);

    /// @notice A hot-path claim was verified but is blocked behind earlier
    ///         sequence numbers. Funds remain in the vault until predecessors
    ///         arrive and the queue drains forward.
    event WithdrawalQueued(
        bytes32 indexed nonce,
        uint256 indexed seq,
        address indexed externalToken,
        address externalRecipient,
        uint256 externalTokenAmount
    );

    /// @notice Emitted whenever `nextSeqToProcess` advances, regardless of
    ///         whether the claim came in fresh or was popped from the queue.
    event SequenceAdvanced(uint256 indexed newNextSeq);

    event InstantThresholdUpdated(address indexed externalToken, uint256 newThreshold);
    event AdminMultisigUpdated(address indexed oldAdmin, address indexed newAdmin);
    event LightClientUpdated(address indexed oldClient, address indexed newClient);
    event StratoVaultAddressUpdated(address indexed oldAddr, address indexed newAddr);

    // ============ Modifiers ============

    modifier onlyAdmin() {
        if (msg.sender != adminMultisig) revert NotAdmin();
        _;
    }

    // ============ Initialization ============

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(
        address owner_,
        address adminMultisig_,
        address lightClient_,
        address stratoVaultAddress_,
        uint256 externalChainId_
    ) public initializer {
        if (
            owner_ == address(0) ||
            adminMultisig_ == address(0) ||
            lightClient_ == address(0) ||
            stratoVaultAddress_ == address(0)
        ) revert InvalidAddress();

        __Ownable_init(owner_);
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        adminMultisig = adminMultisig_;
        lightClient = STRATOLightClient(lightClient_);
        stratoVaultAddress = stratoVaultAddress_;
        externalChainId = externalChainId_;
    }

    // ============ Withdrawal entry points ============

    /**
     * @notice Claim a small (below threshold) withdrawal. Verifies the
     *         STRATO-side `Withdrawal` event proof and releases funds in one
     *         transaction.
     *
     * @param blockNumber STRATO block that emitted the event.
     * @param txIndex Transaction position in that block (0-based).
     * @param logIndex Log position within the transaction (0-based).
     * @param mptProof MPT inclusion proof bytes (one entry per trie node
     *                 along the path from root to leaf).
     * @param receiptRLP RLP-encoded receipt at this transaction's slot.
     */
    function claimWithdrawal(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes[] calldata mptProof,
        bytes calldata receiptRLP
    ) external nonReentrant whenNotPaused {
        bytes32 nonce = _computeNonce(blockNumber, txIndex, logIndex);
        if (nonceState[nonce] != NonceState.Unused) revert NonceAlreadyConsumed();

        STRATOEventDecoder.DecodedWithdrawal memory d = _verifyEventProof(
            blockNumber,
            txIndex,
            mptProof,
            receiptRLP,
            logIndex,
            WITHDRAWAL_EVENT_HASH
        );

        // Threshold gate: a `Withdrawal` event must be strictly below
        // threshold. If a STRATO bug or misconfig sends a too-large amount
        // through the small-event path, we refuse here -- the vault's
        // threshold is authoritative.
        uint256 threshold = instantThreshold[d.externalToken];
        if (d.externalTokenAmount >= threshold) revert AmountAboveInstantThreshold();

        // Release on proof, in whatever order proofs arrive.
        //
        // Ordering used to gate release: a claim whose seq ran ahead of the
        // vault's cursor was parked until its predecessors showed up. That
        // bought FIFO fairness under scarce liquidity and nothing else --
        // replay is already prevented by the nonceState check above, and each
        // claim independently verifies its own receipt proof against a root
        // the light client has proven. The `prevWithdrawalBlock` chain that
        // could have made ordering a real completeness guarantee is decoded
        // but never read.
        //
        // What it cost was liveness, permanently. STRATO burns on request, so
        // the L1 claim is a separate user-paid step; any withdrawal worth less
        // than claim gas is rationally abandoned, and an abandoned seq froze
        // every later withdrawal on that chain with no way past it -- funds
        // proven, queued, and unreleasable. That is ordinary user behaviour,
        // not an attack, so the trade was not worth making.
        //
        // `seq` is still emitted by STRATO and decoded here for accounting.
        nonceState[nonce] = NonceState.Claimed;
        _release(d.externalToken, d.externalRecipient, d.externalTokenAmount);
        emit WithdrawalClaimed(
            nonce,
            d.externalToken,
            d.externalRecipient,
            d.externalTokenAmount
        );
    }

    /**
     * @notice MIGRATION ONLY. Drain up to `maxIters` claims left queued by the
     *         pre-upgrade, order-gated `claimWithdrawal`.
     *
     *         Release is no longer ordered and nothing is ever queued now, so
     *         on a vault upgraded with an empty queue -- or deployed after the
     *         change -- this always reverts QueueEmpty. It is retained so that
     *         a vault carrying a backlog across the upgrade can still release
     *         those already-proven funds instead of stranding them.
     *
     *         Anyone may call.
     */
    function processQueue(uint256 maxIters)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 drained)
    {
        if (queuedClaims[nextSeqToProcess].nonce == bytes32(0)) revert QueueEmpty();
        drained = _drainQueue(maxIters);
    }

    /**
     * @notice Submit proof of a large (>= threshold) withdrawal. Verifies the
     *         STRATO-side `WithdrawalRequested` event and marks the nonce as
     *         awaiting admin approval. No funds move yet.
     */
    function submitProof(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes[] calldata mptProof,
        bytes calldata receiptRLP
    ) external whenNotPaused {
        bytes32 nonce = _computeNonce(blockNumber, txIndex, logIndex);
        if (nonceState[nonce] != NonceState.Unused) revert NonceAlreadyConsumed();

        STRATOEventDecoder.DecodedWithdrawal memory d = _verifyEventProof(
            blockNumber,
            txIndex,
            mptProof,
            receiptRLP,
            logIndex,
            WITHDRAWAL_REQUESTED_EVENT_HASH
        );

        uint256 threshold = instantThreshold[d.externalToken];
        if (d.externalTokenAmount < threshold) revert AmountBelowInstantThreshold();

        nonceState[nonce] = NonceState.AwaitingApproval;
        pending[nonce] = PendingWithdrawal({
            externalToken: d.externalToken,
            externalRecipient: d.externalRecipient,
            externalTokenAmount: d.externalTokenAmount
        });

        emit WithdrawalAwaitingApproval(
            nonce,
            d.externalToken,
            d.externalRecipient,
            d.externalTokenAmount
        );
    }

    /// @notice Admin-only: release funds for a previously-proven large
    ///         withdrawal. Terminal transition: AwaitingApproval -> Claimed.
    function approveWithdrawal(bytes32 nonce) external nonReentrant onlyAdmin {
        if (nonceState[nonce] != NonceState.AwaitingApproval)
            revert NonceNotAwaitingApproval();

        PendingWithdrawal memory p = pending[nonce];
        nonceState[nonce] = NonceState.Claimed;
        delete pending[nonce]; // refund storage

        _release(p.externalToken, p.externalRecipient, p.externalTokenAmount);
        emit WithdrawalApproved(nonce);
        emit WithdrawalClaimed(
            nonce,
            p.externalToken,
            p.externalRecipient,
            p.externalTokenAmount
        );
    }

    /// @notice Admin-only: terminally reject a previously-proven large
    ///         withdrawal. Funds remain in the vault. The STRATO admin can
    ///         then refund the user's escrow via MercataBridge.refundEscrow.
    function rejectWithdrawal(bytes32 nonce, string calldata reason)
        external
        onlyAdmin
    {
        if (nonceState[nonce] != NonceState.AwaitingApproval)
            revert NonceNotAwaitingApproval();

        nonceState[nonce] = NonceState.Rejected;
        delete pending[nonce]; // refund storage
        emit WithdrawalRejected(nonce, reason);
    }

    // ============ Admin: configuration ============

    function setInstantThreshold(address externalToken, uint256 newThreshold)
        external
        onlyOwner
    {
        instantThreshold[externalToken] = newThreshold;
        emit InstantThresholdUpdated(externalToken, newThreshold);
    }

    function setAdminMultisig(address newAdmin) external onlyOwner {
        if (newAdmin == address(0)) revert InvalidAddress();
        emit AdminMultisigUpdated(adminMultisig, newAdmin);
        adminMultisig = newAdmin;
    }

    function setLightClient(address newClient) external onlyOwner {
        if (newClient == address(0)) revert InvalidAddress();
        emit LightClientUpdated(address(lightClient), newClient);
        lightClient = STRATOLightClient(newClient);
    }

    function setStratoVaultAddress(address newAddr) external onlyOwner {
        if (newAddr == address(0)) revert InvalidAddress();
        emit StratoVaultAddressUpdated(stratoVaultAddress, newAddr);
        stratoVaultAddress = newAddr;
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ============ Internal: proof verification ============

    function _computeNonce(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(blockNumber, txIndex, logIndex));
    }

    /**
     * @dev Verify that a STRATO event was actually emitted at the given
     *      location, and return the decoded payload as the source of truth.
     *      Reverts on any failure to verify or decode.
     *
     *      Steps:
     *        1. Pull the receipts root that STRATOLightClient has stored for
     *           `blockNumber`; reverts if no header has been submitted.
     *        2. MPT-verify `receiptRLP` is at key rlp(txIndex) under that root.
     *        3. Decode the receipt and pull out log #logIndex with the
     *           SolidVM-flavored shape (address, eventName, typed args).
     *        4. Confirm the source contract, event-name discriminator, and
     *           chain-id are what we expect.
     *
     *      The decoded struct is returned to the caller, so callers can drive
     *      threshold checks, state transitions, and token transfers off the
     *      authoritative on-chain values. Mirroring the receipt into a
     *      caller-supplied payload would just be a chance to disagree with it.
     */
    function _verifyEventProof(
        uint256 blockNumber,
        uint256 txIndex,
        bytes[] memory mptProof,
        bytes memory receiptRLP,
        uint256 logIndex,
        bytes32 expectedEventNameHash
    ) internal view virtual returns (STRATOEventDecoder.DecodedWithdrawal memory d) {
        bytes32 receiptsRoot = lightClient.getReceiptsRoot(blockNumber);

        // Trie key is rlp(txIndex). For a positional integer key this is
        // either a single byte (0x00..0x7f for txIndex 0..127) or a short
        // RLP string (0x81 + byte) for larger values.
        bytes memory trieKey = _rlpEncodeTxIndex(txIndex);

        if (!MerklePatricia.verifyInclusion(receiptsRoot, trieKey, receiptRLP, mptProof)) {
            revert ProofVerificationFailed();
        }

        d = STRATOEventDecoder.decodeWithdrawalLog(receiptRLP, logIndex);

        // Source must be the canonical STRATO bridge contract.
        if (d.contractAddress != stratoVaultAddress) revert WrongStratoVault();
        // Event name discriminates the small vs. large flow.
        if (d.eventNameHash != expectedEventNameHash) revert UnknownEvent();
        // Chain id must match the chain this vault represents.
        if (d.externalChainId != externalChainId) revert WrongChainId();
    }

    /// @dev Minimal RLP encoder for the trie key. txIndex is a small uint and
    ///      the receipts trie keys it as `rlp(uint)` (Phase 0 §6.1).
    function _rlpEncodeTxIndex(uint256 txIndex)
        private
        pure
        returns (bytes memory)
    {
        if (txIndex == 0) {
            // RLP encoding of 0 is the empty string: 0x80.
            return hex"80";
        }
        if (txIndex < 0x80) {
            // Single-byte values encode as themselves.
            return abi.encodePacked(uint8(txIndex));
        }
        // Otherwise: minimal big-endian, with 0x80 + length prefix. Truncate
        // to the smallest number of bytes that fits.
        uint256 v = txIndex;
        uint256 len;
        while (v != 0) {
            v >>= 8;
            len++;
        }
        bytes memory out = new bytes(1 + len);
        out[0] = bytes1(uint8(0x80 + len));
        for (uint256 i; i < len; ++i) {
            out[len - i] = bytes1(uint8(txIndex >> (8 * i)));
        }
        return out;
    }

    function _release(address token, address recipient, uint256 amount)
        internal
    {
        if (token == address(0)) {
            (bool ok, ) = recipient.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(recipient, amount);
        }
    }

    /**
     * @dev Pop and release queued claims while the slot at
     *      `nextSeqToProcess` is filled, capped at `maxIters`. Returns the
     *      number actually drained. Each iteration:
     *        1. read the queued snapshot,
     *        2. clear the storage (refunds gas),
     *        3. flip nonceState Queued -> Claimed,
     *        4. release funds,
     *        5. advance the cursor.
     *
     *      Loop body is constant work, so total cost is O(maxIters * release).
     *      Caller is responsible for picking a maxIters that fits the block
     *      gas limit; a sane default for batched UI usage is 8-32.
     */
    function _drainQueue(uint256 maxIters) internal returns (uint256 drained) {
        for (uint256 i; i < maxIters; ++i) {
            QueuedClaim memory q = queuedClaims[nextSeqToProcess];
            if (q.nonce == bytes32(0)) break;
            // Atomic snapshot then clear so reentrancy from the release call
            // can't see this slot in a half-applied state. (release() is
            // already nonReentrant-protected via the wrapping external
            // function, but defense-in-depth.)
            delete queuedClaims[nextSeqToProcess];
            nonceState[q.nonce] = NonceState.Claimed;
            _release(q.externalToken, q.externalRecipient, q.externalTokenAmount);
            emit WithdrawalClaimed(
                q.nonce,
                q.externalToken,
                q.externalRecipient,
                q.externalTokenAmount
            );
            unchecked {
                ++nextSeqToProcess;
                ++drained;
            }
        }
        if (drained > 0) emit SequenceAdvanced(nextSeqToProcess);
    }

    // ============ ETH support ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
