// Command proverd serves subset-aggregate proofs for EthLightClient.
//
// It holds no keys and is not trusted. The aggregate it returns is public
// input to the proof, and the light client still puts it through the BLS
// pairing against the real sync-committee signature, so a prover that lies
// produces something the chain rejects. Run as many as you like; the backend
// only needs one to be up, and a user who does not trust it can run their own.
//
//	proverd -test-srs -addr :8547            # development
//	proverd -srs /etc/strato/srs.bin -cache /var/lib/proverd -warm
package main

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/blockapps/strato/app/circuits/prover"
)

type server struct {
	setup *prover.Setup
	// Proving is memory-hungry enough that overlapping runs thrash rather
	// than parallelise, so requests queue.
	proving sync.Mutex
}

func unhex(s string) ([]byte, error) { return hex.DecodeString(strings.TrimPrefix(s, "0x")) }

func hexes(bs []byte) string { return "0x" + hex.EncodeToString(bs) }

func words(xs []*big.Int) []string {
	out := make([]string, len(xs))
	for i, x := range xs {
		out[i] = "0x" + x.Text(16)
	}
	return out
}

func fail(w http.ResponseWriter, code int, format string, a ...any) {
	msg := fmt.Sprintf(format, a...)
	log.Printf("proverd: %d %s", code, msg)
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

func ok(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v)
}

type proveReq struct {
	Pubkeys           []string `json:"pubkeys"`
	ParticipationBits string   `json:"participationBits"`
}

func (s *server) committee(r *proveReq) ([][]byte, error) {
	if len(r.Pubkeys) != prover.CommitteeSize {
		return nil, fmt.Errorf("expected %d pubkeys, got %d", prover.CommitteeSize, len(r.Pubkeys))
	}
	pks := make([][]byte, len(r.Pubkeys))
	for i, h := range r.Pubkeys {
		b, err := unhex(h)
		if err != nil {
			return nil, fmt.Errorf("pubkey %d is not hex: %v", i, err)
		}
		pks[i] = b
	}
	return pks, nil
}

func (s *server) handleProve(w http.ResponseWriter, r *http.Request) {
	var req proveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "malformed body: %v", err)
		return
	}
	pks, err := s.committee(&req)
	if err != nil {
		fail(w, http.StatusBadRequest, "%v", err)
		return
	}
	bits, err := unhex(req.ParticipationBits)
	if err != nil {
		fail(w, http.StatusBadRequest, "participationBits is not hex: %v", err)
		return
	}

	s.proving.Lock()
	defer s.proving.Unlock()
	res, err := s.setup.Prove(pks, bits)
	if err != nil {
		// A refused witness is the caller's problem; a broken setup is ours,
		// and the distinction matters when this is behind a retry loop.
		if strings.Contains(err.Error(), "prover: setup") || strings.Contains(err.Error(), "prover: compile") {
			fail(w, http.StatusServiceUnavailable, "%v", err)
			return
		}
		fail(w, http.StatusBadRequest, "%v", err)
		return
	}
	log.Printf("proverd: proved %d signers in %s", res.Signers, res.Elapsed.Round(time.Millisecond))
	ok(w, map[string]any{
		"aggregate":    hexes(res.Aggregate),
		"commitment":   "0x" + res.Commitment.Text(16),
		"proof":        words(res.Proof),
		"publicInputs": words(res.PublicInputs),
		"signers":      res.Signers,
		"elapsedMs":    res.Elapsed.Milliseconds(),
	})
}

// handleCommitment is the cheap half: a deployment needs the digest to call
// setCommitteeCommitment before any proof exists.
func (s *server) handleCommitment(w http.ResponseWriter, r *http.Request) {
	var req proveReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		fail(w, http.StatusBadRequest, "malformed body: %v", err)
		return
	}
	pks, err := s.committee(&req)
	if err != nil {
		fail(w, http.StatusBadRequest, "%v", err)
		return
	}
	c, err := prover.CommitteeCommitment(pks)
	if err != nil {
		fail(w, http.StatusBadRequest, "%v", err)
		return
	}
	ok(w, map[string]any{"commitment": "0x" + c.Text(16)})
}

func (s *server) handleVK(w http.ResponseWriter, r *http.Request) {
	vk := s.setup.VKWords()
	if vk == nil {
		fail(w, http.StatusServiceUnavailable, "setup is not warm yet")
		return
	}
	ok(w, map[string]any{"words": words(vk), "verifierId": "bridge-sync-committee-aggregate"})
}

func (s *server) handleHealth(w http.ResponseWriter, r *http.Request) {
	ok(w, map[string]any{"ready": s.setup.Ready(), "constraints": s.setup.NbConstraints()})
}

func main() {
	addr := flag.String("addr", ":8547", "listen address")
	srs := flag.String("srs", "", "ceremony SRS covering the circuit's domain")
	testSRS := flag.Bool("test-srs", false, "generate an UNSAFE SRS instead (development only)")
	cache := flag.String("cache", "", "directory to memoize compile+setup in")
	warm := flag.Bool("warm", false, "set up before listening rather than on the first request")
	flag.Parse()

	setup, err := prover.New(prover.Options{SRSPath: *srs, TestSRS: *testSRS, CacheDir: *cache})
	if err != nil {
		log.Fatalf("proverd: %v", err)
	}
	if *testSRS {
		log.Print("proverd: UNSAFE test SRS -- proofs verify only against a contract initialised with the matching test key")
	}
	if *warm {
		if err := setup.Warm(); err != nil {
			log.Fatalf("proverd: %v", err)
		}
	}

	s := &server{setup: setup}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /prove", s.handleProve)
	mux.HandleFunc("POST /commitment", s.handleCommitment)
	mux.HandleFunc("GET /vk", s.handleVK)
	mux.HandleFunc("GET /health", s.handleHealth)

	log.Printf("proverd: listening on %s", *addr)
	srv := &http.Server{
		Addr:    *addr,
		Handler: mux,
		// Proving takes tens of seconds; a default write timeout would cut
		// every response.
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      10 * time.Minute,
	}
	log.Fatal(srv.ListenAndServe())
}
