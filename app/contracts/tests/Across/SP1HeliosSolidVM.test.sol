// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../external/across/SP1HeliosSolidVM.sol";

contract MockSP1VerifierSolidVM {
    function verifyProof(bytes32 programVKey, bytes memory publicValues, bytes memory proof) public view {
        require(programVKey == bytes32(5), "unexpected program vkey");
        require(publicValues.length == 448, "unexpected public values");
        require(keccak256(proof) == keccak256(bytes("proof")), "unexpected proof");
    }
}

contract UntrustedHeliosUpdater {
    function update(SP1HeliosSolidVM helios, bytes proof, bytes publicValues) public {
        helios.update(proof, publicValues);
    }
}

contract HeliosRoleAccount {}

contract Describe_SP1HeliosSolidVM {
    SP1HeliosSolidVM helios;
    MockSP1VerifierSolidVM verifier;

    function beforeEach() public {
        verifier = new MockSP1VerifierSolidVM();
        helios = new SP1HeliosSolidVM(
            0,
            0,
            bytes32(2),
            bytes32(3),
            bytes32(4),
            bytes32(5),
            12,
            32,
            8192,
            address(verifier),
            address(this),
            address(this),
            address(this)
        );
    }

    function canonicalPublicValues() internal pure returns (bytes memory) {
        return bytes(hex"0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000b000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000c000000000000000000000000000000000000000000000000000000000000000a00000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000120000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000001c800000000000000000000000000000000000000000000000000000000000003150000000000000000000000000000000000000000000000000000000000000abc");
    }

    function it_matches_the_evm_storage_key() public {
        require(
            helios.computeStorageKey(123, address(0xabc), bytes32(456)) == bytes32(
                0xb4683440604d3ca90fc3ec7d1c86677a0a608a142f9d6cdbd40d3978a8d87dad
            ),
            "SolidVM storage key differs from Solidity packed encoding"
        );
    }

    function it_returns_zero_for_an_unset_header() public {
        require(helios.headers(10) == bytes32(0), "unset Helios header is nonzero");
    }

    function it_decodes_canonical_public_values_and_stores_a_proved_slot() public {
        helios.update(bytes("proof"), canonicalPublicValues());

        require(helios.head() == 10, "head not updated");
        require(helios.headers(10) == bytes32(10), "header not stored");
        require(helios.executionStateRoots(10) == bytes32(11), "execution root not stored");
        require(helios.syncCommittees(1) == bytes32(12), "next sync committee not stored");
        require(
            helios.getStorageSlot(10, address(0xabc), bytes32(456)) == bytes32(789),
            "proved storage slot not stored"
        );
    }

    function it_rejects_an_unauthorized_updater() public {
        UntrustedHeliosUpdater untrusted = new UntrustedHeliosUpdater();
        bool rejected = false;
        try untrusted.update(helios, bytes("proof"), canonicalPublicValues()) {
        } catch {
            rejected = true;
        }
        require(rejected, "unauthorized Helios updater accepted");
    }

    function it_rejects_malformed_public_values() public {
        bool rejected = false;
        try helios.update(bytes("proof"), bytes(hex"00")) {
        } catch {
            rejected = true;
        }
        require(rejected, "malformed Helios public values accepted");
    }

    function it_matches_the_upstream_access_control_role_surface() public {
        require(
            helios.STATE_UPDATER_ROLE() == bytes32(
                0x7f496d3b3a5b8d5d66b1301ac9407fb7ebb241c9fb60310446582db629b01709
            ),
            "state updater role differs from upstream"
        );
        require(
            helios.VKEY_UPDATER_ROLE() == bytes32(
                0x07ecc55c8d82c6f82ef86e34d1905e0f2873c085733fa96f8a6e0316b050d174
            ),
            "vkey updater role differs from upstream"
        );
        require(helios.hasRole(bytes32(0), address(this)), "deployer admin role missing");
        require(helios.getRoleAdmin(helios.STATE_UPDATER_ROLE()) == bytes32(0), "wrong role admin");
        require(helios.getRoleMemberCount(bytes32(0)) == 1, "wrong initial admin count");
        require(helios.getRoleMember(bytes32(0), 0) == address(this), "wrong initial admin");

        HeliosRoleAccount nextAdmin = new HeliosRoleAccount();
        helios.grantRole(bytes32(0), address(nextAdmin));
        require(helios.hasRole(bytes32(0), address(nextAdmin)), "admin role not granted");
        require(helios.getRoleMemberCount(bytes32(0)) == 2, "admin was not enumerated");

        helios.revokeRole(bytes32(0), address(nextAdmin));
        require(!helios.hasRole(bytes32(0), address(nextAdmin)), "admin role not revoked");
        require(helios.getRoleMemberCount(bytes32(0)) == 1, "revoked admin still enumerated");

        bool rejected = false;
        try helios.renounceRole(bytes32(0), address(this)) {
        } catch {
            rejected = true;
        }
        require(rejected, "last Helios admin was removable");
    }
}
