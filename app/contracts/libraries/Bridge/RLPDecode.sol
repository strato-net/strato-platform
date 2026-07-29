/**
 * @title  RLPDecode
 * @notice SolidVM-native RLP decoder. Decodes Ethereum RLP-encoded
 *         items (per the Yellow Paper) without inline assembly.
 *
 *         Built for the Eth→STRATO bridge: receipts come back as
 *         RLP blobs, and after MPT proof verification we walk them
 *         field-by-field to extract logs.
 *
 *         API style: each entry point takes a `bytes` blob containing
 *         exactly one well-formed RLP item. For nested data,
 *         {decodeList} returns sub-encodings (each itself a complete
 *         RLP item) which can be re-fed into the decoder.
 *
 * RLP encoding rules (Yellow Paper):
 *   * 0x00..0x7f         single byte that encodes itself
 *   * 0x80               empty string ("")
 *   * 0x81..0xb7         short string, payload length = b0 - 0x80 (1..55)
 *   * 0xb8..0xbf         long string, length-of-length follows, then payload
 *   * 0xc0               empty list
 *   * 0xc1..0xf7         short list, payload length = b0 - 0xc0 (0..55)
 *   * 0xf8..0xff         long list, length-of-length follows, then items
 *
 * @dev We accept non-canonical encodings (e.g. an integer with leading
 *      zeros, or a single byte wrapped in a 0x81 short-string prefix).
 *      The MPT verifier hashes the input bytes before trusting them, so
 *      the canonicality of the inner RLP is the producer's problem.
 */
