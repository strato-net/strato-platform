// Command historical generates a fixture for
// EthLightClient.anchorBlockHeaderViaHistoricalSummaries -- the path for
// deposits older than the 8192-slot block_roots window, roughly 27 hours.
//
// The branch is 45 levels and threads five trees:
//
//	bits [0..12]   slot mod 8192   inner block_roots vector      (13)
//	bit  [13]      0               block_summary_root, field 0    (1)
//	bits [14..37]  summaryIndex    historical_summaries data     (24)
//	bit  [38]      0               data side of the List          (1)
//	bits [39..44]  27              field in the BeaconState        (6)
//
// The depth-24 list tree is built sparsely: materialising it would be 16.7M
// leaves for one entry.
//
// Committee and participation match cmd/blockroots exactly, so the aggregate,
// the commitment and any proof over them are shared between the two fixtures.
// The target is the real finalized header, so its execution payload, execution
// branch, block number and receipts root stay real.
//
//	go run ./cmd/historical > ../contracts/tests/Bridge/HistoricalFixture.sol
package main

import (
	"fmt"
	"os"

	"github.com/blockapps/strato/app/circuits/sszfix"
)

// Shared with cmd/blockroots so both fixtures have the same committee.
const (
	committeeSeed = "strato-blockroots-fixture-key"
	committeeSize = 512
	signers       = 470
)

