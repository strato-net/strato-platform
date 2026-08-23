package prover_test

import (
	"encoding/hex"
	"math/big"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/blockapps/strato/app/circuits/prover"
)

const fixture = "../../contracts/tests/Bridge/EthLightClientAnchor.test.sol"

var (
	pkLine   = regexp.MustCompile(`pks\[(\d+)\]\s*=\s*hex"([0-9a-fA-F]{96})"`)
	bitsLine = regexp.MustCompile(`bytes32\(hex"([0-9a-fA-F]{64})"\)`)
)

// sepolia reads the real period-1243 committee and participation bitfield out
// of the SolidVM anchor fixture, so the prover is exercised against the same
// data the on-chain tests use rather than a synthetic committee of its own.
func sepolia(t *testing.T) ([][]byte, []byte) {
	t.Helper()
	raw, err := os.ReadFile(fixture)
	if err != nil {
		t.Fatal(err)
	}
	pks := make([][]byte, prover.CommitteeSize)
	for _, m := range pkLine.FindAllStringSubmatch(string(raw), -1) {
		i, err := strconv.Atoi(m[1])
		if err != nil {
			t.Fatal(err)
		}
		if i >= prover.CommitteeSize {
			continue
		}
		b, err := hex.DecodeString(m[2])
		if err != nil {
			t.Fatal(err)
		}
		pks[i] = b
	}
	for i, p := range pks {
		if p == nil {
			t.Fatalf("fixture is missing pks[%d]", i)
		}
	}

	seg := string(raw)
	idx := strings.Index(seg, "function _participationBits")
	if idx < 0 {
		t.Fatal("no _participationBits in fixture")
	}
	ms := bitsLine.FindAllStringSubmatch(seg[idx:], 2)
	if len(ms) != 2 {
		t.Fatal("expected two bitfield chunks")
	}
	var bits []byte
	for _, m := range ms {
		b, err := hex.DecodeString(m[1])
		if err != nil {
			t.Fatal(err)
		}
		bits = append(bits, b...)
	}
	return pks, bits
}

// The digest the contract builds on-chain, pinned in
// app/contracts/tests/Bridge/CommitteeCommitment.test.sol. If these two ever
// disagree, proofs stop verifying and nothing else says why.
const sepoliaCommitment = "0x1e8042c24f811689ee3b93217ebee2b7e570d579297ff9053f05ddc578db46ad"

func TestCommitteeCommitmentMatchesTheContract(t *testing.T) {
	pks, _ := sepolia(t)
	got, err := prover.CommitteeCommitment(pks)
	if err != nil {
		t.Fatal(err)
	}
	want, ok := new(big.Int).SetString(strings.TrimPrefix(sepoliaCommitment, "0x"), 16)
	if !ok {
		t.Fatal("bad constant")
	}
	if got.Cmp(want) != 0 {
		t.Fatalf("commitment\n got 0x%x\nwant %s", got, sepoliaCommitment)
	}
}

func TestCommitteeCommitmentRejectsAShortCommittee(t *testing.T) {
	pks, _ := sepolia(t)
	if _, err := prover.CommitteeCommitment(pks[:511]); err == nil {
		t.Fatal("expected a 511-member committee to be refused")
	}
}

// The full path. Slow: compile, an unsafe SRS, setup, and a proof. Skipped in
// -short.
func TestProveAgainstTheRealCommittee(t *testing.T) {
	if testing.Short() {
		t.Skip("proving takes ~90s from cold")
	}
	pks, bits := sepolia(t)
	s, err := prover.New(prover.Options{TestSRS: true, CacheDir: t.TempDir(), Logf: t.Logf})
	if err != nil {
		t.Fatal(err)
	}
	res, err := s.Prove(pks, bits)
	if err != nil {
		t.Fatal(err)
	}
	if res.Signers != 470 {
		t.Fatalf("signers = %d, want 470", res.Signers)
	}
	if len(res.Aggregate) != 128 {
		t.Fatalf("aggregate is %d bytes, want 128", len(res.Aggregate))
	}
	// The aggregate the real Sepolia signature was made against: the
	// BLSVerify fixture's precomputed value with its compression flags
	// masked off.
	wantX := "1335746c5e693cee9f751fadf029ea18f9d53f3d0f76877d0f64b5324f0b69aa3e8c52865f647d1bb4d41df0cfae8b5e"
	if got := hex.EncodeToString(res.Aggregate[16:64]); got != wantX {
		t.Fatalf("aggregate x\n got %s\nwant %s", got, wantX)
	}
	if len(res.PublicInputs) != 17 {
		t.Fatalf("public inputs = %d, want 17", len(res.PublicInputs))
	}
	if len(res.Proof) != 27 {
		t.Fatalf("proof words = %d, want 27 (24 + 3 for one Bsb22 commitment)", len(res.Proof))
	}
	if len(s.VKWords()) != 32 {
		t.Fatalf("vk words = %d, want 32", len(s.VKWords()))
	}
	t.Logf("proved in %s", res.Elapsed.Round(0))
}
