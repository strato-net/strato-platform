// Package sszfix builds synthetic beacon-chain fixtures for the light
// client's state-proof paths.
//
// Those paths verify a Merkle branch against the ATTESTED state root, which
// the sync committee signs, so a fixture cannot borrow a real attested header:
// building a branch under a root you did not construct is a sha256 preimage.
// The committee, attested header and beacon state are therefore ours, and
// everything downstream of them stays real.
//
// Nothing about the verification is weakened by that. The contract checks a
// real BLS aggregate over a real SSZ signing root and real Merkle branches;
// only the keys behind them are ours.
package sszfix

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"math/big"

	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
)

// Root is a 32-byte SSZ node.
type Root = [32]byte

// H2 is the SSZ node combiner.
func H2(a, b Root) Root {
	s := sha256.New()
	s.Write(a[:])
	s.Write(b[:])
	var out Root
	copy(out[:], s.Sum(nil))
	return out
}

// Uint64Leaf is a uint64 SSZ-serialised into a leaf: little-endian, right-padded.
func Uint64Leaf(v uint64) Root {
	var out Root
	binary.LittleEndian.PutUint64(out[:8], v)
	return out
}

// MustRoot parses 32 bytes of hex.
func MustRoot(s string) Root {
	b, err := hex.DecodeString(s)
	if err != nil || len(b) != 32 {
		panic("sszfix: bad 32-byte hex: " + s)
	}
	var out Root
	copy(out[:], b)
	return out
}

// Merkleize pads to a power of two and returns every level, bottom-up, so a
// branch can be read off afterwards.
func Merkleize(leaves []Root) [][]Root {
	n := 1
	for n < len(leaves) {
		n <<= 1
	}
	level := make([]Root, n)
	copy(level, leaves)
	levels := [][]Root{level}
	for len(level) > 1 {
		next := make([]Root, len(level)/2)
		for i := range next {
			next[i] = H2(level[2*i], level[2*i+1])
		}
		levels = append(levels, next)
		level = next
	}
	return levels
}

// RootOf is the top of a Merkleize result.
func RootOf(levels [][]Root) Root { return levels[len(levels)-1][0] }

// BranchOf reads the sibling at each level for index, bottom-up -- the order
// SSZHashTree.verifyMerkleBranch consumes.
func BranchOf(levels [][]Root, index int) []Root {
	var br []Root
	for d := 0; d+1 < len(levels); d++ {
		br = append(br, levels[d][index^1])
		index >>= 1
	}
	return br
}

// ZeroHashes[d] is the root of an all-zero subtree of depth d.
func ZeroHashes(depth int) []Root {
	zs := make([]Root, depth+1)
	for d := 1; d <= depth; d++ {
		zs[d] = H2(zs[d-1], zs[d-1])
	}
	return zs
}

// SparseBranch is the branch and root for a tree of the given depth holding
// one non-zero leaf. Materialising the tree is not an option when the depth is
// 24 -- that is 16.7M leaves for one entry.
func SparseBranch(leaf Root, index uint64, depth int) ([]Root, Root) {
	zs := ZeroHashes(depth)
	br := make([]Root, depth)
	node := leaf
	for d := 0; d < depth; d++ {
		br[d] = zs[d]
		if (index>>uint(d))&1 == 1 {
			node = H2(zs[d], node)
		} else {
			node = H2(node, zs[d])
		}
	}
	return br, node
}

// HeaderRoot is hash_tree_root(BeaconBlockHeader).
func HeaderRoot(slot, proposer uint64, parent, state, body Root) Root {
	return RootOf(Merkleize([]Root{Uint64Leaf(slot), Uint64Leaf(proposer), parent, state, body}))
}

// ComputeDomain matches SSZHashTree.computeDomain.
func ComputeDomain(domainType, forkVersion [4]byte, gvr Root) Root {
	var fv Root
	copy(fv[:4], forkVersion[:])
	fdr := H2(fv, gvr)
	var d Root
	copy(d[:4], domainType[:])
	copy(d[4:], fdr[:28])
	return d
}

// Committee is a synthetic sync committee and its signature over one root.
type Committee struct {
	Pubkeys       []bls.G1Affine
	Aggregate     bls.G1Affine // aggregate_pubkey of all members
	Signature     bls.G2Affine // aggregate signature of the participating subset
	Participation []byte       // 64-byte SSZ bitvector
	Signers       int
}

// EthDST is the proof-of-possession DST every Ethereum validator signature
// uses, and the one BLSVerify hashes to.
const EthDST = "BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_"

// SignCommittee derives `size` keys from `seed`, has the first `signers` of
// them sign `signingRoot`, and returns the committee.
//
// Deriving from a seed rather than randomly means two fixtures built from the
// same seed share a committee -- and so share an aggregate, a commitment, and
// any proof over them.
func SignCommittee(seed string, size, signers int, signingRoot Root) (*Committee, error) {
	msg, err := bls.HashToG2(signingRoot[:], []byte(EthDST))
	if err != nil {
		return nil, err
	}
	_, _, g1, _ := bls.Generators()

	c := &Committee{
		Pubkeys:       make([]bls.G1Affine, size),
		Participation: make([]byte, size/8),
		Signers:       signers,
	}
	var aggSk fr.Element
	var allJ bls.G1Jac
	for i := 0; i < size; i++ {
		var sk fr.Element
		sk.SetBytes([]byte(fmt.Sprintf("%s-%d", seed, i)))
		var ski big.Int
		sk.BigInt(&ski)
		c.Pubkeys[i].ScalarMultiplication(&g1, &ski)
		allJ.AddMixed(&c.Pubkeys[i])
		if i < signers {
			aggSk.Add(&aggSk, &sk)
			c.Participation[i/8] |= 1 << (uint(i) % 8)
		}
	}
	c.Aggregate.FromJacobian(&allJ)
	var aggSkI big.Int
	aggSk.BigInt(&aggSkI)
	c.Signature.ScalarMultiplication(&msg, &aggSkI)
	return c, nil
}
