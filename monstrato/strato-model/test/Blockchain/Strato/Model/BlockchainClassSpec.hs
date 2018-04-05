
module Blockchain.Strato.Model.BlockchainClassSpec where

import           Blockchain.Strato.Model.Address
import           Blockchain.Strato.Model.BlockHeaderModel
import           Blockchain.Strato.Model.BlockHeaderModel
import           Blockchain.Strato.Model.BlockModel
import           Blockchain.Strato.Model.SHA
import           Blockchain.Strato.Model.TransactionModel
import           Test.Hspec


import qualified Data.ByteString                          as B
import qualified Data.Map                                 as Map
import           Data.Time
import           Data.Word

data BlockHeaderModel =
  BlockHeaderModel {
     blockNumber      :: Integer,
     parentHash       :: SHA,
     ommersHash       :: SHA,
     beneficiary      :: Address,
     stateRoot        :: B.ByteString,
     receiptsRoot     :: B.ByteString,
     transactionsRoot :: B.ByteString,
     logsBloom        :: B.ByteString,
     gasLimit         :: Integer,
     gasUsed          :: Integer,
     difficulty       :: Integer,
     nonce            :: Word64,
     extraData        :: Integer,
     timestamp        :: UTCTime,
     mixHash          :: SHA
  }

data BlockBodyModel =
  BlockBodyModel {
     transactions :: [TransactionModel],
     uncleHeaders :: BlockHeaderModel
  }

data BlockModel =
  BlockModel {
     header :: BlockHeaderModel,
     body   :: BlockBodyModel
  }

data TransactionType = MessageTransaction
                     | ContractCreationTransaction

type Code = B.ByteString

data TransactionModel =
  TransactionModel {
     txHash        :: SHA,
     txPartialHash :: SHA,
     txSigner      :: Maybe Address,
     txNonce       :: Integer,
     txType        :: TransactionType,
     txSignature   :: (Integer, Integer, Word8),
     txValue       :: Integer,
     txDestination :: Maybe Address,
     txGasPrice    :: Integer,
     txGasLimit    :: Integer,
     txCode        :: Maybe Code,
     txData        :: Maybe B.ByteString
  }

{-
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
-}

data BlockchainModel =
  BlockchainModel {
    bestBlock                  :: BlockModel,
    blockBodyByHash            :: Map.Map BlockHeaderModel BlockBodyModel,
    blockHeaderByNumber        :: Map.Map Int BlockHeaderModel,
    parentChildByHash          :: Map.Map SHA SHA,
    transactionHashByBlockHash :: Map.Map SHA SHA,
    transactionByHash          :: Map.Map SHA TransactionModel
  }

-- instance

spec :: Spec
spec = do
  describe "can get and put blocks in memory" $ do
    it "puts a block" $ do
      True `shouldBe` False
