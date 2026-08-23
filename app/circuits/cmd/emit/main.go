// Command emit compiles the aggregation circuit, proves it, and writes the
// artifacts plonkgen's `import` mode consumes: vk.bin, proof.bin, public.json.
//
// That path runs a Go reference verifier over the proof and then emits a
// word-indexed SolidVM fixture, which is how a real proof from this circuit
// gets in front of app/contracts/concrete/Plonk/PlonkVerifier.sol.
//
//	go run ./cmd/emit [n] [signers] [outdir]
//
// The SRS is generated unsafely. Fine for a test fixture; a deployed circuit
// needs a real ceremony.
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"time"

	circuits "github.com/blockapps/strato/app/circuits"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark/backend/plonk"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/scs"
	"github.com/consensys/gnark/logger"
	"github.com/consensys/gnark/test/unsafekzg"
)

func must(err error) {
	if err != nil {
		panic(err)
	}
}

func atoi(s string, def int) int {
	if s == "" {
		return def
	}
	v, err := strconv.Atoi(s)
	must(err)
	return v
}

func arg(i int, def string) string {
	if len(os.Args) > i {
		return os.Args[i]
	}
	return def
}

func main() {
	logger.Disable()
	n := atoi(arg(1, ""), 512)
	signers := atoi(arg(2, ""), 470)
	out := arg(3, "out")
	must(os.MkdirAll(out, 0o755))

	fmt.Printf("circuit: n=%d signers=%d\n", n, signers)

	t := time.Now()
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder,
		circuits.NewAggregate(n, true, true, true, false))
	must(err)
	fmt.Printf("compile   %8d constraints   %5.1fs\n", ccs.GetNbConstraints(), time.Since(t).Seconds())

	t = time.Now()
	srs, srsL, err := unsafekzg.NewSRS(ccs)
	must(err)
	fmt.Printf("srs                                 %5.1fs\n", time.Since(t).Seconds())

	t = time.Now()
	pk, vk, err := plonk.Setup(ccs, srs, srsL)
	must(err)
	fmt.Printf("setup                               %5.1fs\n", time.Since(t).Seconds())

	assignment, err := circuits.BuildWitness(n, signers, true)
	must(err)
	full, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	must(err)
	pub, err := full.Public()
	must(err)

	t = time.Now()
	proof, err := plonk.Prove(ccs, pk, full)
	must(err)
	fmt.Printf("prove                               %5.1fs\n", time.Since(t).Seconds())

	must(plonk.Verify(proof, vk, pub))
	fmt.Println("native verify OK")

	write := func(name string, wt interface{ WriteTo(f *os.File) (int64, error) }) {
		f, err := os.Create(out + "/" + name)
		must(err)
		defer f.Close()
		_, err = wt.WriteTo(f)
		must(err)
	}
	_ = write

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

	vec := pub.Vector().(fr.Vector)
	strs := make([]string, len(vec))
	for i := range vec {
		strs[i] = vec[i].String()
	}
	raw, err := json.MarshalIndent(strs, "", "  ")
	must(err)
	must(os.WriteFile(out+"/public.json", raw, 0o644))

	fmt.Printf("wrote %s/{vk.bin,proof.bin,public.json}: %d public inputs\n", out, len(strs))
}
