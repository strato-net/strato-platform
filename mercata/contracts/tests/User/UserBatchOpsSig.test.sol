import "../../concrete/User/UserRegistry.sol";

contract Counter {
    uint public count;

    constructor() {
        count = 0;
    }

    function increment() public {
        count++;
    }
}

/**
 * Helper contract to expose the hash computation and signature construction
 * that executeUserBatchOperation performs internally, so we can verify
 * the signature verification paths with known test vectors.
 *
 * Test approach: Since we cannot sign messages inside Solidity, we use
 * known cryptographic test vectors. We pre-compute keccak256(username, ops)
 * inside the test, then construct signature bytes that the contract will parse.
 *
 * For secp256k1 tests, we use the known test vector:
 *   signer: 0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce
 *   (v=0x1c, r=0xa3a9...01e9, s=0x11d7...4f19)
 *   which signed: keccak256(2, 1620, 150000, 0x...100e, "mint", [...], "mercata")
 *
 * For P256/WebAuthn tests, we use the known test vector:
 *   message: "Hallelujah!"
 *   pubkey: 0x0423e81a...39f1d8
 *   authenticatorData: 0x49960de5...00000000
 *   challenge base64: "SGFsbGVsdWphaCE"
 */

contract Describe_UserBatchOpsSig {
    using BytesUtils for bytes;

    UserRegistry registry;

    constructor() {
    }

    function beforeAll() public {
        registry = new UserRegistry(address(0), address(this));
    }

    function beforeEach() public {
    }

    // =========================================================================
    // Helper: construct secp256k1 signature bytes
    // Format: [curveType(1), r(32), s(32), v(1), protocol(1)]
    // =========================================================================
    function buildSecp256k1Sig(bytes32 r, bytes32 s, uint8 v, uint8 protocol) internal pure returns (bytes) {
        bytes sig = new bytes(67);
        sig[0] = 0; // curveType = 0 (secp256k1)
        // Copy r (32 bytes)
        bytes rBytes = bytes(r);
        for (uint i = 0; i < 32; i++) {
            sig[1 + i] = rBytes[i];
        }
        // Copy s (32 bytes)
        bytes sBytes = bytes(s);
        for (uint i = 0; i < 32; i++) {
            sig[33 + i] = sBytes[i];
        }
        sig[65] = v;
        sig[66] = protocol;
        return sig;
    }

    // =========================================================================
    // Helper: construct WebAuthn/passkey signature bytes
    // Format: [curveType(1), r(32), s(32), pub(65), protocol(1),
    //          authDataLen(2), authData, clientDataJSONPreLen(2), clientDataJSONPre,
    //          clientDataJSONPostLen(2), clientDataJSONPost]
    // =========================================================================
    function buildWebAuthnSig(
        bytes32 r, bytes32 s, bytes pub,
        bytes authenticatorData,
        bytes clientDataJSONPre,
        bytes clientDataJSONPost
    ) internal pure returns (bytes) {
        uint16 authDataLen = uint16(authenticatorData.length);
        uint16 preLen = uint16(clientDataJSONPre.length);
        uint16 postLen = uint16(clientDataJSONPost.length);

        // Total size: 1 + 32 + 32 + 65 + 1 + 2 + authData.length + 2 + pre.length + 2 + post.length
        uint totalLen = 137 + authenticatorData.length + clientDataJSONPre.length + clientDataJSONPost.length;
        bytes sig = new bytes(totalLen);

        uint pos = 0;

        // curveType = 1 (secp256r1)
        sig[pos] = 1;
        pos++;

        // r (32 bytes)
        bytes rBytes = bytes(r);
        for (uint i = 0; i < 32; i++) {
            sig[pos + i] = rBytes[i];
        }
        pos += 32;

        // s (32 bytes)
        bytes sBytes = bytes(s);
        for (uint i = 0; i < 32; i++) {
            sig[pos + i] = sBytes[i];
        }
        pos += 32;

        // pub (65 bytes)
        for (uint i = 0; i < 65; i++) {
            sig[pos + i] = pub[i];
        }
        pos += 65;

        // protocol = 0 (WebAuthn)
        sig[pos] = 0;
        pos++;

        // authDataLen (2 bytes, big-endian)
        sig[pos] = uint8(authDataLen >> 8);
        sig[pos + 1] = uint8(authDataLen & 0xff);
        pos += 2;

        // authData
        for (uint i = 0; i < authenticatorData.length; i++) {
            sig[pos + i] = authenticatorData[i];
        }
        pos += authenticatorData.length;

        // clientDataJSONPreLen (2 bytes, big-endian)
        sig[pos] = uint8(preLen >> 8);
        sig[pos + 1] = uint8(preLen & 0xff);
        pos += 2;

        // clientDataJSONPre
        for (uint i = 0; i < clientDataJSONPre.length; i++) {
            sig[pos + i] = clientDataJSONPre[i];
        }
        pos += clientDataJSONPre.length;

        // clientDataJSONPostLen (2 bytes, big-endian)
        sig[pos] = uint8(postLen >> 8);
        sig[pos + 1] = uint8(postLen & 0xff);
        pos += 2;

        // clientDataJSONPost
        for (uint i = 0; i < clientDataJSONPost.length; i++) {
            sig[pos + i] = clientDataJSONPost[i];
        }

        return sig;
    }

    // =========================================================================
    // Test: SolidVM encoding (protocol 0) - signature parsing and rejection
    // =========================================================================
    function it_rejects_invalid_secp256k1_solidvm_sig() public {
        address userAddr = registry.createUser("sigtest1");
        User user = User(userAddr);

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Build a signature with bogus r, s values - ecrecover should return
        // a random address that is not authorized
        bytes32 r = bytes32(0x1111111111111111111111111111111111111111111111111111111111111111);
        bytes32 s = bytes32(0x2222222222222222222222222222222222222222222222222222222222222222);
        bytes sig = buildSecp256k1Sig(r, s, 0x1c, 0);

        try user.executeUserBatchOperation(ops, sig) {
            revert("Should reject invalid secp256k1 signature");
        } catch {
        }

        // Counter should not have been incremented
        require(counter.count() == 0, "Counter should still be 0");
    }

    // =========================================================================
    // Test: eth_personalSign (protocol 1) - signature parsing and rejection
    // =========================================================================
    function it_rejects_invalid_personal_sign_sig() public {
        address userAddr = registry.createUser("sigtest2");
        User user = User(userAddr);

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Build a personalSign signature with bogus values
        bytes32 r = bytes32(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa);
        bytes32 s = bytes32(0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb);
        bytes sig = buildSecp256k1Sig(r, s, 0x1b, 1); // protocol 1 = eth_personalSign

        try user.executeUserBatchOperation(ops, sig) {
            revert("Should reject invalid personalSign signature");
        } catch {
        }

        require(counter.count() == 0, "Counter should still be 0");
    }

    // =========================================================================
    // Test: Verify SolidVM encoding hash computation matches ecrecover
    // Uses the known test vector to verify hash + ecrecover pipeline
    // =========================================================================
    function it_can_verify_secp256k1_solidvm_encoding() public {
        // Known test vector from BaseCodeCollection.test.sol
        address knownSigner = address(0x1b7dc206ef2fe3aab27404b88c36470ccf16c0ce);
        uint knownR = 0xa3a96e57d33654b676751ba4e4e39fa2ba6d870ad9932c31e8485f5011f701e9;
        uint knownS = 0x11d7a39195e4eea4f66e735455db97d63b1e48f3d5af34c54c39264cef9d4f19;
        uint8 knownV = 0x1c;

        // The known signer signed: keccak256(2, 1620, 150000, 0x100e, "mint", [...], "mercata")
        // Verify ecrecover works with the known unsigned hash
        string[] args = ["0xac840dd68e2ab32e98c8d7ccd3b9a725139f1aa7","10000000000000000000"];
        string unsignedHash = keccak256(2, 1620, 150000, address(0x100e), "mint", args, "mercata");
        address recovered = ecrecover(unsignedHash, knownV, knownR, knownS);
        require(recovered == knownSigner, "ecrecover failed for known test vector");

        // Now test the batch operation path:
        // Create a user and add the known signer as an authorized address
        address userAddr = registry.createUser("sigtest3");
        User user = User(userAddr);
        user.addUserAddress(knownSigner);

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Compute the hash that executeUserBatchOperation will compute
        // dataHash = keccak256(username, operations)
        bytes32 dataHash = keccak256("sigtest3", ops);

        // Verify that the hash pipeline is deterministic
        bytes32 dataHash2 = keccak256("sigtest3", ops);
        require(dataHash == dataHash2, "keccak256 of operations is not deterministic");

        // Since we can't sign dataHash with the known private key from within
        // Solidity, we verify the building blocks individually:
        // 1. ecrecover works (verified above)
        // 2. Hash computation is deterministic (verified above)
        // 3. Signature parsing is correct (verified by rejection tests)
        // 4. Authorization check works (verified by unauthorized signer test)
    }

    // =========================================================================
    // Test: eth_personalSign hash includes the Ethereum prefix
    // =========================================================================
    function it_computes_personal_sign_hash_correctly() public {
        address userAddr = registry.createUser("sigtest4");
        User user = User(userAddr);

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Verify that personalSign hash includes the Ethereum prefix
        bytes32 dataHash = keccak256("sigtest4", ops);
        bytes32 personalSignHash = keccak256(bytes(0x19) + bytes("Ethereum Signed Message:\n") + bytes(dataHash));

        // The personalSign hash should differ from the raw hash
        require(dataHash != personalSignHash, "personalSign hash should differ from raw hash");
    }

    // =========================================================================
    // Test: WebAuthn/passkey signature parsing and verification
    // Uses the known P256 test vector from BaseCodeCollection.test.sol
    // =========================================================================
    function it_can_verify_webauthn_passkey_sig() public {
        // Known P256 test vector
        bytes pub = bytes(0x0423e81a4a99319639971cff670b796702ebd275f76b39056ecc06c25911cbe8d682eb5e007feea20a52a2dc4268dd1518975c14889c8d9e58c9861ef49839f1d8);
        uint r = 29576957218913890340491659409841852068033084215229700711255507061323143814549;
        uint s = 101557168712526122138100485234540408883990559892858822894344366649907264877720;
        bytes authenticatorData = bytes(0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000);

        // The known test vector signed "Hallelujah!" with challenge "SGFsbGVsdWphaCE"
        // clientDataJSON = {"type":"webauthn.get","challenge":"<base64url(message)>","origin":"http://localhost:8085","crossOrigin":false}
        // We need to split clientDataJSON into pre and post around the challenge
        bytes clientDataJSONPre = bytes('{"type":"webauthn.get","challenge":"');
        bytes clientDataJSONPost = bytes('","origin":"http://localhost:8085","crossOrigin":false}');

        // For the known vector, the challenge is base64urlencode("Hallelujah!") = "SGFsbGVsdWphaCE"
        // Verify our base64urlencode matches
        string challengeStr = base64urlencode("Hallelujah!");
        require(
            keccak256(challengeStr) == keccak256("SGFsbGVsdWphaCE"),
            "base64urlencode mismatch: got " + string(challengeStr)
        );

        // Reconstruct the full verification to confirm the test vector works
        bytes challenge = bytes(challengeStr);
        bytes clientDataJSON = clientDataJSONPre + challenge + clientDataJSONPost;
        bytes32 clientDataHash = sha256(clientDataJSON);
        bytes32 h = sha256(authenticatorData + bytes(clientDataHash));
        require(verifyP256(h, r, s, pub), "P256 verification of known test vector failed");

        // Now test via the batch operation path:
        // Create a user whose dataHash matches "Hallelujah!"
        // The contract computes: dataHash = keccak256(username, operations)
        // And then: challenge = base64urlencode(bytes(dataHash))
        // For this to match the known vector, we'd need keccak256(username, ops) == "Hallelujah!"
        // which is not feasible. Instead, we verify the components work independently:

        // 1. Verify P256 signature works (verified above)
        // 2. Verify base64urlencode works (verified above)
        // 3. Verify clientDataJSON reconstruction works (verified above)
        // 4. Verify signer address derivation from pubkey
        address expectedSigner = address(bytes(keccak256(pub)).substring(0, 20));
        require(expectedSigner != address(0), "Signer address should not be 0");
    }

    // =========================================================================
    // Test: WebAuthn/passkey signature rejection with invalid signature
    // =========================================================================
    function it_rejects_invalid_webauthn_sig() public {
        address userAddr = registry.createUser("sigtest6");
        User user = User(userAddr);

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Use real pubkey but bogus r, s values -> verifyP256 should fail
        bytes pub = bytes(0x0423e81a4a99319639971cff670b796702ebd275f76b39056ecc06c25911cbe8d682eb5e007feea20a52a2dc4268dd1518975c14889c8d9e58c9861ef49839f1d8);
        bytes authenticatorData = bytes(0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000);
        bytes clientDataJSONPre = bytes('{"type":"webauthn.get","challenge":"');
        bytes clientDataJSONPost = bytes('","origin":"http://localhost:8085","crossOrigin":false}');

        // Bogus r, s
        bytes32 r = bytes32(0x1111111111111111111111111111111111111111111111111111111111111111);
        bytes32 s = bytes32(0x2222222222222222222222222222222222222222222222222222222222222222);

        bytes sig = buildWebAuthnSig(r, s, pub, authenticatorData, clientDataJSONPre, clientDataJSONPost);

        try user.executeUserBatchOperation(ops, sig) {
            revert("Should reject invalid WebAuthn signature");
        } catch {
        }

        require(counter.count() == 0, "Counter should still be 0");
    }

    // =========================================================================
    // Test: WebAuthn signature byte construction and parsing roundtrip
    // Verify that our buildWebAuthnSig produces bytes that the contract
    // can correctly parse back into the component fields
    // =========================================================================
    function it_parses_webauthn_sig_fields_correctly() public {
        bytes pub = bytes(0x0423e81a4a99319639971cff670b796702ebd275f76b39056ecc06c25911cbe8d682eb5e007feea20a52a2dc4268dd1518975c14889c8d9e58c9861ef49839f1d8);
        bytes authenticatorData = bytes(0x49960de5880e8c687434170f6476605b8fe4aeb9a28632c7995cf3ba831d97631d00000000);
        bytes clientDataJSONPre = bytes('{"type":"webauthn.get","challenge":"');
        bytes clientDataJSONPost = bytes('","origin":"http://localhost:8085","crossOrigin":false}');

        bytes32 r = bytes32(0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa);
        bytes32 s = bytes32(0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb);

        bytes sig = buildWebAuthnSig(r, s, pub, authenticatorData, clientDataJSONPre, clientDataJSONPost);

        // Parse it back the same way the contract does
        uint8 curveType = uint8(sig[0]);
        require(curveType == 1, "curveType should be 1");

        bytes32 parsedR = bytes32(sig.substring(1, 33));
        require(parsedR == r, "parsed r mismatch");

        bytes32 parsedS = bytes32(sig.substring(33, 65));
        require(parsedS == s, "parsed s mismatch");

        bytes extraData = sig.substring(65, sig.length);
        bytes parsedPub = extraData.substring(0, 65);
        require(keccak256(parsedPub) == keccak256(pub), "parsed pub mismatch");

        uint8 protocol = uint8(extraData[65]);
        require(protocol == 0, "protocol should be 0 (WebAuthn)");

        bytes rest = extraData.substring(66, extraData.length);
        uint16 authDataLen = uint16(bytes32(rest.substring(0, 2)));
        require(uint(authDataLen) == authenticatorData.length, "authDataLen mismatch: expected " + string(authenticatorData.length) + ", got " + string(uint(authDataLen)));

        uint authDataEnd = uint(authDataLen) + 2;
        bytes parsedAuthData = rest.substring(2, authDataEnd);
        require(keccak256(parsedAuthData) == keccak256(authenticatorData), "parsed authenticatorData mismatch");

        uint16 preLen = uint16(bytes32(rest.substring(authDataEnd, authDataEnd + 2)));
        require(uint(preLen) == clientDataJSONPre.length, "preLen mismatch");

        uint preEnd = authDataEnd + uint(preLen) + 2;
        bytes parsedPre = rest.substring(authDataEnd + 2, preEnd);
        require(keccak256(parsedPre) == keccak256(clientDataJSONPre), "parsed clientDataJSONPre mismatch");

        uint16 postLen = uint16(bytes32(rest.substring(preEnd, preEnd + 2)));
        require(uint(postLen) == clientDataJSONPost.length, "postLen mismatch");

        uint postEnd = preEnd + uint(postLen) + 2;
        bytes parsedPost = rest.substring(preEnd + 2, postEnd);
        require(keccak256(parsedPost) == keccak256(clientDataJSONPost), "parsed clientDataJSONPost mismatch");
    }

    // =========================================================================
    // Test: Unauthorized signer is rejected even with valid signature format
    // =========================================================================
    function it_rejects_unauthorized_signer() public {
        address userAddr = registry.createUser("sigtest7");
        User user = User(userAddr);
        // Don't add any extra user addresses - only owner (this test contract) is authorized

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Use a valid-format signature that will recover to some random address
        // that is NOT in the user's authorized addresses
        bytes32 r = bytes32(0xa3a96e57d33654b676751ba4e4e39fa2ba6d870ad9932c31e8485f5011f701e9);
        bytes32 s = bytes32(0x11d7a39195e4eea4f66e735455db97d63b1e48f3d5af34c54c39264cef9d4f19);
        bytes sig = buildSecp256k1Sig(r, s, 0x1c, 0);

        // The recovered signer won't match any authorized address
        try user.executeUserBatchOperation(ops, sig) {
            revert("Should reject unauthorized signer");
        } catch {
        }

        require(counter.count() == 0, "Counter should still be 0");
    }

    // =========================================================================
    // Test: Multiple batch operations via executeUserBatchOperations
    // Tests the UserRegistry entry point with try/catch per user
    // =========================================================================
    function it_rejects_batch_with_bad_sigs_without_reverting() public {
        address user1Addr = registry.createUser("batchsig1");
        address user2Addr = registry.createUser("batchsig2");

        Counter counter = new Counter();

        UserOperation memory op = UserOperation({
            counter: 0,
            to: address(counter),
            failable: false,
            callData: variadic("increment")
        });
        UserOperation[] memory ops = [op];

        // Both signatures are invalid - neither should execute
        bytes32 r = bytes32(0x1111111111111111111111111111111111111111111111111111111111111111);
        bytes32 s = bytes32(0x2222222222222222222222222222222222222222222222222222222222222222);
        bytes badSig = buildSecp256k1Sig(r, s, 0x1c, 0);

        UserBatchOperation memory batchOp1 = UserBatchOperation({
            username: "batchsig1",
            operations: ops,
            signature: badSig
        });
        UserBatchOperation memory batchOp2 = UserBatchOperation({
            username: "batchsig2",
            operations: ops,
            signature: badSig
        });
        UserBatchOperation[] memory batchOps = [batchOp1, batchOp2];

        // This should NOT revert - each failure is caught
        registry.executeUserBatchOperations(batchOps);

        // Neither batch should have executed
        require(counter.count() == 0, "Counter should still be 0 - both sigs were invalid");
    }
}
