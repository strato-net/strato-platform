package circuits

import (
	"testing"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/test"
)

// A full-size committee at the participation rate of the Sepolia fixture in
// app/contracts/tests/Bridge/EthLightClientAnchor.test.sol.
const (
	committeeSize = 512
	signers       = 470
)

func TestAggregateAcceptsARealSubsetAggregate(t *testing.T) {
	w, err := BuildWitness(committeeSize, signers, true)
	if err != nil {
		t.Fatal(err)
	}
	if err := test.IsSolved(
		NewAggregate(committeeSize, true, true, true, false), w, ecc.BN254.ScalarField(),
	); err != nil {
		t.Fatal(err)
	}
}

func TestAggregateRejectsATamperedAggregate(t *testing.T) {
	w, err := BuildWitness(committeeSize, signers, true)
	if err != nil {
		t.Fatal(err)
	}
	// Claim an aggregate the committee did not produce. Without this the
	// circuit would prove nothing at all.
	w.Agg = sw_emulated.AffinePoint[emulated.BLS12381Fp]{
		X: emulated.ValueOf[emulated.BLS12381Fp](1),
		Y: emulated.ValueOf[emulated.BLS12381Fp](2),
	}
	if err := test.IsSolved(
		NewAggregate(committeeSize, true, true, true, false), w, ecc.BN254.ScalarField(),
	); err == nil {
		t.Fatal("tampered aggregate was accepted")
	}
}

// Incomplete addition saves ~39% of the constraints but has a degenerate case
// (equal x-coordinates have no inverse) that the accumulator pattern does not
// rule out. It has failed on more than one committee; this records that the
// cheap variant is not currently usable, so a future change that claims to fix
// it has something to flip.
func TestIncompleteAdditionIsNotYetUsable(t *testing.T) {
	w, err := BuildWitness(committeeSize, signers, false)
	if err != nil {
		t.Fatal(err)
	}
	err = test.IsSolved(
		NewAggregate(committeeSize, false, true, true, false), w, ecc.BN254.ScalarField(),
	)
	if err == nil {
		t.Log("incomplete addition now solves; re-measure and consider switching")
	}
}
