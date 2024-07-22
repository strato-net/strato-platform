{-# LANGUAGE DeriveDataTypeable #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE ScopedTypeVariables #-}

{-# OPTIONS_GHC -fno-warn-orphans #-}

module Blockchain.Data.BlockHeader
  ( BlockHeader (..),
    headerHash,
    extraData2TxsLen,
    mixHashlens,
    extraDataLens,
    txsLen2ExtraData,
    getBlockDifficulty,
    getBlockGasLimit,
    getBlockOmmersHash
  )
where

import BlockApps.X509.Certificate
import Blockchain.Data.RLP
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.Strato.Model.ChainMember
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Keccak256
import Blockchain.Strato.Model.PositiveInteger
import Blockchain.Strato.Model.Secp256k1
import Blockchain.Strato.Model.Validator
import Control.DeepSeq
import Control.Lens
import Control.Monad
import Data.Aeson
import Data.Binary
import Data.Bits (shiftL, shiftR)
import qualified Data.ByteString as B
import Data.ByteString.Arbitrary
import Data.Data
import Data.Time
import Data.Time.Clock.POSIX
import GHC.Generics
import Numeric
import Test.QuickCheck
import qualified Text.Colors as CL
import Text.Format
import Text.Tools

newtype DummyCertRevocation = DummyCertRevocation String deriving (Show, Read, Eq, Generic, Data, ToJSON, RLPSerializable)

instance Binary DummyCertRevocation
instance NFData DummyCertRevocation

data BlockHeader =
  BlockHeader {
    parentHash :: Keccak256,
    ommersHash :: Keccak256,
    beneficiary :: ChainMemberParsedSet,
    stateRoot :: MP.StateRoot,
    transactionsRoot :: MP.StateRoot,
    receiptsRoot :: MP.StateRoot,
    logsBloom :: B.ByteString,
    difficulty :: Integer,
    number :: Integer,
    gasLimit :: Integer,
    gasUsed :: Integer,
    timestamp :: UTCTime,
    extraData :: B.ByteString,
    mixHash :: Keccak256,
    nonce :: Word64
  } |
  BlockHeaderV2 {
    parentHash :: Keccak256,
    stateRoot :: MP.StateRoot,
    transactionsRoot :: MP.StateRoot,
    receiptsRoot :: MP.StateRoot,
    logsBloom :: B.ByteString,
    number :: Integer,
    timestamp :: UTCTime,
    extraData :: B.ByteString,
    newValidators :: [Validator],
    removedValidators :: [Validator],
    newCerts :: [X509Certificate],
    revokedCerts :: [DummyCertRevocation],
    signatures :: [Signature]
  }
  deriving (Eq, Show, Generic)

instance Binary UTCTime where
  put = put . (round :: POSIXTime -> Integer) . utcTimeToPOSIXSeconds
  get = (posixSecondsToUTCTime . fromInteger) <$> get

instance Binary BlockHeader

instance NFData BlockHeader

getBlockDifficulty :: BlockHeader -> Maybe Integer
getBlockDifficulty BlockHeader {..} = Just difficulty
getBlockDifficulty BlockHeaderV2 {} = Nothing

getBlockGasLimit :: BlockHeader -> Maybe Integer
getBlockGasLimit BlockHeader {..} = Just gasLimit
getBlockGasLimit BlockHeaderV2 {} = Nothing

getBlockOmmersHash :: BlockHeader -> Maybe Keccak256
getBlockOmmersHash BlockHeader {..} = Just ommersHash
getBlockOmmersHash BlockHeaderV2 {} = Nothing

makeLensesFor [("extraData", "extraDataLens"), ("mixHash", "mixHashlens")] ''BlockHeader

instance Format BlockHeader where
  format header@(BlockHeader ph oh b sr tr rr _ d number' gl gu ts ed _ nonce') =
    CL.blue ("BlockHeader #" ++ show number') ++ " " ++ format (headerHash header)
      ++ tab'
        ( "\nparentHash: " ++ format ph ++ "\n"
          ++ "ommersHash: " ++ format oh ++ (if oh == hash (B.pack [0xc0]) then " (the empty array)\n" else "\n")
          ++ "beneficiary: " ++ format b ++ "\n"
          ++ "stateRoot: " ++ format sr ++ "\n"
          ++ "transactionsRoot: " ++ format tr ++ "\n"
          ++ "receiptsRoot: " ++ format rr ++ "\n"
          ++ "difficulty: " ++ show d ++ "\n"
          ++ "gasLimit: " ++ show gl ++ "\n"
          ++ "gasUsed: " ++ show gu ++ "\n"
          ++ "timestamp: " ++ show ts ++ "\n"
          ++ "extraData: " ++ show ed ++ "\n"
          ++ "nonce: " ++ showHex nonce' "" ++ "\n"
        )
  format header@BlockHeaderV2{..} =
    CL.blue ("BlockHeader (version 2) #" ++ show number) ++ " " ++ format (headerHash header)
      ++ tab'
        ( "\nparentHash: " ++ format parentHash ++ "\n"
            ++ "stateRoot: " ++ format stateRoot ++ "\n"
            ++ "transactionsRoot: " ++ format transactionsRoot ++ "\n"
            ++ "receiptsRoot: " ++ format receiptsRoot ++ "\n"
            ++ "timestamp: " ++ show timestamp ++ "\n"
            ++ "extraData: " ++ show extraData ++ "\n"
            ++ "newValidators: " ++ show newValidators ++ "\n"
            ++ "removedValidators: " ++ show removedValidators ++ "\n"
            ++ "newCerts: " ++ show newCerts ++ "\n"
            ++ "revokedCerts: " ++ show revokedCerts ++ "\n"
            ++ "signatures: " ++ show signatures ++ "\n"
        )

instance RLPSerializable BlockHeader where
  rlpEncode (BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
    RLPArray $
      [ rlpEncode ph,
        rlpEncode oh,
        rlpEncode b,
        rlpEncode sr,
        rlpEncode tr,
        rlpEncode rr,
        rlpEncode lb,
        rlpEncode d,
        rlpEncode number',
        rlpEncode gl,
        rlpEncode gu,
        rlpEncode (round $ utcTimeToPOSIXSeconds ts :: Integer),
        rlpEncode ed,
        rlpEncode mh,
        rlpEncode $ B.pack $ word64ToBytes nonce'
      ]
  rlpEncode BlockHeaderV2{..} =
    RLPArray $
      [ rlpEncode (2::Integer), -- BlockHeader version number
        rlpEncode parentHash,
        rlpEncode stateRoot,
        rlpEncode transactionsRoot,
        rlpEncode receiptsRoot,
        rlpEncode logsBloom,
        rlpEncode number,
        rlpEncode (round $ utcTimeToPOSIXSeconds timestamp :: Integer),
        rlpEncode extraData,
        rlpEncode newValidators,
        rlpEncode removedValidators,
        rlpEncode newCerts,
        rlpEncode revokedCerts,
        rlpEncode signatures
      ]
  rlpDecode (RLPArray [ph, oh, b, sr, tr, rr, lb, d, number', gl, gu, ts, ed, mh, nonce']) =
        BlockHeader
        { parentHash = rlpDecode ph,
          ommersHash = rlpDecode oh,
          beneficiary = rlpDecode b,
          stateRoot = rlpDecode sr,
          transactionsRoot = rlpDecode tr,
          receiptsRoot = rlpDecode rr,
          logsBloom = rlpDecode lb,
          difficulty = rlpDecode d,
          number = rlpDecode number',
          gasLimit = rlpDecode gl,
          gasUsed = rlpDecode gu,
          timestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
          extraData = rlpDecode ed,
          mixHash = rlpDecode mh,
          nonce = bytesToWord64 $ B.unpack $ rlpDecode nonce'
        }
  rlpDecode (RLPArray [v, ph, sr, tr, rr, lb, number', ts, ed, nv, rv, nc, rc, s]) =
    case rlpDecode v of
      (2 :: Integer) ->
        BlockHeaderV2
        { parentHash = rlpDecode ph,
          stateRoot = rlpDecode sr,
          transactionsRoot = rlpDecode tr,
          receiptsRoot = rlpDecode rr,
          logsBloom = rlpDecode lb,
          number = rlpDecode number',
          timestamp = posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
          extraData = rlpDecode ed,
          newValidators = rlpDecode nv,
          removedValidators = rlpDecode rv,
          newCerts = rlpDecode nc,
          revokedCerts = rlpDecode rc,
          signatures = rlpDecode s
        }
      versionNumber -> error $ "malformed block format: unknown version number: " ++ show versionNumber
  rlpDecode x = error $ "can not run rlpDecode on BlockHeader for value " ++ show x

instance BlockHeaderLike BlockHeader where
  blockHeaderBlockNumber = number
  blockHeaderParentHash = parentHash
  blockHeaderOmmersHash = ommersHash
  blockHeaderBeneficiary = beneficiary
  blockHeaderStateRoot = MP.unboxStateRoot . stateRoot
  blockHeaderTransactionsRoot = MP.unboxStateRoot . transactionsRoot
  blockHeaderReceiptsRoot = MP.unboxStateRoot . receiptsRoot
  blockHeaderLogsBloom = logsBloom
  blockHeaderGasLimit = gasLimit
  blockHeaderGasUsed = gasUsed
  blockHeaderDifficulty = difficulty
  blockHeaderNonce = nonce
  blockHeaderExtraData = extraData
  blockHeaderTimestamp = timestamp
  blockHeaderMixHash = mixHash

  blockHeaderModifyExtra f h = h {extraData = f (extraData h)}

  morphBlockHeader b =
    BlockHeader
      { number = blockHeaderBlockNumber b,
        parentHash = blockHeaderParentHash b,
        ommersHash = blockHeaderOmmersHash b,
        beneficiary = blockHeaderBeneficiary b,
        stateRoot = MP.StateRoot $ blockHeaderStateRoot b,
        transactionsRoot = MP.StateRoot $ blockHeaderTransactionsRoot b,
        receiptsRoot = MP.StateRoot $ blockHeaderReceiptsRoot b,
        logsBloom = blockHeaderLogsBloom b,
        gasLimit = blockHeaderGasLimit b,
        gasUsed = blockHeaderGasUsed b,
        difficulty = blockHeaderDifficulty b,
        nonce = blockHeaderNonce b,
        extraData = blockHeaderExtraData b,
        timestamp = blockHeaderTimestamp b,
        mixHash = blockHeaderMixHash b
      }

headerHash :: BlockHeader -> Keccak256
headerHash = blockHeaderHash

txsLen2ExtraData :: Int -> B.ByteString
txsLen2ExtraData len = B.singleton len1 <> B.singleton len2 <> B.replicate 30 0
  where
    len1 = fromIntegral $ shiftR len 8
    len2 = fromIntegral len

extraData2TxsLen :: B.ByteString -> Maybe Int
extraData2TxsLen ed = guard (B.length ed >= 32) >> result
  where
    len1 = toInteger $ B.index ed 0
    len2 = toInteger $ B.index ed 1
    len = (shiftL len1 8) + len2
    result = case len of
      0 -> Nothing
      x -> Just (fromInteger x :: Int)

instance Arbitrary BlockHeader where
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
      BlockHeader
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
