import "../../concrete/Bridge/EthBridgeIn.sol";
import "../../concrete/Bridge/EthLightClient.sol";
import "../../libraries/Bridge/ILightClient.sol";

/**
 * @title Describe_EthBridgeIn
 * @notice Baseline tests for EthBridgeIn: compiles, constructs, admin
 *         setters work, claim() rejects unanchored blocks. The full
 *         e2e (real Sepolia receipt + DepositRouted log + MPT proof
 *         verification) is its own larger test that lives separately
 *         once we have the proof bytes in hand.
 */
contract Describe_EthBridgeIn {

    EthLightClient lc;
    EthBridgeIn    bridge;
    address        admin;

    function _gvr() internal pure returns (bytes32) {
        return bytes32(hex"d8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078");
    }
    function _forkVersion() internal pure returns (bytes4) {
        return bytes4(0x90000075);
    }
    function _depositRouter() internal pure returns (address) {
        return address(0xc0DE000000000000000000000000000000000001);
    }
    function _eventSig() internal pure returns (bytes32) {
        // keccak256("DepositRouted(address,uint256,address,address,address,uint96)")
        // computed offline; SolidVM tests can't do it inline.
        return bytes32(hex"a9c98ee9d68a37e4f156dd3c5ea0c44ac4daca8fa5cbd44a523fbf9bb8b0a31a");
    }

    function beforeEach() {
        admin = address(this);
        lc = new EthLightClient(admin);
        bridge = new EthBridgeIn(admin);
        bridge.initialize(
            address(lc),
            uint256(11155111),       // Sepolia
            _depositRouter(),
            _eventSig()
        );
    }

    // ============ Construction / initialization ============

    function it_initialize_stores_state() {
        require(address(bridge.lightClient()) == address(lc), "lightClient mismatch");
        require(bridge.srcChainId() == 11155111, "srcChainId mismatch");
        require(bridge.depositRouter() == _depositRouter(), "router mismatch");
        require(bridge.depositRoutedSig() == _eventSig(), "sig mismatch");
    }

    function it_initialize_rejects_zero_lightclient() {
        EthBridgeIn fresh = new EthBridgeIn(admin);
        bool reverted = false;
        try {
            fresh.initialize(address(0), uint256(1), _depositRouter(), _eventSig());
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero lightClient");
    }

    function it_initialize_rejects_zero_router() {
        EthBridgeIn fresh = new EthBridgeIn(admin);
        bool reverted = false;
        try {
            fresh.initialize(address(lc), uint256(1), address(0), _eventSig());
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero router");
    }

    function it_initialize_rejects_zero_sig() {
        EthBridgeIn fresh = new EthBridgeIn(admin);
        bool reverted = false;
        try {
            fresh.initialize(address(lc), uint256(1), _depositRouter(), bytes32(0));
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero sig");
    }

    // ============ Admin ============

    function it_admin_can_set_router() {
        address newRouter = address(0xc0DE000000000000000000000000000000000002);
        bridge.setDepositRouter(newRouter);
        require(bridge.depositRouter() == newRouter, "router didn't update");
    }

    function it_admin_can_set_event_sig() {
        bytes32 newSig = bytes32(uint256(1));
        bridge.setDepositRoutedSig(newSig);
        require(bridge.depositRoutedSig() == newSig, "sig didn't update");
    }

    function it_only_owner_can_change_admin_settings() {
        // Deploy + initialize as us, then hand ownership to a third
        // party. After that, we (the test contract) are no longer the
        // owner; setDepositRouter must revert.
        EthBridgeIn unowned = new EthBridgeIn(admin);
        unowned.initialize(
            address(lc), uint256(1), _depositRouter(), _eventSig()
        );
        unowned.transferOwnership(address(0xdead));
        bool reverted = false;
        try {
            unowned.setDepositRouter(address(0xbeef));
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner setRouter should revert");
    }

    // ============ claim() preconditions ============

    function it_claim_reverts_when_block_not_anchored() {
        // Stub MPT proof; doesn't matter — the unanchored-block check
        // fires first.
        bytes[] proof = new bytes[](0);
        ClaimAssignment empty = ClaimAssignment({
            depositKey: bytes32(0), newRecipient: address(0), deadline: uint256(0),
            v: uint8(0), r: bytes32(0), s: bytes32(0)
        });
        bool reverted = false;
        try {
            bridge.claim(uint256(99999), uint256(0), uint256(0), hex"00", proof, empty);
        } catch {
            reverted = true;
        }
        require(reverted, "should revert when block not anchored");
    }
}
