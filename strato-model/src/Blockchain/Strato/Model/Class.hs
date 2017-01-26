{-# LANGUAGE Rank2Types #-}
module Blockchain.Strato.Model.Class where

import qualified Data.ByteString as B
import           Data.Word

import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.Code
import           Blockchain.Strato.Model.SHA

class RLPSerializable b => BlockLike b where
    blockHash         :: b -> SHA
    blockHeader       :: forall h. BlockHeaderLike h => b -> h
    blockTransactions :: forall t. TransactionLike t => b -> [t]
    blockUncleHeaders :: forall h. BlockHeaderLike h => b -> [h]

class RLPSerializable h => BlockHeaderLike h where
    blockHeaderHash :: h -> SHA

data TransactionType = ContractCreation | Message deriving (Eq, Ord, Read, Show)

-- todo: newtype all these vague Integers
class RLPSerializable t => TransactionLike t where
    txHash        :: t -> SHA
    txSigner      :: t -> Address
    txNonce       :: t -> Integer
    txType        :: t -> TransactionType
    txSignature   :: t -> (Integer, Integer, Word8)
    txValue       :: t -> Integer
    txDestination :: t -> Maybe Address
    txGasPrice    :: t -> Integer
    txGasLimit    :: t -> Integer
    txCode        :: t -> Maybe Code
    txData        :: t -> Maybe B.ByteString -- todo make a `Code` newtype

    {-# MINIMAL txHash, txSigner, txNonce, txType, txSignature, txValue, txDestination, txGasPrice, txGasLimit,
                txCode, txData #-}

    txSigR :: t -> Integer
    txSigR t = let (r, _, _) = txSignature t in r

    txSigS :: t -> Integer
    txSigS t = let (_, s, _) = txSignature t in s

    txSigV :: t -> Word8
    txSigV t = let (_, _, v) = txSignature t in v
