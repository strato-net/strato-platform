// Command sepolia builds an aggregation witness from the real Sepolia
// period-1243 committee and participation bitfield embedded in
// app/contracts/tests/Bridge/EthLightClientAnchor.test.sol, proves it, and
// writes the artifacts plonkgen's import mode consumes.
//
// This is the witness that matters: the aggregate it proves is the one the
// real sync-committee signature was made against, so a proof over it drives
// the on-chain BLS pairing rather than just verifying in isolation.
//
//	go run ./cmd/sepolia ../contracts/tests/Bridge/EthLightClientAnchor.test.sol out
package main

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	circuits "github.com/blockapps/strato/app/circuits"
	"github.com/consensys/gnark-crypto/ecc"
	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
	bnfr "github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"
	"github.com/consensys/gnark/backend/plonk"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/scs"
	"github.com/consensys/gnark/logger"
	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/test/unsafekzg"
)

var (
	pkLine   = regexp.MustCompile(`pks\[(\d+)\]\s*=\s*hex"([0-9a-fA-F]{96})"`)
	bitsLine = regexp.MustCompile(`bytes32\(hex"([0-9a-fA-F]{64})"\)`)
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func main() {
	logger.Disable()
	src, out := os.Args[1], os.Args[2]
	must(os.MkdirAll(out, 0o755))
	raw, err := os.ReadFile(src)
	must(err)

	// --- committee ---
	pks := make([]bls.G1Affine, 512)
	seen := 0
	for _, m := range pkLine.FindAllStringSubmatch(string(raw), -1) {
		i, err := strconv.Atoi(m[1])
		must(err)
		if i >= 512 {
			continue
		}
		b, err := hex.DecodeString(m[2])
		must(err)
		_, err = pks[i].SetBytes(b)
		must(err)
		seen++
	}
	if seen != 512 {
		panic(fmt.Sprintf("found %d pubkeys, need 512", seen))
	}

	// --- participation bitfield: the first two bytes32 literals in the file
	//     that sit inside _participationBits ---
	seg := string(raw)
	idx := strings.Index(seg, "function _participationBits")
	if idx < 0 {
		panic("no _participationBits in fixture")
	}
	ms := bitsLine.FindAllStringSubmatch(seg[idx:], 2)
	if len(ms) != 2 {
		panic("expected two bitfield chunks")
	}
	bitfield := make([]byte, 0, 64)
	for _, m := range ms {
		b, err := hex.DecodeString(m[1])
		must(err)
		bitfield = append(bitfield, b...)
	}

	// SSZ bitvector: byte b, bit i -> committee index 8b+i, least significant
	// bit first.
	signed := make([]bool, 512)
	nSigners := 0
	for i := 0; i < 512; i++ {
		if bitfield[i/8]&(1<<(uint(i)%8)) != 0 {
			signed[i] = true
			nSigners++
		}
	}
	fmt.Printf("committee 512, signers %d, absentees %d\n", nSigners, 512-nSigners)

	// --- the aggregate the signature was made against ---
	var accJ bls.G1Jac
	for i := 0; i < 512; i++ {
		if signed[i] {
			accJ.AddMixed(&pks[i])
		}
	}
	var agg bls.G1Affine
	agg.FromJacobian(&accJ)

	// --- packed bits, exactly as the circuit unpacks them ---
	words := make([]*big.Int, circuits.NbBitWords(512))
	for i := range words {
		words[i] = new(big.Int)
	}
	for i := 0; i < 512; i++ {
		if signed[i] {
			w := words[i/circuits.BitsPerWord]
			w.SetBit(w, i%circuits.BitsPerWord, 1)
		}
	}

	// --- commitment ---
	h := poseidon2.NewMerkleDamgardHasher()
	absorb := func(e bnfr.Element) { b := e.Bytes(); _, err := h.Write(b[:]); must(err) }
	for i := range pks {
		xlo, xhi := circuits.PackCoord(&pks[i].X)
		ylo, yhi := circuits.PackCoord(&pks[i].Y)
		absorb(xlo)
		absorb(xhi)
		absorb(ylo)
		absorb(yhi)
	}
	var comm bnfr.Element
	comm.SetBytes(h.Sum(nil))
	fmt.Printf("commitment 0x%s\n", comm.Text(16))
	fmt.Printf("aggregate  x=0x%s\n           y=0x%s\n", agg.X.Text(16), agg.Y.Text(16))

	// --- witness ---
	w := &circuits.AggregateCircuit{
		Pk:         make([]sw_emulated.AffinePoint[emulated.BLS12381Fp], 512),
		BitsPacked: make([]frontend.Variable, len(words)),
		Agg: sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](agg.X),
			Y: emulated.ValueOf[emulated.BLS12381Fp](agg.Y),
		},
		Comm: comm, N: 512, Unified: true, Commit: true, CommitY: true, OnCurve: false,
	}
	for i := range words {
		w.BitsPacked[i] = words[i]
	}
	for i := range pks {
		w.Pk[i] = sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](pks[i].X),
			Y: emulated.ValueOf[emulated.BLS12381Fp](pks[i].Y),
		}
	}

	t := time.Now()
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder,
		circuits.NewAggregate(512, true, true, true, false))
	must(err)
	fmt.Printf("compile %d constraints (%.1fs)\n", ccs.GetNbConstraints(), time.Since(t).Seconds())

	t = time.Now()
	srs, srsL, err := unsafekzg.NewSRS(ccs)
	must(err)
	fmt.Printf("srs (%.1fs)\n", time.Since(t).Seconds())
	pk, vk, err := plonk.Setup(ccs, srs, srsL)
	must(err)

	full, err := frontend.NewWitness(w, ecc.BN254.ScalarField())
	must(err)
	pub, err := full.Public()
	must(err)

	t = time.Now()
	proof, err := plonk.Prove(ccs, pk, full)
	must(err)
	fmt.Printf("prove (%.1fs)\n", time.Since(t).Seconds())
	must(plonk.Verify(proof, vk, pub))
	fmt.Println("native verify OK")

	f, err := os.Create(out + "/vk.bin")
	must(err)
	_, err = vk.WriteTo(f)
	must(err)
	f.Close()
	f, err = os.Create(out + "/proof.bin")
	must(err)
	_, err = proof.WriteTo(f)
	must(err)
	f.Close()

	vec := pub.Vector().(bnfr.Vector)
	strs := make([]string, len(vec))
	for i := range vec {
		strs[i] = vec[i].String()
	}
	j, err := json.MarshalIndent(strs, "", "  ")
	must(err)
	must(os.WriteFile(out+"/public.json", j, 0o644))
	fmt.Printf("wrote %s (%d public inputs)\n", out, len(strs))
}
