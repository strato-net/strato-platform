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
    parentHash :: Keccak256,
    ommersHash :: Keccak256,
    beneficiary :: ChainMemberParsedSet,
    stateRoot :: StateRoot,
    transactionsRoot :: StateRoot,
    receiptsRoot :: StateRoot,
    logsBloom :: ByteString,
    difficulty :: Integer,
    number :: Integer,
    gasLimit :: Integer,
    gasUsed :: Integer,
    timestamp :: UTCTime,
    extraData :: ByteString,
    nonce :: Word64,
    mixHash :: Keccak256
    } deriving (Eq, Read, Show, Generic, Data)

makeLensesFor [("extraData", "extraDataLens"), ("mixHash", "mixHashlens")] ''BlockData

instance Binary UTCTime where
  put = put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds
  get = (posixSecondsToUTCTime . fromInteger) <$> get

instance Binary BlockData

instance NFData BlockData

instance RLPSerializable BlockData where
  rlpDecode (RLPArray [v1, v2, v3, v4, v5, v6, v7, v8, v9, v10, v11, v12, v13, v14, v15]) =
    BlockData
      { parentHash = rlpDecode v1,
        ommersHash = rlpDecode v2,
        beneficiary = rlpDecode v3,
        stateRoot = rlpDecode v4,
        transactionsRoot = rlpDecode v5,
        receiptsRoot = rlpDecode v6,
        logsBloom = rlpDecode v7,
        difficulty = rlpDecode v8,
        number = rlpDecode v9,
        gasLimit = rlpDecode v10,
        gasUsed = rlpDecode v11,
        timestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode v12,
        extraData = rlpDecode v13,
        mixHash = rlpDecode v14,
        nonce = bytesToWord64 $ B.unpack $ rlpDecode v15
      }
  rlpDecode (RLPArray arr) = error ("Error in rlpDecode for Block: wrong number of items, expected 15, got " ++ show (length arr) ++ ", arr = " ++ format arr)
  rlpDecode x = error ("rlp2BlockData called on non block object: " ++ show x)

  rlpEncode bd =
    RLPArray
      [ rlpEncode $ parentHash bd,
        rlpEncode $ ommersHash bd,
        rlpEncode $ beneficiary bd,
        rlpEncode $ stateRoot bd,
        rlpEncode $ transactionsRoot bd,
        rlpEncode $ receiptsRoot bd,
        rlpEncode $ logsBloom bd,
        rlpEncode $ difficulty bd,
        rlpEncode $ number bd,
        rlpEncode $ gasLimit bd,
        rlpEncode $ gasUsed bd,
        rlpEncode (round $ utcTimeToPOSIXSeconds $ timestamp bd :: Integer),
        rlpEncode $ extraData bd,
        rlpEncode $ mixHash bd,
        rlpEncode $ B.pack $ word64ToBytes $ nonce bd
      ]

instance Format BlockData where
  format b =
    "parentHash: " ++ format (parentHash b) ++ "\n"
      ++ "unclesHash: "
      ++ format (ommersHash b)
      ++ (if ommersHash b == hash (B.pack [0xc0]) then " (the empty array)\n" else "\n")
      ++ "coinbase: "
      ++ (format $ beneficiary b)
      ++ "\n"
      ++ "stateRoot: "
      ++ format (stateRoot b)
      ++ "\n"
      ++ "transactionsRoot: "
      ++ format (transactionsRoot b)
      ++ "\n"
      ++ "receiptsRoot: "
      ++ format (receiptsRoot b)
      ++ "\n"
      ++ "difficulty: "
      ++ show (difficulty b)
      ++ "\n"
      ++ "gasLimit: "
      ++ show (gasLimit b)
      ++ "\n"
      ++ "gasUsed: "
      ++ show (gasUsed b)
      ++ "\n"
      ++ "timestamp: "
      ++ show (timestamp b)
      ++ "\n"
      ++ "extraData: "
      ++ blue (format $ extraData b)
      ++ "\n"
      ++ "nonce: "
      ++ showHex (nonce b) ""
      ++ "\n"


instance BlockHeaderLike BlockData where
  blockHeaderBlockNumber = number
  blockHeaderParentHash = parentHash
  blockHeaderOmmersHash = ommersHash
  blockHeaderBeneficiary = beneficiary -- blockHeaderBeneficiaryOrg      = blockDataCoinbaseOrg?
  blockHeaderStateRoot = unboxStateRoot . stateRoot
  blockHeaderTransactionsRoot = unboxStateRoot . transactionsRoot
  blockHeaderReceiptsRoot = unboxStateRoot . receiptsRoot
  blockHeaderLogsBloom = logsBloom
  blockHeaderGasLimit = gasLimit
  blockHeaderGasUsed = gasUsed
  blockHeaderDifficulty = difficulty
  blockHeaderNonce = nonce
  blockHeaderExtraData = extraData
  blockHeaderTimestamp = timestamp
  blockHeaderMixHash = mixHash

  blockHeaderModifyExtra = over extraDataLens

  morphBlockHeader h2 =
    BlockData
      { number = blockHeaderBlockNumber h2,
        parentHash = blockHeaderParentHash h2,
        ommersHash = blockHeaderOmmersHash h2,
        beneficiary = blockHeaderBeneficiary h2,
        stateRoot = StateRoot $ blockHeaderStateRoot h2,
        transactionsRoot = StateRoot $ blockHeaderTransactionsRoot h2,
        receiptsRoot = StateRoot $ blockHeaderReceiptsRoot h2,
        logsBloom = blockHeaderLogsBloom h2,
        gasLimit = blockHeaderGasLimit h2,
        gasUsed = blockHeaderGasUsed h2,
        difficulty = blockHeaderDifficulty h2,
        nonce = blockHeaderNonce h2,
        extraData = blockHeaderExtraData h2,
        timestamp = blockHeaderTimestamp h2,
        mixHash = blockHeaderMixHash h2
      }

instance Arbitrary BlockData where
  arbitrary = do
    parentHash' <- arbitrary
    uncleHash' <- arbitrary
    coinbase' <- arbitrary
    stateRoot' <- arbitrary
    transactionsRoot' <- arbitrary
    receiptsRoot' <- arbitrary
    logBloom' <- fastRandBs 256 -- 2048-bit bloom filter
    difficulty' <- unboxPI <$> arbitrary
    number' <- unboxPI <$> arbitrary
    gasLimit' <- unboxPI <$> arbitrary
    gasUsed' <- unboxPI <$> arbitrary `suchThat` (<= PositiveInteger gasLimit')
    timestamp' <- posixSecondsToUTCTime . fromInteger . unboxPI <$> arbitrary
    -- TODO(tim): Rather than making an artificial dependent type, guard Block against
    -- rogue long bytestrings.
    extraData' <- B.take 32 <$> arbitrary
    nonce' <- arbitrary
    mixHash' <- arbitrary
    return
      BlockData
        { parentHash = parentHash',
          ommersHash = uncleHash',
          beneficiary = coinbase',
          stateRoot = stateRoot',
          transactionsRoot = transactionsRoot',
          receiptsRoot = receiptsRoot',
          logsBloom = logBloom',
          difficulty = difficulty',
          number = number',
          gasLimit = gasLimit',
          gasUsed = gasUsed',
          timestamp = timestamp',
          extraData = extraData',
          nonce = nonce',
          mixHash = mixHash'
        }

