module Blockchain.SolidVM.Builtins.Gas where

import Blockchain.Strato.Model.Gas
import Control.Monad.IO.Class (MonadIO)

class MonadIO m => MonadBuiltinGas m where
  chargeBuiltinGas :: Gas -> m ()

-- Gas schedule for the cryptographic builtins.
--
-- Unlike the rest of SolidVM's gas -- a coarse counter of statements and
-- expression nodes -- these operations do unbounded-cost work in a single
-- node. Left unmetered they were effectively free: a contract could buy
-- hundreds of milliseconds of pairing arithmetic for 5 gas, stalling block
-- production (PBFT's round-change cliff is 120s) for the price of a
-- function call.
--
-- The constants below are calibrated so that one gas unit is roughly one
-- microsecond of measured wall-clock on the current implementations, which
-- puts the 400k per-transaction budget at a few hundred milliseconds of
-- crypto. Reassuringly, that calibration lands close to Ethereum's own
-- schedule for the same primitives: the BN254 pairing works out to
-- 45000 + 17000k against EIP-197's 45000 + 34000k.
--
-- Costs are charged BEFORE the operation runs, sized from the input, so
-- an oversized input is rejected rather than paid for after the fact.
-- Because pairing is charged per pair, gas also serves as the input cap:
-- the budget admits roughly 20 pairs in a single call.
gasEcAdd, gasEcMul, gasEcPairingBase, gasEcPairingPerPair :: Gas
gasEcAdd = 50
gasEcMul = 300
gasEcPairingBase = 45000 -- the shared final exponentiation
gasEcPairingPerPair = 17000 -- one Miller loop

gasPoseidonBase, gasPoseidonPerInput :: Gas
gasPoseidonBase = 100
gasPoseidonPerInput = 100

gasModExp :: Gas
gasModExp = 100

-- | Parametrized Poseidon2: charged per PERMUTATION of the selected
-- instance. The Goldilocks width-12 permutation is ~740 field
-- multiplications in the current Integer-backed implementation (~60-100 µs);
-- BN254 t=2 keeps the poseidon2 schedule (100 + 100 per absorbed input).
gasPoseidon2GLBase, gasPoseidon2GLPerPerm :: Gas
gasPoseidon2GLBase = 100
gasPoseidon2GLPerPerm = 100

gasBlsG1Add, gasBlsG1MsmPerTerm, gasBlsG2Add, gasBlsG2MsmPerTerm :: Gas
gasBlsG1Add = 4000
gasBlsG1MsmPerTerm = 2500
gasBlsG2Add = 9000
gasBlsG2MsmPerTerm = 9000

gasBlsPairingBase, gasBlsPairingPerPair :: Gas
gasBlsPairingBase = 50000
gasBlsPairingPerPair = 20000

gasBlsMapFpToG1, gasBlsMapFp2ToG2, gasBlsDecompressG1, gasBlsDecompressG2 :: Gas
gasBlsMapFpToG1 = 5000
gasBlsMapFp2ToG2 = 20000
gasBlsDecompressG1 = 5000
gasBlsDecompressG2 = 20000
