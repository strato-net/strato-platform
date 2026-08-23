// Command commitment computes the committee commitment for the 512 pubkeys
// embedded in a SolidVM test fixture, so the on-chain build can be pinned
// against it.
//
// EthLightClient.buildCommitteeCommitment walks the committee decompressing
// and absorbing; this does the same thing in Go, through gnark-crypto and the
// same packing the circuit uses. If the two ever disagree the only symptom
// on-chain would be proofs that never verify, so the agreement is asserted
// directly.
//
//	go run ./cmd/commitment ../contracts/tests/Bridge/EthLightClientAnchor.test.sol
package main

import (
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strconv"

	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
	bnfr "github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"

	circuits "github.com/blockapps/strato/app/circuits"
)

var pkLine = regexp.MustCompile(`pks\[(\d+)\]\s*=\s*hex"([0-9a-fA-F]{96})"`)

func main() {
	if len(os.Args) < 2 {
		panic("usage: commitment <fixture.sol>")
	}
	raw, err := os.ReadFile(os.Args[1])
	if err != nil {
		panic(err)
	}

	pks := make([][]byte, 512)
	for _, m := range pkLine.FindAllStringSubmatch(string(raw), -1) {
		idx, err := strconv.Atoi(m[1])
		if err != nil {
			panic(err)
		}
		if idx >= 512 {
			continue
		}
		b, err := hex.DecodeString(m[2])
		if err != nil {
			panic(err)
		}
		pks[idx] = b
	}
	for i, p := range pks {
		if p == nil {
			panic(fmt.Sprintf("fixture is missing pks[%d]", i))
		}
	}

	h := poseidon2.NewMerkleDamgardHasher()
	absorb := func(e bnfr.Element) {
		b := e.Bytes()
		if _, err := h.Write(b[:]); err != nil {
			panic(err)
		}
	}
	// Prefix digests too: the on-chain build absorbs a chunk per transaction,
	// so a test can only reach a prefix within one transaction's gas.
	marks := map[int]bool{1: true, 8: true, 64: true, 150: true, 512: true}
	for i, raw := range pks {
		var pt bls.G1Affine
		if _, err := pt.SetBytes(raw); err != nil {
			panic(fmt.Sprintf("pks[%d]: %v", i, err))
		}
		xlo, xhi := circuits.PackCoord(&pt.X)
		ylo, yhi := circuits.PackCoord(&pt.Y)
		absorb(xlo)
		absorb(xhi)
		absorb(ylo)
		absorb(yhi)
		if marks[i+1] {
			var d bnfr.Element
			d.SetBytes(h.Sum(nil))
			fmt.Printf("after %3d members: 0x%s\n", i+1, d.Text(16))
		}
	}
}
