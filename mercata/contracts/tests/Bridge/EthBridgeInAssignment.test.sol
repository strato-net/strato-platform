import "../../concrete/Bridge/EthBridgeIn.sol";
import "../../concrete/Bridge/EthLightClient.sol";
import "../../libraries/Bridge/IBridgeMintTarget.sol";
import "../../libraries/Bridge/ILightClient.sol";

/**
 * @title  TestableEthLightClient2
 * @notice Same trick as in EthBridgeInClaim.test.sol — admin-anchor a
 *         synthetic receipts root so we can drive claim() without
 *         constructing a full LightClientFinalityUpdate.
 *         (Renamed to avoid name collisions across compilation units.)
 */
contract TestableEthLightClient2 is EthLightClient {
    constructor(address owner_) EthLightClient(owner_) {}
    function adminAnchor(uint256 blockNumber, bytes32 receiptsRoot, uint64 beaconSlot, uint64 timestamp) external onlyOwner {
        anchored[blockNumber] = AnchoredHeader({
            blockNumber: blockNumber,
            receiptsRoot: receiptsRoot,
            stateRoot: bytes32(0),
            beaconSlot: beaconSlot,
            timestamp: timestamp
        });
    }
}

/**
 * @title  RecordingMintTarget
 * @notice Records the recipient passed to creditTrustlessDeposit, so
 *         the assignment-redirect tests can assert that the right
 *         address ended up credited.
 */
contract RecordingMintTarget is IBridgeMintTarget {
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public callCount;
    function creditTrustlessDeposit(
        bytes32, uint256, address, address,
        address stratoRecipient, address, uint256 amount
    ) external override {
        lastRecipient = stratoRecipient;
        lastAmount    = amount;
        callCount     = callCount + 1;
    }
}

/**
 * @title  Describe_EthBridgeInAssignment
 * @notice E2E tests for EIP-712 claim assignment. All signature
 *         vectors are pre-computed offline by
 *         /Users/dustinnorwood/BlockApps/pbbo/mercata/ethereum/scripts/gen-assignment-test.js
 *         which uses ethers.js to sign with a known test private key.
 *
 *         The signing key derives address 0x1563915e194D8CfBA1943570603F7606A3115508
 *         which we use as the deposit's stratoRecipient (embedded in
 *         the synthetic receipt at topic[3] of the DepositRouted log).
 *         The contract's ecrecover() must return that same address
 *         when verifying a valid assignment from the recipient.
 */
