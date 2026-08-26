import "../../concrete/Bridge/EthBridgeIn.sol";
import "../../concrete/Bridge/EthLightClient.sol";
import "../../libraries/Bridge/IBridgeMintTarget.sol";

/// Admin-anchor a synthetic receipts root, as the other claim tests do.
contract TestableEthLightClient4 is EthLightClient {
    constructor(address owner_) EthLightClient(owner_) {}
    function adminAnchor(uint256 blockNumber, bytes32 receiptsRoot) external onlyOwner {
        anchored[blockNumber] = AnchoredHeader({
            blockNumber: blockNumber, receiptsRoot: receiptsRoot,
            stateRoot: bytes32(0), beaconSlot: uint64(0), timestamp: uint64(0)
        });
    }
}

/**
 * @notice Test seam for the claim-side match logic.
 *
 *         `fastFill` necessarily moves real tokens, so exercising the match
 *         rules through it would require a token deployed at the fixture's
 *         targetStratoToken -- an address the test cannot choose. Seeding the
 *         fill directly separates "does the transfer work" (covered via the
 *         real token below) from "does the claim honour the right fills",
 *         which is the logic under test here.
 */
contract TestableEthBridgeIn4 is EthBridgeIn {
    constructor(address owner_) EthBridgeIn(owner_) {}
    function seedFill(bytes32 key, address lp, address recipient, address tok, uint256 paid) external {
        fills[key] = Fill(lp, recipient, tok, paid);
    }
}

/// Records who the mint was credited to.
contract RecordingMintTarget4 is IBridgeMintTarget {
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public callCount;
    function creditTrustlessDeposit(
        bytes32, uint256, address, address,
        address stratoRecipient, address, uint256 amount
    ) external override {
        lastRecipient = stratoRecipient;
        lastAmount = amount;
        callCount = callCount + 1;
    }
}

/// Minimal transferFrom-capable token. Not declared `is IERC20` -- fastFill
/// only needs the address to answer the call.
contract TestToken4 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 v) external { balanceOf[to] = balanceOf[to] + v; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transferFrom(address f, address to, uint256 v) external returns (bool) {
        require(balanceOf[f] >= v, "TestToken4: balance");
        require(allowance[f][msg.sender] >= v, "TestToken4: allowance");
        allowance[f][msg.sender] = allowance[f][msg.sender] - v;
        balanceOf[f] = balanceOf[f] - v;
        balanceOf[to] = balanceOf[to] + v;
        return true;
    }
}

/**
 * @title  Describe_EthBridgeInFastFill
 * @notice Fast-fill: an LP pays the recipient before finality and is
 *         reimbursed the FULL deposit once it is proven.
 *
 *         The fixture is a V2 DepositRouted log (128-byte data, so maxFee is
 *         carried). It was produced by rebuilding the receipt RLP and the
 *         single-entry receipts trie; the same construction was first
 *         validated by reproducing, byte for byte, the V1 trie root already
 *         checked into EthBridgeInAssignment.test.sol.
 */
