package prover

import (
	"fmt"
	"math/big"
	"time"

	circuits "github.com/blockapps/strato/app/circuits"
	"github.com/consensys/gnark-crypto/ecc"
	bls "github.com/consensys/gnark-crypto/ecc/bls12-381"
	bnfr "github.com/consensys/gnark-crypto/ecc/bn254/fr"
	"github.com/consensys/gnark-crypto/ecc/bn254/fr/poseidon2"
	"github.com/consensys/gnark/backend/plonk"
	plonkbn254 "github.com/consensys/gnark/backend/plonk/bn254"
	"github.com/consensys/gnark/frontend"
	"github.com/consensys/gnark/std/algebra/emulated/sw_emulated"
	"github.com/consensys/gnark/std/math/emulated"
)

// Result is everything EthLightClient needs for one anchor.
type Result struct {
	// Aggregate is the subset aggregate, 128-byte EIP-2537 uncompressed --
	// the form submitAggregateProof and the BLS pairing both take.
	Aggregate []byte
	// Commitment is the committee digest the proof was made against. The
	// contract must already hold this, or the proof will not verify.
	Commitment *big.Int
	// Proof is PlonkVerifier's word layout.
	Proof []*big.Int
	// PublicInputs in gnark's witness order, for debugging a rejection.
	PublicInputs []*big.Int
	// Signers counted from the bitfield.
	Signers int
	Elapsed time.Duration
}

// CommitteeCommitment is the digest EthLightClient.buildCommitteeCommitment
// produces for the same committee: per member, in order, the affine X then Y,
// each as two 192-bit halves.
//
// Exposed on its own because a deployment needs it before any proof exists --
// setCommitteeCommitment installs it for a bootstrapped period.
func CommitteeCommitment(pubkeys [][]byte) (*big.Int, error) {
	pts, err := decompressCommittee(pubkeys)
	if err != nil {
		return nil, err
	}
	h := poseidon2.NewMerkleDamgardHasher()
	for i := range pts {
		xlo, xhi := circuits.PackCoord(&pts[i].X)
		ylo, yhi := circuits.PackCoord(&pts[i].Y)
		for _, e := range []bnfr.Element{xlo, xhi, ylo, yhi} {
			b := e.Bytes()
			if _, err := h.Write(b[:]); err != nil {
				return nil, err
			}
		}
	}
	var out bnfr.Element
	out.SetBytes(h.Sum(nil))
	return out.BigInt(new(big.Int)), nil
}

func decompressCommittee(pubkeys [][]byte) ([]bls.G1Affine, error) {
	if len(pubkeys) != CommitteeSize {
		return nil, fmt.Errorf("prover: expected %d pubkeys, got %d", CommitteeSize, len(pubkeys))
	}
	pts := make([]bls.G1Affine, CommitteeSize)
	for i, raw := range pubkeys {
		if len(raw) != 48 {
			return nil, fmt.Errorf("prover: pubkey %d is %d bytes, want 48", i, len(raw))
		}
		if _, err := pts[i].SetBytes(raw); err != nil {
			return nil, fmt.Errorf("prover: pubkey %d: %w", i, err)
		}
	}
	return pts, nil
}

