{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}

module Railgun.Unshield
  ( -- * Types
    UnshieldRequest(..)
  , Transaction(..)
  , SnarkProof(..)
  , G1Point(..)
  , G2Point(..)
  , BoundParams(..)
  , UnshieldType(..)
  , CommitmentCiphertext(..)
    -- * Construction
  , createUnshieldRequest
  , createDummyUnshieldRequest
  , serializeUnshieldRequest
  ) where

import Data.Bits ((.&.), shiftR)
import Data.ByteString (ByteString)
import qualified Data.ByteString as BS
import qualified Data.ByteString.Base16 as B16
import Data.Text (Text)
import qualified Data.Text as T
import qualified Data.Text.Encoding as TE
import qualified Numeric
import qualified Crypto.Hash.Poseidon as Poseidon

import Railgun.Types (TokenData(..), TokenType(..), CommitmentPreimage(..))

-- | G1 point on BN254 curve
data G1Point = G1Point
  { g1X :: Integer
  , g1Y :: Integer
  } deriving (Show, Eq)

-- | G2 point on BN254 curve (coordinates are Fq2 elements)
data G2Point = G2Point
  { g2X :: (Integer, Integer)  -- (x_im, x_re)
  , g2Y :: (Integer, Integer)  -- (y_im, y_re)
  } deriving (Show, Eq)

-- | Groth16 SNARK proof
data SnarkProof = SnarkProof
  { proofA :: G1Point
  , proofB :: G2Point
  , proofC :: G1Point
  } deriving (Show, Eq)

-- | Type of unshield operation
data UnshieldType = UnshieldNone | UnshieldNormal | UnshieldRedirect
  deriving (Show, Eq, Enum)

-- | Commitment ciphertext for encrypted note data
data CommitmentCiphertext = CommitmentCiphertext
  { ccCiphertext :: [ByteString]  -- bytes32[4]
  , ccBlindedSenderViewingKey :: ByteString  -- bytes32
  , ccBlindedReceiverViewingKey :: ByteString  -- bytes32
  , ccAnnotationData :: ByteString  -- bytes (empty for us)
  , ccMemo :: ByteString  -- bytes (empty for us)
  } deriving (Show, Eq)

-- | Bound parameters for transaction
data BoundParams = BoundParams
  { bpTreeNumber :: Int
  , bpMinGasPrice :: Integer
  , bpUnshield :: UnshieldType
  , bpChainID :: Integer
  , bpAdaptContract :: Text  -- address
  , bpAdaptParams :: ByteString  -- bytes32
  , bpCommitmentCiphertext :: [CommitmentCiphertext]  -- ciphertext for change notes
  } deriving (Show, Eq)

-- | A Railgun transaction (for unshield/transfer)
data Transaction = Transaction
  { txProof :: SnarkProof
  , txMerkleRoot :: ByteString  -- bytes32
  , txNullifiers :: [ByteString]  -- bytes32[]
  , txCommitments :: [ByteString]  -- bytes32[]
  , txBoundParams :: BoundParams
  , txUnshieldPreimage :: CommitmentPreimage
  } deriving (Show, Eq)

-- | Full unshield request
data UnshieldRequest = UnshieldRequest
  { urTransactions :: [Transaction]
  } deriving (Show, Eq)

-- | Dummy G1 point (generator)
dummyG1 :: G1Point
dummyG1 = G1Point 1 2

-- | Dummy G2 point (generator)
dummyG2 :: G2Point
dummyG2 = G2Point
  { g2X = (10857046999023057135944570762232829481370756359578518086990519993285655852781,
           11559732032986387107991004021392285783925812861821192530917403151452391805634)
  , g2Y = (8495653923123431417604973247489272438418190587263600148770280649306958101930,
           4082367875863433681332203403145435568316851327593401208105741076214120093531)
  }

-- | Create a dummy SNARK proof (will fail verification but establishes structure)
dummyProof :: SnarkProof
dummyProof = SnarkProof
  { proofA = dummyG1
  , proofB = dummyG2
  , proofC = dummyG1
  }

