// Package prover turns a sync committee and a participation bitfield into a
// PLONK proof that EthLightClient.submitAggregateProof will accept.
//
// The proof is not trusted and the prover is not privileged: the aggregate it
// produces is public input, and the light client still puts it through the BLS
// pairing against the real sync-committee signature. A prover that lies
// produces a proof that does not verify, or an aggregate the pairing rejects.
// So this can run anywhere, and more than one can run.
package prover

import (
	"bufio"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	circuits "github.com/blockapps/strato/app/circuits"
	"github.com/consensys/gnark-crypto/ecc"
	"github.com/consensys/gnark-crypto/ecc/bn254/kzg"
	gnarkkzg "github.com/consensys/gnark-crypto/kzg"
	"github.com/consensys/gnark/backend/plonk"
	plonkbn254 "github.com/consensys/gnark/backend/plonk/bn254"
	"github.com/consensys/gnark/constraint"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/frontend/cs/scs"
	"github.com/consensys/gnark/test/unsafekzg"
)

// CommitteeSize is fixed by the beacon spec.
const CommitteeSize = 512

// Options configure a Setup.
type Options struct {
	// SRSPath is a ceremony SRS covering the circuit's domain. Required
	// unless TestSRS.
	SRSPath string

	// TestSRS generates an UNSAFE SRS instead. Development only: its
	// verifying key differs from a ceremony's, so proofs verify only
	// against a contract initialised from the same test key.
	TestSRS bool

	// CacheDir memoizes compile+setup. Cold setup is the slow part, and a
	// real SRS makes it much slower, so a warm cache is the difference
	// between a restart costing seconds and costing many minutes.
	CacheDir string

	Logf func(format string, args ...any)
}

// Setup is the compiled circuit and its proving key. Nothing heavy happens
// until Warm or the first Prove.
type Setup struct {
	opts Options

	mu    sync.Mutex
	ccs   constraint.ConstraintSystem
	pk    plonk.ProvingKey
	vk    plonk.VerifyingKey
	ready bool
}

// New prepares a Setup without doing any work.
func New(opts Options) (*Setup, error) {
	if !opts.TestSRS && opts.SRSPath == "" {
		return nil, errors.New("prover: an SRS path is required (or TestSRS for development)")
	}
	if opts.Logf == nil {
		opts.Logf = log.Printf
	}
	return &Setup{opts: opts}, nil
}

// Ready reports whether the setup is loaded.
func (s *Setup) Ready() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ready
}

// NbConstraints of the compiled circuit, 0 before Warm.
func (s *Setup) NbConstraints() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready {
		return 0
	}
	return s.ccs.GetNbConstraints()
}

// Warm compiles and sets up, loading from cache when one matches.
func (s *Setup) Warm() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ready {
		return nil
	}

	start := time.Now()
	ccs, err := frontend.Compile(ecc.BN254.ScalarField(), scs.NewBuilder,
		circuits.NewAggregate(CommitteeSize, true, true, true, false))
	if err != nil {
		return fmt.Errorf("prover: compile: %w", err)
	}
	s.opts.Logf("prover: compiled %d constraints in %s", ccs.GetNbConstraints(), time.Since(start).Round(time.Millisecond))

	tag, err := s.cacheTag(ccs)
	if err != nil {
		return err
	}
	if pk, vk, err := s.loadCache(tag); err == nil {
		s.ccs, s.pk, s.vk, s.ready = ccs, pk, vk, true
		s.opts.Logf("prover: setup loaded from cache (%s)", time.Since(start).Round(time.Second))
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("prover: reading setup cache (delete %s to rebuild): %w", s.cacheDir(tag), err)
	}

	var srs, srsLagrange gnarkkzg.SRS
	if s.opts.TestSRS {
		s.opts.Logf("prover: generating an UNSAFE test SRS -- development only")
		srs, srsLagrange, err = unsafekzg.NewSRS(ccs)
		if err != nil {
			return fmt.Errorf("prover: test srs: %w", err)
		}
	} else {
		srs, srsLagrange, err = loadCeremonySRS(s.opts.SRSPath, ccs)
		if err != nil {
			return err
		}
	}

	pk, vk, err := plonk.Setup(ccs, srs, srsLagrange)
	if err != nil {
		return fmt.Errorf("prover: setup: %w", err)
	}
	s.ccs, s.pk, s.vk, s.ready = ccs, pk, vk, true
	if err := s.writeCache(tag, pk, vk); err != nil {
		// Not fatal: the next boot just pays for setup again.
		s.opts.Logf("prover: warning: could not cache the setup: %v", err)
	}
	s.opts.Logf("prover: setup ready in %s", time.Since(start).Round(time.Second))
	return nil
}

