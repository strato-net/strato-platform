{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE DeriveGeneric #-}

module Railgun.Witness
  ( -- * Types
    SpendableNote(..)
  , CircuitInputs(..)
    -- * Construction
  , buildUnshieldWitness
  , witnessToJSON
  ) where

import Data.Aeson (ToJSON(..), (.=), object)
import qualified Data.Aeson as Aeson
import qualified Data.ByteString.Lazy as LBS
import Data.Text (Text)
import qualified Data.Text as T
import GHC.Generics (Generic)

import Railgun.Merkle (MerkleProof(..))
import Railgun.Crypto (poseidonHash, computeNullifier)

-- | A note that can be spent (has all info needed for witness)
data SpendableNote = SpendableNote
  { snNoteIndex :: Integer      -- ^ Leaf index in Merkle tree
  , snNpk :: Integer            -- ^ Note public key
  , snValue :: Integer          -- ^ Amount in note
  , snTokenAddress :: Text      -- ^ Token address
  , snRandom :: Integer         -- ^ Random component of note
  } deriving (Show, Eq)

-- | Circuit inputs in the format expected by Railgun circuit (via snarkjs)
-- Field names must match exactly what the circuit expects
data CircuitInputs = CircuitInputs
  { -- Public inputs
    ciMerkleRoot :: Text              -- merkleRoot
  , ciBoundParamsHash :: Text         -- boundParamsHash
  , ciNullifiers :: [Text]            -- nullifiers (array, size depends on circuit)
  , ciCommitmentsOut :: [Text]        -- commitmentsOut (array)
    -- Private inputs
  , ciToken :: Text                   -- token (address as uint256)
  , ciPublicKey :: [Text]             -- publicKey [x, y] (EdDSA public key)
  , ciSignature :: [Text]             -- signature [R8x, R8y, S]
  , ciRandomIn :: [Text]              -- randomIn (array)
  , ciValueIn :: [Text]               -- valueIn (array)
  , ciPathElements :: [Text]          -- pathElements (flattened merkle paths)
  , ciLeavesIndices :: [Text]         -- leavesIndices (leaf positions)
  , ciNullifyingKey :: Text           -- nullifyingKey
  , ciNpkOut :: [Text]                -- npkOut (output note public keys)
  , ciValueOut :: [Text]              -- valueOut (output values)
  } deriving (Show, Eq, Generic)

instance ToJSON CircuitInputs where
  toJSON CircuitInputs{..} = object
    [ "merkleRoot" .= ciMerkleRoot
    , "boundParamsHash" .= ciBoundParamsHash
    , "nullifiers" .= ciNullifiers
    , "commitmentsOut" .= ciCommitmentsOut
    , "token" .= ciToken
    , "publicKey" .= ciPublicKey
    , "signature" .= ciSignature
    , "randomIn" .= ciRandomIn
    , "valueIn" .= ciValueIn
    , "pathElements" .= ciPathElements
    , "leavesIndices" .= ciLeavesIndices
    , "nullifyingKey" .= ciNullifyingKey
    , "npkOut" .= ciNpkOut
    , "valueOut" .= ciValueOut
    ]

-- | Build witness for unshield (1 input, 2 outputs circuit)
-- For unshield: spending 1 note, outputting unshield commitment + optional change
buildUnshieldWitness 
  :: SpendableNote       -- ^ The note to spend
  -> MerkleProof         -- ^ Merkle proof for the note
  -> Integer             -- ^ Nullifying key
  -> (Integer, Integer)  -- ^ Public key (x, y)
  -> (Integer, Integer, Integer)  -- ^ Signature (R8x, R8y, S)
  -> Text                -- ^ Recipient address
  -> Integer             -- ^ Amount to unshield
  -> Integer             -- ^ Bound params hash (from contract)
  -> Integer             -- ^ Merkle root
  -> Either Text CircuitInputs
buildUnshieldWitness note proof nullifyingKey (pkX, pkY) (sigR8x, sigR8y, sigS) recipient amount boundParamsHash merkleRoot = do
  -- Validate note has enough value
  if snValue note < amount
    then Left $ "Note value " <> T.pack (show (snValue note)) 
             <> " less than unshield amount " <> T.pack (show amount)
    else Right ()
  
  -- Compute nullifier: poseidon(nullifyingKey, leafIndex)
  let leafIndex = snNoteIndex note
      npk = snNpk note
      nullifier = computeNullifier nullifyingKey leafIndex
  
  -- Token as uint256
  let tokenId = hexToInteger (snTokenAddress note)
  
  -- Recipient as uint256 (for NORMAL unshield, npk = recipient address)
  let recipientAsNpk = hexToInteger recipient
  
  -- Compute output commitments
  -- For 01x02 circuit: 2 output commitments
  -- First output: the unshield (recipient gets tokens)
  -- Second output: change (goes back to us, may be 0 value)
  let unshieldCommitment = poseidonHash [recipientAsNpk, tokenId, amount]
      -- Change commitment - always use our NPK even if value is 0
      -- This ensures ciNpkOut matches the commitment calculation
      changeValue = snValue note - amount
      changeCommitment = poseidonHash [npk, tokenId, changeValue]
  
  -- Format Merkle path elements (16 levels, flattened)
  let pathElements = map (T.pack . show) (mpSiblings proof)
  
  Right CircuitInputs
    { ciMerkleRoot = T.pack $ show merkleRoot
    , ciBoundParamsHash = T.pack $ show boundParamsHash
    , ciNullifiers = [T.pack $ show nullifier]
    , ciCommitmentsOut = [T.pack $ show changeCommitment, T.pack $ show unshieldCommitment]  -- Change first, unshield last (contract expects unshield at last position)
    , ciToken = T.pack $ show tokenId
    , ciPublicKey = [T.pack $ show pkX, T.pack $ show pkY]
    , ciSignature = [T.pack $ show sigR8x, T.pack $ show sigR8y, T.pack $ show sigS]
    , ciRandomIn = [T.pack $ show (snRandom note)]
    , ciValueIn = [T.pack $ show (snValue note)]
    , ciPathElements = pathElements
    , ciLeavesIndices = [T.pack $ show leafIndex]
    , ciNullifyingKey = T.pack $ show nullifyingKey
    , ciNpkOut = [T.pack $ show npk, T.pack $ show recipientAsNpk]  -- Change NPK first, unshield NPK last
    , ciValueOut = [T.pack $ show changeValue, T.pack $ show amount]  -- Change value first, unshield value last
    }

-- | Convert witness to JSON for snarkjs
witnessToJSON :: CircuitInputs -> LBS.ByteString
witnessToJSON = Aeson.encode

-- | Convert hex text to Integer
hexToInteger :: Text -> Integer
hexToInteger t =
  let cleanHex = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
      digits = T.unpack cleanHex
  in foldl (\acc c -> acc * 16 + fromIntegral (hexDigitValue c)) 0 digits
  where
    hexDigitValue :: Char -> Int
    hexDigitValue c
      | c >= '0' && c <= '9' = fromEnum c - fromEnum '0'
      | c >= 'a' && c <= 'f' = fromEnum c - fromEnum 'a' + 10
      | c >= 'A' && c <= 'F' = fromEnum c - fromEnum 'A' + 10
      | otherwise = 0