-- | Compute commitment hash from preimage
-- hash = Poseidon(npk, tokenID, value)
-- For ERC20: tokenID = address as uint256
hashCommitmentPreimage :: CommitmentPreimage -> ByteString
hashCommitmentPreimage CommitmentPreimage{..} =
  let npk = cpNpk
      -- For ERC20, tokenID is just the address as uint256
      tokenID = hexToInteger (tokenAddress cpToken)
      value = cpValue
      -- Poseidon hash with 3 inputs
      hashResult = Poseidon.fromF $ Poseidon.poseidon 
        [Poseidon.toF npk, Poseidon.toF tokenID, Poseidon.toF value]
  in integerToBytes32 hashResult

-- | Convert hex text to Integer
hexToInteger :: Text -> Integer
hexToInteger t =
  let cleanHex = if "0x" `T.isPrefixOf` T.toLower t then T.drop 2 t else t
  in case B16.decode (TE.encodeUtf8 cleanHex) of
       Right bs -> bytesToInteger bs
       Left _ -> 0

bytesToInteger :: ByteString -> Integer
bytesToInteger = BS.foldl' (\acc b -> acc * 256 + fromIntegral b) 0

-- | Convert Integer to 32-byte ByteString (big-endian)
integerToBytes32 :: Integer -> ByteString
integerToBytes32 n = BS.pack $ reverse $ take 32 $ 
  map (\i -> fromIntegral $ (n `shiftR` (i * 8)) .&. 0xff) [0..31]

-- | Create a real unshield request with actual proof and values
createUnshieldRequest
  :: SnarkProof     -- ^ The generated SNARK proof
  -> ByteString     -- ^ Merkle root (32 bytes)
  -> Integer        -- ^ Nullifier (will be converted to bytes32)
  -> [Integer]      -- ^ Output commitments (will be converted to bytes32)
  -> Text           -- ^ Token address
  -> Integer        -- ^ Amount to unshield
  -> Text           -- ^ Recipient address
  -> Integer        -- ^ Chain ID
  -> Int            -- ^ Tree number
  -> [CommitmentCiphertext]  -- ^ Ciphertexts for non-unshield outputs (change notes)
  -> UnshieldRequest
createUnshieldRequest proof merkleRoot nullifier commitments tokenAddr amount recipient chainId treeNum changeCiphertexts =
  let
    -- Convert nullifier to bytes32
    nullifierBytes = integerToBytes32 nullifier
    
    -- Convert commitments to bytes32
    commitmentBytes = map integerToBytes32 commitments
    
    -- Token data
    tokenData = TokenData
      { tokenType = ERC20
      , tokenAddress = tokenAddr
      , tokenSubID = 0
      }
    
    -- Recipient address as NPK (for NORMAL unshield, npk = recipient address as uint256)
    recipientAsNpk = hexToInteger recipient
    
    -- Unshield preimage - describes what's being withdrawn
    unshieldPreimage = CommitmentPreimage
      { cpNpk = recipientAsNpk
      , cpToken = tokenData
      , cpValue = amount
      }
    
    -- Ciphertext length must equal commitments.length - 1
    -- (the last commitment is the unshield itself, which has no ciphertext)
    ciphertextForChange = changeCiphertexts
    
    boundParams = BoundParams
      { bpTreeNumber = treeNum
      , bpMinGasPrice = 0
      , bpUnshield = UnshieldNormal
      , bpChainID = chainId
      , bpAdaptContract = "0x0000000000000000000000000000000000000000"
      , bpAdaptParams = BS.replicate 32 0
      , bpCommitmentCiphertext = ciphertextForChange
      }
    
    -- The transaction
    tx = Transaction
      { txProof = proof
      , txMerkleRoot = merkleRoot
      , txNullifiers = [nullifierBytes]
      , txCommitments = commitmentBytes
      , txBoundParams = boundParams
      , txUnshieldPreimage = unshieldPreimage
      }
    
  in UnshieldRequest { urTransactions = [tx] }

-- | Create a dummy unshield request
-- This will fail on-chain (invalid proof) but establishes the transaction structure
createDummyUnshieldRequest 
  :: Text           -- ^ Token address
  -> Integer        -- ^ Amount to unshield
  -> Text           -- ^ Recipient address (for unshield)
  -> Integer        -- ^ Chain ID
  -> ByteString     -- ^ Merkle root (32 bytes)
  -> Int            -- ^ Tree number
  -> UnshieldRequest
