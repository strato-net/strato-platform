{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Witness calculation for Groth16 circuits
--
-- This module handles converting circuit inputs (JSON) into a binary witness
-- (.wtns format) that can be used by the prover.
--
-- The witness is computed by executing the circuit's WebAssembly module
-- with the given inputs.
--
module Groth16.Witness
  ( -- * Configuration
    WitnessConfig(..)
  , defaultWitnessConfig
    -- * Witness generation
  , calculateWitness
  , WitnessError(..)
  ) where

import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import System.Exit (ExitCode(..))
import System.IO.Temp (withSystemTempDirectory)
import System.FilePath ((</>))
import System.Process (readProcessWithExitCode)
import System.Directory (doesFileExist)

-- | Witness calculation configuration
data WitnessConfig = WitnessConfig
  { wcCircuitWasm :: !FilePath   -- ^ Path to circuit .wasm file
  , wcSnarkjsPath :: !FilePath   -- ^ Path to snarkjs executable (temporary, until native WASM support)
  } deriving (Show, Eq)

-- | Default witness configuration
defaultWitnessConfig :: WitnessConfig
defaultWitnessConfig = WitnessConfig
  { wcCircuitWasm = ""
  , wcSnarkjsPath = "snarkjs"
  }

-- | Errors that can occur during witness calculation
data WitnessError
  = WitnessCircuitNotFound FilePath
  | WitnessCalculationFailed Text
  | WitnessSnarkjsNotFound
  deriving (Show, Eq)

-- | Calculate witness from circuit inputs
--
-- Takes JSON-encoded circuit inputs and produces binary witness (.wtns format).
--
-- NOTE: This currently uses snarkjs for witness calculation. 
-- Future versions will use a native WASM runtime for true "just works" experience.
-- The witness calculation is fast (~100ms), so this is acceptable for now.
-- The slow part (proving) uses native rapidsnark FFI.
--
-- To fully eliminate Node.js dependency, we need to either:
-- 1. Use a Haskell WASM runtime (wasmer-hs, wasmtime)
-- 2. Include wasm3 (lightweight C WASM interpreter) via FFI
-- 3. Generate C++ witness calculator from circom and include via FFI
--
calculateWitness 
  :: WitnessConfig 
  -> LBS.ByteString   -- ^ Circuit inputs as JSON
  -> IO (Either WitnessError BS.ByteString)
calculateWitness WitnessConfig{..} inputJson = do
  -- Check circuit exists
  circuitExists <- doesFileExist wcCircuitWasm
  if not circuitExists
    then return $ Left $ WitnessCircuitNotFound wcCircuitWasm
    else withSystemTempDirectory "groth16_witness" $ \tmpDir -> do
      let inputFile = tmpDir </> "input.json"
          witnessFile = tmpDir </> "witness.wtns"
      
      -- Write inputs to JSON file
      LBS.writeFile inputFile inputJson
      
      -- Calculate witness using snarkjs
      let witnessArgs = ["wtns", "calculate", wcCircuitWasm, inputFile, witnessFile]
      (exitCode, stdout, stderr) <- readProcessWithExitCode wcSnarkjsPath witnessArgs ""
      
      case exitCode of
        ExitFailure code -> 
          return $ Left $ WitnessCalculationFailed $ 
            "snarkjs failed (exit " <> T.pack (show code) <> "): " 
            <> T.pack stdout <> " | " <> T.pack stderr
        ExitSuccess -> do
          -- Read the witness file
          witnessBytes <- BS.readFile witnessFile
          return $ Right witnessBytes