func main() {
	// Real values, from EthLightClientAnchor.test.sol.
	const (
		finalizedSlot     = uint64(10182848)
		finalizedProposer = uint64(5)
		attestedSlot      = uint64(10182912)
		attestedProposer  = uint64(1446)
		// Arbitrary. The contract does not cross-check it against the slot --
		// a wrong index simply fails to reach the state root, which is what
		// the negative test asserts.
		summaryIndex = uint64(1000)
		summaryCount = uint64(1001)
	)
	finalizedParent := sszfix.MustRoot("909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7")
	finalizedState := sszfix.MustRoot("e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09")
	finalizedBody := sszfix.MustRoot("71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28")
	attestedParent := sszfix.MustRoot("900fee03dc258712f7da869abffcd8a6858a2e1f38cd304243bfab9ec90e4d5f")
	attestedBody := sszfix.MustRoot("29f9342b67f92ba2fe69832cafe1a5d384cbd0f68a4808c863a0d47636e23d49")
	gvr := sszfix.MustRoot("d8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078")
	forkVersion := [4]byte{0x90, 0x00, 0x00, 0x75}
	domainSync := [4]byte{0x07, 0x00, 0x00, 0x00}

	target := sszfix.HeaderRoot(finalizedSlot, finalizedProposer, finalizedParent, finalizedState, finalizedBody)

	// 1. The period's block_roots vector, with the target in its slot.
	blockRoots := make([]sszfix.Root, 8192)
	blockRoots[finalizedSlot%8192] = target
	brLevels := sszfix.Merkleize(blockRoots)

	// 2. HistoricalSummary{block_summary_root, state_summary_root}. The proof
	//    takes field 0, so field 1 is free -- anything, as long as the branch
	//    carries it.
	stateSummaryRoot := sszfix.MustRoot("00000000000000000000000000000000000000000000000000000000deadbeef")
	hsRoot := sszfix.H2(sszfix.RootOf(brLevels), stateSummaryRoot)

	// 3. The historical_summaries List: a depth-24 data tree with one entry,
	//    then h2(data, length).
	listBranch, dataRoot := sszfix.SparseBranch(hsRoot, summaryIndex, 24)
	lengthLeaf := sszfix.Uint64Leaf(summaryCount)
	listRoot := sszfix.H2(dataRoot, lengthLeaf)

	// 4. finalized_checkpoint{epoch, root} at field 20; index 41 = (20<<1)|1.
	cpLevels := sszfix.Merkleize([]sszfix.Root{sszfix.Uint64Leaf(finalizedSlot / 32), target})

	// 5. The BeaconState container.
	state := make([]sszfix.Root, 64)
	state[20] = sszfix.RootOf(cpLevels)
	state[27] = listRoot
	stLevels := sszfix.Merkleize(state)
	attestedState := sszfix.RootOf(stLevels)

	// The 45-level branch, bottom-up.
	var historicalBranch []sszfix.Root
	historicalBranch = append(historicalBranch, sszfix.BranchOf(brLevels, int(finalizedSlot%8192))...) // 13
	historicalBranch = append(historicalBranch, stateSummaryRoot)                                      // 1
	historicalBranch = append(historicalBranch, listBranch...)                                         // 24
	historicalBranch = append(historicalBranch, lengthLeaf)                                            // 1
	historicalBranch = append(historicalBranch, sszfix.BranchOf(stLevels, 27)...)                      // 6
	if len(historicalBranch) != 45 {
		panic(fmt.Sprintf("branch is %d levels, want 45", len(historicalBranch)))
	}

	finalityBranch := append(sszfix.BranchOf(cpLevels, 1), sszfix.BranchOf(stLevels, 20)...)

	// Sign the attested header with the shared committee.
	attestedRoot := sszfix.HeaderRoot(attestedSlot, attestedProposer, attestedParent, attestedState, attestedBody)
	signingRoot := sszfix.H2(attestedRoot, sszfix.ComputeDomain(domainSync, forkVersion, gvr))
	c, err := sszfix.SignCommittee(committeeSeed, committeeSize, signers, signingRoot)
	if err != nil {
		panic(err)
	}

	w := os.Stdout
	p := func(format string, a ...any) { fmt.Fprintf(w, format, a...) }
	p("// GENERATED by app/circuits/cmd/historical -- do not edit by hand.\n//\n")
	p("// Fixture for EthLightClient.anchorBlockHeaderViaHistoricalSummaries: a\n")
	p("// 45-level branch threading the inner block_roots vector, a\n")
	p("// HistoricalSummary, the summaries List and the BeaconState container.\n//\n")
	p("// The committee, attested header and beacon state are synthetic -- the\n")
	p("// branch is verified against the attested state root, which the committee\n")
	p("// signs, so it has to be a state we built. The target is the real\n")
	p("// finalized header and its execution payload, execution branch, block\n")
	p("// number and receipts root are the real ones.\n//\n")
	p("// The committee matches cmd/blockroots, so BlockRootsProofFixture's proof\n")
	p("// covers this fixture too: an aggregate proof is over the committee and\n")
	p("// the bitfield, not over any particular header.\n\n")
	p("library HistoricalFixture {\n")
	p("    function attestedStateRoot() internal pure returns (bytes32) { return bytes32(hex\"%x\"); }\n", attestedState)
	p("    function summaryIndex() internal pure returns (uint64) { return uint64(%d); }\n", summaryIndex)
	p("    function committeeAggregate() internal pure returns (bytes) { return hex\"%x\"; }\n\n", c.Aggregate.Bytes())

	p("    function participationBits() internal pure returns (bytes32[2]) {\n        return [\n")
	p("            bytes32(hex\"%x\"),\n            bytes32(hex\"%x\")\n        ];\n    }\n\n", c.Participation[:32], c.Participation[32:])

	sig := c.Signature.Bytes()
	p("    function signature() internal pure returns (bytes32[3]) {\n        return [\n")
	p("            bytes32(hex\"%x\"),\n            bytes32(hex\"%x\"),\n            bytes32(hex\"%x\")\n        ];\n    }\n\n",
		sig[0:32], sig[32:64], sig[64:96])

	emit := func(name string, br []sszfix.Root) {
		p("    function %s() internal pure returns (bytes32[]) {\n", name)
		p("        bytes32[] b = new bytes32[](%d);\n", len(br))
		for i, x := range br {
			p("        b[%d] = bytes32(hex\"%x\");\n", i, x)
		}
		p("        return b;\n    }\n\n")
	}
	emit("historicalBranch", historicalBranch)
	emit("finalityBranch", finalityBranch)

	p("    function committee() internal pure returns (bytes[]) {\n")
	p("        bytes[] pks = new bytes[](%d);\n", committeeSize)
	for i := range c.Pubkeys {
		p("        pks[%d] = hex\"%x\";\n", i, c.Pubkeys[i].Bytes())
	}
	p("        return pks;\n    }\n}\n")
}
