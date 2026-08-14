// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../external/across/AcrossV4SpokePool.sol";
import "../../abstract/ERC20/ERC20.sol";
import "../../concrete/Bridge/MercataBridge.sol";

contract AcrossTestToken is ERC20 {
    constructor() ERC20("Across test token", "ATST") {}

    function mint(address to, uint amount) public {
        _mint(to, amount);
    }
}

contract AcrossFailingTestToken is AcrossTestToken {
    address public blockedRecipient;

    function setBlockedRecipient(address recipient) public {
        blockedRecipient = recipient;
    }

    function transfer(address to, uint value) public override returns (bool) {
        if (to == blockedRecipient) return false;
        return super.transfer(to, value);
    }
}

contract AcrossTestSignatureValidator {
    bytes32 public expectedHash;
    bytes32 public expectedSignatureHash;

    function setExpected(bytes32 digest, bytes signature) public {
        expectedHash = digest;
        expectedSignatureHash = keccak256(signature);
    }

    function isValidSignature(bytes32 digest, bytes signature) public view returns (bytes4) {
        if (digest == expectedHash && keccak256(signature) == expectedSignatureHash) {
            return bytes4(0x1626ba7e);
        }
        return bytes4(0xffffffff);
    }
}

contract AcrossRecipient {
    address public lastToken;
    uint public lastAmount;
    address public lastRelayer;
    bytes public lastMessage;

    function handleV3AcrossMessage(address token, uint amount, address relayer, bytes message) public {
        lastToken = token;
        lastAmount = amount;
        lastRelayer = relayer;
        lastMessage = message;
    }

    function claimRefund(AcrossV4SpokePool spoke, address token, address recipient) public {
        spoke.claimRelayerRefund(bytes32(uint(token)), bytes32(uint(recipient)));
    }
}

contract AcrossTestReturnBridge {
    uint public withdrawalCounter;
    uint public lastExternalChainId;
    address public lastExternalRecipient;
    address public lastExternalToken;
    address public lastStratoToken;
    uint public lastAmount;

    function requestWithdrawal(
        uint externalChainId,
        address externalRecipient,
        address externalToken,
        address stratoToken,
        uint stratoTokenAmount
    ) public returns (uint) {
        require(
            AcrossV4IERC20(stratoToken).transferFrom(msg.sender, address(this), stratoTokenAmount),
            "test bridge transfer failed"
        );
        lastExternalChainId = externalChainId;
        lastExternalRecipient = externalRecipient;
        lastExternalToken = externalToken;
        lastStratoToken = stratoToken;
        lastAmount = stratoTokenAmount;
        withdrawalCounter += 1;
        return withdrawalCounter;
    }
}

contract AcrossZeroIdReturnBridge {
    function requestWithdrawal(
        uint,
        address,
        address,
        address stratoToken,
        uint stratoTokenAmount
    ) public returns (uint) {
        require(
            AcrossV4IERC20(stratoToken).transferFrom(msg.sender, address(this), stratoTokenAmount),
            "zero-ID bridge transfer failed"
        );
        return 0;
    }
}

contract AcrossTestTokenFactory {
    function isTokenActive(address) public pure returns (bool) {
        return true;
    }
}

