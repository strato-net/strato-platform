package circuits

import (
	"fmt"
	"math/big"

	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fp"
	"github.com/consensys/gnark-crypto/ecc/bls12-381/fr"
	bnfr "github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/math/emulated"
)

// packX mirrors the in-circuit packing: 6 little-endian 64-bit limbs of the
// BLS12-381 X coordinate folded into two BN254 field elements.
func packCoord(c *fp.Element) (bnfr.Element, bnfr.Element) {
	var xi big.Int
	c.BigInt(&xi)
	limb := func(k int) *big.Int {
		return new(big.Int).And(new(big.Int).Rsh(&xi, uint(64*k)), new(big.Int).SetUint64(^uint64(0)))
	}
	sh := func(k int) *big.Int { return new(big.Int).Lsh(big.NewInt(1), uint(64*k)) }
	lo := new(big.Int).Add(limb(0), new(big.Int).Add(
		new(big.Int).Mul(limb(1), sh(1)), new(big.Int).Mul(limb(2), sh(2))))
	hi := new(big.Int).Add(limb(3), new(big.Int).Add(
		new(big.Int).Mul(limb(4), sh(1)), new(big.Int).Mul(limb(5), sh(2))))
	var a, b bnfr.Element
	a.SetBigInt(lo)
	b.SetBigInt(hi)
	return a, b
}

// BuildWitness produces a satisfying assignment for an n-member committee
// where the first `signers` members signed.
func BuildWitness(n, signers int, unified bool) (*AggregateCircuit, error) {
	_, _, g1, _ := bls.Generators()

	// Deterministic but unstructured scalars. Sequential multiples of G
	// are a bad committee for this circuit: the running accumulator hits
	// a later member exactly, and incomplete addition has no inverse.
	pks := make([]bls.G1Affine, n)
	for i := 0; i < n; i++ {
		var s fr.Element
		s.SetBytes([]byte(fmt.Sprintf("strato-bridge-committee-member-%d", i)))
		var si big.Int
		s.BigInt(&si)
		pks[i].ScalarMultiplication(&g1, &si)
	}

	// First `signers` members sign. Pack the bitfield the way the circuit
	// unpacks it: BitsPerWord bits per word, least-significant bit first.
	words := make([]*big.Int, NbBitWords(n))
	for i := range words {
		words[i] = new(big.Int)
	}
	var accJ bls.G1Jac
	for i := 0; i < n; i++ {
		if i < signers {
			words[i/BitsPerWord].SetBit(words[i/BitsPerWord], i%BitsPerWord, 1)
			accJ.AddMixed(&pks[i])
		}
	}
	bits := make([]frontend.Variable, len(words))
	for i, w := range words {
		bits[i] = w
	}
	var agg bls.G1Affine
	agg.FromJacobian(&accJ)

	h := poseidon2.NewMerkleDamgardHasher()
	wr := func(e bnfr.Element) error {
		b := e.Bytes()
		_, err := h.Write(b[:])
		return err
	}
	for i := 0; i < n; i++ {
		xlo, xhi := packCoord(&pks[i].X)
		ylo, yhi := packCoord(&pks[i].Y)
		for _, e := range []bnfr.Element{xlo, xhi, ylo, yhi} {
			if err := wr(e); err != nil {
				return nil, err
			}
		}
	}
	var comm bnfr.Element
	comm.SetBytes(h.Sum(nil))

	w := &AggregateCircuit{
		Pk:         make([]sw_emulated.AffinePoint[emulated.BLS12381Fp], n),
		BitsPacked: bits,
		Agg: sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](agg.X),
			Y: emulated.ValueOf[emulated.BLS12381Fp](agg.Y),
		},
		Comm:    comm,
		N:       n,
		Unified: unified,
		Commit:  true,
		CommitY: true,
		OnCurve: false,
	}
	for i := 0; i < n; i++ {
		w.Pk[i] = sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](pks[i].X),
			Y: emulated.ValueOf[emulated.BLS12381Fp](pks[i].Y),
		}
	}
	return w, nil
}
