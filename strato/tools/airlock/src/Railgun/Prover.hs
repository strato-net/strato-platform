{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Railgun.Prover
  ( -- * Types
    ProverConfig(..)
  , ProverMode(..)
    -- * Proof generation
  , generateProof
  , getProverConfig
  ) where

import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import System.Environment (lookupEnv)
import System.FilePath ((</>))

import Paths_airlock (getDataDir)

import Railgun.Unshield (SnarkProof(..), G1Point(..), G2Point(..))
import Railgun.Witness (CircuitInputs, witnessToJSON)

import qualified Groth16.Snarkjs as Snarkjs
import qualified Groth16.Prover as Rapidsnark
import qualified Groth16.Witness as Witness
import qualified Groth16.BN254 as Native

-- | Prover mode
data ProverMode = SnarkjsProver | RapidsnarkProver | NativeProver
  deriving (Show, Eq)

-- | Configuration for the prover
data ProverConfig = ProverConfig
  { pcCircuitWasm    :: !FilePath   -- ^ Path to circuit .wasm file
  , pcProvingKey     :: !FilePath   -- ^ Path to .zkey proving key
  , pcProvingKeyJSON :: !FilePath   -- ^ Path to .json proving key (native prover)
  , pcSnarkjsPath    :: !FilePath   -- ^ Path to snarkjs executable (only for SnarkjsProver mode)
  , pcProverMode     :: !ProverMode -- ^ Which prover to use
  } deriving (Show, Eq)

-- | Get prover config for 01x02 circuit
-- Uses AIRLOCK_CIRCUITS_DIR env var, or falls back to data-files location
-- Uses native witness calculation (wasm3) + native proving (rapidsnark FFI)
-- No Node.js or snarkjs required!
getProverConfig :: IO ProverConfig
getProverConfig = do
  circuitsDir <- getCircuitsDir
  let circuitDir = circuitsDir </> "01x02"
  return ProverConfig
    { pcCircuitWasm = circuitDir </> "circuit.wasm"
    , pcProvingKey = circuitDir </> "zkey"
    , pcProvingKeyJSON = circuitDir </> "circuit_pk.json"
    , pcSnarkjsPath = "snarkjs"
    , pcProverMode = RapidsnarkProver
    }

-- | Get circuits directory from env var or package data-files location
getCircuitsDir :: IO FilePath
getCircuitsDir = do
  env <- lookupEnv "AIRLOCK_CIRCUITS_DIR"
  case env of
    Just dir -> return dir
    Nothing -> do
      dataDir <- getDataDir
      return $ dataDir </> "circuits"


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

-- | Generate proof via snarkjs (witness + proving)
generateSnarkjs :: ProverConfig -> LBS.ByteString -> IO (Either Text SnarkProof)
generateSnarkjs ProverConfig{..} inputJson = do
  putStrLn "[Prover] Witness: snarkjs (Node.js) | Proving: snarkjs (Node.js)"
  let cfg = Snarkjs.Config
        { Snarkjs.cfgCircuitWasm = pcCircuitWasm
        , Snarkjs.cfgProvingKey  = pcProvingKey
        , Snarkjs.cfgSnarkjsPath = pcSnarkjsPath
        }
  result <- Snarkjs.generateProof cfg inputJson
  return $ fmap convertSnarkjsProof result

-- | Generate proof via rapidsnark (fully native)
--   Uses wasm3 for witness calculation, rapidsnark FFI for proving.
--   No Node.js or snarkjs required!
generateRapidsnark :: ProverConfig -> LBS.ByteString -> IO (Either Text SnarkProof)
generateRapidsnark ProverConfig{..} inputJson = do
  putStrLn "[Prover] Witness: wasm3 (native) | Proving: rapidsnark (native FFI)"
  
  -- Calculate witness using native wasm3 runtime
  let witnessCfg = Witness.WitnessConfig { Witness.wcCircuitWasm = pcCircuitWasm }
  witnessResult <- Witness.calculateWitness witnessCfg inputJson
  
  case witnessResult of
    Left err -> return $ Left $ "Witness calculation failed: " <> T.pack (show err)
    Right witnessBytes -> do
      let cfg = Rapidsnark.defaultConfig { Rapidsnark.pcProvingKey = pcProvingKey }
      result <- Rapidsnark.generateProofFromWitness cfg witnessBytes
      case result of
        Left err -> return $ Left err
        Right proof -> return $ Right $ convertRapidsnarkProof proof

-- | Generate proof via native Haskell prover
generateNative :: ProverConfig -> LBS.ByteString -> IO (Either Text SnarkProof)
generateNative ProverConfig{..} inputJson = do
  putStrLn "[Prover] Witness: wasm3 (native) | Proving: groth16-native (Haskell)"
  
  -- Load proving key from JSON
  pkResult <- Native.loadProvingKeyJSON pcProvingKeyJSON
  case pkResult of
    Left err -> return $ Left $ "Failed to load proving key: " <> err
    Right pk -> do
      putStrLn $ "  Proving key loaded: nVars=" ++ show (Native.pkNVars pk) ++
                 ", domainSize=" ++ show (Native.pkDomainSize pk)
      
      -- Calculate witness using native wasm3 runtime
      let witnessCfg = Witness.WitnessConfig { Witness.wcCircuitWasm = pcCircuitWasm }
      witnessResult <- Witness.calculateWitness witnessCfg inputJson
      
      case witnessResult of
        Left err -> return $ Left $ "Witness calculation failed: " <> T.pack (show err)
        Right witnessBytes -> do
          -- Parse witness from .wtns binary format
          case Native.parseWtns (LBS.fromStrict witnessBytes) of
            Left err -> return $ Left $ "Failed to parse witness: " <> err
            Right witness -> do
              -- Generate proof using native Haskell prover
              putStrLn "  Generating proof..."
              proof <- Native.prove pk witness
              
              -- Convert native proof to SnarkProof
              return $ Right $ convertNativeProof proof

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
  { proofA = G1Point (Rapidsnark.g1x a) (Rapidsnark.g1y a)
  , proofB = G2Point (Rapidsnark.g2x b) (Rapidsnark.g2y b)
  , proofC = G1Point (Rapidsnark.g1x c) (Rapidsnark.g1y c)
  }
  where
    a = Rapidsnark.proofA p
    b = Rapidsnark.proofB p
    c = Rapidsnark.proofC p

-- | Convert Native.Proof to SnarkProof
convertNativeProof :: Native.Proof -> SnarkProof
convertNativeProof proof =
  let ((ax, ay), ((bx0, bx1), (by0, by1)), (cx, cy)) = Native.proofToIntegers proof
  in SnarkProof
    { proofA = G1Point ax ay
    , proofB = G2Point (bx0, bx1) (by0, by1)
    , proofC = G1Point cx cy
    }