contract TestAcrossV4SpokePool is AcrossV4SpokePool {
    constructor(address initialAdmin) AcrossV4SpokePool(initialAdmin, 3600, 7200, 0) {}

    function makeLegacyRelay(
        address depositor,
        address recipient,
        address token,
        uint inputAmount,
        uint outputAmount,
        uint originChainId,
        uint32 depositId,
        uint32 fillDeadline,
        bytes message
    ) public pure returns (V3RelayDataLegacy memory) {
        return V3RelayDataLegacy({
            depositor: depositor,
            recipient: recipient,
            exclusiveRelayer: address(0),
            inputToken: token,
            outputToken: token,
            inputAmount: inputAmount,
            outputAmount: outputAmount,
            originChainId: originChainId,
            depositId: depositId,
            fillDeadline: fillDeadline,
            exclusivityDeadline: 0,
            message: message
        });
    }

    function referenceRelayHash() public pure returns (bytes32) {
        V3RelayData memory data = V3RelayData({
            depositor: bytes32(1),
            recipient: bytes32(2),
            exclusiveRelayer: bytes32(0),
            inputToken: bytes32(3),
            outputToken: bytes32(4),
            inputAmount: 100,
            outputAmount: 99,
            originChainId: 1,
            depositId: 7,
            fillDeadline: 1000,
            exclusivityDeadline: 0,
            message: bytes(hex"1234")
        });
        return computeV3RelayHash(data, 777);
    }

    function referenceUnsafeDepositId() public pure returns (uint) {
        return getUnsafeDepositId(
            address(0x123),
            bytes32(uint(0x456)),
            789
        );
    }

    function referenceUpdateDigest() public view returns (bytes32) {
        return getUpdateDepositTypedDataHash(
            7,
            1,
            98,
            bytes32(uint(0x222)),
            bytes(hex"1234")
        );
    }

    function referenceUpdateSigner() public view returns (address) {
        return recoverUpdateDepositSigner(
            referenceUpdateDigest(),
            bytes(hex"4a9782a894f2d25b880208937d0b3b001368cbe13c84c1d274486fe15a897c924fc2711feeaeea745066210a3abcfd3c12bacc4c7a9ae601adff84a63b479b811c")
        );
    }

    function referenceSlowFillHash() public pure returns (bytes32) {
        V3RelayData memory data = V3RelayData({
            depositor: bytes32(1),
            recipient: bytes32(2),
            exclusiveRelayer: bytes32(0),
            inputToken: bytes32(3),
            outputToken: bytes32(4),
            inputAmount: 100,
            outputAmount: 99,
            originChainId: 1,
            depositId: 7,
            fillDeadline: 1000,
            exclusivityDeadline: 0,
            message: bytes(hex"1234")
        });
        V3SlowFill memory slowFill = V3SlowFill({
            relayData: data,
            chainId: 777,
            updatedOutputAmount: 98
        });
        return hashV3SlowFill(slowFill);
    }

    function makeRefundLeaf(
        uint chain,
        address token,
        address refundA,
        address refundB
    ) public pure returns (RelayerRefundLeaf memory) {
        uint[] memory amounts = new uint[](2);
        amounts[0] = 100e18;
        amounts[1] = 50e18;
        address[] memory addresses = new address[](2);
        addresses[0] = refundA;
        addresses[1] = refundB;
        return RelayerRefundLeaf({
            amountToReturn: 0,
            chainId: chain,
            refundAmounts: amounts,
            leafId: 3,
            l2TokenAddress: token,
            refundAddresses: addresses
        });
    }

    function makeReturnLeaf(uint chain, address token, uint amount)
        public pure returns (RelayerRefundLeaf memory)
    {
        uint[] memory amounts = new uint[](0);
        address[] memory addresses = new address[](0);
        return RelayerRefundLeaf({
            amountToReturn: amount,
            chainId: chain,
            refundAmounts: amounts,
            leafId: 4,
            l2TokenAddress: token,
            refundAddresses: addresses
        });
    }

    function referenceRefundLeafHash() public pure returns (bytes32) {
        uint[] memory amounts = new uint[](2);
        amounts[0] = 100;
        amounts[1] = 50;
        address[] memory addresses = new address[](2);
        addresses[0] = address(0x111);
        addresses[1] = address(0x222);
        RelayerRefundLeaf memory leaf = RelayerRefundLeaf({
            amountToReturn: 0,
            chainId: 777,
            refundAmounts: amounts,
            leafId: 3,
            l2TokenAddress: address(0xabc),
            refundAddresses: addresses
        });
        return hashRelayerRefundLeaf(leaf);
    }

    function makeRelayData(
        bytes32 depositor,
        bytes32 recipient,
        address token,
        uint inputAmount,
        uint outputAmount,
        uint originChainId,
        uint depositId,
        uint32 fillDeadline,
        bytes message
    ) public pure returns (V3RelayData memory) {
        return V3RelayData({
            depositor: depositor,
            recipient: recipient,
            exclusiveRelayer: bytes32(0),
            inputToken: bytes32(uint(token)),
            outputToken: bytes32(uint(token)),
            inputAmount: inputAmount,
            outputAmount: outputAmount,
            originChainId: originChainId,
            depositId: depositId,
            fillDeadline: fillDeadline,
            exclusivityDeadline: 0,
            message: message
        });
    }

    function makeSlowFill(V3RelayData memory data, uint destinationChain, uint updatedOutputAmount)
        public pure returns (V3SlowFill memory)
    {
        return V3SlowFill({
            relayData: data,
            chainId: destinationChain,
            updatedOutputAmount: updatedOutputAmount
        });
    }
}

