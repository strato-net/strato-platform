// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../external/across/AcrossV4UniversalSpoke.sol";
import "../../external/across/SP1HeliosSolidVM.sol";

contract UniversalMockSP1Verifier {
    function verifyProof(bytes32 programVKey, bytes memory publicValues, bytes memory proof) public view {
        require(programVKey == bytes32(5), "unexpected program vkey");
        require(publicValues.length == 544, "unexpected public values");
        require(keccak256(proof) == keccak256(bytes("proof")), "unexpected proof");
    }
}

contract UniversalMockHelios {
    mapping(bytes32 => bytes32) public values;
    mapping(bytes32 => mapping(address => bool)) public roles;
    uint public mockHeadTimestamp;
    bytes32 public mockProgramVkey;
    bytes32 public lastRole;
    address public lastRoleAccount;
    bool public lastRoleGranted;

    function setStorageSlot(bytes32 slot, bytes32 value) public {
        values[slot] = value;
    }

    function getStorageSlot(uint, address, bytes32 storageSlot) public view returns (bytes32) {
        return values[storageSlot];
    }

    function headTimestamp() public view returns (uint) {
        return mockHeadTimestamp;
    }

    function setHeadTimestamp(uint timestamp) public {
        mockHeadTimestamp = timestamp;
    }

    function grantRole(bytes32 role, address account) public {
        lastRole = role;
        lastRoleAccount = account;
        lastRoleGranted = true;
        roles[role][account] = true;
    }

    function revokeRole(bytes32 role, address account) public {
        roles[role][account] = false;
    }

    function renounceRole(bytes32 role, address account) public {
        require(account == msg.sender, "mock can only renounce self");
        roles[role][account] = false;
    }

    function updateHeliosProgramVkey(bytes32 newHeliosProgramVkey) public {
        mockProgramVkey = newHeliosProgramVkey;
    }
}

contract UniversalEmergencyCaller {
    function execute(AcrossV4UniversalSpoke spoke, bytes message) public {
        spoke.adminExecuteMessage(message);
    }
}

