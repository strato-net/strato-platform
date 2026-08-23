// Command blockroots generates a fixture for
// EthLightClient.anchorBlockHeaderViaBlockRoots.
//
// That path proves the target's beacon root sits at
// state.block_roots[slot mod 8192] under the ATTESTED state root -- which the
// sync committee signs. So a fixture cannot reuse the real Sepolia attested
// header: forging a block_roots branch under a root you did not build is a
// sha256 preimage. The committee, the attested header and the beacon state are
// therefore synthetic, and everything downstream of them stays real: the
// target is the fixture's actual finalized header, and its execution payload,
// execution branch, block number and receipts root are the real ones.
//
// The contract cannot tell the difference. It verifies a real BLS aggregate
// over a real SSZ signing root, a real finality branch, and a real 19-level
// block_roots branch; only the keys behind them are ours.
//
//	go run ./cmd/blockroots > ../contracts/tests/Bridge/BlockRootsFixture.sol
package main

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"
	"os"

	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
)

// ---- SSZ ----

func h2(a, b [32]byte) [32]byte {
	s := sha256.New()
	s.Write(a[:])
	s.Write(b[:])
	var out [32]byte
	copy(out[:], s.Sum(nil))
	return out
}

func uint64Leaf(v uint64) [32]byte {
	var out [32]byte
	binary.LittleEndian.PutUint64(out[:8], v)
	return out
}

// merkleize pads to a power of two and returns the root plus every level, so
// a branch can be read off afterwards.
func merkleize(leaves [][32]byte) [][][32]byte {
	n := 1
	for n < len(leaves) {
		n <<= 1
	}
	level := make([][32]byte, n)
	copy(level, leaves)
	levels := [][][32]byte{level}
	for len(level) > 1 {
		next := make([][32]byte, len(level)/2)
		for i := range next {
			next[i] = h2(level[2*i], level[2*i+1])
		}
		levels = append(levels, next)
		level = next
	}
	return levels
}

// branchOf reads the sibling at each level for `index`, bottom-up -- the order
// SSZHashTree.verifyMerkleBranch consumes.
func branchOf(levels [][][32]byte, index int) [][32]byte {
	var br [][32]byte
	for d := 0; d+1 < len(levels); d++ {
		br = append(br, levels[d][index^1])
		index >>= 1
	}
	return br
}

func headerRoot(slot, proposer uint64, parent, state, body [32]byte) [32]byte {
	return merkleize([][32]byte{uint64Leaf(slot), uint64Leaf(proposer), parent, state, body})[3][0]
}

func forkDataRoot(forkVersion [4]byte, gvr [32]byte) [32]byte {
	var fv [32]byte
	copy(fv[:4], forkVersion[:])
	return h2(fv, gvr)
}

func computeDomain(domainType, forkVersion [4]byte, gvr [32]byte) [32]byte {
	fdr := forkDataRoot(forkVersion, gvr)
	var d [32]byte
	copy(d[:4], domainType[:])
	copy(d[4:], fdr[:28])
	return d
}

func mustHex(s string) [32]byte {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		panic("bad 32-byte hex: " + s)
	}
	var out [32]byte
	copy(out[:], b)
	return out
}