// Prove produces a proof that the aggregate of the members `participation`
// selects, from `pubkeys`, is the returned Aggregate.
//
// pubkeys are the 512 compressed committee keys in committee order;
// participation is the 64-byte SSZ bitfield, bit 8b+i in byte b.
func (s *Setup) Prove(pubkeys [][]byte, participation []byte) (*Result, error) {
	if len(participation) != CommitteeSize/8 {
		return nil, fmt.Errorf("prover: participation is %d bytes, want %d", len(participation), CommitteeSize/8)
	}
	if err := s.Warm(); err != nil {
		return nil, err
	}
	pts, err := decompressCommittee(pubkeys)
	if err != nil {
		return nil, err
	}

	// Subset aggregate, and the bitfield packed the way the circuit unpacks
	// it: BitsPerWord bits per word, least significant bit first.
	words := make([]*big.Int, circuits.NbBitWords(CommitteeSize))
	for i := range words {
		words[i] = new(big.Int)
	}
	var accJ bls.G1Jac
	signers := 0
	for i := 0; i < CommitteeSize; i++ {
		if participation[i/8]&(1<<(uint(i)%8)) == 0 {
			continue
		}
		accJ.AddMixed(&pts[i])
		w := words[i/circuits.BitsPerWord]
		w.SetBit(w, i%circuits.BitsPerWord, 1)
		signers++
	}
	if signers == 0 {
		return nil, fmt.Errorf("prover: bitfield selects nobody")
	}
	var agg bls.G1Affine
	agg.FromJacobian(&accJ)

	commitment, err := CommitteeCommitment(pubkeys)
	if err != nil {
		return nil, err
	}

	assignment := &circuits.AggregateCircuit{
		Pk:         make([]sw_emulated.AffinePoint[emulated.BLS12381Fp], CommitteeSize),
		BitsPacked: make([]frontend.Variable, len(words)),
		Agg: sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](agg.X),
			Y: emulated.ValueOf[emulated.BLS12381Fp](agg.Y),
		},
		Comm:    commitment,
		N:       CommitteeSize,
		Unified: true, Commit: true, CommitY: true, OnCurve: false,
	}
	for i := range words {
		assignment.BitsPacked[i] = words[i]
	}
	for i := range pts {
		assignment.Pk[i] = sw_emulated.AffinePoint[emulated.BLS12381Fp]{
			X: emulated.ValueOf[emulated.BLS12381Fp](pts[i].X),
			Y: emulated.ValueOf[emulated.BLS12381Fp](pts[i].Y),
		}
	}

	full, err := frontend.NewWitness(assignment, ecc.BN254.ScalarField())
	if err != nil {
		return nil, fmt.Errorf("prover: witness: %w", err)
	}
	pub, err := full.Public()
	if err != nil {
		return nil, fmt.Errorf("prover: public witness: %w", err)
	}

	start := time.Now()
	s.mu.Lock()
	ccs, pk, vk := s.ccs, s.pk, s.vk
	s.mu.Unlock()

	proof, err := plonk.Prove(ccs, pk, full)
	if err != nil {
		return nil, fmt.Errorf("prover: prove: %w", err)
	}
	// Verify before returning. A proof that fails here would fail on-chain
	// too, and finding that out now costs one verification rather than a
	// transaction and a confusing revert.
	if err := plonk.Verify(proof, vk, pub); err != nil {
		return nil, fmt.Errorf("prover: self-verify: %w", err)
	}
	elapsed := time.Since(start)

	vec := pub.Vector().(bnfr.Vector)
	pis := make([]*big.Int, len(vec))
	for i := range vec {
		pis[i] = vec[i].BigInt(new(big.Int))
	}

	return &Result{
		Aggregate:    uncompressedG1(&agg),
		Commitment:   commitment,
		Proof:        proofWords(proof.(*plonkbn254.Proof)),
		PublicInputs: pis,
		Signers:      signers,
		Elapsed:      elapsed,
	}, nil
}

// uncompressedG1 renders a point in EIP-2537 form: each coordinate is 16 zero
// bytes then its 48-byte big-endian value.
func uncompressedG1(p *bls.G1Affine) []byte {
	out := make([]byte, 128)
	x := p.X.Bytes()
	y := p.Y.Bytes()
	copy(out[16:64], x[:])
	copy(out[80:128], y[:])
	return out
}

// proofWords is MarshalSolidity's blob as 32-byte words, which is what
// PlonkVerifier.verifyProof takes.
func proofWords(p *plonkbn254.Proof) []*big.Int {
	sol := p.MarshalSolidity()
	if len(sol)%32 != 0 {
		panic("prover: MarshalSolidity is not word-aligned")
	}
	words := make([]*big.Int, len(sol)/32)
	for i := range words {
		words[i] = new(big.Int).SetBytes(sol[32*i : 32*(i+1)])
	}
	return words
}

// VKWords is PlonkVerifier.initialize's layout: 29 classic words then
// [Qcp.x, Qcp.y, commitmentConstraintIndex] per Bsb22 commitment.
func (s *Setup) VKWords() []*big.Int {
	vk := s.VerifyingKey()
	if vk == nil {
		return nil
	}
	var words []*big.Int
	add := func(e interface{ BigInt(*big.Int) *big.Int }) {
		words = append(words, e.BigInt(new(big.Int)))
	}
	words = append(words, new(big.Int).SetUint64(vk.Size))
	add(&vk.Generator)
	add(&vk.SizeInv)
	add(&vk.CosetShift)
	words = append(words, new(big.Int).SetUint64(uint64(vk.NbPublicVariables)))
	for i := range vk.S {
		add(&vk.S[i].X)
		add(&vk.S[i].Y)
	}
	add(&vk.Ql.X)
	add(&vk.Ql.Y)
	add(&vk.Qr.X)
	add(&vk.Qr.Y)
	add(&vk.Qm.X)
	add(&vk.Qm.Y)
	add(&vk.Qo.X)
	add(&vk.Qo.Y)
	add(&vk.Qk.X)
	add(&vk.Qk.Y)
	for i := 0; i < 2; i++ {
		g2 := vk.Kzg.G2[i]
		add(&g2.X.A1)
		add(&g2.X.A0)
		add(&g2.Y.A1)
		add(&g2.Y.A0)
	}
	for i := range vk.Qcp {
		add(&vk.Qcp[i].X)
		add(&vk.Qcp[i].Y)
		words = append(words, new(big.Int).SetUint64(vk.CommitmentConstraintIndexes[i]))
	}
	return words
}
