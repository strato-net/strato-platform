
module Blockchain.Data.BlockHeader (
  BlockHeader(..),
  headerHash,
  blockToBlockHeader,
  blockToBody
  ) where

import qualified Data.ByteString as B
import Data.Time
import Data.Time.Clock.POSIX
import Data.Word
import Numeric

import qualified Blockchain.Colors as CL
import Blockchain.Data.Address
import Blockchain.Data.DataDefs
import Blockchain.Data.RLP
import Blockchain.Data.Transaction
import qualified Blockchain.Database.MerklePatricia as MP
import Blockchain.ExtWord
import Blockchain.Format
import Blockchain.SHA
import Blockchain.Util


data BlockHeader =
  BlockHeader {
    parentHash::SHA,
    ommersHash::SHA,
    beneficiary::Address,
    stateRoot::MP.StateRoot,
    transactionsRoot::MP.StateRoot,
    receiptsRoot::MP.StateRoot,
    logsBloom::B.ByteString,
    difficulty::Integer,
    number::Integer,
    gasLimit::Integer,
    gasUsed::Integer,
    timestamp::UTCTime,
    extraData::Integer,
    mixHash::SHA,
    nonce::Word64
    } deriving (Show, Eq)

instance Format BlockHeader where
  format header@(BlockHeader ph oh b sr tr rr _ d number' gl gu ts ed _ nonce') =
    CL.blue ("BlockHeader #" ++ show number') ++ " " ++ (format (headerHash header)) ++
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
         "nonce: " ++ showHex (nonce') "")

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

headerHash::BlockHeader->SHA
headerHash header = hash . rlpSerialize . rlpEncode $ header

blockToBlockHeader::Block->BlockHeader
blockToBlockHeader Block{blockBlockData=bd} = blockDataToBlockHeader bd

blockToBody::Block->([Transaction], [BlockHeader])
blockToBody Block{blockReceiptTransactions=transactions, blockBlockUncles=uncles} =
  (transactions, map blockDataToBlockHeader uncles)

blockDataToBlockHeader::BlockData->BlockHeader
blockDataToBlockHeader (BlockData ph oh b sr tr rr lb d number' gl gu ts ed mh nonce') =
  BlockHeader ph oh b sr tr rr lb d number' gl gu ts ed nonce' mh
