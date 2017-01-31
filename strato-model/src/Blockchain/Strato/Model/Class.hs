module Blockchain.Strato.Model.Class where

import qualified Data.ByteString as B
import           Data.Word
import           Data.Time.Clock

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.SHA

class (RLPSerializable b, BlockHeaderLike h, TransactionLike t) => BlockLike h t b | b -> h t where
    blockHeader       :: b -> h
    blockTransactions :: b -> [t]
    blockUncleHeaders :: b -> [h]

    buildBlock :: h -> [t] -> [h] -> b
    morphBlock :: (BlockLike h2 t2 b2) => b2 -> b
    {-# MINIMAL blockHeader, blockTransactions, blockUncleHeaders, buildBlock, morphBlock #-}

    blockHash :: b -> SHA
    blockHash = blockHeaderHash . blockHeader

class RLPSerializable h => BlockHeaderLike h where
    blockHeaderBlockNumber      :: h -> Integer
    blockHeaderParentHash       :: h -> SHA
    blockHeaderOmmersHash       :: h -> SHA
    blockHeaderBeneficiary      :: h -> Address
    blockHeaderStateRoot        :: h -> B.ByteString -- todo: "StateRoot" thats not the MPDB StateRoot
    blockHeaderTransactionsRoot :: h -> B.ByteString -- todo: ditto
    blockHeaderReceiptsRoot     :: h -> B.ByteString -- todo: ditto
    blockHeaderLogsBloom        :: h -> B.ByteString -- todo: "Bloom" data?
    blockHeaderGasLimit         :: h -> Integer -- todo: "gas" newtype?
    blockHeaderGasUsed          :: h -> Integer -- todo: ditto
    blockHeaderDifficulty       :: h -> Integer
    blockHeaderNonce            :: h -> Word64 -- todo: nonce newtype
    blockHeaderExtraData        :: h -> Integer -- todo: extradata newtype
    blockHeaderTimestamp        :: h -> UTCTime
    blockHeaderMixHash          :: h -> SHA

    morphBlockHeader :: (BlockHeaderLike h2) => h2 -> h
    {-# MINIMAL blockHeaderBlockNumber, blockHeaderParentHash, blockHeaderOmmersHash,
                blockHeaderBeneficiary, blockHeaderStateRoot, blockHeaderTransactionsRoot, blockHeaderReceiptsRoot,
                blockHeaderLogsBloom, blockHeaderDifficulty, blockHeaderGasLimit, blockHeaderGasUsed,
                blockHeaderDifficulty, blockHeaderNonce, blockHeaderExtraData, blockHeaderTimestamp,
                blockHeaderMixHash, morphBlockHeader #-}

    blockHeaderHash :: h -> SHA
    blockHeaderHash = superProprietaryStratoSHAHash . rlpSerialize . rlpEncode

data TransactionType = ContractCreation | Message deriving (Eq, Ord, Read, Show)

-- todo: newtype all these vague Integers
class (RLPSerializable t) => TransactionLike t where
    txHash        :: t -> SHA
    txPartialHash :: t -> SHA
    txSigner      :: t -> Maybe Address
    txNonce       :: t -> Integer
    txType        :: t -> TransactionType
    txSignature   :: t -> (Integer, Integer, Word8)
    txValue       :: t -> Integer
    txDestination :: t -> Maybe Address
    txGasPrice    :: t -> Integer
    txGasLimit    :: t -> Integer
    txCode        :: t -> Maybe Code
    txData        :: t -> Maybe B.ByteString -- todo make a `Code` newtype

    morphTx :: (TransactionLike t2) => t2 -> t
    {-# MINIMAL txHash, txPartialHash, txSigner, txNonce, txType, txSignature, txValue, txDestination, txGasPrice, txGasLimit,
                txCode, txData, morphTx #-}

    txSigR :: t -> Integer
    txSigR t = let (r, _, _) = txSignature t in r

    txSigS :: t -> Integer
    txSigS t = let (_, s, _) = txSignature t in s

    txSigV :: t -> Word8
    txSigV t = let (_, _, v) = txSignature t in v
