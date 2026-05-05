import "../../concrete/Bridge/EthBridgeIn.sol";
import "../../concrete/Bridge/EthLightClient.sol";

/**
 * @title  TestableEthLightClient
 * @notice Test-only subclass of EthLightClient that exposes a direct
 *         anchor function. It bypasses the BLS / SSZ verification
 *         path so we can drive EthBridgeIn.claim() against synthetic
 *         receipts trees without having to construct a full
 *         LightClientFinalityUpdate.
 *
 *         Production deploys plain EthLightClient — never this. The
 *         contract is in this *.test.sol file only so it doesn't live
 *         in concrete/.
 */
contract TestableEthLightClient is EthLightClient {
    constructor(address owner_) EthLightClient(owner_) {}

    /// Test-only direct anchor. Never call this in production.
    function adminAnchor(
        uint256 blockNumber,
        bytes32 receiptsRoot,
        uint64 beaconSlot,
        uint64 timestamp
    ) external onlyOwner {
        anchored[blockNumber] = AnchoredHeader({
            blockNumber: blockNumber,
            receiptsRoot: receiptsRoot,
            beaconSlot: beaconSlot,
            timestamp: timestamp
        });
    }
}

/**
 * @title Describe_EthBridgeInClaim
 * @notice End-to-end test for EthBridgeIn.claim() against a
 *         synthetic-but-realistic receipt + single-leaf MPT proof.
 *         All bytes were generated offline by ethers.js (see
 *         the corresponding scripts/build-claim-test.js).
 *
 *         Synthetic shape:
 *           - 1-tx block with 1 receipt
 *           - That receipt has 1 log (DepositRouted) emitted by the
 *             configured router
 *           - txIndex = 0, logIndex = 0
 *           - MPT key = rlp(0) = 0x80; the entire trie is one leaf
 */
contract Describe_EthBridgeInClaim {

    TestableEthLightClient lc;
    EthBridgeIn            bridge;

    // ── Constants from build-claim-test.js ──────────────────────────

    address constant ROUTER             = address(0xc0DE000000000000000000000000000000000001);
    address constant ETH_TOKEN          = address(0x3333333333333333333333333333333333333333);
    address constant ETH_SENDER         = address(0x1111111111111111111111111111111111111111);
    address constant STRATO_RECIPIENT   = address(0x2222222222222222222222222222222222222222);
    address constant TARGET_STRATO_TOK  = address(0x4444444444444444444444444444444444444444);
    uint256 constant AMOUNT             = 1234567890;
    uint96  constant DEPOSIT_ID         = 99;

    function _eventSig() internal pure returns (bytes32) {
        // keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
        return bytes32(hex"55426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750");
    }

    function _trieRoot() internal pure returns (bytes32) {
        return bytes32(hex"fb207d551ac896319954055fe9ccf06f9017237cb43243b7a6df88aaabe4b256");
    }

    function _receiptRlp() internal pure returns (bytes) {
        // Legacy receipt RLP: [status=1, cumGasUsed=21000, logsBloom=0..0, logs=[log]]
        return hex"f9020801825208b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f8fff8fd94c0de000000000000000000000000000000000001f884a055426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750a00000000000000000000000003333333333333333333333333333333333333333a00000000000000000000000001111111111111111111111111111111111111111a00000000000000000000000002222222222222222222222222222222222222222b86000000000000000000000000000000000000000000000000000000000499602d200000000000000000000000044444444444444444444444444444444444444440000000000000000000000000000000000000000000000000000000000000063";
    }

    function _proof() internal pure returns (bytes[]) {
        bytes[] p = new bytes[](1);
        // Single-leaf trie node = rlp([HP_path=0x2080, receiptRlp]).
        p[0] = hex"f90211822080b9020bf9020801825208b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f8fff8fd94c0de000000000000000000000000000000000001f884a055426533b384af6fcfee0e834a6407e3ffc370a0b1b53400c4e6ec92d7f1f750a00000000000000000000000003333333333333333333333333333333333333333a00000000000000000000000001111111111111111111111111111111111111111a00000000000000000000000002222222222222222222222222222222222222222b86000000000000000000000000000000000000000000000000000000000499602d200000000000000000000000044444444444444444444444444444444444444440000000000000000000000000000000000000000000000000000000000000063";
        return p;
    }

    function beforeEach() {
        lc = new TestableEthLightClient(address(this));
        // SolidVM doesn't auto-upcast from the derived class reference;
        // pass via address+cast so the constructor sees EthLightClient.
        bridge = new EthBridgeIn(
            address(this),
            EthLightClient(address(lc)),
            uint256(11155111),
            ROUTER,
            _eventSig()
        );
        // Anchor the synthetic receipts root at block 1234 directly.
        lc.adminAnchor(uint256(1234), _trieRoot(), uint64(0), uint64(0));
    }

    function it_claim_verifies_synthetic_deposit_end_to_end() {
        // Just running claim() to completion is the core success
        // signal: every internal require has to pass for claim() to
        // return without reverting (MPT proof, log address, event
        // sig, dedup, decode). The dedup bookkeeping itself is
        // separately checked by it_claim_dedups_repeat_attempts.
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof());
    }

    function it_claim_dedups_repeat_attempts() {
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof());

        bool reverted = false;
        try {
            bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof());
        } catch {
            reverted = true;
        }
        require(reverted, "second claim should revert (dedup)");
    }

    function it_claim_rejects_log_from_wrong_router() {
        // Reset the router to something that doesn't match the log's address.
        bridge.setDepositRouter(address(0xdead));

        bool reverted = false;
        try {
            bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof());
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when router doesn't match");
    }

    function it_claim_rejects_wrong_event_sig() {
        bridge.setDepositRoutedSig(bytes32(uint256(1)));
        bool reverted = false;
        try {
            bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof());
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when event sig doesn't match");
    }
}
