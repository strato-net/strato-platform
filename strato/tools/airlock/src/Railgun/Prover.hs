{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Railgun.Prover
  ( -- * Types
    ProverConfig(..)
    -- * Proof generation
  , generateProof
  , defaultProverConfig
  ) where

import qualified Data.Aeson as Aeson
import Data.Aeson ((.:))
import Data.Aeson.Types (Parser, parseEither)
import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import System.Exit (ExitCode(..))
import System.Process (readProcessWithExitCode)
import System.IO.Temp (withSystemTempDirectory)
import System.FilePath ((</>))

import Railgun.Unshield (SnarkProof(..), G1Point(..), G2Point(..))
import Railgun.Witness (CircuitInputs, witnessToJSON)

-- | Configuration for the prover
data ProverConfig = ProverConfig
  { pcCircuitWasm :: FilePath    -- ^ Path to circuit .wasm file
  , pcProvingKey :: FilePath     -- ^ Path to .zkey proving key
  , pcSnarkjsPath :: FilePath    -- ^ Path to snarkjs executable
  } deriving (Show, Eq)

-- | Default prover config for 01x02 circuit (absolute paths)
defaultProverConfig :: ProverConfig
defaultProverConfig = ProverConfig
  { pcCircuitWasm = "/home/golemshid/strato-platform/strato/tools/airlock/circuits/01x02/circuit.wasm"
  , pcProvingKey = "/home/golemshid/strato-platform/strato/tools/airlock/circuits/01x02/zkey"
  , pcSnarkjsPath = "snarkjs"
  }

-- | Generate a Groth16 proof using snarkjs
generateProof :: ProverConfig -> CircuitInputs -> IO (Either Text SnarkProof)
generateProof config inputs = do
  withSystemTempDirectory "railgun_proof" $ \tmpDir -> do
    let inputFile = tmpDir </> "input.json"
        witnessFile = tmpDir </> "witness.wtns"
        proofFile = tmpDir </> "proof.json"
        publicFile = tmpDir </> "public.json"
    
    -- Write inputs to JSON file
    let inputJson = witnessToJSON inputs
    LBS.writeFile inputFile inputJson
    
    -- Step 1: Generate witness
    let witnessCmd = pcSnarkjsPath config
        witnessArgs = ["wtns", "calculate", pcCircuitWasm config, inputFile, witnessFile]
    
    (exitCode1, stdout1, stderr1) <- readProcessWithExitCode witnessCmd witnessArgs ""
    case exitCode1 of
      ExitFailure code -> 
        return $ Left $ "Witness generation failed (exit " <> T.pack (show code) <> "): " 
                     <> T.pack stdout1 <> " | " <> T.pack stderr1
      ExitSuccess -> do
        -- Step 2: Generate proof
        let proveCmd = pcSnarkjsPath config
            proveArgs = ["groth16", "prove", pcProvingKey config, witnessFile, proofFile, publicFile]
        
        (exitCode2, _, stderr2) <- readProcessWithExitCode proveCmd proveArgs ""
        case exitCode2 of
          ExitFailure code ->
            return $ Left $ "Proof generation failed (exit " <> T.pack (show code) <> "): " <> T.pack stderr2
          ExitSuccess -> do
            -- Parse the proof
            proofJson <- LBS.readFile proofFile
            case parseProofJSON proofJson of
              Left err -> return $ Left $ "Failed to parse proof: " <> err
              Right proof -> return $ Right proof

-- | Parse snarkjs proof JSON format
parseProofJSON :: LBS.ByteString -> Either Text SnarkProof
parseProofJSON json = 
  case Aeson.eitherDecode json of
    Left err -> Left $ T.pack err
    Right obj -> parseProofObject obj

parseProofObject :: Aeson.Value -> Either Text SnarkProof
parseProofObject = either (Left . T.pack) Right . parseEither parseProof
  where
    parseProof :: Aeson.Value -> Parser SnarkProof
    parseProof v = do
      obj <- Aeson.parseJSON v
      piA <- obj .: "pi_a" :: Parser [Text]
      piB <- obj .: "pi_b" :: Parser [[Text]]
      piC <- obj .: "pi_c" :: Parser [Text]
      -- Parse G1 point (pi_a and pi_c are [x, y, z] where z=1)
      case (piA, piC) of
        (aX:aY:_, cX:cY:_) -> do
          let aXInt = read (T.unpack aX) :: Integer
              aYInt = read (T.unpack aY) :: Integer
              cXInt = read (T.unpack cX) :: Integer
              cYInt = read (T.unpack cY) :: Integer
          -- Parse G2 point (pi_b is [[x0, x1], [y0, y1], [z0, z1]])
          case piB of
            (bXArr:bYArr:_) ->
              case (bXArr, bYArr) of
                (bX0:bX1:_, bY0:bY1:_) -> do
                  let bX0Int = read (T.unpack bX0) :: Integer
                      bX1Int = read (T.unpack bX1) :: Integer
                      bY0Int = read (T.unpack bY0) :: Integer
                      bY1Int = read (T.unpack bY1) :: Integer
                  return SnarkProof
                    { proofA = G1Point aXInt aYInt
                    , proofB = G2Point (bX0Int, bX1Int) (bY0Int, bY1Int)  -- Keep snarkjs order
                    , proofC = G1Point cXInt cYInt
                    }
                _ -> fail "Invalid pi_b format"
            _ -> fail "Invalid pi_b format"
        _ -> fail "Invalid pi_a or pi_c format"
