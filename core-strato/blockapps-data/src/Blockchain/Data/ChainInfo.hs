{-# OPTIONS -fno-warn-missing-methods #-}
{-# OPTIONS -fno-warn-orphans         #-}
{-# LANGUAGE DataKinds                #-}
{-# LANGUAGE DeriveGeneric            #-}
{-# LANGUAGE FlexibleInstances        #-}
{-# LANGUAGE OverloadedStrings        #-}

module Blockchain.Data.ChainInfo
  ( ChainInfo (..)
  ) where

import           Blockchain.Data.ArbitraryInstances()
import           Blockchain.Data.Enode
import           Blockchain.Data.RLP
import           Blockchain.Strato.Model.Address
import           Blockchain.TypeLits

import           Data.Aeson
import qualified Data.Text                            as T
import           Data.Text.Encoding                   (encodeUtf8, decodeUtf8)

import qualified GHC.Generics                         as GHCG

import           Test.QuickCheck.Arbitrary

data ChainInfo = ChainInfo {
    chainLabel      :: String,
    addRule         :: String,
    removeRule      :: String,
    members         :: [Enode],
    accountBalance  :: [(Address, Integer)]
} deriving (Eq, Read, Show, GHCG.Generic)

instance Arbitrary ChainInfo where
  arbitrary = ChainInfo
          <$> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary
          <*> arbitrary

instance FromJSON ChainInfo where
  parseJSON (Object o) =
    ChainInfo <$>
    o .: "label" <*>
    o .: "addRule" <*>
    o .: "removeRule" <*>
    o .: "members" <*>
    (map toTuple <$> ((o .: "balances") :: NamedMapParser "address" Address "balance" Integer))
  parseJSON x = error $ "couldn't parse JSON for chain info: " ++ show x

instance ToJSON ChainInfo where
  toJSON (ChainInfo cl ar rr ms ab) =
    object [ "label" .= cl
           , "addRule" .= ar
           , "removeRule" .= rr
           , "members" .= ms
           , "balances" .= ((map fromTuple ab) :: NamedMap "address" Address "balance" Integer)
           ]

instance KnownSymbol "address" where
instance KnownSymbol "balance" where

instance RLPSerializable ChainInfo where
  rlpEncode ci = RLPArray
    [ rlpEncode . encodeUtf8 . T.pack $ chainLabel ci
    , rlpEncode . encodeUtf8 . T.pack $ addRule ci
    , rlpEncode . encodeUtf8 . T.pack $ removeRule ci
    , RLPArray . map rlpEncode $ members ci
    , RLPArray . map rlpEncode $ accountBalance ci
    ]
  rlpDecode (RLPArray [cl, ar, rr, RLPArray ms, RLPArray ab]) =
    ChainInfo
      (T.unpack . decodeUtf8 $ rlpDecode cl)
      (T.unpack . decodeUtf8 $ rlpDecode ar)
      (T.unpack . decodeUtf8 $ rlpDecode rr)
      (rlpDecode <$> ms)
      (rlpDecode <$> ab)
  rlpDecode o = error $ "rlpDecode ChainInfo: Expected 5 element RLPArray, got " ++ show o
