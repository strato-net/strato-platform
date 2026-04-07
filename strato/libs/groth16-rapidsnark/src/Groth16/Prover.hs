{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

-- | High-level Groth16 prover using rapidsnark FFI
--
-- This module provides a Haskell interface for generating Groth16 proofs
-- using the rapidsnark library via FFI. No external CLI tools required.
--
-- Example usage:
--
-- @
-- import Groth16.Prover
-- 
-- main = do
--   let config = defaultConfig { pcProvingKey = "path/to/zkey" }
--   result <- generateProof config witnessBytes
--   case result of
--     Left err -> putStrLn $ "Error: " ++ show err
--     Right proof -> print proof
-- @
--
module Groth16.Prover
  ( -- * Configuration
    ProverConfig(..)
  , defaultConfig
    -- * Proof types
  , Proof(..)
  , G1Point(..)
  , G2Point(..)
    -- * Proof generation
  , generateProofFromWitness
  ) where

import qualified Data.Aeson as Aeson
import Data.Aeson ((.:))
import Data.Aeson.Types (Parser, parseEither)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Lazy as LBS
import qualified Data.ByteString.Unsafe as BSU
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Vector as V
import Foreign.C.String
import Foreign.C.Types
import Foreign.Marshal.Alloc
import Foreign.Ptr
import Foreign.Storable

import Groth16.Prover.FFI

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

-- | Prover configuration
data ProverConfig = ProverConfig
  { pcProvingKey :: !FilePath   -- ^ Path to .zkey proving key file
  } deriving (Show, Eq)

-- | Default prover configuration
defaultConfig :: ProverConfig
defaultConfig = ProverConfig
  { pcProvingKey = ""
  }

-- | Generate a Groth16 proof from witness bytes
--
-- Takes the binary witness (.wtns format) and generates a proof.
-- The witness must be computed separately (e.g., via WASM circuit execution).
--
generateProofFromWitness 
  :: ProverConfig 
  -> BS.ByteString   -- ^ Witness in .wtns binary format
  -> IO (Either Text Proof)
generateProofFromWitness ProverConfig{..} witnessBytes = do
  -- Get required buffer sizes
  proofSizePtr <- malloc :: IO (Ptr CULLong)
  c_groth16_proof_size proofSizePtr
  proofSize <- peek proofSizePtr
  free proofSizePtr
  
  -- Allocate buffers
  -- proof_size is for JSON output, typically ~1KB
  -- public_size depends on circuit, allocate generously
  let publicSize = 8192 :: CULLong  -- 8KB should be plenty
      errorSize = 4096 :: CULLong   -- 4KB for error messages
  
  allocaBytes (fromIntegral proofSize) $ \proofBuffer ->
    allocaBytes (fromIntegral publicSize) $ \publicBuffer ->
      allocaBytes (fromIntegral errorSize) $ \errorBuffer ->
        alloca $ \proofSizeOutPtr ->
          alloca $ \publicSizeOutPtr ->
            withCString pcProvingKey $ \zkeyPath -> do
              -- Initialize size pointers
              poke proofSizeOutPtr proofSize
              poke publicSizeOutPtr publicSize
              
              -- Call the prover
              result <- BSU.unsafeUseAsCStringLen witnessBytes $ \(witnessPtr, witnessLen) ->
                c_groth16_prover_zkey_file
                  zkeyPath
                  (castPtr witnessPtr)
                  (fromIntegral witnessLen)
                  proofBuffer
                  proofSizeOutPtr
                  publicBuffer
                  publicSizeOutPtr
                  errorBuffer
                  errorSize
              
              case result of
                r | r == proverOk -> do
                  -- Parse the proof JSON
                  proofJson <- BS.packCString proofBuffer
                  pure $ parseProofJSON (LBS.fromStrict proofJson)
                
                r | r == proverErrorShortBuffer -> do
                  -- Get required sizes
                  reqProof <- peek proofSizeOutPtr
                  reqPublic <- peek publicSizeOutPtr
                  pure $ Left $ "Buffer too small. Proof needs: " <> T.pack (show reqProof)
                           <> ", Public needs: " <> T.pack (show reqPublic)
                
                r | r == proverInvalidWitnessLength ->
                  pure $ Left "Invalid witness length - doesn't match circuit"
                
                _ -> do
                  errorMsg <- peekCString errorBuffer
                  pure $ Left $ "Prover error: " <> T.pack errorMsg

-- | Parse proof from rapidsnark JSON output
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