contract Describe_EthBridgeInFastFill {
    TestableEthLightClient4 lc;
    TestableEthBridgeIn4    bridge;
    RecordingMintTarget4    mintTarget;
    TestToken4              token;

    address constant ROUTER    = address(0xc0DE000000000000000000000000000000000001);
    address constant RECIPIENT = address(0x1563915e194D8CfBA1943570603F7606A3115508);
    address constant TARGET    = address(0x4444444444444444444444444444444444444444);
    address constant LP        = address(0x7777777777777777777777777777777777777777);
    uint256 constant AMOUNT    = 1234567890;
    uint256 constant MIN_PAY   = 1000000000; // AMOUNT - maxFee(234567890)

    function _sig() internal pure returns (bytes32) {
        return bytes32(hex"fc5b47f88f9cf2b26372a1037d51adf3e637958ea873f7eda09cc87c30687a9f");
    }
    function _root() internal pure returns (bytes32) {
        return bytes32(hex"86ce1f23ff13f23425b342454835a535e72bc4834fdd6fecf566a02bbf648ec0");
    }
    function _key() internal pure returns (bytes32) {
        return bytes32(hex"96978d2ffe5e466eb92c2b0739ea698694a16959991a1018df37cd6ced4e5e76");
    }
    function _receiptRlp() internal pure returns (bytes) { return hex"f9022a01825208b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f90120f9011d94c0de000000000000000000000000000000000001f884a0fc5b47f88f9cf2b26372a1037d51adf3e637958ea873f7eda09cc87c30687a9fa00000000000000000000000003333333333333333333333333333333333333333a00000000000000000000000001111111111111111111111111111111111111111a00000000000000000000000001563915e194d8cfba1943570603f7606a3115508b88000000000000000000000000000000000000000000000000000000000499602d200000000000000000000000044444444444444444444444444444444444444440000000000000000000000000000000000000000000000000000000000000063000000000000000000000000000000000000000000000000000000000dfb38d2"; }
    function _proof() internal pure returns (bytes[]) {
        bytes[] p = new bytes[](1); p[0] = hex"f90233822080b9022df9022a01825208b9010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f90120f9011d94c0de000000000000000000000000000000000001f884a0fc5b47f88f9cf2b26372a1037d51adf3e637958ea873f7eda09cc87c30687a9fa00000000000000000000000003333333333333333333333333333333333333333a00000000000000000000000001111111111111111111111111111111111111111a00000000000000000000000001563915e194d8cfba1943570603f7606a3115508b88000000000000000000000000000000000000000000000000000000000499602d200000000000000000000000044444444444444444444444444444444444444440000000000000000000000000000000000000000000000000000000000000063000000000000000000000000000000000000000000000000000000000dfb38d2"; return p;
    }
    function _none() internal pure returns (ClaimAssignment) {
        return ClaimAssignment({ depositKey: bytes32(0), newRecipient: address(0),
                                 deadline: uint256(0), v: uint8(0), r: bytes32(0), s: bytes32(0) });
    }

    function beforeEach() {
        lc = new TestableEthLightClient4(address(this));
        bridge = new TestableEthBridgeIn4(address(this));
        bridge.initialize(address(lc), uint256(11155111), ROUTER, _sig());
        mintTarget = new RecordingMintTarget4();
        bridge.setMintTarget(address(mintTarget));
        token = new TestToken4();
        lc.adminAnchor(uint256(1234), _root());
    }

    function _fillAs(address recipient, address tok, uint256 pay) internal {
        token.mint(address(this), pay);
        token.approve(address(bridge), pay);
        bridge.fastFill(_key(), recipient, tok, pay);
    }

    // ============ Decoding ============

    function it_decodes_maxFee_from_a_v2_log_and_pays_recipient_when_unfilled() {
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        require(mintTarget.lastRecipient() == RECIPIENT, "unfilled: recipient credited");
        require(mintTarget.lastAmount() == AMOUNT, "unfilled: full amount");
    }

    // ============ Happy path ============

    function it_reimburses_an_lp_that_paid_amount_minus_fee() {
        bridge.seedFill(_key(), LP, RECIPIENT, TARGET, MIN_PAY);
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        require(mintTarget.lastRecipient() == LP, "LP should be reimbursed");
        require(mintTarget.lastAmount() == AMOUNT, "LP gets the FULL deposit");
    }

    function it_reimburses_an_lp_that_overpaid() {
        bridge.seedFill(_key(), LP, RECIPIENT, TARGET, AMOUNT);
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        require(mintTarget.lastRecipient() == LP, "overpaying LP still reimbursed");
    }

    // ============ The else-branch: griefing guard ============

    function it_ignores_an_underpaying_fill_and_credits_the_real_recipient() {
        // One wei under the bound, so the depositor's maxFee does not cover it.
        bridge.seedFill(_key(), LP, RECIPIENT, TARGET, MIN_PAY - 1);
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        require(mintTarget.lastRecipient() == RECIPIENT, "dust fill must not lock out the recipient");
        require(mintTarget.lastAmount() == AMOUNT, "recipient still gets the full amount");
    }

    function it_ignores_a_fill_that_paid_the_wrong_recipient() {
        bridge.seedFill(_key(), LP, address(0xDEAD), TARGET, MIN_PAY);
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        require(mintTarget.lastRecipient() == RECIPIENT, "wrong-recipient fill ignored");
    }

    function it_ignores_a_fill_in_the_wrong_token() {
        bridge.seedFill(_key(), LP, RECIPIENT, address(0xBEEF), MIN_PAY);
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        require(mintTarget.lastRecipient() == RECIPIENT, "wrong-token fill ignored");
    }

    // ============ Negative paths ============

    function it_fastFill_pays_the_recipient_and_records_the_fill() {
        _fillAs(RECIPIENT, address(token), MIN_PAY);
        require(token.balanceOf(RECIPIENT) == MIN_PAY, "recipient paid up front");
    }

    function it_rejects_a_second_fill_for_the_same_deposit() {
        _fillAs(RECIPIENT, address(token), MIN_PAY);
        bool reverted = false;
        try {
            _fillAs(RECIPIENT, address(token), MIN_PAY);
        } catch {
            reverted = true;
        }
        require(reverted, "double fill should revert");
    }

    function it_rejects_a_fill_after_the_deposit_is_claimed() {
        bridge.claim(uint256(1234), uint256(0), uint256(0), _receiptRlp(), _proof(), _none());
        bool reverted = false;
        try {
            _fillAs(RECIPIENT, address(token), MIN_PAY);
        } catch {
            reverted = true;
        }
        require(reverted, "fill after claim should revert");
    }

    function it_rejects_a_fill_the_lp_has_not_approved() {
        token.mint(address(this), MIN_PAY);
        bool reverted = false;
        try {
            bridge.fastFill(_key(), RECIPIENT, address(token), MIN_PAY);
        } catch {
            reverted = true;
        }
        require(reverted, "unapproved fill should revert");
    }
}