createDummyUnshieldRequest tokenAddr amount recipient chainId merkleRoot treeNum =
  let
    
    -- Dummy nullifier (would be computed from note + spending key)
    dummyNullifier = BS.replicate 32 0x02
    
    -- Token data
    tokenData = TokenData
      { tokenType = ERC20
      , tokenAddress = tokenAddr
      , tokenSubID = 0
      }
    
    -- Recipient address as NPK (for NORMAL unshield, npk = recipient address as uint256)
    recipientAsNpk = hexToInteger recipient
    
    -- Unshield preimage - describes what's being withdrawn
    unshieldPreimage = CommitmentPreimage
      { cpNpk = recipientAsNpk  -- Recipient's public address
      , cpToken = tokenData
      , cpValue = amount
      }
    
    -- Compute commitment hash for the unshield
    -- This must be the last element of txCommitments
    unshieldCommitmentHash = hashCommitmentPreimage unshieldPreimage
    
    -- Bound params
    boundParams = BoundParams
      { bpTreeNumber = treeNum
      , bpMinGasPrice = 0
      , bpUnshield = UnshieldNormal
      , bpChainID = chainId
      , bpAdaptContract = "0x0000000000000000000000000000000000000000"
      , bpAdaptParams = BS.replicate 32 0
      , bpCommitmentCiphertext = []  -- Empty since we have 1 commitment (unshield)
      }
    
    -- The transaction
    tx = Transaction
      { txProof = dummyProof
      , txMerkleRoot = merkleRoot
      , txNullifiers = [dummyNullifier]
      , txCommitments = [unshieldCommitmentHash]  -- Hash of unshield preimage
      , txBoundParams = boundParams
      , txUnshieldPreimage = unshieldPreimage
      }
    
  in UnshieldRequest { urTransactions = [tx] }

-- | Serialize unshield request to JSON-like text (for debugging)
serializeUnshieldRequest :: UnshieldRequest -> Text
serializeUnshieldRequest UnshieldRequest{..} = T.unlines
  [ "UnshieldRequest {"
  , "  transactions: ["
  , T.unlines $ map serializeTx urTransactions
  , "  ]"
  , "}"
  ]
  where
    serializeTx Transaction{..} = T.unlines
      [ "    Transaction {"
      , "      proof: " <> serializeProof txProof
      , "      merkleRoot: 0x" <> bytesToHex txMerkleRoot
      , "      nullifiers: [" <> T.intercalate ", " (map (("0x" <>) . bytesToHex) txNullifiers) <> "]"
      , "      commitments: [" <> T.intercalate ", " (map (("0x" <>) . bytesToHex) txCommitments) <> "]"
      , "      boundParams: " <> serializeBoundParams txBoundParams
      , "      unshieldPreimage: " <> serializePreimage txUnshieldPreimage
      , "    }"
      ]
    
    serializeProof SnarkProof{..} = T.concat
      [ "{ a: ", serializeG1 proofA
      , ", b: ", serializeG2 proofB
      , ", c: ", serializeG1 proofC
      , " }"
      ]
    
    serializeG1 G1Point{..} = T.concat ["(", T.pack (show g1X), ", ", T.pack (show g1Y), ")"]
    
    serializeG2 G2Point{..} = T.concat 
      [ "([", T.pack (show $ fst g2X), ", ", T.pack (show $ snd g2X), "], "
      , "[", T.pack (show $ fst g2Y), ", ", T.pack (show $ snd g2Y), "])"
      ]
    
    serializeBoundParams BoundParams{..} = T.concat
      [ "{ treeNumber: ", T.pack (show bpTreeNumber)
      , ", unshield: ", T.pack (show bpUnshield)
      , ", chainID: ", T.pack (show bpChainID)
      , " }"
      ]
    
    serializePreimage CommitmentPreimage{..} = T.concat
      [ "{ npk: 0x", T.pack (showHex cpNpk "")
      , ", token: ", tokenAddress cpToken
      , ", value: ", T.pack (show cpValue)
      , " }"
      ]
    
    showHex n s = Numeric.showHex n s
    
    bytesToHex = TE.decodeUtf8 . B16.encode