contract Describe_AcrossV4SpokePool {
    TestAcrossV4SpokePool spoke;
    AcrossTestToken token;
    AcrossRecipient recipient;
    AcrossRecipient refundA;
    AcrossRecipient refundB;

    function beforeEach() public {
        spoke = new TestAcrossV4SpokePool(address(this));
        token = new AcrossTestToken();
        recipient = new AcrossRecipient();
        refundA = new AcrossRecipient();
        refundB = new AcrossRecipient();
        token.mint(address(this), 1000e18);
        token.approve(address(spoke), 1000e18);
    }

    function deposit(uint inputAmount, uint outputAmount, bytes message) internal returns (uint depositId) {
        depositId = spoke.numberOfDeposits();
        uint nowTime = spoke.getCurrentTime();
        spoke.depositV3(
            address(this),
            address(recipient),
            address(token),
            address(token),
            inputAmount,
            outputAmount,
            block.chainid,
            address(0),
            uint32(nowTime),
            uint32(nowTime + 3600),
            0,
            message
        );
    }

    function relay(uint depositId, uint inputAmount, uint outputAmount, bytes message)
        internal view returns (AcrossV4SpokePool.V3RelayDataLegacy memory)
    {
        return spoke.makeLegacyRelay(
            address(this),
            address(recipient),
            address(token),
            inputAmount,
            outputAmount,
            block.chainid,
            uint32(depositId),
            uint32(spoke.getCurrentTime() + 3600),
            message
        );
    }

    function it_locks_a_permissionless_v3_deposit() public {
        uint depositId = deposit(100e18, 99e18, bytes(""));
        require(depositId == 0, "unexpected first deposit id");
        require(spoke.numberOfDeposits() == 1, "deposit counter not incremented");
        require(token.balanceOf(address(spoke)) == 100e18, "input tokens not locked");
    }

    function it_matches_the_evm_v4_relay_hash() public {
        require(
            spoke.referenceRelayHash() == bytes32(
                0x2526c71bb66005ad73a88ec7c129098509497f26e33ef9f623170ba2369827d2
            ),
            "SolidVM relay hash differs from Solidity ABI encoding"
        );
    }

    function it_matches_the_evm_unsafe_deposit_id() public {
        require(
            spoke.referenceUnsafeDepositId() == uint(
                0xafef90800443abcc4bc6f0043c7d84a2999c949d5d7459e7018cf9851565e5b0
            ),
            "SolidVM unsafe deposit ID differs from abi.encodePacked"
        );
    }

    function it_matches_the_evm_update_digest_and_recovers_the_signer() public {
        require(
            spoke.referenceUpdateDigest() == bytes32(
                0xcb8bbef89d9264255577b755758a7a8a2d77ca93474ea863c80349ff35dce0e1
            ),
            "SolidVM update typed-data digest differs from Across"
        );
        require(
            spoke.referenceUpdateSigner() == address(0x7e5f4552091a69125d5dfcb7b8c2659029395bdf),
            "SolidVM update signature recovery differs from Ethereum"
        );
    }

    function it_matches_the_evm_v3_slow_fill_hash() public {
        require(
            spoke.referenceSlowFillHash() == bytes32(
                0x7a0d13755994615071e952d5651e3ea4a5c67d846206c9dd1e7d334028e230b9
            ),
            "SolidVM slow-fill leaf hash differs from Solidity ABI encoding"
        );
    }

    function it_supports_deposit_now_and_deterministic_unsafe_deposits() public {
        uint currentTime = spoke.getCurrentTime();
        spoke.depositV3Now(
            address(this), address(recipient), address(token), address(token),
            10e18, 9e18, block.chainid, address(0), 3600, 0, bytes("")
        );
        require(spoke.numberOfDeposits() == 1, "depositNow did not consume safe ID");

        spoke.unsafeDeposit(
            bytes32(uint(address(this))), bytes32(uint(address(recipient))),
            bytes32(uint(address(token))), bytes32(uint(address(token))),
            5e18, 4e18, block.chainid, bytes32(0), 42,
            uint32(currentTime), uint32(currentTime + 3600), 0, bytes("")
        );
        require(spoke.numberOfDeposits() == 1, "unsafe deposit consumed safe ID");
        require(token.balanceOf(address(spoke)) == 15e18, "depositNow/unsafe funds not locked");
    }

    function it_fills_once_and_forwards_the_across_message() public {
        bytes memory message = bytes("swap-on-arrival");
        uint depositId = deposit(100e18, 99e18, message);
        AcrossV4SpokePool.V3RelayDataLegacy memory data = relay(depositId, 100e18, 99e18, message);

        spoke.fillV3Relay(data, block.chainid);

        require(token.balanceOf(address(recipient)) == 99e18, "recipient was not paid");
        require(recipient.lastToken() == address(token), "callback token mismatch");
        require(recipient.lastAmount() == 99e18, "callback amount mismatch");
        require(recipient.lastRelayer() == address(this), "callback relayer mismatch");
        require(keccak256(recipient.lastMessage()) == keccak256(message), "callback message mismatch");
        require(
            spoke.getFillStatusLegacy(data) == 2,
            "relay not marked filled"
        );

        bool replayRejected = false;
        try spoke.fillV3Relay(data, block.chainid) {
        } catch {
            replayRejected = true;
        }
        require(replayRejected, "relay replay was accepted");
    }

    function it_fills_a_depositor_signed_updated_deposit() public {
        AcrossTestSignatureValidator signer = new AcrossTestSignatureValidator();
        bytes memory originalMessage = bytes("original");
        bytes memory updatedMessage = bytes("updated");
        AcrossV4SpokePool.V3RelayData memory data = spoke.makeRelayData(
            bytes32(uint(address(signer))),
            bytes32(uint(address(refundA))),
            address(token),
            100e18,
            99e18,
            1,
            7,
            uint32(spoke.getCurrentTime() + 3600),
            originalMessage
        );
        // A contract signature may be 65 bytes without being an ECDSA tuple.
        // SignatureChecker must fall through to EIP-1271 instead of reverting
        // while attempting EOA recovery.
        bytes memory signature = new bytes(65);
        signature[0] = 1;
        bytes32 digest = spoke.getUpdateDepositTypedDataHash(
            data.depositId,
            data.originChainId,
            98e18,
            bytes32(uint(address(recipient))),
            updatedMessage
        );
        signer.setExpected(digest, signature);

        spoke.fillRelayWithUpdatedDeposit(
            data,
            block.chainid,
            bytes32(uint(address(this))),
            98e18,
            bytes32(uint(address(recipient))),
            updatedMessage,
            signature
        );

        require(token.balanceOf(address(recipient)) == 98e18, "updated recipient was not paid");
        require(recipient.lastAmount() == 98e18, "updated callback amount mismatch");
        require(keccak256(recipient.lastMessage()) == keccak256(updatedMessage), "updated callback mismatch");
    }

    function it_executes_a_proved_slow_fill_from_spoke_reserves() public {
        bytes memory message = bytes("slow-fill");
        AcrossV4SpokePool.V3RelayData memory data = spoke.makeRelayData(
            bytes32(uint(address(this))),
            bytes32(uint(address(recipient))),
            address(token),
            100e18,
            99e18,
            1,
            9,
            uint32(spoke.getCurrentTime() + 3600),
            message
        );
        AcrossV4SpokePool.V3SlowFill memory slowFill = spoke.makeSlowFill(
            data,
            block.chainid,
            100e18
        );
        bytes32 root = spoke.hashV3SlowFill(slowFill);
        spoke.relayRootBundle(bytes32(0), root);
        token.mint(address(spoke), 100e18);
        bytes32[] memory proof = new bytes32[](0);

        spoke.executeSlowRelayLeaf(slowFill, 0, proof);

        require(token.balanceOf(address(recipient)) == 100e18, "slow-fill recipient was not paid");
        require(spoke.getFillStatus(data) == 2, "slow fill not marked filled");
        require(recipient.lastAmount() == 100e18, "slow-fill callback amount mismatch");
    }

    function it_matches_the_evm_refund_leaf_hash() public {
        require(
            spoke.referenceRefundLeafHash() == bytes32(
                0xf1109eb532dbdeb367bbe6a631015dbf2c867c54cc3f0342aeca7febcacbbf65
            ),
            "SolidVM refund leaf hash differs from Solidity ABI encoding"
        );
    }

    function it_executes_a_refund_root_once() public {
        AcrossV4SpokePool.RelayerRefundLeaf memory leaf = spoke.makeRefundLeaf(
            block.chainid,
            address(token),
            address(refundA),
            address(refundB)
        );
        bytes32 leafHash = spoke.hashRelayerRefundLeaf(leaf);
        spoke.relayRootBundle(leafHash, bytes32(0));
        token.mint(address(spoke), 150e18);
        bytes32[] memory proof = new bytes32[](0);

        spoke.executeRelayerRefundLeaf(0, leaf, proof);
        require(token.balanceOf(address(refundA)) == 100e18, "first relayer not refunded");
        require(token.balanceOf(address(refundB)) == 50e18, "second relayer not refunded");

        bool replayRejected = false;
        try spoke.executeRelayerRefundLeaf(0, leaf, proof) {
        } catch {
            replayRejected = true;
        }
        require(replayRejected, "refund leaf replay accepted");
    }

    function it_defers_a_failed_refund_and_allows_claim_to_a_new_address() public {
        AcrossFailingTestToken failingToken = new AcrossFailingTestToken();
        failingToken.mint(address(spoke), 150e18);
        failingToken.setBlockedRecipient(address(refundA));
        AcrossV4SpokePool.RelayerRefundLeaf memory leaf = spoke.makeRefundLeaf(
            block.chainid,
            address(failingToken),
            address(refundA),
            address(refundB)
        );
        spoke.relayRootBundle(spoke.hashRelayerRefundLeaf(leaf), bytes32(0));
        bytes32[] memory proof = new bytes32[](0);

        spoke.executeRelayerRefundLeaf(0, leaf, proof);

        require(
            spoke.getRelayerRefund(address(failingToken), address(refundA)) == 100e18,
            "failed refund was not deferred"
        );
        require(failingToken.balanceOf(address(refundB)) == 50e18, "successful refund was not paid");

        failingToken.setBlockedRecipient(address(0));
        refundA.claimRefund(
            AcrossV4SpokePool(address(spoke)),
            address(failingToken),
            address(refundB)
        );
        require(spoke.getRelayerRefund(address(failingToken), address(refundA)) == 0, "claim not cleared");
        require(failingToken.balanceOf(address(refundB)) == 150e18, "deferred refund not redirected");
    }

    function it_queues_amount_to_return_through_an_exact_existing_bridge_route() public {
        AcrossTestReturnBridge bridge = new AcrossTestReturnBridge();
        address ethereumToken = address(0xeeee);
        address hubPoolRecipient = address(0x1234);
        spoke.setWithdrawalRecipient(hubPoolRecipient);
        spoke.setTokenReturnRoute(address(token), address(bridge), 1, ethereumToken);

        AcrossV4SpokePool.RelayerRefundLeaf memory leaf = spoke.makeReturnLeaf(
            block.chainid,
            address(token),
            25e18
        );
        spoke.relayRootBundle(spoke.hashRelayerRefundLeaf(leaf), bytes32(0));
        token.mint(address(spoke), 25e18);
        bytes32[] memory proof = new bytes32[](0);

        spoke.executeRelayerRefundLeaf(0, leaf, proof);

        require(token.balanceOf(address(spoke)) == 0, "return remained in spoke");
        require(token.balanceOf(address(bridge)) == 25e18, "bridge escrow mismatch");
        require(token.allowance(address(spoke), address(bridge)) == 0, "bridge allowance remained");
        require(bridge.lastExternalChainId() == 1, "external chain mismatch");
        require(bridge.lastExternalRecipient() == hubPoolRecipient, "HubPool recipient mismatch");
        require(bridge.lastExternalToken() == ethereumToken, "external token mismatch");
        require(bridge.lastStratoToken() == address(token), "STRATO token mismatch");
        require(bridge.lastAmount() == 25e18, "return amount mismatch");
        require(spoke.tokenReturnWithdrawalIds(0, 4) == 1, "withdrawal ID not recorded");
    }

    function it_fails_closed_when_amount_to_return_has_no_bridge_route() public {
        AcrossV4SpokePool.RelayerRefundLeaf memory leaf = spoke.makeReturnLeaf(
            block.chainid,
            address(token),
            1e18
        );
        spoke.relayRootBundle(spoke.hashRelayerRefundLeaf(leaf), bytes32(0));
        token.mint(address(spoke), 1e18);
        bytes32[] memory proof = new bytes32[](0);

        bool rejected = false;
        try spoke.executeRelayerRefundLeaf(0, leaf, proof) {
        } catch {
            rejected = true;
        }
        require(rejected, "unconfigured token return was accepted");
        require(!spoke.isRefundLeafClaimed(0, 4), "failed return consumed leaf");
        require(token.balanceOf(address(spoke)) == 1e18, "failed return moved tokens");
    }

    function it_queues_amount_to_return_in_the_real_mercata_bridge() public {
        AcrossTestTokenFactory tokenFactory = new AcrossTestTokenFactory();
        MercataBridge bridge = new MercataBridge(address(this));
        bridge.initialize(address(tokenFactory), address(0x1001), address(0x1002));
        bridge.setChain("Ethereum", address(0xc001), address(0xc002), true, 1, 0, address(0xc003));
        address ethereumToken = address(0xeeee);
        bridge.setAsset(
            true,
            1,
            18,
            "Ethereum test token",
            "ETST",
            ethereumToken,
            1000e18,
            address(token)
        );

        address hubPoolRecipient = address(0x1234);
        spoke.setWithdrawalRecipient(hubPoolRecipient);
        spoke.setTokenReturnRoute(address(token), address(bridge), 1, ethereumToken);
        AcrossV4SpokePool.RelayerRefundLeaf memory leaf = spoke.makeReturnLeaf(
            block.chainid,
            address(token),
            25e18
        );
        spoke.relayRootBundle(spoke.hashRelayerRefundLeaf(leaf), bytes32(0));
        token.mint(address(spoke), 25e18);
        bytes32[] memory proof = new bytes32[](0);

        spoke.executeRelayerRefundLeaf(0, leaf, proof);

        require(bridge.withdrawalCounter() == 1, "Mercata withdrawal was not queued");
        (
            ,,
            uint externalChainId,
            address externalRecipient,
            address returnedExternalToken,
            uint externalTokenAmount,
            ,
            address stratoSender,
            address stratoToken,
            uint stratoTokenAmount,,
        ) = bridge.withdrawals(1);
        require(externalChainId == 1, "Mercata withdrawal chain mismatch");
        require(externalRecipient == hubPoolRecipient, "Mercata HubPool recipient mismatch");
        require(returnedExternalToken == ethereumToken, "Mercata external token mismatch");
        require(externalTokenAmount == 25e18, "Mercata external amount mismatch");
        require(stratoSender == address(spoke), "Mercata sender is not SpokePool");
        require(stratoToken == address(token), "Mercata STRATO token mismatch");
        require(stratoTokenAmount == 25e18, "Mercata escrow amount mismatch");
        require(token.balanceOf(address(bridge)) == 25e18, "Mercata escrow balance mismatch");
        require(token.allowance(address(spoke), address(bridge)) == 0, "Mercata allowance remained");
    }

    function it_rolls_back_a_return_bridge_that_reports_a_zero_withdrawal_id() public {
        AcrossZeroIdReturnBridge bridge = new AcrossZeroIdReturnBridge();
        spoke.setTokenReturnRoute(address(token), address(bridge), 1, address(0xeeee));
        AcrossV4SpokePool.RelayerRefundLeaf memory leaf = spoke.makeReturnLeaf(
            block.chainid,
            address(token),
            2e18
        );
        spoke.relayRootBundle(spoke.hashRelayerRefundLeaf(leaf), bytes32(0));
        token.mint(address(spoke), 2e18);
        bytes32[] memory proof = new bytes32[](0);

        bool rejected = false;
        try spoke.executeRelayerRefundLeaf(0, leaf, proof) {
        } catch {
            rejected = true;
        }
        require(rejected, "zero withdrawal ID was accepted");
        require(!spoke.isRefundLeafClaimed(0, 4), "zero-ID return consumed leaf");
        require(token.balanceOf(address(spoke)) == 2e18, "zero-ID return moved SpokePool funds");
        require(token.balanceOf(address(bridge)) == 0, "zero-ID bridge retained funds");
        require(token.allowance(address(spoke), address(bridge)) == 0, "zero-ID approval survived revert");
    }

    function it_enforces_quote_and_fill_deadline_buffers() public {
        uint nowTime = spoke.getCurrentTime();
        bool rejected = false;
        try spoke.depositV3(
            address(this), address(recipient), address(token), address(token),
            1e18, 1e18, block.chainid, address(0),
            uint32(nowTime - 3601), uint32(nowTime + 3600), 0, bytes("")
        ) {
        } catch {
            rejected = true;
        }
        require(rejected, "stale quote was accepted");

        rejected = false;
        try spoke.depositV3(
            address(this), address(recipient), address(token), address(token),
            1e18, 1e18, block.chainid, address(0),
            uint32(nowTime), uint32(nowTime + 7201), 0, bytes("")
        ) {
        } catch {
            rejected = true;
        }
        require(rejected, "excessive fill deadline was accepted");
    }

    function it_requires_an_exclusive_relayer_for_an_exclusivity_window() public {
        uint nowTime = spoke.getCurrentTime();
        bool rejected = false;
        try spoke.depositV3(
            address(this), address(recipient), address(token), address(token),
            1e18, 1e18, block.chainid, address(0),
            uint32(nowTime), uint32(nowTime + 3600), 60, bytes("")
        ) {
        } catch {
            rejected = true;
        }
        require(rejected, "zero exclusive relayer accepted for exclusive deposit");
    }
}
