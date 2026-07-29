// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

/**
 * @title RLPReader
 * @notice Minimal Solidity RLP decoder for the STRATO bridge contracts.
 *
 *         Decodes STRATO's canonical V2 header and SolidVM-shaped receipts.
 *         Memory-based: callers copy calldata into memory once at the entry
 *         point and then walk the resulting items. Idiomatic in the OZ /
 *         Hamdi-Allam tradition; the API surface is intentionally small.
 *
 * RLP encoding rules (per Ethereum Yellow Paper):
 *
 *   * Single byte 0x00..0x7f: encodes itself as a length-1 string.
 *   * 0x80 (0): empty string ("").
 *   * 0x81..0xb7: short string of length 0..55. Length = first byte - 0x80.
 *   * 0xb8..0xbf: long string. (first byte - 0xb7) gives the size of the
 *     length-prefix in bytes; the prefix contains the string length.
 *   * 0xc0..0xf7: short list of total payload length 0..55. Length = first
 *     byte - 0xc0.
 *   * 0xf8..0xff: long list. Same length-of-length scheme as long strings.
 *
 * The decoder validates structure (sufficient bytes, sane lengths) but does
 * NOT validate canonical encoding (e.g. it accepts integers with leading
 * zeros in their string form). For consensus-critical paths (receipts root
 * verification), the caller should treat the input bytes as authoritative
 * and avoid any encoding that an attacker could disagree with.
 */
