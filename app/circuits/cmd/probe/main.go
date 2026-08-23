package main

import (
	"fmt"
	"os"
	"runtime"
	"text/tabwriter"
	"time"

	circuits "github.com/blockapps/strato/app/circuits"
	"github.com/consensys/gnark/backend/plonk"
	"github.com/consensys/gnark/test"
	"github.com/consensys/gnark/test/unsafekzg"

	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/r1cs"
	"github.com/consensys/gnark/frontend/cs/scs"
	"github.com/consensys/gnark/logger"
	"github.com/consensys/gnark/std/algebra/emulated/sw_bls12381"
	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/hash/poseidon2"
	"github.com/consensys/gnark/std/math/emulated"
	"github.com/consensys/gnark/std/math/uints"
)

type G1 = sw_emulated.AffinePoint[emulated.BLS12381Fp]

func curve(api frontend.API) (*sw_emulated.Curve[emulated.BLS12381Fp, emulated.BLS12381Fr], error) {
	return sw_emulated.New[emulated.BLS12381Fp, emulated.BLS12381Fr](api, sw_emulated.GetBLS12381Params())
}

// ---- incomplete add ----
type addC struct {
	P   [2]G1
	Out G1 `gnark:",public"`
	n   int
}

func (c *addC) Define(api frontend.API) error {
	crv, err := curve(api)
	if err != nil {
		return err
	}
	acc := &c.P[0]
	for i := 0; i < c.n; i++ {
		acc = crv.Add(acc, &c.P[1])
	}
	crv.AssertIsEqual(acc, &c.Out)
	return nil
}

// ---- complete add ----
type addUC struct {
	P   [2]G1
	Out G1 `gnark:",public"`
	n   int
}

func (c *addUC) Define(api frontend.API) error {
	crv, err := curve(api)
	if err != nil {
		return err
	}
	acc := &c.P[0]
	for i := 0; i < c.n; i++ {
		acc = crv.AddUnified(acc, &c.P[1])
	}
	crv.AssertIsEqual(acc, &c.Out)
	return nil
}

// ---- on-curve check ----
type onCurveC struct {
	P G1
	n int
}

func (c *onCurveC) Define(api frontend.API) error {
	crv, err := curve(api)
	if err != nil {
		return err
	}
	for i := 0; i < c.n; i++ {
		crv.AssertIsOnCurve(&c.P)
	}
	return nil
}

// ---- subgroup check ----
type onG1C struct {
	P G1
	n int
}

func (c *onG1C) Define(api frontend.API) error {
	g, err := sw_bls12381.NewG1(api)
	if err != nil {
		return err
	}
	for i := 0; i < c.n; i++ {
		g.AssertIsOnG1(&c.P)
	}
	return nil
}

// ---- decompress 48 compressed bytes -> G1 ----
type unmarshalC struct {
	B [48]uints.U8
	n int
}

func (c *unmarshalC) Define(api frontend.API) error {
	g, err := sw_bls12381.NewG1(api)
	if err != nil {
		return err
	}
	for i := 0; i < c.n; i++ {
		if _, err := g.UnmarshalCompressed(c.B[:]); err != nil {
			return err
		}
	}
	return nil
}

// ---- point select (padding) ----
type selectC struct {
	B frontend.Variable
	P [2]G1
	n int
}

func (c *selectC) Define(api frontend.API) error {
	crv, err := curve(api)
	if err != nil {
		return err
	}
	acc := &c.P[0]
	for i := 0; i < c.n; i++ {
		acc = crv.Select(c.B, acc, &c.P[1])
	}
	crv.AssertIsEqual(acc, &c.P[0])
	return nil
}

// ---- poseidon2 permutation (commitment hashing) ----
type poseidonC struct {
	In []frontend.Variable
	n  int
}

func (c *poseidonC) Define(api frontend.API) error {
	h, err := poseidon2.New(api)
	if err != nil {
		return err
	}
	for i := 0; i < c.n; i++ {
		h.Reset()
		h.Write(c.In...)
		_ = h.Sum()
	}
	return nil
}

