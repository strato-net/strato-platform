{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.BlockData where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.ChainMember (ChainMemberParsedSet)
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.PositiveInteger
import Blockchain.Strato.Model.StateRoot
import Control.DeepSeq
import Control.Lens
import Data.Binary
import Data.ByteString (ByteString)
import qualified Data.ByteString as B
import Data.ByteString.Arbitrary
import Data.Data
import Data.Time
import Data.Time.Clock.POSIX
import GHC.Generics
import Numeric
import Test.QuickCheck
import Text.Colors
import Text.Format

data BlockData =
  BlockData {
    blockDataParentHash :: Keccak256,
    blockDataUnclesHash :: Keccak256,
    blockDataCoinbase :: ChainMemberParsedSet,
    blockDataStateRoot :: StateRoot,
    blockDataTransactionsRoot :: StateRoot,
    blockDataReceiptsRoot :: StateRoot,
    blockDataLogBloom :: ByteString,
    blockDataDifficulty :: Integer,
    blockDataNumber :: Integer,
    blockDataGasLimit :: Integer,
    blockDataGasUsed :: Integer,
    blockDataTimestamp :: UTCTime,
    blockDataExtraData :: ByteString,
    blockDataNonce :: Word64,
    blockDataMixHash :: Keccak256
    } deriving (Eq, Read, Show, Generic, Data)

makeLensesFor [("blockDataExtraData", "extraDataLens"), ("blockDataMixHash", "mixHashlens")] ''BlockData

instance Binary UTCTime where
  put = put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds
  get = (posixSecondsToUTCTime . fromInteger) <$> get

instance Binary BlockData

instance NFData BlockData

instance RLPSerializable BlockData where
  rlpDecode (RLPArray [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15]) =
    BlockData
      { blockDataParentHash = rlpDecode v1,
        blockDataUnclesHash = rlpDecode v2,
        blockDataCoinbase = rlpDecode v3,
        blockDataStateRoot = rlpDecode v4,
        blockDataTransactionsRoot = rlpDecode v5,
        blockDataReceiptsRoot = rlpDecode v6,
        blockDataLogBloom = rlpDecode v7,
        blockDataDifficulty = rlpDecode v8,
        blockDataNumber = rlpDecode v9,
        blockDataGasLimit = rlpDecode v10,
        blockDataGasUsed = rlpDecode v11,
        blockDataTimestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode v12,
        blockDataExtraData = rlpDecode v13,
        blockDataMixHash = rlpDecode v14,
        blockDataNonce = bytesToWord64 $ B.unpack $ rlpDecode v15
      }
  rlpDecode (RLPArray arr) = error ("Error in rlpDecode for Block: wrong number of items, expected 15, got " ++ show (length arr) ++ ", arr = " ++ format arr)
  rlpDecode x = error ("rlp2BlockData called on non block object: " ++ show x)

  rlpEncode bd =
    RLPArray
      [ rlpEncode $ blockDataParentHash bd,
        rlpEncode $ blockDataUnclesHash bd,
        rlpEncode $ blockDataCoinbase bd,
        rlpEncode $ blockDataStateRoot bd,
        rlpEncode $ blockDataTransactionsRoot bd,
        rlpEncode $ blockDataReceiptsRoot bd,
        rlpEncode $ blockDataLogBloom bd,
        rlpEncode $ blockDataDifficulty bd,
        rlpEncode $ blockDataNumber bd,
        rlpEncode $ blockDataGasLimit bd,
        rlpEncode $ blockDataGasUsed bd,
        rlpEncode (round $ utcTimeToPOSIXSeconds $ blockDataTimestamp bd :: Integer),
        rlpEncode $ blockDataExtraData bd,
        rlpEncode $ blockDataMixHash bd,
        rlpEncode $ B.pack $ word64ToBytes $ blockDataNonce bd
      ]

instance Format BlockData where
  format b =
    "parentHash: " ++ format (blockDataParentHash b) ++ "\n"
      ++ "unclesHash: "
      ++ format (blockDataUnclesHash b)
      ++ (if blockDataUnclesHash b == hash (B.pack [0xc0]) then " (the empty array)\n" else "\n")
      ++ "coinbase: "
      ++ (format $ blockDataCoinbase b)
      ++ "\n"
      ++ "stateRoot: "
      ++ format (blockDataStateRoot b)
      ++ "\n"
      ++ "transactionsRoot: "
      ++ format (blockDataTransactionsRoot b)
      ++ "\n"
      ++ "receiptsRoot: "
      ++ format (blockDataReceiptsRoot b)
      ++ "\n"
      ++ "difficulty: "
      ++ show (blockDataDifficulty b)
      ++ "\n"
      ++ "gasLimit: "
      ++ show (blockDataGasLimit b)
      ++ "\n"
      ++ "gasUsed: "
      ++ show (blockDataGasUsed b)
      ++ "\n"
      ++ "timestamp: "
      ++ show (blockDataTimestamp b)
      ++ "\n"
      ++ "extraData: "
      ++ blue (format $ blockDataExtraData b)
      ++ "\n"
      ++ "nonce: "
      ++ showHex (blockDataNonce b) ""
      ++ "\n"


instance BlockHeaderLike BlockData where
  blockHeaderBlockNumber = blockDataNumber
  blockHeaderParentHash = blockDataParentHash
  blockHeaderOmmersHash = blockDataUnclesHash
  blockHeaderBeneficiary = blockDataCoinbase -- blockHeaderBeneficiaryOrg      = blockDataCoinbaseOrg?
  blockHeaderStateRoot = unboxStateRoot . blockDataStateRoot
  blockHeaderTransactionsRoot = unboxStateRoot . blockDataTransactionsRoot
  blockHeaderReceiptsRoot = unboxStateRoot . blockDataReceiptsRoot
  blockHeaderLogsBloom = blockDataLogBloom
  blockHeaderGasLimit = blockDataGasLimit
  blockHeaderGasUsed = blockDataGasUsed
  blockHeaderDifficulty = blockDataDifficulty
  blockHeaderNonce = blockDataNonce
  blockHeaderExtraData = blockDataExtraData
  blockHeaderTimestamp = blockDataTimestamp
  blockHeaderMixHash = blockDataMixHash

  blockHeaderModifyExtra = over extraDataLens

  morphBlockHeader h2 =
    BlockData
      { blockDataNumber = blockHeaderBlockNumber h2,
        blockDataParentHash = blockHeaderParentHash h2,
        blockDataUnclesHash = blockHeaderOmmersHash h2,
        blockDataCoinbase = blockHeaderBeneficiary h2,
        blockDataStateRoot = StateRoot $ blockHeaderStateRoot h2,
        blockDataTransactionsRoot = StateRoot $ blockHeaderTransactionsRoot h2,
        blockDataReceiptsRoot = StateRoot $ blockHeaderReceiptsRoot h2,
        blockDataLogBloom = blockHeaderLogsBloom h2,
        blockDataGasLimit = blockHeaderGasLimit h2,
        blockDataGasUsed = blockHeaderGasUsed h2,
        blockDataDifficulty = blockHeaderDifficulty h2,
        blockDataNonce = blockHeaderNonce h2,
        blockDataExtraData = blockHeaderExtraData h2,
        blockDataTimestamp = blockHeaderTimestamp h2,
        blockDataMixHash = blockHeaderMixHash h2
      }

instance Arbitrary BlockData where
  arbitrary = do
    parentHash <- arbitrary
    uncleHash <- arbitrary
    coinbase <- arbitrary
    stateRoot <- arbitrary
    transactionsRoot <- arbitrary
    receiptsRoot <- arbitrary
    logBloom <- fastRandBs 256 -- 2048-bit bloom filter
    difficulty <- unboxPI <$> arbitrary
    number <- unboxPI <$> arbitrary
    gasLimit <- unboxPI <$> arbitrary
    gasUsed <- unboxPI <$> arbitrary `suchThat` (<= PositiveInteger gasLimit)
    timestamp <- posixSecondsToUTCTime . fromInteger . unboxPI <$> arbitrary
    -- TODO(tim): Rather than making an artificial dependent type, guard Block against
    -- rogue long bytestrings.
    extraData <- B.take 32 <$> arbitrary
    nonce <- arbitrary
    mixHash <- arbitrary
    return
      BlockData
        { blockDataParentHash = parentHash,
          blockDataUnclesHash = uncleHash,
          blockDataCoinbase = coinbase,
          blockDataStateRoot = stateRoot,
          blockDataTransactionsRoot = transactionsRoot,
          blockDataReceiptsRoot = receiptsRoot,
          blockDataLogBloom = logBloom,
          blockDataDifficulty = difficulty,
          blockDataNumber = number,
          blockDataGasLimit = gasLimit,
          blockDataGasUsed = gasUsed,
          blockDataTimestamp = timestamp,
          blockDataExtraData = extraData,
          blockDataNonce = nonce,
          blockDataMixHash = mixHash
        }

