{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Railgun.Prover
  ( -- * Types
    ProverConfig(..)
  , ProverMode(..)
    -- * Proof generation
  , generateProof
  , defaultProverConfig
  ) where

import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import System.Environment (lookupEnv)

import Railgun.Unshield (SnarkProof(..), G1Point(..), G2Point(..))
import Railgun.Witness (CircuitInputs, witnessToJSON)

import qualified Groth16.Snarkjs as Snarkjs
import qualified Groth16.Rapidsnark as Rapidsnark
import qualified Groth16.BN254 as Native

-- | Prover mode
data ProverMode = SnarkjsProver | RapidsnarkProver | NativeProver
  deriving (Show, Eq)

-- | Configuration for the prover
data ProverConfig = ProverConfig
  { pcCircuitWasm    :: !FilePath   -- ^ Path to circuit .wasm file
  , pcProvingKey     :: !FilePath   -- ^ Path to .zkey proving key
  , pcProvingKeyJSON :: !FilePath   -- ^ Path to .json proving key (native prover)
  , pcSnarkjsPath    :: !FilePath   -- ^ Path to snarkjs executable
  , pcRapidsnarkPath :: !FilePath   -- ^ Path to rapidsnark executable
  , pcProverMode     :: !ProverMode -- ^ Which prover to use
  } deriving (Show, Eq)

-- | Default prover config for 01x02 circuit
defaultProverConfig :: ProverConfig
defaultProverConfig = ProverConfig
  { pcCircuitWasm = "/home/golemshid/strato-platform/strato/tools/airlock/circuits/01x02/circuit.wasm"
  , pcProvingKey = "/home/golemshid/strato-platform/strato/tools/airlock/circuits/01x02/zkey"
  , pcProvingKeyJSON = "/home/golemshid/strato-platform/strato/tools/airlock/circuits/01x02/circuit_pk.json"
  , pcSnarkjsPath = "snarkjs"
  , pcRapidsnarkPath = "rapidsnark"
  , pcProverMode = SnarkjsProver
  }

-- | Generate a Groth16 proof
--   Use AIRLOCK_PROVER env var to override: native, snarkjs, rapidsnark
generateProof :: ProverConfig -> CircuitInputs -> IO (Either Text SnarkProof)
generateProof config inputs = do
  mode <- getProverMode config
  let inputJson = witnessToJSON inputs
  case mode of
    SnarkjsProver    -> generateSnarkjs config inputJson
    RapidsnarkProver -> generateRapidsnark config inputJson
    NativeProver     -> generateNative config inputJson

-- | Get prover mode (env var overrides config)
getProverMode :: ProverConfig -> IO ProverMode
getProverMode config = do
  env <- lookupEnv "AIRLOCK_PROVER"
  return $ case env of
    Just "native"     -> NativeProver
    Just "snarkjs"    -> SnarkjsProver
    Just "rapidsnark" -> RapidsnarkProver
    _                 -> pcProverMode config

-- | Generate proof via snarkjs
generateSnarkjs :: ProverConfig -> LBS.ByteString -> IO (Either Text SnarkProof)
generateSnarkjs ProverConfig{..} inputJson = do
  let cfg = Snarkjs.Config
        { Snarkjs.cfgCircuitWasm = pcCircuitWasm
        , Snarkjs.cfgProvingKey  = pcProvingKey
        , Snarkjs.cfgSnarkjsPath = pcSnarkjsPath
        }
  result <- Snarkjs.generateProof cfg inputJson
  return $ fmap convertSnarkjsProof result

-- | Generate proof via rapidsnark
generateRapidsnark :: ProverConfig -> LBS.ByteString -> IO (Either Text SnarkProof)
generateRapidsnark ProverConfig{..} inputJson = do
  let cfg = Rapidsnark.Config
        { Rapidsnark.cfgCircuitWasm    = pcCircuitWasm
        , Rapidsnark.cfgProvingKey     = pcProvingKey
        , Rapidsnark.cfgRapidsnarkPath = pcRapidsnarkPath
        , Rapidsnark.cfgSnarkjsPath    = pcSnarkjsPath
        }
  result <- Rapidsnark.generateProof cfg inputJson
  return $ fmap convertRapidsnarkProof result

-- | Generate proof via native Haskell prover
generateNative :: ProverConfig -> LBS.ByteString -> IO (Either Text SnarkProof)
generateNative ProverConfig{..} inputJson = do
  putStrLn "WARNING: Native prover is experimental and may produce invalid proofs."
  -- Load proving key
  pkResult <- Native.loadProvingKeyJSON pcProvingKeyJSON
  case pkResult of
    Left err -> return $ Left $ "Failed to load proving key: " <> err
    Right pk -> do
      -- Generate witness via snarkjs (native prover only does proving)
      let cfg = Snarkjs.Config
            { Snarkjs.cfgCircuitWasm = pcCircuitWasm
            , Snarkjs.cfgProvingKey  = pcProvingKey
            , Snarkjs.cfgSnarkjsPath = pcSnarkjsPath
            }
      -- Use snarkjs just for witness, then extract and use native prover
      -- For now, use a simplified approach: call snarkjs for full proof
      -- but with native key loaded (TODO: proper witness extraction)
      result <- Snarkjs.generateProof cfg inputJson
      case result of
        Left err -> return $ Left err
        Right _ -> do
          -- Generate native proof (requires witness file - simplified for now)
          -- TODO: Extract witness from snarkjs and use Native.prove
          return $ Left $ "Native prover integration incomplete. " <>
                         "Proving key loaded: nVars=" <> T.pack (show (Native.pkNVars pk)) <>
                         ", domainSize=" <> T.pack (show (Native.pkDomainSize pk))

-- | Convert Snarkjs.Proof to SnarkProof
convertSnarkjsProof :: Snarkjs.Proof -> SnarkProof
convertSnarkjsProof p = SnarkProof
  { proofA = G1Point (Snarkjs.g1x $ Snarkjs.proofA p) (Snarkjs.g1y $ Snarkjs.proofA p)
  , proofB = G2Point (Snarkjs.g2x $ Snarkjs.proofB p) (Snarkjs.g2y $ Snarkjs.proofB p)
  , proofC = G1Point (Snarkjs.g1x $ Snarkjs.proofC p) (Snarkjs.g1y $ Snarkjs.proofC p)
  }

-- | Convert Rapidsnark.Proof to SnarkProof
convertRapidsnarkProof :: Rapidsnark.Proof -> SnarkProof
convertRapidsnarkProof p = SnarkProof
  { proofA = G1Point (Rapidsnark.g1x $ Rapidsnark.proofA p) (Rapidsnark.g1y $ Rapidsnark.proofA p)
  , proofB = G2Point (Rapidsnark.g2x $ Rapidsnark.proofB p) (Rapidsnark.g2y $ Rapidsnark.proofB p)
  , proofC = G1Point (Rapidsnark.g1x $ Rapidsnark.proofC p) (Rapidsnark.g1y $ Rapidsnark.proofC p)
  }
