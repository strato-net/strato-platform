{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Witness calculation for Groth16 circuits
--
-- This module handles converting circuit inputs (JSON) into a binary witness
-- that can be used by the prover.
--
-- Uses wasm3 (embedded WASM interpreter) to execute the circuit natively,
-- without requiring Node.js or snarkjs.
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
import System.Directory (doesFileExist)
import Foreign.C.String
import Foreign.Marshal.Alloc
import Foreign.Marshal.Array
import Foreign.Storable

import Groth16.Witness.FFI

-- | Witness calculation configuration
data WitnessConfig = WitnessConfig
  { wcCircuitWasm :: !FilePath   -- ^ Path to circuit .wasm file
  } deriving (Show, Eq)

-- | Default witness configuration
defaultWitnessConfig :: WitnessConfig
defaultWitnessConfig = WitnessConfig
  { wcCircuitWasm = ""
  }

-- | Errors that can occur during witness calculation
data WitnessError
  = WitnessCircuitNotFound FilePath
  | WitnessCalculationFailed Text
  deriving (Show, Eq)

-- | Calculate witness from circuit inputs using native wasm3 runtime.
--
-- Takes JSON-encoded circuit inputs and produces binary witness.
-- This is a fully native implementation - no Node.js or snarkjs required.
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
    else calculateWitnessNative wcCircuitWasm (LBS.toStrict inputJson)

-- | Native witness calculation using wasm3
calculateWitnessNative :: FilePath -> BS.ByteString -> IO (Either WitnessError BS.ByteString)
calculateWitnessNative wasmPath inputJson = do
  let errorBufSize = 1024
  
  -- First, get the required witness buffer size
  allocaBytes errorBufSize $ \errorBuf -> do
    alloca $ \sizePtr -> do
      withCString wasmPath $ \wasmPathC -> do
        -- Get witness size
        ret <- c_circom_witness_size wasmPathC sizePtr errorBuf (fromIntegral errorBufSize)
        
        if ret /= 0
          then do
            errorMsg <- peekCString errorBuf
            return $ Left $ WitnessCalculationFailed $ T.pack errorMsg
          else do
            requiredSize <- peek sizePtr
            
            -- Allocate witness buffer and calculate
            allocaBytes (fromIntegral requiredSize) $ \witnessBuf -> do
              alloca $ \witSizePtr -> do
                poke witSizePtr requiredSize
                
                -- Calculate witness
                BS.useAsCString inputJson $ \inputJsonC -> do
                  ret2 <- c_circom_calc_witness wasmPathC inputJsonC witnessBuf witSizePtr errorBuf (fromIntegral errorBufSize)
                  
                  if ret2 /= 0
                    then do
                      errorMsg <- peekCString errorBuf
                      return $ Left $ WitnessCalculationFailed $ T.pack errorMsg
                    else do
                      actualSize <- peek witSizePtr
                      -- Copy witness data to ByteString
                      witnessData <- peekArray (fromIntegral actualSize) witnessBuf
                      return $ Right $ BS.pack $ map fromIntegral witnessData