func compile(c frontend.Circuit) (int, int, error) {
	r, err := frontend.Compile(ecc.BN254.ScalarField(), r1cs.NewBuilder, c)
	if err != nil {
		return 0, 0, err
	}
	s, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder, c)
	if err != nil {
		return 0, 0, err
	}
	return r.GetNbConstraints(), s.GetNbConstraints(), nil
}

func main() {
	logger.Disable()
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(w, "operation\tR1CS/op\tPLONK/op\t")

	// marginal cost = (cost at hi - cost at lo) / (hi - lo)
	type probe struct {
		name   string
		lo, hi int
		mk     func(n int) frontend.Circuit
	}
	probes := []probe{
		{"G1 Add (incomplete)", 4, 20, func(n int) frontend.Circuit { return &addC{n: n} }},
		{"G1 AddUnified (complete)", 4, 20, func(n int) frontend.Circuit { return &addUC{n: n} }},
		{"AssertIsOnCurve", 4, 20, func(n int) frontend.Circuit { return &onCurveC{n: n} }},
		{"AssertIsOnG1 (subgroup)", 1, 4, func(n int) frontend.Circuit { return &onG1C{n: n} }},
		{"UnmarshalCompressed(48B)", 1, 4, func(n int) frontend.Circuit { return &unmarshalC{n: n} }},
		{"Point Select", 4, 20, func(n int) frontend.Circuit { return &selectC{n: n} }},
		{"Poseidon2 MD hash(4 in)", 4, 20, func(n int) frontend.Circuit {
			return &poseidonC{n: n, In: make([]frontend.Variable, 4)}
		}},
		{"sign check (LessOrEqual)", 4, 20, func(n int) frontend.Circuit {
			return &signCircuit{n: n, Y: make([]emulated.Element[emulated.BLS12381Fp], n)}
		}},
		{"emulated ToBits", 4, 20, func(n int) frontend.Circuit {
			return &toBitsCircuit{n: n, Y: make([]emulated.Element[emulated.BLS12381Fp], n)}
		}},
	}
	for _, p := range probes {
		rl, sl, err := compile(p.mk(p.lo))
		if err != nil {
			fmt.Fprintf(w, "%s\tERR\t%v\t\n", p.name, err)
			continue
		}
		rh, sh, err := compile(p.mk(p.hi))
		if err != nil {
			fmt.Fprintf(w, "%s\tERR\t%v\t\n", p.name, err)
			continue
		}
		d := p.hi - p.lo
		fmt.Fprintf(w, "%s\t%d\t%d\t\n", p.name, (rh-rl)/d, (sh-sl)/d)
	}
	w.Flush()

	fmt.Println()
	w2 := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', tabwriter.AlignRight)
	fmt.Fprintln(w2, "boundary-A circuit\tR1CS\tPLONK(scs)\t")
	for _, cfg := range []struct {
		name            string
		n               int
		unified, commit bool
	}{
		{"n=512 EC only (no commit)", 512, false, false},
		{"n=512 + commit(X,Y), incomplete", 512, false, true},
		{"n=512 + commit(X,Y), unified", 512, true, true},
	} {
		r, s, err := compile(circuits.NewAggregate(cfg.n, cfg.unified, cfg.commit, true, false))
		if err != nil {
			fmt.Fprintf(w2, "%s\tERR\t%v\t\n", cfg.name, err)
			continue
		}
		fmt.Fprintf(w2, "%s\t%d\t%d\t\n", cfg.name, r, s)
	}
	w2.Flush()

}

