
module Blockchain.Data.BlockHeader (
  BlockHeader(..),
  headerHash,
  blockToBlockHeader,
  blockToBody,
  extraData2TxsLen,
  txsLen2ExtraData
  ) where

import           Control.Monad
import qualified Data.ByteString                    as B
import           Data.Time
import           Data.Time.Clock.POSIX
import           Data.Word
import           Data.Bits (shiftL, shiftR)
import           Numeric

import           Blockchain.Data.Address
import           Blockchain.Data.Block
import           Blockchain.Data.DataDefs
import           Blockchain.Data.RLP
import           Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import           Blockchain.ExtWord
import           Blockchain.SHA
import           Blockchain.Util

import           Blockchain.Strato.Model.Class

import qualified Text.Colors                        as CL
import           Text.Format

data BlockHeader =
  BlockHeader {
    parentHash       :: SHA,
    ommersHash       :: SHA,
    beneficiary      :: Address,
    stateRoot        :: MP.StateRoot,
    transactionsRoot :: MP.StateRoot,
    receiptsRoot     :: MP.StateRoot,
    logsBloom        :: B.ByteString,
    difficulty       :: Integer,
    number           :: Integer,
    gasLimit         :: Integer,
    gasUsed          :: Integer,
    timestamp        :: UTCTime,
    extraData        :: B.ByteString,
    mixHash          :: SHA,
    nonce            :: Word64
    } deriving (Eq, Read, Show)

instance Format BlockHeader where
  format header@(BlockHeader ph oh b sr tr rr _ d number' gl gu ts ed _ nonce') =
    CL.blue ("BlockHeader #" ++ show number') ++ " " ++ format (headerHash header) ++
    tab ("\nparentHash: " ++ format ph ++ "\n" ++
         "ommersHash: " ++ format oh ++
         (if oh == hash (B.pack [0xc0]) then " (the empty array)\n" else "\n") ++
         "beneficiary: " ++ format b ++ "\n" ++
         "stateRoot: " ++ format sr ++ "\n" ++
         "transactionsRoot: " ++ format tr ++ "\n" ++
         "receiptsRoot: " ++ format rr ++ "\n" ++
         "difficulty: " ++ show d ++ "\n" ++
         "gasLimit: " ++ show gl ++ "\n" ++
         "gasUsed: " ++ show gu ++ "\n" ++
         "timestamp: " ++ show ts ++ "\n" ++
         "extraData: " ++ show ed ++ "\n" ++
         "nonce: " ++ showHex nonce' "" ++ "\n")

instance RLPSerializable BlockHeader where
  rlpEncode (BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
    RLPArray $ [
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
    blockHeaderStateRoot        = MP.unboxStateRoot . stateRoot
    blockHeaderTransactionsRoot = MP.unboxStateRoot . transactionsRoot
    blockHeaderReceiptsRoot     = MP.unboxStateRoot . receiptsRoot
    blockHeaderLogsBloom        = logsBloom
    blockHeaderGasLimit         = gasLimit
    blockHeaderGasUsed          = gasUsed
    blockHeaderDifficulty       = difficulty
    blockHeaderNonce            = nonce
    blockHeaderExtraData        = extraData
    blockHeaderTimestamp        = timestamp
    blockHeaderMixHash          = mixHash

    blockHeaderModifyExtra f h  = h{extraData = f (extraData h)}

    morphBlockHeader b          = BlockHeader { number           = blockHeaderBlockNumber b
                                              , parentHash       = blockHeaderParentHash b
                                              , ommersHash       = blockHeaderOmmersHash b
                                              , beneficiary      = blockHeaderBeneficiary b
                                              , stateRoot        = MP.StateRoot $ blockHeaderStateRoot b
                                              , transactionsRoot = MP.StateRoot $ blockHeaderTransactionsRoot b
                                              , receiptsRoot     = MP.StateRoot $ blockHeaderReceiptsRoot b
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

blockToBlockHeader::Block->BlockHeader
blockToBlockHeader Block{blockBlockData=bd} = blockDataToBlockHeader bd

blockToBody::Block->([Transaction], [BlockHeader])
blockToBody Block{blockReceiptTransactions=transactions, blockBlockUncles=uncles} =
  (transactions, map blockDataToBlockHeader uncles)

blockDataToBlockHeader::BlockData->BlockHeader
blockDataToBlockHeader (BlockData ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
  BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed nonce' mh

txsLen2ExtraData :: Int -> B.ByteString
txsLen2ExtraData len = B.singleton len1 <> B.singleton len2 <> B.replicate 30 0
  where len1 = fromIntegral $ shiftR len 8
        len2 = fromIntegral len

extraData2TxsLen :: B.ByteString -> Maybe Int
extraData2TxsLen ed = guard (B.length ed >= 32) >> result
  where len1 = toInteger $ B.index ed 0
        len2 = toInteger $ B.index ed 1
        len = (shiftL len1 8) + len2
        result = case len of
          0 -> Nothing
          x -> Just (fromInteger x :: Int)
