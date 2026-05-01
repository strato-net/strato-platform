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
    ///      the STRATO bridge contract emits with.
    uint256 private constant WITHDRAWAL_ARG_COUNT = 8;
    uint256 private constant ARG_NONCE = 0;
    uint256 private constant ARG_EXTERNAL_CHAIN_ID = 1;
    uint256 private constant ARG_EXTERNAL_TOKEN = 2;
    uint256 private constant ARG_EXTERNAL_RECIPIENT = 3;
    uint256 private constant ARG_EXTERNAL_TOKEN_AMOUNT = 4;
    uint256 private constant ARG_STRATO_SENDER = 5;
    uint256 private constant ARG_STRATO_TOKEN = 6;
    uint256 private constant ARG_STRATO_TOKEN_AMOUNT = 7;

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
        if (args.length != WITHDRAWAL_ARG_COUNT) revert UnexpectedArgCount();

        w.nonce = args[ARG_NONCE].toUint();
        w.externalChainId = args[ARG_EXTERNAL_CHAIN_ID].toUint();
        w.externalToken = args[ARG_EXTERNAL_TOKEN].toAddress();
        w.externalRecipient = args[ARG_EXTERNAL_RECIPIENT].toAddress();
        w.externalTokenAmount = args[ARG_EXTERNAL_TOKEN_AMOUNT].toUint();
        w.stratoSender = args[ARG_STRATO_SENDER].toAddress();
        w.stratoToken = args[ARG_STRATO_TOKEN].toAddress();
        w.stratoTokenAmount = args[ARG_STRATO_TOKEN_AMOUNT].toUint();
    }
}
