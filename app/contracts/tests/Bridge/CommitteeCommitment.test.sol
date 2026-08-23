// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import "../../concrete/Bridge/EthLightClient.sol";
import "./EthLightClientAnchor.test.sol";

/// @notice Pins EthLightClient.buildCommitteeCommitment against the same
///         digest computed in Go, over the real Sepolia period-1243 committee.
///
///         This is the join between two independent implementations: the
///         contract decompresses and absorbs on-chain, gnark packs the same
///         coordinates in-circuit. A byte-offset or limb-order slip in either
///         would produce a commitment that simply never matches, and the only
///         symptom would be proofs that never verify -- so it is asserted
///         directly instead.
///
///         Digests from:
///             cd app/circuits && go run ./cmd/commitment \
///                 ../contracts/tests/Bridge/EthLightClientAnchor.test.sol
///
///         Only prefixes are checked: the full 512-member build costs several
///         times a transaction's gas budget, which is why it is chunked at
///         all. The loop absorbing member 151 is the same loop that absorbs
///         member 1.
contract Describe_CommitteeCommitment is Describe_EthLightClientAnchor {

    function _build(uint256 n) internal returns (uint256) {
        lc.buildCommitteeCommitment(_bootstrapPeriod(), n);
        (uint256 state, uint256 next) = lc.commitmentBuild(_bootstrapPeriod());
        require(next == n, "absorbed the wrong number of members");
        return state;
    }

    function it_absorbs_one_member_to_the_reference_digest() {
        require(
            _build(1) == 0x2c946b39207dcdb525d164174f4dde637df0832bba33f0e386e46a2f80562942,
            "digest after 1 member diverges from gnark"
        );
    }

    function it_absorbs_eight_members_to_the_reference_digest() {
        require(
            _build(8) == 0x2e2ecb5dc1bdc178b8e786aceefba25d7445a63adaa31c67f216562f367abac2,
            "digest after 8 members diverges from gnark"
        );
    }

    function it_absorbs_sixty_four_members_to_the_reference_digest() {
        require(
            _build(64) == 0x16447b138b551d7c220a6d1333e969d77e1df7797570e81798c298b1269b3ae5,
            "digest after 64 members diverges from gnark"
        );
    }

    /// Resuming must land on the same digest as absorbing in one go -- that is
    /// the whole premise of chunking the build.
    function it_resumes_across_chunks() {
        lc.buildCommitteeCommitment(_bootstrapPeriod(), 8);
        lc.buildCommitteeCommitment(_bootstrapPeriod(), 24);
        lc.buildCommitteeCommitment(_bootstrapPeriod(), 32);
        (uint256 state, uint256 next) = lc.commitmentBuild(_bootstrapPeriod());
        require(next == 64, "should have absorbed 64 members");
        require(
            state == 0x16447b138b551d7c220a6d1333e969d77e1df7797570e81798c298b1269b3ae5,
            "resumed digest differs from an unbroken one"
        );
    }

    /// The commitment stays zero until the whole committee is in, so a partial
    /// build cannot be mistaken for a usable one.
    function it_leaves_the_commitment_unset_while_incomplete() {
        lc.buildCommitteeCommitment(_bootstrapPeriod(), 64);
        require(lc.committeeCommitment(_bootstrapPeriod()) == 0, "commitment set before the build finished");
    }

    function it_refuses_a_period_with_no_committee() {
        bool reverted = false;
        try {
            lc.buildCommitteeCommitment(uint64(9999), 8);
        } catch {
            reverted = true;
        }
        require(reverted, "should refuse a period with no committee");
    }
}
