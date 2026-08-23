// Command fixtures emits Poseidon2 test vectors from gnark-crypto so the
// SolidVM side can be pinned against them.
//
// The committee commitment that EthLightClient stores and the aggregation
// circuit re-derives must be the same hash, computed by two independent
// implementations in two languages. Nothing in either build catches a
// divergence, so the vectors below are checked into
// app/contracts/tests/General/poseidon2Interop.test.sol and asserted there.
package main

import (
	"fmt"

	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"
)

func el(v string) fr.Element {
	var e fr.Element
	if _, err := e.SetString(v); err != nil {
		panic(err)
	}
	return e
}

// mdHash mirrors gnark-crypto's Merkle-Damgard hasher: zero IV, one
// compression per input element, no length padding.
func mdHash(in []fr.Element) fr.Element {
	h := poseidon2.NewMerkleDamgardHasher()
	for _, e := range in {
		b := e.Bytes()
		if _, err := h.Write(b[:]); err != nil {
			panic(err)
		}
	}
	var out fr.Element
	out.SetBytes(h.Sum(nil))
	return out
}

func main() {
	perm := poseidon2.NewDefaultPermutation()

	fmt.Println("// --- poseidon2Compress(l, r) ---")
	for _, p := range [][2]string{{"0", "0"}, {"1", "2"}, {"7", "11"},
		{"21888242871839275222246405745257275088548364400416034343698204186575808495616", "1"}} {
		s := []fr.Element{el(p[0]), el(p[1])}
		if err := perm.Permutation(s); err != nil {
			panic(err)
		}
		r := el(p[1])
		var c fr.Element
		c.Add(&s[1], &r)
		fmt.Printf("compress(%s, %s) = %s\n", p[0], p[1], c.String())
	}

	fmt.Println("// --- poseidon2(x...) Merkle-Damgard ---")
	for _, in := range [][]string{
		{"0"},
		{"1"},
		{"1", "2"},
		{"1", "2", "3", "4"},
		{"12345678901234567890", "98765432109876543210", "5", "0", "7"},
	} {
		els := make([]fr.Element, len(in))
		for i, s := range in {
			els[i] = el(s)
		}
		h := mdHash(els)
		fmt.Printf("hash(%v) = %s\n", in, h.String())
	}
}

