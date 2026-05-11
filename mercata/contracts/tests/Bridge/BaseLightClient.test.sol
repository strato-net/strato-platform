import "../../concrete/Bridge/BaseLightClient.sol";
import "../../concrete/Bridge/EthLightClient.sol";
import "../../libraries/Bridge/ILightClient.sol";

/**
 * @notice Compile-check + revert-path tests for BaseLightClient.
 *         End-to-end Cannon-path tests live in
 *         BaseLightClientCannon.test.sol; parent-chain extension tests
 *         in BaseLightClientChain.test.sol.
 */
contract Describe_BaseLightClient {
    BaseLightClient bc;
    EthLightClient lc;
    address admin;

    /// Base Sepolia DisputeGameFactory address (placeholder for tests).
    address constant FACTORY = address(0xd6E6dBf4F7EA0ac412fD8b65ED297e64BB7a06E1);

    /// keccak256("DisputeGameCreated(address,uint32,bytes32)")
    function _dgcSig() private pure returns (bytes32) {
        return bytes32(hex"5b565efe82411da98814f356d0e7bcb8f0219b8d970307c5afb4a6903a8b2e35");
    }

    function beforeEach() {
        admin = address(this);
        lc = new EthLightClient(admin);
        bc = new BaseLightClient(admin);
        bc.initialize(address(lc), FACTORY, _dgcSig());
    }

    function it_initialize_stores_state() {
        require(address(bc.l1LightClient()) == address(lc), "l1 mismatch");
        require(bc.disputeGameFactory() == FACTORY, "factory mismatch");
        require(bc.disputeGameCreatedSig() == _dgcSig(), "sig mismatch");
    }

    function it_initialize_rejects_zero_l1() {
        BaseLightClient fresh = new BaseLightClient(admin);
        bool reverted = false;
        try {
            fresh.initialize(address(0), FACTORY, _dgcSig());
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero l1");
    }

    function it_initialize_rejects_zero_factory() {
        BaseLightClient fresh = new BaseLightClient(admin);
        bool reverted = false;
        try {
            fresh.initialize(address(lc), address(0), _dgcSig());
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero factory");
    }

    function it_initialize_rejects_zero_sig() {
        BaseLightClient fresh = new BaseLightClient(admin);
        bool reverted = false;
        try {
            fresh.initialize(address(lc), FACTORY, bytes32(0));
        } catch {
            reverted = true;
        }
        require(reverted, "should revert on zero sig");
    }

    function it_admin_can_set_factory() {
        address newFactory = address(0xc0DE000000000000000000000000000000000003);
        bc.setDisputeGameFactory(newFactory);
        require(bc.disputeGameFactory() == newFactory, "factory didn't update");
    }

    function it_admin_can_set_sig() {
        bytes32 newSig = bytes32(uint256(1));
        bc.setDisputeGameCreatedSig(newSig);
        require(bc.disputeGameCreatedSig() == newSig, "sig didn't update");
    }

    function it_unanchored_block_returns_zero() {
        require(bc.getReceiptsRoot(uint256(1234)) == bytes32(0), "should be zero");
        require(!bc.isAnchored(uint256(1234)), "should not be anchored");
    }

    function it_anchor_reverts_when_l1_block_not_anchored() {
        OutputReceiptProof memory proof = OutputReceiptProof({
            l1BlockNumber: uint256(999),
            txIndex: uint256(0),
            logIndex: uint256(0),
            receiptValueBytes: new bytes(0),
            mptProof: new bytes[](0)
        });
        bool reverted = false;
        try {
            bc.anchorBaseBlockViaCannon(proof, new bytes(0), bytes32(0));
        } catch {
            reverted = true;
        }
        require(reverted, "expected revert on un-anchored L1 block");
    }

    function it_implements_ilightclient_interface() {
        ILightClient ilc = ILightClient(address(bc));
        require(ilc.getReceiptsRoot(uint256(1)) == bytes32(0), "interface dispatch failed");
        require(!ilc.isAnchored(uint256(1)), "interface dispatch failed");
    }
}