library RLPReader {
    error InvalidRLP();
    error WrongType();
    error OutOfBounds();

    struct RLPItem {
        uint256 len; // total length of the item (header + payload)
        uint256 memPtr; // memory pointer to the first byte of the item
    }

    /// @notice Wraps a `bytes memory` blob into an RLPItem positioned at the
    ///         start of the encoding. Callers should ensure `b` contains a
    ///         single, well-formed RLP item.
    function toRLPItem(bytes memory b) internal pure returns (RLPItem memory item) {
        uint256 ptr;
        assembly {
            ptr := add(b, 0x20)
        }
        item.memPtr = ptr;
        item.len = b.length;
    }

    /// @notice True if the item is an RLP list (prefix >= 0xc0).
    function isList(RLPItem memory item) internal pure returns (bool) {
        if (item.len == 0) return false;
        return _byteAt(item.memPtr, 0) >= 0xc0;
    }

    /// @dev Convenience: type the RLP prefix as uint8 throughout the file.
    ///      _byteAt returns uint8 directly so callers don't need cast noise.

    /// @notice Decode the item as a list of sub-items.
    ///
    /// Reverts if the item isn't a list. The returned array's length is the
    /// number of top-level entries; each sub-item references the same memory
    /// region as the input.
    function toList(RLPItem memory item) internal pure returns (RLPItem[] memory out) {
        if (!isList(item)) revert WrongType();

        (uint256 headerLen, uint256 payloadLen) = _payloadOffset(item);
        if (headerLen + payloadLen > item.len) revert InvalidRLP();

        // Two-pass: first pass counts entries, second pass populates.
        // Avoids dynamic resize and the gas overhead it would cost.
        uint256 count = _countListEntries(item.memPtr + headerLen, payloadLen);
        out = new RLPItem[](count);

        uint256 cursor = item.memPtr + headerLen;
        uint256 endPtr = cursor + payloadLen;
        for (uint256 i; i < count; ++i) {
            uint256 entryLen = _itemLen(cursor, endPtr - cursor);
            out[i] = RLPItem({len: entryLen, memPtr: cursor});
            cursor += entryLen;
        }
    }

    /// @notice Number of items in an RLP list, without materializing them.
    function listLength(RLPItem memory item) internal pure returns (uint256) {
        if (!isList(item)) revert WrongType();
        (uint256 headerLen, uint256 payloadLen) = _payloadOffset(item);
        return _countListEntries(item.memPtr + headerLen, payloadLen);
    }

    /// @notice Raw payload bytes of a string item (no length prefix).
    ///
    /// Reverts if the item is a list. Single-byte items (0x00..0x7f) return
    /// a single byte; the empty string (0x80) returns a zero-length array.
    function toBytes(RLPItem memory item) internal pure returns (bytes memory out) {
        if (isList(item)) revert WrongType();
        (uint256 headerLen, uint256 payloadLen) = _payloadOffset(item);
        if (headerLen + payloadLen > item.len) revert InvalidRLP();

        out = new bytes(payloadLen);
        if (payloadLen == 0) return out;

        uint256 src = item.memPtr + headerLen;
        uint256 dst;
        assembly {
            dst := add(out, 0x20)
        }
        _memcpy(src, dst, payloadLen);
    }

    /// @notice Decode a string item as a uint256.
    ///
    /// Accepts any payload length 0..32. Empty payload decodes to 0 (RLP
    /// integer convention). Payloads longer than 32 bytes revert.
    function toUint(RLPItem memory item) internal pure returns (uint256 out) {
        if (isList(item)) revert WrongType();
        (uint256 headerLen, uint256 payloadLen) = _payloadOffset(item);
        if (payloadLen > 32) revert InvalidRLP();
        if (headerLen + payloadLen > item.len) revert InvalidRLP();
        if (payloadLen == 0) return 0;

        // Big-endian: load 32 bytes starting at the payload, shift right by
        // (32 - payloadLen) bytes to discard the low garbage.
        uint256 src = item.memPtr + headerLen;
        assembly {
            out := mload(src)
            out := shr(mul(8, sub(32, payloadLen)), out)
        }
    }

    /// @notice Decode a string item as an Ethereum address (exactly 20 bytes).
    function toAddress(RLPItem memory item) internal pure returns (address) {
        if (isList(item)) revert WrongType();
        (uint256 headerLen, uint256 payloadLen) = _payloadOffset(item);
        if (payloadLen != 20) revert WrongType();
        if (headerLen + payloadLen > item.len) revert InvalidRLP();

        uint256 src = item.memPtr + headerLen;
        uint256 raw;
        assembly {
            raw := mload(src)
            raw := shr(96, raw) // 32 - 20 = 12 bytes of right-shift = 96 bits
        }
        return address(uint160(raw));
    }

    /// @notice Decode a string item as a bytes32. Payload must be exactly 32.
    function toBytes32(RLPItem memory item) internal pure returns (bytes32 out) {
        if (isList(item)) revert WrongType();
        (uint256 headerLen, uint256 payloadLen) = _payloadOffset(item);
        if (payloadLen != 32) revert WrongType();
        if (headerLen + payloadLen > item.len) revert InvalidRLP();

        uint256 src = item.memPtr + headerLen;
        assembly {
            out := mload(src)
        }
    }

    /// @notice Length of the payload (just the data, not the header).
    function payloadLength(RLPItem memory item) internal pure returns (uint256) {
        (, uint256 payloadLen) = _payloadOffset(item);
        return payloadLen;
    }

    // ============ Internal ============

    /// @dev Returns (header byte count, payload byte count) for the item.
    function _payloadOffset(RLPItem memory item)
        private
        pure
        returns (uint256 headerLen, uint256 payloadLen)
    {
        if (item.len == 0) revert InvalidRLP();
        uint8 prefix = _byteAt(item.memPtr, 0);

        if (prefix < 0x80) {
            // Single byte that encodes itself.
            return (0, 1);
        } else if (prefix < 0xb8) {
            return (1, prefix - 0x80);
        } else if (prefix < 0xc0) {
            uint256 lenOfLen = prefix - 0xb7;
            if (1 + lenOfLen > item.len) revert InvalidRLP();
            return (1 + lenOfLen, _readLen(item.memPtr + 1, lenOfLen));
        } else if (prefix < 0xf8) {
            return (1, prefix - 0xc0);
        } else {
            uint256 lenOfLen = prefix - 0xf7;
            if (1 + lenOfLen > item.len) revert InvalidRLP();
            return (1 + lenOfLen, _readLen(item.memPtr + 1, lenOfLen));
        }
    }

    /// @dev Read a big-endian length from `lenOfLen` bytes at `ptr`.
    function _readLen(uint256 ptr, uint256 lenOfLen) private pure returns (uint256 out) {
        if (lenOfLen == 0 || lenOfLen > 8) revert InvalidRLP();
        assembly {
            out := mload(ptr)
            out := shr(mul(8, sub(32, lenOfLen)), out)
        }
    }

    /// @dev Total byte length of one RLP item starting at `ptr`. Ensures the
    ///      claimed length doesn't exceed `available`.
    function _itemLen(uint256 ptr, uint256 available) private pure returns (uint256 total) {
        if (available == 0) revert InvalidRLP();
        uint8 prefix = _byteAt(ptr, 0);
        if (prefix < 0x80) {
            total = 1;
        } else if (prefix < 0xb8) {
            total = 1 + (prefix - 0x80);
        } else if (prefix < 0xc0) {
            uint256 lenOfLen = prefix - 0xb7;
            if (1 + lenOfLen > available) revert InvalidRLP();
            total = 1 + lenOfLen + _readLen(ptr + 1, lenOfLen);
        } else if (prefix < 0xf8) {
            total = 1 + (prefix - 0xc0);
        } else {
            uint256 lenOfLen = prefix - 0xf7;
            if (1 + lenOfLen > available) revert InvalidRLP();
            total = 1 + lenOfLen + _readLen(ptr + 1, lenOfLen);
        }
        if (total > available) revert InvalidRLP();
    }

    /// @dev Walk a list payload counting top-level items.
    function _countListEntries(uint256 startPtr, uint256 payloadLen)
        private
        pure
        returns (uint256 count)
    {
        uint256 cursor = startPtr;
        uint256 endPtr = startPtr + payloadLen;
        while (cursor < endPtr) {
            cursor += _itemLen(cursor, endPtr - cursor);
            unchecked {
                ++count;
            }
        }
        if (cursor != endPtr) revert InvalidRLP();
    }

    function _byteAt(uint256 ptr, uint256 offset) private pure returns (uint8 b) {
        assembly {
            b := byte(0, mload(add(ptr, offset)))
        }
    }

    function _memcpy(uint256 src, uint256 dst, uint256 len) private pure {
        // Word-by-word copy, with a final masked write for the tail.
        // 32-byte unrolling is overkill for the small inputs we handle.
        for (; len >= 32; len -= 32) {
            assembly {
                mstore(dst, mload(src))
            }
            src += 32;
            dst += 32;
        }
        if (len > 0) {
            uint256 mask = (1 << (8 * (32 - len))) - 1;
            assembly {
                let srcWord := mload(src)
                let dstWord := mload(dst)
                mstore(dst, or(and(srcWord, not(mask)), and(dstWord, mask)))
            }
        }
    }
}