contract Describe_EthBridgeInAssignment {

    TestableEthLightClient2 lc;
    EthBridgeIn             bridge;
    RecordingMintTarget     mintTarget;

    // ── Constants from gen-assignment-test.js ──────────────────────

    address constant ROUTER             = address(0xc0DE000000000000000000000000000000000001);
    address constant RECIPIENT          = address(0x1563915e194D8CfBA1943570603F7606A3115508); // signer
    address constant NEW_RECIPIENT      = address(0x9999999999999999999999999999999999999999);
    uint256 constant VALID_DEADLINE     = 9999999999;
    uint256 constant AMOUNT             = 1234567890;

    function _eventSig() internal pure returns (bytes32) {
        return bytes32(hex"55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750");
    }

    function _trieRoot() internal pure returns (bytes32) {
        return bytes32(hex"71b41ad2432a1c3525e4705f9493077a05c78453da94bea63cd3f8e3cf961f24");
    }

    function _receiptRlp() internal pure returns (bytes) {
        // Synthetic receipt with stratoRecipient = RECIPIENT (above).
        return hex"f9020801825208b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f8fff8fd94c0de000000000000000000000000000000000001f884a055426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750a00000000000000000000000003333333333333333333333333333333333333333a00000000000000000000000001111111111111111111111111111111111111111a00000000000000000000000001563915e194d8cfba1943570603f7606a3115508b86000000000000000000000000000000000000000000000000000000000499602d200000000000000000000000044444444444444444444444444444444444444440000000000000000000000000000000000000000000000000000000000000063";
    }

    function _proof() internal pure returns (bytes[]) {
        bytes[] p = new bytes[](1);
        p[0] = hex"f90211822080b9020bf9020801825208b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f8fff8fd94c0de000000000000000000000000000000000001f884a055426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750a00000000000000000000000003333333333333333333333333333333333333333a00000000000000000000000001111111111111111111111111111111111111111a00000000000000000000000001563915e194d8cfba1943570603f7606a3115508b86000000000000000000000000000000000000000000000000000000000499602d200000000000000000000000044444444444444444444444444444444444444440000000000000000000000000000000000000000000000000000000000000063";
        return p;
    }

    /// keccak256(abi.encode(11155111, 1234, 0, 0)) — must match the
    /// contract's depositKey computation for srcChainId/blockNumber/
    /// txIndex/logIndex = (11155111, 1234, 0, 0).
    function _depositKey() internal pure returns (bytes32) {
        return bytes32(hex"96978d2ffe5e466eb92c2b0739ea698694a16959991a1018df37cd6ced4e5e76");
    }

    function _validAssignment() internal pure returns (ClaimAssignment) {
        // Signed by RECIPIENT over (depositKey, NEW_RECIPIENT, VALID_DEADLINE).
        return ClaimAssignment({
            depositKey:   _depositKey(),
            newRecipient: NEW_RECIPIENT,
            deadline:     VALID_DEADLINE,
            v:            uint8(27),
            r:            bytes32(hex"5fb63956dd0ca7d6a2a82748f1b4a6f07fcdc93fa4dd7d25711d01e43c97918d"),
            s:            bytes32(hex"36884565c1b969490ad732db9f55163052079d047465dd09540d0908641ef773")
        });
    }

    function _wrongSignerAssignment() internal pure returns (ClaimAssignment) {
        // Signed by an ATTACKER key over the same (depositKey, NEW_RECIPIENT, VALID_DEADLINE).
        return ClaimAssignment({
            depositKey:   _depositKey(),
            newRecipient: NEW_RECIPIENT,
            deadline:     VALID_DEADLINE,
            v:            uint8(28),
            r:            bytes32(hex"6f1f3ca7cd73756c0bc0eba5e95e452dc8200b3f65b64675b186bb868ee069b4"),
            s:            bytes32(hex"68dba5d3b3ace3dbe8f2468a18ee373153101745760c6ff68580ae0969afb420")
        });
    }

    function _expiredAssignment() internal pure returns (ClaimAssignment) {
        // Signed by RECIPIENT over (depositKey, NEW_RECIPIENT, deadline=0).
        return ClaimAssignment({
            depositKey:   _depositKey(),
            newRecipient: NEW_RECIPIENT,
            deadline:     uint256(0),
            v:            uint8(27),
            r:            bytes32(hex"b0927c21bf591906de211ee025ac8dc33608335bc75a7f0441d7bb5992514afd"),
            s:            bytes32(hex"147bb83616d31fbd5b3cec718105f2bb669e567aa5b2550c3af4767d9ddb3339")
        });
    }

    function _wrongDepositKeyAssignment() internal pure returns (ClaimAssignment) {
        // Signed by RECIPIENT over a DIFFERENT depositKey but submitted
        // here with the real depositKey - the contract must reject.
        // The signature is valid for (otherKey, NEW_RECIPIENT, deadline);
        // we put the real depositKey into the struct so the on-chain
        // depositKey-equality check fires first.
        return ClaimAssignment({
            depositKey:   bytes32(hex"abc765a5a201e5881f2a9bccbdeae445849a9bef2484bd6b9b07ea1f549e9b94"),
            newRecipient: NEW_RECIPIENT,
            deadline:     VALID_DEADLINE,
            v:            uint8(28),
            r:            bytes32(hex"843ad70f4f67d17cc40c0779de707a95e9eaeeb9b2968546ce40da3f34b1118f"),
            s:            bytes32(hex"5f8c4533b409251fd7af9105788b8df7a67818c74364f4a2be72a29373eaa491")
        });
    }

    function beforeEach() {
        lc = new TestableEthLightClient2(address(this));
        bridge = new EthBridgeIn(
            address(this),
            ILightClient(address(lc)),
            uint256(11155111),
            ROUTER,
            _eventSig()
        );
        mintTarget = new RecordingMintTarget();
        bridge.setMintTarget(address(mintTarget));
        lc.adminAnchor(uint256(1234), _trieRoot(), uint64(0), uint64(0));
    }

    // ============ Happy path: redirect ============

    function it_claim_with_valid_assignment_redirects_to_new_recipient() {
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _validAssignment());
        require(mintTarget.callCount() == 1, "callback should fire once");
        require(mintTarget.lastRecipient() == NEW_RECIPIENT, "credit should redirect to NEW_RECIPIENT");
        require(mintTarget.lastAmount() == AMOUNT, "amount mismatch");
    }

    // ============ Negative paths ============

    function it_claim_with_expired_assignment_reverts() {
        bool reverted = false;
        try {
            bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _expiredAssignment());
        } catch {
            reverted = true;
        }
        require(reverted, "expired assignment should revert");
    }

    function it_claim_with_wrong_signer_reverts() {
        bool reverted = false;
        try {
            bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _wrongSignerAssignment());
        } catch {
            reverted = true;
        }
        require(reverted, "wrong-signer assignment should revert");
    }

    function it_claim_with_mismatched_depositKey_reverts() {
        bool reverted = false;
        try {
            bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _wrongDepositKeyAssignment());
        } catch {
            reverted = true;
        }
        require(reverted, "mismatched-depositKey assignment should revert");
    }
}
