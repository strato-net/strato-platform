{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | Groth16 proof generation via snarkjs CLI
--
-- This module wraps the snarkjs Node.js tool for witness calculation
-- and Groth16 proof generation. Requires snarkjs to be installed.
--
module Groth16.Snarkjs
  ( -- * Types
    Config(..)
  , Proof(..)
  , G1Point(..)
  , G2Point(..)
    -- * Proof generation
  , generateProof
  ) where

import qualified Data.Aeson as Aeson
import Data.Aeson ((.:))
import Data.Aeson.Types (Parser, parseEither)
import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Vector as V
import System.Exit (ExitCode(..))
import System.Process (readProcessWithExitCode)
import System.IO.Temp (withSystemTempDirectory)
import System.FilePath ((</>))

-- | G1 curve point (affine coordinates)
data G1Point = G1Point
  { g1x :: !Integer
  , g1y :: !Integer
  } deriving (Show, Eq)

-- | G2 curve point (affine coordinates, Fq2 elements)
data G2Point = G2Point
  { g2x :: !(Integer, Integer)  -- ^ x coordinate (c0, c1) where x = c0 + c1*u
  , g2y :: !(Integer, Integer)  -- ^ y coordinate (c0, c1)
  } deriving (Show, Eq)

-- | Groth16 proof (3 curve points)
data Proof = Proof
  { proofA :: !G1Point
  , proofB :: !G2Point
  , proofC :: !G1Point
  } deriving (Show, Eq)

-- | Configuration for snarkjs prover
data Config = Config
  { cfgCircuitWasm :: !FilePath   -- ^ Path to circuit .wasm file
  , cfgProvingKey  :: !FilePath   -- ^ Path to .zkey proving key
  , cfgSnarkjsPath :: !FilePath   -- ^ Path to snarkjs executable (default: "snarkjs")
  } deriving (Show, Eq)

-- | Generate a Groth16 proof using snarkjs
--
-- Takes circuit inputs as JSON ByteString, returns proof or error.
-- Performs both witness calculation and proof generation.
generateProof :: Config -> LBS.ByteString -> IO (Either Text Proof)
generateProof Config{..} inputJson = do
  withSystemTempDirectory "groth16_snarkjs" $ \tmpDir -> do
    let inputFile = tmpDir </> "input.json"
        witnessFile = tmpDir </> "witness.wtns"
        proofFile = tmpDir </> "proof.json"
        publicFile = tmpDir </> "public.json"
    
    -- Write inputs to JSON file
    LBS.writeFile inputFile inputJson
    
    -- Step 1: Generate witness
    let witnessArgs = ["wtns", "calculate", cfgCircuitWasm, inputFile, witnessFile]
    (exitCode1, stdout1, stderr1) <- readProcessWithExitCode cfgSnarkjsPath witnessArgs ""
    case exitCode1 of
      ExitFailure code -> 
        return $ Left $ "Witness generation failed (exit " <> T.pack (show code) <> "): " 
                     <> T.pack stdout1 <> " | " <> T.pack stderr1
      ExitSuccess -> do
        -- Step 2: Generate proof
        let proveArgs = ["groth16", "prove", cfgProvingKey, witnessFile, proofFile, publicFile]
        (exitCode2, stdout2, stderr2) <- readProcessWithExitCode cfgSnarkjsPath proveArgs ""
        case exitCode2 of
          ExitFailure code ->
            return $ Left $ "Proof generation failed (exit " <> T.pack (show code) <> "): " 
                         <> T.pack stdout2 <> " | " <> T.pack stderr2
          ExitSuccess -> do
            -- Parse the proof JSON
            proofJson <- LBS.readFile proofFile
            return $ parseProofJSON proofJson

-- | Parse proof from snarkjs JSON output
parseProofJSON :: LBS.ByteString -> Either Text Proof
parseProofJSON bs = case Aeson.decode bs of
  Nothing -> Left "Failed to decode proof JSON"
  Just val -> parseProofObject val

parseProofObject :: Aeson.Value -> Either Text Proof
parseProofObject = either (Left . T.pack) Right . parseEither parseProof
  where
    parseProof :: Aeson.Value -> Parser Proof
    parseProof = Aeson.withObject "Proof" $ \obj -> do
      piA <- obj .: "pi_a"
      piB <- obj .: "pi_b"
      piC <- obj .: "pi_c"
      case (piA, piC) of
        (Aeson.Array arrA, Aeson.Array arrC) -> do
          -- Parse G1 points (pi_a and pi_c are [x, y, z] strings)
          aX <- parseCoord arrA 0
          aY <- parseCoord arrA 1
          cX <- parseCoord arrC 0
          cY <- parseCoord arrC 1
          -- Parse G2 point (pi_b is [[x0,x1], [y0,y1], [z0,z1]])
          case piB of
            Aeson.Array arrB -> do
              bX <- parseG2Coord arrB 0
              bY <- parseG2Coord arrB 1
              return $ Proof (G1Point aX aY) (G2Point bX bY) (G1Point cX cY)
            _ -> fail "Invalid pi_b format"
        _ -> fail "Invalid pi_a or pi_c format"
    
    parseCoord arr idx = do
      case arr V.!? idx of
        Just (Aeson.String s) -> return $ read (T.unpack s)
        _ -> fail $ "Missing coordinate at index " ++ show idx
    
    parseG2Coord arr idx = do
      case arr V.!? idx of
        Just (Aeson.Array inner) -> do
          c0 <- parseCoord inner 0
          c1 <- parseCoord inner 1
          return (c0, c1)
        _ -> fail $ "Missing G2 coordinate at index " ++ show idx
