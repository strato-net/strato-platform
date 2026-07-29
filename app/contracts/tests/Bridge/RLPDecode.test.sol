import "../../libraries/Bridge/RLPDecode.sol";

/**
 * @title Describe_RLPDecode
 * @notice Yellow-Paper test vectors plus a few realistic shapes for
 *         the receipt parsing path (status, logs).
 */
contract Describe_RLPDecode {
    using RLPDecode for *;

    // ============ Single-item primitives ============

    function it_decodes_empty_string() {
        bytes b = RLPDecode.decodeBytes(hex"80");
        require(b.length == 0, "empty string should be empty");
    }

    function it_decodes_self_encoded_byte() {
        bytes b = RLPDecode.decodeBytes(hex"42");
        require(b.length == 1, "single byte length wrong");
        require(uint8(b[0]) == 0x42, "single byte wrong value");
    }

    function it_decodes_short_string() {
        // 0x83 = short string of length 3, "dog" = 0x64 0x6f 0x67
        bytes b = RLPDecode.decodeBytes(hex"83646f67");
        require(b.length == 3, "dog length wrong");
        require(uint8(b[0]) == 0x64 && uint8(b[1]) == 0x6f && uint8(b[2]) == 0x67, "dog bytes wrong");
    }

    function it_decodes_long_string() {
        // 0xb8 = long string with 1-byte length-of-length; length 0x38 = 56.
        // Payload: 56 bytes of repeating 0xab.
        bytes b = RLPDecode.decodeBytes(hex"b838abababababababababababababababababababababababababababababababababababababababababababababababababababababababab");
        require(b.length == 56, "long string length wrong");
        require(uint8(b[0]) == 0xab && uint8(b[55]) == 0xab, "long string bytes wrong");
    }

    function it_decodes_uint_zero() {
        // 0x80 = empty string = integer 0 in RLP
        require(RLPDecode.decodeUint(hex"80") == 0, "uint 0 wrong");
    }

    function it_decodes_uint_127() {
        // 0x7f = single self-encoded byte = 127
        require(RLPDecode.decodeUint(hex"7f") == 127, "uint 127 wrong");
    }

    function it_decodes_uint_128() {
        // 0x81 0x80 = short string of length 1 containing byte 0x80 = 128
        require(RLPDecode.decodeUint(hex"8180") == 128, "uint 128 wrong");
    }

    function it_decodes_uint_1024() {
        // 0x82 0x04 0x00 = short string of length 2 containing 0x0400 = 1024
        require(RLPDecode.decodeUint(hex"820400") == 1024, "uint 1024 wrong");
    }

    function it_decodes_bytes32() {
        // 0xa0 = short string of length 32, then 32 bytes of 0xff
        bytes32 b = RLPDecode.decodeBytes32(hex"a0ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
        require(b == bytes32(hex"ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff"), "bytes32 mismatch");
    }

    function it_decodes_address() {
        // 0x94 = short string of length 20
        address a = RLPDecode.decodeAddress(hex"9413CB6AE34A13a0977F4d7101eBc24B87Bb23F0d5");
        require(a == address(0x13CB6AE34A13a0977F4d7101eBc24B87Bb23F0d5), "address mismatch");
    }

    // ============ Lists ============

    function it_decodes_empty_list() {
        bytes[] items = RLPDecode.decodeList(hex"c0");
        require(items.length == 0, "empty list length wrong");
    }

    function it_decodes_two_string_list() {
        // ["cat", "dog"] = 0xc8 [0x83 'c''a''t' 0x83 'd''o''g']
        // Total payload: 0x83 0x63 0x61 0x74 0x83 0x64 0x6f 0x67 = 8 bytes; prefix 0xc0 + 8 = 0xc8
        bytes[] items = RLPDecode.decodeList(hex"c88363617483646f67");
        require(items.length == 2, "list length wrong");
        bytes cat = RLPDecode.decodeBytes(items[0]);
        bytes dog = RLPDecode.decodeBytes(items[1]);
        require(cat.length == 3 && uint8(cat[0]) == 0x63, "cat wrong");
        require(dog.length == 3 && uint8(dog[2]) == 0x67, "dog wrong");
    }

    function it_decodes_nested_list() {
        // [[], [[]], [ [], [[]] ]]  -- the "set theoretic" example from the Yellow Paper.
        // Encoding: 0xc7 0xc0 0xc1 0xc0 0xc3 0xc0 0xc1 0xc0
        bytes[] items = RLPDecode.decodeList(hex"c7c0c1c0c3c0c1c0");
        require(items.length == 3, "outer list length wrong");
        // items[0] = [] = 0xc0
        require(items[0].length == 1 && uint8(items[0][0]) == 0xc0, "items[0] wrong");
        // items[1] = [[]] = 0xc1 0xc0
        bytes[] inner1 = RLPDecode.decodeList(items[1]);
        require(inner1.length == 1, "items[1] inner length wrong");
        require(RLPDecode.decodeList(inner1[0]).length == 0, "items[1][0] should be empty list");
    }

    function it_decodes_receipt_shape() {
        // Synthetic legacy-receipt shape: [status=1, gasUsed=42000, logsBloom=zeros, logs=[]]
        // status=1     : 0x01                  (1 byte, self-encoded)
        // gasUsed=42000: 0x82 0xa4 0x10        (3 bytes)
        // logsBloom    : 0xa0 || 32 zero bytes (33 bytes = short string of 32)
        //                Wait — real logs_bloom is 256 bytes; here we shorten for the unit test.
        //                Use 0x80 (empty string) instead so we can fit cleanly in the test.
        // logs=[]      : 0xc0                   (1 byte)
        // Payload: 0x01 0x82 0xa4 0x10 0x80 0xc0  = 6 bytes; prefix 0xc6
        bytes[] r = RLPDecode.decodeList(hex"c60182a41080c0");
        require(r.length == 4, "receipt shape: 4 fields");
        require(RLPDecode.decodeUint(r[0]) == 1, "status wrong");
        require(RLPDecode.decodeUint(r[1]) == 42000, "gasUsed wrong");
        require(RLPDecode.decodeBytes(r[2]).length == 0, "bloom wrong");
        require(RLPDecode.decodeList(r[3]).length == 0, "logs wrong");
    }
}
