{-# LANGUAGE DataKinds #-}
{-# LANGUAGE DeriveAnyClass #-}
{-# LANGUAGE DeriveGeneric #-}
{-# LANGUAGE FlexibleContexts #-}
{-# LANGUAGE FlexibleInstances #-}
{-# LANGUAGE GeneralizedNewtypeDeriving #-}
{-# LANGUAGE MultiParamTypeClasses #-}
{-# LANGUAGE OverloadedLists #-}
{-# LANGUAGE OverloadedStrings #-}
{-# LANGUAGE RecordWildCards #-}
{-# LANGUAGE TypeApplications #-}
{-# OPTIONS_GHC -fno-warn-orphans #-}

-- {-# OPTIONS -fno-warn-unused-top-binds #-}
-- {-# OPTIONS -fno-warn-unused-imports #-}

module Blockchain.Data.AlternateTransaction
  ( -- Number type reexports
    Transaction (..),
    UnsignedTransaction (..),
    rlpHash,
  )
where

import Blockchain.Data.RLP
import Blockchain.Strato.Model.Address
import Blockchain.Strato.Model.ChainId
import Blockchain.Strato.Model.Code
import Blockchain.Strato.Model.ExtendedWord
import Blockchain.Strato.Model.Gas
import Blockchain.Strato.Model.Keccak256 hiding (rlpHash)
import Blockchain.Strato.Model.Nonce
import Blockchain.Strato.Model.Wei
import Control.DeepSeq (NFData)
import qualified Data.Aeson as A
import Data.ByteString (ByteString)
import Data.Map.Strict (Map)
import Data.Maybe
import Data.Text (Text)
import GHC.Generics
import GHC.Natural
import Generic.Random
import Test.QuickCheck hiding ((.&.))
import Test.QuickCheck.Instances ()

--------------------------------------------------------------------------------

data Transaction = Transaction
  { transactionNonce :: Nonce,
    transactionGasPrice :: Wei,
    transactionGasLimit :: Gas,
    transactionTo :: Maybe Address,
    transactionValue :: Wei,
    transactionInitOrData :: Code,
    transactionChainId :: Maybe ChainId,
    transactionV :: Natural,
    transactionR :: Word256,
    transactionS :: Word256,
    transactionMetadata :: Maybe (Map Text Text)
  }
  deriving (Eq, Show, Generic, NFData)

instance RLPSerializable Transaction where
  rlpEncode Transaction {..} =
    RLPArray $
      [ rlpEncode transactionNonce,
        rlpEncode transactionGasPrice,
        rlpEncode transactionGasLimit,
        rlpEncode transactionTo,
        rlpEncode transactionValue,
        rlpEncode transactionInitOrData,
        rlpEncode transactionV,
        rlpEncode transactionR,
        rlpEncode transactionS
      ]
        ++ ( case transactionChainId of
               Nothing -> []
               Just cid -> [rlpEncode cid]
           )
        ++ ( case transactionMetadata of
               Nothing -> []
               Just md -> [rlpEncode md]
           )
  rlpDecode (RLPArray (n : gp : gl : to' : va : iod : v' : r' : s' : rest)) =
    let (cid, md) = case rest of
          [] -> (Nothing, Nothing)
          [c] -> case c of
            a@(RLPArray _) -> (Nothing, Just $ rlpDecode a)
            cid' -> (Just $ rlpDecode cid', Nothing)
          (c : m : _) -> (Just $ rlpDecode c, Just $ rlpDecode m)
     in Transaction
          (rlpDecode n)
          (rlpDecode gp)
          (rlpDecode gl)
          (rlpDecode to')
          (rlpDecode va)
          (rlpDecode iod)
          cid
          (rlpDecode v')
          (rlpDecode r')
          (rlpDecode s')
          md
  rlpDecode x = error $ "rlpDecode Transaction: Got " ++ show x

data UnsignedTransaction = UnsignedTransaction
  { unsignedTransactionNonce :: Nonce,
    unsignedTransactionGasPrice :: Wei,
    unsignedTransactionGasLimit :: Gas,
    unsignedTransactionTo :: Maybe Address,
    unsignedTransactionValue :: Wei,
    unsignedTransactionInitOrData :: Code,
    unsignedTransactionChainId :: Maybe ChainId,
    unsignedTransactionNetworkId :: Maybe Natural
  }
  deriving (Eq, Show, Generic, A.ToJSON, A.FromJSON)

instance Arbitrary UnsignedTransaction where
  arbitrary = genericArbitrary uniform

instance RLPSerializable UnsignedTransaction where
  rlpEncode UnsignedTransaction {..} =
    RLPArray $
      [ rlpEncode unsignedTransactionNonce,
        rlpEncode unsignedTransactionGasPrice,
        rlpEncode unsignedTransactionGasLimit,
        rlpEncode unsignedTransactionTo,
        rlpEncode unsignedTransactionValue,
        rlpEncode unsignedTransactionInitOrData
      ]
        ++ (maybeToList $ fmap rlpEncode unsignedTransactionChainId)
        ++ case unsignedTransactionNetworkId of
            Nothing -> []
            Just nid -> [RLPArray [rlpEncode nid]]
  rlpDecode (RLPArray (n : gp : gl : to' : va : iod : rest)) =
    let (chainid, netid) = case rest of 
          [] -> (Nothing, Nothing)
          [RLPArray [nid]] -> (Nothing, Just $ rlpDecode nid)
          [cid] -> (Just $ rlpDecode cid, Nothing)
          [cid, RLPArray [nid]] -> (Just $ rlpDecode cid, Just $ rlpDecode nid)
          x -> error $ "rlpDecode UnsignedTransaction: Too many entries, got: " ++ show x
    in UnsignedTransaction
      (rlpDecode n)
      (rlpDecode gp)
      (rlpDecode gl)
      (rlpDecode to')
      (rlpDecode va)
      (rlpDecode iod)
      chainid
      netid
  rlpDecode x = error $ "rlpDecode UnsignedTransaction: Got " ++ show x

rlpHash :: RLPSerializable x => x -> ByteString
rlpHash =
  keccak256ToByteString
    . hash
    . rlpSerialize
    . rlpEncode
