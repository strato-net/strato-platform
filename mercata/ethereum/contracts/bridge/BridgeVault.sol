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

    // ============ State machine ============

    enum NonceState {
        Unused, // 0: never seen
        Claimed, // 1: terminal -- funds released
        AwaitingApproval, // 2: large-withdrawal proof submitted, admin must decide
        Rejected // 3: terminal -- admin rejected
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

    /// @notice Common payload submitted with a proof. Mirrors the structured
    ///         args of the STRATO-side `Withdrawal` / `WithdrawalRequested`
    ///         events (Phase 0 §7.1) so the vault can validate the proof
    ///         decode against the values the caller is asserting.
    struct WithdrawalPayload {
        uint256 stratoNonce; // app-layer nonce (withdrawalCounter on STRATO)
        uint256 externalChainId;
        address externalToken;
        address externalRecipient;
        uint256 externalTokenAmount;
        address stratoSender;
        address stratoToken;
        uint256 stratoTokenAmount;
    }

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
     * @param payload Asserted payload values; checked against the decoded
     *                event during proof verification.
     */
    function claimWithdrawal(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes[] calldata mptProof,
        bytes calldata receiptRLP,
        WithdrawalPayload calldata payload
    ) external nonReentrant whenNotPaused {
        bytes32 nonce = _computeNonce(blockNumber, txIndex, logIndex);
        if (nonceState[nonce] != NonceState.Unused) revert NonceAlreadyConsumed();

        _verifyEventProof(
            blockNumber,
            txIndex,
            logIndex,
            mptProof,
            receiptRLP,
            payload,
            WITHDRAWAL_EVENT_HASH
        );

        // Threshold gate: a `Withdrawal` event must be at-or-below threshold.
        // If a STRATO bug or misconfig sends a too-large amount through the
        // small-event path, we refuse here -- the vault's threshold is
        // authoritative.
        uint256 threshold = instantThreshold[payload.externalToken];
        if (payload.externalTokenAmount >= threshold)
            revert AmountAboveInstantThreshold();

        nonceState[nonce] = NonceState.Claimed;
        _release(payload.externalToken, payload.externalRecipient, payload.externalTokenAmount);

        emit WithdrawalClaimed(
            nonce,
            payload.externalToken,
            payload.externalRecipient,
            payload.externalTokenAmount
        );
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
        bytes calldata receiptRLP,
        WithdrawalPayload calldata payload
    ) external whenNotPaused {
        bytes32 nonce = _computeNonce(blockNumber, txIndex, logIndex);
        if (nonceState[nonce] != NonceState.Unused) revert NonceAlreadyConsumed();

        _verifyEventProof(
            blockNumber,
            txIndex,
            logIndex,
            mptProof,
            receiptRLP,
            payload,
            WITHDRAWAL_REQUESTED_EVENT_HASH
        );

        uint256 threshold = instantThreshold[payload.externalToken];
        if (payload.externalTokenAmount < threshold)
            revert AmountBelowInstantThreshold();

        nonceState[nonce] = NonceState.AwaitingApproval;
        pending[nonce] = PendingWithdrawal({
            externalToken: payload.externalToken,
            externalRecipient: payload.externalRecipient,
            externalTokenAmount: payload.externalTokenAmount
        });

        emit WithdrawalAwaitingApproval(
            nonce,
            payload.externalToken,
            payload.externalRecipient,
            payload.externalTokenAmount
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
     *      location with the given payload. Reverts on any mismatch.
     *
     *      Steps:
     *        1. Cheap chain-id check on the asserted payload.
     *        2. Pull the receipts root that STRATOLightClient has stored for
     *           `blockNumber`; reverts if no header has been submitted.
     *        3. MPT-verify `receiptRLP` is at key rlp(txIndex) under that root.
     *        4. Decode the receipt and pull out log #logIndex with the
     *           SolidVM-flavored shape (address, eventName, typed args).
     *        5. Equality-check every authoritative field: source contract,
     *           event name, and all eight payload fields. Anything left
     *           un-asserted is a forgery vector.
     */
    function _verifyEventProof(
        uint256 blockNumber,
        uint256 txIndex,
        uint256 logIndex,
        bytes[] memory mptProof,
        bytes memory receiptRLP,
        WithdrawalPayload calldata payload,
        bytes32 expectedEventNameHash
    ) internal view {
        if (payload.externalChainId != externalChainId) revert WrongChainId();

        bytes32 receiptsRoot = lightClient.getReceiptsRoot(blockNumber);

        // Trie key is rlp(txIndex). For a positional integer key this is
        // either a single byte (0x00..0x7f for txIndex 0..127) or a short
        // RLP string (0x81 + byte).
        bytes memory triKey = _rlpEncodeTxIndex(txIndex);

        if (!MerklePatricia.verifyInclusion(receiptsRoot, triKey, receiptRLP, mptProof)) {
            revert ProofVerificationFailed();
        }

        STRATOEventDecoder.DecodedWithdrawal memory d =
            STRATOEventDecoder.decodeWithdrawalLog(receiptRLP, logIndex);

        // Source must be the canonical STRATO bridge contract.
        if (d.contractAddress != stratoVaultAddress) revert WrongStratoVault();

        // Event name must match (small-tier vs large-tier dispatch).
        if (d.eventNameHash != expectedEventNameHash) revert UnknownEvent();

        // Every payload field must match what the user asserted. Anything
        // not checked here is a forgery vector.
        if (d.externalChainId != payload.externalChainId) revert WrongChainId();
        if (d.externalToken != payload.externalToken) revert ProofVerificationFailed();
        if (d.externalRecipient != payload.externalRecipient) revert ProofVerificationFailed();
        if (d.externalTokenAmount != payload.externalTokenAmount) revert ProofVerificationFailed();
        if (d.stratoSender != payload.stratoSender) revert ProofVerificationFailed();
        if (d.stratoToken != payload.stratoToken) revert ProofVerificationFailed();
        if (d.stratoTokenAmount != payload.stratoTokenAmount) revert ProofVerificationFailed();
        if (d.nonce != payload.stratoNonce) revert ProofVerificationFailed();
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

    // ============ ETH support ============

    receive() external payable {}

    // ============ UUPS ============

    function _authorizeUpgrade(address) internal override onlyOwner {}
}
