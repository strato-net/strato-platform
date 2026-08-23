package circuits

import (
	"fmt"
	"math/big"

	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/hash/poseidon2"
	"github.com/consensys/gnark/std/math/emulated"
)

// AggregateCircuit is boundary A: prove that `Agg` is the sum of the committee
// members selected by `Bits`, against a committee pinned by `Comm`.
//
// The pubkeys are private witness. `Comm` is the on-chain commitment to
// them, so the prover cannot substitute a committee. No subgroup check:
// the points are fully determined by the commitment, so membership is a
// property of the committed data rather than something a prover picks.
type AggregateCircuit struct {
	Pk   []sw_emulated.AffinePoint[emulated.BLS12381Fp]
	Bits []frontend.Variable                          `gnark:",public"`
	Agg  sw_emulated.AffinePoint[emulated.BLS12381Fp] `gnark:",public"`
	Comm frontend.Variable                            `gnark:",public"`

	N       int
	Unified bool // complete addition instead of generator-seeded incomplete
	Commit  bool // include the commitment hashing
	CommitY bool // commit to Y too, pinning the sign of every key
	OnCurve bool // assert each key satisfies the curve equation
}

func (c *AggregateCircuit) Define(api frontend.API) error {
	crv, err := sw_emulated.New[emulated.BLS12381Fp, emulated.BLS12381Fr](api, sw_emulated.GetBLS12381Params())
	if err != nil {
		return err
	}
	fp, err := emulated.NewField[emulated.BLS12381Fp](api)
	if err != nil {
		return err
	}

	// --- subset aggregation ---
	var acc *sw_emulated.AffinePoint[emulated.BLS12381Fp]
	if c.Unified {
		// (0,0) is gnark's encoding of the point at infinity for AddUnified.
		zero := sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](0),
			Y: emulated.ValueOf[emulated.BLS12381Fp](0),
		}
		acc = &zero
	} else {
		// Seed with the generator so incomplete addition never sees a
		// zero denominator, then subtract it back off at the end.
		acc = crv.Generator()
	}

	for i := 0; i < c.N; i++ {
		if c.OnCurve {
			crv.AssertIsOnCurve(&c.Pk[i])
		}
		var sum *sw_emulated.AffinePoint[emulated.BLS12381Fp]
		if c.Unified {
			sum = crv.AddUnified(acc, &c.Pk[i])
		} else {
			sum = crv.Add(acc, &c.Pk[i])
		}
		acc = crv.Select(c.Bits[i], sum, acc)
	}
	if !c.Unified {
		acc = crv.Add(acc, crv.Neg(crv.Generator()))
	}
	crv.AssertIsEqual(acc, &c.Agg)

	// --- committee commitment ---
	if c.Commit {
		h, err := poseidon2.New(api)
		if err != nil {
			return err
		}
		shift := new(big.Int).Lsh(big.NewInt(1), 64)
		shift2 := new(big.Int).Lsh(big.NewInt(1), 128)
		pack := func(e *emulated.Element[emulated.BLS12381Fp]) (frontend.Variable, frontend.Variable, error) {
			// Reduce so the limb decomposition is canonical; otherwise the
			// packing below is not injective and the commitment would not bind.
			v := fp.Reduce(e)
			if len(v.Limbs) != 6 {
				return nil, nil, fmt.Errorf("expected 6 limbs, got %d", len(v.Limbs))
			}
			// 6 x 64-bit limbs -> 2 native elements. Linear, so ~free.
			lo := api.Add(v.Limbs[0], api.Mul(v.Limbs[1], shift), api.Mul(v.Limbs[2], shift2))
			hi := api.Add(v.Limbs[3], api.Mul(v.Limbs[4], shift), api.Mul(v.Limbs[5], shift2))
			return lo, hi, nil
		}
		for i := 0; i < c.N; i++ {
			xlo, xhi, err := pack(&c.Pk[i].X)
			if err != nil {
				return err
			}
			h.Write(xlo, xhi)
			if c.CommitY {
				// Committing X alone leaves each key's sign free, and 512
				// free signs is a k-sum instance Wagner's algorithm can
				// solve — the prover could search for a sign pattern whose
				// aggregate has a known discrete log, and forge. Pinning Y
				// removes the freedom entirely.
				ylo, yhi, err := pack(&c.Pk[i].Y)
				if err != nil {
					return err
				}
				h.Write(ylo, yhi)
			}
		}
		api.AssertIsEqual(h.Sum(), c.Comm)
	}
	return nil
}

func NewAggregate(n int, unified, commit, commitY, onCurve bool) *AggregateCircuit {
	return &AggregateCircuit{
		Pk:      make([]sw_emulated.AffinePoint[emulated.BLS12381Fp], n),
		Bits:    make([]frontend.Variable, n),
		N:       n,
		Unified: unified,
		Commit:  commit,
		CommitY: commitY,
		OnCurve: onCurve,
	}
}