library RLPDecode {

    /// @notice Returns true if the blob's first item is an RLP list
    ///         (i.e. starts with prefix ≥ 0xc0).
    function isList(bytes blob) internal pure returns (bool) {
        require(blob.length > 0, "RLPDecode: empty blob");
        return uint8(blob[0]) >= 0xc0;
    }

    /**
     * @notice Decode a top-level RLP list into the encodings of its
     *         elements. Each returned `bytes` is itself a complete,
     *         re-decodable RLP item.
     *
     *         Reverts if the blob isn't a list, or if the elements
     *         don't pack exactly to the declared payload length.
     */
    function decodeList(bytes blob) internal pure returns (bytes[] items) {
        require(isList(blob), "RLPDecode: expected list");
        (uint headerLen, uint payloadLen) = _itemHeader(blob, 0);
        require(headerLen + payloadLen == blob.length, "RLPDecode: list trailing data");

        // Two-pass: count entries first so we can size `items` exactly.
        uint cursor = headerLen;
        uint endPos = blob.length;
        uint count = 0;
        while (cursor < endPos) {
            (uint subHl, uint subPl) = _itemHeader(blob, cursor);
            cursor = cursor + subHl + subPl;
            require(cursor <= endPos, "RLPDecode: child overflows list");
            count = count + 1;
        }
        require(cursor == endPos, "RLPDecode: list misaligned");

        items = new bytes[](count);
        cursor = headerLen;
        uint i = 0;
        while (cursor < endPos) {
            (uint subHl, uint subPl) = _itemHeader(blob, cursor);
            uint itemLen = subHl + subPl;
            items[i] = _slice(blob, cursor, cursor + itemLen);
            cursor = cursor + itemLen;
            i = i + 1;
        }
    }

    /**
     * @notice Decode a non-list RLP item to its raw payload bytes.
     *         Empty string (0x80) returns a zero-length bytes; single
     *         self-encoding bytes (0x00..0x7f) return that single byte.
     */
    function decodeBytes(bytes blob) internal pure returns (bytes payload) {
        require(!isList(blob), "RLPDecode: expected string, got list");
        (uint headerLen, uint payloadLen) = _itemHeader(blob, 0);
        require(headerLen + payloadLen == blob.length, "RLPDecode: string trailing data");
        if (headerLen == 0) {
            // Single self-encoded byte (0x00..0x7f). Payload IS the blob.
            return blob;
        }
        return _slice(blob, headerLen, headerLen + payloadLen);
    }

    /**
     * @notice Decode an RLP string item as a big-endian unsigned integer.
     *         Accepts any payload length 0..32 (longer reverts).
     *         Empty payload (0x80) decodes to 0.
     */
    function decodeUint(bytes blob) internal pure returns (uint256 v) {
        bytes payload = decodeBytes(blob);
        require(payload.length <= 32, "RLPDecode: uint payload > 32 bytes");
        v = 0;
        for (uint i = 0; i < payload.length; i = i + 1) {
            v = (v << 8) | uint256(uint8(payload[i]));
        }
    }

    /// @notice Decode an RLP string item as a 32-byte hash.
    ///         Reverts if payload length is anything other than 32.
    function decodeBytes32(bytes blob) internal pure returns (bytes32) {
        bytes payload = decodeBytes(blob);
        require(payload.length == 32, "RLPDecode: bytes32 must be 32 bytes");
        return bytes32(payload);
    }

    /// @notice Decode an RLP string item as an Ethereum address (20 bytes).
    function decodeAddress(bytes blob) internal pure returns (address) {
        bytes payload = decodeBytes(blob);
        require(payload.length == 20, "RLPDecode: address must be 20 bytes");
        uint160 a = 0;
        for (uint i = 0; i < 20; i = i + 1) {
            a = uint160((uint256(a) << 8) | uint256(uint8(payload[i])));
        }
        return address(a);
    }

    // ─────────────────────────────────────────────────────────────────
    // Internal: header parsing
    // ─────────────────────────────────────────────────────────────────

    /**
     * @dev Parse the header of the RLP item starting at @offset in @blob.
     *      Returns (headerLen, payloadLen). The single-byte case
     *      (0x00..0x7f) is reported as headerLen=0, payloadLen=1; the
     *      decoders that care surface the raw byte themselves.
     */
    function _itemHeader(bytes blob, uint offset)
        private
        pure
        returns (uint headerLen, uint payloadLen)
    {
        require(offset < blob.length, "RLPDecode: header offset OOB");
        uint8 b0 = uint8(blob[offset]);

        if (b0 < 0x80) {
            // Single self-encoded byte: 0x00..0x7f.
            return (0, 1);
        }
        if (b0 < 0xb8) {
            return (1, uint256(b0) - 0x80);
        }
        if (b0 < 0xc0) {
            // Long string: length-of-length is b0 - 0xb7 (1..8).
            uint lenLen = uint256(b0) - 0xb7;
            require(offset + 1 + lenLen <= blob.length, "RLPDecode: long-str length OOB");
            uint pl = _readBE(blob, offset + 1, lenLen);
            return (1 + lenLen, pl);
        }
        if (b0 < 0xf8) {
            return (1, uint256(b0) - 0xc0);
        }
        // Long list: length-of-length is b0 - 0xf7 (1..8).
        uint lenLen2 = uint256(b0) - 0xf7;
        require(offset + 1 + lenLen2 <= blob.length, "RLPDecode: long-list length OOB");
        uint pl2 = _readBE(blob, offset + 1, lenLen2);
        return (1 + lenLen2, pl2);
    }

    /// @dev Read @nBytes big-endian bytes from @blob starting at @offset
    ///      into a uint256. Used for long-string / long-list length-of-length.
    function _readBE(bytes blob, uint offset, uint nBytes) private pure returns (uint v) {
        v = 0;
        for (uint i = 0; i < nBytes; i = i + 1) {
            v = (v << 8) | uint256(uint8(blob[offset + i]));
        }
    }

    /// @dev Manual byte-range copy. Used in place of `.substring()`,
    ///      which SolidVM's typechecker doesn't surface as a member
    ///      function in `pure` library context.
    function _slice(bytes blob, uint start, uint endExclusive) private pure returns (bytes out) {
        require(endExclusive >= start, "RLPDecode: slice end before start");
        require(endExclusive <= blob.length, "RLPDecode: slice OOB");
        uint n = endExclusive - start;
        out = new bytes(n);
        for (uint i = 0; i < n; i = i + 1) {
            out[i] = blob[start + i];
        }
    }
}
