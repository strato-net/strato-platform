// Command livedryrun exercises the prover against the LIVE Sepolia beacon
// chain rather than a checked-in fixture.
//
// It fetches the current finality update and the sync committee that signed
// it, proves the subset aggregate, and then checks that aggregate against the
// live signature with a real BLS pairing -- the same check EthLightClient
// makes on-chain. If the pairing holds, the aggregate the prover produced is
// the one the committee actually signed for, on data nobody curated.
//
// The artifacts it writes feed a SolidVM fixture, so the same proof can then
// be put through PlonkVerifier.
//
//	go run ./cmd/livedryrun -srs <ceremony>/srs.bin -cache <dir> -out <dir>
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"math/big"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/blockapps/strato/app/circuits/prover"
	"github.com/blockapps/strato/app/circuits/sszfix"
	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
)

const slotsPerPeriod = 8192

func get(url string, out any) error {
	c := &http.Client{Timeout: 60 * time.Second}
	resp, err := c.Get(url)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("%s -> %d", url, resp.StatusCode)
	}
	return json.NewDecoder(resp.Body).Decode(out)
}

func unhex(s string) []byte {
	b, err := hex.DecodeString(strings.TrimPrefix(s, "0x"))
	if err != nil {
		panic(err)
	}
	return b
}

func root(s string) sszfix.Root { return sszfix.MustRoot(strings.TrimPrefix(s, "0x")) }