func main() {
	// ---- real values, from EthLightClientAnchor.test.sol ----
	const (
		finalizedSlot     = uint64(10182848)
		finalizedProposer = uint64(5)
		attestedSlot      = uint64(10182912)
		attestedProposer  = uint64(1446)
		signatureSlot     = uint64(10182913)
	)
	finalizedParent := mustHex("909769c65157a1f487b063a82330e1ce3d5f5a36360e34969ced0a2a00532ac7")
	finalizedState := mustHex("e982a9f9a9ec24790ac1172fbf7458ee48caabc8c9b2f1eb2adef4cce6618b09")
	finalizedBody := mustHex("71dda7e512b87a1cbedb14a58d771c20c15dca9eb84ea162f337b44678325d28")
	attestedParent := mustHex("900fee03dc258712f7da869abffcd8a6858a2e1f38cd304243bfab9ec90e4d5f")
	attestedBody := mustHex("29f9342b67f92ba2fe69832cafe1a5d384cbd0f68a4808c863a0d47636e23d49")
	gvr := mustHex("d8ea171f3c94aea21ebc42a1ed61052acf3f9209c00e4efbaaddac09ed9b8078")
	forkVersion := [4]byte{0x90, 0x00, 0x00, 0x75}
	domainSync := [4]byte{0x07, 0x00, 0x00, 0x00}

	// The target is the real finalized header.
	targetRoot := headerRoot(finalizedSlot, finalizedProposer, finalizedParent, finalizedState, finalizedBody)

	// ---- synthetic beacon state ----
	// block_roots: Vector[Root, 8192], field 5 of the state container.
	blockRoots := make([][32]byte, 8192)
	blockRoots[finalizedSlot%8192] = targetRoot
	brLevels := merkleize(blockRoots)
	brRoot := brLevels[len(brLevels)-1][0]

	// finalized_checkpoint: Container{epoch, root}, field 20 of the state.
	// finalizedRootIndex 41 == (20 << 1) | 1, so root is the second field.
	cpLevels := merkleize([][32]byte{uint64Leaf(finalizedSlot / 32), targetRoot})
	cpRoot := cpLevels[len(cpLevels)-1][0]

	// The state container itself: 64 leaves, depth 6.
	state := make([][32]byte, 64)
	state[5] = brRoot
	state[20] = cpRoot
	stLevels := merkleize(state)
	attestedState := stLevels[len(stLevels)-1][0]

	// Branches, bottom-up: inside the sub-tree, then up the container.
	blockRootsBranch := append(branchOf(brLevels, int(finalizedSlot%8192)), branchOf(stLevels, 5)...)
	finalityBranch := append(branchOf(cpLevels, 1), branchOf(stLevels, 20)...)

	// ---- synthetic sync committee, and a real signature from it ----
	attestedRoot := headerRoot(attestedSlot, attestedProposer, attestedParent, attestedState, attestedBody)
	domain := computeDomain(domainSync, forkVersion, gvr)
	signingRoot := h2(attestedRoot, domain)

	msg, err := bls.HashToG2(signingRoot[:], []byte("BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_"))
	if err != nil {
		panic(err)
	}
	_, _, g1, _ := bls.Generators()

	// 470 of 512 sign, matching the real fixture's participation rate.
	const signers = 470
	pubkeys := make([]bls.G1Affine, 512)
	var aggSk fr.Element
	participation := make([]byte, 64)
	for i := 0; i < 512; i++ {
		var sk fr.Element
		sk.SetBytes([]byte(fmt.Sprintf("strato-blockroots-fixture-key-%d", i)))
		var ski big.Int
		sk.BigInt(&ski)
		pubkeys[i].ScalarMultiplication(&g1, &ski)
		if i < signers {
			aggSk.Add(&aggSk, &sk)
			participation[i/8] |= 1 << (uint(i) % 8)
		}
	}
	var aggSkI big.Int
	aggSk.BigInt(&aggSkI)
	var sig bls.G2Affine
	sig.ScalarMultiplication(&msg, &aggSkI)

	// The whole committee's aggregate_pubkey, so the test can anchor by
	// subtracting the 42 absentees instead of summing 470 signers -- the
	// latter costs several times the test runner's gas.
	var allJ bls.G1Jac
	for i := range pubkeys {
		allJ.AddMixed(&pubkeys[i])
	}
	var aggAll bls.G1Affine
	aggAll.FromJacobian(&allJ)

	// ---- emit ----
	w := os.Stdout
	p := func(format string, a ...any) { fmt.Fprintf(w, format, a...) }
	p("// GENERATED by app/circuits/cmd/blockroots -- do not edit by hand.\n//\n")
	p("// Fixture for EthLightClient.anchorBlockHeaderViaBlockRoots.\n//\n")
	p("// The block_roots proof is verified against the ATTESTED state root, which\n")
	p("// the sync committee signs, so this cannot reuse the real Sepolia attested\n")
	p("// header -- forging a branch under a root you did not build is a sha256\n")
	p("// preimage. The committee, attested header and beacon state are synthetic;\n")
	p("// the target is the real finalized header and its execution payload,\n")
	p("// execution branch, block number and receipts root are the real ones.\n//\n")
	p("// The contract cannot tell: it checks a real BLS aggregate over a real SSZ\n")
	p("// signing root, a real finality branch and a real 19-level block_roots\n")
	p("// branch. Only the keys behind them are ours.\n\n")
	p("library BlockRootsFixture {\n")
	p("    function attestedStateRoot() internal pure returns (bytes32) { return bytes32(hex\"%x\"); }\n", attestedState)
	p("    function targetBeaconRoot() internal pure returns (bytes32) { return bytes32(hex\"%x\"); }\n", targetRoot)
	aggAllC := aggAll.Bytes()
	p("    /// aggregate_pubkey of the whole synthetic committee, so a test can\n")
	p("    /// anchor by subtracting the 42 absentees rather than summing 470.\n")
	p("    function committeeAggregate() internal pure returns (bytes) { return hex\"%x\"; }\n\n", aggAllC)

	p("    function participationBits() internal pure returns (bytes32[2]) {\n        return [\n")
	p("            bytes32(hex\"%x\"),\n            bytes32(hex\"%x\")\n        ];\n    }\n\n", participation[:32], participation[32:])

	sigC := sig.Bytes()
	p("    function signature() internal pure returns (bytes32[3]) {\n        return [\n")
	p("            bytes32(hex\"%x\"),\n            bytes32(hex\"%x\"),\n            bytes32(hex\"%x\")\n        ];\n    }\n\n",
		sigC[0:32], sigC[32:64], sigC[64:96])

	emitBranch := func(name string, br [][32]byte) {
		p("    function %s() internal pure returns (bytes32[]) {\n", name)
		p("        bytes32[] b = new bytes32[](%d);\n", len(br))
		for i, x := range br {
			p("        b[%d] = bytes32(hex\"%x\");\n", i, x)
		}
		p("        return b;\n    }\n\n")
	}
	emitBranch("blockRootsBranch", blockRootsBranch)
	emitBranch("finalityBranch", finalityBranch)

	p("    function committee() internal pure returns (bytes[]) {\n")
	p("        bytes[] pks = new bytes[](512);\n")
	for i := range pubkeys {
		c := pubkeys[i].Bytes()
		p("        pks[%d] = hex\"%x\";\n", i, c)
	}
	p("        return pks;\n    }\n")
	p("}\n")
}
