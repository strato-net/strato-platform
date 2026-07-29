// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import {RLPReader} from "./RLPReader.sol";

/**
 * @title STRATOEventDecoder
 * @notice Decoders for the two STRATO data structures the Ethereum bridge
 *         contracts care about:
 *
 *           1. The canonical V2 block header (per Phase 0 spec §2.1, mirrors
 *              `BlockHeader.hs:219-235` on the STRATO side). Used by the
 *              light client to extract block number, receipts root, and the
 *              three validator lists.
 *
 *           2. The receipts trie leaf shape -- a STRATO receipt with embedded
 *              SolidVM-flavored logs (Phase 0 §6.2 / §6.3). Used by the
 *              vault to decode a `Withdrawal` or `WithdrawalRequested` event
 *              payload from a proven receipt.
 *
 *         Both decoders are positional and assume the input has been
 *         authenticated upstream (header signatures or MPT inclusion proof).
 */
library STRATOEventDecoder {
    using RLPReader for RLPReader.RLPItem;
    using RLPReader for bytes;

    error UnsupportedHeaderVersion();
    error MalformedHeader();
    error MalformedReceipt();
    error MalformedLog();
    error LogIndexOutOfRange();
    error UnexpectedArgCount();

    // ============ Header ============

    /// @dev Layout: [version, parentHash, stateRoot, transactionsRoot,
    ///              receiptsRoot, logsBloom, number, timestamp, extraData,
    ///              currentValidators, newValidators, removedValidators,
    ///              proposalSignature, signatures]
    uint256 private constant HEADER_FIELD_COUNT = 14;
    uint256 private constant HEADER_VERSION = 2;

    uint256 private constant IDX_VERSION = 0;
    uint256 private constant IDX_RECEIPTS_ROOT = 4;
    uint256 private constant IDX_NUMBER = 6;
    uint256 private constant IDX_CURRENT_VALIDATORS = 9;
    uint256 private constant IDX_NEW_VALIDATORS = 10;
    uint256 private constant IDX_REMOVED_VALIDATORS = 11;

    struct DecodedHeader {
        uint256 number;
        bytes32 receiptsRoot;
        address[] currentValidators;
        address[] newValidators;
        address[] removedValidators;
    }

    /**
     * @notice Decode a STRATO V2 block header from its RLP encoding.
     * @param headerRLP The full RLP encoding (header bytes that validators
     *                  signed -- i.e. with the `signatures` field emptied).
     */
    function decodeHeader(bytes memory headerRLP)
        internal
        pure
        returns (DecodedHeader memory h)
    {
        RLPReader.RLPItem memory item = headerRLP.toRLPItem();
        if (!item.isList()) revert MalformedHeader();
        RLPReader.RLPItem[] memory fields = item.toList();
        if (fields.length != HEADER_FIELD_COUNT) revert MalformedHeader();

        if (fields[IDX_VERSION].toUint() != HEADER_VERSION) {
            revert UnsupportedHeaderVersion();
        }

        h.number = fields[IDX_NUMBER].toUint();
        h.receiptsRoot = fields[IDX_RECEIPTS_ROOT].toBytes32();
        h.currentValidators = _decodeAddressList(fields[IDX_CURRENT_VALIDATORS]);
        h.newValidators = _decodeAddressList(fields[IDX_NEW_VALIDATORS]);
        h.removedValidators = _decodeAddressList(fields[IDX_REMOVED_VALIDATORS]);
    }

    function _decodeAddressList(RLPReader.RLPItem memory listItem)
        private
        pure
        returns (address[] memory out)
    {
        if (!listItem.isList()) revert MalformedHeader();
        RLPReader.RLPItem[] memory entries = listItem.toList();
        out = new address[](entries.length);
        for (uint256 i; i < entries.length; ++i) {
            out[i] = entries[i].toAddress();
        }
    }

    // ============ Receipts trie leaf / log ============

    /// @dev Receipt layout (Phase 0 §6.2): [status, gasUsed, logs]
    uint256 private constant RECEIPT_FIELD_COUNT = 3;
    uint256 private constant RECEIPT_LOGS_INDEX = 2;

    /// @dev Log layout (Phase 0 §6.3): [address, eventName, args]
    uint256 private constant LOG_FIELD_COUNT = 3;

    /// @dev Withdrawal / WithdrawalRequested args layout (Phase 0 §7.1).
    ///      Position is consensus -- the verifier must use the same order
    ///      the STRATO bridge contract emits with. The trailing
    ///      `prevWithdrawalBlock` and `seq` fields are appended on the
    ///      hot-path `Withdrawal` event (10-arg layout) to drive the
    ///      BridgeVault's sequence-ordered queue. Cold-path
    ///      `WithdrawalRequestedV2` keeps the legacy 8-arg layout (no
    ///      sequencing -- admin approval is the gate). The decoder accepts
    ///      both shapes; cold logs decode with `prevWithdrawalBlock = 0`
    ///      and `seq = 0`.
    uint256 private constant WITHDRAWAL_ARG_COUNT_LEGACY = 8;
    uint256 private constant WITHDRAWAL_ARG_COUNT_SEQUENCED = 10;
    uint256 private constant ARG_NONCE = 0;
    uint256 private constant ARG_EXTERNAL_CHAIN_ID = 1;
    uint256 private constant ARG_EXTERNAL_TOKEN = 2;
    uint256 private constant ARG_EXTERNAL_RECIPIENT = 3;
    uint256 private constant ARG_EXTERNAL_TOKEN_AMOUNT = 4;
    uint256 private constant ARG_STRATO_SENDER = 5;
    uint256 private constant ARG_STRATO_TOKEN = 6;
    uint256 private constant ARG_STRATO_TOKEN_AMOUNT = 7;
    uint256 private constant ARG_PREV_WITHDRAWAL_BLOCK = 8;
    uint256 private constant ARG_SEQ = 9;

    struct DecodedWithdrawal {
        address contractAddress;
        bytes32 eventNameHash; // keccak256(eventName), for cheap comparison
        uint256 nonce;
        uint256 externalChainId;
        address externalToken;
        address externalRecipient;
        uint256 externalTokenAmount;
        address stratoSender;
        address stratoToken;
        uint256 stratoTokenAmount;
        /// @dev STRATO block of the previous Withdrawal event for this
        ///      external chain; 0 if this is the first hot withdrawal.
        ///      Used by the catch-up flow to walk predecessors.
        uint256 prevWithdrawalBlock;
        /// @dev Per-chain monotonically-increasing sequence number; the
        ///      BridgeVault releases funds strictly in this order.
        uint256 seq;
    }

    /**
     * @notice Decode a Withdrawal-shaped log out of a STRATO receipt.
     * @param receiptRLP RLP encoding of the receipt at the relevant tx slot.
     * @param logIndex Position of the target log within the receipt.
     */
    function decodeWithdrawalLog(bytes memory receiptRLP, uint256 logIndex)
        internal
        pure
        returns (DecodedWithdrawal memory w)
    {
        RLPReader.RLPItem memory receiptItem = receiptRLP.toRLPItem();
        if (!receiptItem.isList()) revert MalformedReceipt();
        RLPReader.RLPItem[] memory receiptFields = receiptItem.toList();
        if (receiptFields.length != RECEIPT_FIELD_COUNT) revert MalformedReceipt();

        RLPReader.RLPItem memory logsItem = receiptFields[RECEIPT_LOGS_INDEX];
        if (!logsItem.isList()) revert MalformedReceipt();
        RLPReader.RLPItem[] memory logs = logsItem.toList();
        if (logIndex >= logs.length) revert LogIndexOutOfRange();

        // ---- Decode the target log ----
        if (!logs[logIndex].isList()) revert MalformedLog();
        RLPReader.RLPItem[] memory logFields = logs[logIndex].toList();
        if (logFields.length != LOG_FIELD_COUNT) revert MalformedLog();

        w.contractAddress = logFields[0].toAddress();
        // eventName is RLP'd as a UTF-8 byte string; we hash for comparison.
        w.eventNameHash = keccak256(logFields[1].toBytes());

        // ---- Decode the args list ----
        if (!logFields[2].isList()) revert MalformedLog();
        RLPReader.RLPItem[] memory args = logFields[2].toList();
        if (
            args.length != WITHDRAWAL_ARG_COUNT_LEGACY &&
            args.length != WITHDRAWAL_ARG_COUNT_SEQUENCED
        ) revert UnexpectedArgCount();

        w.nonce = args[ARG_NONCE].toUint();
        w.externalChainId = args[ARG_EXTERNAL_CHAIN_ID].toUint();
        w.externalToken = args[ARG_EXTERNAL_TOKEN].toAddress();
        w.externalRecipient = args[ARG_EXTERNAL_RECIPIENT].toAddress();
        w.externalTokenAmount = args[ARG_EXTERNAL_TOKEN_AMOUNT].toUint();
        w.stratoSender = args[ARG_STRATO_SENDER].toAddress();
        w.stratoToken = args[ARG_STRATO_TOKEN].toAddress();
        w.stratoTokenAmount = args[ARG_STRATO_TOKEN_AMOUNT].toUint();
        if (args.length == WITHDRAWAL_ARG_COUNT_SEQUENCED) {
            w.prevWithdrawalBlock = args[ARG_PREV_WITHDRAWAL_BLOCK].toUint();
            w.seq = args[ARG_SEQ].toUint();
        }
        // For legacy 8-arg logs (cold-path WithdrawalRequestedV2),
        // prevWithdrawalBlock and seq stay at the struct's zero defaults.
        // The vault's submitProof flow doesn't consult them; cold-path
        // sequencing is admin-driven, not on-chain-queued.
    }

    // ============ NativeWithdrawalRequested ============

    /// @dev Sibling decoder for the STRATO-native bridge-out flow. The
    ///      `NativeWithdrawalRequested` event is emitted by
    ///      `StratoNativeBridge` (separate contract from MercataBridge,
    ///      governs STRATO-native tokens like USDST / GOLDST) and has a
    ///      different argument shape than `Withdrawal` --- there's no
    ///      `nonce` field (the STRATO-side `withdrawalId` plays that
    ///      role), and the routing fields differ (a `representationToken`
    ///      replaces `externalToken`, and an `externalBridge` field
    ///      identifies the rep bridge directly).
    ///
    ///      Event signature on STRATO:
    ///        NativeWithdrawalRequested(
    ///          uint256 indexed withdrawalId,
    ///          uint256 externalChainId,
    ///          address externalBridge,
    ///          address externalRecipient,
    ///          address representationToken,
    ///          address stratoSender,
    ///          address stratoToken,
    ///          uint256 stratoTokenAmount,
    ///          bool    useInstantPath
    ///        )
    ///
    ///      STRATO emits typed args as a single positional list -- the
    ///      `indexed` keyword is consumed for SolidVM's event-routing
    ///      semantics but doesn't split the args list across topics
    ///      the way EVM does. So all nine args land in `args[0..8]`.
    uint256 private constant NATIVE_WITHDRAWAL_ARG_COUNT = 9;
    uint256 private constant N_ARG_WITHDRAWAL_ID = 0;
    uint256 private constant N_ARG_EXTERNAL_CHAIN_ID = 1;
    uint256 private constant N_ARG_EXTERNAL_BRIDGE = 2;
    uint256 private constant N_ARG_EXTERNAL_RECIPIENT = 3;
    uint256 private constant N_ARG_REPRESENTATION_TOKEN = 4;
    uint256 private constant N_ARG_STRATO_SENDER = 5;
    uint256 private constant N_ARG_STRATO_TOKEN = 6;
    uint256 private constant N_ARG_STRATO_TOKEN_AMOUNT = 7;
    uint256 private constant N_ARG_USE_INSTANT_PATH = 8;

    struct DecodedNativeWithdrawal {
        address contractAddress;     // must equal configured StratoNativeBridge addr
        bytes32 eventNameHash;       // keccak256("NativeWithdrawalRequested")
        uint256 withdrawalId;        // STRATO-side identifier; doubles as mintId's sourceWithdrawalId
        uint256 externalChainId;     // must equal block.chainid on the destination
        address externalBridge;      // must equal address(this) on the rep bridge
        address externalRecipient;   // mint recipient
        address representationToken; // must match stratoToRepresentation[stratoToken]
        address stratoSender;        // for indexing / refund-paths if ever needed
        address stratoToken;         // resolves the rep-token route
        uint256 stratoTokenAmount;   // mint amount (representation tokens use the same decimals as the strato token)
        /// @dev Carried for completeness so off-chain consumers can
        ///      inspect the original flow choice. The trustless mint
        ///      path doesn't honour this -- LC anchoring cadence is
        ///      the only timing knob.
        bool    useInstantPath;
    }

    /**
     * @notice Decode a NativeWithdrawalRequested log out of a STRATO receipt.
     *         Identical receipt/log envelope as {decodeWithdrawalLog};
     *         only the inner args list differs.
     */
    function decodeNativeWithdrawalLog(bytes memory receiptRLP, uint256 logIndex)
        internal
        pure
        returns (DecodedNativeWithdrawal memory n)
    {
        RLPReader.RLPItem memory receiptItem = receiptRLP.toRLPItem();
        if (!receiptItem.isList()) revert MalformedReceipt();
        RLPReader.RLPItem[] memory receiptFields = receiptItem.toList();
        if (receiptFields.length != RECEIPT_FIELD_COUNT) revert MalformedReceipt();

        RLPReader.RLPItem memory logsItem = receiptFields[RECEIPT_LOGS_INDEX];
        if (!logsItem.isList()) revert MalformedReceipt();
        RLPReader.RLPItem[] memory logs = logsItem.toList();
        if (logIndex >= logs.length) revert LogIndexOutOfRange();

        if (!logs[logIndex].isList()) revert MalformedLog();
        RLPReader.RLPItem[] memory logFields = logs[logIndex].toList();
        if (logFields.length != LOG_FIELD_COUNT) revert MalformedLog();

        n.contractAddress = logFields[0].toAddress();
        n.eventNameHash = keccak256(logFields[1].toBytes());

        if (!logFields[2].isList()) revert MalformedLog();
        RLPReader.RLPItem[] memory args = logFields[2].toList();
        if (args.length != NATIVE_WITHDRAWAL_ARG_COUNT) revert UnexpectedArgCount();

        n.withdrawalId        = args[N_ARG_WITHDRAWAL_ID].toUint();
        n.externalChainId     = args[N_ARG_EXTERNAL_CHAIN_ID].toUint();
        n.externalBridge      = args[N_ARG_EXTERNAL_BRIDGE].toAddress();
        n.externalRecipient   = args[N_ARG_EXTERNAL_RECIPIENT].toAddress();
        n.representationToken = args[N_ARG_REPRESENTATION_TOKEN].toAddress();
        n.stratoSender        = args[N_ARG_STRATO_SENDER].toAddress();
        n.stratoToken         = args[N_ARG_STRATO_TOKEN].toAddress();
        n.stratoTokenAmount   = args[N_ARG_STRATO_TOKEN_AMOUNT].toUint();
        // RLPReader has no toBool; treat any non-zero uint as true.
        n.useInstantPath      = args[N_ARG_USE_INSTANT_PATH].toUint() != 0;
    }
}
