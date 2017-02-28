{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}

module Blockchain.Strato.Model.BlockHeaderModel where

import qualified Data.ByteString as B
import Data.String
import Data.Time
import Data.Time.Clock.POSIX
import Data.Word

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Class
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.SHA
import Blockchain.Strato.Model.ExtendedWord

import GHC.Generics

newtype StateRoot = StateRoot B.ByteString deriving (Show, Eq, Read, Generic, IsString)

instance RLPSerializable StateRoot where
    rlpEncode (StateRoot x) = rlpEncode x
    rlpDecode x = StateRoot $ rlpDecode x

sha2StateRoot::SHA->StateRoot
sha2StateRoot (SHA x) = StateRoot $ B.pack $ word256ToBytes x

unboxStateRoot :: StateRoot -> B.ByteString
unboxStateRoot (StateRoot b) = b

data BlockHeader =
  BlockHeader {
    parentHash            :: SHA,
    ommersHash            :: SHA,
    beneficiary           :: Address,
    stateRoot             :: StateRoot,
    transactionsRoot      :: StateRoot,
    receiptsRoot          :: StateRoot,
    logsBloom             :: B.ByteString,
    difficulty            :: Integer,
    number                :: Integer,
    gasLimit              :: Integer,
    gasUsed               :: Integer,
    timestamp             :: UTCTime,
    extraData             :: Integer,
    mixHash               :: SHA,
    nonce                 :: Word64
    } deriving (Eq, Read, Show)

instance RLPSerializable BlockHeader where
  rlpEncode (BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
    RLPArray [
      rlpEncode ph,
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
      rlpEncode (round $ utcTimeToPOSIXSeconds ts::Integer),
      rlpEncode ed,
      rlpEncode mh,
      rlpEncode $ B.pack $ word64ToBytes nonce'
      ]
  rlpDecode (RLPArray [ph, oh, b, sr, tr, rr, lb, d, number', gl, gu, ts, ed, mh, nonce']) = 
    BlockHeader {
      parentHash=rlpDecode ph,
      ommersHash=rlpDecode oh,
      beneficiary=rlpDecode b,
      stateRoot=rlpDecode sr,
      transactionsRoot=rlpDecode tr,
      receiptsRoot=rlpDecode rr,
      logsBloom=rlpDecode lb,
      difficulty=rlpDecode d,
      number=rlpDecode number',
      gasLimit=rlpDecode gl,
      gasUsed=rlpDecode gu,
      timestamp=posixSecondsToUTCTime $ fromInteger $ rlpDecode ts,
      extraData=rlpDecode ed,
      mixHash=rlpDecode mh,
      nonce=bytesToWord64 $ B.unpack $ rlpDecode nonce'
      }
  rlpDecode x = error $ "can not run rlpDecode on BlockHeader for value " ++ show x

instance BlockHeaderLike BlockHeader where
    blockHeaderBlockNumber      = number
    blockHeaderParentHash       = parentHash
    blockHeaderOmmersHash       = ommersHash 
    blockHeaderBeneficiary      = beneficiary 
    blockHeaderStateRoot        = unboxStateRoot . stateRoot 
    blockHeaderTransactionsRoot = unboxStateRoot . transactionsRoot
    blockHeaderReceiptsRoot     = unboxStateRoot . receiptsRoot
    blockHeaderLogsBloom        = logsBloom
    blockHeaderGasLimit         = gasLimit
    blockHeaderGasUsed          = gasUsed
    blockHeaderDifficulty       = difficulty
    blockHeaderNonce            = nonce 
    blockHeaderExtraData        = extraData
    blockHeaderTimestamp        = timestamp 
    blockHeaderMixHash          = mixHash

    morphBlockHeader b          = BlockHeader { number           = blockHeaderBlockNumber b
                                              , parentHash       = blockHeaderParentHash b
                                              , ommersHash       = blockHeaderOmmersHash b
                                              , beneficiary      = blockHeaderBeneficiary b
                                              , stateRoot        = StateRoot $ blockHeaderStateRoot b
                                              , transactionsRoot = StateRoot $ blockHeaderTransactionsRoot b
                                              , receiptsRoot     = StateRoot $ blockHeaderReceiptsRoot b
                                              , logsBloom        = blockHeaderLogsBloom b
                                              , gasLimit         = blockHeaderGasLimit b
                                              , gasUsed          = blockHeaderGasUsed b
                                              , difficulty       = blockHeaderDifficulty b
                                              , nonce            = blockHeaderNonce b
                                              , extraData        = blockHeaderExtraData b
                                              , timestamp        = blockHeaderTimestamp b
                                              , mixHash          = blockHeaderMixHash b
                                              } 

headerHash :: BlockHeader->SHA
headerHash = blockHeaderHash