contract Describe_AcrossV4UniversalSpoke {
    SP1HeliosSolidVM helios;
    AcrossV4UniversalSpoke spoke;

    function beforeEach() public {
        UniversalMockSP1Verifier verifier = new UniversalMockSP1Verifier();
        helios = new SP1HeliosSolidVM(
            0, 0, bytes32(2), bytes32(3), bytes32(4), bytes32(5),
            12, 32, 8192, address(verifier), address(this), address(this), address(this)
        );
        spoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(helios), address(0xabc)
        );
    }

    function canonicalMessage() internal pure returns (bytes memory) {
        // abi.encode(address(0), abi.encodeCall(pauseDeposits, (true)))
        return bytes(hex"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024738b62e5000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000");
    }

    function canonicalPauseCall() internal pure returns (bytes memory) {
        return bytes(hex"738b62e50000000000000000000000000000000000000000000000000000000000000001");
    }

    function canonicalRootMessage() internal pure returns (bytes memory) {
        // abi.encode(address(0), abi.encodeCall(relayRootBundle, (0x111, 0x222)))
        return bytes(hex"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000044493a4f840000000000000000000000000000000000000000000000000000000000000111000000000000000000000000000000000000000000000000000000000000022200000000000000000000000000000000000000000000000000000000");
    }

    function canonicalWithdrawalMessage() internal pure returns (bytes memory) {
        // abi.encode(address(0), abi.encodeCall(setWithdrawalRecipient, (0xdef)))
        return bytes(hex"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000024fc8a584f0000000000000000000000000000000000000000000000000000000000000def00000000000000000000000000000000000000000000000000000000");
    }

    function canonicalReturnRouteMessage() internal pure returns (bytes memory) {
        // abi.encode(address(0), abi.encodeCall(setTokenReturnRoute,
        // (0x111, 0x222, 1, 0x333)))
        return bytes(hex"000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000084b7473550000000000000000000000000000000000000000000000000000000000000011100000000000000000000000000000000000000000000000000000000000002220000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000033300000000000000000000000000000000000000000000000000000000");
    }

    function externalGrantRoleMessage(address target, bytes32 role, address account)
        internal pure returns (bytes memory)
    {
        bytes memory spokeCall = externalGrantRoleCall(target, role, account);
        return bytes(bytes32(0))
            + bytes(bytes32(uint(64)))
            + bytes(bytes32(uint(spokeCall.length)))
            + spokeCall
            + new bytes(28);
    }

    function externalGrantRoleCall(address target, bytes32 role, address account)
        internal pure returns (bytes memory)
    {
        bytes memory heliosCall = bytes(hex"2f2ff15d")
            + bytes(role)
            + bytes(bytes32(uint(account)));
        bytes memory externalMessage = bytes(bytes32(uint(target)))
            + bytes(bytes32(uint(64)))
            + bytes(bytes32(uint(heliosCall.length)))
            + heliosCall
            + new bytes(28);
        bytes memory spokeCall = bytes(hex"7659f9e0")
            + bytes(bytes32(uint(32)))
            + bytes(bytes32(uint(externalMessage.length)))
            + externalMessage;
        return spokeCall;
    }

    function canonicalPublicValues() internal pure returns (bytes memory) {
        // The proved slot is HubPoolStore.relayMessageCallData[7], whose
        // value is keccak256(canonicalMessage()).
        return bytes(hex"0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000001200000000000000000000000000000000000000000000000000000000000000002870253054e3d98b71abec8fff9ebf8a15d167f15909091a800d4acaab9266d2bd990aa3acff62a373cf6c9d17fa2da1c321b1929abc773918e2ac38e5b4c0ffd0000000000000000000000000000000000000000000000000000000000000abc5b8b9143058ba3a137192c563ca6541845e62f0a2f9a667aac4db2fa3c334e3c8361030320812fe18a30227dce49002a052fa343acf922589256dba8d4f0c4d60000000000000000000000000000000000000000000000000000000000000abc");
    }

    function it_matches_the_evm_hub_pool_store_slot_key() public {
        require(
            spoke.getSlotKey(7) == bytes32(
                0x870253054e3d98b71abec8fff9ebf8a15d167f15909091a800d4acaab9266d2b
            ),
            "SolidVM HubPoolStore slot key differs from Solidity"
        );
    }

    function it_keeps_emergency_admin_and_settlement_roles_distinct() public {
        UniversalMockHelios mockHelios = new UniversalMockHelios();
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(0x111), address(0x222), address(0x333),
            3600, 7200, 0, 86400, address(mockHelios), address(0xabc)
        );
        require(localSpoke.owner() == address(0x111), "wrong emergency owner");
        require(localSpoke.crossDomainAdmin() == address(0x222), "wrong Ethereum admin");
        require(localSpoke.withdrawalRecipient() == address(0x333), "wrong withdrawal recipient");
    }

    function it_starts_deposits_and_fills_paused_until_ethereum_activation() public {
        require(spoke.pausedDeposits(), "deposits were open before Ethereum activation");
        require(spoke.pausedFills(), "fills were open before Ethereum activation");
    }

    function it_executes_an_ethereum_rooted_admin_message_once() public {
        helios.update(bytes("proof"), canonicalPublicValues());
        spoke.executeMessage(7, canonicalMessage(), 10);

        require(spoke.pausedDeposits(), "proved pause message was not executed");
        require(spoke.executedMessages(7), "message nonce was not consumed");

        bool replayRejected = false;
        try spoke.executeMessage(7, canonicalMessage(), 10) {
        } catch {
            replayRejected = true;
        }
        require(replayRejected, "proved admin message replay accepted");
    }

    function it_relays_an_ethereum_root_bundle() public {
        helios.update(bytes("proof"), canonicalPublicValues());
        spoke.executeMessage(8, canonicalRootMessage(), 10);

        require(spoke.rootBundleCount() == 1, "proved root bundle was not relayed");
        require(spoke.relayerRefundRoots(0) == bytes32(0x111), "refund root mismatch");
        require(spoke.slowRelayRoots(0) == bytes32(0x222), "slow root mismatch");
    }

    function it_dispatches_the_canonical_withdrawal_recipient_admin_selector() public {
        UniversalMockHelios mockHelios = new UniversalMockHelios();
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(mockHelios), address(0xabc)
        );
        bytes memory message = canonicalWithdrawalMessage();
        mockHelios.setStorageSlot(localSpoke.getSlotKey(9), keccak256(message));

        localSpoke.executeMessage(9, message, 10);

        require(localSpoke.withdrawalRecipient() == address(0xdef), "withdrawal recipient not updated");
    }

    function it_dispatches_an_ethereum_proved_token_return_route() public {
        UniversalMockHelios mockHelios = new UniversalMockHelios();
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(mockHelios), address(0xabc)
        );
        bytes memory message = canonicalReturnRouteMessage();
        mockHelios.setStorageSlot(localSpoke.getSlotKey(10), keccak256(message));

        localSpoke.executeMessage(10, message, 10);

        require(localSpoke.tokenReturnBridges(address(0x111)) == address(0x222), "bridge route mismatch");
        require(localSpoke.tokenReturnChainIds(address(0x111)) == 1, "return chain mismatch");
        require(
            localSpoke.tokenReturnExternalTokens(address(0x111)) == address(0x333),
            "external return token mismatch"
        );
    }

    function it_dispatches_the_canonical_helios_access_control_surface() public {
        UniversalMockHelios mockHelios = new UniversalMockHelios();
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(mockHelios), address(0xabc)
        );
        bytes32 role = bytes32(
            0x7f496d3b3a5b8d5d66b1301ac9407fb7ebb241c9fb60310446582db629b01709
        );
        bytes memory message = externalGrantRoleMessage(address(mockHelios), role, address(0xdef));
        mockHelios.setStorageSlot(localSpoke.getSlotKey(11), keccak256(message));

        localSpoke.executeMessage(11, message, 10);

        require(mockHelios.lastRole() == role, "wrong Helios role was dispatched");
        require(mockHelios.lastRoleAccount() == address(0xdef), "wrong Helios account was dispatched");
        require(mockHelios.lastRoleGranted(), "Helios role was not granted");
    }

    function it_administers_the_real_helios_port_after_role_handoff() public {
        UniversalMockSP1Verifier verifier = new UniversalMockSP1Verifier();
        SP1HeliosSolidVM realHelios = new SP1HeliosSolidVM(
            0, 0, bytes32(2), bytes32(3), bytes32(4), bytes32(5),
            12, 32, 8192, address(verifier), address(this), address(this), address(this)
        );
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(realHelios), address(0xabc)
        );
        realHelios.grantRole(bytes32(0), address(localSpoke));
        fastForward(86400);

        bytes32 role = realHelios.STATE_UPDATER_ROLE();
        localSpoke.adminExecuteMessage(
            externalGrantRoleCall(address(realHelios), role, address(0xdef))
        );

        require(realHelios.hasRole(role, address(0xdef)), "real Helios role was not granted");
    }

    function it_rejects_unproved_and_direct_admin_changes() public {
        helios.update(bytes("proof"), canonicalPublicValues());
        bytes memory changedMessage = canonicalMessage();
        changedMessage[159] = 1;

        bool rejected = false;
        try spoke.executeMessage(8, changedMessage, 10) {
        } catch {
            rejected = true;
        }
        require(rejected, "unproved admin message accepted");

        rejected = false;
        try spoke.pauseDeposits(true) {
        } catch {
            rejected = true;
        }
        require(rejected, "direct Universal Spoke admin call accepted");
    }

    function it_only_allows_emergency_dispatch_after_helios_is_stale() public {
        UniversalMockHelios mockHelios = new UniversalMockHelios();
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(mockHelios), address(0xabc)
        );
        mockHelios.setHeadTimestamp(block.timestamp);

        bool rejected = false;
        try localSpoke.adminExecuteMessage(canonicalPauseCall()) {
        } catch {
            rejected = true;
        }
        require(rejected, "emergency dispatch accepted a fresh Helios head");

        fastForward(86400);
        UniversalEmergencyCaller caller = new UniversalEmergencyCaller();
        rejected = false;
        try caller.execute(localSpoke, canonicalPauseCall()) {
        } catch {
            rejected = true;
        }
        require(rejected, "non-owner emergency dispatch was accepted");

        localSpoke.adminExecuteMessage(canonicalPauseCall());
        require(localSpoke.pausedDeposits(), "stale-Helios emergency pause was not executed");
    }

    function it_transfers_the_emergency_owner_without_changing_ethereum_admin() public {
        UniversalMockHelios mockHelios = new UniversalMockHelios();
        AcrossV4UniversalSpoke localSpoke = new AcrossV4UniversalSpoke(
            address(this), address(this), address(this),
            3600, 7200, 0, 86400, address(mockHelios), address(0xabc)
        );
        UniversalEmergencyCaller nextOwner = new UniversalEmergencyCaller();
        localSpoke.transferOwnership(address(nextOwner));

        require(localSpoke.owner() == address(nextOwner), "emergency owner was not transferred");
        require(localSpoke.crossDomainAdmin() == address(this), "Ethereum admin changed with owner");
    }
}