func main() {
	beacon := flag.String("beacon", "https://lodestar-sepolia.chainsafe.io", "beacon API")
	srs := flag.String("srs", "", "ceremony SRS")
	testSRS := flag.Bool("test-srs", false, "use an unsafe SRS instead")
	cache := flag.String("cache", "", "setup cache dir")
	out := flag.String("out", "", "write vk/proof/public json here")
	flag.Parse()
	base := strings.TrimSuffix(*beacon, "/")

	// --- live finality update: the header the committee just signed ---
	var fu struct {
		Data struct {
			AttestedHeader struct {
				// Explicit tags: Go's default field matching is
				// case-insensitive but does not cross snake_case, so
				// proposer_index and parent_root would silently decode as
				// empty and the signing root would be quietly wrong.
				Beacon struct {
					Slot          string `json:"slot"`
					ProposerIndex string `json:"proposer_index"`
					ParentRoot    string `json:"parent_root"`
					StateRoot     string `json:"state_root"`
					BodyRoot      string `json:"body_root"`
				} `json:"beacon"`
			} `json:"attested_header"`
			SyncAggregate struct {
				SyncCommitteeBits      string `json:"sync_committee_bits"`
				SyncCommitteeSignature string `json:"sync_committee_signature"`
			} `json:"sync_aggregate"`
			SignatureSlot string `json:"signature_slot"`
		} `json:"data"`
	}
	if err := get(base+"/eth/v1/beacon/light_client/finality_update", &fu); err != nil {
		panic(err)
	}
	d := fu.Data
	u64 := func(what, v string) uint64 {
		n, err := strconv.ParseUint(v, 10, 64)
		if err != nil {
			panic(fmt.Sprintf("beacon returned %q for %s: %v", v, what, err))
		}
		return n
	}
	sigSlot := u64("signature_slot", d.SignatureSlot)
	period := sigSlot / slotsPerPeriod
	attSlot := u64("attested slot", d.AttestedHeader.Beacon.Slot)
	attProposer := u64("attested proposer_index", d.AttestedHeader.Beacon.ProposerIndex)
	fmt.Printf("live finality update: attested slot %d, signature slot %d, period %d\n", attSlot, sigSlot, period)

	// --- the committee that signed it ---
	var updates struct {
		Data []struct {
			Data struct {
				NextSyncCommittee struct {
					Pubkeys []string `json:"pubkeys"`
				} `json:"next_sync_committee"`
			} `json:"data"`
		}
	}
	var raw []map[string]any
	if err := get(fmt.Sprintf("%s/eth/v1/beacon/light_client/updates?start_period=%d&count=1", base, period-1), &raw); err != nil {
		panic(err)
	}
	b, _ := json.Marshal(raw)
	_ = json.Unmarshal(b, &updates.Data)
	pk := updates.Data[0].Data.NextSyncCommittee.Pubkeys
	if len(pk) != 512 {
		panic(fmt.Sprintf("expected 512 pubkeys for period %d, got %d", period, len(pk)))
	}
	fmt.Printf("committee for period %d: %d pubkeys\n", period, len(pk))

	// --- prove ---
	s, err := prover.New(prover.Options{SRSPath: *srs, TestSRS: *testSRS, CacheDir: *cache, Logf: func(f string, a ...any) { fmt.Printf(f+"\n", a...) }})
	if err != nil {
		panic(err)
	}
	pubkeys := make([][]byte, len(pk))
	for i := range pk {
		pubkeys[i] = unhex(pk[i])
	}
	res, err := s.Prove(pubkeys, unhex(d.SyncAggregate.SyncCommitteeBits))
	if err != nil {
		panic(err)
	}
	fmt.Printf("proved %d signers in %s\n", res.Signers, res.Elapsed.Round(time.Millisecond))

	// --- the check that matters: does the live signature verify against the
	//     aggregate the prover produced? Same pairing EthLightClient makes. ---
	var genesis struct {
		Data struct {
			GenesisValidatorsRoot string `json:"genesis_validators_root"`
		} `json:"data"`
	}
	if err := get(base+"/eth/v1/beacon/genesis", &genesis); err != nil {
		panic(err)
	}
	var forks struct {
		Data []struct {
			CurrentVersion string `json:"current_version"`
			Epoch          string `json:"epoch"`
		} `json:"data"`
	}
	if err := get(base+"/eth/v1/config/fork_schedule", &forks); err != nil {
		panic(err)
	}
	epoch := attSlot / 32
	var fv [4]byte
	for _, f := range forks.Data {
		e, _ := strconv.ParseUint(f.Epoch, 10, 64)
		if e <= epoch {
			copy(fv[:], unhex(f.CurrentVersion))
		}
	}
	fmt.Printf("fork version at epoch %d: 0x%x\n", epoch, fv)

	attestedRoot := sszfix.HeaderRoot(attSlot, attProposer,
		root(d.AttestedHeader.Beacon.ParentRoot), root(d.AttestedHeader.Beacon.StateRoot), root(d.AttestedHeader.Beacon.BodyRoot))
	domain := sszfix.ComputeDomain([4]byte{0x07, 0x00, 0x00, 0x00}, fv, root(genesis.Data.GenesisValidatorsRoot))
	signingRoot := sszfix.H2(attestedRoot, domain)

	msg, err := bls.HashToG2(signingRoot[:], []byte(sszfix.EthDST))
	if err != nil {
		panic(err)
	}
	// EIP-2537 uncompressed: 16 zero bytes then the 48-byte coordinate.
	var aggPk bls.G1Affine
	aggPk.X.SetBytes(res.Aggregate[16:64])
	aggPk.Y.SetBytes(res.Aggregate[80:128])

	var sig bls.G2Affine
	if _, err := sig.SetBytes(unhex(d.SyncAggregate.SyncCommitteeSignature)); err != nil {
		panic(fmt.Errorf("decoding the live signature: %w", err))
	}
	_, _, g1, _ := bls.Generators()
	var negG1 bls.G1Affine
	negG1.Neg(&g1)
	ok, err := bls.PairingCheck([]bls.G1Affine{negG1, aggPk}, []bls.G2Affine{sig, msg})
	if err != nil {
		panic(err)
	}
	fmt.Printf("\nLIVE SIGNATURE VERIFIES AGAINST THE PROVEN AGGREGATE: %v\n", ok)
	if !ok {
		os.Exit(1)
	}

	if *out != "" {
		must := func(e error) {
			if e != nil {
				panic(e)
			}
		}
		must(os.MkdirAll(*out, 0o755))
		enc := func(name string, v any) {
			b, err := json.MarshalIndent(v, "", "  ")
			must(err)
			must(os.WriteFile(*out+"/"+name, b, 0o644))
		}
		hexes := func(xs []*big.Int) []string {
			o := make([]string, len(xs))
			for i, x := range xs {
				o[i] = "0x" + x.Text(16)
			}
			return o
		}
		enc("proof.json", map[string]any{
			"proof":         hexes(res.Proof),
			"publicInputs":  hexes(res.PublicInputs),
			"aggregate":     "0x" + hex.EncodeToString(res.Aggregate),
			"commitment":    "0x" + res.Commitment.Text(16),
			"period":        period,
			"signatureSlot": sigSlot,
			"signers":       res.Signers,
		})
		enc("vk.json", map[string]any{"words": hexes(s.VKWords())})
		fmt.Printf("wrote %s/{proof,vk}.json\n", *out)
	}
}