// cacheTag binds a cache entry to the exact circuit and SRS it came from, so
// a circuit edit or a different SRS misses rather than silently loading a key
// that would produce proofs the deployed verifier rejects.
func (s *Setup) cacheTag(ccs constraint.ConstraintSystem) (string, error) {
	h := sha256.New()
	fmt.Fprintf(h, "aggregate-v1/%d/", ccs.GetNbConstraints())
	if s.opts.TestSRS {
		h.Write([]byte("unsafe-test-srs"))
	} else {
		f, err := os.Open(s.opts.SRSPath)
		if err != nil {
			return "", fmt.Errorf("prover: opening SRS: %w", err)
		}
		defer f.Close()
		if _, err := io.Copy(h, f); err != nil {
			return "", fmt.Errorf("prover: digesting SRS: %w", err)
		}
	}
	return hex.EncodeToString(h.Sum(nil))[:16], nil
}

func (s *Setup) cacheDir(tag string) string {
	if s.opts.CacheDir == "" {
		return ""
	}
	return filepath.Join(s.opts.CacheDir, "aggregate-"+tag)
}

func (s *Setup) loadCache(tag string) (plonk.ProvingKey, plonk.VerifyingKey, error) {
	dir := s.cacheDir(tag)
	if dir == "" {
		return nil, nil, os.ErrNotExist
	}
	pkf, err := os.Open(filepath.Join(dir, "pk.bin"))
	if err != nil {
		return nil, nil, err
	}
	defer pkf.Close()
	vkf, err := os.Open(filepath.Join(dir, "vk.bin"))
	if err != nil {
		return nil, nil, err
	}
	defer vkf.Close()

	pk := plonk.NewProvingKey(ecc.BN254)
	if _, err := pk.UnsafeReadFrom(pkf); err != nil {
		return nil, nil, err
	}
	vk := plonk.NewVerifyingKey(ecc.BN254)
	if _, err := vk.ReadFrom(vkf); err != nil {
		return nil, nil, err
	}
	return pk, vk, nil
}

func (s *Setup) writeCache(tag string, pk plonk.ProvingKey, vk plonk.VerifyingKey) error {
	dir := s.cacheDir(tag)
	if dir == "" {
		return nil
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	write := func(name string, to io.WriterTo) error {
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			return err
		}
		defer f.Close()
		_, err = to.WriteTo(f)
		return err
	}
	if err := write("pk.bin", pk); err != nil {
		return err
	}
	return write("vk.bin", vk)
}

// loadCeremonySRS reads a ceremony SRS and slices it to what this circuit
// needs, canonical and Lagrange. Same preparation the rollup's wrap does.
func loadCeremonySRS(path string, ccs constraint.ConstraintSystem) (gnarkkzg.SRS, gnarkkzg.SRS, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, fmt.Errorf("prover: opening SRS: %w", err)
	}
	defer f.Close()

	var srs kzg.SRS
	if _, err := srs.UnsafeReadFrom(bufio.NewReaderSize(f, 1<<20)); err != nil {
		return nil, nil, fmt.Errorf("prover: reading SRS %s: %w", path, err)
	}
	// A ceremony's G2 points are the whole basis of the verification; an
	// off-subgroup one would break soundness silently.
	for i := range srs.Vk.G2 {
		if !srs.Vk.G2[i].IsInSubGroup() {
			return nil, nil, errors.New("prover: SRS G2 point outside the subgroup")
		}
	}

	sizeLagrange := ecc.NextPowerOfTwo(uint64(ccs.GetNbConstraints() + ccs.GetNbPublicVariables()))
	need := sizeLagrange + 3
	if uint64(len(srs.Pk.G1)) < need {
		return nil, nil, fmt.Errorf(
			"prover: SRS has %d G1 powers, the circuit needs %d (domain %d + 3): run a larger ceremony",
			len(srs.Pk.G1), need, sizeLagrange)
	}
	canonical := &kzg.SRS{Vk: srs.Vk}
	canonical.Pk.G1 = srs.Pk.G1[:need]
	lag, err := kzg.ToLagrangeG1(srs.Pk.G1[:sizeLagrange])
	if err != nil {
		return nil, nil, fmt.Errorf("prover: lagrange conversion: %w", err)
	}
	return canonical, &kzg.SRS{Vk: srs.Vk, Pk: kzg.ProvingKey{G1: lag}}, nil
}

// VerifyingKey exposes the loaded key, nil before Warm.
func (s *Setup) VerifyingKey() *plonkbn254.VerifyingKey {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ready {
		return nil
	}
	return s.vk.(*plonkbn254.VerifyingKey)
}