func runProve(n, signers int, unified bool) {
	fmt.Printf("\n=== boundary-A: n=%d, %d signers, unified=%v ===\n", n, signers, unified)
	fmt.Printf("cores: %d\n", runtime.NumCPU())

	assignment, err := circuits.BuildWitness(n, signers, unified)
	if err != nil {
		fmt.Println("witness:", err)
		return
	}

	// 1. Does the circuit actually accept a real aggregate?
	t0 := time.Now()
	if err := test.IsSolved(circuits.NewAggregate(n, unified, true, true, false), assignment, ecc.BN254.ScalarField()); err != nil {
		fmt.Println("SATISFIABILITY: FAILED —", err)
		return
	}
	fmt.Printf("satisfiability   OK          (%.1fs)\n", time.Since(t0).Seconds())

	// 2. Negative control: a tampered aggregate must be rejected.
	bad, _ := circuits.BuildWitness(n, signers, unified)
	bad.Agg = sw_emulated.AffinePoint[emulated.BLS12381Fp]{
		X: emulated.ValueOf[emulated.BLS12381Fp](1),
		Y: emulated.ValueOf[emulated.BLS12381Fp](2),
	}
	if err := test.IsSolved(circuits.NewAggregate(n, unified, true, true, false), bad, ecc.BN254.ScalarField()); err == nil {
		fmt.Println("NEGATIVE CONTROL: FAILED — tampered aggregate was accepted")
		return
	}
	fmt.Println("tampered agg     rejected")

	// 3. Compile / setup / prove / verify.
	t0 = time.Now()
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder, circuits.NewAggregate(n, unified, true, true, false))
	if err != nil {
		fmt.Println("compile:", err)
		return
	}
	fmt.Printf("compile          %7d constraints  (%.1fs)\n", ccs.GetNbConstraints(), time.Since(t0).Seconds())

	t0 = time.Now()
	srs, srsL, err := unsafekzg.NewSRS(ccs)
	if err != nil {
		fmt.Println("srs:", err)
		return
	}
	fmt.Printf("srs (unsafe)                  (%.1fs)\n", time.Since(t0).Seconds())

	t0 = time.Now()
	pk, vk, err := plonk.Setup(ccs, srs, srsL)
	if err != nil {
		fmt.Println("setup:", err)
		return
	}
	fmt.Printf("plonk setup                   (%.1fs)\n", time.Since(t0).Seconds())

	full, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		fmt.Println("witness:", err)
		return
	}
	pub, _ := full.Public()

	t0 = time.Now()
	proof, err := plonk.Prove(ccs, pk, full)
	if err != nil {
		fmt.Println("prove:", err)
		return
	}
	provetime := time.Since(t0).Seconds()

	t0 = time.Now()
	if err := plonk.Verify(proof, vk, pub); err != nil {
		fmt.Println("verify:", err)
		return
	}
	fmt.Printf("PROVE            %.1fs\n", provetime)
	fmt.Printf("verify (native)  %.3fs\n", time.Since(t0).Seconds())
}

// Cost of pinning a key's sign in-circuit, which is what you must pay if
// the on-chain commitment covers the 48-byte compressed form (X + sign)
// rather than the full affine (X, Y).
//
// Each iteration uses a distinct element: repeating one input lets gnark
// fold the duplicates away by common-subexpression elimination and reports
// a cost far below the real one.
type signCircuit struct {
	Y []emulated.Element[emulated.BLS12381Fp]
	H emulated.Element[emulated.BLS12381Fp]
	n int
}

func (c *signCircuit) Define(api frontend.API) error {
	fp, err := emulated.NewField[emulated.BLS12381Fp](api)
	if err != nil {
		return err
	}
	for i := 0; i < c.n; i++ {
		// IETF serialisation sets the sign bit when y > (p-1)/2.
		fp.AssertIsLessOrEqual(&c.Y[i], &c.H)
	}
	return nil
}

// Cost of bit-decomposing an emulated element (the other route to a sign).
type toBitsCircuit struct {
	Y []emulated.Element[emulated.BLS12381Fp]
	n int
}

func (c *toBitsCircuit) Define(api frontend.API) error {
	fp, err := emulated.NewField[emulated.BLS12381Fp](api)
	if err != nil {
		return err
	}
	for i := 0; i < c.n; i++ {
		_ = fp.ToBits(&c.Y[i])
	}
	return nil
}
